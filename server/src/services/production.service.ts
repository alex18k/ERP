import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact } from "../utils/date";
import { retryOnDuplicate, lockOrderNo, ORDER_NO_LOCK } from "../utils/retry";
import { generateDocNo, applyBatchIn, applyBatchOut, addStock, resolveBinId } from "./stock.service";
import { resolveUnitRate, toBaseQty } from "../utils/unit";

// ===== 生产订单 =====
// 单号 = 前缀 + 当日最大序号+1（配合 lockOrderNo 串行化，避免 count+1 并发撞号）
export async function generateProductionOrderNo(): Promise<string> {
  const dateStr = localDateCompact();
  const prefix = `MO${dateStr}`;
  const existing = await prisma.productionOrder.findMany({
    where: { orderNo: { startsWith: prefix } },
    select: { orderNo: true },
  });
  let max = 0;
  for (const e of existing) {
    const n = parseInt(e.orderNo.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export interface ProductionOrderInput {
  salesOrderId?: number;
  salesOrderNo?: string;
  materialId: number;
  quantity: number;
  planStartDate?: string;
  planEndDate?: string;
  planner?: string;
  releaseDate?: string;
  remark?: string;
  processRouteId?: number;
}

export async function listProductionOrders(where: any) {
  const { orderNo, materialName, status, page = 1, pageSize = 20 } = where;

  const filters: Prisma.ProductionOrderWhereInput = {};
  if (orderNo) filters.orderNo = { contains: orderNo };
  if (status) {
    const arr = String(status).split(",").map((s) => s.trim()).filter(Boolean);
    filters.status = arr.length === 1 ? arr[0] : { in: arr };
  }
  if (materialName) {
    filters.material = { name: { contains: materialName } };
  }

  const [total, items] = await Promise.all([
    prisma.productionOrder.count({ where: filters }),
    prisma.productionOrder.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, unit: true, location: true } },
        salesOrder: { select: { id: true, orderNo: true, customerName: true } },
        batches: { orderBy: { batchNo: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function createProductionOrders(inputs: ProductionOrderInput[], userId: number) {
  const created: any[] = [];
  const skipped: { materialId: number; salesOrderId: number | null }[] = [];

  // 先全部校验（非制造类 / BOM / 工艺路线），避免中途报错留下半成品
  const resolved: { input: ProductionOrderInput; salesOrderId: number | null; salesOrderNo: string | null; processRouteId: number }[] = [];
  for (const input of inputs) {
    const material = await prisma.material.findUnique({ where: { id: input.materialId } });
    if (!material) throw new Error(`物料ID ${input.materialId} 不存在`);
    if (material.category !== "manufacture") {
      throw new Error(`物料 ${material.code} 非制造类，不能创建生产订单`);
    }

    // 销售订单：可用 id，或用「销售订单号」精确匹配；匹配不到也不报错（允许随意输入）
    let salesOrderId = input.salesOrderId ?? null;
    const salesOrderNo = input.salesOrderNo?.trim() || null;
    if (!salesOrderId && salesOrderNo) {
      const so = await prisma.salesOrder.findFirst({ where: { orderNo: salesOrderNo } });
      if (so) salesOrderId = so.id;
    }

    // 必须有启用中的 BOM
    const bom = await prisma.bom.findFirst({
      where: { productId: input.materialId, status: "active" },
      select: { id: true },
    });
    if (!bom) throw new Error(`物料 ${material.code} 没有启用中的 BOM，不能创建生产订单`);

    // 工艺路线：优先使用本次指定的，否则取产品所属路线；必须启用且含工序
    const processRouteId = input.processRouteId ?? material.processRouteId;
    if (!processRouteId) throw new Error(`物料 ${material.code} 未指定工艺路线，请选择工艺路线`);
    const route = await prisma.processRoute.findUnique({
      where: { id: processRouteId },
      include: { processes: { select: { id: true } } },
    });
    if (!route || route.status !== "active") throw new Error(`物料 ${material.code} 的工艺路线未启用，不能创建生产订单`);
    if (route.processes.length === 0) throw new Error(`物料 ${material.code} 的工艺路线没有工序，不能创建生产订单`);

    resolved.push({ input, salesOrderId, salesOrderNo, processRouteId });
  }

  for (const { input, salesOrderId, salesOrderNo, processRouteId } of resolved) {
    // 防重复下达：同一销售订单（或同一手工销售订单号）+ 同一物料已有未完成生产订单则跳过
    const exists = await prisma.productionOrder.findFirst({
      where: {
        materialId: input.materialId,
        ...(salesOrderId ? { salesOrderId } : salesOrderNo ? { salesOrderNo } : { salesOrderId: null }),
        status: { in: ["planned", "in_progress"] },
      },
    });
    if (exists) {
      skipped.push({ materialId: input.materialId, salesOrderId });
      continue;
    }

    // 单号在事务内生成并加串行锁；并发撞 @unique 时重试并换单号
    const order = await retryOnDuplicate(() =>
      prisma.$transaction(async (tx) => {
        await lockOrderNo(tx, ORDER_NO_LOCK.MO);
        const orderNo = await generateProductionOrderNo();
        return tx.productionOrder.create({
          data: {
            orderNo,
            salesOrderId,
            salesOrderNo,
            materialId: input.materialId,
            processRouteId,
            quantity: input.quantity,
            planStartDate: input.planStartDate ? new Date(input.planStartDate) : null,
            planEndDate: input.planEndDate ? new Date(input.planEndDate) : null,
            planner: input.planner ?? null,
            releaseDate: input.releaseDate ? new Date(input.releaseDate) : new Date(),
            remark: input.remark,
            createdBy: userId,
            status: "planned",
          },
        });
      })
    );
    created.push(order);
  }
  return { created, skipped };
}

// 计划员下拉：计划员角色的启用用户
export async function listPlanners() {
  return prisma.user.findMany({
    where: { status: 1, userRoles: { some: { role: { code: "PLANNER" } } } },
    select: { id: true, username: true, realName: true },
    orderBy: { id: "asc" },
  });
}

// 车间员工下拉：车间人员角色的启用用户
export async function listEmployees(keyword?: string) {
  return prisma.user.findMany({
    where: {
      status: 1,
      userRoles: { some: { role: { code: "PRODUCTION" } } },
      ...(keyword
        ? { OR: [{ username: { contains: keyword } }, { realName: { contains: keyword } }] }
        : {}),
    },
    select: { id: true, username: true, realName: true },
    orderBy: { id: "asc" },
  });
}

// 已下达（未完成）的生产订单键：物料 + 销售订单，用于 MRP 建议下达时置灰已下达项
export async function listIssuedProductionKeys() {
  const rows = await prisma.productionOrder.findMany({
    where: { status: { in: ["planned", "in_progress"] } },
    select: { materialId: true, salesOrderId: true },
  });
  return rows.map((r) => ({ materialId: r.materialId, salesOrderId: r.salesOrderId }));
}

// 取消生产订单：作废未完成批次；若该销售订单已无有效生产订单则回退其状态
export async function cancelProductionOrder(id: number) {
  const order = await prisma.productionOrder.findUnique({ where: { id } });
  if (!order) throw new Error("生产订单不存在");
  if (order.status === "cancelled") throw new Error("生产订单已取消");
  if (order.status === "completed") throw new Error("已完成的生产订单不能取消");

  return prisma.$transaction(async (tx) => {
    await tx.productionBatch.updateMany({
      where: { productionOrderId: id, status: { in: ["planned", "in_progress"] } },
      data: { status: "cancelled" },
    });

    const updated = await tx.productionOrder.update({
      where: { id },
      data: { status: "cancelled" },
    });

    if (order.salesOrderId) {
      const active = await tx.productionOrder.count({
        where: { salesOrderId: order.salesOrderId, status: { in: ["planned", "in_progress"] } },
      });
      if (active === 0) {
        // 已取消的销售订单不回退状态
        const updatedSo = await tx.salesOrder.updateMany({
          where: { id: order.salesOrderId, status: { not: "cancelled" } },
          data: { status: "confirmed" },
        });
        if (updatedSo.count > 0) {
          await tx.salesOrderItem.updateMany({
            where: { orderId: order.salesOrderId, materialId: order.materialId, status: "in_production" },
            data: { status: "pending" },
          });
        }
      }
    }

    return updated;
  });
}

export async function updateProductionOrder(id: number, data: Partial<ProductionOrderInput>) {
  const exists = await prisma.productionOrder.findUnique({ where: { id } });
  if (!exists) throw new Error("生产订单不存在");
  if (data.quantity !== undefined && (!Number.isFinite(data.quantity) || data.quantity <= 0)) {
    throw new Error("生产数量必须大于0");
  }
  if (!data.planStartDate) throw new Error("请选择计划开始日期");
  if (!data.planEndDate) throw new Error("请选择计划结束日期");
  if (!data.planner) throw new Error("请选择计划员");
  if (!data.releaseDate) throw new Error("请选择下达日期");

  return prisma.$transaction(async (tx) => {
    const order = await tx.productionOrder.update({
      where: { id },
      data: {
        planStartDate: data.planStartDate !== undefined ? (data.planStartDate ? new Date(data.planStartDate) : null) : undefined,
        planEndDate: data.planEndDate !== undefined ? (data.planEndDate ? new Date(data.planEndDate) : null) : undefined,
        planner: data.planner,
        releaseDate: data.releaseDate !== undefined ? (data.releaseDate ? new Date(data.releaseDate) : null) : undefined,
        remark: data.remark,
        quantity: data.quantity,
      },
    });

    return order;
  });
}

// ===== 排产：根据工艺路线按批次生成加工单 =====
export interface ScheduleBatchInput {
  quantity: number;
  planStartDate?: string;
  planEndDate?: string;
  remark?: string;
}

export async function scheduleProduction(
  productionOrderId: number,
  userId: number,
  batches?: ScheduleBatchInput[],
  planner?: string
) {
  const order = await prisma.productionOrder.findUnique({
    where: { id: productionOrderId },
    include: { material: true },
  });
  if (!order) throw new Error("生产订单不存在");
  if (order.status === "completed") throw new Error("已完成的生产订单不能排产");

  // 排产前置条件：计划员、下达日期必须已维护；计划日期按批次录入（未维护时由批次日期回填）
  const finalPlanner = (planner && planner.trim()) || order.planner;
  if (!finalPlanner) throw new Error("请先指定计划员");
  if (!order.releaseDate) throw new Error("请先维护下达日期");

  const routeId = order.processRouteId ?? order.material.processRouteId;
  if (!routeId) throw new Error("该产品未指定工艺路线，无法排产");

  const route = await prisma.processRoute.findUnique({
    where: { id: routeId },
    include: { processes: { orderBy: { sequence: "asc" } } },
  });
  if (!route) throw new Error("该产品指定的工艺路线不存在，无法排产");
  if (route.status !== "active") throw new Error("该产品的工艺路线未启用，无法排产");
  if (route.processes.length === 0) throw new Error("该产品的工艺路线没有工序，无法排产");

  // 批次物料清单来源：产品启用中的 BOM（一层）；无 BOM 拒绝排产
  const bom = await prisma.bom.findFirst({
    where: { productId: order.materialId, status: "active" },
    include: { items: { include: { material: { select: { unit: true } } } } },
  });
  if (!bom || bom.items.length === 0) {
    throw new Error("该产品未维护启用的BOM，无法排产");
  }

  // 已排产量（未取消批次之和）
  const scheduledAgg = await prisma.productionBatch.aggregate({
    where: { productionOrderId, status: { not: "cancelled" } },
    _sum: { quantity: true },
  });
  const scheduledQty = scheduledAgg._sum.quantity ?? 0;
  const remaining = order.quantity - scheduledQty;

  // 本次批次：未传则按剩余未排量建一个默认批次
  let planBatches: ScheduleBatchInput[];
  if (batches && batches.length > 0) {
    planBatches = batches;
  } else {
    if (remaining <= 0) throw new Error("该生产订单已排满，不能重复排产");
    planBatches = [
      {
        quantity: remaining,
        planStartDate: order.planStartDate ? order.planStartDate.toISOString() : undefined,
        planEndDate: order.planEndDate ? order.planEndDate.toISOString() : undefined,
      },
    ];
  }

  for (const b of planBatches) {
    if (!Number.isFinite(b.quantity) || b.quantity <= 0) throw new Error("批次数量必须大于0");
  }
  const addQty = planBatches.reduce((s, b) => s + b.quantity, 0);
  if (scheduledQty + addQty > order.quantity + 1e-6) {
    throw new Error(`已排产 ${scheduledQty}，本次 ${addQty}，超过生产订单数量 ${order.quantity}`);
  }

  // 重建：已取消的批次若带报工记录则不能清理
  const cancelledBatches = await prisma.productionBatch.findMany({
    where: { productionOrderId, status: "cancelled" },
    select: { id: true, _count: { select: { reports: true } } },
  });
  if (cancelledBatches.some((b) => b._count.reports > 0)) {
    throw new Error("该生产订单存在已报工的批次，无法重新排产");
  }

  const maxBatch = await prisma.productionBatch.aggregate({
    where: { productionOrderId },
    _max: { batchNo: true },
  });
  let nextBatchNo = (maxBatch._max.batchNo ?? 0) + 1;

  return prisma.$transaction(async (tx) => {
    // 清理此前已取消的批次
    await tx.productionBatch.deleteMany({ where: { productionOrderId: order.id, status: "cancelled" } });

    // 排产时为该生产订单创建独立的工艺路线副本
    let orderRoute = await tx.productionOrderRoute.findUnique({ where: { productionOrderId: order.id } });
    if (!orderRoute) {
      orderRoute = await tx.productionOrderRoute.create({
        data: {
          productionOrderId: order.id,
          sourceRouteId: route.id,
          code: route.code,
          name: route.name,
          description: route.description,
          totalTime: route.totalTime,
        },
      });
      for (const p of route.processes) {
        await tx.productionOrderStep.create({
          data: {
            orderRouteId: orderRoute.id,
            sourceStepId: p.id,
            code: p.code,
            name: p.name,
            sequence: p.sequence,
            workstationId: p.workstationId,
            standardTime: p.standardTime,
            setupTime: p.setupTime,
          },
        });
      }
    }
    const orderSteps = await tx.productionOrderStep.findMany({
      where: { orderRouteId: orderRoute.id },
      orderBy: { sequence: "asc" },
    });
    if (orderSteps.length === 0) throw new Error("该订单的工艺路线没有工序，无法排产");

    const createdBatches: any[] = [];
    const totalTime = orderSteps.reduce((sum, s) => sum + s.standardTime + s.setupTime, 0);

    for (const b of planBatches) {
      const batch = await tx.productionBatch.create({
        data: {
          productionOrderId: order.id,
          batchNo: nextBatchNo++,
          quantity: b.quantity,
          planStartDate: b.planStartDate ? new Date(b.planStartDate) : null,
          planEndDate: b.planEndDate ? new Date(b.planEndDate) : null,
          status: "planned",
          remark: b.remark,
        },
      });
      createdBatches.push(batch);

      // 按产品 BOM 生成批次物料清单（一层）
      for (const item of bom.items) {
        await tx.productionBatchMaterial.create({
          data: {
            batchId: batch.id,
            materialId: item.materialId,
            requiredQty: b.quantity * item.quantity * (1 + (item.lossRate ?? 0)),
            unit: item.unit || item.material?.unit || null,
            status: "pending",
          },
        });
      }
    }

    // 计划开始/结束日期：订单未维护时，用本次批次日期回填（取最早开始/最晚结束）
    const batchStarts = createdBatches.map((b: any) => b.planStartDate).filter(Boolean) as Date[];
    const batchEnds = createdBatches.map((b: any) => b.planEndDate).filter(Boolean) as Date[];
    const planStartDate = order.planStartDate ?? (batchStarts.length ? new Date(Math.min(...batchStarts.map((d) => d.getTime()))) : undefined);
    const planEndDate = order.planEndDate ?? (batchEnds.length ? new Date(Math.max(...batchEnds.map((d) => d.getTime()))) : undefined);

    await tx.productionOrder.update({
      where: { id: order.id },
      data: { status: "in_progress", actualStartDate: order.actualStartDate ?? new Date(), planStartDate, planEndDate, planner: finalPlanner },
    });

    // 关联销售订单状态更新（已取消的订单不覆盖）
    if (order.salesOrderId) {
      const updatedSo = await tx.salesOrder.updateMany({
        where: { id: order.salesOrderId, status: { not: "cancelled" } },
        data: { status: "in_production" },
      });
      if (updatedSo.count > 0) {
        await tx.salesOrderItem.updateMany({
          where: { orderId: order.salesOrderId, materialId: order.materialId },
          data: { status: "in_production" },
        });
      }
    }

    return { productionOrderId: order.id, batches: createdBatches, steps: orderSteps, totalTime };
  });
}

// ===== 报工（直接挂批次 + 订单级工序）=====
interface ReportWorkItem {
  processStepId: number; // 订单级工序 ProductionOrderStep.id（必填）
  quantity: number;
  scrapQty?: number;
  materialUsed?: number;
  workHours?: number;
  reportTime?: string;
  reportBy?: number; // 报工操作人（默认当前登录用户）
  remark?: string;
}

// 对单个批次报工：写入报工流水，并按「末道工序累计报工量」推进批次/生产订单/销售订单完工
async function applyBatchReport(tx: Prisma.TransactionClient, batchId: number, data: ReportWorkItem, userId: number) {
  const batch = await tx.productionBatch.findUnique({
    where: { id: batchId },
    include: { productionOrder: { include: { material: true } } },
  });
  if (!batch) throw new Error("批次不存在");
  if (batch.status === "cancelled") throw new Error("批次已取消，不能报工");
  if (batch.status === "completed") throw new Error("批次已完成，不能重复报工");
  if (!Number.isFinite(data.quantity) || data.quantity <= 0) throw new Error("报工数量必须大于0");

  // 工序必填，且必须属于该生产订单的工艺路线副本
  if (!data.processStepId) throw new Error("请选择工序");
  const orderRoute = await tx.productionOrderRoute.findUnique({
    where: { productionOrderId: batch.productionOrderId },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
  if (!orderRoute || orderRoute.steps.length === 0) throw new Error("该生产订单尚未排产，无法报工");
  const step = orderRoute.steps.find((s) => s.id === data.processStepId);
  if (!step) throw new Error("工序不属于该订单的工艺路线");

  let reporterId = userId;
  if (data.reportBy) {
    const emp = await tx.user.findUnique({ where: { id: data.reportBy } });
    if (!emp || emp.status !== 1) throw new Error("报工员工不存在或已停用");
    reporterId = data.reportBy;
  }

  await tx.workReport.create({
    data: {
      batchId,
      reporterId,
      processStepId: step.id,
      quantity: data.quantity,
      scrapQty: data.scrapQty ?? 0,
      materialUsed: data.materialUsed ?? 0,
      workHours: data.workHours ?? 0,
      reportTime: data.reportTime ? new Date(data.reportTime) : undefined,
      remark: data.remark,
    },
  });

  // 末道工序（sequence 最大）累计报工量达标 → 批次完工
  const lastStep = orderRoute.steps.reduce((a, b) => (b.sequence > a.sequence ? b : a));
  const lastAgg = await tx.workReport.aggregate({
    where: { batchId, processStepId: lastStep.id },
    _sum: { quantity: true },
  });
  const lastQty = lastAgg._sum.quantity ?? 0;
  const batchCompleted = lastQty >= batch.quantity - 1e-6;

  const updatedBatch = await tx.productionBatch.update({
    where: { id: batchId },
    data: { status: batchCompleted ? "completed" : "in_progress" },
  });

  // 所有非取消批次完工 且 已排产量≥生产订单数量 → 关闭生产订单及其销售订单
  if (batchCompleted) {
    const notDone = await tx.productionBatch.count({
      where: { productionOrderId: batch.productionOrderId, status: { notIn: ["completed", "cancelled"] } },
    });
    if (notDone === 0) {
      const batchAgg = await tx.productionBatch.aggregate({
        where: { productionOrderId: batch.productionOrderId, status: { not: "cancelled" } },
        _sum: { quantity: true },
      });
      const scheduledQty = batchAgg._sum.quantity ?? 0;
      const po = await tx.productionOrder.findUnique({ where: { id: batch.productionOrderId } });
      if (po && scheduledQty >= po.quantity - 1e-6) {
        await tx.productionOrder.update({
          where: { id: po.id },
          data: { status: "completed", actualEndDate: new Date() },
        });
        if (po.salesOrderId) {
          const allPoDone = await tx.productionOrder.count({
            where: { salesOrderId: po.salesOrderId, status: { not: "completed" } },
          });
          if (allPoDone === 0) {
            const updatedSo = await tx.salesOrder.updateMany({
              where: { id: po.salesOrderId, status: { not: "cancelled" } },
              data: { status: "completed" },
            });
            if (updatedSo.count > 0) {
              await tx.salesOrderItem.updateMany({
                where: { orderId: po.salesOrderId },
                data: { status: "completed" },
              });
            }
          }
        }
      }
    }
  }

  return updatedBatch;
}

export async function reportBatch(batchId: number, data: ReportWorkItem, userId: number) {
  return prisma.$transaction((tx) => applyBatchReport(tx, batchId, data, userId));
}

// 批量报工：同一生产订单内，按「批次 × 工序」一次录入多条
export async function batchReportWork(
  productionOrderId: number,
  items: (ReportWorkItem & { batchId: number })[],
  userId: number
) {
  if (!items || items.length === 0) throw new Error("请填写报工数据");
  return prisma.$transaction(async (tx) => {
    const results: any[] = [];
    for (const it of items) {
      if (!it.quantity || it.quantity <= 0) continue;
      if (!it.batchId) throw new Error("报工行缺少批次");
      const batch = await tx.productionBatch.findUnique({ where: { id: it.batchId }, select: { productionOrderId: true } });
      if (!batch || batch.productionOrderId !== productionOrderId) throw new Error("报工批次不属于该生产订单");
      results.push(await applyBatchReport(tx, it.batchId, it, userId));
    }
    return { count: results.length, batches: results };
  });
}

// ===== 报工历史 =====
// 报工员工下拉：仅返回有报工记录的员工
export async function listReporters() {
  return prisma.user.findMany({
    where: { workReports: { some: {} } },
    select: { id: true, username: true, realName: true },
    orderBy: { id: "asc" },
  });
}

export async function listWorkReports(where: any) {
  const { batchId, reporterId, processStepId, orderNo, batchNo, from, to, page = 1, pageSize = 20 } = where;
  const filters: Prisma.WorkReportWhereInput = {};
  if (batchId) filters.batchId = Number(batchId);
  if (reporterId) filters.reporterId = Number(reporterId);
  if (processStepId) filters.processStepId = Number(processStepId);
  if (orderNo || batchNo) {
    filters.batch = {
      ...(orderNo ? { productionOrder: { orderNo: { contains: orderNo } } } : {}),
      ...(batchNo ? { batchNo: Number(batchNo) } : {}),
    };
  }
  if (from || to) {
    const gte = from ? new Date(from) : undefined;
    const lte = to ? new Date(to) : undefined;
    if (lte) lte.setHours(23, 59, 59, 999);
    filters.reportTime = { gte, lte };
  }

  const [total, items] = await Promise.all([
    prisma.workReport.count({ where: filters }),
    prisma.workReport.findMany({
      where: filters,
      include: {
        reporter: { select: { id: true, realName: true } },
        batch: { include: { productionOrder: { include: { material: { select: { name: true, code: true } } } } } },
      },
      orderBy: { reportTime: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  // 补充工序名（processStepId 无 relation，单独查映射 → 订单级工序）
  const stepIds = [...new Set(items.map((r) => r.processStepId))];
  const stepMap = new Map<number, { id: number; code: string; name: string }>();
  if (stepIds.length) {
    const steps = await prisma.productionOrderStep.findMany({ where: { id: { in: stepIds } }, select: { id: true, code: true, name: true } });
    for (const s of steps) stepMap.set(s.id, s);
  }
  const enriched = items.map((r) => ({
    ...r,
    processStep: stepMap.get(r.processStepId) ?? null,
  }));

  return { total, page: Number(page), pageSize: Number(pageSize), items: enriched };
}

// ===== 报工统计（员工生产报工报表） =====
export async function getWorkReportStats(where: any) {
  const { reporterId, processStepId, orderNo, batchNo, from, to } = where;
  const filters: Prisma.WorkReportWhereInput = {};
  if (reporterId) filters.reporterId = Number(reporterId);
  if (processStepId) filters.processStepId = Number(processStepId);
  if (orderNo || batchNo) {
    filters.batch = {
      ...(orderNo ? { productionOrder: { orderNo: { contains: orderNo } } } : {}),
      ...(batchNo ? { batchNo: Number(batchNo) } : {}),
    };
  }
  if (from || to) {
    const gte = from ? new Date(from) : undefined;
    const lte = to ? new Date(to) : undefined;
    if (lte) lte.setHours(23, 59, 59, 999);
    filters.reportTime = { gte, lte };
  }

  const reports = await prisma.workReport.findMany({
    where: filters,
    include: { reporter: { select: { id: true, realName: true } } },
    orderBy: { reportTime: "asc" },
  });

  const byEmployee = new Map<number, { reporterId: number; realName: string; count: number; totalQty: number; totalScrap: number; totalHours: number }>();
  let totalCount = 0, totalQty = 0, totalScrap = 0, totalHours = 0;
  for (const r of reports) {
    totalCount += 1;
    totalQty += r.quantity;
    totalScrap += r.scrapQty;
    totalHours += r.workHours;
    const key = r.reporterId;
    const cur = byEmployee.get(key) ?? { reporterId: key, realName: r.reporter?.realName ?? "未知", count: 0, totalQty: 0, totalScrap: 0, totalHours: 0 };
    cur.count += 1;
    cur.totalQty += r.quantity;
    cur.totalScrap += r.scrapQty;
    cur.totalHours += r.workHours;
    byEmployee.set(key, cur);
  }

  return {
    summary: { count: totalCount, totalQty, totalScrap, totalHours },
    byEmployee: [...byEmployee.values()].sort((a, b) => b.totalQty - a.totalQty),
  };
}


// ===== 批次物料清单 / 领料 / 入库 =====
export async function listBatchMaterials(where: any) {
  const { materialKeyword, orderNo, onlyUnissued, page = 1, pageSize = 20 } = where;
  const filters: Prisma.ProductionBatchMaterialWhereInput = {};
  if (materialKeyword) {
    filters.material = {
      OR: [{ code: { contains: materialKeyword } }, { name: { contains: materialKeyword } }],
    };
  }
  const batchFilter: Prisma.ProductionBatchWhereInput = { status: { not: "cancelled" } };
  if (orderNo) batchFilter.productionOrder = { orderNo: { contains: orderNo } };
  filters.batch = batchFilter;
  if (onlyUnissued === "true" || onlyUnissued === true) {
    filters.status = { in: ["pending", "partial"] };
  }

  const [total, items] = await Promise.all([
    prisma.productionBatchMaterial.count({ where: filters }),
    prisma.productionBatchMaterial.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true } },
        batch: {
          include: {
            productionOrder: { include: { material: { select: { code: true, name: true } } } },
          },
        },
      },
      orderBy: { id: "asc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function getBatchMaterials(batchId: number) {
  const batch = await prisma.productionBatch.findUnique({
    where: { id: batchId },
    include: {
      productionOrder: {
        include: { material: { select: { id: true, code: true, name: true, unit: true, location: true } } },
      },
      materials: {
        include: {
          material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!batch) throw new Error("批次不存在");
  await attachUnitInfo([batch.productionOrder.material, ...batch.materials.map((m) => m.material)]);
  return batch;
}

/** 给物料对象附带可用计量单位（基本单位 + 转换单位）及换算率 */
async function attachUnitInfo(materials: any[]) {
  const list = materials.filter(Boolean);
  const ids = [...new Set(list.map((m) => m.id))];
  const convs = ids.length
    ? await prisma.materialUnitConversion.findMany({ where: { materialId: { in: ids }, status: 1 }, orderBy: { id: "asc" } })
    : [];
  const unitMap = new Map<number, string[]>();
  const rateMap = new Map<number, Record<string, number>>();
  for (const c of convs) {
    if (!unitMap.has(c.materialId)) unitMap.set(c.materialId, []);
    unitMap.get(c.materialId)!.push(c.unit);
    if (!rateMap.has(c.materialId)) rateMap.set(c.materialId, {});
    rateMap.get(c.materialId)![c.unit] = c.conversionRate;
  }
  for (const m of list) {
    m.units = [m.unit, ...(unitMap.get(m.id) ?? [])];
    m.unitRates = { [m.unit]: 1, ...(rateMap.get(m.id) ?? {}) };
  }
}

// 批量发料：异常行（数量非法/超未发/库存不足）跳过，其余正常出库
export async function issueBatchMaterials(
  batchId: number,
  warehouseId: number,
  items: { batchMaterialId: number; quantity: number; unit?: string; location?: string; binId?: number | null; batchNo?: string }[],
  userId: number,
  effectiveDate?: string
) {
  if (!warehouseId) throw new Error("请选择出库仓库");
  if (!items || items.length === 0) throw new Error("请填写发放数量");
  const batch = await prisma.productionBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("批次不存在");
  if (batch.status === "cancelled") throw new Error("批次已取消，不能发料");
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new Error("仓库不存在");

  const rows = await prisma.productionBatchMaterial.findMany({
    where: { batchId, id: { in: items.map((i) => i.batchMaterialId) } },
    include: { material: { select: { id: true, code: true, name: true, batchManaged: true } } },
  });
  const map = new Map(rows.map((r) => [r.id, r]));
  const issueType = await prisma.stockTransactionType.findUnique({ where: { code: "ISS-WO" } });

  const issued: { batchMaterialId: number; materialCode: string; materialName: string; quantity: number }[] = [];
  const skipped: { batchMaterialId: number; materialCode: string; materialName: string; quantity: number; reason: string }[] = [];

  let docNo = "";
  await prisma.$transaction(async (tx) => {
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    docNo = await generateDocNo(tx, issueType?.documentPrefix || "ST");
    let lineNo = 1;
    for (const it of items) {
      const row = map.get(it.batchMaterialId);
      const qty = Number(it.quantity);
      if (!row) {
        skipped.push({ batchMaterialId: it.batchMaterialId, materialCode: "", materialName: "", quantity: qty, reason: "物料行不存在" });
        continue;
      }
      const base = { batchMaterialId: row.id, materialCode: row.material.code, materialName: row.material.name, quantity: qty };
      if (!Number.isFinite(qty) || qty <= 0) {
        skipped.push({ ...base, reason: "数量必须大于0" });
        continue;
      }
      // 计量单位换算：录入数量按换算率折算为基本单位（需求量/已发量均以基本单位计）
      const { rate } = await resolveUnitRate(row.materialId, it.unit, tx as any);
      const baseQty = toBaseQty(qty, rate);

      const remain = row.requiredQty - row.issuedQty;
      if (baseQty > remain + 1e-6) {
        skipped.push({ ...base, reason: `超过未发数量（${remain}）` });
        continue;
      }

      // 1) 校验货位并预检库存（只读，未通过则跳过该行，无副作用）
      let binId: number | null;
      try {
        binId = await resolveBinId(tx, warehouse, it.binId);
      } catch (e: any) {
        skipped.push({ ...base, reason: e.message });
        continue;
      }
      const stock = await tx.stock.findFirst({ where: { materialId: row.materialId, warehouseId, binId } });
      if (!stock || stock.quantity < baseQty) {
        skipped.push({ ...base, reason: `库存不足（当前 ${stock?.quantity ?? 0}）` });
        continue;
      }

      // 2) 原子累加已发量（写入时校验不超需求量），防止并发超发；并发冲突时中止整个事务（回滚保证一致性）
      const issuedUpd = await tx.productionBatchMaterial.updateMany({
        where: { id: row.id, issuedQty: { lte: row.requiredQty - baseQty + 1e-6 } },
        data: { issuedQty: { increment: baseQty } },
      });
      if (issuedUpd.count === 0) {
        throw new Error(`物料 ${row.material.code} 未发数量已变化，请刷新后重试`);
      }
      const freshRow = await tx.productionBatchMaterial.findUnique({ where: { id: row.id } });
      const newIssued = freshRow?.issuedQty ?? row.issuedQty + baseQty;
      await tx.productionBatchMaterial.update({
        where: { id: row.id },
        data: { status: newIssued >= (freshRow?.requiredQty ?? row.requiredQty) - 1e-6 ? "issued" : "partial" },
      });
      row.issuedQty = newIssued;

      // 3) 原子扣减库存（写入时再次校验充足），防止预检与写入之间被并发扣减
      const stockUpd = await tx.stock.updateMany({
        where: { id: stock.id, quantity: { gte: baseQty } },
        data: { quantity: { decrement: baseQty }, lastOutDate: new Date() },
      });
      if (stockUpd.count === 0) {
        const freshStock = await tx.stock.findUnique({ where: { id: stock.id } });
        throw new Error(`物料 ${row.material.code} 库存不足（当前 ${freshStock?.quantity ?? 0}）`);
      }

      const resolvedBatchNo = await applyBatchOut(tx, row.material, warehouseId, binId, it.batchNo, baseQty);
      await tx.stockRecord.create({
        data: {
          materialId: row.materialId,
          warehouseId,
          binId,
          type: "out",
          quantity: baseQty,
          batchNo: resolvedBatchNo,
          relatedType: "ProductionBatch",
          relatedId: batchId,
          transactionTypeId: issueType?.id,
          documentNo: docNo,
          lineNo: lineNo++,
          location: it.location || null,
          effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
          operatorId: userId,
          remark: `生产发料 批次${batch.batchNo}`,
        },
      });
      issued.push(base);
    }
  });

  return { documentNo: docNo, issued, skipped };
}

// ===== 批次物料清单维护：新增 / 更新 / 删除明细行 =====
export async function createBatchMaterial(
  batchId: number,
  data: { materialId?: number; requiredQty?: number; unit?: string | null; remark?: string | null }
) {
  const batch = await prisma.productionBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("批次不存在");
  if (!data.materialId) throw new Error("请选择物料");
  if (!Number.isFinite(Number(data.requiredQty)) || Number(data.requiredQty) <= 0) {
    throw new Error("需求量必须大于0");
  }
  const dup = await prisma.productionBatchMaterial.findUnique({
    where: { batchId_materialId: { batchId, materialId: data.materialId } },
  });
  if (dup) throw new Error("该物料已在清单中，请直接编辑");
  const material = await prisma.material.findUnique({ where: { id: data.materialId } });
  if (!material) throw new Error("物料不存在");
  return prisma.productionBatchMaterial.create({
    data: {
      batchId,
      materialId: data.materialId,
      requiredQty: Number(data.requiredQty),
      unit: data.unit || material.unit || null,
      remark: data.remark || null,
      status: "pending",
    },
    include: { material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true } } },
  });
}

export async function updateBatchMaterial(
  id: number,
  data: { materialId?: number; requiredQty?: number; unit?: string | null; remark?: string | null }
) {
  const row = await prisma.productionBatchMaterial.findUnique({
    where: { id },
    include: { material: { select: { unit: true } } },
  });
  if (!row) throw new Error("物料行不存在");
  if (data.materialId !== undefined && data.materialId !== row.materialId) {
    if (row.issuedQty > 0) throw new Error("已发料的行不能更换物料");
    const dup = await prisma.productionBatchMaterial.findUnique({
      where: { batchId_materialId: { batchId: row.batchId, materialId: data.materialId } },
    });
    if (dup && dup.id !== row.id) throw new Error("该物料已在清单中");
  }
  const materialId = data.materialId ?? row.materialId;
  if (data.requiredQty !== undefined && (!Number.isFinite(Number(data.requiredQty)) || Number(data.requiredQty) <= 0)) {
    throw new Error("需求量必须大于0");
  }
  const requiredQty = data.requiredQty !== undefined ? Number(data.requiredQty) : row.requiredQty;
  if (requiredQty < row.issuedQty - 1e-6) {
    throw new Error(`需求量不能小于已发料数量（${row.issuedQty}）`);
  }
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  return prisma.productionBatchMaterial.update({
    where: { id },
    data: {
      materialId,
      requiredQty,
      unit: data.unit !== undefined ? data.unit || material?.unit || null : row.unit,
      remark: data.remark !== undefined ? data.remark || null : row.remark,
      status: requiredQty <= row.issuedQty + 1e-6 ? "issued" : row.issuedQty > 0 ? "partial" : "pending",
    },
    include: { material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true } } },
  });
}

export async function deleteBatchMaterial(id: number) {
  const row = await prisma.productionBatchMaterial.findUnique({ where: { id } });
  if (!row) throw new Error("物料行不存在");
  if (row.issuedQty > 0) throw new Error("该物料已发料，不能删除");
  await prisma.productionBatchMaterial.delete({ where: { id } });
  return { success: true };
}

// ===== 加工单工艺路线：优先取订单级副本，否则返回标准路线（仅预览）=====
export async function getProductionOrderRoute(orderId: number) {
  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      materialId: true,
      processRouteId: true,
      material: { select: { id: true, code: true, name: true, specification: true, processRouteId: true } },
    },
  });
  if (!order) throw new Error("生产订单不存在");

  // 优先返回订单级工艺路线副本
  const orderRoute = await prisma.productionOrderRoute.findUnique({
    where: { productionOrderId: orderId },
    include: {
      steps: {
        include: { workstation: { select: { id: true, code: true, name: true } } },
        orderBy: { sequence: "asc" },
      },
    },
  });
  if (orderRoute) {
    const sourceRoute = orderRoute.sourceRouteId
      ? await prisma.processRoute.findUnique({
          where: { id: orderRoute.sourceRouteId },
          select: { id: true, code: true, name: true },
        })
      : null;
    return {
      order: { id: order.id, orderNo: order.orderNo, material: order.material },
      route: { ...orderRoute, processes: orderRoute.steps, isOrderLevel: true, sourceRoute },
    };
  }

  // 未排产：返回标准路线供预览（只读）
  const routeId = order.processRouteId ?? order.material?.processRouteId;
  if (!routeId) {
    return { order: { id: order.id, orderNo: order.orderNo, material: order.material }, route: null };
  }
  const route = await prisma.processRoute.findUnique({
    where: { id: routeId },
    include: {
      processes: {
        include: { workstation: { select: { id: true, code: true, name: true } } },
        orderBy: { sequence: "asc" },
      },
    },
  });
  return {
    order: { id: order.id, orderNo: order.orderNo, material: order.material },
    route: route ? { ...route, isOrderLevel: false } : null,
  };
}

// ===== 更新订单级工艺路线表头 =====
export async function updateOrderRoute(orderId: number, data: { code?: string; name?: string; description?: string }) {
  const orderRoute = await prisma.productionOrderRoute.findUnique({ where: { productionOrderId: orderId } });
  if (!orderRoute) throw new Error("该订单未排产，没有订单级工艺路线");
  return prisma.productionOrderRoute.update({
    where: { id: orderRoute.id },
    data: {
      ...(data.code !== undefined && { code: data.code }),
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
    },
    include: { steps: { include: { workstation: { select: { id: true, code: true, name: true } } }, orderBy: { sequence: "asc" } } },
  });
}

// ===== 编辑订单级工序（diff：更新已有工序、新增、删除不在列表且未被加工单引用的工序）=====
export async function replaceOrderRouteSteps(
  orderId: number,
  steps: { id?: number; code: string; name: string; sequence: number; workstationId?: number | null; standardTime: number; setupTime: number }[]
) {
  const orderRoute = await prisma.productionOrderRoute.findUnique({
    where: { productionOrderId: orderId },
    include: { steps: { select: { id: true, code: true, name: true, sequence: true, workstationId: true, standardTime: true, setupTime: true, sourceStepId: true } } },
  });
  if (!orderRoute) throw new Error("该订单未排产，没有订单级工艺路线");

  const existing = orderRoute.steps;
  const incomingIds = steps.map((s) => s.id).filter((id): id is number => !!id);

  return prisma.$transaction(async (tx) => {
    // 更新已有工序
    for (const s of steps) {
      if (!s.id) continue;
      const target = existing.find((e) => e.id === s.id);
      if (!target) throw new Error(`工序ID ${s.id} 不属于该订单的工艺路线`);
      await tx.productionOrderStep.update({
        where: { id: s.id },
        data: {
          code: s.code,
          name: s.name,
          sequence: s.sequence,
          workstationId: s.workstationId ?? null,
          standardTime: s.standardTime ?? 0,
          setupTime: s.setupTime ?? 0,
        },
      });
    }
    // 新增工序
    for (const s of steps) {
      if (s.id) continue;
      await tx.productionOrderStep.create({
        data: {
          orderRouteId: orderRoute.id,
          code: s.code,
          name: s.name,
          sequence: s.sequence,
          workstationId: s.workstationId ?? null,
          standardTime: s.standardTime ?? 0,
          setupTime: s.setupTime ?? 0,
        },
      });
    }
    // 删除不在列表里的工序（被加工单引用的禁止删除）
    const deleted = existing.filter((e) => !incomingIds.includes(e.id));
    if (deleted.length > 0) {
      const usedCount = await tx.workReport.count({ where: { processStepId: { in: deleted.map((d) => d.id) } } });
      if (usedCount > 0) throw new Error("待删除的工序已有报工记录，不能删除；请保留该工序");
      await tx.productionOrderStep.deleteMany({ where: { id: { in: deleted.map((d) => d.id) } } });
    }
    // 更新总工时
    const totalTime = steps.reduce((sum, s) => sum + (s.standardTime ?? 0) + (s.setupTime ?? 0), 0);
    await tx.productionOrderRoute.update({ where: { id: orderRoute.id }, data: { totalTime } });

    const updated = await tx.productionOrderRoute.findUnique({
      where: { id: orderRoute.id },
      include: { steps: { include: { workstation: { select: { id: true, code: true, name: true } } }, orderBy: { sequence: "asc" } } },
    });
    return updated;
  });
}

export async function listReceivableBatches(where: any) {
  const { orderNo, onlyReceivable, page = 1, pageSize = 20 } = where;
  const filters: Prisma.ProductionBatchWhereInput = { status: { not: "cancelled" } };
  if (orderNo) filters.productionOrder = { orderNo: { contains: orderNo } };
  if (onlyReceivable === "true" || onlyReceivable === true) {
    filters.receivedQty = { lt: prisma.productionBatch.fields.quantity };
  }

  const [total, items] = await Promise.all([
    prisma.productionBatch.count({ where: filters }),
    prisma.productionBatch.findMany({
      where: filters,
      include: {
        productionOrder: {
          include: { material: { select: { id: true, code: true, name: true, unit: true, location: true } } },
        },
      },
      orderBy: { id: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  await attachUnitInfo(items.map((b) => b.productionOrder.material));
  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function receiveBatchProduct(
  batchId: number,
  quantity: number,
  warehouseId: number,
  userId: number,
  batchNo?: string,
  unit?: string,
  binId?: number | null
) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("入库数量必须大于0");
  if (!warehouseId) throw new Error("请选择入库仓库");
  const batch = await prisma.productionBatch.findUnique({
    where: { id: batchId },
    include: { productionOrder: { include: { material: true } } },
  });
  if (!batch) throw new Error("批次不存在");
  if (batch.status === "cancelled") throw new Error("批次已取消，不能入库");
  const material = batch.productionOrder.material;
  // 计量单位换算：录入数量按换算率折算为基本单位后入库
  const { rate } = await resolveUnitRate(material.id, unit);
  const baseQty = toBaseQty(quantity, rate);
  const remain = batch.quantity - batch.receivedQty;
  if (baseQty > remain + 1e-6) throw new Error(`入库数量超过剩余可入库数量（${remain}）`);
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new Error("仓库不存在");
  const receiveType = await prisma.stockTransactionType.findUnique({ where: { code: "RCT-WO" } });

  return prisma.$transaction(async (tx) => {
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const docNo = await generateDocNo(tx, receiveType?.documentPrefix || "ST");

    // 1) 原子累加入库量（写入时校验不超批次数量），防止并发超收
    const recvUpd = await tx.productionBatch.updateMany({
      where: { id: batch.id, status: { not: "cancelled" }, receivedQty: { lte: batch.quantity - baseQty + 1e-6 } },
      data: { receivedQty: { increment: baseQty } },
    });
    if (recvUpd.count === 0) {
      const fresh = await tx.productionBatch.findUnique({ where: { id: batch.id }, select: { quantity: true, receivedQty: true } });
      throw new Error(`入库数量超过剩余可入库数量（${(fresh?.quantity ?? 0) - (fresh?.receivedQty ?? 0)}）`);
    }
    const after = await tx.productionBatch.findUnique({ where: { id: batch.id }, select: { receivedQty: true } });
    const newReceived = after?.receivedQty ?? batch.receivedQty + baseQty;

    // 2) 校验货位 + 库存 upsert + 原子累加
    const resolvedBinId = await resolveBinId(tx, warehouse, binId);
    await addStock(tx, material.id, warehouseId, resolvedBinId, baseQty);
    const resolvedBatchNo = await applyBatchIn(tx, material, warehouseId, resolvedBinId, batchNo, baseQty);
    await tx.stockRecord.create({
      data: {
        materialId: material.id,
        warehouseId,
        binId: resolvedBinId,
        type: "in",
        quantity: baseQty,
        batchNo: resolvedBatchNo,
        relatedType: "ProductionBatch",
        relatedId: batch.id,
        transactionTypeId: receiveType?.id,
        documentNo: docNo,
        lineNo: 1,
        operatorId: userId,
        remark: `生产入库 ${material.name}`,
      },
    });
    return { success: true, documentNo: docNo, receivedQty: newReceived };
  });
}

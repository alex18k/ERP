import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact } from "../utils/date";
import { retryOnDuplicate, lockOrderNo, ORDER_NO_LOCK } from "../utils/retry";
import { generateDocNo, applyBatchIn, applyBatchOut, checkBatchOutAvailable, addStock, resolveBinId } from "./stock.service";
import { resolveUnitRate, resolveUnitRateMap, toBaseQty } from "../utils/unit";
import { parseQueryConditions } from "../utils/queryConditions";
import { buildPrismaQueryWhere, type PrismaQueryFieldDefinition } from "../utils/prismaQueryConditions";

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
        material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true } },
        salesOrder: { select: { id: true, orderNo: true, customerName: true } },
        materials: { include: { material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true } } } },
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
        // 已完工（执行完成）的订单不算「已下达未完工」，允许再次下达
        execStatus: { not: "completed" },
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

// 部门员工下拉：部门人员角色的启用用户
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
    where: { status: { in: ["planned", "in_progress"] }, execStatus: { not: "completed" } },
    select: { materialId: true, salesOrderId: true },
  });
  return rows.map((r) => ({ materialId: r.materialId, salesOrderId: r.salesOrderId }));
}

// 关闭生产订单：任何状态均可关闭，不回退销售订单；已关闭后可重新打开
export async function closeProductionOrder(id: number) {
  const order = await prisma.productionOrder.findUnique({ where: { id } });
  if (!order) throw new Error("生产订单不存在");
  if (order.status === "closed") return order;
  return prisma.productionOrder.update({
    where: { id },
    data: {
      status: "closed",
      // 未排产订单保留 none，重新打开时仍可排产
      execStatus: order.execStatus === "none" ? "none" : "closed",
    },
  });
}

// 删除已关闭的生产订单：仅允许删除没有发料、报工/工时、成品入库和库存流水的订单
export async function deleteProductionOrder(id: number) {
  const order = await prisma.productionOrder.findUnique({
    where: { id },
    include: {
      orderRoute: { select: { id: true } },
    },
  });
  if (!order) throw new Error("生产订单不存在");
  if (order.status !== "closed") throw new Error("仅已关闭的生产订单可以删除");

  const [issuedCount, workReportCount, receivedCount, stockRecordCount] = await Promise.all([
    prisma.productionOrderMaterial.count({
      where: { productionOrderId: id, issuedQty: { gt: 1e-6 } },
    }),
    prisma.workReport.count({ where: { productionOrderId: id } }),
    prisma.productionOrder.count({ where: { id, receivedQty: { gt: 1e-6 } } }),
    prisma.stockRecord.count({ where: { relatedType: "ProductionOrder", relatedId: id } }),
  ]);
  if (issuedCount > 0) throw new Error("该生产订单已有发料记录，不能删除");
  if (workReportCount > 0) throw new Error("该生产订单已有报工/工时记录，不能删除");
  if (receivedCount > 0) throw new Error("该生产订单已有成品入库记录，不能删除");
  if (stockRecordCount > 0) throw new Error("该生产订单存在库存事务记录，不能删除");

  await prisma.$transaction(async (tx) => {
    await tx.productionOrderMaterial.deleteMany({ where: { productionOrderId: id } });
    await tx.workReport.deleteMany({ where: { productionOrderId: id } });
    if (order.orderRoute) {
      await tx.productionOrderStep.deleteMany({ where: { orderRouteId: order.orderRoute.id } });
      await tx.productionOrderRoute.delete({ where: { id: order.orderRoute.id } });
    }
    await tx.productionOrder.delete({ where: { id } });
  });
  return { success: true };
}

// 重新打开已关闭订单时，按报工/工艺路线还原执行状态
async function computeReopenedExecStatus(
  db: Prisma.TransactionClient,
  order: { id: number; plannedQty: number; startTime: Date | null }
) {
  if (order.plannedQty <= 1e-6 && !order.startTime) return "none";
  const orderRoute = await db.productionOrderRoute.findUnique({
    where: { productionOrderId: order.id },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
  const anyReport = await db.workReport.count({ where: { productionOrderId: order.id } });
  if (orderRoute && orderRoute.steps.length > 0) {
    const lastStep = orderRoute.steps[orderRoute.steps.length - 1];
    const agg = await db.workReport.aggregate({
      where: { productionOrderId: order.id, processStepId: lastStep.id },
      _sum: { quantity: true },
    });
    const lastQty = agg._sum.quantity ?? 0;
    return lastQty >= order.plannedQty - 1e-6 ? "completed" : anyReport > 0 ? "in_progress" : "pending";
  }
  return anyReport > 0 ? "in_progress" : "pending";
}

// 销售订单完工回写：该销售订单下不再有「未完工且未关闭」的生产订单时，销售订单及其明细置完成
// 完工判据只看执行状态（execStatus=completed），生产订单不再有 status=completed
async function completeSalesOrderIfAllDone(tx: Prisma.TransactionClient, salesOrderId: number | null) {
  if (!salesOrderId) return;
  const open = await tx.productionOrder.count({
    where: { salesOrderId, status: { not: "closed" }, execStatus: { not: "completed" } },
  });
  if (open > 0) return;
  const so = await tx.salesOrder.updateMany({
    where: { id: salesOrderId, status: { notIn: ["shipped", "cancelled"] } },
    data: { status: "completed" },
  });
  if (so.count > 0) {
    await tx.salesOrderItem.updateMany({
      where: { orderId: salesOrderId, status: { notIn: ["shipped", "cancelled"] } },
      data: { status: "completed" },
    });
  }
}

// 生产订单从完工/关闭回到进行中：销售订单若是因生产完工而完成，同步回退为生产中
async function revertSalesOrderToInProduction(tx: Prisma.TransactionClient, salesOrderId: number | null) {
  if (!salesOrderId) return;
  const so = await tx.salesOrder.updateMany({
    where: { id: salesOrderId, status: "completed" },
    data: { status: "in_production" },
  });
  if (so.count > 0) {
    await tx.salesOrderItem.updateMany({
      where: { orderId: salesOrderId, status: { notIn: ["shipped", "cancelled"] } },
      data: { status: "in_production" },
    });
  }
}

// 手工调整生产订单状态：planned/in_progress/closed 之间切换（完工由执行状态表达；关闭走统一关闭逻辑）
export async function updateProductionOrderStatus(id: number, status: string) {
  if (!["planned", "in_progress", "closed"].includes(status)) {
    throw new Error("不支持的状态；标记完工请调整执行状态");
  }
  const order = await prisma.productionOrder.findUnique({ where: { id } });
  if (!order) throw new Error("生产订单不存在");
  if (order.status === status) return order;
  if (status === "closed") return closeProductionOrder(id);

  const reopening = order.status === "closed" && order.execStatus === "closed";

  return prisma.$transaction(async (tx) => {
    const reopenedExecStatus = reopening ? await computeReopenedExecStatus(tx, order) : undefined;
    const updated = await tx.productionOrder.update({
      where: { id },
      data:
        status === "in_progress"
          ? {
              status: "in_progress",
              actualStartDate: order.actualStartDate ?? new Date(),
              actualEndDate: null,
              ...(reopenedExecStatus ? { execStatus: reopenedExecStatus } : {}),
            }
          : {
              status,
              actualEndDate: null,
              ...(reopenedExecStatus ? { execStatus: reopenedExecStatus } : {}),
            },
    });

    await revertSalesOrderToInProduction(tx, order.salesOrderId);

    return updated;
  });
}

export async function updateProductionOrder(id: number, data: Partial<ProductionOrderInput>) {
  const exists = await prisma.productionOrder.findUnique({ where: { id } });
  if (!exists) throw new Error("生产订单不存在");
  if (exists.execStatus === "completed") throw new Error("生产订单已完工，不能编辑字段；请先将执行状态改为生产中");
  if (exists.status === "closed") throw new Error("生产订单已关闭，不能编辑字段；请先将状态改为其他状态");
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

// ===== 排产：按工艺路线生成订单级工序副本与领料单 =====
export interface ScheduleBatchInput {
  quantity: number;
  planStartDate?: string;
  planEndDate?: string;
  remark?: string;
}

// 批量排产候选：planned/in_progress、已下达且尚未排产的生产订单
export async function listSchedulableOrders() {
  const orders = await prisma.productionOrder.findMany({
    where: {
      status: { in: ["planned", "in_progress"] },
      releaseDate: { not: null },
      execStatus: "none",
    },
    include: {
      material: { select: { id: true, code: true, name: true } },
    },
    orderBy: { orderNo: "asc" },
  });
  return orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    materialCode: o.material?.code || "",
    materialName: o.material?.name || "",
    quantity: o.quantity,
    scheduledQty: 0,
    remain: Math.round(o.quantity * 100) / 100,
    planStartDate: o.planStartDate,
    planEndDate: o.planEndDate,
    planner: o.planner,
    releaseDate: o.releaseDate,
  }));
}

export interface BatchScheduleItemInput {
  id: number;
  planStartDate?: string | null;
  planEndDate?: string | null;
}

// 批量排产：逐单独立事务，单个失败不影响其它订单，返回逐单结果
export async function batchScheduleProduction(
  userId: number,
  payload: { planner?: string; items?: BatchScheduleItemInput[] }
) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) throw new Error("请选择要排产的生产订单");
  if (items.length > 100) throw new Error("单次最多批量排产 100 张生产订单");

  const ids = [...new Set(items.map((it) => Number(it.id)).filter((id) => Number.isFinite(id) && id > 0))];
  const orders = await prisma.productionOrder.findMany({
    where: { id: { in: ids } },
    select: { id: true, orderNo: true },
  });
  const noMap = new Map(orders.map((o) => [o.id, o.orderNo]));

  const success: { id: number; orderNo: string; workOrders: number }[] = [];
  const failed: { id: number; orderNo: string; message: string }[] = [];

  for (const it of items) {
    const id = Number(it.id);
    const orderNo = noMap.get(id) ?? "";
    if (!noMap.has(id)) {
      failed.push({ id, orderNo, message: "生产订单不存在" });
      continue;
    }
    try {
      if (it.planStartDate || it.planEndDate) {
        await prisma.productionOrder.update({
          where: { id },
          data: {
            ...(it.planStartDate ? { planStartDate: new Date(it.planStartDate) } : {}),
            ...(it.planEndDate ? { planEndDate: new Date(it.planEndDate) } : {}),
          },
        });
      }
      const res: any = await scheduleProduction(id, userId, payload.planner);
      success.push({ id, orderNo, workOrders: res ? 1 : 0 });
    } catch (e: any) {
      failed.push({ id, orderNo, message: e?.message || "排产失败" });
    }
  }

  return { total: items.length, successCount: success.length, failCount: failed.length, success, failed };
}

export async function scheduleProduction(
  productionOrderId: number,
  userId: number,
  planner?: string
) {
  const order = await prisma.productionOrder.findUnique({
    where: { id: productionOrderId },
    include: { material: true },
  });
  if (!order) throw new Error("生产订单不存在");
  if (order.execStatus === "completed") throw new Error("已完工的生产订单不能排产");
  if (order.status === "closed") throw new Error("已关闭的生产订单不能排产");

  // 排产前置条件：计划开始/结束日期、计划员、下达日期必须已维护
  if (!order.planStartDate) throw new Error("请先维护计划开始日期");
  if (!order.planEndDate) throw new Error("请先维护计划结束日期");
  const finalPlanner = (planner && planner.trim()) || order.planner;
  if (!finalPlanner) throw new Error("请先指定计划员");
  if (!order.releaseDate) throw new Error("请先维护下达日期");

  // 一个生产订单只排产一次；execStatus 非 none 即已排产
  if (order.execStatus !== "none") {
    throw new Error("该生产订单已排产，不能重复排产");
  }
  const routeId = order.processRouteId ?? order.material.processRouteId;
  if (!routeId) throw new Error("该产品未指定工艺路线，无法排产");

  const route = await prisma.processRoute.findUnique({
    where: { id: routeId },
    include: { processes: { orderBy: { sequence: "asc" } } },
  });
  if (!route) throw new Error("该产品指定的工艺路线不存在，无法排产");
  if (route.status !== "active") throw new Error("该产品的工艺路线未启用，无法排产");
  if (route.processes.length === 0) throw new Error("该产品的工艺路线没有工序，无法排产");

  // 领料单来源：产品启用中的 BOM（一层）；无 BOM 拒绝排产
  const bom = await prisma.bom.findFirst({
    where: { productId: order.materialId, status: "active" },
    include: { items: { include: { material: { select: { unit: true } } } } },
  });
  if (!bom || bom.items.length === 0) {
    throw new Error("该产品未维护启用的BOM，无法排产");
  }
  // 同一子件重复会导致领料单唯一键冲突，排产前给出明确提示
  const bomMaterialIds = new Set<number>();
  for (const it of bom.items) {
    if (bomMaterialIds.has(it.materialId)) {
      throw new Error("该产品BOM存在重复子件，请先在BOM维护中合并后再排产");
    }
    bomMaterialIds.add(it.materialId);
  }
  // BOM 子件单位折算到基本单位，保证领料/库存口径一致
  const bomRateMap = await resolveUnitRateMap(bom.items.map((it) => ({ materialId: it.materialId, unit: it.unit })));

  return prisma.$transaction(async (tx) => {
    // 重新排产：清理此前的领料明细
    await tx.productionOrderMaterial.deleteMany({ where: { productionOrderId: order.id } });

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

    const totalTime = orderSteps.reduce((sum, s) => sum + s.standardTime + s.setupTime, 0);

    await tx.productionOrder.update({
      where: { id: order.id },
      data: {
        status: "in_progress",
        actualStartDate: order.actualStartDate ?? new Date(),
        planner: finalPlanner,
        plannedQty: order.quantity,
        execStatus: "pending",
        startTime: order.planStartDate,
        operatorId: userId,
        endTime: null,
      },
    });

    // 按产品 BOM 生成生产订单领料单（一层）
    for (const item of bom.items) {
      const bomRate = bomRateMap.get(item.materialId)?.rate ?? 1;
      await tx.productionOrderMaterial.create({
        data: {
          productionOrderId: order.id,
          materialId: item.materialId,
          requiredQty: toBaseQty(order.quantity * item.quantity * (1 + (item.lossRate ?? 0)), bomRate),
          unit: item.material?.unit || item.unit || null,
          status: "pending",
        },
      });
    }

    // 关联销售订单状态更新（已取消的订单不覆盖）
    if (order.salesOrderId) {
      const updatedSo = await tx.salesOrder.updateMany({
        // 已完成/已发货的销售订单不回退为生产中
        where: { id: order.salesOrderId, status: { notIn: ["completed", "shipped", "cancelled"] } },
        data: { status: "in_production" },
      });
      if (updatedSo.count > 0) {
        await tx.salesOrderItem.updateMany({
          // 已发货/已完成/已取消的明细不参与生产状态回写
          where: {
            orderId: order.salesOrderId,
            materialId: order.materialId,
            status: { notIn: ["shipped", "completed", "cancelled"] },
          },
          data: { status: "in_production" },
        });
      }
    }

    return { productionOrderId: order.id, steps: orderSteps, totalTime };
  });
}

// ===== 报工（按订单级工序）=====
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

// 对生产订单报工：写入报工流水，并按「末道工序累计报工量」推进执行/生产订单/销售订单完工
async function applyWorkReport(tx: Prisma.TransactionClient, productionOrderId: number, data: ReportWorkItem, userId: number) {
  const order = await tx.productionOrder.findUnique({ where: { id: productionOrderId } });
  if (!order) throw new Error("生产订单不存在");
  if (order.status === "closed") throw new Error("生产订单已关闭，不能报工");
  if (order.execStatus === "closed") throw new Error("生产订单已关闭，不能报工");
  if (order.execStatus === "completed") throw new Error("生产订单已完成，不能重复报工");
  if (order.execStatus === "none") throw new Error("该生产订单尚未排产，不能报工");
  if (!Number.isFinite(data.quantity) || data.quantity <= 0) throw new Error("报工数量必须大于0");

  // 工序必填，且必须属于该生产订单的工艺路线副本
  if (!data.processStepId) throw new Error("请选择工序");
  const orderRoute = await tx.productionOrderRoute.findUnique({
    where: { productionOrderId },
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
      productionOrderId,
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

  const [qtyAgg, scrapAgg] = await Promise.all([
    tx.workReport.aggregate({ where: { productionOrderId }, _sum: { quantity: true } }),
    tx.workReport.aggregate({ where: { productionOrderId }, _sum: { scrapQty: true } }),
  ]);

  // 末道工序（sequence 最大）累计报工量达标 → 生产订单完工
  const lastStep = orderRoute.steps.reduce((a, b) => (b.sequence > a.sequence ? b : a));
  const lastAgg = await tx.workReport.aggregate({
    where: { productionOrderId, processStepId: lastStep.id },
    _sum: { quantity: true },
  });
  const lastQty = lastAgg._sum.quantity ?? 0;
  const completed = lastQty >= order.plannedQty - 1e-6;

  const updated = await tx.productionOrder.update({
    where: { id: productionOrderId },
    data: {
      actualQty: qtyAgg._sum.quantity ?? 0,
      scrapQty: scrapAgg._sum.scrapQty ?? 0,
      // 完工只写执行状态（生产订单状态不再有 completed）
      execStatus: completed ? "completed" : "in_progress",
      endTime: completed ? new Date() : null,
      ...(completed ? { actualEndDate: new Date() } : {}),
    },
  });

  if (completed) await completeSalesOrderIfAllDone(tx, order.salesOrderId);

  return updated;
}

export async function reportWork(productionOrderId: number, data: ReportWorkItem, userId: number) {
  return prisma.$transaction((tx) => applyWorkReport(tx, productionOrderId, data, userId));
}

// 批量报工：同一生产订单内，按「工序」一次录入多条
export async function batchReportWork(
  productionOrderId: number,
  items: ReportWorkItem[],
  userId: number
) {
  if (!items || items.length === 0) throw new Error("请填写报工数据");
  return prisma.$transaction(async (tx) => {
    const results: any[] = [];
    for (const it of items) {
      if (!it.quantity || it.quantity <= 0) continue;
      results.push(await applyWorkReport(tx, productionOrderId, it, userId));
    }
    return { count: results.length, productionOrders: results };
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
  const { productionOrderId, workOrderId, reporterId, processStepId, orderNo, from, to, page = 1, pageSize = 20 } = where;
  const filters: Prisma.WorkReportWhereInput = {};
  if (productionOrderId ?? workOrderId) filters.productionOrderId = Number(productionOrderId ?? workOrderId);
  if (reporterId) filters.reporterId = Number(reporterId);
  if (processStepId) filters.processStepId = Number(processStepId);
  if (orderNo) {
    filters.productionOrder = { orderNo: { contains: orderNo } };
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
        productionOrder: { include: { material: { select: { name: true, code: true } } } },
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
  const { reporterId, processStepId, orderNo, from, to } = where;
  const filters: Prisma.WorkReportWhereInput = {};
  if (reporterId) filters.reporterId = Number(reporterId);
  if (processStepId) filters.processStepId = Number(processStepId);
  if (orderNo) {
    filters.productionOrder = { orderNo: { contains: orderNo } };
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


// ===== 生产订单领料单 / 领料 / 入库 =====
export async function getProductionOrderMaterials(productionOrderId: number) {
  const order = await prisma.productionOrder.findUnique({
    where: { id: productionOrderId },
    include: {
      operator: { select: { id: true, realName: true } },
      material: true,
      orderRoute: { include: { steps: { include: { workstation: { select: { id: true, code: true, name: true } } }, orderBy: { sequence: "asc" } } } },
      materials: {
        include: {
          material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true, batchManaged: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!order) throw new Error("生产订单不存在");
  await attachUnitInfo([order.material, ...order.materials.map((m) => m.material)]);
  return order;
}

/** 生产领料单高级查询字段（Prisma 侧） */
export const PRODUCTION_ORDER_MATERIAL_QUERY_FIELDS: Record<string, PrismaQueryFieldDefinition> = {
  orderNo: { type: "text", column: "orderNo", relation: { name: "productionOrder" } },
  orderStatus: {
    type: "enum",
    column: "status",
    relation: { name: "productionOrder" },
    options: [
      { label: "已计划", value: "planned" },
      { label: "生产中", value: "in_progress" },
      { label: "已关闭", value: "closed" },
    ],
  },
  execStatus: {
    type: "enum",
    column: "execStatus",
    relation: { name: "productionOrder" },
    options: [
      { label: "未排产", value: "none" },
      { label: "待开工", value: "pending" },
      { label: "生产中", value: "in_progress" },
      { label: "已完成", value: "completed" },
      { label: "已关闭", value: "closed" },
    ],
  },
  planner: { type: "text", column: "planner", relation: { name: "productionOrder" } },
  releaseDate: { type: "date", column: "releaseDate", relation: { name: "productionOrder" } },
  planStartDate: { type: "date", column: "planStartDate", relation: { name: "productionOrder" } },
  // 生产订单（产品）维度
  productCode: { type: "text", column: "code", relation: { name: "productionOrder", inner: ["material"] } },
  productSpecification: { type: "text", column: "specification", relation: { name: "productionOrder", inner: ["material"] } },
  quantity: { type: "number", column: "quantity", relation: { name: "productionOrder" } },
  receivedQty: { type: "number", column: "receivedQty", relation: { name: "productionOrder" } },
  planEndDate: { type: "date", column: "planEndDate", relation: { name: "productionOrder" } },
  // 领料物料维度
  materialCode: { type: "text", column: "code", relation: { name: "material" } },
  materialName: { type: "text", column: "name", relation: { name: "material" } },
  specification: { type: "text", column: "specification", relation: { name: "material" } },
  category: {
    type: "enum",
    column: "category",
    relation: { name: "material" },
    options: [
      { label: "采购", value: "purchase" },
      { label: "制造", value: "manufacture" },
    ],
  },
  requiredQty: { type: "number", column: "requiredQty" },
  issuedQty: { type: "number", column: "issuedQty" },
  unit: { type: "text", column: "unit" },
  status: {
    type: "enum",
    column: "status",
    options: [
      { label: "未领料", value: "pending" },
      { label: "部分领料", value: "partial" },
      { label: "已发料", value: "issued" },
    ],
  },
  remark: { type: "text", column: "remark" },
};

export async function listProductionOrderMaterials(where: any) {
  const { materialKeyword, orderNo, onlyUnissued, page = 1, pageSize = 20 } = where;
  const filters: Prisma.ProductionOrderMaterialWhereInput = {};
  if (materialKeyword) {
    filters.material = {
      OR: [{ code: { contains: materialKeyword } }, { name: { contains: materialKeyword } }],
    };
  }
  const poFilter: Prisma.ProductionOrderWhereInput = {};
  if (orderNo) poFilter.orderNo = { contains: orderNo };
  filters.productionOrder = poFilter;
  if (onlyUnissued === "true" || onlyUnissued === true) {
    filters.status = { in: ["pending", "partial"] };
  }

  // 高级查询条件（与基础条件 AND 叠加）
  const advancedConditions = parseQueryConditions((where as any).conditions);
  if (advancedConditions.length) {
    const advanced = buildPrismaQueryWhere(advancedConditions, PRODUCTION_ORDER_MATERIAL_QUERY_FIELDS);
    filters.AND = [...(Array.isArray(filters.AND) ? filters.AND : []), advanced];
  }

  const [total, items] = await Promise.all([
    prisma.productionOrderMaterial.count({ where: filters }),
    prisma.productionOrderMaterial.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true } },
        productionOrder: { include: { material: { select: { code: true, name: true, specification: true } } } },
      },
      orderBy: { id: "asc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function updateProductionOrderExecStatus(productionOrderId: number, status: string) {
  if (!["pending", "in_progress", "completed", "closed"].includes(status)) throw new Error("不支持的执行状态");
  const order = await prisma.productionOrder.findUnique({ where: { id: productionOrderId } });
  if (!order) throw new Error("生产订单不存在");
  if (order.execStatus === "none") throw new Error("该生产订单尚未排产");
  if (order.execStatus === status) return order;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.productionOrder.update({
      where: { id: productionOrderId },
      data: {
        execStatus: status,
        // 完工只体现在执行状态上（生产订单状态不再有 completed），并回写销售订单
        ...(status === "completed" ? { endTime: new Date(), actualEndDate: order.actualEndDate ?? new Date() } : {}),
        // 从完工退回待开工/生产中：清掉完工时间，避免残留
        ...(order.execStatus === "completed" && (status === "pending" || status === "in_progress")
          ? { endTime: null, actualEndDate: null }
          : {}),
      },
    });
    if (status === "completed") await completeSalesOrderIfAllDone(tx, order.salesOrderId);
    else if (order.execStatus === "completed") await revertSalesOrderToInProduction(tx, order.salesOrderId);
    return updated;
  });
}

// ===== 执行状态关闭 / 重新打开 =====
// 关闭后：不能报工、不能领料、不能入库，且不参与 MRP（在制量/需求来源均剔除）
export async function closeProductionOrderExec(productionOrderId: number) {
  const order = await prisma.productionOrder.findUnique({ where: { id: productionOrderId } });
  if (!order) throw new Error("生产订单不存在");
  if (order.execStatus === "none") throw new Error("该生产订单尚未排产，不能关闭");
  if (order.execStatus === "closed") return order;
  return prisma.productionOrder.update({ where: { id: productionOrderId }, data: { execStatus: "closed" } });
}

// 重新打开：按已有报工重算状态（末道工序累计达标→已完成；有报工→生产中；否则→待开工）
export async function reopenProductionOrderExec(productionOrderId: number) {
  const order = await prisma.productionOrder.findUnique({ where: { id: productionOrderId } });
  if (!order) throw new Error("生产订单不存在");
  if (order.execStatus === "none") throw new Error("该生产订单尚未排产，不能重新打开");
  if (order.execStatus !== "closed") return order;
  const status = await computeReopenedExecStatus(prisma, order);
  return prisma.productionOrder.update({ where: { id: productionOrderId }, data: { execStatus: status } });
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

// 批量领料：异常行（数量非法/超未发/库存不足）跳过，其余正常出库
// cancelRemainMaterialIds：按行取消未发量（不再需要发料的部分），可与发料同一事务提交
export async function issueProductionOrderMaterials(
  productionOrderId: number,
  warehouseId: number | null,
  items: { workOrderMaterialId: number; quantity: number; unit?: string; location?: string; binId?: number | null; batchNo?: string; warehouseId?: number }[],
  userId: number,
  effectiveDate?: string,
  cancelRemainMaterialIds?: number[]
) {
  const cancelIds = [...new Set((cancelRemainMaterialIds ?? []).map(Number).filter((n) => n > 0))];
  const issueIdSet = new Set((items ?? []).map((i) => Number(i.workOrderMaterialId)));
  if (cancelIds.some((id) => issueIdSet.has(id))) throw new Error("同一物料行不能同时发料和取消未发");
  items = items ?? [];
  if (items.length > 0 && !warehouseId) throw new Error("请选择出库仓库");
  if (items.length === 0 && cancelIds.length === 0) throw new Error("请填写发放数量");
  const order = await prisma.productionOrder.findUnique({
    where: { id: productionOrderId },
  });
  if (!order) throw new Error("生产订单不存在");
  if (order.status === "closed") throw new Error("生产订单已关闭，不能发料");
  if (order.execStatus === "none") throw new Error("该生产订单尚未排产，不能发料");
  if (order.execStatus === "closed") throw new Error("生产订单执行已关闭，不能发料");
  if (cancelIds.length > 0 && !["pending", "in_progress"].includes(order.execStatus)) {
    throw new Error("生产订单已完工，不能取消未发");
  }
  let warehouse: any = null;
  if (items.length > 0) {
    warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId! } });
    if (!warehouse) throw new Error("仓库不存在");
  }
  // 行级仓库：按领料明细行的库位出库；行上未带 warehouseId 时用表头仓库兜底
  const warehouseCache = new Map<number, any>(warehouse ? [[warehouse.id, warehouse]] : []);

  const rows = await prisma.productionOrderMaterial.findMany({
    where: { productionOrderId, id: { in: [...new Set([...issueIdSet, ...cancelIds])] } },
    include: { material: { select: { id: true, code: true, name: true, batchManaged: true } } },
  });
  const map = new Map(rows.map((r) => [r.id, r]));
  const issueType = await prisma.stockTransactionType.findUnique({ where: { code: "ISS-WO" } });

  const issued: { workOrderMaterialId: number; materialCode: string; materialName: string; quantity: number }[] = [];
  const skipped: { workOrderMaterialId: number; materialCode: string; materialName: string; quantity: number; reason: string }[] = [];
  const cancelled: { workOrderMaterialId: number; materialCode: string; materialName: string; quantity: number }[] = [];

  let docNo = "";
  await prisma.$transaction(async (tx) => {
    if (items.length > 0) {
      await lockOrderNo(tx, ORDER_NO_LOCK.ST);
      docNo = await generateDocNo(tx, issueType?.documentPrefix || "ST");
    }
    let lineNo = 1;
    for (const it of items) {
      const row = map.get(it.workOrderMaterialId);
      const qty = Number(it.quantity);
      if (!row) {
        skipped.push({ workOrderMaterialId: it.workOrderMaterialId, materialCode: "", materialName: "", quantity: qty, reason: "物料行不存在" });
        continue;
      }
      const base = { workOrderMaterialId: row.id, materialCode: row.material.code, materialName: row.material.name, quantity: qty };
      if (!Number.isFinite(qty) || qty <= 0) {
        skipped.push({ ...base, reason: "数量必须大于0" });
        continue;
      }
      // 计量单位换算：录入数量按换算率折算为基本单位（需求量/已发量均以基本单位计）
      let rate: number;
      try {
        ({ rate } = await resolveUnitRate(row.materialId, it.unit, tx as any));
      } catch (e: any) {
        skipped.push({ ...base, reason: e.message });
        continue;
      }
      const baseQty = toBaseQty(qty, rate);

      const remain = row.requiredQty - row.issuedQty - row.cancelledQty;
      if (baseQty > remain + 1e-6) {
        skipped.push({ ...base, reason: `超过未发数量（${remain}）` });
        continue;
      }

      // 1) 行库位 → 行仓库；校验货位并预检库存（只读，未通过则跳过该行，无副作用）
      const itemWarehouseId = Number(it.warehouseId) || Number(warehouseId);
      let itemWarehouse = warehouseCache.get(itemWarehouseId);
      if (!itemWarehouse) {
        itemWarehouse = await tx.warehouse.findUnique({ where: { id: itemWarehouseId } });
        if (!itemWarehouse) {
          skipped.push({ ...base, reason: "库位对应的仓库不存在" });
          continue;
        }
        warehouseCache.set(itemWarehouseId, itemWarehouse);
      }
      let binId: number | null;
      try {
        binId = await resolveBinId(tx, itemWarehouse, it.binId);
      } catch (e: any) {
        skipped.push({ ...base, reason: e.message });
        continue;
      }
      const stock = await tx.stock.findFirst({ where: { materialId: row.materialId, warehouseId: itemWarehouseId, binId } });
      if (!stock || stock.quantity < baseQty) {
        skipped.push({ ...base, reason: `库存不足（当前 ${stock?.quantity ?? 0}）` });
        continue;
      }
      // 批号余量预检（与 applyBatchOut 同规则，只读）：失败仅跳过该行，避免写入后抛错整单回滚
      try {
        await checkBatchOutAvailable(tx, row.material, itemWarehouseId, binId, it.batchNo, baseQty);
      } catch (e: any) {
        skipped.push({ ...base, reason: e.message });
        continue;
      }

      // 2) 原子累加已发量（写入时校验不超未发量），防止并发超发；并发冲突时中止整个事务（回滚保证一致性）
      const issuedUpd = await tx.productionOrderMaterial.updateMany({
        where: {
          id: row.id,
          cancelledQty: row.cancelledQty,
          issuedQty: { lte: row.requiredQty - row.cancelledQty - baseQty + 1e-6 },
        },
        data: { issuedQty: { increment: baseQty } },
      });
      if (issuedUpd.count === 0) {
        throw new Error(`物料 ${row.material.code} 未发数量已变化，请刷新后重试`);
      }
      const freshRow = await tx.productionOrderMaterial.findUnique({ where: { id: row.id } });
      const newIssued = freshRow?.issuedQty ?? row.issuedQty + baseQty;
      const left = (freshRow?.requiredQty ?? row.requiredQty) - newIssued - (freshRow?.cancelledQty ?? row.cancelledQty);
      await tx.productionOrderMaterial.update({
        where: { id: row.id },
        data: {
          status: left <= 1e-6 ? (newIssued > 1e-6 ? "issued" : "cancelled") : newIssued > 1e-6 ? "partial" : "pending",
        },
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

      const resolvedBatchNo = await applyBatchOut(tx, row.material, itemWarehouseId, binId, it.batchNo, baseQty);
      await tx.stockRecord.create({
        data: {
          materialId: row.materialId,
          warehouseId: itemWarehouseId,
          binId,
          type: "out",
          quantity: baseQty,
          batchNo: resolvedBatchNo,
          relatedType: "ProductionOrder",
          relatedId: productionOrderId,
          transactionTypeId: issueType?.id,
          documentNo: docNo,
          lineNo: lineNo++,
          location: it.location || null,
          effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
          operatorId: userId,
          remark: `生产领料 生产订单${order.orderNo}`,
        },
      });
      issued.push(base);
    }

    // 4) 取消未发量：把该行未发部分标记为不再需要发料（不动库存、不写流水）
    for (const id of cancelIds) {
      const row = map.get(id);
      if (!row) {
        skipped.push({ workOrderMaterialId: id, materialCode: "", materialName: "", quantity: 0, reason: "物料行不存在" });
        continue;
      }
      const remain = row.requiredQty - row.issuedQty - row.cancelledQty;
      if (remain <= 1e-6) {
        skipped.push({ workOrderMaterialId: id, materialCode: row.material.code, materialName: row.material.name, quantity: 0, reason: "没有未发数量" });
        continue;
      }
      const upd = await tx.productionOrderMaterial.updateMany({
        where: { id, issuedQty: row.issuedQty, cancelledQty: row.cancelledQty },
        data: {
          cancelledQty: row.requiredQty - row.issuedQty,
          cancelledAt: new Date(),
          status: row.issuedQty > 1e-6 ? "issued" : "cancelled",
        },
      });
      if (upd.count === 0) {
        throw new Error(`物料 ${row.material.code} 未发数量已变化，请刷新后重试`);
      }
      row.cancelledQty = row.requiredQty - row.issuedQty;
      cancelled.push({ workOrderMaterialId: id, materialCode: row.material.code, materialName: row.material.name, quantity: remain });
    }
  });

  return { documentNo: docNo, issued, skipped, cancelled };
}

// ===== 生产订单领料单维护：新增 / 更新 / 删除明细行 =====
export async function createProductionOrderMaterial(
  productionOrderId: number,
  data: { materialId?: number; requiredQty?: number; unit?: string | null; remark?: string | null }
) {
  const order = await prisma.productionOrder.findUnique({ where: { id: productionOrderId } });
  if (!order) throw new Error("生产订单不存在");
  if (order.execStatus === "none") throw new Error("该生产订单尚未排产");
  if (order.status === "closed") throw new Error("生产订单已关闭，不能修改领料单");
  if (order.execStatus === "closed") throw new Error("生产订单执行已关闭，不能修改物料");
  if (!data.materialId) throw new Error("请选择物料");
  if (!Number.isFinite(Number(data.requiredQty)) || Number(data.requiredQty) <= 0) {
    throw new Error("需求量必须大于0");
  }
  const dup = await prisma.productionOrderMaterial.findUnique({
    where: { productionOrderId_materialId: { productionOrderId, materialId: data.materialId } },
  });
  if (dup) throw new Error("该物料已在清单中，请直接编辑");
  const material = await prisma.material.findUnique({ where: { id: data.materialId } });
  if (!material) throw new Error("物料不存在");
  return prisma.productionOrderMaterial.create({
    data: {
      productionOrderId,
      materialId: data.materialId,
      requiredQty: Number(data.requiredQty),
      unit: data.unit || material.unit || null,
      remark: data.remark || null,
      status: "pending",
    },
    include: { material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true } } },
  });
}

export async function updateProductionOrderMaterial(
  id: number,
  data: { materialId?: number; requiredQty?: number; unit?: string | null; remark?: string | null }
) {
  const row = await prisma.productionOrderMaterial.findUnique({
    where: { id },
    include: { material: { select: { unit: true } }, productionOrder: { select: { status: true, execStatus: true } } },
  });
  if (!row) throw new Error("物料行不存在");
  if (row.productionOrder.status === "closed") throw new Error("生产订单已关闭，不能修改领料单");
  if (row.productionOrder.execStatus === "closed") throw new Error("生产订单执行已关闭，不能修改物料");
  const materialChanged = data.materialId !== undefined && data.materialId !== row.materialId;
  if (materialChanged) {
    if (row.issuedQty > 0) throw new Error("已发料的行不能更换物料");
    const dup = await prisma.productionOrderMaterial.findUnique({
      where: { productionOrderId_materialId: { productionOrderId: row.productionOrderId, materialId: data.materialId! } },
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
  // 需求量改小时取消量随之收敛，保证 需求量 ≥ 已发 + 已取消；换物料视为重新提需求，取消量清零
  const cancelledQty = materialChanged ? 0 : Math.min(row.cancelledQty, Math.max(0, requiredQty - row.issuedQty));
  const left = requiredQty - row.issuedQty - cancelledQty;
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  // CAS 写回：并发取消/发料期间行已变化时中止，避免把 cancelledQty 静默覆盖回旧值
  return prisma.$transaction(async (tx) => {
    const upd = await tx.productionOrderMaterial.updateMany({
      where: { id, issuedQty: row.issuedQty, cancelledQty: row.cancelledQty },
      data: {
        materialId,
        requiredQty,
        cancelledQty,
        cancelledAt: cancelledQty > 1e-6 ? row.cancelledAt : null,
        unit: data.unit !== undefined ? data.unit || material?.unit || null : row.unit,
        remark: data.remark !== undefined ? data.remark || null : row.remark,
        status: left <= 1e-6 ? (row.issuedQty > 1e-6 ? "issued" : "cancelled") : row.issuedQty > 1e-6 ? "partial" : "pending",
      },
    });
    if (upd.count === 0) throw new Error("领料行已被其他操作修改，请刷新后重试");
    return tx.productionOrderMaterial.findUnique({
      where: { id },
      include: { material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true } } },
    });
  });
}

export async function deleteProductionOrderMaterial(id: number) {
  const row = await prisma.productionOrderMaterial.findUnique({
    where: { id },
    include: { productionOrder: { select: { status: true, execStatus: true } } },
  });
  if (!row) throw new Error("物料行不存在");
  if (row.productionOrder.status === "closed") throw new Error("生产订单已关闭，不能修改领料单");
  if (row.productionOrder.execStatus === "closed") throw new Error("生产订单执行已关闭，不能修改物料");
  if (row.issuedQty > 0) throw new Error("该物料已发料，不能删除");
  await prisma.productionOrderMaterial.delete({ where: { id } });
  return { success: true };
}

// ===== 订单工艺路线：优先取订单级副本，否则返回标准路线（仅预览）=====
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
  const orderRoute = await prisma.productionOrderRoute.findUnique({
    where: { productionOrderId: orderId },
    include: { productionOrder: { select: { status: true } } },
  });
  if (!orderRoute) throw new Error("该订单未排产，没有订单级工艺路线");
  assertOrderRouteEditable(orderRoute.productionOrder.status);
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

// ===== 编辑订单级工序（diff：更新已有工序、新增、删除不在列表且已被报工引用的工序）=====
// 生产订单已关闭后，订单级工艺路线（表头与工序）一律只读
function assertOrderRouteEditable(orderStatus: string) {
  if (orderStatus === "closed") throw new Error("生产订单已关闭，不能修改工艺路线");
}

export async function replaceOrderRouteSteps(
  orderId: number,
  steps: { id?: number; code: string; name: string; sequence: number; workstationId?: number | null; standardTime: number; setupTime: number }[]
) {
  const orderRoute = await prisma.productionOrderRoute.findUnique({
    where: { productionOrderId: orderId },
    include: {
      productionOrder: { select: { status: true } },
      steps: { select: { id: true, code: true, name: true, sequence: true, workstationId: true, standardTime: true, setupTime: true, sourceStepId: true } },
    },
  });
  if (!orderRoute) throw new Error("该订单未排产，没有订单级工艺路线");
  assertOrderRouteEditable(orderRoute.productionOrder.status);

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
    // 删除不在列表里的工序（已被报工引用的禁止删除）
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

export async function listReceivableProductionOrders(where: any) {
  const { orderNo, onlyReceivable, page = 1, pageSize = 20 } = where;
  const filters: Prisma.ProductionOrderWhereInput = {
    execStatus: { notIn: ["none", "closed"] },
    status: { notIn: ["closed"] },
  };
  if (orderNo) filters.orderNo = { contains: orderNo };
  if (onlyReceivable === "true" || onlyReceivable === true) {
    filters.receivedQty = { lt: prisma.productionOrder.fields.plannedQty };
  }

  const [total, items] = await Promise.all([
    prisma.productionOrder.count({ where: filters }),
    prisma.productionOrder.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, unit: true, location: true } },
        // 发料状态：按领料明细 已发/需求量 汇总
        materials: { select: { requiredQty: true, issuedQty: true, cancelledQty: true } },
      },
      orderBy: { id: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  await attachUnitInfo(items.map((o) => o.material));
  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function receiveProductionOrderProduct(
  productionOrderId: number,
  quantity: number,
  warehouseId: number,
  userId: number,
  batchNo?: string,
  unit?: string,
  binId?: number | null,
  closeWorkOrder?: boolean
) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("入库数量必须大于0");
  if (!warehouseId) throw new Error("请选择入库仓库");
  const order = await prisma.productionOrder.findUnique({
    where: { id: productionOrderId },
    include: { material: true },
  });
  if (!order) throw new Error("生产订单不存在");
  if (order.status === "closed") throw new Error("生产订单已关闭，不能入库");
  
  if (order.execStatus === "closed") throw new Error("生产订单执行已关闭，不能入库");
  if (order.execStatus === "none") throw new Error("该生产订单尚未排产，不能入库");
  const material = order.material;
  // 计量单位换算：录入数量按换算率折算为基本单位后入库
  const { rate } = await resolveUnitRate(material.id, unit);
  const baseQty = toBaseQty(quantity, rate);
  const remain = order.plannedQty - order.receivedQty;
  if (baseQty > remain + 1e-6) throw new Error(`入库数量超过剩余可入库数量（${remain}）`);
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new Error("仓库不存在");
  const receiveType = await prisma.stockTransactionType.findUnique({ where: { code: "RCT-WO" } });

  return prisma.$transaction(async (tx) => {
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const docNo = await generateDocNo(tx, receiveType?.documentPrefix || "ST");

    // 1) 原子累加入库量（写入时校验不超计划数量），防止并发超收
    const recvUpd = await tx.productionOrder.updateMany({
      where: { id: order.id, status: { notIn: ["closed"] }, execStatus: { notIn: ["none", "closed"] }, receivedQty: { lte: order.plannedQty - baseQty + 1e-6 } },
      data: { receivedQty: { increment: baseQty } },
    });
    if (recvUpd.count === 0) {
      const fresh = await tx.productionOrder.findUnique({ where: { id: order.id }, select: { plannedQty: true, receivedQty: true } });
      throw new Error(`入库数量超过剩余可入库数量（${(fresh?.plannedQty ?? 0) - (fresh?.receivedQty ?? 0)}）`);
    }
    const after = await tx.productionOrder.findUnique({ where: { id: order.id }, select: { receivedQty: true } });
    const newReceived = after?.receivedQty ?? order.receivedQty + baseQty;

    // 勾选「入库后关闭生产订单」时：关闭生产订单状态（status→closed），不改动执行状态；入满不再自动关闭
    const fullyReceived = newReceived >= order.plannedQty - 1e-6;
    let closed = false;
    if (closeWorkOrder === true) {
      const closedResult = await tx.productionOrder.updateMany({
        where: { id: order.id, status: { in: ["planned", "in_progress"] } },
        data: { status: "closed" },
      });
      closed = closedResult.count > 0;
    }

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
        relatedType: "ProductionOrder",
        relatedId: order.id,
        transactionTypeId: receiveType?.id,
        documentNo: docNo,
        lineNo: 1,
        operatorId: userId,
        remark: `生产入库 ${material.name} 生产订单${order.orderNo}`,
      },
    });
    return { success: true, documentNo: docNo, receivedQty: newReceived, fullyReceived, closed };
  });
}

import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact } from "../utils/date";
import { generateStockDocNo } from "./stock.service";

// ===== 生产订单 =====
export async function generateProductionOrderNo(): Promise<string> {
  const dateStr = localDateCompact();
  const count = await prisma.productionOrder.count({
    where: { orderNo: { startsWith: `MO${dateStr}` } },
  });
  return `MO${dateStr}${String(count + 1).padStart(4, "0")}`;
}

export interface ProductionOrderInput {
  salesOrderId?: number;
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
  if (status) filters.status = status;
  if (materialName) {
    filters.material = { name: { contains: materialName } };
  }

  const [total, items] = await Promise.all([
    prisma.productionOrder.count({ where: filters }),
    prisma.productionOrder.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, unit: true } },
        salesOrder: { select: { id: true, orderNo: true, customerName: true } },
        batches: { orderBy: { batchNo: "asc" } },
        workOrders: {
          include: { workstation: { select: { id: true, code: true, name: true } } },
        },
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
  for (const input of inputs) {
    const material = await prisma.material.findUnique({ where: { id: input.materialId } });
    if (!material) throw new Error(`物料ID ${input.materialId} 不存在`);
    if (material.category !== "manufacture") continue;

    // 防重复下达：同一销售订单 + 同一物料已有未完成生产订单则跳过
    const exists = await prisma.productionOrder.findFirst({
      where: {
        materialId: input.materialId,
        salesOrderId: input.salesOrderId ?? null,
        status: { in: ["planned", "in_progress"] },
      },
    });
    if (exists) {
      skipped.push({ materialId: input.materialId, salesOrderId: input.salesOrderId ?? null });
      continue;
    }

    const orderNo = await generateProductionOrderNo();
    const order = await prisma.productionOrder.create({
      data: {
        orderNo,
        salesOrderId: input.salesOrderId,
        materialId: input.materialId,
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
    created.push(order);
  }
  return { created, skipped };
}

// 计划员下拉：计划员角色的启用用户
export async function listPlanners() {
  return prisma.user.findMany({
    where: { status: 1, userRoles: { some: { role: { code: "Planner" } } } },
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

// 取消生产订单：作废未完成加工单；若该销售订单已无有效生产订单则回退其状态
export async function cancelProductionOrder(id: number) {
  const order = await prisma.productionOrder.findUnique({ where: { id } });
  if (!order) throw new Error("生产订单不存在");
  if (order.status === "cancelled") throw new Error("生产订单已取消");
  if (order.status === "completed") throw new Error("已完成的生产订单不能取消");

  return prisma.$transaction(async (tx) => {
    await tx.workOrder.updateMany({
      where: { productionOrderId: id, status: { in: ["pending", "in_progress", "paused"] } },
      data: { status: "cancelled" },
    });
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
        await tx.salesOrder.update({ where: { id: order.salesOrderId }, data: { status: "confirmed" } });
        await tx.salesOrderItem.updateMany({
          where: { orderId: order.salesOrderId, materialId: order.materialId, status: "in_production" },
          data: { status: "pending" },
        });
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

    // 数量变更时同步未完成加工单的计划量，保持与生产订单一致
    if (data.quantity !== undefined && data.quantity !== exists.quantity) {
      await tx.workOrder.updateMany({
        where: { productionOrderId: id, status: { in: ["pending", "in_progress", "paused"] } },
        data: { plannedQty: data.quantity },
      });
    }

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

  const routeId = order.material.processRouteId;
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

  // 重建：已取消的加工单不能带报工记录，否则拒绝
  const cancelledWorkOrders = await prisma.workOrder.findMany({
    where: { productionOrderId, status: "cancelled" },
    select: { id: true, _count: { select: { reports: true } } },
  });
  if (cancelledWorkOrders.some((w) => w._count.reports > 0)) {
    throw new Error("该生产订单存在已报工的加工单，无法重新排产");
  }

  const maxBatch = await prisma.productionBatch.aggregate({
    where: { productionOrderId },
    _max: { batchNo: true },
  });
  let nextBatchNo = (maxBatch._max.batchNo ?? 0) + 1;

  return prisma.$transaction(async (tx) => {
    // 清理此前已取消的加工单及其工序分配
    if (cancelledWorkOrders.length > 0) {
      const oldIds = cancelledWorkOrders.map((w) => w.id);
      await tx.processRouteAssignment.deleteMany({ where: { workOrderId: { in: oldIds } } });
      await tx.workOrder.deleteMany({ where: { id: { in: oldIds } } });
    }
    await tx.productionBatch.deleteMany({ where: { productionOrderId: order.id, status: "cancelled" } });

    const workOrders: any[] = [];
    const createdBatches: any[] = [];
    const totalTime = route.processes.reduce((sum, p) => sum + p.standardTime + p.setupTime, 0);

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

      for (const p of route.processes) {
        const dateStr = localDateCompact();
        const count = await tx.workOrder.count({ where: { orderNo: { startsWith: `WO${dateStr}` } } });
        const workOrder = await tx.workOrder.create({
          data: {
            orderNo: `WO${dateStr}${String(count + 1).padStart(4, "0")}`,
            productionOrderId: order.id,
            batchId: batch.id,
            processRouteId: route.id,
            workstationId: p.workstationId,
            operatorId: userId,
            plannedQty: b.quantity,
            status: "pending",
            startTime: batch.planStartDate,
          },
        });

        await tx.processRouteAssignment.create({
          data: {
            productionOrderId: order.id,
            workOrderId: workOrder.id,
            processStepId: p.id,
            status: "pending",
          },
        });

        workOrders.push(workOrder);
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

    // 关联销售订单状态更新
    if (order.salesOrderId) {
      await tx.salesOrder.update({
        where: { id: order.salesOrderId },
        data: { status: "in_production" },
      });
      await tx.salesOrderItem.updateMany({
        where: { orderId: order.salesOrderId, materialId: order.materialId },
        data: { status: "in_production" },
      });
    }

    return { productionOrderId: order.id, batches: createdBatches, workOrders, totalTime };
  });
}

// ===== 报工 =====
export async function reportWork(workOrderId: number, data: {
  quantity: number;
  scrapQty?: number;
  materialUsed?: number;
  remark?: string;
}, userId: number) {
  const workOrder = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: { productionOrder: { include: { material: true } } },
  });
  if (!workOrder) throw new Error("加工单不存在");
  if (workOrder.status === "completed") throw new Error("加工单已完成，不能重复报工");

  return prisma.$transaction(async (tx) => {
    const newActualQty = workOrder.actualQty + data.quantity;
    const newScrapQty = workOrder.scrapQty + (data.scrapQty ?? 0);
    const completed = newActualQty >= workOrder.plannedQty;

    // 记录报工
    await tx.workReport.create({
      data: {
        workOrderId,
        reporterId: userId,
        quantity: data.quantity,
        scrapQty: data.scrapQty ?? 0,
        materialUsed: data.materialUsed ?? 0,
        remark: data.remark,
      },
    });

    const updated = await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        actualQty: newActualQty,
        scrapQty: newScrapQty,
        status: completed ? "completed" : "in_progress",
        endTime: completed ? new Date() : null,
      },
    });

    // 更新加工单状态分配
    await tx.processRouteAssignment.updateMany({
      where: { workOrderId },
      data: {
        status: completed ? "completed" : "in_progress",
        actualQty: newActualQty,
        completedAt: completed ? new Date() : null,
      },
    });

    // 同步所属批次状态
    if (workOrder.batchId) {
      const batchNotDone = await tx.workOrder.count({
        where: { batchId: workOrder.batchId, status: { notIn: ["completed", "cancelled"] } },
      });
      await tx.productionBatch.update({
        where: { id: workOrder.batchId },
        data: { status: batchNotDone === 0 ? "completed" : "in_progress" },
      });
    }

    // 所有加工单完成 且 已排产量≥生产订单数量 时，才关闭生产订单
    const notDone = await tx.workOrder.count({
      where: { productionOrderId: workOrder.productionOrderId, status: { notIn: ["completed", "cancelled"] } },
    });
    if (notDone === 0) {
      const batchAgg = await tx.productionBatch.aggregate({
        where: { productionOrderId: workOrder.productionOrderId, status: { not: "cancelled" } },
        _sum: { quantity: true },
      });
      const scheduledQty = batchAgg._sum.quantity ?? 0;
      const po = await tx.productionOrder.findUnique({ where: { id: workOrder.productionOrderId } });
      if (po && scheduledQty >= po.quantity - 1e-6) {
        await tx.productionOrder.update({
          where: { id: po.id },
          data: { status: "completed", actualEndDate: new Date() },
        });
        // 更新销售订单状态
        if (po.salesOrderId) {
          const allPoDone = await tx.productionOrder.count({
            where: { salesOrderId: po.salesOrderId, status: { not: "completed" } },
          });
          if (allPoDone === 0) {
            await tx.salesOrder.update({
              where: { id: po.salesOrderId },
              data: { status: "completed" },
            });
            await tx.salesOrderItem.updateMany({
              where: { orderId: po.salesOrderId },
              data: { status: "completed" },
            });
          }
        }
      }
    }

    return updated;
  });
}

// ===== 车间状态 =====
export async function getWorkshopStatus(workshopId?: number) {
  const workstations = await prisma.workstation.findMany({
    where: workshopId ? { workshopId: Number(workshopId) } : undefined,
    include: {
      workshop: true,
      workOrders: {
        where: { status: { in: ["in_progress", "pending"] } },
        include: {
          productionOrder: { include: { material: true } },
        },
      },
    },
    orderBy: { code: "asc" },
  });

  return workstations.map((ws) => ({
    id: ws.id,
    code: ws.code,
    name: ws.name,
    workshopName: ws.workshop?.name,
    type: ws.type,
    status: ws.workOrders.some((w) => w.status === "in_progress") ? "busy" : "idle",
    currentWorkOrders: ws.workOrders.map((w) => ({
      id: w.id,
      orderNo: w.orderNo,
      materialName: w.productionOrder.material.name,
      plannedQty: w.plannedQty,
      actualQty: w.actualQty,
      status: w.status,
      progress: w.plannedQty > 0 ? Math.round((w.actualQty / w.plannedQty) * 100) : 0,
    })),
  }));
}

// ===== 甘特图数据 =====
export async function getGanttData(startDate?: string, endDate?: string) {
  const filters: Prisma.WorkOrderWhereInput = {};
  if (startDate || endDate) {
    filters.startTime = {
      gte: startDate ? new Date(startDate) : undefined,
      lte: endDate ? new Date(endDate) : undefined,
    };
  }

  const workOrders = await prisma.workOrder.findMany({
    where: filters,
    include: {
      workstation: true,
      productionOrder: { include: { material: true } },
      assignments: { include: { processStep: true } },
    },
    orderBy: [{ workstationId: "asc" }, { startTime: "asc" }],
  });

  return workOrders.map((w) => ({
    id: w.id,
    orderNo: w.orderNo,
    materialName: w.productionOrder.material.name,
    workStationName: w.workstation?.name,
    processStepName: w.assignments[0]?.processStep?.name,
    plannedQty: w.plannedQty,
    actualQty: w.actualQty,
    status: w.status,
    startTime: w.startTime,
    endTime: w.endTime,
    progress: w.plannedQty > 0 ? Math.round((w.actualQty / w.plannedQty) * 100) : 0,
  }));
}

// ===== 报工历史 =====
export async function listWorkReports(where: any) {
  const { workOrderId, reporterId, page = 1, pageSize = 20 } = where;
  const filters: Prisma.WorkReportWhereInput = {};
  if (workOrderId) filters.workOrderId = Number(workOrderId);
  if (reporterId) filters.reporterId = Number(reporterId);

  const [total, items] = await Promise.all([
    prisma.workReport.count({ where: filters }),
    prisma.workReport.findMany({
      where: filters,
      include: {
        reporter: { select: { id: true, realName: true } },
        workOrder: {
          include: { productionOrder: { include: { material: { select: { name: true } } } } },
        },
      },
      orderBy: { reportTime: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

// ===== 加工单列表 =====
export async function listWorkOrders(where: any) {
  const { orderNo, status, workstationId, page = 1, pageSize = 20 } = where;
  const filters: Prisma.WorkOrderWhereInput = {};
  if (orderNo) filters.orderNo = { contains: orderNo };
  if (status) filters.status = status;
  if (workstationId) filters.workstationId = Number(workstationId);

  const [total, items] = await Promise.all([
    prisma.workOrder.count({ where: filters }),
    prisma.workOrder.findMany({
      where: filters,
      include: {
        workstation: true,
        operator: { select: { id: true, realName: true } },
        batch: { select: { id: true, batchNo: true, quantity: true, planStartDate: true, planEndDate: true, status: true } },
        productionOrder: {
          include: { material: { select: { id: true, code: true, name: true, unit: true } } },
        },
        assignments: { include: { processStep: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
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
        material: { select: { id: true, code: true, name: true, specification: true, unit: true, defaultWarehouseId: true } },
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
        include: { material: { select: { id: true, code: true, name: true, unit: true, defaultWarehouseId: true } } },
      },
      materials: {
        include: {
          material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true, defaultWarehouseId: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!batch) throw new Error("批次不存在");
  return batch;
}

// 批量发料：异常行（数量非法/超未发/库存不足）跳过，其余正常出库
export async function issueBatchMaterials(
  batchId: number,
  warehouseId: number,
  items: { batchMaterialId: number; quantity: number; location?: string }[],
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
    include: { material: { select: { id: true, code: true, name: true } } },
  });
  const map = new Map(rows.map((r) => [r.id, r]));
  const issueType = await prisma.stockTransactionType.findUnique({ where: { code: "ISS-WO" } });
  const docNo = await generateStockDocNo();

  const issued: { batchMaterialId: number; materialCode: string; materialName: string; quantity: number }[] = [];
  const skipped: { batchMaterialId: number; materialCode: string; materialName: string; quantity: number; reason: string }[] = [];

  await prisma.$transaction(async (tx) => {
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
      const remain = row.requiredQty - row.issuedQty;
      if (qty > remain + 1e-6) {
        skipped.push({ ...base, reason: `超过未发数量（${remain}）` });
        continue;
      }
      const stock = await tx.stock.findFirst({ where: { materialId: row.materialId, warehouseId } });
      if (!stock || stock.quantity < qty) {
        skipped.push({ ...base, reason: `库存不足（当前 ${stock?.quantity ?? 0}）` });
        continue;
      }

      await tx.stock.update({
        where: { id: stock.id },
        data: { quantity: stock.quantity - qty, lastOutDate: new Date() },
      });
      await tx.stockRecord.create({
        data: {
          materialId: row.materialId,
          warehouseId,
          type: "out",
          quantity: qty,
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
      const newIssued = row.issuedQty + qty;
      await tx.productionBatchMaterial.update({
        where: { id: row.id },
        data: {
          issuedQty: newIssued,
          status: newIssued >= row.requiredQty - 1e-6 ? "issued" : "partial",
        },
      });
      row.issuedQty = newIssued;
      issued.push(base);
    }
  });

  return { documentNo: docNo, issued, skipped };
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
          include: { material: { select: { id: true, code: true, name: true, unit: true, defaultWarehouseId: true } } },
        },
      },
      orderBy: { id: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function receiveBatchProduct(
  batchId: number,
  quantity: number,
  warehouseId: number,
  userId: number
) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("入库数量必须大于0");
  if (!warehouseId) throw new Error("请选择入库仓库");
  const batch = await prisma.productionBatch.findUnique({
    where: { id: batchId },
    include: { productionOrder: { include: { material: true } } },
  });
  if (!batch) throw new Error("批次不存在");
  if (batch.status === "cancelled") throw new Error("批次已取消，不能入库");
  const remain = batch.quantity - batch.receivedQty;
  if (quantity > remain + 1e-6) throw new Error(`入库数量超过剩余可入库数量（${remain}）`);
  const material = batch.productionOrder.material;
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new Error("仓库不存在");
  const receiveType = await prisma.stockTransactionType.findUnique({ where: { code: "RCT-WO" } });
  const docNo = await generateStockDocNo();

  return prisma.$transaction(async (tx) => {
    const stock = await tx.stock.findFirst({ where: { materialId: material.id, warehouseId } });
    if (stock) {
      await tx.stock.update({
        where: { id: stock.id },
        data: { quantity: stock.quantity + quantity, lastInDate: new Date() },
      });
    } else {
      await tx.stock.create({
        data: { materialId: material.id, warehouseId, quantity, lastInDate: new Date() },
      });
    }
    await tx.stockRecord.create({
      data: {
        materialId: material.id,
        warehouseId,
        type: "in",
        quantity,
        relatedType: "ProductionBatch",
        relatedId: batch.id,
        transactionTypeId: receiveType?.id,
        documentNo: docNo,
        lineNo: 1,
        operatorId: userId,
        remark: `生产入库 ${material.name}`,
      },
    });
    const newReceived = batch.receivedQty + quantity;
    await tx.productionBatch.update({ where: { id: batch.id }, data: { receivedQty: newReceived } });
    return { success: true, documentNo: docNo, receivedQty: newReceived };
  });
}

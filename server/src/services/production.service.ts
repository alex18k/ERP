import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact } from "../utils/date";

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

// ===== 排产：根据工艺路线生成加工单 =====
export async function scheduleProduction(productionOrderId: number, userId: number) {
  const order = await prisma.productionOrder.findUnique({
    where: { id: productionOrderId },
    include: { material: true },
  });
  if (!order) throw new Error("生产订单不存在");
  if (order.status === "completed") throw new Error("已完成的生产订单不能排产");

  // 排产前置条件：计划开始/结束日期、计划员、下达日期必须已维护
  if (!order.planStartDate) throw new Error("请先维护计划开始日期");
  if (!order.planEndDate) throw new Error("请先维护计划结束日期");
  if (!order.planner) throw new Error("请先指定计划员");
  if (!order.releaseDate) throw new Error("请先维护下达日期");

  // 已有未取消的加工单 => 已排产，避免重复排产
  const activeWorkOrders = await prisma.workOrder.count({
    where: { productionOrderId, status: { not: "cancelled" } },
  });
  if (activeWorkOrders > 0) throw new Error("该生产订单已排产，不能重复排产");

  // 重新排产时需重建：已取消的加工单不能带报工记录，否则拒绝
  const cancelledWorkOrders = await prisma.workOrder.findMany({
    where: { productionOrderId, status: "cancelled" },
    select: { id: true, _count: { select: { reports: true } } },
  });
  if (cancelledWorkOrders.some((w) => w._count.reports > 0)) {
    throw new Error("该生产订单存在已报工的加工单，无法重新排产");
  }

  const routeId = order.material.processRouteId;
  if (!routeId) throw new Error("该产品未指定工艺路线，无法排产");

  const route = await prisma.processRoute.findUnique({
    where: { id: routeId },
    include: { processes: { orderBy: { sequence: "asc" } } },
  });
  if (!route) throw new Error("该产品指定的工艺路线不存在，无法排产");
  if (route.status !== "active") throw new Error("该产品的工艺路线未启用，无法排产");
  if (route.processes.length === 0) throw new Error("该产品的工艺路线没有工序，无法排产");

  return prisma.$transaction(async (tx) => {
    // 重建：清理此前已取消的加工单及其工序分配
    if (cancelledWorkOrders.length > 0) {
      const oldIds = cancelledWorkOrders.map((w) => w.id);
      await tx.processRouteAssignment.deleteMany({ where: { workOrderId: { in: oldIds } } });
      await tx.workOrder.deleteMany({ where: { id: { in: oldIds } } });
    }

    // 为每个工序创建加工单
    const workOrders = [];
    const totalTime = route.processes.reduce((sum, p) => sum + p.standardTime + p.setupTime, 0);

    for (const p of route.processes) {
      const dateStr = localDateCompact();
      const count = await tx.workOrder.count({ where: { orderNo: { startsWith: `WO${dateStr}` } } });
      const workOrder = await tx.workOrder.create({
        data: {
          orderNo: `WO${dateStr}${String(count + 1).padStart(4, "0")}`,
          productionOrderId: order.id,
          processRouteId: route.id,
          workstationId: p.workstationId,
          operatorId: userId,
          plannedQty: order.quantity,
          status: "pending",
          startTime: order.planStartDate,
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

    await tx.productionOrder.update({
      where: { id: order.id },
      data: { status: "in_progress", actualStartDate: new Date() },
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

    return { productionOrderId: order.id, workOrders, totalTime };
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

    // 如果所有加工单完成，更新生产订单
    const allDone = await tx.workOrder.count({
      where: { productionOrderId: workOrder.productionOrderId, status: { not: "completed" } },
    });
    if (allDone === 0) {
      await tx.productionOrder.update({
        where: { id: workOrder.productionOrderId },
        data: { status: "completed", actualEndDate: new Date() },
      });
      // 更新销售订单状态
      const po = await tx.productionOrder.findUnique({ where: { id: workOrder.productionOrderId } });
      if (po?.salesOrderId) {
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
import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateStr } from "../utils/date";

export async function getExecutiveDashboard() {
  const today = new Date();
  const todayStr = localDateStr(today);

  // 总订单数/完成数/进行中
  const totalOrders = await prisma.salesOrder.count({ where: { status: { not: "cancelled" } } });
  const completedOrders = await prisma.salesOrder.count({ where: { status: { in: ["completed", "shipped"] } } });
  const inProgressOrders = await prisma.salesOrder.count({ where: { status: "in_production" } });

  // 逾期订单
  const overdueOrders = await prisma.salesOrder.count({
    where: {
      deliveryDate: { lt: today },
      status: { in: ["draft", "confirmed", "in_production"] },
    },
  });

  // 订单总额
  const totalAmountResult = await prisma.salesOrder.aggregate({
    _sum: { totalAmount: true },
    where: { status: { not: "cancelled" } },
  });

  // 缺料物料数
  const latestRun = await prisma.mrpRun.findFirst({ orderBy: { startedAt: "desc" } });
  const shortageCount = latestRun?.shortageCount ?? 0;

  // 库存预警数：与 /stocks/alert 同口径——仅启用仓库、按物料全仓合计，且包含无库存行的物料
  const alertMaterials = await prisma.material.findMany({
    where: { status: 1, safetyStock: { gt: 0 } },
    select: { id: true, safetyStock: true },
  });
  const alertGrouped = await prisma.stock.groupBy({
    by: ["materialId"],
    where: { warehouse: { status: 1 } },
    _sum: { quantity: true },
  });
  const alertQtyMap = new Map(alertGrouped.map((g) => [g.materialId, g._sum.quantity ?? 0]));
  const lowStockCount = alertMaterials.filter(
    (m) => (alertQtyMap.get(m.id) ?? 0) <= m.safetyStock
  ).length;

  // 生产中数量（已排产且执行中的生产订单）
  const activeWorkOrders = await prisma.productionOrder.count({
    where: { execStatus: "in_progress" },
  });

  // ===== 经营/生产指标 =====
  // 已完工产值：完工/已发货订单金额合计
  const outputValue = await prisma.salesOrder.aggregate({
    _sum: { totalAmount: true },
    where: { status: { in: ["completed", "shipped"] } },
  });

  // 准时交付率：完工订单中，所有生产订单实际完工时间 ≤ 交期的占比
  const doneOrders = await prisma.salesOrder.findMany({
    where: { status: { in: ["completed", "shipped"] }, deliveryDate: { not: null } },
    select: { id: true, deliveryDate: true },
  });
  const doneProd = await prisma.productionOrder.findMany({
    where: { execStatus: "completed", actualEndDate: { not: null } },
    select: { salesOrderId: true, actualEndDate: true },
  });
  const doneOrderMap = new Map(doneOrders.map((o) => [o.id, o.deliveryDate!]));
  const lateOrders = new Set<number>();
  for (const p of doneProd) {
    const due = doneOrderMap.get(p.salesOrderId!);
    if (due && p.actualEndDate! > due) lateOrders.add(p.salesOrderId!);
  }
  const onTimeRate = doneOrders.length > 0 ? Math.round(((doneOrders.length - lateOrders.size) / doneOrders.length) * 100) : 0;

  // 累计良率：报工总量 vs 报废量
  const wrAgg = await prisma.workReport.aggregate({ _sum: { quantity: true, scrapQty: true } });
  const totalQty = wrAgg._sum.quantity ?? 0;
  const totalScrap = wrAgg._sum.scrapQty ?? 0;
  const yieldRate = totalQty > 0 ? Math.round(((totalQty - totalScrap) / totalQty) * 100) : 100;

  // 缺料影响订单数：最近一次MRP缺料关联的去重订单
  let shortageOrderCount = 0;
  if (latestRun) {
    const shortages = await prisma.mrpShortage.findMany({
      where: { runId: latestRun.id },
      select: { affectedOrders: true },
    });
    const orderSet = new Set<number>();
    for (const s of shortages) {
      if (!s.affectedOrders) continue;
      try {
        for (const a of JSON.parse(s.affectedOrders) as { orderId: number }[]) {
          orderSet.add(a.orderId);
        }
      } catch { /* ignore */ }
    }
    shortageOrderCount = orderSet.size;
  }

  return {
    orderStats: {
      total: totalOrders,
      completed: completedOrders,
      inProgress: inProgressOrders,
      overdue: overdueOrders,
      completionRate: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0,
    },
    financial: {
      totalAmount: totalAmountResult._sum.totalAmount ?? 0,
    },
    operations: {
      outputValue: outputValue._sum.totalAmount ?? 0,
      onTimeRate,
      yieldRate,
      shortageOrderCount,
    },
    alerts: {
      shortageCount,
      lowStockCount,
      activeWorkOrders,
    },
    lastMrpRun: latestRun
      ? {
          runNo: latestRun.runNo,
          completedAt: latestRun.completedAt,
          shortageCount: latestRun.shortageCount,
        }
      : null,
  };
}

export async function getOrderTrackingDashboard() {
  const orders = await prisma.salesOrder.findMany({
    where: { status: { not: "cancelled" } },
    include: {
      items: { include: { material: { select: { id: true, code: true, name: true, unit: true } } } },
      productionOrders: {
        include: {
          orderRoute: { include: { steps: true } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { deliveryDate: "asc" }],
    take: 50,
  });

  // 汇总各生产订单各工序报工量，按末道工序计算生产进度
  const allProductionOrderIds = orders.flatMap((o) => o.productionOrders.filter((po) => po.execStatus !== "none").map((po) => po.id));
  const grouped = allProductionOrderIds.length
    ? await prisma.workReport.groupBy({
        by: ["productionOrderId", "processStepId"],
        where: { productionOrderId: { in: allProductionOrderIds } },
        _sum: { quantity: true },
      })
    : [];
  const qtyMap = new Map<string, number>();
  for (const g of grouped) qtyMap.set(`${g.productionOrderId}:${g.processStepId}`, g._sum.quantity ?? 0);

  const today = new Date();

  return orders.map((o) => {
    const totalItemQty = o.items.reduce((sum, i) => sum + i.quantity, 0);
    const completedItemQty = o.items.reduce((sum, i) => sum + i.deliveredQty, 0);
    const productionProgress = o.productionOrders.length > 0
      ? Math.round(
          o.productionOrders.reduce((sum, po) => {
            const steps = po.orderRoute?.steps ?? [];
            const lastStep = steps.length ? steps.reduce((a, b) => (b.sequence > a.sequence ? b : a)) : null;
            const plan = po.quantity || 1;
            const lastQty = lastStep && po.execStatus !== "none" ? qtyMap.get(`${po.id}:${lastStep.id}`) ?? 0 : 0;
            return sum + Math.min(100, (Math.min(lastQty, po.plannedQty || po.quantity) / plan) * 100);
          }, 0) / o.productionOrders.length
        )
      : 0;

    return {
      id: o.id,
      orderNo: o.orderNo,
      customerName: o.customerName,
      deliveryDate: o.deliveryDate,
      status: o.status,
      isOverdue: o.deliveryDate ? o.deliveryDate < today && !["completed", "shipped"].includes(o.status) : false,
      totalItemQty,
      completedItemQty,
      productionProgress,
    };
  });
}

export async function getShortageAlertDashboard() {
  const latestRun = await prisma.mrpRun.findFirst({
    orderBy: { startedAt: "desc" },
  });
  if (!latestRun) return { latestRun: null, shortages: [] };

  const shortages = await prisma.mrpShortage.findMany({
    where: { runId: latestRun.id },
    include: { material: { select: { id: true, code: true, name: true, category: true, unit: true, supplierId: true } } },
    orderBy: { netDemand: "desc" },
  });

  const inTransitItems = await prisma.purchaseOrderItem.findMany({
    where: { status: "", order: { status: "confirmed" } },
    include: { material: { select: { id: true, code: true, name: true } } },
  });
  const inTransitMap = new Map<number, number>();
  for (const item of inTransitItems) {
    inTransitMap.set(item.materialId, (inTransitMap.get(item.materialId) ?? 0) + (item.quantity - item.receivedQty));
  }

  return {
    latestRun: { runNo: latestRun.runNo, completedAt: latestRun.completedAt },
    shortages: shortages.map((s) => ({
      ...s,
      affectedOrders: s.affectedOrders ? JSON.parse(s.affectedOrders) : [],
      inTransit: inTransitMap.get(s.materialId) ?? 0,
    })),
  };
}

export async function getInventoryDashboard() {
  const stocks = await prisma.stock.findMany({
    include: {
      material: { select: { id: true, code: true, name: true, category: true, unit: true, safetyStock: true } },
      warehouse: { select: { id: true, code: true, name: true, status: true } },
    },
    orderBy: { material: { code: "asc" } },
  });

  // 低库存按物料全仓合计（仅启用仓库）判断，避免同一物料多仓库被重复计数
  const totalByMaterial = new Map<number, number>();
  for (const s of stocks) {
    if (s.warehouse.status !== 1) continue;
    totalByMaterial.set(s.materialId, (totalByMaterial.get(s.materialId) ?? 0) + s.quantity);
  }
  const isLowStock = (s: (typeof stocks)[number]) =>
    s.material.safetyStock > 0 && (totalByMaterial.get(s.materialId) ?? 0) <= s.material.safetyStock;
  const lowMaterialIds = new Set(stocks.filter(isLowStock).map((s) => s.materialId));

  const summary = {
    totalMaterials: new Set(stocks.map((s) => s.materialId)).size,
    totalValue: stocks.reduce((sum, s) => sum + s.quantity, 0),
    lowStockCount: lowMaterialIds.size,
  };

  const categorized = new Map<string, any[]>();
  for (const s of stocks) {
    const cat = s.material.category;
    if (!categorized.has(cat)) categorized.set(cat, []);
    categorized.get(cat)!.push({
      ...s,
      availableQty: s.quantity - s.reservedQty,
      isLow: isLowStock(s),
    });
  }

  return {
    summary,
    stocks: stocks.map((s) => ({
      ...s,
      availableQty: s.quantity - s.reservedQty,
      isLow: isLowStock(s),
    })),
    byCategory: Object.fromEntries(categorized),
  };
}

export interface WorkshopDashboardFilters {
  workshopId?: number;
  execStatus?: string;
}

export interface WorkshopDashboardResult {
  summary: {
    inProgress: number;
    pending: number;
    todayReports: number;
    todayCompleted: number;
    overdue: number;
  };
  orders: Array<{
    id: number;
    orderNo: string;
    salesOrderNo: string | null;
    customerName: string | null;
    materialCode: string;
    materialName: string;
    quantity: number;
    plannedQty: number;
    reportedQty: number;
    progress: number;
    execStatus: string;
    planEndDate: Date | null;
    isOverdue: boolean;
    currentStepName: string | null;
    stepProgress: { completed: number; total: number };
    steps: Array<{
      id: number;
      name: string;
      sequence: number;
      workstationName: string | null;
      reportedQty: number;
      scrapQty: number;
      status: "done" | "current" | "waiting";
    }>;
  }>;
  workstations: Array<{
    id: number;
    code: string;
    name: string;
    workshopName: string | null;
    status: "busy" | "pending" | "idle";
    orderNo: string | null;
    stepName: string | null;
  }>;
  recentReports: Array<{
    id: number;
    reportTime: Date;
    reporterName: string;
    orderNo: string;
    stepName: string;
    quantity: number;
    scrapQty: number;
  }>;
  workshops: Array<{ id: number; name: string }>;
}

export async function getWorkshopDashboard(
  filters: WorkshopDashboardFilters = {}
): Promise<WorkshopDashboardResult> {
  const empty: WorkshopDashboardResult = {
    summary: { inProgress: 0, pending: 0, todayReports: 0, todayCompleted: 0, overdue: 0 },
    orders: [],
    workstations: [],
    recentReports: [],
    workshops: [],
  };
  if (
    filters.workshopId !== undefined &&
    (!Number.isFinite(filters.workshopId) || filters.workshopId <= 0)
  ) {
    return empty;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const now = new Date();

  const execStatusWhere: Prisma.ProductionOrderWhereInput = filters.execStatus
    ? filters.execStatus === "completed"
      ? { execStatus: "completed", actualEndDate: { gte: todayStart } }
      : { execStatus: filters.execStatus }
    : {
        OR: [
          { execStatus: { in: ["pending", "in_progress"] } },
          { execStatus: "completed", actualEndDate: { gte: todayStart } },
        ],
      };

  const where: Prisma.ProductionOrderWhereInput = {
    status: { not: "closed" },
    ...execStatusWhere,
    ...(filters.workshopId !== undefined
      ? { orderRoute: { steps: { some: { workstation: { workshopId: filters.workshopId } } } } }
      : {}),
  };

  const sortedOrders = await prisma.productionOrder.findMany({
    where,
    include: {
      material: { select: { code: true, name: true } },
      salesOrder: { select: { orderNo: true, customerName: true } },
      orderRoute: {
        include: {
          steps: {
            include: { workstation: { include: { workshop: true } } },
            orderBy: { sequence: "asc" },
          },
        },
      },
    },
    orderBy: { planEndDate: { sort: "asc", nulls: "last" } },
    take: 200,
  });

  const orderIds = sortedOrders.map((order) => order.id);
  const grouped = orderIds.length
    ? await prisma.workReport.groupBy({
        by: ["productionOrderId", "processStepId"],
        where: { productionOrderId: { in: orderIds } },
        _sum: { quantity: true, scrapQty: true },
      })
    : [];
  const qtyMap = new Map<string, { quantity: number; scrapQty: number }>();
  for (const row of grouped) {
    qtyMap.set(`${row.productionOrderId}:${row.processStepId}`, {
      quantity: row._sum.quantity ?? 0,
      scrapQty: row._sum.scrapQty ?? 0,
    });
  }

  const stepWorkshopMap = new Map<number, number | null>();
  const stepNameMap = new Map<number, string>();
  for (const order of sortedOrders) {
    for (const step of order.orderRoute?.steps ?? []) {
      stepWorkshopMap.set(step.id, step.workstation?.workshopId ?? null);
      stepNameMap.set(step.id, step.name);
    }
  }
  const workshopStepIds =
    filters.workshopId !== undefined
      ? [...stepWorkshopMap.entries()]
          .filter(([, workshopId]) => workshopId === filters.workshopId)
          .map(([stepId]) => stepId)
      : null;

  const orders = sortedOrders.map((order) => {
    const steps = order.orderRoute?.steps ?? [];
    const plan = order.plannedQty || order.quantity || 1;
    let currentAssigned = false;
    const stepsOut = steps.map((step) => {
      const agg = qtyMap.get(`${order.id}:${step.id}`);
      const reportedQty = agg?.quantity ?? 0;
      let status: "done" | "current" | "waiting";
      if (reportedQty >= plan) {
        status = "done";
      } else if (!currentAssigned) {
        status = "current";
        currentAssigned = true;
      } else {
        status = "waiting";
      }
      return {
        id: step.id,
        name: step.name,
        sequence: step.sequence,
        workstationName: step.workstation?.name ?? null,
        reportedQty,
        scrapQty: agg?.scrapQty ?? 0,
        status,
      };
    });

    const lastStep = steps.length ? steps[steps.length - 1] : null;
    const reportedQty = lastStep ? qtyMap.get(`${order.id}:${lastStep.id}`)?.quantity ?? 0 : 0;
    const progress = Math.round(Math.min(100, (Math.min(reportedQty, plan) / plan) * 100));

    return {
      id: order.id,
      orderNo: order.orderNo,
      salesOrderNo: order.salesOrderNo ?? order.salesOrder?.orderNo ?? null,
      customerName: order.salesOrder?.customerName ?? null,
      materialCode: order.material.code,
      materialName: order.material.name,
      quantity: order.quantity,
      plannedQty: order.plannedQty,
      reportedQty,
      progress,
      execStatus: order.execStatus,
      planEndDate: order.planEndDate,
      isOverdue: !!order.planEndDate && order.planEndDate < now && order.execStatus !== "completed",
      currentStepName: stepsOut.find((step) => step.status === "current")?.name ?? null,
      stepProgress: {
        completed: stepsOut.filter((step) => step.status === "done").length,
        total: stepsOut.length,
      },
      steps: stepsOut,
    };
  });

  const activeByWorkstation = new Map<
    number,
    { orderNo: string; stepName: string; status: "busy" | "pending" }
  >();
  for (const order of sortedOrders) {
    if (order.execStatus !== "in_progress" && order.execStatus !== "pending") continue;
    const plan = order.plannedQty || order.quantity || 1;
    const currentStep = (order.orderRoute?.steps ?? []).find(
      (step) => (qtyMap.get(`${order.id}:${step.id}`)?.quantity ?? 0) < plan
    );
    if (!currentStep?.workstationId || activeByWorkstation.has(currentStep.workstationId)) continue;
    activeByWorkstation.set(currentStep.workstationId, {
      orderNo: order.orderNo,
      stepName: currentStep.name,
      status: order.execStatus === "in_progress" ? "busy" : "pending",
    });
  }

  const [workshops, rawWorkstations] = await Promise.all([
    prisma.workshop.findMany({
      where: { status: 1 },
      select: { id: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.workstation.findMany({
      where: {
        status: 1,
        ...(filters.workshopId !== undefined ? { workshopId: filters.workshopId } : {}),
      },
      include: { workshop: true },
      orderBy: { code: "asc" },
    }),
  ]);
  const workstations = rawWorkstations.map((station) => {
    const active = activeByWorkstation.get(station.id);
    return {
      id: station.id,
      code: station.code,
      name: station.name,
      workshopName: station.workshop?.name ?? null,
      status: (active?.status ?? "idle") as "busy" | "pending" | "idle",
      orderNo: active?.orderNo ?? null,
      stepName: active?.stepName ?? null,
    };
  });

  const reportWhere = {
    productionOrderId: { in: orderIds },
    reportTime: { gte: todayStart },
    ...(workshopStepIds ? { processStepId: { in: workshopStepIds } } : {}),
  };
  const orderNoMap = new Map(sortedOrders.map((order) => [order.id, order.orderNo]));
  const [todayReports, reportRows] = orderIds.length
    ? await Promise.all([
        prisma.workReport.count({ where: reportWhere }),
        prisma.workReport.findMany({
          where: reportWhere,
          include: { reporter: { select: { realName: true } } },
          orderBy: { reportTime: "desc" },
          take: 20,
        }),
      ])
    : [0, []];
  const recentReports = reportRows.map((report) => ({
    id: report.id,
    reportTime: report.reportTime,
    reporterName: report.reporter.realName,
    orderNo: orderNoMap.get(report.productionOrderId) ?? "",
    stepName: stepNameMap.get(report.processStepId) ?? `工序#${report.processStepId}`,
    quantity: report.quantity,
    scrapQty: report.scrapQty,
  }));

  const summary = {
    inProgress: sortedOrders.filter((order) => order.execStatus === "in_progress").length,
    pending: sortedOrders.filter((order) => order.execStatus === "pending").length,
    todayReports,
    todayCompleted: sortedOrders.filter(
      (order) =>
        order.execStatus === "completed" &&
        !!order.actualEndDate &&
        order.actualEndDate >= todayStart
    ).length,
    overdue: sortedOrders.filter(
      (order) =>
        order.execStatus !== "completed" &&
        !!order.planEndDate &&
        order.planEndDate < now
    ).length,
  };

  return { summary, orders, workstations, recentReports, workshops };
}
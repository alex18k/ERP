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

// 工位任务：订单级工序中「未达产」的一条（同一工序只出现一次）
export interface WorkshopTask {
  stepId: number;
  orderId: number;
  orderNo: string;
  stepName: string;
  sequence: number;
  reportedQty: number;
  plannedQty: number;
  planEndDate: Date | null;
  started: boolean;
}

export interface WorkshopDashboardResult {
  summary: {
    inProgress: number;
    pending: number;
    todayReports: number;
    todayCompleted: number;
    overdue: number;
  };
  /** 工位面板只展示开头的若干条，未分配工位的任务单独返回，避免静默消失 */
  unassignedTasks: WorkshopTask[];
  unassignedCount: number;
  /** 符合条件的订单总数（orders 最多返回 200 条） */
  total: number;
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
    capacity: number;
    status: "busy" | "pending" | "idle";
    /** 该工位当前排队任务数（含正在加工的一条） */
    taskCount: number;
    orderNo: string | null;
    stepName: string | null;
    tasks: WorkshopTask[];
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
    unassignedTasks: [],
    unassignedCount: 0,
    total: 0,
  };
  if (
    filters.workshopId !== undefined &&
    (!Number.isFinite(filters.workshopId) || filters.workshopId <= 0)
  ) {
    return empty;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

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

  const workshopWhere: Prisma.ProductionOrderWhereInput =
    filters.workshopId !== undefined
      ? { orderRoute: { steps: { some: { workstation: { workshopId: filters.workshopId } } } } }
      : {};

  const where: Prisma.ProductionOrderWhereInput = {
    status: { not: "closed" },
    ...execStatusWhere,
    ...workshopWhere,
  };

  const [sortedOrders, total] = await Promise.all([
    prisma.productionOrder.findMany({
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
      orderBy: [{ planEndDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: 200,
    }),
    prisma.productionOrder.count({ where }),
  ]);

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

  const orders = sortedOrders.map((order) => {
    const steps = order.orderRoute?.steps ?? [];
    const plan = order.plannedQty || order.quantity || 1;
    const stepsOut = steps.map((step) => {
      const agg = qtyMap.get(`${order.id}:${step.id}`);
      const reportedQty = agg?.quantity ?? 0;
      // 已开工（有报工未达产）才算「当前」，避免后道先报工却显示待加工
      const status: "done" | "current" | "waiting" =
        reportedQty >= plan ? "done" : reportedQty > 0 ? "current" : "waiting";
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

    // 当前工序：优先取已开工的那道；都没开工则取第一道未完工
    const currentStep =
      stepsOut.find((step) => step.status === "current") ??
      stepsOut.find((step) => step.status !== "done") ??
      null;

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
      isOverdue: isOverdueOn(order.planEndDate, order.execStatus, todayStart),
      currentStepName: currentStep?.name ?? null,
      stepProgress: {
        completed: stepsOut.filter((step) => step.status === "done").length,
        total: stepsOut.length,
      },
      steps: stepsOut,
    };
  });

  // ===== 工位任务：按「工序」聚合（不再只取每单第一道未达产工序）=====
  // 未完工订单的全部工序里，凡未达产的都是待完成任务；同一工位可排队多条，按交期升序。
  const openOrders = await prisma.productionOrder.findMany({
    where: { status: { not: "closed" }, execStatus: { in: ["pending", "in_progress"] } },
    select: {
      id: true,
      orderNo: true,
      plannedQty: true,
      quantity: true,
      planEndDate: true,
      execStatus: true,
    },
  });
  const openOrderIds = openOrders.map((order) => order.id);
  const [openSteps, openStepAgg] = openOrderIds.length
    ? await Promise.all([
        prisma.productionOrderStep.findMany({
          where: { orderRoute: { productionOrderId: { in: openOrderIds } } },
          select: {
            id: true,
            name: true,
            sequence: true,
            workstationId: true,
            orderRoute: { select: { productionOrderId: true } },
            workstation: { select: { workshopId: true } },
          },
          orderBy: { sequence: "asc" },
        }),
        prisma.workReport.groupBy({
          by: ["processStepId"],
          where: { productionOrderId: { in: openOrderIds } },
          _sum: { quantity: true },
        }),
      ])
    : [[], []];
  const openStepQty = new Map<number, number>(
    (openStepAgg as Array<{ processStepId: number; _sum: { quantity: number | null } }>).map((row) => [
      row.processStepId,
      row._sum.quantity ?? 0,
    ])
  );
  const openOrderMap = new Map(openOrders.map((order) => [order.id, order]));
  const stepRows = (openSteps as Array<{
    id: number;
    name: string;
    sequence: number;
    workstationId: number | null;
    orderRoute: { productionOrderId: number };
    workstation: { workshopId: number | null } | null;
  }>).map((step) => {
    const order = openOrderMap.get(step.orderRoute.productionOrderId)!;
    const plan = order.plannedQty || order.quantity || 1;
    const reportedQty = openStepQty.get(step.id) ?? 0;
    return {
      stepId: step.id,
      orderId: order.id,
      orderNo: order.orderNo,
      stepName: step.name,
      sequence: step.sequence,
      workstationId: step.workstationId,
      workshopId: step.workstation?.workshopId ?? null,
      reportedQty,
      plannedQty: plan,
      planEndDate: order.planEndDate,
      started: reportedQty > 0,
      done: reportedQty >= plan,
    };
  });
  const pendingTasks = stepRows
    .filter((step) => !step.done)
    .sort(
      (a, b) =>
        (a.planEndDate?.getTime() ?? Number.POSITIVE_INFINITY) -
          (b.planEndDate?.getTime() ?? Number.POSITIVE_INFINITY) ||
        a.sequence - b.sequence
    );

  const toPublicTask = (task: (typeof pendingTasks)[number]): WorkshopTask => ({
    stepId: task.stepId,
    orderId: task.orderId,
    orderNo: task.orderNo,
    stepName: task.stepName,
    sequence: task.sequence,
    reportedQty: task.reportedQty,
    plannedQty: task.plannedQty,
    planEndDate: task.planEndDate,
    started: task.started,
  });

  const tasksByStation = new Map<number, typeof pendingTasks>();
  const unassignedAll = pendingTasks.filter((task) => !task.workstationId);
  for (const task of pendingTasks) {
    if (!task.workstationId) continue;
    const list = tasksByStation.get(task.workstationId) ?? [];
    list.push(task);
    tasksByStation.set(task.workstationId, list);
  }
  // 车间筛选时，未分配工位的任务只保留「该车间确有工序」的订单，避免跨车间串数据
  const unassignedTasks =
    filters.workshopId === undefined
      ? unassignedAll
      : unassignedAll.filter((task) => {
          const order = openOrderMap.get(task.orderId);
          if (!order) return false;
          return stepRows.some(
            (step) =>
              step.orderId === task.orderId && step.workshopId === filters.workshopId
          );
        });

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
    const tasks = tasksByStation.get(station.id) ?? [];
    // 只要该工位有一条工序已开工，就算加工中；否则有待办算待开工
    const status: "busy" | "pending" | "idle" =
      tasks.length === 0 ? "idle" : tasks.some((task) => task.started) ? "busy" : "pending";
    return {
      id: station.id,
      code: station.code,
      name: station.name,
      workshopName: station.workshop?.name ?? null,
      capacity: station.capacity ?? 1,
      status,
      taskCount: tasks.length,
      orderNo: tasks[0]?.orderNo ?? null,
      stepName: tasks[0]?.stepName ?? null,
      tasks: tasks.map(toPublicTask),
    };
  });

  // 今日报工与报工动态：全厂口径（仅受车间筛选影响），不随 execStatus 筛选变化
  const workshopStepIds =
    filters.workshopId !== undefined
      ? (
          await prisma.productionOrderStep.findMany({
            where: { workstation: { workshopId: filters.workshopId } },
            select: { id: true },
          })
        ).map((step) => step.id)
      : null;
  const reportWhere = {
    reportTime: { gte: todayStart },
    ...(workshopStepIds ? { processStepId: { in: workshopStepIds } } : {}),
  };
  const [todayReports, reportRows] = await Promise.all([
    prisma.workReport.count({ where: reportWhere }),
    prisma.workReport.findMany({
      where: reportWhere,
      include: {
        reporter: { select: { realName: true } },
        productionOrder: { select: { orderNo: true } },
      },
      orderBy: { reportTime: "desc" },
      take: 20,
    }),
  ]);
  const reportStepIds = [...new Set(reportRows.map((report) => report.processStepId))];
  const reportStepNameMap = new Map<number, string>(
    reportStepIds.length
      ? (
          await prisma.productionOrderStep.findMany({
            where: { id: { in: reportStepIds } },
            select: { id: true, name: true },
          })
        ).map((step) => [step.id, step.name])
      : []
  );
  const recentReports = reportRows.map((report) => ({
    id: report.id,
    reportTime: report.reportTime,
    reporterName: report.reporter.realName,
    orderNo: report.productionOrder?.orderNo ?? "",
    stepName: reportStepNameMap.get(report.processStepId) ?? `工序#${report.processStepId}`,
    quantity: report.quantity,
    scrapQty: report.scrapQty,
  }));

  // 顶部统计：不受 orders 的 200 条上限影响（车间筛选仍生效，execStatus 筛选不影响）
  const summaryWhere: Prisma.ProductionOrderWhereInput = {
    status: { not: "closed" },
    ...workshopWhere,
  };
  const [inProgress, pending, todayCompleted, overdue] = await Promise.all([
    prisma.productionOrder.count({ where: { ...summaryWhere, execStatus: "in_progress" } }),
    prisma.productionOrder.count({ where: { ...summaryWhere, execStatus: "pending" } }),
    prisma.productionOrder.count({
      where: { ...summaryWhere, execStatus: "completed", actualEndDate: { gte: todayStart } },
    }),
    prisma.productionOrder.count({
      where: {
        ...summaryWhere,
        execStatus: { not: "completed" },
        planEndDate: { lt: todayStart },
      },
    }),
  ]);
  const summary = { inProgress, pending, todayReports, todayCompleted, overdue };

  return {
    summary,
    orders,
    workstations,
    recentReports,
    workshops,
    unassignedTasks: unassignedTasks.slice(0, 20).map(toPublicTask),
    unassignedCount: unassignedTasks.length,
    total,
  };
}

/**
 * 逾期判据：按「日期」比较，计划完工日 = 今天不算逾期（与生产订单页口径一致）。
 * 已完工订单不算逾期。
 */
export function isOverdueOn(
  planEndDate: Date | null | undefined,
  execStatus: string,
  todayStart: Date
): boolean {
  if (!planEndDate || execStatus === "completed") return false;
  const due = new Date(planEndDate);
  due.setHours(0, 0, 0, 0);
  return due.getTime() < todayStart.getTime();
}

import prisma from "../config/prisma";
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

  // 库存预警数
  const alertStocks = await prisma.stock.findMany({
    include: { material: true },
  });
  const stockByMaterial = new Map<number, { qty: number; safety: number }>();
  for (const s of alertStocks) {
    const cur = stockByMaterial.get(s.materialId) ?? { qty: 0, safety: s.material.safetyStock };
    cur.qty += s.quantity;
    stockByMaterial.set(s.materialId, cur);
  }
  const lowStockCount = [...stockByMaterial.values()].filter((x) => x.safety > 0 && x.qty <= x.safety).length;

  // 生产中工单数
  const activeWorkOrders = await prisma.workOrder.count({
    where: { status: "in_progress" },
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
    where: { status: "completed", actualEndDate: { not: null } },
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

  // 产能负荷：当前有任务工位占比
  const workstations = await prisma.workstation.findMany({
    include: { workOrders: { where: { status: { in: ["pending", "in_progress"] } }, select: { id: true } } },
  });
  const busyCount = workstations.filter((w) => w.workOrders.length > 0).length;
  const capacityLoad = workstations.length > 0 ? Math.round((busyCount / workstations.length) * 100) : 0;

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
      capacityLoad,
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
        include: { workOrders: true },
      },
    },
    orderBy: [{ status: "asc" }, { deliveryDate: "asc" }],
    take: 50,
  });

  const today = new Date();

  return orders.map((o) => {
    const totalItemQty = o.items.reduce((sum, i) => sum + i.quantity, 0);
    const completedItemQty = o.items.reduce((sum, i) => sum + i.deliveredQty, 0);
    const productionProgress = o.productionOrders.length > 0
      ? Math.round(
          o.productionOrders.reduce((sum, po) => {
            const totalPlan = po.workOrders.reduce((s, w) => s + w.plannedQty, 0);
            const totalActual = po.workOrders.reduce((s, w) => s + w.actualQty, 0);
            return sum + (totalPlan > 0 ? (totalActual / totalPlan) * 100 : 0);
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
    where: { status: { in: ["pending", "partial_received"] } },
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

export async function getWorkshopDashboard() {
  const workstations = await prisma.workstation.findMany({
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

  const todayReports = await prisma.workReport.findMany({
    where: {
      reportTime: {
        gte: new Date(new Date().setHours(0, 0, 0, 0)),
      },
    },
    include: { reporter: true },
  });

  const totalReportsToday = todayReports.reduce((sum, r) => sum + r.quantity, 0);
  const totalScrapToday = todayReports.reduce((sum, r) => sum + r.scrapQty, 0);

  return {
    workstations: workstations.map((ws) => ({
      id: ws.id,
      code: ws.code,
      name: ws.name,
      workshopName: ws.workshop?.name,
      type: ws.type,
      status: ws.workOrders.length > 0 ? (ws.workOrders.some((w) => w.status === "in_progress") ? "busy" : "idle") : "idle",
      workOrders: ws.workOrders.map((w) => ({
        orderNo: w.orderNo,
        materialName: w.productionOrder.material.name,
        plannedQty: w.plannedQty,
        actualQty: w.actualQty,
        progress: w.plannedQty > 0 ? Math.round((w.actualQty / w.plannedQty) * 100) : 0,
      })),
    })),
    todaySummary: {
      totalReports: todayReports.length,
      totalOutputQty: totalReportsToday,
      totalScrapQty: totalScrapToday,
      yieldRate: totalReportsToday > 0 ? Math.round(((totalReportsToday - totalScrapToday) / totalReportsToday) * 100) : 100,
    },
  };
}

export async function getInventoryDashboard() {
  const stocks = await prisma.stock.findMany({
    include: {
      material: { select: { id: true, code: true, name: true, category: true, unit: true, safetyStock: true } },
      warehouse: { select: { id: true, code: true, name: true } },
    },
    orderBy: { material: { code: "asc" } },
  });

  const summary = {
    totalMaterials: new Set(stocks.map((s) => s.materialId)).size,
    totalValue: stocks.reduce((sum, s) => sum + s.quantity, 0),
    lowStockCount: 0,
  };

  const categorized = new Map<string, any[]>();
  for (const s of stocks) {
    const cat = s.material.category;
    if (!categorized.has(cat)) categorized.set(cat, []);
    categorized.get(cat)!.push({
      ...s,
      availableQty: s.quantity - s.reservedQty,
      isLow: s.material.safetyStock > 0 && s.quantity <= s.material.safetyStock,
    });
    if (s.material.safetyStock > 0 && s.quantity <= s.material.safetyStock) summary.lowStockCount++;
  }

  return {
    summary,
    stocks: stocks.map((s) => ({
      ...s,
      availableQty: s.quantity - s.reservedQty,
      isLow: s.material.safetyStock > 0 && s.quantity <= s.material.safetyStock,
    })),
    byCategory: Object.fromEntries(categorized),
  };
}
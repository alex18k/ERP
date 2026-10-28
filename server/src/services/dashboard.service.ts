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
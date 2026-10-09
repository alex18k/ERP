import prisma from "../config/prisma";

export interface ReportQuery {
  from?: string;
  to?: string;
  groupBy?: "day" | "week" | "month";
}

type GroupBy = "day" | "week" | "month";

function parseRange(q: ReportQuery) {
  const groupBy: GroupBy = q.groupBy ?? "month";
  let from: Date | undefined;
  let to: Date | undefined;
  if (q.from) from = new Date(q.from);
  if (q.to) {
    to = new Date(q.to);
    to.setHours(23, 59, 59, 999);
  }
  return { from, to, groupBy };
}

const pad = (n: number) => String(n).padStart(2, "0");

function isoWeekNumber(d: Date) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function bucketKey(d: Date, groupBy: GroupBy): string {
  const y = d.getFullYear();
  if (groupBy === "day") return `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (groupBy === "week") return `${y}-W${pad(isoWeekNumber(d))}`;
  return `${y}-${pad(d.getMonth() + 1)}`;
}

function buildSeries(map: Map<string, number>): { period: string; value: number }[] {
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, value]) => ({ period, value: Math.round(value * 100) / 100 }));
}

const round = (n: number) => Math.round(n * 100) / 100;

// ===== 生产报表 =====
export async function getProductionReport(q: ReportQuery) {
  const { from, to, groupBy } = parseRange(q);

  const reports = await prisma.workReport.findMany({
    where: {
      reportTime: from || to ? { gte: from ?? undefined, lte: to ?? undefined } : undefined,
    },
    include: {
      reporter: { select: { id: true, realName: true } },
    },
    orderBy: { reportTime: "asc" },
  });

  // 工序名映射（processStepId → ProductionOrderStep）
  const stepIds = [...new Set(reports.map((r) => r.processStepId))];
  const stepMap = new Map<number, string>();
  if (stepIds.length) {
    const steps = await prisma.productionOrderStep.findMany({
      where: { id: { in: stepIds } },
      select: { id: true, code: true, name: true },
    });
    for (const s of steps) stepMap.set(s.id, `${s.code} ${s.name}`);
  }

  const outputByBucket = new Map<string, number>();
  const scrapByBucket = new Map<string, number>();
  const stepMap_rank = new Map<string, number>();
  const operatorMap = new Map<string, number>();

  let reportCount = reports.length;
  let outputQty = 0;
  let scrapQty = 0;

  for (const r of reports) {
    const key = bucketKey(r.reportTime, groupBy);
    outputByBucket.set(key, (outputByBucket.get(key) ?? 0) + r.quantity);
    scrapByBucket.set(key, (scrapByBucket.get(key) ?? 0) + r.scrapQty);
    outputQty += r.quantity;
    scrapQty += r.scrapQty;

    const stepName = stepMap.get(r.processStepId) ?? "未知工序";
    stepMap_rank.set(stepName, (stepMap_rank.get(stepName) ?? 0) + r.quantity);

    const reporterName = r.reporter?.realName ?? "未知";
    operatorMap.set(reporterName, (operatorMap.get(reporterName) ?? 0) + r.quantity);
  }

  const outputSeries = buildSeries(outputByBucket);
  const scrapSeries = buildSeries(scrapByBucket);
  const yieldSeries = outputSeries.map((p) => {
    const scrap = scrapByBucket.get(p.period) ?? 0;
    return { period: p.period, value: p.value > 0 ? round(((p.value - scrap) / p.value) * 100) : 100 };
  });

  const statusRank = (map: Map<string, number>, top = 10) =>
    [...map.entries()]
      .map(([name, value]) => ({ name, value: round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, top);

  return {
    summary: {
      reportCount,
      outputQty: round(outputQty),
      scrapQty: round(scrapQty),
      yieldRate: outputQty > 0 ? round(((outputQty - scrapQty) / outputQty) * 100) : 100,
    },
    outputSeries,
    scrapSeries,
    yieldSeries,
    processStepRank: statusRank(stepMap_rank),
    operatorRank: statusRank(operatorMap),
  };
}

// ===== 销售与交期报表 =====
export async function getSalesReport(q: ReportQuery) {
  const { from, to, groupBy } = parseRange(q);
  const createdFilter = from || to ? { gte: from ?? undefined, lte: to ?? undefined } : undefined;

  const orders = await prisma.salesOrder.findMany({
    where: { createdAt: createdFilter },
    select: { id: true, customerName: true, totalAmount: true, deliveryDate: true, status: true, createdAt: true },
  });

  const today = new Date();
  const activeStatuses = ["draft", "confirmed", "in_production"];
  const doneStatuses = ["completed", "shipped"];

  const amountByBucket = new Map<string, number>();
  const customerMap = new Map<string, number>();
  const statusDist = new Map<string, number>();

  let totalAmount = 0;
  let completedCount = 0;
  let overdueCount = 0;

  for (const o of orders) {
    if (o.status !== "cancelled") {
      totalAmount += o.totalAmount ?? 0;
      const key = bucketKey(o.createdAt, groupBy);
      amountByBucket.set(key, (amountByBucket.get(key) ?? 0) + (o.totalAmount ?? 0));
      customerMap.set(o.customerName, (customerMap.get(o.customerName) ?? 0) + (o.totalAmount ?? 0));
    }
    if (doneStatuses.includes(o.status)) completedCount++;
    if (o.deliveryDate && o.deliveryDate < today && activeStatuses.includes(o.status)) overdueCount++;
    statusDist.set(o.status, (statusDist.get(o.status) ?? 0) + 1);
  }

  // 准时交付率（与管理驾驶舱相同算法，限定范围内）
  const doneOrderIds = orders.filter((o) => doneStatuses.includes(o.status)).map((o) => o.id);
  const doneProd = await prisma.productionOrder.findMany({
    where: { status: "completed", actualEndDate: { not: null }, salesOrderId: { in: doneOrderIds } },
    select: { salesOrderId: true, actualEndDate: true },
  });
  const dueMap = new Map(orders.filter((o) => o.deliveryDate).map((o) => [o.id, o.deliveryDate]));
  const lateSet = new Set<number>();
  const onTimeCountByBucket = new Map<string, number>();
  const lateCountByBucket = new Map<string, number>();
  for (const p of doneProd) {
    const due = dueMap.get(p.salesOrderId!);
    if (!due || !p.actualEndDate) continue;
    const key = bucketKey(p.actualEndDate, groupBy);
    if (p.actualEndDate > due) {
      lateSet.add(p.salesOrderId!);
      lateCountByBucket.set(key, (lateCountByBucket.get(key) ?? 0) + 1);
    } else {
      onTimeCountByBucket.set(key, (onTimeCountByBucket.get(key) ?? 0) + 1);
    }
  }

  const onTimeRateTrend = [...new Set([...onTimeCountByBucket.keys(), ...lateCountByBucket.keys()])]
    .sort((a, b) => a.localeCompare(b))
    .map((period) => {
      const good = onTimeCountByBucket.get(period) ?? 0;
      const bad = lateCountByBucket.get(period) ?? 0;
      const total = good + bad;
      return { period, value: total > 0 ? round((good / total) * 100) : 100 };
    });

  return {
    summary: {
      totalAmount: round(totalAmount),
      orderCount: orders.length,
      completedCount,
      completedRate: orders.length > 0 ? round((completedCount / orders.length) * 100) : 0,
      overdueCount,
      onTimeRate: doneProd.length > 0 ? round(((doneProd.length - lateSet.size) / doneProd.length) * 100) : 100,
    },
    amountSeries: buildSeries(amountByBucket),
    onTimeRateTrend,
    customerRank: [...customerMap.entries()]
      .map(([name, value]) => ({ name, value: round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    statusDist: [...statusDist.entries()].map(([status, count]) => ({ status, count })),
  };
}

// ===== 采购报表 =====
export async function getPurchaseReport(q: ReportQuery) {
  const { from, to, groupBy } = parseRange(q);
  const dateFilter = from || to ? { gte: from ?? undefined, lte: to ?? undefined } : undefined;

  const orders = await prisma.purchaseOrder.findMany({
    where: { orderDate: dateFilter },
    include: {
      supplier: { select: { id: true, name: true } },
      items: { select: { id: true, expectedDate: true, receivedQty: true } },
    },
    orderBy: { orderDate: "asc" },
  });

  const amountByBucket = new Map<string, number>();
  const supplierMap = new Map<string, number>();

  let totalAmount = 0;
  let orderCount = 0;
  let inTransitAmount = 0;

  for (const o of orders) {
    if (o.status !== "confirmed") continue;
    orderCount++;
    totalAmount += o.totalAmount ?? 0;
    inTransitAmount += o.totalAmount ?? 0;
    const key = bucketKey(o.orderDate ?? o.createdAt, groupBy);
    amountByBucket.set(key, (amountByBucket.get(key) ?? 0) + (o.totalAmount ?? 0));
    supplierMap.set(o.supplier?.name ?? "未知", (supplierMap.get(o.supplier?.name ?? "未知") ?? 0) + (o.totalAmount ?? 0));
  }

  // 供应商到货准时率：以收货入库流水时间对比【明细行】的截止日期（有已收数量的明细订单）
  const receivedOrders = orders.filter((o) => (o.items || []).some((it) => it.receivedQty > 0));
  const supplierRateMap = new Map<string, { total: number; onTime: number }>();
  const rateBucketMap = new Map<string, { total: number; onTime: number }>();

  for (const o of receivedOrders) {
    const items = await prisma.purchaseOrderItem.findMany({
      where: { orderId: o.id, expectedDate: { not: null } },
      select: { materialId: true, expectedDate: true, receivedQty: true },
    });
    if (items.length === 0) continue;

    const stockRecords = await prisma.stockRecord.findMany({
      where: { relatedType: "PurchaseOrder", relatedId: o.id, type: "in" },
      select: { materialId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    for (const it of items) {
      if (!it.expectedDate || (it.receivedQty ?? 0) <= 0) continue;
      const rec = stockRecords.find((r) => r.materialId === it.materialId);
      if (!rec) continue;
      const expEnd = new Date(it.expectedDate);
      expEnd.setHours(23, 59, 59, 999);
      const isOnTime = rec.createdAt <= expEnd;
      const key = bucketKey(rec.createdAt, groupBy);
      const s = supplierRateMap.get(o.supplier?.name ?? "未知") ?? { total: 0, onTime: 0 };
      s.total++;
      if (isOnTime) s.onTime++;
      supplierRateMap.set(o.supplier?.name ?? "未知", s);
      const b = rateBucketMap.get(key) ?? { total: 0, onTime: 0 };
      b.total++;
      if (isOnTime) b.onTime++;
      rateBucketMap.set(key, b);
    }
  }

  const supplierRate = [...supplierRateMap.entries()].map(([name, v]) => ({
    name,
    total: v.total,
    onTime: v.onTime,
    rate: round((v.onTime / v.total) * 100),
  }));

  const arrivalRateTrend = [...rateBucketMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, v]) => ({ period, value: round((v.onTime / v.total) * 100) }));

  return {
    summary: {
      totalAmount: round(totalAmount),
      orderCount,
      inTransitAmount: round(inTransitAmount),
      receivedCount: receivedOrders.length,
    },
    amountSeries: buildSeries(amountByBucket),
    arrivalRateTrend,
    supplierRank: [...supplierMap.entries()]
      .map(([name, value]) => ({ name, value: round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    supplierRate: supplierRate.sort((a, b) => a.total - b.total).slice(0, 10),
  };
}

// ===== 库存报表 =====
export async function getInventoryReport(q: ReportQuery) {
  const { from, to, groupBy } = parseRange(q);

  const stocks = await prisma.stock.findMany({
    include: {
      material: { select: { id: true, code: true, name: true, category: true, unit: true, safetyStock: true } },
      warehouse: { select: { id: true, name: true } },
    },
    orderBy: { material: { code: "asc" } },
  });

  const inByBucket = new Map<string, number>();
  const outByBucket = new Map<string, number>();
  const records = await prisma.stockRecord.findMany({
    where: {
      type: { in: ["in", "out"] },
      createdAt: from || to ? { gte: from ?? undefined, lte: to ?? undefined } : undefined,
    },
    select: { type: true, quantity: true, createdAt: true },
  });
  for (const r of records) {
    const key = bucketKey(r.createdAt, groupBy);
    if (r.type === "in") inByBucket.set(key, (inByBucket.get(key) ?? 0) + r.quantity);
    else outByBucket.set(key, (outByBucket.get(key) ?? 0) + r.quantity);
  }

  // 按物料汇总（同一物料可能存在多个仓库/库位的库存行）
  const byMaterial = new Map<number, { material: (typeof stocks)[number]["material"]; qty: number; warehouses: string[] }>();
  for (const s of stocks) {
    const cur = byMaterial.get(s.materialId) ?? { material: s.material, qty: 0, warehouses: [] };
    cur.qty += s.quantity;
    if (s.quantity !== 0) cur.warehouses.push(s.warehouse.name);
    byMaterial.set(s.materialId, cur);
  }
  const materialAgg = [...byMaterial.values()];

  const lowStock = materialAgg
    .filter((x) => x.material.safetyStock > 0 && x.qty <= x.material.safetyStock)
    .map((x) => ({
      materialId: x.material.id,
      materialCode: x.material.code,
      materialName: x.material.name,
      category: x.material.category,
      warehouseName: x.warehouses.join("、"),
      quantity: x.qty,
      safetyStock: x.material.safetyStock,
      shortageQty: round(x.material.safetyStock - x.qty),
    }));

  const allPeriods = [...new Set([...inByBucket.keys(), ...outByBucket.keys()])].sort((a, b) => a.localeCompare(b));
  const inOutSeries = allPeriods.map((period) => ({
    period,
    in: Math.round(inByBucket.get(period) ?? 0),
    out: Math.round(outByBucket.get(period) ?? 0),
  }));

  const topStock = materialAgg
    .map((x) => ({ name: x.material.name, code: x.material.code, value: round(x.qty) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return {
    summary: {
      materialCount: materialAgg.length,
      totalQty: round(materialAgg.reduce((sum, x) => sum + x.qty, 0)),
      lowStockCount: lowStock.length,
    },
    inOutSeries,
    lowStock,
    topStock,
  };
}
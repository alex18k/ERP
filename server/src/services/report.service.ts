import prisma from "../config/prisma";
import { parseLocalDateStart, parseLocalDateEnd } from "../utils/date";

export interface ReportQuery {
  from?: string;
  to?: string;
  groupBy?: "day" | "week" | "month";
}

type GroupBy = "day" | "week" | "month";

// 查询参数校验错误：controller 据此返回 400 可读消息（其它错误一律脱敏为 500）
export class ReportQueryError extends Error {}

const REPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(value: unknown, label: string): string {
  const s = String(value ?? "");
  if (!REPORT_DATE_RE.test(s)) throw new ReportQueryError(`查询条件：${label}格式不正确（应为 YYYY-MM-DD）`);
  const [y, m, d] = s.split("-").map(Number);
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() + 1 !== m || probe.getDate() !== d) {
    throw new ReportQueryError(`查询条件：${label}不是有效日期`);
  }
  return s;
}

function parseRange(q: ReportQuery) {
  const groupBy: GroupBy = q.groupBy === "day" || q.groupBy === "week" ? q.groupBy : "month";
  let from: Date | undefined;
  let to: Date | undefined;
  if (q.from) from = parseLocalDateStart(checkDate(q.from, "开始日期"));
  if (q.to) to = parseLocalDateEnd(checkDate(q.to, "结束日期"));
  if (from && to && from.getTime() > to.getTime()) throw new ReportQueryError("查询条件：开始日期不能晚于结束日期");
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
    where: { execStatus: "completed", actualEndDate: { not: null }, salesOrderId: { in: doneOrderIds } },
    select: { salesOrderId: true, actualEndDate: true },
  });
  const dueMap = new Map(orders.filter((o) => o.deliveryDate).map((o) => [o.id, o.deliveryDate]));
  const onTimeCountByBucket = new Map<string, number>();
  const lateCountByBucket = new Map<string, number>();
  for (const p of doneProd) {
    const due = dueMap.get(p.salesOrderId!);
    if (!due || !p.actualEndDate) continue;
    const key = bucketKey(p.actualEndDate, groupBy);
    if (p.actualEndDate > due) {
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

  // 准时率与趋势使用同一分子/分母（生产订单完工次数），避免用销售订单 id 去减生产订单数
  const onTimeTotal = [...onTimeCountByBucket.values()].reduce((s, v) => s + v, 0);
  const lateTotal = [...lateCountByBucket.values()].reduce((s, v) => s + v, 0);

  return {
    summary: {
      totalAmount: round(totalAmount),
      orderCount: orders.length,
      completedCount,
      completedRate: orders.length > 0 ? round((completedCount / orders.length) * 100) : 0,
      overdueCount,
      onTimeRate: onTimeTotal + lateTotal > 0 ? round((onTimeTotal / (onTimeTotal + lateTotal)) * 100) : 100,
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
      items: {
        select: {
          id: true,
          line: true,
          materialId: true,
          quantity: true,
          unitPrice: true,
          status: true,
          expectedDate: true,
          receivedQty: true,
        },
      },
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
    // 在途金额只统计仍可收货的明细（空白状态且未收完）的剩余金额
    for (const it of o.items) {
      if ((it.status ?? "") !== "") continue;
      const remaining = Number(it.quantity ?? 0) - Number(it.receivedQty ?? 0);
      if (remaining > 1e-6) inTransitAmount += remaining * Number(it.unitPrice ?? 0);
    }
    const key = bucketKey(o.orderDate ?? o.createdAt, groupBy);
    amountByBucket.set(key, (amountByBucket.get(key) ?? 0) + (o.totalAmount ?? 0));
    supplierMap.set(o.supplier?.name ?? "未知", (supplierMap.get(o.supplier?.name ?? "未知") ?? 0) + (o.totalAmount ?? 0));
  }

  // 供应商到货准时率：以收货入库流水时间对比【明细行】的截止日期（有已收数量的明细订单）
  const receivedOrders = orders.filter((o) => (o.items || []).some((it) => it.receivedQty > 0));
  const supplierRateMap = new Map<string, { total: number; onTime: number }>();
  const rateBucketMap = new Map<string, { total: number; onTime: number }>();

  // 一次性加载所有收货流水，避免逐订单查询造成 N+1
  const receivedOrderIds = receivedOrders.map((o) => o.id);
  const allReceiptRecords = receivedOrderIds.length
    ? await prisma.stockRecord.findMany({
        where: { relatedType: "PurchaseOrder", relatedId: { in: receivedOrderIds }, type: "in" },
        select: { relatedId: true, materialId: true, lineNo: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const receiptsByOrder = new Map<number, typeof allReceiptRecords>();
  for (const r of allReceiptRecords) {
    if (!r.relatedId) continue;
    if (!receiptsByOrder.has(r.relatedId)) receiptsByOrder.set(r.relatedId, []);
    receiptsByOrder.get(r.relatedId)!.push(r);
  }

  for (const o of receivedOrders) {
    const items = (o.items || []).filter((it) => it.expectedDate && (it.receivedQty ?? 0) > 0);
    if (items.length === 0) continue;

    const stockRecords = receiptsByOrder.get(o.id) ?? [];

    for (const it of items) {
      // 优先按行号+物料匹配，避免同一物料多行时取错收货流水
      const rec =
        stockRecords.find((r) => r.lineNo === it.line && r.materialId === it.materialId) ??
        stockRecords.find((r) => r.materialId === it.materialId);
      if (!rec) continue;
      const expEnd = new Date(it.expectedDate as Date);
      expEnd.setHours(23, 59, 59, 999);
      const recAt = rec.createdAt ?? new Date();
      const isOnTime = recAt <= expEnd;
      const key = bucketKey(recAt, groupBy);
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
    supplierRate: supplierRate.sort((a, b) => b.rate - a.rate || b.total - a.total).slice(0, 10),
  };
}

// ===== 库存报表 =====
export async function getInventoryReport(q: ReportQuery) {
  const { from, to, groupBy } = parseRange(q);

  // 与库存预警/明细查询口径一致：低库存只看启用仓库的库存
  const stocks = await prisma.stock.findMany({
    where: { warehouse: { status: 1 } },
    include: {
      material: { select: { id: true, code: true, name: true, category: true, unit: true, safetyStock: true } },
      warehouse: { select: { id: true, name: true } },
    },
    orderBy: { material: { code: "asc" } },
  });

  const inByBucket = new Map<string, number>();
  const outByBucket = new Map<string, number>();
  // 流水日期口径与库存事务列表一致：优先 effectiveDate，未填写时回退 createdAt
  const records = await prisma.stockRecord.findMany({
    where: {
      type: { in: ["in", "out"] },
      ...(from || to
        ? {
            OR: [
              { effectiveDate: { gte: from ?? undefined, lte: to ?? undefined } },
              { effectiveDate: null, createdAt: { gte: from ?? undefined, lte: to ?? undefined } },
            ],
          }
        : {}),
    },
    select: { type: true, quantity: true, createdAt: true, effectiveDate: true },
  });
  for (const r of records) {
    const key = bucketKey(r.effectiveDate ?? r.createdAt, groupBy);
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
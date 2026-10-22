import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact, parseLocalDateStart, parseLocalDateEnd } from "../utils/date";
import { resolveUnitRate, toBaseQty } from "../utils/unit";
import { lockOrderNo, ORDER_NO_LOCK } from "../utils/retry";
import { buildSqlQueryFilters, parseQueryConditions, type SqlQueryFieldDefinition } from "../utils/queryConditions";

// 生成单据号：前缀+日期+序号（调用方需先持有库存单据号的 advisory lock，避免并发重复）
export async function generateDocNo(client: any = prisma, prefix = "ST"): Promise<string> {
  const dateStr = localDateCompact();
  const fullPrefix = `${String(prefix || "ST").trim().toUpperCase()}${dateStr}`;
  const existing = await client.stockRecord.findMany({
    where: { documentNo: { startsWith: fullPrefix } },
    select: { documentNo: true },
  });
  let max = 0;
  for (const e of existing) {
    const n = parseInt((e.documentNo ?? "").slice(fullPrefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `${fullPrefix}${String(max + 1).padStart(4, "0")}`;
}

export async function generateStockDocNo(client: any = prisma): Promise<string> {
  return generateDocNo(client, "ST");
}

// 手工出入库必须指定启用的事务类型，且方向必须与本次操作一致
async function resolveManualTransactionType(transactionTypeId: number | undefined, expected: "in" | "out") {
  if (!transactionTypeId) throw new Error("请选择事务类型");
  const type = await prisma.stockTransactionType.findUnique({ where: { id: Number(transactionTypeId) } });
  if (!type) throw new Error("事务类型不存在");
  if (type.status !== 1) throw new Error(`事务类型「${type.description}」已停用`);
  if (type.direction !== expected) {
    throw new Error(`事务类型「${type.description}」方向为${type.direction === "in" ? "入库" : "出库"}，与本次操作不一致`);
  }
  return type;
}

function typeDocPrefix(type: { documentPrefix: string | null }, fallback = "ST") {
  return String(type.documentPrefix ?? "").trim().toUpperCase() || fallback;
}

// 源单号对应的销售订单销售员快照（非销售订单号返回 null）
async function salespersonByOrderNo(orderNo?: string | null) {
  const no = String(orderNo ?? "").trim();
  if (!no) return null;
  const order = await prisma.salesOrder.findUnique({
    where: { orderNo: no },
    select: { seller1: true, seller2: true },
  });
  return [order?.seller1, order?.seller2].filter(Boolean).join("、") || null;
}

function buildStockFilters(where: any) {
  const { materialId, materialCode, materialName, warehouseId, binId } = where;
  const filters: any = { quantity: { gt: 0 } };
  if (materialId) filters.materialId = Number(materialId);
  if (materialCode || materialName) {
    filters.material = {
      ...(materialCode && { code: { contains: materialCode } }),
      ...(materialName && { OR: [{ name: { contains: materialName } }, { specification: { contains: materialName } }] }),
    };
  }
  if (warehouseId) filters.warehouseId = Number(warehouseId);
  if (binId !== undefined && binId !== "" && binId !== null) filters.binId = Number(binId);
  return filters;
}

// 物料全仓现存量合计：安全库存是物料级口径，判断“低于安全库存”必须跨仓库汇总，
// 与 getStockAlerts 保持一致（不能拿单个仓库的数量去比全局安全库存）。
async function materialStockTotals(materialIds: number[]) {
  if (materialIds.length === 0) return new Map<number, number>();
  const grouped = await prisma.stock.groupBy({
    by: ["materialId"],
    where: { materialId: { in: materialIds }, warehouse: { status: 1 } },
    _sum: { quantity: true },
  });
  return new Map(grouped.map((g) => [g.materialId, g._sum.quantity ?? 0]));
}

function clampPage(page: any, pageSize: any) {
  const pageNum = Math.max(1, Number(page) || 1);
  const sizeNum = Math.min(1000, Math.max(1, Number(pageSize) || 20));
  return { pageNum, sizeNum, offset: (pageNum - 1) * sizeNum };
}

function escapeLike(value: any) {
  return String(value ?? "").replace(/[\\%_]/g, (c) => `\\${c}`);
}

// SQL 过滤条件（使用 s/m 别名），供明细/分组的数据库分页复用
function buildStockSqlParts(where: any): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [Prisma.sql`s.quantity > 0`];
  if (where.materialCode) {
    parts.push(Prisma.sql`m.code LIKE ${`%${escapeLike(where.materialCode)}%`}`);
  }
  if (where.materialName) {
    const pattern = `%${escapeLike(where.materialName)}%`;
    parts.push(Prisma.sql`(m.name LIKE ${pattern} OR m.specification LIKE ${pattern})`);
  }
  if (where.warehouseId !== undefined && where.warehouseId !== "" && where.warehouseId !== null) {
    const id = Number(where.warehouseId);
    if (Number.isFinite(id)) parts.push(Prisma.sql`s."warehouseId" = ${id}`);
  }
  if (where.binId !== undefined && where.binId !== "" && where.binId !== null) {
    const id = Number(where.binId);
    if (Number.isFinite(id)) parts.push(Prisma.sql`s."binId" = ${id}`);
  }
  return parts;
}

const STOCK_SUMMARY_STATUS_SQL = `CASE WHEN m."safetyStock" > 0 AND COALESCE((SELECT SUM(sq.quantity) FROM "Stock" sq JOIN "Warehouse" sw ON sw.id = sq."warehouseId" WHERE sq."materialId" = m.id AND sw.status = 1), 0) <= m."safetyStock" THEN 'low' ELSE 'normal' END`;

const stockSummaryQueryFields: Record<string, SqlQueryFieldDefinition> = {
  materialCode: { type: "text", whereSql: "m.code" },
  materialName: { type: "text", whereSql: "m.name" },
  specification: { type: "text", whereSql: "m.specification" },
  category: {
    type: "enum",
    whereSql: "m.category",
    options: [
      { label: "采购", value: "purchase" },
      { label: "制造", value: "manufacture" },
    ],
  },
  warehouseName: { type: "text", whereSql: "w.name" },
  quantity: { type: "number", havingSql: "SUM(s.quantity)" },
  availableQty: { type: "number", havingSql: "SUM(s.quantity - s.reservedQty)" },
  unit: { type: "text", whereSql: "m.unit" },
  safetyStock: { type: "number", whereSql: 'm."safetyStock"' },
  status: {
    type: "enum",
    whereSql: STOCK_SUMMARY_STATUS_SQL,
    options: [
      { label: "低于安全库存", value: "low" },
      { label: "正常", value: "normal" },
    ],
  },
};

function buildStockSummaryAdvancedFilters(where: any): { whereParts: Prisma.Sql[]; havingParts: Prisma.Sql[] } {
  const conditions = parseQueryConditions(where.conditions);
  return buildSqlQueryFilters(conditions, stockSummaryQueryFields);
}

// 明细台账按「库存行」过滤：数量/可用量为单行值，全部走 WHERE，无聚合条件
const stockDetailQueryFields: Record<string, SqlQueryFieldDefinition> = {
  materialCode: { type: "text", whereSql: "m.code" },
  materialName: { type: "text", whereSql: "m.name" },
  specification: { type: "text", whereSql: "m.specification" },
  category: {
    type: "enum",
    whereSql: "m.category",
    options: [
      { label: "采购", value: "purchase" },
      { label: "制造", value: "manufacture" },
    ],
  },
  warehouseName: { type: "text", whereSql: "w.name" },
  quantity: { type: "number", whereSql: "s.quantity" },
  availableQty: { type: "number", whereSql: '(s.quantity - s."reservedQty")' },
  unit: { type: "text", whereSql: "m.unit" },
  safetyStock: { type: "number", whereSql: 'm."safetyStock"' },
  status: {
    type: "enum",
    whereSql: STOCK_SUMMARY_STATUS_SQL,
    options: [
      { label: "低于安全库存", value: "low" },
      { label: "正常", value: "normal" },
    ],
  },
};

function buildStockDetailAdvancedFilters(where: any): Prisma.Sql[] {
  const conditions = parseQueryConditions(where.conditions);
  const { whereParts, havingParts } = buildSqlQueryFilters(conditions, stockDetailQueryFields);
  if (havingParts.length) throw new Error("查询条件：库存明细不支持聚合过滤");
  return whereParts;
}

// 按 id 批量加载库存行，并附带物料/仓库/货位/批次与低库存标记（顺序按传入 id）
async function loadStockRowsByIds(ids: number[]) {
  if (ids.length === 0) return [];
  const items = await prisma.stock.findMany({
    where: { id: { in: ids } },
    include: {
      material: { select: { id: true, code: true, name: true, specification: true, category: true, unit: true, safetyStock: true } },
      warehouse: { select: { id: true, code: true, name: true, binManaged: true } },
      bin: { select: { id: true, code: true, name: true } },
    },
  });

  const batchRows = await prisma.materialBatch.findMany({
    where: { materialId: { in: [...new Set(items.map((s) => s.materialId))] }, warehouseId: { in: [...new Set(items.map((s) => s.warehouseId))] } },
    orderBy: { batchNo: "asc" },
  });
  const batchByKey = new Map<string, { batchNo: string; quantity: number }[]>();
  for (const b of batchRows) {
    const key = `${b.materialId}|${b.warehouseId}|${b.binId ?? ""}`;
    if (!batchByKey.has(key)) batchByKey.set(key, []);
    batchByKey.get(key)!.push({ batchNo: b.batchNo, quantity: b.quantity });
  }

  const totals = await materialStockTotals([...new Set(items.map((s) => s.materialId))]);
  const enriched = items.map((s) => ({
    ...s,
    availableQty: s.quantity - s.reservedQty,
    isLow: s.material.safetyStock > 0 && (totals.get(s.materialId) ?? 0) <= s.material.safetyStock,
    batches: batchByKey.get(`${s.materialId}|${s.warehouseId}|${s.binId ?? ""}`) ?? [],
  }));
  const byId = new Map(enriched.map((s) => [s.id, s]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as any[];
}

// 明细分页的“每个库存行会产生几行展示”CTE（批号行 + 未分批余量行）
function buildDetailRowCountCte(filters: Prisma.Sql) {
  return Prisma.sql`
    SELECT s.id, m.code, s."warehouseId", s."binId",
      (COALESCE(b.batch_count, 0) + CASE
        WHEN COALESCE(b.batch_count, 0) = 0 OR s.quantity - COALESCE(b.batch_sum, 0) > 1e-6 THEN 1
        ELSE 0
      END)::int AS cnt
    FROM "Stock" s
    JOIN "Material" m ON m.id = s."materialId"
    JOIN "Warehouse" w ON w.id = s."warehouseId"
    LEFT JOIN (
      SELECT "materialId", "warehouseId", "binId",
        COUNT(*)::int AS batch_count,
        SUM(quantity) AS batch_sum
      FROM "MaterialBatch"
      WHERE quantity > 0
      GROUP BY "materialId", "warehouseId", "binId"
    ) b ON b."materialId" = s."materialId"
       AND b."warehouseId" = s."warehouseId"
       AND b."binId" IS NOT DISTINCT FROM s."binId"
    WHERE s.quantity > 0 ${filters}
  `;
}

// 库存明细台账：SQL 级分页（按批号平铺后计算累计行号），避免全量加载
export async function listStockDetail(where: any) {
  const { pageNum, sizeNum, offset } = clampPage(where.page, where.pageSize);
  const whereParts = [...buildStockSqlParts(where), ...buildStockDetailAdvancedFilters(where)];
  const filters = Prisma.sql`AND ${Prisma.join(whereParts, " AND ")}`;
  const cte = buildDetailRowCountCte(filters);

  const countRows = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
    WITH row_counts AS (${cte})
    SELECT COALESCE(SUM(cnt), 0)::int AS total FROM row_counts
  `);
  const total = Number(countRows[0]?.total ?? 0);

  const pageRows = await prisma.$queryRaw<{ id: number; cum_start: number }[]>(Prisma.sql`
    WITH row_counts AS (${cte}),
    cum AS (
      SELECT id, cnt,
        (SUM(cnt) OVER (ORDER BY code, "warehouseId", "binId" NULLS LAST, id) - cnt)::int AS cum_start,
        (SUM(cnt) OVER (ORDER BY code, "warehouseId", "binId" NULLS LAST, id))::int AS cum_end
      FROM row_counts
    )
    SELECT id, cum_start FROM cum
    WHERE cum_end > ${offset} AND cum_start < ${offset + sizeNum}
    ORDER BY cum_start, id
  `);

  if (pageRows.length === 0) return { total, page: pageNum, pageSize: sizeNum, items: [] };

  const rows = await loadStockRowsByIds(pageRows.map((r) => Number(r.id)));
  const flat: any[] = [];
  for (const s of rows) {
    const batches = (s.batches || []).filter((b: any) => Number(b.quantity) > 0);
    let batchSum = 0;
    for (const b of batches) {
      batchSum += Number(b.quantity) || 0;
      flat.push({ ...s, batches: undefined, batchNo: b.batchNo, batchQty: b.quantity });
    }
    const remainder = Number(s.quantity || 0) - batchSum;
    if (batches.length === 0 || remainder > 1e-6) {
      flat.push({ ...s, batches: undefined, batchNo: "", batchQty: remainder });
    }
  }

  const localStart = offset - Number(pageRows[0].cum_start);
  return { total, page: pageNum, pageSize: sizeNum, items: flat.slice(localStart, localStart + sizeNum) };
}

// 库存查询：按「仓库 × 物料」分组，SQL 级分页后再加载当前页的分组明细
export async function listStockSummary(where: any) {
  const { pageNum, sizeNum, offset } = clampPage(where.page, where.pageSize);
  const advancedFilters = buildStockSummaryAdvancedFilters(where);
  const whereParts = [...buildStockSqlParts(where), ...advancedFilters.whereParts];
  const filters = Prisma.sql`AND ${Prisma.join(whereParts, " AND ")}`;
  const having = advancedFilters.havingParts.length
    ? Prisma.sql`HAVING ${Prisma.join(advancedFilters.havingParts, " AND ")}`
    : Prisma.empty;
  const groupSelect = Prisma.sql`
    SELECT s."warehouseId", s."materialId", w.name AS "warehouseName", m.code AS "materialCode"
    FROM "Stock" s
    JOIN "Material" m ON m.id = s."materialId"
    JOIN "Warehouse" w ON w.id = s."warehouseId"
    WHERE s.quantity > 0 ${filters}
    GROUP BY s."warehouseId", s."materialId", w.name, m.code
    ${having}
  `;

  const countRows = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS total FROM (${groupSelect}) t
  `);
  const total = Number(countRows[0]?.total ?? 0);

  const groupRows = await prisma.$queryRaw<{ warehouseId: number; materialId: number }[]>(
    Prisma.sql`${groupSelect} ORDER BY "warehouseName" ASC, "materialCode" ASC, "warehouseId" ASC, "materialId" ASC LIMIT ${sizeNum} OFFSET ${offset}`,
  );

  if (groupRows.length === 0) return { total, page: pageNum, pageSize: sizeNum, items: [] };

  const keys = new Set(groupRows.map((g) => `${Number(g.warehouseId)}|${Number(g.materialId)}`));
  const binFilter = where.binId !== undefined && where.binId !== "" && where.binId !== null ? Number(where.binId) : null;
  const idRows = await prisma.stock.findMany({
    where: {
      quantity: { gt: 0 },
      warehouseId: { in: [...new Set(groupRows.map((g) => Number(g.warehouseId)))] },
      materialId: { in: [...new Set(groupRows.map((g) => Number(g.materialId)))] },
      ...(binFilter !== null && Number.isFinite(binFilter) ? { binId: binFilter } : {}),
    },
    select: { id: true, warehouseId: true, materialId: true },
  });
  const ids = idRows.filter((s) => keys.has(`${s.warehouseId}|${s.materialId}`)).map((s) => s.id);
  const rows = await loadStockRowsByIds(ids);

  const map = new Map<string, any>();
  for (const s of rows) {
    const key = `${s.warehouseId}|${s.materialId}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        material: s.material,
        warehouse: s.warehouse,
        quantity: 0,
        availableQty: 0,
        reservedQty: 0,
        safetyStock: s.material.safetyStock ?? 0,
        children: [] as any[],
      };
      map.set(key, g);
    }
    g.quantity += Number(s.quantity) || 0;
    g.availableQty += Number(s.availableQty) || 0;
    g.reservedQty += Number(s.reservedQty) || 0;
    const batches = (s.batches || []).filter((b: any) => Number(b.quantity) > 0);
    g.children.push({
      index: 0,
      binLabel: s.bin ? `${s.bin.code} - ${s.bin.name}` : "未分配货位",
      batchLabel: batches.length ? batches.map((b: any) => `${b.batchNo}（${b.quantity}）`).join("，") : "-",
      hasDetail: !!s.bin || batches.length > 0,
      quantity: Number(s.quantity) || 0,
      availableQty: Number(s.availableQty) || 0,
    });
  }

  const totals = await materialStockTotals([...new Set(rows.map((s) => s.materialId))]);
  const groups = groupRows
    .map((g) => map.get(`${Number(g.warehouseId)}|${Number(g.materialId)}`))
    .filter(Boolean)
    .map((g: any) => {
      g.isLow = g.safetyStock > 0 && (totals.get(g.material.id) ?? 0) <= g.safetyStock;
      g.children.sort((a: any, b: any) => a.binLabel.localeCompare(b.binLabel));
      g.children.forEach((c: any, i: number) => (c.index = i + 1));
      if (!g.children.some((c: any) => c.hasDetail)) delete g.children;
      return g;
    });

  return { total, page: pageNum, pageSize: sizeNum, items: groups };
}

export async function listStocks(where: any) {
  const { page = 1, pageSize = 20 } = where;
  const pageNum = Math.max(1, Number(page) || 1);
  const sizeNum = Math.min(1000, Math.max(1, Number(pageSize) || 20));
  const filters = buildStockFilters(where);

  const [total, items] = await Promise.all([
    prisma.stock.count({ where: filters }),
    prisma.stock.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, specification: true, category: true, unit: true, safetyStock: true } },
        warehouse: { select: { id: true, code: true, name: true, binManaged: true } },
        bin: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ material: { code: "asc" } }, { warehouseId: "asc" }, { binId: "asc" }],
      skip: (pageNum - 1) * sizeNum,
      take: sizeNum,
    }),
  ]);

  const batchRows = items.length > 0
    ? await prisma.materialBatch.findMany({
        where: { materialId: { in: [...new Set(items.map((s) => s.materialId))] }, warehouseId: { in: [...new Set(items.map((s) => s.warehouseId))] } },
        orderBy: { batchNo: "asc" },
      })
    : [];
  const batchByKey = new Map<string, { batchNo: string; quantity: number }[]>();
  for (const b of batchRows) {
    const key = `${b.materialId}|${b.warehouseId}|${b.binId ?? ""}`;
    if (!batchByKey.has(key)) batchByKey.set(key, []);
    batchByKey.get(key)!.push({ batchNo: b.batchNo, quantity: b.quantity });
  }
  const totals = await materialStockTotals([...new Set(items.map((s) => s.materialId))]);

  return {
    total,
    page: pageNum,
    pageSize: sizeNum,
    items: items.map((s) => ({
      ...s,
      availableQty: s.quantity - s.reservedQty,
      isLow: s.material.safetyStock > 0 && (totals.get(s.materialId) ?? 0) <= s.material.safetyStock,
      batches: batchByKey.get(`${s.materialId}|${s.warehouseId}|${s.binId ?? ""}`) ?? [],
    })),
  };
}

export async function listStockRecords(where: any) {
  const { materialId, materialKeyword, warehouseId, type, direction, transactionTypeId, transactionTypeIds, address, startDate, endDate, documentNo, page = 1, pageSize = 20 } = where;

  const filters: any = {};
  const mid = Number(materialId);
  if (materialId && !Number.isNaN(mid)) filters.materialId = mid;
  if (materialKeyword) {
    filters.material = {
      OR: [{ code: { contains: materialKeyword } }, { name: { contains: materialKeyword } }],
    };
  }
  if (warehouseId) filters.warehouseId = Number(warehouseId);
  if (address) filters.address = { contains: String(address).trim() };
  if (type) filters.type = type;
  if (direction) filters.transactionType = { direction };
  if (transactionTypeId) filters.transactionTypeId = Number(transactionTypeId);
  if (transactionTypeIds) {
    const ids = String(transactionTypeIds)
      .split(",")
      .map((v) => Number(v))
      .filter((v) => !Number.isNaN(v));
    if (ids.length) filters.transactionTypeId = { in: ids };
  }
  const and: any[] = [];
  if (documentNo) {
    and.push({ OR: [{ documentNo: { contains: documentNo } }, { orderNo: { contains: documentNo } }] });
  }
  if (startDate || endDate) {
    const range = {
      gte: startDate ? parseLocalDateStart(startDate) : undefined,
      lte: endDate ? parseLocalDateEnd(endDate) : undefined,
    };
    // 页面展示生效日期，优先按生效日期筛选；无生效日期的历史流水回退创建时间
    and.push({ OR: [{ effectiveDate: range }, { effectiveDate: null, createdAt: range }] });
  }
  if (and.length > 0) filters.AND = and;
  const pageNum = Math.max(1, Number(page) || 1);
  const sizeNum = Math.min(1000, Math.max(1, Number(pageSize) || 20));

  const [total, items] = await Promise.all([
    prisma.stockRecord.count({ where: filters }),
    prisma.stockRecord.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, specification: true, packageType: true, brand: true, remark: true, unit: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        bin: { select: { id: true, code: true, name: true } },
        operator: { select: { id: true, realName: true } },
        department: { select: { id: true, code: true, name: true } },
        transactionType: { select: { id: true, code: true, description: true, direction: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * sizeNum,
      take: sizeNum,
    }),
  ]);

  return { total, page: pageNum, pageSize: sizeNum, items };
}

// 按单号取整张库存事务单据（精确匹配），供打印使用
export async function listStockRecordsByDocument(documentNo: string) {
  const no = String(documentNo ?? "").trim();
  if (!no) throw new Error("请提供单号");
  const items = await prisma.stockRecord.findMany({
    where: { documentNo: no },
    include: {
      material: { select: { id: true, code: true, name: true, specification: true, brand: true, unit: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      bin: { select: { id: true, code: true, name: true } },
      operator: { select: { id: true, realName: true, username: true } },
      department: { select: { id: true, code: true, name: true } },
      transactionType: { select: { id: true, code: true, description: true, direction: true } },
      company: { select: { id: true, nameZh: true, nameEn: true, address: true, phone: true, fax: true, email: true, contact: true, website: true } },
    },
    orderBy: [{ lineNo: "asc" }, { id: "asc" }],
  });
  return { documentNo: no, items };
}

// 编辑整张库存事务单据（销售出库维护）：仅允许修改表头字段（随单各行统一覆盖）与各行备注；
// 物料/仓库/货位/批号/数量/单价等库存相关字段一律不可改
export async function updateStockDocument(
  documentNo: string,
  data: {
    effectiveDate?: string | null;
    orderNo?: string | null;
    departmentId?: number | null;
    handler?: string | null;
    salesperson?: string | null;
    keeper?: string | null;
    approver?: string | null;
    mainRemark?: string | null;
    deliveryNo?: string | null;
    contractNo?: string | null;
    address?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    companyId?: number | null;
    items?: { id: number; remark?: string }[];
  },
) {
  const no = String(documentNo ?? "").trim();
  if (!no) throw new Error("请提供单号");
  const rows = await prisma.stockRecord.findMany({ where: { documentNo: no }, select: { id: true } });
  if (rows.length === 0) throw new Error("单据不存在");

  const header: any = {};
  if (data.effectiveDate !== undefined) header.effectiveDate = data.effectiveDate ? new Date(data.effectiveDate) : null;
  if (data.orderNo !== undefined) header.orderNo = data.orderNo?.trim() || null;
  if (data.departmentId !== undefined) header.departmentId = data.departmentId ?? null;
  if (data.handler !== undefined) header.handler = data.handler?.trim() || null;
  if (data.salesperson !== undefined) header.salesperson = data.salesperson?.trim() || null;
  if (data.keeper !== undefined) header.keeper = data.keeper?.trim() || null;
  if (data.approver !== undefined) header.approver = data.approver?.trim() || null;
  if (data.mainRemark !== undefined) header.mainRemark = data.mainRemark?.trim() || null;
  if (data.deliveryNo !== undefined) header.deliveryNo = data.deliveryNo?.trim() || null;
  if (data.contractNo !== undefined) header.contractNo = data.contractNo?.trim() || null;
  if (data.address !== undefined) header.address = data.address?.trim() || null;
  if (data.contactName !== undefined) header.contactName = data.contactName?.trim() || null;
  if (data.contactPhone !== undefined) header.contactPhone = data.contactPhone?.trim() || null;
  if (data.companyId !== undefined) {
    if (data.companyId === null) header.companyId = null;
    else {
      const comp = await prisma.companyInfo.findUnique({ where: { id: Number(data.companyId) } });
      if (!comp) throw new Error("所属公司不存在");
      header.companyId = comp.id;
    }
  }

  const remarkItems = (data.items || []).filter((it) => Number.isInteger(it.id) && rows.some((r) => r.id === it.id));

  return prisma.$transaction(async (tx) => {
    if (Object.keys(header).length > 0) {
      await tx.stockRecord.updateMany({ where: { documentNo: no }, data: header });
    }
    for (const it of remarkItems) {
      await tx.stockRecord.update({ where: { id: it.id }, data: { remark: it.remark?.trim() || null } });
    }
    return { documentNo: no, headerUpdated: Object.keys(header).length > 0, remarkUpdated: remarkItems.length, total: rows.length };
  });
}

// 经手人/仓管员/审核人下拉：历史库存流水使用过的人员
export async function listStockHandlers(field: string = "handler") {
  const key = ["handler", "keeper", "approver"].includes(field) ? field : "handler";
  const rows = await prisma.stockRecord.findMany({
    where: { [key]: { not: null } },
    select: { handler: true, keeper: true, approver: true },
    distinct: [key] as any,
    orderBy: { [key]: "asc" } as any,
  });
  return rows.map((r: any) => r[key]).filter((h: any): h is string => !!h && h.trim() !== "");
}

// 车间/委外加工商下拉：ISS-WO(材料出库) / ISS-SUB(委外出库) 历史流水使用过的车间（去重）
export async function listStockHistoryWorkshops() {
  const types = await prisma.stockTransactionType.findMany({
    where: { code: { in: ["ISS-WO", "ISS-SUB"] } },
    select: { id: true },
  });
  const typeIds = types.map((t: any) => Number(t.id));
  if (typeIds.length === 0) return [];
  const rows = await prisma.stockRecord.findMany({
    where: { departmentId: { not: null }, transactionTypeId: { in: typeIds } },
    select: { departmentId: true },
    distinct: ["departmentId"],
    orderBy: { departmentId: "asc" },
  });
  const ids = rows.map((r: any) => Number(r.departmentId)).filter((id: number) => Number.isFinite(id));
  if (ids.length === 0) return [];
  return prisma.workshop.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, name: true, status: true },
    orderBy: { name: "asc" },
  });
}

// ===== 仓库/货位辅助 =====
// 校验仓库与货位：仓库必须存在且启用；启用货位管理的仓库必须指定有效货位，未启用则不允许指定货位。
// 返回规范化后的 binId（number 或 null）。所有库存事务入口都应经过这里。
export async function resolveBinId(
  tx: any,
  warehouse: { id: number; name: string; binManaged: boolean; status: number },
  binId?: number | string | null
): Promise<number | null> {
  if (warehouse.status !== 1) throw new Error(`仓库「${warehouse.name}」已停用，不能进行库存事务`);
  const bid = binId === undefined || binId === null || binId === "" ? null : Number(binId);
  if (warehouse.binManaged) {
    if (!bid) throw new Error(`仓库「${warehouse.name}」启用货位管理，请选择货位`);
    const bin = await tx.warehouseBin.findUnique({ where: { id: bid } });
    if (!bin || bin.warehouseId !== warehouse.id) throw new Error("货位不存在或不属于该仓库");
    if (bin.status !== 1) throw new Error(`货位「${bin.code}」已停用`);
    return bid;
  }
  if (bid) throw new Error(`仓库「${warehouse.name}」未启用货位管理，不能指定货位`);
  return null;
}

// 库存原子累加：按 (物料, 仓库, 货位) upsert（binId 为空时命中 NULLS NOT DISTINCT 唯一索引）
export async function addStock(tx: any, materialId: number, warehouseId: number, binId: number | null, qty: number) {
  await tx.$executeRaw`
    INSERT INTO "Stock" ("materialId","warehouseId","binId","quantity","lastInDate","createdAt","updatedAt")
    VALUES (${materialId}, ${warehouseId}, ${binId}, ${qty}, NOW(), NOW(), NOW())
    ON CONFLICT ("materialId","warehouseId","binId")
    DO UPDATE SET "quantity" = "Stock"."quantity" + EXCLUDED."quantity", "lastInDate" = NOW(), "updatedAt" = NOW()`;
}

// ===== 批号管理辅助 =====
// 入库：只要提供了批号就写入批次台账（非批号管理物料可选用批号，同样走批号管控逻辑）；
// 批号管理物料未提供批号则自动生成，非批号管理物料未提供批号则不记批次明细。
export async function applyBatchIn(
  tx: any,
  material: { id: number; code: string; batchManaged?: boolean },
  warehouseId: number,
  binId: number | null,
  batchNo: string | undefined,
  quantity: number
): Promise<string | null> {
  // 未提供批号且非批号管理物料：不记批次明细
  if (!material.batchManaged && !batchNo?.trim()) return null;
  const resolved = batchNo?.trim() ? batchNo.trim() : await generateBatchNo(tx, material);
  // upsert + 原子累加：并发下走数据库 ON CONFLICT，避免“读-改-写”丢失更新
  await tx.$executeRaw`
    INSERT INTO "MaterialBatch" ("materialId","warehouseId","binId","batchNo","quantity","createdAt","updatedAt")
    VALUES (${material.id}, ${warehouseId}, ${binId}, ${resolved}, ${quantity}, NOW(), NOW())
    ON CONFLICT ("materialId","warehouseId","binId","batchNo")
    DO UPDATE SET "quantity" = "MaterialBatch"."quantity" + EXCLUDED."quantity", "updatedAt" = NOW()`;
  return resolved;
}

// 出库批号预检（只读、不落库）：确定实际扣减批号并校验批次余量，规则与 applyBatchOut 完全一致；
// 供批量发料等“异常行跳过”场景在写入前先校验，避免事务中途抛错导致整单回滚。
export async function checkBatchOutAvailable(
  tx: any,
  material: { id: number; code: string; batchManaged?: boolean },
  warehouseId: number,
  binId: number | null,
  batchNo: string | undefined,
  quantity: number
): Promise<string | null> {
  if (!material.batchManaged && !batchNo?.trim()) {
    const batchStock = await tx.materialBatch.findFirst({
      where: { materialId: material.id, warehouseId, binId, quantity: { gt: 0 } },
      select: { batchNo: true },
    });
    if (batchStock) throw new Error(`物料 ${material.code} 该仓库货位存在批次库存，出库必须指定批号`);
    return null;
  }
  if (!batchNo?.trim()) throw new Error(`物料 ${material.code} 启用批号管理，出库必须指定批号`);
  const resolved = batchNo.trim();
  const existing = await tx.materialBatch.findFirst({
    where: { materialId: material.id, warehouseId, binId, batchNo: resolved },
  });
  if (!existing || existing.quantity + 1e-6 < quantity) {
    throw new Error(`物料 ${material.code} 批号 ${resolved} 库存不足（当前 ${existing?.quantity ?? 0}）`);
  }
  return resolved;
}

// 出库：提供了批号即按批次台账扣减并校验批次余量；批号管理物料必须指定批号，
// 非批号管理物料默认可选，但若该物料×仓库×货位仍存在批次库存，则也必须指定批号（保证批次台账与现存量一致）。
export async function applyBatchOut(
  tx: any,
  material: { id: number; code: string; batchManaged?: boolean },
  warehouseId: number,
  binId: number | null,
  batchNo: string | undefined,
  quantity: number
): Promise<string | null> {
  const resolved = await checkBatchOutAvailable(tx, material, warehouseId, binId, batchNo, quantity);
  if (resolved === null) return null;
  const existing = await tx.materialBatch.findFirst({
    where: { materialId: material.id, warehouseId, binId, batchNo: resolved },
  });
  if (!existing) {
    throw new Error(`物料 ${material.code} 批号 ${resolved} 库存不足（当前 0）`);
  }
  // 条件递减：WHERE 在写入时原子校验，防止并发下扣成负数
  const updated = await tx.materialBatch.updateMany({
    where: { id: existing.id, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  if (updated.count === 0) {
    const fresh = await tx.materialBatch.findUnique({ where: { id: existing.id } });
    throw new Error(`物料 ${material.code} 批号 ${resolved} 库存不足（当前 ${fresh?.quantity ?? 0}）`);
  }
  return resolved;
}

async function generateBatchNo(tx: any, material: { id: number; code: string }): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const prefix = `${material.code}-${ymd}-`;
  const rows = await tx.materialBatch.findMany({
    where: { materialId: material.id, batchNo: { startsWith: prefix } },
    select: { batchNo: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.batchNo.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export async function listBatches(where: any) {
  const { materialId, materialKeyword, warehouseId, binId, page = 1, pageSize = 20 } = where;
  const pageNum = Math.max(1, Number(page) || 1);
  const sizeNum = Math.min(1000, Math.max(1, Number(pageSize) || 20));
  const filters: any = { quantity: { gt: 0 } };
  if (materialId) filters.materialId = Number(materialId);
  if (materialKeyword) filters.material = { OR: [{ code: { contains: materialKeyword } }, { name: { contains: materialKeyword } }] };
  if (warehouseId) filters.warehouseId = Number(warehouseId);
  if (binId !== undefined && binId !== "" && binId !== null) filters.binId = Number(binId);
  const [total, items] = await Promise.all([
    prisma.materialBatch.count({ where: filters }),
    prisma.materialBatch.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, unit: true, batchManaged: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        bin: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ material: { code: "asc" } }, { batchNo: "asc" }],
      skip: (pageNum - 1) * sizeNum,
      take: sizeNum,
    }),
  ]);
  return { total, page: pageNum, pageSize: sizeNum, items };
}

// 手工库存事务的部门：必须存在且启用
// 部门/车间解析：支持数字 id 或车间名称（可输入下拉录入新名字时按名称匹配已建档车间）
async function createWorkshopAuto(name: string) {
  // 未建档车间/委外加工商：以输入名自动建档（编号 AUTO-名称，撞唯一约束则追加序号）
  for (let i = 0; i < 5; i++) {
    const code = `AUTO-${name}${i > 0 ? `-${i}` : ""}`;
    try {
      const created = await prisma.workshop.create({ data: { code, name, status: 1 } });
      return created.id;
    } catch (e: any) {
      if (e?.code !== "P2002") throw e;
    }
  }
  throw new Error("车间/委外加工商建档失败，请先在基础数据-车间管理建档");
}

async function resolveDepartmentId(departmentId?: number | string | null) {
  if (!departmentId) return null;
  const raw = String(departmentId).trim();
  let dept = null;
  if (/^\d+$/.test(raw)) {
    dept = await prisma.workshop.findUnique({ where: { id: Number(raw) } });
    if (!dept) throw new Error("车间/委外加工商不存在，请先在基础数据-车间管理建档");
  } else {
    dept = await prisma.workshop.findFirst({ where: { name: raw } });
    if (!dept) return createWorkshopAuto(raw);
  }
  if (dept.status !== 1) throw new Error("该车间/委外加工商已停用");
  return dept.id;
}

export async function stockIn(data: { materialId: number; quantity: number; unit?: string; warehouseId: number; binId?: number | null; batchNo?: string; relatedType?: string; relatedId?: number; transactionTypeId: number; effectiveDate?: string; orderNo?: string; lineNo?: number; remark?: string; departmentId?: number; handler?: string }, userId: number) {
  if (!Number.isFinite(data.quantity) || data.quantity <= 0) throw new Error("入库数量必须大于0");
  if (!Number.isFinite(Number(data.materialId)) || Number(data.materialId) <= 0) throw new Error("请选择物料");
  if (!Number.isFinite(Number(data.warehouseId)) || Number(data.warehouseId) <= 0) throw new Error("请选择仓库");
  const transactionType = await resolveManualTransactionType(data.transactionTypeId, "in");

  const material = await prisma.material.findUnique({ where: { id: data.materialId } });
  if (!material) throw new Error("物料不存在");

  const warehouse = await prisma.warehouse.findUnique({ where: { id: data.warehouseId } });
  if (!warehouse) throw new Error("仓库不存在");

  const departmentId = await resolveDepartmentId(data.departmentId);

  // 计量单位换算：录入数量按换算率折算为基本单位后入库
  const { rate } = await resolveUnitRate(data.materialId, data.unit);
  const baseQty = toBaseQty(data.quantity, rate);

  return prisma.$transaction(async (tx) => {
    // 单号串行生成，避免并发产生重复单号；前缀取事务类型配置，未配置用 ST
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const docNo = await generateDocNo(tx, typeDocPrefix(transactionType));

    // 校验货位（启用货位管理的仓库必须指定货位）
    const binId = await resolveBinId(tx, warehouse, data.binId);

    // upsert + 原子累加：并发建行走 ON CONFLICT，读-改-写不会丢失更新
    await addStock(tx, data.materialId, data.warehouseId, binId, baseQty);

    const resolvedBatchNo = await applyBatchIn(tx, material, data.warehouseId, binId, data.batchNo, baseQty);

    await tx.stockRecord.create({
      data: {
        materialId: data.materialId,
        warehouseId: data.warehouseId,
        binId,
        type: "in",
        quantity: baseQty,
        batchNo: resolvedBatchNo,
        relatedType: null,
        relatedId: null,
        transactionTypeId: data.transactionTypeId,
        documentNo: docNo,
        orderNo: data.orderNo || null,
        lineNo: data.lineNo ?? 1,
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : new Date(),
        operatorId: userId,
        departmentId,
        handler: data.handler || null,
        remark: data.remark,
      },
    });

    return { success: true, batchNo: resolvedBatchNo, baseQty, binId };
  });
}

export async function stockOut(data: { materialId: number; quantity: number; unit?: string; warehouseId: number; binId?: number | null; batchNo?: string; relatedType?: string; relatedId?: number; transactionTypeId: number; effectiveDate?: string; orderNo?: string; lineNo?: number; remark?: string; departmentId?: number; handler?: string }, userId: number) {
  if (!Number.isFinite(data.quantity) || data.quantity <= 0) throw new Error("出库数量必须大于0");
  if (!Number.isFinite(Number(data.materialId)) || Number(data.materialId) <= 0) throw new Error("请选择物料");
  if (!Number.isFinite(Number(data.warehouseId)) || Number(data.warehouseId) <= 0) throw new Error("请选择仓库");
  const transactionType = await resolveManualTransactionType(data.transactionTypeId, "out");

  const material = await prisma.material.findUnique({ where: { id: data.materialId } });
  if (!material) throw new Error("物料不存在");

  const warehouse = await prisma.warehouse.findUnique({ where: { id: data.warehouseId } });
  if (!warehouse) throw new Error("仓库不存在");

  const departmentId = await resolveDepartmentId(data.departmentId);

  // 计量单位换算：录入数量按换算率折算为基本单位后出库
  const { rate } = await resolveUnitRate(data.materialId, data.unit);
  const baseQty = toBaseQty(data.quantity, rate);
  if (baseQty <= 0) throw new Error("出库数量必须大于0");

  // 快速预校验货位（正式校验在事务内再做一次）
  const preBinId = await resolveBinId(prisma, warehouse, data.binId);

  const stock = await prisma.stock.findFirst({
    where: { materialId: data.materialId, warehouseId: data.warehouseId, binId: preBinId },
  });
  if (!stock || stock.quantity < baseQty) {
    throw new Error(`库存不足，当前库存 ${stock?.quantity ?? 0}`);
  }

  const salesperson = await salespersonByOrderNo(data.orderNo);

  return prisma.$transaction(async (tx) => {
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const docNo = await generateDocNo(tx, typeDocPrefix(transactionType));

    const binId = await resolveBinId(tx, warehouse, data.binId);

    // 条件递减：写入时原子校验库存充足，防止并发下扣成负数
    const updated = await tx.stock.updateMany({
      where: { id: stock.id, quantity: { gte: baseQty } },
      data: { quantity: { decrement: baseQty }, lastOutDate: new Date() },
    });
    if (updated.count === 0) {
      const fresh = await tx.stock.findUnique({ where: { id: stock.id } });
      throw new Error(`库存不足，当前库存 ${fresh?.quantity ?? 0}`);
    }

    const resolvedBatchNo = await applyBatchOut(tx, material, data.warehouseId, binId, data.batchNo, baseQty);

    await tx.stockRecord.create({
      data: {
        materialId: data.materialId,
        warehouseId: data.warehouseId,
        binId,
        type: "out",
        quantity: baseQty,
        batchNo: resolvedBatchNo,
        relatedType: null,
        relatedId: null,
        transactionTypeId: data.transactionTypeId,
        documentNo: docNo,
        orderNo: data.orderNo || null,
        salesperson,
        lineNo: data.lineNo ?? 1,
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : new Date(),
        operatorId: userId,
        departmentId,
        handler: data.handler || null,
        remark: data.remark,
      },
    });

    const after = await tx.stock.findUnique({ where: { id: stock.id } });
    return { success: true, remainingQty: after?.quantity ?? 0, batchNo: resolvedBatchNo, baseQty, binId };
  });
}

// 批量出库：一张单据对应多条出库明细，共用一个系统单号，整单原子提交
export async function stockOutBatch(
  data: {
    transactionTypeId: number;
    effectiveDate?: string;
    orderNo?: string;
    departmentId?: number;
    handler?: string;
    salesperson?: string;
    keeper?: string;
    approver?: string;
    mainRemark?: string;
    deliveryNo?: string;
    contractNo?: string;
    address?: string;
    contactName?: string;
    contactPhone?: string;
    companyId?: number;
    items: {
      materialId: number;
      warehouseId: number;
      binId?: number | null;
      batchNo?: string;
      quantity: number;
      unit?: string;
      remark?: string;
    }[];
  },
  userId: number
) {
  if (!Array.isArray(data.items) || data.items.length === 0) throw new Error("请至少添加一条出库明细");
  const transactionType = await resolveManualTransactionType(data.transactionTypeId, "out");
  const departmentId = await resolveDepartmentId(data.departmentId);
  let companyId: number | null = null;
  if (data.companyId) {
    const comp = await prisma.companyInfo.findUnique({ where: { id: Number(data.companyId) } });
    if (!comp) throw new Error("所属公司不存在");
    companyId = comp.id;
  } else {
    companyId = await getDefaultCompanyId();
  }

  // 预校验：物料/仓库/货位/单位换算
  const prepared: {
    material: any;
    warehouse: any;
    binId: number | null;
    batchNo?: string;
    baseQty: number;
    remark?: string;
  }[] = [];
  for (const [idx, line] of data.items.entries()) {
    if (!line.materialId) throw new Error(`第 ${idx + 1} 行请选择物料`);
    if (!line.warehouseId) throw new Error(`第 ${idx + 1} 行请选择仓库`);
    if (!Number.isFinite(line.quantity) || line.quantity === 0) throw new Error(`第 ${idx + 1} 行数量不能为0`);
    const material = await prisma.material.findUnique({ where: { id: line.materialId } });
    if (!material) throw new Error(`第 ${idx + 1} 行物料不存在`);
    const warehouse = await prisma.warehouse.findUnique({ where: { id: line.warehouseId } });
    if (!warehouse) throw new Error(`第 ${idx + 1} 行仓库不存在`);
    const binId = await resolveBinId(prisma, warehouse, line.binId);
    const { rate } = await resolveUnitRate(line.materialId, line.unit);
    const baseQty = toBaseQty(line.quantity, rate);
    if (baseQty === 0) throw new Error(`第 ${idx + 1} 行数量不能为0`);
    prepared.push({ material, warehouse, binId, batchNo: line.batchNo, baseQty, remark: line.remark });
  }

  const salesperson = String(data.salesperson ?? "").trim() || (await salespersonByOrderNo(data.orderNo));

  return prisma.$transaction(async (tx) => {
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const documentNo = await generateDocNo(tx, typeDocPrefix(transactionType));
    const effectiveDate = data.effectiveDate ? new Date(data.effectiveDate) : new Date();

    for (const [idx, line] of prepared.entries()) {
      const binId = await resolveBinId(tx, line.warehouse, line.binId);

      let resolvedBatchNo: string | null;
      if (line.baseQty > 0) {
        // 条件递减：并发出库不会扣成负数
        const updated = await tx.stock.updateMany({
          where: { materialId: line.material.id, warehouseId: line.warehouse.id, binId, quantity: { gte: line.baseQty } },
          data: { quantity: { decrement: line.baseQty }, lastOutDate: new Date() },
        });
        if (updated.count === 0) {
          const fresh = await tx.stock.findFirst({
            where: { materialId: line.material.id, warehouseId: line.warehouse.id, binId },
          });
          throw new Error(`第 ${idx + 1} 行物料 ${line.material.code} 库存不足，当前库存 ${fresh?.quantity ?? 0}`);
        }
        resolvedBatchNo = await applyBatchOut(tx, line.material, line.warehouse.id, binId, line.batchNo, line.baseQty);
      } else {
        // 负数 = 红单退库：原路退回仓库/货位/批次，库存增加，流水保留负数
        const returnQty = Math.abs(line.baseQty);
        await addStock(tx, line.material.id, line.warehouse.id, binId, returnQty);
        resolvedBatchNo = await applyBatchIn(tx, line.material, line.warehouse.id, binId, line.batchNo, returnQty);
      }

      await tx.stockRecord.create({
        data: {
          materialId: line.material.id,
          warehouseId: line.warehouse.id,
          binId,
          type: "out",
          quantity: line.baseQty,
          batchNo: resolvedBatchNo,
          transactionTypeId: data.transactionTypeId,
          documentNo,
          orderNo: data.orderNo || null,
          salesperson,
          lineNo: idx + 1,
          effectiveDate,
          operatorId: userId,
          departmentId,
          handler: data.handler || null,
          keeper: data.keeper || null,
          approver: data.approver || null,
          mainRemark: data.mainRemark || null,
          deliveryNo: data.deliveryNo || null,
          contractNo: data.contractNo || null,
          address: data.address || null,
          contactName: data.contactName || null,
          contactPhone: data.contactPhone || null,
          companyId,
          remark: line.remark || null,
        },
      });
    }

    return { success: true, documentNo, count: prepared.length };
  });
}

// 批量入库：一张单据对应多条入库明细，共用一个系统单号，整单原子提交
export async function stockInBatch(
  data: {
    transactionTypeId: number;
    effectiveDate?: string;
    orderNo?: string;
    departmentId?: number;
    handler?: string;
    keeper?: string;
    approver?: string;
    mainRemark?: string;
    items: {
      materialId: number;
      warehouseId: number;
      binId?: number | null;
      batchNo?: string;
      quantity: number;
      unit?: string;
      remark?: string;
    }[];
  },
  userId: number
) {
  if (!Array.isArray(data.items) || data.items.length === 0) throw new Error("请至少添加一条入库明细");
  const transactionType = await resolveManualTransactionType(data.transactionTypeId, "in");
  const departmentId = await resolveDepartmentId(data.departmentId);

  // 预校验：物料/仓库/货位/单位换算
  const prepared: {
    material: any;
    warehouse: any;
    binId: number | null;
    batchNo?: string;
    baseQty: number;
    remark?: string;
  }[] = [];
  for (const [idx, line] of data.items.entries()) {
    if (!line.materialId) throw new Error(`第 ${idx + 1} 行请选择物料`);
    if (!line.warehouseId) throw new Error(`第 ${idx + 1} 行请选择仓库`);
    if (!Number.isFinite(line.quantity) || line.quantity === 0) throw new Error(`第 ${idx + 1} 行数量不能为0`);
    const material = await prisma.material.findUnique({ where: { id: line.materialId } });
    if (!material) throw new Error(`第 ${idx + 1} 行物料不存在`);
    const warehouse = await prisma.warehouse.findUnique({ where: { id: line.warehouseId } });
    if (!warehouse) throw new Error(`第 ${idx + 1} 行仓库不存在`);
    const binId = await resolveBinId(prisma, warehouse, line.binId);
    const { rate } = await resolveUnitRate(line.materialId, line.unit);
    const baseQty = toBaseQty(line.quantity, rate);
    if (baseQty === 0) throw new Error(`第 ${idx + 1} 行数量不能为0`);
    prepared.push({ material, warehouse, binId, batchNo: line.batchNo, baseQty, remark: line.remark });
  }

  return prisma.$transaction(async (tx) => {
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const documentNo = await generateDocNo(tx, typeDocPrefix(transactionType));
    const effectiveDate = data.effectiveDate ? new Date(data.effectiveDate) : new Date();

    for (const [idx, line] of prepared.entries()) {
      const binId = await resolveBinId(tx, line.warehouse, line.binId);

      let resolvedBatchNo: string | null;
      if (line.baseQty > 0) {
        await addStock(tx, line.material.id, line.warehouse.id, binId, line.baseQty);
        resolvedBatchNo = await applyBatchIn(tx, line.material, line.warehouse.id, binId, line.batchNo, line.baseQty);
      } else {
        // 负数 = 红单冲销：按原仓库/货位/批次扣回库存，流水保留负数
        const outQty = Math.abs(line.baseQty);
        const updated = await tx.stock.updateMany({
          where: { materialId: line.material.id, warehouseId: line.warehouse.id, binId, quantity: { gte: outQty } },
          data: { quantity: { decrement: outQty }, lastOutDate: new Date() },
        });
        if (updated.count === 0) {
          const fresh = await tx.stock.findFirst({
            where: { materialId: line.material.id, warehouseId: line.warehouse.id, binId },
          });
          throw new Error(`第 ${idx + 1} 行物料 ${line.material.code} 库存不足，当前库存 ${fresh?.quantity ?? 0}`);
        }
        resolvedBatchNo = await applyBatchOut(tx, line.material, line.warehouse.id, binId, line.batchNo, outQty);
      }

      await tx.stockRecord.create({
        data: {
          materialId: line.material.id,
          warehouseId: line.warehouse.id,
          binId,
          type: "in",
          quantity: line.baseQty,
          batchNo: resolvedBatchNo,
          transactionTypeId: data.transactionTypeId,
          documentNo,
          orderNo: data.orderNo || null,
          lineNo: idx + 1,
          effectiveDate,
          operatorId: userId,
          departmentId,
          handler: data.handler || null,
          keeper: data.keeper || null,
          approver: data.approver || null,
          mainRemark: data.mainRemark || null,
          remark: line.remark || null,
        },
      });
    }

    return { success: true, documentNo, count: prepared.length };
  });
}

// 移库：把某物料的数量从源(仓库+货位)移动到目标(仓库+货位)，同一事务内写出一出一入两条流水。
export async function transferStock(data: {
  materialId: number;
  unit?: string;
  quantity: number;
  fromWarehouseId: number;
  fromBinId?: number | null;
  toWarehouseId: number;
  toBinId?: number | null;
  batchNo?: string;
  effectiveDate?: string;
  orderNo?: string;
  remark?: string;
}, userId: number) {
  if (!data.fromWarehouseId || !data.toWarehouseId) throw new Error("请选择源仓库和目标仓库");
  if (!Number.isFinite(data.quantity) || data.quantity <= 0) throw new Error("移库数量必须大于0");

  const material = await prisma.material.findUnique({ where: { id: data.materialId } });
  if (!material) throw new Error("物料不存在");

  const fromWarehouse = await prisma.warehouse.findUnique({ where: { id: data.fromWarehouseId } });
  if (!fromWarehouse) throw new Error("源仓库不存在");
  if (fromWarehouse.status !== 1) throw new Error(`源仓库「${fromWarehouse.name}」已停用，不能移库`);
  const toWarehouse = await prisma.warehouse.findUnique({ where: { id: data.toWarehouseId } });
  if (!toWarehouse) throw new Error("目标仓库不存在");
  if (toWarehouse.status !== 1) throw new Error(`目标仓库「${toWarehouse.name}」已停用，不能移库`);

  const { rate } = await resolveUnitRate(data.materialId, data.unit);
  const baseQty = toBaseQty(data.quantity, rate);
  if (baseQty <= 0) throw new Error("移库数量必须大于0");

  // 预校验货位（正式校验在事务内再做一次）
  const preFromBinId = await resolveBinId(prisma, fromWarehouse, data.fromBinId);
  const preToBinId = await resolveBinId(prisma, toWarehouse, data.toBinId);
  if (data.fromWarehouseId === data.toWarehouseId && preFromBinId === preToBinId) {
    throw new Error("源与目标不能为同一仓库的同一货位");
  }

  const stock = await prisma.stock.findFirst({
    where: { materialId: data.materialId, warehouseId: data.fromWarehouseId, binId: preFromBinId },
  });
  if (!stock || stock.quantity < baseQty) {
    throw new Error(`库存不足，当前库存 ${stock?.quantity ?? 0}`);
  }

  // 移库使用 ISS-TR/RCT-TR；旧环境若尚未导入，则回退到历史 MOVE-OUT/MOVE-IN
  const outType =
    (await prisma.stockTransactionType.findUnique({ where: { code: "ISS-TR" } })) ??
    (await prisma.stockTransactionType.findUnique({ where: { code: "MOVE-OUT" } }));
  const inType =
    (await prisma.stockTransactionType.findUnique({ where: { code: "RCT-TR" } })) ??
    (await prisma.stockTransactionType.findUnique({ where: { code: "MOVE-IN" } }));

  return prisma.$transaction(async (tx) => {
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const docNo = await generateDocNo(tx, outType?.documentPrefix || inType?.documentPrefix || "ST");

    const fromBinId = await resolveBinId(tx, fromWarehouse, data.fromBinId);
    const toBinId = await resolveBinId(tx, toWarehouse, data.toBinId);
    if (data.fromWarehouseId === data.toWarehouseId && fromBinId === toBinId) {
      throw new Error("源与目标不能为同一仓库的同一货位");
    }

    // 源：条件递减，原子校验库存充足
    const updated = await tx.stock.updateMany({
      where: { id: stock.id, quantity: { gte: baseQty } },
      data: { quantity: { decrement: baseQty }, lastOutDate: new Date() },
    });
    if (updated.count === 0) {
      const fresh = await tx.stock.findUnique({ where: { id: stock.id } });
      throw new Error(`库存不足，当前库存 ${fresh?.quantity ?? 0}`);
    }

    // 源：批号扣减（批号管理物料必须指定批号）
    const resolvedBatchNo = await applyBatchOut(tx, material, data.fromWarehouseId, fromBinId, data.batchNo, baseQty);

    // 目标：入库并沿用同一批号
    await addStock(tx, data.materialId, data.toWarehouseId, toBinId, baseQty);
    await applyBatchIn(tx, material, data.toWarehouseId, toBinId, resolvedBatchNo ?? undefined, baseQty);

    const effDate = data.effectiveDate ? new Date(data.effectiveDate) : new Date();
    await tx.stockRecord.create({
      data: {
        materialId: data.materialId,
        warehouseId: data.fromWarehouseId,
        binId: fromBinId,
        type: "out",
        quantity: baseQty,
        batchNo: resolvedBatchNo,
        transactionTypeId: outType?.id,
        documentNo: docNo,
        orderNo: data.orderNo || null,
        lineNo: 1,
        effectiveDate: effDate,
        operatorId: userId,
        remark: data.remark || `移库至 ${toWarehouse.name}`,
      },
    });
    await tx.stockRecord.create({
      data: {
        materialId: data.materialId,
        warehouseId: data.toWarehouseId,
        binId: toBinId,
        type: "in",
        quantity: baseQty,
        batchNo: resolvedBatchNo,
        transactionTypeId: inType?.id,
        documentNo: docNo,
        orderNo: data.orderNo || null,
        lineNo: 1,
        effectiveDate: effDate,
        operatorId: userId,
        remark: data.remark || `移库自 ${fromWarehouse.name}`,
      },
    });

    return { success: true, documentNo: docNo, baseQty, batchNo: resolvedBatchNo, fromBinId, toBinId };
  });
}

// 列出库存为 0 的现存量行与批次行（「清除0库存」页面用）
function buildZeroStockFilters(where: any = {}) {
  const keyword = where.materialKeyword?.trim();
  const relationWhere: any = {};
  if (where.warehouseId) relationWhere.warehouseId = Number(where.warehouseId);

  // 只处理数量恰好为 0 的记录；负库存属于异常，不能静默删除
  const stockWhere: any = { quantity: 0, ...relationWhere };
  const batchWhere: any = { quantity: 0, ...relationWhere };
  if (keyword) {
    const mf = { OR: [{ code: { contains: keyword } }, { name: { contains: keyword } }] };
    stockWhere.material = mf;
    batchWhere.material = mf;
  }
  return { stockWhere, batchWhere };
}

export async function listZeroStock(where: any = {}) {
  const page = Math.max(1, Number(where.page) || 1);
  const pageSize = Math.min(1000, Math.max(1, Number(where.pageSize) || 20));
  const { stockWhere, batchWhere } = buildZeroStockFilters(where);

  const [stockCount, batchCount] = await Promise.all([
    prisma.stock.count({ where: stockWhere }),
    prisma.materialBatch.count({ where: batchWhere }),
  ]);
  const total = stockCount + batchCount;

  // 展示顺序：先现存量行、再批次行。据此换算每张表在本页需要取的窗口，避免全量加载
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const stockSkip = Math.min(start, stockCount);
  const stockTake = Math.max(0, Math.min(end, stockCount) - stockSkip);
  const batchSkip = Math.max(0, start - stockCount);
  const batchTake = Math.max(0, Math.min(end, total) - Math.max(start, stockCount));

  const [stockRows, batchRows] = await Promise.all([
    stockTake > 0
      ? prisma.stock.findMany({
          where: stockWhere,
          include: {
            material: { select: { id: true, code: true, name: true, specification: true, unit: true } },
            warehouse: { select: { id: true, code: true, name: true } },
            bin: { select: { id: true, code: true, name: true } },
          },
          orderBy: { id: "asc" },
          skip: stockSkip,
          take: stockTake,
        })
      : [],
    batchTake > 0
      ? prisma.materialBatch.findMany({
          where: batchWhere,
          include: {
            material: { select: { id: true, code: true, name: true, specification: true, unit: true } },
            warehouse: { select: { id: true, code: true, name: true } },
            bin: { select: { id: true, code: true, name: true } },
          },
          orderBy: { id: "asc" },
          skip: batchSkip,
          take: batchTake,
        })
      : [],
  ]);

  const items = [
    ...stockRows.map((s) => ({ type: "stock", typeLabel: "现存量", id: s.id, material: s.material, warehouse: s.warehouse, bin: s.bin, batchNo: null as string | null, quantity: s.quantity, updatedAt: s.updatedAt })),
    ...batchRows.map((b) => ({ type: "batch", typeLabel: "批次库存", id: b.id, material: b.material, warehouse: b.warehouse, bin: b.bin, batchNo: b.batchNo, quantity: b.quantity, updatedAt: b.updatedAt })),
  ];

  return {
    stockCount,
    batchCount,
    total,
    page,
    pageSize,
    items,
  };
}

// 清除库存为 0 的现存量行与批次行（保留库存事务流水 StockRecord）；按页面筛选条件限定范围
export async function clearZeroStock(where: any = {}) {
  const { stockWhere, batchWhere } = buildZeroStockFilters(where);
  return prisma.$transaction(async (tx) => {
    const batch = await tx.materialBatch.deleteMany({ where: batchWhere });
    const stock = await tx.stock.deleteMany({ where: stockWhere });
    return { deletedStock: stock.count, deletedBatch: batch.count };
  });
}

export async function getStockAlerts(where: any = {}) {
  const { materialType, keyword } = where;
  const filters: Prisma.MaterialWhereInput = { status: 1, safetyStock: { gt: 0 } };
  if (materialType) {
    const types = String(materialType).split(",").map((t) => t.trim()).filter(Boolean);
    filters.materialType = types.length === 1 ? types[0] : { in: types };
  }
  if (keyword) {
    filters.OR = [
      { code: { contains: keyword } },
      { name: { contains: keyword } },
      { specification: { contains: keyword } },
    ];
  }

  const materials = await prisma.material.findMany({ where: filters });

  // 一次性汇总各物料现存量，避免逐物料 aggregate 的 N+1 查询
  const materialIds = materials.map((m) => m.id);
  const grouped = materialIds.length
    ? await prisma.stock.groupBy({
        by: ["materialId"],
        where: { materialId: { in: materialIds }, warehouse: { status: 1 } },
        _sum: { quantity: true },
      })
    : [];
  const qtyByMaterial = new Map(grouped.map((g) => [g.materialId, g._sum.quantity ?? 0]));

  const alerts = [];
  for (const m of materials) {
    const currentQty = qtyByMaterial.get(m.id) ?? 0;
    if (currentQty <= m.safetyStock) {
      alerts.push({
        materialId: m.id,
        materialCode: m.code,
        materialName: m.name,
        specification: m.specification,
        materialType: m.materialType,
        currentQty,
        safetyStock: m.safetyStock,
        shortageQty: m.safetyStock - currentQty,
        level: currentQty === 0 ? "critical" : "warning",
      });
    }
  }

  return alerts.sort((a, b) => a.shortageQty - b.shortageQty);
}
// 所属公司：库存流水归属的默认公司（销售出库等业务记录用）
export async function getDefaultCompanyId(): Promise<number | null> {
  const row = await prisma.companyInfo.findFirst({ where: { isDefault: true }, orderBy: { id: "asc" } });
  return row?.id ?? null;
}

import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact } from "../utils/date";
import { resolveUnitRate, toBaseQty } from "../utils/unit";

// 生成库存事务单号：ST+日期+序号
export async function generateStockDocNo(): Promise<string> {
  const dateStr = localDateCompact();
  const prefix = `ST${dateStr}`;
  const existing = await prisma.stockRecord.findMany({
    where: { documentNo: { startsWith: prefix } },
    select: { documentNo: true },
  });
  let max = 0;
  for (const e of existing) {
    const n = parseInt((e.documentNo ?? "").slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export async function listStocks(where: any) {
  const { materialCode, materialName, warehouseId, binId, page = 1, pageSize = 20 } = where;

  const filters: any = { quantity: { gt: 0 } };
  if (materialCode || materialName) {
    filters.material = {
      ...(materialCode && { code: { contains: materialCode } }),
      ...(materialName && { OR: [{ name: { contains: materialName } }, { specification: { contains: materialName } }] }),
    };
  }
  if (warehouseId) filters.warehouseId = Number(warehouseId);
  if (binId !== undefined && binId !== "" && binId !== null) filters.binId = Number(binId);

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
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
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

  return {
    total,
    page: Number(page),
    pageSize: Number(pageSize),
    items: items.map((s) => ({
      ...s,
      availableQty: s.quantity - s.reservedQty,
      isLow: s.material.safetyStock > 0 && s.quantity <= s.material.safetyStock,
      batches: batchByKey.get(`${s.materialId}|${s.warehouseId}|${s.binId ?? ""}`) ?? [],
    })),
  };
}

export async function listStockRecords(where: any) {
  const { materialId, materialKeyword, warehouseId, type, transactionTypeId, startDate, endDate, documentNo, page = 1, pageSize = 20 } = where;

  const filters: any = {};
  const mid = Number(materialId);
  if (materialId && !Number.isNaN(mid)) filters.materialId = mid;
  if (materialKeyword) {
    filters.material = {
      OR: [{ code: { contains: materialKeyword } }, { name: { contains: materialKeyword } }],
    };
  }
  if (warehouseId) filters.warehouseId = Number(warehouseId);
  if (type) filters.type = type;
  if (transactionTypeId) filters.transactionTypeId = Number(transactionTypeId);
  if (documentNo) filters.documentNo = { contains: documentNo };
  if (startDate || endDate) {
    filters.createdAt = {
      gte: startDate ? new Date(startDate) : undefined,
      lte: endDate ? new Date(endDate) : undefined,
    };
  }

  const [total, items] = await Promise.all([
    prisma.stockRecord.count({ where: filters }),
    prisma.stockRecord.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, unit: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        bin: { select: { id: true, code: true, name: true } },
        operator: { select: { id: true, realName: true } },
        transactionType: { select: { id: true, code: true, description: true, direction: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

// ===== 货位辅助 =====
// 校验货位：启用货位管理的仓库必须指定有效货位；未启用则不允许指定货位。
// 返回规范化后的 binId（number 或 null）。
export async function resolveBinId(
  tx: any,
  warehouse: { id: number; name: string; binManaged: boolean },
  binId?: number | string | null
): Promise<number | null> {
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
  // 非批号管理物料且未提供批号：仅当该仓库×货位已无批次库存时才允许不记批次
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
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);
  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function stockIn(data: { materialId: number; quantity: number; unit?: string; warehouseId: number; binId?: number | null; batchNo?: string; relatedType?: string; relatedId?: number; transactionTypeId?: number; effectiveDate?: string; documentNo?: string; lineNo?: number; remark?: string }, userId: number) {
  if (data.quantity <= 0) throw new Error("入库数量必须大于0");

  const material = await prisma.material.findUnique({ where: { id: data.materialId } });
  if (!material) throw new Error("物料不存在");

  const warehouse = await prisma.warehouse.findUnique({ where: { id: data.warehouseId } });
  if (!warehouse) throw new Error("仓库不存在");

  // 计量单位换算：录入数量按换算率折算为基本单位后入库
  const { rate } = await resolveUnitRate(data.materialId, data.unit);
  const baseQty = toBaseQty(data.quantity, rate);

  const docNo = data.documentNo || (await generateStockDocNo());

  return prisma.$transaction(async (tx) => {
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
        relatedType: data.relatedType,
        relatedId: data.relatedId,
        transactionTypeId: data.transactionTypeId,
        documentNo: docNo,
        lineNo: data.lineNo ?? 1,
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
        operatorId: userId,
        remark: data.remark,
      },
    });

    return { success: true, batchNo: resolvedBatchNo, baseQty, binId };
  });
}

export async function stockOut(data: { materialId: number; quantity: number; unit?: string; warehouseId: number; binId?: number | null; batchNo?: string; relatedType?: string; relatedId?: number; transactionTypeId?: number; effectiveDate?: string; documentNo?: string; lineNo?: number; remark?: string }, userId: number) {
  if (data.quantity <= 0) throw new Error("出库数量必须大于0");

  const material = await prisma.material.findUnique({ where: { id: data.materialId } });
  if (!material) throw new Error("物料不存在");

  const warehouse = await prisma.warehouse.findUnique({ where: { id: data.warehouseId } });
  if (!warehouse) throw new Error("仓库不存在");

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

  const docNo = data.documentNo || (await generateStockDocNo());

  return prisma.$transaction(async (tx) => {
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
        relatedType: data.relatedType,
        relatedId: data.relatedId,
        transactionTypeId: data.transactionTypeId,
        documentNo: docNo,
        lineNo: data.lineNo ?? 1,
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
        operatorId: userId,
        remark: data.remark,
      },
    });

    const after = await tx.stock.findUnique({ where: { id: stock.id } });
    return { success: true, remainingQty: after?.quantity ?? 0, batchNo: resolvedBatchNo, baseQty, binId };
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
  documentNo?: string;
  remark?: string;
}, userId: number) {
  if (!data.fromWarehouseId || !data.toWarehouseId) throw new Error("请选择源仓库和目标仓库");
  if (data.quantity <= 0) throw new Error("移库数量必须大于0");

  const material = await prisma.material.findUnique({ where: { id: data.materialId } });
  if (!material) throw new Error("物料不存在");

  const fromWarehouse = await prisma.warehouse.findUnique({ where: { id: data.fromWarehouseId } });
  if (!fromWarehouse) throw new Error("源仓库不存在");
  const toWarehouse = await prisma.warehouse.findUnique({ where: { id: data.toWarehouseId } });
  if (!toWarehouse) throw new Error("目标仓库不存在");

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

  const docNo = data.documentNo || (await generateStockDocNo());
  const outType = await prisma.stockTransactionType.findUnique({ where: { code: "MOVE-OUT" } });
  const inType = await prisma.stockTransactionType.findUnique({ where: { code: "MOVE-IN" } });

  return prisma.$transaction(async (tx) => {
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
export async function listZeroStock(where: any = {}) {
  const page = Number(where.page) || 1;
  const pageSize = Number(where.pageSize) || 20;
  const keyword = where.materialKeyword?.trim();

  const relationWhere: any = {};
  if (where.warehouseId) relationWhere.warehouseId = Number(where.warehouseId);

  const stockWhere: any = { quantity: { lte: 0 }, ...relationWhere };
  const batchWhere: any = { quantity: { lte: 0 }, ...relationWhere };
  if (keyword) {
    const mf = { OR: [{ code: { contains: keyword } }, { name: { contains: keyword } }] };
    stockWhere.material = mf;
    batchWhere.material = mf;
  }

  const [stockRows, batchRows] = await Promise.all([
    prisma.stock.findMany({
      where: stockWhere,
      include: {
        material: { select: { id: true, code: true, name: true, specification: true, unit: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        bin: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.materialBatch.findMany({
      where: batchWhere,
      include: {
        material: { select: { id: true, code: true, name: true, specification: true, unit: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        bin: { select: { id: true, code: true, name: true } },
      },
    }),
  ]);

  const items = [
    ...stockRows.map((s) => ({ type: "stock", typeLabel: "现存量", id: s.id, material: s.material, warehouse: s.warehouse, bin: s.bin, batchNo: null as string | null, quantity: s.quantity, updatedAt: s.updatedAt })),
    ...batchRows.map((b) => ({ type: "batch", typeLabel: "批次库存", id: b.id, material: b.material, warehouse: b.warehouse, bin: b.bin, batchNo: b.batchNo, quantity: b.quantity, updatedAt: b.updatedAt })),
  ];

  const stockCount = stockRows.length;
  const batchCount = batchRows.length;
  const total = items.length;
  const start = (page - 1) * pageSize;

  return {
    stockCount,
    batchCount,
    total,
    page,
    pageSize,
    items: items.slice(start, start + pageSize),
  };
}

// 清除库存为 0 的现存量行与批次行（保留库存事务流水 StockRecord）
export async function clearZeroStock() {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.materialBatch.deleteMany({ where: { quantity: { lte: 0 } } });
    const stock = await tx.stock.deleteMany({ where: { quantity: { lte: 0 } } });
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

  const alerts = [];
  for (const m of materials) {
    const agg = await prisma.stock.aggregate({ where: { materialId: m.id }, _sum: { quantity: true } });
    const currentQty = agg._sum.quantity ?? 0;
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
import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact } from "../utils/date";

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
  const { materialCode, materialName, warehouseId, page = 1, pageSize = 20 } = where;

  const filters: any = {};
  if (materialCode || materialName) {
    filters.material = {
      ...(materialCode && { code: { contains: materialCode } }),
      ...(materialName && { OR: [{ name: { contains: materialName } }, { specification: { contains: materialName } }] }),
    };
  }
  if (warehouseId) filters.warehouseId = Number(warehouseId);

  const [total, items] = await Promise.all([
    prisma.stock.count({ where: filters }),
    prisma.stock.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, specification: true, category: true, unit: true, safetyStock: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
      orderBy: { material: { code: "asc" } },
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
    const key = `${b.materialId}|${b.warehouseId}`;
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
      batches: batchByKey.get(`${s.materialId}|${s.warehouseId}`) ?? [],
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

// ===== 批号管理辅助 =====
// 入库：批号管理物料必须带批号（调用方未提供则自动生成），累加批号库存；非批号管理物料直接返回传入批号（通常为空）
export async function applyBatchIn(
  tx: any,
  material: { id: number; code: string; batchManaged?: boolean },
  warehouseId: number,
  batchNo: string | undefined,
  quantity: number
): Promise<string | null> {
  // 未启用批号管理且未提供批号：不记批号明细
  if (!material.batchManaged && !batchNo?.trim()) return null;
  const resolved = batchNo?.trim() ? batchNo.trim() : await generateBatchNo(tx, material);
  // upsert + 原子累加：并发下走数据库 ON CONFLICT，避免“读-改-写”丢失更新
  await tx.materialBatch.upsert({
    where: { materialId_warehouseId_batchNo: { materialId: material.id, warehouseId, batchNo: resolved } },
    create: { materialId: material.id, warehouseId, batchNo: resolved, quantity },
    update: { quantity: { increment: quantity } },
  });
  return resolved;
}

// 出库：批号管理物料必须指定批号且该批库存充足；非批号管理物料直接返回传入批号
export async function applyBatchOut(
  tx: any,
  material: { id: number; code: string; batchManaged?: boolean },
  warehouseId: number,
  batchNo: string | undefined,
  quantity: number
): Promise<string | null> {
  // 未启用批号管理且未提供批号：不校验批号明细
  if (!material.batchManaged && !batchNo?.trim()) return null;
  if (!batchNo?.trim()) throw new Error(`物料 ${material.code} 启用批号管理，出库必须指定批号`);
  const resolved = batchNo.trim();
  const existing = await tx.materialBatch.findUnique({
    where: { materialId_warehouseId_batchNo: { materialId: material.id, warehouseId, batchNo: resolved } },
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
  const { materialId, materialKeyword, warehouseId, page = 1, pageSize = 20 } = where;
  const filters: any = { quantity: { gt: 0 } };
  if (materialId) filters.materialId = Number(materialId);
  if (materialKeyword) filters.material = { OR: [{ code: { contains: materialKeyword } }, { name: { contains: materialKeyword } }] };
  if (warehouseId) filters.warehouseId = Number(warehouseId);
  const [total, items] = await Promise.all([
    prisma.materialBatch.count({ where: filters }),
    prisma.materialBatch.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, unit: true, batchManaged: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ material: { code: "asc" } }, { batchNo: "asc" }],
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);
  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function stockIn(data: { materialId: number; quantity: number; warehouseId: number; batchNo?: string; relatedType?: string; relatedId?: number; transactionTypeId?: number; effectiveDate?: string; documentNo?: string; lineNo?: number; remark?: string }, userId: number) {
  if (data.quantity <= 0) throw new Error("入库数量必须大于0");

  const material = await prisma.material.findUnique({ where: { id: data.materialId } });
  if (!material) throw new Error("物料不存在");

  const warehouse = await prisma.warehouse.findUnique({ where: { id: data.warehouseId } });
  if (!warehouse) throw new Error("仓库不存在");

  const docNo = data.documentNo || (await generateStockDocNo());

  return prisma.$transaction(async (tx) => {
    // upsert + 原子累加：并发建行走 ON CONFLICT，读-改-写不会丢失更新
    await tx.stock.upsert({
      where: { materialId_warehouseId: { materialId: data.materialId, warehouseId: data.warehouseId } },
      create: {
        materialId: data.materialId,
        warehouseId: data.warehouseId,
        quantity: data.quantity,
        lastInDate: new Date(),
      },
      update: { quantity: { increment: data.quantity }, lastInDate: new Date() },
    });

    const resolvedBatchNo = await applyBatchIn(tx, material, data.warehouseId, data.batchNo, data.quantity);

    await tx.stockRecord.create({
      data: {
        materialId: data.materialId,
        warehouseId: data.warehouseId,
        type: "in",
        quantity: data.quantity,
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

    return { success: true, batchNo: resolvedBatchNo };
  });
}

export async function stockOut(data: { materialId: number; quantity: number; warehouseId: number; batchNo?: string; relatedType?: string; relatedId?: number; transactionTypeId?: number; effectiveDate?: string; documentNo?: string; lineNo?: number; remark?: string }, userId: number) {
  if (data.quantity <= 0) throw new Error("出库数量必须大于0");

  const material = await prisma.material.findUnique({ where: { id: data.materialId } });
  if (!material) throw new Error("物料不存在");

  const stock = await prisma.stock.findFirst({
    where: { materialId: data.materialId, warehouseId: data.warehouseId },
  });
  if (!stock || stock.quantity < data.quantity) {
    throw new Error(`库存不足，当前库存 ${stock?.quantity ?? 0}`);
  }

  const docNo = data.documentNo || (await generateStockDocNo());

  return prisma.$transaction(async (tx) => {
    // 条件递减：写入时原子校验库存充足，防止并发下扣成负数
    const updated = await tx.stock.updateMany({
      where: { id: stock.id, quantity: { gte: data.quantity } },
      data: { quantity: { decrement: data.quantity }, lastOutDate: new Date() },
    });
    if (updated.count === 0) {
      const fresh = await tx.stock.findUnique({ where: { id: stock.id } });
      throw new Error(`库存不足，当前库存 ${fresh?.quantity ?? 0}`);
    }

    const resolvedBatchNo = await applyBatchOut(tx, material, data.warehouseId, data.batchNo, data.quantity);

    await tx.stockRecord.create({
      data: {
        materialId: data.materialId,
        warehouseId: data.warehouseId,
        type: "out",
        quantity: data.quantity,
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
    return { success: true, remainingQty: after?.quantity ?? 0, batchNo: resolvedBatchNo };
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
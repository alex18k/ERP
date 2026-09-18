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
      ...(materialName && { name: { contains: materialName } }),
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

  return {
    total,
    page: Number(page),
    pageSize: Number(pageSize),
    items: items.map((s) => ({
      ...s,
      availableQty: s.quantity - s.reservedQty,
      isLow: s.material.safetyStock > 0 && s.quantity <= s.material.safetyStock,
    })),
  };
}

export async function listStockRecords(where: any) {
  const { materialId, materialKeyword, warehouseId, type, startDate, endDate, documentNo, page = 1, pageSize = 20 } = where;

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

export async function stockIn(data: { materialId: number; quantity: number; warehouseId: number; relatedType?: string; relatedId?: number; transactionTypeId?: number; effectiveDate?: string; documentNo?: string; lineNo?: number; remark?: string }, userId: number) {
  if (data.quantity <= 0) throw new Error("入库数量必须大于0");

  const material = await prisma.material.findUnique({ where: { id: data.materialId } });
  if (!material) throw new Error("物料不存在");

  const warehouse = await prisma.warehouse.findUnique({ where: { id: data.warehouseId } });
  if (!warehouse) throw new Error("仓库不存在");

  const docNo = data.documentNo || (await generateStockDocNo());

  return prisma.$transaction(async (tx) => {
    const stock = await tx.stock.findFirst({
      where: { materialId: data.materialId, warehouseId: data.warehouseId },
    });

    if (stock) {
      await tx.stock.update({
        where: { id: stock.id },
        data: { quantity: stock.quantity + data.quantity, lastInDate: new Date() },
      });
    } else {
      await tx.stock.create({
        data: {
          materialId: data.materialId,
          warehouseId: data.warehouseId,
          quantity: data.quantity,
          lastInDate: new Date(),
        },
      });
    }

    await tx.stockRecord.create({
      data: {
        materialId: data.materialId,
        warehouseId: data.warehouseId,
        type: "in",
        quantity: data.quantity,
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

    return { success: true };
  });
}

export async function stockOut(data: { materialId: number; quantity: number; warehouseId: number; relatedType?: string; relatedId?: number; transactionTypeId?: number; effectiveDate?: string; documentNo?: string; lineNo?: number; remark?: string }, userId: number) {
  if (data.quantity <= 0) throw new Error("出库数量必须大于0");

  const stock = await prisma.stock.findFirst({
    where: { materialId: data.materialId, warehouseId: data.warehouseId },
  });
  if (!stock || stock.quantity < data.quantity) {
    throw new Error(`库存不足，当前库存 ${stock?.quantity ?? 0}`);
  }

  const docNo = data.documentNo || (await generateStockDocNo());

  return prisma.$transaction(async (tx) => {
    await tx.stock.update({
      where: { id: stock.id },
      data: { quantity: stock.quantity - data.quantity, lastOutDate: new Date() },
    });

    await tx.stockRecord.create({
      data: {
        materialId: data.materialId,
        warehouseId: data.warehouseId,
        type: "out",
        quantity: data.quantity,
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

    return { success: true, remainingQty: stock.quantity - data.quantity };
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
import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";

export interface MaterialCreateInput {
  code: string;
  name: string;
  specification?: string;
  category: string;
  unit: string;
  safetyStock?: number;
  minStock?: number;
  maxStock?: number;
  leadTime?: number;
  manufactureLeadTime?: number;
  orderCycleDays?: number;
  materialType?: string;
  minOrderQty?: number;
  cost?: number;
  processRouteId?: number;
  location?: string;
  supplierId?: number;
  batchManaged?: boolean;
  remark?: string;
}

export interface MaterialWhere {
  code?: string;
  name?: string;
  keyword?: string;
  category?: string;
  materialType?: string;
  status?: number;
  page?: number;
  pageSize?: number;
}

export async function listMaterials(where: MaterialWhere) {
  const { code, name, keyword, category, materialType, status, page = 1, pageSize = 20 } = where;

  const filters: Prisma.MaterialWhereInput = {};
  if (code) filters.code = { contains: code };
  if (name) filters.name = { contains: name };
  if (keyword) filters.OR = [{ code: { contains: keyword } }, { name: { contains: keyword } }, { specification: { contains: keyword } }];
  if (category) {
    const cats = String(category).split(",").map((c) => c.trim()).filter(Boolean);
    filters.category = cats.length === 1 ? cats[0] : { in: cats };
  }
  if (materialType) {
    const types = String(materialType).split(",").map((t) => t.trim()).filter(Boolean);
    filters.materialType = types.length === 1 ? types[0] : { in: types };
  }
  if (status !== undefined) filters.status = Number(status);

  const [total, items] = await Promise.all([
    prisma.material.count({ where: filters }),
    prisma.material.findMany({
      where: filters,
      include: {
        supplier: { select: { id: true, name: true } },
        stocks: { select: { quantity: true, reservedQty: true } },
        processRoute: { select: { id: true, code: true, name: true } },
      },
      orderBy: { code: "asc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return {
    total,
    page: Number(page),
    pageSize: Number(pageSize),
    items: items.map(({ stocks, ...m }) => ({
      ...m,
      stock: {
        quantity: stocks.reduce((s, x) => s + x.quantity, 0),
        reservedQty: stocks.reduce((s, x) => s + x.reservedQty, 0),
      },
    })),
  };
}

export async function getMaterial(id: number) {
  const material = await prisma.material.findUnique({
    where: { id },
    include: {
      supplier: true,
      stocks: true,
      processRoute: true,
      bomProducts: { include: { items: { include: { material: true } } } },
    },
  });
  if (!material) return null;
  const { stocks, ...m } = material;
  return {
    ...m,
    stock: {
      quantity: stocks.reduce((s, x) => s + x.quantity, 0),
      reservedQty: stocks.reduce((s, x) => s + x.reservedQty, 0),
    },
  };
}

export async function listMaterialTypes(): Promise<string[]> {
  const rows = await prisma.material.findMany({
    where: { materialType: { not: null } },
    distinct: ["materialType"],
    select: { materialType: true },
    orderBy: { materialType: "asc" },
  });
  return rows.map((r) => r.materialType).filter((t): t is string => !!t && t.trim().length > 0);
}

export interface MaterialOptionWhere {
  category?: string;
  keyword?: string;
  limit?: number;
}

export async function listMaterialOptions(where: MaterialOptionWhere) {
  const { category, keyword, limit = 50 } = where;
  const filters: Prisma.MaterialWhereInput = { status: 1 };
  if (category) {
    const cats = String(category).split(",").map((c) => c.trim()).filter(Boolean);
    filters.category = cats.length === 1 ? cats[0] : { in: cats };
  }
  if (keyword) {
    filters.OR = [
      { code: { contains: keyword } },
      { name: { contains: keyword } },
      { materialType: { contains: keyword } },
    ];
  }
  return prisma.material.findMany({
    where: filters,
    select: { id: true, code: true, name: true, specification: true, unit: true, location: true, cost: true, category: true, processRouteId: true },
    orderBy: { code: "asc" },
    take: Math.min(Number(limit) || 50, 500),
  });
}

export async function createMaterial(data: MaterialCreateInput) {
  const exists = await prisma.material.findUnique({ where: { code: data.code } });
  if (exists) throw new Error("物料编码已存在");

  return prisma.material.create({
    data: {
      ...data,
      safetyStock: data.safetyStock ?? 0,
      minStock: data.minStock ?? 0,
      maxStock: data.maxStock ?? 0,
      leadTime: data.leadTime ?? 0,
      manufactureLeadTime: data.manufactureLeadTime ?? 0,
      minOrderQty: data.minOrderQty ?? 0,
      cost: data.cost ?? 0,
    },
  });
}

export async function updateMaterial(id: number, data: Partial<MaterialCreateInput>) {
  const exists = await prisma.material.findUnique({ where: { id } });
  if (!exists) throw new Error("物料不存在");

  if (data.code) {
    const dup = await prisma.material.findFirst({
      where: { code: data.code, NOT: { id } },
    });
    if (dup) throw new Error("物料编码已存在");
  }

  return prisma.material.update({ where: { id }, data });
}

export async function deleteMaterial(id: number) {
  const exists = await prisma.material.findUnique({ where: { id } });
  if (!exists) throw new Error("物料不存在");

  // 检查是否被关联使用
  const bomItemCount = await prisma.bomItem.count({ where: { materialId: id } });
  const orderItemCount = await prisma.salesOrderItem.count({ where: { materialId: id } });
  if (bomItemCount > 0 || orderItemCount > 0) {
    throw new Error("物料已被BOM或订单引用，无法删除");
  }

  await prisma.material.update({ where: { id }, data: { status: 0 } });
  return true;
}

export async function importMaterials(rows: MaterialCreateInput[]) {
  const results = { success: 0, failed: 0, errors: [] as string[] };
  for (const row of rows) {
    try {
      await createMaterial(row);
      results.success++;
    } catch (error: any) {
      results.failed++;
      results.errors.push(`${row.code}: ${error.message}`);
    }
  }
  return results;
}
// 制造件成本 = BOM 子件成本之和 × 用量（含损耗） + 工艺成本（路线总工时 × 工时费率）
// 工时费率取环境变量 LABOR_RATE（每小时），默认 0（不计工艺成本）
export async function recalcManufactureCosts() {
  const laborRate = Number(process.env.LABOR_RATE ?? 0) || 0;

  const [materials, boms, routes] = await Promise.all([
    prisma.material.findMany({ select: { id: true, category: true, cost: true, processRouteId: true } }),
    prisma.bom.findMany({
      where: { status: "active" },
      include: { items: { select: { materialId: true, quantity: true, lossRate: true } } },
    }),
    prisma.processRoute.findMany({ select: { id: true, totalTime: true } }),
  ]);

  const materialById = new Map(materials.map((m) => [m.id, m]));
  const bomByProduct = new Map(boms.map((b) => [b.productId, b]));
  const routeById = new Map(routes.map((r) => [r.id, r]));
  const cache = new Map<number, number>();

  const compute = (id: number, visiting: Set<number>): number => {
    if (cache.has(id)) return cache.get(id)!;
    const base = materialById.get(id)?.cost ?? 0;
    const bom = bomByProduct.get(id);
    if (!bom) {
      cache.set(id, base);
      return base;
    }
    if (visiting.has(id)) return base; // 循环引用保护
    visiting.add(id);
    let cost = 0;
    for (const item of bom.items) {
      cost += compute(item.materialId, visiting) * item.quantity * (1 + (item.lossRate ?? 0));
    }
    visiting.delete(id);
    const mat = materialById.get(id);
    if (mat?.processRouteId) {
      const route = routeById.get(mat.processRouteId);
      if (route) cost += route.totalTime * laborRate;
    }
    const rounded = Math.round(cost * 100) / 100;
    cache.set(id, rounded);
    return rounded;
  };

  let updated = 0;
  let total = 0;
  for (const m of materials) {
    if (m.category !== "manufacture") continue;
    total++;
    const newCost = compute(m.id, new Set());
    if (Math.abs(newCost - m.cost) > 1e-6) {
      await prisma.material.update({ where: { id: m.id }, data: { cost: newCost } });
      updated++;
    }
  }
  return { updated, total };
}

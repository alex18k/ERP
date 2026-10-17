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
  if (code) filters.code = { contains: code, mode: "insensitive" };
  if (name) filters.name = { contains: name, mode: "insensitive" };
  if (keyword) {
    const kw = { contains: keyword, mode: "insensitive" as const };
    filters.OR = [{ code: kw }, { name: kw }, { specification: kw }];
  }
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
  // 物料类别 = 类别主数据（基础数据→物料类别维护） ∪ 物料主文件中已使用的历史值
  const [rows, cats] = await Promise.all([
    prisma.material.findMany({
      where: { materialType: { not: null } },
      distinct: ["materialType"],
      select: { materialType: true },
    }),
    prisma.materialCategory.findMany({ where: { status: 1 }, select: { name: true } }),
  ]);
  const set = new Set<string>();
  for (const r of rows) {
    const t = r.materialType?.trim();
    if (t) set.add(t);
  }
  for (const c of cats) {
    const t = c.name.trim();
    if (t) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "zh"));
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
    const kw = { contains: keyword, mode: "insensitive" as const };
    filters.OR = [
      { code: kw },
      { name: kw },
      { specification: kw },
      { materialType: kw },
    ];
  }
  const materials = await prisma.material.findMany({
    where: filters,
    select: { id: true, code: true, name: true, specification: true, unit: true, location: true, cost: true, category: true, processRouteId: true, batchManaged: true },
    orderBy: { code: "asc" },
    take: Math.min(Number(limit) || 50, 500),
  });

  // 附带每个物料的可用计量单位（基本单位 + 已维护的转换单位），供单据行单位下拉使用
  const convs = materials.length
    ? await prisma.materialUnitConversion.findMany({
        where: { materialId: { in: materials.map((m) => m.id) }, status: 1 },
        orderBy: { id: "asc" },
      })
    : [];
  const unitMap = new Map<number, string[]>();
  const rateMap = new Map<number, Record<string, number>>();
  for (const c of convs) {
    if (!unitMap.has(c.materialId)) unitMap.set(c.materialId, []);
    unitMap.get(c.materialId)!.push(c.unit);
    if (!rateMap.has(c.materialId)) rateMap.set(c.materialId, {});
    rateMap.get(c.materialId)![c.unit] = c.conversionRate;
  }
  return materials.map((m) => ({
    ...m,
    units: [m.unit, ...(unitMap.get(m.id) ?? [])],
    unitRates: { [m.unit]: 1, ...(rateMap.get(m.id) ?? {}) },
  }));
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

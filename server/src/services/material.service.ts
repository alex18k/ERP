import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { parseQueryConditions } from "../utils/queryConditions";
import { buildPrismaQueryWhere, type PrismaQueryFieldDefinition } from "../utils/prismaQueryConditions";

export interface MaterialCreateInput {
  code: string;
  bomcode?: string;
  name: string;
  specification?: string;
  description?: string;
  packageType?: string;
  brand?: string;
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
  price?: number;
  processRouteId?: number;
  location?: string;
  supplierId?: number;
  batchManaged?: boolean;
  status?: number;
  remark?: string;
  desc1?: string;
  desc2?: string;
  desc3?: string;
  desc4?: string;
}

export interface MaterialWhere {
  code?: string;
  bomcode?: string;
  name?: string;
  keyword?: string;
  category?: string;
  materialType?: string;
  brand?: string;
  packageType?: string;
  status?: number;
  page?: number;
  pageSize?: number;
  conditions?: string;
}

/** 高级查询字段白名单（物料主文件） */
export const MATERIAL_QUERY_FIELDS: Record<string, PrismaQueryFieldDefinition> = {
  code: { type: "text", column: "code" },
  bomcode: { type: "text", column: "bomcode" },
  name: { type: "text", column: "name" },
  specification: { type: "text", column: "specification" },
  description: { type: "text", column: "description" },
  packageType: { type: "text", column: "packageType" },
  brand: { type: "text", column: "brand" },
  materialType: { type: "text", column: "materialType" },
  category: {
    type: "enum",
    column: "category",
    options: [
      { label: "采购", value: "purchase" },
      { label: "制造", value: "manufacture" },
    ],
  },
  unit: { type: "text", column: "unit" },
  batchManaged: {
    type: "enum",
    options: [
      { label: "是", value: "1" },
      { label: "否", value: "0" },
    ],
    build: (value, _value2, operator) => {
      const isTrue = value === true || value === "1" || value === 1;
      return operator === "ne" ? { batchManaged: { not: isTrue } } : { batchManaged: isTrue };
    },
  },
  safetyStock: { type: "number", column: "safetyStock" },
  minStock: { type: "number", column: "minStock" },
  maxStock: { type: "number", column: "maxStock" },
  leadTime: { type: "number", column: "leadTime" },
  manufactureLeadTime: { type: "number", column: "manufactureLeadTime" },
  orderCycleDays: { type: "number", column: "orderCycleDays" },
  minOrderQty: { type: "number", column: "minOrderQty" },
  cost: { type: "number", column: "cost" },
  price: { type: "number", column: "price" },
  location: { type: "text", column: "location" },
  remark: { type: "text", column: "remark" },
  status: {
    type: "enum",
    column: "status",
    options: [
      { label: "启用", value: 1 },
      { label: "停用", value: 0 },
    ],
  },
  supplierName: {
    type: "text",
    build: (value, _value2, operator) => ({
      supplier: {
        name:
          operator === "eq"
            ? String(value ?? "").trim()
            : operator === "ne"
              ? { not: String(value ?? "").trim() }
              : { contains: String(value ?? "").trim(), mode: "insensitive" },
      },
    }),
  },
  routeName: {
    type: "text",
    build: (value, _value2, operator) => ({
      processRoute: {
        name:
          operator === "eq"
            ? String(value ?? "").trim()
            : operator === "ne"
              ? { not: String(value ?? "").trim() }
              : { contains: String(value ?? "").trim(), mode: "insensitive" },
      },
    }),
  },
  createdAt: { type: "date", column: "createdAt" },
};

export async function listMaterials(where: MaterialWhere) {
  const { code, bomcode, name, keyword, category, materialType, brand, packageType, status, page = 1, pageSize = 20 } = where;

  const filters: Prisma.MaterialWhereInput = {};
  if (code) filters.code = { contains: code, mode: "insensitive" };
  if (bomcode) filters.bomcode = { contains: bomcode, mode: "insensitive" };
  if (name) filters.name = { contains: name, mode: "insensitive" };
  if (keyword) {
    const kw = { contains: keyword, mode: "insensitive" as const };
    filters.OR = [{ code: kw }, { bomcode: kw }, { name: kw }, { specification: kw }, { description: kw }, { packageType: kw }, { brand: kw }];
  }
  if (category) {
    const cats = String(category).split(",").map((c) => c.trim()).filter(Boolean);
    filters.category = cats.length === 1 ? cats[0] : { in: cats };
  }
  if (materialType) {
    const types = String(materialType).split(",").map((t) => t.trim()).filter(Boolean);
    filters.materialType = types.length === 1 ? types[0] : { in: types };
  }
  if (brand) filters.brand = { contains: brand, mode: "insensitive" };
  if (packageType) filters.packageType = { contains: packageType, mode: "insensitive" };
  if (status !== undefined) filters.status = Number(status);

  // 高级查询条件（与基础条件 AND 叠加）
  const advancedConditions = parseQueryConditions((where as any).conditions);
  if (advancedConditions.length) {
    const advanced = buildPrismaQueryWhere(advancedConditions, MATERIAL_QUERY_FIELDS);
    filters.AND = [...(Array.isArray(filters.AND) ? filters.AND : []), advanced];
  }

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

export async function listMaterialUnits(): Promise<string[]> {
  // 物料主文件中已使用的计量单位（去重），供物料表单单位下拉使用
  const rows = await prisma.material.findMany({
    distinct: ["unit"],
    select: { unit: true },
  });
  const set = new Set<string>();
  for (const r of rows) {
    const u = r.unit?.trim();
    if (u) set.add(u);
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
      { bomcode: kw },
      { name: kw },
      { specification: kw },
      { description: kw },
      { materialType: kw },
      { packageType: kw },
      { brand: kw },
    ];
  }
  const materials = await prisma.material.findMany({
    where: filters,
    select: { id: true, code: true, name: true, specification: true, description: true, packageType: true, brand: true, remark: true, unit: true, location: true, cost: true, price: true, category: true, processRouteId: true, batchManaged: true },
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

function validateRequiredMaterialFields(
  data: Partial<MaterialCreateInput>,
  options: { requireBoth: boolean },
) {
  const fields = [
    { key: "materialType", label: "物料类别" },
    { key: "location", label: "库位" },
  ] as const;

  for (const field of fields) {
    const value = data[field.key];
    const missing = value === undefined || value === null || String(value).trim() === "";
    if (missing && (options.requireBoth || value !== undefined)) {
      throw new Error(`${field.label}不能为空`);
    }
  }

  if (data.materialType !== undefined) data.materialType = String(data.materialType).trim();
  if (data.location !== undefined) data.location = String(data.location).trim();
}

export async function createMaterial(data: MaterialCreateInput) {
  validateRequiredMaterialFields(data, { requireBoth: true });
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
      price: data.price ?? 0,
    },
  });
}

export async function updateMaterial(id: number, data: Partial<MaterialCreateInput>) {
  const exists = await prisma.material.findUnique({ where: { id } });
  if (!exists) throw new Error("物料不存在");

  validateRequiredMaterialFields(data, { requireBoth: false });

  if (data.code && data.code !== exists.code) throw new Error("物料编码不可修改");

  // 基本单位变更会导致已有库存、单据快照和换算关系的数量含义全部改变，存在业务引用时禁止直接修改
  if (data.unit !== undefined && String(data.unit).trim() !== exists.unit.trim()) {
    const [stockCount, batchCount, recordCount, salesItemCount, purchaseItemCount, bomItemCount, unitConvCount] =
      await Promise.all([
        prisma.stock.count({ where: { materialId: id, quantity: { gt: 1e-6 } } }),
        prisma.materialBatch.count({ where: { materialId: id } }),
        prisma.stockRecord.count({ where: { materialId: id } }),
        prisma.salesOrderItem.count({ where: { materialId: id } }),
        prisma.purchaseOrderItem.count({ where: { materialId: id } }),
        prisma.bomItem.count({ where: { materialId: id } }),
        prisma.materialUnitConversion.count({ where: { materialId: id } }),
      ]);
    if (stockCount + batchCount + recordCount + salesItemCount + purchaseItemCount + bomItemCount + unitConvCount > 0) {
      throw new Error("该物料已有库存、单据或换算关系，不能修改基本单位");
    }
  }

  // 启用批号管理前，现有库存必须已按批次维护；关闭前必须没有批次余量
  if (data.batchManaged === true && !exists.batchManaged) {
    const stockCount = await prisma.stock.count({ where: { materialId: id, quantity: { gt: 1e-6 } } });
    if (stockCount > 0) throw new Error("该物料仍有库存，请先清空或按批次维护后再启用批号管理");
  }
  if (data.batchManaged === false && exists.batchManaged) {
    const batchCount = await prisma.materialBatch.count({ where: { materialId: id, quantity: { gt: 1e-6 } } });
    if (batchCount > 0) throw new Error("该物料仍有批次库存，请先清空后再关闭批号管理");
  }

  const { code: _code, ...payload } = data;
  return prisma.material.update({ where: { id }, data: payload });
}

export async function deleteMaterial(id: number) {
  const exists = await prisma.material.findUnique({ where: { id } });
  if (!exists) throw new Error("物料不存在");

  // 检查是否被关联使用（任何业务引用都不允许删除）
  const [
    bomItemCount,
    bomProductCount,
    orderItemCount,
    purchaseItemCount,
    productionOrderCount,
    stockCount,
    batchCount,
    stockRecordCount,
    productionOrderMaterialCount,
    suggestionCount,
    shortageCount,
    unitConversionCount,
  ] = await Promise.all([
    prisma.bomItem.count({ where: { materialId: id } }),
    prisma.bom.count({ where: { productId: id } }),
    prisma.salesOrderItem.count({ where: { materialId: id } }),
    prisma.purchaseOrderItem.count({ where: { materialId: id } }),
    prisma.productionOrder.count({ where: { materialId: id } }),
    prisma.stock.count({ where: { materialId: id } }),
    prisma.materialBatch.count({ where: { materialId: id } }),
    prisma.stockRecord.count({ where: { materialId: id } }),
    prisma.productionOrderMaterial.count({ where: { materialId: id } }),
    prisma.purchaseSuggestion.count({ where: { materialId: id } }),
    prisma.mrpShortage.count({ where: { materialId: id } }),
    prisma.materialUnitConversion.count({ where: { materialId: id } }),
  ]);
  if (bomItemCount > 0) throw new Error("物料已被BOM引用，无法删除");
  if (bomProductCount > 0) throw new Error("物料已维护BOM，无法删除");
  if (orderItemCount > 0) throw new Error("物料已被销售订单引用，无法删除");
  if (purchaseItemCount > 0) throw new Error("物料已被采购订单引用，无法删除");
  if (productionOrderCount > 0) throw new Error("物料已被生产订单引用，无法删除");
  if (stockCount > 0 || batchCount > 0 || stockRecordCount > 0) throw new Error("物料存在库存、批次或库存流水，无法删除");
  if (productionOrderMaterialCount > 0) throw new Error("物料已被生产订单用料引用，无法删除");
  if (suggestionCount > 0 || shortageCount > 0) throw new Error("物料存在采购建议或MRP缺料记录，无法删除");
  if (unitConversionCount > 0) throw new Error("物料存在计量单位换算，无法删除");

  // 未被任何业务引用的物料直接物理删除（软删除会让物料仍留在列表中，看起来删不掉）
  try {
    await prisma.material.delete({ where: { id } });
  } catch (e: any) {
    if (e?.code === "P2003") throw new Error("物料仍被其它数据引用，无法删除");
    throw e;
  }
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

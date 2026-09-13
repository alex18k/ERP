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
  orderCycleDays?: number;
  materialType?: string;
  minOrderQty?: number;
  unitPrice?: number;
  cost?: number;
  processRouteId?: number;
  defaultWarehouseId?: number;
  location?: string;
  supplierId?: number;
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
  if (keyword) filters.OR = [{ code: { contains: keyword } }, { name: { contains: keyword } }];
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
        stock: { select: { quantity: true, reservedQty: true } },
        processRoute: { select: { id: true, code: true, name: true } },
      },
      orderBy: { code: "asc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function getMaterial(id: number) {
  return prisma.material.findUnique({
    where: { id },
    include: {
      supplier: true,
      stock: true,
      processRoute: true,
      bomProducts: { include: { items: { include: { material: true } } } },
    },
  });
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
    select: { id: true, code: true, name: true, specification: true, unit: true, location: true, category: true },
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
      minOrderQty: data.minOrderQty ?? 0,
      unitPrice: data.unitPrice ?? 0,
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
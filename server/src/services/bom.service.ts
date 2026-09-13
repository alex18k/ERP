import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";

export interface BomCreateInput {
  code?: string;
  name?: string;
  productId: number;
  version?: string;
  items: {
    materialId: number;
    quantity: number;
    unit: string;
    lossRate?: number;
    sortOrder?: number;
  }[];
}

export async function listBoms(where: any) {
  const { code, name, status, page = 1, pageSize = 20 } = where;

  const filters: Prisma.BomWhereInput = {};
  if (code) filters.code = { contains: code };
  if (name) filters.name = { contains: name };
  if (status) filters.status = status;

  const [total, items] = await Promise.all([
    prisma.bom.count({ where: filters }),
    prisma.bom.findMany({
      where: filters,
      include: {
        product: { select: { id: true, code: true, name: true, category: true } },
        items: {
          include: { material: { select: { id: true, code: true, name: true, unit: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

// BOM可选成品/半成品：制造类物料中尚未拥有BOM的（同一物料只允许一张BOM；
// 已挂BOM的物料作为父零件仅可修改其已有BOM，不可再新增）。
export async function bomProductOptions() {
  const occupied = new Set<number>();
  const allBoms = await prisma.bom.findMany({ select: { productId: true } });
  for (const b of allBoms) occupied.add(b.productId);

  const notIn = [...occupied];
  return prisma.material.findMany({
    where: {
      category: "manufacture",
      ...(notIn.length > 0 ? { NOT: { id: { in: notIn } } } : {}),
    },
    select: { id: true, code: true, name: true, specification: true, unit: true },
    orderBy: { code: "asc" },
  });
}

export async function getBom(id: number) {
  return prisma.bom.findUnique({
    where: { id },
    include: {
      product: true,
      items: { include: { material: true }, orderBy: { sortOrder: "asc" } },
    },
  });
}

// BOM编码默认取父零件号（产出物料编码）
function defaultBomCode(productCode: string): string {
  return productCode.trim() || "BOM";
}

export async function createBom(data: BomCreateInput) {
  const product = await prisma.material.findUnique({ where: { id: data.productId } });
  if (!product) throw new Error("成品物料不存在");

  if (!data.items || data.items.length === 0) {
    throw new Error("BOM至少需要一个明细项");
  }

  // 同一物料只允许一张BOM
  const productBom = await prisma.bom.findFirst({ where: { productId: data.productId } });
  if (productBom) {
    throw new Error(`物料「${product.code} ${product.name}」已存在BOM，同一物料只允许一张BOM`);
  }

  const code = data.code?.trim() ? data.code.trim() : defaultBomCode(product.code);
  const name = data.name?.trim() ? data.name.trim() : product.code;

  const exists = await prisma.bom.findUnique({ where: { code } });
  if (exists) throw new Error("BOM编码已存在");

  return prisma.$transaction(async (tx) => {
    const bom = await tx.bom.create({
      data: {
        code,
        name,
        productId: data.productId,
        version: data.version || "1.0",
        status: "active",
      },
    });

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      await tx.bomItem.create({
        data: {
          bomId: bom.id,
          materialId: item.materialId,
          quantity: item.quantity,
          unit: item.unit,
          lossRate: item.lossRate ?? 0,
          sortOrder: item.sortOrder ?? i + 1,
        },
      });
    }

    return tx.bom.findUnique({
      where: { id: bom.id },
      include: { items: { include: { material: true } } },
    });
  });
}

export async function updateBom(id: number, data: Partial<BomCreateInput>) {
  const exists = await prisma.bom.findUnique({ where: { id } });
  if (!exists) throw new Error("BOM不存在");

  if (data.productId !== undefined && data.productId !== exists.productId) {
    throw new Error("父零件不可更换，已挂BOM的物料只能修改其BOM");
  }

  if (data.code) {
    const dup = await prisma.bom.findFirst({ where: { code: data.code, NOT: { id } } });
    if (dup) throw new Error("BOM编码已存在");
  }

  return prisma.$transaction(async (tx) => {
    const bom = await tx.bom.update({
      where: { id },
      data: {
        code: data.code,
        name: data.name,
        productId: data.productId,
        version: data.version,
      },
    });

    if (data.items) {
      await tx.bomItem.deleteMany({ where: { bomId: id } });
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        await tx.bomItem.create({
          data: {
            bomId: id,
            materialId: item.materialId,
            quantity: item.quantity,
            unit: item.unit,
            lossRate: item.lossRate ?? 0,
            sortOrder: item.sortOrder ?? i + 1,
          },
        });
      }
    }

    return tx.bom.findUnique({
      where: { id: bom.id },
      include: { items: { include: { material: true } } },
    });
  });
}

export async function activateBom(id: number) {
  const exists = await prisma.bom.findUnique({ where: { id } });
  if (!exists) throw new Error("BOM不存在");

  // 先停用同产品的其他BOM
  return prisma.$transaction(async (tx) => {
    await tx.bom.updateMany({
      where: { productId: exists.productId, status: "active" },
      data: { status: "obsolete" },
    });
    return tx.bom.update({ where: { id }, data: { status: "active" } });
  });
}

export async function deleteBom(id: number) {
  const exists = await prisma.bom.findUnique({ where: { id } });
  if (!exists) throw new Error("BOM不存在");

  await prisma.bom.delete({ where: { id } });
  return true;
}

export async function batchDeleteBom(ids: number[]) {
  const result = await prisma.bom.deleteMany({ where: { id: { in: ids } } });
  return result.count;
}

// ===== 产品结构树（多层展开） =====
const MAX_BOM_TREE_DEPTH = 20;

export interface BomTreeNode {
  bomId: number;
  materialId: number;
  materialCode: string;
  materialName: string;
  specification: string | null;
  category: string;
  unit: string;
  quantity: number;      // 本级用量（父BOM中标注的用量）
  totalQuantity: number; // 累计用量（自根节点逐层相乘，含损耗率）
  lossRate: number;
  cost: number;          // 物料成本（单价）
  level: number;
  hasSubBom: boolean;
  children: BomTreeNode[];
}

export async function getBomTree(id: number) {
  const bom = await prisma.bom.findUnique({
    where: { id },
    include: { product: true },
  });
  if (!bom) throw new Error("BOM不存在");

  // 根节点使用被查看的BOM（不论状态），子装配按MRP规则取激活BOM
  async function build(
    materialId: number,
    bomId: number | null,
    level: number,
    baseQty: number,
    path: Set<number>
  ): Promise<BomTreeNode[]> {
    if (level > MAX_BOM_TREE_DEPTH) {
      throw new Error(`BOM层级过深，超过最大深度 ${MAX_BOM_TREE_DEPTH} 层，可能存在循环引用`);
    }
    if (path.has(materialId)) {
      throw new Error(`BOM存在循环引用: 物料 ${materialId}`);
    }

    const currentBom = bomId
      ? await prisma.bom.findUnique({ where: { id: bomId }, include: { items: true } })
      : await prisma.bom.findFirst({
          where: { productId: materialId, status: "active" },
          include: { items: true },
        });
    if (!currentBom) return [];
    if (currentBom.productId !== materialId) return [];

    path.add(materialId);
    const nodes: BomTreeNode[] = [];
    const items = [...currentBom.items].sort((a, b) => a.sortOrder - b.sortOrder);

    for (const item of items) {
      const mat = await prisma.material.findUnique({ where: { id: item.materialId } });
      if (!mat) continue;
      const hasSubBom = await prisma.bom.findFirst({
        where: { productId: item.materialId, status: "active" },
        select: { id: true },
      });

      const totalQuantity = baseQty * item.quantity * (1 + (item.lossRate ?? 0));
      const node: BomTreeNode = {
        bomId: item.bomId,
        materialId: mat.id,
        materialCode: mat.code,
        materialName: mat.name,
        specification: mat.specification,
        category: mat.category,
        unit: item.unit || mat.unit,
        quantity: item.quantity,
        totalQuantity,
        lossRate: item.lossRate ?? 0,
        cost: mat.cost ?? 0,
        level,
        hasSubBom: !!hasSubBom,
        children: [],
      };

      if (hasSubBom) {
        node.children = await build(item.materialId, null, level + 1, totalQuantity, new Set(path));
      }
      nodes.push(node);
    }

    path.delete(materialId);
    return nodes;
  }

  const tree = await build(bom.productId, bom.id, 1, 1, new Set());
  return { ...bom, tree };
}
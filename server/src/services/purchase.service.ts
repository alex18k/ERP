import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact } from "../utils/date";
import { applyBatchIn } from "./stock.service";

export async function generatePurchaseOrderNo(): Promise<string> {
  const dateStr = localDateCompact();
  const prefix = `PO${dateStr}`;
  const existing = await prisma.purchaseOrder.findMany({
    where: { orderNo: { startsWith: prefix } },
    select: { orderNo: true },
  });
  let maxSeq = 0;
  for (const e of existing) {
    const n = parseInt(e.orderNo.slice(prefix.length), 10);
    if (!isNaN(n) && n > maxSeq) maxSeq = n;
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
}

export interface PurchaseOrderInput {
  supplierId: number | null;
  settleMethod?: string;
  orderDate?: string;
  expectedDate?: string;
  buyer?: string;
  taxIncluded?: boolean;
  taxRate?: number;
  remark?: string;
  items: {
    materialId: number;
    quantity: number;
    unit?: string;
    unitPrice?: number;
    taxIncluded?: boolean;
    taxRate?: number;
    location?: string;
    expectedDate?: string;
    remark?: string;
  }[];
}

export async function listPurchaseOrders(where: any) {
  const { orderNo, supplierId, status, materialKeyword, materialCode, materialName, specification, page = 1, pageSize = 20 } = where;
  const filters: Prisma.PurchaseOrderWhereInput = {};
  if (orderNo) filters.orderNo = { contains: orderNo };
  if (supplierId) filters.supplierId = Number(supplierId);
  if (status) {
    const arr = String(status).split(",").map((s) => s.trim()).filter(Boolean);
    filters.status = arr.length === 1 ? arr[0] : { in: arr };
  }
  if (materialKeyword) {
    filters.items = {
      some: {
        material: {
          OR: [
            { code: { contains: materialKeyword } },
            { name: { contains: materialKeyword } },
            { specification: { contains: materialKeyword } },
          ],
        },
      },
    };
  } else if (materialCode || materialName || specification) {
    filters.items = {
      some: {
        material: {
          ...(materialCode && { code: { contains: materialCode } }),
          ...(materialName && { name: { contains: materialName } }),
          ...(specification && { specification: { contains: specification } }),
        },
      },
    };
  }

  const [total, items] = await Promise.all([
    prisma.purchaseOrder.count({ where: filters }),
    prisma.purchaseOrder.findMany({
      where: filters,
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        items: { include: { material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function getPurchaseOrder(id: number) {
  return prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { include: { material: true } },
    },
  });
}

export async function createPurchaseOrder(data: PurchaseOrderInput, userId: number) {
  if (!data.items || data.items.length === 0) throw new Error("采购单至少需要一个明细");
  if (!data.orderDate) throw new Error("请选择订货日期");
  if (!data.expectedDate) throw new Error("请选择截止日期");
  if (!data.buyer) throw new Error("请输入采购员");
  const supplier = data.supplierId ? await prisma.supplier.findUnique({ where: { id: data.supplierId } }) : null;
  if (data.supplierId && !supplier) throw new Error("供应商不存在");

  const orderNo = await generatePurchaseOrderNo();
  const totalAmount = data.items.reduce((s, i) => s + i.quantity * (i.unitPrice ?? 0), 0);
  const settleMethod = data.settleMethod ?? supplier?.settleMethod ?? null;

  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: {
        orderNo,
        supplierId: data.supplierId,
        settleMethod,
        totalAmount,
        orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
        buyer: data.buyer || null,
        taxIncluded: data.taxIncluded ?? false,
        taxRate: data.taxRate ?? 0,
        status: "confirmed",
        remark: data.remark,
        createdBy: userId,
      },
    });

    for (const item of data.items) {
      await tx.purchaseOrderItem.create({
        data: {
          orderId: po.id,
          materialId: item.materialId,
          quantity: item.quantity,
          unit: item.unit || null,
          unitPrice: item.unitPrice ?? 0,
          amount: item.quantity * (item.unitPrice ?? 0),
          taxIncluded: item.taxIncluded ?? false,
          taxRate: item.taxRate ?? 0,
          location: item.location || null,
          expectedDate: item.expectedDate ? new Date(item.expectedDate) : null,
          status: "pending",
          remark: item.remark || null,
        },
      });
    }

    return tx.purchaseOrder.findUnique({ where: { id: po.id }, include: { items: true } });
  });
}

export async function updatePurchaseOrder(id: number, data: PurchaseOrderInput) {
  const exists = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!exists) throw new Error("采购单不存在");
  if (!["draft", "confirmed"].includes(exists.status)) throw new Error("仅草稿或已确认状态可编辑");
  if (!data.items || data.items.length === 0) throw new Error("采购单至少需要一个明细");
  if (!data.orderDate) throw new Error("请选择订货日期");
  if (!data.expectedDate) throw new Error("请选择截止日期");
  if (!data.buyer) throw new Error("请输入采购员");

  const supplier = data.supplierId ? await prisma.supplier.findUnique({ where: { id: data.supplierId } }) : null;
  if (data.supplierId && !supplier) throw new Error("供应商不存在");

  const totalAmount = data.items.reduce((s, i) => s + i.quantity * (i.unitPrice ?? 0), 0);
  // 供应商变更时自动继承新供应商的结算方式；否则保留原单值
  const settleMethod =
    data.settleMethod !== undefined && data.settleMethod !== null
      ? data.settleMethod
      : exists.supplierId !== data.supplierId
        ? (supplier?.settleMethod ?? null)
        : exists.settleMethod;

  return prisma.$transaction(async (tx) => {
    await tx.purchaseOrderItem.deleteMany({ where: { orderId: id } });
    for (const item of data.items) {
      await tx.purchaseOrderItem.create({
        data: {
          orderId: id,
          materialId: item.materialId,
          quantity: item.quantity,
          unit: item.unit || null,
          unitPrice: item.unitPrice ?? 0,
          amount: item.quantity * (item.unitPrice ?? 0),
          taxIncluded: item.taxIncluded ?? false,
          taxRate: item.taxRate ?? 0,
          location: item.location || null,
          expectedDate: item.expectedDate ? new Date(item.expectedDate) : null,
          status: "pending",
          remark: item.remark || null,
        },
      });
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: data.supplierId,
        settleMethod,
        totalAmount,
        orderDate: data.orderDate ? new Date(data.orderDate) : null,
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
        buyer: data.buyer || null,
        taxIncluded: data.taxIncluded ?? false,
        taxRate: data.taxRate ?? 0,
        remark: data.remark,
      },
    });

    return tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
  });
}

export async function confirmPurchaseOrder(id: number) {
  const exists = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
  if (!exists) throw new Error("采购单不存在");
  if (exists.status !== "draft") throw new Error("仅草稿状态可确认");

  // 确认前校验必填项（与保存逻辑一致）
  if (!exists.supplierId) throw new Error("请先选择供应商");
  if (!exists.orderDate) throw new Error("请先选择订货日期");
  if (!exists.expectedDate) throw new Error("请先选择截止日期");
  if (!exists.buyer) throw new Error("请先填写采购员");
  if (!exists.items || exists.items.length === 0) throw new Error("采购单至少需要一个明细");
  for (const it of exists.items) {
    if (!it.materialId) throw new Error("采购明细缺少物料");
    if (!it.quantity || it.quantity <= 0) throw new Error("采购明细数量必须大于0");
  }

  return prisma.purchaseOrder.update({ where: { id }, data: { status: "confirmed" } });
}

const MAINTAINABLE_STATUSES = ["draft", "confirmed", "cancelled", "closed"];

// 主表状态下拉维护：仅允许草稿/已确认/已取消/已关闭，收货相关状态由收货操作驱动
export async function updatePurchaseOrderStatus(id: number, status: string) {
  if (!MAINTAINABLE_STATUSES.includes(status)) {
    throw new Error("仅支持草稿、已确认、已取消、已关闭四种状态");
  }
  const exists = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!exists) throw new Error("采购单不存在");
  if (["partial_received", "received"].includes(exists.status)) {
    throw new Error("已收货或部分收货的采购单不能修改状态");
  }
  if (exists.status === status) return exists;

  return prisma.$transaction(async (tx) => {
    await tx.purchaseOrderItem.updateMany({
      where: { orderId: id, status: status === "cancelled" ? { not: "received" } : "cancelled" },
      data: { status: status === "cancelled" ? "cancelled" : "pending" },
    });
    return tx.purchaseOrder.update({ where: { id }, data: { status } });
  });
}

export async function cancelPurchaseOrder(id: number) {
  const exists = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!exists) throw new Error("采购单不存在");
  if (exists.status === "received") throw new Error("已收货的采购单不能取消");

  return prisma.$transaction(async (tx) => {
    await tx.purchaseOrderItem.updateMany({
      where: { orderId: id, status: { in: ["pending", "partial_received"] } },
      data: { status: "cancelled" },
    });
    return tx.purchaseOrder.update({ where: { id }, data: { status: "cancelled" } });
  });
}

// ===== 收货（支持分批：传入 items 则按数量收，否则全部收完）=====
export async function receivePurchaseOrder(
  id: number,
  userId: number,
  receipts?: { itemId: number; quantity: number; batchNo?: string }[],
  options?: { effectiveDate?: string; location?: string }
) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: { include: { material: true } } },
  });
  if (!po) throw new Error("采购单不存在");
  if (po.status === "draft") throw new Error("采购单为草稿状态，请先确认后再收货");
  if (po.status === "cancelled") throw new Error("采购单已取消，不能收货");
  if (po.status === "closed") throw new Error("采购单已关闭，不能收货");
  if (po.status === "received") throw new Error("采购单已全部收货");

  const receiptType = await prisma.stockTransactionType.findUnique({ where: { code: "RCT-PO" } });

  // 本次各明细的收货数量：传了 receipts 用传入值，否则默认收完剩余
  const receiptsByItem = new Map<number, { quantity: number; batchNo?: string }>();
  if (receipts && receipts.length > 0) {
    for (const r of receipts) {
      if (r.quantity > 0) receiptsByItem.set(r.itemId, { quantity: r.quantity, batchNo: r.batchNo });
    }
  } else {
    for (const it of po.items) receiptsByItem.set(it.id, { quantity: it.quantity - it.receivedQty });
  }
  const receiveMap = new Map<number, number>();
  for (const [itemId, r] of receiptsByItem) receiveMap.set(itemId, r.quantity);
  if (receiveMap.size === 0) throw new Error("请填写收货数量");

  // 库位映射到仓库（库位编码 = 仓库编码），将收货库存记入指定库位对应的仓库
  const locationWarehouse = options?.location
    ? await prisma.warehouse.findUnique({ where: { code: options.location } })
    : null;

  return prisma.$transaction(async (tx) => {
    for (const [idx, item] of po.items.entries()) {
      const qty = receiveMap.get(item.id) ?? 0;
      if (qty <= 0) continue;

      const remaining = item.quantity - item.receivedQty;
      if (qty > remaining) {
        throw new Error(`收货数量不能超过未收数量（${remaining}）`);
      }
      const newReceived = item.receivedQty + qty;

      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: {
          receivedQty: newReceived,
          status: newReceived >= item.quantity ? "received" : "partial_received",
        },
      });

      // 采购件成本：按最近一次采购单价回写物料成本
      if (item.unitPrice != null && item.unitPrice > 0) {
        await tx.material.update({ where: { id: item.materialId }, data: { cost: item.unitPrice } });
      }

      // 更新库存：优先记入库位对应的仓库（库位编码 = 仓库编码）
      const targetWarehouseId = locationWarehouse?.id ?? null;
      let warehouseId: number;
      const stock = targetWarehouseId
        ? await tx.stock.findFirst({ where: { materialId: item.materialId, warehouseId: targetWarehouseId } })
        : await tx.stock.findFirst({ where: { materialId: item.materialId } });
      if (stock) {
        await tx.stock.update({
          where: { id: stock.id },
          data: { quantity: stock.quantity + qty, lastInDate: new Date() },
        });
        warehouseId = stock.warehouseId;
      } else {
        const wh = targetWarehouseId ?? (await tx.warehouse.findFirst({ where: { status: 1 } }))?.id ?? 1;
        await tx.stock.create({
          data: {
            materialId: item.materialId,
            warehouseId: wh,
            quantity: qty,
            lastInDate: new Date(),
          },
        });
        warehouseId = wh;
      }

      const resolvedBatchNo = await applyBatchIn(tx, item.material, warehouseId, receiptsByItem.get(item.id)?.batchNo, qty);

      // 库存流水
      await tx.stockRecord.create({
        data: {
          materialId: item.materialId,
          warehouseId,
          type: "in",
          quantity: qty,
          batchNo: resolvedBatchNo,
          relatedType: "PurchaseOrder",
          relatedId: po.id,
          transactionTypeId: receiptType?.id,
          documentNo: po.orderNo,
          lineNo: idx + 1,
          location: options?.location || null,
          effectiveDate: options?.effectiveDate ? new Date(options.effectiveDate) : null,
          operatorId: userId,
        },
      });
    }

    // 汇总状态：全部收完→received，否则→partial_received
    const updatedItems = await tx.purchaseOrderItem.findMany({ where: { orderId: id } });
    const allReceived = updatedItems.every((it) => it.receivedQty >= it.quantity);

    return tx.purchaseOrder.update({
      where: { id },
      data: { status: allReceived ? "received" : "partial_received" },
    });
  });
}

// ===== 到货跟踪 =====
export async function getArrivalTracking() {
  const items = await prisma.purchaseOrderItem.findMany({
    where: {
      status: { in: ["pending", "partial_received"] },
      order: { status: { not: "cancelled" } },
    },
    include: {
      order: { include: { supplier: { select: { id: true, name: true } } } },
      material: { select: { id: true, code: true, name: true, unit: true } },
    },
    orderBy: [{ expectedDate: "asc" }],
  });

  const today = new Date();
  return items.map((item) => ({
    id: item.id,
    orderNo: item.order.orderNo,
    supplierName: item.order.supplier?.name ?? "未指定",
    materialCode: item.material.code,
    materialName: item.material.name,
    quantity: item.quantity,
    receivedQty: item.receivedQty,
    remainingQty: item.quantity - item.receivedQty,
    expectedDate: item.expectedDate,
    status: item.status,
    isOverdue: item.expectedDate ? item.expectedDate < today : false,
  }));
}
// 采购员下拉：采购人员角色的启用用户
export async function listBuyers() {
  return prisma.user.findMany({
    where: { status: 1, userRoles: { some: { role: { code: "PURCHASE" } } } },
    select: { id: true, username: true, realName: true },
    orderBy: { id: "asc" },
  });
}

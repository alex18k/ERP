import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact } from "../utils/date";
import { retryOnDuplicate, lockOrderNo, ORDER_NO_LOCK } from "../utils/retry";
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
    id?: number;
    receivedQty?: number;
    materialId: number;
    quantity: number;
    unit?: string;
    unitPrice?: number;
    taxIncluded?: boolean;
    taxRate?: number;
    location?: string;
    expectedDate?: string;
    remark?: string;
    status?: string;
    sourceOrderNo?: string;
  }[];
}

export async function listPurchaseOrders(where: any) {
  const { orderNo, supplierId, status, receivable, materialKeyword, materialCode, materialName, specification, page = 1, pageSize = 20 } = where;
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

  // 收货列表：仅已确认的采购单、且明细为【空白状态且未收完】的行才列出（明细status空白才参与MRP/收货）
  if (receivable) {
    filters.status = "confirmed";
    const prev = filters.items as any;
    filters.items = {
      some: {
        ...(prev?.some || {}),
        status: "",
        receivedQty: { lt: prisma.purchaseOrderItem.fields.quantity },
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

  const totalAmount = data.items.reduce((s, i) => s + i.quantity * (i.unitPrice ?? 0), 0);
  const settleMethod = data.settleMethod ?? supplier?.settleMethod ?? null;

  // 单号在事务内生成；并发撞 @unique 时整体重试并换单号
  return retryOnDuplicate(() =>
    prisma.$transaction(async (tx) => {
      await lockOrderNo(tx, ORDER_NO_LOCK.PO);
      const orderNo = await generatePurchaseOrderNo();
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
            status: item.status ?? "",
            remark: item.remark || null,
            sourceOrderNo: item.sourceOrderNo || null,
          },
        });
      }

      return tx.purchaseOrder.findUnique({ where: { id: po.id }, include: { items: true } });
    })
  );
}

export async function updatePurchaseOrder(id: number, data: PurchaseOrderInput) {
  const exists = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!exists) throw new Error("采购单不存在");
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

  const existingItems = await prisma.purchaseOrderItem.findMany({ where: { orderId: id } });
  const receivedById = new Map(existingItems.map((it) => [it.id, it.receivedQty]));

  // 已收货明细的数量不能再改小，否则会出现 已收 > 订购 的矛盾数据
  for (const item of data.items) {
    if (!item.id) continue;
    const alreadyReceived = receivedById.get(item.id) ?? 0;
    if (item.quantity < alreadyReceived) {
      throw new Error(`明细「${item.materialId ?? item.id}」已收货 ${alreadyReceived}，数量不能小于已收数量`);
    }
  }

  return prisma.$transaction(async (tx) => {
    await tx.purchaseOrderItem.deleteMany({ where: { orderId: id } });
    for (const item of data.items) {
      await tx.purchaseOrderItem.create({
        data: {
          orderId: id,
          materialId: item.materialId,
          quantity: item.quantity,
          receivedQty: item.id ? (receivedById.get(item.id) ?? 0) : 0,
          unit: item.unit || null,
          unitPrice: item.unitPrice ?? 0,
          amount: item.quantity * (item.unitPrice ?? 0),
          taxIncluded: item.taxIncluded ?? false,
          taxRate: item.taxRate ?? 0,
          location: item.location || null,
          expectedDate: item.expectedDate ? new Date(item.expectedDate) : null,
          status: item.status ?? "",
          remark: item.remark || null,
          sourceOrderNo: item.sourceOrderNo || null,
        },
      });
    }

    // 主表状态不随明细编辑自动推算，仅由维护操作（确认/取消等）显式控制

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

const MAINTAINABLE_STATUSES = ["draft", "confirmed"];

// 主表状态仅两种：草稿 / 已确认；已确认才可收货与参与MRP，已收货等进度全部由明细状态体现
export async function updatePurchaseOrderStatus(id: number, status: string) {
  if (!MAINTAINABLE_STATUSES.includes(status)) {
    throw new Error("仅支持草稿、已确认两种状态");
  }
  const exists = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!exists) throw new Error("采购单不存在");
  if (exists.status === status) return exists;

  // 已收货订单不能退回草稿：收货已入账库存、RCT-PO 流水、MRP 在途口径会与库存脱节
  if (status === "draft") {
    const receivedItems = await prisma.purchaseOrderItem.findMany({
      where: { orderId: id, receivedQty: { gt: 0 } },
      select: { id: true },
    });
    if (receivedItems.length > 0) throw new Error("该采购单已收货，不能退回草稿");
  }

  return prisma.purchaseOrder.update({ where: { id }, data: { status } });
}

// 仅允许删除草稿且无收货记录的采购单（连带删明细）；已确认/已收货保留追溯
// 由采购建议转换来的明细，删除后把建议退回待处理，便于重新生成
export async function deletePurchaseOrder(id: number) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: { select: { receivedQty: true } } },
  });
  if (!po) throw new Error("采购单不存在");
  if (po.status !== "draft") throw new Error("仅草稿状态的采购单可删除");
  if (po.items.some((it) => (it.receivedQty ?? 0) > 0)) throw new Error("该采购单已有收货记录，不能删除");

  await prisma.$transaction([
    prisma.purchaseOrderItem.deleteMany({ where: { orderId: id } }),
    prisma.purchaseSuggestion.updateMany({
      where: { convertedOrderId: id },
      data: { status: "pending", convertedOrderId: null },
    }),
    prisma.purchaseOrder.delete({ where: { id } }),
  ]);
  return { id };
}

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

  // 仅已确认的采购单可收货；明细状态只有空白（可收）/关闭/取消，收货进度由 receivedQty 体现
  if (po.status !== "confirmed") throw new Error("仅已确认的采购单可收货");

  const NON_RECEIVABLE = ["cancelled", "closed"];
  const hasReceivable = po.items.some((it) => !NON_RECEIVABLE.includes(it.status) && it.receivedQty < it.quantity);
  if (!hasReceivable) throw new Error("采购单没有可收货的明细");

  const receiptType = await prisma.stockTransactionType.findUnique({ where: { code: "RCT-PO" } });

  // 本次各明细的收货数量：传了 receipts 用传入值，否则默认收完剩余
  const receiptsByItem = new Map<number, { quantity: number; batchNo?: string }>();
  if (receipts && receipts.length > 0) {
    for (const r of receipts) {
      if (r.quantity <= 0) continue;
      const target = po.items.find((it) => it.id === r.itemId);
      if (target && NON_RECEIVABLE.includes(target.status)) {
        throw new Error(`明细「${target.material?.name ?? target.id}」状态为「${target.status}」，不能收货`);
      }
      receiptsByItem.set(r.itemId, { quantity: r.quantity, batchNo: r.batchNo });
    }
  } else {
    for (const it of po.items) {
      if (NON_RECEIVABLE.includes(it.status)) continue;
      receiptsByItem.set(it.id, { quantity: it.quantity - it.receivedQty });
    }
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
      if (NON_RECEIVABLE.includes(item.status)) throw new Error(`明细「${item.material?.name ?? item.id}」状态为「${item.status}」，不能收货`);

      const remaining = item.quantity - item.receivedQty;
      if (qty > remaining) {
        throw new Error(`收货数量不能超过未收数量（${remaining}）`);
      }

      // 原子累加收货量：写入时校验 receivedQty + qty <= quantity，并发下不会超收
      const updatedRows = await tx.$executeRaw`
        UPDATE "PurchaseOrderItem"
        SET "receivedQty" = "receivedQty" + ${qty}
        WHERE "id" = ${item.id}
          AND "receivedQty" + ${qty} <= "quantity"
          AND COALESCE("status", '') NOT IN ('cancelled', 'closed')`;
      if (updatedRows === 0) {
        throw new Error(`收货数量不能超过未收数量（${item.quantity - item.receivedQty}）或明细状态已变更`);
      }

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
          data: { quantity: { increment: qty }, lastInDate: new Date() },
        });
        warehouseId = stock.warehouseId;
      } else {
        const wh = targetWarehouseId ?? (await tx.warehouse.findFirst({ where: { status: 1 } }))?.id ?? 1;
        await tx.stock.upsert({
          where: { materialId_warehouseId: { materialId: item.materialId, warehouseId: wh } },
          create: {
            materialId: item.materialId,
            warehouseId: wh,
            quantity: qty,
            lastInDate: new Date(),
          },
          update: { quantity: { increment: qty }, lastInDate: new Date() },
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

    // 主表状态不随收货自动更新，仅明细状态反映收货进度
    return tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
  });
}

// ===== 到货跟踪 =====
export async function getArrivalTracking() {
  const items = await prisma.purchaseOrderItem.findMany({
    where: {
      status: "",
      receivedQty: { lt: prisma.purchaseOrderItem.fields.quantity },
      order: { status: "confirmed" },
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

// ===== 采购收货记录（来源：采购单收货写入的库存流水）=====
export async function listPurchaseReceipts(where: any) {
  const { orderNo, materialKeyword, startDate, endDate, page = 1, pageSize = 20 } = where;

  const filters: Prisma.StockRecordWhereInput = { relatedType: "PurchaseOrder", type: "in" };
  if (orderNo) filters.documentNo = { contains: orderNo };
  if (materialKeyword) {
    filters.material = {
      OR: [
        { code: { contains: materialKeyword } },
        { name: { contains: materialKeyword } },
        { specification: { contains: materialKeyword } },
      ],
    };
  }
  if (startDate || endDate) {
    filters.createdAt = {
      gte: startDate ? new Date(startDate) : undefined,
      lte: endDate ? new Date(endDate + "T23:59:59.999") : undefined,
    };
  }

  const [total, items] = await Promise.all([
    prisma.stockRecord.count({ where: filters }),
    prisma.stockRecord.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, specification: true, unit: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        operator: { select: { id: true, realName: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  const orderIds = [...new Set(items.map((i) => i.relatedId).filter((x): x is number => !!x))];
  const orders = orderIds.length
    ? await prisma.purchaseOrder.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, status: true, supplier: { select: { name: true } } },
      })
    : [];
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  return {
    total,
    page: Number(page),
    pageSize: Number(pageSize),
    items: items.map((i) => ({
      ...i,
      supplierName: i.relatedId ? orderMap.get(i.relatedId)?.supplier?.name ?? null : null,
      orderStatus: i.relatedId ? orderMap.get(i.relatedId)?.status ?? null : null,
    })),
  };
}

import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { parseQueryConditions } from "../utils/queryConditions";
import { buildPrismaQueryWhere, type PrismaQueryFieldDefinition } from "../utils/prismaQueryConditions";
import { localDateCompact, parseLocalDateStart, parseLocalDateEnd, startOfLocalDay } from "../utils/date";
import { retryOnDuplicate, lockOrderNo, ORDER_NO_LOCK } from "../utils/retry";
import { applyBatchIn, applyBatchOut, addStock, resolveBinId, generateDocNo } from "./stock.service";
import { resolveUnitRateMap, toBaseQty } from "../utils/unit";

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
    line?: number;
  }[];
}

/** 高级查询字段白名单（采购订单：表头 + 明细） */
export const PURCHASE_QUERY_FIELDS: Record<string, PrismaQueryFieldDefinition> = {
  orderNo: { type: "text", column: "orderNo" },
  supplierName: { type: "text", column: "name", relation: { name: "supplier" } },
  status: {
    type: "enum",
    column: "status",
    options: [
      { label: "草稿", value: "draft" },
      { label: "已确认", value: "confirmed" },
    ],
  },
  orderDate: { type: "date", column: "orderDate" },
  expectedDate: { type: "date", column: "expectedDate" },
  buyer: { type: "text", column: "buyer" },
  settleMethod: { type: "text", column: "settleMethod" },
  totalAmount: { type: "number", column: "totalAmount" },
  remark: { type: "text", column: "remark" },
  createdAt: { type: "date", column: "createdAt" },
  // 明细行条件（items 为一对多，同一订单的多个明细条件合并到同一个 items.some）
  materialCode: { type: "text", column: "code", relation: { name: "items", toMany: true, inner: ["material"] } },
  materialName: { type: "text", column: "name", relation: { name: "items", toMany: true, inner: ["material"] } },
  specification: { type: "text", column: "specification", relation: { name: "items", toMany: true, inner: ["material"] } },
  line: { type: "number", column: "line", relation: { name: "items", toMany: true } },
  quantity: { type: "number", column: "quantity", relation: { name: "items", toMany: true } },
  receivedQty: { type: "number", column: "receivedQty", relation: { name: "items", toMany: true } },
  unitPrice: { type: "number", column: "unitPrice", relation: { name: "items", toMany: true } },
  itemRemark: { type: "text", column: "remark", relation: { name: "items", toMany: true } },
};

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

  // 高级查询条件（与基础条件 AND 叠加）
  const advancedConditions = parseQueryConditions(where.conditions);
  if (advancedConditions.length) {
    const advanced = buildPrismaQueryWhere(advancedConditions, PURCHASE_QUERY_FIELDS);
    filters.AND = [...(Array.isArray(filters.AND) ? filters.AND : []), advanced];
  }

  const [total, items] = await Promise.all([
    prisma.purchaseOrder.count({ where: filters }),
    prisma.purchaseOrder.findMany({
      where: filters,
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        items: { include: { material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true, batchManaged: true } } }, orderBy: { line: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  const returnedMap = await calcReturnedBaseByItem(
    prisma,
    items.map((o) => o.id),
    items.flatMap((o) => o.items.map((it) => ({ id: it.id, orderId: o.id, line: it.line ?? 0, materialId: it.materialId })))
  );
  const itemsWithReturned = items.map((o) => ({
    ...o,
    items: o.items.map((it) => {
      const rate = (it as any).conversionRate || 1;
      return { ...it, returnedQty: Math.round(((returnedMap.get(it.id) ?? 0) / rate) * 1e6) / 1e6 };
    }),
  }));

  return { total, page: Number(page), pageSize: Number(pageSize), items: itemsWithReturned };
}

// 轻量下拉选项：仅返回单号与供应商名，供采购单维护页选单/远程搜索使用，避免拉取整单+明细
export async function listPurchaseOrderOptions(where: any) {
  const { keyword, limit = 50 } = where || {};
  const filters: Prisma.PurchaseOrderWhereInput = {};
  const kw = keyword ? String(keyword).trim() : "";
  if (kw) {
    filters.OR = [
      { orderNo: { contains: kw } },
      { supplier: { name: { contains: kw } } },
    ];
  }
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const items = await prisma.purchaseOrder.findMany({
    where: filters,
    select: { id: true, orderNo: true, supplier: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return items.map((o) => ({ id: o.id, orderNo: o.orderNo, supplier: o.supplier?.name || "未指定" }));
}

export async function getPurchaseOrder(id: number) {
  return prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { include: { material: true }, orderBy: { line: "asc" } },
    },
  });
}

// 明细行号必填（正整数）且不可重复，与销售订单明细一致
function assertItemLines(items: { line?: number }[]) {
  const seen = new Set<number>();
  items.forEach((item, idx) => {
    const lineNo = Number(item.line);
    if (!Number.isInteger(lineNo) || lineNo < 1) {
      throw new Error(`第 ${idx + 1} 行明细未填写行号`);
    }
    if (seen.has(lineNo)) throw new Error(`行号 ${lineNo} 重复`);
    seen.add(lineNo);
  });
}

// 明细数值校验：必须选择物料、数量为正、单价不为负
function assertItemsPositive(items: PurchaseOrderInput["items"]) {
  items.forEach((item, idx) => {
    const line = Number(item.line) || idx + 1;
    if (!item.materialId) throw new Error(`第 ${line} 行明细未选择物料`);
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`第 ${line} 行明细数量必须大于 0`);
    const price = Number(item.unitPrice ?? 0);
    if (!Number.isFinite(price) || price < 0) throw new Error(`第 ${line} 行明细单价不能为负数`);
  });
}

// 供应商必须存在且未停用
async function resolveActiveSupplier(supplierId: number | null | undefined) {
  if (!supplierId) throw new Error("请选择供应商");
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new Error("供应商不存在");
  if (supplier.status !== 1) throw new Error("供应商已停用，不能下单");
  return supplier;
}

// 订货日期不得晚于截止日期
function assertDateOrder(orderDate?: string, expectedDate?: string) {
  if (orderDate && expectedDate && new Date(expectedDate) < new Date(orderDate)) {
    throw new Error("截止日期不能早于订货日期");
  }
}

export async function createPurchaseOrder(data: PurchaseOrderInput, userId: number) {
  if (!data.items || data.items.length === 0) throw new Error("采购单至少需要一个明细");
  if (!data.orderDate) throw new Error("请选择订货日期");
  if (!data.expectedDate) throw new Error("请选择截止日期");
  if (!data.buyer) throw new Error("请输入采购员");
  assertItemLines(data.items);
  assertItemsPositive(data.items);
  assertDateOrder(data.orderDate, data.expectedDate);
  const supplier = await resolveActiveSupplier(data.supplierId);

  const totalAmount = data.items.reduce((s, i) => s + i.quantity * (i.unitPrice ?? 0), 0);
  const settleMethod = data.settleMethod ?? supplier?.settleMethod ?? null;

  // 计量单位换算率（按明细行的计量单位解析，折算为基本单位数量入库/统计）
  const rateMap = await resolveUnitRateMap(data.items.map((i) => ({ materialId: i.materialId, unit: i.unit })));

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
          status: "draft",
          remark: data.remark,
          createdBy: userId,
        },
      });

      for (const item of data.items) {
        const rate = rateMap.get(item.materialId)?.rate ?? 1;
        await tx.purchaseOrderItem.create({
          data: {
            orderId: po.id,
            materialId: item.materialId,
            line: Number(item.line),
            quantity: item.quantity,
            unit: item.unit || null,
            conversionRate: rate,
            baseQty: toBaseQty(item.quantity, rate),
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
  assertItemLines(data.items);
  assertItemsPositive(data.items);
  assertDateOrder(data.orderDate, data.expectedDate);

  const supplier = await resolveActiveSupplier(data.supplierId);
  if (exists.status !== "draft" && exists.supplierId !== data.supplierId) {
    throw new Error("已确认的采购单不能更换供应商");
  }

  const totalAmount = data.items.reduce((s, i) => s + i.quantity * (i.unitPrice ?? 0), 0);
  // 供应商变更时自动继承新供应商的结算方式；否则保留原单值
  const settleMethod =
    data.settleMethod !== undefined && data.settleMethod !== null
      ? data.settleMethod
      : exists.supplierId !== data.supplierId
        ? (supplier?.settleMethod ?? null)
        : exists.settleMethod;

  // 计量单位换算率（按明细行的计量单位解析）
  const rateMap = await resolveUnitRateMap(data.items.map((i) => ({ materialId: i.materialId, unit: i.unit })));

  return prisma.$transaction(async (tx) => {
    // 锁定本单明细行：与「收货」的原子 UPDATE 串行化，读取最新 receivedQty，避免丢更新
    await tx.$executeRaw`SELECT "id" FROM "PurchaseOrderItem" WHERE "orderId" = ${id} FOR UPDATE`;

    const existingItems = await tx.purchaseOrderItem.findMany({ where: { orderId: id } });
    const existingById = new Map(existingItems.map((it) => [it.id, it]));
    const receivedById = new Map(existingItems.map((it) => [it.id, it.receivedQty]));

    // 明细 id 不可重复：重复会把同一行的 receivedQty 复制到多条新行，造成已收量翻倍
    const seenItemIds = new Set<number>();
    for (const item of data.items) {
      if (!item.id) continue;
      if (!existingById.has(item.id)) throw new Error(`明细 ${item.id} 不属于该采购单，请刷新后重试`);
      if (seenItemIds.has(item.id)) throw new Error(`采购明细重复提交（id ${item.id}）`);
      seenItemIds.add(item.id);
    }

    // 已收货明细保护：有收货记录的行不允许删除
    const keptIds = new Set<number>();
    for (const item of data.items) {
      if (item.id && existingById.has(item.id)) keptIds.add(item.id);
    }
    for (const old of existingItems) {
      if (!keptIds.has(old.id) && (old.receivedQty ?? 0) > 1e-6) {
        throw new Error(`行号 ${old.line} 的明细已收货 ${old.receivedQty}，不能删除`);
      }
    }

    // 已收货明细的数量不能再改小，且不能更换物料/计量单位（已收量按基本单位记账，换了会对错物料）
    data.items.forEach((item) => {
      const old = item.id ? existingById.get(item.id) : undefined;
      const alreadyReceived = old?.receivedQty ?? 0;
      if (alreadyReceived > 1e-6) {
        if (old!.materialId !== item.materialId) {
          throw new Error(`行号 ${old!.line} 的明细已收货 ${alreadyReceived}，不能更换物料`);
        }
        if ((old!.unit || "") !== (item.unit || "")) {
          throw new Error(`行号 ${old!.line} 的明细已收货 ${alreadyReceived}，不能变更计量单位`);
        }
        if (Number(item.line) !== old!.line) {
          throw new Error(`行号 ${old!.line} 的明细已收货 ${alreadyReceived}，不能变更行号`);
        }
        if (item.quantity < alreadyReceived - 1e-6) {
          throw new Error(`行号 ${old!.line} 的明细已收货 ${alreadyReceived}，数量不能小于已收量`);
        }
      }
    });

    await tx.purchaseOrderItem.deleteMany({ where: { orderId: id } });
    // 整单重建会更换明细 id；记录新旧 id 映射，重建后把按明细退货的流水改挂到新 id，
    // 否则 PurchaseReturnItem.relatedId 会变成孤儿，已退数量被重置并可重复退货。
    const newItemIdByKey = new Map<string, number>();
    for (const item of data.items) {
      const rate = rateMap.get(item.materialId)?.rate ?? 1;
      const created = await tx.purchaseOrderItem.create({
        data: {
          orderId: id,
          materialId: item.materialId,
          line: Number(item.line),
          quantity: item.quantity,
          receivedQty: item.id ? (receivedById.get(item.id) ?? 0) : 0,
          unit: item.unit || null,
          conversionRate: rate,
          baseQty: toBaseQty(item.quantity, rate),
          unitPrice: item.unitPrice ?? 0,
          amount: item.quantity * (item.unitPrice ?? 0),
          taxIncluded: item.taxIncluded ?? false,
          taxRate: item.taxRate ?? 0,
          location: item.location || null,
          expectedDate: item.expectedDate ? new Date(item.expectedDate) : null,
          // 保留行的明细状态（空白/关闭/取消）不因编辑被重置为可收货
          status: item.status !== undefined ? item.status : item.id ? (existingById.get(item.id)?.status ?? "") : "",
          remark: item.remark || null,
          sourceOrderNo: item.sourceOrderNo || null,
          // 整单重建时保留 MRP 采购建议关联（明细 id 会变，但建议链接不能丢）
          suggestionId: item.id ? (existingById.get(item.id)?.suggestionId ?? null) : null,
        },
      });
      newItemIdByKey.set(`${Number(item.line)}|${item.materialId}|${item.unit || ""}`, created.id);
    }

    // 把旧的按采购明细退货流水改挂到新明细 id（已收货行的行号/物料/单位禁止变更，键唯一）
    for (const old of existingItems) {
      if ((old.receivedQty ?? 0) <= 1e-6) continue;
      const newId = newItemIdByKey.get(`${old.line}|${old.materialId}|${old.unit || ""}`);
      if (!newId || newId === old.id) continue;
      await tx.stockRecord.updateMany({
        where: { relatedType: "PurchaseReturnItem", relatedId: old.id, type: "out" },
        data: { relatedId: newId },
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

// 确认前必填项校验（草稿保存与状态流转共用，避免绕过 /confirm 直接置为已确认）
function assertConfirmable(po: {
  supplierId: number | null;
  orderDate: Date | null;
  expectedDate: Date | null;
  buyer: string | null;
  items: { materialId: number; quantity: number }[];
}) {
  if (!po.supplierId) throw new Error("请先选择供应商");
  if (!po.orderDate) throw new Error("请先选择订货日期");
  if (!po.expectedDate) throw new Error("请先选择截止日期");
  if (!po.buyer) throw new Error("请先填写采购员");
  if (!po.items || po.items.length === 0) throw new Error("采购单至少需要一个明细");
  for (const it of po.items) {
    if (!it.materialId) throw new Error("采购明细缺少物料");
    if (!it.quantity || it.quantity <= 0) throw new Error("采购明细数量必须大于0");
  }
}

export async function confirmPurchaseOrder(id: number) {
  const exists = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
  if (!exists) throw new Error("采购单不存在");
  if (exists.status !== "draft") throw new Error("仅草稿状态可确认");

  assertConfirmable(exists);

  return prisma.purchaseOrder.update({ where: { id }, data: { status: "confirmed" } });
}

const MAINTAINABLE_STATUSES = ["draft", "confirmed"];

// 主表状态仅两种：草稿 / 已确认；已确认才可收货与参与MRP，已收货等进度全部由明细状态体现
export async function updatePurchaseOrderStatus(id: number, status: string) {
  if (!MAINTAINABLE_STATUSES.includes(status)) {
    throw new Error("仅支持草稿、已确认两种状态");
  }
  const exists = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
  if (!exists) throw new Error("采购单不存在");
  if (exists.status === status) return exists;

  // 置为已确认时同样校验必填项，避免绕过 /confirm 把 MRP 草稿直接确认
  if (status === "confirmed") assertConfirmable(exists);

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
  receipts?: { itemId: number; quantity: number; batchNo?: string; warehouseId?: number; binId?: number | null }[],
  options?: { effectiveDate?: string; location?: string; binId?: number | null; deliveryNo?: string; keeper?: string; remark?: string }
) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: { include: { material: true } }, supplier: { select: { code: true } } },
  });
  if (!po) throw new Error("采购单不存在");

  // 仅已确认的采购单可收货；明细状态只有空白（可收）/关闭/取消，收货进度由 receivedQty 体现
  if (po.status !== "confirmed") throw new Error("仅已确认的采购单可收货");

  const NON_RECEIVABLE = ["cancelled", "closed"];
  const hasReceivable = po.items.some((it) => !NON_RECEIVABLE.includes(it.status) && it.receivedQty < it.quantity);
  if (!hasReceivable) throw new Error("采购单没有可收货的明细");

  const receiptType = await prisma.stockTransactionType.findUnique({ where: { code: "RCT-PO" } });

  // 本次各明细的收货数量：传了 receipts 用传入值，否则默认收完剩余
  const receiptsByItem = new Map<number, { quantity: number; batchNo?: string; warehouseId?: number; binId?: number | null }>();
  if (receipts && receipts.length > 0) {
    for (const r of receipts) {
      if (!Number.isFinite(r.quantity)) throw new Error("收货数量无效");
      if (r.quantity <= 0) continue;
      const target = po.items.find((it) => it.id === r.itemId);
      if (!target) throw new Error(`收货明细 ${r.itemId} 不属于该采购单`);
      if (receiptsByItem.has(r.itemId)) throw new Error(`收货明细 ${r.itemId} 重复`);
      if (NON_RECEIVABLE.includes(target.status)) {
        throw new Error(`明细「${target.material?.name ?? target.id}」状态为「${target.status}」，不能收货`);
      }
      receiptsByItem.set(r.itemId, { quantity: r.quantity, batchNo: r.batchNo, warehouseId: r.warehouseId, binId: r.binId });
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
  if (options?.location) {
    if (!locationWarehouse) throw new Error(`库位「${options.location}」不存在`);
    if (locationWarehouse.status !== 1) throw new Error(`库位「${options.location}」已停用，不能收货`);
  }

  return prisma.$transaction(async (tx) => {
    // 收货单号串行生成：同一次收货的多条流水共用一个号；前缀取事务类型“单据”配置，未配置回退 RC
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const receiptNo = await generateDocNo(tx, receiptType?.documentPrefix || "RC");

    // 移动加权平均基准：收货前该物料全部仓库的库存合计（qty）与当前平均成本（cost）
    const receiveMaterialIds = [...new Set(po.items.map((it) => it.materialId))];
    const stockRows = await tx.stock.findMany({
      where: { materialId: { in: receiveMaterialIds } },
      select: { materialId: true, quantity: true },
    });
    const avgQty = new Map<number, number>();
    for (const r of stockRows) avgQty.set(r.materialId, (avgQty.get(r.materialId) ?? 0) + r.quantity);
    const avgCost = new Map<number, number>();
    const materialRows = await tx.material.findMany({
      where: { id: { in: receiveMaterialIds } },
      select: { id: true, cost: true },
    });
    for (const m of materialRows) avgCost.set(m.id, m.cost ?? 0);
    for (const id of receiveMaterialIds) {
      if (!avgCost.has(id)) avgCost.set(id, 0);
    }

    for (const [idx, item] of po.items.entries()) {
      const qty = receiveMap.get(item.id) ?? 0;
      if (qty <= 0) continue;
      if (NON_RECEIVABLE.includes(item.status)) throw new Error(`明细「${item.material?.name ?? item.id}」状态为「${item.status}」，不能收货`);

      const remaining = item.quantity - item.receivedQty;
      if (qty > remaining) {
        throw new Error(`收货数量不能超过未收数量（${remaining}）`);
      }

      // 换算为基本单位入库（换算率取下单时快照）
      const baseQty = toBaseQty(qty, item.conversionRate || 1);

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

      // 采购价格与成本：
      //  - price = 最近一次采购单价（基本单位，覆盖写）
      //  - cost  = 移动加权平均成本（按收货前库存结存加权）
      if (item.unitPrice != null && item.unitPrice > 0) {
        const rate = item.conversionRate || 1;
        const basePrice = rate > 0 ? item.unitPrice / rate : item.unitPrice;
        const prevQty = avgQty.get(item.materialId) ?? 0;
        const prevCost = avgCost.get(item.materialId) ?? 0;
        const denom = prevQty + baseQty;
        const newCost = denom > 0 ? (prevQty * prevCost + baseQty * basePrice) / denom : basePrice;
        avgQty.set(item.materialId, denom);
        avgCost.set(item.materialId, newCost);
        await tx.material.update({
          where: { id: item.materialId },
          data: { price: basePrice, cost: Math.round(newCost * 10000) / 10000 },
        });
      }

      // 更新库存：优先用明细行指定的库位；否则整单库位；再按明细库位；最后回退已有库存仓库/首个启用仓
      const lineReceipt = receiptsByItem.get(item.id);
      let warehouseId = lineReceipt?.warehouseId ?? locationWarehouse?.id ?? null;
      let warehouse = warehouseId ? await tx.warehouse.findUnique({ where: { id: warehouseId } }) : null;
      if (lineReceipt?.warehouseId) {
        if (!warehouse) throw new Error("库位不存在");
        if (warehouse.status !== 1) throw new Error(`库位「${warehouse.code}」已停用，不能收货`);
      }
      if (!warehouseId && item.location) {
        // 明细库位只在启用仓库中匹配；失效/停用库位回退到已有库存仓库或首个启用仓
        const byLocation = await tx.warehouse.findFirst({ where: { code: item.location, status: 1 } });
        warehouseId = byLocation?.id ?? null;
        warehouse = byLocation;
      }
      if (!warehouseId) {
        // 回退仓库只能选启用仓库，避免把库存收进停用仓库
        const anyStock = await tx.stock.findFirst({
          where: { materialId: item.materialId, quantity: { gt: 0 }, warehouse: { status: 1 } },
          orderBy: { quantity: "desc" },
        });
        warehouseId = anyStock?.warehouseId ?? (await tx.warehouse.findFirst({ where: { status: 1 } }))?.id ?? null;
        warehouse = warehouseId ? await tx.warehouse.findUnique({ where: { id: warehouseId } }) : null;
      }
      if (!warehouseId || !warehouse) throw new Error("没有可用的仓库，无法入库");
      // 明细行未指定货位时，整单货位只在同一仓库下生效
      const binId = await resolveBinId(tx, warehouse, lineReceipt?.binId ?? (warehouseId === locationWarehouse?.id ? options?.binId : undefined));
      await addStock(tx, item.materialId, warehouseId, binId, baseQty);

      const resolvedBatchNo = await applyBatchIn(tx, item.material, warehouseId, binId, receiptsByItem.get(item.id)?.batchNo, baseQty);

      // 库存流水
      await tx.stockRecord.create({
        data: {
          materialId: item.materialId,
          warehouseId,
          binId,
          type: "in",
          quantity: baseQty,
          batchNo: resolvedBatchNo,
          relatedType: "PurchaseOrder",
          relatedId: po.id,
          transactionTypeId: receiptType?.id,
          documentNo: receiptNo,
          orderNo: po.orderNo,
          deliveryNo: options?.deliveryNo || null,
          address: po.supplier?.code || null,
          buyer: po.buyer || null,
          price: item.unitPrice ?? null,
          um: item.unit || null,
          keeper: options?.keeper || null,
          remark: options?.remark || null,
          lineNo: item.line ?? idx + 1,
          location: warehouse.code,
          effectiveDate: options?.effectiveDate ? new Date(options.effectiveDate) : new Date(),
          operatorId: userId,
        },
      });
    }

    // 主表状态不随收货自动更新，仅明细状态反映收货进度
    const order = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    return { ...order, receiptNo };
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

  const todayStart = startOfLocalDay();
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
    isOverdue: item.expectedDate ? item.expectedDate < todayStart : false,
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

// 采购收货仓管员下拉：历史收货记录中使用过的仓管员
export async function listReceiptKeepers() {
  const rows = await prisma.stockRecord.findMany({
    where: { relatedType: "PurchaseOrder", type: "in", keeper: { not: null } },
    select: { keeper: true },
    distinct: ["keeper"],
    orderBy: { keeper: "asc" },
  });
  return rows.map((r) => r.keeper).filter((k): k is string => !!k && k.trim() !== "");
}

// ===== 采购收货记录（来源：采购单收货写入的库存流水，含采购退货）=====
export async function listPurchaseReceipts(where: any) {
  const { orderNo, receiptNo, materialKeyword, startDate, endDate, page = 1, pageSize = 20 } = where;

  const and: Prisma.StockRecordWhereInput[] = [
    {
      OR: [
        { relatedType: "PurchaseOrder", type: "in" },
        { type: "out", relatedType: { in: ["PurchaseReturn", "PurchaseReturnItem"] } },
      ],
    },
  ];
  // 单号筛选：收货单号/退货单号都是库存流水的 documentNo（历史数据可能是采购单号）
  if (receiptNo) and.push({ documentNo: { contains: receiptNo } });
  if (orderNo) {
    const matched = await prisma.purchaseOrder.findMany({ where: { orderNo: { contains: orderNo } }, select: { id: true } });
    and.push({ OR: [{ relatedId: { in: matched.map((o) => o.id) } }, { orderNo: { contains: orderNo } }] });
  }
  if (materialKeyword) {
    and.push({
      material: {
        OR: [
          { code: { contains: materialKeyword } },
          { name: { contains: materialKeyword } },
          { specification: { contains: materialKeyword } },
        ],
      },
    });
  }
  if (startDate || endDate) {
    const range = {
      gte: startDate ? parseLocalDateStart(startDate) : undefined,
      lte: endDate ? parseLocalDateEnd(endDate) : undefined,
    };
    // 展示生效日期，优先按生效日期筛选；历史流水回退创建时间
    and.push({ OR: [{ effectiveDate: range }, { effectiveDate: null, createdAt: range }] });
  }
  const filters: Prisma.StockRecordWhereInput = { AND: and };
  const pageNum = Math.max(1, Number(page) || 1);
  const sizeNum = Math.min(1000, Math.max(1, Number(pageSize) || 20));

  const [total, items] = await Promise.all([
    prisma.stockRecord.count({ where: filters }),
    prisma.stockRecord.findMany({
      where: filters,
      include: {
        material: { select: { id: true, code: true, name: true, specification: true, unit: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        bin: { select: { id: true, code: true, name: true } },
        operator: { select: { id: true, realName: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * sizeNum,
      take: sizeNum,
    }),
  ]);

  const orderIds = [...new Set(items.filter((i) => i.type === "in").map((i) => i.relatedId).filter((x): x is number => !!x))];
  const orderNos = [...new Set(items.map((i) => i.orderNo).filter((x): x is string => !!x))];
  const orders =
    orderIds.length || orderNos.length
      ? await prisma.purchaseOrder.findMany({
        where: { OR: [{ id: { in: orderIds } }, { orderNo: { in: orderNos } }] },
        select: {
          id: true,
          orderNo: true,
          status: true,
          buyer: true,
          settleMethod: true,
          taxIncluded: true,
          taxRate: true,
          supplier: { select: { name: true } },
          items: { select: { line: true, materialId: true, unitPrice: true, taxIncluded: true, taxRate: true, conversionRate: true } },
        },
      })
      : [];
  const orderMapById = new Map(orders.map((o) => [o.id, o]));
  const orderMapByNo = new Map(orders.map((o) => [o.orderNo, o]));

  // 已退货数量：同时统计 PurchaseReturn（按收货流水）与 PurchaseReturnItem（按采购明细），口径与退货接口一致
  const returnedMap = await calcReturnedByReceipt(
    prisma,
    items
      .filter((i) => i.type === "in")
      .map((i) => ({
        id: i.id,
        relatedId: i.relatedId ?? null,
        lineNo: i.lineNo ?? null,
        materialId: i.materialId,
        quantity: i.quantity,
        createdAt: i.createdAt,
      }))
  );

  return {
    total,
    page: pageNum,
    pageSize: sizeNum,
    items: items.map((i) => {
      const isReturn = i.type === "out";
      const order = (i.type === "in" ? orderMapById.get(i.relatedId ?? -1) : undefined) ?? (i.orderNo ? orderMapByNo.get(i.orderNo) : undefined);
      const returnedQty = returnedMap.get(i.id) ?? 0;
      const item =
        order?.items.find((it) => it.line === i.lineNo && it.materialId === i.materialId) ??
        order?.items.find((it) => it.materialId === i.materialId);
      const rate = item?.conversionRate || 1;
      // 收货数量 i.quantity 已是基本单位；单价统一折算为基本单位价，保证 数量×单价=金额
      const unitPrice = item?.unitPrice != null && rate > 0 ? item.unitPrice / rate : (item?.unitPrice ?? null);
      const amount = unitPrice != null ? Math.round(i.quantity * unitPrice * 100) / 100 : null;
      const taxIncluded = item?.taxIncluded ?? order?.taxIncluded ?? false;
      const taxRate = item?.taxRate ?? order?.taxRate ?? 0;
      const priceExcludingTax =
        unitPrice != null
          ? taxIncluded && taxRate > 0
            ? Math.round((unitPrice / (1 + taxRate / 100)) * 10000) / 10000
            : unitPrice
          : null;
      return {
        ...i,
        isReturn,
        recordKind: isReturn ? "return" : "receipt",
        receiptNo: i.documentNo,
        orderNo: order?.orderNo ?? i.orderNo ?? null,
        supplierName: order?.supplier?.name ?? null,
        orderStatus: order?.status ?? null,
        unitPrice,
        priceExcludingTax,
        amount,
        taxIncluded,
        taxRate,
        settleMethod: order?.settleMethod ?? null,
        buyer: order?.buyer ?? null,
        returnedQty,
        returnableQty: isReturn ? 0 : Math.max(0, i.quantity - returnedQty),
      };
    }),
  };
}

// 采购收货单据（按收货单号汇总）：主表 + 该单所有明细行
export async function listPurchaseReceiptDocuments(where: any) {
  const { orderNo, receiptNo, materialKeyword, startDate, endDate, page = 1, pageSize = 20 } = where;

  const filters: Prisma.StockRecordWhereInput = { relatedType: "PurchaseOrder", type: "in" };
  if (receiptNo) filters.documentNo = { contains: receiptNo };
  if (orderNo) {
    const matched = await prisma.purchaseOrder.findMany({ where: { orderNo: { contains: orderNo } }, select: { id: true } });
    filters.relatedId = { in: matched.map((o) => o.id) };
  }
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
    const range = {
      gte: startDate ? parseLocalDateStart(startDate) : undefined,
      lte: endDate ? parseLocalDateEnd(endDate) : undefined,
    };
    filters.OR = [{ effectiveDate: range }, { effectiveDate: null, createdAt: range }];
  }

  const grouped = await prisma.stockRecord.groupBy({
    by: ["documentNo"],
    where: filters,
    _sum: { quantity: true },
    _count: { _all: true },
    _max: { effectiveDate: true, createdAt: true },
  });
  const docs = grouped
    .filter((g) => !!g.documentNo)
    .sort((a, b) => {
      const at = (a._max.effectiveDate ?? a._max.createdAt)?.getTime() ?? 0;
      const bt = (b._max.effectiveDate ?? b._max.createdAt)?.getTime() ?? 0;
      return bt - at || String(b.documentNo).localeCompare(String(a.documentNo));
    });

  const pageNum = Math.max(1, Number(page) || 1);
  const sizeNum = Math.min(200, Math.max(1, Number(pageSize) || 20));
  const pageDocs = docs.slice((pageNum - 1) * sizeNum, pageNum * sizeNum);
  const docNos = pageDocs.map((d) => d.documentNo!).filter(Boolean);

  const lines = docNos.length
    ? await prisma.stockRecord.findMany({
        where: { ...filters, documentNo: { in: docNos } },
        include: {
          material: { select: { id: true, code: true, name: true, specification: true, unit: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          bin: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      })
    : [];

  const lineIds = lines.map((l) => l.id);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const returnRows = lineIds.length
    ? await prisma.stockRecord.findMany({
        where: { relatedType: "PurchaseReturn", type: "out", relatedId: { in: lineIds } },
        include: {
          material: { select: { code: true, name: true, specification: true, unit: true } },
          warehouse: { select: { name: true } },
          bin: { select: { name: true } },
          department: { select: { name: true } },
          operator: { select: { realName: true, username: true } },
        },
        orderBy: { id: "desc" },
      })
    : [];
  const returnsByDoc = new Map<string, any[]>();
  for (const r of returnRows) {
    if (!r.relatedId) continue;
    const receiptLine = lineById.get(r.relatedId);
    if (!receiptLine?.documentNo) continue;
    const docNo = receiptLine.documentNo;
    if (!returnsByDoc.has(docNo)) returnsByDoc.set(docNo, []);
    returnsByDoc.get(docNo)!.push({
      id: r.id,
      documentNo: r.documentNo,
      effectiveDate: r.effectiveDate,
      createdAt: r.createdAt,
      quantity: r.quantity,
      batchNo: r.batchNo,
      material: r.material,
      warehouseName: r.warehouse?.name ?? null,
      binName: r.bin?.name ?? null,
      departmentName: r.department?.name ?? null,
      handler: r.handler,
      operatorName: r.operator?.realName || r.operator?.username || null,
      remark: r.remark,
    });
  }

  // 已退货数量：订单退货（PurchaseReturnItem）按明细 FIFO 分摊到收货流水，再叠加按收货流水退货（PurchaseReturn）
  const returnedMap = await calcReturnedByReceipt(
    prisma,
    lines
      .filter((l) => l.type === "in")
      .map((l) => ({
        id: l.id,
        relatedId: l.relatedId ?? null,
        lineNo: l.lineNo ?? null,
        materialId: l.materialId,
        quantity: l.quantity,
        createdAt: l.createdAt,
      }))
  );

  const orderIds = [...new Set(lines.map((l) => l.relatedId).filter((x): x is number => !!x))];
  const orders = orderIds.length
    ? await prisma.purchaseOrder.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, orderNo: true, supplier: { select: { name: true } } },
      })
    : [];
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  const linesByDoc = new Map<string, any[]>();
  for (const l of lines) {
    const returnedQty = returnedMap.get(l.id) ?? 0;
    const line = { ...l, returnedQty, returnableQty: Math.max(0, l.quantity - returnedQty) };
    const key = l.documentNo!;
    if (!linesByDoc.has(key)) linesByDoc.set(key, []);
    linesByDoc.get(key)!.push(line);
  }

  const items = pageDocs.map((g) => {
    const docLines = linesByDoc.get(g.documentNo!) ?? [];
    const first = docLines[0];
    const order = first?.relatedId ? orderMap.get(first.relatedId) : undefined;
    return {
      documentNo: g.documentNo,
      receiptNo: g.documentNo,
      orderNo: order?.orderNo ?? first?.orderNo ?? null,
      supplierName: order?.supplier?.name ?? null,
      deliveryNo: first?.deliveryNo ?? null,
      effectiveDate: g._max.effectiveDate ?? first?.effectiveDate ?? first?.createdAt ?? null,
      lineCount: docLines.length,
      totalQty: docLines.reduce((s, l) => s + l.quantity, 0),
      returnedQty: docLines.reduce((s, l) => s + l.returnedQty, 0),
      returnableQty: docLines.reduce((s, l) => s + l.returnableQty, 0),
      items: docLines,
      returns: returnsByDoc.get(g.documentNo!) ?? [],
    };
  });

  return { total: docs.length, page: pageNum, pageSize: sizeNum, items };
}

// 采购退货（整张收货单）：主表一次提交，多条明细共用一个退货单号
export async function returnPurchaseReceiptBatch(
  documentNo: string,
  data: {
    items: { recordId: number; quantity: number }[];
    effectiveDate?: string;
    departmentId?: number;
    handler?: string;
    remark?: string;
  },
  userId: number
) {
  const no = String(documentNo ?? "").trim();
  if (!no) throw new Error("请提供收货单号");
  if (!data.departmentId) throw new Error("请选择部门");
  const handler = String(data.handler ?? "").trim();
  if (!handler) throw new Error("请输入经手人");
  if (!Array.isArray(data.items) || data.items.length === 0) throw new Error("请至少填写一条退货明细");

  const receipts = await prisma.stockRecord.findMany({
    where: { documentNo: no, type: "in", relatedType: "PurchaseOrder" },
    include: { material: true, warehouse: true },
  });
  if (!receipts.length) throw new Error("收货单不存在或没有可退明细");
  const receiptMap = new Map(receipts.map((r) => [r.id, r]));

  const qtyByRecord = new Map<number, number>();
  for (const it of data.items) {
    const qty = Number(it.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    qtyByRecord.set(it.recordId, (qtyByRecord.get(it.recordId) ?? 0) + qty);
  }
  if (qtyByRecord.size === 0) throw new Error("请至少填写一条退货数量");

  const ids = [...qtyByRecord.keys()];
  for (const recordId of ids) {
    const receipt = receiptMap.get(recordId);
    if (!receipt) throw new Error("退货明细不属于该收货单");
    if (!receipt.warehouse) throw new Error(`物料 ${receipt.material.code} 的收货仓库不存在`);
  }

  const returnType = await prisma.stockTransactionType.findUnique({ where: { code: "ISS-PRV" } });
  if (!returnType) throw new Error("未配置采购退货事务类型（ISS-PRV）");
  if (returnType.status !== 1) throw new Error("采购退货事务类型已停用");
  if (returnType.direction !== "out") throw new Error("采购退货事务类型方向必须为出库");

  let departmentId: number | null = null;
  if (data.departmentId) {
    const dept = await prisma.workshop.findUnique({ where: { id: Number(data.departmentId) } });
    if (!dept) throw new Error("部门不存在");
    if (dept.status !== 1) throw new Error("该部门已停用");
    departmentId = dept.id;
  }

  return prisma.$transaction(async (tx) => {
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const returnDocNo = await generateDocNo(tx, returnType.documentPrefix || "PV");
    const effectiveDate = data.effectiveDate ? new Date(data.effectiveDate) : new Date();

    // 已退数量同时覆盖“按收货单退货”和“按采购单退货”两个入口，防止重复退货
    const { items: purchaseItems, itemByReceipt } = await receiptPurchaseItems(tx, receipts as any);
    const returnedByItem = await calcReturnedBaseByItem(
      tx,
      [...new Set<number>(purchaseItems.map((it: any) => Number(it.orderId)))],
      purchaseItems
    );
    const requestedByItem = new Map<number, number>();

    let idx = 0;
    const lineCount = qtyByRecord.size;
    for (const [recordId, qty] of qtyByRecord) {
      idx += 1;
      const receipt = receiptMap.get(recordId)!;
      const item = itemByReceipt.get(recordId);
      let returnableQty: number;
      if (item) {
        const rate = item.conversionRate || 1;
        const receivedBase = toBaseQty(item.receivedQty, rate);
        const alreadyBase = requestedByItem.get(item.id) ?? 0;
        const availableBase = Math.max(0, receivedBase - (returnedByItem.get(item.id) ?? 0) - alreadyBase);
        returnableQty = Math.min(receipt.quantity, availableBase);
        if (qty > returnableQty + 1e-6) {
          throw new Error(`物料 ${receipt.material.code} 退货数量不能超过可退数量 ${roundQty(returnableQty)}`);
        }
        requestedByItem.set(item.id, alreadyBase + qty);
      } else {
        const returnedMap = await calcReturnedByReceipt(tx, [
          {
            id: receipt.id,
            relatedId: receipt.relatedId ?? null,
            lineNo: receipt.lineNo ?? null,
            materialId: receipt.materialId,
            quantity: receipt.quantity,
            createdAt: receipt.createdAt,
          },
        ]);
        returnableQty = Math.max(0, receipt.quantity - (returnedMap.get(receipt.id) ?? 0));
        if (qty > returnableQty + 1e-6) {
          throw new Error(`物料 ${receipt.material.code} 退货数量不能超过可退数量 ${roundQty(returnableQty)}`);
        }
      }
      const binId = await resolveBinId(tx, receipt.warehouse, receipt.binId);

      const updated = await tx.stock.updateMany({
        where: {
          materialId: receipt.materialId,
          warehouseId: receipt.warehouseId,
          binId,
          quantity: { gte: qty },
        },
        data: { quantity: { decrement: qty }, lastOutDate: new Date() },
      });
      if (updated.count === 0) {
        const fresh = await tx.stock.findFirst({
          where: { materialId: receipt.materialId, warehouseId: receipt.warehouseId, binId },
        });
        throw new Error(`物料 ${receipt.material.code} 库存不足，当前库存 ${fresh?.quantity ?? 0}`);
      }

      const resolvedBatchNo = await applyBatchOut(
        tx,
        receipt.material,
        receipt.warehouseId,
        binId,
        receipt.batchNo ?? undefined,
        qty
      );

      await tx.stockRecord.create({
        data: {
          materialId: receipt.materialId,
          warehouseId: receipt.warehouseId,
          binId,
          type: "out",
          quantity: qty,
          batchNo: resolvedBatchNo,
          transactionTypeId: returnType.id,
          documentNo: returnDocNo,
          orderNo: receipt.orderNo,
          lineNo: idx,
          effectiveDate,
          operatorId: userId,
          departmentId,
          handler,
          remark: data.remark || null,
          relatedType: "PurchaseReturn",
          relatedId: receipt.id,
        },
      });
    }

    return { success: true, documentNo: returnDocNo, count: lineCount };
  });
}

function roundQty(v: number) {
  return Math.round(v * 1e6) / 1e6;
}

// 统计采购明细已退货数量（基本单位）。
// 新退货流水 relatedType=PurchaseReturnItem、relatedId=采购明细 id；
// 历史退货流水 relatedType=PurchaseReturn、relatedId=收货流水 id，按 订单+行号+物料 反查所属明细。
async function calcReturnedBaseByItem(
  client: any,
  orderIds: number[],
  items: { id: number; orderId: number; line: number; materialId: number }[]
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (items.length === 0) return result;

  const itemIds = items.map((i) => i.id);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemKey = (orderId: number | null | undefined, lineNo: number | null | undefined, materialId: number) =>
    `${orderId ?? ""}|${lineNo ?? ""}|${materialId}`;
  const keyToItem = new Map(items.map((i) => [itemKey(i.orderId, i.line, i.materialId), i.id]));

  const receipts = orderIds.length
    ? await client.stockRecord.findMany({
        where: { type: "in", relatedType: "PurchaseOrder", relatedId: { in: orderIds } },
        select: { id: true, relatedId: true, lineNo: true, materialId: true },
      })
    : [];
  const receiptIdToItem = new Map<number, number>();
  for (const r of receipts) {
    let itemId = keyToItem.get(itemKey(r.relatedId, r.lineNo, r.materialId));
    if (!itemId) {
      const candidates = items.filter((i) => i.orderId === r.relatedId && i.materialId === r.materialId);
      if (candidates.length === 1) itemId = candidates[0].id;
    }
    if (itemId) receiptIdToItem.set(r.id, itemId);
  }

  const or: any[] = [];
  if (itemIds.length) or.push({ relatedType: "PurchaseReturnItem", relatedId: { in: itemIds } });
  if (receiptIdToItem.size) or.push({ relatedType: "PurchaseReturn", relatedId: { in: [...receiptIdToItem.keys()] } });
  if (!or.length) return result;

  const rows = await client.stockRecord.findMany({
    where: { type: "out", OR: or },
    select: { relatedType: true, relatedId: true, quantity: true },
  });
  for (const r of rows) {
    const itemId =
      r.relatedType === "PurchaseReturnItem"
        ? r.relatedId ?? undefined
        : r.relatedId
          ? receiptIdToItem.get(r.relatedId)
          : undefined;
    if (!itemId || !itemById.has(itemId)) continue;
    result.set(itemId, (result.get(itemId) ?? 0) + Number(r.quantity ?? 0));
  }
  return result;
}

type ReceiptReturnRow = {
  id: number;
  relatedId: number | null;
  lineNo: number | null;
  materialId: number;
  quantity: number;
  createdAt?: Date;
};

// 统计每条收货流水已退数量（基本单位）。退货有两个入口：
// - PurchaseReturn：relatedId=收货流水 id，可直接归属；
// - PurchaseReturnItem：relatedId=采购明细 id，需要按明细把退货量 FIFO 分摊到该明细的各条收货流水。
// 两个入口共用同一口径，避免“订单退货后再按收货单退货”造成重复退货。
async function calcReturnedByReceipt(client: any, receipts: ReceiptReturnRow[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (receipts.length === 0) return result;
  const orderIds = [...new Set(receipts.map((r) => r.relatedId).filter((x): x is number => x != null))];
  if (orderIds.length === 0) return result;

  const orders = await client.purchaseOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      items: { select: { id: true, line: true, materialId: true, receivedQty: true, conversionRate: true } },
    },
  });
  const allItems = orders.flatMap((o: any) =>
    o.items.map((it: any) => ({ ...it, orderId: o.id }))
  );
  const returnedByItem = await calcReturnedBaseByItem(client, orderIds, allItems);

  const directRows = await client.stockRecord.findMany({
    where: { type: "out", relatedType: "PurchaseReturn", relatedId: { in: receipts.map((r) => r.id) } },
    select: { relatedId: true, quantity: true },
  });
  for (const r of directRows) {
    if (!r.relatedId) continue;
    result.set(r.relatedId, (result.get(r.relatedId) ?? 0) + Number(r.quantity ?? 0));
  }

  const itemKey = (orderId: number | null | undefined, lineNo: number | null | undefined, materialId: number) =>
    `${orderId ?? ""}|${lineNo ?? ""}|${materialId}`;
  const itemByKey = new Map(allItems.map((it: any) => [itemKey(it.orderId, it.line, it.materialId), it]));
  const receiptsByItem = new Map<number, ReceiptReturnRow[]>();
  for (const r of receipts) {
    let item: any = itemByKey.get(itemKey(r.relatedId, r.lineNo, r.materialId));
    if (!item) {
      const candidates = allItems.filter((it: any) => it.orderId === r.relatedId && it.materialId === r.materialId);
      if (candidates.length === 1) item = candidates[0];
    }
    if (!item) continue;
    if (!receiptsByItem.has(item.id)) receiptsByItem.set(item.id, []);
    receiptsByItem.get(item.id)!.push(r);
  }

  for (const [itemId, rows] of receiptsByItem) {
    const totalReturned = returnedByItem.get(itemId) ?? 0;
    const directSum = rows.reduce((sum, r) => sum + (result.get(r.id) ?? 0), 0);
    // 未被直接归属的退货量（PurchaseReturnItem）按收货流水时间 FIFO 分摊
    let residual = Number((totalReturned - directSum).toFixed(6));
    if (residual <= 1e-6) continue;
    const sorted = [...rows].sort(
      (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || a.id - b.id
    );
    for (const r of sorted) {
      if (residual <= 1e-6) break;
      const already = result.get(r.id) ?? 0;
      const capacity = Math.max(0, Number(r.quantity) - already);
      const add = Math.min(capacity, residual);
      if (add <= 1e-6) continue;
      result.set(r.id, already + add);
      residual = Number((residual - add).toFixed(6));
    }
  }
  return result;
}

// 收货流水对应的采购明细（用于跨入口的“可退数量”校验）
async function receiptPurchaseItems(
  client: any,
  receipts: { id: number; relatedId: number | null; lineNo: number | null; materialId: number }[]
) {
  const orderIds = [...new Set(receipts.map((r) => r.relatedId).filter((x): x is number => x != null))];
  const orders = orderIds.length
    ? await client.purchaseOrder.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          items: { select: { id: true, line: true, materialId: true, receivedQty: true, conversionRate: true } },
        },
      })
    : [];
  const items = orders.flatMap((o: any) => o.items.map((it: any) => ({ ...it, orderId: o.id })));
  const itemKey = (orderId: number | null | undefined, lineNo: number | null | undefined, materialId: number) =>
    `${orderId ?? ""}|${lineNo ?? ""}|${materialId}`;
  const itemByKey = new Map(items.map((it: any) => [itemKey(it.orderId, it.line, it.materialId), it]));
  const itemByReceipt = new Map<number, any>();
  for (const r of receipts) {
    let item: any = itemByKey.get(itemKey(r.relatedId, r.lineNo, r.materialId));
    if (!item) {
      const candidates = items.filter((it: any) => it.orderId === r.relatedId && it.materialId === r.materialId);
      if (candidates.length === 1) item = candidates[0];
    }
    if (item) itemByReceipt.set(r.id, item);
  }
  return { items, itemByReceipt };
}

// 采购退货列表（按采购订单维度）：只统计发生过收货的明细行
export async function listPurchaseReturnOrders(where: any) {
  const { orderNo, supplierKeyword, materialKeyword, startDate, endDate, page = 1, pageSize = 20 } = where;

  const itemFilter: Prisma.PurchaseOrderItemWhereInput = { receivedQty: { gt: 0 } };
  if (materialKeyword) {
    itemFilter.material = {
      OR: [
        { code: { contains: materialKeyword } },
        { name: { contains: materialKeyword } },
        { specification: { contains: materialKeyword } },
      ],
    };
  }

  const filters: Prisma.PurchaseOrderWhereInput = { items: { some: itemFilter } };
  if (orderNo) filters.orderNo = { contains: orderNo };
  if (supplierKeyword) {
    filters.supplier = {
      OR: [{ name: { contains: supplierKeyword } }, { code: { contains: supplierKeyword } }],
    };
  }
  if (startDate || endDate) {
    filters.orderDate = {
      gte: startDate ? parseLocalDateStart(startDate) : undefined,
      lte: endDate ? parseLocalDateEnd(endDate) : undefined,
    };
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const sizeNum = Math.min(200, Math.max(1, Number(pageSize) || 20));

  const [total, orders] = await Promise.all([
    prisma.purchaseOrder.count({ where: filters }),
    prisma.purchaseOrder.findMany({
      where: filters,
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        items: {
          where: { receivedQty: { gt: 0 } },
          include: {
            material: {
              select: { id: true, code: true, name: true, specification: true, unit: true, batchManaged: true },
            },
          },
          orderBy: { line: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * sizeNum,
      take: sizeNum,
    }),
  ]);

  const calcItems = orders.flatMap((o) =>
    o.items.map((it) => ({
      id: it.id,
      orderId: o.id,
      line: it.line ?? 0,
      materialId: it.materialId,
    }))
  );
  const returnedMap = await calcReturnedBaseByItem(
    prisma,
    orders.map((o) => o.id),
    calcItems
  );

  const items = orders.map((o) => {
    const lines = o.items.map((it) => {
      const rate = it.conversionRate || 1;
      const receivedBase = toBaseQty(it.receivedQty, rate);
      const returnedBase = returnedMap.get(it.id) ?? 0;
      const returnableBase = Math.max(0, receivedBase - returnedBase);
      return {
        id: it.id,
        materialId: it.materialId,
        line: it.line,
        material: it.material,
        unit: it.unit || it.material.unit,
        quantity: it.quantity,
        receivedQty: it.receivedQty,
        returnedQty: roundQty(returnedBase / rate),
        returnableQty: roundQty(returnableBase / rate),
        conversionRate: rate,
        location: it.location,
        remark: it.remark,
      };
    });
    return {
      id: o.id,
      orderNo: o.orderNo,
      supplierId: o.supplierId,
      supplierName: o.supplier?.name || "未指定",
      orderDate: o.orderDate,
      expectedDate: o.expectedDate,
      buyer: o.buyer,
      status: o.status,
      settleMethod: o.settleMethod,
      lineCount: lines.length,
      totalReceivedQty: roundQty(lines.reduce((s, l) => s + l.receivedQty, 0)),
      returnedQty: roundQty(lines.reduce((s, l) => s + l.returnedQty, 0)),
      returnableQty: roundQty(lines.reduce((s, l) => s + l.returnableQty, 0)),
      items: lines,
    };
  });

  return { total, page: pageNum, pageSize: sizeNum, items };
}

// 采购退货（按采购订单）：逐行由用户指定仓库/货位/批号，整单原子出库
export async function returnPurchaseOrder(
  orderId: number,
  data: {
    items: { itemId: number; quantity: number; warehouseId: number; binId?: number | null; batchNo?: string }[];
    effectiveDate?: string;
    departmentId?: number;
    handler?: string;
    remark?: string;
  },
  userId: number
) {
  if (!data.departmentId) throw new Error("请选择部门");
  const handler = String(data.handler ?? "").trim();
  if (!handler) throw new Error("请输入经手人");
  const lines = Array.isArray(data.items) ? data.items.filter((it) => Number(it.quantity) > 0) : [];
  if (lines.length === 0) throw new Error("请至少填写一条退货数量");

  const order = await prisma.purchaseOrder.findUnique({
    where: { id: orderId },
    include: { items: { include: { material: true } } },
  });
  if (!order) throw new Error("采购订单不存在");
  const itemById = new Map(order.items.map((it) => [it.id, it]));

  for (const line of lines) {
    const item = itemById.get(Number(line.itemId));
    if (!item) throw new Error("退货明细不属于该采购订单");
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`物料 ${item.material.code} 退货数量必须大于0`);
    if (!line.warehouseId) throw new Error(`物料 ${item.material.code} 请选择仓库`);
  }

  const returnType = await prisma.stockTransactionType.findUnique({ where: { code: "ISS-PRV" } });
  if (!returnType) throw new Error("未配置采购退货事务类型（ISS-PRV）");
  if (returnType.status !== 1) throw new Error("采购退货事务类型已停用");
  if (returnType.direction !== "out") throw new Error("采购退货事务类型方向必须为出库");

  let departmentId: number | null = null;
  if (data.departmentId) {
    const dept = await prisma.workshop.findUnique({ where: { id: Number(data.departmentId) } });
    if (!dept) throw new Error("部门不存在");
    if (dept.status !== 1) throw new Error("该部门已停用");
    departmentId = dept.id;
  }

  return prisma.$transaction(async (tx) => {
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const documentNo = await generateDocNo(tx, returnType.documentPrefix || "PV");
    const effectiveDate = data.effectiveDate ? new Date(data.effectiveDate) : new Date();

    const returnedMap = await calcReturnedBaseByItem(
      tx,
      [order.id],
      order.items.map((it) => ({ id: it.id, orderId: order.id, line: it.line ?? 0, materialId: it.materialId }))
    );
    const requestedBase = new Map<number, number>();

    for (const line of lines) {
      const item = itemById.get(Number(line.itemId))!;
      const rate = item.conversionRate || 1;
      const baseQty = toBaseQty(Number(line.quantity), rate);
      const receivedBase = toBaseQty(item.receivedQty, rate);
      const returnedBase = returnedMap.get(item.id) ?? 0;
      const alreadyBase = requestedBase.get(item.id) ?? 0;
      const availableBase = Math.max(0, receivedBase - returnedBase - alreadyBase);
      if (baseQty > availableBase + 1e-6) {
        throw new Error(`物料 ${item.material.code} 退货数量不能超过可退数量 ${roundQty(availableBase / rate)}`);
      }
      requestedBase.set(item.id, alreadyBase + baseQty);

      const warehouse = await tx.warehouse.findUnique({ where: { id: Number(line.warehouseId) } });
      if (!warehouse) throw new Error("仓库不存在");
      const binId = await resolveBinId(tx, warehouse, line.binId);

      const updated = await tx.stock.updateMany({
        where: {
          materialId: item.materialId,
          warehouseId: warehouse.id,
          binId,
          quantity: { gte: baseQty },
        },
        data: { quantity: { decrement: baseQty }, lastOutDate: new Date() },
      });
      if (updated.count === 0) {
        const fresh = await tx.stock.findFirst({
          where: { materialId: item.materialId, warehouseId: warehouse.id, binId },
        });
        throw new Error(`物料 ${item.material.code} 库存不足，当前库存 ${fresh?.quantity ?? 0}`);
      }

      const resolvedBatchNo = await applyBatchOut(
        tx,
        item.material,
        warehouse.id,
        binId,
        line.batchNo?.trim() || undefined,
        baseQty
      );

      await tx.stockRecord.create({
        data: {
          materialId: item.materialId,
          warehouseId: warehouse.id,
          binId,
          type: "out",
          quantity: baseQty,
          batchNo: resolvedBatchNo,
          transactionTypeId: returnType.id,
          documentNo,
          orderNo: order.orderNo,
          lineNo: item.line,
          effectiveDate,
          operatorId: userId,
          departmentId,
          handler,
          remark: data.remark || null,
          relatedType: "PurchaseReturnItem",
          relatedId: item.id,
        },
      });
    }

    return { success: true, documentNo, count: lines.length };
  });
}

// 采购退货：基于某条采购收货流水，退回相同仓库/货位/批次；整单原子出库
export async function returnPurchaseReceipt(
  recordId: number,
  data: { quantity: number; effectiveDate?: string; departmentId?: number; handler?: string; remark?: string },
  userId: number
) {
  if (!Number.isFinite(data.quantity) || data.quantity <= 0) throw new Error("退货数量必须大于0");
  if (!data.departmentId) throw new Error("请选择部门");
  const handler = String(data.handler ?? "").trim();
  if (!handler) throw new Error("请输入经手人");
  const receipt = await prisma.stockRecord.findUnique({
    where: { id: recordId },
    include: { material: true, warehouse: true },
  });
  if (!receipt) throw new Error("收货记录不存在");
  if (receipt.type !== "in" || receipt.relatedType !== "PurchaseOrder") throw new Error("该记录不是采购收货记录");
  if (!receipt.warehouse) throw new Error("收货仓库不存在");

  const returnType = await prisma.stockTransactionType.findUnique({ where: { code: "ISS-PRV" } });
  if (!returnType) throw new Error("未配置采购退货事务类型（ISS-PRV）");
  if (returnType.status !== 1) throw new Error("采购退货事务类型已停用");
  if (returnType.direction !== "out") throw new Error("采购退货事务类型方向必须为出库");

  let departmentId: number | null = null;
  if (data.departmentId) {
    const dept = await prisma.workshop.findUnique({ where: { id: Number(data.departmentId) } });
    if (!dept) throw new Error("部门不存在");
    if (dept.status !== 1) throw new Error("该部门已停用");
    departmentId = dept.id;
  }

  return prisma.$transaction(async (tx) => {
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const documentNo = await generateDocNo(tx, returnType.documentPrefix || "PV");

    // 与“按采购单退货”共用口径，避免同一收货流水被重复退货
    const { itemByReceipt } = await receiptPurchaseItems(tx, [receipt as any]);
    let returnableQty = receipt.quantity;
    const item = itemByReceipt.get(receipt.id);
    if (item) {
      const returnedByItem = await calcReturnedBaseByItem(tx, [item.orderId], [item]);
      const rate = item.conversionRate || 1;
      const availableBase = Math.max(0, toBaseQty(item.receivedQty, rate) - (returnedByItem.get(item.id) ?? 0));
      returnableQty = Math.min(receipt.quantity, availableBase);
    } else {
      const returnedMap = await calcReturnedByReceipt(tx, [
        {
          id: receipt.id,
          relatedId: receipt.relatedId ?? null,
          lineNo: receipt.lineNo ?? null,
          materialId: receipt.materialId,
          quantity: receipt.quantity,
          createdAt: receipt.createdAt,
        },
      ]);
      returnableQty = Math.max(0, receipt.quantity - (returnedMap.get(receipt.id) ?? 0));
    }
    if (data.quantity > returnableQty + 1e-6) {
      throw new Error(`退货数量不能超过可退数量 ${roundQty(returnableQty)}`);
    }

    const binId = await resolveBinId(tx, receipt.warehouse, receipt.binId);

    const updated = await tx.stock.updateMany({
      where: {
        materialId: receipt.materialId,
        warehouseId: receipt.warehouseId,
        binId,
        quantity: { gte: data.quantity },
      },
      data: { quantity: { decrement: data.quantity }, lastOutDate: new Date() },
    });
    if (updated.count === 0) {
      const fresh = await tx.stock.findFirst({
        where: { materialId: receipt.materialId, warehouseId: receipt.warehouseId, binId },
      });
      throw new Error(`库存不足，当前库存 ${fresh?.quantity ?? 0}`);
    }

    const resolvedBatchNo = await applyBatchOut(
      tx,
      receipt.material,
      receipt.warehouseId,
      binId,
      receipt.batchNo ?? undefined,
      data.quantity
    );

    await tx.stockRecord.create({
      data: {
        materialId: receipt.materialId,
        warehouseId: receipt.warehouseId,
        binId,
        type: "out",
        quantity: data.quantity,
        batchNo: resolvedBatchNo,
        transactionTypeId: returnType.id,
        documentNo,
        orderNo: receipt.orderNo,
        lineNo: receipt.lineNo ?? 1,
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : new Date(),
        operatorId: userId,
        departmentId,
        handler,
        remark: data.remark || null,
        relatedType: "PurchaseReturn",
        relatedId: receipt.id,
      },
    });

    return { success: true, documentNo, quantity: data.quantity, returnableQty: Math.max(0, returnableQty - data.quantity) };
  });
}

import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact, parseLocalDateStart, parseLocalDateEnd, startOfLocalDay } from "../utils/date";
import { retryOnDuplicate, lockOrderNo, ORDER_NO_LOCK } from "../utils/retry";
import { applyBatchIn, addStock, resolveBinId, generateDocNo } from "./stock.service";
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
        items: { include: { material: { select: { id: true, code: true, name: true, specification: true, unit: true, location: true } } }, orderBy: { line: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
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
        if (item.quantity < alreadyReceived - 1e-6) {
          throw new Error(`行号 ${old!.line} 的明细已收货 ${alreadyReceived}，数量不能小于已收量`);
        }
      }
    });

    await tx.purchaseOrderItem.deleteMany({ where: { orderId: id } });
    for (const item of data.items) {
      const rate = rateMap.get(item.materialId)?.rate ?? 1;
      await tx.purchaseOrderItem.create({
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
          status: item.status ?? "",
          remark: item.remark || null,
          sourceOrderNo: item.sourceOrderNo || null,
          // 整单重建时保留 MRP 采购建议关联（明细 id 会变，但建议链接不能丢）
          suggestionId: item.id ? (existingById.get(item.id)?.suggestionId ?? null) : null,
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
  receipts?: { itemId: number; quantity: number; batchNo?: string }[],
  options?: { effectiveDate?: string; location?: string; binId?: number | null }
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
      if (!Number.isFinite(r.quantity)) throw new Error("收货数量无效");
      if (r.quantity <= 0) continue;
      const target = po.items.find((it) => it.id === r.itemId);
      if (!target) throw new Error(`收货明细 ${r.itemId} 不属于该采购单`);
      if (receiptsByItem.has(r.itemId)) throw new Error(`收货明细 ${r.itemId} 重复`);
      if (NON_RECEIVABLE.includes(target.status)) {
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
    for (const it of po.items) {
      if (!avgCost.has(it.materialId)) avgCost.set(it.materialId, it.material.cost ?? 0);
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
        const prevCost = avgCost.get(item.materialId) ?? (item.material.cost ?? 0);
        const denom = prevQty + baseQty;
        const newCost = denom > 0 ? (prevQty * prevCost + baseQty * basePrice) / denom : basePrice;
        avgQty.set(item.materialId, denom);
        avgCost.set(item.materialId, newCost);
        await tx.material.update({
          where: { id: item.materialId },
          data: { price: basePrice, cost: Math.round(newCost * 10000) / 10000 },
        });
      }

      // 更新库存：优先用本次收货指定的库位（整单覆盖）；否则按明细库位；再回退已有库存仓库/首个启用仓
      let warehouseId = locationWarehouse?.id ?? null;
      if (!warehouseId && item.location) {
        // 明细库位只在启用仓库中匹配；失效/停用库位回退到已有库存仓库或首个启用仓
        const byLocation = await tx.warehouse.findFirst({ where: { code: item.location, status: 1 } });
        warehouseId = byLocation?.id ?? null;
      }
      if (!warehouseId) {
        // 回退仓库只能选启用仓库，避免把库存收进停用仓库
        const anyStock = await tx.stock.findFirst({
          where: { materialId: item.materialId, quantity: { gt: 0 }, warehouse: { status: 1 } },
          orderBy: { quantity: "desc" },
        });
        warehouseId = anyStock?.warehouseId ?? (await tx.warehouse.findFirst({ where: { status: 1 } }))?.id ?? null;
      }
      if (!warehouseId) throw new Error("没有可用的仓库，无法入库");
      const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse) throw new Error("仓库不存在");
      // 整单指定的货位只对同一仓库生效；明细按自身库位落到别的仓库时不套用
      const binId = await resolveBinId(tx, warehouse, warehouseId === locationWarehouse?.id ? options?.binId : undefined);
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
          lineNo: item.line ?? idx + 1,
          location: options?.location || item.location || null,
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

// ===== 采购收货记录（来源：采购单收货写入的库存流水）=====
export async function listPurchaseReceipts(where: any) {
  const { orderNo, receiptNo, materialKeyword, startDate, endDate, page = 1, pageSize = 20 } = where;

  const filters: Prisma.StockRecordWhereInput = { relatedType: "PurchaseOrder", type: "in" };
  // 收货单号就是库存流水的 documentNo（历史数据可能是采购单号）
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
    // 收货记录展示生效日期，优先按生效日期筛选；历史流水回退创建时间
    filters.OR = [{ effectiveDate: range }, { effectiveDate: null, createdAt: range }];
  }
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

  const orderIds = [...new Set(items.map((i) => i.relatedId).filter((x): x is number => !!x))];
  const orders = orderIds.length
    ? await prisma.purchaseOrder.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, orderNo: true, status: true, supplier: { select: { name: true } } },
      })
    : [];
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  return {
    total,
    page: pageNum,
    pageSize: sizeNum,
    items: items.map((i) => ({
      ...i,
      receiptNo: i.documentNo,
      orderNo: i.relatedId ? orderMap.get(i.relatedId)?.orderNo ?? null : null,
      supplierName: i.relatedId ? orderMap.get(i.relatedId)?.supplier?.name ?? null : null,
      orderStatus: i.relatedId ? orderMap.get(i.relatedId)?.status ?? null : null,
    })),
  };
}

import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact } from "../utils/date";

export interface MrpParams {
  orderIds?: number[];        // 指定订单，不传则全部未完成订单
  deductStock?: boolean;      // 扣除现有库存
  deductInTransit?: boolean;  // 扣除在途采购量
  considerSafetyStock?: boolean; // 考虑安全库存
}

export interface MrpResult {
  runId: number;
  runNo: string;
  orderCount: number;
  materialCount: number;
  shortageCount: number;
  shortages: ShortageItem[];
  purchaseSuggestions: SuggestionItem[];
  productionOrders: ProductionDemand[];
}

interface ShortageItem {
  materialId: number;
  materialCode: string;
  materialName: string;
  category: string;
  unit: string;
  grossDemand: number;
  stockQuantity: number;
  inTransit: number;
  safetyStock: number;
  netDemand: number;
  needDate: Date | null;
  affectedOrders: { orderId: number; orderNo: string; quantity: number }[];
}

interface OrderDemand {
  orderId: number;
  orderNo: string;
  quantity: number;
  needDate: Date | null;
}

interface DemandBucket {
  needDate: Date | null;
  anchor: number | null;
  grossDemand: number;
  orders: { orderId: number; orderNo: string; quantity: number }[];
}

// 按订货周期对需求分桶：与桶内最早需求日期间隔在周期内的合并，超出则新开一桶
function bucketByOrderCycle(demands: OrderDemand[], cycleDays: number): DemandBucket[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const sorted = [...demands].sort((a, b) => {
    const ta = a.needDate ? a.needDate.getTime() : Infinity;
    const tb = b.needDate ? b.needDate.getTime() : Infinity;
    return ta - tb;
  });

  const buckets: DemandBucket[] = [];
  for (const d of sorted) {
    const t = d.needDate ? d.needDate.getTime() : null;
    const last = buckets[buckets.length - 1];
    const within = last
      ? last.anchor === null
        ? t === null
        : t !== null && t - last.anchor <= cycleDays * dayMs
      : false;
    const entry = { orderId: d.orderId, orderNo: d.orderNo, quantity: d.quantity };
    if (within) {
      last.grossDemand += d.quantity;
      last.orders.push(entry);
    } else {
      buckets.push({ needDate: d.needDate, anchor: t, grossDemand: d.quantity, orders: [entry] });
    }
  }
  return buckets;
}

interface SuggestionItem {
  materialId: number;
  materialCode: string;
  materialName: string;
  specification: string | null;
  suggestedQty: number;
  supplierId: number | null;
  leadTime: number;
  needDate: Date;
  sourceOrders: { orderId: number; orderNo: string; quantity: number }[];
}

interface ProductionDemand {
  materialId: number;
  materialCode: string;
  materialName: string;
  quantity: number;
  relatedOrderId: number;
  orderNo: string;
}

// ===== 1. 获取订单及明细 =====
async function fetchOrders(orderIds?: number[]) {
  const where: Prisma.SalesOrderWhereInput = {
    status: { in: ["confirmed", "in_production"] },
  };
  if (orderIds && orderIds.length > 0) {
    where.id = { in: orderIds };
  }
  return prisma.salesOrder.findMany({
    where,
    include: {
      items: {
        include: { material: true },
        where: { status: { in: ["pending", "in_production"] } },
      },
    },
    orderBy: { deliveryDate: "asc" },
  });
}

// ===== 2. BOM展开（递归） =====
const MAX_BOM_DEPTH = 20;

interface ExpandedDemand {
  materialId: number;
  quantity: number;
  orderId: number;
  orderNo: string;
  isSemiProduct: boolean;
}

// visited 采用回溯式（仅祖先链），支持菱形结构：同一子BOM可在多个分支复用
async function expandDemand(
  materialId: number,
  quantity: number,
  orderId: number,
  orderNo: string,
  visited: Set<number> = new Set(),
  depth = 0
): Promise<ExpandedDemand[]> {
  if (depth > MAX_BOM_DEPTH) {
    throw new Error(`BOM层级过深，超过最大深度 ${MAX_BOM_DEPTH} 层`);
  }

  const bom = await prisma.bom.findFirst({
    where: { productId: materialId, status: "active" },
    include: { items: true },
  });

  const results: ExpandedDemand[] = [];
  if (!bom) {
    // 无BOM，直接作为采购/生产需求
    return results;
  }

  if (visited.has(materialId)) {
    throw new Error(`BOM存在循环引用: 物料 ${materialId}`);
  }
  visited.add(materialId);

  for (const item of bom.items) {
    const totalQty = quantity * item.quantity * (1 + (item.lossRate ?? 0));
    const itemMaterial = await prisma.material.findUnique({ where: { id: item.materialId } });

    if (!itemMaterial) continue;

    const hasSubBom = await prisma.bom.findFirst({
      where: { productId: item.materialId, status: "active" },
      select: { id: true },
    });

    if (hasSubBom) {
      results.push({ materialId: item.materialId, quantity: totalQty, orderId, orderNo, isSemiProduct: true });
      const sub = await expandDemand(item.materialId, totalQty, orderId, orderNo, visited, depth + 1);
      results.push(...sub);
    } else {
      results.push({ materialId: item.materialId, quantity: totalQty, orderId, orderNo, isSemiProduct: false });
    }
  }

  visited.delete(materialId);
  return results;
}

// ===== 3. 执行MRP运算 =====
export async function runMrp(params: MrpParams = {}, userId?: number): Promise<MrpResult> {
  const orders = await fetchOrders(params.orderIds);
  if (orders.length === 0) {
    throw new Error("没有符合条件的销售订单");
  }

  // 展开需求
  const allDemands: ExpandedDemand[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      // 成品自身需求也要统计（用于跟踪）
      allDemands.push({
        materialId: item.materialId,
        quantity: item.quantity,
        orderId: order.id,
        orderNo: order.orderNo,
        isSemiProduct: true,
      });

      const expanded = await expandDemand(item.materialId, item.quantity, order.id, order.orderNo);
      allDemands.push(...expanded);
    }
  }

  // 汇总毛需求（按物料 × 订单分组）
  const demandMap = new Map<number, Map<number, number>>(); // materialId -> orderId -> qty
  const materialIds = new Set<number>();

  for (const d of allDemands) {
    materialIds.add(d.materialId);
    if (!demandMap.has(d.materialId)) demandMap.set(d.materialId, new Map());
    const orderDemand = demandMap.get(d.materialId)!;
    orderDemand.set(d.orderId, (orderDemand.get(d.orderId) ?? 0) + d.quantity);
  }

  const materials = await prisma.material.findMany({
    where: { id: { in: [...materialIds] } },
  });
  const materialMap = new Map(materials.map((m) => [m.id, m]));

  // 获取库存、在途采购、安全库存（仅统计启用状态仓库，停用仓库库存不参与MRP）
  const stocks = await prisma.stock.findMany({
    where: { materialId: { in: [...materialIds] }, warehouse: { status: 1 } },
  });
  const stockMap = new Map<number, number>();
  for (const s of stocks) stockMap.set(s.materialId, (stockMap.get(s.materialId) ?? 0) + s.quantity);

  const inTransitRows = await prisma.purchaseOrderItem.findMany({
    where: {
      materialId: { in: [...materialIds] },
      status: { in: ["pending", "partial_received"] },
      order: { status: { not: "cancelled" } },
    },
    include: { order: true },
  });
  const inTransitMap = new Map<number, number>();
  for (const r of inTransitRows) {
    const remaining = r.quantity - r.receivedQty;
    inTransitMap.set(r.materialId, (inTransitMap.get(r.materialId) ?? 0) + remaining);
  }

  // 计算净需求（按物料的订货周期对需求分桶：周期内合并，周期外拆分）
  const shortages: ShortageItem[] = [];
  for (const materialId of demandMap.keys()) {
    const material = materialMap.get(materialId);
    if (!material) continue;

    const stock = params.deductStock !== false ? (stockMap.get(materialId) ?? 0) : 0;
    const inTransit = params.deductInTransit !== false ? (inTransitMap.get(materialId) ?? 0) : 0;
    const safetyStock = params.considerSafetyStock !== false ? material.safetyStock : 0;

    // 按订单汇总需求，并带上需求日期（销售订单交货期）
    const orderDemands: OrderDemand[] = [...demandMap.get(materialId)!.entries()].map(([oid, qty]) => {
      const order = orders.find((o) => o.id === oid);
      return { orderId: oid, orderNo: order?.orderNo ?? "", quantity: qty, needDate: order?.deliveryDate ?? null };
    });

    const buckets = bucketByOrderCycle(orderDemands, material.orderCycleDays ?? 0);

    // 库存/在途按需求日期由早到晚依次冲抵；安全库存只计入最早一个桶
    let remainingStock = stock;
    let remainingInTransit = inTransit;
    let safetyApplied = false;
    for (const bucket of buckets) {
      const bucketSafety = safetyApplied ? 0 : safetyStock;
      safetyApplied = true;

      // 安全库存先计入需求，再用库存/在途冲抵，避免剩余库存无法覆盖安全库存导致重复建议
      let need = bucket.grossDemand + bucketSafety;
      const useStock = Math.min(remainingStock, need);
      remainingStock -= useStock;
      need -= useStock;
      const useInTransit = Math.min(remainingInTransit, need);
      remainingInTransit -= useInTransit;
      need -= useInTransit;

      const netDemand = Math.max(0, need);
      if (netDemand <= 0) continue;

      shortages.push({
        materialId,
        materialCode: material.code,
        materialName: material.name,
        category: material.category,
        unit: material.unit,
        grossDemand: bucket.grossDemand,
        stockQuantity: useStock,
        inTransit: useInTransit,
        safetyStock: bucketSafety,
        netDemand,
        needDate: bucket.needDate,
        affectedOrders: bucket.orders,
      });
    }
  }

  // 排序：需求日期早的在前，同日期缺口大的在前
  shortages.sort((a, b) => {
    const ta = a.needDate ? a.needDate.getTime() : Infinity;
    const tb = b.needDate ? b.needDate.getTime() : Infinity;
    return ta - tb || b.netDemand - a.netDemand;
  });

  // 生成采购建议（采购类物料由外部采购，按需求日期桶分别建议）
  const fallbackNeedDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  };
  const purchaseSuggestions: SuggestionItem[] = shortages
    .filter((s) => s.category === "purchase")
    .map((s) => {
      const material = materialMap.get(s.materialId)!;
      return {
        materialId: s.materialId,
        materialCode: s.materialCode,
        materialName: s.materialName,
        specification: material.specification,
        suggestedQty: Math.ceil(s.netDemand * 100) / 100,
        supplierId: material.supplierId,
        leadTime: material.leadTime,
        needDate: s.needDate ?? fallbackNeedDate(),
        sourceOrders: s.affectedOrders,
      };
    });

  // 生成生产订单建议（制造类半成品由内部生产）
  const productionMaterials = new Set<number>();
  for (const d of allDemands) {
    if (d.isSemiProduct && materialMap.get(d.materialId)?.category === "manufacture") {
      productionMaterials.add(d.materialId);
    }
  }

  const productionOrders: ProductionDemand[] = [];
  for (const materialId of productionMaterials) {
    const material = materialMap.get(materialId)!;
    const demandByOrder = demandMap.get(materialId);
    if (!demandByOrder) continue;
    for (const [orderId, qty] of demandByOrder) {
      const order = orders.find((o) => o.id === orderId);
      productionOrders.push({
        materialId,
        materialCode: material.code,
        materialName: material.name,
        quantity: qty,
        relatedOrderId: orderId,
        orderNo: order?.orderNo ?? "",
      });
    }
  }

  // 创建MRP运行记录并保存结果
  const runNo = `MRP${localDateCompact()}${Date.now().toString().slice(-4)}`;
  const run = await prisma.mrpRun.create({
    data: {
      runNo,
      orderCount: orders.length,
      materialCount: demandMap.size,
      shortageCount: shortages.length,
      status: "completed",
      completedAt: new Date(),
      createdBy: userId,
      result: "{}",
    },
  });

  // 保存缺料明细
  for (const s of shortages) {
    await prisma.mrpShortage.create({
      data: {
        runId: run.id,
        materialId: s.materialId,
        grossDemand: s.grossDemand,
        stockQuantity: s.stockQuantity,
        inTransit: s.inTransit,
        safetyStock: s.safetyStock,
        netDemand: s.netDemand,
        affectedOrders: JSON.stringify(s.affectedOrders),
      },
    });
  }

  // 保存采购建议：新运行替代旧建议，先作废上一次仍待处理的采购建议
  await prisma.purchaseSuggestion.updateMany({
    where: { status: "pending" },
    data: { status: "cancelled" },
  });
  const createdSuggestionIds: number[] = [];
  for (const s of purchaseSuggestions) {
    const row = await prisma.purchaseSuggestion.create({
      data: {
        runId: run.id,
        materialId: s.materialId,
        suggestedQty: s.suggestedQty,
        supplierId: s.supplierId,
        leadTime: s.leadTime,
        needDate: s.needDate,
        status: "pending",
      },
    });
    createdSuggestionIds.push(row.id);
  }

  // 回写运行结果（含采购建议ID，便于按建议维度合并状态）
  const resultPayload = {
    shortages,
    purchaseSuggestions: purchaseSuggestions.map((s, i) => ({
      ...s,
      needDate: s.needDate.toISOString(),
      suggestionId: createdSuggestionIds[i],
    })),
    productionOrders,
  };
  await prisma.mrpRun.update({ where: { id: run.id }, data: { result: JSON.stringify(resultPayload) } });

  return {
    runId: run.id,
    runNo,
    orderCount: orders.length,
    materialCount: demandMap.size,
    shortageCount: shortages.length,
    shortages,
    purchaseSuggestions,
    productionOrders,
  };
}

// ===== 查询MRP历史 =====
export async function listMrpHistory(where: any) {
  const { page = 1, pageSize = 10 } = where;
  const [total, items] = await Promise.all([
    prisma.mrpRun.count(),
    prisma.mrpRun.findMany({
      include: { shortages: { include: { material: { select: { id: true, code: true, name: true } } } } },
      orderBy: { startedAt: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);
  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function getMrpRun(id: number) {
  const run = await prisma.mrpRun.findUnique({ where: { id } });
  if (!run) throw new Error("MRP记录不存在");
  const result = run.result ? JSON.parse(run.result) : { shortages: [], purchaseSuggestions: [], productionOrders: [] };
  return { ...run, result };
}

// ===== 获取当前缺料榜 =====
export async function listShortages() {
  const latestRun = await prisma.mrpRun.findFirst({
    orderBy: { startedAt: "desc" },
  });
  if (!latestRun) return { latestRun: null, shortages: [] };

  const shortages = await prisma.mrpShortage.findMany({
    where: { runId: latestRun.id },
    include: {
      material: { select: { id: true, code: true, name: true, category: true, unit: true, supplierId: true } },
    },
    orderBy: { netDemand: "desc" },
  });

  // 采购建议（取自运行结果JSON，合并数据库中建议的真实状态）
  const result = latestRun.result ? JSON.parse(latestRun.result) : {};
  const rawSuggestions: any[] = result.purchaseSuggestions || [];
  const dbSuggestions = await prisma.purchaseSuggestion.findMany({
    where: { runId: latestRun.id },
    select: { id: true, status: true, convertedOrderId: true },
  });
  const statusMap = new Map(dbSuggestions.map((s) => [s.id, s]));
  const jsonIds = new Set(rawSuggestions.map((s) => s.suggestionId));
  const suggestions = rawSuggestions.map((s) => ({
    ...s,
    source: "mrp",
    status: statusMap.get(s.suggestionId)?.status ?? "pending",
    convertedOrderId: statusMap.get(s.suggestionId)?.convertedOrderId ?? null,
  }));

  // 追加数据库中的待处理采购建议（如安全库存补货建议），不依赖运行结果JSON
  const extraSuggestions = await prisma.purchaseSuggestion.findMany({
    where: { status: "pending", id: { notIn: [...jsonIds] } },
    include: {
      material: { select: { id: true, code: true, name: true, specification: true, unit: true, supplierId: true, leadTime: true, cost: true } },
    },
  });
  for (const s of extraSuggestions) {
    suggestions.push({
      suggestionId: s.id,
      materialId: s.materialId,
      materialCode: s.material.code,
      materialName: s.material.name,
      specification: s.material.specification,
      suggestedQty: s.suggestedQty,
      supplierId: s.supplierId ?? s.material.supplierId,
      leadTime: s.leadTime ?? s.material.leadTime,
      needDate: s.needDate,
      sourceOrders: [],
      source: "safety",
      status: s.status,
      convertedOrderId: s.convertedOrderId,
    });
  }

  return {
    latestRun: {
      id: latestRun.id,
      runNo: latestRun.runNo,
      orderCount: latestRun.orderCount,
      shortageCount: latestRun.shortageCount,
      completedAt: latestRun.completedAt,
    },
    shortages: shortages.map((s) => ({
      ...s,
      affectedOrders: s.affectedOrders ? JSON.parse(s.affectedOrders) : [],
    })),
    suggestions,
  };
}

// ===== 采购建议转采购单 =====
export async function generatePurchaseOrders(
  userId: number,
  suggestionIds?: number[],
  supplierOverrides?: Record<string, number>
) {
  if (Array.isArray(suggestionIds) && suggestionIds.length === 0) {
    throw new Error("请先勾选要转换的采购建议");
  }

  const suggestions = await prisma.purchaseSuggestion.findMany({
    where: {
      status: "pending",
      ...(suggestionIds && suggestionIds.length > 0 ? { id: { in: suggestionIds } } : {}),
    },
    include: { material: true },
    orderBy: [{ supplierId: "asc" }, { needDate: "asc" }],
  });

  if (suggestions.length === 0) {
    throw new Error("没有待处理的采购建议");
  }

  // 供应商：优先使用前端行内选择的覆盖值，否则用建议自带的（允许为空）
  const resolveSupplier = (s: (typeof suggestions)[number]): number | null =>
    supplierOverrides?.[String(s.materialId)] ?? s.supplierId ?? null;

  // 按（供应商 + 需求日期桶）分组：同一物料不同订货周期的需求分开下单
  const dayKey = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "none");
  const byGroup = new Map<string, { supplierId: number | null; items: typeof suggestions }>();
  for (const s of suggestions) {
    const supplierId = resolveSupplier(s);
    const key = `${supplierId ?? "null"}|${dayKey(s.needDate)}`;
    if (!byGroup.has(key)) byGroup.set(key, { supplierId, items: [] });
    byGroup.get(key)!.items.push(s);
  }

  // 将行内选择的供应商回写到物料主文件，便于后续MRP沿用
  if (supplierOverrides) {
    for (const [matId, supId] of Object.entries(supplierOverrides)) {
      if (supId) {
        await prisma.material.update({ where: { id: Number(matId) }, data: { supplierId: Number(supId) } });
      }
    }
  }

  // 供应商默认含税/税率（下单时快照到表头与明细）
  const supplierIds = [...new Set([...byGroup.values()].map((g) => g.supplierId).filter((id): id is number => id != null))];
  const supplierTax = new Map<number, { taxIncluded: boolean; taxRate: number }>();
  if (supplierIds.length > 0) {
    const sups = await prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, taxIncluded: true, taxRate: true },
    });
    for (const s of sups) supplierTax.set(s.id, { taxIncluded: s.taxIncluded, taxRate: s.taxRate });
  }

  const createdOrders = [];
  for (const { supplierId, items } of byGroup.values()) {
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
    const orderNo = `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;

    const totalAmount = items.reduce((sum, s) => sum + s.suggestedQty * (s.unitPrice ?? 0), 0);
    const tax = supplierId != null ? supplierTax.get(supplierId) : undefined;

    const order = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          orderNo,
          supplierId,
          totalAmount,
          orderDate: new Date(),
          status: "draft",
          taxIncluded: tax?.taxIncluded ?? false,
          taxRate: tax?.taxRate ?? 0,
          createdBy: userId,
        },
      });

      for (const s of items) {
        await tx.purchaseOrderItem.create({
          data: {
            orderId: po.id,
            materialId: s.materialId,
            quantity: s.suggestedQty,
            unit: s.material.unit || null,
            unitPrice: s.unitPrice ?? 0,
            amount: s.suggestedQty * (s.unitPrice ?? 0),
            taxIncluded: tax?.taxIncluded ?? false,
            taxRate: tax?.taxRate ?? 0,
            location: s.material.location || null,
            expectedDate: s.needDate,
            status: "pending",
            suggestionId: s.id,
          },
        });
        await tx.purchaseSuggestion.update({
          where: { id: s.id },
          data: { status: "converted", convertedOrderId: po.id },
        });
      }

      return po;
    });

    createdOrders.push(order);
  }

  return {
    orders: createdOrders,
  };
}
// ===== 安全库存检查：采购件可用量低于安全库存时生成采购建议 =====
export async function createSafetyStockSuggestions() {
  const latestRun = await prisma.mrpRun.findFirst({ orderBy: { startedAt: "desc" } });
  if (!latestRun) throw new Error("请先执行MRP运算");

  // 现存量：启用仓库库存合计
  const stocks = await prisma.stock.findMany({ where: { warehouse: { status: 1 } } });
  const stockMap = new Map<number, number>();
  for (const s of stocks) stockMap.set(s.materialId, (stockMap.get(s.materialId) ?? 0) + s.quantity);

  // 在途：未取消采购单未收数量
  const inTransitRows = await prisma.purchaseOrderItem.findMany({
    where: { status: { in: ["pending", "partial_received"] }, order: { status: { not: "cancelled" } } },
  });
  const inTransitMap = new Map<number, number>();
  for (const r of inTransitRows) {
    inTransitMap.set(r.materialId, (inTransitMap.get(r.materialId) ?? 0) + (r.quantity - r.receivedQty));
  }

  // 候选：启用中的采购件，安全库存>0
  const materials = await prisma.material.findMany({
    where: { category: "purchase", safetyStock: { gt: 0 }, status: 1 },
  });

  // 去重：已有待处理采购建议的物料跳过
  const pending = await prisma.purchaseSuggestion.findMany({ where: { status: "pending" }, select: { materialId: true } });
  const pendingSet = new Set(pending.map((p) => p.materialId));

  const created: { suggestionId: number; materialId: number; materialCode: string; materialName: string; suggestedQty: number }[] = [];
  const skipped: { materialId: number; materialCode: string; materialName: string; reason: string }[] = [];

  for (const m of materials) {
    const available = (stockMap.get(m.id) ?? 0) + (inTransitMap.get(m.id) ?? 0);
    const shortage = m.safetyStock - available;
    if (shortage <= 1e-6) continue;
    if (pendingSet.has(m.id)) {
      skipped.push({ materialId: m.id, materialCode: m.code, materialName: m.name, reason: "已有待处理采购建议" });
      continue;
    }
    const needDate = new Date();
    needDate.setDate(needDate.getDate() + (m.leadTime ?? 0));
    const suggestion = await prisma.purchaseSuggestion.create({
      data: {
        runId: latestRun.id,
        materialId: m.id,
        suggestedQty: Math.ceil(shortage * 100) / 100,
        unitPrice: m.cost ?? 0,
        supplierId: m.supplierId,
        leadTime: m.leadTime,
        needDate,
        status: "pending",
      },
    });
    created.push({
      suggestionId: suggestion.id,
      materialId: m.id,
      materialCode: m.code,
      materialName: m.name,
      suggestedQty: suggestion.suggestedQty,
    });
    pendingSet.add(m.id);
  }

  return { created, skipped };
}

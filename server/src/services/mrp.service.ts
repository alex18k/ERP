import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact } from "../utils/date";
import { retryOnDuplicate, lockOrderNo, ORDER_NO_LOCK } from "../utils/retry";

// MRP 单实例锁键（PostgreSQL advisory lock，任意私有常量）
const MRP_LOCK_KEY = 95271024;

export interface MrpParams {
  orderIds?: number[];        // 指定订单，不传则全部未完成订单
  deductStock?: boolean;      // 扣除现有库存
  deductInTransit?: boolean;  // 扣除在途采购量
  deductInProcess?: boolean;  // 扣除在制量（未完工生产订单未入库量 + 已发料量）
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
  wipQuantity: number; // 在制量（未完工生产订单尚未入库数量，仅制造类可能>0）
  issuedQuantity: number; // 已发料量（已按未完工生产订单发料的承诺量）
  safetyStock: number;
  netDemand: number;
  needDate: Date | null;
  affectedOrders: { orderId: number; orderNo: string; quantity: number; deliveryDate: Date | null }[];
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
  orders: { orderId: number; orderNo: string; quantity: number; deliveryDate: Date | null }[];
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
    const entry = { orderId: d.orderId, orderNo: d.orderNo, quantity: d.quantity, deliveryDate: d.needDate };
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
  unitPrice: number; // 建议采购单价（物料最近采购价 price，回退加权平均成本 cost）
  supplierId: number | null;
  leadTime: number;
  needDate: Date;
  orderDate: Date; // 建议下单日期 = 需求日期 − 采购提前期
  purchaseOverdue: boolean; // 建议下单日期已早于今天，应立即下单
  sourceOrders: { orderId: number; orderNo: string; quantity: number; deliveryDate: Date | null }[];
}

interface ProductionDemand {
  materialId: number;
  materialCode: string;
  materialName: string;
  quantity: number;
  relatedOrderId: number;
  orderNo: string;
  customerName: string;
  needDate: Date | null; // 需求交期（销售订单交货期）
  orderDate: Date | null; // 建议开工日期 = 交期 − 制造提前期
  overdue: boolean; // 建议开工日期已早于今天，来不及按提前期排产
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

// ===== 2. BOM展开（递归 + 全量内存缓存，消除 N+1） =====
const MAX_BOM_DEPTH = 20;

type BomWithItems = Prisma.BomGetPayload<{ include: { items: true } }>;

interface ExpandedDemand {
  materialId: number;
  quantity: number;
  orderId: number;
  orderNo: string;
  needDate: Date | null;
  isSemiProduct: boolean;
}

export interface MrpCache {
  bomMap: Map<number, BomWithItems>; // productId -> active BOM
  materialMap: Map<number, Prisma.MaterialGetPayload<{}>>;
}

// 一次性加载全部有效BOM与物料进内存，供展开过程复用（仅两次查询）
export async function buildMrpCache(): Promise<MrpCache> {
  const [boms, materials] = await Promise.all([
    prisma.bom.findMany({ where: { status: "active" }, include: { items: true } }),
    prisma.material.findMany(),
  ]);
  const bomMap = new Map<number, BomWithItems>();
  for (const b of boms) {
    if (!bomMap.has(b.productId)) bomMap.set(b.productId, b);
  }
  const materialMap = new Map(materials.map((m) => [m.id, m]));
  return { bomMap, materialMap };
}

// visited 采用回溯式（仅祖先链），支持菱形结构：同一子BOM可在多个分支复用
// BOM与物料均来自调用方内存缓存，展开过程零额外DB查询
async function expandDemand(
  materialId: number,
  quantity: number,
  orderId: number,
  orderNo: string,
  needDate: Date | null,
  cache: MrpCache,
  visited: Set<number> = new Set(),
  depth = 0
): Promise<ExpandedDemand[]> {
  if (depth > MAX_BOM_DEPTH) {
    throw new Error(`BOM层级过深，超过最大深度 ${MAX_BOM_DEPTH} 层`);
  }

  const { bomMap, materialMap } = cache;
  const bom = bomMap.get(materialId);
  const results: ExpandedDemand[] = [];
  if (!bom) {
    // 无BOM，直接作为采购/生产需求
    return results;
  }

  if (visited.has(materialId)) {
    throw new Error(`BOM存在循环引用: 物料 ${materialId}`);
  }
  visited.add(materialId);

  // 子件需求日期 = 父件需求日期 − 父件生产提前期（父件为制造件时）。
  // 源单为上层生产/加工单：采购件需求日期 = 上层加工单需求日期 − 上层生产提前期；逐层向下累加。
  const parentMaterial = materialMap.get(materialId);
  const parentOffsetDays =
    parentMaterial?.category === "manufacture"
      ? (parentMaterial.manufactureLeadTime ?? parentMaterial.leadTime ?? 0)
      : 0;
  const childNeedDate =
    needDate && parentOffsetDays > 0
      ? new Date(needDate.getTime() - parentOffsetDays * 24 * 60 * 60 * 1000)
      : needDate;

  for (const item of bom.items) {
    const totalQty = quantity * item.quantity * (1 + (item.lossRate ?? 0));
    const itemMaterial = materialMap.get(item.materialId);
    if (!itemMaterial) continue;

    const hasSubBom = bomMap.has(item.materialId);

    if (hasSubBom) {
      results.push({ materialId: item.materialId, quantity: totalQty, orderId, orderNo, needDate: childNeedDate, isSemiProduct: true });
      const sub = await expandDemand(item.materialId, totalQty, orderId, orderNo, childNeedDate, cache, visited, depth + 1);
      results.push(...sub);
    } else {
      results.push({ materialId: item.materialId, quantity: totalQty, orderId, orderNo, needDate: childNeedDate, isSemiProduct: false });
    }
  }

  visited.delete(materialId);
  return results;
}

// ===== 3. 执行MRP运算 =====
export async function runMrp(params: MrpParams = {}, userId?: number, existingRunId?: number): Promise<MrpResult> {
  const orders = await fetchOrders(params.orderIds);
  if (orders.length === 0) {
    throw new Error("没有符合条件的销售订单");
  }

  // 全量加载BOM/物料缓存一次，展开过程零额外查询
  const cache = await buildMrpCache();
  const allMaterialMap = cache.materialMap;

  // 展开需求
  const allDemands: ExpandedDemand[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      // 计量单位换算：销售明细按录入单位录入，MRP 需求按基本单位展开
      const baseQty = item.baseQty && item.baseQty > 0 ? item.baseQty : item.quantity;
      // 成品自身需求也要统计（用于跟踪）
      allDemands.push({
        materialId: item.materialId,
        quantity: baseQty,
        orderId: order.id,
        orderNo: order.orderNo,
        needDate: item.deliveryDate ?? order.deliveryDate ?? null,
        isSemiProduct: true,
      });

      const expanded = await expandDemand(item.materialId, baseQty, order.id, order.orderNo, item.deliveryDate ?? order.deliveryDate ?? null, cache);
      allDemands.push(...expanded);
    }
  }

  // 汇总毛需求（按物料 × 订单明细行分组：同一订单不同明细行交货期各算一行）
  interface LineDemand { orderId: number; orderNo: string; quantity: number; needDate: Date | null; }
  const demandMap = new Map<number, Map<string, LineDemand>>(); // materialId -> lineKey -> demand
  const materialIds = new Set<number>();

  for (const d of allDemands) {
    materialIds.add(d.materialId);
    if (!demandMap.has(d.materialId)) demandMap.set(d.materialId, new Map());
    const lineMap = demandMap.get(d.materialId)!;
    const lineKey = `${d.orderId}|${d.needDate ? d.needDate.getTime() : "null"}`;
    const prev = lineMap.get(lineKey);
    if (prev) prev.quantity += d.quantity;
    else lineMap.set(lineKey, { orderId: d.orderId, orderNo: d.orderNo, quantity: d.quantity, needDate: d.needDate });
  }

  // 物料信息全部来自缓存（一次查询），无需再次查询
  const materialMap = allMaterialMap;

  // 获取库存、在途采购、安全库存（仅统计启用状态仓库，停用仓库库存不参与MRP）
  const stocks = await prisma.stock.findMany({
    where: { materialId: { in: [...materialIds] }, warehouse: { status: 1 } },
  });
  const stockMap = new Map<number, number>();
  for (const s of stocks) stockMap.set(s.materialId, (stockMap.get(s.materialId) ?? 0) + s.quantity);

  const inTransitRows = await prisma.purchaseOrderItem.findMany({
    where: {
      materialId: { in: [...materialIds] },
      status: "",
      order: { status: "confirmed" },
    },
    include: { order: true },
  });
  const inTransitMap = new Map<number, number>();
  for (const r of inTransitRows) {
    // 在途量按基本单位折算（数量为计量单位，换算率取自明细快照）
    const remaining = Math.max(0, r.quantity - r.receivedQty) * (r.conversionRate || 1);
    inTransitMap.set(r.materialId, (inTransitMap.get(r.materialId) ?? 0) + remaining);
  }

  // 在制量（在途供给）：未完工生产订单（planned/in_progress）中尚未完工入库的数量。
  // 已发料量（承诺量）：已按未完工生产订单发料（ProductionBatchMaterial.issuedQty）的物料，库存已扣、不会退回。
  const openProductionRows = await prisma.productionOrder.findMany({
    where: { materialId: { in: [...materialIds] }, status: { in: ["planned", "in_progress"] } },
    select: {
      materialId: true,
      salesOrderId: true,
      quantity: true,
      batches: { where: { status: { not: "cancelled" } }, select: { receivedQty: true } },
    },
  });
    const wipMap = new Map<number, number>(); // materialId -> 在制供给量
    const openByOrderKey = new Map<string, number>(); // `${materialId}:${salesOrderId}` -> 在制量（生产建议扣减用）
    const manualWipMap = new Map<number, number>(); // materialId -> 手工生产订单（无销售订单）在制剩余量
  for (const o of openProductionRows) {
    const received = o.batches.reduce((s, b) => s + b.receivedQty, 0);
    const remaining = Math.max(0, o.quantity - received);
    if (remaining <= 0) continue;
    wipMap.set(o.materialId, (wipMap.get(o.materialId) ?? 0) + remaining);
    if (o.salesOrderId == null) {
      manualWipMap.set(o.materialId, (manualWipMap.get(o.materialId) ?? 0) + remaining);
    } else {
      const key = `${o.materialId}:${o.salesOrderId}`;
      openByOrderKey.set(key, (openByOrderKey.get(key) ?? 0) + remaining);
    }
  }

  const issuedWipRows = await prisma.productionBatchMaterial.findMany({
    where: {
      materialId: { in: [...materialIds] },
      issuedQty: { gt: 0 },
      batch: { status: { not: "cancelled" }, productionOrder: { status: { in: ["planned", "in_progress"] } } },
    },
    select: { materialId: true, issuedQty: true },
  });
  const issuedWipMap = new Map<number, number>();
  for (const r of issuedWipRows) {
    issuedWipMap.set(r.materialId, (issuedWipMap.get(r.materialId) ?? 0) + r.issuedQty);
  }

  // 计算净需求（按物料的订货周期对需求分桶：周期内合并，周期外拆分）
  const shortages: ShortageItem[] = [];
  for (const materialId of demandMap.keys()) {
    const material = materialMap.get(materialId);
    if (!material) continue;

    const stock = params.deductStock !== false ? (stockMap.get(materialId) ?? 0) : 0;
    const inTransit = params.deductInTransit !== false ? (inTransitMap.get(materialId) ?? 0) : 0;
    const wipQuantity = params.deductInProcess !== false ? (wipMap.get(materialId) ?? 0) : 0;
    const issuedQuantity = params.deductInProcess !== false ? (issuedWipMap.get(materialId) ?? 0) : 0;
    const safetyStock = params.considerSafetyStock !== false ? material.safetyStock : 0;

    // 按订单明细行汇总需求，需求日期取明细行交货期（无则回退订单主表交货期）
    const orderDemands: OrderDemand[] = [...demandMap.get(materialId)!.values()].map((d) => ({
      orderId: d.orderId,
      orderNo: d.orderNo,
      quantity: d.quantity,
      needDate: d.needDate,
    }));

    const buckets = bucketByOrderCycle(orderDemands, material.orderCycleDays ?? 0);

    // 库存/在途/在制/已发料按需求日期由早到晚依次冲抵；安全库存只计入最早一个桶
    let remainingStock = stock;
    let remainingInTransit = inTransit;
    let remainingWip = wipQuantity;
    let remainingIssued = issuedQuantity;
    let safetyApplied = false;
    for (const bucket of buckets) {
      const bucketSafety = safetyApplied ? 0 : safetyStock;
      safetyApplied = true;

      // 安全库存先计入需求，再用库存/在途/在制/已发料冲抵，避免剩余库存无法覆盖安全库存导致重复建议
      let need = bucket.grossDemand + bucketSafety;
      const useStock = Math.min(remainingStock, need);
      remainingStock -= useStock;
      need -= useStock;
      const useInTransit = Math.min(remainingInTransit, need);
      remainingInTransit -= useInTransit;
      need -= useInTransit;
      const useWip = Math.min(remainingWip, need);
      remainingWip -= useWip;
      need -= useWip;
      const useIssued = Math.min(remainingIssued, need);
      remainingIssued -= useIssued;
      need -= useIssued;

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
        wipQuantity: useWip,
        issuedQuantity: useIssued,
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
      const needDate = s.needDate ?? fallbackNeedDate();
      return {
        materialId: s.materialId,
        materialCode: s.materialCode,
        materialName: s.materialName,
        specification: material.specification,
        suggestedQty: Math.ceil(s.netDemand * 100) / 100,
        unitPrice: material.price || material.cost || 0,
        supplierId: material.supplierId,
        leadTime: material.leadTime,
        needDate,
        orderDate: new Date(needDate.getTime() - (material.leadTime ?? 0) * 24 * 60 * 60 * 1000),
        purchaseOverdue: needDate.getTime() - (material.leadTime ?? 0) * 24 * 60 * 60 * 1000 < Date.now(),
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

    // 成品/半成品现库存：按物料共用，需求日期早的订单优先分配
    let remainingStockForProd = params.deductStock !== false ? (stockMap.get(materialId) ?? 0) : 0;
    // 手工未完工生产订单的在制剩余量：按物料共用，需求日期早的订单优先冲抵
    let remainingManualWip = params.deductInProcess !== false ? (manualWipMap.get(materialId) ?? 0) : 0;
    // 在制量冲抵余额：同一订单多个明细行共用该订单的在制剩余量，依次扣减不重复
    const remainingOrderWip = new Map<number, number>();
    for (const [key, v] of openByOrderKey) {
      const [matId, orderId] = key.split(":");
      if (Number(matId) === materialId) remainingOrderWip.set(Number(orderId), v);
    }

    const lines = [...demandByOrder.values()].sort((a, b) => {
      const ta = a.needDate ? a.needDate.getTime() : Infinity;
      const tb = b.needDate ? b.needDate.getTime() : Infinity;
      return ta - tb;
    });
    for (const line of lines) {
      const { orderId, quantity: qty } = line;
      const order = orders.find((o) => o.id === orderId);
      // 在制量冲抵：该物料对该销售订单已下达未完工的生产订单剩余量不重复建议
      const wipAvail = params.deductInProcess !== false ? (remainingOrderWip.get(orderId) ?? 0) : 0;
      const wipCovered = Math.min(wipAvail, qty);
      remainingOrderWip.set(orderId, wipAvail - wipCovered);
      const manualCovered = Math.min(remainingManualWip, Math.max(0, qty - wipCovered));
      remainingManualWip -= manualCovered;
      // 已入库/现库存冲抵：成品、半成品有库存则从建议量中扣除
      let need = Math.max(0, qty - wipCovered - manualCovered);
      const useStock = Math.min(remainingStockForProd, need);
      remainingStockForProd -= useStock;
      need -= useStock;
      const suggestQty = Math.ceil(Math.max(0, need) * 100) / 100;
      if (suggestQty <= 0) continue;
      const needDate = line.needDate ? new Date(line.needDate) : null;
      const orderDate = needDate
        ? new Date(needDate.getTime() - ((material.manufactureLeadTime ?? material.leadTime) ?? 0) * 24 * 60 * 60 * 1000)
        : null;
      productionOrders.push({
        materialId,
        materialCode: material.code,
        materialName: material.name,
        quantity: suggestQty,
        relatedOrderId: orderId,
        orderNo: order?.orderNo ?? "",
        customerName: order?.customerName ?? "",
        needDate,
        orderDate,
        overdue: orderDate !== null && orderDate.getTime() < Date.now(),
      });
    }
  }

  // 创建MRP运行记录并保存结果（后台模式下复用调用方预建的 run 记录，前台/直调时自建）
  let run: { id: number };
  if (existingRunId) {
    await prisma.mrpRun.update({
      where: { id: existingRunId },
      data: {
        orderCount: orders.length,
        materialCount: demandMap.size,
        shortageCount: shortages.length,
        status: "completed",
        completedAt: new Date(),
      },
    });
    run = { id: existingRunId };
  } else {
    const runNo = `MRP${localDateCompact()}${Date.now().toString().slice(-4)}`;
    run = await prisma.mrpRun.create({
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
  }

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

  // 保存采购建议：新运行替代旧建议，先作废上一次仍待处理的采购建议（与创建同事务，避免中途失败丢状态）
  const createdSuggestionIds: number[] = await prisma.$transaction(async (tx) => {
    await tx.purchaseSuggestion.updateMany({
      where: { status: "pending" },
      data: { status: "cancelled" },
    });
    const ids: number[] = [];
    for (const s of purchaseSuggestions) {
      const row = await tx.purchaseSuggestion.create({
        data: {
          runId: run.id,
          materialId: s.materialId,
          suggestedQty: s.suggestedQty,
          unitPrice: s.unitPrice,
          supplierId: s.supplierId,
          leadTime: s.leadTime,
          needDate: s.needDate,
          orderDate: s.orderDate,
          status: "pending",
        },
      });
      ids.push(row.id);
    }
    return ids;
  }, { timeout: 60000 });

  // 回写运行结果（含采购建议ID，便于按建议维度合并状态）
  const resultPayload = {
    shortages,
    purchaseSuggestions: purchaseSuggestions.map((s, i) => ({
      ...s,
      needDate: s.needDate.toISOString(),
      orderDate: s.orderDate.toISOString(),
      suggestionId: createdSuggestionIds[i],
    })),
    productionOrders,
  };
  await prisma.mrpRun.update({ where: { id: run.id }, data: { result: JSON.stringify(resultPayload) } });

  const runRow = await prisma.mrpRun.findUnique({ where: { id: run.id } });
  return {
    runId: run.id,
    runNo: runRow?.runNo ?? `MRP${run.id}`,
    orderCount: orders.length,
    materialCount: demandMap.size,
    shortageCount: shortages.length,
    shortages,
    purchaseSuggestions,
    productionOrders,
  };
}

// ===== 后台执行MRP：立即返回running记录，运算在后台完成并回写 =====
export async function startMrp(params: MrpParams = {}, userId?: number): Promise<{ runId: number; runNo: string; status: string }> {
  // PG advisory 事务锁：锁内“检查 running → 创建 running”，同一时刻仅允许一个 MRP
  // （原先依赖 SQLite 单写者串行的 findFirst→create 在 PostgreSQL 多连接下存在竞态）
  const { run, runNo } = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${MRP_LOCK_KEY})`);
      const running = await tx.mrpRun.findFirst({ where: { status: "running" } });
      if (running) {
        throw new Error(`已有MRP运算进行中（${running.runNo}），请等待完成后再执行`);
      }
      const no = `MRP${localDateCompact()}${Date.now().toString().slice(-4)}`;
      const created = await tx.mrpRun.create({
        data: {
          runNo: no,
          orderCount: 0,
          materialCount: 0,
          shortageCount: 0,
          status: "running",
          createdBy: userId,
          result: "{}",
        },
      });
      return { run: created, runNo: no };
    },
    { timeout: 15000 }
  );

  // 后台异步执行，不阻塞HTTP响应。校验性错误（无订单等）直接置为 failed
  runMrp(params, userId, run.id)
    .then(() => {})
    .catch(async (error: any) => {
      await prisma.mrpRun.update({
        where: { id: run.id },
        data: { status: "failed", completedAt: new Date(), result: JSON.stringify({ error: error.message }) },
      });
    });

  return { runId: run.id, runNo, status: "running" };
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
  const prodOrders: any[] = (result.productionOrders || []) as any[];
  if (prodOrders.length > 0) {
    const orderIds = [...new Set(prodOrders.map((p: any) => p.relatedOrderId))].filter((v): v is number => typeof v === "number");
    const [orders, materials] = await Promise.all([
      prisma.salesOrder.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, orderNo: true, customerName: true, deliveryDate: true },
      }),
      prisma.material.findMany({
        where: { id: { in: [...new Set(prodOrders.map((p: any) => p.materialId))] } },
        select: { id: true, leadTime: true, manufactureLeadTime: true },
      }),
    ]);
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const leadMap = new Map(materials.map((m) => [m.id, m.manufactureLeadTime ?? m.leadTime ?? 0]));
    const dayMs = 24 * 60 * 60 * 1000;
    result.productionOrders = prodOrders.map((p: any) => {
      const order = orderMap.get(p.relatedOrderId);
      // 优先用存储的 needDate（含上层制造提前期偏移）；旧运行无该值时回退销售订单交货期
      const resolvedNeedDate = p.needDate ? new Date(p.needDate) : order?.deliveryDate ? new Date(order.deliveryDate) : null;
      const resolvedOrderDate = p.orderDate
        ? new Date(p.orderDate)
        : resolvedNeedDate
          ? new Date(resolvedNeedDate.getTime() - (leadMap.get(p.materialId) ?? 0) * dayMs)
          : null;
      return {
        ...p,
        orderNo: p.orderNo || order?.orderNo || "",
        customerName: p.customerName || order?.customerName || "",
        needDate: resolvedNeedDate,
        orderDate: resolvedOrderDate,
        overdue: resolvedOrderDate !== null && resolvedOrderDate.getTime() < Date.now(),
      };
    });
  }
  const suggestions: any[] = (result.purchaseSuggestions || []) as any[];
  if (suggestions.length > 0) {
    const ids = [...new Set(suggestions.flatMap((s: any) => (s.sourceOrders || []).map((o: any) => o.orderId)))].filter(
      (v): v is number => typeof v === "number"
    );
    if (ids.length > 0) {
      const orders = await prisma.salesOrder.findMany({
        where: { id: { in: ids } },
        select: { id: true, deliveryDate: true },
      });
      const dateMap = new Map(orders.map((o) => [o.id, o.deliveryDate]));
      result.purchaseSuggestions = suggestions.map((s: any) => {
        const needDate = s.needDate ?? null;
        const orderDate = s.orderDate
          ? new Date(s.orderDate)
          : needDate
            ? new Date(new Date(needDate).getTime() - (s.leadTime ?? 0) * 24 * 60 * 60 * 1000)
            : null;
        return {
          ...s,
          orderDate,
          purchaseOverdue: orderDate !== null && orderDate.getTime() < Date.now(),
          sourceOrders: (s.sourceOrders || []).map((o: any) => ({
            ...o,
            deliveryDate: o.deliveryDate ?? dateMap.get(o.orderId) ?? null,
          })),
        };
      });
    }
  }
  return { ...run, result };
}

// ===== 获取当前缺料榜 =====
export async function listShortages() {
  const latestRun = await prisma.mrpRun.findFirst({
    where: { status: "completed" },
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
  let suggestions = rawSuggestions.map((s) => ({
    ...s,
    source: "mrp",
    status: statusMap.get(s.suggestionId)?.status ?? "pending",
    convertedOrderId: statusMap.get(s.suggestionId)?.convertedOrderId ?? null,
  }));

  // 旧运行 result JSON 无 sourceOrders 交货期，按订单号回查补全
  const rawOrderIds = [...new Set(suggestions.flatMap((s) => (s.sourceOrders || []).map((o: any) => o.orderId)))].filter(
    (v): v is number => typeof v === "number"
  );
  if (rawOrderIds.length > 0) {
    const rawOrders = await prisma.salesOrder.findMany({
      where: { id: { in: rawOrderIds } },
      select: { id: true, deliveryDate: true },
    });
    const rawDateMap = new Map(rawOrders.map((o) => [o.id, o.deliveryDate]));
    suggestions = suggestions.map((s: any) => {
      const orderDate = s.orderDate
        ? new Date(s.orderDate)
        : s.needDate
          ? new Date(new Date(s.needDate).getTime() - (s.leadTime ?? 0) * 24 * 60 * 60 * 1000)
          : null;
      return {
        ...s,
        orderDate,
        purchaseOverdue: orderDate !== null && orderDate.getTime() < Date.now(),
        sourceOrders: (s.sourceOrders || []).map((o: any) => ({
          ...o,
          deliveryDate: o.deliveryDate ?? rawDateMap.get(o.orderId) ?? null,
        })),
      };
    });
  }

  // 追加数据库中的待处理采购建议（如安全库存补货建议），不依赖运行结果JSON
  const extraSuggestions = await prisma.purchaseSuggestion.findMany({
    where: { status: "pending", id: { notIn: [...jsonIds] } },
    include: {
      material: { select: { id: true, code: true, name: true, specification: true, unit: true, supplierId: true, leadTime: true, cost: true, price: true } },
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
      unitPrice: s.unitPrice || s.material.price || s.material.cost || 0,
      supplierId: s.supplierId ?? s.material.supplierId,
      leadTime: s.leadTime ?? s.material.leadTime,
      needDate: s.needDate,
      orderDate: s.orderDate ?? (s.needDate ? new Date(s.needDate.getTime() - (s.leadTime ?? s.material.leadTime ?? 0) * 24 * 60 * 60 * 1000) : null),
      purchaseOverdue: (s.orderDate ?? (s.needDate ? new Date(s.needDate.getTime() - (s.leadTime ?? s.material.leadTime ?? 0) * 24 * 60 * 60 * 1000) : null)) !== null && (s.orderDate ?? (s.needDate ? new Date(s.needDate.getTime() - (s.leadTime ?? s.material.leadTime ?? 0) * 24 * 60 * 60 * 1000) : null))!.getTime() < Date.now(),
      sourceOrders: [],
      source: "safety",
      status: s.status,
      convertedOrderId: s.convertedOrderId,
    });
  }

  // 补充物料类型（运行结果JSON与数据库建议均可能缺失，统一按物料回查）
  const suggestionMaterialIds = [...new Set(suggestions.map((s: any) => s.materialId))].filter(
    (v): v is number => typeof v === "number"
  );
  if (suggestionMaterialIds.length > 0) {
    const materialTypes = await prisma.material.findMany({
      where: { id: { in: suggestionMaterialIds } },
      select: { id: true, materialType: true },
    });
    const typeMap = new Map(materialTypes.map((m) => [m.id, m.materialType]));
    suggestions = suggestions.map((s: any) => ({ ...s, materialType: typeMap.get(s.materialId) ?? null }));
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

  // 按供应商分组：同一供应商勾选的建议合并为一张采购单，不同需求日期在明细行的 expectedDate 区分
  const byGroup = new Map<string, { supplierId: number | null; items: typeof suggestions }>();
  for (const s of suggestions) {
    const supplierId = resolveSupplier(s);
    const key = `${supplierId ?? "null"}`;
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
    // 单价：建议自带的有效单价优先（0/空视为未设，回退物料主文件成本）
    const priceOf = (s: (typeof items)[number]) => s.unitPrice || s.material.price || s.material.cost || 0;
    const totalAmount = items.reduce((sum, s) => sum + s.suggestedQty * priceOf(s), 0);
    const tax = supplierId != null ? supplierTax.get(supplierId) : undefined;

    // 单号在事务内生成；并发撞 @unique 时整体重试并换单号
    const order = await retryOnDuplicate(() =>
      prisma.$transaction(
        async (tx) => {
          await lockOrderNo(tx, ORDER_NO_LOCK.PO);
          const dateStr = localDateCompact();
          const prefix = `PO${dateStr}`;
          const existing = await tx.purchaseOrder.findMany({
            where: { orderNo: { startsWith: prefix } },
            select: { orderNo: true },
          });
          let maxSeq = 0;
          for (const e of existing) {
            const n = parseInt(e.orderNo.slice(prefix.length), 10);
            if (!isNaN(n) && n > maxSeq) maxSeq = n;
          }
          const orderNo = `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;

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

          for (const [idx, s] of items.entries()) {
            const unitPrice = priceOf(s);
            await tx.purchaseOrderItem.create({
              data: {
                orderId: po.id,
                materialId: s.materialId,
                line: idx + 1,
                quantity: s.suggestedQty,
                unit: s.material.unit || null,
                unitPrice,
                amount: s.suggestedQty * unitPrice,
                taxIncluded: tax?.taxIncluded ?? false,
                taxRate: tax?.taxRate ?? 0,
                location: s.material.location || null,
                expectedDate: s.needDate,
                status: "",
                suggestionId: s.id,
              },
            });
            await tx.purchaseSuggestion.update({
              where: { id: s.id },
              data: { status: "converted", convertedOrderId: po.id },
            });
          }

          return po;
        },
        { timeout: 60000 }
      )
    );

    createdOrders.push(order);
  }

  return {
    orders: createdOrders,
  };
}
// ===== 安全库存检查：采购件可用量低于安全库存时生成采购建议 =====
export async function createSafetyStockSuggestions() {
  const latestRun = await prisma.mrpRun.findFirst({ where: { status: "completed" }, orderBy: { startedAt: "desc" } });
  if (!latestRun) throw new Error("请先执行MRP运算");

  // 现存量：启用仓库库存合计
  const stocks = await prisma.stock.findMany({ where: { warehouse: { status: 1 } } });
  const stockMap = new Map<number, number>();
  for (const s of stocks) stockMap.set(s.materialId, (stockMap.get(s.materialId) ?? 0) + s.quantity);

  // 在途：仅已确认采购单中明细状态空白（未收完）的数量
  const inTransitRows = await prisma.purchaseOrderItem.findMany({
    where: { status: "", order: { status: "confirmed" } },
  });
  const inTransitMap = new Map<number, number>();
  for (const r of inTransitRows) {
    inTransitMap.set(r.materialId, (inTransitMap.get(r.materialId) ?? 0) + Math.max(0, r.quantity - r.receivedQty) * (r.conversionRate || 1));
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
    const orderDate = new Date();
    const suggestion = await prisma.purchaseSuggestion.create({
      data: {
        runId: latestRun.id,
        materialId: m.id,
        suggestedQty: Math.ceil(shortage * 100) / 100,
        unitPrice: m.price || m.cost || 0,
        supplierId: m.supplierId,
        leadTime: m.leadTime,
        needDate,
        orderDate,
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

import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact, parseLocalDateStart, parseLocalDateEnd } from "../utils/date";
import { retryOnDuplicate, lockOrderNo, ORDER_NO_LOCK } from "../utils/retry";
import { applyBatchOut, resolveBinId, generateDocNo } from "./stock.service";
import { resolveUnitRateMap, toBaseQty } from "../utils/unit";

export interface SalesOrderCreateInput {
  customerId?: number;
  customerName: string;
  customerCode?: string;
  contactPerson?: string;
  contactPhone?: string;
  orderDate?: string;
  channel?: string;
  seller1?: string;
  seller2?: string;
  paymentMethod?: string;
  deliveryDate?: string;
  remark?: string;
  items: {
    id?: number;
    materialId: number;
    quantity: number;
    unit?: string;
    unitPrice?: number;
    taxIncluded?: boolean;
    taxRate?: number;
    deliveryDate?: string;
    remark?: string;
    line?: number;
  }[];
}

// 单号 = 前缀 + 当日最大序号+1（配合 lockOrderNo 串行化，避免 count+1 并发撞号）
export async function generateOrderNo(): Promise<string> {
  const dateStr = localDateCompact();
  const prefix = `SO${dateStr}`;
  const existing = await prisma.salesOrder.findMany({
    where: { orderNo: { startsWith: prefix } },
    select: { orderNo: true },
  });
  let max = 0;
  for (const e of existing) {
    const n = parseInt(e.orderNo.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// 可发运订单：未发完且非草稿/取消的订单（SQL 级分页，参照 listStockSummary）
function escapeLike(value: any) {
  return String(value ?? "").replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listShippableOrders(where: any) {
  const { orderNo, customerName } = where;
  const pageNum = Math.max(1, Number(where.page) || 1);
  const sizeNum = Math.min(1000, Math.max(1, Number(where.pageSize) || 20));
  const offset = (pageNum - 1) * sizeNum;

  const conds: Prisma.Sql[] = [Prisma.sql`o.status IN ('confirmed', 'in_production', 'completed')`];
  if (orderNo) conds.push(Prisma.sql`o."orderNo" LIKE ${`%${escapeLike(orderNo)}%`}`);
  if (customerName) conds.push(Prisma.sql`o."customerName" LIKE ${`%${escapeLike(customerName)}%`}`);
  const whereSql = Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}
    AND EXISTS (
      SELECT 1 FROM "SalesOrderItem" i
      WHERE i."orderId" = o.id
        AND (i.status IS NULL OR i.status <> 'cancelled')
        AND i.quantity - COALESCE(i."deliveredQty", 0) > 0.0001
    )`;

  const [countRows, pageRows] = await Promise.all([
    prisma.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS total FROM "SalesOrder" o ${whereSql}`),
    prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      SELECT o.id FROM "SalesOrder" o ${whereSql}
      ORDER BY o."orderNo" DESC
      LIMIT ${sizeNum} OFFSET ${offset}
    `),
  ]);
  const total = Number(countRows[0]?.total ?? 0);
  const ids = pageRows.map((r) => Number(r.id));
  if (ids.length === 0) return { total, page: pageNum, pageSize: sizeNum, items: [] };

  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: ids } },
    include: {
      customer: { select: { id: true, name: true } },
      items: {
        include: {
          material: { select: { id: true, code: true, name: true, unit: true, specification: true, category: true, location: true, batchManaged: true } },
        },
        orderBy: { line: "asc" },
      },
    },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));
  const items = ids
    .map((id) => byId.get(id))
    .filter((o): o is (typeof orders)[number] => !!o)
    .map((o) => ({
      ...o,
      items: o.items
        .filter((it) => it.status !== "cancelled")
        .map((it) => ({ ...it, remaining: Number((it.quantity - (it.deliveredQty ?? 0)).toFixed(4)) })),
    }));

  return { total, page: pageNum, pageSize: sizeNum, items };
}

export async function listOrders(where: any) {
  const { orderNo, customerName, status, page = 1, pageSize = 20, startDate, endDate } = where;

  const filters: Prisma.SalesOrderWhereInput = {};
  if (orderNo) filters.orderNo = { contains: orderNo };
  if (customerName) filters.customerName = { contains: customerName };
  if (status) filters.status = status;
  if (startDate && endDate) {
    filters.deliveryDate = {
      gte: new Date(startDate as string),
      lte: new Date(endDate as string),
    };
  }

  // 按订单号从大到小排序
  const [total, items] = await Promise.all([
    prisma.salesOrder.count({ where: filters }),
    prisma.salesOrder.findMany({
      where: filters,
      include: {
        customer: { select: { id: true, name: true } },
        items: {
          include: { material: { select: { id: true, code: true, name: true, unit: true } } },
          orderBy: { line: "asc" },
        },
        productionOrders: { select: { id: true, orderNo: true, status: true } },
      },
      orderBy: { orderNo: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

// 轻量单号查询：供维护页单号下拉远程搜索，仅返回 单号/客户/状态
export async function listSalesOrderOptions(where: any) {
  const { keyword, limit = 50 } = where || {};
  const filters: Prisma.SalesOrderWhereInput = {};
  const kw = keyword ? String(keyword).trim() : "";
  if (kw) {
    filters.OR = [
      { orderNo: { contains: kw } },
      { customerName: { contains: kw } },
    ];
  }
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const items = await prisma.salesOrder.findMany({
    where: filters,
    select: { id: true, orderNo: true, customerName: true, status: true },
    orderBy: { orderNo: "desc" },
    take,
  });
  return items.map((o) => ({ id: o.id, orderNo: o.orderNo, customer: o.customerName || "未指定", status: o.status }));
}

export async function getOrder(id: number) {
  return prisma.salesOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      creator: { select: { id: true, realName: true } },
      items: {
        include: { material: true },
        orderBy: { line: "asc" },
      },
      productionOrders: {
        include: {
          material: true,
          batches: { where: { status: { not: "cancelled" } }, orderBy: { batchNo: "asc" } },
        },
      },
    },
  });
}

function assertDeliveryNotBeforeOrder(orderDate?: string | Date | null, deliveryDate?: string | Date | null) {
  if (!orderDate || !deliveryDate) return;
  if (new Date(deliveryDate) < new Date(orderDate)) {
    throw new Error("交货日期不能早于订货日期");
  }
}

function assertItemLines(items: { line?: number }[]) {
  items.forEach((item, idx) => {
    const lineNo = Number(item.line);
    if (!Number.isInteger(lineNo) || lineNo < 1) {
      throw new Error(`第 ${idx + 1} 行明细未填写行号`);
    }
  });
}

export async function createOrder(data: SalesOrderCreateInput, userId: number) {
  if (!data.items || data.items.length === 0) {
    throw new Error("订单至少需要一个产品明细");
  }
  assertDeliveryNotBeforeOrder(data.orderDate, data.deliveryDate);
  assertItemLines(data.items);

  for (const item of data.items) {
    const exists = await prisma.material.findUnique({ where: { id: item.materialId } });
    if (!exists) throw new Error(`物料ID ${item.materialId} 不存在`);
  }

  const totalAmount = data.items.reduce((sum, item) => sum + (item.quantity * (item.unitPrice ?? 0)), 0);

  // 计量单位换算率（按明细行的计量单位解析，换算为基本单位用于库存/MRP）
  const rateMap = await resolveUnitRateMap(data.items.map((i) => ({ materialId: i.materialId, unit: i.unit })));

  // 单号在事务内生成；并发撞 @unique 时整体重试并换单号
  return retryOnDuplicate(() =>
    prisma.$transaction(async (tx) => {
      await lockOrderNo(tx, ORDER_NO_LOCK.SO);
      const orderNo = await generateOrderNo();
      const order = await tx.salesOrder.create({
        data: {
          orderNo,
          customerId: data.customerId,
          customerName: data.customerName,
          customerCode: data.customerCode,
          contactPerson: data.contactPerson,
          contactPhone: data.contactPhone,
          orderDate: data.orderDate ? new Date(data.orderDate) : null,
          channel: data.channel,
          seller1: data.seller1,
          seller2: data.seller2,
          paymentMethod: data.paymentMethod,
          deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
          remark: data.remark,
          totalAmount,
          status: "confirmed",
          createdBy: userId,
        },
      });

      for (const item of data.items) {
        const amount = item.quantity * (item.unitPrice ?? 0);
        const info = rateMap.get(item.materialId);
        const rate = info?.rate ?? 1;
        await tx.salesOrderItem.create({
          data: {
            orderId: order.id,
            materialId: item.materialId,
            line: Number(item.line),
            quantity: item.quantity,
            unit: item.unit || info?.baseUnit || null,
            conversionRate: rate,
            baseQty: toBaseQty(item.quantity, rate),
            unitPrice: item.unitPrice ?? 0,
            taxIncluded: Boolean(item.taxIncluded),
            taxRate: Number(item.taxRate ?? 0),
            amount,
            deliveryDate: item.deliveryDate ? new Date(item.deliveryDate) : null,
            remark: item.remark,
            status: "pending",
          },
        });
      }

      return tx.salesOrder.findUnique({
        where: { id: order.id },
        include: { items: { include: { material: true } } },
      });
    })
  );
}

export async function updateOrder(id: number, data: Partial<SalesOrderCreateInput>) {
  const exists = await prisma.salesOrder.findUnique({ where: { id } });
  if (!exists) throw new Error("订单不存在");
  if (exists.status === "shipped" || exists.status === "cancelled") {
    throw new Error("已发货或已取消的订单不能修改");
  }
  assertDeliveryNotBeforeOrder(data.orderDate ?? exists.orderDate, data.deliveryDate ?? exists.deliveryDate);
  if (data.items) assertItemLines(data.items);

  const rateMap = data.items
    ? await resolveUnitRateMap(data.items.map((i) => ({ materialId: i.materialId, unit: i.unit })))
    : null;

  return prisma.$transaction(async (tx) => {
    const existingItems = await tx.salesOrderItem.findMany({ where: { orderId: id } });
    const totalAmount = data.items
      ? data.items.reduce((sum, item) => sum + item.quantity * (item.unitPrice ?? 0), 0)
      : exists.totalAmount;

    const order = await tx.salesOrder.update({
      where: { id },
      data: {
        customerId: data.customerId,
        customerName: data.customerName,
        customerCode: data.customerCode,
        contactPerson: data.contactPerson,
        contactPhone: data.contactPhone,
        orderDate: data.orderDate ? new Date(data.orderDate) : exists.orderDate,
        channel: data.channel,
        seller1: data.seller1,
        seller2: data.seller2,
        paymentMethod: data.paymentMethod,
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : exists.deliveryDate,
        remark: data.remark,
        totalAmount,
        status: exists.status === "draft" ? "confirmed" : undefined,
      },
    });

    if (data.items) {
      // 已发运明细保护：有发货记录的行不允许删除，数量也不允许改到小于已发量
      const existingById = new Map(existingItems.map((it) => [it.id, it]));
      const keptIds = new Set<number>();
      for (const item of data.items) {
        if (item.id && existingById.has(item.id)) keptIds.add(item.id);
      }
      for (const old of existingItems) {
        if (!keptIds.has(old.id) && (old.deliveredQty ?? 0) > 1e-6) {
          throw new Error(`行号 ${old.line} 的明细已发运 ${old.deliveredQty}，不能删除`);
        }
      }
      data.items.forEach((item, idx) => {
        const old = item.id ? existingById.get(item.id) : undefined;
        const delivered = old?.deliveredQty ?? 0;
        if (delivered > 1e-6 && item.quantity < delivered - 1e-6) {
          throw new Error(`第 ${item.line ?? idx + 1} 行明细已发运 ${delivered}，数量不能小于已发量`);
        }
      });

      await tx.salesOrderItem.deleteMany({ where: { orderId: id } });
      for (const item of data.items) {
        const old = item.id ? existingById.get(item.id) : undefined;
        const delivered = old?.deliveredQty ?? 0;
        const amount = item.quantity * (item.unitPrice ?? 0);
        const info = rateMap?.get(item.materialId);
        const rate = info?.rate ?? 1;
        await tx.salesOrderItem.create({
          data: {
            orderId: id,
            materialId: item.materialId,
            line: Number(item.line),
            quantity: item.quantity,
            unit: item.unit || info?.baseUnit || null,
            conversionRate: rate,
            baseQty: toBaseQty(item.quantity, rate),
            unitPrice: item.unitPrice ?? 0,
            taxIncluded: Boolean(item.taxIncluded),
            taxRate: Number(item.taxRate ?? 0),
            amount,
            deliveryDate: item.deliveryDate ? new Date(item.deliveryDate) : null,
            remark: item.remark,
            deliveredQty: delivered,
            status: delivered > 1e-6 ? (old?.status ?? "pending") : "pending",
          },
        });
      }
    }

    return tx.salesOrder.findUnique({ where: { id: order.id }, include: { items: true } });
  });
}

export async function confirmOrder(id: number) {
  const exists = await prisma.salesOrder.findUnique({ where: { id } });
  if (!exists) throw new Error("订单不存在");
  if (exists.status !== "draft") throw new Error("仅草稿状态订单可以确认");

  return prisma.salesOrder.update({
    where: { id },
    data: { status: "confirmed" },
  });
}

export async function getDownstreamInfo(id: number) {
  const exists = await prisma.salesOrder.findUnique({ where: { id } });
  if (!exists) throw new Error("订单不存在");

  const productionOrders = await prisma.productionOrder.findMany({
    where: { salesOrderId: id },
    select: { id: true, orderNo: true, status: true, quantity: true },
    orderBy: { createdAt: "asc" },
  });

  const planned = productionOrders.filter((p) => p.status === "planned");
  const inProgress = productionOrders.filter((p) => p.status === "in_progress");

  let pendingBatchCount = 0;
  const cancelScope = new Map<number, "all" | "pendingOnly">();
  for (const p of planned) cancelScope.set(p.id, "all");
  for (const p of inProgress) cancelScope.set(p.id, "pendingOnly");
  if (cancelScope.size > 0) {
    pendingBatchCount = await prisma.productionBatch.count({
      where: { productionOrderId: { in: [...cancelScope.keys()] }, status: "planned" },
    });
  }

  return {
    productionOrders,
    plannedCount: planned.length, // 未开工生产订单：可整单取消
    inProgressCount: inProgress.length, // 加工中生产订单：仅可取消未开工批次
    pendingBatchCount,
    canCancelProduction: cancelScope.size > 0,
  };
}

export async function cancelOrder(id: number, opts?: { cancelProduction?: boolean }) {
  const exists = await prisma.salesOrder.findUnique({ where: { id } });
  if (!exists) throw new Error("订单不存在");
  if (exists.status === "shipped") throw new Error("已发货订单不能取消");
  if (exists.status === "cancelled") throw new Error("订单已取消");

  return prisma.$transaction(async (tx) => {
    if (opts?.cancelProduction) {
      // 未开工的生产订单：整单取消（含其全部批次）
      const planned = await tx.productionOrder.findMany({
        where: { salesOrderId: id, status: "planned" },
        select: { id: true },
      });
      if (planned.length > 0) {
        const ids = planned.map((p) => p.id);
        await tx.productionOrder.updateMany({
          where: { id: { in: ids } },
          data: { status: "cancelled" },
        });
        await tx.productionBatch.updateMany({
          where: { productionOrderId: { in: ids }, status: { in: ["planned", "in_progress"] } },
          data: { status: "cancelled" },
        });
      }

      // 已开工的生产订单：保留订单，仅取消其未开工的批次
      const inProgress = await tx.productionOrder.findMany({
        where: { salesOrderId: id, status: "in_progress" },
        select: { id: true },
      });
      if (inProgress.length > 0) {
        await tx.productionBatch.updateMany({
          where: { productionOrderId: { in: inProgress.map((p) => p.id) }, status: "planned" },
          data: { status: "cancelled" },
        });
      }
    }

    return tx.salesOrder.update({
      where: { id },
      data: { status: "cancelled" },
    });
  });
}

export async function shipOrder(id: number, userId: number) {
  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: { items: { include: { material: true } } },
  });
  if (!order) throw new Error("订单不存在");
  if (order.status !== "completed") throw new Error("仅已完工订单可以发货");

  const shipType = await prisma.stockTransactionType.findUnique({ where: { code: "ISS-SO" } });

  return prisma.$transaction(async (tx) => {
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const docNo = await generateDocNo(tx, shipType?.documentPrefix || "ISSSO");
    const activeItems = order.items.filter((it) => it.status !== "cancelled");
    if (activeItems.length === 0) throw new Error("订单没有可发货的明细");
    for (const [idx, item] of order.items.entries()) {
      if (item.status === "cancelled") continue;
      await tx.salesOrderItem.update({
        where: { id: item.id },
        data: { status: "shipped", deliveredQty: item.quantity },
      });

      // 制造类成品发货自动出库（必须库存充足；不足时提示改用销售发运按仓库出库）
      if (item.material.category === "manufacture") {
        const fullBase = item.baseQty && item.baseQty > 0 ? item.baseQty : item.quantity;
        // 已按销售发运部分出库的量（deliveredQty 为录入单位，折回基本单位），自动发货只补差值，避免双倍扣库存
        const deliveredBase = toBaseQty(item.deliveredQty ?? 0, item.conversionRate ?? 1);
        const shipBase = Number((fullBase - deliveredBase).toFixed(6));
        if (shipBase <= 1e-6) continue;
        // 自动发货只允许从启用仓库的有效货位出库，跳过停用仓库/停用货位上的历史库存
        const stockRows = await tx.stock.findMany({
          where: { materialId: item.materialId, quantity: { gt: 0 } },
          include: {
            warehouse: { select: { id: true, status: true, binManaged: true } },
            bin: { select: { id: true, warehouseId: true, status: true } },
          },
          orderBy: { quantity: "desc" },
        });
        const stock = stockRows.find((s: any) => {
          if (s.warehouse.status !== 1) return false;
          if (s.warehouse.binManaged) return !!s.bin && s.bin.status === 1 && s.bin.warehouseId === s.warehouseId;
          return s.binId === null;
        });
        if (!stock || stock.quantity < shipBase - 1e-6) {
          throw new Error(`物料 ${item.material?.code ?? item.materialId} 库存不足（可用 ${stock?.quantity ?? 0}），请使用销售发运按仓库分批出库`);
        }
        if (stock && stock.quantity > 0) {
          const deduct = shipBase;
          const stockUpd = await tx.stock.updateMany({
            where: { id: stock.id, quantity: { gte: deduct } },
            data: { quantity: { decrement: deduct }, lastOutDate: new Date() },
          });
          if (stockUpd.count === 0) {
            throw new Error(`物料 ${item.material?.code ?? item.materialId} 库存不足`);
          }
          // 批号管理物料：自动出库按批号先进先出分配，逐批记录流水
          if (item.material.batchManaged) {
            const batches = await tx.materialBatch.findMany({
              where: { materialId: item.materialId, warehouseId: stock.warehouseId, binId: stock.binId, quantity: { gt: 0 } },
              orderBy: { createdAt: "asc" },
            });
            const batchTotal = batches.reduce((sum, b) => sum + Number(b.quantity || 0), 0);
            if (batchTotal < deduct - 1e-6) {
              throw new Error(`物料 ${item.material?.code ?? item.materialId} 批次库存不足（可用 ${batchTotal}），请使用销售发运处理`);
            }
            let remaining = deduct;
            for (const b of batches) {
              if (remaining <= 0) break;
              const use = Math.min(remaining, b.quantity);
              const batchUpd = await tx.materialBatch.updateMany({
                where: { id: b.id, quantity: { gte: use } },
                data: { quantity: { decrement: use } },
              });
              if (batchUpd.count === 0) {
                throw new Error(`批号 ${b.batchNo} 库存不足`);
              }
              await tx.stockRecord.create({
                data: {
                  materialId: item.materialId,
                  warehouseId: stock.warehouseId,
                  binId: stock.binId,
                  type: "out",
                  quantity: use,
                  batchNo: b.batchNo,
                  relatedType: "sales-order",
                  relatedId: id,
                  transactionTypeId: shipType?.id,
                  documentNo: docNo,
                  orderNo: order.orderNo,
                  lineNo: idx + 1,
                  operatorId: userId,
                  remark: "销售订单发货出库",
                },
              });
              remaining -= use;
            }
            if (remaining > 1e-6) throw new Error(`物料 ${item.material?.code ?? item.materialId} 批次库存分配异常`);
          } else {
            await tx.stockRecord.create({
              data: {
                materialId: item.materialId,
                warehouseId: stock.warehouseId,
                binId: stock.binId,
                type: "out",
                quantity: deduct,
                relatedType: "sales-order",
                relatedId: id,
                transactionTypeId: shipType?.id,
                documentNo: docNo,
                orderNo: order.orderNo,
                lineNo: idx + 1,
                operatorId: userId,
                remark: "销售订单发货出库",
              },
            });
          }
        }
      }
    }

    await tx.salesOrder.update({ where: { id }, data: { status: "shipped" } });
    return tx.salesOrder.findUnique({ where: { id } });
  });
}

// 销售发运（库存管理）：按明细指定发运数量与出库仓库，扣减库存并更新订单已发量
export async function shipOrderItems(
  id: number,
  userId: number,
  data: {
    items: { itemId: number; quantity: number; warehouseId: number; remark?: string; binId?: number | null; batchNo?: string }[];
    effectiveDate?: string;
    deliveryNo?: string;
    handler?: string;
    keeper?: string;
    departmentId?: number | null;
  },
) {
  if (!data.items?.length) throw new Error("请填写发运明细");

  if (data.departmentId) {
    const dept = await prisma.workshop.findUnique({ where: { id: Number(data.departmentId) } });
    if (!dept) throw new Error("部门不存在");
    if (dept.status !== 1) throw new Error("该部门已停用");
  }

  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: { items: { include: { material: true } } },
  });
  if (!order) throw new Error("订单不存在");
  if (!["confirmed", "in_production", "completed"].includes(order.status)) {
    throw new Error("当前订单状态不能发运");
  }

  const shipType = await prisma.stockTransactionType.findUnique({ where: { code: "ISS-SO" } });

  // 校验明细归属与数量
  const itemMap = new Map(order.items.map((it) => [it.id, it]));
  for (const line of data.items) {
    const item = itemMap.get(line.itemId);
    if (!item) throw new Error("发运明细不属于该订单");
    if (item.status === "cancelled") throw new Error(`${item.material?.code ?? item.materialId} 明细已取消，不能发运`);
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new Error("发运数量必须大于0");
    const remaining = item.quantity - (item.deliveredQty ?? 0);
    if (line.quantity > remaining + 1e-6) throw new Error(`${item.material?.code} 发运数量超过未发数量 ${remaining}`);
  }

  return prisma.$transaction(async (tx) => {
    await lockOrderNo(tx, ORDER_NO_LOCK.ST);
    const docNo = await generateDocNo(tx, shipType?.documentPrefix || "ISSSO");
    const shippedItems: { itemId: number; deliveredQty: number }[] = [];
    for (const [idx, line] of data.items.entries()) {
      const item = itemMap.get(line.itemId)!;

      // 换算为基本单位出库（换算率取订单明细快照）
      const baseQty = toBaseQty(line.quantity, item.conversionRate || 1);

      // 扣减库存（按仓库+货位）
      const warehouse = await tx.warehouse.findUnique({ where: { id: line.warehouseId } });
      if (!warehouse) throw new Error("仓库不存在");
      const binId = await resolveBinId(tx, warehouse, line.binId);
      const stock = await tx.stock.findFirst({
        where: { materialId: item.materialId, warehouseId: line.warehouseId, binId },
      });
      if (!stock || stock.quantity < baseQty) {
        throw new Error(`${item.material?.code ?? item.materialId} 库存不足（当前 ${stock?.quantity ?? 0}）`);
      }
      const stockUpd = await tx.stock.updateMany({
        where: { id: stock.id, quantity: { gte: baseQty } },
        data: { quantity: { decrement: baseQty }, lastOutDate: new Date() },
      });
      if (stockUpd.count === 0) {
        const fresh = await tx.stock.findUnique({ where: { id: stock.id } });
        throw new Error(`${item.material?.code ?? item.materialId} 库存不足（当前 ${fresh?.quantity ?? 0}）`);
      }
      const resolvedBatchNo = await applyBatchOut(tx, item.material, line.warehouseId, binId, line.batchNo, baseQty);
      await tx.stockRecord.create({
        data: {
          materialId: item.materialId,
          warehouseId: line.warehouseId,
          binId,
          type: "out",
          quantity: baseQty,
          batchNo: resolvedBatchNo,
          relatedType: "sales-order",
          relatedId: id,
          transactionTypeId: shipType?.id,
          documentNo: docNo,
          orderNo: order.orderNo,
          deliveryNo: data.deliveryNo?.trim() || null,
          handler: data.handler?.trim() || null,
          keeper: data.keeper?.trim() || null,
          departmentId: data.departmentId ? Number(data.departmentId) : null,
          lineNo: idx + 1,
          effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
          operatorId: userId,
          remark: line.remark ?? "销售发运出库",
        },
      });

      // 原子累加已发量（写入时校验不超订单数量），并发下防止超发
      const deliveredUpd = await tx.salesOrderItem.updateMany({
        where: { id: item.id, deliveredQty: { lte: item.quantity - line.quantity + 1e-6 } },
        data: { deliveredQty: { increment: line.quantity } },
      });
      if (deliveredUpd.count === 0) {
        throw new Error(`${item.material?.code ?? item.materialId} 发运数量超过未发数量`);
      }
      const freshItem = await tx.salesOrderItem.findUnique({ where: { id: item.id } });
      const newDelivered = freshItem?.deliveredQty ?? (item.deliveredQty ?? 0) + line.quantity;
      const newStatus = newDelivered >= item.quantity - 1e-6 ? "shipped" : item.status;
      if (freshItem?.status !== newStatus) {
        await tx.salesOrderItem.update({
          where: { id: item.id },
          data: { status: newStatus },
        });
      }
      shippedItems.push({ itemId: item.id, deliveredQty: newDelivered });
    }

    // 全部分批发完后订单状态置为已发货
    const items = await tx.salesOrderItem.findMany({ where: { orderId: id } });
    const allShipped = items.length > 0 && items.every((it) => it.status === "shipped");
    if (allShipped) {
      await tx.salesOrder.update({ where: { id }, data: { status: "shipped" } });
    }

    return { shippedItems, orderStatus: allShipped ? "shipped" : order.status };
  });
}

export async function getOrderTrack(id: number) {
  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          material: true,
        },
      },
      productionOrders: {
        include: {
          material: true,
          batches: { where: { status: { not: "cancelled" } }, orderBy: { batchNo: "asc" } },
          orderRoute: { include: { steps: { orderBy: { sequence: "asc" } } } },
        },
      },
    },
  });
  if (!order) throw new Error("订单不存在");

  // 汇总各批次各工序的报工量
  const batchIds = order.productionOrders.flatMap((po) => po.batches.map((b) => b.id));
  const grouped = batchIds.length
    ? await prisma.workReport.groupBy({
        by: ["batchId", "processStepId"],
        where: { batchId: { in: batchIds } },
        _sum: { quantity: true },
      })
    : [];
  const qtyMap = new Map<string, number>();
  for (const g of grouped) qtyMap.set(`${g.batchId}:${g.processStepId}`, g._sum.quantity ?? 0);

  // 本订单各批次的成品/半成品入库记录（生产入库 RCT-WO）
  const receiptRecords = batchIds.length
    ? await prisma.stockRecord.findMany({
        where: { relatedType: "ProductionBatch", relatedId: { in: batchIds }, type: "in" },
        include: {
          material: { select: { id: true, code: true, name: true, unit: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          operator: { select: { id: true, realName: true } },
          transactionType: { select: { id: true, code: true, description: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  // 本订单的销售发运出库记录（销售发运 ISS-SO）
  const shipmentRecords = await prisma.stockRecord.findMany({
    where: { relatedType: "sales-order", relatedId: id, type: "out" },
    include: {
      material: { select: { id: true, code: true, name: true, unit: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      operator: { select: { id: true, realName: true } },
      transactionType: { select: { id: true, code: true, description: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    order,
    statusNodes: buildStatusTrack(order.status),
    shipments: shipmentRecords.map((r) => ({
      id: r.id,
      documentNo: r.documentNo,
      transactionTypeName: r.transactionType?.description ?? r.transactionType?.code ?? "销售发运",
      materialCode: r.material.code,
      materialName: r.material.name,
      unit: r.material.unit,
      warehouseCode: r.warehouse?.code ?? null,
      warehouseName: r.warehouse?.name ?? null,
      quantity: r.quantity,
      operatorName: r.operator?.realName ?? "-",
      effectiveDate: r.effectiveDate,
      createdAt: r.createdAt,
      remark: r.remark,
    })),
    receipts: receiptRecords.map((r) => ({
      id: r.id,
      documentNo: r.documentNo,
      transactionTypeName: r.transactionType?.description ?? r.transactionType?.code ?? "生产入库",
      materialCode: r.material.code,
      materialName: r.material.name,
      unit: r.material.unit,
      warehouseCode: r.warehouse?.code ?? null,
      warehouseName: r.warehouse?.name ?? null,
      quantity: r.quantity,
      operatorName: r.operator?.realName ?? "-",
      effectiveDate: r.effectiveDate,
      createdAt: r.createdAt,
      remark: r.remark,
    })),
    productionProgress: order.productionOrders.map((po) => {
      const steps = po.orderRoute?.steps ?? [];
      const lastStep = steps.length ? steps.reduce((a, b) => (b.sequence > a.sequence ? b : a)) : null;
      const completedQty = po.batches.reduce((sum, b) => {
        const lastQty = lastStep ? qtyMap.get(`${b.id}:${lastStep.id}`) ?? 0 : 0;
        return sum + Math.min(lastQty, b.quantity);
      }, 0);
      return {
        productionOrderNo: po.orderNo,
        materialCode: po.material.code,
        materialName: po.material.name,
        quantity: po.quantity,
        completedQty,
        status: po.status,
        batchCount: po.batches.length,
        planStartDate: po.planStartDate,
        planEndDate: po.planEndDate,
        batches: po.batches.map((b) => ({
          batchId: b.id,
          batchNo: b.batchNo,
          quantity: b.quantity,
          completedQty: lastStep ? Math.min(qtyMap.get(`${b.id}:${lastStep.id}`) ?? 0, b.quantity) : 0,
          receivedQty: b.receivedQty,
          status: b.status,
          planStartDate: b.planStartDate,
          planEndDate: b.planEndDate,
          steps: steps.map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            sequence: s.sequence,
            reportedQty: qtyMap.get(`${b.id}:${s.id}`) ?? 0,
          })),
        })),
      };
    }),
  };
}

function buildStatusTrack(status: string) {
  const flow = [
    { key: "draft", label: "草稿", index: 0 },
    { key: "confirmed", label: "已确认", index: 1 },
    { key: "in_production", label: "生产中", index: 2 },
    { key: "completed", label: "已完工", index: 3 },
    { key: "shipped", label: "已发货", index: 4 },
  ];
  const current = flow.find((f) => f.key === status);
  return flow.map((f) => {
    let stepStatus = "pending";
    if (current) {
      if (f.index < current.index) stepStatus = "done";
      else if (f.index === current.index) stepStatus = "current";
    }
    return { label: f.label, status: stepStatus };
  });
}

export async function listOverdueOrders() {
  const today = new Date();
  return prisma.salesOrder.findMany({
    where: {
      deliveryDate: { lt: today },
      status: { in: ["draft", "confirmed", "in_production"] },
    },
    include: {
      items: { include: { material: true } },
    },
    orderBy: { deliveryDate: "asc" },
  });
}
// ===== 销售发运记录（来源：销售发运写入的库存流水）=====
export async function listSalesShipments(where: any) {
  const { documentNo, orderNo, customerName, materialKeyword, startDate, endDate, page = 1, pageSize = 20 } = where;

  const and: Prisma.StockRecordWhereInput[] = [{ relatedType: "sales-order", type: "out" }];
  if (documentNo) and.push({ documentNo: { contains: documentNo } });
  if (orderNo || customerName) {
    const orderFilter: Prisma.SalesOrderWhereInput = {};
    if (orderNo) orderFilter.orderNo = { contains: orderNo };
    if (customerName) orderFilter.customerName = { contains: customerName };
    const matched = await prisma.salesOrder.findMany({ where: orderFilter, select: { id: true } });
    and.push({ relatedId: { in: matched.map((o) => o.id) } });
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
        transactionType: { select: { id: true, code: true, description: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * sizeNum,
      take: sizeNum,
    }),
  ]);

  const orderIds = [...new Set(items.map((i) => i.relatedId).filter((x): x is number => !!x))];
  const orders = orderIds.length
    ? await prisma.salesOrder.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          orderNo: true,
          customerName: true,
          customerCode: true,
          contactPerson: true,
          contactPhone: true,
          customer: { select: { name: true, contactPerson: true, phone: true, address: true } },
          seller1: true,
          seller2: true,
          items: { select: { line: true, materialId: true, unit: true, unitPrice: true, conversionRate: true } },
        },
      })
    : [];
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  return {
    total,
    page: pageNum,
    pageSize: sizeNum,
    items: items.map((i) => {
      const order = i.relatedId ? orderMap.get(i.relatedId) : undefined;
      const item =
        order?.items.find((it) => it.line === i.lineNo && it.materialId === i.materialId) ??
        order?.items.find((it) => it.materialId === i.materialId);
      const rate = item?.conversionRate || 1;
      const unitPrice = item?.unitPrice != null && rate > 0 ? item.unitPrice / rate : (item?.unitPrice ?? null);
      const amount = unitPrice != null ? Math.round(i.quantity * unitPrice * 100) / 100 : null;
      return {
        ...i,
        receiptNo: i.documentNo,
        orderNo: order?.orderNo ?? i.orderNo ?? null,
        customerName: order?.customerName || order?.customer?.name || null,
        customerCode: order?.customerCode ?? null,
        contactPerson: order?.contactPerson || order?.customer?.contactPerson || null,
        contactPhone: order?.contactPhone || order?.customer?.phone || null,
        sellerNames: [order?.seller1, order?.seller2].filter(Boolean).join("、") || null,
        lineQty: Math.round((i.quantity / rate) * 1e6) / 1e6,
        lineUnit: item?.unit || i.material?.unit || null,
        transactionTypeName: i.transactionType?.description ?? i.transactionType?.code ?? "销售发运",
        unitPrice,
        amount,
      };
    }),
  };
}

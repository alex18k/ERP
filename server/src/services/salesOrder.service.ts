import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { localDateCompact } from "../utils/date";

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
    materialId: number;
    quantity: number;
    unit?: string;
    unitPrice?: number;
    taxIncluded?: boolean;
    taxRate?: number;
    deliveryDate?: string;
    remark?: string;
  }[];
}

export async function generateOrderNo(): Promise<string> {
  const dateStr = localDateCompact();
  const count = await prisma.salesOrder.count({
    where: { orderNo: { startsWith: `SO${dateStr}` } },
  });
  return `SO${dateStr}${String(count + 1).padStart(4, "0")}`;
}

// 可发运订单：未发完且非草稿/取消的订单
export async function listShippableOrders(where: any) {
  const { orderNo, customerName, page = 1, pageSize = 20 } = where;

  const filters: Prisma.SalesOrderWhereInput = {
    status: { in: ["confirmed", "in_production", "completed"] },
  };
  if (orderNo) filters.orderNo = { contains: orderNo };
  if (customerName) filters.customerName = { contains: customerName };

  const all = await prisma.salesOrder.findMany({
    where: filters,
    include: {
      customer: { select: { id: true, name: true } },
      items: {
        include: {
          material: { select: { id: true, code: true, name: true, unit: true, specification: true, category: true } },
        },
      },
    },
    orderBy: { orderNo: "desc" },
  });

  const shippable = all
    .filter((o) => o.items.some((it) => it.status !== "cancelled" && it.quantity - (it.deliveredQty ?? 0) > 0.0001))
    .map((o) => ({
      ...o,
      items: o.items
        .filter((it) => it.status !== "cancelled")
        .map((it) => ({ ...it, remaining: Number((it.quantity - (it.deliveredQty ?? 0)).toFixed(4)) })),
    }));

  const total = shippable.length;
  const start = (Number(page) - 1) * Number(pageSize);
  return { total, page: Number(page), pageSize: Number(pageSize), items: shippable.slice(start, start + Number(pageSize)) };
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

export async function getOrder(id: number) {
  return prisma.salesOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      creator: { select: { id: true, realName: true } },
      items: {
        include: { material: true },
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

export async function createOrder(data: SalesOrderCreateInput, userId: number) {
  if (!data.items || data.items.length === 0) {
    throw new Error("订单至少需要一个产品明细");
  }
  assertDeliveryNotBeforeOrder(data.orderDate, data.deliveryDate);

  for (const item of data.items) {
    const exists = await prisma.material.findUnique({ where: { id: item.materialId } });
    if (!exists) throw new Error(`物料ID ${item.materialId} 不存在`);
  }

  const orderNo = await generateOrderNo();
  const totalAmount = data.items.reduce((sum, item) => sum + (item.quantity * (item.unitPrice ?? 0)), 0);

  return prisma.$transaction(async (tx) => {
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
      await tx.salesOrderItem.create({
        data: {
          orderId: order.id,
          materialId: item.materialId,
          quantity: item.quantity,
          unit: item.unit || (await tx.material.findUnique({ where: { id: item.materialId }, select: { unit: true } }))?.unit || null,
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
  });
}

export async function updateOrder(id: number, data: Partial<SalesOrderCreateInput>) {
  const exists = await prisma.salesOrder.findUnique({ where: { id } });
  if (!exists) throw new Error("订单不存在");
  if (exists.status === "shipped" || exists.status === "cancelled") {
    throw new Error("已发货或已取消的订单不能修改");
  }
  assertDeliveryNotBeforeOrder(data.orderDate ?? exists.orderDate, data.deliveryDate ?? exists.deliveryDate);

  return prisma.$transaction(async (tx) => {
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
      await tx.salesOrderItem.deleteMany({ where: { orderId: id } });
      for (const item of data.items) {
        const amount = item.quantity * (item.unitPrice ?? 0);
        await tx.salesOrderItem.create({
          data: {
            orderId: id,
            materialId: item.materialId,
            quantity: item.quantity,
            unit: item.unit || (await tx.material.findUnique({ where: { id: item.materialId }, select: { unit: true } }))?.unit || null,
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
    for (const [idx, item] of order.items.entries()) {
      await tx.salesOrderItem.update({
        where: { id: item.id },
        data: { status: "shipped", deliveredQty: item.quantity },
      });

      // 制造类成品发货自动出库（有库存则扣减）
      if (item.material.category === "manufacture") {
        const stock = await tx.stock.findFirst({ where: { materialId: item.materialId, quantity: { gt: 0 } }, orderBy: { quantity: "desc" } });
        if (stock && stock.quantity > 0) {
          const deduct = Math.min(item.quantity, stock.quantity);
          await tx.stock.update({
            where: { id: stock.id },
            data: { quantity: { decrement: deduct }, lastOutDate: new Date() },
          });
          await tx.stockRecord.create({
            data: {
              materialId: item.materialId,
              warehouseId: stock.warehouseId,
              type: "out",
              quantity: deduct,
              relatedType: "sales-order",
              relatedId: id,
              transactionTypeId: shipType?.id,
              documentNo: order.orderNo,
              lineNo: idx + 1,
              operatorId: userId,
              remark: "销售订单发货出库",
            },
          });
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
  data: { items: { itemId: number; quantity: number; warehouseId: number; remark?: string }[]; effectiveDate?: string },
) {
  if (!data.items?.length) throw new Error("请填写发运明细");

  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: { items: { include: { material: true } } },
  });
  if (!order) throw new Error("订单不存在");
  if (order.status === "cancelled") throw new Error("已取消订单不能发运");
  if (order.status === "shipped") throw new Error("订单已全部发运");

  const shipType = await prisma.stockTransactionType.findUnique({ where: { code: "ISS-SO" } });

  // 校验明细归属与数量
  const itemMap = new Map(order.items.map((it) => [it.id, it]));
  for (const line of data.items) {
    const item = itemMap.get(line.itemId);
    if (!item) throw new Error("发运明细不属于该订单");
    if (line.quantity <= 0) throw new Error("发运数量必须大于0");
    const remaining = item.quantity - (item.deliveredQty ?? 0);
    if (line.quantity > remaining + 1e-6) throw new Error(`${item.material?.code} 发运数量超过未发数量 ${remaining}`);
  }

  return prisma.$transaction(async (tx) => {
    const shippedItems: { itemId: number; deliveredQty: number }[] = [];
    for (const [idx, line] of data.items.entries()) {
      const item = itemMap.get(line.itemId)!;

      // 扣减库存
      const stock = await tx.stock.findFirst({
        where: { materialId: item.materialId, warehouseId: line.warehouseId },
      });
      if (!stock || stock.quantity < line.quantity) {
        throw new Error(`${item.material?.code ?? item.materialId} 库存不足（当前 ${stock?.quantity ?? 0}）`);
      }
      await tx.stock.update({
        where: { id: stock.id },
        data: { quantity: { decrement: line.quantity }, lastOutDate: new Date() },
      });
      await tx.stockRecord.create({
        data: {
          materialId: item.materialId,
          warehouseId: line.warehouseId,
          type: "out",
          quantity: line.quantity,
          relatedType: "sales-order",
          relatedId: id,
          transactionTypeId: shipType?.id,
          documentNo: order.orderNo,
          lineNo: idx + 1,
          effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
          operatorId: userId,
          remark: line.remark ?? "销售发运出库",
        },
      });

      const newDelivered = (item.deliveredQty ?? 0) + line.quantity;
      const newStatus = newDelivered >= item.quantity - 1e-6 ? "shipped" : item.status;
      await tx.salesOrderItem.update({
        where: { id: item.id },
        data: { deliveredQty: newDelivered, status: newStatus },
      });
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
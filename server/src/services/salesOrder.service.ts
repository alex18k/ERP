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

  // 逾期订单优先显示
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
      orderBy: [{ status: "asc" }, { deliveryDate: "asc" }],
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
          workOrders: { include: { workstation: true } },
        },
      },
    },
  });
}

export async function createOrder(data: SalesOrderCreateInput, userId: number) {
  if (!data.items || data.items.length === 0) {
    throw new Error("订单至少需要一个产品明细");
  }

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
        status: "draft",
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

  let pendingWorkOrderCount = 0;
  const cancelScope = new Map<number, "all" | "pendingOnly">();
  for (const p of planned) cancelScope.set(p.id, "all");
  for (const p of inProgress) cancelScope.set(p.id, "pendingOnly");
  if (cancelScope.size > 0) {
    pendingWorkOrderCount = await prisma.workOrder.count({
      where: { productionOrderId: { in: [...cancelScope.keys()] }, status: "pending" },
    });
  }

  return {
    productionOrders,
    plannedCount: planned.length, // 未开工生产订单：可整单取消
    inProgressCount: inProgress.length, // 加工中生产订单：仅可取消未开工工单
    pendingWorkOrderCount,
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
      // 未开工的生产订单：整单取消（含其全部待开工工单）
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
        await tx.workOrder.updateMany({
          where: { productionOrderId: { in: ids }, status: "pending" },
          data: { status: "cancelled" },
        });
      }

      // 已开工的生产订单：保留订单，仅取消其未开工的加工单
      const inProgress = await tx.productionOrder.findMany({
        where: { salesOrderId: id, status: "in_progress" },
        select: { id: true },
      });
      if (inProgress.length > 0) {
        await tx.workOrder.updateMany({
          where: { productionOrderId: { in: inProgress.map((p) => p.id) }, status: "pending" },
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
          workOrders: {
            include: {
              workstation: true,
              assignments: { include: { processStep: true } },
            },
          },
        },
      },
    },
  });
  if (!order) throw new Error("订单不存在");

  return {
    order,
    statusNodes: buildStatusTrack(order.status),
    productionProgress: order.productionOrders.map((po) => ({
      productionOrderNo: po.orderNo,
      materialName: po.material.name,
      quantity: po.quantity,
      status: po.status,
      completedQty: po.workOrders.reduce((s, w) => s + w.actualQty, 0),
    })),
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
import test, { after } from "node:test";
import assert from "node:assert/strict";
import prisma from "../config/prisma";
import { updatePurchaseOrder } from "./purchase.service";

const orderIds: number[] = [];

after(async () => {
  for (const id of orderIds) {
    await prisma.purchaseOrder.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

test("update allows a purchase order without header expectedDate", async () => {
  const [supplier, material] = await Promise.all([
    prisma.supplier.findFirst({ where: { status: 1 }, select: { id: true } }),
    prisma.material.findFirst({ where: { category: "purchase", status: 1 }, select: { id: true, unit: true } }),
  ]);
  assert.ok(supplier);
  assert.ok(material);

  const order = await prisma.purchaseOrder.create({
    data: {
      orderNo: `T-PODATE-${Date.now()}`,
      supplierId: supplier.id,
      settleMethod: "现结",
      orderDate: new Date(),
      expectedDate: new Date(),
      buyer: "测试",
      status: "draft",
      items: {
        create: [
          {
            materialId: material.id,
            line: 1,
            quantity: 1,
            unit: material.unit,
            unitPrice: 1,
            baseQty: 1,
            status: "",
          },
        ],
      },
    },
  });
  orderIds.push(order.id);

  await updatePurchaseOrder(order.id, {
    supplierId: supplier.id,
    settleMethod: "现结",
    orderDate: new Date().toISOString().slice(0, 10),
    buyer: "测试",
    items: [
      {
        materialId: material.id,
        line: 1,
        quantity: 1,
        unit: material.unit,
        unitPrice: 1,
        status: "",
      },
    ],
  });

  const updated = await prisma.purchaseOrder.findUnique({ where: { id: order.id } });
  assert.equal(updated?.expectedDate, null);
});

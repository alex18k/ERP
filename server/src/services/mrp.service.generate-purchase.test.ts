import test, { after } from "node:test";
import assert from "node:assert/strict";
import prisma from "../config/prisma";
import { generatePurchaseOrders } from "./mrp.service";

const cleanup = {
  orderIds: [] as number[],
  suggestionIds: [] as number[],
  runIds: [] as number[],
};

after(async () => {
  for (const id of cleanup.orderIds) {
    await prisma.purchaseOrder.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of cleanup.suggestionIds) {
    await prisma.purchaseSuggestion.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of cleanup.runIds) {
    await prisma.mrpRun.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

test("generated purchase order item carries source sales order numbers", async () => {
  const material = await prisma.material.findFirst({
    where: { category: "purchase", status: 1 },
    select: { id: true },
  });
  assert.ok(material, "need a purchase material for the test");

  const run = await prisma.mrpRun.create({
    data: {
      runNo: `T-MRPGEN-${Date.now()}`,
      status: "completed",
      completedAt: new Date(),
      result: "{}",
    },
  });
  cleanup.runIds.push(run.id);

  const suggestion = await prisma.purchaseSuggestion.create({
    data: {
      runId: run.id,
      materialId: material.id,
      suggestedQty: 3,
      unitPrice: 1,
      needDate: new Date(),
      status: "pending",
    },
  });
  cleanup.suggestionIds.push(suggestion.id);

  await prisma.mrpRun.update({
    where: { id: run.id },
    data: {
      result: JSON.stringify({
        purchaseSuggestions: [
          {
            suggestionId: suggestion.id,
            materialId: material.id,
            sourceOrders: [
              { orderId: 9001, orderNo: "SO-TEST-A", quantity: 2, deliveryDate: null },
              { orderId: 9002, orderNo: "SO-TEST-B", quantity: 1, deliveryDate: null },
            ],
          },
        ],
      }),
    },
  });

  const result = await generatePurchaseOrders(1, [suggestion.id]);
  assert.equal(result.orders.length, 1);
  cleanup.orderIds.push(result.orders[0].id);

  const item = await prisma.purchaseOrderItem.findFirst({
    where: { orderId: result.orders[0].id },
  });
  assert.ok(item);
  assert.equal(item.sourceOrderNo, "SO-TEST-A、SO-TEST-B");
});

import test, { after } from "node:test";
import assert from "node:assert/strict";
import prisma from "../config/prisma";
import { getWorkshopDashboard } from "./dashboard.service";

after(async () => {
  await prisma.$disconnect();
});

test("returns summary, orders, workstations and today's reports", async () => {
  const data = await getWorkshopDashboard();

  for (const key of ["inProgress", "pending", "todayReports", "todayCompleted", "overdue"] as const) {
    assert.equal(typeof data.summary[key], "number");
  }
  assert.ok(Array.isArray(data.orders));
  assert.ok(Array.isArray(data.workstations));
  assert.ok(Array.isArray(data.recentReports));

  for (const order of data.orders) {
    assert.ok(order.progress >= 0 && order.progress <= 100, `progress out of range: ${order.progress}`);
    assert.ok(order.stepProgress.completed <= order.stepProgress.total);
    assert.ok(order.steps.every((step) => ["done", "current", "waiting"].includes(step.status)));
  }
});

test("unknown workshop returns empty collections", async () => {
  const data = await getWorkshopDashboard({ workshopId: 999999 });

  assert.deepEqual(data.orders, []);
  assert.deepEqual(data.workstations, []);
  assert.deepEqual(data.recentReports, []);
});

test("invalid workshopId returns empty collections", async () => {
  for (const workshopId of [Number.NaN, 0, -1]) {
    const data = await getWorkshopDashboard({ workshopId });
    assert.deepEqual(data.orders, [], `orders for workshopId=${workshopId}`);
    assert.deepEqual(data.workstations, [], `workstations for workshopId=${workshopId}`);
    assert.deepEqual(data.recentReports, [], `reports for workshopId=${workshopId}`);
  }
});

test("includes workshop options for the filter", async () => {
  const data = await getWorkshopDashboard();

  assert.ok(Array.isArray(data.workshops));
  assert.ok(data.workshops.every((workshop) => typeof workshop.id === "number" && typeof workshop.name === "string"));
});

test("when no matching orders, workstations are all idle", async () => {
  const data = await getWorkshopDashboard({ execStatus: "pending" });

  if (data.orders.length === 0) {
    assert.ok(data.workstations.every((station) => station.status === "idle"));
  }
});

test("execStatus filter only returns matching orders", async () => {
  const data = await getWorkshopDashboard({ execStatus: "pending" });

  assert.ok(data.orders.every((order) => order.execStatus === "pending"));
});

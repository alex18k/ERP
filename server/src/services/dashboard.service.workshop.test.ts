import test, { after } from "node:test";
import assert from "node:assert/strict";
import prisma from "../config/prisma";
import { getWorkshopDashboard, isOverdueOn } from "./dashboard.service";

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

test("execStatus filter only returns matching orders", async () => {
  const data = await getWorkshopDashboard({ execStatus: "pending" });

  assert.ok(data.orders.every((order) => order.execStatus === "pending"));
});

// ===== 工位任务（按工序聚合）=====

test("workstation task panel is independent from execStatus list filter", async () => {
  const all = await getWorkshopDashboard();
  const onlyCompleted = await getWorkshopDashboard({ execStatus: "completed" });

  // 工位任务来自全部未完工订单，不随订单列表筛选变化
  assert.deepEqual(
    onlyCompleted.workstations.map((station) => station.taskCount),
    all.workstations.map((station) => station.taskCount)
  );
});

test("workstation status matches its tasks", async () => {
  const data = await getWorkshopDashboard();

  for (const station of data.workstations) {
    assert.equal(station.taskCount, station.tasks.length, `taskCount mismatch on ${station.code}`);
    assert.ok(station.capacity >= 1, `capacity should be positive on ${station.code}`);
    if (station.tasks.length === 0) {
      assert.equal(station.status, "idle", `${station.code} should be idle`);
      assert.equal(station.orderNo, null);
      assert.equal(station.stepName, null);
    } else {
      // 有任一已开工任务 → busy，否则 pending
      const expected = station.tasks.some((task) => task.started) ? "busy" : "pending";
      assert.equal(station.status, expected, `${station.code} status`);
      assert.equal(station.orderNo, station.tasks[0].orderNo);
      assert.equal(station.stepName, station.tasks[0].stepName);
    }
    for (const task of station.tasks) {
      // 任务 = 未达产工序
      assert.ok(task.reportedQty < task.plannedQty, `done step leaked into queue: ${task.orderNo}/${task.stepName}`);
      assert.equal(task.started, task.reportedQty > 0);
    }
  }
});

test("every open order's unfinished steps appear in workstation tasks or unassigned", async () => {
  const data = await getWorkshopDashboard();

  const openOrders = await prisma.productionOrder.findMany({
    where: { status: { not: "closed" }, execStatus: { in: ["pending", "in_progress"] } },
    select: {
      id: true,
      plannedQty: true,
      quantity: true,
      orderRoute: {
        select: {
          steps: {
            select: { id: true, name: true, workstationId: true },
          },
        },
      },
    },
  });
  const reportedAgg = await prisma.workReport.groupBy({
    by: ["productionOrderId", "processStepId"],
    _sum: { quantity: true },
  });
  const reportedOf = new Map<number, number>(
    reportedAgg.map((row) => [row.processStepId, row._sum.quantity ?? 0])
  );

  const taskStepIds = new Set<number>(data.workstations.flatMap((station) => station.tasks.map((task) => task.stepId)));
  const unassignedStepIds = new Set<number>(data.unassignedTasks.map((task) => task.stepId));

  for (const order of openOrders) {
    const plan = order.plannedQty || order.quantity || 1;
    for (const step of order.orderRoute?.steps ?? []) {
      const reported = reportedOf.get(step.id) ?? 0;
      if (reported >= plan) continue; // 已达产，不应出现
      const inPanel = taskStepIds.has(step.id);
      const inUnassigned = unassignedStepIds.has(step.id);
      if (!step.workstationId) {
        // 未绑工位的任务只出现在 unassigned（且 unassignedCount 覆盖总数）
        assert.ok(!inPanel, `unbound step ${step.id} should not be on a workstation card`);
      } else {
        assert.ok(inPanel, `pending step ${step.id} (${order.id}/${step.name}) missing from workstation tasks`);
        assert.ok(!inUnassigned, `bound step ${step.id} should not be in unassigned`);
      }
    }
  }
  assert.ok(data.unassignedCount >= data.unassignedTasks.length);
});

// ===== 顶部统计 =====

test("summary counts are not limited by the 200-order page", async () => {
  const data = await getWorkshopDashboard();

  const [inProgress, pending] = await Promise.all([
    prisma.productionOrder.count({ where: { status: { not: "closed" }, execStatus: "in_progress" } }),
    prisma.productionOrder.count({ where: { status: { not: "closed" }, execStatus: "pending" } }),
  ]);
  assert.equal(data.summary.inProgress, inProgress);
  assert.equal(data.summary.pending, pending);
  assert.ok(data.total >= data.orders.length);
  assert.ok(data.orders.length <= 200);
});

test("total matches the filtered order count", async () => {
  const data = await getWorkshopDashboard({ execStatus: "pending" });
  const count = await prisma.productionOrder.count({
    where: { status: { not: "closed" }, execStatus: "pending" },
  });
  assert.equal(data.total, count);
});

// ===== 逾期判据 =====

test("isOverdueOn compares by date, not timestamp", () => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const today = new Date(todayStart);
  const yesterday = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  assert.equal(isOverdueOn(today, "in_progress", todayStart), false, "交期当天不算逾期");
  assert.equal(isOverdueOn(yesterday, "in_progress", todayStart), true, "昨天到期算逾期");
  assert.equal(isOverdueOn(tomorrow, "pending", todayStart), false, "未来到期不算逾期");
  assert.equal(isOverdueOn(yesterday, "completed", todayStart), false, "已完工不算逾期");
  assert.equal(isOverdueOn(null, "pending", todayStart), false, "无交期不算逾期");
});

test("orders with planEndDate = today are not overdue", async () => {
  // 用一张未完工订单模拟「今天到期」，看板不应标逾期
  const order = await prisma.productionOrder.findFirst({
    where: { status: { not: "closed" }, execStatus: { in: ["pending", "in_progress"] } },
  });
  if (!order) return;
  const original = order.planEndDate;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  try {
    await prisma.productionOrder.update({ where: { id: order.id }, data: { planEndDate: todayStart } });
    const data = await getWorkshopDashboard();
    const row = data.orders.find((item) => item.id === order.id);
    if (row) {
      assert.equal(row.isOverdue, false, "交期当天不应显示逾期");
    }
  } finally {
    await prisma.productionOrder.update({ where: { id: order.id }, data: { planEndDate: original } });
  }
});

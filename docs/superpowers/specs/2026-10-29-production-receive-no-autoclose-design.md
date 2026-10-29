# 生产入库取消自动关闭 设计说明

日期：2026-10-29 ｜ 分支：main（本轮直接在 main 上做小改动）｜ 状态：待批准

## 意图与原因

生产入库（`/inventory/production-receive` 弹窗）现在在**入库量达到计划量时自动把生产订单 `status` 置 `closed`**（后端 `receiveProductionOrderProduct` 的 `autoClosed`）。用户要求：**取消这一自动行为**——全部入库后订单保持打开，只有在弹窗勾选「入库后关闭生产订单」才关闭，让仓库人员手工决定关单时机。

## 目标 / 非目标 / 反目标

- **目标**：入库数量到计划量且未勾选 → 订单不关闭；勾选 → 入库+关闭一次完成（保持现状：默认不勾选、提交前二次确认）；已全部入库未关闭时页面给出提示。
- **非目标**：不改发料/报工/销售订单完工联动（销售订单 `completed` 仍由报工完工/手工完工触发，与入库关单无关）；不加「仅关闭订单」新接口。
- **反目标**：入库后仍出现任何形式的自动关闭。

## 方案（已选定）

比较过三个方案：仅提示不加入口（选定）、弹窗加「仅关闭订单」按钮（需新后端接口，超出需求）、完全不提示（用户看不到单还开着）。用户选「仅提示」。

**后端** `server/src/services/production.service.ts`（约 1519-1521、1550 行）：
- 关闭条件从 `if (autoClosed || closeWorkOrder === true)` 改为 `if (closeWorkOrder === true)`。
- 响应字段 `autoClosed` 改名 `fullyReceived`（值仍为 `newReceived >= plannedQty - 1e-6`，仅作展示信号；`autoClosed` 无其它消费方，grep 确认）。

**前端** `client/src/views/inventory/productionReceive/index.vue`（提交成功处）：
- 提示三分支：`closed` → 「入库已提交，生产订单已关闭」；`fullyReceived`（未关）→ 「入库已提交，已全部入库；如需关闭订单请勾选「入库后关闭生产订单」后再次入库」；其余 → 「入库已提交」。
- 勾选框默认值、二次确认、请求体（`closeWorkOrder`）均不变。

**文档** `AGENTS.md`：把「生产入库在 `receivedQty` 达到 `plannedQty` 时自动关闭生产订单」改为「仅勾选『入库后关闭生产订单』时关闭；入库不再自动关闭，响应以 `fullyReceived` 提示已全部入库」。

## 副作用（已确认可接受）

未勾关闭、已全部入库的订单仍为 `planned/in_progress`，但无剩余量 → 默认「仅未入库完」列表不再显示（切「全部」可见、仍不可再入库，数量校验拦截）。

## 验证（无测试框架 → curl + Playwright + psql）

以订单 18（`MO202610290002`，planned 4000，received 0）为样本，RED 先跑：
1. **未勾选、入满 4000** → 期望 `closed=false`、`fullyReceived=true`，psql 查 `status` 保持 `in_progress`（当前代码会关单 → RED）；提示含「已全部入库」。
2. **复位后再入库并勾选** → 期望入库成功且 `status=closed`、提示「已关闭」（回归现行为）。
3. 未勾、部分入库 → 提示「入库已提交」，订单不关。
4. 每步真实入库后复位（`Stock` 减回、`StockRecord` 删、`receivedQty=0`），结束重跑 MRP。
5. `server`/`client` `npm run build` 通过。

## 留给施工者的自由裁量

文案措辞可微调；提示用 `ElMessage.success` 还是带时长定制由实现定；不影响上述断言。

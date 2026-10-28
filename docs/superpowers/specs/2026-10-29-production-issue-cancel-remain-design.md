# 生产发料「取消未发量」设计（2026-10-29）

## 目的

生产订单的领料明细里，未发量有时不再需要发（改用替代料、工艺调整等）。目前只能把
`requiredQty` 改小到等于已发量，丢掉了原始需求量、也无法让 MRP 认账。本设计新增
「取消未发量」标记：**按行勾选**，勾上后该行未发量归零、不再需要发料，MRP 不再为这部分
出采购/生产建议。

## 目标 / 非目标

- 目标：按行取消未发量；取消后未发=0、不能再发料；MRP 冲抵该部分需求；可追溯（保留原始需求量）。
- 非目标：不做「撤销取消」（本期）；不改发料单据打印；不改历史数据（`cancelledQty` 默认 0）。

## 方案（已选：完整版 + 每行勾选）

被否的轻量版（直接把 `requiredQty` 改成 `issuedQty`）不保留原始需求、MRP 仍按销售订单
BOM 出建议，故不采用。

### 数据（1 个迁移）

`20261029120000_add_cancel_remain_to_production_order_material`

- `ProductionOrderMaterial` 新增 `cancelledQty Float @default(0)`、`cancelledAt DateTime?`
- `MrpCheckLine` 新增 `cancelledQuantity Float @default(0)`（运算检查表可见取消冲抵量）
- 口径统一：**未发 = requiredQty − issuedQty − cancelledQty**；`requiredQty` 不变

### 后端

- `issueProductionOrderMaterials`
  - 入参新增 `cancelRemainMaterialIds?: number[]`；`items` 可为空（只取消不发料），此时不要求仓库
  - 发料上限由 `requiredQty - issuedQty` 改为 `requiredQty - issuedQty - cancelledQty`（含原子守卫）
  - 取消行：`cancelledQty = requiredQty - issuedQty`、`cancelledAt = now`；状态 `issued`（已发>0）或 `cancelled`（未发过）
  - 同一事务内完成，取消行写 `operationLog`；不写 `StockRecord`、不动库存
  - 仍受现有约束：订单 `closed` / `execStatus` 非 `pending|in_progress` 时不能取消
- `updateProductionOrderMaterial`：`cancelledQty` 随需求量收敛（`≤ requiredQty − issuedQty`），状态重算
- `MRP`
  - 手工单（无销售订单）子件需求 = `requiredQty − cancelledQty`（≤0 跳过）
  - 销售订单下达的单：取消量与已发料同口径作为冲抵（只统计未完工订单），净需求不再包含取消部分
  - `MrpCheckLine.cancelledQuantity` 落库，`净需求 = 毛需求 + 安全库存 − 库存 − 在途 − 在制 − 已发 − 已取消`

### 前端

- `/inventory/issue` 发料弹窗：每行新增「取消未发」勾选列（未发≤0 时禁用）；勾选后该行未发显示 0、
  「本次发放」置 0 并禁用；提交时与发料项一次调用
- 发料进度标记（列表）与生产订单领料单页的「已发/未发」按新口径计算
- `/mrp/inspection` 增加「已取消冲抵」列

### 文档

`AGENTS.md` 增加该规则一两句（未发口径、MRP 冲抵、接口参数）。

## 验证

1. `cd server && npm run build`；`cd client && npm run build`
2. 重启后端，`prisma migrate deploy`
3. curl：对已排产订单某行取消未发 → 行 `cancelledQty/未发` 正确 → 再对该行发料返回「超过未发数量」
4. `POST /mrp/calculate` 后查 `/mrp/check`，确认该物料 `cancelledQuantity` 与净需求
5. 测试数据复位（`cancelledQty=0`、删除测试产生的建议/流水）

## 风险

- 取消量按物料全局冲抵（与已发料同粒度），多订单共用物料时会把其他订单需求一起冲掉；
  与现有已发料冲抵一致，暂不细化到订单级。

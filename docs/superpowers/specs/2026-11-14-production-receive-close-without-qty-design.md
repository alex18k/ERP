# 生产入库/退库：勾选关闭订单可「纯关单」— 设计（短版）

日期：2026-11-14 ｜ 状态：待批准 ｜ 规模：小改动（前后端各 1 文件 + 文档）

## 意图 / 为什么

生产订单实际没做完、甚至一件都没入库（报废/终止）时，仓库用户要在「生产入库/退库」页把单关掉。
现在这一页做不到：前端与后端都硬校验数量，`quantity === 0` 直接报「入库/退库数量不能为0」，
正数又必须 ≤ 剩余可入库。用户只能先凑一条入库，或绕到生产订单编辑弹窗改状态。

用户已确认口径：**勾选「入库后关闭生产订单」时，数量允许填 0 / 留空 = 只关单，不产生入库流水、不动 `receivedQty`**；
填正数仍按现有规则照常入库（含剩余量校验）。负数退库与纯关单互斥（退库不关单）。

## 目标

- 前端：数量 0 且勾选关闭 → 允许提交，二次确认文案明确「仅关闭订单、不入库」。
- 后端：`POST /production/orders/:id/receive` 支持 `closeWorkOrder === true` 且数量为 0 的纯关单分支：
  同一事务只把 `status` 改为 `closed`，不生成单据号、不写 `StockRecord`、不碰 `Stock`/`MaterialBatch`/`receivedQty`。
- 返回结构兼容现有前端：`{ success: true, documentNo: null, receivedQty: <原值>, fullyReceived: false, closed: true }`。
- 权限不变（`stock:edit`），仓库角色可用；不新增接口、不改路由。

## 非目标 / 反目标

- 不放宽正数入库上限：填正数仍不能超过「计划 − 已入库」。
- 不允许负数 + 勾选关闭：退库依旧不关单，勾选框在数量为负时保持禁用。
- 不自动关闭：入满不勾选仍然只返回 `fullyReceived`，订单保持打开（沿用 2026-10-29 的约定）。
- 不改 `execStatus`：纯关单只动 `status`，与 `closeProductionOrder` 口径一致。
- 不动生产订单编辑弹窗、销售订单联动、MRP 口径；不回退销售订单。
- 不写额外操作日志表字段（沿用路由已有的 `operationLog("stock","receive")`）。

## 约束

- 项目无自动化测试套件，验收 = `cd server && npm run build`、`cd client && npm run build`（vue-tsc 严格 noUnusedLocals）+ `curl` 实测 + 浏览器实测。
- 纯关单分支必须在 `resolveUnitRate` 之前返回：数量为 0 时不应因「单位未维护换算关系」报错，也不应要求仓库/货位。
- 现有 `quantity === 0` 的两处报错（入口校验、折算后 `baseQty === 0`）要保留给「未勾选关闭」的场景，别顺手删掉。
- 纯关单允许 `execStatus === "none"`（未排产）：入库列表本来就显示未关闭的未排产单，`closeProductionOrder` 也是任何状态均可关闭；只有入库/退库才要求已排产。
- 并发：纯关单用 `updateMany({ where: { id, status: { in: ["planned","in_progress"] } }, data: { status: "closed" } })` 原子改状态；
  不生成单号所以不取 `lockOrderNo(ORDER_NO_LOCK.ST)`。

## 方案取舍

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. 入库接口内增纯关单分支** | `closeWorkOrder && 数量为 0` → 只关单；前端放开 0 校验 | **采用**：权限沿用 `stock:edit`、一次请求、语义集中在本页 |
| B. 前端改调 `PUT /orders/:id/close-order` | 零后端改动，复用 `closeProductionOrder` | 否：该接口要 `production:manage`，只有 `stock:edit` 的仓库角色会 403；且两个接口容易走岔 |
| C. 新增 `/receive-and-close` 专用接口 | 与 A 等价 | 否：多一层路由与权限声明，无收益 |

## 实现要点（给实现者）

### 1. `server/src/services/production.service.ts` — `receiveProductionOrderProduct`

在取到 `order`、`order.status === "closed"` 校验之后、`execStatus === "none"` 校验与 `resolveUnitRate` **之前**插入：

```
const closingOnly = closeWorkOrder === true && (!Number.isFinite(quantity) || quantity === 0);
if (closingOnly) {
  const closedResult = await prisma.productionOrder.updateMany({
    where: { id: order.id, status: { in: ["planned", "in_progress"] } },
    data: { status: "closed" },
  });
  return { success: true, documentNo: null, receivedQty: order.receivedQty, fullyReceived: false, closed: closedResult.count > 0 };
}
```

- 入口的 `if (!Number.isFinite(quantity) || quantity === 0) throw ...` 改为只在非纯关单时生效（放到 `closingOnly` 判断之后，或在纯关单分支返回后再校验）。
- `if (order.execStatus === "none") throw "尚未排产"` 与 `if (!warehouseId) throw "请选择入库仓库"` 同样移到纯关单分支之后（纯关单不需要仓库、不要求排产）。

### 2. `client/src/views/inventory/productionReceiveMake/index.vue` — `submit()`

- 计算 `const closeOnly = qty === 0 && form.closeWorkOrder`。
- `qty === 0 && !form.closeWorkOrder` → 提示「入库/退库数量不能为0；仅关闭订单请勾选“入库后关闭生产订单”」。
- `closeOnly` 为真时：跳过仓库 / 单位换算 / 剩余量校验，直接二次确认
  「将仅关闭生产订单 {orderNo}：不入库、不写库存流水、已入库数量保持 {receivedQty}。是否继续？」
- 请求体照常发 `{ quantity: 0, closeWorkOrder: true, ... }`（仓库字段有默认值，后端纯关单分支忽略）。
- 成功提示：`res.data?.closed` 且未入库 → 「生产订单已关闭（未入库）」。
- 页面底部提示补一句：数量填 0 并勾选关闭 = 仅关单不入库。

### 3. 文档

- `AGENTS.md` 生产入库段落补：数量 0 + 勾选关闭 = 纯关单（无流水、不动 `receivedQty`、不改 `execStatus`、允许未排产）。
- `开发日志.md` 追加一条。

## 验收

1. `cd server && npm run build`、`cd client && npm run build` 均 0 退出。
2. `curl -X POST /api/v1/production/orders/<id>/receive -d '{"quantity":0,"closeWorkOrder":true}'`：
   - 返回 `closed: true`、`documentNo: null`、`receivedQty` 不变；
   - psql 查订单 `status='closed'`、`receivedQty` 未变、无新 `StockRecord`、`Stock` 未变；
   - 再对该单提交任何入库 → 400「生产订单已关闭」。
3. `quantity: 0` 不带 `closeWorkOrder` → 400「入库/退库数量不能为0」。
4. 正数 + `closeWorkOrder: true` 且数量 > 剩余 → 400「入库数量超过剩余可入库数量」。
5. 负数 + 勾选关闭 → 仍走退库、不关单（勾选框在前端也禁用）。
6. 浏览器：数量 0 未勾选 → 提示；数量 0 勾选 → 弹「仅关单」确认 → 成功回列表，列表中该单消失（已关闭）；正数入库流程与原来一致。

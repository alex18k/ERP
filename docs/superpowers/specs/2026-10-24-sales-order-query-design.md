# 销售订单查询页 设计（2026-10-24）

## 意图
订单管理下新增「销售订单查询」菜单：以「一行 = 一个明细行」平铺展示销售订单主表 + 全部明细行，并提供高级查询。只读查询页。

## 方案（已选 A）
- **A（选中）**：复用 `GET /sales-orders`，后端 `listOrders` 增加 `conditions` 高级查询（`SALES_QUERY_FIELDS` + `buildPrismaQueryWhere`）；前端客户端平铺（每单展开为明细行），明细级条件在前端二次过滤行。分页按订单。
- B（未选）：新增后端 SQL 平铺接口、按明细行分页。弃用原因：与采购订单列表行为不一致、改动面大。

## 目标 / 非目标
- 目标：主表+明细列全覆盖；高级查询覆盖全部列字段；运算符 `=`/`<>`/`包含`/`>`/`<`/`>=`/`<=`/范围。
- 非目标：不在该页提供新增/编辑/删除/打印/导出；不做行级分页后端。

## 后端
- `server/src/services/salesOrder.service.ts`：新增 `SALES_QUERY_FIELDS`；`listOrders` 中 `parseQueryConditions` + `buildPrismaQueryWhere` 与基础筛选 AND 叠加；明细字段统一挂 `items`（toMany）合并为同一个 `items.some`；金额/数量走 number，日期走 date，状态走 enum。
- `server/src/controllers/salesOrder.controller.ts`：`listHandler` 对 `isQueryConditionError` 返回 400。
- 权限复用 `order:view`，无需改 seed。

## 前端
- 新页 `client/src/views/order/salesQuery/index.vue`：高级查询框（`QueryConditionBuilder`）→ 平铺表格 → 分页。`rows` computed 将每单展开为明细行（主表字段每行重复）；明细级条件在前端过滤行（同采购订单列表 `ITEM_FIELDS`/`matchCondition` 模式）。单据状态、行状态用色彩胶囊（`el-tag`）。
- 路由 `/order/sales-query`（name `SalesOrderQuery`）。
- 菜单：订单管理 → 销售订单查询（置于「销售订单维护」之后）。
- 接口复用 `orderApi.list`（附带 `conditions`）。

## 验证
- server `npm run build`、client `npm run build`。
- 重启后端后 curl：主表条件（`status`/`customerName`）、明细条件（`materialCode`/`quantity gte`）、`<>`、非法运算符 400。

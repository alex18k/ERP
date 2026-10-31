# 生产入库/退库 补全库存流水字段 — 设计（小改动）

日期：2026-10-31

## 意图

生产入库（成品/半成品）页面的「生产入库/退库」提交后写入的 `StockRecord` 信息要完整：
补上 **生效日期、源单号、经手人、仓管员**。用户明确：不需要物料备注输入（remark 维持现有自动文字）。

## 现状

`production.service.ts` 的 `receiveProductionOrderProduct`（正数入库与负数退库两条路径各写一条 `StockRecord`）目前只写：
物料/仓库/货位/数量/批号/类型/事务类型(RCT-WO)/单据号/行号/操作人/自动 remark。
缺：`effectiveDate`（为空，记录页只能按 createdAt 回显）、`orderNo`（源单号=生产订单号，现成未写）、`handler`、`keeper`。

参照：手工出入库（`stockIn`/`stockOut`）表头同样字段；采购收货把 `orderNo`=采购单号写流水。

## 方案（已选定）

- **前端**（`client/src/views/inventory/productionReceive/index.vue` 弹窗）：
  - 加「生效日期」`el-date-picker`（date，`YYYY-MM-DD`，默认今天）；
  - 加「经手人」「仓管员」，`el-select filterable clearable allow-create`，选项来自 `stockApi.handlers()` / `stockApi.handlers('keeper')`，默认空；
  - 提交时随现有参数一起传：`effectiveDate / handler / keeper`。源单号不录入（自动取生产订单号）。
- **后端**（`production.controller.ts` + `production.service.ts`）：
  - `receiveProductionOrderProduct` 新增可选参数 `effectiveDate?`、`handler?`、`keeper?`
    （string 透传前 trim；`effectiveDate` 有值转 `new Date()`，缺省 `new Date()`，与手工出入库同口径）；
  - 两条 StockRecord 路径统一补写：`orderNo: order.orderNo`（源单号）、`effectiveDate`、`handler: handler||null`、`keeper: keeper||null`。
- **remark 维持现状**（「生产入库 X 生产订单MO…」/「生产退库 …」），不加密文备注字段。
- 入库与退库共用弹窗字段（同一张单生效）。

## 非目标

- 不改手工出入库/采购收货/移库等其他写流水的路径；
- 不加打印、不加记录页筛选（`effectiveDate`/`handler`/`keeper` 筛选手工出入库记录页已有）。

## 约束

- 接口权限不变（`stock:edit`）；handlers 下拉复用 `GET /stocks/handlers`（`stock:view`），页面用户均具备。
- 不改 schema（字段均已存在于 `StockRecord`），无迁移。

## 留给实现者的

- `orderNo` 写生产订单号与销售发运「orderNo=销售订单号」同语义（源单据号），无需用户输入。

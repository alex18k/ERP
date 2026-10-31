# 生产入库/退库录页 加分组框 — 设计（小改动）

日期：2026-10-31

## 意图

给 `views/inventory/productionReceiveMake`（生产入库/退库录入页）加「分组框」，把页面拆成两个带边框的区块：**订单信息框** + **录入信息框**（用户已选“两个框”）。

## 范式

复用仓库既有分组框样式（`.erp-group` / `.kd-grid` / `.kd-field` / `.kd-header-form`），与库存入库 `views/inventory/stockIn`、采购/销售维护页一致：1px `#d5dae2` 边框、6px 圆角、`#fafbfc` 底、五列网格、行距收紧。样式按仓库惯例在本页 `scoped` 内复制一份。

## 结构

1. **框一「生产订单」**：`el-descriptions`（生产订单号 / 产品 / 已入库-计划 / 剩余可入库）外包 `.erp-group`，内加 `.erp-group-title` 标题；只读，无交互变化。
2. **框二「入库信息」**：现有 `el-form` 全部录入项改入 `.kd-grid` 五列网格、`kd-field` 单元：
   - 入库仓库、货位（binManaged 时）、入库/退库数量、计量单位、批号、生效日期、经手人、仓管员；
   - 备注（textarea）占整行（`kd-field-remark`）；
   - 关闭订单 checkbox 单独一行或占两列。
3. 顶部工具栏（标题/返回/提交）不变；提交校验、接口调用、跳转全部不变。

## 非目标

- 不改任何业务逻辑、校验、接口与路由；不动列表页；不引入新组件库/全局样式改动。

## 约束

- client 严格模式（vue-tsc noUnusedLocals）：删掉不再使用的 `.form-grid`/`.receive-form` 样式与无用类名。
- 仅前端 build 验证（项目无测试套件）；无 schema/接口变更。
- 维持窄屏可用：`kd-grid` 五列沿用库存入库页的现有响应处理（不新增断点，与仓库现状一致）。

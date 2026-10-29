# 生产发料：弹窗改独立页面（跟单走）

## 意图

现在「生产发料」（`/inventory/issue`）是列表页 + 960px 弹窗。弹窗里放了表头 3 项、11 列明细、以及每行的货位/批号远程下拉，实际操作时横向拥挤、容易点错库位和批号。用户要求改成页面级维护，并且**跟着单据走**：从列表某一行进单，页面只服务这一张生产订单，提交后回列表。

## 目标

- 发料操作在独立页面完成，不再弹窗。
- 仍从「生产发料」列表某一行进入（`?orderId=`），页面头部显示该生产订单，提交后返回列表并刷新发料状态。
- 现有全部语义原样保留：按行库位算库存、货位、批号（批号管理物料必选）、计量单位换算、未发口径 `需求量−已发−已取消`、每行「取消未发」勾选、超发跳过提示、`cancelRemainMaterialIds` 与 `items` 同事务提交。

## 非目标

- 不做页内换单（不加订单搜索选择器、提交后不留页面继续下一单）。
- 不改后端接口、不改表结构、不动 MRP。
- 不改「生产入库」页（`/inventory/production-receive`）的弹窗。
- 不顺手改列表页的按钮文案（保持「领料」）。

## 反目标

- 出现两套发料入口（列表弹窗 + 页面）并存。
- 页面能进入「已关闭 / 未排产 / 执行已关闭 / 已完工」的订单并发料成功。
- 提交成功后停在页面上，让用户对同一张单重复提交。

## 约束

- 项目约定：一个目录一个页面（`views/<模块>/<名称>/index.vue`）、路由与菜单分离注册、录入页不进菜单。
- 参照实现：材料出库 = 列表 `/inventory/material-out-maintain` + 录入页 `/inventory/material-out`（顶部 `返回` + 提交按钮）。
- `client` tsconfig 严格（`noUnusedLocals`），删弹窗时残留的 `ref`/`import` 必须一起清掉。
- 数据来源只有 `GET /production/orders/:id/materials`（返回整张生产订单：`orderNo`/`material`/`quantity`/`status`/`execStatus`/`plannedQty`/`materials[]`），仓库与库存仍走 `warehouseApi.list` / `stockApi.list` / `stockApi.batches` / `warehouseBinApi.list`。

## 方案

- **A（已选）新增录入页目录**：`client/src/views/inventory/issueMake/index.vue`，路由 `inventory/issue-make`（name `InventoryIssueMake`，title「生产发料」），不进菜单；列表页「领料」`router.push({ path: '/inventory/issue-make', query: { orderId: row.id } })`；`issue/index.vue` 的弹窗模板与其专属状态、方法整体删除。与材料出库同构，代价是多一个目录和一行路由。
- B 同目录拆 `issue/make.vue`：少一层目录，但违反「一目录一页面」约定，不选。
- C 单页面双模式（`?orderId` 切换模板）：只注册一条路由，但一个文件两套模板/状态，`onMounted`、表格高度、面包屑都要分支，不选。

## 已定的做法

- **页面结构**：`page-container > page-card` 单卡片。工具栏一行：标题「生产发料」+ `返回`（回 `/inventory/issue`）+ 右侧 `提交发料`（loading 态）；下面 `el-descriptions`（生产订单号 / 产品 / 订单数量 / 状态 / 执行状态），再下面表头表单（库位、生效日期、本次发放数量 + 重算），再下面明细表（列同现弹窗），最后一行汇总（已填行数 / 合计数量）。
- **进入校验**：无 `orderId` 或非数字 → `ElMessage.warning` + 回列表。订单 `status=closed`、`execStatus in (none, closed, completed)` → 页面上显示提示并禁用提交，只留 `返回`（与后端拒绝口径一致）。
- **数据加载**：进页面 `Promise.all` 拉仓库 + 订单明细；库位默认取明细行共同库位，无共同库位则回落产品库位，再回落首个启用仓库（沿用现有 `openDialog` 的逻辑）。
- **提交**：沿用现有 `submit()` 全部校验与载荷；成功后 `ElMessage.success`（发料 N 行 / 取消未发 N 行），有跳过行则 `ElMessageBox.alert` 明细，然后 `router.push('/inventory/issue')`。
- **取消/返回**：顶部 `返回` 与浏览器后退都直接回列表，不做"未保存"拦截（与材料出库录入页一致）。
- **清理**：`issue/index.vue` 里弹窗相关的 `dialogVisible`、`currentOrder`、`currentWorkOrder`、`detail`、`form`、库存/货位/批号加载函数、`submit`、`recalc`、`lineRemain`（列表仍需 `issueProgress`）等一并删除或迁移；列表页只保留查询、分页、状态标签、`issueProgress`。

## 留给实施者的

- 新页面文件的 import 深度（`views/inventory/issueMake/` → `../../../api`、`../../../utils/location`）。
- 明细表 `max-height` 取值（页面可用高度）与是否需要 `fixed` 列。
- `el-descriptions` 展示哪几项（建议 生产订单号/产品/订单数量/状态/执行状态）。
- 是否保留「本次发放数量 + 重算」这个批量辅助（现有效果：按订单数量等比填行）。

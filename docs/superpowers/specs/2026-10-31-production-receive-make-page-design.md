# 生产入库/退库 弹窗改独立录入页 + 备注字段 — 设计（小改动）

日期：2026-10-31

## 意图

把「生产入库（成品/半成品）」页的入库/退库弹窗改为独立录入页面（录入住单页），并新增「备注」录入字段。
备注口径（用户定）：备注以用户录入为准，没填就空白；**不再自动拼**「生产入库 X 生产订单MO…」（新流水历史流水不动）。

## 范式（已选定，同生产发料 issue-make 模式）

- 列表页：`views/inventory/productionReceive`（`/inventory/productionReceive`，菜单不变）删除弹窗及其状态/计算属性；「入库」按钮改为 `router.push('/inventory/production-receive-make?orderId=' + row.id)`。
- 录入页：新建 `views/inventory/productionReceiveMake/index.vue`，路由 `/inventory/production-receive-make`，**不注册菜单**（发料例外同款，AGENTS.md「Adding a page」豁免同 `/inventory/issue-make`）。
- 录入页顶部「返回」回列表页；提交成功 ElMessage（视 closed/fullyReceived 口径）并跳回列表。

## 录入页表单（弹性布局，字段≥原弹窗）

- 生产订单号 / 产品 / 已入库-计划 / 剩余可入库：只读展示；数据来自 `productionApi.receivableOrders({ id: orderId })`（一处小后端改动见下），未找到（订单已关闭等）提示并返回列表。
- 正数入库 / 负数退库：数量为**必填**；负数提交前保留「退库确认」二次确认；前端超剩余/超已入库校验保持，后端原子校验依旧兜底。
- 计量单位（基本单位+换算单位，折算提示）、批号（空自动生成/退库必填批管物料）、入库仓库（仅启用仓库，默认物料库位映射）、货位（binManaged 仓库显示）→ 逻辑原样从弹窗迁移。
- 生效日期（默认今天，本地时区 `todayStr()`）、经手人、仓管员（历史下拉+可手输，默认空）→ 原样迁移。
- **新增「备注」**：`el-input type="textarea"`，maxlength 500，可选；提交随 `remark` 字段传后端。

## 后端改动（仅两处小改）

1. `listReceivableProductionOrders`：支持 `id` 过滤（`where.id = Number(id)`，一行），供录入页按 id 拉单；列表页照旧不带 id。
2. `receiveProductionOrderProduct` 增可选参数 `remark?: string`；入库/退库两条 StockRecord 的 `remark` 改为 `remark?.trim() || null`（**删除**原模板文字）。controller 解构透传。

## 非目标

- 权限不变（stock:edit）；无 schema 变更、无迁移；手工出入库/采购收货等其他路径 remark 口径不动。

## 约束

- client strict noUnusedLocals：删除弹窗后必须清掉失效 import/函数。
- remark 空串/纯空白 → 存 null（不是 ""）。

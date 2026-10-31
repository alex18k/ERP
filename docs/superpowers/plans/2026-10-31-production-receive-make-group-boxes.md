# 生产入库/退库录页 分组框 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生产入库/退库录入页改成两个带边框的分组框（订单信息框 + 入库信息框）。

**Architecture:** 纯前端模板/样式改动，单文件。复用仓库既有的 `.erp-group`/`.kd-grid`/`.kd-field`/`.kd-header-form` 样式（与库存入库页一致），scoped 复制进本页；业务逻辑、校验、接口、路由一行不动。

**Tech Stack:** Vue 3 + Element Plus（vue-tsc strict noUnusedLocals）。

**Spec:** `docs/superpowers/specs/2026-10-31-production-receive-make-group-boxes-design.md`

## Global Constraints

- 只改 `client/src/views/inventory/productionReceiveMake/index.vue`；不动 script 逻辑（除非删除不再使用的样式类引用）。
- 项目无测试套件：验证 = `cd client && npm run build` 0 错误。
- 分组框样式数值与库存入库页一致：`border: 1px solid #d5dae2; border-radius: 6px; padding: 8px 12px 2px; margin-bottom: 12px; background: #fafbfc`；`.kd-grid` = `grid-template-columns: minmax(0,1.6fr) repeat(4, minmax(0,1fr)); column-gap: 16px; row-gap: 2px`。
- 顶部工具栏（标题/返回/提交）与所有字段名、绑定、校验文案保持不变。

## Review Focus

- **五列网格里长内容溢出**：备注 textarea 必须占整行（`grid-column: 1 / -1`）→ Task 1 模板核对。
- **字段遗漏**：原 10 个录入项（仓库/货位/数量/单位/批号/生效日期/经手人/仓管员/备注/关闭订单）一个不能少 → Task 1 build 后逐项核对。
- **v-loading/空订单态**：分组框改造不影响 loading 遮罩与异常跳转 → build + 代码核对。
- **旧样式残留**：`.form-grid`/`.receive-form` 若不再使用必须删除（避免无用样式）→ Task 1 步骤明确。
- **窄屏**：与库存入库页同样不做额外断点，保持仓库现状。

---

### Task 1: 录页模板改两个分组框

**Files:**
- Modify: `client/src/views/inventory/productionReceiveMake/index.vue`（仅 `<template>` 与 `<style scoped>`）

**Interfaces:**
- Consumes: 页面现有 script 状态（`order`、`form`、`warehouses`、`bins`、`handlerOptions`、`keeperOptions`、`unitOptions`、`baseHint`、`binRequired`、`remaining()`、`loadBins`、`submit`、`backToList`、`loading`、`submitting`）——签名全部不变。
- Produces: 无（无对外接口改动）。

- [ ] **Step 1: 顶部订单信息改为框一**

把现有 `el-descriptions` 包进：
```html
<div class="erp-group">
  <div class="erp-group-title">生产订单</div>
  <el-descriptions :column="4" size="small" :border="false">…原 4 项…</el-descriptions>
</div>
```

- [ ] **Step 2: 录入表单改为框二（五列网格）**

`el-form` 加 `class="kd-header-form"`，内容改为：
```html
<div class="erp-group">
  <div class="erp-group-title">入库信息</div>
  <div class="kd-grid">
    <div class="kd-field">…入库仓库…</div>
    <div class="kd-field" v-if="binRequired">…货位…</div>
    <div class="kd-field">…入库/退库数量…</div>
    <div class="kd-field">…计量单位…</div>
    <div class="kd-field">…批号…</div>
    <div class="kd-field">…生效日期…</div>
    <div class="kd-field">…经手人…</div>
    <div class="kd-field">…仓管员…</div>
    <div class="kd-field kd-field-remark">…备注 textarea（占整行）…</div>
    <div class="kd-field kd-field-span2">…关闭订单 checkbox…</div>
  </div>
</div>
```
字段绑定、`v-if`、`@change`、placeholder 全部原样。

- [ ] **Step 3: 替换样式**

删除 `.receive-form`、`.form-grid`，新增（数值照 Global Constraints）：
`.erp-group`、`.erp-group-title`、`.kd-grid`、`.kd-field-remark { grid-column: 1 / -1; }`、`.kd-field-span2 { grid-column: span 2; }`、`.kd-header-form .kd-grid :deep(.el-form-item) { margin-bottom: 6px; margin-right: 0; }`、label/content 行高 26px 三条、`.unit-hint` 保留。

- [ ] **Step 4: 验证构建**

Run: `cd client && npm run build`
Expected: 退出码 0，无 TS/vue-tsc 错误。

- [ ] **Step 5: Commit**

```bash
git add client/src/views/inventory/productionReceiveMake/index.vue
git commit -m "style: 生产入库/退库录页改为两个分组框"
```

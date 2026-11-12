# 生产订单「已计划」行配色 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生产订单主列表中状态为「已计划」的行整行浅橙高亮 + 首列橙色左标，视觉与采购订单草稿行一致。

**Architecture:** 纯前端单文件改动 —— `el-table` 挂 `:row-class-name`，本页 `<style scoped>` 内用 `:deep()` 写 4 条行底色规则（`!important` 压过 stripe，选中行显式还回 Element 浅蓝）。不改后端、不改数据、不抽公共样式。

**Tech Stack:** Vue 3 `<script setup lang="ts">` + Element Plus `el-table` + scoped CSS。

**Spec:** `docs/superpowers/specs/2026-11-12-production-planned-row-highlight-design.md`

## Global Constraints

- 判据**只认状态列**：`row.status === 'planned'`；**禁止**用 `execStatus`（`none`/`pending`…）做判据 —— 规格明确"已计划但已排产照样染色、已下达但未排产不染色"。
- 只允许改 `client/src/views/production/order/index.vue` 一个文件；不得改采购订单页、`global.css`、后端、路由、菜单。
- 色值固定：常态 `#fff7e6`、hover `#ffefd1`、左标 `inset 3px 0 0 var(--el-color-warning)`、选中行 `var(--el-color-primary-light-9)`。
- 不动三个弹窗（批量排产 / 编辑 / MRP 下达）里的表格。
- 项目**无自动化测试套件**：门禁 = `cd client && npm run build`（`vue-tsc -b` 严格，`noUnusedLocals`，未使用的函数直接构建失败）零退出 + 浏览器实测。构建必须用 `npm run build`，`npx vite build` 会跳过 `vue-tsc`。
- UI 文案与提交信息用中文。

## Review Focus

以下输入/状态最容易出错，逐条对应到任务里的验证步骤：

1. **stripe 斑马纹盖过行底色** → 颜色"看着加了但没生效"。对应 Task 1 Step 4 的断言②。
2. **选中行被橙色盖住**（点了行却看不出选中）→ 必须有 `.current-row` 覆写。对应 Step 4 断言③。
3. **判据写成 `execStatus === 'none'`**（参考语境里"未排产"更顺口）→ 与规格相反。对应 Step 4 断言①（挑一条「已下达但未排产」或「已计划但已排产」的行验证；当前库 14 条订单，`planned` 1 / `in_progress` 7 / `closed` 6）。
4. **hover 态缺失** → 与采购页不一致。对应 Step 4 断言④。
5. **既有文字色被影响**（逾期红 / 今日琥珀 / 已入库绿）或**筛选、翻页后行类丢失**。对应 Step 4 断言⑤⑥。
6. **`rowClassName` 写了没挂到模板 / 变量未使用** → `vue-tsc` `noUnusedLocals` 构建失败。对应 Step 2。

---

### Task 1: 主列表「已计划」行高亮

**Files:**
- Modify: `client/src/views/production/order/index.vue`（三处：script 约 L221 `canSchedule` 附近、模板约 L545 主列表 `<el-table>`、`<style scoped>` 约 L804 起）

**Interfaces:**
- Consumes: `list`/`flatRows` 行对象上的 `status` 字段（值 `planned`/`in_progress`/`closed`，来自 `productionApi.orders`）；Element Plus `el-table` 的 `:row-class-name` prop（本页尚未使用）。
- Produces: `function rowClassName({ row }: any): string` —— 返回 `'row-planned'` 或 `''`；CSS 类名 `row-planned`（模板 `:row-class-name="rowClassName"` 消费，后续任何改动都不得改名）。

- [ ] **Step 1: 加 `rowClassName` 函数**

在 `canSchedule`（L221-223）之后插入，注释说明口径：

```ts
// 已计划行整行高亮，便于与已下达/已关闭区分（口径同采购单草稿行，只看 status 不看 execStatus）
function rowClassName({ row }: any) {
  return row.status === 'planned' ? 'row-planned' : ''
}
```

- [ ] **Step 2: 挂到主列表表格并跑构建（先证伪再证实）**

模板 L545 的 `<el-table :data="flatRows" v-loading="loading" stripe …>` 补一个属性 `:row-class-name="rowClassName"`。

先故意不加该属性跑一次构建，确认 `vue-tsc` 报 `TS6133: 'rowClassName' is declared but its value is never read`（证明构建确实会拦住"写了没挂"的错）；再加属性复跑。

Run: `cd client && npm run build`
Expected: 首轮 **FAIL**（TS6133）；补上属性后 **PASS**（0 退出，末行 `✓ built`）。

- [ ] **Step 3: 写 4 条 `:deep` 样式**

在本页 `<style scoped>`（L804）末尾追加，色值照抄采购页 `purchase/order/index.vue:324-336`：

```css
/* 已计划行整行浅橙标识（同采购单草稿行） */
:deep(.el-table__row.row-planned > td.el-table__cell) { background-color: #fff7e6 !important; }
:deep(.el-table__row.row-planned:hover > td.el-table__cell) { background-color: #ffefd1 !important; }
:deep(.el-table__row.row-planned > td.el-table__cell:first-child) { box-shadow: inset 3px 0 0 var(--el-color-warning); }
:deep(.el-table__row.row-planned.current-row > td.el-table__cell) { background-color: var(--el-color-primary-light-9) !important; }
```

- [ ] **Step 4: 浏览器实测（6 条断言）**

前置：后端 `localhost:3000/api/health` 200、前端 `localhost:63130` 200；用 `playwright@1.49.1`（node，浏览器已缓存在 `~/.cache/ms-playwright`）写临时脚本，admin/admin123 登录后进 `/production/order`（路由以 `client/src/router/index.ts` 为准，菜单名「生产订单」），逐条断言：

- ① **判据**：两层钉死（现有数据里 `planned` 那行恰好也是 `execStatus==='none'`，纯行为断言区分不了两条判据，故加静态断言）——
  (a) 行为：`status==='planned'` 的行带 `row-planned` 类，`status==='in_progress'`/`closed` 的行**不带**；
  (b) 静态：`grep -n "rowClassName" -A3 client/src/views/production/order/index.vue` 显示函数体含 `row.status === 'planned'`，且该函数体内**不出现** `execStatus`。
- ② **底色生效**：`row-planned` 行 `td` 的 `background-color` 计算值为 `#fff7e6`（不是斑马纹的白/灰）。
- ③ **选中态**：点击该行后 `td` 计算值变为 `--el-color-primary-light-9`（约 `#ecf5ff`），且行有 `current-row` 类。
- ④ **hover**：鼠标悬停该行，计算值 `#ffefd1`。
- ⑤ **既有颜色不受影响**：逾期日期仍红字（`due-overdue`）、已入库>0 仍绿字（`qty-done`）——取有值的行各查一个。
- ⑥ **筛选/翻页后仍在**：状态下拉选「已计划」查询后该行仍带类；清筛选翻到第 2 页再翻回，行类不丢。

Run: `node <临时脚本>`（跑完删除脚本）
Expected: 6/6 PASS，0 FAIL。若断言②失败，优先怀疑 `!important` 缺失或选择器层级（对照采购页同名规则），不要改判据。

- [ ] **Step 5: 复跑构建 + 提交**

Run: `cd client && npm run build`
Expected: 0 退出。

```bash
git add client/src/views/production/order/index.vue
git commit -m "feat(production): 生产订单列表已计划行整行高亮"
```

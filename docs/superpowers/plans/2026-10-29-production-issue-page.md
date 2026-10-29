# 生产发料改独立页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「生产发料」从列表页弹窗改成跟单走的独立页面（`/inventory/issue-make?orderId=<id>`），列表只保留查询与入口。

**Architecture:** 新增录入页 `views/inventory/issueMake/index.vue`，把原弹窗的表头表单、明细表（含库存/货位/批号远程加载）、重算、取消未发、提交整体迁移过去；列表页 `issue/index.vue` 的弹窗及其专属状态/函数全部删除，`领料` 按钮改为路由跳转。与「材料出库」= 列表 `material-out-maintain` + 录入页 `material-out` 同构。

**Tech Stack:** Vue 3 + Vite + Element Plus + vue-router（前端）；后端接口不变（`POST /production/orders/:id/issue`、`GET /production/orders/:id/materials`）。

**Spec:** `docs/superpowers/specs/2026-10-29-production-issue-page-design.md`

## Global Constraints

- 只改 `client/` 与 `AGENTS.md`；**后端代码、Prisma schema、接口一律不动**。
- 路由与菜单分离：新路由**不进** `MainLayout.vue` 的 `menuItems`（录入页，参照 `inventory/material-out`）。
- 从 `views/inventory/issueMake/` 引 `src/api` 用 `'../../../api'`，`utils` 用 `'../../../utils/location'`。
- `client` tsconfig **严格 `noUnusedLocals`**：删弹窗后残留的未使用 `ref`/`computed`/import 会让 `npm run build` 失败，必须一并删干净。
- 列表页 `issue/index.vue` 完成后**不得再有 `el-dialog`**（`grep -n el-dialog` 为空）。
- 业务语义零改动，照抄现有实现：按行库位算当前库存（货位管理仓库选了货位取该货位结存，否则取仓库合计）、批号管理物料必选批号、本次发放超库存标红、未发 = `requiredQty − issuedQty − cancelledQty`、勾选「取消未发」后本次发放置 0 并禁用、`items` 与 `cancelRemainMaterialIds` 同一次请求提交。
- 提交接口签名（已存在，勿改）：`productionApi.issueOrderMaterials(productionOrderId: number, data: { warehouseId?, effectiveDate?, items: {workOrderMaterialId, quantity, unit?, location?, warehouseId?, binId?, batchNo?}[], cancelRemainMaterialIds?: number[] })`，返回 `{ documentNo, issued[], cancelled[], skipped[] }`。
- 本项目**无自动化测试框架**：每个任务的验证 = `npm run build` + Playwright 脚本（`/tmp/opencode/verify-*.js`，`playwright-core` 与 chromium 已在 `/tmp/opencode` 可用）+ 需要时 `curl`/`psql`。前端改动一律走 `cd client && npm run build`（`vue-tsc -b && vite build`），**不要用 `npx vite build`**。
- 涉及真实发料的验证必须**复位测试数据**（见 Task 3 Step 6），并在最后重跑一次 MRP。
- 提交信息用中文，与本仓库既有风格一致（`feat(inventory): ...`）。

## Review Focus

- 直接访问 `/inventory/issue-make?orderId=<已关闭或不存在的订单>` — 期望：提示后回列表，不出现可提交表单、不白屏、不抛未捕获异常。
- `orderId` 缺失 / 非数字 — 期望：提示并回列表。
- 明细行库位为空、或库位码不对应任何启用仓库 — 期望：提交被拦，提示具体物料行，不发料。
- 批号管理物料未选批号、货位管理仓库未选货位 — 期望：分别提示，不发料。
- 提交后有跳过行（超发/行已结清）— 期望：弹出跳行明细，而不是只报"成功"；随后回列表。

---

### Task 1: 新增发料页骨架 + 路由 + 只读明细

**Files:**
- Create: `client/src/views/inventory/issueMake/index.vue`
- Modify: `client/src/router/index.ts`（在 `inventory/issue` 那行之后插入一行）
- Verify: `/tmp/opencode/verify-issue-page-1.js`（临时脚本，不进仓库）

**Interfaces:**
- Consumes: `productionApi.orderMaterialsOfOrder(id)` → `res.data` 为整张生产订单（`orderNo`、`material{code,name,location}`、`quantity`、`status`、`execStatus`、`plannedQty`、`materials[]` 每项含 `id/material/requiredQty/issuedQty/cancelledQty/unit`）；`warehouseApi.list({pageSize:200})` → `res.data.items[]`（`id/code/name/status/binManaged`）。
- Produces: 路由 `inventory/issue-make`（name `InventoryIssueMake`，meta.title `生产发料`）；页面内部 `order: Ref<any>`、`detail: Ref<any[]>`、`backToList()`，供 Task 2/3 使用。

- [ ] **Step 1: 注册路由**

在 `client/src/router/index.ts` 的 `{ path: 'inventory/issue', ... }` 之后插入：

```ts
      { path: 'inventory/issue-make', name: 'InventoryIssueMake', component: () => import('../views/inventory/issueMake/index.vue'), meta: { title: '生产发料' } },
```

- [ ] **Step 2: 建页面骨架（script）**

创建 `client/src/views/inventory/issueMake/index.vue`。script 部分包含：

```ts
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { productionApi, warehouseApi } from '../../../api'
import { warehouseIdByLocation } from '../../../utils/location'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const submitting = ref(false)
const warehouses = ref<any[]>([])
const activeWarehouses = computed(() => warehouses.value.filter((w: any) => w.status === 1))
const order = ref<any>(null)
const detail = ref<any[]>([])
const form = reactive<any>({ warehouseId: null, issueQty: 0, effectiveDate: '' })
```

函数（本任务只做 1-3，其余 Task 2/3 补）：

1. `function lineRemain(m: any): number` — `Math.max(0, (m.requiredQty ?? 0) - (m.issuedQty ?? 0) - (m.cancelledQty ?? 0))`（与 `issue/index.vue:193-195` 同实现，故意各留一份，只有三行，不抽公共文件）。
2. `function backToList(): void` — `router.replace('/inventory/issue')`。
3. `async function loadPage(): Promise<void>`：
   - `const id = Number(route.query.orderId)`；若 `!Number.isInteger(id) || id <= 0` → `ElMessage.warning('缺少生产订单参数')` + `backToList()` + `return`。
   - `loading.value = true`；`try` 内并行 `warehouseApi.list({ pageSize: 200 })` 与 `productionApi.orderMaterialsOfOrder(id)`，仓库结果写入 `warehouses.value`。
   - 订单不存在（接口抛错）→ `ElMessage.warning('生产订单不存在')` + `backToList()`。
   - 拿到订单后调用 `assertIssuable(data)`：`status === 'closed'`、`execStatus` 为 `none`/`closed`/`completed` 之一 → `ElMessage.warning(<对应原因，文案见下>)` + `backToList()` + `return`；原因文案：已关闭=`该生产订单已关闭，不能发料`，未排产=`该生产订单尚未排产，不能发料`，执行关闭=`该生产订单执行已关闭，不能发料`，已完工=`该生产订单已完工，不能发料`（与后端 `production.service.ts:1013-1017` 及 `完工不能取消未发` 口径一致）。
   - 组装 `detail.value`：逐项映射为 `{ workOrderMaterialId: m.id, materialCode, materialName, material, unit, issueUnit, requiredQty, issuedQty: m.issuedQty ?? 0, cancelledQty: m.cancelledQty ?? 0, cancelRemain: false, location: m.material?.location || '', binId: null, issueQty: 0, batchNo: '', batches: [], batchesKey: '', batchesLoading: false }`（照 `issue/index.vue:268-284`）。
   - `order.value = data`；`form.issueQty = data.plannedQty ?? 0`；`form.effectiveDate = todayStr()`；`form.warehouseId = warehouseIdByLocation(启用仓库, data.material?.location) || 启用仓库[0]?.id || null`，其中"启用仓库"= `warehouses.filter(w => w.status === 1)`；最后按明细行共同库位覆盖（同 `issue/index.vue:236-248` 的 locCodes 逻辑）。
   - `finally { loading.value = false }`。
4. `function todayStr(): string` — 照 `issue/index.vue:162-166`。
5. `onMounted(loadPage)`。

- [ ] **Step 3: 建页面模板骨架**

`<template>` 结构（`page-container > page-card` 单卡片）：

```vue
<div class="page-container" v-loading="loading">
  <div class="page-card">
    <div class="search-bar">
      <span class="toolbar-title">生产发料</span>
      <el-button style="margin-left: 12px" @click="backToList"><el-icon><Back /></el-icon>返回</el-button>
    </div>
    <el-descriptions :column="5" border size="small" style="margin-bottom: 12px">
      <el-descriptions-item label="生产订单">{{ order?.orderNo }}</el-descriptions-item>
      <el-descriptions-item label="产品">{{ order?.material?.code }} - {{ order?.material?.name }}</el-descriptions-item>
      <el-descriptions-item label="订单数量">{{ order?.quantity }}</el-descriptions-item>
      <el-descriptions-item label="状态">{{ order?.status }}</el-descriptions-item>
      <el-descriptions-item label="执行状态">{{ order?.execStatus }}</el-descriptions-item>
    </el-descriptions>
    <el-table :data="detail" size="small" stripe max-height="calc(100vh - 320px)">
      <!-- 本任务只放只读列：物料 / 单位 / 库位 / 需求量 / 已发 / 未发 -->
    </el-table>
  </div>
</div>
```

只读列渲染：物料 = `{{ row.materialCode }} - {{ row.materialName }}`；单位 = `row.unit`；库位 = `row.location`；需求量 = `row.requiredQty`；已发 = `row.issuedQty`；未发 = `lineRemain(row)`。

- [ ] **Step 4: 构建验证**

Run: `cd client && npm run build`
Expected: `✓ built in ...`，无 `error TS`（尤其无 `noUnusedLocals` 报错）。

- [ ] **Step 5: 浏览器验证骨架与守卫**

写 `/tmp/opencode/verify-issue-page-1.js`（`playwright-core` + `/home/ubuntu/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`，先 `admin`/`admin123` 登录 `http://localhost:63130/`），断言：

- 打开 `/inventory/issue-make?orderId=17` → 页面文本含 `MO202610290001`，明细表行数 = `GET /api/v1/production/orders/17/materials` 的 `data.materials.length`。
- 打开 `/inventory/issue-make`（无参）→ 最终 URL 为 `/inventory/issue`，且出现「缺少生产订单参数」提示。
- 打开 `/inventory/issue-make?orderId=999999` → 最终 URL 为 `/inventory/issue`，出现提示。
- 打开 `/inventory/issue-make?orderId=12`（已完工/已关闭订单）→ 最终 URL 为 `/inventory/issue`，出现「不能发料」类提示。
- `errors`（pageerror / console error）为空数组。

Expected: 全部断言通过。

- [ ] **Step 6: 提交**

```bash
cd /home/ubuntu/apps/WT && git add client/src/views/inventory/issueMake/index.vue client/src/router/index.ts && git commit -m "feat(inventory): 新增生产发料独立页面骨架与路由"
```

---

### Task 2: 迁移表头表单、库存/货位/批号与取消未发

**Files:**
- Modify: `client/src/views/inventory/issueMake/index.vue`
- Verify: `/tmp/opencode/verify-issue-page-2.js`

**Interfaces:**
- Consumes: Task 1 的 `order`/`detail`/`form`、`lineRemain`。
- Produces: `rowStock(row)`、`rowStockShort(row)`、`hasBinRows`、`rowBins(row)`、`recalc()`、`onCancelRemainChange(row)`、`onWarehouseChange(v)`、`onRowLocationChange(row)`、`onRowBinChange(row)`、`loadRowBatches(row)`、`rowUnitOptions(row)`、`locationOptions`，供 Task 3 的提交与模板使用。

- [ ] **Step 1: 原样搬移库存与货位/批号逻辑**

从 `client/src/views/inventory/issue/index.vue` 复制以下块到新页面（**函数体不变**，`warehouses`/`activeWarehouses` 沿用 Task 1 的定义）：

- 状态：`stockTotals`、`stockByBin`、`binsByWarehouse`（`issue/index.vue:29-31`）、`locationOptions`（:24）
- `warehouses`/`activeWarehouses` 已在 Task 1 建立，无需重复
- `selectedWarehouse`/`warehouseByCode`（:33-34）
- `rowWarehouse`、`rowWarehouseId`、`rowBinRequired`、`hasBinRows`、`rowBins`（:36-49）
- `loadWarehouseBins`（:51-67）、`onWarehouseChange`（:69-80）、`onRowLocationChange`（:82-89）、`loadStocks`（:91-121）
- `rowStock`（:123-130）、`rowStockShort`（:132-137）、`loadRowBatches`（:139-154）、`onRowBinChange`（:156-160）
- `buildLocationOptions`（:168-174）
- `rowUnitOptions`（:285-290）、`recalc`（:292-307，**保留** `if (line.cancelRemain) { line.issueQty = 0; continue }` 这两行）、`onCancelRemainChange`（:309-311）

`loadPage()` 末尾追加 `await loadStocks()`（在 `detail.value` 与 `form.warehouseId` 就绪之后）。

- [ ] **Step 2: 表头表单进模板**

在 `el-descriptions` 与明细表之间插入：

```vue
<el-form :model="form" label-width="110px" inline>
  <el-form-item label="库位">
    <el-select v-model="form.warehouseId" style="width: 220px" placeholder="选择库位" @change="(v: number) => onWarehouseChange(v)">
      <el-option v-for="w in activeWarehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
    </el-select>
    <span class="batch-loc-tip">一键设置所有行；库存按每行库位计算，可在行内单独改</span>
  </el-form-item>
  <el-form-item label="生效日期">
    <el-date-picker v-model="form.effectiveDate" type="date" value-format="YYYY-MM-DD" placeholder="选择生效日期" style="width: 160px" />
  </el-form-item>
  <el-form-item label="本次发放数量" style="margin-left: 40px">
    <el-input-number v-model="form.issueQty" :min="0" :precision="2" :controls="false" style="width: 160px" @change="recalc" />
    <el-button style="margin-left: 8px" @click="recalc">重算</el-button>
  </el-form-item>
</el-form>
```

（注意现弹窗里「重算」按钮无 `@click`，此处补上 `@click="recalc"`。）

- [ ] **Step 3: 明细表换成完整列**

替换 Task 1 的只读表为 `issue/index.vue:459-522` 的完整列（物料 / 单位 / 库位 / 货位（`v-if="hasBinRows"`）/ 需求量 / 已发 / 未发 / 取消未发 / 当前库存 / 本次发放 / 批号），逐列照抄；差异仅两处：

- 「未发」列仍用 `{{ row.cancelRemain ? 0 : lineRemain(row) }}`
- 表格 `max-height` 用 `calc(100vh - 320px)`（页面无弹窗，纵向可用更多）

页脚换成汇总行（在表格之后）：

```vue
<div class="issue-footer">
  <span>已填 <b>{{ detail.filter((l: any) => Number(l.issueQty) > 0).length }}</b> 行</span>
  <span>取消未发 <b>{{ detail.filter((l: any) => l.cancelRemain && lineRemain(l) > 1e-6).length }}</b> 行</span>
</div>
```

样式 `.batch-loc-tip`、`.stock-num`、`.stock-num.short`、`.issue-footer`（`display:flex; gap:16px; margin-top:8px; font-size:12px; color:var(--erp-steel)`）放进页面 `<style scoped>`。

- [ ] **Step 4: 构建验证**

Run: `cd client && npm run build`
Expected: PASS，无 TS 报错。

- [ ] **Step 5: 浏览器验证交互**

写 `/tmp/opencode/verify-issue-page-2.js`，断言（`/inventory/issue-make?orderId=17`）：

- 「当前库存」列至少有一行数字 > 0（对照 `GET /api/v1/stocks?warehouseId=..&materialIds=..` 粗略同量级即可）。
- 勾选某可勾行的「取消未发」→ 该行「未发」显示 `0`，且该行「本次发放」`input` 为 disabled。
- 把「本次发放数量」改成 `1` 并回车 → 已勾选行的 `issueQty` 仍为 0 / 仍勾选（`recalc` 跳过取消行）。
- 货位列：仅当存在 `binManaged` 仓库的行时表头出现「货位」。
- `errors` 为空。

Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
cd /home/ubuntu/apps/WT && git add client/src/views/inventory/issueMake/index.vue && git commit -m "feat(inventory): 发料页迁移库存/货位/批号与取消未发交互"
```

---

### Task 3: 提交发料 + 删除列表页弹窗

**Files:**
- Modify: `client/src/views/inventory/issueMake/index.vue`（提交逻辑 + 提交按钮）
- Modify: `client/src/views/inventory/issue/index.vue`（删弹窗，改入口跳转）
- Verify: `/tmp/opencode/verify-issue-page-3.js`

**Interfaces:**
- Consumes: Task 2 的 `recalc`/`rowStock`/`rowWarehouseId`/`lineRemain`/`detail`/`form`；`ElMessageBox`。
- Produces: `submit(): Promise<void>`；列表页 `openIssue(row)` → `router.push({ path: '/inventory/issue-make', query: { orderId: row.id } })`。

- [ ] **Step 1: 页面提交**

把 `issue/index.vue:313-370` 的 `submit()` 整体迁入新页面，差异：

- 仍用 `ElMessageBox.alert` 展示 `skipped` 明细（`dangerouslyUseHTMLString: true`）。
- 成功分支末尾：`ElMessage.success(parts.join('，') || '已提交')`（或跳行 alert 之后）→ `router.push('/inventory/issue')`，**不要**再 `loadData()`。
- 请求体与校验原样保留（含 `items.length > 0 && !form.warehouseId` → 「请选择库位」、批号必选校验、`badLine` 库位校验，三者都带 `!l.cancelRemain` / `Number(l.issueQty) > 0` 条件）。

工具栏右侧加提交按钮：

```vue
<el-button type="primary" :loading="submitting" @click="submit">确认发料</el-button>
```

- [ ] **Step 2: 删除列表页弹窗模板**

删除 `client/src/views/inventory/issue/index.vue` 中 `<el-dialog ...>` 到 `</el-dialog>` 的整段（当前 `436-528` 行）。删除后 `<template>` 内只剩 `page-container > page-card`（列表、分页）。

- [ ] **Step 3: 列表页改跳转并清理死代码**

- 把 `openDialog(order)` 替换为：

```ts
function openIssue(row: any) {
  router.push({ path: '/inventory/issue-make', query: { orderId: row.id } })
}
```

- 模板里 `@click="openDialog(row)"` 改为 `@click="openIssue(row)"`。
- 删除列表页中已无引用的内容：`dialogVisible`、`submitting`、`currentOrder`、`currentWorkOrder`、`detail`、`locationOptions`、`form`、`workOrderReqSeq`、`stockTotals`、`stockByBin`、`binsByWarehouse`、`selectedWarehouse`、`warehouseByCode`、`warehouses`（列表不再需要仓库）、`loadWarehouses`、`onWorkOrderChange`、`loadStocks`、`loadWarehouseBins`、`onWarehouseChange`、`onRowLocationChange`、`rowWarehouse*`、`rowBin*`、`hasBinRows`、`rowStock*`、`loadRowBatches`、`onRowBinChange`、`todayStr`、`buildLocationOptions`、`rowUnitOptions`、`recalc`、`onCancelRemainChange`、`submit`、`activeWarehouses` 及 `BASE_LOCATIONS`/`warehouseIdByLocation`/`warehouseBinApi`/`stockApi` 等随之无用的 import。
- **保留**：`statusOptions`/`statusLabel`/`statusType`、`issueProgressOptions`、`lineRemain`（`issueProgress` 用）、`issueProgress`、`workOrderOf`（控制「领料」按钮禁用）、`loadData`、`query`、`loading`、`list`、`total`。
- `onMounted` 只剩 `await loadData()`。
- 新增 `import { useRouter } from 'vue-router'` + `const router = useRouter()`。

- [ ] **Step 4: 构建验证（严格 tsconfig 会抓出漏删）**

Run: `cd client && npm run build`
Expected: PASS。若报 `TS6133 ... is declared but its value is never read`，按报错逐个删除残留声明后重跑。

- [ ] **Step 5: 端到端验证（真实发料）**

写 `/tmp/opencode/verify-issue-page-3.js`：

1. 登录 → `/inventory/issue` → 断言页面无 `.el-dialog`，且首行「领料」可点。
2. 点首行「领料」→ 断言 URL 变 `/inventory/issue-make?orderId=...`。
3. 从 `/inventory/issue-make?orderId=17` 直接进入，把「本次发放数量」设为 `1` 触发重算，只保留 1-2 行有数量（其余填 0），点「确认发料」→ 断言出现成功提示、URL 回到 `/inventory/issue`。
4. 记录返回的成功提示文案与接口写入的 `documentNo`（从 `StockRecord` 查，见下一步）。
5. 断言列表页该订单「发料状态」不再是「未领料」（若发料行数足以推进状态）。

Expected: 1-5 全部通过，`errors` 为空。

补充校验（Review Focus 剩余三项，逐条手动或脚本验证，验证后同样复位数据）：

- 库位校验：把某行「库位」改成不存在的编码（下拉可 `allow-create`，输入 `ZZZ` 回车），填正数数量后点「确认发料」→ 出现 `... 的库位「ZZZ」未对应启用仓库，请重新选择`，页面不跳转。
- 批号校验：找一条 `batchManaged` 物料的行，填数量、不选批号 → 出现 `批号管理物料必须选择批号`，不发料。
- 跳过行提示：代码与旧弹窗逐行一致（`skipped` 分支未改），以 `git diff` 对照确认即可；若能构造超发场景（同行已有 `issuedQty` 且数量 > 未发），验证弹出跳行明细且仍回列表。

- [ ] **Step 6: 复位测试数据并重跑 MRP**

```bash
cd /home/ubuntu/apps/WT
# 1) 用上一步的 documentNo 找到本次写入的流水
PGPASSWORD=erp123456 psql -h 127.0.0.1 -U erp -d erp -c "select id,\"documentNo\",\"materialId\",\"warehouseId\",\"binId\",quantity from \"StockRecord\" where \"relatedType\"='ProductionOrder' and \"createdAt\" > now() - interval '30 minutes';"
```

对每条流水：把 `quantity` 加回 `Stock`（同一 `materialId`/`warehouseId`/`binId` 行，`binId is null` 时用 `IS NULL` 匹配），然后 `delete from "StockRecord" where "documentNo" = '<上一步单号>'`；再把对应的 `ProductionOrderMaterial` 行复位 `issuedQty=0, cancelledQty=0, "cancelledAt"=null, status='pending'`。全程用 `BEGIN; ... COMMIT;` 单事务。

复位后重跑 MRP 恢复建议：

```bash
curl -s -X POST localhost:3000/api/v1/mrp/calculate -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

Expected: `code: 200`；`select count(*) from "ProductionOrderMaterial" where "cancelledQty" > 0;` 为 `0`。

- [ ] **Step 7: 提交**

```bash
cd /home/ubuntu/apps/WT && git add client/src/views/inventory/issueMake/index.vue client/src/views/inventory/issue/index.vue && git commit -m "feat(inventory): 生产发料改为独立页面，移除列表页弹窗"
```

---

### Task 4: 文档与全量回归

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: 前面三个任务的产出。
- Produces: 无（收尾）。

- [ ] **Step 1: 更新 AGENTS.md**

在 `## Adding a page (3 places, import depth)` 一节末尾补一行（说明发料录入页不进菜单）：

```
- 例外：**生产发料**是「列表 `/inventory/issue` + 录入住单页 `/inventory/issue-make?orderId=`」两页（参照材料出库 `material-out-maintain` + `material-out`），录入住单页**不注册菜单**，列表「领料」按 `orderId` 跳转，提交成功回列表。
```

- [ ] **Step 2: 双侧构建**

Run:
```bash
cd /home/ubuntu/apps/WT/server && npm run build
cd /home/ubuntu/apps/WT/client && npm run build
```
Expected: 两者均无 TS 报错。

- [ ] **Step 3: 接口与页面回归**

- `curl` 回归（Bearer token）：`/api/v1/production/orders`、`/api/v1/production/orders/17/materials`、`/api/v1/stocks`、`/api/v1/mrp/check`、`/api/v1/sales-orders` 全部 `code: 200`。
- Playwright 跑一遍 Task 1/2/3 的三个脚本，全部通过。
- `grep -n "el-dialog" client/src/views/inventory/issue/index.vue` → 无输出。

- [ ] **Step 4: 提交**

```bash
cd /home/ubuntu/apps/WT && git add AGENTS.md && git commit -m "docs: 记录生产发料列表页与录入住单页的两页结构"
```

---

## 完成判定

- `/inventory/issue` 只有列表（无弹窗），「领料」跳转到 `/inventory/issue-make?orderId=`。
- 发料页能完整完成原弹窗的所有操作（改单位/库位/货位/批号、重算、取消未发、提交、跳行提示），提交后回列表。
- 非法/不可发料订单进入页面时被拦回列表。
- `client npm run build`、`server npm run build` 通过；测试数据已复位；MRP 已重跑。

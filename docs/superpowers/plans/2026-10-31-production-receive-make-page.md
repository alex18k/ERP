# 生产入库/退库 独立录入页 + 备注 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生产入库/退库从弹窗改为独立录入页，并新增「备注」字段（备注按用户录入保存，未填为空，不再自动拼文字）。

**Architecture:** 仿生产发料（`issue-make`）双页模式：列表页保留，仅把「入库」按钮改为携带 `orderId` 跳转；新建录入页读取 `orderId` → `GET /production/orders/receivable?id=` 拉单据（本次给 receivable 加 `id` 过滤）→ 表单提交 `POST /production/orders/:id/receive`（本次给 service 加 `remark` 参数，两条 StockRecord 的 remark 改为用户备注或 null）。

**Tech Stack:** Node + Express 5 + Prisma（tsx 运行）、Vue 3 + Element Plus（vue-tsc 严格 noUnusedLocals）。

**Spec:** `docs/superpowers/specs/2026-10-31-production-receive-make-page-design.md`

## Global Constraints

- 项目无自动化测试套件（AGENTS.md）：每任务验证 = 对应端 `npm run build` 通过；端到端用 Task 3 的 curl 步骤。
- 备注口径：`remark?.trim() || null`，**删除**原自动拼文字（「生产入库 X 生产订单MO…」）；历史流水不动。
- 路由与目录同名：`views/inventory/productionReceiveMake` ↔ `/inventory/production-receive-make`；**不注册菜单**；参照 `/inventory/issue-make`。
- client 严格模式：删弹窗后必须清理失效的 import / ref / computed / 函数，否则 build 失败。
- 权限不变（`stock:edit`）；无 schema 变更、无迁移；不动其他出入库路径。
- 本分支沿用 `feat/production-receive-stockrecord-fields`（上批工作按用户要求保留未合并）。

## Review Focus

- **已关闭/不存在的 orderId**：录页不能白屏或崩溃 → Task 3 用非法 id 调 receivable 验证回退行为。
- **备注为空/纯空白**：必须落 `null` 而非 `""`、也不能拼回自动文字 → Task 3 用不带 remark 的提交核对。
- **备注填写**：写入两条路径（入库/退库）的 remark → Task 3 退库带备注验证。
- **旧链接直达**：列表页不再弹窗，弹窗删除后无残留引用（否则 runtime 报 undefined）→ Task 2 build + 代码清理检查。
- **单位折算与超量校验**：迁移后正数入库/负数退库的前端校验行为不变 → Task 3 用超量数量提交验证 400 提示仍在。

---

### Task 1: 后端 — receivable 按 id 过滤 + receive 支持 remark

**Files:**
- Modify: `server/src/services/production.service.ts`（`listReceivableProductionOrders` ~1388；`receiveProductionOrderProduct` ~1415-1427 签名 + 两条 StockRecord 的 `remark` ~1500、~1556）
- Modify: `server/src/controllers/production.controller.ts`（`receiveProductionOrderHandler` ~299）

**Interfaces:**
- Consumes: 现有 `receiveProductionOrderProduct(..., closeWorkOrder?, effectiveDate?, handler?, keeper?)`。
- Produces:
  - `listReceivableProductionOrders(where)` 支持 `where.id`（正整数时过滤 `id`）。
  - `receiveProductionOrderProduct(..., keeper?: string, remark?: string)`；两条 `stockRecord.create` 的 `remark: remarkVal`（`const remarkVal = remark?.trim() || null`），**不再使用模板字符串**。
  - controller 解构 `remark` 并作为第 12 个实参透传。

- [ ] **Step 1: receivable 支持 id 过滤**

在 `listReceivableProductionOrders` 的 `filters` 组装处（`if (orderNo) ...` 之后）加：
```ts
if (where.id && Number.isInteger(Number(where.id))) filters.id = Number(where.id);
```

- [ ] **Step 2: service 签名 + remark 写入**

签名末尾（`keeper?: string` 后）追加 `remark?: string`；派生变量处（`keeperVal` 之后）加：
```ts
const remarkVal = remark?.trim() || null;
```
入库与退库两条 `stockRecord.create` 中，把 `remark: \`生产入库 ${material.name} 生产订单${order.orderNo}\`` / `remark: \`生产退库 ...\`` 两行**替换**为：
```ts
remark: remarkVal,
```

- [ ] **Step 3: controller 透传 remark**

`receiveProductionOrderHandler` 解构补 `remark`；调用实参末尾（`keeper` 后）追加 `remark`。

- [ ] **Step 4: 验证构建**

Run: `cd server && npm run build`
Expected: `tsc` 无错误退出。

- [ ] **Step 5: Commit**

```bash
git add server/src/services/production.service.ts server/src/controllers/production.controller.ts
git commit -m "feat: 生产入库/退库支持备注写入，receivable 支持按 id 查询"
```

---

### Task 2: 前端 — 列表页瘦身 + 新建录入页 + 路由

**Files:**
- Modify: `client/src/views/inventory/productionReceive/index.vue`（删除弹窗及全部弹窗状态）
- Create: `client/src/views/inventory/productionReceiveMake/index.vue`
- Modify: `client/src/router/index.ts`（不注册菜单）

**Interfaces:**
- Consumes: Task 1 的 `GET /production/orders/receivable?id=` 与 `POST /production/orders/:id/receive`（新增 `remark`）。
- Produces: 路由 `/inventory/production-receive-make`；列表「入库」→ `router.push('/inventory/production-receive-make?orderId=' + row.id)`。

- [ ] **Step 1: 列表页删除弹窗**

`productionReceive/index.vue`：删除 `dialogVisible/submitting/current/form/bins/handlerOptions/keeperOptions/warehouses/loadWarehouses/loadBins/openDialog/submit`、`activeWarehouses/selectedWarehouse/binRequired/productMaterial/unitOptions/unitRate/baseHint/remaining` 中不再被模板使用的部分（`remaining` 仍被列表剩余列与汇总使用，保留）；`import` 只留 `productionApi`、`ElMessage` 不需要的移除；`openDialog` 改为：
```ts
function openDialog(row: any) {
  router.push(`/inventory/production-receive-make?orderId=${row.id}`)
}
```
补 `import { useRouter } from 'vue-router'` 与 `const router = useRouter()`；删除 `<el-dialog>...</el-dialog>` 整块与 `.unit-hint` 样式（若不再使用）。

- [ ] **Step 2: 新建录入页骨架（script）**

`productionReceiveMake/index.vue` 参照 `issueMake/index.vue`：
- 取 `route.query.orderId`；非法 → `ElMessage.warning('缺少生产订单参数')` + `backToList()`（`router.replace('/inventory/productionReceive')`）。
- `loadPage()`：`warehouseApi.list({pageSize:200})` 与 `productionApi.receivableOrders({ id })` 并行；`res.data.items?.[0]` 为空 → 提示「生产订单不存在或已关闭」+ 返回。
- 状态：`order`、`warehouses`、`activeWarehouses`、`bins`、`handlerOptions`、`keeperOptions`、`loading`、`submitting`；`form = reactive({ quantity, unit, warehouseId, binId, batchNo, effectiveDate, handler, keeper, remark, closeWorkOrder })`。
- 迁移现有弹窗逻辑：`remaining()`、`unitOptions/unitRate/baseHint`、`loadBins()`（warehouseBinApi）、`todayStr()`、handlers 装载（`stockApi.handlers()` / `stockApi.handlers('keeper')`）。
- `loadPage` 初始化：`form.quantity = remaining(order)`、`form.unit = order.material?.unit`、仓库默认 `warehouseIdByLocation(activeWarehouses, order.material?.location) || activeWarehouses[0]?.id || null`、`form.effectiveDate = todayStr()`、handler/keeper 空、`remark` 空。

- [ ] **Step 3: 新建录入页提交逻辑**

`submit()` 复用弹窗校验（数量非 0、仓库必选、单位换算已维护、超剩余/超已入库拦截、退库二次确认、关闭订单二次确认），API 调用追加 `remark: form.remark || undefined`；成功后按 `returned/closed/fullyReceived` 分文案 `ElMessage.success`，再 `backToList()`。

- [ ] **Step 4: 新建录入页模板**

参照 `issueMake` 页面结构：`.search-bar` 内标题「生产入库/退库」+「返回」按钮 + 右侧「提交」按钮；`el-descriptions` 只读展示 生产订单/产品/已入库-计划/剩余可入库；`el-form inline` 或栅格放置：入库/退库数量（含正负提示与折算提示）、计量单位、入库仓库、货位（binManaged 才显示）、批号、生效日期、经手人、仓管员、**备注**（`el-input type="textarea"` maxlength 500，占整行）、关闭订单 checkbox（负数禁用）。

- [ ] **Step 5: 注册路由**

`client/src/router/index.ts` 在 `inventory/issue-make` 同级加：
```ts
{ path: 'inventory/production-receive-make', name: 'ProductionReceiveMake', component: () => import('../views/inventory/productionReceiveMake/index.vue') },
```
（字段风格以该文件现有条目为准；不注册菜单。）

- [ ] **Step 6: 验证构建**

Run: `cd client && npm run build`
Expected: `vue-tsc -b && vite build` 无错误（重点：无未使用变量）。

- [ ] **Step 7: Commit**

```bash
git add client/src/views/inventory/productionReceive/index.vue client/src/views/inventory/productionReceiveMake/index.vue client/src/router/index.ts
git commit -m "feat: 生产入库/退库改独立录入页并新增备注字段"
```

---

### Task 3: 端到端验证（curl）

**Files:** 无代码改动。

- [ ] **Step 1: 重启后端**

```bash
pkill -f "src/inde[x].ts" || true
```
单独执行后：
```bash
cd server && (setsid npx tsx src/index.ts > /tmp/erp-server.log 2>&1 < /dev/null &)
```
`curl -s localhost:3000/api/health` 返回 `code:200`。

- [ ] **Step 2: 登录取 token**（wh01/admin123）

- [ ] **Step 3: receivable 按 id 查询**

Run: `curl -s "localhost:3000/api/v1/production/orders/receivable?id=24" -H "Authorization: Bearer $TOKEN"`
Expected: `total=1`，items[0].id=24、含 `material.unit`；再查 `?id=999999` → `total=0`。

- [ ] **Step 4: 带备注入库**

Run: `POST /production/orders/24/receive`，body 带 `remark:'测试备注A'`（其余同上次已验证的字段）。
Expected: `code:200`，返回 `documentNo`。

- [ ] **Step 5: 不带备注退库**

`quantity:-1`、不带 `remark`（带 handler/keeper）。
Expected: `code:200`。

- [ ] **Step 6: by-document 核对**

两次 `GET /stocks/records/by-document?documentNo=...`：
- 带备注：`remark="测试备注A"`（**不含**自动文字）
- 不带备注：`remark=null`
- 两单 `orderNo`、`effectiveDate`、`handler`、`keeper` 均正常

- [ ] **Step 7: 超量仍被拒**

`POST receive` 数量 9999 → `code:400`（后端原子校验未破坏）。

- [ ] **Step 8: 汇报结果**

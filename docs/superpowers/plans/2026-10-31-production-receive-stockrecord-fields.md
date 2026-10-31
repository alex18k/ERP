# 生产入库/退库 补全库存流水字段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生产入库/退库提交时把 生效日期、源单号（生产订单号）、经手人、仓管员 写进 `StockRecord`。

**Architecture:** 前端弹窗（`productionReceive/index.vue`）新增 3 个输入（生效日期默认今天、经手人/仓管员历史下拉可手输），随请求透传；controller 解包后传入 service；service 在入库/退库两条 StockRecord 路径统一补写 `orderNo/effectiveDate/handler/keeper`。无 schema 变更、无迁移。

**Tech Stack:** Node + Express 5 + Prisma（server, tsx 运行）、Vue 3 + Element Plus（client, vue-tsc 严格模式）。

**Spec:** `docs/superpowers/specs/2026-10-31-production-receive-stockrecord-fields-design.md`

## Global Constraints

- 本项目**无自动化测试套件**（AGENTS.md）：每任务验证 = 对应端 `npm run build` 通过；端到端用 curl 按 Task 3 步骤。
- remark **维持现状**自动文字（「生产入库 X 生产订单MO…」/「生产退库 …」），不加密文备注字段（用户明确"不需要备注"）。
- `handler`/`keeper` 默认留空、写入时 trim 为空则存 `null`；`effectiveDate` 缺省 `new Date()`。
- 源单号不录入：`orderNo` 一律取 `order.orderNo`（生产订单号）。
- server 只能用 tsx 运行（`npm start` 是坏的）；重启用 `(setsid npx tsx src/index.ts > /tmp/log 2>&1 < /dev/null &)`，且 `pkill -f "src/inde[x].ts"` 必须单独一条命令。
- 改完 service 类型后必须 `npx prisma generate`？——**不需要**（无 schema 变更），仅需重启运行中的 tsx 服务。

## Review Focus

- **入库与退库两条路径都要补**：负数（退库）分支的 `stockRecord.create` 极易漏改 → Task 3 的 curl 同时验证一条退库流水。
- **非批号管理物料**：批号为 null 时流水其余字段仍需完整 → Task 3 用任意可入库订单验证。
- **空字符串 handler/keeper**：前端清空后提交空串，必须落 `null` 而非 `""` → Task 3 检查 by-document 返回。
- **effectiveDate 为空串/缺省**：必须回落当前时间、不能存 Invalid Date → build + curl 验证。
- **弹窗复用**：入库与退库共用同一弹窗，字段对两者都生效 → Task 3 退库 curl 带同样字段。

---

### Task 1: 后端 — service + controller 透传与写入

**Files:**
- Modify: `server/src/services/production.service.ts`（`receiveProductionOrderProduct`，约 1415 行起；两条 `stockRecord.create` 在 ~1483 与 ~1532）
- Modify: `server/src/controllers/production.controller.ts`（`receiveProductionOrderHandler`，299-316 行）

**Interfaces:**
- Consumes: 现有 `receiveProductionOrderProduct(productionOrderId, quantity, warehouseId, userId, batchNo?, unit?, binId?, closeWorkOrder?)`。
- Produces: 签名追加为 `(..., closeWorkOrder?: boolean, effectiveDate?: string, handler?: string, keeper?: string)`；内部派生 `effDate: Date` 与 `handlerVal/keeperVal: string | null`；两条 `stockRecord.create` 的 data 各加 4 个键：`orderNo: order.orderNo`、`effectiveDate: effDate`、`handler: handlerVal`、`keeper: keeperVal`。返回值不变。

- [ ] **Step 1: 修改 `receiveProductionOrderProduct` 签名**

在参数列表末尾（`closeWorkOrder?: boolean` 之后）追加：
```ts
effectiveDate?: string,
handler?: string,
keeper?: string
```
函数体开头（`return prisma.$transaction` 之前）加：
```ts
const effDate = effectiveDate ? new Date(effectiveDate) : new Date();
const handlerVal = handler?.trim() || null;
const keeperVal = keeper?.trim() || null;
```

- [ ] **Step 2: 两条 stockRecord.create 补 4 个字段**

入库（~1532）与退库（~1483）两处的 `data:` 对象里，在 `operatorId: userId,` 之后各插入：
```ts
orderNo: order.orderNo,
effectiveDate: effDate,
handler: handlerVal,
keeper: keeperVal,
```
（remark 一行保持不动。）

- [ ] **Step 3: controller 解包并透传**

`receiveProductionOrderHandler` 第 301 行解构补 `effectiveDate, handler, keeper`；调用在第 8 个实参后追加三个实参，与解构同名直接透传：
```ts
effectiveDate,
handler,
keeper
```

- [ ] **Step 4: 验证构建**

Run: `cd server && npm run build`
Expected: `tsc` 无错误退出。

- [ ] **Step 5: Commit**

```bash
git add server/src/services/production.service.ts server/src/controllers/production.controller.ts
git commit -m "feat: 生产入库/退库流水补写生效日期/源单号/经手人/仓管员"
```

---

### Task 2: 前端 — 弹窗加 生效日期/经手人/仓管员

**Files:**
- Modify: `client/src/views/inventory/productionReceive/index.vue`

**Interfaces:**
- Consumes: `stockApi.handlers()`、`stockApi.handlers('keeper')`（`client/src/api/index.ts` 已有，均返回 `string[]`）；Task 1 的接口新可选参数 `effectiveDate/handler/keeper`。
- Produces: 提交 payload 新增 `effectiveDate: string`（`YYYY-MM-DD`）、`handler/keeper: string | undefined`（空不传）。

- [ ] **Step 1: script 增加状态与装载**

- 导入行加 `stockApi`（现有 `import { productionApi, warehouseApi, warehouseBinApi } from '../../../api'`）。
- 增加两个 ref：`handlerOptions`、`keeperOptions`（`ref<string[]>([])`）。
- `form` 初始对象加 `effectiveDate: '', handler: '', keeper: ''`。
- `openDialog` 里重置：`form.effectiveDate = new Date().toISOString().slice(0, 10)`（默认今天）、`form.handler = ''`、`form.keeper = ''`。
- `onMounted` 里与现有加载并行调用：
```ts
stockApi.handlers().then((r: any) => { handlerOptions.value = r.data || [] })
stockApi.handlers('keeper').then((r: any) => { keeperOptions.value = r.data || [] })
```

- [ ] **Step 2: submit payload 带上 3 字段**

`productionApi.receiveOrderProduct(...)` 的 data 对象加：
```ts
effectiveDate: form.effectiveDate || undefined,
handler: form.handler || undefined,
keeper: form.keeper || undefined,
```

- [ ] **Step 3: 模板加 3 个表单项**

在「批号」与「关闭订单」两个 `el-form-item` 之间插入（label-width 已是 100px）：
- 「生效日期」：`<el-date-picker v-model="form.effectiveDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />`
- 「经手人」：`el-select`（`filterable clearable allow-create default-first-option`，选项 `v-for="h in handlerOptions"`，绑定 `form.handler`）
- 「仓管员」：同上，`keeperOptions` / `form.keeper`；（对照 `views/inventory/stockIn/index.vue` 437-448 行的写法）

- [ ] **Step 4: 验证构建**

Run: `cd client && npm run build`
Expected: `vue-tsc -b && vite build` 无错误（注意 strict noUnusedLocals，勿遗留未用变量）。

- [ ] **Step 5: Commit**

```bash
git add client/src/views/inventory/productionReceive/index.vue
git commit -m "feat: 生产入库/退库弹窗新增生效日期/经手人/仓管员"
```

---

### Task 3: 端到端验证（curl）

**Files:**
- 无代码改动；产出仅为验证结论。

**Interfaces:**
- Consumes: Task 1/2 完成后的运行中服务（重启后生效）。

- [ ] **Step 1: 重启后端服务（新代码生效）**

```bash
pkill -f "src/inde[x].ts" || true
```
（单独一条命令执行，勿与下面启动命令同行。）然后：
```bash
cd server && (setsid npx tsx src/index.ts > /tmp/erp-server.log 2>&1 < /dev/null &)
```
等待 2-3 秒后 `curl -s localhost:3000/api/health` 应返回正常。

- [ ] **Step 2: 登录取 token**

Run: `curl -s -X POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"wh01","password":"admin123"}'`
Expected: `code: 200`，取出 `data.token`。

- [ ] **Step 3: 找一张可入库的生产订单**

Run: `curl -s "localhost:3000/api/v1/production/orders/receivable?pageSize=5" -H "Authorization: Bearer $TOKEN"`
Expected: 选 `remaining = plannedQty - receivedQty > 0` 的一张，记 `id/orderNo`。若无剩余>0 的订单，则选一张 `receivedQty > 0` 的做退库验证（负数路径），并如实说明。

- [ ] **Step 4: 带新字段提交入库**

Run: `curl -s -X POST "localhost:3000/api/v1/production/orders/<id>/receive" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"quantity":1,"warehouseId":<该物料库位对应仓库id>,"effectiveDate":"2026-10-31","handler":"张三","keeper":"李四"}'`
（数量/仓库按订单实情调整，避免超剩余量；退库则 quantity 为负。）
Expected: `code: 200`，返回 `documentNo`。

- [ ] **Step 5: 按单据号核对流水字段**

Run: `curl -s "localhost:3000/api/v1/stocks/records/by-document?documentNo=<上一步返回的documentNo>" -H "Authorization: Bearer $TOKEN"`
Expected: 行数据满足：
- `orderNo` = 生产订单号（源单号）
- `effectiveDate` 为 `"2026-10-31"`（或日期部分为当日；未传时为提交时刻）
- `handler`="张三"、`keeper`="李四"（且 `transactionType` 描述含"生产入库"，`documentNo` 前缀为 RCT-WO 事务类型前缀）
- `remark` 仍是自动文字（无中文备注被覆盖）
- 再提交一次不带 handler/keeper 的，确认落 `null`。

- [ ] **Step 6: （如做了退库）核对负数路径流水同样带全 4 字段**

- [ ] **Step 7: 汇报验证结果（含 by-document 返回的关键字段摘录）**

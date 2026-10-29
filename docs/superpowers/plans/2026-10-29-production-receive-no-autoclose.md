# 生产入库取消自动关闭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生产入库不再在入满计划量时自动关闭生产订单，只有勾选「入库后关闭生产订单」才关闭；已全部入库未关闭时页面提示。

**Architecture:** 后端 `receiveProductionOrderProduct` 关单条件去掉 `autoClosed` 分支、响应字段 `autoClosed` 改名 `fullyReceived`；前端 `productionReceive` 弹窗成功提示改三分支；AGENTS.md 修正「入库自动关单」记载。不动接口路径、权限、勾选框默认值与二次确认。

**Tech Stack:** Node + Express 5 + Prisma 5（server）；Vue 3 + Element Plus（client）。

**Spec:** `docs/superpowers/specs/2026-10-29-production-receive-no-autoclose-design.md`

## Global Constraints

- 本轮直接在 `main` 分支做（工作区当前干净，HEAD `10e0a4c`）。
- 后端只用 `tsx` 跑；改完代码必须重启运行中的服务：先单独一条命令 `pkill -f "src/inde[x].ts"`，再 `(setsid npx tsx src/index.ts > /tmp/opencode/server.log 2>&1 < /dev/null &)`（workdir `server/`）。
- 验证 = `npm run build`（双侧）+ curl + Playwright（`playwright-core` + `/home/ubuntu/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`，脚本放 `/tmp/opencode/`）+ psql。**先写验证脚本、看它失败，再实现。**
- 真实入库的测试数据每步必须复位（见 Task 1 Step 6 / Task 2 Step 5）；全部结束重跑一次 MRP。
- 测试样本 = 生产订单 **18**（`MO202610290002`，plannedQty=4000，receivedQty=0，产品 materialId 10307，单位 PCS，非批号管理，salesOrder 8 = `SO202610290001` 状态 `in_production`）。仓库用 **id 3**。
- 接口契约（保持不变的部分）：`POST /api/v1/production/orders/:id/receive`，body `{quantity, unit?, warehouseId, binId?, batchNo?, closeWorkOrder?}`，权限 `stock:edit`；响应 data 现为 `{success, documentNo, receivedQty, autoClosed, closed}`。
- 提交信息中文，`fix(production): ...` / `feat(inventory): ...` / `docs: ...` 风格。

## Review Focus

- 入满且未勾选后再**继续入库** → 期望被「入库数量超过剩余可入库数量」拦截（行为不应因取消自动关闭而回归为可超收）。
- 入满未关闭时**销售订单状态不受影响**（仍 `in_production`，关单/完工联动只认报工完工）→ 期望验证后 SO 8 仍为 `in_production`。
- 勾选关闭时**二次确认与提示语义不变** → 期望 `closed=true`、提示「已关闭」、列表不再显示该单。
- 并发/重复提交最后一段数量 → CAS 守卫（`receivedQty: { lte: planned - base }`）应保证不超收，两条都不关单。

---

### Task 1: 后端取消自动关闭 + 响应字段改名

**Files:**
- Modify: `server/src/services/production.service.ts:1518-1527,1550`
- Verify: `/tmp/opencode/verify-receive-noautoclose.sh`（curl + psql，临时脚本不进仓库）

**Interfaces:**
- Consumes: 现有 `receiveProductionOrderProduct(productionOrderId, quantity, warehouseId, userId, batchNo?, unit?, binId?, closeWorkOrder?)`。
- Produces: 响应 `data` 字段变更为 `{success, documentNo, receivedQty, fullyReceived, closed}`（`autoClosed` 不再返回；`fullyReceived = newReceived >= plannedQty - 1e-6`；`closed` 仅当 `closeWorkOrder===true` 且订单原 status 为 `planned`/`in_progress` 时为 true）。Task 2 的前端读 `res.data.closed` 与 `res.data.fullyReceived`。

- [ ] **Step 1: 写失败验证脚本**

`/tmp/opencode/verify-receive-noautoclose.sh`（bash，`set -e` 不用，逐段打印结果并以最后 `PASS`/`FAIL` 为准）：

1. 登录取 token（`admin`/`admin123`）；先 `select max(id) from "StockRecord";` 记为 BASE_ID（当前 198），后续复位按 BASE_ID 过滤。
2. **复位到基准**：receivedQty=0、status=`in_progress`、execStatus=`pending`（psql，见 Step 6 的 SQL）。
3. `POST /production/orders/18/receive {quantity:2000, warehouseId:3}` → 断言 `data.closed==false` 且 `data.fullyReceived==false`（当前代码返回的是 `autoClosed`，`fullyReceived` 为 undefined → 此断言 FAIL，即 RED）。
4. `POST /production/orders/18/receive {quantity:2000, warehouseId:3}`（入满）→ 断言 `data.closed==false` 且 `data.fullyReceived==true`（当前代码 `closed` 可能 false 但响应无 `fullyReceived` → FAIL）。
5. psql 断言订单 18 `status='in_progress'`（当前代码已关成 `closed` → FAIL）；断言 SO 8 `status='in_production'`；`GET /production/orders/receivable?onlyReceivable=true`（或页面同参数）断言**不含**订单 18（入满未关不再出现在默认列表）。
6. **超收拦截**：再 `POST {quantity:1, warehouseId:3}` → 断言 `code==400` 且 message 含「超过剩余可入库数量」。
7. **勾选关闭回归**：复位后 `POST {quantity:4000, warehouseId:3, closeWorkOrder:true}` → 断言 `data.closed==true`，psql 订单 18 `status='closed'`。
8. 复位到基准（同 Step 6），打印 `DONE`。

- [ ] **Step 2: 跑脚本确认 RED**

Run: `bash /tmp/opencode/verify-receive-noautoclose.sh`
Expected: 第 3 步起 FAIL（`fullyReceived` undefined / status closed）。

- [ ] **Step 3: 实现**

`production.service.ts` 事务内：
- `const autoClosed = ...` 改名 `const fullyReceived = newReceived >= order.plannedQty - 1e-6;`
- 关单条件 `if (autoClosed || closeWorkOrder === true)` → `if (closeWorkOrder === true)`；注释同步改为「勾选『入库后关闭生产订单』时关闭（入满不再自动关闭）」。
- return 里 `autoClosed` → `fullyReceived`。

- [ ] **Step 4: 重启服务并跑脚本确认 GREEN**

```bash
pkill -f "src/inde[x].ts"        # 单独一条命令
# 然后 workdir=server: (setsid npx tsx src/index.ts > /tmp/opencode/server.log 2>&1 < /dev/null &)
sleep 8 && curl -s localhost:3000/api/health
bash /tmp/opencode/verify-receive-noautoclose.sh
```
Expected: 全部断言通过，末行 `DONE` + `PASS`。

- [ ] **Step 5: server 构建 + 提交**

```bash
cd /home/ubuntu/apps/WT/server && npm run build   # 无 TS 报错
cd /home/ubuntu/apps/WT && git add server/src/services/production.service.ts && git commit -m "fix(production): 生产入库不再自动关闭订单，仅勾选关闭；响应 autoClosed 改名 fullyReceived"
```

- [ ] **Step 6: 复位 SQL（脚本内与手工兜底通用）**

```sql
BEGIN;
UPDATE "Stock" SET quantity = quantity - <本次实际入满的基本量> WHERE "materialId"=10307 AND "warehouseId"=3 AND "binId" IS NULL;
DELETE FROM "StockRecord" WHERE "relatedType"='ProductionOrder' AND "relatedId"=18 AND id > <基准 id>;
UPDATE "ProductionOrder" SET "receivedQty"=0, status='in_progress', "execStatus"='pending' WHERE id=18;
COMMIT;
```
基准 id = 动手前 `select max(id) from "StockRecord";` 记下（当前 198）。流水数量一律基本单位（PCS rate=1，入多少扣多少）。

---

### Task 2: 前端三分支提示 + 端到端验证

**Files:**
- Modify: `client/src/views/inventory/productionReceive/index.vue:177`（成功提示处）
- Verify: `/tmp/opencode/verify-receive-page.js`

**Interfaces:**
- Consumes: Task 1 的响应 `{closed, fullyReceived}`。
- Produces: 无（页面文案）。

- [ ] **Step 1: 写失败验证脚本（Playwright）**

`/tmp/opencode/verify-receive-page.js`：登录 → `/inventory/production-receive` →
1. 找到订单 18 行（`MO202610290002`），点「入库」打开弹窗，数量填 `4000`，仓库选 id 3 对应仓库，**不勾**「入库后关闭生产订单」，提交 → 断言出现 `.el-message` 含「已全部入库」，且 psql 订单 18 `status='in_progress'`（当前代码提示为「入库已提交」→ FAIL，RED）。
2. 复位后同单**勾选**提交 → 断言先出现二次确认框（文案含「将被关闭」），继续后提示含「已关闭」，psql `status='closed'`。
3. 复位后部分入库 `100` 不勾选 → 提示恰为「入库已提交」（无「已全部入库」「已关闭」）。
4. `pageerror` 为空。脚本结束把数据复位到基准（receivedQty=0、库存/流水还原、订单 18 `in_progress`/`pending`）。

- [ ] **Step 2: 跑脚本确认 RED**

Run: `node /tmp/opencode/verify-receive-page.js`（vite 63130 已在跑；前端未改 → 断言 1 FAIL）

- [ ] **Step 3: 实现三分支提示**

`index.vue` 提交成功处，`ElMessage.success(res.data?.closed ? '入库已提交，生产订单已关闭' : '入库已提交')` 改为三分支：`closed` → 「入库已提交，生产订单已关闭」；`fullyReceived` → 「入库已提交，已全部入库；如需关闭订单请勾选「入库后关闭生产订单」后再次入库」；否则 → 「入库已提交」。

- [ ] **Step 4: 构建并确认 GREEN**

```bash
cd /home/ubuntu/apps/WT/client && npm run build   # ✓ built，无 TS 报错
node /tmp/opencode/verify-receive-page.js          # PASS
```

- [ ] **Step 5: 复位确认 + 提交**

```bash
PGPASSWORD=erp123456 psql -h 127.0.0.1 -U erp -d erp -c 'select id,"receivedQty",status,"execStatus" from "ProductionOrder" where id=18;' -c 'select count(*) from "StockRecord" where id>198;' -c 'select quantity from "Stock" where id=51;'
```
Expected: `receivedQty=0`、`status=in_progress`、流水残留 0、Stock id 51 回到 6000。
```bash
cd /home/ubuntu/apps/WT && git add client/src/views/inventory/productionReceive/index.vue && git commit -m "feat(inventory): 生产入库入满未勾选时提示已全部入库且订单未关闭"
```

---

### Task 3: AGENTS.md 修正 + 全量回归

**Files:**
- Modify: `AGENTS.md`（Production 一节「生产入库...自动关闭」句）

- [ ] **Step 1: 改文档**

把「生产入库 **closes the production order `status`→`closed`**（not `execStatus`）when `receivedQty` reaches `plannedQty`（receive response returns `autoClosed`）；the receiving dialog also has a `closeWorkOrder` checkbox ...」相关表述改为：**入库不再自动关闭订单**；只有勾选「入库后关闭生产订单」（`closeWorkOrder`，`status`→`closed`，不动 `execStatus`，仅 `planned`/`in_progress` 可关）才关闭；响应 `fullyReceived` 表示已全部入库，前端据此提示。

- [ ] **Step 2: 全量回归**

```bash
cd /home/ubuntu/apps/WT/server && npm run build
cd /home/ubuntu/apps/WT/client && npm run build
bash /tmp/opencode/verify-receive-noautoclose.sh
node /tmp/opencode/verify-receive-page.js
```
curl 冒烟（Bearer token）：`/api/v1/production/orders/receivable`、`/api/v1/production/orders/18/materials`、`/api/v1/stocks` 全 `code:200`；确认订单 17 未受影响、订单 18 回到基准。

- [ ] **Step 3: 重跑 MRP**

`POST /api/v1/mrp/calculate` `{}` → 200；`GET /api/v1/mrp/check` 重查一次拿到最新 run（注意：刚跑完立刻查可能 total=0，属查询时序，重查即有）。

- [ ] **Step 4: 提交**

```bash
cd /home/ubuntu/apps/WT && git add AGENTS.md docs/superpowers/specs/2026-10-29-production-receive-no-autoclose-design.md && git commit -m "docs: 生产入库取消自动关闭——更新 AGENTS.md 记载与设计文档"
```

---

## 完成判定

- 入满 4000 未勾选：订单 18 保持 `in_progress`，提示「已全部入库…未关闭」；勾选：入库+`closed`。
- 超收仍被 400 拦截；SO 8 保持 `in_production`。
- 双侧 build 通过；测试数据复位到基准；MRP 重跑。
- 三个提交（后端 / 前端 / 文档）。

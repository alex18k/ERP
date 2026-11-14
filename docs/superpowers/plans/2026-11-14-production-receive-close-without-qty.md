# 生产入库/退库「纯关单」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生产入库/退库页勾选「关闭订单」且数量为 0 时，只关闭生产订单，不入库、不写库存流水、不改已入库数量。

**Architecture:** 复用现有入库接口 `POST /production/orders/:id/receive`（权限 `stock:edit`），在 service 的校验链前段增加「纯关单」分支（`closeWorkOrder && 数量为 0/未传`），只做一次带状态守卫的 `updateMany`；前端放开「数量不能为 0」这一条并给出专门的确认文案。不新增接口、不改路由与权限。

**Tech Stack:** Node 22 + Express 5 + Prisma 5（PostgreSQL）、Vue 3 + Element Plus + Vite 8。

**Spec:** `docs/superpowers/specs/2026-11-14-production-receive-close-without-qty-design.md`

## Global Constraints

- 项目无自动化测试套件：每个任务的验收 = `npm run build` 0 退出 + `curl`/`psql` 实测 + 浏览器实测。
- 后端只能 `tsx` 运行；改完必须重启服务（`(setsid npx tsx src/index.ts > /tmp/log 2>&1 < /dev/null &)`，不要在同一命令里 `pkill -f "tsx src/index.ts"`，用 `pkill -f "src/inde[x].ts"` 单独执行）。
- 纯关单分支必须在 `resolveUnitRate` / `warehouseId` 校验 / `execStatus === "none"` 校验**之前**返回。
- 纯关单允许 `execStatus === "none"`，允许不传 `warehouseId`/`unit`，不生成单据号、不取 `lockOrderNo`。
- 纯关单只写 `status → closed`，绝不动 `execStatus` / `receivedQty`。
- 正数入库上限不放宽；负数退库行为不变（不关单）。
- AGENTS.md 是规则沉淀：改动必须同步，且不要删除既有条款，只在生产入库段落追加。

## Review Focus

1. **数量留空**（请求体无 `quantity`，controller 得 `NaN`）+ `closeWorkOrder:true` → 纯关单成功，不得报「数量不能为0」。
2. **数量为负** + `closeWorkOrder:true`（绕过前端禁用直接调接口）→ 仍走退库、`closed:false`，不得误判为纯关单。
3. **未排产**（`execStatus = none`）订单 + 数量 0 + 勾选关闭 → 成功关闭（入库列表本来就显示这些单）。
4. **重复提交**：订单已 `closed` 后再提交纯关单 → 400「生产订单已关闭，不能入库/退库」，且不产生流水。
5. **数量 0 但未勾选关闭** → 400 原文案「入库/退库数量不能为0」，不能被新分支吞掉。

---

### Task 1: 后端纯关单分支

**Files:**
- Modify: `server/src/services/production.service.ts:1424-1462`（`receiveProductionOrderProduct` 前段校验）

**Interfaces:**
- Consumes: `prisma.productionOrder.updateMany`（既有）、`receiveProductionOrderProduct` 既有签名（参数顺序不变）。
- Produces: 同一函数返回 `{ success: true, documentNo: null, receivedQty: number, fullyReceived: false, closed: boolean }` 的纯关单结果；其余分支返回值不变。

- [ ] **Step 1: 插入纯关单分支**

在 `if (order.status === "closed") throw ...` 之后、`if (order.execStatus === "none") throw ...` 之前插入：

```ts
  // 勾选「入库后关闭生产订单」且数量为 0/未填 = 纯关单：不入库、不写流水、不动 receivedQty/execStatus
  if (closeWorkOrder === true && (!Number.isFinite(quantity) || quantity === 0)) {
    const closedResult = await prisma.productionOrder.updateMany({
      where: { id: order.id, status: { in: ["planned", "in_progress"] } },
      data: { status: "closed" },
    });
    return {
      success: true,
      documentNo: null,
      receivedQty: order.receivedQty,
      fullyReceived: false,
      closed: closedResult.count > 0,
    };
  }
```

同时把函数入口的 `if (!Number.isFinite(quantity) || quantity === 0) throw new Error("入库/退库数量不能为0");`
与 `if (!warehouseId) throw new Error("请选择入库仓库");` 移到该分支之后（纯关单不要求仓库与数量）；
折算后的 `if (baseQty === 0) throw new Error("入库/退库数量不能为0");` 保留在原位。

- [ ] **Step 2: 构建**

Run: `cd server && npm run build`
Expected: 0 退出，无类型错误。

- [ ] **Step 3: 重启后端并取得 token**

```bash
pkill -f "src/inde[x].ts"
```

然后单独执行：

```bash
cd server && (setsid npx tsx src/index.ts > /tmp/log 2>&1 < /dev/null &)
```

等待 `curl -s localhost:3000/api/health` 返回 ok 后：

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"wh01","password":"admin123"}' | jq -r '.data.token')
```

Expected: `TOKEN` 非空（用 `wh01` 证明 `stock:edit` 即可，无需 `production:manage`）。

- [ ] **Step 4: 取测试订单并记录基线**

```bash
curl -s "localhost:3000/api/v1/production/orders/receivable?pageSize=3" -H "Authorization: Bearer $TOKEN" | jq '.data.items[] | {id,orderNo,status,execStatus,plannedQty,receivedQty}'
```

记下第一张未关闭单 `ID1`（正数/纯关单用）、第二张 `ID2`（数量 0 未勾选用）：
未排产单用 psql 找（若列表里没有）：

```bash
PGPASSWORD=erp123456 psql -h localhost -U erp -d erp -c \
 "select id,status,\"execStatus\",\"receivedQty\" from \"ProductionOrder\" where \"execStatus\"='none' and status<>'closed' order by id desc limit 3;"
```

基线记录（`ID1` 的 `status`/`receivedQty` 与流水条数）：

```bash
PGPASSWORD=erp123456 psql -h localhost -U erp -d erp -c \
 "select status,\"receivedQty\" from \"ProductionOrder\" where id=ID1;"
PGPASSWORD=erp123456 psql -h localhost -U erp -d erp -c \
 "select count(*) from \"StockRecord\" where \"relatedType\"='ProductionOrder' and \"relatedId\"=ID1;"
```

- [ ] **Step 5: 验证纯关单（数量 0 + 勾选关闭）**

```bash
curl -s -X POST localhost:3000/api/v1/production/orders/ID1/receive \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"quantity":0,"closeWorkOrder":true}' | jq '.data'
```

Expected: `{"success":true,"documentNo":null,"receivedQty":<基线值>,"fullyReceived":false,"closed":true}`。

再查 psql：`status='closed'`、`receivedQty` 未变、`StockRecord` 条数未变、`Stock` 无新增/变动。

- [ ] **Step 6: 验证「数量留空」也走纯关单**

对另一张未关闭单 `ID3`（同上取法）提交 `-d '{"closeWorkOrder":true}'`（无 `quantity`）。
Expected: 同 Step 5，`closed:true`。

- [ ] **Step 7: 验证未排产订单可纯关单**

对 `execStatus='none'` 的未关闭单 `ID4` 提交 `{"quantity":0,"closeWorkOrder":true}`。
Expected: `closed:true`（不再报「尚未排产」）。

- [ ] **Step 8: 验证负向用例**

```bash
# 数量 0 + 未勾选关闭 → 400 原文案
curl -s -X POST localhost:3000/api/v1/production/orders/ID2/receive -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"quantity":0,"warehouseId":1}'
# 已关闭单再提交纯关单 → 400
curl -s -X POST localhost:3000/api/v1/production/orders/ID1/receive -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"quantity":0,"closeWorkOrder":true}'
# 正数超剩余 + 勾选关闭 → 400 超量
curl -s -X POST localhost:3000/api/v1/production/orders/ID2/receive -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"quantity":999999,"warehouseId":1,"closeWorkOrder":true}'
```

Expected 依次：`message` 含「入库/退库数量不能为0」；含「生产订单已关闭」；含「入库数量超过剩余可入库数量」。
负数用例：若存在 `receivedQty > 0` 的未关闭单 `ID5`，提交 `{"quantity":-1,"warehouseId":1,"closeWorkOrder":true}` → 返回 `returned:true, closed:false`，订单未被关闭。

- [ ] **Step 9: 还原测试数据**

```bash
PGPASSWORD=erp123456 psql -h localhost -U erp -d erp -c \
 "update \"ProductionOrder\" set status='<ID1/ID3/ID4 原状态>' where id in (ID1,ID3,ID4);"
```

负数用例改动过的 `receivedQty`/库存/流水需手工还原（或只做只读核对）。

- [ ] **Step 10: 提交**

```bash
git add server/src/services/production.service.ts
git commit -m "feat(production): allow closing order from receive page without receipt"
```

---

### Task 2: 前端纯关单交互

**Files:**
- Modify: `client/src/views/inventory/productionReceiveMake/index.vue`（`submit()` 约 L123-204；提示文案约 L294）

**Interfaces:**
- Consumes: Task 1 的接口返回值 `{ closed: boolean, documentNo: string | null, receivedQty: number }`。
- Produces: 无（页面自包含）。

- [ ] **Step 1: 改 `submit()` 校验**

- `const closeOnly = qty === 0 && form.closeWorkOrder === true`
- `qty === 0 && !closeOnly` → `ElMessage.warning('入库/退库数量不能为0；仅关闭订单请勾选「入库后关闭生产订单」')` 后 return。
- `closeOnly` 为真时跳过仓库/单位换算/剩余量校验，直接确认：
  `将仅关闭生产订单 {orderNo}：不入库、不写库存流水、已入库数量保持 {receivedQty}。是否继续？`
- 请求体：`quantity: 0`、`closeWorkOrder: true`、其余字段照发（后端忽略）。
- 成功提示：若 `res.data?.closed` 且未入库（`documentNo` 为空）→ `生产订单已关闭（未入库）`。

- [ ] **Step 2: 更新页面提示**

`<div class="unit-hint">` 文案改为：
`正数入库，负数退库；数量填 0 并勾选「关闭订单」= 仅关单不入库。退库最多 {receivedQty}（输入负数）；退库不关闭订单。`

- [ ] **Step 3: 构建**

Run: `cd client && npm run build`
Expected: 0 退出（vue-tsc 严格 noUnusedLocals）。

- [ ] **Step 4: 浏览器实测（`npm run dev`，63130）**

1. 入库列表点「入库」→ 数量改 0、不勾选 → 提交 → 提示「入库/退库数量不能为0…」。
2. 数量 0、勾选关闭 → 提交 → 弹「仅关单」确认 → 提示「生产订单已关闭（未入库）」→ 回列表该单消失。
3. 正数 + 勾选关闭 → 仍弹关闭确认 → 成功入库并关闭（与改前一致）。
4. 负数 → 关闭勾选框为禁用态。

- [ ] **Step 5: 提交**

```bash
git add client/src/views/inventory/productionReceiveMake/index.vue
git commit -m "feat(production-receive): allow close-only submit without quantity"
```

---

### Task 3: 文档同步

**Files:**
- Modify: `AGENTS.md:88`（Production 段落生产入库句）
- Modify: `开发日志.md:5`（在 `## 2026-10-31` 前新增 `## 2026-11-14`）

**Interfaces:**
- Consumes: Task 1/2 的最终行为。
- Produces: 无。

- [ ] **Step 1: 更新 AGENTS.md**

在「生产入库**不再自动关闭订单**——」句后追加：
`数量填 0 并勾选「入库后关闭生产订单」= **纯关单**（`closeWorkOrder===true` 且数量为 0/未传：只写 `status→closed`，不生成单据号、不写 `StockRecord`、不动 `receivedQty`/`execStatus`，允许未排产单；仍走 `stock:edit` 权限）；`

- [ ] **Step 2: 追加开发日志**

在 `## 2026-10-31` 之前插入：

```markdown
## 2026-11-14

### 生产入库/退库
- **支持纯关单**：`POST /production/orders/:id/receive` 在 `closeWorkOrder === true` 且数量为 0/未传时，只把 `status` 置 `closed`，不生成单据号、不写 `StockRecord`、不动 `receivedQty`/`execStatus`，允许未排产单；权限仍为 `stock:edit`。数量为正仍受剩余可入库约束，负数仍为退库且不关单。前端（`/inventory/production-receive-make`）在勾选关闭时放开「数量不能为0」校验并提示「仅关单不入库」。
```

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md 开发日志.md
git commit -m "docs: document production receive close-only mode"
```

---

## 自检

- Spec 覆盖：纯关单分支（Task 1）、0/留空校验放开（Task 1 Step 5-6、Task 2 Step 1）、前端确认与提示（Task 2）、退出码/文档（Task 3）——全覆盖；无新接口/权限改动需处理。
- 类型一致性：返回值字段 `closed`/`documentNo`/`receivedQty`/`fullyReceived` 与前端读取一致。
- Review Focus 5 条全部落到 Task 1 Step 5-8 的验证步骤。
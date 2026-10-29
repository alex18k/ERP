# 生产发料「取消未发量」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生产订单领料明细支持按行「取消未发量」，取消后未发归零、不能再发料，MRP 不再为这部分需求出建议。

**Architecture:** 在 `ProductionOrderMaterial` 上新增 `cancelledQty`/`cancelledAt` 记录取消量（保留 `requiredQty` 原始需求），未发口径统一为 `requiredQty − issuedQty − cancelledQty`；取消动作并入现有 `POST /production/orders/:id/issue` 同一事务；MRP 对手工单减少子件需求、对销售订单下达的单按取消量冲抵，并在 `MrpCheckLine` 落 `cancelledQuantity`。

**Tech Stack:** Node 22 + Express 5 + Prisma 5.22.0 + PostgreSQL（后端，`tsx` 运行）；Vue 3 + Element Plus + Vite（前端）。

**Spec:** `docs/superpowers/specs/2026-10-29-production-issue-cancel-remain-design.md`

## Global Constraints

- 本项目**没有自动化测试套件**：每个任务的验证 = `npm run build` + `curl` 真实接口 + `psql` 查库，测试后复位数据。
- Prisma **固定 5.22.0**，不要升级；不要用 `prisma migrate dev`（P3014），手写 `migration.sql` 后 `npx prisma migrate deploy && npx prisma generate`，并**重启后端**（`tsx` 不热重载）。
- 后端只跑 `tsx src/index.ts`（`npm start`/`node dist` 不可用）；重启：`cd server && (setsid npx tsx src/index.ts > /tmp/opencode/server.log 2>&1 < /dev/null &)`，停旧进程用单独命令 `pkill -f "src/inde[x].ts"`。
- 前端 `npm run build` = `vue-tsc -b && vite build`（strict，未使用变量会失败）。
- API 返回封装 `{ code, message, data, timestamp }`，成功 `code: 200`；登录 `POST /api/v1/auth/login {username:"admin",password:"admin123"}` 取 `data.token`。
- 库存/发料写库统一走 `stock.service.ts` 的 `addStock`/`applyBatchOut`，不要直接 `upsert`；单据号在事务内用 `lockOrderNo` + `generateDocNo` 生成。
- 未发口径必须**全链路一致**：`requiredQty − issuedQty − cancelledQty`。

## Review Focus

- **已关闭/已完工订单**：`status='closed'` 或 `execStatus` 不在 `pending|in_progress` 时，取消未发必须被拒绝（与发料同样的 400 提示），不能静默成功。
- **已全部取消的行**：再次发料必须返回「超过未发数量」，且不能写库存流水、不能扣库存。
- **取消后 MRP 不重复冲减**：手工单靠减少 `requiredQty` 需求，销售订单单靠 `cancelledQty` 冲抵，两者不能叠加。
- **只取消不发料**：`items` 为空、只传 `cancelRemainMaterialIds` 时接口必须成功，且不生成空单据号/空流水。
- **取消部分后仍可发剩余**：取消前已发一部分的行，剩余未发仍能正常发料，状态在 `partial`/`issued`/`cancelled` 间正确切换。

---

### Task 1: 数据模型与迁移

**Files:**
- Modify: `server/prisma/schema.prisma`（`ProductionOrderMaterial` ~L435、`MrpCheckLine` ~L144 附近）
- Create: `server/prisma/migrations/20261029120000_add_cancel_remain_to_production_order_material/migration.sql`

**Interfaces:**
- Produces: `ProductionOrderMaterial.cancelledQty: number`（默认 0）、`ProductionOrderMaterial.cancelledAt: Date | null`、`MrpCheckLine.cancelledQuantity: number`（默认 0）

- [ ] **Step 1: 改 schema**

`ProductionOrderMaterial` 在 `issuedQty` 之后加：

```prisma
  cancelledQty      Float           @default(0) // 已取消未发量（不再需要发料的部分）
  cancelledAt       DateTime?
```

`MrpCheckLine` 在 `issuedQuantity` 之后加：

```prisma
  cancelledQuantity      Float    @default(0) // 已取消未发冲抵量
```

- [ ] **Step 2: 手写迁移 SQL**

```sql
-- 生产领料明细：取消未发量（不再需要发料的部分），保留 requiredQty 原始需求
ALTER TABLE "ProductionOrderMaterial" ADD COLUMN "cancelledQty" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ProductionOrderMaterial" ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- MRP信息检查表：取消未发冲抵量
ALTER TABLE "MrpCheckLine" ADD COLUMN "cancelledQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0;
```

- [ ] **Step 3: 应用并生成 client**

Run: `cd server && npx prisma migrate deploy && npx prisma generate`
Expected: `All migrations have been successfully applied.` + `Generated Prisma Client (v5.22.0)`

- [ ] **Step 4: 重启后端并验证列存在**

Run: `pkill -f "src/inde[x].ts"; cd /home/ubuntu/apps/WT/server && (setsid npx tsx src/index.ts > /tmp/opencode/server.log 2>&1 < /dev/null &)`；再 `PGPASSWORD=erp123456 psql -h 127.0.0.1 -U erp -d erp -c '\d "ProductionOrderMaterial"' | grep cancelled`
Expected: `cancelledQty`、`cancelledAt` 两行；`curl -s localhost:3000/api/health` 返回 `"code":200`

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20261029120000_add_cancel_remain_to_production_order_material
git commit -m "feat(production): 领料明细新增取消未发量字段与 MRP 检查表取消冲抵列"
```

---

### Task 2: 发料接口支持取消未发量

**Files:**
- Modify: `server/src/services/production.service.ts`（`issueProductionOrderMaterials` ~L994-1140、`updateProductionOrderMaterial` ~L1194-1210）
- Modify: `server/src/controllers/production.controller.ts`（`issueProductionOrderMaterialsHandler` ~L255-267）

**Interfaces:**
- Consumes: Task 1 的 `cancelledQty`/`cancelledAt`
- Produces: `issueProductionOrderMaterials(productionOrderId: number, warehouseId: number | null, items: IssueItem[], userId: number, effectiveDate?: string, cancelRemainMaterialIds?: number[])` → `{ documentNo: string; issued: IssuedRow[]; skipped: SkippedRow[]; cancelled: { workOrderMaterialId: number; materialCode: string; materialName: string; quantity: number }[] }`；HTTP `POST /production/orders/:id/issue` body 接受 `cancelRemainMaterialIds: number[]`

- [ ] **Step 1: 调整函数签名与入口校验**

- `warehouseId` 改为 `number | null`；新增末参 `cancelRemainMaterialIds?: number[]`
- `const cancelIds = [...new Set((cancelRemainMaterialIds ?? []).map(Number).filter((n) => n > 0))]`
- 两项都为空 → `throw new Error("请填写发放数量")`；`items.length > 0 && !warehouseId` 时才 `throw new Error("请选择出库仓库")`
- 订单校验（存在、`status==='closed'`、`execStatus==='none'`、`execStatus==='closed'`）保持不变
- 行查询的 `id: { in: [...] }` 改为发放行 id ∪ 取消行 id

- [ ] **Step 2: 事务内实现取消逻辑**

事务开始处：`if (items.length > 0) { await lockOrderNo(tx, ORDER_NO_LOCK.ST); docNo = await generateDocNo(...) }`（只取消不发料时不生成单据号）。

事务前先做互斥校验：

```ts
const issueIds = new Set(items.map((i) => i.workOrderMaterialId));
if (cancelIds.some((id) => issueIds.has(id))) throw new Error("同一物料行不能同时发料和取消未发");
```

在发放循环之后（同一 `$transaction` 内）遍历 `cancelIds`：

```ts
for (const id of cancelIds) {
  const row = map.get(id);
  if (!row) { skipped.push({ workOrderMaterialId: id, materialCode: "", materialName: "", quantity: 0, reason: "物料行不存在" }); continue; }
  const remain = row.requiredQty - row.issuedQty - row.cancelledQty;
  if (remain <= 1e-6) { skipped.push({ workOrderMaterialId: id, materialCode: row.material.code, materialName: row.material.name, quantity: 0, reason: "没有未发数量" }); continue; }
  const upd = await tx.productionOrderMaterial.updateMany({
    where: { id, issuedQty: row.issuedQty, cancelledQty: row.cancelledQty },
    data: { cancelledQty: row.requiredQty - row.issuedQty, cancelledAt: new Date(), status: row.issuedQty > 1e-6 ? "issued" : "cancelled" },
  });
  if (upd.count === 0) throw new Error(`物料 ${row.material.code} 未发数量已变化，请刷新后重试`);
  cancelled.push({ workOrderMaterialId: id, materialCode: row.material.code, materialName: row.material.name, quantity: remain });
}
```

- [ ] **Step 3: 发放上限改用新口径**

- `const remain = row.requiredQty - row.issuedQty - row.cancelledQty;`（原为两数相减）
- 原子守卫改为：`where: { id: row.id, cancelledQty: row.cancelledQty, issuedQty: { lte: row.requiredQty - row.cancelledQty - baseQty + 1e-6 } }`
- 状态重算：`const left = requiredQty - newIssued - row.cancelledQty;` → `left <= 1e-6 ? (newIssued > 1e-6 ? "issued" : "cancelled") : (newIssued > 1e-6 ? "partial" : "pending")`

- [ ] **Step 4: `updateProductionOrderMaterial` 收敛取消量**

需求量改小时把取消量夹到 `requiredQty − issuedQty`：

```ts
const maxCancel = Math.max(0, requiredQty - row.issuedQty);
const cancelledQty = Math.min(row.cancelledQty, maxCancel);
```

`data` 增加 `cancelledQty`，`status` 按新口径：`left = requiredQty - row.issuedQty - cancelledQty`，规则同 Step 3。

- [ ] **Step 5: 控制器透传**

`issueProductionOrderMaterialsHandler` 增加末参 `req.body?.cancelRemainMaterialIds`；`warehouseId` 用 `req.body?.warehouseId ? Number(req.body.warehouseId) : null`；成功消息改为：`data.cancelled.length ? "已取消未发" : "领料完成"`。

- [ ] **Step 6: 构建并 curl 验证**

Run: `cd server && npm run build`
Expected: 无输出（成功）。

用手工测试（`$T` 为 admin token）：
1. 找一条已排产、未关闭、有未发明细的生产订单：`curl -s -H "Authorization: Bearer $T" "localhost:3000/api/v1/production/orders?page=1&pageSize=20"`，取 `execStatus in pending/in_progress` 且 `materials[].issuedQty < requiredQty` 的 `id` 与某行 `workOrderMaterialId`
2. 只取消：`curl -s -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"cancelRemainMaterialIds":[<行id>]}' localhost:3000/api/v1/production/orders/<订单id>/issue`
   Expected: `code:200`，`data.cancelled[0].quantity>0`，`data.documentNo` 为该单最新单号或空
3. 再对同一行发料 → Expected: `data.skipped[0].reason` 形如 `超过未发数量（0）`
4. 查行：`curl -s -H "Authorization: Bearer $T" localhost:3000/api/v1/production/orders/<订单id>/materials | grep -o '"cancelledQty":[0-9.]*'`
   Expected: 该行 `cancelledQty` = 原未发量
5. 复位：`PGPASSWORD=erp123456 psql -h 127.0.0.1 -U erp -d erp -c 'UPDATE "ProductionOrderMaterial" SET "cancelledQty"=0,"cancelledAt"=NULL,status='"'"'partial'"'"' WHERE id=<行id>'`

- [ ] **Step 7: Commit**

```bash
git add server/src/services/production.service.ts server/src/controllers/production.controller.ts
git commit -m "feat(production): 发料接口支持按行取消未发量"
```

---

### Task 3: MRP 冲抵取消未发量

**Files:**
- Modify: `server/src/services/mrp.service.ts`（手工单需求 ~L299-352、`issuedWipRows` ~L427-443、净需求桶循环 ~L455-530、`checkLines` 类型 ~L448）

**Interfaces:**
- Consumes: Task 1 的 `cancelledQty` / `MrpCheckLine.cancelledQuantity`
- Produces: MRP 结果中 `checkLines[].cancelledQuantity: number`；`MrpCheckLine` 落库时含该字段

- [ ] **Step 1: 手工单需求扣减取消量**

`manualProductionOrders` 的 `materials` select 增加 `cancelledQty: true`；循环内改为：

```ts
const requiredQty = Number(m.requiredQty || 0) - Number(m.cancelledQty || 0);
```

（`<= 1e-6` 时跳过，逻辑不变。）

- [ ] **Step 2: 新增取消量冲抵映射（仅销售订单下达的单）**

在 `issuedWipRows` 之后加：

```ts
const cancelledWipRows = await prisma.productionOrderMaterial.findMany({
  where: {
    materialId: { in: [...materialIds] },
    cancelledQty: { gt: 0 },
    productionOrder: { salesOrderId: { not: null }, status: { in: ["planned", "in_progress"] }, execStatus: { in: ["pending", "in_progress"] } },
  },
  select: { materialId: true, cancelledQty: true },
});
const cancelledWipMap = new Map<number, number>();
for (const r of cancelledWipRows) cancelledWipMap.set(r.materialId, (cancelledWipMap.get(r.materialId) ?? 0) + r.cancelledQty);
```

（不统计手工单：手工单需求已在 Step 1 扣减，避免重复。）

- [ ] **Step 3: 桶循环里冲抵**

`const cancelledQuantity = params.deductInProcess !== false ? (cancelledWipMap.get(materialId) ?? 0) : 0;` 与 `let remainingCancelled = cancelledQuantity;`；在 `useIssued` 之后追加：

```ts
const useCancelled = Math.min(remainingCancelled, need);
remainingCancelled -= useCancelled;
need -= useCancelled;
```

`checkLines.push({...})` 增加 `cancelledQuantity: useCancelled`，类型声明同步加 `cancelledQuantity: number;`。

- [ ] **Step 4: 构建并验证 MRP**

Run: `cd server && npm run build`；重启后端。

然后（`$T` 同上）：
1. 按 Task 2 Step 6 的 1-2 步对某行取消未发
2. `curl -s -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{}' localhost:3000/api/v1/mrp/calculate`
   Expected: `code:200`
3. `curl -s -H "Authorization: Bearer $T" "localhost:3000/api/v1/mrp/check?materialId=<该物料id>"`（无该参数则取最近一次运行全部行后过滤）
   Expected: 该物料行 `cancelledQuantity > 0`，且 `netDemand` 比取消前小（对比取消前同一运行）
4. 复位：把 `cancelledQty` 改回 0，重跑 `POST /mrp/calculate` 恢复建议

- [ ] **Step 5: Commit**

```bash
git add server/src/services/mrp.service.ts
git commit -m "feat(mrp): 已取消未发量计入冲抵，检查表记录取消量"
```

---

### Task 4: 发料弹窗按行勾选「取消未发」

**Files:**
- Modify: `client/src/views/inventory/issue/index.vue`（明细映射 ~L252-268、`recalc` ~L282-292、`submit` ~L294-345、明细表列 ~L440-470、`issueProgress` ~L191-199）
- Modify: `client/src/views/inventory/productionReceive/index.vue`（`issueProgress` ~L88-100）

**Interfaces:**
- Consumes: Task 2 的 `cancelRemainMaterialIds` 入参、`data.cancelled` 返回
- Produces: 页面行为；`productionApi.issueOrderMaterials` 调用体新增 `cancelRemainMaterialIds`

- [ ] **Step 1: 明细行带取消量与勾选状态**

`detail.value = (data.materials || []).map(...)` 增加 `cancelledQty: m.cancelledQty ?? 0, cancelRemain: false`。

- [ ] **Step 2: 未发口径与勾选联动**

- 行内工具函数：`const rowRemain = (row: any) => Math.max(0, Number(row.requiredQty||0) - Number(row.issuedQty||0) - Number(row.cancelledQty||0))`
- 未发列：`{{ row.cancelRemain ? 0 : rowRemain(row) }}`
- `recalc()` 内 `const remain = rowRemain(line)`
- 勾选处理：`function onCancelRemainChange(row: any) { if (row.cancelRemain) row.issueQty = 0 }`
- 「本次发放」`el-input-number` 加 `:disabled="row.cancelRemain"`

- [ ] **Step 3: 新增勾选列**

在「未发」列之后插入：

```vue
<el-table-column label="取消未发" width="90" align="center">
  <template #default="{ row }">
    <el-checkbox v-model="row.cancelRemain" :disabled="rowRemain(row) <= 1e-6" @change="onCancelRemainChange(row)" />
  </template>
</el-table-column>
```

- [ ] **Step 4: 提交载荷**

- `const cancelIds = detail.value.filter((l) => l.cancelRemain && rowRemain(l) > 1e-6).map((l) => l.workOrderMaterialId)`
- `items` 过滤条件改为 `!l.cancelRemain && Number(l.issueQty) > 0`
- `if (items.length === 0 && cancelIds.length === 0)` → `ElMessage.warning('请填写发放数量或勾选取消未发')`
- 仓库校验改为仅当 `items.length > 0` 时执行
- 请求体：`{ warehouseId: form.warehouseId || undefined, effectiveDate: form.effectiveDate || undefined, items, cancelRemainMaterialIds: cancelIds }`
- 成功提示：`const cancelled = res.data?.cancelled || []`；`items.length===0 && cancelled.length>0` → `ElMessage.success(\`已取消未发 ${cancelled.length} 行\`)`

- [ ] **Step 5: 发料进度口径（两个页面同步改）**

`issue/index.vue` 与 `inventory/productionReceive/index.vue` 的 `issueProgress` 改为：

```ts
const remain = (m: any) => Math.max(0, (m.requiredQty ?? 0) - (m.issuedQty ?? 0) - (m.cancelledQty ?? 0));
const eps = 1e-6;
if (ms.every((m: any) => remain(m) <= eps)) {
  return ms.every((m: any) => (m.issuedQty ?? 0) <= eps) ? 'cancelled' : 'issued';
}
```

`productionReceive/index.vue` 的 `issueProgressOptions` 增加 `cancelled: { label: '已取消未发', type: 'info' }`；`issue/index.vue` 同样增加。

- [ ] **Step 6: 构建验证**

Run: `cd client && npm run build`
Expected: `✓ built in ...`，无 `error TS`

页面手测（`localhost:63130`，admin/admin123）：打开发料弹窗 → 勾选某行「取消未发」→ 该行未发显示 0、本次发放禁用 → 提交 → 列表该单进度变为「已取消未发」或「部分领料」；再打开弹窗该行未发为 0。

- [ ] **Step 7: Commit**

```bash
git add client/src/views/inventory/issue/index.vue client/src/views/inventory/productionReceive/index.vue
git commit -m "feat(inventory): 发料弹窗支持按行取消未发量"
```

---

### Task 5: 领料单/打印与 MRP 检查页展示取消量

**Files:**
- Modify: `client/src/views/production/components/MaterialListPanel.vue`（列 ~L235-260）
- Modify: `client/src/views/production/workOrderMaterialPrint/index.vue`（~L20、L95-105）
- Modify: `client/src/views/production/orderMaterials/index.vue`（~L63、L224）
- Modify: `client/src/views/mrp/inspection/index.vue`（「已发料冲抵」列后 ~L191）

**Interfaces:**
- Consumes: `ProductionOrderMaterial.cancelledQty`、`MrpCheckLine.cancelledQuantity`

- [ ] **Step 1: 领料单组件加「已取消」列**

`MaterialListPanel.vue` 在「已领料」列后加：

```vue
<el-table-column prop="cancelledQty" label="已取消" width="90" />
```

- [ ] **Step 2: 打印页未发口径**

`workOrderMaterialPrint/index.vue`：未发单元格改为 `Number(row.requiredQty||0) - Number(row.issuedQty||0) - Number(row.cancelledQty||0)`；表头统计增加一行 `已取消：{{ totalCancelled }}`，其中 `const totalCancelled = computed(() => list.value.reduce((s: number, r: any) => s + Number(r.cancelledQty || 0), 0))`。

- [ ] **Step 3: 明细查询页加列**

`orderMaterials/index.vue`：字段数组在 `issuedQty` 后加 `{ field: 'cancelledQty', label: '已取消', type: 'number' }`，表格在「已领料」列后加 `<el-table-column prop="cancelledQty" label="已取消" width="90" align="right" />`。

- [ ] **Step 4: MRP 检查页加列**

`inspection/index.vue` 在「已发料冲抵」列后加：

```vue
<el-table-column label="已取消冲抵" width="86" align="right">
  <template #default="{ row }">{{ row.cancelledQuantity || '-' }}</template>
</el-table-column>
```

- [ ] **Step 5: 构建验证**

Run: `cd client && npm run build`
Expected: 无 `error TS`；打开 `/mrp/inspection` 能看到「已取消冲抵」列（最近一次运行有取消量时非 `-`）。

- [ ] **Step 6: Commit**

```bash
git add client/src/views/production/components/MaterialListPanel.vue client/src/views/production/workOrderMaterialPrint/index.vue client/src/views/production/orderMaterials/index.vue client/src/views/mrp/inspection/index.vue
git commit -m "feat(ui): 领料单/打印/明细与 MRP 检查表展示取消未发量"
```

---

### Task 6: 文档与整体验证

**Files:**
- Modify: `AGENTS.md`（「Business flow」销售/生产段附近）

**Interfaces:**
- 无（文档）

- [ ] **Step 1: 补 AGENTS.md 规则**

在 Production 段落末尾追加一条：

> **领料明细「取消未发量」**：`ProductionOrderMaterial.cancelledQty`（`cancelledAt` 记录时间）表示不再需要发料的部分，未发口径全链路为 `requiredQty − issuedQty − cancelledQty`；取消通过 `POST /production/orders/:id/issue` 的 `cancelRemainMaterialIds`（可与 `items` 同时传，也可只取消不发料，此时不需要仓库、不生成单据号），同事务写 `operationLog`、不动库存；订单 `closed` 或 `execStatus` 非 `pending|in_progress` 时拒绝。行状态 `pending`/`partial`/`issued`/`cancelled`。MRP：手工单子件需求按 `requiredQty − cancelledQty` 计入，销售订单下达的单把 `cancelledQty` 作为冲抵（与已发料同口径、只统计未完工订单），`MrpCheckLine.cancelledQuantity` 记录本桶冲抵量。

- [ ] **Step 2: 端到端回归**

Run: `cd server && npm run build && cd ../client && npm run build`
Expected: 两者均成功。

接口回归（`$T` 同上）：`GET /api/v1/production/orders`、`GET /api/v1/stocks`、`POST /api/v1/mrp/calculate`、`GET /api/v1/mrp/check`、`GET /api/v1/mrp/purchase-suggestion` 全部 `code:200`。

页面回归：发料弹窗取消行 → 未发 0；`/mrp/inspection` 出现该物料取消冲抵行；`/production/work-order-materials` 显示已取消列。

- [ ] **Step 3: 复位测试数据并确认无残留**

Run: `PGPASSWORD=erp123456 psql -h 127.0.0.1 -U erp -d erp -c 'SELECT count(*) FROM "ProductionOrderMaterial" WHERE "cancelledQty" > 0;'`
Expected: `0`（测试行已复位）

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: 记录生产领料取消未发量规则"
```

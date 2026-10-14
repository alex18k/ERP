# AGENTS.md

ERP生产管理系统 (MRP-driven manufacturing ERP). Monorepo, two apps at repo root: `server/` (Node + Express 5 + Prisma 5) and `client/` (Vue 3 + Vite 8 + Element Plus). UI/docs/conversation language is Chinese (订单/物料/排产/报工). Requirements: `erp.md` (root), `docs/ERP系统设计说明.md`, `docs/ERP项目开发计划.md`; living docs `docs/MRP运算逻辑.md`, `docs/生产订单取消逻辑.md`. Git repo; `main` is the integration branch.

## Run / verify

```bash
# backend (port 3000) — ALWAYS tsx
cd server && npm run dev            # tsx watch src/index.ts

# frontend (port 63130, vite proxies /api -> localhost:3000)
cd client && npm run dev            # vite

# typecheck + build (MUST use these; npx vite build skips vue-tsc)
cd client && npm run build          # vue-tsc -b && vite build (strict noUnusedLocals)
cd server && npm run build          # tsc
```

- **No automated test suite.** Verify backend with `curl localhost:3000/api/...` + Bearer token. Login `POST /api/v1/auth/login {username,password}`; seed accounts `admin`/`sales01`/`user01`/`purch01`/`wh01`/`plan01`, all `admin123`.
- Node **22.12+** required (Vite 8).

## Gotchas (hard-won)

- Health check is only `GET /api/health` (before auth). Unknown `/api/v1/*` returns `code: 500 "接口不存在"` — not a crash.
- **Prisma pinned `5.22.0` — never upgrade** (v7+ contract CLI broke this project; `prisma.config.ts` removed).
- **`npm start` / `node dist/index.js` is broken**: `tsc` emits ESM with extensionless imports → `ERR_UNSUPPORTED_DIR_IMPORT`. Server is `"type": "module"`; only `tsx` runs it.
- **`MrpRun` has NO `createdAt`** (use `startedAt`/`completedAt`); `orderBy: { createdAt }` throws at typecheck AND runtime.
- Database is **PostgreSQL** (local apt service, db `erp`, user `erp`/`erp123456`, `DATABASE_URL` in `server/.env`). If the server fails with connection refused → `sudo service postgresql start`.
- Migrations at `server/prisma/migrations/<ts>_name/migration.sql`; history starts from the PostgreSQL baseline `20261014000000_init` (generated from `schema.prisma`). The old **SQLite** migration history is archived at `server/prisma/migrations_legacy_sqlite/` (reference only, never applied). To change schema: edit `schema.prisma` → `npx prisma migrate dev --name <x>` → `npx prisma generate` → restart server (or hand-write SQL and `npx prisma migrate deploy`).
- Full reset (test env): drop/recreate the `erp` database → `npx prisma migrate deploy` → `npx prisma db seed` → import scripts (see Master-data import below). If a migration fails mid-`deploy`, reset (test env) or `npx prisma migrate resolve`.
- **Concurrency**: inventory counters use atomic `increment`/`decrement` with `gte` guards (never read-modify-write); order numbers retry on `P2002` (`server/src/utils/retry.ts`); MRP single-instance uses `pg_advisory_xact_lock` (`mrp.service.ts`). Keep new write paths on those patterns — PostgreSQL has multiple writers, unlike the old SQLite single-writer setup.
- After any schema change you MUST `npx prisma generate` **and restart the running server**, or new fields are invisible at runtime.
- The running server is often started as plain `tsx src/index.ts` (no watch) → it does not hot-reload; restart it. Restart pattern: `(setsid npx tsx src/index.ts > /tmp/log 2>&1 < /dev/null &)`. Do NOT `pkill -f "tsx src/index.ts"` in the same command line — it matches and kills the invoking shell; use `pkill -f "src/inde[x].ts"` in a separate command.

## Architecture / conventions

- **API envelope** `{ code, message, data, timestamp }`, success `code: 200`. The axios interceptor returns the whole envelope → pages read `res.data` (`res.data.items`, `{total,page,pageSize,items}`).
- Backend `server/src/{config,utils,middleware,routes,controllers,services}`. Every route needs `requirePermission("module:action")` + a matching method in `client/src/api/index.ts`.
- Blank base-entity CRUD via `crudRoutes()` (`server/src/routes/base.routes.ts`), permission suffix `:view/:create/:edit/:delete`.
- `client/src/api/index.ts` paths mirror backend (`orderApi`→`/sales-orders`, `productionApi`→`/production/...`, `stockApi`→`/stocks`).
- Material dropdowns: use remote search `materialApi.options({keyword,limit})` (lightweight), NOT `materialApi.list({pageSize:1000})`. `materialApi.types()` returns all distinct 物料类别. **Never render a per-row `el-select` with a large option list (e.g. 200 suppliers × N rows) — it explodes the DOM; use `el-select-v2` or remote search + pagination.**
- The purchase-order list flattens one row per detail line: order-level actions use `row.orderId` (not `row.id`).
- Some page routes differ from menu labels: 采购建议 is `/mrp/purchase-suggestion` (not `/mrp/suggestion`).

## Adding a page (3 places, import depth)

1. View `client/src/views/<module>/<name>/index.vue`
2. Route `client/src/router/index.ts` (path must match the directory)
3. Menu `client/src/layouts/MainLayout.vue` (`menuItems`)

Import `src/api` as `../../../api` from `views/<module>/<name>/`; `views/login|home/` are one level shallower → `../../api`. `client` tsconfig is strict (no unused imports/vars).

## Business flow

- Orders must be `confirmed`/`in_production` before MRP sees them.
- MRP (`POST /mrp/calculate`, perm `mrp:run`) expands active BOMs, buckets demand by material `orderCycleDays`, deducts stock (active warehouses) + in-transit (**confirmed** purchase order items with **blank** `status`, remaining qty) + **在制量** (open `planned`/`in_progress` production orders minus already-received qty, per material; also offsets each product×sales-order production suggestion) + **已发料量** (`ProductionBatchMaterial.issuedQty` on non-cancelled batches of open production orders), adds safety stock (first bucket only) → shortages; `purchase` → purchase suggestions, semi/finished `manufacture` → production suggestions (quantity = order demand − 该物料×订单 in-process − 成品/半成品现库存). **Each MRP run cancels ALL `pending` purchase suggestions**, and MRP-generated POs are `draft`. See `docs/MRP运算逻辑.md`.
- Safety-stock replenishment is **separate**: `POST /mrp/safety-stock-suggest` (perm `purchase:create`) creates purchase suggestions for purchase parts with `stock + inTransit < safetyStock` (skips ones already pending).
- Purchase: **`PurchaseOrder.status` has only 2 values: `draft`/`confirmed`** (no cancel/received at header level); **`PurchaseOrderItem.status` has only 3: 空白 `""` (active/receivable)/`closed`/`cancelled`** — receipt progress lives on `receivedQty`, and **only blank-status items are receivable and count as MRP in-transit**. **Only `confirmed` orders can be received and only `confirmed` orders count as MRP in-transit** (draft orders are not receivable and not in transit). create → `PUT /purchase/:id/confirm` (requires supplier + orderDate + expectedDate + buyer + items; perm `purchase:approve`) → `PUT /purchase/:id/receive` (stocks in; writes `RCT-PO` record; receipt unit price > 0 overwrites `material.cost`; rejects non-confirmed POs and `cancelled/closed` items; does NOT update item or header status). MRP orders need editing (dates/buyer/supplier) before they can be confirmed. Receiving list = `GET /purchase?receivable=true` = confirmed orders with blank-status items whose `receivedQty < quantity`.
- Production: create order → `PUT /production/orders/:id/schedule` (requires `planner` + `releaseDate`; per-batch plan dates come from the batch rows; requires an **active process route** for the product) → **copies the standard route into `ProductionOrderRoute`/`ProductionOrderStep`** (once per order, like `ProductionBatchMaterial` does for BOM) → creates `ProductionBatch` rows (**one per batch, no WorkOrder**) + `ProductionBatchMaterial` from the product's active BOM. **Report against a batch**: `POST /production/batches/:id/report` (single) or `POST /production/batch-report` (`{productionOrderId, items:[{batchId, processStepId, quantity, ...}]}`); `processStepId` is **mandatory** and must be a `ProductionOrderStep` of that order. A batch auto-completes when the **last step** (max `sequence`) has cumulative reported qty ≥ `batch.quantity`; when all non-cancelled batches complete AND scheduled qty ≥ order qty → production order (and sales order) auto-complete.
- **`WorkOrder` + `ProcessRouteAssignment` do not exist** (dropped in migration `20260914130000_drop_work_order`). No per-step work orders; the batch is the unit of execution. Station-oriented views (车间看板/甘特图/产能负荷/工位产出排行) were removed. `WorkReport` now has `batchId` (not `workOrderId`) + `processStepId` (bare Int = `ProductionOrderStep.id`, **NOT NULL**), so `listWorkReports`/`getProductionReport` map step names manually. `listWorkReports`/`getWorkReportStats` filter by `orderNo`/`batchNo`/`batchId` (no `workOrderNo`). Export is per batch (`batchExport`), and `updateProductionOrder` no longer rewrites any work-order qty.
- **Two route tables, don't confuse them**: `ProcessRoute`/`ProcessStep` = standard template (基础数据→工艺路线, only affects *future* schedules); `ProductionOrderRoute`/`ProductionOrderStep` = per-order copy (加工单工艺路线 page, editable only **after** scheduling). `GET /production/orders/:id/route` returns the copy with `isOrderLevel: true` (+ `sourceRoute`), else the standard route with `isOrderLevel: false` (frontend renders it read-only). Edit via `PUT /production/orders/:id/route` (header) and `PUT /production/orders/:id/route/steps` (diff: update/create/delete; deleting a step already referenced by a `WorkReport.processStepId` is rejected). Steps added only to the order route have `sourceStepId: null`.
- Batch material issue/receive live under 库存管理: `POST /production/batches/:id/issue` (out, `ISS-WO`) and `POST /production/batches/:id/receive` (in, `RCT-WO`).
- Stock is now per `(material, warehouse)` (the old `materialId @unique` was removed); `Material.stocks` is an array — aggregate across warehouses for "current stock".
- **批号管理 (`MaterialBatch`)**: per `(materialId, warehouseId, batchNo)` stock rows (migration `20261007120000_add_batch_management`). `GET /stocks` list items embed `batches: [{batchNo, quantity}]` (stock.service.ts groups them); issue/receive/receive-production/shipping accept `batchNo` and write batch-level stock. `Material.batchManaged` flags batch-tracked materials; 库存查询 page flattens one row per batch (`flatList` in views/inventory/query). Backfill after reset: `npx tsx prisma/backfill-batches.ts`.
- **Master-data import scripts** (`server/prisma/import-*.ts`, run with `npx tsx prisma/import-<x>.ts`): read the CSV exports in `docs/` (`物料主文件.csv`/`BOM.csv`/`供应商文件.csv`/`客户文件.csv`/`事务类型文件.csv`/`库位文件.csv`). Idempotent (upsert/dedupe by code); order matters only for BOM (must run **after** materials). 库位 maps to `Warehouse` (`code=A01, name=材料仓`). Reliable way to rebuild the ~10.5k-material / ~1.2k-BOM dataset after a DB reset.

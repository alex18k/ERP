# AGENTS.md

ERP生产管理系统 (MRP-driven manufacturing ERP). Monorepo, two apps at repo root: `server/` (Node + Express 5 + Prisma 5) and `client/` (Vue 3 + Vite 8 + Element Plus). UI/docs/conversation language is Chinese (订单/物料/排产/报工). Requirements: `erp.md` (root), `docs/ERP系统设计说明.md`, `docs/ERP项目开发计划.md`; living docs `docs/MRP运算逻辑.md`, `docs/生产订单取消逻辑.md`. Git repo; `main` is the integration branch.

## Run / verify

```bash
# backend (port 3000) — ALWAYS tsx
cd server && npm run dev            # tsx watch src/index.ts

# frontend (port 5173, vite proxies /api -> localhost:3000)
cd client && npm run dev            # vite

# typecheck + build (MUST use these; npx vite build skips vue-tsc)
cd client && npm run build          # vue-tsc -b && vite build (strict noUnusedLocals)
cd server && npm run build          # tsc
```

- **No automated test suite.** Verify backend with `curl localhost:3000/api/...` + Bearer token. Login `POST /api/v1/auth/login {username,password}`; seed accounts `admin`/`sales01`/`user01`/`purch01`/`wh01`, all `admin123`.
- Node **22.12+** required (Vite 8).

## Gotchas (hard-won)

- Health check is only `GET /api/health` (before auth). Unknown `/api/v1/*` returns `code: 500 "接口不存在"` — not a crash.
- **Prisma pinned `5.22.0` — never upgrade** (v7+ contract CLI broke this project; `prisma.config.ts` removed).
- **`npm start` / `node dist/index.js` is broken**: `tsc` emits ESM with extensionless imports → `ERR_UNSUPPORTED_DIR_IMPORT`. Server is `"type": "module"`; only `tsx` runs it.
- **`MrpRun` has NO `createdAt`** (use `startedAt`/`completedAt`); `orderBy: { createdAt }` throws at typecheck AND runtime.
- Migrations are **hand-written SQL** at `server/prisma/migrations/<ts>_name/migration.sql`. Apply with `npx prisma migrate deploy && npx prisma generate`. Do NOT use `prisma migrate dev` (drift risk with hand-written history).
- SQLite at `server/prisma/dev.db`; relative `DATABASE_URL="file:./dev.db"` resolves to the schema dir. Full reset: delete `dev.db` → `npx prisma migrate deploy` → `npx prisma db seed`.
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
- MRP (`POST /mrp/calculate`, perm `mrp:run`) expands active BOMs, buckets demand by material `orderCycleDays`, deducts stock (active warehouses) + in-transit, adds safety stock (first bucket only) → shortages; `purchase` → purchase suggestions, semi/finished `manufacture` → production suggestions. **Each MRP run cancels ALL `pending` purchase suggestions**, and MRP-generated POs are `draft`. See `docs/MRP运算逻辑.md`.
- Safety-stock replenishment is **separate**: `POST /mrp/safety-stock-suggest` (perm `purchase:create`) creates purchase suggestions for purchase parts with `stock + inTransit < safetyStock` (skips ones already pending).
- Purchase: create → `PUT /purchase/:id/confirm` (requires supplier + orderDate + expectedDate + buyer + items; perm `purchase:approve`) → `PUT /purchase/:id/receive` (stocks in; writes `RCT-PO` record; receipt unit price > 0 overwrites `material.cost`). MRP orders need editing (dates/buyer/supplier) before they can be confirmed.
- Production: create order → `PUT /production/orders/:id/schedule` (requires `planner` + `releaseDate`; per-batch plan dates come from the batch rows; requires an **active process route** for the product) → creates one WorkOrder per process step per batch + `ProductionBatchMaterial` from the product's active BOM. Report `POST /production/work-orders/:id/report`; when all work orders complete AND scheduled qty ≥ order qty → production order (and sales order) auto-complete.
- Batch material issue/receive live under 库存管理: `POST /production/batches/:id/issue` (out, `ISS-WO`) and `POST /production/batches/:id/receive` (in, `RCT-WO`).
- Stock is now per `(material, warehouse)` (the old `materialId @unique` was removed); `Material.stocks` is an array — aggregate across warehouses for "current stock".

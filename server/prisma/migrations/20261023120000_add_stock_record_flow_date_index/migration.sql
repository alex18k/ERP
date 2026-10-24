-- 库存流水统一日期口径 (COALESCE(effectiveDate, createdAt)) 的表达式索引：
-- 进销存报表/库存事务列表按该口径过滤与聚合，避免流水表增长后全表扫描。
CREATE INDEX IF NOT EXISTS "StockRecord_flowDate_idx" ON "StockRecord" ((COALESCE("effectiveDate", "createdAt")));
CREATE INDEX IF NOT EXISTS "StockRecord_warehouseId_flowDate_idx" ON "StockRecord" ("warehouseId", (COALESCE("effectiveDate", "createdAt")));

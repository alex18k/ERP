-- 库存事务/库存查询常用过滤与打印索引
CREATE INDEX "StockRecord_documentNo_idx" ON "StockRecord"("documentNo");
CREATE INDEX "StockRecord_relatedType_relatedId_idx" ON "StockRecord"("relatedType", "relatedId");
CREATE INDEX "StockRecord_createdAt_idx" ON "StockRecord"("createdAt");
CREATE INDEX "Stock_warehouseId_idx" ON "Stock"("warehouseId");
CREATE INDEX "MaterialBatch_warehouseId_idx" ON "MaterialBatch"("warehouseId");

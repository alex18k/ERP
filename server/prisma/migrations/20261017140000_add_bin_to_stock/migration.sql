-- 货位管理：仓库开关 + 库存/MaterialBatch/流水按 仓库+货位 维度
ALTER TABLE "Warehouse" ADD COLUMN "binManaged" BOOLEAN NOT NULL DEFAULT false;

-- ===== Stock =====
ALTER TABLE "Stock" ADD COLUMN "binId" INTEGER;
DROP INDEX "Stock_materialId_warehouseId_key";
CREATE UNIQUE INDEX "Stock_materialId_warehouseId_binId_key" ON "Stock"("materialId", "warehouseId", "binId") NULLS NOT DISTINCT;
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_binId_fkey" FOREIGN KEY ("binId") REFERENCES "WarehouseBin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== StockRecord =====
ALTER TABLE "StockRecord" ADD COLUMN "binId" INTEGER;
ALTER TABLE "StockRecord" ADD CONSTRAINT "StockRecord_binId_fkey" FOREIGN KEY ("binId") REFERENCES "WarehouseBin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== MaterialBatch =====
ALTER TABLE "MaterialBatch" ADD COLUMN "binId" INTEGER;
DROP INDEX "MaterialBatch_materialId_warehouseId_batchNo_key";
CREATE UNIQUE INDEX "MaterialBatch_materialId_warehouseId_binId_batchNo_key" ON "MaterialBatch"("materialId", "warehouseId", "binId", "batchNo") NULLS NOT DISTINCT;
ALTER TABLE "MaterialBatch" ADD CONSTRAINT "MaterialBatch_binId_fkey" FOREIGN KEY ("binId") REFERENCES "WarehouseBin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

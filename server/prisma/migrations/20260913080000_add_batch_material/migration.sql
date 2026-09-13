-- CreateTable
CREATE TABLE "ProductionBatchMaterial" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batchId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "requiredQty" REAL NOT NULL,
    "issuedQty" REAL NOT NULL DEFAULT 0,
    "unit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionBatchMaterial_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductionBatchMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductionBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productionOrderId" INTEGER NOT NULL,
    "batchNo" INTEGER NOT NULL,
    "quantity" REAL NOT NULL,
    "planStartDate" DATETIME,
    "planEndDate" DATETIME,
    "receivedQty" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionBatch_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProductionBatch" ("batchNo", "createdAt", "id", "planEndDate", "planStartDate", "productionOrderId", "quantity", "remark", "status") SELECT "batchNo", "createdAt", "id", "planEndDate", "planStartDate", "productionOrderId", "quantity", "remark", "status" FROM "ProductionBatch";
DROP TABLE "ProductionBatch";
ALTER TABLE "new_ProductionBatch" RENAME TO "ProductionBatch";
CREATE INDEX "ProductionBatch_productionOrderId_idx" ON "ProductionBatch"("productionOrderId");
CREATE UNIQUE INDEX "ProductionBatch_productionOrderId_batchNo_key" ON "ProductionBatch"("productionOrderId", "batchNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ProductionBatchMaterial_batchId_idx" ON "ProductionBatchMaterial"("batchId");

-- CreateIndex
CREATE INDEX "ProductionBatchMaterial_materialId_idx" ON "ProductionBatchMaterial"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatchMaterial_batchId_materialId_key" ON "ProductionBatchMaterial"("batchId", "materialId");

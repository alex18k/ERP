ALTER TABLE "Material" ADD COLUMN "batchManaged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StockRecord" ADD COLUMN "batchNo" TEXT;
CREATE TABLE "MaterialBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "materialId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "batchNo" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MaterialBatch_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialBatch_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MaterialBatch_materialId_warehouseId_batchNo_key" ON "MaterialBatch"("materialId", "warehouseId", "batchNo");
CREATE INDEX "MaterialBatch_materialId_idx" ON "MaterialBatch"("materialId");

-- CreateTable
CREATE TABLE "StockTransactionType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'in',
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StockRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "materialId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "transactionTypeId" INTEGER,
    "quantity" REAL NOT NULL,
    "relatedType" TEXT,
    "relatedId" INTEGER,
    "operatorId" INTEGER,
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockRecord_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRecord_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRecord_transactionTypeId_fkey" FOREIGN KEY ("transactionTypeId") REFERENCES "StockTransactionType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRecord_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockRecord" ("createdAt", "id", "materialId", "operatorId", "quantity", "relatedId", "relatedType", "remark", "type", "warehouseId") SELECT "createdAt", "id", "materialId", "operatorId", "quantity", "relatedId", "relatedType", "remark", "type", "warehouseId" FROM "StockRecord";
DROP TABLE "StockRecord";
ALTER TABLE "new_StockRecord" RENAME TO "StockRecord";
CREATE INDEX "StockRecord_materialId_idx" ON "StockRecord"("materialId");
CREATE INDEX "StockRecord_warehouseId_idx" ON "StockRecord"("warehouseId");
CREATE INDEX "StockRecord_type_createdAt_idx" ON "StockRecord"("type", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "StockTransactionType_code_key" ON "StockTransactionType"("code");

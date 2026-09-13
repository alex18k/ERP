-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PurchaseOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderNo" TEXT NOT NULL,
    "supplierId" INTEGER,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "orderDate" DATETIME,
    "expectedDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "settleMethod" TEXT,
    "remark" TEXT,
    "createdBy" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseOrder" ("createdAt", "createdBy", "expectedDate", "id", "orderDate", "orderNo", "remark", "settleMethod", "status", "supplierId", "totalAmount", "updatedAt") SELECT "createdAt", "createdBy", "expectedDate", "id", "orderDate", "orderNo", "remark", "settleMethod", "status", "supplierId", "totalAmount", "updatedAt" FROM "PurchaseOrder";
DROP TABLE "PurchaseOrder";
ALTER TABLE "new_PurchaseOrder" RENAME TO "PurchaseOrder";
CREATE UNIQUE INDEX "PurchaseOrder_orderNo_key" ON "PurchaseOrder"("orderNo");
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

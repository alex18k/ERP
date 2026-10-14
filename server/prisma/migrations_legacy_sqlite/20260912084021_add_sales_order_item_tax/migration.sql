-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SalesOrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "quantity" REAL NOT NULL,
    "unit" TEXT,
    "unitPrice" REAL DEFAULT 0,
    "taxIncluded" BOOLEAN NOT NULL DEFAULT false,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "amount" REAL DEFAULT 0,
    "deliveredQty" REAL NOT NULL DEFAULT 0,
    "deliveryDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remark" TEXT,
    CONSTRAINT "SalesOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesOrderItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SalesOrderItem" ("amount", "deliveredQty", "deliveryDate", "id", "materialId", "orderId", "quantity", "remark", "status", "unit", "unitPrice") SELECT "amount", "deliveredQty", "deliveryDate", "id", "materialId", "orderId", "quantity", "remark", "status", "unit", "unitPrice" FROM "SalesOrderItem";
DROP TABLE "SalesOrderItem";
ALTER TABLE "new_SalesOrderItem" RENAME TO "SalesOrderItem";
CREATE INDEX "SalesOrderItem_orderId_idx" ON "SalesOrderItem"("orderId");
CREATE INDEX "SalesOrderItem_materialId_idx" ON "SalesOrderItem"("materialId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

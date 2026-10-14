-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Material" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specification" TEXT,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "safetyStock" REAL NOT NULL DEFAULT 0,
    "minStock" REAL NOT NULL DEFAULT 0,
    "maxStock" REAL NOT NULL DEFAULT 0,
    "leadTime" INTEGER NOT NULL DEFAULT 0,
    "materialType" TEXT,
    "minOrderQty" REAL NOT NULL DEFAULT 0,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "cost" REAL NOT NULL DEFAULT 0,
    "defaultWarehouseId" INTEGER,
    "supplierId" INTEGER,
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Material_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Material" ("category", "code", "createdAt", "defaultWarehouseId", "id", "leadTime", "maxStock", "minStock", "name", "remark", "safetyStock", "specification", "status", "supplierId", "unit", "updatedAt") SELECT "category", "code", "createdAt", "defaultWarehouseId", "id", "leadTime", "maxStock", "minStock", "name", "remark", "safetyStock", "specification", "status", "supplierId", "unit", "updatedAt" FROM "Material";
DROP TABLE "Material";
ALTER TABLE "new_Material" RENAME TO "Material";
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");
CREATE INDEX "Material_category_status_idx" ON "Material"("category", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

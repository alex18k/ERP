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
    "processRouteId" INTEGER,
    CONSTRAINT "Material_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Material_processRouteId_fkey" FOREIGN KEY ("processRouteId") REFERENCES "ProcessRoute" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Material" ("category", "code", "cost", "createdAt", "defaultWarehouseId", "id", "leadTime", "materialType", "maxStock", "minOrderQty", "minStock", "name", "remark", "safetyStock", "specification", "status", "supplierId", "unit", "unitPrice", "updatedAt") SELECT "category", "code", "cost", "createdAt", "defaultWarehouseId", "id", "leadTime", "materialType", "maxStock", "minOrderQty", "minStock", "name", "remark", "safetyStock", "specification", "status", "supplierId", "unit", "unitPrice", "updatedAt" FROM "Material";
DROP TABLE "Material";
ALTER TABLE "new_Material" RENAME TO "Material";
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");
CREATE INDEX "Material_category_status_idx" ON "Material"("category", "status");
CREATE TABLE "new_ProcessRoute" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalTime" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ProcessRoute" ("code", "createdAt", "id", "name", "status", "totalTime", "updatedAt") SELECT "code", "createdAt", "id", "name", "status", "totalTime", "updatedAt" FROM "ProcessRoute";
DROP TABLE "ProcessRoute";
ALTER TABLE "new_ProcessRoute" RENAME TO "ProcessRoute";
CREATE UNIQUE INDEX "ProcessRoute_code_key" ON "ProcessRoute"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


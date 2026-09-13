-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Warehouse" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'valid',
    "address" TEXT,
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Warehouse" ("address", "code", "createdAt", "id", "name", "status", "type") SELECT "address", "code", "createdAt", "id", "name", "status", "type" FROM "Warehouse";
DROP TABLE "Warehouse";
ALTER TABLE "new_Warehouse" RENAME TO "Warehouse";
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- 旧仓库类型统一重映射为有效
UPDATE "Warehouse" SET "type" = 'valid' WHERE "type" NOT IN ('valid', 'invalid');

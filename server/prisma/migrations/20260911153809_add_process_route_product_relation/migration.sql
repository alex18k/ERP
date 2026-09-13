-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProcessRoute" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "totalTime" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProcessRoute_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProcessRoute" ("code", "createdAt", "id", "name", "productId", "status", "totalTime", "updatedAt") SELECT "code", "createdAt", "id", "name", "productId", "status", "totalTime", "updatedAt" FROM "ProcessRoute";
DROP TABLE "ProcessRoute";
ALTER TABLE "new_ProcessRoute" RENAME TO "ProcessRoute";
CREATE UNIQUE INDEX "ProcessRoute_code_key" ON "ProcessRoute"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

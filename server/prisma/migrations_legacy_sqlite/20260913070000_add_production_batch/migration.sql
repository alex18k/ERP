-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productionOrderId" INTEGER NOT NULL,
    "batchNo" INTEGER NOT NULL,
    "quantity" REAL NOT NULL,
    "planStartDate" DATETIME,
    "planEndDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionBatch_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderNo" TEXT NOT NULL,
    "productionOrderId" INTEGER NOT NULL,
    "batchId" INTEGER,
    "processRouteId" INTEGER,
    "workstationId" INTEGER,
    "operatorId" INTEGER,
    "plannedQty" REAL NOT NULL,
    "actualQty" REAL NOT NULL DEFAULT 0,
    "scrapQty" REAL NOT NULL DEFAULT 0,
    "startTime" DATETIME,
    "endTime" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkOrder_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkOrder_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkOrder_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkOrder_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WorkOrder" ("actualQty", "createdAt", "endTime", "id", "operatorId", "orderNo", "plannedQty", "processRouteId", "productionOrderId", "remark", "scrapQty", "startTime", "status", "updatedAt", "workstationId") SELECT "actualQty", "createdAt", "endTime", "id", "operatorId", "orderNo", "plannedQty", "processRouteId", "productionOrderId", "remark", "scrapQty", "startTime", "status", "updatedAt", "workstationId" FROM "WorkOrder";
DROP TABLE "WorkOrder";
ALTER TABLE "new_WorkOrder" RENAME TO "WorkOrder";
CREATE UNIQUE INDEX "WorkOrder_orderNo_key" ON "WorkOrder"("orderNo");
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");
CREATE INDEX "WorkOrder_productionOrderId_idx" ON "WorkOrder"("productionOrderId");
CREATE INDEX "WorkOrder_batchId_idx" ON "WorkOrder"("batchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ProductionBatch_productionOrderId_idx" ON "ProductionBatch"("productionOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_productionOrderId_batchNo_key" ON "ProductionBatch"("productionOrderId", "batchNo");

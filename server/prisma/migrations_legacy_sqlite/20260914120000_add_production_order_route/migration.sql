-- CreateTable
CREATE TABLE "ProductionOrderRoute" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productionOrderId" INTEGER NOT NULL,
    "sourceRouteId" INTEGER,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "totalTime" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductionOrderRoute_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductionOrderStep" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderRouteId" INTEGER NOT NULL,
    "sourceStepId" INTEGER,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "workstationId" INTEGER,
    "standardTime" REAL NOT NULL DEFAULT 0,
    "setupTime" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionOrderStep_orderRouteId_fkey" FOREIGN KEY ("orderRouteId") REFERENCES "ProductionOrderRoute" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductionOrderStep_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrderRoute_productionOrderId_key" ON "ProductionOrderRoute"("productionOrderId");

-- CreateIndex
CREATE INDEX "ProductionOrderStep_orderRouteId_idx" ON "ProductionOrderStep"("orderRouteId");

-- AlterTable: WorkOrder add orderStepId (SQLite: no ADD CONSTRAINT, FK enforced by Prisma ORM)
ALTER TABLE "WorkOrder" ADD COLUMN "orderStepId" INTEGER;

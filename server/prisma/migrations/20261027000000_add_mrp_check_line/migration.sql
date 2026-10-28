-- MRP信息检查表：每次 MRP 运算落库全部参与运算的物料（按物料×需求日期分桶）
CREATE TABLE "MrpCheckLine" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "category" TEXT,
    "unit" TEXT,
    "needDate" TIMESTAMP(3),
    "grossDemand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "safetyStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stockQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inTransit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wipQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "issuedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netDemand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leadTime" INTEGER,
    "orderDate" TIMESTAMP(3),
    "suggestedPurchaseQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggestedProductionQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceOrders" TEXT,

    CONSTRAINT "MrpCheckLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MrpCheckLine_runId_idx" ON "MrpCheckLine"("runId");
CREATE INDEX "MrpCheckLine_materialId_idx" ON "MrpCheckLine"("materialId");

ALTER TABLE "MrpCheckLine" ADD CONSTRAINT "MrpCheckLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MrpRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MrpCheckLine" ADD CONSTRAINT "MrpCheckLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

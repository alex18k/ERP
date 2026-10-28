-- 取消生产批次：删除批次/批次用料/按批次的报工，恢复按生产订单生成加工单
-- 按业务确认：现有批次执行数据清空，生产订单主数据保留；进行中的订单回到已计划，便于重新排产。

DROP TABLE IF EXISTS "WorkReport";
DROP TABLE IF EXISTS "ProductionBatchMaterial";
DROP TABLE IF EXISTS "ProductionBatch";

UPDATE "ProductionOrder"
SET "status" = 'planned', "actualStartDate" = NULL
WHERE "status" = 'in_progress';

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" SERIAL NOT NULL,
    "orderNo" TEXT NOT NULL,
    "productionOrderId" INTEGER NOT NULL,
    "plannedQty" DOUBLE PRECISION NOT NULL,
    "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scrapQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "operatorId" INTEGER,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderMaterial" (
    "id" SERIAL NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "requiredQty" DOUBLE PRECISION NOT NULL,
    "issuedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkReport" (
    "id" SERIAL NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "processStepId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "scrapQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "materialUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "workHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reportTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remark" TEXT,

    CONSTRAINT "WorkReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_orderNo_key" ON "WorkOrder"("orderNo");
CREATE UNIQUE INDEX "WorkOrder_productionOrderId_key" ON "WorkOrder"("productionOrderId");
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");
CREATE INDEX "WorkOrderMaterial_workOrderId_idx" ON "WorkOrderMaterial"("workOrderId");
CREATE INDEX "WorkOrderMaterial_materialId_idx" ON "WorkOrderMaterial"("materialId");
CREATE UNIQUE INDEX "WorkOrderMaterial_workOrderId_materialId_key" ON "WorkOrderMaterial"("workOrderId", "materialId");
CREATE INDEX "WorkReport_workOrderId_idx" ON "WorkReport"("workOrderId");
CREATE INDEX "WorkReport_processStepId_idx" ON "WorkReport"("processStepId");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkOrderMaterial" ADD CONSTRAINT "WorkOrderMaterial_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrderMaterial" ADD CONSTRAINT "WorkOrderMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

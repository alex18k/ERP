-- 将加工单（WorkOrder）合并进生产订单（ProductionOrder）：
-- 生产订单吸收执行字段（加工单号/计划量/入库量/报工量/执行状态等），
-- 加工单物料清单改挂生产订单，报工与库存流水改指向生产订单，最后删除加工单表。

-- 1. ProductionOrder 增加执行字段
ALTER TABLE "ProductionOrder"
  ADD COLUMN "workOrderNo" TEXT,
  ADD COLUMN "plannedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "actualQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "scrapQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "execStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "operatorId" INTEGER,
  ADD COLUMN "startTime" TIMESTAMP(3),
  ADD COLUMN "endTime" TIMESTAMP(3);

-- 2. 回填原加工单执行信息
UPDATE "ProductionOrder" po
SET "workOrderNo" = wo."orderNo",
    "plannedQty" = wo."plannedQty",
    "receivedQty" = wo."receivedQty",
    "actualQty" = wo."actualQty",
    "scrapQty" = wo."scrapQty",
    "execStatus" = wo."status",
    "operatorId" = wo."operatorId",
    "startTime" = wo."startTime",
    "endTime" = wo."endTime"
FROM "WorkOrder" wo
WHERE wo."productionOrderId" = po."id";

-- 未排产订单：计划数量取订单数量
UPDATE "ProductionOrder"
SET "plannedQty" = "quantity"
WHERE "workOrderNo" IS NULL AND "plannedQty" = 0;

-- 3. 新建生产订单领料明细并回填
CREATE TABLE "ProductionOrderMaterial" (
    "id" SERIAL NOT NULL,
    "productionOrderId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "requiredQty" DOUBLE PRECISION NOT NULL,
    "issuedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionOrderMaterial_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ProductionOrderMaterial"
  ("productionOrderId", "materialId", "requiredQty", "issuedQty", "unit", "status", "remark", "createdAt")
SELECT wo."productionOrderId", wom."materialId", wom."requiredQty", wom."issuedQty",
       wom."unit", wom."status", wom."remark", wom."createdAt"
FROM "WorkOrderMaterial" wom
JOIN "WorkOrder" wo ON wo."id" = wom."workOrderId";

-- 4. 报工改挂生产订单
ALTER TABLE "WorkReport" ADD COLUMN "productionOrderId" INTEGER;
UPDATE "WorkReport" wr
SET "productionOrderId" = wo."productionOrderId"
FROM "WorkOrder" wo
WHERE wo."id" = wr."workOrderId";
ALTER TABLE "WorkReport" ALTER COLUMN "productionOrderId" SET NOT NULL;
ALTER TABLE "WorkReport" DROP CONSTRAINT IF EXISTS "WorkReport_workOrderId_fkey";
DROP INDEX IF EXISTS "WorkReport_workOrderId_idx";
ALTER TABLE "WorkReport" DROP COLUMN "workOrderId";

-- 5. 库存流水相关类型由加工单改为生产订单
UPDATE "StockRecord" sr
SET "relatedType" = 'ProductionOrder',
    "relatedId" = wo."productionOrderId"
FROM "WorkOrder" wo
WHERE sr."relatedType" = 'WorkOrder' AND sr."relatedId" = wo."id";

-- 6. 删除旧加工单表（先删明细，再删主表）
DROP TABLE "WorkOrderMaterial";
DROP TABLE "WorkOrder";

-- 7. 新索引与外键
CREATE UNIQUE INDEX "ProductionOrder_workOrderNo_key" ON "ProductionOrder"("workOrderNo");
CREATE INDEX "ProductionOrder_execStatus_idx" ON "ProductionOrder"("execStatus");
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ProductionOrderMaterial_productionOrderId_idx" ON "ProductionOrderMaterial"("productionOrderId");
CREATE INDEX "ProductionOrderMaterial_materialId_idx" ON "ProductionOrderMaterial"("materialId");
CREATE UNIQUE INDEX "ProductionOrderMaterial_productionOrderId_materialId_key"
  ON "ProductionOrderMaterial"("productionOrderId", "materialId");
ALTER TABLE "ProductionOrderMaterial" ADD CONSTRAINT "ProductionOrderMaterial_productionOrderId_fkey"
  FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionOrderMaterial" ADD CONSTRAINT "ProductionOrderMaterial_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "WorkReport_productionOrderId_idx" ON "WorkReport"("productionOrderId");
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_productionOrderId_fkey"
  FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

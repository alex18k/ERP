-- 生产领料明细：取消未发量（不再需要发料的部分），保留 requiredQty 原始需求
ALTER TABLE "ProductionOrderMaterial" ADD COLUMN "cancelledQty" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ProductionOrderMaterial" ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- MRP信息检查表：取消未发冲抵量
ALTER TABLE "MrpCheckLine" ADD COLUMN "cancelledQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0;

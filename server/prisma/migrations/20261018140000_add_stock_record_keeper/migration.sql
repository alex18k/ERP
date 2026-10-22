-- 采购收货增加仓管员（随本次收货写入库存流水）
ALTER TABLE "StockRecord" ADD COLUMN "keeper" TEXT;

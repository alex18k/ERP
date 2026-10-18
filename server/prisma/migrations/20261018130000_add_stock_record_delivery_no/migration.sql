-- 采购收货增加送货单号（随本次收货写入库存流水）
ALTER TABLE "StockRecord" ADD COLUMN "deliveryNo" TEXT;

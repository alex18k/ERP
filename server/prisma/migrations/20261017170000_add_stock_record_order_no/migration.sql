-- 库存事务增加手工/原单号；documentNo 保留为系统自动生成的单据号
ALTER TABLE "StockRecord" ADD COLUMN "orderNo" TEXT;

CREATE INDEX "StockRecord_orderNo_idx" ON "StockRecord"("orderNo");

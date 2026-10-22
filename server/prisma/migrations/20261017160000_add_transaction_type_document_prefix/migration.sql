-- 事务类型增加“单据”前缀，用于生成库存事务单号（如采购收货 RC）
ALTER TABLE "StockTransactionType" ADD COLUMN "documentPrefix" TEXT;

-- 现有采购收货类型默认 RC，保持与既有收货单号一致
UPDATE "StockTransactionType" SET "documentPrefix" = 'RC' WHERE "code" = 'RCT-PO';

-- 明细状态归一化：PurchaseOrderItem.status 仅保留 空白('')/关闭(closed)/取消(cancelled)
-- 收货进度由 receivedQty 承载，历史 pending/partial_received/received/draft 统一转为空白(空串)
UPDATE "PurchaseOrderItem"
SET "status" = ''
WHERE "status" IN ('pending', 'partial_received', 'received', 'draft');
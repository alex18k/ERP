-- 主表状态归一化：PurchaseOrder.status 仅保留 draft/confirmed 两种
-- 收货进度已由明细（PurchaseOrderItem.status）承载，历史 partial_received/received/cancelled/closed 统一转为 confirmed
UPDATE "PurchaseOrder"
SET "status" = 'confirmed'
WHERE "status" IN ('partial_received', 'received', 'cancelled', 'closed');
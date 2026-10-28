-- 生产订单「已取消」并入「已关闭」（status 与 execStatus）
-- 从未排产（plannedQty=0 且 startTime 为空）的历史执行记录还原为 none，保留重新排产能力
UPDATE "ProductionOrder" SET "execStatus" = 'none' WHERE "execStatus" = 'cancelled' AND "plannedQty" = 0 AND "startTime" IS NULL;
UPDATE "ProductionOrder" SET "execStatus" = 'closed' WHERE "execStatus" = 'cancelled';
UPDATE "ProductionOrder" SET "status" = 'closed' WHERE "status" = 'cancelled';

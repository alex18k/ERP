-- 取消生产订单「已完成」状态：完工改由执行状态 execStatus='completed' 表达
-- 已排产的完工单保留完工事实（execStatus 已是 completed）；未排产的异常数据不伪造执行状态
UPDATE "ProductionOrder" SET "execStatus" = 'completed' WHERE "status" = 'completed' AND "execStatus" <> 'none';
UPDATE "ProductionOrder" SET "status" = 'in_progress' WHERE "status" = 'completed';

-- 取消加工单号：一单一号（MO），已排产判据改由 execStatus <> 'none' 承担
ALTER TABLE "ProductionOrder" DROP CONSTRAINT IF EXISTS "ProductionOrder_workOrderNo_key";
ALTER TABLE "ProductionOrder" DROP COLUMN IF EXISTS "workOrderNo";

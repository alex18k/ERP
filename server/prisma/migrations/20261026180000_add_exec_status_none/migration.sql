-- 未排产显式化：execStatus 增加 none 值作为「未排产」，取号与判据仍沿用 workOrderNo（下一迁移删除）
ALTER TABLE "ProductionOrder" ALTER COLUMN "execStatus" SET DEFAULT 'none';

UPDATE "ProductionOrder" SET "execStatus" = 'none' WHERE "workOrderNo" IS NULL;

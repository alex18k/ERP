-- MRP信息检查表：记录运算时的当前库存（启用仓库合计）
ALTER TABLE "MrpCheckLine" ADD COLUMN "currentStock" DOUBLE PRECISION NOT NULL DEFAULT 0;

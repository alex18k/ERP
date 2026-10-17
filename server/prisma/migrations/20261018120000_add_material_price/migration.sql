-- 新增物料最近采购价（基本单位），采购收货回写；历史数据以原 cost 回填
ALTER TABLE "Material" ADD COLUMN "price" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "Material" SET "price" = "cost";
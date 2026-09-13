-- 物料分类简化为两类：采购 / 制造
-- raw/accessory -> purchase ; semi/finished -> manufacture
UPDATE "Material" SET "category" = 'purchase' WHERE "category" IN ('raw', 'accessory');
UPDATE "Material" SET "category" = 'manufacture' WHERE "category" IN ('semi', 'finished');

-- 物料主文件增加封装、品牌字段（自由填写）
ALTER TABLE "Material" ADD COLUMN "packageType" TEXT;
ALTER TABLE "Material" ADD COLUMN "brand" TEXT;

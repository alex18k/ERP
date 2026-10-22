-- AlterTable
ALTER TABLE "CompanyInfo" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompanyInfo" ADD COLUMN "defaultedAt" TIMESTAMP(3);

-- 现有单例公司设为默认
UPDATE "CompanyInfo"
SET "isDefault" = true, "defaultedAt" = NOW()
WHERE NOT EXISTS (SELECT 1 FROM "CompanyInfo" WHERE "isDefault" = true);

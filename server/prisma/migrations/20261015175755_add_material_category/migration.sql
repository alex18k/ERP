-- CreateTable
CREATE TABLE "MaterialCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialCategory_name_key" ON "MaterialCategory"("name");

-- 用物料主文件已有的物料类别初始化类别主数据（去重）
INSERT INTO "MaterialCategory" ("name", "updatedAt")
SELECT DISTINCT TRIM("materialType"), CURRENT_TIMESTAMP
FROM "Material"
WHERE "materialType" IS NOT NULL AND TRIM("materialType") <> ''
ON CONFLICT ("name") DO NOTHING;

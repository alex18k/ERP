CREATE TABLE "CompanyInfo" (
    "id" SERIAL NOT NULL,
    "nameZh" TEXT NOT NULL DEFAULT '',
    "nameEn" TEXT,
    "region" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "contact" TEXT,
    "taxNo" TEXT,
    "website" TEXT,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyInfo_pkey" PRIMARY KEY ("id")
);

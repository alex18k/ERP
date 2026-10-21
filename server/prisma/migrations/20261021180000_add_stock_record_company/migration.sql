-- AlterTable
ALTER TABLE "StockRecord" ADD COLUMN "companyId" INTEGER;

-- ForeignKey
ALTER TABLE "StockRecord" ADD CONSTRAINT "StockRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "CompanyInfo"(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- CreateIndex
CREATE INDEX "StockRecord_companyId_idx" ON "StockRecord"("companyId");

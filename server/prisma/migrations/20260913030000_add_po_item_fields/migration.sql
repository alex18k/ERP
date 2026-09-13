-- AlterTable
ALTER TABLE "Material" ADD COLUMN "location" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "unit" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "taxIncluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "taxRate" REAL NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "location" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "remark" TEXT;

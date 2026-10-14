-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN "channel" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "orderDate" DATETIME;
ALTER TABLE "SalesOrder" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "seller" TEXT;

-- Migration: SalesOrder seller -> seller1, add seller2
ALTER TABLE "SalesOrder" RENAME COLUMN "seller" TO "seller1";
ALTER TABLE "SalesOrder" ADD COLUMN "seller2" TEXT;

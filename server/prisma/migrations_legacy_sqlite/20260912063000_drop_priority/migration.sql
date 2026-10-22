-- Migration: drop priority from SalesOrder and ProductionOrder
ALTER TABLE "SalesOrder" DROP COLUMN "priority";
ALTER TABLE "ProductionOrder" DROP COLUMN "priority";

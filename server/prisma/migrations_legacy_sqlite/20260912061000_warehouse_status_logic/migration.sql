-- Migration: replace warehouse.type(valid/invalid) with status(1/0)
UPDATE "Warehouse" SET "status" = 0 WHERE "type" = "invalid";
ALTER TABLE "Warehouse" DROP COLUMN "type";

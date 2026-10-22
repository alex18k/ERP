-- 库存流水增加部门与经手人（手工库存事务录入）
ALTER TABLE "StockRecord" ADD COLUMN "departmentId" INTEGER,
ADD COLUMN "handler" TEXT;

CREATE INDEX "StockRecord_departmentId_idx" ON "StockRecord"("departmentId");

ALTER TABLE "StockRecord" ADD CONSTRAINT "StockRecord_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Workshop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

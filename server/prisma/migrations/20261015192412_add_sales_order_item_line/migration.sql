-- AlterTable
ALTER TABLE "SalesOrderItem" ADD COLUMN     "line" INTEGER NOT NULL DEFAULT 0;

-- 回填历史明细行号（按订单内 id 顺序，从 1 开始）
UPDATE "SalesOrderItem" i
SET "line" = s.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "orderId" ORDER BY id) AS rn
  FROM "SalesOrderItem"
) s
WHERE i.id = s.id AND i."line" = 0;

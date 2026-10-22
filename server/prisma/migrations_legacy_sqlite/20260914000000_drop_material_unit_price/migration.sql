-- 弃用 Material.unitPrice，统一使用 cost：
-- 1) 将历史单价回填到成本（仅当成本为空/0 时），避免丢失参考价
-- 2) 删除 unitPrice 列
UPDATE "Material" SET "cost" = "unitPrice"
  WHERE ("cost" IS NULL OR "cost" = 0) AND "unitPrice" > 0;

ALTER TABLE "Material" DROP COLUMN "unitPrice";
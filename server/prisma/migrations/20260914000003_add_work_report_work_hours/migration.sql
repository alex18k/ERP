-- 报工记录增加实际工时字段 workHours
ALTER TABLE "WorkReport" ADD COLUMN "workHours" REAL NOT NULL DEFAULT 0;
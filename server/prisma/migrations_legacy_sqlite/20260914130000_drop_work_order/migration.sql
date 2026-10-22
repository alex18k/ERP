-- 取消加工单：报工改为直接挂批次
-- 1) WorkReport 重建：workOrderId -> batchId，processStepId 改为非空（订单级工序）
-- 2) 删除 WorkOrder / ProcessRouteAssignment

PRAGMA foreign_keys=OFF;

-- CreateTable: new WorkReport
CREATE TABLE "new_WorkReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batchId" INTEGER NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "processStepId" INTEGER NOT NULL,
    "quantity" REAL NOT NULL,
    "scrapQty" REAL NOT NULL DEFAULT 0,
    "materialUsed" REAL NOT NULL DEFAULT 0,
    "workHours" REAL NOT NULL DEFAULT 0,
    "reportTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remark" TEXT,
    CONSTRAINT "WorkReport_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 回填历史数据：由 workOrder.batchId 推导（无可对应批次或无工序的旧流水丢弃）
INSERT INTO "new_WorkReport" ("id","batchId","reporterId","processStepId","quantity","scrapQty","materialUsed","workHours","reportTime","remark")
SELECT r."id", w."batchId", r."reporterId", r."processStepId", r."quantity", r."scrapQty", r."materialUsed", r."workHours", r."reportTime", r."remark"
FROM "WorkReport" r
JOIN "WorkOrder" w ON r."workOrderId" = w."id"
WHERE w."batchId" IS NOT NULL AND r."processStepId" IS NOT NULL;

DROP TABLE "WorkReport";
ALTER TABLE "new_WorkReport" RENAME TO "WorkReport";

CREATE INDEX "WorkReport_batchId_idx" ON "WorkReport"("batchId");
CREATE INDEX "WorkReport_processStepId_idx" ON "WorkReport"("processStepId");

-- DropTable
DROP TABLE "ProcessRouteAssignment";
DROP TABLE "WorkOrder";

PRAGMA foreign_keys=ON;

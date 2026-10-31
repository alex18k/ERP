-- 执行状态取消「已关闭」(closed)：存量行按实际进度重算（口径同 computeReopenedExecStatus；单据关闭只看 status=closed）
UPDATE "ProductionOrder" po
SET "execStatus" = CASE
  WHEN po."plannedQty" <= 0.000001 AND po."startTime" IS NULL THEN 'none'
  WHEN COALESCE((
    SELECT SUM(w."quantity")
    FROM "WorkReport" w
    WHERE w."productionOrderId" = po."id"
      AND w."processStepId" = (
        SELECT s."id"
        FROM "ProductionOrderRoute" r
        JOIN "ProductionOrderStep" s ON s."orderRouteId" = r."id"
        WHERE r."productionOrderId" = po."id"
        ORDER BY s."sequence" DESC
        LIMIT 1
      )
  ), -1) >= po."plannedQty" - 0.000001 THEN 'completed'
  WHEN EXISTS (SELECT 1 FROM "WorkReport" w2 WHERE w2."productionOrderId" = po."id") THEN 'in_progress'
  ELSE 'pending'
END
WHERE po."execStatus" = 'closed';

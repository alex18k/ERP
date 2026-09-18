import { Router } from "express";
import * as productionController from "../controllers/production.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

// 生产订单
router.get("/orders", requirePermission("production:view"), productionController.listOrderHandler);
router.get("/planners", requirePermission("production:view"), productionController.plannersHandler);
router.get("/employees", requirePermission("production:report"), productionController.employeesHandler);
router.get("/orders/issued-keys", requirePermission("production:view"), productionController.issuedKeysHandler);
router.post("/orders", requirePermission("production:manage"), productionController.createOrderHandler);
router.put("/orders/:id", requirePermission("production:manage"), productionController.updateOrderHandler);
router.put("/orders/:id/cancel", requirePermission("production:manage"), productionController.cancelOrderHandler);
router.post("/orders/:id/schedule", requirePermission("production:manage"), productionController.scheduleHandler);

// 报工（直接挂批次 + 订单级工序）
router.post("/batches/:id/report", requirePermission("production:report"), productionController.reportBatchHandler);
router.post("/batch-report", requirePermission("production:report"), productionController.batchReportHandler);

// 批次物料清单 / 发料 / 入库
router.get("/orders/:id/route", requirePermission("production:view"), productionController.orderRouteHandler);
router.put("/orders/:id/route", requirePermission("production:manage"), productionController.updateOrderRouteHandler);
router.put("/orders/:id/route/steps", requirePermission("production:manage"), productionController.replaceOrderRouteStepsHandler);
router.get("/batch-materials", requirePermission("production:view"), productionController.batchMaterialsHandler);
router.post("/batches/:id/materials", requirePermission("production:manage"), productionController.createBatchMaterialHandler);
router.put("/batch-materials/:id", requirePermission("production:manage"), productionController.updateBatchMaterialHandler);
router.delete("/batch-materials/:id", requirePermission("production:manage"), productionController.deleteBatchMaterialHandler);
router.get("/batches/receivable", requirePermission("production:view"), productionController.receivableBatchesHandler);
router.get("/batches/:id/materials", requirePermission("production:view"), productionController.batchMaterialsDetailHandler);
router.post("/batches/:id/issue", requirePermission("stock:edit"), productionController.issueBatchMaterialsHandler);
router.post("/batches/:id/receive", requirePermission("stock:edit"), productionController.receiveBatchHandler);

// 导出（按批次）
router.get("/export", requirePermission("production:view"), productionController.exportHandler);
// 员工报工报表导出
router.get("/employee-report-export", requirePermission("production:view"), productionController.employeeReportExportHandler);

// 报工记录
router.get("/reports", requirePermission("production:view"), productionController.listReportHandler);
router.get("/reporters", requirePermission("production:view"), productionController.listReporterHandler);
router.get("/work-report-stats", requirePermission("production:view"), productionController.workReportStatsHandler);

export default router;
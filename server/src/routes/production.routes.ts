import { Router } from "express";
import * as productionController from "../controllers/production.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";
import { operationLog } from "../middleware/log";

const router = Router();

router.use(authMiddleware);

// 生产订单
router.get("/orders", requirePermission("production:view"), productionController.listOrderHandler);
router.get("/planners", requirePermission("production:view"), productionController.plannersHandler);
router.get("/employees", requirePermission("production:report"), productionController.employeesHandler);
router.get("/orders/issued-keys", requirePermission("production:view"), productionController.issuedKeysHandler);
router.get("/orders/schedulable", requirePermission("production:view"), productionController.schedulableOrdersHandler);
router.post("/orders", requirePermission("production:manage"), productionController.createOrderHandler);
router.put("/orders/:id", requirePermission("production:manage"), productionController.updateOrderHandler);
router.put("/orders/:id/status", requirePermission("production:manage"), productionController.updateStatusHandler);
router.put("/orders/:id/close-order", requirePermission("production:manage"), productionController.closeOrderHandler);
router.delete("/orders/:id", requirePermission("production:manage"), operationLog("production", "delete"), productionController.deleteOrderHandler);
router.post("/orders/batch-schedule", requirePermission("production:manage"), productionController.batchScheduleHandler);
router.post("/orders/:id/schedule", requirePermission("production:manage"), productionController.scheduleHandler);

// 生产订单领料单 / 领料 / 入库
router.get("/order-materials", requirePermission("production:view"), productionController.productionOrderMaterialsHandler);
router.get("/orders/receivable", requirePermission("production:view"), productionController.receivableProductionOrdersHandler);
router.get("/orders/:id/materials", requirePermission("production:view"), productionController.productionOrderMaterialsDetailHandler);
router.post("/orders/:id/materials", requirePermission("production:manage"), productionController.createProductionOrderMaterialHandler);
router.put("/order-materials/:id", requirePermission("production:manage"), productionController.updateProductionOrderMaterialHandler);
router.delete("/order-materials/:id", requirePermission("production:manage"), productionController.deleteProductionOrderMaterialHandler);
router.put("/orders/:id/exec-status", requirePermission("production:manage"), productionController.updateProductionOrderExecStatusHandler);
router.post("/orders/:id/report", requirePermission("production:report"), productionController.reportWorkHandler);
router.post("/batch-report", requirePermission("production:report"), productionController.batchReportHandler);
router.get("/orders/:id/route", requirePermission("production:view"), productionController.orderRouteHandler);
router.put("/orders/:id/route", requirePermission("production:manage"), productionController.updateOrderRouteHandler);
router.put("/orders/:id/route/steps", requirePermission("production:manage"), productionController.replaceOrderRouteStepsHandler);
router.post("/orders/:id/issue", requirePermission("stock:edit"), operationLog("stock", "issue"), productionController.issueProductionOrderMaterialsHandler);
router.post("/orders/:id/receive", requirePermission("stock:edit"), operationLog("stock", "receive"), productionController.receiveProductionOrderHandler);

// 导出（生产订单执行信息）
router.get("/export", requirePermission("production:view"), productionController.exportHandler);
// 员工报工报表导出
router.get("/employee-report-export", requirePermission("production:view"), productionController.employeeReportExportHandler);

// 报工记录
router.get("/reports", requirePermission("production:view"), productionController.listReportHandler);
router.get("/reporters", requirePermission("production:view"), productionController.listReporterHandler);
router.get("/work-report-stats", requirePermission("production:view"), productionController.workReportStatsHandler);

export default router;
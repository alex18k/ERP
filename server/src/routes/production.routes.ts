import { Router } from "express";
import * as productionController from "../controllers/production.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

// 生产订单
router.get("/orders", requirePermission("production:view"), productionController.listOrderHandler);
router.get("/planners", requirePermission("production:view"), productionController.plannersHandler);
router.get("/orders/issued-keys", requirePermission("production:view"), productionController.issuedKeysHandler);
router.post("/orders", requirePermission("production:manage"), productionController.createOrderHandler);
router.put("/orders/:id", requirePermission("production:manage"), productionController.updateOrderHandler);
router.put("/orders/:id/cancel", requirePermission("production:manage"), productionController.cancelOrderHandler);
router.post("/orders/:id/schedule", requirePermission("production:manage"), productionController.scheduleHandler);

// 加工单
router.get("/work-orders", requirePermission("production:view"), productionController.listWorkOrderHandler);
router.post("/work-orders/:workOrderId/report", requirePermission("production:report"), productionController.reportWorkHandler);

// 导出（加工单）
router.get("/export", requirePermission("production:view"), productionController.exportHandler);

// 报工记录
router.get("/reports", requirePermission("production:view"), productionController.listReportHandler);

// 车间状态与甘特图
router.get("/workshop", requirePermission("production:view"), productionController.workshopHandler);
router.get("/gantt", requirePermission("production:view"), productionController.ganttHandler);

export default router;
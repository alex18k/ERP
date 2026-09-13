import { Router } from "express";
import * as dashboardController from "../controllers/dashboard.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

router.get("/executive", requirePermission("dashboard:view"), dashboardController.executiveHandler);
router.get("/order-tracking", requirePermission("dashboard:view"), dashboardController.orderTrackingHandler);
router.get("/shortage-alert", requirePermission("dashboard:view"), dashboardController.shortageAlertHandler);
router.get("/workshop", requirePermission("dashboard:view"), dashboardController.workshopHandler);
router.get("/inventory", requirePermission("dashboard:view"), dashboardController.inventoryHandler);

export default router;
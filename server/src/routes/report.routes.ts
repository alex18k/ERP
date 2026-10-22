import { Router } from "express";
import * as reportController from "../controllers/report.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

router.get("/production", requirePermission("dashboard:view"), reportController.productionReportHandler);
router.get("/sales", requirePermission("dashboard:view"), reportController.salesReportHandler);
router.get("/purchase", requirePermission("dashboard:view"), reportController.purchaseReportHandler);
router.get("/inventory", requirePermission("dashboard:view"), reportController.inventoryReportHandler);

export default router;
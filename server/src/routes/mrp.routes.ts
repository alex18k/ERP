import { Router } from "express";
import * as mrpController from "../controllers/mrp.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

router.post("/calculate", requirePermission("mrp:run"), mrpController.calculateHandler);
router.get("/history", requirePermission("mrp:view"), mrpController.historyHandler);
router.get("/history/export", requirePermission("mrp:view"), mrpController.exportMrpHistoryHandler);
router.delete("/history", requirePermission("mrp:run"), mrpController.deleteMrpHistoryHandler);
router.get("/history/:id", requirePermission("mrp:view"), mrpController.getRunHandler);
router.get("/check", requirePermission("mrp:view"), mrpController.checkHandler);
router.get("/shortage", requirePermission("mrp:view"), mrpController.shortageHandler);
router.post("/suggestion/generate-purchase", requirePermission("purchase:create"), mrpController.generatePurchaseHandler);
router.post("/safety-stock-suggest", requirePermission("purchase:create"), mrpController.safetyStockHandler);

export default router;
import { Router } from "express";
import * as mrpController from "../controllers/mrp.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

router.post("/calculate", requirePermission("mrp:run"), mrpController.calculateHandler);
router.get("/history", requirePermission("mrp:view"), mrpController.historyHandler);
router.get("/history/:id", requirePermission("mrp:view"), mrpController.getRunHandler);
router.get("/shortage", requirePermission("mrp:view"), mrpController.shortageHandler);
router.post("/suggestion/generate-purchase", requirePermission("purchase:create"), mrpController.generatePurchaseHandler);

export default router;
import { Router } from "express";
import * as purchaseController from "../controllers/purchase.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

router.get("/arrival", requirePermission("purchase:view"), purchaseController.arrivalHandler);
router.get("/receipts", requirePermission("purchase:view"), purchaseController.receiptsHandler);
router.get("/buyers", requirePermission("purchase:view"), purchaseController.buyersHandler);
router.get("/options", requirePermission("purchase:view"), purchaseController.optionsHandler);
router.get("/export", requirePermission("purchase:view"), purchaseController.exportHandler);
router.get("/", requirePermission("purchase:view"), purchaseController.listHandler);
router.get("/:id", requirePermission("purchase:view"), purchaseController.getHandler);
router.post("/", requirePermission("purchase:create"), purchaseController.createHandler);
router.put("/:id", requirePermission("purchase:create"), purchaseController.updateHandler);
router.put("/:id/confirm", requirePermission("purchase:approve"), purchaseController.confirmHandler);
router.put("/:id/status", requirePermission("purchase:approve"), purchaseController.updateStatusHandler);
router.delete("/:id", requirePermission("purchase:delete"), purchaseController.deleteHandler);
router.put("/:id/receive", requirePermission("stock:edit"), purchaseController.receiveHandler);

export default router;
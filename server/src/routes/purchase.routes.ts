import { Router } from "express";
import * as purchaseController from "../controllers/purchase.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";
import { operationLog } from "../middleware/log";

const router = Router();

router.use(authMiddleware);

router.get("/arrival", requirePermission("purchase:view"), purchaseController.arrivalHandler);
router.get("/receipts", requirePermission("purchase:view"), purchaseController.receiptsHandler);
router.get("/receipt-keepers", requirePermission("purchase:view"), purchaseController.keepersHandler);
router.post("/receipts/:id/return", requirePermission("stock:edit"), operationLog("purchase", "return"), purchaseController.returnReceiptHandler);
router.get("/receipt-documents", requirePermission("purchase:view"), purchaseController.receiptDocumentsHandler);
router.post("/receipt-documents/:documentNo/return", requirePermission("stock:edit"), operationLog("purchase", "return"), purchaseController.returnReceiptDocHandler);
router.get("/buyers", requirePermission("purchase:view"), purchaseController.buyersHandler);
router.get("/options", requirePermission("purchase:view"), purchaseController.optionsHandler);
router.get("/export", requirePermission("purchase:view"), purchaseController.exportHandler);
router.get("/", requirePermission("purchase:view"), purchaseController.listHandler);
router.get("/:id", requirePermission("purchase:view"), purchaseController.getHandler);
router.post("/", requirePermission("purchase:create"), operationLog("purchase", "create"), purchaseController.createHandler);
router.put("/:id", requirePermission("purchase:edit"), operationLog("purchase", "update"), purchaseController.updateHandler);
router.put("/:id/confirm", requirePermission("purchase:approve"), operationLog("purchase", "confirm"), purchaseController.confirmHandler);
router.put("/:id/status", requirePermission("purchase:approve"), operationLog("purchase", "status"), purchaseController.updateStatusHandler);
router.delete("/:id", requirePermission("purchase:delete"), operationLog("purchase", "delete"), purchaseController.deleteHandler);
router.put("/:id/receive", requirePermission("stock:edit"), operationLog("purchase", "receive"), purchaseController.receiveHandler);

export default router;
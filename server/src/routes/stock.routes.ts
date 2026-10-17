import { Router } from "express";
import * as stockController from "../controllers/stock.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";
import { operationLog } from "../middleware/log";

const router = Router();

router.use(authMiddleware);

router.get("/alert", requirePermission("stock:view"), stockController.alertHandler);
router.get("/export", requirePermission("stock:view"), stockController.exportHandler);
router.get("/zero-stock", requirePermission("stock:view"), stockController.zeroStockHandler);
router.get("/", requirePermission("stock:view"), stockController.listHandler);
router.get("/detail", requirePermission("stock:view"), stockController.detailHandler);
router.get("/summary", requirePermission("stock:view"), stockController.summaryHandler);
router.get("/records", requirePermission("stock:view"), stockController.recordsHandler);
router.get("/batches", requirePermission("stock:view"), stockController.batchesHandler);
router.post("/in", requirePermission("stock:edit"), operationLog("stock", "in"), stockController.inHandler);
router.post("/out", requirePermission("stock:edit"), operationLog("stock", "out"), stockController.outHandler);
router.post("/transfer", requirePermission("stock:edit"), operationLog("stock", "transfer"), stockController.transferHandler);
router.post("/clear-zero", requirePermission("stock:edit"), operationLog("stock", "clear_zero"), stockController.clearZeroStockHandler);

export default router;
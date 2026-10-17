import { Router } from "express";
import * as stockController from "../controllers/stock.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

router.get("/alert", requirePermission("stock:view"), stockController.alertHandler);
router.get("/export", requirePermission("stock:view"), stockController.exportHandler);
router.get("/zero-stock", requirePermission("stock:view"), stockController.zeroStockHandler);
router.get("/", requirePermission("stock:view"), stockController.listHandler);
router.get("/records", requirePermission("stock:view"), stockController.recordsHandler);
router.get("/batches", requirePermission("stock:view"), stockController.batchesHandler);
router.post("/in", requirePermission("stock:edit"), stockController.inHandler);
router.post("/out", requirePermission("stock:edit"), stockController.outHandler);
router.post("/transfer", requirePermission("stock:edit"), stockController.transferHandler);
router.post("/clear-zero", requirePermission("stock:edit"), stockController.clearZeroStockHandler);

export default router;
import { Router } from "express";
import * as orderController from "../controllers/salesOrder.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";
import { operationLog } from "../middleware/log";

const router = Router();

router.use(authMiddleware);

router.get("/shippable", requirePermission("order:view"), orderController.shippableHandler);
router.get("/overdue", requirePermission("order:view"), orderController.overdueHandler);
router.get("/export", requirePermission("order:view"), orderController.exportHandler);
router.get("/options", requirePermission("order:view"), orderController.optionsHandler);
router.get("/shipments", requirePermission("order:view"), orderController.shipmentsHandler);
router.get("/:id/downstream", requirePermission("order:view"), orderController.downstreamHandler);
router.get("/", requirePermission("order:view"), orderController.listHandler);
router.get("/:id/track", requirePermission("order:view"), orderController.trackHandler);
router.get("/:id", requirePermission("order:view"), orderController.getHandler);
router.post("/", requirePermission("order:create"), orderController.createHandler);
router.put("/:id", requirePermission("order:edit"), orderController.updateHandler);
router.put("/:id/confirm", requirePermission("order:confirm"), orderController.confirmHandler);
router.put("/:id/cancel", requirePermission("order:edit"), orderController.cancelHandler);
router.delete("/:id", requirePermission("order:edit"), operationLog("sales-order", "delete"), orderController.deleteHandler);
router.put("/:id/ship", requirePermission("order:ship"), operationLog("stock", "ship"), orderController.shipHandler);
router.put("/:id/shipping", requirePermission("order:ship"), operationLog("stock", "shipping"), orderController.shippingHandler);

export default router;
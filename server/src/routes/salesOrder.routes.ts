import { Router } from "express";
import * as orderController from "../controllers/salesOrder.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

router.get("/overdue", requirePermission("order:view"), orderController.overdueHandler);
router.get("/export", requirePermission("order:view"), orderController.exportHandler);
router.get("/:id/downstream", requirePermission("order:view"), orderController.downstreamHandler);
router.get("/", requirePermission("order:view"), orderController.listHandler);
router.get("/:id/track", requirePermission("order:view"), orderController.trackHandler);
router.get("/:id", requirePermission("order:view"), orderController.getHandler);
router.post("/", requirePermission("order:create"), orderController.createHandler);
router.put("/:id", requirePermission("order:edit"), orderController.updateHandler);
router.put("/:id/confirm", requirePermission("order:confirm"), orderController.confirmHandler);
router.put("/:id/cancel", requirePermission("order:edit"), orderController.cancelHandler);
router.put("/:id/ship", requirePermission("order:ship"), orderController.shipHandler);

export default router;
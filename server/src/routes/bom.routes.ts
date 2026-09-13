import { Router } from "express";
import * as bomController from "../controllers/bom.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

router.get("/", requirePermission("bom:view"), bomController.listHandler);
router.get("/product-options", requirePermission("bom:view"), bomController.productOptionsHandler);
router.get("/:id", requirePermission("bom:view"), bomController.getHandler);
router.get("/:id/tree", requirePermission("bom:view"), bomController.treeHandler);
router.post("/", requirePermission("bom:edit"), bomController.createHandler);
router.put("/:id", requirePermission("bom:edit"), bomController.updateHandler);
router.put("/:id/activate", requirePermission("bom:edit"), bomController.activateHandler);
router.delete("/:id", requirePermission("bom:edit"), bomController.deleteHandler);
router.post("/batch-delete", requirePermission("bom:edit"), bomController.batchDeleteHandler);

export default router;
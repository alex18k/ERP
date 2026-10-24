import { Router } from "express";
import * as materialController from "../controllers/material.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

router.get("/", requirePermission("material:view"), materialController.listHandler);
router.get("/export", requirePermission("material:view"), materialController.exportHandler);
router.get("/types", requirePermission("material:view"), materialController.typeHandler);
router.get("/units", requirePermission("material:view"), materialController.unitHandler);
router.get("/options", requirePermission("material:view"), materialController.optionHandler);
router.get("/:id", requirePermission("material:view"), materialController.getHandler);
router.post("/", requirePermission("material:create"), materialController.createHandler);
router.post("/recalc-cost", requirePermission("material:edit"), materialController.recalcCostHandler);
router.put("/:id", requirePermission("material:edit"), materialController.updateHandler);
router.delete("/:id", requirePermission("material:delete"), materialController.deleteHandler);
router.post("/import", requirePermission("material:create"), materialController.importHandler);

export default router;
import { Router } from "express";
import * as routeController from "../controllers/processRoute.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

router.get("/", requirePermission("material:view"), routeController.listHandler);
router.get("/:id", requirePermission("material:view"), routeController.getHandler);
router.post("/", requirePermission("bom:edit"), routeController.createHandler);
router.put("/:id", requirePermission("bom:edit"), routeController.updateHandler);
router.delete("/:id", requirePermission("bom:edit"), routeController.deleteHandler);

export default router;
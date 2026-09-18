import { Router } from "express";
import * as systemController from "../controllers/system.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

// 用户管理
router.get("/users", requirePermission("user:manage"), systemController.listUserHandler);
router.post("/users", requirePermission("user:manage"), systemController.createUserHandler);
router.put("/users/:id", requirePermission("user:manage"), systemController.updateUserHandler);
router.delete("/users/:id", requirePermission("user:manage"), systemController.deleteUserHandler);

// 销售员下拉选项（供销售订单使用，需订单查看权限）
router.get("/salespersons", requirePermission("order:view"), systemController.listSalespersonHandler);

// 角色管理
router.get("/roles", requirePermission("role:manage"), systemController.listRoleHandler);
router.post("/roles", requirePermission("role:manage"), systemController.createRoleHandler);
router.put("/roles/:id", requirePermission("role:manage"), systemController.updateRoleHandler);
router.delete("/roles/:id", requirePermission("role:manage"), systemController.deleteRoleHandler);

// 权限
router.get("/permissions", requirePermission("role:manage"), systemController.listPermissionHandler);

// 部门
router.get("/departments", systemController.listDepartmentHandler);

// 操作日志
router.get("/logs", requirePermission("user:manage"), systemController.listLogHandler);

export default router;
import { Router } from "express";
import { supplierController, warehouseController, customerController, workshopController, workstationController, stockTransactionTypeController } from "../controllers/base.controller";
import { authMiddleware, requirePermission } from "../middleware/auth";

function crudRoutes(controller: any, perm: string, forbidGet?: boolean) {
  const router = Router();
  router.use(authMiddleware);
  router.get("/", requirePermission(`${perm}:view`), controller.list);
  router.get("/:id", requirePermission(`${perm}:view`), controller.get);
  router.post("/", requirePermission(`${perm}:create`), controller.create);
  router.put("/:id", requirePermission(`${perm}:edit`), controller.update);
  router.delete("/:id", requirePermission(`${perm}:delete`), controller.remove);
  return router;
}

export const supplierRoutes = crudRoutes(supplierController, "purchase");
export const customerRoutes = crudRoutes(customerController, "order");
export const warehouseRoutes = crudRoutes(warehouseController, "stock");

export const workshopRoutes = Router();
workshopRoutes.use(authMiddleware);
workshopRoutes.get("/", requirePermission("production:view"), workshopController.list);
workshopRoutes.get("/:id", requirePermission("production:view"), workshopController.get);
workshopRoutes.post("/", requirePermission("production:manage"), workshopController.create);
workshopRoutes.put("/:id", requirePermission("production:manage"), workshopController.update);
workshopRoutes.delete("/:id", requirePermission("production:manage"), workshopController.remove);

export const workstationRoutes = Router();
workstationRoutes.use(authMiddleware);
workstationRoutes.get("/", requirePermission("production:view"), workstationController.list);
workstationRoutes.post("/", requirePermission("production:manage"), workstationController.create);
workstationRoutes.put("/:id", requirePermission("production:manage"), workstationController.update);
workstationRoutes.delete("/:id", requirePermission("production:manage"), workstationController.remove);

export const stockTransactionTypeRoutes = Router();
stockTransactionTypeRoutes.use(authMiddleware);
stockTransactionTypeRoutes.get("/", requirePermission("stock:view"), stockTransactionTypeController.list);
stockTransactionTypeRoutes.get("/:id", requirePermission("stock:view"), stockTransactionTypeController.get);
stockTransactionTypeRoutes.post("/", requirePermission("stock:edit"), stockTransactionTypeController.create);
stockTransactionTypeRoutes.put("/:id", requirePermission("stock:edit"), stockTransactionTypeController.update);
stockTransactionTypeRoutes.delete("/:id", requirePermission("stock:edit"), stockTransactionTypeController.remove);
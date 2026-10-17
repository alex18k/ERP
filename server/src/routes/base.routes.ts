import { Router } from "express";
import { supplierController, warehouseController, warehouseBinController, customerController, workshopController, workstationController, stockTransactionTypeController, unitConversionController, materialCategoryController } from "../controllers/base.controller";
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

// 货位（仓库下的存放位置）：查看 stock:view，维护 stock:edit
export const warehouseBinRoutes = Router();
warehouseBinRoutes.use(authMiddleware);
warehouseBinRoutes.get("/", requirePermission("stock:view"), warehouseBinController.list);
warehouseBinRoutes.get("/:id", requirePermission("stock:view"), warehouseBinController.get);
warehouseBinRoutes.post("/", requirePermission("stock:edit"), warehouseBinController.create);
warehouseBinRoutes.put("/:id", requirePermission("stock:edit"), warehouseBinController.update);
warehouseBinRoutes.delete("/:id", requirePermission("stock:edit"), warehouseBinController.remove);

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

export const unitConversionRoutes = Router();
unitConversionRoutes.use(authMiddleware);
unitConversionRoutes.get("/", requirePermission("material:view"), unitConversionController.list);
unitConversionRoutes.get("/:id", requirePermission("material:view"), unitConversionController.get);
unitConversionRoutes.post("/", requirePermission("material:edit"), unitConversionController.create);
unitConversionRoutes.put("/:id", requirePermission("material:edit"), unitConversionController.update);
unitConversionRoutes.delete("/:id", requirePermission("material:edit"), unitConversionController.remove);

export const materialCategoryRoutes = Router();
materialCategoryRoutes.use(authMiddleware);
materialCategoryRoutes.get("/", requirePermission("material:view"), materialCategoryController.list);
materialCategoryRoutes.get("/:id", requirePermission("material:view"), materialCategoryController.get);
materialCategoryRoutes.post("/", requirePermission("material:edit"), materialCategoryController.create);
materialCategoryRoutes.put("/:id", requirePermission("material:edit"), materialCategoryController.update);
materialCategoryRoutes.delete("/:id", requirePermission("material:edit"), materialCategoryController.remove);
import { Request, Response } from "express";
import { supplierService, warehouseService, customerService, workshopService, workstationService, stockTransactionTypeService } from "../services/base.service";
import { success, fail } from "../utils/response";

function makeController(service: any) {
  return {
    list: async (req: Request, res: Response) => {
      try {
        const data = service.list ? await service.list(req.query as any) : null;
        return success(res, data);
      } catch (error: any) {
        return fail(res, 500, error.message, 500);
      }
    },
    get: async (req: Request, res: Response) => {
      try {
        const data = await service.get(Number(req.params.id));
        if (!data) return fail(res, 404, "资源不存在", 404);
        return success(res, data);
      } catch (error: any) {
        return fail(res, 500, error.message, 500);
      }
    },
    create: async (req: Request, res: Response) => {
      try {
        const data = await service.create(req.body);
        return success(res, data, "创建成功");
      } catch (error: any) {
        return fail(res, 400, error.message);
      }
    },
    update: async (req: Request, res: Response) => {
      try {
        const data = await service.update(Number(req.params.id), req.body);
        return success(res, data, "更新成功");
      } catch (error: any) {
        return fail(res, 400, error.message);
      }
    },
    remove: async (req: Request, res: Response) => {
      try {
        await service.remove(Number(req.params.id));
        return success(res, null, "删除成功");
      } catch (error: any) {
        return fail(res, 400, error.message);
      }
    },
  };
}

export const supplierController = makeController(supplierService);
export const warehouseController = makeController(warehouseService);
export const customerController = makeController(customerService);
export const workshopController = makeController(workshopService);
export const stockTransactionTypeController = makeController(stockTransactionTypeService);

const workstationControllerRaw = makeController(workstationService);
export const workstationController = {
  ...workstationControllerRaw,
  list: async (req: Request, res: Response) => {
    try {
      const data = await workstationService.list(req.query.workshopId as any);
      return success(res, data);
    } catch (error: any) {
      return fail(res, 500, error.message, 500);
    }
  },
};
import { Request, Response } from "express";
import * as purchaseService from "../services/purchase.service";
import * as exportService from "../services/export.service";
import { success, fail } from "../utils/response";
import { AuthRequest } from "../middleware/auth";
import { sendCsv } from "../utils/export";

export async function exportHandler(_req: Request, res: Response) {
  try {
    const { filename, csv } = await exportService.purchaseExport();
    return sendCsv(res, filename, csv);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function listHandler(req: Request, res: Response) {
  try {
    const data = await purchaseService.listPurchaseOrders(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}
export async function optionsHandler(req: Request, res: Response) {
  try {
    const data = await purchaseService.listPurchaseOrderOptions(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}
export async function receiptsHandler(req: Request, res: Response) {
  try {
    const data = await purchaseService.listPurchaseReceipts(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function getHandler(req: Request, res: Response) {
  try {
    const data = await purchaseService.getPurchaseOrder(Number(req.params.id));
    if (!data) return fail(res, 404, "采购单不存在", 404);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function createHandler(req: AuthRequest, res: Response) {
  try {
    const data = await purchaseService.createPurchaseOrder(req.body, req.user!.id);
    return success(res, data, "创建成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function updateHandler(req: Request, res: Response) {
  try {
    const data = await purchaseService.updatePurchaseOrder(Number(req.params.id), req.body);
    return success(res, data, "更新成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function confirmHandler(req: Request, res: Response) {
  try {
    const data = await purchaseService.confirmPurchaseOrder(Number(req.params.id));
    return success(res, data, "采购单已确认");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function updateStatusHandler(req: Request, res: Response) {
  try {
    const data = await purchaseService.updatePurchaseOrderStatus(Number(req.params.id), req.body?.status);
    return success(res, data, "状态已更新");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function deleteHandler(req: Request, res: Response) {
  try {
    const data = await purchaseService.deletePurchaseOrder(Number(req.params.id));
    return success(res, data, "采购单已删除");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function receiveHandler(req: AuthRequest, res: Response) {
  try {
    const items = req.body?.items;
    const data = await purchaseService.receivePurchaseOrder(
      Number(req.params.id),
      req.user!.id,
      Array.isArray(items) ? items : undefined,
      { effectiveDate: req.body?.effectiveDate, location: req.body?.location }
    );
    return success(res, data, "收货完成");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function arrivalHandler(req: Request, res: Response) {
  try {
    const data = await purchaseService.getArrivalTracking();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}
export async function buyersHandler(_req: Request, res: Response) {
  try {
    const data = await purchaseService.listBuyers();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

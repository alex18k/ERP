import { Request, Response } from "express";
import * as orderService from "../services/salesOrder.service";
import * as exportService from "../services/export.service";
import { success, fail } from "../utils/response";
import { AuthRequest } from "../middleware/auth";
import { sendCsv } from "../utils/export";

export async function exportHandler(_req: Request, res: Response) {
  try {
    const { filename, csv } = await exportService.orderExport();
    return sendCsv(res, filename, csv);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function shipHandler(req: AuthRequest, res: Response) {
  try {
    const data = await orderService.shipOrder(Number(req.params.id), req.user!.id);
    return success(res, data, "已发货");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function shippableHandler(req: Request, res: Response) {
  try {
    const data = await orderService.listShippableOrders(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function shippingHandler(req: AuthRequest, res: Response) {
  try {
    const data = await orderService.shipOrderItems(Number(req.params.id), req.user!.id, req.body);
    return success(res, data, "发运完成");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function listHandler(req: Request, res: Response) {
  try {
    const data = await orderService.listOrders(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function optionsHandler(req: Request, res: Response) {
  try {
    const data = await orderService.listSalesOrderOptions(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function getHandler(req: Request, res: Response) {
  try {
    const data = await orderService.getOrder(Number(req.params.id));
    if (!data) return fail(res, 404, "订单不存在", 404);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function createHandler(req: AuthRequest, res: Response) {
  try {
    const data = await orderService.createOrder(req.body, req.user!.id);
    return success(res, data, "创建成功，订单已确认");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function updateHandler(req: Request, res: Response) {
  try {
    const data = await orderService.updateOrder(Number(req.params.id), req.body);
    return success(res, data, "更新成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function confirmHandler(req: Request, res: Response) {
  try {
    const data = await orderService.confirmOrder(Number(req.params.id));
    return success(res, data, "订单已确认");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function cancelHandler(req: Request, res: Response) {
  try {
    const data = await orderService.cancelOrder(Number(req.params.id), {
      cancelProduction: Boolean(req.body?.cancelProduction),
    });
    return success(res, data, "订单已取消");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function downstreamHandler(req: Request, res: Response) {
  try {
    const data = await orderService.getDownstreamInfo(Number(req.params.id));
    return success(res, data);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function trackHandler(req: Request, res: Response) {
  try {
    const data = await orderService.getOrderTrack(Number(req.params.id));
    return success(res, data);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function overdueHandler(req: Request, res: Response) {
  try {
    const data = await orderService.listOverdueOrders();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}
export async function shipmentsHandler(req: Request, res: Response) {
  try {
    const data = await orderService.listSalesShipments(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

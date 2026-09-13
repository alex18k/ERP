import { Request, Response } from "express";
import * as productionService from "../services/production.service";
import * as exportService from "../services/export.service";
import { success, fail } from "../utils/response";
import { AuthRequest } from "../middleware/auth";
import { sendCsv } from "../utils/export";

export async function exportHandler(_req: Request, res: Response) {
  try {
    const { filename, csv } = await exportService.workOrderExport();
    return sendCsv(res, filename, csv);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function listOrderHandler(req: Request, res: Response) {
  try {
    const data = await productionService.listProductionOrders(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function createOrderHandler(req: AuthRequest, res: Response) {
  try {
    const { created, skipped } = await productionService.createProductionOrders(req.body, req.user!.id);
    const msg = skipped.length > 0
      ? `已创建 ${created.length} 张生产订单，跳过 ${skipped.length} 张（已下达）`
      : `已创建 ${created.length} 张生产订单`;
    return success(res, { created, skipped }, msg);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function issuedKeysHandler(_req: Request, res: Response) {
  try {
    const data = await productionService.listIssuedProductionKeys();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function plannersHandler(_req: Request, res: Response) {
  try {
    const data = await productionService.listPlanners();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function updateOrderHandler(req: Request, res: Response) {
  try {
    const data = await productionService.updateProductionOrder(Number(req.params.id), req.body);
    return success(res, data, "更新成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function cancelOrderHandler(req: Request, res: Response) {
  try {
    const data = await productionService.cancelProductionOrder(Number(req.params.id));
    return success(res, data, "生产订单已取消");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function scheduleHandler(req: AuthRequest, res: Response) {
  try {
    const data = await productionService.scheduleProduction(Number(req.params.id), req.user!.id);
    return success(res, data, "排产完成");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function reportWorkHandler(req: AuthRequest, res: Response) {
  try {
    const data = await productionService.reportWork(Number(req.params.workOrderId), req.body, req.user!.id);
    return success(res, data, "报工成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function workshopHandler(req: Request, res: Response) {
  try {
    const data = await productionService.getWorkshopStatus(req.query.workshopId as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function ganttHandler(req: Request, res: Response) {
  try {
    const data = await productionService.getGanttData(req.query.startDate as any, req.query.endDate as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function listWorkOrderHandler(req: Request, res: Response) {
  try {
    const data = await productionService.listWorkOrders(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function listReportHandler(req: Request, res: Response) {
  try {
    const data = await productionService.listWorkReports(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}
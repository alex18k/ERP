import { Request, Response } from "express";
import * as productionService from "../services/production.service";
import * as exportService from "../services/export.service";
import { success, fail } from "../utils/response";
import { AuthRequest } from "../middleware/auth";
import { sendCsv } from "../utils/export";

export async function exportHandler(_req: Request, res: Response) {
  try {
    const { filename, csv } = await exportService.batchExport();
    return sendCsv(res, filename, csv);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function employeeReportExportHandler(req: Request, res: Response) {
  try {
    const { filename, csv } = await exportService.employeeReportExport(req.query as any);
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

export async function employeesHandler(req: Request, res: Response) {
  try {
    const data = await productionService.listEmployees((req.query.keyword as string) || undefined);
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
    const batches = Array.isArray(req.body?.batches) ? req.body.batches : undefined;
    const data = await productionService.scheduleProduction(Number(req.params.id), req.user!.id, batches, req.body?.planner);
    return success(res, data, "排产完成");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function reportBatchHandler(req: AuthRequest, res: Response) {
  try {
    const data = await productionService.reportBatch(Number(req.params.id), req.body, req.user!.id);
    return success(res, data, "报工成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function batchReportHandler(req: AuthRequest, res: Response) {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const data = await productionService.batchReportWork(Number(req.body?.productionOrderId), items, req.user!.id);
    return success(res, data, "报工成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function listReporterHandler(_req: Request, res: Response) {
  try {
    const data = await productionService.listReporters();
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

export async function workReportStatsHandler(req: Request, res: Response) {
  try {
    const data = await productionService.getWorkReportStats(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}
// ===== 批次物料清单 / 领料 / 入库 =====
export async function orderRouteHandler(req: Request, res: Response) {
  try {
    const data = await productionService.getProductionOrderRoute(Number(req.params.id));
    return success(res, data);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function updateOrderRouteHandler(req: Request, res: Response) {
  try {
    const data = await productionService.updateOrderRoute(Number(req.params.id), req.body);
    return success(res, data, "工艺路线已更新");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function replaceOrderRouteStepsHandler(req: Request, res: Response) {
  try {
    const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
    const data = await productionService.replaceOrderRouteSteps(Number(req.params.id), steps);
    return success(res, data, "工序已更新");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function batchMaterialsHandler(req: Request, res: Response) {
  try {
    const data = await productionService.listBatchMaterials(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function issueBatchMaterialsHandler(req: AuthRequest, res: Response) {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const data = await productionService.issueBatchMaterials(
      Number(req.params.id),
      Number(req.body?.warehouseId),
      items,
      req.user!.id,
      req.body?.effectiveDate
    );
    return success(res, data, "发料完成");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function batchMaterialsDetailHandler(req: Request, res: Response) {
  try {
    const data = await productionService.getBatchMaterials(Number(req.params.id));
    return success(res, data);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function createBatchMaterialHandler(req: AuthRequest, res: Response) {
  try {
    const data = await productionService.createBatchMaterial(Number(req.params.id), req.body);
    return success(res, data, "物料行已添加");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function updateBatchMaterialHandler(req: Request, res: Response) {
  try {
    const data = await productionService.updateBatchMaterial(Number(req.params.id), req.body);
    return success(res, data, "物料行已更新");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function deleteBatchMaterialHandler(req: Request, res: Response) {
  try {
    const data = await productionService.deleteBatchMaterial(Number(req.params.id));
    return success(res, data, "物料行已删除");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function receivableBatchesHandler(req: Request, res: Response) {
  try {
    const data = await productionService.listReceivableBatches(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function receiveBatchHandler(req: AuthRequest, res: Response) {
  try {
    const { quantity, warehouseId, batchNo, unit, binId } = req.body || {};
    const data = await productionService.receiveBatchProduct(
      Number(req.params.id),
      Number(quantity),
      Number(warehouseId),
      req.user!.id,
      batchNo,
      unit,
      binId
    );
    return success(res, data, "生产入库成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

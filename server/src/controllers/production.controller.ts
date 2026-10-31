import { Request, Response } from "express";
import * as productionService from "../services/production.service";
import * as exportService from "../services/export.service";
import { success, fail } from "../utils/response";
import { AuthRequest } from "../middleware/auth";
import { sendCsv } from "../utils/export";

export async function exportHandler(_req: Request, res: Response) {
  try {
    const { filename, csv } = await exportService.productionOrderExport();
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

export async function closeOrderHandler(req: Request, res: Response) {
  try {
    const data = await productionService.closeProductionOrder(Number(req.params.id));
    return success(res, data, "生产订单已关闭");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function deleteOrderHandler(req: Request, res: Response) {
  try {
    const data = await productionService.deleteProductionOrder(Number(req.params.id));
    return success(res, data, "生产订单已删除");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

// 手工调整生产订单状态（标记完成 / 改回生产中）
export async function updateStatusHandler(req: AuthRequest, res: Response) {
  try {
    const data = await productionService.updateProductionOrderStatus(Number(req.params.id), String(req.body?.status || ""));
    return success(res, data, "状态已更新");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function scheduleHandler(req: AuthRequest, res: Response) {
  try {
    const data = await productionService.scheduleProduction(Number(req.params.id), req.user!.id, req.body?.planner);
    return success(res, data, "排产完成");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

// 批量排产候选：planned/in_progress、已下达且未排满的生产订单（供批量排产弹窗勾选）
export async function schedulableOrdersHandler(_req: Request, res: Response) {
  try {
    const data = await productionService.listSchedulableOrders();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

// 直接指定执行状态
export async function updateProductionOrderExecStatusHandler(req: AuthRequest, res: Response) {
  try {
    const data = await productionService.updateProductionOrderExecStatus(
      Number(req.params.id),
      String(req.body?.execStatus || req.body?.status || "")
    );
    return success(res, data, "执行状态已更新");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

// 执行状态关闭 / 重新打开
// 批量排产：逐单独立事务，返回成功/失败明细
export async function batchScheduleHandler(req: AuthRequest, res: Response) {
  try {
    const data = await productionService.batchScheduleProduction(req.user!.id, req.body);
    return success(res, data, "批量排产完成");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function reportWorkHandler(req: AuthRequest, res: Response) {
  try {
    const data = await productionService.reportWork(Number(req.params.id), req.body, req.user!.id);
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
// ===== 生产订单领料单 / 领料 / 入库 =====
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

export async function productionOrderMaterialsHandler(req: Request, res: Response) {
  try {
    const data = await productionService.listProductionOrderMaterials(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function issueProductionOrderMaterialsHandler(req: AuthRequest, res: Response) {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const data = await productionService.issueProductionOrderMaterials(
      Number(req.params.id),
      req.body?.warehouseId ? Number(req.body.warehouseId) : null,
      items,
      req.user!.id,
      req.body?.effectiveDate,
      Array.isArray(req.body?.cancelRemainMaterialIds) ? req.body.cancelRemainMaterialIds : undefined
    );
    return success(res, data, data.cancelled.length ? "已取消未发" : "领料完成");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function productionOrderMaterialsDetailHandler(req: Request, res: Response) {
  try {
    const data = await productionService.getProductionOrderMaterials(Number(req.params.id));
    return success(res, data);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function createProductionOrderMaterialHandler(req: AuthRequest, res: Response) {
  try {
    const data = await productionService.createProductionOrderMaterial(Number(req.params.id), req.body);
    return success(res, data, "物料行已添加");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function updateProductionOrderMaterialHandler(req: Request, res: Response) {
  try {
    const data = await productionService.updateProductionOrderMaterial(Number(req.params.id), req.body);
    return success(res, data, "物料行已更新");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function deleteProductionOrderMaterialHandler(req: Request, res: Response) {
  try {
    const data = await productionService.deleteProductionOrderMaterial(Number(req.params.id));
    return success(res, data, "物料行已删除");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function receivableProductionOrdersHandler(req: Request, res: Response) {
  try {
    const data = await productionService.listReceivableProductionOrders(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function receiveProductionOrderHandler(req: AuthRequest, res: Response) {
  try {
    const { quantity, warehouseId, batchNo, unit, binId, closeWorkOrder, effectiveDate, handler, keeper } = req.body || {};
    const data = await productionService.receiveProductionOrderProduct(
      Number(req.params.id),
      Number(quantity),
      Number(warehouseId),
      req.user!.id,
      batchNo,
      unit,
      binId,
      closeWorkOrder === true,
      effectiveDate,
      handler,
      keeper
    );
    return success(res, data, "生产入库/退库成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

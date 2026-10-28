import { Request, Response } from "express";
import { startMrp, listMrpHistory, getMrpRun, listShortages, generatePurchaseOrders, createSafetyStockSuggestions, exportMrpHistory, deleteMrpHistory, getMrpCheck } from "../services/mrp.service";
import { success, fail } from "../utils/response";
import { sendCsv } from "../utils/export";
import { AuthRequest } from "../middleware/auth";

export async function calculateHandler(req: AuthRequest, res: Response) {
  try {
    const data = await startMrp(req.body || {}, req.user?.id);
    return success(res, data, "MRP运算已提交，正在后台执行");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function historyHandler(req: Request, res: Response) {
  try {
    const data = await listMrpHistory(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function getRunHandler(req: Request, res: Response) {
  try {
    const data = await getMrpRun(Number(req.params.id));
    return success(res, data);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

// MRP历史：存档导出CSV / 按日期范围删除
export async function exportMrpHistoryHandler(req: Request, res: Response) {
  try {
    const csv = await exportMrpHistory(req.query.from as string, req.query.to as string);
    return sendCsv(res, `MRP运算历史_${req.query.from || ""}_${req.query.to || ""}.csv`, csv);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function deleteMrpHistoryHandler(req: Request, res: Response) {
  try {
    const data = await deleteMrpHistory(req.query.from as string, req.query.to as string);
    return success(res, data, `已删除 ${data.deletedRuns} 条MRP运算历史`);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function checkHandler(req: Request, res: Response) {
  try {
    const data = await getMrpCheck(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function shortageHandler(req: Request, res: Response) {
  try {
    const data = await listShortages();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function generatePurchaseHandler(req: AuthRequest, res: Response) {
  try {
    const { suggestionIds, supplierOverrides } = req.body || {};
    const data = await generatePurchaseOrders(
      req.user!.id,
      Array.isArray(suggestionIds) ? suggestionIds : undefined,
      supplierOverrides && typeof supplierOverrides === "object" ? supplierOverrides : undefined
    );
    const noSupplier = data.orders.filter((o) => o.supplierId == null).length;
    const msg = noSupplier > 0
      ? `已生成 ${data.orders.length} 张采购单（其中 ${noSupplier} 张未指定供应商）`
      : `已生成 ${data.orders.length} 张采购单`;
    return success(res, data, msg);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}
export async function safetyStockHandler(_req: AuthRequest, res: Response) {
  try {
    const data = await createSafetyStockSuggestions();
    const msg = data.skipped.length > 0
      ? `已生成 ${data.created.length} 条采购建议，跳过 ${data.skipped.length} 条（已有建议）`
      : `已生成 ${data.created.length} 条采购建议`;
    return success(res, data, msg);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

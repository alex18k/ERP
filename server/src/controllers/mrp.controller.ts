import { Request, Response } from "express";
import { runMrp, listMrpHistory, getMrpRun, listShortages, generatePurchaseOrders, createSafetyStockSuggestions } from "../services/mrp.service";
import { success, fail } from "../utils/response";
import { AuthRequest } from "../middleware/auth";

export async function calculateHandler(req: AuthRequest, res: Response) {
  try {
    const data = await runMrp(req.body || {}, req.user?.id);
    return success(res, data, "MRP运算完成");
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

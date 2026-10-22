import { Request, Response } from "express";
import * as stockService from "../services/stock.service";
import * as exportService from "../services/export.service";
import { success, fail } from "../utils/response";
import { isQueryConditionError } from "../utils/queryConditions";
import { AuthRequest } from "../middleware/auth";
import { sendCsv } from "../utils/export";

// 业务异常直接返回可读信息；Prisma 等数据库异常不把内部表名/约束/SQL 细节暴露给前端
function publicError(error: any): string {
  const code = error?.code;
  if (typeof code === "string" && code.startsWith("P")) {
    return "数据库操作失败，请检查输入数据后重试";
  }
  return error?.message || "操作失败";
}

export async function exportHandler(req: Request, res: Response) {
  try {
    const { filename, csv } = await exportService.stockExport(req.query as any);
    return sendCsv(res, filename, csv);
  } catch (error: any) {
    return fail(res, 500, publicError(error), 500);
  }
}

export async function listHandler(req: Request, res: Response) {
  try {
    const data = await stockService.listStocks(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, publicError(error), 500);
  }
}

export async function detailHandler(req: Request, res: Response) {
  try {
    const data = await stockService.listStockDetail(req.query as any);
    return success(res, data);
  } catch (error: any) {
    if (isQueryConditionError(error)) {
      return fail(res, 400, publicError(error));
    }
    return fail(res, 500, publicError(error), 500);
  }
}

export async function summaryHandler(req: Request, res: Response) {
  try {
    const data = await stockService.listStockSummary(req.query as any);
    return success(res, data);
  } catch (error: any) {
    if (isQueryConditionError(error)) {
      return fail(res, 400, publicError(error));
    }
    return fail(res, 500, publicError(error), 500);
  }
}

export async function psiReportHandler(req: Request, res: Response) {
  try {
    const data = await stockService.listPsiReport(req.query as any);
    return success(res, data);
  } catch (error: any) {
    if (isQueryConditionError(error)) {
      return fail(res, 400, publicError(error));
    }
    return fail(res, 500, publicError(error), 500);
  }
}

export async function psiReportExportHandler(req: Request, res: Response) {
  try {
    const { filename, csv } = await exportService.psiReportExport(req.query as any);
    return sendCsv(res, filename, csv);
  } catch (error: any) {
    if (isQueryConditionError(error)) {
      return fail(res, 400, publicError(error));
    }
    return fail(res, 500, publicError(error), 500);
  }
}

export async function recordsHandler(req: Request, res: Response) {
  try {
    const data = await stockService.listStockRecords(req.query as any);
    return success(res, data);
  } catch (error: any) {
    if (isQueryConditionError(error)) {
      return fail(res, 400, publicError(error));
    }
    return fail(res, 500, publicError(error), 500);
  }
}

export async function handlersHandler(req: Request, res: Response) {
  try {
    const data = await stockService.listStockHandlers(String(req.query.field || "handler"));
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, publicError(error), 500);
  }
}

export async function historyWorkshopsHandler(req: Request, res: Response) {
  try {
    const data = await stockService.listStockHistoryWorkshops();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, publicError(error), 500);
  }
}

export async function recordsByDocumentHandler(req: Request, res: Response) {
  try {
    const data = await stockService.listStockRecordsByDocument(String(req.query.documentNo ?? ""));
    return success(res, data);
  } catch (error: any) {
    return fail(res, 400, publicError(error));
  }
}

export async function recordsUpdateByDocumentHandler(req: Request, res: Response) {
  try {
    const documentNo = String(req.query.documentNo ?? req.body?.documentNo ?? "").trim();
    const data = await stockService.updateStockDocument(documentNo, req.body || {});
    return success(res, data, "保存成功");
  } catch (error: any) {
    return fail(res, 400, publicError(error));
  }
}

export async function batchesHandler(req: Request, res: Response) {
  try {
    const data = await stockService.listBatches(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, publicError(error), 500);
  }
}

export async function inHandler(req: AuthRequest, res: Response) {
  try {
    const data = await stockService.stockIn(req.body, req.user!.id);
    return success(res, data, "入库成功");
  } catch (error: any) {
    return fail(res, 400, publicError(error));
  }
}

export async function outHandler(req: AuthRequest, res: Response) {
  try {
    const data = await stockService.stockOut(req.body, req.user!.id);
    return success(res, data, "出库成功");
  } catch (error: any) {
    return fail(res, 400, publicError(error));
  }
}

export async function inBatchHandler(req: AuthRequest, res: Response) {
  try {
    const data = await stockService.stockInBatch(req.body, req.user!.id);
    return success(res, data, "入库成功");
  } catch (error: any) {
    return fail(res, 400, publicError(error));
  }
}

export async function outBatchHandler(req: AuthRequest, res: Response) {
  try {
    const data = await stockService.stockOutBatch(req.body, req.user!.id);
    return success(res, data, "出库成功");
  } catch (error: any) {
    return fail(res, 400, publicError(error));
  }
}

export async function transferHandler(req: AuthRequest, res: Response) {
  try {
    const data = await stockService.transferStock(req.body, req.user!.id);
    return success(res, data, "移库成功");
  } catch (error: any) {
    return fail(res, 400, publicError(error));
  }
}

export async function zeroStockHandler(req: Request, res: Response) {
  try {
    const data = await stockService.listZeroStock(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, publicError(error), 500);
  }
}

export async function clearZeroStockHandler(req: Request, res: Response) {
  try {
    const data = await stockService.clearZeroStock(req.query as any);
    return success(res, data, `已清除 0 库存记录 ${data.deletedStock + data.deletedBatch} 条`);
  } catch (error: any) {
    return fail(res, 500, publicError(error), 500);
  }
}

export async function alertHandler(req: Request, res: Response) {
  try {
    const data = await stockService.getStockAlerts(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, publicError(error), 500);
  }
}
import { Request, Response } from "express";
import {
  ReportQuery,
  ReportQueryError,
  getProductionReport,
  getSalesReport,
  getPurchaseReport,
  getInventoryReport,
} from "../services/report.service";
import { success, fail } from "../utils/response";

// 参数校验错误返回 400 可读消息；Prisma 等内部错误不把表名/SQL/源码细节暴露给前端
function handleError(res: Response, error: any) {
  if (error instanceof ReportQueryError) {
    return fail(res, 400, error.message);
  }
  const code = error?.code;
  const message =
    typeof code === "string" && code.startsWith("P")
      ? "数据库操作失败，请检查输入数据后重试"
      : error?.message || "查询失败";
  return fail(res, 500, message, 500);
}

export async function productionReportHandler(req: Request, res: Response) {
  try {
    const data = await getProductionReport(req.query as ReportQuery);
    return success(res, data);
  } catch (error: any) {
    return handleError(res, error);
  }
}

export async function salesReportHandler(req: Request, res: Response) {
  try {
    const data = await getSalesReport(req.query as ReportQuery);
    return success(res, data);
  } catch (error: any) {
    return handleError(res, error);
  }
}

export async function purchaseReportHandler(req: Request, res: Response) {
  try {
    const data = await getPurchaseReport(req.query as ReportQuery);
    return success(res, data);
  } catch (error: any) {
    return handleError(res, error);
  }
}

export async function inventoryReportHandler(req: Request, res: Response) {
  try {
    const data = await getInventoryReport(req.query as ReportQuery);
    return success(res, data);
  } catch (error: any) {
    return handleError(res, error);
  }
}

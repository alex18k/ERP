import { Request, Response } from "express";
import {
  ReportQuery,
  getProductionReport,
  getSalesReport,
  getPurchaseReport,
  getInventoryReport,
} from "../services/report.service";
import { success, fail } from "../utils/response";

export async function productionReportHandler(req: Request, res: Response) {
  try {
    const data = await getProductionReport(req.query as ReportQuery);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function salesReportHandler(req: Request, res: Response) {
  try {
    const data = await getSalesReport(req.query as ReportQuery);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function purchaseReportHandler(req: Request, res: Response) {
  try {
    const data = await getPurchaseReport(req.query as ReportQuery);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function inventoryReportHandler(req: Request, res: Response) {
  try {
    const data = await getInventoryReport(req.query as ReportQuery);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}
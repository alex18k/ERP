import { Request, Response } from "express";
import * as dashboardService from "../services/dashboard.service";
import { success, fail } from "../utils/response";

export async function executiveHandler(req: Request, res: Response) {
  try {
    const data = await dashboardService.getExecutiveDashboard();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function orderTrackingHandler(req: Request, res: Response) {
  try {
    const data = await dashboardService.getOrderTrackingDashboard();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function shortageAlertHandler(req: Request, res: Response) {
  try {
    const data = await dashboardService.getShortageAlertDashboard();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function inventoryHandler(req: Request, res: Response) {
  try {
    const data = await dashboardService.getInventoryDashboard();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}
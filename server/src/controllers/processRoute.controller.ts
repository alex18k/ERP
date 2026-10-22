import { Request, Response } from "express";
import * as routeService from "../services/processRoute.service";
import { success, fail } from "../utils/response";

export async function listHandler(req: Request, res: Response) {
  try {
    const data = await routeService.listProcessRoutes(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function getHandler(req: Request, res: Response) {
  try {
    const data = await routeService.getProcessRoute(Number(req.params.id));
    if (!data) return fail(res, 404, "工艺路线不存在", 404);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function createHandler(req: Request, res: Response) {
  try {
    const data = await routeService.createProcessRoute(req.body);
    return success(res, data, "创建成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function updateHandler(req: Request, res: Response) {
  try {
    const data = await routeService.updateProcessRoute(Number(req.params.id), req.body);
    return success(res, data, "更新成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function deleteHandler(req: Request, res: Response) {
  try {
    await routeService.deleteProcessRoute(Number(req.params.id));
    return success(res, null, "删除成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}
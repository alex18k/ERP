import { Request, Response } from "express";
import * as bomService from "../services/bom.service";
import { success, fail } from "../utils/response";

export async function listHandler(req: Request, res: Response) {
  try {
    const data = await bomService.listBoms(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function getHandler(req: Request, res: Response) {
  try {
    const data = await bomService.getBom(Number(req.params.id));
    if (!data) return fail(res, 404, "BOM不存在", 404);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function productOptionsHandler(req: Request, res: Response) {
  try {
    const data = await bomService.bomProductOptions();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function treeHandler(req: Request, res: Response) {
  try {
    const data = await bomService.getBomTree(Number(req.params.id));
    return success(res, data);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function createHandler(req: Request, res: Response) {
  try {
    const data = await bomService.createBom(req.body);
    return success(res, data, "创建成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function updateHandler(req: Request, res: Response) {
  try {
    const data = await bomService.updateBom(Number(req.params.id), req.body);
    return success(res, data, "更新成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function activateHandler(req: Request, res: Response) {
  try {
    const data = await bomService.activateBom(Number(req.params.id));
    return success(res, data, "启用成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function deleteHandler(req: Request, res: Response) {
  try {
    await bomService.deleteBom(Number(req.params.id));
    return success(res, null, "删除成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function batchDeleteHandler(req: Request, res: Response) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return fail(res, 400, "ids必须为数组");
    const count = await bomService.batchDeleteBom(ids);
    return success(res, { count }, "批量删除成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}
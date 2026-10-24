import { Request, Response } from "express";
import * as materialService from "../services/material.service";
import * as exportService from "../services/export.service";
import { success, fail } from "../utils/response";
import { isQueryConditionError } from "../utils/queryConditions";
import { sendCsv } from "../utils/export";

export async function exportHandler(_req: Request, res: Response) {
  try {
    const { filename, csv } = await exportService.materialExport();
    return sendCsv(res, filename, csv);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function listHandler(req: Request, res: Response) {
  try {
    const data = await materialService.listMaterials(req.query as any);
    return success(res, data);
  } catch (error: any) {
    if (isQueryConditionError(error)) return fail(res, 400, error.message, 400);
    return fail(res, 500, error.message, 500);
  }
}

export async function typeHandler(_req: Request, res: Response) {
  try {
    const data = await materialService.listMaterialTypes();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function optionHandler(req: Request, res: Response) {
  try {
    const data = await materialService.listMaterialOptions(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

// 已使用过的计量单位（去重），供物料表单单位下拉使用，避免拉取整表
export async function unitHandler(_req: Request, res: Response) {
  try {
    const data = await materialService.listMaterialUnits();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function getHandler(req: Request, res: Response) {
  try {
    const data = await materialService.getMaterial(Number(req.params.id));
    if (!data) return fail(res, 404, "物料不存在", 404);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function createHandler(req: Request, res: Response) {
  try {
    const data = await materialService.createMaterial(req.body);
    return success(res, data, "创建成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function updateHandler(req: Request, res: Response) {
  try {
    const data = await materialService.updateMaterial(Number(req.params.id), req.body);
    return success(res, data, "更新成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function deleteHandler(req: Request, res: Response) {
  try {
    await materialService.deleteMaterial(Number(req.params.id));
    return success(res, null, "删除成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function importHandler(req: Request, res: Response) {
  try {
    const rows = req.body;
    if (!Array.isArray(rows)) return fail(res, 400, "导入数据格式错误");
    const data = await materialService.importMaterials(rows);
    return success(res, data, "导入完成");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}
export async function recalcCostHandler(_req: Request, res: Response) {
  try {
    const data = await materialService.recalcManufactureCosts();
    return success(res, data, `已重算 ${data.updated} 个制造件成本`);
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

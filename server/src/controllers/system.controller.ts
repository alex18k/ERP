import { Request, Response } from "express";
import * as systemService from "../services/system.service";
import * as companyService from "../services/company.service";
import { success, fail } from "../utils/response";

export async function listUserHandler(req: Request, res: Response) {
  try {
    const data = await systemService.listUsers(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function listSalespersonHandler(req: Request, res: Response) {
  try {
    const data = await systemService.listSalespersons();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function createUserHandler(req: Request, res: Response) {
  try {
    const data = await systemService.createUser(req.body);
    return success(res, data, "用户创建成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function updateUserHandler(req: Request, res: Response) {
  try {
    const data = await systemService.updateUser(Number(req.params.id), req.body);
    return success(res, data, "更新成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function deleteUserHandler(req: Request, res: Response) {
  try {
    await systemService.deleteUser(Number(req.params.id));
    return success(res, null, "删除成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function listRoleHandler(req: Request, res: Response) {
  try {
    const data = await systemService.listRoles();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function createRoleHandler(req: Request, res: Response) {
  try {
    const data = await systemService.createRole(req.body);
    return success(res, data, "角色创建成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function updateRoleHandler(req: Request, res: Response) {
  try {
    const data = await systemService.updateRole(Number(req.params.id), req.body);
    return success(res, data, "更新成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function deleteRoleHandler(req: Request, res: Response) {
  try {
    await systemService.deleteRole(Number(req.params.id));
    return success(res, null, "删除成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

export async function listPermissionHandler(req: Request, res: Response) {
  try {
    const data = await systemService.listPermissions();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function listDepartmentHandler(req: Request, res: Response) {
  try {
    const data = await systemService.listDepartments();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function listLogHandler(req: Request, res: Response) {
  try {
    const data = await systemService.listOperationLogs(req.query as any);
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}
export async function getCompanyInfoHandler(_req: Request, res: Response) {
  try {
    const data = await companyService.getCompanyInfo();
    return success(res, data);
  } catch (error: any) {
    return fail(res, 500, error.message, 500);
  }
}

export async function updateCompanyInfoHandler(req: Request, res: Response) {
  try {
    const data = await companyService.updateCompanyInfo(req.body);
    return success(res, data, "公司信息保存成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}

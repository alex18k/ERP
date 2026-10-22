import { Request, Response } from "express";
import { login, changePassword } from "../services/auth.service";
import { success, fail } from "../utils/response";
import { AuthRequest } from "../middleware/auth";

export async function loginHandler(req: Request, res: Response) {
  const { username, password } = req.body;
  if (!username || !password) {
    return fail(res, 400, "用户名和密码不能为空");
  }
  try {
    const result = await login(username, password);
    return success(res, result, "登录成功");
  } catch (error: any) {
    return fail(res, 401, error.message, 401);
  }
}

export async function changePasswordHandler(req: AuthRequest, res: Response) {
  const { oldPassword, newPassword } = req.body;
  if (!req.user) return fail(res, 401, "未认证", 401);
  if (!oldPassword || !newPassword) {
    return fail(res, 400, "原密码和新密码不能为空");
  }
  try {
    await changePassword(req.user.id, oldPassword, newPassword);
    return success(res, null, "密码修改成功");
  } catch (error: any) {
    return fail(res, 400, error.message);
  }
}
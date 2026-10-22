import { Request, Response, NextFunction } from "express";
import prisma from "../config/prisma";
import { verifyToken } from "../utils/jwt";
import { unauthorized, forbidden } from "../utils/response";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    realName: string;
  };
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return unauthorized(res, "请先登录");
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, realName: true, status: true },
    });
    if (!user || user.status !== 1) {
      return unauthorized(res, "用户不存在或已禁用");
    }
    req.user = {
      id: user.id,
      username: user.username,
      realName: user.realName,
    };
    next();
  } catch (error) {
    return unauthorized(res, "登录已过期，请重新登录");
  }
}

export function requirePermission(code: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return unauthorized(res);
    }

    const role = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    const hasPermission = role?.userRoles.some((ur) =>
      ur.role.rolePermissions.some((rp) => rp.permission.code === code)
    );

    // 管理员（ADMIN角色）拥有所有权限
    const isAdmin = role?.userRoles.some((ur) => ur.role.code === "ADMIN");

    if (isAdmin || hasPermission) {
      return next();
    }
    return forbidden(res, "无权限执行此操作");
  };
}
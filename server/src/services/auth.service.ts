import bcrypt from "bcryptjs";
import prisma from "../config/prisma";
import { signToken } from "../utils/jwt";
import type { JwtPayload } from "../utils/jwt";

export interface LoginResult {
  token: string;
  user: {
    id: number;
    username: string;
    realName: string;
    email?: string | null;
    phone?: string | null;
  };
  permissions: string[];
  roles: string[];
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { username },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              rolePermissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  if (!user || user.status !== 1) {
    throw new Error("用户不存在或已禁用");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new Error("用户名或密码错误");
  }

  const permissions = new Set<string>();
  const roles: string[] = [];
  for (const ur of user.userRoles) {
    roles.push(ur.role.code);
    for (const rp of ur.role.rolePermissions) {
      permissions.add(rp.permission.code);
    }
    if (ur.role.code === "ADMIN") {
      // 管理员拥有全部权限
      const allPerms = await prisma.permission.findMany();
      allPerms.forEach((p) => permissions.add(p.code));
    }
  }
  if (user.userRoles.some((ur) => ur.role.code === "ADMIN")) {
    const allPerms = await prisma.permission.findMany();
    allPerms.forEach((p) => permissions.add(p.code));
  }

  const payload: JwtPayload = { userId: user.id, username: user.username, realName: user.realName };
  const token = signToken(payload);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      realName: user.realName,
      email: user.email,
      phone: user.phone,
    },
    permissions: [...permissions],
    roles,
  };
}

export async function changePassword(userId: number, oldPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("用户不存在");

  const valid = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!valid) throw new Error("原密码错误");

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
  return true;
}
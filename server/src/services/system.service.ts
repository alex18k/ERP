import bcrypt from "bcryptjs";
import prisma from "../config/prisma";

// ===== 用户管理 =====
export async function listUsers(where: any) {
  const { keyword, status, page = 1, pageSize = 20 } = where;

  const filters: any = { ...(status !== undefined && status !== "" ? { status: Number(status) } : {}) };
  if (keyword) {
    filters.OR = [{ username: { contains: keyword } }, { realName: { contains: keyword } }];
  }

  const [total, items] = await Promise.all([
    prisma.user.count({ where: filters }),
    prisma.user.findMany({
      where: filters,
      select: {
        id: true,
        username: true,
        realName: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        department: { select: { id: true, name: true } },
        userRoles: { include: { role: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { id: "asc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function createUser(data: { username: string; password: string; realName: string; email?: string; phone?: string; departmentId?: number; roleIds?: number[] }) {
  if (!data.username || !data.password || !data.realName) throw new Error("用户名、密码、姓名不能为空");

  const exists = await prisma.user.findUnique({ where: { username: data.username } });
  if (exists) throw new Error("用户名已存在");

  const passwordHash = await bcrypt.hash(data.password, 10);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username: data.username,
        passwordHash,
        realName: data.realName,
        email: data.email,
        phone: data.phone,
        departmentId: data.departmentId,
        status: 1,
      },
    });

    if (data.roleIds && data.roleIds.length > 0) {
      for (const roleId of data.roleIds) {
        await tx.userRole.create({ data: { userId: user.id, roleId } });
      }
    }

    return user;
  });
}

export async function updateUser(id: number, data: { realName?: string; email?: string; phone?: string; departmentId?: number; status?: number; password?: string; roleIds?: number[] }) {
  const exists = await prisma.user.findUnique({ where: { id } });
  if (!exists) throw new Error("用户不存在");

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: {
        realName: data.realName,
        email: data.email,
        phone: data.phone,
        departmentId: data.departmentId,
        status: data.status,
        ...(data.password ? { passwordHash: await bcrypt.hash(data.password, 10) } : {}),
      },
    });

    if (data.roleIds) {
      await tx.userRole.deleteMany({ where: { userId: id } });
      for (const roleId of data.roleIds) {
        await tx.userRole.create({ data: { userId: id, roleId } });
      }
    }

    return user;
  });
}

export async function deleteUser(id: number) {
  const exists = await prisma.user.findUnique({ where: { id } });
  if (!exists) throw new Error("用户不存在");
  if (exists.username === "admin") throw new Error("系统管理员不能删除");

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: id } }),
    prisma.user.update({ where: { id }, data: { status: 0 } }),
  ]);
  return true;
}

// ===== 角色管理 =====
export async function listRoles() {
  const roles = await prisma.role.findMany({
    include: {
      _count: { select: { userRoles: true } },
      rolePermissions: { include: { permission: true } },
    },
    orderBy: { id: "asc" },
  });
  return roles.map((r) => ({
    ...r,
    permissionIds: r.rolePermissions.map((rp) => rp.permissionId),
    userCount: r._count.userRoles,
    rolePermissions: undefined,
    _count: undefined,
  }));
}

export async function createRole(data: { code: string; name: string; description?: string; dataScope?: string; permissionIds?: number[] }) {
  const exists = await prisma.role.findUnique({ where: { code: data.code } });
  if (exists) throw new Error("角色编码已存在");

  return prisma.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        code: data.code,
        name: data.name,
        description: data.description,
        dataScope: data.dataScope ?? "personal",
      },
    });

    if (data.permissionIds) {
      for (const pid of data.permissionIds) {
        await tx.rolePermission.create({ data: { roleId: role.id, permissionId: pid } });
      }
    }

    return role;
  });
}

export async function updateRole(id: number, data: { name?: string; description?: string; dataScope?: string; permissionIds?: number[] }) {
  const exists = await prisma.role.findUnique({ where: { id } });
  if (!exists) throw new Error("角色不存在");

  return prisma.$transaction(async (tx) => {
    const role = await tx.role.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        dataScope: data.dataScope,
      },
    });

    if (data.permissionIds) {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      for (const pid of data.permissionIds) {
        await tx.rolePermission.create({ data: { roleId: id, permissionId: pid } });
      }
    }

    return role;
  });
}

export async function deleteRole(id: number) {
  const exists = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { userRoles: true } } } });
  if (!exists) throw new Error("角色不存在");
  if (exists.code === "ADMIN") throw new Error("系统管理员角色不能删除");
  if (exists._count.userRoles > 0) throw new Error("角色下存在用户，无法删除");

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: id } }),
    prisma.role.delete({ where: { id } }),
  ]);
  return true;
}

// ===== 权限 =====
export async function listPermissions() {
  const permissions = await prisma.permission.findMany({ orderBy: [{ module: "asc" }, { id: "asc" }] });
  // 分组返回
  const grouped = new Map<string, any[]>();
  for (const p of permissions) {
    if (!grouped.has(p.module)) grouped.set(p.module, []);
    grouped.get(p.module)!.push(p);
  }
  return {
    list: permissions,
    grouped: Object.fromEntries(grouped),
  };
}

// ===== 部门 =====
export async function listDepartments() {
  return prisma.department.findMany({ orderBy: { code: "asc" } });
}

// ===== 操作日志 =====
export async function listOperationLogs(where: any) {
  const { module, userId, page = 1, pageSize = 20, startDate, endDate } = where;
  const filters: any = {};
  if (module) filters.module = module;
  if (userId) filters.userId = Number(userId);
  if (startDate || endDate) {
    filters.createdAt = {
      gte: startDate ? new Date(startDate) : undefined,
      lte: endDate ? new Date(endDate) : undefined,
    };
  }

  const [total, items] = await Promise.all([
    prisma.operationLog.count({ where: filters }),
    prisma.operationLog.findMany({
      where: filters,
      include: { user: { select: { id: true, realName: true, username: true } } },
      orderBy: { createdAt: "desc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}
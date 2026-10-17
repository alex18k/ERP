import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// 各模块测试角色 -> 权限码（权限码的唯一来源是 seed.ts 的 permissions[]，此处仅做授权）
const roleDefs: {
  code: string;
  name: string;
  description: string;
  dataScope: string;
  permissions: string[] | "*";
}[] = [
  { code: "ADMIN", name: "系统管理员", description: "拥有全部权限", dataScope: "all", permissions: "*" },
  {
    code: "MANAGER",
    name: "厂长/经理",
    description: "查看全部门数据",
    dataScope: "department",
    permissions: [
      "material:view", "bom:view", "order:view", "mrp:view", "mrp:run",
      "production:view", "production:manage", "purchase:view", "purchase:approve",
      "purchase:delete", "stock:view", "dashboard:view",
    ],
  },
  {
    code: "SALES",
    name: "销售跟单",
    description: "订单管理",
    dataScope: "personal",
    permissions: ["order:view", "order:create", "order:edit", "order:confirm", "order:ship", "order:delete", "material:view", "stock:view"],
  },
  {
    code: "PLANNER",
    name: "计划员",
    description: "生产排产/MRP",
    dataScope: "department",
    permissions: ["mrp:view", "mrp:run", "production:view", "production:manage", "bom:view", "material:view", "dashboard:view"],
  },
  {
    code: "PRODUCTION",
    name: "车间人员",
    description: "生产报工",
    dataScope: "department",
    permissions: ["material:view", "production:view", "production:report", "dashboard:view"],
  },
  {
    code: "PURCHASE",
    name: "采购人员",
    description: "采购管理",
    dataScope: "department",
    permissions: ["material:view", "purchase:view", "purchase:create", "purchase:edit", "mrp:view", "dashboard:view"],
  },
  {
    code: "WAREHOUSE",
    name: "仓库管理员",
    description: "库存管理",
    dataScope: "department",
    permissions: ["material:view", "stock:view", "stock:create", "stock:edit", "stock:delete", "purchase:view", "production:view"],
  },
  {
    code: "BASE",
    name: "基础数据员",
    description: "物料/BOM 等基础数据维护",
    dataScope: "all",
    permissions: ["material:view", "material:create", "material:edit", "material:delete", "bom:view", "bom:edit"],
  },
];

// 每个角色一个测试用户，密码统一 admin123
const userDefs: { username: string; realName: string; email: string; role: string; deptCode: string | null }[] = [
  { username: "admin", realName: "系统管理员", email: "admin@erp.com", role: "ADMIN", deptCode: null },
  { username: "manager01", realName: "厂长/经理", email: "manager01@erp.com", role: "MANAGER", deptCode: null },
  { username: "sales01", realName: "销售员", email: "sales01@erp.com", role: "SALES", deptCode: "DEPT-SALE" },
  { username: "plan01", realName: "计划员", email: "plan01@erp.com", role: "PLANNER", deptCode: "DEPT-PROD" },
  { username: "user01", realName: "车间操作员", email: "user01@erp.com", role: "PRODUCTION", deptCode: "DEPT-PROD" },
  { username: "purch01", realName: "采购员", email: "purch01@erp.com", role: "PURCHASE", deptCode: "DEPT-PURCH" },
  { username: "wh01", realName: "仓库管理员", email: "wh01@erp.com", role: "WAREHOUSE", deptCode: "DEPT-WH" },
  { username: "base01", realName: "基础数据员", email: "base01@erp.com", role: "BASE", deptCode: null },
];

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 10);

  const allPerms = await prisma.permission.findMany();
  const permMap = new Map(allPerms.map((p) => [p.code, p.id]));

  // ===== 角色 + 授权（幂等）=====
  for (const def of roleDefs) {
    const role = await prisma.role.upsert({
      where: { code: def.code },
      update: {},
      create: { code: def.code, name: def.name, description: def.description, dataScope: def.dataScope },
    });

    const codes = def.permissions === "*" ? [...permMap.keys()] : def.permissions;
    for (const code of codes) {
      const pid = permMap.get(code);
      if (!pid) {
        console.warn(`[warn] 权限码不存在，跳过：${code}（角色 ${def.code}）`);
        continue;
      }
      const exists = await prisma.rolePermission.findFirst({
        where: { roleId: role.id, permissionId: pid },
      });
      if (!exists) await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: pid } });
    }
  }

  // ===== 用户 + 角色关联（幂等，重置为测试密码 admin123）=====
  const depts = await prisma.department.findMany();
  const deptMap = new Map(depts.map((d) => [d.code, d.id]));
  const roles = await prisma.role.findMany();
  const roleMap = new Map(roles.map((r) => [r.code, r.id]));

  const summary: string[] = [];
  for (const def of userDefs) {
    const departmentId = def.deptCode ? (deptMap.get(def.deptCode) ?? null) : null;
    const user = await prisma.user.upsert({
      where: { username: def.username },
      update: { passwordHash, realName: def.realName, status: 1 },
      create: {
        username: def.username,
        passwordHash,
        realName: def.realName,
        email: def.email,
        departmentId,
        status: 1,
      },
    });

    const roleId = roleMap.get(def.role);
    if (roleId) {
      const exists = await prisma.userRole.findUnique({
        where: { userId_roleId: { userId: user.id, roleId } },
      });
      if (!exists) await prisma.userRole.create({ data: { userId: user.id, roleId } });
    } else {
      console.warn(`[warn] 角色不存在，跳过关联：${def.role}（用户 ${def.username}）`);
    }
    summary.push(`  ${def.username.padEnd(10)} ${def.realName.padEnd(8)} -> ${def.role}`);
  }

  console.log("✅ 测试用户/角色创建完成（密码均为 admin123）");
  console.log(summary.join("\n"));
}

main()
  .catch((e) => {
    console.error("测试用户/角色创建失败:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
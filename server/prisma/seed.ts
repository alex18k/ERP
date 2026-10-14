import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // ===== 部门 =====
  const deptProduction = await prisma.department.upsert({
    where: { code: "DEPT-PROD" },
    update: {},
    create: { code: "DEPT-PROD", name: "生产部" },
  });
  const deptSales = await prisma.department.upsert({
    where: { code: "DEPT-SALE" },
    update: {},
    create: { code: "DEPT-SALE", name: "销售部" },
  });
  const deptPurchase = await prisma.department.upsert({
    where: { code: "DEPT-PURCH" },
    update: {},
    create: { code: "DEPT-PURCH", name: "采购部" },
  });
  const deptWarehouse = await prisma.department.upsert({
    where: { code: "DEPT-WH" },
    update: {},
    create: { code: "DEPT-WH", name: "仓储部" },
  });

  // ===== 权限 =====
  const permissions: { code: string; name: string; module: string; action: string }[] = [
    { code: "material:view", name: "查看物料", module: "material", action: "view" },
    { code: "material:create", name: "新增物料", module: "material", action: "create" },
    { code: "material:edit", name: "编辑物料", module: "material", action: "edit" },
    { code: "material:delete", name: "删除物料", module: "material", action: "delete" },
    { code: "bom:view", name: "查看BOM", module: "bom", action: "view" },
    { code: "bom:edit", name: "编辑BOM", module: "bom", action: "edit" },
    { code: "order:view", name: "查看订单", module: "order", action: "view" },
    { code: "order:create", name: "创建订单", module: "order", action: "create" },
    { code: "order:edit", name: "编辑订单", module: "order", action: "edit" },
    { code: "order:confirm", name: "审核订单", module: "order", action: "confirm" },
    { code: "order:ship", name: "发货确认", module: "order", action: "ship" },
    { code: "mrp:run", name: "MRP运算", module: "mrp", action: "run" },
    { code: "mrp:view", name: "查看MRP结果", module: "mrp", action: "view" },
    { code: "production:view", name: "查看生产", module: "production", action: "view" },
    { code: "production:report", name: "生产报工", module: "production", action: "report" },
    { code: "production:manage", name: "生产管理", module: "production", action: "manage" },
    { code: "purchase:view", name: "查看采购", module: "purchase", action: "view" },
    { code: "purchase:create", name: "创建采购单", module: "purchase", action: "create" },
    { code: "purchase:approve", name: "审批采购单", module: "purchase", action: "approve" },
    { code: "purchase:delete", name: "删除采购单", module: "purchase", action: "delete" },
    { code: "stock:view", name: "查看库存", module: "stock", action: "view" },
    { code: "stock:edit", name: "库存操作", module: "stock", action: "edit" },
    { code: "dashboard:view", name: "查看看板", module: "dashboard", action: "view" },
    { code: "user:manage", name: "用户管理", module: "user", action: "manage" },
    { code: "role:manage", name: "角色管理", module: "role", action: "manage" },
  ];

  for (const p of permissions) {
    await prisma.permission.upsert({ where: { code: p.code }, update: {}, create: p });
  }

  // ===== 角色 =====
  const roleAdmin = await prisma.role.upsert({
    where: { code: "ADMIN" },
    update: {},
    create: {
      code: "ADMIN",
      name: "系统管理员",
      description: "拥有全部权限",
      dataScope: "all",
    },
  });
  const roleManager = await prisma.role.upsert({
    where: { code: "MANAGER" },
    update: {},
    create: {
      code: "MANAGER",
      name: "厂长/经理",
      description: "查看全部门数据",
      dataScope: "department",
    },
  });
  const roleSales = await prisma.role.upsert({
    where: { code: "SALES" },
    update: {},
    create: {
      code: "SALES",
      name: "销售跟单",
      description: "订单管理",
      dataScope: "personal",
    },
  });
  const roleProduction = await prisma.role.upsert({
    where: { code: "PRODUCTION" },
    update: {},
    create: {
      code: "PRODUCTION",
      name: "车间人员",
      description: "生产报工",
      dataScope: "department",
    },
  });
  const rolePurchase = await prisma.role.upsert({
    where: { code: "PURCHASE" },
    update: {},
    create: {
      code: "PURCHASE",
      name: "采购人员",
      description: "采购管理",
      dataScope: "department",
    },
  });
  const roleWarehouse = await prisma.role.upsert({
    where: { code: "WAREHOUSE" },
    update: {},
    create: {
      code: "WAREHOUSE",
      name: "仓库管理员",
      description: "库存管理",
      dataScope: "department",
    },
  });
  const rolePlanner = await prisma.role.upsert({
    where: { code: "PLANNER" },
    update: {},
    create: {
      code: "PLANNER",
      name: "计划员",
      description: "生产排产",
      dataScope: "department",
    },
  });

  // 角色-权限关联
  const allPerms = await prisma.permission.findMany();
  const permMap = new Map(allPerms.map((p) => [p.code, p.id]));

  for (const p of allPerms) {
    const exists = await prisma.rolePermission.findFirst({
      where: { roleId: roleAdmin.id, permissionId: p.id },
    });
    if (!exists) {
      await prisma.rolePermission.create({ data: { roleId: roleAdmin.id, permissionId: p.id } });
    }
  }

  const managerCodes = ["material:view", "bom:view", "order:view", "mrp:view", "mrp:run", "production:view", "production:manage", "purchase:view", "stock:view", "dashboard:view"];
  for (const code of managerCodes) {
    const pid = permMap.get(code);
    if (pid) {
      const exists = await prisma.rolePermission.findFirst({ where: { roleId: roleManager.id, permissionId: pid } });
      if (!exists) await prisma.rolePermission.create({ data: { roleId: roleManager.id, permissionId: pid } });
    }
  }

  const salesCodes = ["order:view", "order:create", "order:edit", "order:confirm", "order:ship", "material:view"];
  for (const code of salesCodes) {
    const pid = permMap.get(code);
    if (pid) {
      const exists = await prisma.rolePermission.findFirst({ where: { roleId: roleSales.id, permissionId: pid } });
      if (!exists) await prisma.rolePermission.create({ data: { roleId: roleSales.id, permissionId: pid } });
    }
  }

  const productionCodes = ["material:view", "production:view", "production:report", "dashboard:view"];
  for (const code of productionCodes) {
    const pid = permMap.get(code);
    if (pid) {
      const exists = await prisma.rolePermission.findFirst({ where: { roleId: roleProduction.id, permissionId: pid } });
      if (!exists) await prisma.rolePermission.create({ data: { roleId: roleProduction.id, permissionId: pid } });
    }
  }

  const purchaseCodes = ["material:view", "purchase:view", "purchase:create", "purchase:approve", "purchase:delete", "mrp:view", "dashboard:view"];
  for (const code of purchaseCodes) {
    const pid = permMap.get(code);
    if (pid) {
      const exists = await prisma.rolePermission.findFirst({ where: { roleId: rolePurchase.id, permissionId: pid } });
      if (!exists) await prisma.rolePermission.create({ data: { roleId: rolePurchase.id, permissionId: pid } });
    }
  }

  const warehouseCodes = ["material:view", "stock:view", "stock:edit", "purchase:view"];
  for (const code of warehouseCodes) {
    const pid = permMap.get(code);
    if (pid) {
      const exists = await prisma.rolePermission.findFirst({ where: { roleId: roleWarehouse.id, permissionId: pid } });
      if (!exists) await prisma.rolePermission.create({ data: { roleId: roleWarehouse.id, permissionId: pid } });
    }
  }

  // ===== 用户 =====
  const passwordHash = await bcrypt.hash("admin123", 10);

  const adminUser = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash,
      realName: "系统管理员",
      email: "admin@erp.com",
      status: 1,
    },
  });

  const salesUser = await prisma.user.upsert({
    where: { username: "sales01" },
    update: {},
    create: {
      username: "sales01",
      passwordHash,
      realName: "销售员",
      departmentId: deptSales.id,
      status: 1,
    },
  });

  const prodUser = await prisma.user.upsert({
    where: { username: "user01" },
    update: {},
    create: {
      username: "user01",
      passwordHash,
      realName: "车间操作员",
      departmentId: deptProduction.id,
      status: 1,
    },
  });

  const purchUser = await prisma.user.upsert({
    where: { username: "purch01" },
    update: {},
    create: {
      username: "purch01",
      passwordHash,
      realName: "采购员",
      departmentId: deptPurchase.id,
      status: 1,
    },
  });

  const whUser = await prisma.user.upsert({
    where: { username: "wh01" },
    update: {},
    create: {
      username: "wh01",
      passwordHash,
      realName: "仓库管理员",
      departmentId: deptWarehouse.id,
      status: 1,
    },
  });

  const plannerUser = await prisma.user.upsert({
    where: { username: "plan01" },
    update: {},
    create: {
      username: "plan01",
      passwordHash,
      realName: "计划员",
      departmentId: deptProduction.id,
      status: 1,
    },
  });

  // 用户-角色关联
  const userRolePairs = [
    [adminUser.id, roleAdmin.id],
    [salesUser.id, roleSales.id],
    [prodUser.id, roleProduction.id],
    [purchUser.id, rolePurchase.id],
    [whUser.id, roleWarehouse.id],
    [plannerUser.id, rolePlanner.id],
    [salesUser.id, roleManager.id],
  ];
  for (const [uid, rid] of userRolePairs) {
    const exists = await prisma.userRole.findUnique({
      where: { userId_roleId: { userId: uid, roleId: rid } },
    });
    if (!exists) {
      await prisma.userRole.create({ data: { userId: uid, roleId: rid } });
    }
  }

  // ===== 仓库 =====
  const whMain = await prisma.warehouse.upsert({
    where: { code: "WH-01" },
    update: {},
    create: { code: "WH-01", name: "原料仓库" },
  });
  const whRaw = await prisma.warehouse.upsert({
    where: { code: "WH-02" },
    update: {},
    create: { code: "WH-02", name: "成品仓库" },
  });

  // ===== 库存事务类型 =====
  const txnTypes = [
    { code: "ADJ-IN", description: "盘盈入库", direction: "in" },
    { code: "ADJ-OUT", description: "盘亏出库", direction: "out" },
    { code: "PUR-IN", description: "采购入库", direction: "in" },
    { code: "SALE-OUT", description: "销售出库", direction: "out" },
    { code: "SCRAP", description: "报废出库", direction: "out" },
  ];
  for (const t of txnTypes) {
    await prisma.stockTransactionType.upsert({ where: { code: t.code }, update: {}, create: t });
  }

  // ===== 供应商 =====
  const supplier1 = await prisma.supplier.upsert({
    where: { code: "SUP-001" },
    update: {},
    create: {
      code: "SUP-001",
      name: "宏达钢材有限公司",
      contactPerson: "王经理",
      phone: "13800000001",
      email: "hongda@example.com",
      address: "XX省XX市工业园区",
    },
  });
  const supplier2 = await prisma.supplier.upsert({
    where: { code: "SUP-002" },
    update: {},
    create: {
      code: "SUP-002",
      name: "精工紧固件厂",
      contactPerson: "李经理",
      phone: "13800000002",
      email: "jinggong@example.com",
      address: "XX省XX市经济开发区",
    },
  });
  const supplier3 = await prisma.supplier.upsert({
    where: { code: "SUP-003" },
    update: {},
    create: {
      code: "SUP-003",
      name: "欣美包装材料有限公司",
      contactPerson: "张经理",
      phone: "13800000003",
      address: "XX省XX市高新园区",
    },
  });

  // ===== 客户 =====
  const customer1 = await prisma.customer.upsert({
    where: { code: "CUS-001" },
    update: { settleMethod: "月结30天" },
    create: {
      code: "CUS-001",
      name: "宏图机械设备有限公司",
      contactPerson: "赵经理",
      phone: "13900000001",
      address: "XX省XX市工业大道1号",
      settleMethod: "月结30天",
    },
  });
  const customer2 = await prisma.customer.upsert({
    where: { code: "CUS-002" },
    update: { settleMethod: "现结" },
    create: {
      code: "CUS-002",
      name: "长江电气股份有限公司",
      contactPerson: "陈经理",
      phone: "13900000002",
      address: "XX省XX市长江路88号",
      settleMethod: "现结",
    },
  });

  // ===== 物料 =====
  const materialData = [
    { code: "M-001", name: "冷轧钢板", specification: "2mm×1000×2000", category: "purchase", unit: "张", safetyStock: 100, minStock: 50, maxStock: 500, leadTime: 7, supplierId: supplier1.id },
    { code: "M-002", name: "冷轧钢板", specification: "3mm×1000×2000", category: "purchase", unit: "张", safetyStock: 80, minStock: 40, maxStock: 400, leadTime: 7, supplierId: supplier1.id },
    { code: "M-003", name: "六角螺栓", specification: "M6×20", category: "purchase", unit: "个", safetyStock: 2000, minStock: 1000, maxStock: 10000, leadTime: 3, supplierId: supplier2.id },
    { code: "M-004", name: "六角螺母", specification: "M6", category: "purchase", unit: "个", safetyStock: 2000, minStock: 1000, maxStock: 10000, leadTime: 3, supplierId: supplier2.id },
    { code: "M-005", name: "包装纸箱", specification: "600×400×300", category: "purchase", unit: "个", safetyStock: 500, minStock: 200, maxStock: 2000, leadTime: 5, supplierId: supplier3.id },
    { code: "M-100", name: "设备外壳组件", specification: "HF-1000", category: "manufacture", unit: "套", safetyStock: 50, minStock: 20, maxStock: 200, leadTime: 10, manufactureLeadTime: 10 },
    { code: "M-200", name: "标准设备产品A", specification: "HF-A2000", category: "manufacture", unit: "台", safetyStock: 20, minStock: 10, maxStock: 100, leadTime: 15, manufactureLeadTime: 15 },
  ];

  const materials = new Map<string, { id: number }>();
  for (const m of materialData) {
    const created = await prisma.material.upsert({
      where: { code: m.code },
      update: {},
      create: m,
    });
    materials.set(m.code, created);
  }

  // ===== 车间/工位 =====
  const workshop1 = await prisma.workshop.upsert({
    where: { code: "WS-01" },
    update: {},
    create: { code: "WS-01", name: "一号车间", manager: "车间主任" },
  });
  const workshop2 = await prisma.workshop.upsert({
    where: { code: "WS-02" },
    update: {},
    create: { code: "WS-02", name: "二号车间", manager: "车间副主任" },
  });

  const workstationData = [
    { code: "ST-A01", name: "冲压工位A01", workshopId: workshop1.id, type: "stamping", capacity: 1 },
    { code: "ST-A02", name: "冲压工位A02", workshopId: workshop1.id, type: "stamping", capacity: 1 },
    { code: "ST-B01", name: "焊接工位B01", workshopId: workshop1.id, type: "welding", capacity: 1 },
    { code: "ST-C01", name: "组装工位C01", workshopId: workshop2.id, type: "assembly", capacity: 1 },
  ];
  for (const ws of workstationData) {
    await prisma.workstation.upsert({ where: { code: ws.code }, update: {}, create: ws });
  }

  // ===== 工艺路线（不绑定产品；路线可被多个成品/半成品共用） =====
  const route = await prisma.processRoute.upsert({
    where: { code: "ROUTE-001" },
    update: {},
    create: {
      code: "ROUTE-001",
      name: "标准设备A生产工艺",
      totalTime: 120,
    },
  });

  // 标准路线工序
  const stepData = [
    { code: "OP001", name: "下料", sequence: 1, workstationId: 1, standardTime: 10, setupTime: 5 },
    { code: "OP002", name: "冲压", sequence: 2, workstationId: 2, standardTime: 20, setupTime: 10 },
    { code: "OP003", name: "焊接", sequence: 3, workstationId: 3, standardTime: 30, setupTime: 10 },
    { code: "OP004", name: "组装", sequence: 4, workstationId: 4, standardTime: 40, setupTime: 5 },
  ];
  for (const s of stepData) {
    const existingStep = await prisma.processStep.findFirst({ where: { routeId: route.id, code: s.code } });
    if (!existingStep) await prisma.processStep.create({ data: { routeId: route.id, ...s } });
  }

  // 把路线挂到产品物料上（成品/半成品通过物料的 processRouteId 调用路线）
  await prisma.material.update({
    where: { id: materials.get("M-200")!.id },
    data: { processRouteId: route.id },
  });

  // ===== BOM =====
  const bom = await prisma.bom.upsert({
    where: { code: "BOM-001" },
    update: {},
    create: {
      code: "BOM-001",
      name: "标准设备产品A-BOM",
      productId: materials.get("M-200")!.id,
      version: "1.0",
      status: "active",
      createdBy: adminUser.id,
    },
  });

  const bomItems = [
    { materialId: materials.get("M-100")!.id, quantity: 1, unit: "套", lossRate: 0, sortOrder: 1 },
    { materialId: materials.get("M-003")!.id, quantity: 20, unit: "个", lossRate: 0.02, sortOrder: 2 },
    { materialId: materials.get("M-004")!.id, quantity: 20, unit: "个", lossRate: 0.02, sortOrder: 3 },
    { materialId: materials.get("M-005")!.id, quantity: 1, unit: "个", lossRate: 0, sortOrder: 4 },
  ];
  for (const item of bomItems) {
    const exists = await prisma.bomItem.findFirst({
      where: { bomId: bom.id, materialId: item.materialId },
    });
    if (!exists) {
      await prisma.bomItem.create({ data: { bomId: bom.id, ...item } });
    }
  }

  const bom2 = await prisma.bom.upsert({
    where: { code: "BOM-002" },
    update: {},
    create: {
      code: "BOM-002",
      name: "设备外壳组件-BOM",
      productId: materials.get("M-100")!.id,
      version: "1.0",
      status: "active",
      createdBy: adminUser.id,
    },
  });
  for (const item of [
    { materialId: materials.get("M-001")!.id, quantity: 1, unit: "张", lossRate: 0.05, sortOrder: 1 },
    { materialId: materials.get("M-002")!.id, quantity: 1, unit: "张", lossRate: 0.05, sortOrder: 2 },
  ]) {
    const exists = await prisma.bomItem.findFirst({
      where: { bomId: bom2.id, materialId: item.materialId },
    });
    if (!exists) {
      await prisma.bomItem.create({ data: { bomId: bom2.id, ...item } });
    }
  }

  // ===== 初始库存 =====
  for (const m of [
    { code: "M-001", qty: 150 },
    { code: "M-002", qty: 100 },
    { code: "M-003", qty: 5000 },
    { code: "M-004", qty: 4000 },
    { code: "M-005", qty: 800 },
    { code: "M-100", qty: 30 },
    { code: "M-200", qty: 15 },
  ]) {
    const mat = materials.get(m.code)!;
    const existingStock = await prisma.stock.findUnique({
      where: { materialId_warehouseId: { materialId: mat.id, warehouseId: whMain.id } },
    });
    if (!existingStock) {
      await prisma.stock.create({
        data: {
          materialId: mat.id,
          warehouseId: whMain.id,
          quantity: m.qty,
        },
      });
    }
  }

  console.log("✅ 种子数据创建完成");
  console.log(`  部门: ${5} 个, 权限: ${permissions.length} 个, 物资: ${materialData.length} 种`);
  console.log(`  用户: admin/sales01/user01/purch01/wh01/plan01 (密码均为: admin123)`);
}

main()
  .catch((e) => {
    console.error("种子数据创建失败:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
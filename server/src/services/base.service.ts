import prisma from "../config/prisma";

async function listModel<T>(model: any, where: any, include: any, orderBy: any, staticFilters: Record<string, any> = {}) {
  const { page = 1, pageSize = 20, keyword } = where;
  const filters: Record<string, any> = { ...staticFilters };
  if (keyword) {
    filters.OR = [
      { code: { contains: keyword } },
      { name: { contains: keyword } },
    ];
  }
  const [total, items] = await Promise.all([
    model.count({ where: filters }),
    model.findMany({
      where: filters,
      include,
      orderBy,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);
  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

// ===== 供应商 =====
export const supplierService = {
  list: (where: any) =>
    listModel(prisma.supplier, where, {}, { code: "asc" } as any),
  get: (id: number) => prisma.supplier.findUnique({ where: { id } }),
  create: (data: any) => {
    return prisma.supplier.create({ data });
  },
  update: async (id: number, data: any) => {
    const exists = await prisma.supplier.findUnique({ where: { id } });
    if (!exists) throw new Error("供应商不存在");
    return prisma.supplier.update({ where: { id }, data });
  },
  remove: async (id: number) => {
    const exists = await prisma.supplier.findUnique({ where: { id } });
    if (!exists) throw new Error("供应商不存在");
    const count = await prisma.purchaseOrder.count({ where: { supplierId: id } });
    if (count > 0) throw new Error("供应商存在采购订单，无法删除");
    await prisma.supplier.update({ where: { id }, data: { status: 0 } });
    return true;
  },
};

// ===== 仓库 =====
export const warehouseService = {
  list: (where: any) =>
    listModel(prisma.warehouse, where, { stocks: { include: { material: { select: { id: true, code: true, name: true } } } } }, { code: "asc" } as any),
  get: (id: number) =>
    prisma.warehouse.findUnique({ where: { id }, include: { stocks: { include: { material: true } } } }),
  create: (data: any) => prisma.warehouse.create({ data }),
  update: async (id: number, data: any) => {
    const exists = await prisma.warehouse.findUnique({ where: { id } });
    if (!exists) throw new Error("仓库不存在");
    return prisma.warehouse.update({ where: { id }, data });
  },
  remove: async (id: number) => {
    const exists = await prisma.warehouse.findUnique({ where: { id } });
    if (!exists) throw new Error("仓库不存在");
    const count = await prisma.stock.count({ where: { warehouseId: id } });
    if (count > 0) throw new Error("仓库中还有库存，无法删除");
    await prisma.warehouse.update({ where: { id }, data: { status: 0 } });
    return true;
  },
};

// ===== 客户 =====
export const customerService = {
  list: (where: any) =>
    listModel(prisma.customer, where, {}, { code: "asc" } as any, { status: 1 }),
  get: (id: number) => prisma.customer.findUnique({ where: { id } }),
  create: (data: any) => prisma.customer.create({ data }),
  update: async (id: number, data: any) => {
    const exists = await prisma.customer.findUnique({ where: { id } });
    if (!exists) throw new Error("客户不存在");
    return prisma.customer.update({ where: { id }, data });
  },
  remove: async (id: number) => {
    const exists = await prisma.customer.findUnique({ where: { id } });
    if (!exists) throw new Error("客户不存在");
    const count = await prisma.salesOrder.count({ where: { customerId: id } });
    if (count > 0) throw new Error("客户存在销售订单，无法删除");
    await prisma.customer.update({ where: { id }, data: { status: 0 } });
    return true;
  },
};

// ===== 车间/工位 =====
export const workshopService = {
  list: () =>
    prisma.workshop.findMany({
      where: { status: 1 },
      include: { workstations: true },
      orderBy: { code: "asc" },
    }),
  create: (data: any) => prisma.workshop.create({ data }),
  update: async (id: number, data: any) => {
    const exists = await prisma.workshop.findUnique({ where: { id } });
    if (!exists) throw new Error("车间不存在");
    return prisma.workshop.update({ where: { id }, data });
  },
  remove: async (id: number) => {
    const exists = await prisma.workshop.findUnique({ where: { id } });
    if (!exists) throw new Error("车间不存在");
    if (exists.status === 0) throw new Error("该车间已停用");
    const activeStationCount = await prisma.workstation.count({ where: { workshopId: id, status: 1 } });
    if (activeStationCount > 0) {
      throw new Error(`该车间下仍有 ${activeStationCount} 个有效工位，请先停用/转移后再删除`);
    }
    await prisma.$transaction([
      prisma.workstation.updateMany({ where: { workshopId: id }, data: { status: 0 } }),
      prisma.workshop.update({ where: { id }, data: { status: 0 } }),
    ]);
    return true;
  },
};

export const workstationService = {
  list: (workshopId?: number) =>
    prisma.workstation.findMany({
      where: {
        status: 1,
        ...(workshopId ? { workshopId: Number(workshopId) } : {}),
      },
      include: { workshop: { select: { id: true, name: true } } },
      orderBy: { code: "asc" },
    }),
  create: (data: any) => prisma.workstation.create({ data }),
  update: async (id: number, data: any) => {
    const exists = await prisma.workstation.findUnique({ where: { id } });
    if (!exists) throw new Error("工位不存在");
    return prisma.workstation.update({ where: { id }, data });
  },
  remove: async (id: number) => {
    const exists = await prisma.workstation.findUnique({ where: { id } });
    if (!exists) throw new Error("工位不存在");
    if (exists.status === 0) throw new Error("该工位已停用");
    const [stepCount, activeOrderCount] = await Promise.all([
      prisma.processStep.count({ where: { workstationId: id } }),
      prisma.workOrder.count({ where: { workstationId: id, status: { in: ["pending", "in_progress", "paused"] } } }),
    ]);
    if (stepCount > 0 || activeOrderCount > 0) {
      const parts: string[] = [];
      if (stepCount > 0) parts.push(`${stepCount} 处工艺路线工序`);
      if (activeOrderCount > 0) parts.push(`${activeOrderCount} 张未完成加工单`);
      throw new Error(`该工位已被${parts.join("、")}引用，无法停用/删除`);
    }
    await prisma.workstation.update({ where: { id }, data: { status: 0 } });
    return true;
  },
};

// ===== 库存事务类型 =====
export const stockTransactionTypeService = {
  list: async (where: any) => {
    const { page = 1, pageSize = 20, keyword } = where;
    const filters: Record<string, any> = {};
    if (keyword) {
      filters.OR = [
        { code: { contains: keyword } },
        { description: { contains: keyword } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.stockTransactionType.count({ where: filters }),
      prisma.stockTransactionType.findMany({
        where: filters,
        orderBy: { code: "asc" },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
      }),
    ]);
    return { total, page: Number(page), pageSize: Number(pageSize), items };
  },
  get: (id: number) => prisma.stockTransactionType.findUnique({ where: { id } }),
  create: async (data: any) => {
    if (!data.code) throw new Error("请输入事务代码");
    const exists = await prisma.stockTransactionType.findUnique({ where: { code: data.code } });
    if (exists) throw new Error("事务代码已存在");
    return prisma.stockTransactionType.create({
      data: {
        code: data.code,
        description: data.description ?? "",
        direction: data.direction || "in",
        status: data.status ?? 1,
      },
    });
  },
  update: async (id: number, data: any) => {
    const exists = await prisma.stockTransactionType.findUnique({ where: { id } });
    if (!exists) throw new Error("事务类型不存在");
    if (data.code) {
      const dup = await prisma.stockTransactionType.findFirst({ where: { code: data.code, NOT: { id } } });
      if (dup) throw new Error("事务代码已存在");
    }
    return prisma.stockTransactionType.update({
      where: { id },
      data: {
        code: data.code,
        description: data.description,
        direction: data.direction,
        status: data.status,
      },
    });
  },
  remove: async (id: number) => {
    const exists = await prisma.stockTransactionType.findUnique({ where: { id } });
    if (!exists) throw new Error("事务类型不存在");
    const count = await prisma.stockRecord.count({ where: { transactionTypeId: id } });
    if (count > 0) throw new Error("事务类型已被库存记录使用，无法删除");
    await prisma.stockTransactionType.update({ where: { id }, data: { status: 0 } });
    return true;
  },
};
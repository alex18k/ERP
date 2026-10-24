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
    // 关闭货位管理前，需确保该仓库没有货位维度的库存
    if (exists.binManaged && data.binManaged === false) {
      const binStock = await prisma.stock.findFirst({ where: { warehouseId: id, binId: { not: null } } });
      if (binStock) throw new Error("该仓库存在货位库存，请先清空货位库存后再关闭货位管理");
    }
    // 停用仓库前，需确保没有库存和批次库存（停用后所有出入库都会被拒绝）
    if (exists.status === 1 && data.status === 0) {
      const [stockCount, batchCount] = await Promise.all([
        prisma.stock.count({ where: { warehouseId: id, quantity: { gt: 1e-6 } } }),
        prisma.materialBatch.count({ where: { warehouseId: id, quantity: { gt: 1e-6 } } }),
      ]);
      if (stockCount > 0 || batchCount > 0) {
        throw new Error("该仓库仍有库存/批次库存，请先清空或移库后再停用");
      }
    }
    return prisma.warehouse.update({ where: { id }, data });
  },
  remove: async (id: number) => {
    const exists = await prisma.warehouse.findUnique({ where: { id } });
    if (!exists) throw new Error("仓库不存在");
    const count = await prisma.stock.count({ where: { warehouseId: id } });
    if (count > 0) throw new Error("仓库中还有库存，无法删除");
    const recordCount = await prisma.stockRecord.count({ where: { warehouseId: id } });
    if (recordCount > 0) throw new Error(`仓库存在 ${recordCount} 条库存事务记录，无法删除`);
    const binCount = await prisma.warehouseBin.count({ where: { warehouseId: id } });
    if (binCount > 0) throw new Error(`仓库下还有 ${binCount} 个货位，无法删除`);
    await prisma.warehouse.delete({ where: { id } });
    return true;
  },
};

// ===== 货位（仓库下的存放位置）=====
export const warehouseBinService = {
  list: async (where: any) => {
    const { page = 1, pageSize = 20, keyword, warehouseId, status } = where;
    const filters: Record<string, any> = {};
    if (warehouseId) filters.warehouseId = Number(warehouseId);
    if (status !== undefined && status !== "" && status !== null) filters.status = Number(status);
    if (keyword) {
      filters.OR = [
        { code: { contains: keyword } },
        { name: { contains: keyword } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.warehouseBin.count({ where: filters }),
      prisma.warehouseBin.findMany({
        where: filters,
        include: { warehouse: { select: { id: true, code: true, name: true } } },
        orderBy: [{ warehouseId: "asc" }, { code: "asc" }],
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
      }),
    ]);
    return { total, page: Number(page), pageSize: Number(pageSize), items };
  },
  get: (id: number) =>
    prisma.warehouseBin.findUnique({ where: { id }, include: { warehouse: { select: { id: true, code: true, name: true } } } }),
  create: async (data: any) => {
    const warehouseId = Number(data.warehouseId);
    if (!warehouseId) throw new Error("请选择所属仓库");
    const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) throw new Error("仓库不存在");
    if (!warehouse.binManaged) throw new Error("该仓库未启用货位管理，请先在仓库维护中开启");
    const code = String(data.code ?? "").trim();
    const name = String(data.name ?? "").trim();
    if (!code) throw new Error("请输入货位编码");
    if (!name) throw new Error("请输入货位名称");
    const dup = await prisma.warehouseBin.findFirst({ where: { warehouseId, code } });
    if (dup) throw new Error("该仓库下货位编码已存在");
    return prisma.warehouseBin.create({
      data: { warehouseId, code, name, status: data.status ?? 1, remark: data.remark ?? null },
    });
  },
  update: async (id: number, data: any) => {
    const exists = await prisma.warehouseBin.findUnique({ where: { id } });
    if (!exists) throw new Error("货位不存在");
    const warehouseId = data.warehouseId ? Number(data.warehouseId) : exists.warehouseId;
    const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) throw new Error("仓库不存在");
    if (!warehouse.binManaged) throw new Error("该仓库未启用货位管理，请先在仓库维护中开启");
    // 已有库存/批次/流水的货位禁止跨仓库改挂，否则库存归属会与货位仓库不一致（产生“孤儿库存”）
    if (warehouseId !== exists.warehouseId) {
      const [stockCount, batchCount, recordCount] = await Promise.all([
        prisma.stock.count({ where: { binId: id } }),
        prisma.materialBatch.count({ where: { binId: id } }),
        prisma.stockRecord.count({ where: { binId: id } }),
      ]);
      if (stockCount > 0 || batchCount > 0 || recordCount > 0) {
        throw new Error("该货位已有库存/批次/事务记录，不能更换所属仓库");
      }
    }
    // 停用货位前需确保没有库存和批次库存
    if (exists.status === 1 && data.status !== undefined && Number(data.status) === 0) {
      const [stockCount, batchCount] = await Promise.all([
        prisma.stock.count({ where: { binId: id, quantity: { gt: 1e-6 } } }),
        prisma.materialBatch.count({ where: { binId: id, quantity: { gt: 1e-6 } } }),
      ]);
      if (stockCount > 0 || batchCount > 0) {
        throw new Error("该货位仍有库存/批次库存，请先清空或移库后再停用");
      }
    }
    const code = data.code !== undefined ? String(data.code).trim() : exists.code;
    const name = data.name !== undefined ? String(data.name).trim() : exists.name;
    if (!code) throw new Error("请输入货位编码");
    if (!name) throw new Error("请输入货位名称");
    const dup = await prisma.warehouseBin.findFirst({ where: { warehouseId, code, NOT: { id } } });
    if (dup) throw new Error("该仓库下货位编码已存在");
    return prisma.warehouseBin.update({
      where: { id },
      data: {
        warehouseId,
        code,
        name,
        status: data.status ?? exists.status,
        remark: data.remark !== undefined ? data.remark : exists.remark,
      },
    });
  },
  remove: async (id: number) => {
    const exists = await prisma.warehouseBin.findUnique({ where: { id } });
    if (!exists) throw new Error("货位不存在");
    const [stockCount, batchCount, recordCount] = await Promise.all([
      prisma.stock.count({ where: { binId: id } }),
      prisma.materialBatch.count({ where: { binId: id } }),
      prisma.stockRecord.count({ where: { binId: id } }),
    ]);
    if (stockCount > 0) throw new Error("该货位下还有库存记录，无法删除");
    if (batchCount > 0) throw new Error("该货位下还有批次记录，无法删除");
    if (recordCount > 0) throw new Error(`该货位存在 ${recordCount} 条库存事务记录，无法删除`);
    await prisma.warehouseBin.delete({ where: { id } });
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

// ===== 部门/工位 =====
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
    if (!exists) throw new Error("部门不存在");
    return prisma.workshop.update({ where: { id }, data });
  },
  remove: async (id: number) => {
    const exists = await prisma.workshop.findUnique({ where: { id } });
    if (!exists) throw new Error("部门不存在");
    if (exists.status === 0) throw new Error("该部门已停用");
    const activeStationCount = await prisma.workstation.count({ where: { workshopId: id, status: 1 } });
    if (activeStationCount > 0) {
      throw new Error(`该部门下仍有 ${activeStationCount} 个有效工位，请先停用/转移后再删除`);
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
    const [stepCount, orderStepCount] = await Promise.all([
      prisma.processStep.count({ where: { workstationId: id } }),
      prisma.productionOrderStep.count({ where: { workstationId: id } }),
    ]);
    if (stepCount > 0 || orderStepCount > 0) {
      const parts: string[] = [];
      if (stepCount > 0) parts.push(`${stepCount} 处工艺路线工序`);
      if (orderStepCount > 0) parts.push(`${orderStepCount} 处订单工艺路线工序`);
      throw new Error(`该工位已被${parts.join("、")}引用，无法停用/删除`);
    }
    await prisma.workstation.update({ where: { id }, data: { status: 0 } });
    return true;
  },
};

// ===== 库存事务类型 =====
// 单据前缀：可空；统一大写，只允许字母/数字，长度 1-10
function normalizeDocumentPrefix(value: any): string | null | undefined {
  if (value === undefined) return undefined;
  const prefix = String(value ?? "").trim().toUpperCase();
  if (!prefix) return null;
  if (!/^[A-Z0-9]{1,10}$/.test(prefix)) throw new Error("单据前缀只能包含字母和数字，长度不超过10");
  return prefix;
}

export const stockTransactionTypeService = {
  list: async (where: any) => {
    const { page = 1, pageSize = 20, keyword, status } = where;
    const filters: Record<string, any> = {};
    if (status !== undefined && status !== null && status !== "") filters.status = Number(status);
    if (keyword) {
      filters.OR = [
        { code: { contains: keyword } },
        { description: { contains: keyword } },
        { documentPrefix: { contains: keyword } },
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
        documentPrefix: normalizeDocumentPrefix(data.documentPrefix) ?? null,
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
        documentPrefix: normalizeDocumentPrefix(data.documentPrefix),
        direction: data.direction,
        status: data.status,
      },
    });
  },
  remove: async (id: number) => {
    const exists = await prisma.stockTransactionType.findUnique({ where: { id } });
    if (!exists) throw new Error("事务类型不存在");
    // 有库存流水引用时保留，保证历史记录可追溯；无引用则物理删除，避免“删了还在列表里”
    const count = await prisma.stockRecord.count({ where: { transactionTypeId: id } });
    if (count > 0) throw new Error(`事务类型已被 ${count} 条库存记录使用，无法删除`);
    await prisma.stockTransactionType.delete({ where: { id } });
    return true;
  },
};

// ===== 计量单位换算 =====
const materialRef = { select: { id: true, code: true, name: true, unit: true } };

export const unitConversionService = {
  list: async (where: any) => {
    const { page = 1, pageSize = 20, keyword, materialId } = where;
    const filters: Record<string, any> = {};
    if (materialId) filters.materialId = Number(materialId);
    if (keyword) {
      filters.OR = [
        { unit: { contains: keyword } },
        { material: { code: { contains: keyword } } },
        { material: { name: { contains: keyword } } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.materialUnitConversion.count({ where: filters }),
      prisma.materialUnitConversion.findMany({
        where: filters,
        include: { material: materialRef },
        orderBy: { id: "desc" },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
      }),
    ]);
    return { total, page: Number(page), pageSize: Number(pageSize), items };
  },
  get: (id: number) =>
    prisma.materialUnitConversion.findUnique({ where: { id }, include: { material: materialRef } }),
  create: async (data: any) => {
    const materialId = Number(data.materialId);
    if (!materialId) throw new Error("请选择物料");
    const material = await prisma.material.findUnique({ where: { id: materialId } });
    if (!material) throw new Error("物料不存在");
    const unit = String(data.unit ?? "").trim();
    if (!unit) throw new Error("请输入转换单位");
    if (unit === material.unit) throw new Error("转换单位不能与基本单位相同");
    const conversionRate = Number(data.conversionRate);
    if (!(conversionRate > 0)) throw new Error("换算率必须大于 0");
    const dup = await prisma.materialUnitConversion.findFirst({ where: { materialId, unit } });
    if (dup) throw new Error("该物料已存在相同的转换单位");
    return prisma.materialUnitConversion.create({
      data: { materialId, unit, conversionRate, remark: data.remark ?? null, status: data.status ?? 1 },
    });
  },
  update: async (id: number, data: any) => {
    const exists = await prisma.materialUnitConversion.findUnique({ where: { id } });
    if (!exists) throw new Error("换算关系不存在");
    const materialId = data.materialId ? Number(data.materialId) : exists.materialId;
    const material = await prisma.material.findUnique({ where: { id: materialId } });
    if (!material) throw new Error("物料不存在");
    const unit = data.unit !== undefined ? String(data.unit).trim() : exists.unit;
    if (!unit) throw new Error("请输入转换单位");
    if (unit === material.unit) throw new Error("转换单位不能与基本单位相同");
    const conversionRate = data.conversionRate !== undefined ? Number(data.conversionRate) : exists.conversionRate;
    if (!(conversionRate > 0)) throw new Error("换算率必须大于 0");
    const dup = await prisma.materialUnitConversion.findFirst({ where: { materialId, unit, NOT: { id } } });
    if (dup) throw new Error("该物料已存在相同的转换单位");
    return prisma.materialUnitConversion.update({
      where: { id },
      data: { materialId, unit, conversionRate, remark: data.remark !== undefined ? data.remark : exists.remark, status: data.status ?? exists.status },
    });
  },
  remove: async (id: number) => {
    const exists = await prisma.materialUnitConversion.findUnique({ where: { id } });
    if (!exists) throw new Error("换算关系不存在");
    await prisma.materialUnitConversion.delete({ where: { id } });
    return true;
  },
};

// ===== 物料类别 =====
export const materialCategoryService = {
  list: async (where: any) => {
    const { page = 1, pageSize = 20, keyword, status } = where;
    const filters: Record<string, any> = {};
    if (keyword) filters.name = { contains: keyword };
    if (status !== undefined && status !== "" && status !== null) filters.status = Number(status);
    const [total, items] = await Promise.all([
      prisma.materialCategory.count({ where: filters }),
      prisma.materialCategory.findMany({
        where: filters,
        orderBy: { name: "asc" },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
      }),
    ]);
    return { total, page: Number(page), pageSize: Number(pageSize), items };
  },
  get: (id: number) => prisma.materialCategory.findUnique({ where: { id } }),
  create: async (data: any) => {
    const name = String(data.name ?? "").trim();
    if (!name) throw new Error("请输入物料类别名称");
    const dup = await prisma.materialCategory.findUnique({ where: { name } });
    if (dup) throw new Error("该物料类别已存在");
    return prisma.materialCategory.create({
      data: { name, status: data.status ?? 1, remark: data.remark ?? null },
    });
  },
  update: async (id: number, data: any) => {
    const exists = await prisma.materialCategory.findUnique({ where: { id } });
    if (!exists) throw new Error("物料类别不存在");
    const name = data.name !== undefined ? String(data.name).trim() : exists.name;
    if (!name) throw new Error("请输入物料类别名称");
    const dup = await prisma.materialCategory.findFirst({ where: { name, NOT: { id } } });
    if (dup) throw new Error("该物料类别已存在");
    const status = data.status !== undefined ? data.status : exists.status;
    const remark = data.remark !== undefined ? data.remark : exists.remark;
    return prisma.$transaction(async (tx) => {
      const updated = await tx.materialCategory.update({ where: { id }, data: { name, status, remark } });
      // 重命名时同步物料主文件中引用该类别名称的记录，避免类别名与物料数据不一致
      if (name !== exists.name) {
        await tx.material.updateMany({ where: { materialType: exists.name }, data: { materialType: name } });
      }
      return updated;
    });
  },
  remove: async (id: number) => {
    const exists = await prisma.materialCategory.findUnique({ where: { id } });
    if (!exists) throw new Error("物料类别不存在");
    const used = await prisma.material.count({ where: { materialType: exists.name } });
    if (used > 0) throw new Error(`该类别已被 ${used} 个物料使用，无法删除`);
    await prisma.materialCategory.delete({ where: { id } });
    return true;
  },
};
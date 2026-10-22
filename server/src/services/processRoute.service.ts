import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";

export interface ProcessRouteCreateInput {
  code: string;
  name: string;
  description?: string;
  processes: {
    id?: number;
    code: string;
    name: string;
    sequence: number;
    workstationId?: number;
    standardTime?: number;
    setupTime?: number;
  }[];
}

export async function listProcessRoutes(where: any) {
  const { code, name, page = 1, pageSize = 20 } = where;

  const filters: Prisma.ProcessRouteWhereInput = {};
  if (code) filters.code = { contains: code };
  if (name) filters.name = { contains: name };

  const [total, items] = await Promise.all([
    prisma.processRoute.count({ where: filters }),
    prisma.processRoute.findMany({
      where: filters,
      include: {
        materials: { select: { id: true, code: true, name: true, category: true } },
        processes: {
          include: { workstation: { select: { id: true, code: true, name: true } } },
          orderBy: { sequence: "asc" },
        },
      },
      orderBy: { code: "asc" },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);

  return { total, page: Number(page), pageSize: Number(pageSize), items };
}

export async function getProcessRoute(id: number) {
  return prisma.processRoute.findUnique({
    where: { id },
    include: {
      materials: { select: { id: true, code: true, name: true, category: true } },
      processes: { include: { workstation: true }, orderBy: { sequence: "asc" } },
    },
  });
}

export async function createProcessRoute(data: ProcessRouteCreateInput) {
  const exists = await prisma.processRoute.findUnique({ where: { code: data.code } });
  if (exists) throw new Error("工艺路线编码已存在");

  if (!data.processes || data.processes.length === 0) {
    throw new Error("工艺路线至少需要一个工序");
  }

  return prisma.$transaction(async (tx) => {
    const totalTime = data.processes.reduce((sum, p) => sum + (p.standardTime ?? 0) + (p.setupTime ?? 0), 0);

    const route = await tx.processRoute.create({
      data: {
        code: data.code,
        name: data.name,
        description: data.description,
        totalTime,
      },
    });

    for (const p of data.processes) {
      await tx.processStep.create({
        data: {
          routeId: route.id,
          code: p.code,
          name: p.name,
          sequence: p.sequence,
          workstationId: p.workstationId,
          standardTime: p.standardTime ?? 0,
          setupTime: p.setupTime ?? 0,
        },
      });
    }

    return tx.processRoute.findUnique({
      where: { id: route.id },
      include: { materials: { select: { id: true, code: true, name: true, category: true } }, processes: true },
    });
  });
}

export async function updateProcessRoute(id: number, data: Partial<ProcessRouteCreateInput>) {
  const exists = await prisma.processRoute.findUnique({ where: { id } });
  if (!exists) throw new Error("工艺路线不存在");

  return prisma.$transaction(async (tx) => {
    let totalTime: number | undefined;
    if (data.processes) {
      totalTime = data.processes.reduce(
        (sum, p) => sum + (p.standardTime ?? 0) + (p.setupTime ?? 0),
        0
      );
    }

    const route = await tx.processRoute.update({
      where: { id },
      data: {
        code: data.code,
        name: data.name,
        description: data.description,
        totalTime,
      },
    });

    if (data.processes) {
      // 保留已有工序 id，就地更新，避免删除被加工单引用的工序（外键约束）
      const incomingIds = data.processes.filter((p) => p.id).map((p) => p.id as number);
      const existing = await tx.processStep.findMany({ where: { routeId: id }, select: { id: true } });
      const toDelete = existing.filter((e) => !incomingIds.includes(e.id)).map((e) => e.id);
      if (toDelete.length > 0) {
        const referenced = await tx.productionOrderStep.count({ where: { sourceStepId: { in: toDelete } } });
        if (referenced > 0) throw new Error("该工艺路线的部分工序已被生产订单工艺路线引用，无法删除");
        await tx.processStep.deleteMany({ where: { id: { in: toDelete } } });
      }
      for (const p of data.processes) {
        const stepData = {
          code: p.code,
          name: p.name,
          sequence: p.sequence,
          workstationId: p.workstationId,
          standardTime: p.standardTime ?? 0,
          setupTime: p.setupTime ?? 0,
        };
        if (p.id) {
          await tx.processStep.update({ where: { id: p.id }, data: stepData });
        } else {
          await tx.processStep.create({ data: { routeId: id, ...stepData } });
        }
      }
    }

    return tx.processRoute.findUnique({
      where: { id: route.id },
      include: { materials: { select: { id: true, code: true, name: true, category: true } }, processes: true },
    });
  });
}

export async function deleteProcessRoute(id: number) {
  const exists = await prisma.processRoute.findUnique({ where: { id } });
  if (!exists) throw new Error("工艺路线不存在");

  const used = await prisma.productionOrderRoute.count({ where: { sourceRouteId: id } });
  if (used > 0) throw new Error("工艺路线已被生产订单使用，无法删除");

  const usedByMaterials = await prisma.material.count({ where: { processRouteId: id } });
  if (usedByMaterials > 0) throw new Error(`工艺路线已被 ${usedByMaterials} 个物料引用，无法删除`);

  await prisma.$transaction(async (tx) => {
    await tx.processStep.deleteMany({ where: { routeId: id } });
    await tx.processRoute.delete({ where: { id } });
  });
  return true;
}
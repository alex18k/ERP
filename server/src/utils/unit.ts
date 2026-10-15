import prisma from "../config/prisma";

type Client = {
  material: any;
  materialUnitConversion: any;
};

const DEFAULT_CLIENT = prisma as unknown as Client;

/** 数量按换算率转基本单位（保留 6 位精度，规避浮点误差） */
export function toBaseQty(quantity: number, rate: number): number {
  return Math.round(quantity * rate * 1e6) / 1e6;
}

/**
 * 解析某物料某计量单位对应的换算率。
 * - 单位为空或等于物料基本单位 → 1
 * - 命中已维护的换算关系 → conversionRate
 * - 未维护 → 抛错
 */
export async function resolveUnitRate(
  materialId: number,
  unit?: string | null,
  client: Client = DEFAULT_CLIENT
): Promise<{ rate: number; baseUnit: string }> {
  const material = await client.material.findUnique({ where: { id: materialId }, select: { unit: true } });
  if (!material) throw new Error("物料不存在");
  const u = (unit ?? "").trim();
  if (!u || u === material.unit) return { rate: 1, baseUnit: material.unit };
  const conv = await client.materialUnitConversion.findFirst({ where: { materialId, unit: u, status: 1 } });
  if (!conv) throw new Error(`单位「${u}」未维护换算关系（物料基本单位为 ${material.unit}）`);
  return { rate: conv.conversionRate, baseUnit: material.unit };
}

/** 批量解析换算率，返回 materialId → { rate, baseUnit }（一次查询物料 + 一次查询换算关系） */
export async function resolveUnitRateMap(
  rows: { materialId: number; unit?: string | null }[],
  client: Client = DEFAULT_CLIENT
): Promise<Map<number, { rate: number; baseUnit: string }>> {
  const materialIds = [...new Set(rows.map((r) => r.materialId).filter(Boolean))];
  const materials = await client.material.findMany({ where: { id: { in: materialIds } }, select: { id: true, unit: true } });
  const unitById = new Map<number, string>(materials.map((m: any) => [m.id, m.unit]));
  const convoys = await client.materialUnitConversion.findMany({ where: { materialId: { in: materialIds }, status: 1 } });
  const convMap = new Map<string, number>();
  for (const c of convoys as any[]) convMap.set(`${c.materialId}|${c.unit}`, c.conversionRate);

  const result = new Map<number, { rate: number; baseUnit: string }>();
  for (const row of rows) {
    const baseUnit = unitById.get(row.materialId);
    if (!baseUnit) throw new Error("物料不存在");
    const u = (row.unit ?? "").trim();
    if (!u || u === baseUnit) {
      result.set(row.materialId, { rate: 1, baseUnit });
      continue;
    }
    const rate = convMap.get(`${row.materialId}|${u}`);
    if (rate === undefined) throw new Error(`单位「${u}」未维护换算关系（物料基本单位为 ${baseUnit}）`);
    result.set(row.materialId, { rate, baseUnit });
  }
  return result;
}

// 从 StockRecord 流水回填 MaterialBatch（按 物料×仓库×货位×批号 汇总 in-out）
// 包含非批号管理物料：这些物料若在出入库时录入了批号，也会走批号管控并记批次行
// 用法: npx tsx prisma/backfill-batches.ts
import prisma from "../src/config/prisma";

async function main() {
  const recs = await prisma.stockRecord.findMany({
    where: { batchNo: { not: null } },
    select: { materialId: true, warehouseId: true, binId: true, batchNo: true, type: true, quantity: true },
  });
  const m = new Map<string, { materialId: number; warehouseId: number; binId: number | null; batchNo: string; qty: number }>();
  for (const r of recs) {
    const k = `${r.materialId}|${r.warehouseId}|${r.binId ?? ""}|${r.batchNo}`;
    const delta = (r.type === "in" ? 1 : -1) * r.quantity;
    const cur = m.get(k);
    if (cur) cur.qty += delta;
    else m.set(k, { materialId: r.materialId, warehouseId: r.warehouseId, binId: r.binId, batchNo: r.batchNo as string, qty: delta });
  }
  for (const v of m.values()) {
    const existing = await prisma.materialBatch.findFirst({
      where: { materialId: v.materialId, warehouseId: v.warehouseId, binId: v.binId, batchNo: v.batchNo },
    });
    if (existing) {
      await prisma.materialBatch.update({ where: { id: existing.id }, data: { quantity: v.qty } });
    } else {
      await prisma.materialBatch.create({
        data: { materialId: v.materialId, warehouseId: v.warehouseId, binId: v.binId, batchNo: v.batchNo, quantity: v.qty },
      });
    }
  }
  console.log(`回填完成，共 ${m.size} 个批号`);
}

main().finally(() => prisma.$disconnect());

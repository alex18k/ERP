// 从 StockRecord 流水回填 MaterialBatch（按 物料×仓库×批号 汇总 in-out）
// 包含非批号管理物料：这些物料若在出入库时录入了批号，也会走批号管控并记批次行
// 用法: npx tsx prisma/backfill-batches.ts
import prisma from "../src/config/prisma";

async function main() {
  const recs = await prisma.stockRecord.findMany({
    where: { batchNo: { not: null } },
    select: { materialId: true, warehouseId: true, batchNo: true, type: true, quantity: true },
  });
  const m = new Map<string, number>();
  for (const r of recs) {
    const k = `${r.materialId}|${r.warehouseId}|${r.batchNo}`;
    m.set(k, (m.get(k) ?? 0) + (r.type === "in" ? 1 : -1) * r.quantity);
  }
  for (const [k, v] of m) {
    const [materialId, warehouseId, batchNo] = k.split("|");
    await prisma.materialBatch.upsert({
      where: { materialId_warehouseId_batchNo: { materialId: Number(materialId), warehouseId: Number(warehouseId), batchNo } },
      create: { materialId: Number(materialId), warehouseId: Number(warehouseId), batchNo, quantity: v },
      update: { quantity: v },
    });
  }
  console.log(`回填完成，共 ${m.size} 个批号`);
}

main().finally(() => prisma.$disconnect());

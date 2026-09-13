// 从 docs/BOM.csv 导入 BOM（单层 BOM；多级结构由 MRP 递归展开）
// 用法: npx tsx prisma/import-boms.ts [CSV路径]
// 说明:
//   1. 同一父件的同名子件行会按数量求和（含税/不含税价取最后一行）
//   2. desc2 以 "不用" 开头的行视为"未使用位"，不导入
//   3. 父件编码在物料主文件中不存在的，跳过该 BOM
//   4. 可重复执行（按 BOM编码 重建）
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import prisma from "../src/config/prisma";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const csvPath = process.argv[2] ?? join(scriptDir, "../../docs/BOM.csv");

// RFC4180 CSV 解析（支持引号内的逗号/换行/转义引号）
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function clean(v: string | undefined): string {
  return (v ?? "").replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, "").replace(/\s+/g, " ");
}

function toNum(v: string | undefined): number {
  const n = parseFloat(clean(v));
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const rows = parseCsv(readFileSync(csvPath, "utf-8"));
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const lines = rows.slice(1).filter((r) => r.length >= 2 && clean(r[idx["ps_par"]]));

  const materials = await prisma.material.findMany({ select: { code: true, id: true, unit: true } });
  const matById = new Map(materials.map((m) => [m.code, m]));

  // 按父件聚合：qty 求和
  type Agg = { comp: string; qty: number; skippedNotUsed: boolean };
  const groups = new Map<string, Agg[]>();
  let lineTotal = 0;
  let lineNotUsed = 0;
  let lineInvalid = 0;
  let lineNoComp = 0;

  for (const r of lines) {
    lineTotal++;
    const par = clean(r[idx["ps_par"]]);
    const comp = clean(r[idx["pt_part"]] || r[idx["ps_comp"]]);
    if (clean(r[idx["pt_status"]]) === "无效") { lineInvalid++; continue; }
    if (clean(r[idx["pt_desc2"]]).startsWith("不用")) { lineNotUsed++; continue; }
    if (!comp || !matById.has(comp)) { lineNoComp++; continue; }
    const qty = toNum(r[idx["ps_qty_per"]]);
    const list = groups.get(par) ?? [];
    const hit = list.find((a) => a.comp === comp);
    if (hit) hit.qty += qty;
    else list.push({ comp, qty, skippedNotUsed: false });
    groups.set(par, list);
  }

  // 每批建一个 BOM，重建 items，保证幂等
  let bomOk = 0;
  let bomSkipped = 0;
  let itemCount = 0;

  for (const [par, aggs] of groups) {
    const parent = matById.get(par);
    if (!parent) { bomSkipped++; continue; }
    const bomCode = "BOM-" + par;
    const bom = await prisma.bom.upsert({
      where: { code: bomCode },
      update: { name: par, productId: parent.id, status: "active" },
      create: { code: bomCode, name: par, productId: parent.id, version: "1.0", status: "active" },
    });

    await prisma.bomItem.deleteMany({ where: { bomId: bom.id } });
    const items = aggs.map((a, i) => ({
      bomId: bom.id,
      materialId: matById.get(a.comp)!.id,
      quantity: a.qty,
      unit: matById.get(a.comp)!.unit,
      lossRate: 0,
      sortOrder: i,
    }));
    await prisma.bomItem.createMany({ data: items });
    itemCount += items.length;
    bomOk++;
  }

  console.log(`✅ BOM 导入完成`);
  console.log(`   明细行: ${lineTotal}, 跳过(无效): ${lineInvalid}, 跳过(不用): ${lineNotUsed}, 跳过(无子件): ${lineNoComp}`);
  console.log(`   父件: ${groups.size}, 导入 BOM: ${bomOk}, 跳过(父件不在物料主文件): ${bomSkipped}`);
  console.log(`   BOM明细总数: ${itemCount}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
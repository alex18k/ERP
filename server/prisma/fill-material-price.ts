// 按 docs/物料主文件.csv 的 pt_price 回填物料「最近采购价 price」与「成本 cost」
// 用法: npx tsx prisma/fill-material-price.ts [CSV路径]
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import prisma from "../src/config/prisma";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const csvPath = process.argv[2] ?? join(scriptDir, "../../docs/物料主文件.csv");

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

const clean = (v: string | undefined) => (v ?? "").replace(/^\uFEFF+/, "").trim();
const toNum = (v: string | undefined) => {
  const n = parseFloat(clean(v));
  return Number.isFinite(n) ? n : 0;
};

async function main() {
  const rows = parseCsv(readFileSync(csvPath, "utf-8"));
  const idx = Object.fromEntries(rows[0].map((h, i) => [h, i]));

  const priceByCode = new Map<string, number>();
  for (const r of rows.slice(1)) {
    const code = clean(r[idx["pt_part"]]);
    if (code) priceByCode.set(code, toNum(r[idx["pt_price"]]));
  }

  const materials = await prisma.material.findMany({ select: { id: true, code: true, cost: true, price: true } });
  let matched = 0;
  let updated = 0;
  const changed: { code: string; fromPrice: number; fromCost: number; to: number }[] = [];

  for (const m of materials) {
    if (!priceByCode.has(m.code)) continue;
    matched++;
    const p = priceByCode.get(m.code)!;
    if (Math.abs(m.price - p) < 1e-9 && Math.abs(m.cost - p) < 1e-9) continue;
    changed.push({ code: m.code, fromPrice: m.price, fromCost: m.cost, to: p });
    await prisma.material.update({ where: { id: m.id }, data: { price: p, cost: p } });
    updated++;
  }

  console.log("✅ 物料价格回填完成");
  console.log(`   匹配编码: ${matched}, 更新: ${updated}`);
  for (const c of changed) {
    console.log(`   ${c.code}: price ${c.fromPrice} → ${c.to}, cost ${c.fromCost} → ${c.to}`);
  }
}

main()
  .catch((e) => {
    console.error("物料价格回填失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

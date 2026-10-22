// 从 docs/库位文件.csv 导入库位（映射为仓库：编码=库位编码，名称=库位描述）
// 用法: npx tsx prisma/import-locations.ts [CSV路径]
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import prisma from "../src/config/prisma";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const csvPath = process.argv[2] ?? join(scriptDir, "../../docs/库位文件.csv");

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

async function main() {
  const rows = parseCsv(readFileSync(csvPath, "utf-8"));
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const lines = rows.slice(1).filter((r) => r.length >= 2 && clean(r[idx["loc_loc"]]));

  let created = 0;
  let updated = 0;
  for (const r of lines) {
    const code = clean(r[idx["loc_loc"]]);
    const name = clean(r[idx["loc_desc"]]) || code;
    const existing = await prisma.warehouse.findUnique({ where: { code } });
    if (existing) {
      await prisma.warehouse.update({ where: { code }, data: { name } });
      updated++;
    } else {
      await prisma.warehouse.create({ data: { code, name, status: 1 } });
      created++;
    }
  }

  console.log(`✅ 库位导入完成（映射为仓库）`);
  console.log(`   读取行数: ${lines.length}, 新导入: ${created}, 更新: ${updated}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

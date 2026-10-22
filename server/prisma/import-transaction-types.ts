// 从 docs/事务类型文件.csv 导入库存事务类型
// 用法: npx tsx prisma/import-transaction-types.ts [CSV路径]
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import prisma from "../src/config/prisma";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const csvPath = process.argv[2] ?? join(scriptDir, "../../docs/事务类型文件.csv");

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

// 现有单据的默认前缀（重置库后保持收货单号仍以 RC 开头）
const DEFAULT_PREFIXES: Record<string, string> = {
  "RCT-PO": "RC",
  "ISS-SO": "ISSSO",
  "ISS-TR": "TR",
  "RCT-TR": "TR",
};

async function main() {
  const rows = parseCsv(readFileSync(csvPath, "utf-8"));
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const lines = rows.slice(1).filter((r) => r.length >= 2 && clean(r[idx["type_code"]]));

  let created = 0;
  let updated = 0;
  for (const r of lines) {
    const code = clean(r[idx["type_code"]]);
    const description = clean(r[idx["type_desc"]]) || code;
    const dir = clean(r[idx["type_dir"]]) === "+" ? "in" : "out";
    const existing = await prisma.stockTransactionType.findUnique({ where: { code } });
    if (existing) {
      await prisma.stockTransactionType.update({
        where: { code },
        data: {
          description,
          direction: dir,
          ...(existing.documentPrefix == null && DEFAULT_PREFIXES[code] ? { documentPrefix: DEFAULT_PREFIXES[code] } : {}),
        },
      });
      updated++;
    } else {
      await prisma.stockTransactionType.create({ data: { code, description, direction: dir, status: 1, documentPrefix: DEFAULT_PREFIXES[code] ?? null } });
      created++;
    }
  }

  console.log(`✅ 事务类型导入完成`);
  console.log(`   读取行数: ${lines.length}, 新导入: ${created}, 更新: ${updated}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

// 从 docs/供应商文件.csv 导入供应商
// 用法: npx tsx prisma/import-suppliers.ts [CSV路径]
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import prisma from "../src/config/prisma";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const csvPath = process.argv[2] ?? join(scriptDir, "../../docs/供应商文件.csv");

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
  const lines = rows.slice(1).filter((r) => r.length >= 2 && clean(r[idx["vd_code"]]));

  const records = lines.map((r) => {
    const address = [r[idx["vd_state"]], r[idx["vd_city"]], r[idx["vd_addr1"]], r[idx["vd_addr2"]], r[idx["vd_addr3"]]]
      .map(clean).filter(Boolean).join(" ");
    const term = clean(r[idx["vd_term"]]);
    const taxin = clean(r[idx["vd_taxin"]]);
    const tel2 = clean(r[idx["vd_tel2"]]);
    const remark = [
      term ? `结算:${term}` : "",
      taxin === "1" ? "含税" : taxin === "0" ? "不含税" : "",
      tel2 ? `电话2:${tel2}` : "",
    ].filter(Boolean).join("；") || null;

    return {
      code: clean(r[idx["vd_code"]]),
      name: clean(r[idx["vd_name"]]),
      contactPerson: clean(r[idx["vd_attention"]]) || null,
      phone: clean(r[idx["vd_tel1"]]) || null,
      address: address || null,
      type: clean(r[idx["vd_type"]]) || null,
      settleMethod: term || null,
      remark: [
        taxin === "1" ? "含税" : taxin === "0" ? "不含税" : "",
        tel2 ? `电话2:${tel2}` : "",
      ].filter(Boolean).join("；") || null,
      status: 1,
    };
  });

  // 清理后仍可能重复的编码（首尾空白差异），保留首行；对去重后的行执行 upsert（幂等）
  const seen = new Set<string>();
  const unique = records.filter((r) => {
    if (seen.has(r.code)) return false;
    seen.add(r.code);
    return true;
  });

  const existing = await prisma.supplier.findMany({
    where: { code: { in: unique.map((r) => r.code) } },
    select: { code: true },
  });
  const existed = new Set(existing.map((s) => s.code));

  let created = 0;
  let updated = 0;
  for (const rec of unique) {
    if (existed.has(rec.code)) {
      await prisma.supplier.update({ where: { code: rec.code }, data: { settleMethod: rec.settleMethod, remark: rec.remark } });
      updated++;
    } else {
      await prisma.supplier.create({ data: rec });
      created++;
    }
  }

  console.log(`✅ 供应商导入完成`);
  console.log(`   读取行数: ${lines.length}, 去重后: ${unique.length}, 新导入: ${created}, 更新(回填结算方式): ${updated}, 跳过(重复): ${lines.length - unique.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
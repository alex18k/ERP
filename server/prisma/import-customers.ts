// 从 docs/客户文件.csv 导入客户
// 用法: npx tsx prisma/import-customers.ts [CSV路径]
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import prisma from "../src/config/prisma";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const csvPath = process.argv[2] ?? join(scriptDir, "../../docs/客户文件.csv");

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

// 去掉导出数值带的 ".0" 尾巴
function cleanPhone(v: string | undefined): string | null {
  const s = clean(v).replace(/\.0$/, "");
  return s || null;
}

async function main() {
  const rows = parseCsv(readFileSync(csvPath, "utf-8"));
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const lines = rows.slice(1).filter((r) => r.length >= 2 && clean(r[idx["cs_code"]]));

  const records = lines.map((r) => {
    const address = [clean(r[idx["cs_state"]]), clean(r[idx["cs_city"]]), clean(r[idx["cs_addr1"]])]
      .filter(Boolean).join(" ");
    const term = clean(r[idx["cs_term"]]);
    const taxin = clean(r[idx["cs_taxin"]]);
    const tax = clean(r[idx["cs_tax"]]);

    return {
      code: clean(r[idx["cs_code"]]),
      name: clean(r[idx["cs_name"]]) || clean(r[idx["cs_code"]]),
      contactPerson: clean(r[idx["cs_attention"]]) || null,
      phone: cleanPhone(r[idx["cs_tel1"]]),
      address: address || null,
      type: clean(r[idx["cs_type"]]) || null,
      seller: clean(r[idx["cs_slspsn"]]) || null,
      settleMethod: term || null,
      remark: [
        taxin === "1" ? "含税" : taxin === "0" ? "不含税" : "",
        tax ? `税率:${tax}` : "",
      ].filter(Boolean).join("；") || null,
      status: 1,
    };
  });

  // 去重（保留首行）；对去重后的行 upsert（幂等）
  const seen = new Set<string>();
  const unique = records.filter((r) => {
    if (seen.has(r.code)) return false;
    seen.add(r.code);
    return true;
  });

  const existing = await prisma.customer.findMany({
    where: { code: { in: unique.map((r) => r.code) } },
    select: { code: true },
  });
  const existed = new Set(existing.map((c) => c.code));

  let created = 0;
  let updated = 0;
  for (const rec of unique) {
    if (existed.has(rec.code)) {
      await prisma.customer.update({
        where: { code: rec.code },
        data: { settleMethod: rec.settleMethod, seller: rec.seller, remark: rec.remark },
      });
      updated++;
    } else {
      await prisma.customer.create({ data: rec });
      created++;
    }
  }

  console.log(`✅ 客户导入完成`);
  console.log(`   读取行数: ${lines.length}, 去重后: ${unique.length}, 新导入: ${created}, 更新: ${updated}, 跳过(重复): ${lines.length - unique.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

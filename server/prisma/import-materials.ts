// 从 docs/物料主文件.csv 导入物料主文件（物料）
// 用法: npx tsx prisma/import-materials.ts [CSV路径]
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

function clean(v: string | undefined): string {
  return (v ?? "").replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, "").replace(/\s+/g, " ");
}

function toNum(v: string | undefined): number {
  const n = parseFloat(clean(v));
  return Number.isFinite(n) ? n : 0;
}

// 该表 desc1 为统一的"名称/类别"标签，真正的型号/规格在 desc2 及以后
const GENERIC_LABELS = new Set(["贴片品", "成品", "生产辅材", "样品", "PCB板", "PCB板生产工程费", "PCB板样品", "PCB板模具", "贸易与加工", "生产工艺", "设备"]);

// 属于"自制/成品"的类别（参与自制排产），其余一律按采购件导入
const MANUFACTURE_TYPES = new Set(["成品", "贴片品", "BOM"]);

async function main() {
  const rows = parseCsv(readFileSync(csvPath, "utf-8"));
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const dataRows = rows.slice(1).filter((r) => r.length >= 2 && r[idx["pt_part"]]);

  const records: any[] = [];
  let manufactureCount = 0;
  let deletedCount = 0;

  for (const r of dataRows) {
    const code = clean(r[idx["pt_part"]]);
    const partType = clean(r[idx["pt_part_type"]]);
    const desc1 = clean(r[idx["pt_desc1"]]);
    const desc2 = clean(r[idx["pt_desc2"]]);
    const desc3 = clean(r[idx["pt_desc3"]]);
    const desc4 = clean(r[idx["pt_desc4"]]);
    const desc5 = clean(r[idx["pt_desc5"]]);
    const desc6 = clean(r[idx["pt_desc6"]]);
    const label = clean(r[idx["pt_label"]]);
    const unit = clean(r[idx["pt_um"]]) || "PCS";

    const isGeneric = GENERIC_LABELS.has(desc1) || desc1 === partType;
    // 物料名称统一取 pt_desc1（主数据口径）
    const name = desc1 || code;
    const remaining = [isGeneric ? "" : desc2, desc3, desc4].filter(Boolean);
    const spec = remaining.join(" ") || null;

    const remark = [desc5, desc6, label].filter(Boolean).join("；") || null;

    if (clean(r[idx["pt_status"]]) === "无效") deletedCount++;

    records.push({
      code,
      name,
      specification: spec,
      category: MANUFACTURE_TYPES.has(partType) ? "manufacture" : "purchase",
      unit,
      safetyStock: toNum(r[idx["pt_sfty_stk"]]),
      minStock: 0,
      maxStock: 0,
      leadTime: 0,
      materialType: partType || null,
      minOrderQty: toNum(r[idx["pt_ord_min"]]),
      cost: toNum(r[idx["pt_price"]]),
      status: clean(r[idx["pt_status"]]) === "无效" ? 0 : 1,
      remark,
    });
    if (records[records.length - 1].category === "manufacture") manufactureCount++;
  }

  const existing = await prisma.material.findMany({ select: { code: true } });
  const existingCodes = new Set(existing.map((m) => m.code));

  // 清理后仍可能产生重复编码（如首尾空白差异），保留第一行，其余视为重复
  const seenCodes = new Set<string>();
  const rowsToInsert = records.filter((r) => {
    if (existingCodes.has(r.code) || seenCodes.has(r.code)) return false;
    seenCodes.add(r.code);
    return true;
  });
  const skipped = dataRows.length - rowsToInsert.length + (rowsToInsert.length - seenCodes.size);

  const batch = await prisma.material.createMany({ data: rowsToInsert });
  console.log(`✅ 导入完成`);
  console.log(`   读取行数: ${dataRows.length}, 新导入: ${batch.count}, 跳过(已存在/重复): ${skipped}`);
  console.log(`   类别: 自制 ${manufactureCount}, 采购 ${dataRows.length - manufactureCount}`);
  console.log(`   停用状态(无效): ${deletedCount}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
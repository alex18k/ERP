// 为「没有成本(cost=0)」的物料，按同类物料（同一 materialType）的**中位数成本**自动补填；
// 同类无有成本物料时回退到同一 category（purchase/manufacture）的中位数成本。
// 用法: npx tsx prisma/fill-material-cost.ts [--reset]
//   --reset: 先按 docs/无成本物料.csv 的清单把这些物料还原为 cost=0/price=0，再重填
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import prisma from "../src/config/prisma";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const resetCsv = join(scriptDir, "../../docs/无成本物料.csv");

const round4 = (n: number) => Math.round(n * 10000) / 10000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 读取清单 CSV 的物料编码（第一列，跳过表头）
function readResetCodes(): string[] {
  if (!existsSync(resetCsv)) return [];
  const lines = readFileSync(resetCsv, "utf-8").split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((l) => l.split(",")[0].replace(/^"|"$/g, "").trim()).filter(Boolean);
}

async function main() {
  const reset = process.argv.includes("--reset");
  let resetCount = 0;
  if (reset) {
    const codes = readResetCodes();
    if (codes.length) {
      const r = await prisma.material.updateMany({
        where: { code: { in: codes } },
        data: { cost: 0, price: 0 },
      });
      resetCount = r.count;
    }
  }

  const materials = await prisma.material.findMany({
    select: { id: true, code: true, category: true, materialType: true, cost: true, price: true },
  });

  // 同类（materialType）/ 同分类（category）成本中位数，仅统计 cost>0
  const typeVals = new Map<string, number[]>();
  const catVals = new Map<string, number[]>();
  for (const m of materials) {
    if (m.cost <= 0) continue;
    if (m.materialType) {
      const arr = typeVals.get(m.materialType) ?? [];
      arr.push(m.cost);
      typeVals.set(m.materialType, arr);
    }
    const arr = catVals.get(m.category) ?? [];
    arr.push(m.cost);
    catVals.set(m.category, arr);
  }
  const typeMed = new Map<string, number>();
  for (const [k, v] of typeVals) { const md = median(v); if (md != null) typeMed.set(k, md); }
  const catMed = new Map<string, number>();
  for (const [k, v] of catVals) { const md = median(v); if (md != null) catMed.set(k, md); }

  const noCost = materials.filter((m) => m.cost <= 0);
  const stats = new Map<string, { filled: number; skipped: number; value: number | null; source: string }>();
  let filled = 0;
  let skipped = 0;

  for (const m of noCost) {
    const typeKey = m.materialType ?? "(空)";
    let value: number | undefined;
    let source = "";
    if (m.materialType && typeMed.has(m.materialType)) {
      value = typeMed.get(m.materialType);
      source = `同类中位数(${m.materialType})`;
    } else if (catMed.has(m.category)) {
      value = catMed.get(m.category);
      source = `同分类中位数(${m.category})`;
    }

    const s = stats.get(typeKey) ?? { filled: 0, skipped: 0, value: null, source: "" };
    if (value === undefined) {
      s.skipped++; skipped++; stats.set(typeKey, s);
      continue;
    }
    const v = round4(value);
    s.filled++; s.value = v; s.source = source;
    stats.set(typeKey, s);
    filled++;

    const data: any = { cost: v };
    if (m.category === "purchase") data.price = v;
    await prisma.material.update({ where: { id: m.id }, data });
  }

  console.log("✅ 无成本物料自动补填完成");
  if (reset) console.log(`   已按清单还原: ${resetCount}`);
  console.log(`   无成本物料: ${noCost.length}, 已补填: ${filled}, 跳过: ${skipped}`);
  const rows = [...stats.entries()].sort((a, b) => b[1].filled - a[1].filled || b[1].skipped - a[1].skipped);
  for (const [type, s] of rows) {
    const val = s.value == null ? "-" : String(s.value);
    console.log(`   ${type}: 补填 ${s.filled}, 跳过 ${s.skipped}, 取值 ${val} (${s.source || "无可参考同类"})`);
  }
}

main()
  .catch((e) => {
    console.error("补填失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

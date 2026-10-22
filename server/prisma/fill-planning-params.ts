// 按物料类别（materialType）+ 规格描述，填写规划参数经验值：采购提前期、安全库存、最小订量。
// 规则：
//  - 采购件（category=purchase）：leadTime + safetyStock + minOrderQty
//  - 自制件（category=manufacture，即 BOM/成品/贴片品）：manufactureLeadTime + safetyStock，minOrderQty=1
//  - 只填当前为 0 的字段（保留 CSV 导入的历史非 0 值），可重复运行（幂等）
// 用法: npx tsx prisma/fill-planning-params.ts [--dry]
import prisma from "../src/config/prisma";

// [采购提前期(天), 安全库存(基本单位), 最小订量]
const PURCHASE_RULES: Record<string, [number, number, number]> = {
  // 阻容/被动件：通用料，库存深、提前期短
  贴片电阻: [7, 30000, 5000],
  贴片电容: [7, 12000, 4000],
  电解电容: [10, 5000, 1000],
  瓷片电容: [10, 5000, 4000],
  独石电容: [10, 5000, 4000],
  CBB电容: [10, 2000, 1000],
  安规电容: [12, 5000, 1000],
  Y电容: [12, 3000, 1000],
  涤沦电容: [10, 2000, 1000],
  色环电阻: [10, 5000, 5000],
  碳膜电阻: [10, 5000, 5000],
  金属膜电阻: [10, 5000, 5000],
  绕线电阻: [20, 2000, 1000],
  压敏电阻: [10, 5000, 1000],
  热敏电阻: [10, 2000, 1000],
  电感: [15, 2000, 1000],
  贴片电感: [15, 4000, 4000],
  工字电感: [20, 1000, 1000],
  共模电感: [18, 1000, 500],
  磁环电感: [18, 1000, 500],
  // 半导体：单价较高，库存浅
  贴片IC: [20, 1000, 1000],
  插件IC: [20, 2000, 1000],
  贴片MOS管: [10, 2000, 4000],
  MOS管: [10, 2000, 1000],
  贴片三极管: [10, 3000, 4000],
  三极管: [10, 2000, 1000],
  贴片二极管: [10, 3000, 4000],
  插件二极管: [10, 5000, 1000],
  二极管: [10, 2000, 1000],
  整流桥: [18, 5000, 1000],
  贴片整流桥: [18, 2000, 1000],
  光耦: [15, 1000, 1000],
  稳压件: [15, 1000, 1000],
  晶振: [15, 1000, 1000],
  红外接收头: [15, 1000, 1000],
  保险: [10, 2000, 1000],
  模块: [25, 200, 50],
  // PCB/结构/定制件：按图按单，量少
  PCB板: [30, 1000, 100],
  PCB板样品: [15, 0, 1],
  PCB板模具: [15, 0, 1],
  PCB板生产工程费: [7, 0, 1],
  钢网: [10, 0, 1],
  外壳: [25, 200, 100],
  "JV05-Z外壳": [25, 200, 100],
  散热片: [20, 1000, 1000],
  骨架: [20, 1000, 1000],
  工字骨架: [20, 1000, 1000],
  磁芯: [25, 2000, 1000],
  变压器: [30, 3000, 1000],
  // 线材/端子：按卷按条
  端子: [10, 5000, 5000],
  端子线: [15, 3000, 1000],
  护套线: [15, 3000, 500],
  硅胶线: [15, 3000, 500],
  铁氟龙线: [15, 3000, 500],
  电子线: [15, 3000, 500],
  PVC线: [15, 3000, 500],
  地线: [15, 1000, 500],
  硅胶地线: [15, 1000, 500],
  // 辅料/指示/一次性
  生产辅材: [10, 500, 100],
  指示灯: [10, 2000, 1000],
  贴片指示灯: [10, 2000, 1000],
  样品: [7, 0, 1],
  设备: [45, 0, 1],
  生产工艺: [7, 0, 1],
  贸易与加工: [15, 0, 1],
};
const PURCHASE_DEFAULT: [number, number, number] = [10, 1000, 1000];

// 自制件：[制造提前期(天), 安全库存]
const MANUFACTURE_RULE: [number, number] = [5, 50];

// 描述微调：一次性/定制件不备库存、最小订量按 1
const ONEOFF_KEYWORDS = ["样品", "模具", "工程费", "加工费", "钢网", "设备"];

type Target = { lead?: number; mfgLead?: number; safe: number; moq: number };

function resolveTarget(m: { materialType: string | null; category: string; name: string; specification: string | null }): Target {
  const text = `${m.name} ${m.specification ?? ""}`;
  const isManufacture = m.category === "manufacture";

  let target: Target;
  if (isManufacture) {
    const [mfgLead, safe] = MANUFACTURE_RULE;
    target = { mfgLead, safe, moq: 1 };
  } else {
    const [lead, safe, moq] = PURCHASE_RULES[m.materialType ?? ""] ?? PURCHASE_DEFAULT;
    target = { lead, safe, moq };
  }

  if (ONEOFF_KEYWORDS.some((k) => text.includes(k))) {
    target.safe = 0;
    target.moq = 1;
  }
  if (text.includes("无库存")) target.safe = 0;
  return target;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const materials = await prisma.material.findMany({
    select: {
      id: true, materialType: true, category: true, name: true, specification: true,
      leadTime: true, manufactureLeadTime: true, safetyStock: true, minOrderQty: true,
    },
  });

  const updates: { id: number; data: Record<string, number> }[] = [];
  const stat = new Map<string, { n: number; lead: number; safe: number; moq: number }>();
  const touched = { lead: 0, mfgLead: 0, safe: 0, moq: 0 };

  for (const m of materials) {
    const t = resolveTarget(m);
    const data: Record<string, number> = {};
    // 只填 0 值，保留历史数据
    if (m.leadTime === 0 && t.lead) { data.leadTime = t.lead; touched.lead++; }
    if (m.manufactureLeadTime === 0 && t.mfgLead) { data.manufactureLeadTime = t.mfgLead; touched.mfgLead++; }
    if (m.safetyStock === 0 && t.safe) { data.safetyStock = t.safe; touched.safe++; }
    if (m.minOrderQty === 0 && t.moq) { data.minOrderQty = t.moq; touched.moq++; }
    if (Object.keys(data).length === 0) continue;
    updates.push({ id: m.id, data });

    const key = m.category === "manufacture" ? `${m.materialType ?? "<空>"} (自制)` : m.materialType ?? "<空>";
    const s = stat.get(key) ?? { n: 0, lead: 0, safe: 0, moq: 0 };
    s.n++;
    s.lead ||= data.leadTime ?? data.manufactureLeadTime ?? 0;
    s.safe ||= data.safetyStock ?? 0;
    s.moq ||= data.minOrderQty ?? 0;
    stat.set(key, s);
  }

  console.log(`待更新 ${updates.length}/${materials.length} 条 | 提前期 ${touched.lead} | 制造提前期 ${touched.mfgLead} | 安全库存 ${touched.safe} | 最小订量 ${touched.moq}`);
  if (dry) {
    console.table([...stat.entries()].sort((a, b) => b[1].n - a[1].n).map(([type, s]) => ({ 类别: type, 条数: s.n, 提前期: s.lead, 安全库存: s.safe, 最小订量: s.moq })));
    console.log("dry-run，未写入");
    return;
  }

  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map((u) => prisma.material.update({ where: { id: u.id }, data: u.data })),
      { timeout: 60000, maxWait: 10000 }
    );
    done += chunk.length;
    console.log(`已更新 ${done}/${updates.length}`);
  }
  console.log(`完成，共更新 ${done} 条`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

// 按物料类别（materialType）为所有物料随机填写提前期（leadTime；制造件同时填 manufactureLeadTime）
// 用法: npx tsx prisma/fill-lead-time.ts
import prisma from "../src/config/prisma";

// 各类别提前期取值区间 [min, max]（天）；未列出的类别用 DEFAULT_RANGE
const RANGE_BY_TYPE: Record<string, [number, number]> = {
  PCB板: [20, 45],
  PCB板样品: [10, 20],
  PCB板模具: [10, 20],
  PCB板生产工程费: [5, 15],
  变压器: [25, 45],
  磁芯: [20, 35],
  工字电感: [15, 30],
  共模电感: [10, 25],
  磁环电感: [10, 25],
  电感: [10, 20],
  贴片电感: [10, 20],
  贴片电阻: [3, 10],
  色环电阻: [5, 15],
  碳膜电阻: [5, 15],
  金属膜电阻: [5, 15],
  绕线电阻: [15, 30],
  贴片电容: [3, 10],
  贴片MOS管: [5, 15],
  MOS管: [5, 15],
  贴片三极管: [5, 15],
  三极管: [5, 15],
  贴片二极管: [5, 15],
  插件二极管: [5, 15],
  二极管: [5, 15],
  贴片IC: [10, 30],
  插件IC: [10, 30],
  整流桥: [10, 25],
  晶振: [10, 20],
  保险: [5, 15],
  光耦: [10, 20],
  压敏电阻: [5, 15],
  热敏电阻: [5, 15],
  外壳: [20, 40],
  "JV05-Z外壳": [20, 40],
  散热片: [15, 30],
  骨架: [15, 30],
  工字骨架: [15, 30],
  端子: [5, 15],
  端子线: [10, 20],
  护套线: [10, 20],
  硅胶线: [10, 20],
  铁氟龙线: [10, 20],
  电子线: [10, 20],
  钢网: [7, 15],
  模块: [20, 40],
  样品: [5, 15],
  设备: [30, 60],
  成品: [3, 10],
  贴片品: [3, 10],
  BOM: [3, 10],
  贸易与加工: [10, 25],
};
const DEFAULT_RANGE: [number, number] = [5, 15];
const MANUFACTURE_RANGE: [number, number] = [3, 10];

const randIn = ([min, max]: [number, number]) => min + Math.floor(Math.random() * (max - min + 1));

async function main() {
  const materials = await prisma.material.findMany({ select: { id: true, materialType: true, category: true } });
  let updated = 0;
  const BATCH = 500;
  for (let i = 0; i < materials.length; i += BATCH) {
    const chunk = materials.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map((m) => {
        const range = (m.materialType && RANGE_BY_TYPE[m.materialType]) || DEFAULT_RANGE;
        const data: { leadTime: number; manufactureLeadTime?: number } = { leadTime: randIn(range) };
        if (m.category === "manufacture") data.manufactureLeadTime = randIn(MANUFACTURE_RANGE);
        return prisma.material.update({ where: { id: m.id }, data });
      })
    );
    updated += chunk.length;
    console.log(`已更新 ${updated}/${materials.length}`);
  }
  console.log(`完成，共 ${updated} 条`);
}

main().finally(() => prisma.$disconnect());

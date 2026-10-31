import test, { after } from "node:test";
import assert from "node:assert/strict";
import prisma from "../config/prisma";
import { createMaterial, updateMaterial } from "./material.service";

const createdIds: number[] = [];

after(async () => {
  for (const id of createdIds) {
    await prisma.material.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function createValidMaterial(label: string) {
  const suffix = `${Date.now()}-${label}`;
  const material = await createMaterial({
    code: `T-MATVAL-${suffix}`,
    name: `测试物料-${label}`,
    category: "purchase",
    unit: "PCS",
    materialType: "电子件",
    location: "A01",
  });
  createdIds.push(material.id);
  return material;
}

async function expectCreateRejected(input: any, message: RegExp) {
  try {
    await assert.rejects(createMaterial(input), message);
  } finally {
    await prisma.material.deleteMany({ where: { code: input.code } });
  }
}

test("create rejects missing materialType", async () => {
  await expectCreateRejected(
    {
      code: `T-MATVAL-MISSING-TYPE-${Date.now()}`,
      name: "测试物料-缺少类别",
      category: "purchase",
      unit: "PCS",
      location: "A01",
    },
    /物料类别不能为空/,
  );
});

test("create rejects blank materialType", async () => {
  await expectCreateRejected(
    {
      code: `T-MATVAL-BLANK-TYPE-${Date.now()}`,
      name: "测试物料-空类别",
      category: "purchase",
      unit: "PCS",
      materialType: "  ",
      location: "A01",
    },
    /物料类别不能为空/,
  );
});

test("create rejects missing location", async () => {
  await expectCreateRejected(
    {
      code: `T-MATVAL-MISSING-LOCATION-${Date.now()}`,
      name: "测试物料-缺少库位",
      category: "purchase",
      unit: "PCS",
      materialType: "电子件",
    },
    /库位不能为空/,
  );
});

test("create rejects blank location", async () => {
  await expectCreateRejected(
    {
      code: `T-MATVAL-BLANK-LOCATION-${Date.now()}`,
      name: "测试物料-空库位",
      category: "purchase",
      unit: "PCS",
      materialType: "电子件",
      location: " ",
    },
    /库位不能为空/,
  );
});

test("update rejects blank materialType when provided", async () => {
  const material = await createValidMaterial("更新空类别");

  await assert.rejects(
    updateMaterial(material.id, { materialType: "  " }),
    /物料类别不能为空/,
  );
});

test("update rejects blank location when provided", async () => {
  const material = await createValidMaterial("更新空库位");

  await assert.rejects(
    updateMaterial(material.id, { location: "  " }),
    /库位不能为空/,
  );
});

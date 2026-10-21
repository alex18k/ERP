import prisma from "../config/prisma";

const FIELDS = [
  "nameZh",
  "nameEn",
  "region",
  "address",
  "phone",
  "fax",
  "email",
  "contact",
  "taxNo",
  "website",
  "remark",
] as const;

function pickFields(input: any) {
  const data: Record<string, any> = {};
  for (const key of FIELDS) {
    if (input[key] !== undefined) data[key] = input[key] == null ? null : String(input[key]).trim();
  }
  return data;
}

// 默认公司：其它页面统一从这里取公司名称
export async function getCompanyInfo() {
  return (
    (await prisma.companyInfo.findFirst({ where: { isDefault: true }, orderBy: { id: "asc" } })) ||
    (await prisma.companyInfo.findFirst({ orderBy: { id: "asc" } }))
  );
}

export async function listCompanies() {
  return prisma.companyInfo.findMany({ orderBy: [{ isDefault: "desc" }, { id: "asc" }] });
}

export async function createCompany(input: any) {
  const data = pickFields(input);
  if (!data.nameZh) throw new Error("公司中文名称不能为空");

  return prisma.$transaction(async (tx) => {
    const hasDefault = await tx.companyInfo.findFirst({ where: { isDefault: true } });
    if (!hasDefault) {
      data.isDefault = true;
      data.defaultedAt = new Date();
    }
    return tx.companyInfo.create({ data: data as any });
  });
}

export async function updateCompany(id: number, input: any) {
  const row = await prisma.companyInfo.findUnique({ where: { id } });
  if (!row) throw new Error("公司不存在");
  const data = pickFields(input);
  const nameZh = data.nameZh !== undefined ? data.nameZh : row.nameZh;
  if (!nameZh) throw new Error("公司中文名称不能为空");
  return prisma.companyInfo.update({ where: { id }, data });
}

export async function setDefaultCompany(id: number) {
  const row = await prisma.companyInfo.findUnique({ where: { id } });
  if (!row) throw new Error("公司不存在");
  if (row.isDefault) return row;
  return prisma.$transaction(async (tx) => {
    await tx.companyInfo.updateMany({ data: { isDefault: false } });
    return tx.companyInfo.update({
      where: { id },
      data: { isDefault: true, defaultedAt: row.defaultedAt || new Date() },
    });
  });
}

// 删除：默认公司正在被其它页面引用；曾被设为默认的公司名称可能已出现在历史单据中，两者都禁止删除
export async function deleteCompany(id: number) {
  const row = await prisma.companyInfo.findUnique({ where: { id } });
  if (!row) throw new Error("公司不存在");
  if (row.isDefault) throw new Error("默认公司正被其它页面引用，不能删除；请先把其它公司设为默认");
  if (row.defaultedAt) throw new Error("该公司曾作为默认公司被引用（历史单据可能使用其名称），不能删除");
  await prisma.companyInfo.delete({ where: { id } });
  return { success: true };
}

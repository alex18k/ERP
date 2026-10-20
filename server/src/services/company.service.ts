import prisma from "../config/prisma";

const SINGLETON_ID = 1;
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

export async function getCompanyInfo() {
  return prisma.companyInfo.findUnique({ where: { id: SINGLETON_ID } });
}

export async function updateCompanyInfo(input: any) {
  const data: Record<string, any> = {};
  for (const key of FIELDS) {
    if (input[key] !== undefined) data[key] = input[key] == null ? null : String(input[key]).trim();
  }
  const nameZh = data.nameZh !== undefined ? data.nameZh : (await getCompanyInfo())?.nameZh;
  if (!nameZh) throw new Error("公司中文名称不能为空");

  return prisma.companyInfo.upsert({
    where: { id: SINGLETON_ID },
    update: data,
    create: { id: SINGLETON_ID, nameZh, ...data },
  });
}

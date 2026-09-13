import prisma from "../config/prisma";
import { toCsv, today } from "../utils/export";

const categoryLabel: Record<string, string> = { purchase: "采购", manufacture: "制造" };

const saleStatusLabel: Record<string, string> = {
  draft: "草稿", confirmed: "已确认", in_production: "生产中", completed: "已完工", shipped: "已发货", cancelled: "已取消",
};

const purchaseStatusLabel: Record<string, string> = {
  draft: "草稿", confirmed: "已确认", partial_received: "部分到货", received: "已到货", cancelled: "已取消",
};

const workStatusLabel: Record<string, string> = {
  pending: "待开工", in_progress: "加工中", paused: "暂停", completed: "已完成", cancelled: "已取消",
};

const date = (d: Date | null | undefined) => (d ? new Date(d).toLocaleString("zh-CN", { hour12: false }) : "");

// ===== 物料 =====
export async function materialExport() {
  const list = await prisma.material.findMany({
    orderBy: { code: "asc" },
    include: { supplier: { select: { name: true } }, stocks: true },
  });
  const headers = ["物料编码", "物料名称", "规格型号", "物料类别", "类别", "单位", "安全库存", "最低库存", "最高库存", "提前期(天)", "最小订量", "单价", "成本", "默认供应商", "现存量", "状态", "备注"];
  const rows = list.map((m) => [
    m.code, m.name, m.specification, m.materialType ?? "", categoryLabel[m.category] ?? m.category, m.unit,
    m.safetyStock, m.minStock, m.maxStock, m.leadTime, m.minOrderQty, m.unitPrice, m.cost,
    m.supplier?.name ?? "", m.stocks.reduce((s, x) => s + x.quantity, 0),
    m.status === 1 ? "启用" : "停用", m.remark ?? "",
  ]);
  return { filename: `物料数据_${today()}.csv`, csv: toCsv(headers, rows) };
}

// ===== 销售订单 =====
export async function orderExport() {
  const list = await prisma.salesOrder.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { name: true } },
      items: { include: { material: { select: { code: true, name: true } } } },
    },
  });
  const headers = ["订单号", "客户", "订单日期", "交期", "状态", "金额", "订单明细"];
  const rows = list.map((o) => [
    o.orderNo,
    o.customer?.name ?? o.customerName,
    date(o.createdAt),
    date(o.deliveryDate),
    saleStatusLabel[o.status] ?? o.status,
    o.totalAmount,
    o.items.map((i) => `${i.material.code}×${i.quantity}`).join("; "),
  ]);
  return { filename: `销售订单_${today()}.csv`, csv: toCsv(headers, rows) };
}

// ===== 库存现况 =====
export async function stockExport() {
  const list = await prisma.stock.findMany({
    include: {
      material: { select: { code: true, name: true, category: true, unit: true, safetyStock: true } },
      warehouse: { select: { code: true, name: true } },
    },
    orderBy: { material: { code: "asc" } },
  });
  const headers = ["物料编码", "物料名称", "类别", "仓库", "现存量", "预占", "可用量", "安全库存", "是否预警"];
  const rows = list.map((s) => [
    s.material.code, s.material.name, categoryLabel[s.material.category] ?? s.material.category,
    s.warehouse?.name ?? "", s.quantity, s.reservedQty, s.quantity - s.reservedQty,
    s.material.safetyStock,
    s.material.safetyStock > 0 && s.quantity <= s.material.safetyStock ? "低库存" : "正常",
  ]);
  return { filename: `库存现况_${today()}.csv`, csv: toCsv(headers, rows) };
}

// ===== 加工单 =====
export async function workOrderExport() {
  const list = await prisma.workOrder.findMany({
    include: {
      productionOrder: { include: { material: { select: { code: true, name: true } } } },
      workstation: { select: { code: true, name: true } },
      operator: { select: { realName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const headers = ["加工单号", "所属生产订单", "产品编码", "产品名称", "工位", "操作人员", "计划数量", "完成数量", "报废数量", "进度", "状态", "创建时间"];
  const rows = list.map((w) => [
    w.orderNo,
    w.productionOrder.orderNo,
    w.productionOrder.material.code,
    w.productionOrder.material.name,
    w.workstation?.name ?? "",
    w.operator?.realName ?? "",
    w.plannedQty,
    w.actualQty,
    w.scrapQty,
    w.plannedQty > 0 ? `${Math.round((w.actualQty / w.plannedQty) * 100)}%` : "0%",
    workStatusLabel[w.status] ?? w.status,
    date(w.createdAt),
  ]);
  return { filename: `加工单_${today()}.csv`, csv: toCsv(headers, rows) };
}

// ===== 采购订单 =====
export async function purchaseExport() {
  const list = await prisma.purchaseOrder.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      supplier: { select: { name: true } },
      items: { include: { material: { select: { code: true, name: true } } } },
    },
  });
  const headers = ["采购单号", "供应商", "结算方式", "下单日期", "截止日期", "状态", "金额", "采购明细"];
  const rows = list.map((p) => [
    p.orderNo,
    p.supplier?.name ?? "",
    p.settleMethod ?? "",
    date(p.orderDate ?? p.createdAt),
    [...new Set(p.items.map((i) => date(i.expectedDate)).filter(Boolean))].join(", "),
    purchaseStatusLabel[p.status] ?? p.status,
    p.totalAmount,
    p.items.map((i) => `${i.material.code}×${i.quantity}${i.expectedDate ? `(截止${date(i.expectedDate)})` : ""}`).join("; "),
  ]);
  return { filename: `采购订单_${today()}.csv`, csv: toCsv(headers, rows) };
}
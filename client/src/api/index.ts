import request from './request'
import { downloadCsv } from '../utils/download'

export interface PageParams {
  page?: number
  pageSize?: number
  keyword?: string
  [key: string]: any
}

// ===== 认证 =====
export const authApi = {
  login: (data: { username: string; password: string }) =>
    request.post('/auth/login', data),
  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    request.post('/auth/change-password', data),
}

// ===== 物料 =====
export const materialApi = {
  list: (params: PageParams) => request.get('/materials', { params }),
  types: () => request.get('/materials/types'),
  options: (params?: any) => request.get('/materials/options', { params }),
  get: (id: number) => request.get(`/materials/${id}`),
  create: (data: any) => request.post('/materials', data),
  update: (id: number, data: any) => request.put(`/materials/${id}`, data),
  remove: (id: number) => request.delete(`/materials/${id}`),
  importData: (rows: any[]) => request.post('/materials/import', rows),
  recalcCost: () => request.post('/materials/recalc-cost'),
  exportCsv: () => downloadCsv('/materials/export', '物料数据'),
}

// ===== BOM =====
export const bomApi = {
  list: (params: PageParams) => request.get('/boms', { params }),
  productOptions: (params?: any) => request.get('/boms/product-options', { params }),
  get: (id: number) => request.get(`/boms/${id}`),
  getTree: (id: number) => request.get(`/boms/${id}/tree`),
  create: (data: any) => request.post('/boms', data),
  update: (id: number, data: any) => request.put(`/boms/${id}`, data),
  activate: (id: number) => request.put(`/boms/${id}/activate`),
  remove: (id: number) => request.delete(`/boms/${id}`),
  batchDelete: (ids: number[]) => request.post('/boms/batch-delete', { ids }),
}

// ===== 工艺路线 =====
export const processRouteApi = {
  list: (params: PageParams) => request.get('/process-routes', { params }),
  get: (id: number) => request.get(`/process-routes/${id}`),
  create: (data: any) => request.post('/process-routes', data),
  update: (id: number, data: any) => request.put(`/process-routes/${id}`, data),
  remove: (id: number) => request.delete(`/process-routes/${id}`),
}

// ===== 供应商/仓库/客户/工位 =====
export const supplierApi = {
  list: (params: PageParams) => request.get('/suppliers', { params }),
  create: (data: any) => request.post('/suppliers', data),
  update: (id: number, data: any) => request.put(`/suppliers/${id}`, data),
  remove: (id: number) => request.delete(`/suppliers/${id}`),
}

export const warehouseApi = {
  list: (params: PageParams) => request.get('/warehouses', { params }),
  create: (data: any) => request.post('/warehouses', data),
  update: (id: number, data: any) => request.put(`/warehouses/${id}`, data),
  remove: (id: number) => request.delete(`/warehouses/${id}`),
}

// ===== 货位（仓库下的存放位置）=====
export const warehouseBinApi = {
  list: (params: PageParams) => request.get('/warehouse-bins', { params }),
  create: (data: any) => request.post('/warehouse-bins', data),
  update: (id: number, data: any) => request.put(`/warehouse-bins/${id}`, data),
  remove: (id: number) => request.delete(`/warehouse-bins/${id}`),
}

export const customerApi = {
  list: (params: PageParams) => request.get('/customers', { params }),
  create: (data: any) => request.post('/customers', data),
  update: (id: number, data: any) => request.put(`/customers/${id}`, data),
  remove: (id: number) => request.delete(`/customers/${id}`),
}

export const workstationApi = {
  list: (params?: any) => request.get('/workstations', { params }),
  create: (data: any) => request.post('/workstations', data),
  update: (id: number, data: any) => request.put(`/workstations/${id}`, data),
  remove: (id: number) => request.delete(`/workstations/${id}`),
}

export const workshopApi = {
  list: () => request.get('/workshops'),
  create: (data: any) => request.post('/workshops', data),
  update: (id: number, data: any) => request.put(`/workshops/${id}`, data),
  remove: (id: number) => request.delete(`/workshops/${id}`),
}

export const unitConversionApi = {
  list: (params: PageParams) => request.get('/unit-conversions', { params }),
  create: (data: any) => request.post('/unit-conversions', data),
  update: (id: number, data: any) => request.put(`/unit-conversions/${id}`, data),
  remove: (id: number) => request.delete(`/unit-conversions/${id}`),
}

export const materialCategoryApi = {
  list: (params: PageParams) => request.get('/material-categories', { params }),
  create: (data: any) => request.post('/material-categories', data),
  update: (id: number, data: any) => request.put(`/material-categories/${id}`, data),
  remove: (id: number) => request.delete(`/material-categories/${id}`),
}

// ===== 销售订单 =====
export const orderApi = {
  list: (params: PageParams) => request.get('/sales-orders', { params }),
  options: (params?: any) => request.get('/sales-orders/options', { params }),
  get: (id: number) => request.get(`/sales-orders/${id}`),
  create: (data: any) => request.post('/sales-orders', data),
  update: (id: number, data: any) => request.put(`/sales-orders/${id}`, data),
  confirm: (id: number) => request.put(`/sales-orders/${id}/confirm`),
  cancel: (id: number, data?: any) => request.put(`/sales-orders/${id}/cancel`, data),
  ship: (id: number) => request.put(`/sales-orders/${id}/ship`),
  shippable: (params: PageParams) => request.get('/sales-orders/shippable', { params }),
  shipments: (params: PageParams) => request.get('/sales-orders/shipments', { params }),
  shipping: (id: number, data: any) => request.put(`/sales-orders/${id}/shipping`, data),
  track: (id: number) => request.get(`/sales-orders/${id}/track`),
  downstream: (id: number) => request.get(`/sales-orders/${id}/downstream`),
  overdue: () => request.get('/sales-orders/overdue'),
  exportCsv: () => downloadCsv('/sales-orders/export', '销售订单'),
}

// ===== MRP =====
export const mrpApi = {
  calculate: (data?: any) => request.post('/mrp/calculate', data),
  history: (params: PageParams) => request.get('/mrp/history', { params }),
  getRun: (id: number) => request.get(`/mrp/history/${id}`),
  shortage: () => request.get('/mrp/shortage'),
  generatePurchase: (suggestionIds?: number[], supplierOverrides?: Record<number, number>) =>
    request.post('/mrp/suggestion/generate-purchase', { suggestionIds, supplierOverrides }),
  safetyStockSuggest: () => request.post('/mrp/safety-stock-suggest'),
}

// ===== 生产 =====
export const productionApi = {
  orders: (params: PageParams) => request.get('/production/orders', { params }),
  planners: () => request.get('/production/planners'),
  employees: (params?: any) => request.get('/production/employees', { params }),
  issuedKeys: () => request.get('/production/orders/issued-keys'),
  createOrders: (data: any[]) => request.post('/production/orders', data),
  updateOrder: (id: number, data: any) => request.put(`/production/orders/${id}`, data),
  cancelOrder: (id: number) => request.put(`/production/orders/${id}/cancel`),
  schedule: (id: number, data?: any) => request.post(`/production/orders/${id}/schedule`, data),
  orderRoute: (id: number) => request.get(`/production/orders/${id}/route`),
  updateOrderRoute: (id: number, data: any) => request.put(`/production/orders/${id}/route`, data),
  replaceOrderRouteSteps: (id: number, steps: any[]) => request.put(`/production/orders/${id}/route/steps`, { steps }),
  batchMaterials: (params?: any) => request.get('/production/batch-materials', { params }),
  batchMaterialsOfBatch: (batchId: number) => request.get(`/production/batches/${batchId}/materials`),
  addBatchMaterial: (batchId: number, data: any) => request.post(`/production/batches/${batchId}/materials`, data),
  updateBatchMaterial: (id: number, data: any) => request.put(`/production/batch-materials/${id}`, data),
  deleteBatchMaterial: (id: number) => request.delete(`/production/batch-materials/${id}`),
  issueBatch: (batchId: number, data: any) => request.post(`/production/batches/${batchId}/issue`, data),
  receivableBatches: (params?: any) => request.get('/production/batches/receivable', { params }),
  receiveBatch: (id: number, data: any) => request.post(`/production/batches/${id}/receive`, data),
  reportBatch: (batchId: number, data: any) => request.post(`/production/batches/${batchId}/report`, data),
  batchReport: (productionOrderId: number, items: any[]) => request.post('/production/batch-report', { productionOrderId, items }),
  reports: (params: PageParams) => request.get('/production/reports', { params }),
  reporters: () => request.get('/production/reporters'),
  exportCsv: () => downloadCsv('/production/export', '生产批次'),
  exportEmployeeReports: (params?: any) => downloadCsv('/production/employee-report-export', '员工报工报表', params),
}

// ===== 采购 =====
export const purchaseApi = {
  list: (params: PageParams) => request.get('/purchase', { params }),
  options: (params?: any) => request.get('/purchase/options', { params }),
  buyers: () => request.get('/purchase/buyers'),
  get: (id: number) => request.get(`/purchase/${id}`),
  create: (data: any) => request.post('/purchase', data),
  update: (id: number, data: any) => request.put(`/purchase/${id}`, data),
  confirm: (id: number) => request.put(`/purchase/${id}/confirm`),
  updateStatus: (id: number, status: string) => request.put(`/purchase/${id}/status`, { status }),
  remove: (id: number) => request.delete(`/purchase/${id}`),
  receive: (id: number, data?: any) => request.put(`/purchase/${id}/receive`, data),
  arrival: () => request.get('/purchase/arrival'),
  receipts: (params: PageParams) => request.get('/purchase/receipts', { params }),
  receiptKeepers: () => request.get('/purchase/receipt-keepers'),
  returnReceipt: (id: number, data: any) => request.post(`/purchase/receipts/${id}/return`, data),
  returnOrders: (params: PageParams) => request.get('/purchase/return-orders', { params }),
  returnOrder: (id: number, data: any) => request.post(`/purchase/return-orders/${id}/return`, data),
  receiptDocuments: (params: PageParams) => request.get('/purchase/receipt-documents', { params }),
  returnReceiptDocument: (documentNo: string, data: any) => request.post(`/purchase/receipt-documents/${encodeURIComponent(documentNo)}/return`, data),
  exportCsv: () => downloadCsv('/purchase/export', '采购订单'),
}

// ===== 库存 =====
export const stockApi = {
  list: (params: PageParams) => request.get('/stocks', { params }),
  detail: (params: PageParams) => request.get('/stocks/detail', { params }),
  summary: (params: PageParams) => request.get('/stocks/summary', { params }),
  records: (params: PageParams) => request.get('/stocks/records', { params }),
  recordsByDocument: (documentNo: string) => request.get('/stocks/records/by-document', { params: { documentNo } }),
  handlers: (field?: string) => request.get('/stocks/handlers', { params: field ? { field } : undefined }),
  in: (data: any) => request.post('/stocks/in', data),
  out: (data: any) => request.post('/stocks/out', data),
  outBatch: (data: any) => request.post('/stocks/out-batch', data),
  inBatch: (data: any) => request.post('/stocks/in-batch', data),
  transfer: (data: any) => request.post('/stocks/transfer', data),
  alert: (params?: any) => request.get('/stocks/alert', { params }),
  batches: (params: PageParams) => request.get('/stocks/batches', { params }),
  zeroStock: (params?: PageParams) => request.get('/stocks/zero-stock', { params }),
  clearZero: (params?: any) => request.post('/stocks/clear-zero', null, { params }),
  exportCsv: (params?: any) => downloadCsv('/stocks/export', '库存现况', params),
}

// ===== 库存事务类型 =====
export const stockTransactionTypeApi = {
  list: (params?: PageParams) => request.get('/stock-transaction-types', { params }),
  create: (data: any) => request.post('/stock-transaction-types', data),
  update: (id: number, data: any) => request.put(`/stock-transaction-types/${id}`, data),
  remove: (id: number) => request.delete(`/stock-transaction-types/${id}`),
}

// ===== 看板 =====
export const dashboardApi = {
  executive: () => request.get('/dashboard/executive'),
  orderTracking: () => request.get('/dashboard/order-tracking'),
  inventory: () => request.get('/dashboard/inventory'),
}

// ===== 系统管理 =====
export const systemApi = {
  users: (params: PageParams) => request.get('/system/users', { params }),
  salespersons: () => request.get('/system/salespersons'),
  createUser: (data: any) => request.post('/system/users', data),
  updateUser: (id: number, data: any) => request.put(`/system/users/${id}`, data),
  deleteUser: (id: number) => request.delete(`/system/users/${id}`),
  roles: () => request.get('/system/roles'),
  createRole: (data: any) => request.post('/system/roles', data),
  updateRole: (id: number, data: any) => request.put(`/system/roles/${id}`, data),
  deleteRole: (id: number) => request.delete(`/system/roles/${id}`),
  permissions: () => request.get('/system/permissions'),
  departments: () => request.get('/system/departments'),
  logs: (params: PageParams) => request.get('/system/logs', { params }),
  company: () => request.get('/system/company'),
  updateCompany: (data: any) => request.put('/system/company', data),
}
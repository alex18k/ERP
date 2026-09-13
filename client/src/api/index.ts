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
  exportCsv: () => downloadCsv('/materials/export', '物料数据'),
}

// ===== BOM =====
export const bomApi = {
  list: (params: PageParams) => request.get('/boms', { params }),
  productOptions: () => request.get('/boms/product-options'),
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

// ===== 销售订单 =====
export const orderApi = {
  list: (params: PageParams) => request.get('/sales-orders', { params }),
  get: (id: number) => request.get(`/sales-orders/${id}`),
  create: (data: any) => request.post('/sales-orders', data),
  update: (id: number, data: any) => request.put(`/sales-orders/${id}`, data),
  confirm: (id: number) => request.put(`/sales-orders/${id}/confirm`),
  cancel: (id: number, data?: any) => request.put(`/sales-orders/${id}/cancel`, data),
  ship: (id: number) => request.put(`/sales-orders/${id}/ship`),
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
}

// ===== 生产 =====
export const productionApi = {
  orders: (params: PageParams) => request.get('/production/orders', { params }),
  planners: () => request.get('/production/planners'),
  issuedKeys: () => request.get('/production/orders/issued-keys'),
  createOrders: (data: any[]) => request.post('/production/orders', data),
  updateOrder: (id: number, data: any) => request.put(`/production/orders/${id}`, data),
  cancelOrder: (id: number) => request.put(`/production/orders/${id}/cancel`),
  schedule: (id: number, data?: any) => request.post(`/production/orders/${id}/schedule`, data),
  workOrders: (params: PageParams) => request.get('/production/work-orders', { params }),
  batchMaterials: (params?: any) => request.get('/production/batch-materials', { params }),
  batchMaterialsOfBatch: (batchId: number) => request.get(`/production/batches/${batchId}/materials`),
  issueBatch: (batchId: number, data: any) => request.post(`/production/batches/${batchId}/issue`, data),
  receivableBatches: (params?: any) => request.get('/production/batches/receivable', { params }),
  receiveBatch: (id: number, data: any) => request.post(`/production/batches/${id}/receive`, data),
  report: (workOrderId: number, data: any) => request.post(`/production/work-orders/${workOrderId}/report`, data),
  reports: (params: PageParams) => request.get('/production/reports', { params }),
  workshop: (params?: any) => request.get('/production/workshop', { params }),
  gantt: (params?: any) => request.get('/production/gantt', { params }),
  exportCsv: () => downloadCsv('/production/export', '加工单'),
}

// ===== 采购 =====
export const purchaseApi = {
  list: (params: PageParams) => request.get('/purchase', { params }),
  buyers: () => request.get('/purchase/buyers'),
  get: (id: number) => request.get(`/purchase/${id}`),
  create: (data: any) => request.post('/purchase', data),
  update: (id: number, data: any) => request.put(`/purchase/${id}`, data),
  confirm: (id: number) => request.put(`/purchase/${id}/confirm`),
  updateStatus: (id: number, status: string) => request.put(`/purchase/${id}/status`, { status }),
  cancel: (id: number) => request.put(`/purchase/${id}/cancel`),
  receive: (id: number, data?: any) => request.put(`/purchase/${id}/receive`, data),
  arrival: () => request.get('/purchase/arrival'),
  exportCsv: () => downloadCsv('/purchase/export', '采购订单'),
}

// ===== 库存 =====
export const stockApi = {
  list: (params: PageParams) => request.get('/stocks', { params }),
  records: (params: PageParams) => request.get('/stocks/records', { params }),
  in: (data: any) => request.post('/stocks/in', data),
  out: (data: any) => request.post('/stocks/out', data),
  alert: () => request.get('/stocks/alert'),
  exportCsv: () => downloadCsv('/stocks/export', '库存现况'),
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
  shortageAlert: () => request.get('/dashboard/shortage-alert'),
  workshop: () => request.get('/dashboard/workshop'),
  inventory: () => request.get('/dashboard/inventory'),
}

// ===== 统计报表 =====
export const reportApi = {
  production: (params: any) => request.get('/report/production', { params }),
  sales: (params: any) => request.get('/report/sales', { params }),
  purchase: (params: any) => request.get('/report/purchase', { params }),
  inventory: (params: any) => request.get('/report/inventory', { params }),
}

// ===== 系统管理 =====
export const systemApi = {
  users: (params: PageParams) => request.get('/system/users', { params }),
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
}
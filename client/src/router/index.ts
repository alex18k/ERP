import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/login/index.vue'),
    meta: { title: '登录' },
  },
  {
    path: '/m/report',
    name: 'MobileReport',
    component: () => import('../views/mobile/report/index.vue'),
    meta: { title: '员工报工' },
  },
  {
    path: '/',
    component: () => import('../layouts/MainLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('../views/home/index.vue'),
        meta: { title: '工作台' },
      },
      // 基础数据
      { path: 'base/material', name: 'Material', component: () => import('../views/base/material/index.vue'), meta: { title: '物料主文件' } },
      { path: 'base/bom', name: 'Bom', component: () => import('../views/base/bom/index.vue'), meta: { title: 'BOM管理' } },
      { path: 'base/bom-cost', name: 'BomCost', component: () => import('../views/base/bomCost/index.vue'), meta: { title: 'BOM成本' } },
      { path: 'base/process-route', name: 'ProcessRoute', component: () => import('../views/base/processRoute/index.vue'), meta: { title: '工艺路线' } },
      { path: 'base/supplier', name: 'Supplier', component: () => import('../views/base/supplier/index.vue'), meta: { title: '供应商管理' } },
      { path: 'base/warehouse', name: 'Warehouse', component: () => import('../views/base/warehouse/index.vue'), meta: { title: '仓库管理' } },
      { path: 'base/customer', name: 'Customer', component: () => import('../views/base/customer/index.vue'), meta: { title: '客户管理' } },
      { path: 'base/workshop', name: 'Workshop', component: () => import('../views/base/workshop/index.vue'), meta: { title: '车间管理' } },
      { path: 'base/workstation', name: 'Workstation', component: () => import('../views/base/workstation/index.vue'), meta: { title: '工位管理' } },
      // 订单
      { path: 'order/sales', name: 'SalesOrder', component: () => import('../views/order/sales/index.vue'), meta: { title: '销售订单' } },
      { path: 'order/maintain', name: 'SalesOrderMaintain', component: () => import('../views/order/maintain/index.vue'), meta: { title: '销售订单维护' } },
      { path: 'order/print', name: 'OrderPrint', component: () => import('../views/order/print/index.vue'), meta: { title: '打印销售订单' } },
      { path: 'order/tracking', name: 'OrderTracking', component: () => import('../views/order/tracking/index.vue'), meta: { title: '订单跟踪' } },
      { path: 'order/production', name: 'OrderProduction', component: () => import('../views/order/production/index.vue'), meta: { title: '订单转生产' } },
      // MRP
      { path: 'mrp/calculate', name: 'MrpCalculate', component: () => import('../views/mrp/calculate/index.vue'), meta: { title: 'MRP运算' } },
      { path: 'mrp/shortage', name: 'MrpShortage', component: () => import('../views/mrp/shortage/index.vue'), meta: { title: '缺料预警' } },
      { path: 'mrp/purchase-suggestion', name: 'MrpSuggestion', component: () => import('../views/mrp/suggestion/index.vue'), meta: { title: '采购建议' } },
      // 生产
      { path: 'production/order', name: 'ProductionOrder', component: () => import('../views/production/order/index.vue'), meta: { title: '生产订单' } },
      { path: 'production/batch-materials', name: 'ProductionBatchMaterials', component: () => import('../views/production/batchMaterials/index.vue'), meta: { title: '加工单物料清单' } },
      { path: 'production/process-route', name: 'ProductionProcessRoute', component: () => import('../views/production/processRoute/index.vue'), meta: { title: '加工单工艺路线' } },
      { path: 'production/work-report', name: 'ProductionWorkReport', component: () => import('../views/production/workReport/index.vue'), meta: { title: '批次报工' } },
      { path: 'production/employee-report', name: 'ProductionEmployeeReport', component: () => import('../views/production/employeeReport/index.vue'), meta: { title: '员工报工' } },
      { path: 'production/process-route-print', name: 'ProductionProcessRoutePrint', component: () => import('../views/production/processRoutePrint/index.vue'), meta: { title: '工艺路线卡' } },
      { path: 'production/batch-material-print', name: 'ProductionBatchMaterialPrint', component: () => import('../views/production/batchMaterialPrint/index.vue'), meta: { title: '加工单领料单' } },
      // 采购
      { path: 'purchase/order', name: 'PurchaseOrder', component: () => import('../views/purchase/order/index.vue'), meta: { title: '采购订单' } },
      { path: 'purchase/arrival', name: 'PurchaseArrival', component: () => import('../views/purchase/arrival/index.vue'), meta: { title: '到货跟踪' } },
      { path: 'purchase/maintain', name: 'PurchaseMaintain', component: () => import('../views/purchase/maintain/index.vue'), meta: { title: '采购单维护' } },
      { path: 'purchase/print', name: 'PurchasePrint', component: () => import('../views/purchase/print/index.vue'), meta: { title: '打印采购订单' } },
      // 库存
      { path: 'inventory/query', name: 'InventoryQuery', component: () => import('../views/inventory/query/index.vue'), meta: { title: '库存查询' } },
      { path: 'inventory/record', name: 'InventoryRecord', component: () => import('../views/inventory/record/index.vue'), meta: { title: '库存事务记录' } },
      { path: 'inventory/receive', name: 'InventoryReceive', component: () => import('../views/inventory/receive/index.vue'), meta: { title: '采购收货' } },
      { path: 'inventory/receipt-record', name: 'InventoryReceiptRecord', component: () => import('../views/inventory/receiptRecord/index.vue'), meta: { title: '采购收货记录' } },
      { path: 'inventory/issue', name: 'InventoryIssue', component: () => import('../views/inventory/issue/index.vue'), meta: { title: '生产领料' } },
      { path: 'inventory/production-receive', name: 'InventoryProductionReceive', component: () => import('../views/inventory/productionReceive/index.vue'), meta: { title: '生产入库' } },
      { path: 'inventory/shipping', name: 'InventoryShipping', component: () => import('../views/inventory/shipping/index.vue'), meta: { title: '销售发运' } },
      { path: 'inventory/batch', name: 'InventoryBatch', component: () => import('../views/inventory/batch/index.vue'), meta: { title: '批号库存' } },
      { path: 'inventory/transaction-type', name: 'StockTransactionType', component: () => import('../views/inventory/transactionType/index.vue'), meta: { title: '事务类型维护' } },
      // 看板
      { path: 'dashboard/inventory-board', name: 'InventoryBoard', component: () => import('../views/dashboard/inventory/index.vue'), meta: { title: '库存看板' } },
      // 统计报表
      { path: 'dashboard/report/employee-reports', name: 'ReportEmployeeReports', component: () => import('../views/dashboard/report/employeeReports/index.vue'), meta: { title: '员工报工报表' } },
      { path: 'dashboard/order-tracking', name: 'DashboardOrderTracking', component: () => import('../views/dashboard/orderTracking/index.vue'), meta: { title: '订单追踪看板' } },
      { path: 'dashboard/stock-alert', name: 'DashboardStockAlert', component: () => import('../views/dashboard/report/stockAlert/index.vue'), meta: { title: '库存预警' } },
      // 系统
      { path: 'system/user', name: 'SystemUser', component: () => import('../views/system/user/index.vue'), meta: { title: '用户管理' } },
      { path: 'system/role', name: 'SystemRole', component: () => import('../views/system/role/index.vue'), meta: { title: '角色管理' } },
      { path: 'system/log', name: 'SystemLog', component: () => import('../views/system/log/index.vue'), meta: { title: '操作日志' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to, _from, next) => {
  document.title = to.meta.title ? `${to.meta.title} - ERP生产管理系统` : 'ERP生产管理系统'
  const authStore = useAuthStore()
  if (to.path !== '/login' && !authStore.isLoggedIn) {
    next({ path: '/login', query: { redirect: to.fullPath } })
  } else {
    next()
  }
})

export default router
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
      { path: 'base/unit-conversion', name: 'UnitConversion', component: () => import('../views/base/unitConversion/index.vue'), meta: { title: '计量单位转换' } },
      { path: 'base/material-category', name: 'MaterialCategory', component: () => import('../views/base/materialCategory/index.vue'), meta: { title: '物料类别维护' } },
      { path: 'base/supplier', name: 'Supplier', component: () => import('../views/base/supplier/index.vue'), meta: { title: '供应商管理' } },
      { path: 'base/warehouse', name: 'Warehouse', component: () => import('../views/base/warehouse/index.vue'), meta: { title: '仓库管理' } },
      { path: 'base/bin', name: 'WarehouseBin', component: () => import('../views/base/bin/index.vue'), meta: { title: '货位管理' } },
      { path: 'base/customer', name: 'Customer', component: () => import('../views/base/customer/index.vue'), meta: { title: '客户管理' } },
      { path: 'base/workshop', name: 'Workshop', component: () => import('../views/base/workshop/index.vue'), meta: { title: '部门管理' } },
      { path: 'base/workstation', name: 'Workstation', component: () => import('../views/base/workstation/index.vue'), meta: { title: '工位管理' } },
      // 订单
      { path: 'order/sales', name: 'SalesOrder', component: () => import('../views/order/sales/index.vue'), meta: { title: '销售订单' } },
      { path: 'order/maintain', name: 'SalesOrderMaintain', component: () => import('../views/order/maintain/index.vue'), meta: { title: '销售订单维护' } },
      { path: 'order/sales-query', name: 'SalesOrderQuery', component: () => import('../views/order/salesQuery/index.vue'), meta: { title: '销售订单明细' } },
      { path: 'order/print', name: 'OrderPrint', component: () => import('../views/order/print/index.vue'), meta: { title: '打印销售订单' } },
      { path: 'order/tracking', name: 'OrderTracking', component: () => import('../views/order/tracking/index.vue'), meta: { title: '订单跟踪' } },
      { path: 'order/production', name: 'OrderProduction', component: () => import('../views/order/production/index.vue'), meta: { title: '订单转生产' } },
      // MRP
      { path: 'mrp/calculate', name: 'MrpCalculate', component: () => import('../views/mrp/calculate/index.vue'), meta: { title: 'MRP运算' } },
      { path: 'mrp/inspection', name: 'MrpInspection', component: () => import('../views/mrp/inspection/index.vue'), meta: { title: 'MRP信息检查' } },
      { path: 'mrp/shortage', name: 'MrpShortage', component: () => import('../views/mrp/shortage/index.vue'), meta: { title: '缺料预警' } },
      { path: 'mrp/purchase-suggestion', name: 'MrpSuggestion', component: () => import('../views/mrp/suggestion/index.vue'), meta: { title: '采购建议' } },
      { path: 'mrp/production-suggestion', name: 'MrpProductionSuggestion', component: () => import('../views/mrp/productionSuggestion/index.vue'), meta: { title: '生产建议' } },
      // 生产
      { path: 'production/order', name: 'ProductionOrder', component: () => import('../views/production/order/index.vue'), meta: { title: '生产订单' } },
      { path: 'production/order-config', name: 'ProductionOrderConfig', component: () => import('../views/production/orderConfig/index.vue'), meta: { title: '生产订单配置' } },
      { path: 'production/order-materials', name: 'ProductionOrderMaterials', component: () => import('../views/production/orderMaterials/index.vue'), meta: { title: '生产订单物料清单' } },
      { path: 'production/work-order-materials', name: 'ProductionWorkOrderMaterials', component: () => import('../views/production/workOrderMaterials/index.vue'), meta: { title: '生产领料单维护' } },
      { path: 'production/process-route', name: 'ProductionProcessRoute', component: () => import('../views/production/processRoute/index.vue'), meta: { title: '生产订单工艺路线' } },
      { path: 'production/work-report', name: 'ProductionWorkReport', component: () => import('../views/production/workReport/index.vue'), meta: { title: '生产报工' } },
      { path: 'production/employee-report', name: 'ProductionEmployeeReport', component: () => import('../views/production/employeeReport/index.vue'), meta: { title: '员工报工' } },
      { path: 'production/process-route-print', name: 'ProductionProcessRoutePrint', component: () => import('../views/production/processRoutePrint/index.vue'), meta: { title: '工艺路线卡' } },
      { path: 'production/work-order-material-print', name: 'ProductionWorkOrderMaterialPrint', component: () => import('../views/production/workOrderMaterialPrint/index.vue'), meta: { title: '生产领料单打印' } },
      // 采购
      { path: 'purchase/order', name: 'PurchaseOrder', component: () => import('../views/purchase/order/index.vue'), meta: { title: '采购订单' } },
      { path: 'purchase/arrival', name: 'PurchaseArrival', component: () => import('../views/purchase/arrival/index.vue'), meta: { title: '到货跟踪' } },
      { path: 'purchase/maintain', name: 'PurchaseMaintain', component: () => import('../views/purchase/maintain/index.vue'), meta: { title: '采购单维护' } },
      { path: 'purchase/receipt-report', name: 'PurchaseReceiptReport', component: () => import('../views/purchase/receiptReport/index.vue'), meta: { title: '采购收货报表' } },
      { path: 'purchase/print', name: 'PurchasePrint', component: () => import('../views/purchase/print/index.vue'), meta: { title: '打印采购订单' } },
      { path: 'purchase/receipt-print', name: 'PurchaseReceiptPrint', component: () => import('../views/purchase/receiptPrint/index.vue'), meta: { title: '打印收货单' } },
      // 库存
      { path: 'inventory/query', name: 'InventoryQuery', component: () => import('../views/inventory/query/index.vue'), meta: { title: '库存明细查询' } },
      { path: 'inventory/stock-query', name: 'InventoryStockQuery', component: () => import('../views/inventory/stockQuery/index.vue'), meta: { title: '库存查询' } },
      { path: 'inventory/psi-report', name: 'InventoryPsiReport', component: () => import('../views/inventory/psiReport/index.vue'), meta: { title: '进销存报表' } },
      { path: 'inventory/record', name: 'InventoryRecord', component: () => import('../views/inventory/record/index.vue'), meta: { title: '库存事务记录' } },
      { path: 'inventory/stock-in', name: 'InventoryStockIn', component: () => import('../views/inventory/stockIn/index.vue'), meta: { title: '库存入库' } },
      { path: 'inventory/stock-out', name: 'InventoryStockOut', component: () => import('../views/inventory/stockOut/index.vue'), meta: { title: '库存出库' } },
      { path: 'inventory/material-out', name: 'InventoryMaterialOut', component: () => import('../views/inventory/materialOut/index.vue'), meta: { title: '材料出库' } },
      { path: 'inventory/sales-out', name: 'InventorySalesOut', component: () => import('../views/inventory/salesOut/index.vue'), meta: { title: '销售出库' } },
      { path: 'inventory/material-out-maintain', name: 'InventoryMaterialOutMaintain', component: () => import('../views/inventory/materialOutMaintain/index.vue'), meta: { title: '材料出库维护' } },
      { path: 'inventory/sales-out-maintain', name: 'InventorySalesOutMaintain', component: () => import('../views/inventory/salesOutMaintain/index.vue'), meta: { title: '销售出库维护' } },
      { path: 'inventory/material-out-print', name: 'InventoryMaterialOutPrint', component: () => import('../views/inventory/materialOutPrint/index.vue'), meta: { title: '打印材料出库单' } },
      { path: 'inventory/product-in', name: 'InventoryProductIn', component: () => import('../views/inventory/productIn/index.vue'), meta: { title: '产品入库' } },
      { path: 'inventory/product-in-maintain', name: 'InventoryProductInMaintain', component: () => import('../views/inventory/productInMaintain/index.vue'), meta: { title: '产品入库维护' } },
      { path: 'inventory/purchase-in-maintain', name: 'InventoryPurchaseInMaintain', component: () => import('../views/inventory/purchaseInMaintain/index.vue'), meta: { title: '采购入库维护' } },
      { path: 'inventory/product-in-print', name: 'InventoryProductInPrint', component: () => import('../views/inventory/productInPrint/index.vue'), meta: { title: '打印产品入库单' } },
      { path: 'inventory/purchase-return', name: 'InventoryPurchaseReturn', component: () => import('../views/inventory/purchaseReturn/index.vue'), meta: { title: '采购退货' } },
      { path: 'inventory/record-print', name: 'InventoryRecordPrint', component: () => import('../views/inventory/recordPrint/index.vue'), meta: { title: '打印库存事务单' } },
      { path: 'inventory/sales-deliver-print', name: 'InventorySalesDeliverPrint', component: () => import('../views/inventory/salesDeliverPrint/index.vue'), meta: { title: '打印销售送货单' } },
      { path: 'inventory/receive', name: 'InventoryReceive', component: () => import('../views/inventory/receive/index.vue'), meta: { title: '采购收货' } },
      { path: 'inventory/receipt-report', name: 'InventoryReceiptReport', component: () => import('../views/purchase/receiptReport/index.vue'), meta: { title: '采购收货报表' } },
      { path: 'inventory/issue', name: 'InventoryIssue', component: () => import('../views/inventory/issue/index.vue'), meta: { title: '生产发料' } },
      { path: 'inventory/issue-make', name: 'InventoryIssueMake', component: () => import('../views/inventory/issueMake/index.vue'), meta: { title: '生产发料' } },
      { path: 'inventory/production-receive', name: 'InventoryProductionReceive', component: () => import('../views/inventory/productionReceive/index.vue'), meta: { title: '生产入库' } },
      { path: 'inventory/shipping', name: 'InventoryShipping', component: () => import('../views/inventory/shipping/index.vue'), meta: { title: '销售发运' } },
      { path: 'inventory/shipment-record', name: 'InventoryShipmentRecord', component: () => import('../views/inventory/shipmentRecord/index.vue'), meta: { title: '销售发运记录' } },
      { path: 'inventory/shipment-print', name: 'InventoryShipmentPrint', component: () => import('../views/inventory/shipmentPrint/index.vue'), meta: { title: '销售送货单' } },
      { path: 'inventory/batch', name: 'InventoryBatch', component: () => import('../views/inventory/batch/index.vue'), meta: { title: '批号库存' } },
      { path: 'inventory/transaction-type', name: 'StockTransactionType', component: () => import('../views/inventory/transactionType/index.vue'), meta: { title: '事务类型维护' } },
      { path: 'inventory/clear-zero', name: 'InventoryClearZero', component: () => import('../views/inventory/clearZero/index.vue'), meta: { title: '清除0库存' } },
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
      { path: 'system/company', name: 'SystemCompany', component: () => import('../views/system/company/index.vue'), meta: { title: '公司信息维护' } },
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
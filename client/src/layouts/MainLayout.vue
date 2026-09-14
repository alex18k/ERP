<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const activeMenu = computed(() => route.path)

interface MenuNode {
  title: string
  icon: string
  path?: string
  children?: MenuNode[]
}

const menuItems: MenuNode[] = [
  { path: '/dashboard', title: '工作台', icon: 'House' },
  {
    title: '基础数据',
    icon: 'Files',
    children: [
      { path: '/base/material', title: '物料管理', icon: 'Box' },
      { path: '/base/bom', title: 'BOM管理', icon: 'List' },
      { path: '/base/bom-cost', title: 'BOM成本', icon: 'List' },
      { path: '/base/process-route', title: '工艺路线', icon: 'SetUp' },
    ],
  },
  {
    title: '订单管理',
    icon: 'Document',
    children: [
      { path: '/order/sales', title: '销售订单', icon: 'Tickets' },
      { path: '/order/order-release', title: '销售订单下达', icon: 'Promotion' },
      { path: '/order/tracking', title: '订单跟踪', icon: 'Position' },
      { path: '/base/customer', title: '客户管理', icon: 'User' },
    ],
  },
  {
    title: 'MRP运算',
    icon: 'Cpu',
    children: [
      { path: '/mrp/calculate', title: 'MRP运算', icon: 'Aim' },
      { path: '/mrp/shortage', title: '缺料预警', icon: 'Warning' },
      { path: '/mrp/purchase-suggestion', title: '采购建议', icon: 'ShoppingCart' },
    ],
  },
  {
    title: '生产管理',
    icon: 'Operation',
    children: [
      { path: '/production/order', title: '生产订单', icon: 'Files' },
      { path: '/production/work-order', title: '加工单管理', icon: 'Tickets' },
      { path: '/production/batch-materials', title: '加工单物料清单', icon: 'List' },
      { path: '/production/process-route', title: '加工单工艺路线', icon: 'List' },
      { path: '/production/gantt', title: '排产甘特图', icon: 'Histogram' },
      { path: '/production/workshop', title: '车间看板', icon: 'Monitor' },
    ],
  },
  {
    title: '采购管理',
    icon: 'ShoppingCart',
    children: [
      { path: '/purchase/order', title: '采购订单', icon: 'List' },
      { path: '/purchase/arrival', title: '到货跟踪', icon: 'Van' },
      { path: '/base/supplier', title: '供应商管理', icon: 'Van' },
    ],
  },
  {
    title: '库存管理',
    icon: 'Box',
    children: [
      { path: '/inventory/query', title: '库存查询', icon: 'Search' },
      { path: '/inventory/record', title: '事务记录', icon: 'Clock' },
      { path: '/inventory/receive', title: '采购收货', icon: 'Download' },
      { path: '/inventory/issue', title: '生产领料', icon: 'Upload' },
      { path: '/inventory/production-receive', title: '生产入库', icon: 'Download' },
      { path: '/inventory/transaction-type', title: '事务类型维护', icon: 'SetUp' },
    ],
  },
  {
    title: '数据看板',
    icon: 'DataAnalysis',
    children: [
      {
        title: '实时看板',
        icon: 'DataBoard',
        children: [
          { path: '/dashboard/executive', title: '管理驾驶舱', icon: 'DataBoard' },
          { path: '/dashboard/shortage-alert', title: '缺料预警大屏', icon: 'Warning' },
          { path: '/dashboard/inventory-board', title: '库存看板', icon: 'PieChart' },
        ],
      },
      {
        title: '统计报表',
        icon: 'TrendCharts',
        children: [
          { path: '/dashboard/report/production', title: '生产报表', icon: 'Histogram' },
          { path: '/dashboard/report/sales', title: '销售与交期报表', icon: 'TrendCharts' },
          { path: '/dashboard/report/purchase', title: '采购报表', icon: 'ShoppingCart' },
          { path: '/dashboard/report/inventory', title: '库存报表', icon: 'PieChart' },
          { path: '/dashboard/report/work-reports', title: '报工记录', icon: 'Document' },
          { path: '/dashboard/order-tracking', title: '订单追踪看板', icon: 'Position' },
          { path: '/dashboard/stock-alert', title: '库存预警', icon: 'Warning' },
        ],
      },
    ],
  },
  {
    title: '系统管理',
    icon: 'Setting',
    children: [
      { path: '/system/user', title: '用户管理', icon: 'UserFilled' },
      { path: '/system/role', title: '角色管理', icon: 'Key' },
      { path: '/system/log', title: '操作日志', icon: 'Document' },
      { path: '/base/warehouse', title: '仓库管理', icon: 'OfficeBuilding' },
      { path: '/base/workshop', title: '车间管理', icon: 'OfficeBuilding' },
      { path: '/base/workstation', title: '工位管理', icon: 'Monitor' },
    ],
  },
]

async function handleLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' })
    authStore.logout()
    router.push('/login')
  } catch { /* canceled */ }
}
</script>

<template>
  <el-container class="layout">
    <el-aside width="224px" class="aside">
      <div class="logo">
        <div class="logo-mark">
          <el-icon :size="20"><Cpu /></el-icon>
        </div>
        <span class="logo-text">ERP生产管理系统</span>
        <el-icon class="logo-tick" :size="14"><ArrowRight /></el-icon>
      </div>
      <el-menu
        :default-active="activeMenu"
        router
        class="side-menu"
      >
        <el-menu-item index="/dashboard" class="menu-home">
          <el-icon><House /></el-icon>
          <span>工作台</span>
        </el-menu-item>
        <el-sub-menu v-for="item in menuItems.filter(m => m.children)" :key="item.title" :index="item.title">
          <template #title>
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.title }}</span>
          </template>
          <template v-for="child in item.children ?? []" :key="child.path ?? child.title">
            <el-sub-menu v-if="child.children" :index="`${item.title}-${child.title}`">
              <template #title>
                <el-icon><component :is="child.icon" /></el-icon>
                <span>{{ child.title }}</span>
              </template>
              <el-menu-item v-for="leaf in child.children" :key="leaf.path" :index="leaf.path">
                <el-icon><component :is="leaf.icon" /></el-icon>
                <span>{{ leaf.title }}</span>
              </el-menu-item>
            </el-sub-menu>
            <el-menu-item v-else :index="child.path ?? ''">
              <el-icon><component :is="child.icon" /></el-icon>
              <span>{{ child.title }}</span>
            </el-menu-item>
          </template>
        </el-sub-menu>
      </el-menu>
      <div class="aside-foot">
        <span class="foot-lamp"></span>
        <span>MRP v1.0</span>
      </div>
    </el-aside>

    <el-container class="body-wrap">
      <el-header class="header">
        <div class="breadcrumb">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-if="route.meta.title">{{ route.meta.title }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-dropdown>
            <span class="user-info">
              <span class="username">{{ authStore.user?.realName }}</span>
              <el-icon class="user-caret"><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="handleLogout">
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100vh;
}

/* ---------- 侧边栏：冷调浅蓝 ---------- */
.aside {
  background: linear-gradient(180deg, #eef4fb 0%, #e3ecf6 100%);
  border-right: 1px solid #cdd9e6;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.aside::-webkit-scrollbar { width: 4px; }
.aside::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); }

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  color: #23324a;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.02em;
  border-bottom: 1px solid #d0dbe8;
  flex-shrink: 0;
}

.logo-mark {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #4a94e0, #2f77cc);
  border-radius: 8px;
  color: #fff;
}

.logo-text { white-space: nowrap; }

.logo-tick {
  margin-left: auto;
  color: #3b7fd0;
  opacity: 0.9;
}

.side-menu {
  flex: 1;
  border-right: none;
  background: transparent;
  padding: 8px 0;
  --el-menu-bg-color: transparent;
  --el-menu-text-color: #4b5b70;
  --el-menu-hover-bg-color: rgba(255, 255, 255, 0.85);
  --el-menu-active-color: #1f5e9e;
  --el-menu-item-height: 40px;
  --el-menu-sub-item-height: 38px;
}

.side-menu :deep(.el-menu-item),
.side-menu :deep(.el-sub-menu__title) {
  height: 40px;
  line-height: 40px;
  margin: 1px 8px;
  border-radius: 8px;
  color: #4b5b70;
  font-size: 13.5px;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.side-menu :deep(.el-menu-item .el-icon),
.side-menu :deep(.el-sub-menu__title .el-icon) {
  color: #7d8da3;
}

.side-menu :deep(.el-menu-item:hover),
.side-menu :deep(.el-sub-menu__title:hover) {
  background: rgba(255, 255, 255, 0.9);
  color: #1c2a3d;
}

.side-menu :deep(.el-menu-item:hover .el-icon),
.side-menu :deep(.el-sub-menu__title:hover .el-icon) {
  color: #1c2a3d;
}

.side-menu :deep(.el-menu-item.is-active) {
  color: #1f5e9e;
  font-weight: 600;
  box-shadow: inset 3px 0 0 0 var(--erp-blue);
}

.side-menu :deep(.el-menu-item.is-active .el-icon) {
  color: var(--erp-blue);
}

/* 子菜单内联层 */
.side-menu :deep(.el-sub-menu .el-menu) { background: transparent; }
.side-menu :deep(.el-sub-menu .el-menu-item) {
  background: rgba(31, 58, 90, 0.05);
  margin: 1px 8px;
  padding-left: 34px !important;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.side-menu :deep(.el-sub-menu .el-menu-item.is-active) {
  color: #1f5e9e;
  box-shadow: inset 3px 0 0 0 var(--erp-blue);
}

.aside-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  font-size: 12px;
  color: #8a9199;
  letter-spacing: 0.08em;
  border-top: 1px solid #d0dbe8;
}

.foot-lamp {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--erp-green);
  box-shadow: 0 0 6px rgba(46, 125, 91, 0.55);
  animation: lamp-pulse 2.4s ease-in-out infinite;
}

@keyframes lamp-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* ---------- 头部 ---------- */
.body-wrap {
  min-width: 0;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 52px;
  padding: 0 20px;
  background: var(--erp-surface);
  border-bottom: 1px solid var(--erp-hairline);
  box-shadow: 0 1px 0 var(--erp-hairline-2), 0 2px 6px -4px rgba(18, 34, 58, 0.08);
}

.header :deep(.el-breadcrumb) {
  font-size: 13px;
}

.header :deep(.el-breadcrumb__inner) {
  color: var(--erp-steel);
}

.header :deep(.el-breadcrumb__inner a:hover) {
  color: var(--erp-blue);
}

.header :deep(.el-breadcrumb__last .el-breadcrumb__inner) {
  color: var(--erp-ink-2);
  font-weight: 700;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 20px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  outline: none;
  padding: 4px 8px;
  margin-right: -8px;
  border-radius: 8px;
  transition: background-color 0.15s ease;
}

.user-info:hover {
  background: var(--el-fill-color-light);
}

.username {
  font-size: 13px;
  color: var(--erp-inktext);
}

.user-caret { color: var(--erp-steel); }

.main {
  padding: 0;
  overflow-y: auto;
  background: var(--erp-paper);
}

@media (max-width: 900px) {
  .logo-tick {
    display: none;
  }
}
</style>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const activeMenu = computed(() => route.path)

const now = ref('')
let timer: number | undefined

function tick() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  now.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

onMounted(() => {
  tick()
  timer = window.setInterval(tick, 1000)
})

onUnmounted(() => {
  window.clearInterval(timer)
})

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
      { path: '/inventory/record', title: '库存事务记录', icon: 'Clock' },
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
          <div class="sys-status" :title="'系统在线'">
            <span class="status-lamp"></span>
            <span class="status-text">系统运行中</span>
          </div>
          <span class="clock" v-if="now">{{ now }}</span>
          <el-dropdown>
            <span class="user-info">
              <el-avatar :size="28" class="user-avatar">
                {{ authStore.user?.realName?.charAt(0) || 'U' }}
              </el-avatar>
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

/* ---------- 侧边栏：枪铁色仪表导轨 ---------- */
.aside {
  background: var(--erp-ink);
  overflow-y: auto;
  border-right: 1px solid rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
}

.aside::-webkit-scrollbar { width: 4px; }
.aside::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); }

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px;
  color: #e7ecf2;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.02em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  flex-shrink: 0;
}

.logo-mark {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #2f5e8c, #24507c);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 3px;
  color: #dceaf5;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

.logo-text { white-space: nowrap; }

.logo-tick {
  margin-left: auto;
  color: var(--erp-amber);
  opacity: 0.9;
}

.side-menu {
  border-right: none;
  background: transparent;
  /* 覆盖 Element 默认 #fff：子菜单内联层继承透明，不留白底 */
  --el-menu-bg-color: transparent;
  /* 悬停/激活高亮用暗透明白，避免近白色块 */
  --el-menu-hover-bg-color: rgba(255, 255, 255, 0.08);
  --el-menu-item-hover-bg-color: rgba(255, 255, 255, 0.07);
  --el-menu-sub-menu-hover-bg-color: rgba(255, 255, 255, 0.05);
  --el-menu-text-color: #a9b3c0;
  --el-menu-hover-text-color: #e7ecf2;
  --el-menu-active-color: #ffffff;
  flex: 1;
}

/* 顶层本级文字 */
.side-menu :deep(.el-sub-menu__title) {
  font-weight: 600;
  letter-spacing: 0.04em;
}

/* 子项：毛细管 + 琥珀激活刻线 */
.side-menu :deep(.el-menu-item) {
  position: relative;
}

.side-menu :deep(.el-menu-item.is-active) {
  color: #ffffff;
}

.side-menu :deep(.el-menu-item.is-active::before) {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--erp-amber);
}

.side-menu :deep(.el-menu-item.is-active .el-icon) {
  color: var(--erp-amber);
}

.side-menu :deep(.el-menu-item) {
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  margin-left: 18px;
  padding-left: 26px !important;
}

.aside-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  font-size: 12px;
  color: #6d7785;
  letter-spacing: 0.08em;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.foot-lamp,
.status-lamp {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--erp-green);
  box-shadow: 0 0 6px rgba(62, 124, 79, 0.9);
  animation: lamp-pulse 2.4s ease-in-out infinite;
}

@keyframes lamp-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* ---------- 头部：机电饰条 ---------- */
.body-wrap {
  min-width: 0;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 56px;
  padding: 0 20px;
  background: var(--erp-surface);
  border-bottom: 1px solid var(--erp-hairline);
  box-shadow: 0 1px 2px rgba(28, 33, 41, 0.03);
}

.header :deep(.el-breadcrumb) {
  font-size: 13px;
}

.header :deep(.el-breadcrumb__inner) {
  color: var(--erp-steel);
}

.header :deep(.el-breadcrumb__last .el-breadcrumb__inner) {
  color: var(--erp-inktext);
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 22px;
}

.sys-status {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border: 1px solid var(--erp-hairline);
  border-radius: 2px;
  background: #f7faf8;
}

.status-text {
  font-size: 12px;
  color: var(--erp-inktext);
  letter-spacing: 0.04em;
}

.clock {
  font-size: 12px;
  color: var(--erp-steel);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  outline: none;
}

.user-avatar {
  background: var(--erp-blue);
  font-size: 14px;
  font-weight: 600;
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
  .clock,
  .status-text,
  .logo-tick {
    display: none;
  }
}
</style>
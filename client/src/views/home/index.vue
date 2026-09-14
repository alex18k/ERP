<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { dashboardApi } from '../../api'

const router = useRouter()
const loading = ref(true)
const data = ref<any>(null)

onMounted(async () => {
  try {
    const res: any = await dashboardApi.executive()
    data.value = res.data
  } finally {
    loading.value = false
  }
})

const shortcuts = [
  { title: '物料管理', desc: '物料主数据维护', path: '/base/material', icon: 'Box' },
  { title: '销售订单', desc: '录入与跟踪订单', path: '/order/sales', icon: 'Tickets' },
  { title: 'MRP运算', desc: '计算物料需求', path: '/mrp/calculate', icon: 'Aim' },
  { title: '生产报工', desc: '车间执行报工', path: '/production/work-order', icon: 'Clock' },
  { title: '采购订货', desc: '创建采购订单', path: '/purchase/order', icon: 'ShoppingCart' },
  { title: '库存查询', desc: '查看当前库存', path: '/inventory/query', icon: 'Search' },
]
</script>

<template>
  <div class="page-container" v-loading="loading">
    <!-- 状态带 -->
    <div class="status-strip">
      <div class="strip-main">
        <div class="strip-icon"><el-icon :size="20"><Cpu /></el-icon></div>
        <div>
          <div class="strip-title">欢迎回到制造系统</div>
          <div class="strip-desc">以 MRP 为引擎，打通销售 → 计划 → 生产 → 采购全流程</div>
        </div>
      </div>
      <div class="strip-side">
        <span class="strip-lamp"></span>
        <span>系统运行中</span>
      </div>
    </div>

    <!-- 核心指标 -->
    <div class="dashboard-grid" v-if="data">
      <div class="stat-card">
        <div class="title">订单总数</div>
        <div class="value">{{ data.orderStats.total }}</div>
        <div class="stat-sub">已完成 {{ data.orderStats.completed }} 单 · 完成率 {{ data.orderStats.completionRate }}%</div>
      </div>
      <div class="stat-card green">
        <div class="title">生产中订单</div>
        <div class="value">{{ data.orderStats.inProgress }}</div>
        <div class="stat-sub">当前进行中的订单数</div>
      </div>
      <div class="stat-card red">
        <div class="title">逾期订单</div>
        <div class="value">{{ data.orderStats.overdue }}</div>
        <div class="stat-sub">超过交期未完成的订单</div>
      </div>
      <div class="stat-card orange">
        <div class="title">缺料物料数</div>
        <div class="value">{{ data.alerts.shortageCount }}</div>
        <div class="stat-sub">最近一次 MRP 计算缺料数</div>
      </div>
    </div>

    <!-- 快捷入口 -->
    <div class="page-card">
      <el-card shadow="never" class="cut" body-style="padding:2px">
        <template #header>
          <span class="toolbar-title">快捷功能</span>
        </template>
        <div class="shortcuts">
          <div v-for="s in shortcuts" :key="s.path" class="shortcut" @click="router.push(s.path)">
            <el-icon :size="26" class="s-icon"><component :is="s.icon" /></el-icon>
            <div class="s-title">{{ s.title }}</div>
            <div class="s-desc">{{ s.desc }}</div>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
/* 状态带 */
.status-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  margin-bottom: 18px;
  background:
    linear-gradient(90deg, rgba(59, 138, 224, 0.10), transparent 60%),
    var(--erp-surface);
  border: 1px solid var(--erp-hairline);
  border-radius: 10px;
  border-left: 3px solid var(--erp-blue);
}

.strip-main {
  display: flex;
  align-items: center;
  gap: 14px;
}

.strip-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #4a94e0, #2f77cc);
  border-radius: 8px;
  color: #fff;
}

.strip-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--erp-inktext);
  letter-spacing: 0.01em;
}

.strip-desc {
  margin-top: 4px;
  color: var(--erp-steel);
  font-size: 13px;
}

.strip-side {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--erp-inktext);
  letter-spacing: 0.04em;
  padding: 6px 14px;
  border: 1px solid var(--erp-hairline);
  border-radius: 999px;
  background: var(--erp-surface);
}

.strip-lamp {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--erp-green);
  box-shadow: 0 0 6px rgba(62, 124, 79, 0.9);
  animation: pulse 2.4s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.cut {
  border: none;
}

/* 快捷键：机械瓷砖 */
.shortcuts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.shortcut {
  text-align: center;
  padding: 20px 10px 16px;
  background: var(--erp-surface);
  border: 1px solid var(--erp-hairline);
  border-radius: 8px;
  cursor: pointer;
  position: relative;
  transition:
    transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.shortcut:hover {
  border-color: var(--erp-blue);
  transform: translateY(-2px);
  box-shadow: 0 8px 20px -8px rgba(18, 34, 58, 0.12);
}

.shortcut:active {
  transform: translateY(0);
}

/* 悬停浮现刻度 */
.shortcut::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -1px;
  transform: translateX(-50%);
  width: 0;
  height: 2px;
  background: var(--erp-blue);
  transition: width 0.18s ease;
}

.shortcut:hover::after {
  width: 50%;
}

.s-icon {
  color: var(--erp-blue);
}

.shortcut .s-title {
  font-size: 14px;
  font-weight: 600;
  margin-top: 10px;
  color: var(--erp-inktext);
}

.shortcut .s-desc {
  font-size: 12px;
  color: var(--erp-steel);
  margin-top: 4px;
}
</style>
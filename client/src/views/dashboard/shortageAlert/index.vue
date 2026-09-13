<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { dashboardApi } from '../../../api'
import { materialCategoryLabel } from '../../../utils/category'

const loading = ref(false)
const data = ref<any>(null)

async function loadData() {
  loading.value = true
  try {
    const res: any = await dashboardApi.shortageAlert()
    data.value = res.data
  } finally { loading.value = false }
}

function fontColor(n: number) {
  if (n >= 50) return 'var(--el-color-danger)'
  if (n >= 10) return 'var(--el-color-warning)'
  return 'var(--el-color-success)'
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <span class="toolbar-title">缺料预警大屏</span>
        <div style="flex: 1" />
        <el-button type="primary" @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-alert
        v-if="data?.latestRun"
        type="info" show-icon :closable="false"
        :title="`数据来源：最近一次MRP运算 #${data.latestRun.runNo}（${data.latestRun.completedAt}）`"
        style="margin-bottom: 16px"
      />
      <el-alert v-if="!data?.latestRun" type="info" show-icon :closable="false" title="尚未执行MRP运算，请先到「MRP运算」页面执行。" style="margin-bottom: 16px" />

      <div v-loading="loading">
        <el-row :gutter="12">
          <el-col v-for="s in data?.shortages || []" :key="s.id" :span="8" style="margin-bottom: 12px">
            <div class="shortage-card">
              <div class="shortage-material">
                <strong>{{ s.material.code }}</strong>
                <el-tag size="small" effect="plain" style="margin-left: 8px">{{ materialCategoryLabel(s.material.category) }}</el-tag>
              </div>
              <div class="shortage-name">{{ s.material.name }}</div>
              <el-descriptions :column="2" size="small" class="shortage-desc">
                <el-descriptions-item label="毛需求">{{ s.grossDemand }}</el-descriptions-item>
                <el-descriptions-item label="可用库存">{{ s.stockQuantity }}</el-descriptions-item>
                <el-descriptions-item label="在途">{{ s.inTransit }}</el-descriptions-item>
                <el-descriptions-item label="安全库存">{{ s.safetyStock }}</el-descriptions-item>
              </el-descriptions>
              <div class="shortage-net" :style="{ color: fontColor(s.netDemand) }">
                净需求 {{ s.netDemand }}
              </div>
              <div class="shortage-orders">
                <el-tag v-for="o in s.affectedOrders" :key="o.orderId" size="small" type="warning" effect="plain" style="margin-right: 4px">
                  {{ o.orderNo }} ×{{ o.quantity }}
                </el-tag>
                <span v-if="!s.affectedOrders?.length" style="color: var(--el-text-color-secondary); font-size: 12px">无关联订单</span>
              </div>
            </div>
          </el-col>
        </el-row>

        <el-result v-if="!loading && (!data?.shortages || data.shortages.length === 0)" icon="success" title="暂无缺料" sub-title="当前所有物料库存均满足已确认订单需求。" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.shortage-card {
  position: relative;
  border: 1px solid var(--el-border-color-light);
  border-radius: 2px;
  padding: 14px 16px;
  background: #fff;
  overflow: hidden;
}
.shortage-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--erp-amber);
}
.shortage-material {
  display: flex;
  align-items: center;
}
.shortage-name {
  margin: 4px 0 10px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.shortage-desc {
  margin-bottom: 8px;
}
.shortage-net {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 8px;
}
.shortage-orders {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
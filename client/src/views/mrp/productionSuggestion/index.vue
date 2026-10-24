<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mrpApi, productionApi } from '../../../api'

const loading = ref(false)
const run = ref<any>(null)
const issuedKeys = ref<any[]>([])
const selectedRows = ref<any[]>([])
const generating = ref(false)

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dueClassOf(value: any) {
  const d = value ? String(value).slice(0, 10) : ''
  if (!d) return ''
  if (d < todayStr()) return 'due-overdue'
  if (d === todayStr()) return 'due-today'
  return ''
}

const suggestions = computed(() => {
  const issued = new Set(
    issuedKeys.value.map((k: any) => `${k.materialId}-${k.salesOrderId ?? 'null'}`)
  )
  return (run.value?.result?.productionOrders || [])
    .map((s: any) => ({
      ...s,
      sourceKey: `${s.materialId}-${s.relatedOrderId > 0 ? s.relatedOrderId : 'null'}`,
      planStartDate: s.planStartDate || s.orderDate?.slice?.(0, 10) || todayStr(),
      planEndDate: s.planEndDate || s.needDate?.slice?.(0, 10) || '',
    }))
    .filter((s: any) => s.sourceKey && !issued.has(s.sourceKey))
})

function onSelectionChange(rows: any[]) {
  selectedRows.value = rows
}

function rowKey(row: any) {
  return `${row.materialId}-${row.relatedOrderId}`
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await mrpApi.shortage()
    const latest = res.data.latestRun
    if (latest) {
      const detail: any = await mrpApi.getRun(latest.id)
      run.value = detail.data
      issuedKeys.value = res.data.issuedProductionKeys || []
    } else {
      run.value = null
      issuedKeys.value = []
    }
    selectedRows.value = []
  } finally {
    loading.value = false
  }
}

async function handleGenerate() {
  if (selectedRows.value.length === 0) {
    ElMessage.warning('请先勾选要下达的生产建议')
    return
  }
  const missing = selectedRows.value.filter((s: any) => !s.planEndDate)
  if (missing.length > 0) {
    ElMessage.warning('请为选中的生产建议填写计划交期')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将把勾选的 ${selectedRows.value.length} 条生产建议生成生产订单（状态：已计划，后续可排产），确定继续？`,
      '批准下达生产订单',
      { type: 'warning' }
    )
  } catch {
    return
  }
  generating.value = true
  try {
    const payload = selectedRows.value.map((s: any) => ({
      materialId: s.materialId,
      quantity: s.quantity,
      // relatedOrderId <= 0 表示来源是手工加工单：不能作为销售订单 id，
      // 但要把来源加工单号带到生产订单的“来源订单”字段
      salesOrderId: s.relatedOrderId > 0 ? s.relatedOrderId : undefined,
      salesOrderNo: s.relatedOrderId > 0 ? undefined : (s.orderNo || undefined),
      planStartDate: s.planStartDate || undefined,
      planEndDate: s.planEndDate || undefined,
      remark: `来自MRP生产建议-${s.orderNo || ''}`,
    }))
    const res: any = await productionApi.createOrders(payload)
    const createdCount = res.data?.created?.length ?? 0
    const skippedCount = res.data?.skipped?.length ?? 0
    ElMessage.success(
      skippedCount > 0
        ? `已创建 ${createdCount} 张，跳过 ${skippedCount} 张（已下达过）`
        : `已创建 ${createdCount} 张生产订单`
    )
    await loadData()
  } catch {
    /* error shown */
  } finally {
    generating.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <el-card v-if="run" class="mb-16" shadow="never">
      <el-descriptions :column="4" border size="small">
        <el-descriptions-item label="最近MRP运行">#{{ run.runNo }}</el-descriptions-item>
        <el-descriptions-item label="生产建议">{{ suggestions.length }}</el-descriptions-item>
        <el-descriptions-item label="运算订单数">{{ run.orderCount ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="缺料总数">{{ (run.result?.shortages || []).length }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">生产建议清单</span>
        <span class="list-summary-tip" style="margin-left: 16px">基于最近一次 MRP 运算自动展开的半成品/成品生产建议；已下达且未完工的物料不再显示</span>
        <div style="flex: 1" />
        <el-button type="primary" :loading="generating" @click="handleGenerate">
          <el-icon><Files /></el-icon>批准下达生产订单
        </el-button>
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-table :data="suggestions" v-loading="loading" stripe :row-key="rowKey" @selection-change="onSelectionChange" max-height="calc(100vh - 300px)">
        <el-table-column type="selection" width="45" reserve-selection />
        <el-table-column label="物料" min-width="200">
          <template #default="{ row }">
            <div>{{ row.materialCode }} - {{ row.materialName }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="quantity" label="建议生产量" width="110" align="right" />
        <el-table-column label="需求来源" min-width="150">
          <template #default="{ row }">
            <span v-if="row.orderNo">
              {{ row.orderNo }}
              <br />
              <small style="color: var(--el-text-color-secondary)">{{ row.customerName || (row.relatedOrderId > 0 ? '' : '手工加工单') }}</small>
            </span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="需求日期" width="120">
          <template #default="{ row }">
            <span :class="dueClassOf(row.needDate)">{{ row.needDate?.slice?.(0, 10) || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="建议开工" width="120">
          <template #default="{ row }">{{ row.orderDate?.slice?.(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column label="制造提前期" width="110" align="right">
          <template #default="{ row }">{{ row.leadTime == null ? '-' : `${row.leadTime} 天` }}</template>
        </el-table-column>
        <el-table-column label="计划开始" width="150">
          <template #default="{ row }">
            <el-date-picker v-model="row.planStartDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
          </template>
        </el-table-column>
        <el-table-column label="计划交期" width="150">
          <template #default="{ row }">
            <el-date-picker v-model="row.planEndDate" type="date" value-format="YYYY-MM-DD" placeholder="必填，选择交期" style="width: 100%" />
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有待下达的生产建议" :image-size="56">
            <div class="empty-tip">执行 MRP 运算后会显示制造类半成品/成品的生产建议；已下达且未完工的物料不再显示</div>
          </el-empty>
        </template>
      </el-table>

    </div>
  </div>
</template>

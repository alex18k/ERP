<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mrpApi } from '../../../api'

const loading = ref(false)
const run = ref<any>(null)
const suggestions = ref<any[]>([])
const generating = ref(false)
const safetyChecking = ref(false)
const selectedRows = ref<any[]>([])
const typeFilter = ref('')

const materialTypes = computed(() =>
  [...new Set(suggestions.value.map((s: any) => s.materialType).filter(Boolean))].sort() as string[]
)

const filteredSuggestions = computed(() =>
  typeFilter.value
    ? suggestions.value.filter((s: any) => (s.materialType || '') === typeFilter.value)
    : suggestions.value
)

function onSelectionChange(rows: any[]) {
  selectedRows.value = rows
}

function rowKey(row: any) {
  return row.suggestionId ?? `${row.materialId}-${row.needDate ?? ''}`
}

function selectable(row: any) {
  return row.status === 'pending'
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await mrpApi.shortage()
    const latest = res.data.latestRun
    if (latest) {
      const detail: any = await mrpApi.getRun(latest.id)
      run.value = detail.data
      suggestions.value = res.data.suggestions || []
    } else {
      run.value = null
      suggestions.value = []
    }
    selectedRows.value = []
  } finally { loading.value = false }
}

async function handleGenerate() {
  if (selectedRows.value.length === 0) {
    ElMessage.warning('请先勾选要转换的采购建议')
    return
  }
  const selected = selectedRows.value
  const missing = selected.filter((s) => !s.supplierId)
  const tip = missing.length > 0
    ? `其中 ${missing.length} 条未指定供应商，将生成无供应商采购单。`
    : ''
  try {
    await ElMessageBox.confirm(`将把勾选的 ${selected.length} 条采购建议生成采购订单，${tip}确定继续？`, '生成采购订单', { type: 'warning' })
  } catch { return }
  generating.value = true
  try {
    const suggestionIds = selected.map((s) => s.suggestionId).filter((id: any) => id != null)
    const overrides: Record<number, number> = {}
    for (const s of selected) if (s.supplierId) overrides[s.materialId] = s.supplierId
    const res: any = await mrpApi.generatePurchase(suggestionIds, overrides)
    ElMessage.success(res.message || `已生成 ${res.data?.orders?.length ?? 0} 张采购订单`)
    loadData()
  } catch {
    /* error already shown */
  } finally {
    generating.value = false
  }
}

async function handleSafetyCheck() {
  try {
    await ElMessageBox.confirm('将检查所有采购件「现存量 + 在途」低于安全库存的情况，并生成采购建议（已有待处理建议的物料会跳过）。确定继续？', '安全库存检查', { type: 'warning' })
  } catch { return }
  safetyChecking.value = true
  try {
    const res: any = await mrpApi.safetyStockSuggest()
    ElMessage.success(res.message || `已生成 ${res.data?.created?.length ?? 0} 条采购建议`)
    loadData()
  } catch {
    /* error shown */
  } finally {
    safetyChecking.value = false
  }
}


function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
// 未生成采购单的建议：需求日逾期红色、今日琥珀
function dueClassOf(value: any) {
  const d = value ? String(value).slice(0, 10) : ''
  if (!d) return ''
  if (d < todayStr()) return 'due-overdue'
  if (d === todayStr()) return 'due-today'
  return ''
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <el-card v-if="run" class="mb-16" shadow="never">
      <el-descriptions :column="4" border size="small">
        <el-descriptions-item label="最近MRP运行">#{{ run.runNo }}</el-descriptions-item>
        <el-descriptions-item label="缺料总数">{{ (run.result.shortages || []).length }}</el-descriptions-item>
        <el-descriptions-item label="采购建议">{{ suggestions.length }}</el-descriptions-item>
        <el-descriptions-item label="生产建议">{{ (run.result.productionOrders || []).length }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">采购建议清单</span>
        <el-select v-model="typeFilter" placeholder="物料类型" clearable style="width: 170px; margin-left: 16px">
          <el-option v-for="t in materialTypes" :key="t" :label="t" :value="t" />
        </el-select>
        <div style="flex: 1" />
        <el-button :loading="safetyChecking" @click="handleSafetyCheck">
          <el-icon><Search /></el-icon>安全库存检查
        </el-button>
        <el-button type="primary" :loading="generating" @click="handleGenerate">
          <el-icon><Files /></el-icon>生成采购订单
        </el-button>
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-table :data="filteredSuggestions" v-loading="loading" stripe :row-key="rowKey" @selection-change="onSelectionChange" max-height="calc(100vh - 260px)">
        <el-table-column type="selection" width="45" :selectable="selectable" reserve-selection />
        <el-table-column type="expand">
          <template #default="{ row }">
            <div style="padding: 8px 16px 12px 48px">
              <div style="margin-bottom: 6px">
                <span style="color: var(--el-text-color-secondary)">建议需求日：</span>{{ row.needDate?.slice?.(0, 10) || '-' }}
                <span style="color: var(--el-text-color-secondary); margin-left: 24px">建议采购量：</span>{{ row.suggestedQty }}
              </div>
              <template v-if="row.sourceOrders && row.sourceOrders.length">
                <div v-for="o in row.sourceOrders" :key="o.orderId" style="line-height: 22px">
                  <el-tag size="small" type="info">{{ o.orderNo }}</el-tag>
                  <span style="margin-left: 8px">数量 {{ o.quantity }}</span>
                  <span v-if="o.deliveryDate" style="margin-left: 16px; color: var(--el-text-color-secondary)">交货期/需求日 {{ o.deliveryDate?.slice?.(0, 10) }}</span>
                </div>
              </template>
              <div v-else style="color: var(--el-text-color-secondary)">安全库存补货，无需求来源</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="materialCode" label="物料编码" width="110" />
        <el-table-column prop="materialName" label="物料名称" min-width="150" />
        <el-table-column prop="specification" label="型号规格" min-width="140" />
        <el-table-column prop="materialType" label="物料类型" width="120">
          <template #default="{ row }">{{ row.materialType || '-' }}</template>
        </el-table-column>
        <el-table-column label="来源" width="100">
          <template #default="{ row }">{{ row.source === 'safety' ? '安全库存' : 'MRP需求' }}</template>
        </el-table-column>
        <el-table-column prop="suggestedQty" label="建议采购量" width="110" align="right" />
        <el-table-column label="建议单价" width="100" align="right">
          <template #default="{ row }">{{ row.unitPrice ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="建议下单日期" width="120">
          <template #default="{ row }">{{ row.orderDate?.slice?.(0, 10) || '-' }}</template>
        </el-table-column>
        <el-table-column label="建议需求日" width="120">
          <template #default="{ row }">
            <span :class="dueClassOf(row.needDate)">{{ row.needDate?.slice?.(0, 10) || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="leadTime" label="采购提前期" width="100" align="right">
          <template #default="{ row }">{{ row.leadTime ?? '-' }} 天</template>
        </el-table-column>
        <el-table-column label="下单状态" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.purchaseOverdue" type="danger" size="small">需立即下单</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </template>
        </el-table-column>
              <template #empty>
          <el-empty description="没有待处理的采购建议" :image-size="56">
            <div class="empty-tip">执行 MRP 运算或安全库存补货后会生成建议；已生成采购单的建议不再显示</div>
          </el-empty>
        </template>
</el-table>

    </div>

  </div>
</template>
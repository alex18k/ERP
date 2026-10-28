<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { mrpApi, materialApi } from '../../../api'


const loading = ref(false)
const items = ref<any[]>([])
const total = ref(0)
const run = ref<any>(null)
const summary = ref<any>(null)
const query = reactive<any>({ page: 1, pageSize: 20, materialKeyword: '', materialType: '', needRange: null })
const activeCategory = ref<'purchase' | 'manufacture'>('purchase')
const materialTypes = ref<string[]>([])

function fmtDate(v: any) {
  return v ? String(v).slice(0, 10) : '-'
}

function sources(row: any): any[] {
  if (Array.isArray(row.sourceOrderList)) return row.sourceOrderList
  try {
    const list = row.sourceOrders ? JSON.parse(row.sourceOrders) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function sourceText(row: any) {
  const list = sources(row)
  if (list.length === 0) return '-'
  if (list.length > 1) return `共 ${list.length} 单（点击行首展开）`
  const o = list[0]
  return `${o.orderNo || o.orderId}${o.quantity ? ` ×${o.quantity}` : ''}`
}

function rowClass({ row }: any) {
  return sources(row).length > 1 ? '' : 'no-expand'
}

async function loadData() {
  loading.value = true
  try {
    const { needRange, ...rest } = query
    const params: any = { ...rest, category: activeCategory.value }
    if (Array.isArray(needRange) && needRange[0] && needRange[1]) {
      params.from = needRange[0]
      params.to = needRange[1]
    }
    const res: any = await mrpApi.inspection(params)
    run.value = res.data?.run || null
    summary.value = res.data?.summary || null
    items.value = res.data?.items || []
    total.value = res.data?.total || 0
  } finally {
    loading.value = false
  }
}

function resetQuery() {
  Object.assign(query, { page: 1, materialKeyword: '', materialType: '', needRange: null })
  loadData()
}

function onTabChange() {
  query.page = 1
  loadData()
}

async function loadMaterialTypes() {
  try {
    const res: any = await materialApi.types()
    materialTypes.value = res.data || []
  } catch {
    materialTypes.value = []
  }
}

onMounted(() => {
  loadMaterialTypes()
  loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <span class="toolbar-title">MRP信息检查（最后一次运算）</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-card v-if="run" shadow="never" class="run-card">
        <div class="run-header">
          <span class="run-no">{{ run.runNo }}</span>
          <el-tag :type="run.status === 'completed' ? 'success' : run.status === 'running' ? 'warning' : 'danger'" size="small">
            {{ run.status === 'completed' ? '完成' : run.status === 'running' ? '运算中' : '失败' }}
          </el-tag>
        </div>
        <div class="run-grid">
          <div class="run-item"><span class="run-label">运算时间</span><span>{{ run.completedAt || run.startedAt }}</span></div>
          <div class="run-item"><span class="run-label">订单数</span><span>{{ run.orderCount }}</span></div>
          <div class="run-item"><span class="run-label">参与物料</span><span>{{ summary?.materials ?? run.materialCount }}</span></div>
          <div class="run-item"><span class="run-label">检查行数</span><span>{{ summary?.lines ?? 0 }}</span></div>
          <div class="run-item"><span class="run-label">短缺行数</span><span :class="{ 'shortage-num': (summary?.shortageLines ?? 0) > 0 }">{{ summary?.shortageLines ?? 0 }}</span></div>
          <div class="run-item"><span class="run-label">净需求合计</span><span :class="{ 'shortage-num': (summary?.totalNetDemand ?? 0) > 0 }">{{ Math.round((summary?.totalNetDemand ?? 0) * 100) / 100 }}</span></div>
        </div>
      </el-card>

      <el-alert
        v-if="run && summary && summary.lines === 0"
        type="warning"
        show-icon
        :closable="false"
        title="该次运算没有检查数据（旧版本运算记录）。重新执行一次 MRP 运算后即可查看完整检查表。"
        style="margin-bottom: 12px"
      />

      <div class="search-bar">
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称" clearable style="width: 180px" @keyup.enter="query.page = 1, loadData()" />
        <el-date-picker v-model="query.needRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="需求日期起" end-placeholder="需求日期止" style="width: 260px" />
        <el-select v-model="query.materialType" placeholder="物料类型" clearable filterable style="width: 140px">
          <el-option v-for="t in materialTypes" :key="t" :label="t" :value="t" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="resetQuery">重置</el-button>
      </div>

      <el-tabs v-model="activeCategory" @tab-change="onTabChange" class="cat-tabs">
        <el-tab-pane :label="`采购 (${summary?.byCategory?.purchase ?? 0})`" name="purchase" />
        <el-tab-pane :label="`制造 (${summary?.byCategory?.manufacture ?? 0})`" name="manufacture" />
      </el-tabs>

      <el-table :data="items" v-loading="loading" stripe border max-height="calc(100vh - 380px)" size="small" :row-class-name="rowClass">
        <el-table-column type="expand" width="36">
          <template #default="{ row }">
            <div class="expand-box">
              <div class="expand-title">需求来源（{{ sources(row).length }} 单）</div>
              <el-table :data="sources(row)" size="small" border>
                <el-table-column label="订单号" width="150" show-overflow-tooltip>
                  <template #default="{ row: o }">{{ o.orderNo || o.orderId || '-' }}</template>
                </el-table-column>
                <el-table-column label="产品名称" width="340" show-overflow-tooltip>
                  <template #default="{ row: o }">{{ o.productName ? `${o.productCode || ''} - ${o.productName}` : '-' }}</template>
                </el-table-column>
                <el-table-column label="客户名称" width="130" show-overflow-tooltip>
                  <template #default="{ row: o }">{{ o.customerName || '-' }}</template>
                </el-table-column>
                <el-table-column label="需求数量" width="82" align="right">
                  <template #default="{ row: o }">{{ o.quantity ?? '-' }}</template>
                </el-table-column>
                <el-table-column label="需求日期" width="100">
                  <template #default="{ row: o }">{{ fmtDate(o.needDate || o.deliveryDate) }}</template>
                </el-table-column>
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="物料" min-width="200">
          <template #default="{ row }">
            <div>{{ row.material?.code }} - {{ row.material?.name }}</div>
            <span v-if="row.material?.specification" class="spec-text">{{ row.material.specification }}</span>
          </template>
        </el-table-column>
        <el-table-column label="物料类型" width="88" show-overflow-tooltip>
          <template #default="{ row }">{{ row.material?.materialType || '-' }}</template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="56" />
        <el-table-column label="当前库存" width="72" align="right">
          <template #default="{ row }">{{ Math.round((row.currentStock ?? 0) * 100) / 100 }}</template>
        </el-table-column>
        <el-table-column label="需求日期" width="94">
          <template #default="{ row }">{{ fmtDate(row.needDate) }}</template>
        </el-table-column>
        <el-table-column label="毛需求" width="66" align="right">
          <template #default="{ row }">{{ row.grossDemand }}</template>
        </el-table-column>
        <el-table-column label="安全库存" width="76" align="right">
          <template #default="{ row }">{{ row.safetyStock || '-' }}</template>
        </el-table-column>
        <el-table-column label="库存冲抵" width="76" align="right">
          <template #default="{ row }">{{ row.stockQuantity || '-' }}</template>
        </el-table-column>
        <el-table-column label="在途冲抵" width="76" align="right">
          <template #default="{ row }">{{ row.inTransit || '-' }}</template>
        </el-table-column>
        <el-table-column label="在制冲抵" width="76" align="right">
          <template #default="{ row }">{{ row.wipQuantity || '-' }}</template>
        </el-table-column>
        <el-table-column label="已发料冲抵" width="86" align="right">
          <template #default="{ row }">{{ row.issuedQuantity || '-' }}</template>
        </el-table-column>
        <el-table-column label="已取消冲抵" width="86" align="right">
          <template #default="{ row }">{{ row.cancelledQuantity || '-' }}</template>
        </el-table-column>
        <el-table-column label="净需求" width="76" align="right">
          <template #default="{ row }">
            <el-tag v-if="row.netDemand > 0" type="danger" size="small">{{ Math.round(row.netDemand * 100) / 100 }}</el-tag>
            <span v-else class="ok-text">0</span>
          </template>
        </el-table-column>
        <el-table-column label="提前期(天)" width="82" align="right">
          <template #default="{ row }">{{ row.leadTime ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="建议下单日期" width="100">
          <template #default="{ row }">{{ fmtDate(row.orderDate) }}</template>
        </el-table-column>
        <el-table-column label="采购建议" width="80" align="right">
          <template #default="{ row }">{{ row.suggestedPurchaseQty > 0 ? Math.round(row.suggestedPurchaseQty * 100) / 100 : '-' }}</template>
        </el-table-column>
        <el-table-column label="生产建议" width="80" align="right">
          <template #default="{ row }">{{ row.suggestedProductionQty > 0 ? Math.round(row.suggestedProductionQty * 100) / 100 : '-' }}</template>
        </el-table-column>
        <el-table-column label="需求来源" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ sourceText(row) }}</template>
        </el-table-column>
        <template #empty>
          <el-empty :description="run ? '没有符合条件的检查记录' : '还没有 MRP 运算记录'" :image-size="56">
            <div class="empty-tip">请先在「MRP运算」页执行一次运算</div>
          </el-empty>
        </template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.run-card {
  margin-bottom: 12px;
}
.run-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.run-no {
  font-size: 15px;
  font-weight: 600;
}
.run-grid {
  display: flex;
  flex-wrap: nowrap;
  gap: 0 20px;
  overflow-x: auto;
}
.run-item {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  font-size: 13px;
  white-space: nowrap;
}
.run-label {
  flex-shrink: 0;
  color: #909399;
}
.shortage-num {
  color: var(--erp-red);
  font-weight: 600;
}
.ok-text {
  color: var(--erp-steel);
}
.spec-text {
  font-size: 12px;
  color: var(--erp-steel);
}
.empty-tip {
  font-size: 12px;
  color: var(--erp-steel);
}
:deep(.no-expand .el-table__expand-icon) {
  visibility: hidden;
}
.cat-tabs :deep(.el-tabs__header) {
  margin: 0 0 8px;
}
.cat-tabs :deep(.el-tabs__content) {
  display: none;
}
.expand-box {
  padding: 4px 12px 8px 44px;
}
.expand-title {
  font-size: 12px;
  color: var(--erp-steel);
  margin-bottom: 6px;
}
</style>

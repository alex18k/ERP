<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mrpApi, orderApi } from '../../../api'
import { materialCategoryLabel } from '../../../utils/category'
import { downloadCsv } from '../../../utils/download'

const loading = ref(false)
const history = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10 })
const running = ref(false)
const orders = ref<any[]>([])
const runDialogVisible = ref(false)
const runType = ref<'all' | 'selected'>('all')
const selectedOrders = ref<number[]>([])
const resultDialogVisible = ref(false)
const result = ref<any>(null)
let pollTimer: ReturnType<typeof setTimeout> | null = null

function pollRun(runId: number) {
  const check = async () => {
    try {
      const res: any = await mrpApi.getRun(runId)
      const data = res.data || {}
      if (data.status === 'running') {
        pollTimer = setTimeout(check, 1500)
        return
      }
      running.value = false
      if (data.status === 'failed') {
        ElMessage.error((data.result?.error as string) || 'MRP运算失败')
      } else {
        result.value = { ...data, ...(data.result || {}) }
        resultDialogVisible.value = true
      }
      loadData()
    } catch {
      running.value = false
      loadData()
    }
  }
  pollTimer = setTimeout(check, 1500)
}

onUnmounted(() => {
  if (pollTimer) clearTimeout(pollTimer)
})

async function loadData() {
  loading.value = true
  try {
    const res: any = await mrpApi.history(query)
    history.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

async function openRunDialog() {
  const res: any = await orderApi.list({ pageSize: 50, status: 'confirmed' })
  orders.value = res.data.items
  selectedOrders.value = []
  runType.value = 'all'
  runDialogVisible.value = true
}

async function handleRun() {
  try {
    await ElMessageBox.confirm('MRP运算将根据有效订单展开BOM计算物料净需求，确定继续？', '确认MRP运算', { type: 'warning' })
  } catch {
    return
  }
  running.value = true
  try {
    const payload = runType.value === 'selected' ? { orderIds: selectedOrders.value } : {}
    const res: any = await mrpApi.calculate(payload)
    if (res.data?.runId) {
      runDialogVisible.value = false
      ElMessage.success(`MRP运算已提交（${res.data.runNo}），后台运算中，完成后将自动展示结果`)
      pollRun(res.data.runId)
      loadData()
    } else {
      running.value = false
      result.value = res.data
      resultDialogVisible.value = true
      loadData()
    }
  } catch {
    running.value = false
  }
}

async function viewResult(row: any) {
  const res: any = await mrpApi.getRun(row.id)
  const data = res.data || {}
  result.value = { ...data, ...(data.result || {}) }
  resultDialogVisible.value = true
}

// ===== 历史清理：按日期范围删除，可先存档导出Excel(CSV) =====
const cleanDialogVisible = ref(false)
const cleanRange = ref<[string, string] | null>(null)
const archiveExport = ref(true)
const cleaning = ref(false)

function openCleanDialog() {
  cleanRange.value = null
  archiveExport.value = true
  cleaning.value = false
  cleanDialogVisible.value = true
}

async function handleClean() {
  if (!cleanRange.value || !cleanRange.value[0] || !cleanRange.value[1]) {
    ElMessage.warning('请选择日期范围')
    return
  }
  const [from, to] = cleanRange.value
  try {
    await ElMessageBox.confirm(
      archiveExport.value
        ? `将先导出 ${from} ~ ${to} 的MRP运算历史存档，然后删除该范围内的所有历史记录，删除后不可恢复。是否继续？`
        : `将直接删除 ${from} ~ ${to} 的所有MRP运算历史记录（不导出存档），删除后不可恢复。是否继续？`,
      '删除MRP历史确认',
      { type: 'warning', confirmButtonText: '继续删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  cleaning.value = true
  try {
    if (archiveExport.value) {
      await downloadCsv('/mrp/history/export', `MRP运算历史_${from}_${to}`, { from, to })
    }
    const res: any = await mrpApi.deleteHistory({ from, to })
    ElMessage.success(`已删除 ${res.data?.deletedRuns ?? 0} 条MRP运算历史${archiveExport.value ? '，存档已导出' : ''}`)
    cleanDialogVisible.value = false
    loadData()
  } catch (e: any) {
    ElMessage.error(e?.message || '删除失败')
  } finally {
    cleaning.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="table-toolbar">
        <el-button type="primary" :loading="running" @click="openRunDialog">
          <el-icon><Cpu /></el-icon>执行MRP运算
        </el-button>
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-table :data="history" v-loading="loading" stripe max-height="calc(100vh - 260px)">
        <el-table-column prop="runNo" label="运算编号" width="150" />
        <el-table-column prop="orderCount" label="订单数" width="90" />
        <el-table-column prop="materialCount" label="物料数" width="90" />
        <el-table-column prop="shortageCount" label="缺料数" width="90" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'completed' ? 'success' : row.status === 'running' ? 'warning' : 'danger'" size="small">
              {{ row.status === 'completed' ? '完成' : row.status === 'running' ? '运算中' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="运算时间" width="170">
          <template #default="{ row }">{{ row.completedAt || row.startedAt }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="viewResult(row)">查看结果</el-button>
          </template>
        </el-table-column>
              <template #empty>
          <el-empty description="还没有 MRP 运算历史" :image-size="56">
            <div class="empty-tip">点上方「开始运算」后会记录每次运算的时间、范围与结果</div>
          </el-empty>
        </template>
</el-table>

      <div class="pagination-wrap">
        <el-button @click="openCleanDialog">
          <el-icon><Delete /></el-icon>清理历史记录
        </el-button>
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" layout="total, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <!-- 选择运算范围 -->
    <el-dialog v-model="runDialogVisible" title="执行MRP运算" width="720px">
      <el-alert type="info" :closable="false" title="MRP运算将读取所有「已确认」状态订单，按BOM逐层展开，结合现有库存、在途量与安全库存计算各物料净需求。" style="margin-bottom: 16px" />
      <el-form label-width="100px">
        <el-form-item label="运算范围">
          <el-radio-group v-model="runType">
            <el-radio value="all">全部已确认订单</el-radio>
            <el-radio value="selected">指定订单</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="runType === 'selected'" label="选择订单">
          <el-table :data="orders" size="small" max-height="260" @selection-change="(v: any) => (selectedOrders = v.map((r: any) => r.id))">
            <el-table-column type="selection" width="45" />
            <el-table-column prop="orderNo" label="订单编号" width="150" />
            <el-table-column prop="customerName" label="客户" min-width="140" />
            <el-table-column prop="totalAmount" label="金额" width="100" />
          </el-table>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="runDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="running" @click="handleRun">开始运算</el-button>
      </template>
    </el-dialog>

    <!-- 清理历史记录 -->
    <el-dialog v-model="cleanDialogVisible" title="清理MRP历史记录" width="460px">
      <el-form label-width="120px">
        <el-form-item label="日期范围" required>
          <el-date-picker v-model="cleanRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="存档导出">
          <el-checkbox v-model="archiveExport">删除前导出到Excel（CSV存档）</el-checkbox>
        </el-form-item>
      </el-form>
      <el-alert type="warning" :closable="false" show-icon title="将删除所选日期内（按运算开始时间）的全部历史记录及其缺料/未转单建议，运算中的记录不会被删除。" style="margin-top: 4px" />
      <template #footer>
        <el-button @click="cleanDialogVisible = false">取消</el-button>
        <el-button type="danger" :loading="cleaning" @click="handleClean">{{ archiveExport ? '存档并删除' : '直接删除' }}</el-button>
      </template>
    </el-dialog>

    <!-- 运算结果 -->
    <el-dialog v-model="resultDialogVisible" title="MRP运算结果" width="920px" top="5vh">
      <template v-if="result">
        <el-descriptions :column="4" border size="small" style="margin-bottom: 16px">
          <el-descriptions-item label="运算编号">{{ result.runNo }}</el-descriptions-item>
          <el-descriptions-item label="订单数">{{ result.orderCount }}</el-descriptions-item>
          <el-descriptions-item label="物料数">{{ result.materialCount }}</el-descriptions-item>
          <el-descriptions-item label="缺料数"><el-tag type="danger" size="small">{{ (result.shortages || []).length || result.shortageCount || 0 }}</el-tag></el-descriptions-item>
        </el-descriptions>

        <el-tabs>
          <el-tab-pane :label="`缺料清单 (${(result.shortages || []).length})`">
            <el-table :data="result.shortages || []" size="small" stripe>
              <el-table-column label="物料" min-width="150">
                <template #default="{ row }">{{ row.materialCode }} - {{ row.materialName }}</template>
              </el-table-column>
              <el-table-column label="类别" width="80">
                <template #default="{ row }">{{ materialCategoryLabel(row.category) }}</template>
              </el-table-column>
              <el-table-column prop="unit" label="单位" width="70" />
              <el-table-column prop="grossDemand" label="毛需求" width="90" />
              <el-table-column prop="stockQuantity" label="可用库存" width="100" />
              <el-table-column prop="inTransit" label="在途" width="80" />
              <el-table-column prop="netDemand" label="净需求" width="90" />
            </el-table>
          </el-tab-pane>
          <el-tab-pane :label="`采购建议 (${(result.purchaseSuggestions || []).length})`">
            <el-table :data="result.purchaseSuggestions || []" size="small" stripe>
              <el-table-column label="物料" min-width="150">
                <template #default="{ row }">{{ row.materialCode }} - {{ row.materialName }}</template>
              </el-table-column>
              <el-table-column prop="suggestedQty" label="建议采购量" width="110" />
              <el-table-column label="需求来源" min-width="180">
                <template #default="{ row }">
                  <template v-if="row.sourceOrders && row.sourceOrders.length">
                    <span v-for="o in row.sourceOrders" :key="o.orderId" style="margin-right: 8px">
                      {{ o.orderNo }} ×{{ o.quantity }}<span v-if="o.deliveryDate">({{ o.deliveryDate?.slice?.(0, 10) }})</span>
                    </span>
                  </template>
                  <span v-else style="color: var(--el-text-color-secondary)">-</span>
                </template>
              </el-table-column>
              <el-table-column prop="leadTime" label="提前期" width="90" />
              <el-table-column label="需求日期" width="110">
                <template #default="{ row }">{{ row.needDate?.slice?.(0, 10) || '-' }}</template>
              </el-table-column>
              <el-table-column label="建议下单日期" width="130">
                <template #default="{ row }">{{ row.orderDate?.slice?.(0, 10) || '-' }}</template>
              </el-table-column>
              <el-table-column label="下单状态" width="100">
                <template #default="{ row }">
                  <el-tag v-if="row.purchaseOverdue" type="danger" size="small">需立即下单</el-tag>
                  <el-tag v-else type="success" size="small">正常</el-tag>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane :label="`生产建议 (${(result.productionOrders || []).length})`">
            <el-table :data="result.productionOrders || []" size="small" stripe>
              <el-table-column label="物料" min-width="150">
                <template #default="{ row }">{{ row.materialCode }} - {{ row.materialName }}</template>
              </el-table-column>
              <el-table-column prop="quantity" label="建议生产量" width="110" />
              <el-table-column prop="orderNo" label="关联订单" width="160" />
              <el-table-column label="需求交期" width="110">
                <template #default="{ row }">{{ row.needDate?.slice?.(0, 10) || '-' }}</template>
              </el-table-column>
              <el-table-column label="建议开工日期" width="130">
                <template #default="{ row }">{{ row.orderDate?.slice?.(0, 10) || '-' }}</template>
              </el-table-column>
              <el-table-column label="状态" width="110">
                <template #default="{ row }">
                  <el-tag v-if="row.overdue" type="danger" size="small">已逾期</el-tag>
                  <el-tag v-else type="success" size="small">正常</el-tag>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </template>
      <template #footer>
        <el-button type="primary" @click="resultDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.pagination-wrap {
  justify-content: space-between;
  align-items: center;
}
</style>
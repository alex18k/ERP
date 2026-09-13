<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { productionApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, orderNo: '', status: '' })

const statusOptions = [
  { label: '待开工', value: 'pending', type: 'info' },
  { label: '加工中', value: 'in_progress', type: 'warning' },
  { label: '已暂停', value: 'paused', type: 'warning' },
  { label: '已完成', value: 'completed', type: 'success' },
  { label: '已取消', value: 'cancelled', type: 'danger' },
]

const reportDialogVisible = ref(false)
const reportForm = reactive<any>({ workOrderId: null, quantity: 0, scrapQty: 0, materialUsed: 0, remark: '' })

async function loadData() {
  loading.value = true
  try {
    const res: any = await productionApi.workOrders(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

function statusLabel(s: string) {
  return statusOptions.find(o => o.value === s)?.label || s
}

function statusType(s: string) {
  return statusOptions.find(o => o.value === s)?.type || 'info'
}

function openReportDialog(row: any) {
  Object.assign(reportForm, { workOrderId: row.id, quantity: row.plannedQty - row.actualQty, scrapQty: 0, materialUsed: 0, remark: '' })
  reportDialogVisible.value = true
}

async function handleReport() {
  if (reportForm.quantity <= 0) {
    ElMessage.warning('请输入报工数量')
    return
  }
  try {
    await productionApi.report(reportForm.workOrderId, {
      quantity: reportForm.quantity,
      scrapQty: reportForm.scrapQty,
      materialUsed: reportForm.materialUsed,
      remark: reportForm.remark,
    })
    ElMessage.success('报工成功')
    reportDialogVisible.value = false
    loadData()
  } catch { /* error shown */ }
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.orderNo" placeholder="加工单号" clearable style="width: 170px" />
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 130px">
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { orderNo: '', status: '', page: 1 }), loadData()">重置</el-button>
      </div>

      <div class="table-toolbar">
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
        <el-button @click="productionApi.exportCsv()"><el-icon><Download /></el-icon>导出</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="orderNo" label="加工单号" width="150" />
        <el-table-column label="生产订单" width="140">
          <template #default="{ row }">{{ row.productionOrder?.orderNo }}</template>
        </el-table-column>
        <el-table-column label="物料" min-width="150">
          <template #default="{ row }">{{ row.productionOrder?.material?.code }} - {{ row.productionOrder?.material?.name }}</template>
        </el-table-column>
        <el-table-column label="工序" min-width="110">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.assignments?.[0]?.processStep?.name || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="工位" width="110">
          <template #default="{ row }">{{ row.workstation?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作员" width="90">
          <template #default="{ row }">{{ row.operator?.realName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="plannedQty" label="计划量" width="90" />
        <el-table-column label="实际量" width="90">
          <template #default="{ row }">
            <span :style="{ color: 'var(--el-color-success)', fontWeight: 600 }">{{ row.actualQty }}</span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="160">
          <template #default="{ row }">
            <el-progress :percentage="Math.round((row.actualQty / row.plannedQty) * 100)" :stroke-width="8" />
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status !== 'completed' && row.status !== 'cancelled'" size="small" type="success" link @click="openReportDialog(row)">报工</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="reportDialogVisible" title="加工报工" width="460px">
      <el-form :model="reportForm" label-width="100px">
        <el-form-item label="报工数量">
          <el-input-number v-model="reportForm.quantity" :min="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="报废数量">
          <el-input-number v-model="reportForm.scrapQty" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="耗用物料">
          <el-input-number v-model="reportForm.materialUsed" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="reportForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reportDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleReport">确认报工</el-button>
      </template>
    </el-dialog>
  </div>
</template>
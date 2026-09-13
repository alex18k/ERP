<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { productionApi, warehouseApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const warehouses = ref<any[]>([])
const query = reactive({ page: 1, pageSize: 20, materialKeyword: '', orderNo: '', onlyUnissued: 'true' })

const dialogVisible = ref(false)
const submitting = ref(false)
const current = ref<any>(null)
const form = reactive<any>({ quantity: 0, warehouseId: null })

function remaining(row: any) {
  return (row.requiredQty ?? 0) - (row.issuedQty ?? 0)
}

function statusLabel(s: string) {
  return ({ pending: '未领', partial: '部分领料', issued: '已领完' } as any)[s] || s
}
function statusType(s: string) {
  return ({ pending: 'info', partial: 'warning', issued: 'success' } as any)[s] || 'info'
}

async function loadData() {
  loading.value = true
  try {
    const res: any = await productionApi.batchMaterials(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

async function loadWarehouses() {
  const res: any = await warehouseApi.list({ pageSize: 200 })
  warehouses.value = res.data.items
}

function openDialog(row: any) {
  current.value = row
  form.quantity = remaining(row)
  form.warehouseId = row.material?.defaultWarehouseId || warehouses.value[0]?.id || null
  dialogVisible.value = true
}

async function submit() {
  if (!form.quantity || form.quantity <= 0) {
    ElMessage.warning('领料数量必须大于0')
    return
  }
  if (!form.warehouseId) {
    ElMessage.warning('请选择出库仓库')
    return
  }
  if (form.quantity > remaining(current.value) + 1e-6) {
    ElMessage.warning(`领料数量超过未领数量 ${remaining(current.value)}`)
    return
  }
  submitting.value = true
  try {
    await productionApi.issueBatchMaterials([
      { batchMaterialId: current.value.id, quantity: form.quantity, warehouseId: form.warehouseId },
    ])
    ElMessage.success('领料出库成功')
    dialogVisible.value = false
    loadData()
  } catch {
    /* error shown */
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await loadWarehouses()
  await loadData()
})
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.materialKeyword" placeholder="物料编码/名称" clearable style="width: 180px" />
        <el-input v-model="query.orderNo" placeholder="生产订单号" clearable style="width: 160px" />
        <el-select v-model="query.onlyUnissued" placeholder="范围" style="width: 130px">
          <el-option label="仅未领完" value="true" />
          <el-option label="全部" value="false" />
        </el-select>
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { materialKeyword: '', orderNo: '', onlyUnissued: 'true', page: 1 }), loadData()">重置</el-button>
      </div>

      <div class="table-toolbar">
        <span class="toolbar-title">生产领料（批次物料需求）</span>
        <div style="flex: 1" />
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="物料" min-width="180">
          <template #default="{ row }">
            <div>{{ row.material?.code }} - {{ row.material?.name }}</div>
            <small style="color: var(--el-text-color-secondary)">{{ row.material?.specification }}</small>
          </template>
        </el-table-column>
        <el-table-column label="所属生产订单" width="150">
          <template #default="{ row }">{{ row.batch?.productionOrder?.orderNo }}</template>
        </el-table-column>
        <el-table-column label="产品" min-width="140">
          <template #default="{ row }">{{ row.batch?.productionOrder?.material?.name }}</template>
        </el-table-column>
        <el-table-column label="批次" width="80">
          <template #default="{ row }">第{{ row.batch?.batchNo }}批</template>
        </el-table-column>
        <el-table-column prop="requiredQty" label="需求量" width="90" />
        <el-table-column prop="issuedQty" label="已领" width="90" />
        <el-table-column label="未领" width="90">
          <template #default="{ row }">{{ remaining(row) }}</template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="70" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button v-if="remaining(row) > 0" size="small" type="primary" link @click="openDialog(row)">领料</el-button>
            <span v-else style="color: var(--el-text-color-secondary)">-</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" title="生产领料" width="480px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="物料">
          <span>{{ current?.material?.code }} - {{ current?.material?.name }}</span>
        </el-form-item>
        <el-form-item label="需求 / 未领">
          <span>{{ current?.requiredQty }} / {{ current ? remaining(current) : 0 }}</span>
        </el-form-item>
        <el-form-item label="出库仓库" required>
          <el-select v-model="form.warehouseId" placeholder="选择仓库" style="width: 100%">
            <el-option v-for="w in warehouses" :key="w.id" :label="`${w.code} - ${w.name}`" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="领料数量" required>
          <el-input-number v-model="form.quantity" :min="0" :precision="2" :controls="false" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">确认领料</el-button>
      </template>
    </el-dialog>
  </div>
</template>

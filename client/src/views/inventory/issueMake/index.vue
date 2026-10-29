<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { productionApi, warehouseApi } from '../../../api'
import { warehouseIdByLocation } from '../../../utils/location'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const warehouses = ref<any[]>([])
const activeWarehouses = computed(() => warehouses.value.filter((w: any) => w.status === 1))
const order = ref<any>(null)
const detail = ref<any[]>([])
const form = reactive<any>({ warehouseId: null, issueQty: 0, effectiveDate: '' })

// 未发口径：需求量 - 已发 - 已取消
function lineRemain(m: any) {
  return Math.max(0, (m.requiredQty ?? 0) - (m.issuedQty ?? 0) - (m.cancelledQty ?? 0))
}

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function backToList() {
  router.replace('/inventory/issue')
}

// 与后端发料校验同口径：已关闭/未排产/执行关闭/已完工 的订单不允许发料
function issuableError(data: any): string | null {
  if (data?.status === 'closed') return '该生产订单已关闭，不能发料'
  if (data?.execStatus === 'none') return '该生产订单尚未排产，不能发料'
  if (data?.execStatus === 'closed') return '该生产订单执行已关闭，不能发料'
  if (data?.execStatus === 'completed') return '该生产订单已完工，不能发料'
  return null
}

async function loadPage() {
  const id = Number(route.query.orderId)
  if (!Number.isInteger(id) || id <= 0) {
    ElMessage.warning('缺少生产订单参数')
    backToList()
    return
  }
  loading.value = true
  try {
    const [wRes, oRes]: any[] = await Promise.all([
      warehouseApi.list({ pageSize: 200 }),
      productionApi.orderMaterialsOfOrder(id),
    ])
    warehouses.value = wRes?.data?.items || []
    const data = oRes?.data
    if (!data) {
      ElMessage.warning('生产订单不存在')
      backToList()
      return
    }
    const err = issuableError(data)
    if (err) {
      ElMessage.warning(err)
      backToList()
      return
    }
    detail.value = (data.materials || []).map((m: any) => ({
      workOrderMaterialId: m.id,
      materialCode: m.material?.code,
      materialName: m.material?.name,
      material: m.material,
      unit: m.unit || m.material?.unit,
      issueUnit: m.unit || m.material?.unit,
      requiredQty: m.requiredQty,
      issuedQty: m.issuedQty ?? 0,
      cancelledQty: m.cancelledQty ?? 0,
      cancelRemain: false,
      location: m.material?.location || '',
      binId: null,
      issueQty: 0,
      batchNo: '',
      batches: [] as any[],
      batchesKey: '',
      batchesLoading: false,
    }))
    order.value = data
    form.issueQty = data.plannedQty ?? 0
    form.effectiveDate = todayStr()
    form.warehouseId = warehouseIdByLocation(activeWarehouses.value, data.material?.location) || activeWarehouses.value[0]?.id || null
    // 顶部库位默认跟随明细行的共同库位，没有共同库位时保留产品库位
    const locCodes = [...new Set(detail.value.map((l: any) => l.location).filter(Boolean))]
    if (locCodes.length === 1) {
      const common = activeWarehouses.value.find((w: any) => w.code === locCodes[0])
      if (common) form.warehouseId = common.id
    }
  } catch (e: any) {
    ElMessage.warning(e?.response?.data?.message || '生产订单不存在')
    backToList()
  } finally {
    loading.value = false
  }
}

onMounted(loadPage)
</script>

<template>
  <div class="page-container" v-loading="loading">
    <div class="page-card">
      <div class="search-bar">
        <span class="toolbar-title">生产发料</span>
        <el-button style="margin-left: 12px" @click="backToList"><el-icon><Back /></el-icon>返回</el-button>
      </div>

      <el-descriptions :column="5" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="生产订单">{{ order?.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="产品">{{ order?.material?.code }} - {{ order?.material?.name }}</el-descriptions-item>
        <el-descriptions-item label="订单数量">{{ order?.quantity }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ order?.status }}</el-descriptions-item>
        <el-descriptions-item label="执行状态">{{ order?.execStatus }}</el-descriptions-item>
      </el-descriptions>

      <el-table :data="detail" size="small" stripe max-height="calc(100vh - 320px)">
        <el-table-column label="物料" min-width="180">
          <template #default="{ row }">
            <div>{{ row.materialCode }} - {{ row.materialName }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="90" />
        <el-table-column prop="location" label="库位" width="120" />
        <el-table-column prop="requiredQty" label="需求量" width="100" align="right" />
        <el-table-column prop="issuedQty" label="已发" width="90" align="right" />
        <el-table-column label="未发" width="90" align="right">
          <template #default="{ row }">{{ lineRemain(row) }}</template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

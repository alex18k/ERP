<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { productionApi } from '../../../api'
import { useCompanyInfo, displayCompanyName } from '../../../composables/useCompanyInfo'

const route = useRoute()
const router = useRouter()
const order = ref<any>(null)
const list = ref<any[]>([])

const { companyInfo, loadCompanyInfo } = useCompanyInfo()
const companyName = computed(() => displayCompanyName(companyInfo.value))

function fmt(d: string | null | undefined) {
  return d ? String(d).slice(0, 10) : '-'
}

const batches = computed(() => {
  const map = new Map<number, any>()
  for (const row of list.value) {
    const b = row.batch
    if (b?.id) map.set(b.id, b)
  }
  return [...map.values()]
})

const batchLabel = (batchId: number) => {
  const b = batches.value.find((x: any) => x.id === batchId)
  return b ? `第${b.batchNo}批` : '-'
}

const totalRequired = computed(() => list.value.reduce((s: number, r: any) => s + Number(r.requiredQty || 0), 0))
const totalIssued = computed(() => list.value.reduce((s: number, r: any) => s + Number(r.issuedQty || 0), 0))
const totalPending = computed(() => totalRequired.value - totalIssued.value)

const todayStr = computed(() => {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})

function doPrint() {
  window.print()
}

onMounted(async () => {
  loadCompanyInfo()
  const orderNo = String(route.query.orderNo || '')
  if (!orderNo) return
  const res: any = await productionApi.batchMaterials({ orderNo, pageSize: 500 })
  list.value = res.data.items || []
  const detail: any = await productionApi.orders({ pageSize: 5, orderNo })
  order.value = detail.data.items?.[0] || null
})
</script>

<template>
  <div class="page-container print-view">
    <div class="no-print toolbar">
      <el-button @click="router.back()"><el-icon><Back /></el-icon>返回</el-button>
      <div style="flex: 1" />
      <el-button type="primary" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div v-if="order" id="print-area" class="issued-sheet">
      <div class="sh-header">
        <div>
          <div class="sh-brand">{{ companyName }}</div>
        </div>
        <div class="sh-title">加工单领料单</div>
        <div class="sh-meta">
          <div><span>打印日期</span><b>{{ todayStr }}</b></div>
        </div>
      </div>

      <div class="sh-info">
        <div><span class="lb">生产订单</span>{{ order.orderNo }}</div>
        <div><span class="lb">产品</span>{{ order.material?.code }} - {{ order.material?.name }}</div>
        <div><span class="lb">订单数量</span>{{ order.quantity }}</div>
        <div><span class="lb">批次数量</span>{{ batches.map((b: any) => `第${b.batchNo}批 ${b.quantity}`).join('　') || '-' }}</div>
        <div><span class="lb">计划周期</span>{{ fmt(order.planStartDate) }} ~ {{ fmt(order.planEndDate) }}</div>
        <div><span class="lb">计划员</span>{{ order.planner || '-' }}</div>
        <div><span class="lb">工单状态</span>{{ order.status === 'in_progress' ? '生产中' : order.status === 'completed' ? '已完成' : order.status }}</div>
        <div><span class="lb">销售订单</span>{{ order.salesOrder?.orderNo || '-' }}</div>
      </div>

      <table class="sh-items">
        <thead>
          <tr>
            <th class="c" style="width: 34px">序</th>
            <th class="c" style="width: 70px">批次</th>
            <th style="width: 96px">物料编码</th>
            <th>物料名称 / 规格型号</th>
            <th class="c" style="width: 46px">单位</th>
            <th class="r" style="width: 60px">需求量</th>
            <th class="r" style="width: 60px">已领料</th>
            <th class="r" style="width: 60px">待领料</th>
            <th class="c" style="width: 66px">库位</th>
            <th style="width: 100px">备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in list" :key="row.id">
            <td class="c">{{ Number(idx) + 1 }}</td>
            <td class="c">{{ batchLabel(row.batchId) }}</td>
            <td>{{ row.material?.code }}</td>
            <td class="l">
              {{ row.material?.name }}
              <span v-if="row.material?.specification" class="sh-spec">{{ row.material.specification }}</span>
            </td>
            <td class="c">{{ row.unit || row.material?.unit }}</td>
            <td class="r">{{ row.requiredQty }}</td>
            <td class="r">{{ row.issuedQty ?? 0 }}</td>
            <td class="r f">{{ Number(row.requiredQty || 0) - Number(row.issuedQty || 0) }}</td>
            <td class="c">{{ row.material?.location || '-' }}</td>
            <td class="l">{{ row.remark || '' }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td class="c" colspan="5">合计</td>
            <td class="r b">{{ totalRequired }}</td>
            <td class="r b">{{ totalIssued }}</td>
            <td class="r b">{{ totalPending }}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>

      <div class="sh-pending">
        <span>本次发料明细（仓库填写）</span>
      </div>

      <div class="sh-sign">
        <div class="sh-sign-cell"><div class="sh-sign-name">领料人（部门）</div><div class="sh-sign-line">签字：____________　日期：____________</div></div>
        <div class="sh-sign-cell"><div class="sh-sign-name">发料人（仓库）</div><div class="sh-sign-line">签字：____________　日期：____________</div></div>
        <div class="sh-sign-cell"><div class="sh-sign-name">审核</div><div class="sh-sign-line">签字：____________　日期：____________</div></div>
      </div>

      <div class="sh-foot">本单做为仓库发料依据 · 打印日期 {{ todayStr }}</div>
    </div>
  </div>
</template>

<style scoped>
.print-view {
  max-width: 960px;
  margin: 0 auto;
}
.toolbar {
  display: flex;
  align-items: center;
  background: #fff;
  border: 1px solid #d9dfe8;
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 14px;
  box-shadow: 0 1px 2px rgba(20, 40, 80, 0.06);
}

/* ===== 单据纸张 ===== */
.issued-sheet {
  background: #fff;
  color: #26303d;
  padding: 36px 42px 26px;
  border: 1px solid #d9dfe8;
  box-shadow: 0 2px 14px rgba(20, 40, 80, 0.08);
  font-size: 13px;
  line-height: 1.6;
}

.sh-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 2px solid #000;
  padding-bottom: 12px;
}
.sh-brand {
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 15px;
  font-weight: 700;
  color: #000;
}
.sh-title {
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 28px;
  font-weight: 700;
  color: #000;
  letter-spacing: 8px;
  text-indent: 8px;
  text-align: center;
}
.sh-meta {
  text-align: right;
  font-size: 12px;
  color: #5a6874;
}
.sh-meta div span {
  display: inline-block;
  min-width: 56px;
  color: #8a97a8;
}
.sh-meta b {
  font-weight: 600;
  color: #000;
}

.sh-info {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin: 16px 0;
  font-size: 12.5px;
}
.sh-info .lb {
  display: inline-block;
  min-width: 58px;
  color: #7d8a9a;
  margin-right: 4px;
}

.sh-items {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.sh-items th {
  background: #e8e8e8;
  color: #000;
  font-weight: 700;
  font-size: 12px;
  padding: 7px 6px;
  letter-spacing: 0.5px;
}
.sh-items td {
  border: 1px solid #d5dde8;
  padding: 6px 6px;
  font-size: 12.5px;
  vertical-align: middle;
}
.sh-items tfoot td {
  background: #f2f2f2;
  font-weight: 700;
}
.sh-items tbody tr:nth-child(even) {
  background: #f6f8fb;
}
.c { text-align: center; }
.r { text-align: right; font-variant-numeric: tabular-nums; }
.l { text-align: left; }
.b { font-weight: 700; }
.f { font-weight: 700; color: #000; }
.sh-spec {
  display: block;
  color: #7d8a9a;
  font-size: 11px;
}

.sh-pending {
  margin-top: 14px;
  font-size: 12px;
  color: #5a6874;
}

.sh-sign {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-top: 26px;
}
.sh-sign-cell {
  padding-top: 18px;
  border-top: 1px solid #c9d4e0;
}
.sh-sign-name {
  font-size: 13px;
  font-weight: 700;
  color: #000;
  margin-bottom: 14px;
}
.sh-sign-line {
  font-size: 12px;
  color: #5a6874;
  letter-spacing: 1px;
}

.sh-foot {
  margin-top: 20px;
  text-align: center;
  font-size: 10.5px;
  color: #9aa7b6;
  letter-spacing: 0.5px;
}

/* ===== 打印 ===== */
@media print {
  .no-print { display: none !important; }
  .print-view { max-width: none; margin: 0; }
  .issued-sheet {
    border: none;
    box-shadow: none;
    padding: 10mm;
  }
  .sh-info,
  .sh-sign {
    break-inside: avoid;
  }
  .sh-items thead {
    display: table-header-group;
  }
  .sh-items th,
  .sh-items tfoot td {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
</style>
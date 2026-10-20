<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { purchaseApi } from '../../../api'
import { useCompanyInfo, displayCompanyName } from '../../../composables/useCompanyInfo'

const route = useRoute()
const router = useRouter()
const order = ref<any>(null)
const receipts = ref<any[]>([])

const { companyInfo, loadCompanyInfo } = useCompanyInfo()
const companyName = computed(() => displayCompanyName(companyInfo.value))

const first = computed(() => receipts.value[0] || {})

const supplierName = computed(() => first.value.supplierName || order.value?.supplier?.name || '-')
const deliveryNo = computed(() => first.value.deliveryNo || '-')
const warehouseName = computed(() => first.value.warehouse?.name || '-')
const documentNo = computed(() => first.value.documentNo || first.value.receiptNo || '-')
const businessType = computed(() => first.value.transactionType?.description || '普通采购')
const remark = computed(() => first.value.remark || '')

const docDate = computed(() => {
  const v = first.value.effectiveDate || first.value.createdAt
  if (!v) return '-'
  const d = new Date(v)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
})

const totalQty = computed(() => receipts.value.reduce((s, r) => s + Number(r.quantity || 0), 0))
const totalAmount = computed(() =>
  receipts.value.reduce((s, r) => {
    const amount = r.amount != null ? Number(r.amount) : Number(r.quantity || 0) * Number(r.unitPrice || 0)
    return s + amount
  }, 0)
)

function money(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function qty(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function price(n: number | null | undefined) {
  return n == null ? '' : Number(n).toFixed(6)
}

function doPrint() {
  window.print()
}

async function loadByOrderId(id: number) {
  const res: any = await purchaseApi.get(id)
  order.value = res.data
  if (order.value?.orderNo) {
    const r: any = await purchaseApi.receipts({ orderNo: order.value.orderNo, pageSize: 1000 })
    receipts.value = (r.data.items || []).filter((it: any) => !it.isReturn)
  }
}

onMounted(async () => {
  loadCompanyInfo()
  const receiptNo = String(route.query.receiptNo || '').trim()
  if (receiptNo) {
    const r: any = await purchaseApi.receipts({ receiptNo, pageSize: 1000 })
    receipts.value = (r.data.items || [])
      .filter((it: any) => !it.isReturn)
      .filter((it: any) => (it.receiptNo || it.documentNo) === receiptNo)
    const orderId = Number(receipts.value[0]?.relatedId)
    if (orderId) {
      const res: any = await purchaseApi.get(orderId)
      order.value = res.data
    }
    return
  }
  const id = Number(route.query.id)
  if (id) await loadByOrderId(id)
})
</script>

<template>
  <div class="page-container print-view">
    <div class="no-print toolbar">
      <el-button @click="router.back()"><el-icon><Back /></el-icon>返回</el-button>
      <div style="flex: 1" />
      <el-button type="primary" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div id="print-area" class="sheet">
      <div class="head">
        <div class="head-left"></div>
        <div class="head-center">
          <div class="company">{{ companyName }}</div>
          <div class="title">采购入库单</div>
        </div>
        <div class="head-right">第1页共1页</div>
      </div>

      <div class="meta">
        <div class="meta-row">
          <div class="meta-left">供应商：{{ supplierName }}</div>
          <div class="meta-mid">送货单号：{{ deliveryNo }}</div>
          <div class="meta-right">单据日期：{{ docDate }}</div>
        </div>
        <div class="meta-row">
          <div class="meta-left">业务类型：{{ businessType }}</div>
          <div class="meta-mid">仓库：{{ warehouseName }}</div>
          <div class="meta-right">单据编号：{{ documentNo }}</div>
        </div>
      </div>

      <table class="items">
        <colgroup>
          <col style="width: 44px" />
          <col style="width: 110px" />
          <col style="width: 150px" />
          <col style="width: 190px" />
          <col style="width: 52px" />
          <col style="width: 100px" />
          <col style="width: 96px" />
          <col style="width: 110px" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th class="c">序号</th>
            <th class="c">存货编码</th>
            <th class="c">存货名称</th>
            <th class="c">规格型号</th>
            <th class="c">单位</th>
            <th class="c">数量</th>
            <th class="c">单价</th>
            <th class="c">金额</th>
            <th class="c">备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, idx) in receipts" :key="it.id">
            <td class="c">{{ idx + 1 }}</td>
            <td>{{ it.material?.code || '-' }}</td>
            <td>{{ it.material?.name || '-' }}</td>
            <td>{{ it.material?.specification || '' }}</td>
            <td class="c">{{ it.material?.unit || '-' }}</td>
            <td class="r">{{ qty(it.quantity) }}</td>
            <td class="r">{{ price(it.unitPrice) }}</td>
            <td class="r">{{ money(it.amount != null ? it.amount : Number(it.quantity || 0) * Number(it.unitPrice || 0)) }}</td>
            <td>{{ it.remark || '' }}</td>
          </tr>
          <tr v-if="receipts.length === 0">
            <td class="c empty" colspan="9">暂无入库明细</td>
          </tr>
          <tr class="sum-row">
            <td class="c">合计</td>
            <td colspan="4"></td>
            <td class="r">{{ qty(totalQty) }}</td>
            <td></td>
            <td class="r">{{ money(totalAmount) }}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <div class="remark">备注：{{ remark }}</div>

      <div class="sign">
        <div>仓管员：{{ first.keeper || '' }}</div>
        <div>审核人：{{ first.approver || '' }}</div>
        <div>复核人：</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.print-view {
  max-width: 1080px;
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

.sheet {
  background: #fff;
  color: #000;
  padding: 28px 32px 30px;
  border: 1px solid #d9dfe8;
  box-shadow: 0 2px 14px rgba(20, 40, 80, 0.08);
  font-family: 'SimSun', 'Songti SC', Arial, sans-serif;
  font-size: 13px;
}

.head {
  display: flex;
  align-items: flex-start;
}
.head-left {
  flex: 0 0 150px;
}
.head-center {
  flex: 1;
  text-align: center;
}
.company {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 1px;
}
.title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 10px;
  margin-top: 2px;
  text-indent: 10px;
}
.head-right {
  flex: 0 0 150px;
  text-align: right;
  font-size: 12px;
  padding-top: 4px;
}

.meta {
  margin: 14px 0 10px;
}
.meta-row {
  display: flex;
  align-items: center;
  padding: 3px 0;
  font-size: 13px;
}
.meta-left {
  flex: 1;
}
.meta-mid {
  flex: 1;
  text-align: center;
}
.meta-right {
  flex: 1;
  text-align: right;
}

.items {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.items th,
.items td {
  border: 1px solid #000;
  padding: 5px 6px;
  font-size: 12.5px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
}
.items th {
  background: #e8e8e8;
  font-weight: 700;
  text-align: center;
}
.c { text-align: center; }
.r { text-align: right; font-variant-numeric: tabular-nums; }
.empty { padding: 16px 0; }
.sum-row td {
  font-weight: 700;
}

.remark {
  margin-top: 16px;
  font-size: 13px;
}
.sign {
  display: flex;
  margin-top: 22px;
  font-size: 13px;
}
.sign > div {
  flex: 1;
}
.sign > div:nth-child(2) {
  text-align: center;
}
.sign > div:nth-child(3) {
  text-align: right;
}

@media print {
  .no-print { display: none !important; }
  .print-view { max-width: none; margin: 0; }
  .sheet {
    border: none;
    box-shadow: none;
    padding: 0;
  }
  .items thead {
    display: table-header-group;
  }
  .items tr {
    break-inside: avoid;
  }
}
</style>

<style>
@page {
  size: A4 landscape;
  margin: 10mm;
}
</style>

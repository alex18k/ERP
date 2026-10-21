<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { stockApi, customerApi } from '../../../api'
import { useCompanyInfo, displayCompanyName } from '../../../composables/useCompanyInfo'

const route = useRoute()
const router = useRouter()
const records = ref<any[]>([])
const loading = ref(false)
const customerName = ref('')

const { companyInfo, loadCompanyInfo } = useCompanyInfo()
const companyName = computed(() => displayCompanyName(companyInfo.value))

const documentNo = computed(() => String(route.query.documentNo || '').trim())

const doc = computed(() => {
  const first = records.value[0] || {}
  const company = first.company || null
  return {
    company,
    deliveryNo: records.value.find((r) => r.deliveryNo)?.deliveryNo || '',
    orderNo: records.value.find((r) => r.orderNo)?.orderNo || '',
    contractNo: records.value.find((r) => r.contractNo)?.contractNo || '',
    addressCode: first.address || '',
    contactName: records.value.find((r) => r.contactName)?.contactName || '',
    contactPhone: records.value.find((r) => r.contactPhone)?.contactPhone || '',
    salesperson: records.value.find((r) => r.salesperson)?.salesperson || records.value.find((r) => r.handler)?.handler || '',
    effectiveDate: first.effectiveDate || first.createdAt,
  }
})

const headerCompany = computed(() => doc.value.company || {
  nameZh: companyName.value,
  address: companyInfo.value?.address || '',
  phone: companyInfo.value?.phone || '',
  fax: companyInfo.value?.fax || '',
})

const cnDate = computed(() => {
  const v = doc.value.effectiveDate
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
})

const rows = computed(() =>
  records.value.map((r, idx) => {
    const qty = Number(r.quantity) || 0
    const price = r.price == null ? null : Number(r.price)
    const amount = price == null ? null : Math.round(qty * price * 100) / 100
    return {
      no: idx + 1,
      name: r.material?.name || '',
      spec: r.material?.specification || '',
      unit: r.um || r.material?.unit || '',
      qty: qty.toFixed(1),
      price,
      amount,
      remark: r.remark || '',
    }
  }),
)

const fmtPrice = (v: number | null) => (v == null ? '' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

async function resolveCustomerName(code: string) {
  if (!code) return
  try {
    const res: any = await customerApi.options({ keyword: code, limit: 200 })
    const list = res.data || []
    const hit = list.find((c: any) => c.code === code) || (list.length === 1 ? list[0] : null)
    customerName.value = hit?.name || code
  } catch {
    customerName.value = code
  }
}

async function loadData() {
  if (!documentNo.value) return
  loading.value = true
  try {
    const res: any = await stockApi.recordsByDocument(documentNo.value)
    records.value = res.data.items || []
    resolveCustomerName(doc.value.addressCode)
  } finally {
    loading.value = false
  }
}

function doPrint() {
  window.print()
}

onMounted(() => {
  loadCompanyInfo()
  loadData()
})
</script>

<template>
  <div class="page-container print-view">
    <div class="no-print toolbar">
      <el-button @click="router.back()"><el-icon><Back /></el-icon>返回</el-button>
      <div style="flex: 1" />
      <el-button type="primary" :disabled="records.length === 0" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div v-loading="loading" class="sheet-wrap">
      <div v-if="records.length > 0" id="print-area" class="sheet">
        <div class="triplicate">第一联存根（白）第二联客户（红）第三联回单（蓝）</div>

        <div class="sales-head">
          <span class="logo"><i>Win</i><em>tim</em><b>e</b></span>
          <span class="sales-title">{{ headerCompany.nameZh }}销售送货单</span>
        </div>

        <div class="meta-row">
          <span class="meta-block">地址：{{ headerCompany.address || '　' }}</span>
          <span class="meta-block">电话：{{ headerCompany.phone || '　' }}　传真：{{ headerCompany.fax || '　' }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-block">日期：{{ cnDate }}　　随货快递单号：{{ doc.deliveryNo || '　' }}</span>
          <span class="meta-block">No：{{ documentNo }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-block">订单号：{{ doc.orderNo || '　' }}　　合同号：{{ doc.contractNo || '　' }}</span>
          <span class="meta-block">销售人员：{{ doc.salesperson || '　' }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-block">收货单位：{{ customerName || doc.addressCode || '　' }}</span>
          <span class="meta-block">联系电话：{{ doc.contactPhone || '　' }}　联系人：{{ doc.contactName || '　' }}</span>
        </div>

        <table class="sales-table">
          <thead>
            <tr>
              <th style="width: 42px">编号</th>
              <th>产品名称</th>
              <th>规格型号</th>
              <th style="width: 56px">单位</th>
              <th style="width: 62px">数量</th>
              <th style="width: 70px">单价</th>
              <th style="width: 78px">金额</th>
              <th style="width: 150px">备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.no">
              <td class="c">{{ row.no }}</td>
              <td class="l">{{ row.name }}</td>
              <td class="l">{{ row.spec }}</td>
              <td class="c">{{ row.unit }}</td>
              <td class="r">{{ row.qty }}</td>
              <td class="r">{{ fmtPrice(row.price) }}</td>
              <td class="r">{{ fmtPrice(row.amount) }}</td>
              <td class="c">{{ row.remark }}</td>
            </tr>
          </tbody>
        </table>

        <div class="sign-row">
          <div class="sign-col">
            收货单位盖章：<br /><br />
            收货单位经手人签名：
          </div>
          <div class="sign-col sign-col--right">
            送货单位盖章：<br /><br />
            送货单位经手人签名：{{ doc.salesperson }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.print-view {
  background: #eef1f5;
  min-height: 100vh;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
}
.sheet-wrap {
  padding: 16px;
  display: flex;
  justify-content: center;
}
.sheet {
  position: relative;
  width: 277mm;
  min-height: 190mm;
  padding: 12mm 14mm 10mm 12mm;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
  font-size: 13px;
  color: #000;
}

/* 右侧三联竖排字 */
.triplicate {
  position: absolute;
  right: 2mm;
  top: 98px;
  writing-mode: vertical-rl;
  text-orientation: upright;
  white-space: nowrap;
  font-size: 11px;
  letter-spacing: 3px;
}

.sales-head {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  margin-bottom: 10px;
}
.logo {
  position: absolute;
  left: 0;
  font-size: 26px;
  font-style: italic;
  font-weight: 800;
  color: #1b3f8f;
  letter-spacing: 1px;
}
.logo i {
  font-style: italic;
}
.logo em {
  font-style: italic;
  font-family: Georgia, serif;
}
.logo b {
  color: #f60;
  font-size: 30px;
}
.sales-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 2px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  line-height: 22px;
  white-space: nowrap;
}
.meta-block {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sales-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 6px;
  table-layout: fixed;
}
.sales-table th,
.sales-table td {
  border: 1px solid #000;
  height: 26px;
  padding: 2px 6px;
  font-size: 13px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sales-table th {
  font-weight: 600;
  text-align: center;
}
.sales-table td.c { text-align: center; }
.sales-table td.l { text-align: left; }
.sales-table td.r { text-align: right; }

.sign-row {
  position: relative;
  margin-top: 14px;
  line-height: 24px;
}
.sign-col--right {
  position: absolute;
  top: 0;
  /* 与明细表「数量」栏左缘对齐：表格固定列宽 62/70/78/150px 位于其右侧 */
  left: calc(100% - 360px);
}

@media print {
  @page {
    size: A4 landscape;
    margin: 8mm;
  }
  .print-view {
    background: #fff;
    min-height: auto;
  }
  .no-print {
    display: none !important;
  }
  .sheet-wrap {
    padding: 0;
    display: block;
  }
  .sheet {
    width: auto;
    min-height: auto;
    box-shadow: none;
    padding: 0;
  }
  .triplicate {
    position: fixed;
    right: 2mm;
    top: 98px;
  }
}
</style>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { orderApi } from '../../../api'
import { useCompanyInfo, displayCompanyName } from '../../../composables/useCompanyInfo'

const route = useRoute()
const router = useRouter()
const list = ref<any[]>([])

const { companyInfo, loadCompanyInfo } = useCompanyInfo()
const companyName = computed(() => displayCompanyName(companyInfo.value))
const first = computed(() => list.value[0] || {})
const documentNo = computed(() => String(route.query.documentNo || first.value.documentNo || '').trim())

const docDate = computed(() => {
  const v = first.value.effectiveDate || first.value.createdAt
  if (!v) return '-'
  const d = new Date(v)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
})

function fmtQty(v: any) {
  const n = Number(v || 0)
  return Number.isInteger(n) ? n.toFixed(1) : String(Number(n.toFixed(4)))
}

function doPrint() {
  window.print()
}

onMounted(async () => {
  loadCompanyInfo()
  const no = String(route.query.documentNo || '').trim()
  if (!no) return
  const res: any = await orderApi.shipments({ documentNo: no, pageSize: 1000 })
  list.value = (res.data.items || []).filter((it: any) => it.documentNo === no)
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
      <div class="doc">
        <div class="content">
          <div class="company-title">{{ companyName }}销售送货单</div>

          <div class="info-row">
            <span class="col">地址：{{ companyInfo.address || '' }}</span>
            <span class="col">电话：{{ companyInfo.phone || '' }}</span>
            <span class="col">传真：{{ companyInfo.fax || '' }}</span>
          </div>
          <div class="info-row">
            <span class="col">日期：{{ docDate }}</span>
            <span class="col">随货快递单号：{{ first.deliveryNo || '' }}</span>
            <span class="col right">No: {{ documentNo }}</span>
          </div>
          <div class="info-row">
            <span class="col">订单号：{{ first.orderNo || '' }}</span>
            <span class="col">合同号：</span>
            <span class="col right">销售人员：{{ first.sellerNames || '' }}</span>
          </div>
          <div class="info-row">
            <span class="col">收货单位：{{ first.customerName || '' }}</span>
            <span class="col">联系电话：{{ first.contactPhone || '' }}</span>
            <span class="col right">联系人：{{ first.contactPerson || '' }}</span>
          </div>

          <table class="items">
            <colgroup>
              <col style="width: 46px" />
              <col />
              <col style="width: 210px" />
              <col style="width: 46px" />
              <col style="width: 66px" />
              <col style="width: 64px" />
              <col style="width: 76px" />
              <col style="width: 160px" />
            </colgroup>
            <thead>
              <tr>
                <th>编号</th>
                <th>产品名称</th>
                <th>规格型号</th>
                <th>单位</th>
                <th>数量</th>
                <th>单价</th>
                <th>金额</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(it, idx) in list" :key="it.id">
                <td class="c">{{ idx + 1 }}</td>
                <td>{{ it.material?.name || '' }}</td>
                <td>{{ it.material?.specification || '' }}</td>
                <td class="c">{{ it.lineUnit || it.material?.unit || '' }}</td>
                <td class="c">{{ fmtQty(it.lineQty ?? it.quantity) }}</td>
                <td></td>
                <td></td>
                <td>{{ it.remark && it.remark !== '销售发运出库' ? it.remark : '' }}</td>
              </tr>
              <tr v-if="list.length === 0">
                <td class="c empty" colspan="8">暂无发运明细</td>
              </tr>
            </tbody>
          </table>

          <div class="foot">
            <div class="foot-row">
              <span class="foot-col">收货单位盖章：</span>
              <span class="foot-col">送货单位盖章：</span>
            </div>
            <div class="foot-row">
              <span class="foot-col">收货单位经手人签名：</span>
              <span class="foot-col">送货单位经手人签名：{{ first.operator?.realName || first.operator?.username || '' }}</span>
            </div>
          </div>
        </div>

        <div class="copies">
          <div>第一联存根（白）</div>
          <div>第二联客户（红）</div>
          <div>第三联回单（蓝）</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.print-view {
  max-width: 1120px;
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
  padding: 24px 26px;
  border: 1px solid #d9dfe8;
  box-shadow: 0 2px 14px rgba(20, 40, 80, 0.08);
  font-family: 'SimSun', 'Songti SC', Arial, sans-serif;
  font-size: 13px;
}
.doc {
  display: flex;
}
.content {
  flex: 1;
  min-width: 0;
}
.copies {
  flex: 0 0 34px;
  margin-left: 10px;
  border-left: 1px solid #000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 14px;
  padding-top: 6px;
  font-size: 12px;
}
.copies div {
  writing-mode: vertical-rl;
  letter-spacing: 2px;
  white-space: nowrap;
}

.company-title {
  text-align: center;
  font-size: 25px;
  font-weight: 700;
  letter-spacing: 2px;
  margin-bottom: 10px;
}

.info-row {
  display: flex;
  align-items: center;
  padding: 2px 0;
  font-size: 13px;
}
.col {
  flex: 1;
}
.col.right {
  text-align: right;
}

.items {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin-top: 8px;
}
.items th,
.items td {
  border: 1px solid #000;
  padding: 4px 5px;
  font-size: 12.5px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.items th {
  background: #fff;
  font-weight: 700;
  text-align: center;
}
.c { text-align: center; }
.empty { padding: 16px 0; }

.foot {
  margin-top: 22px;
}
.foot-row {
  display: flex;
  padding: 3px 0;
  font-size: 13px;
}
.foot-col {
  flex: 1;
}

@media print {
  .no-print { display: none !important; }
  .print-view { max-width: none; margin: 0; }
  .sheet {
    border: none;
    box-shadow: none;
    padding: 0;
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

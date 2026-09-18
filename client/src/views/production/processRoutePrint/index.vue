<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QRCode from 'qrcode'
import { productionApi } from '../../../api'

const route = useRoute()
const router = useRouter()
const order = ref<any>(null)
const routeInfo = ref<any>(null)
const qrDataUrl = ref('')

const COMPANY_NAME = '肇庆市博士芯电子科技有限公司'
const REPORT_BASE_URL = 'http://134.175.22.157:63130'

async function renderQrCode(orderNo: string) {
  const url = `${REPORT_BASE_URL}/m/report?orderNo=${encodeURIComponent(orderNo)}`
  qrDataUrl.value = await QRCode.toDataURL(url, { width: 160, margin: 1 })
}

function fmt(d: string | null | undefined) {
  return d ? String(d).slice(0, 10) : '-'
}

const todayStr = computed(() => {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})

function doPrint() {
  window.print()
}

onMounted(async () => {
  const orderNo = String(route.query.orderNo || '')
  if (!orderNo) return
  const listRes: any = await productionApi.orders({ pageSize: 5, orderNo })
  const found = listRes.data.items?.[0]
  if (!found) return
  order.value = found
  const res: any = await productionApi.orderRoute(found.id)
  routeInfo.value = res.data.route
  await renderQrCode(found.orderNo)
})
</script>

<template>
  <div class="page-container print-view">
    <div class="no-print toolbar">
      <el-button @click="router.back()"><el-icon><Back /></el-icon>返回</el-button>
      <div style="flex: 1" />
      <el-button type="primary" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div v-if="order" id="print-area" class="route-sheet">
      <div class="sh-header">
        <div class="sh-brand">{{ COMPANY_NAME }}</div>
        <div class="sh-title">工艺路线卡</div>
        <div class="sh-meta">
          <div><span>打印日期</span><b>{{ todayStr }}</b></div>
        </div>
        <div class="sh-qr">
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="报工二维码" />
          <div class="sh-qr-cap">扫码报工</div>
        </div>
      </div>

      <div class="sh-info">
        <div><span class="lb">生产订单</span>{{ order.orderNo }}</div>
        <div><span class="lb">产品</span>{{ order.material?.code }} - {{ order.material?.name }}</div>
        <div><span class="lb">订单数量</span>{{ order.quantity }}</div>
        <div><span class="lb">计划员</span>{{ order.planner || '-' }}</div>
        <div><span class="lb">计划周期</span>{{ fmt(order.planStartDate) }} ~ {{ fmt(order.planEndDate) }}</div>
      </div>

      <table v-if="routeInfo?.processes?.length" class="sh-items">
        <thead>
          <tr>
            <th class="c" style="width: 34px">序</th>
            <th style="width: 70px">工序编码</th>
            <th style="width: 90px">工序名称</th>
            <th style="width: 80px">工位</th>
            <th class="r" style="width: 60px">操作时间</th>
            <th class="c" style="width: 60px">报工数量</th>
            <th style="width: 100px">完成签名</th>
            <th style="width: 90px">日期</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(step, idx) in routeInfo.processes" :key="step.id">
            <td class="c">{{ Number(idx) + 1 }}</td>
            <td>{{ step.code }}</td>
            <td class="l">{{ step.name }}</td>
            <td>{{ step.workstation ? step.workstation.code + ' ' + step.workstation.name : '-' }}</td>
            <td class="r">{{ step.standardTime }}</td>
            <td class="c blank-cell"></td>
            <td class="blank-cell"></td>
            <td class="blank-cell"></td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="routeInfo" style="text-align:center;color:#999;padding:30px 0">该工艺路线暂无工序</div>
    </div>
  </div>
</template>

<style scoped>
.print-view { max-width: 960px; margin: 0 auto; }
.toolbar {
  display: flex; align-items: center; background: #fff;
  border: 1px solid #d9dfe8; border-radius: 6px;
  padding: 10px 14px; margin-bottom: 14px;
  box-shadow: 0 1px 2px rgba(20, 40, 80, 0.06);
}
.route-sheet {
  background: #fff; color: #26303d;
  padding: 36px 42px 26px; border: 1px solid #d9dfe8;
  box-shadow: 0 2px 14px rgba(20, 40, 80, 0.08);
  font-size: 13px; line-height: 1.6;
}
.sh-header {
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 2px solid #000; padding-bottom: 12px;
}
.sh-brand { font-family: 'SimSun', 'Songti SC', serif; font-size: 15px; font-weight: 700; }
.sh-title {
  font-family: 'SimSun', 'Songti SC', serif; font-size: 28px;
  font-weight: 700; letter-spacing: 8px; text-indent: 8px; text-align: center;
}
.sh-meta { text-align: right; font-size: 12px; color: #5a6874; }
.sh-meta div span { display: inline-block; min-width: 56px; color: #8a97a8; }
.sh-meta b { font-weight: 600; color: #000; }
.sh-qr { text-align: center; }
.sh-qr img {
  width: 104px; height: 104px; display: block; padding: 3px;
  background: #fff; border: 1px solid #d5dde8; box-sizing: border-box;
}
.sh-qr-cap { font-size: 11px; color: #5a6874; margin-top: 3px; letter-spacing: 1px; }
.sh-info {
  display: flex; flex-wrap: wrap; gap: 4px 18px;
  margin: 16px 0; font-size: 12.5px;
}
.sh-info .lb { display: inline-block; min-width: 58px; color: #7d8a9a; margin-right: 4px; }
.sh-items {
  width: 100%; border-collapse: collapse; table-layout: fixed;
}
.sh-items th {
  background: #e8e8e8; color: #000; font-weight: 700;
  font-size: 12px; padding: 7px 6px; letter-spacing: 0.5px;
}
.sh-items td {
  border: 1px solid #d5dde8; padding: 6px 6px;
  font-size: 12.5px; vertical-align: middle;
}
.sh-items tbody tr:nth-child(even) { background: #f6f8fb; }
.c { text-align: center; }
.r { text-align: right; font-variant-numeric: tabular-nums; }
.l { text-align: left; }
.blank-cell { height: 24px; }
@media print {
  .no-print { display: none !important; }
  .print-view { max-width: none; margin: 0; }
  .route-sheet { border: none; box-shadow: none; padding: 10mm; }
  .sh-items thead { display: table-header-group; }
  .sh-items th, .sh-items td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sh-qr img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sh-info { break-inside: avoid; }
}
</style>
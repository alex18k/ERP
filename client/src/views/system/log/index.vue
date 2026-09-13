<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { systemApi } from '../../../api'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20, module: '', action: '', keyword: '' })

async function loadData() {
  loading.value = true
  try {
    const res: any = await systemApi.logs(query)
    list.value = res.data.items
    total.value = res.data.total
  } finally { loading.value = false }
}

function actionType(a: string) {
  return ({ create: 'success', update: 'primary', delete: 'danger', login: 'warning', logout: 'info' } as any)[a] || 'info'
}

onMounted(loadData)
</script>

<template>
  <div class="page-container">
    <div class="page-card">
      <div class="search-bar">
        <el-input v-model="query.keyword" placeholder="操作人/详情" clearable style="width: 180px" />
        <el-input v-model="query.module" placeholder="模块" clearable style="width: 120px" />
        <el-input v-model="query.action" placeholder="操作类型" clearable style="width: 120px" />
        <el-button type="primary" @click="query.page = 1, loadData()"><el-icon><Search /></el-icon>查询</el-button>
        <el-button @click="Object.assign(query, { keyword: '', module: '', action: '', page: 1 }), loadData()">重置</el-button>
      </div>
      <div class="table-toolbar">
        <el-button @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe size="small">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ row.createdAt }}</template>
        </el-table-column>
        <el-table-column label="操作人" width="110">
          <template #default="{ row }">{{ row.user?.realName || row.user?.username || '-' }}</template>
        </el-table-column>
        <el-table-column prop="module" label="模块" width="110">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.module }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-tag :type="actionType(row.action)" size="small">{{ row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="resourceName" label="资源" min-width="140">
          <template #default="{ row }">{{ row.resourceName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="detail" label="详情" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.detail || '-' }}</template>
        </el-table-column>
        <el-table-column prop="ip" label="IP" width="130">
          <template #default="{ row }">{{ row.ip || '-' }}</template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="loadData" />
      </div>
    </div>
  </div>
</template>
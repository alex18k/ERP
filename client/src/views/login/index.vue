<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const formRef = ref()
const loading = ref(false)
const form = reactive({
  username: 'admin',
  password: '',
})

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function handleLogin() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  loading.value = true
  try {
    await authStore.login(form.username, form.password)
    ElMessage.success('登录成功')
    router.push('/dashboard')
  } catch (e: any) {
    // 错误已由拦截器处理
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-panel">
      <div class="panel-status">
        <span class="status-lamp"></span>
        <span class="status-copy">系统在线 · MRP ENGINE READY</span>
        <span class="status-right">ERP / v1.0</span>
      </div>

      <div class="panel-brand">
        <div class="brand-mark">
          <el-icon :size="22"><Cpu /></el-icon>
        </div>
        <h1>ERP生产管理系统</h1>
        <p>销售 · 计划 · 生产 · 采购 一体化执行中枢</p>
        <div class="brand-rule"></div>
      </div>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="handleLogin">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="用户名" :prefix-icon="'User'" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="密码" show-password :prefix-icon="'Lock'" />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            class="login-btn"
            :loading="loading"
            @click="handleLogin"
          >
            进入系统
          </el-button>
        </el-form-item>
      </el-form>

      <div class="login-hint">
        <span class="hint-key">测试账号</span>
        <span class="hint-val">admin / admin123</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  position: relative;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(900px 520px at 15% -10%, rgba(162, 87, 42, 0.14), transparent 60%),
    radial-gradient(800px 480px at 95% 115%, rgba(165, 113, 19, 0.10), transparent 55%),
    linear-gradient(160deg, #eef0eb 0%, #e4e7e0 100%);
  overflow: hidden;
}

.login-panel {
  position: relative;
  width: 400px;
  padding: 0;
  background: var(--erp-surface);
  border: 1px solid var(--erp-hairline);
  border-radius: 14px;
  box-shadow: 0 6px 24px rgba(29, 38, 34, 0.08), 0 24px 72px rgba(29, 38, 34, 0.10);
  overflow: hidden;
}

.panel-status {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 20px;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--erp-steel);
  border-bottom: 1px solid var(--erp-hairline);
  background: #fafbf9;
}

.status-lamp {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--erp-green);
  box-shadow: 0 0 8px rgba(46, 125, 91, 0.55);
  animation: pulse 2.4s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.status-right {
  margin-left: auto;
  color: var(--erp-steel);
}

.panel-brand {
  padding: 30px 20px 22px;
  text-align: center;
}

.brand-mark {
  width: 52px;
  height: 52px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #b06a3f, #8f4820);
  border-radius: 12px;
  color: #fff;
}

.panel-brand h1 {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--erp-ink);
  margin: 0 0 8px;
}

.panel-brand p {
  color: var(--erp-steel);
  font-size: 12px;
  letter-spacing: 0.06em;
}

.brand-rule {
  width: 44px;
  height: 2px;
  margin: 20px auto 0;
  background: var(--erp-blue);
  border-radius: 1px;
  opacity: 0.85;
}

.panel-brand + :deep(.el-form) {
  padding: 0 36px;
}

.login-panel :deep(.el-input__wrapper) {
  border-radius: 6px;
}

.login-panel :deep(.el-input__prefix) {
  color: var(--erp-steel);
}

.login-panel :deep(.el-form-item) {
  margin-bottom: 20px;
}

.login-btn {
  width: 100%;
  height: 44px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.2em;
}

.login-hint {
  margin: 4px 36px 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 12px;
}

.hint-key {
  color: var(--erp-steel);
  letter-spacing: 0.08em;
}

.hint-val {
  color: var(--erp-inktext);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  background: var(--erp-hairline-2);
  border: 1px solid var(--erp-hairline);
  border-radius: 6px;
  padding: 2px 8px;
}
</style>
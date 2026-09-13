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
    <div class="login-grid" aria-hidden="true"></div>
    <div class="scanline" aria-hidden="true"></div>

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
    radial-gradient(1200px 700px at 20% -10%, rgba(47, 94, 140, 0.32), transparent 60%),
    radial-gradient(1000px 600px at 90% 110%, rgba(199, 124, 30, 0.10), transparent 55%),
    linear-gradient(160deg, #1b212b 0%, #161a21 55%, #15181f 100%);
  overflow: hidden;
}

/* 机台栅格：细网格暗示控制台 */
.login-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: radial-gradient(720px 520px at 50% 50%, #000 30%, transparent 78%);
  -webkit-mask-image: radial-gradient(720px 520px at 50% 50%, #000 30%, transparent 78%);
}

/* 装载时的单次扫线 */
.scanline {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(199, 124, 30, 0.55), transparent);
  animation: scan 3.2s ease-in-out 1;
}

@keyframes scan {
  from { transform: translateY(-10px); opacity: 0; }
  8%  { opacity: 1; }
  to   { transform: translateY(100vh); opacity: 0; }
}

.login-panel {
  position: relative;
  width: 400px;
  padding: 0;
  background: var(--erp-ink-2);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 4px;
  box-shadow:
    0 24px 64px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

/* 顶缘：琥珀指示灯条 */
.panel-status {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 20px;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: #98a3b0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(0, 0, 0, 0.18);
}

.status-lamp {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--erp-green);
  box-shadow: 0 0 8px rgba(62, 124, 79, 0.9);
  animation: pulse 2.4s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.status-right {
  margin-left: auto;
  color: #5a6472;
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
  background: linear-gradient(180deg, #2f5e8c, #24507c);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  color: #eaf2f9;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

.panel-brand h1 {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #eef2f7;
  margin: 0 0 8px;
}

.panel-brand p {
  color: #8a95a3;
  font-size: 12px;
  letter-spacing: 0.06em;
}

.brand-rule {
  width: 44px;
  height: 2px;
  margin: 20px auto 0;
  background: var(--erp-amber);
  border-radius: 1px;
  opacity: 0.85;
}

.panel-brand + :deep(.el-form) {
  padding: 0 36px;
}

/* 暗底输入：凹刻感 */
.login-panel :deep(.el-input__wrapper) {
  background: #1a1f27;
  box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.08);
  border-radius: 3px;
}

.login-panel :deep(.el-input__wrapper.is-focus) {
  box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.35), 0 0 0 1px var(--erp-blue);
}

.login-panel :deep(.el-input__inner) {
  color: #e6ebf1;
  font-variant-numeric: tabular-nums;
}

.login-panel :deep(.el-input__inner::placeholder) {
  color: #6a7482;
}

.login-panel :deep(.el-input__prefix) {
  color: #a3adba;
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
  background: linear-gradient(180deg, #2f5e8c, #24507c);
}

.login-btn:hover {
  filter: brightness(1.08);
}

.login-btn.is-loading {
  filter: none;
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
  color: #6a7482;
  letter-spacing: 0.08em;
}

.hint-val {
  color: #a9b4c1;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  padding: 2px 8px;
}
</style>
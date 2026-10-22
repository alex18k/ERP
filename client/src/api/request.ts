import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '../router'

const service = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
})

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    __ts?: number
    _retried?: boolean
  }
}

service.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  config.__ts = Date.now()
  return config
})

const API_LOG_LIMIT = 100

function apiLog(entry: Record<string, any>) {
  const log = ((window as any).__apiLog ||= []) as any[]
  log.push({ t: new Date().toISOString(), ...entry })
  if (log.length > API_LOG_LIMIT) log.splice(0, log.length - API_LOG_LIMIT)
}

service.interceptors.response.use(
  (response) => {
    const config = response.config as any
    const ms = config.__ts ? Date.now() - config.__ts : null
    if (ms != null && ms > 1500) {
      apiLog({ kind: 'slow', method: config.method, url: config.url, status: response.status, ms })
      console.warn(`[API-SLOW] ${config.method?.toUpperCase()} ${config.url} ${response.status} ${ms}ms`)
    }
    const res = response.data
    if (res.code !== 200) {
      ElMessage.error(res.message || '请求失败')
      return Promise.reject(new Error(res.message || '请求失败'))
    }
    return res
  },
  (error) => {
    const status = error.response?.status
    const msg = error.response?.data?.message || error.message
    const config = error.config || {}
    const ms = config.__ts ? Date.now() - config.__ts : null
    apiLog({ kind: 'error', method: config.method, url: config.url, status: status || error.code, ms, message: msg })
    console.warn(`[API-ERR] ${config.method?.toUpperCase()} ${config.url} ${status || error.code} ${ms ?? '-'}ms ${msg}`)
    const url = config.url || ''
    const isLoginRequest = url.includes('/auth/login')
    // 网络空闲后连接被中间设备静默断开会产生假超时；GET 幂等，重试一次可恢复
    const isTimeout = error.code === 'ECONNABORTED' || /timeout/i.test(msg)
    const canRetry = isTimeout && error.config?.method === 'get' && !error.config?._retried
    if (canRetry) {
      error.config._retried = true
      return service.request(error.config)
    }
    if (status === 401 && !isLoginRequest) {
      ElMessage.error('登录已过期，请重新登录')
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      router.push('/login')
    } else if (isTimeout) {
      ElMessage.error('请求超时：后端服务未及时响应或正在重启，请稍后重试')
    } else {
      ElMessage.error(msg || '网络错误')
    }
    return Promise.reject(error)
  }
)

export default service
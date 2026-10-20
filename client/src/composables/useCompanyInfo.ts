import { ref } from 'vue'
import { systemApi } from '../api'

export const DEFAULT_COMPANY_NAME = '肇庆市博士芯电子科技有限公司'

const companyInfo = ref<any>({})
let loaded = false
let pending: Promise<void> | null = null

export function useCompanyInfo() {
  async function loadCompanyInfo() {
    if (loaded) return
    if (!pending) {
      pending = (async () => {
        try {
          const res: any = await systemApi.company()
          companyInfo.value = res.data || {}
        } catch {
          companyInfo.value = {}
        } finally {
          loaded = true
        }
      })()
    }
    await pending
  }
  return { companyInfo, loadCompanyInfo }
}

export function setCompanyInfo(data: any) {
  companyInfo.value = data || {}
  loaded = true
}

export function displayCompanyName(info: any) {
  return info?.nameZh || DEFAULT_COMPANY_NAME
}

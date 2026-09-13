import { onBeforeUnmount, onMounted } from 'vue'
import * as echarts from 'echarts'

export function useECharts() {
  const charts = new Set<echarts.ECharts>()

  function mount(el: HTMLElement | undefined, option: echarts.EChartsOption) {
    if (!el) return null
    const chart = echarts.init(el)
    chart.setOption(option)
    charts.add(chart)
    return chart
  }

  function clear() {
    charts.forEach((c) => {
      try { c.dispose() } catch { /* already disposed */ }
    })
    charts.clear()
  }

  function resize() {
    charts.forEach((c) => c.resize())
  }

  onMounted(() => window.addEventListener('resize', resize))
  onBeforeUnmount(() => {
    window.removeEventListener('resize', resize)
    clear()
  })

  return { mount, clear }
}

export const axisLabelStyle = { color: '#5b6472', fontSize: 12 }
export const splitLineStyle = { lineStyle: { color: '#e3e7ec', type: 'dashed' as const } }
export const gridOpt = { left: 16, right: 24, top: 32, bottom: 8, containLabel: true }
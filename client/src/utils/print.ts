/**
 * 使用隐藏 iframe 打印 HTML，避免 window.open 打印窗口残留导致主界面失焦/控件不响应。
 * 打印完成后自动移除 iframe，并把焦点交回主窗口。
 */
export function printHtml(html: string): boolean {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.zIndex = '-1'
  document.body.appendChild(iframe)

  const win = iframe.contentWindow
  const doc = win?.document
  if (!win || !doc) {
    iframe.remove()
    return false
  }

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    window.setTimeout(() => {
      try { iframe.remove() } catch { /* ignore */ }
    }, 300)
    window.focus()
  }
  doc.open()
  doc.write(html)
  doc.close()
  // 必须在 document.close() 之后绑定：document.open() 会重置 iframe 文档的事件监听
  win.addEventListener('afterprint', cleanup, { once: true })
  win.onafterprint = cleanup

  let printed = false
  const doPrint = () => {
    if (printed) return
    printed = true
    try {
      // 不主动 focus iframe，避免打印后焦点停留在隐藏 iframe 上
      win.print()
    } catch {
      cleanup()
    }
  }
  // 等待 iframe 内容完成布局后再打印
  window.setTimeout(doPrint, 200)
  // 兜底清理：afterprint 未触发时不长期残留隐藏 iframe
  window.setTimeout(cleanup, 5 * 60 * 1000)
  return true
}

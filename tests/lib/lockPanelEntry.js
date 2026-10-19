// จุดเข้าสำหรับเทสต์แผงล็อกตัวเลขรายเดือน (tests/complaint-monthly-lock.test.mjs) — เรนเดอร์ตัวจริงใน Chrome แล้วกดปุ่มจริง
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import MonthlyLockPanel from '../../src/components/reports/MonthlyLockPanel.jsx'

const roots = []

/** วางแผงลงหน้า (onPublish ถูกแทนด้วยฟังก์ชันที่เทสต์ควบคุม ผ่าน window.__publish) */
export function mount(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  flushSync(() => {
    root.render(createElement(MonthlyLockPanel, {
      ...props,
      onPublish: note => window.__publish(note),
    }))
  })
  roots.push({ root, container })
  return container
}

export function unmountAll() {
  for (const { root, container } of roots.splice(0)) {
    root.unmount()
    container.remove()
  }
}

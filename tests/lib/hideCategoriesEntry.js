// จุดเข้าสำหรับเทสต์ปุ่ม "แสดง/ไม่แสดงชื่อหมวด" บนการ์ดภาพสรุป (tests/complaint-image-hide-categories.test.mjs)
// เรนเดอร์การ์ดตัวจริงใน Chrome พร้อมตัวห่อที่ต่อสายแบบเดียวกับ ComplaintStats.jsx:
// รายการปุ่มมาจากสรุปฉบับเต็ม (ไม่ซ่อน) ส่วนภาพมาจากสรุปที่คำนวณตามหมวดที่เลือกซ่อน
import { createElement, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import ComplaintMonthlyInfographic from '../../src/components/reports/ComplaintMonthlyInfographic.jsx'
import { monthPeriod, summarizeMonth } from '../../src/lib/complaintMonthlySummary.js'

const roots = []

// areaCounts/issueBreakdown = จำลองผลจาก complaint_area_ranking_fy / complaint_issue_breakdown_fy (ไม่ส่ง = ไม่มีการ์ดนั้น)
function Harness({ sample, staff, logoDataUrl = null, areaCounts = null, issueBreakdown = null }) {
  const [hidden, setHidden] = useState([])
  const args = {
    stats: sample.stats,
    // มีสถานะทุกแถว — ปิดหมวดแล้วผลการดำเนินงานนับใหม่จากรายเรื่อง (ไฟฟ้า 13 เรื่องเสร็จหมด เพื่อให้ % เปลี่ยนให้เห็น)
    rows: Object.entries(sample.categories).flatMap(([category, n]) => Array.from({ length: n }, (_, i) => ({
      category, status: category === 'light' || i > 0 ? 'done' : 'in_progress',
    }))),
    labelOf: code => sample.labels[code] ?? code,
    tenantName: 'เทศบาลตำบลสาธิต',
    period: monthPeriod(2569, 9),
    now: new Date('2026-10-18T05:00:00Z'),
    issueBreakdown,
    areaCounts,
  }
  const full = summarizeMonth(args)
  const exported = hidden.length ? summarizeMonth({ ...args, hiddenCategories: hidden }) : full
  return createElement(ComplaintMonthlyInfographic, {
    summary: exported,
    tenantName: 'เทศบาลตำบลสาธิต',
    categoryOptions: staff ? full.allCategories : null,
    hiddenCategories: hidden,
    onToggleCategory: code => setHidden(list => (list.includes(code) ? list.filter(c => c !== code) : [...list, code])),
    logoDataUrl,
  })
}

export function mount(props) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  flushSync(() => { root.render(createElement(Harness, props)) })
  roots.push({ root, container })
  return container
}

export function unmountAll() {
  for (const { root, container } of roots.splice(0)) {
    root.unmount()
    container.remove()
  }
}

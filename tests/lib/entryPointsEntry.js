// จุดเข้าสำหรับเทสต์ทางเข้าหน้าสรุปรายเดือน (tests/report-entry-points.test.mjs) — เรนเดอร์การ์ดเจ้าหน้าที่จริงในเบราว์เซอร์
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import MonthlyComplaintShareCard from '../../src/components/staff/MonthlyComplaintShareCard.jsx'
import { parseMonthParam } from '../../src/lib/complaintMonthlySummary.js'

export function renderCard(nowIso) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(MonthlyComplaintShareCard, { now: new Date(nowIso) })),
  )
}

export { parseMonthParam }

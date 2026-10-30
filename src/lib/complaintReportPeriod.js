import { fiscalYearOf } from './fiscalYear.js'

// ช่วงเวลาของรายงานคำร้องฝั่งเจ้าหน้าที่/แอดมิน (ReportManager)
// มุมมอง "ปี" นับตามปีงบประมาณให้ตรงกับหน้ารายงานสาธารณะ /reports/complaints — เดิมนับปีปฏิทิน
// คำร้องเดือน ต.ค. 2569 จึงอยู่ "ปี 2569" ที่นี่ แต่อยู่ "ปีงบ 2570" ที่หน้าประชาชน ตัวเลขสองหน้าเลยไม่ตรงกัน
// รายเดือนยังเลือกปี พ.ศ. ตามปฏิทินเหมือนเดิม เพราะเดือนหนึ่งอยู่ปีปฏิทินเดียวอยู่แล้ว

export function isInReportPeriod(value, { view, month, year, fiscalYear }) {
  const date = new Date(value)
  if (view === 'month') return date.getMonth() === month && date.getFullYear() === year
  if (view === 'year') return fiscalYearOf(date) === fiscalYear
  return true
}

// calendarMonth = เลขเดือนจริง 1-12 ตาม FISCAL_MONTHS_TH (ต.ค.→ก.ย.)
export function isInFiscalMonth(value, fiscalYear, calendarMonth) {
  const date = new Date(value)
  return fiscalYearOf(date) === fiscalYear && date.getMonth() === calendarMonth - 1
}

// ปีงบที่มีคำร้องจริง + ปีงบปัจจุบันเสมอ (ปีงบใหม่ที่ยังไม่มีเรื่องต้องเลือกดูเลข 0 ได้) เรียงล่าสุดก่อน
export function reportFiscalYears(complaints, now = new Date()) {
  const years = new Set(complaints.map(c => fiscalYearOf(new Date(c.created_at))))
  years.add(fiscalYearOf(now))
  return [...years].sort((a, b) => b - a)
}

import { fiscalYearBounds, fiscalQuarterBounds } from './fiscalYear.js'

export const REPORT_MODES = { month: 'รายเดือน', quarter: 'รายไตรมาส', year: 'รายปี', custom: 'กำหนดเอง' }
export const MAX_REPORT_DAYS = 3660
const DAY = 86400000
export function validReportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function reportDateLabel(value) {
  return new Date(`${value}T12:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric' })
}
export function reportPeriod({ mode = 'month', month, year, quarter = 1, basis = 'fiscal', from, to }) {
  if (!Object.hasOwn(REPORT_MODES, mode)) throw new Error('กรุณาเลือกประเภทรายงาน')
  if (mode === 'month') {
    if (!/^\d{4}-\d{2}$/.test(month || '') || !validReportDate(`${month}-01`)) throw new Error('กรุณาเลือกเดือน')
    from = `${month}-01`
    const [y, m] = month.split('-').map(Number)
    to = `${month}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`
  } else if (mode !== 'custom') {
    const be = Number(year), ce = be - 543, q = Number(quarter)
    if (!Number.isInteger(be) || ce < 1900 || ce > 2199) throw new Error('กรุณาระบุปี พ.ศ. ระหว่าง 2443–2742')
    if (!['fiscal', 'calendar'].includes(basis)) throw new Error('กรุณาเลือกปีงบประมาณหรือปีปฏิทิน')
    if (mode === 'quarter' && (!Number.isInteger(q) || q < 1 || q > 4)) throw new Error('กรุณาเลือกไตรมาส 1–4')
    if (basis === 'fiscal') ({ from, to } = mode === 'year' ? fiscalYearBounds(be) : fiscalQuarterBounds(be, q))
    else {
      const start = mode === 'year' ? 1 : (q - 1) * 3 + 1
      const end = mode === 'year' ? 12 : start + 2
      from = `${ce}-${String(start).padStart(2, '0')}-01`
      to = `${ce}-${String(end).padStart(2, '0')}-${new Date(Date.UTC(ce, end, 0)).getUTCDate()}`
    }
  }
  if (!validReportDate(from) || !validReportDate(to)) throw new Error('กรุณาระบุวันที่เริ่มและสิ้นสุดให้ครบ')
  if (from > to) throw new Error('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม กรุณาแก้ช่วงวันที่')
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY > MAX_REPORT_DAYS) throw new Error('เลือกช่วงครั้งละไม่เกิน 10 ปี หากต้องการมากกว่านี้ให้แยกพิมพ์แต่ละช่วง')
  const dates = `${reportDateLabel(from)} – ${reportDateLabel(to)}`
  const label = mode === 'month' ? `ประจำเดือน ${new Date(`${from}T12:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', month: 'long', year: 'numeric' })}`
    : mode === 'custom' ? 'ตามช่วงวันที่กำหนด' : `${mode === 'quarter' ? `ไตรมาส ${quarter} · ` : ''}${basis === 'fiscal' ? 'ปีงบประมาณ' : 'ปีปฏิทิน'} ${year}`
  const fileKey = mode === 'month' ? month : `${from}_${to}`
  return { mode, from, to, label, dates, fileKey, key: `${mode}:${from}:${to}:${label}` }
}

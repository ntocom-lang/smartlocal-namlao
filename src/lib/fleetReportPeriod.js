import { MONTHS_TH } from './thaiDate.js'
import {
  fiscalYearOf, fiscalQuarterOf, fiscalYearBounds, fiscalQuarterBounds, FISCAL_QUARTERS,
} from './fiscalYear.js'

export const MONTH_OPTIONS = MONTHS_TH.map((label, index) => ({ value: index + 1, label }))

export const PERIOD_MODES = [
  { value: 'month', label: 'รายเดือน' },
  { value: 'quarter', label: 'รายไตรมาส' },
  { value: 'year', label: 'รายปี' },
  { value: 'custom', label: 'กำหนดเอง' },
]

export const QUARTERS = FISCAL_QUARTERS

function pad(n) {
  return String(n).padStart(2, '0')
}

function ymd(yearCE, month, day) {
  return `${yearCE}-${pad(month)}-${pad(day)}`
}

function lastDayOfMonth(yearCE, month) {
  return new Date(yearCE, month, 0).getDate()
}

export function calendarYearCE(yearBE) {
  return Number(yearBE) - 543
}

export function currentPeriodDefaults(now = new Date()) {
  return {
    mode: 'month',
    month: now.getMonth() + 1,
    quarter: fiscalQuarterOf(now),
    yearBE: now.getFullYear() + 543,
    fiscalYearBE: fiscalYearOf(now),
  }
}

export function yearOptionsBE(now = new Date(), past = 6, future = 0) {
  const current = now.getFullYear() + 543
  return Array.from({ length: past + future + 1 }, (_, i) => current - past + i)
}

export function fiscalYearOptionsBE(now = new Date(), past = 6, future = 0) {
  const current = fiscalYearOf(now)
  return Array.from({ length: past + future + 1 }, (_, i) => current - past + i)
}

export function formatBEDate(iso) {
  const match = String(iso ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return `${day} ${MONTHS_TH[month - 1]} พ.ศ. ${year + 543}`
}

export function fleetPeriodRange({
  mode, yearBE, fiscalYearBE, month, quarter, dateFrom, dateTo,
}) {
  const y = calendarYearCE(yearBE)
  if (mode === 'month') {
    const mm = Number(month)
    const last = lastDayOfMonth(y, mm)
    return {
      from: ymd(y, mm, 1),
      to: ymd(y, mm, last),
      label: `ประจำเดือน ${MONTHS_TH[mm - 1]} พ.ศ. ${yearBE}`,
    }
  }
  if (mode === 'quarter') {
    const fy = Number(fiscalYearBE || yearBE)
    const q = QUARTERS.find(item => item.value === Number(quarter)) || QUARTERS[0]
    const bounds = fiscalQuarterBounds(fy, q.value)
    return {
      from: bounds.from,
      to: bounds.to,
      label: `ประจำไตรมาสที่ ${q.value} ปีงบประมาณ พ.ศ. ${fy} (${q.short})`,
    }
  }
  if (mode === 'year') {
    const fy = Number(fiscalYearBE || yearBE)
    const bounds = fiscalYearBounds(fy)
    return {
      from: bounds.from,
      to: bounds.to,
      label: `ประจำปีงบประมาณ พ.ศ. ${fy} (${formatBEDate(bounds.from)} – ${formatBEDate(bounds.to)})`,
    }
  }
  const from = String(dateFrom ?? '').trim()
  const to = String(dateTo ?? '').trim()
  const fromText = formatBEDate(from)
  const toText = formatBEDate(to)
  return {
    from,
    to,
    label: fromText && toText ? `ตั้งแต่วันที่ ${fromText} ถึง ${toText}` : '',
  }
}

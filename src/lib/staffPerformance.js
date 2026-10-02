// ผลการปฏิบัติงานรายคนจากคำร้อง — ตัวคำนวณล้วนของเมนู "ผลการปฏิบัติงาน"
// รับแถวจาก RPC staff_performance_rows (supabase/migrations/20260927150000_staff_performance_rows_rpc.sql)
// แล้วจัดเป็น 3 มิติตามส่วนที่ 1 ของแบบประเมินผลการปฏิบัติงาน (ปริมาณ / คุณภาพ / ประโยชน์)
//
// ระบบไม่ให้คะแนน ไม่เทียบค่าเป้าหมาย และไม่จัดอันดับคน — ผู้ประเมินเป็นผู้เทียบกับข้อตกลงต้นรอบเอง
//
// ⚠️ ไฟล์นี้ต้องไม่ import supabase — เทสต์รันด้วย node ตรงๆ
// ⚠️ วันที่ทุกจุดต้องแปลงเป็นวันตามเวลาไทยก่อนเทียบ ห้ามพึ่ง timezone ของเครื่อง
//    (เรื่องที่ปิดตอน 00:30 น. วันที่ 1 เม.ย. ต้องนับเป็นรอบที่ 2 แม้เครื่องจะตั้งเวลาเป็นประเทศอื่น)

import { fleetPeriodRange, formatBEDate } from './fleetReportPeriod.js'
import { fiscalQuarterBounds, FISCAL_MONTHS_TH } from './fiscalYear.js'
import { workingDaysBetween, missingHolidayYears } from './workingDays.js'
import { isFinishedLike } from './complaintWorkflow.js'
import { printableCategoryLabel } from './complaintCategoryLabels.js'

export const PERFORMANCE_PERIOD_MODES = [
  { value: 'month', label: 'รายเดือน' },
  { value: 'quarter', label: 'รายไตรมาส' },
  { value: 'year', label: 'รายปีงบประมาณ' },
  { value: 'round', label: 'รอบการประเมิน' },
]

export const EVALUATION_ROUNDS = [
  { value: 1, label: 'รอบที่ 1 (1 ต.ค. – 31 มี.ค.)' },
  { value: 2, label: 'รอบที่ 2 (1 เม.ย. – 30 ก.ย.)' },
]

// ถ้อยคำของ 3 มิติต้องตรงกับแบบประเมินที่ อปท. ใช้จริง — แก้ที่นี่ที่เดียว
export const DIMENSION_LABELS = {
  quantity: 'เชิงปริมาณ',
  quality: 'เชิงคุณภาพ',
  benefit: 'เชิงประโยชน์ (ความรวดเร็ว)',
}

export const CHANNEL_LABELS = {
  citizen_online: 'ออนไลน์',
  oss_counter: 'เคาน์เตอร์',
}

const OPEN_STATUSES = ['received', 'in_progress']

const BANGKOK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** วันตามเวลาไทยแบบ 'YYYY-MM-DD' — สตริงวันที่ล้วน (คอลัมน์ date) คืนค่าเดิม */
export function bangkokDateOf(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return BANGKOK_DATE.format(date)
}

/** '2026-09-24' → '24 ก.ย. 2569' */
export function thaiShortDate(isoDate) {
  const match = String(isoDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const month = FISCAL_MONTHS_TH.find((m) => m.month === Number(match[2]))
  return `${Number(match[3])} ${month?.label ?? ''} ${Number(match[1]) + 543}`
}

function fiscalYearBEOfDate(isoDate) {
  const year = Number(isoDate.slice(0, 4))
  const month = Number(isoDate.slice(5, 7))
  return (month >= 10 ? year + 1 : year) + 543
}

/**
 * ช่วงวันที่ของรายงาน — เดือน/ไตรมาส/ปีงบ ใช้ fleetPeriodRange() เดิม
 * รอบการประเมิน: รอบ 1 = ไตรมาส 1–2 ของปีงบ, รอบ 2 = ไตรมาส 3–4
 */
export function performancePeriodRange({ mode, yearBE, fiscalYearBE, month, quarter, round }) {
  if (mode === 'round') {
    const fy = Number(fiscalYearBE)
    const r = Number(round) === 1 ? 1 : 2
    const from = fiscalQuarterBounds(fy, r === 1 ? 1 : 3).from
    const to = fiscalQuarterBounds(fy, r === 1 ? 2 : 4).to
    return {
      from,
      to,
      label: `รอบการประเมินที่ ${r} ปีงบประมาณ พ.ศ. ${fy} (${formatBEDate(from)} – ${formatBEDate(to)})`,
    }
  }
  return fleetPeriodRange({ mode, yearBE, fiscalYearBE, month, quarter })
}

/**
 * ช่วงที่เปิดหน้ามาแล้วเห็นก่อน: ปกติเป็นเดือนนี้ · เดือน ต.ค. และ เม.ย. เป็นช่วงประเมิน
 * จึงเลือกรอบการประเมินที่เพิ่งจบให้เลย (ต.ค. = รอบ 2 ของปีงบที่แล้ว, เม.ย. = รอบ 1 ของปีงบนี้)
 */
export function defaultPerformancePeriod(now = new Date()) {
  const today = bangkokDateOf(now)
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const fiscalYearBE = fiscalYearBEOfDate(today)
  const quarter = month >= 10 ? 1 : month <= 3 ? 2 : month <= 6 ? 3 : 4
  const base = { mode: 'month', yearBE: year + 543, month, fiscalYearBE, quarter, round: month >= 10 || month <= 3 ? 1 : 2 }
  if (month === 10) return { ...base, mode: 'round', fiscalYearBE: fiscalYearBE - 1, round: 2 }
  if (month === 4) return { ...base, mode: 'round', round: 1 }
  return base
}

function earliest(values) {
  const present = values.filter(Boolean).map((v) => new Date(v)).filter((d) => !Number.isNaN(d.getTime()))
  if (present.length === 0) return null
  return new Date(Math.min(...present.map((d) => d.getTime())))
}

/**
 * แปลงแถวจาก RPC เป็นรายการที่คำนวณต่อได้
 * - เรื่องที่ปิดผ่านปุ่ม "ดำเนินการแล้ว" (finish_recorded) ใช้ closed_at ตรงๆ
 * - แถวก่อนมีปุ่ม closed_at คือเวลาที่แอดมินรับงาน จึงใช้วันที่เก่าที่สุดระหว่าง closed_at กับแถว
 *   timeline done แรก แล้วติดธง legacy (แสดงเป็น †)
 * - เสร็จแล้วแต่ไม่มีวันที่เลย → completionSource 'unknown' แยกลิสต์ ไม่นับตามช่วงเวลา
 */
export function normalizePerformanceRows(rows = []) {
  return rows.map((row) => {
    const finished = isFinishedLike(row.status)
    let completedAt = null
    let completionSource = null
    if (finished) {
      if (row.finish_recorded && row.closed_at) {
        completedAt = row.closed_at
        completionSource = 'recorded'
      } else {
        completedAt = earliest([row.closed_at, row.first_done_at])
        completionSource = completedAt ? 'legacy' : 'unknown'
      }
    }
    const createdDate = bangkokDateOf(row.created_at)
    const receivedDate = bangkokDateOf(row.received_at) ?? createdDate
    const completedDate = bangkokDateOf(completedAt)
    const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : null
    const dateAnomaly = Boolean(completedDate && receivedDate && completedDate < receivedDate)
    const workingDays = completedDate && receivedDate && !dateAnomaly
      ? workingDaysBetween(receivedDate, completedDate)
      : null
    let dueResult = null
    if (completedDate) dueResult = dueDate ? (completedDate <= dueDate ? 'on_time' : 'late') : 'no_due'
    const rating = Number(row.rating)
    return {
      id: row.id,
      refNo: row.ref_no ?? null,
      category: row.category ?? null,
      issueType: row.issue_type ?? null,
      village: row.village ?? null,
      channel: row.channel ?? null,
      status: row.status,
      isConfidential: Boolean(row.is_confidential),
      finished,
      open: OPEN_STATUSES.includes(row.status),
      rejected: row.status === 'rejected',
      createdDate,
      receivedDate,
      completedDate,
      completionSource,
      dueDate,
      dueResult,
      workingDays,
      dateAnomaly,
      reopened: Number(row.reopen_count) > 0,
      rating: rating >= 1 && rating <= 5 ? rating : null,
      closedOnBehalfBy: row.resolved_by_name || null,
    }
  })
}

/** ร้อยละทศนิยม 1 ตำแหน่ง หรือ null เมื่อไม่มีตัวหาร */
export function percent(numerator, denominator) {
  if (!denominator) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function inRange(date, from, to) {
  return Boolean(date) && date >= from && date <= to
}

function emptyGroup(category) {
  return { category, completed: [], received: 0, receivedDone: 0, openAtEnd: 0, openPastDue: 0 }
}

function finishGroup(group) {
  const done = group.completed
  const onTime = done.filter((i) => i.dueResult === 'on_time').length
  const late = done.filter((i) => i.dueResult === 'late').length
  const rated = done.filter((i) => i.rating != null)
  const notReopened = done.filter((i) => !i.reopened).length
  return {
    category: group.category,
    quantity: {
      completed: done.length,
      received: group.received,
      receivedDone: group.receivedDone,
      receivedDoneRate: percent(group.receivedDone, group.received),
      openAtEnd: group.openAtEnd,
    },
    quality: {
      notReopened,
      notReopenedRate: percent(notReopened, done.length),
      reopened: done.length - notReopened,
      ratingCount: rated.length,
      ratingAverage: rated.length ? Math.round((rated.reduce((s, i) => s + i.rating, 0) / rated.length) * 10) / 10 : null,
    },
    benefit: {
      onTime,
      late,
      openPastDue: group.openPastDue,
      noDue: done.filter((i) => i.dueResult === 'no_due').length,
      // ใส่เรื่องค้างที่เลยกำหนดในตัวหารด้วย ไม่งั้นการปล่อยเรื่องยากค้างไว้จะทำให้ร้อยละดูดีขึ้น
      onTimeRate: percent(onTime, onTime + late + group.openPastDue),
      medianWorkingDays: median(done.map((i) => i.workingDays)),
    },
    legacyCount: done.filter((i) => i.completionSource === 'legacy').length,
  }
}

/**
 * สรุปผลของช่วง [from, to] (สตริงวันไทย รวมทั้งสองปลาย)
 * today ใช้ตัดสินว่าเรื่องค้าง "เลยกำหนดแล้ว" หรือยัง เมื่อช่วงยังไม่จบ
 */
export function summarizePerformance(items, { from, to, today = bangkokDateOf(new Date()) } = {}) {
  const asOf = today && today < to ? today : to
  const groups = new Map()
  const groupOf = (category) => {
    if (!groups.has(category)) groups.set(category, emptyGroup(category))
    return groups.get(category)
  }
  const completedItems = []
  const openItems = []
  const undatedItems = []
  const confidential = { completed: 0, openAtEnd: 0 }
  let rejected = 0
  let dateAnomalies = 0

  for (const item of items) {
    if (item.rejected) {
      if (inRange(item.createdDate, from, to)) rejected++
      continue
    }
    if (item.dateAnomaly) dateAnomalies++
    const completedInPeriod = item.finished && inRange(item.completedDate, from, to)
    const openAtEnd = Boolean(item.receivedDate && item.receivedDate <= to)
      && (item.open || (item.finished && item.completedDate > to))
    if (item.finished && item.completionSource === 'unknown') {
      if (!item.isConfidential) undatedItems.push(item)
      continue
    }
    if (item.isConfidential) {
      if (completedInPeriod) confidential.completed++
      if (openAtEnd) confidential.openAtEnd++
      continue
    }
    const group = groupOf(item.category)
    if (completedInPeriod) {
      group.completed.push(item)
      completedItems.push(item)
    }
    if (inRange(item.receivedDate, from, to)) {
      group.received++
      if (item.finished && item.completedDate && item.completedDate <= to) group.receivedDone++
    }
    if (openAtEnd) {
      group.openAtEnd++
      const pastDue = Boolean(item.dueDate && item.dueDate < asOf)
      if (pastDue) group.openPastDue++
      openItems.push({ ...item, pastDue, finishedAfterPeriod: item.finished })
    }
  }

  const byCategory = [...groups.values()]
    .map(finishGroup)
    .filter((g) => g.quantity.completed || g.quantity.received || g.quantity.openAtEnd)
    .sort((a, b) => b.quantity.completed - a.quantity.completed || String(a.category).localeCompare(String(b.category)))
  const total = finishGroup({
    category: null,
    completed: completedItems,
    received: byCategory.reduce((s, g) => s + g.quantity.received, 0),
    receivedDone: byCategory.reduce((s, g) => s + g.quantity.receivedDone, 0),
    openAtEnd: byCategory.reduce((s, g) => s + g.quantity.openAtEnd, 0),
    openPastDue: byCategory.reduce((s, g) => s + g.benefit.openPastDue, 0),
  })
  const byDate = (key) => (a, b) => String(a[key]).localeCompare(String(b[key])) || String(a.refNo).localeCompare(String(b.refNo))

  return {
    from,
    to,
    asOf,
    byCategory,
    total,
    completedItems: completedItems.sort(byDate('completedDate')),
    openItems: openItems.sort(byDate('receivedDate')),
    undatedItems: undatedItems.sort(byDate('receivedDate')),
    confidential,
    rejected,
    dateAnomalies,
    holidayYearsMissing: missingHolidayYears(Number(from.slice(0, 4)), Number(to.slice(0, 4))),
  }
}

function itemNotes(item) {
  const notes = []
  if (item.completionSource === 'legacy') notes.push('† วันที่จากประวัติการดำเนินงาน')
  if (item.reopened) notes.push('ผู้ร้องเปิดเรื่องกลับ')
  if (item.closedOnBehalfBy) notes.push(`ปิดงานแทนโดย ${item.closedOnBehalfBy}`)
  if (item.rating != null) notes.push(`คะแนนผู้ร้อง ${item.rating}/5`)
  if (item.dateAnomaly) notes.push('วันที่แล้วเสร็จก่อนวันรับเรื่อง ตรวจสอบข้อมูล')
  return notes.join(' · ')
}

const DUE_RESULT_LABELS = { on_time: 'ทันกำหนด', late: 'เกินกำหนด', no_due: 'ไม่มีกำหนด' }

/** แถวสำหรับ CSV — กลุ่ม แล้วเสร็จ / ค้าง ณ สิ้นช่วง / ไม่ทราบวันแล้วเสร็จ */
export function performanceCsvRows(summary, { categoryLabels = {} } = {}) {
  const label = (category) => (category ? printableCategoryLabel(category, categoryLabels[category] ?? category) : '')
  const row = (group, item, result) => [
    group,
    item.refNo ?? '',
    label(item.category),
    item.issueType ?? '',
    item.village ?? '',
    CHANNEL_LABELS[item.channel] ?? item.channel ?? '',
    thaiShortDate(item.receivedDate),
    thaiShortDate(item.completedDate),
    item.workingDays ?? '',
    thaiShortDate(item.dueDate),
    result,
    itemNotes(item),
  ]
  return [
    ['กลุ่ม', 'เลขที่', 'หมวด', 'ลักษณะปัญหา', 'หมู่บ้าน', 'ช่องทาง', 'วันที่รับเรื่อง', 'วันที่แล้วเสร็จ',
      'วันทำการที่ใช้', 'วันครบกำหนด', 'ผลเทียบกำหนด', 'หมายเหตุ'],
    ...summary.completedItems.map((i) => row('แล้วเสร็จ', i, DUE_RESULT_LABELS[i.dueResult] ?? '')),
    ...summary.openItems.map((i) => row('ค้าง ณ สิ้นช่วง', i, i.pastDue ? 'เลยกำหนด' : '')),
    ...summary.undatedItems.map((i) => row('ไม่ทราบวันแล้วเสร็จ', i, '')),
  ]
}

// Excel ตีความเซลล์ที่ขึ้นต้นด้วย = + - @ เป็นสูตร และข้อความหมู่บ้าน/ลักษณะปัญหามาจากที่ประชาชนพิมพ์
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/** CSV ที่ Excel เปิดภาษาไทยได้ถูก (มี BOM) */
export function toCsv(rows) {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

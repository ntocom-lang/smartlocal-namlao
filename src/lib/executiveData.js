// ตัวเลขของ "ห้องผู้บริหาร" เฟส E1 + E2 (E2 อยู่ท้ายไฟล์) — ฟังก์ชันบริสุทธิ์ล้วน (ไม่ import React/supabase เทสต์ด้วย node ได้)
//
// แหล่งข้อมูลมีแค่ RPC ใน EXEC_E1_RPCS (executiveRegistry.js) — viewer/ปลัดอ่านตาราง complaints/document_requests
// ตรงๆ ไม่ได้ (RLS) หน้านี้จึงห้าม supabase.from('complaints'|'document_requests') เด็ดขาด
// ตัวเลขทุกตัวต้องตรงกับหน้าสถิติสาธารณะ (/reports/complaints, /doc-stats) เพราะใช้ RPC ชุดเดียวกัน

import { addDays, bangkokIsoDate, thaiDateRange, thaiShortDate } from './complaintReportPeriods.js'
import { BASE_DOCUMENT_TYPES, allDocumentTypes } from './documentTypes.js'
import { categoryNameOf } from './complaintCategoryLabels.js'
import { fiscalYearBounds, fiscalYearOf } from './fiscalYear.js'
import { ownerOfDocType, isPhaseLive } from './executiveRegistry.js'
import { workingDaysBetween, workingDaysSince } from './workingDays.js'
import { percent } from './staffPerformance.js'
import { STAGES, STAGE_LABELS } from './constructionLifecycle.js'
import { fiscalYearOfIso } from './localPlanView.js'
import { fiscalMonthRange } from './localPlanCalendar.js'

// ───────────────────────── ช่วงเวลา ─────────────────────────

export const EXEC_PERIODS = Object.freeze(['today', '7d', 'month', 'fy'])
export const EXEC_PERIOD_LABELS = Object.freeze({ today: 'วันนี้', '7d': '7 วัน', month: 'เดือนนี้', fy: 'ปีงบ' })
export const EXEC_DEFAULT_PERIOD = 'month'

const pad = (n, width = 2) => String(n).padStart(width, '0')
const iso = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`
const partsOf = (isoDate) => ({ y: Number(isoDate.slice(0, 4)), m: Number(isoDate.slice(5, 7)), d: Number(isoDate.slice(8, 10)) })
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
// วันที่เดิมในเดือน/ปีที่ย้ายไป — วันที่ไม่มีในเดือนนั้น (31 → เดือนที่มี 30 วัน, 29 ก.พ.) ใช้วันสุดท้ายของเดือน
const clampedDate = (y, m, d) => iso(y, m, Math.min(d, daysInMonth(y, m)))

/** วันที่ตามปฏิทินไทย (Asia/Bangkok) ของเวลาใดๆ — Intl ไม่พึ่งโซนเวลาของเครื่อง */
export const execToday = (now = new Date()) => bangkokIsoDate(now)

/**
 * วันเริ่มปีงบ (1 ต.ค.) ที่ครอบคลุมวันที่นี้ — ใช้กติกาปีงบกลางของระบบ (src/lib/fiscalYear.js) ไม่เขียนซ้ำ
 * สร้าง Date จาก "ส่วนประกอบของวันที่ไทยที่ได้มาแล้ว" ด้วยโซนเครื่องเอง (new Date(y, m-1, d)) แล้วให้ fiscalYearOf อ่านด้วยโซนเดียวกัน
 * ผลจึงไม่ขึ้นกับโซนเวลาของเครื่อง (วันที่ไทยตัดสินไปแล้วที่ execToday)
 */
export function fiscalYearStart(isoDate) {
  const { y, m, d } = partsOf(isoDate)
  return fiscalYearBounds(fiscalYearOf(new Date(y, m - 1, d))).from
}

/**
 * ช่วงของตัวเลือก — ทุกช่วง "นับถึงวันนี้" (to = วันนี้) ไม่ใช่ถึงสิ้นเดือน/สิ้นปีงบ
 * ตัวเลขของวันอนาคตเป็น 0 อยู่แล้ว ผลนับไม่ต่าง แต่ลูกศรเทียบต้องเทียบ "จำนวนวันที่ผ่านไปเท่ากัน":
 * เดือนนี้เดินมา 10 วัน เทียบทั้งเดือนก่อนจะเห็นว่าลดลงเสมอ (ผิด)
 *   today → วันนี้ · 7d → 7 วันล่าสุดรวมวันนี้ · month → 1 ของเดือน..วันนี้ · fy → 1 ต.ค...วันนี้
 * @returns {{ from: string, to: string }} YYYY-MM-DD (ค.ศ.) ปลายทางนับรวม — ส่งเข้า RPC ชุด _fy ได้ตรงๆ
 */
export function execPeriodRange(period, now = new Date()) {
  const today = execToday(now)
  const { y, m } = partsOf(today)
  switch (period) {
    case 'today': return { from: today, to: today }
    case '7d': return { from: addDays(today, -6), to: today }
    case 'month': return { from: iso(y, m, 1), to: today }
    case 'fy': return { from: fiscalYearStart(today), to: today }
    default: throw new Error(`ช่วงเวลาไม่รู้จัก: ${period}`)
  }
}

/** ช่วงก่อนหน้าความยาวเท่ากัน (สำหรับลูกศรเทียบ) — วัน/7 วัน: ช่วงติดกันก่อนหน้า · เดือน: เดือนก่อน · ปีงบ: ปีงบก่อน */
export function execPreviousRange(period, now = new Date()) {
  const today = execToday(now)
  const { y, m, d } = partsOf(today)
  switch (period) {
    case 'today': { const day = addDays(today, -1); return { from: day, to: day } }
    case '7d': return { from: addDays(today, -13), to: addDays(today, -7) }
    case 'month': {
      const py = m === 1 ? y - 1 : y
      const pm = m === 1 ? 12 : m - 1
      return { from: iso(py, pm, 1), to: clampedDate(py, pm, d) }
    }
    case 'fy': {
      const start = fiscalYearStart(today)
      const startY = Number(start.slice(0, 4))
      const toY = m >= 10 ? startY : startY + 1 // ปีปฏิทินของวันนี้
      return { from: iso(startY - 1, 10, 1), to: clampedDate(toY - 1, m, d) }
    }
    default: throw new Error(`ช่วงเวลาไม่รู้จัก: ${period}`)
  }
}

/** ช่วงวันที่ภาษาไทยสำหรับหัวส่วน: วันเดียว "10 พ.ย. 2569" · หลายวัน "1 ต.ค. – 10 พ.ย. 2569" */
export function execRangeText({ from, to }) {
  return from === to ? thaiShortDate(from) : thaiDateRange(from, to)
}

/** ข้อความบอกว่าลูกศรเทียบกับอะไร */
export const EXEC_COMPARE_LABELS = Object.freeze({
  today: 'เมื่อวาน',
  '7d': '7 วันก่อนหน้า',
  month: 'ช่วงเดียวกันของเดือนก่อน',
  fy: 'ช่วงเดียวกันของปีงบก่อน',
})

// ───────────────────────── ตัวช่วยตัวเลข ─────────────────────────

/** ตัวเลขจาก RPC → จำนวนเต็มไม่ติดลบ (ข้อมูลผิดรูป/ว่าง = 0) */
export function execCount(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** ค่าเฉลี่ยวัน → ทศนิยม 1 ตำแหน่ง หรือ null เมื่อไม่มีข้อมูล (ไม่มีเรื่องที่เสร็จ ห้ามเป็น 0) */
export function execAvgDays(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null
}

/** เทียบช่วงนี้กับช่วงก่อน — คืนทิศ/ผลต่าง ไม่ตัดสินดี-เลว (เรื่องใหม่เพิ่ม ไม่ได้แปลว่าแย่) */
export function compareValues(current, previous) {
  const cur = execCount(current)
  const prev = execCount(previous)
  const diff = cur - prev
  return {
    current: cur,
    previous: prev,
    diff,
    dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
    pct: prev > 0 ? Math.round((diff / prev) * 100) : null, // ช่วงก่อนเป็น 0 = คิดเปอร์เซ็นต์ไม่ได้
  }
}

// ───────────────────────── ชีพจร ②-1 ─────────────────────────

/**
 * สถิติคำร้องจาก complaint_stats_fy
 * ยังไม่เสร็จ = open + in_progress + parked (parked คือ "ขึ้นทะเบียนรอดำเนินการ" ยังเป็นงานค้าง ไม่ใช่เสร็จ/ปฏิเสธ)
 */
export function normalizeComplaintStats(stats) {
  const parked = execCount(stats?.parked)
  return {
    total: execCount(stats?.total),
    open: execCount(stats?.open) + execCount(stats?.in_progress) + parked,
    done: execCount(stats?.resolved),
    rejected: execCount(stats?.rejected),
    parked,
    avgDays: execAvgDays(stats?.avg_days),
  }
}

/** สถิติคำขอจาก doc_request_stats_fy — ยังไม่เสร็จ = pending + processing */
export function normalizeDocStats(stats) {
  return {
    total: execCount(stats?.total),
    open: execCount(stats?.pending) + execCount(stats?.processing),
    done: execCount(stats?.completed),
    rejected: execCount(stats?.rejected),
    parked: 0,
    avgDays: execAvgDays(stats?.avg_days),
  }
}

/**
 * รวมชีพจรของสองแหล่ง (null = แหล่งนั้นปิดโมดูล ไม่นับ) · ไม่รวมค่าเฉลี่ยวันข้ามสองชุด
 * (คำร้องกับคำขอมีกำหนดคนละแบบ ค่าเฉลี่ยรวมอ่านไม่ได้ความหมาย — เวลาเฉลี่ยอยู่ในตาราง ②-2 แยกรายแถว)
 * @returns {{ new: number, open: number, done: number, parked: number }}
 */
export function summarizePulse({ complaints = null, docs = null } = {}) {
  const parts = [complaints && normalizeComplaintStats(complaints), docs && normalizeDocStats(docs)].filter(Boolean)
  return parts.reduce((sum, p) => ({
    new: sum.new + p.total,
    open: sum.open + p.open,
    done: sum.done + p.done,
    parked: sum.parked + p.parked,
  }), { new: 0, open: 0, done: 0, parked: 0 })
}

// ───────────────────────── แถวรายเรื่อง (กรองคอลัมน์) ─────────────────────────

export const EXEC_ROW_LIMIT = 5000

/**
 * คำขอรายเรื่องจาก doc_requests_public_fy — เก็บเฉพาะคอลัมน์ที่หน้านี้ใช้
 * ⚠️ ทิ้งคอลัมน์ purpose (ข้อความที่ผู้ยื่นพิมพ์เอง) ตั้งแต่ตรงนี้ — ห้ามเข้า state/แคชของหน้า (PDPA)
 */
export function projectDocRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    doc_type: r?.doc_type ?? null,
    status: r?.status ?? null,
    created_at: r?.created_at ?? null,
    issued_at: r?.issued_at ?? null,
    days_taken: r?.days_taken ?? null,
  }))
}

/** คำร้องรายเรื่องจาก complaints_public_fy — เก็บเฉพาะหมวด/สถานะ/วัน (ไม่มีชื่อผู้แจ้ง และไม่เก็บเลขที่เรื่อง) */
export function projectComplaintRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    category: r?.category ?? null,
    status: r?.status ?? null,
    created_at: r?.created_at ?? null,
    closed_at: r?.closed_at ?? null,
    days_taken: r?.days_taken ?? null,
  }))
}

/**
 * แถวรายเรื่องถูกตัดหรือไม่ — ได้ครบ limit = อาจมีต่อ · ได้น้อยกว่ายอดรวมจากสถิติ = เซิร์ฟเวอร์ตัดเอง
 * (Supabase ตั้ง max_rows = 1000 ขอ 5000 ก็ได้ 1000 จึงเทียบยอดรวมด้วย ไม่ใช้แค่ "ครบ limit")
 */
export function rowsTruncated(rowCount, { limit = EXEC_ROW_LIMIT, knownTotal = null } = {}) {
  if (rowCount >= limit) return true
  return knownTotal != null && Number.isFinite(Number(knownTotal)) && rowCount < Number(knownTotal)
}

// ───────────────────────── ตาราง ②-2 ─────────────────────────

// ประเภทเก่าที่ตัดออกจากตัวเลือกยื่นแล้ว แต่คำขอเดิมยังอยู่ในระบบ (ดูคอมเมนต์หัว BASE_DOCUMENT_TYPES)
const LEGACY_DOC_LABELS = Object.freeze({
  residence_cert: 'ใบรับรองการอยู่อาศัย',
  personal_cert: 'หนังสือรับรองบุคคล',
})

// ตัดอีโมจิหน้าชื่อ ("🏦 ค่าธรรมเนียม/ภาษี" → "ค่าธรรมเนียม/ภาษี") — ตารางตัวเลขอ่านง่ายกว่าไม่มีอีโมจิ
const stripLeadingEmoji = (label) => String(label ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim()

/** ชื่อไทยของ document_type — ประเภทมาตรฐานทุกตัว (รวมที่ อปท. ลบแล้ว) + ประเภทที่ อปท. เพิ่มเอง + ประเภทเก่า */
export function docTypeLabelOf(docType, tenant) {
  const everKnown = [...BASE_DOCUMENT_TYPES, ...allDocumentTypes(tenant)]
  const hit = everKnown.find((t) => t.value === docType)
  return stripLeadingEmoji(hit?.label) || LEGACY_DOC_LABELS[docType] || String(docType ?? 'ไม่ระบุประเภท')
}

const emptyTally = () => ({ total: 0, open: 0, done: 0, rejected: 0, daySum: 0, dayN: 0 })

function tallyDocRows(rows) {
  const byType = new Map()
  for (const r of rows) {
    const t = r?.doc_type
    if (!t) continue
    const tally = byType.get(t) ?? emptyTally()
    tally.total += 1
    if (r.status === 'pending' || r.status === 'processing') tally.open += 1
    else if (r.status === 'completed') {
      tally.done += 1
      const days = Number(r.days_taken)
      if (r.days_taken != null && Number.isFinite(days) && days >= 0) { tally.daySum += days; tally.dayN += 1 }
    } else if (r.status === 'rejected') tally.rejected += 1
    byType.set(t, tally)
  }
  return byType
}

/** by_type ของ exec_summary_doc_requests (ปรับรูปแล้ว: normalizeDocRequestsSummary().byType) → tally แบบเดียวกับ tallyDocRows */
function talliesFromByType(byType) {
  const out = new Map()
  for (const r of Array.isArray(byType) ? byType : []) {
    if (!r?.t) continue
    const days = r.avgDays
    out.set(r.t, {
      total: execCount(r.total), open: execCount(r.pending) + execCount(r.processing), done: execCount(r.completed), rejected: execCount(r.rejected),
      // avg_days เป็นค่าเฉลี่ยที่ฐานข้อมูลคิดแล้ว — ใส่เป็น "ผลรวมของ 1 กลุ่ม" ให้ avgDays ด้านล่างคืนค่าเดิม (null = ไม่มีเรื่องที่เสร็จ)
      daySum: days == null ? 0 : days, dayN: days == null ? 0 : 1,
    })
  }
  return out
}

/**
 * แถวตาราง ②-2: แถวคำร้อง 1 แถว + 1 แถวต่อ document_type
 *
 * รายการประเภท = (ประเภทที่ อปท. เปิดรับอยู่ และโมดูลเจ้าของเปิด) ∪ (ประเภทที่มีเรื่องจริงในช่วงนั้น)
 *   - ประเภทเปิดอยู่แต่ไม่มีเรื่อง → แสดง 0 ไม่ซ่อน (ผู้บริหารต้องเห็นว่า "ไม่มี" ไม่ใช่ "ไม่รู้จัก")
 *   - ประเภทที่ปิดแล้ว/โมดูลปิดแล้ว แต่ยังมีเรื่องในช่วงนั้น → แสดงพร้อม closed: true (ป้าย "(ปิดรับแล้ว)")
 *   - ประเภทที่ อปท. เพิ่มเอง → เจ้าของแถวตกที่รายการ acceptsCustomTypes (กล่องคำขอบริการ) ตาม ownerOfDocType
 *
 * @param {{
 *   complaintStats: object|null,  // complaint_stats_fy · null = ไม่แสดงแถวคำร้อง (โมดูลปิด)
 *   docRows: Array|null,          // projectDocRows(doc_requests_public_fy) · null = ไม่แสดงแถวคำขอ (เฟส E1)
 *   docByType?: Array|null,       // E2: normalizeDocRequestsSummary().byType — มีค่าแล้วใช้แทน docRows (นับในฐานข้อมูลครบทุกแถว)
 *   tenant: object|null,
 *   isModuleEnabled?: (key: string) => boolean,
 *   complaintEntry?: object,      // รายการ 'complaints' จากทะเบียน (ใช้ทำลิงก์)
 * }} input
 */
export function buildServiceRows({ complaintStats, docRows = null, docByType = null, tenant = null, isModuleEnabled = () => true, complaintEntry = null }) {
  const rows = []

  if (complaintStats) {
    const c = normalizeComplaintStats(complaintStats)
    rows.push({
      id: 'complaints', kind: 'complaint', label: complaintEntry?.label ?? 'คำร้อง/ร้องทุกข์', docType: null, closed: false,
      owner: complaintEntry, total: c.total, open: c.open, done: c.done, rejected: c.rejected, avgDays: c.avgDays,
    })
  }

  if (docRows || docByType) {
    // E2: docByType = doc_requests.by_type ที่นับในฐานข้อมูลครบทุกแถว (ไม่ถูกตัดที่ 1,000 แถว) · ไม่ส่ง = นับจากรายการรายเรื่องแบบ E1
    const tallies = docByType ? talliesFromByType(docByType) : tallyDocRows(docRows)
    const openTypes = allDocumentTypes(tenant)
      .map((t) => t.value)
      .filter((value) => {
        const owner = ownerOfDocType(value)
        return !owner || isModuleEnabled(owner.key)
      })
    const order = [...openTypes]
    const withData = [...tallies.keys()].filter((t) => !openTypes.includes(t))
      .sort((a, b) => (tallies.get(b).total - tallies.get(a).total) || String(a).localeCompare(String(b)))
    order.push(...withData)

    const seen = new Set()
    for (const docType of order) {
      if (seen.has(docType)) continue
      seen.add(docType)
      const t = tallies.get(docType) ?? emptyTally()
      rows.push({
        id: `doc:${docType}`, kind: 'doc', docType,
        label: docTypeLabelOf(docType, tenant),
        closed: !openTypes.includes(docType),
        owner: ownerOfDocType(docType) ?? null,
        total: t.total, open: t.open, done: t.done, rejected: t.rejected,
        avgDays: t.dayN > 0 ? Math.round((t.daySum / t.dayN) * 10) / 10 : null,
      })
    }
  }
  return rows
}

/**
 * แยกแถวตาราง ②-2 เป็น "มีเรื่องในช่วงนี้" กับ "ไม่มีเรื่อง" — เจ้าของระบบสั่ง 2569-11-10: แสดงเฉพาะแถวที่มีเรื่อง
 * แถว 0 ซ่อนไว้หลังปุ่ม "แสดงประเภทที่ไม่มีเรื่อง" (ยังเปิดดูได้ว่าระบบมีบริการอะไรบ้าง ไม่ได้ตัดทิ้ง)
 * ใช้กติกาเดียวกันทุกแถวรวมแถวคำร้อง · คงลำดับเดิมของ buildServiceRows
 * E2: แถวที่ไม่มีเรื่องยื่นในช่วงนี้แต่ยังมีเรื่อง "เลยกำหนด" ค้างอยู่ (ผลของ decorateServiceRows) ต้องขึ้นด้วย
 *     ไม่งั้นยอดเลยกำหนดบนการ์ดชีพจรไปซ่อนอยู่หลังปุ่ม "ไม่มีเรื่อง" (เจอจริงบน demo 2569-11-10: การ์ด 3 แต่ตาราง 0)
 * @returns {{ withData: object[], empty: object[] }}
 */
export function splitServiceRows(rows = []) {
  const withData = []
  const empty = []
  for (const row of rows) (execCount(row?.total) > 0 || execCount(row?.overdue) > 0 ? withData : empty).push(row)
  return { withData, empty }
}

// ───────────────────────── หมวดปัญหา ②-4 ─────────────────────────

export const EXEC_TOP_CATEGORIES = 8
export const EXEC_REST_LABEL = 'อื่นๆ'
const REST_KEY = '__rest__'

/**
 * นับเรื่องรายหมวดจาก complaints_public_fy — หมวดยอดสูงสุด top 8 + แถว "อื่นๆ" รวมที่เหลือ
 * หมวด 'other' และเรื่องที่ไม่มีหมวด รวมเข้าแถว "อื่นๆ" เสมอ (ชื่อซ้ำกัน ถ้าแยกจะอ่านสับสน)
 * @param {Array<{ category?: string|null }>} rows
 * @param {{ labels?: object, top?: number }} [options]  labels = { รหัสหมวด: ชื่อ } จาก complaint_categories ของ อปท.
 * @returns {Array<{ key: string, label: string, count: number, isRest: boolean }>}
 */
export function categoryCounts(rows, { labels = {}, top = EXEC_TOP_CATEGORIES } = {}) {
  const counts = new Map()
  let rest = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const code = typeof r?.category === 'string' ? r.category.trim() : ''
    if (!code || code === 'other') { rest += 1; continue }
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  const sorted = [...counts.entries()]
    .map(([key, count]) => ({ key, label: categoryNameOf(labels, key), count, isRest: false }))
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, 'th'))
  const head = sorted.slice(0, top)
  const tail = sorted.slice(top)
  rest += tail.reduce((sum, t) => sum + t.count, 0)
  if (rest > 0) head.push({ key: REST_KEY, label: EXEC_REST_LABEL, count: rest, isRest: true })
  return head
}

/** ลักษณะย่อยของหมวดไฟฟ้า จาก complaint_issue_breakdown_fy (label ว่าง = ไม่ระบุลักษณะ) */
export function issueBreakdownRows(data) {
  return (Array.isArray(data) ? data : [])
    .map((r) => ({ label: typeof r?.issue_label === 'string' && r.issue_label.trim() ? r.issue_label.trim() : 'ไม่ระบุลักษณะ', total: execCount(r?.total) }))
    .filter((r) => r.total > 0)
}

/** หมวดที่มีลักษณะย่อยให้ดู (ตรงกับรายการอนุญาตในฟังก์ชันฐานข้อมูล complaint_issue_breakdown_fy) */
export const EXEC_ISSUE_BREAKDOWN_CATEGORY = 'light'

// ═════════════════════════ เฟส E2 — executive_overview() ═════════════════════════
// ตัวเลขทั้งหมดด้านล่างมาจาก RPC executive_overview (ตรวจสิทธิ์ใน SECURITY DEFINER) + ตัวคิดวันทำการ workingDays.js ตัวเดียว
// ทุกฟังก์ชันทนค่า null/คีย์หาย (RPC คืนส่วนที่ว่างเป็น null ได้) — ผิดรูป = 0/ว่าง ห้ามทำหน้าพัง

/** เกินกำหนดกี่วันทำการจึงนับเป็น "เลยกำหนดเกิน 5 วันทำการ" (ตรงกับ rule ของ alert overdue_5wd ในทะเบียน: มากกว่า 5) */
export const EXEC_OVERDUE_WD = 5
/** รอตัดสินเกินกี่วันทำการขึ้นสีส้ม (เจ้าของระบบสั่ง: เกิน 2 วันทำการ) */
export const EXEC_WAIT_WARN_WD = 2

const isIsoDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
const asDay = (v) => (isIsoDay(v) ? v.slice(0, 10) : null)
const asList = (v) => (Array.isArray(v) ? v : [])
const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const round1 = (n) => Math.round(n * 10) / 10

/** เวลา/วันที่ใดๆ → วันที่ไทย YYYY-MM-DD (วันที่ล้วนคงเดิม · timestamp แปลงเป็นเวลาไทย) · ผิดรูป = null */
export function execDateOnly(value) {
  if (value == null || value === '') return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const t = value instanceof Date ? value : new Date(value)
  return Number.isNaN(t.getTime()) ? null : bangkokIsoDate(t)
}

/** ค่าเฉลี่ย = ผลรวม ÷ จำนวน ปัด 1 ตำแหน่ง · จำนวน 0 = null (ไม่มีข้อมูล ห้ามเป็น 0) */
export function execAverage(sum, count) {
  const c = execCount(count)
  if (c <= 0) return null
  return round1(execCount(sum) / c)
}

/** ร้อยละ 1 ตำแหน่ง (สูตรเดียวกับ percent() ของเมนูผลการปฏิบัติงาน) · ตัวหาร 0 = null → หน้าจอแสดงขีด */
export const execPercent = (numerator, denominator) => percent(execCount(numerator), execCount(denominator))

/** เทียบค่าที่ไม่ใช่จำนวนนับ (ร้อยละ/คะแนนเฉลี่ย) — ค่าใดค่าหนึ่ง null = เทียบไม่ได้ (null) ไม่ใช่เทียบกับ 0 */
export function compareMetric(current, previous) {
  if (current == null || previous == null || !Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) return null
  const diff = round1(Number(current) - Number(previous))
  return { current: Number(current), previous: Number(previous), diff, dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat', pct: null }
}

// ───────────────────────── ปรับรูปผล RPC ─────────────────────────

const normalizeOnTime = (o) => {
  const v = asObj(o)
  return {
    completed: execCount(v.completed), onTime: execCount(v.on_time), late: execCount(v.late),
    noDue: execCount(v.no_due), openPastDue: execCount(v.open_past_due), undated: execCount(v.undated),
  }
}

const normalizeBacklog = (rows) => asList(rows)
  .map((r) => ({ s: String(r?.s ?? ''), t: r?.t ?? null, due: asDay(r?.due), c: asDay(r?.c), u: r?.u === true, n: execCount(r?.n) }))
  .filter((r) => r.n > 0)

const countsOf = (obj, keys) => Object.fromEntries(keys.map((k) => [k, execCount(asObj(obj)[k])]))

export function normalizeComplaintsSummary(data) {
  const d = asObj(data)
  const parkedRaw = asObj(d.parked)
  const repeat = asObj(d.repeat)
  return {
    period: countsOf(d.period, ['total', 'citizen_online', 'oss_counter', 'confidential', 'adhoc']),
    villages: asList(d.villages).map((v) => ({ village: String(v?.village ?? '').trim(), n: execCount(v?.n) })).filter((v) => v.village && v.n > 0),
    villagesUnlisted: execCount(d.villages_unlisted),
    onTime: normalizeOnTime(d.on_time),
    backlog: normalizeBacklog(d.backlog),
    parked: {
      n: execCount(parkedRaw.n),
      byReason: Object.entries(asObj(parkedRaw.by_reason)).map(([reason, n]) => ({ reason, n: execCount(n) })).filter((r) => r.n > 0),
    },
    repeat: {
      days: execCount(repeat.days) || 90,
      min: execCount(repeat.min) || 3,
      groups: asList(repeat.groups).map((g) => ({ category: g?.category ?? null, label: String(g?.label ?? g?.category ?? '').trim(), village: String(g?.village ?? '').trim(), n: execCount(g?.n) })).filter((g) => g.n > 0),
    },
  }
}

export function normalizeDocRequestsSummary(data) {
  const d = asObj(data)
  const onTime = asObj(d.on_time)
  return {
    byType: asList(d.by_type).filter((r) => r?.t).map((r) => ({
      t: r.t, total: execCount(r.total), pending: execCount(r.pending), processing: execCount(r.processing),
      completed: execCount(r.completed), rejected: execCount(r.rejected), avgDays: execAvgDays(r.avg_days),
    })),
    onTimeByType: asList(onTime.by_type).filter((r) => r?.t).map((r) => ({ t: r.t, ...normalizeOnTime(r) })),
    backlog: normalizeBacklog(d.backlog),
    entered: countsOf(d.entered, ['citizen', 'council', 'staff', 'unknown']),
  }
}

/** ที่มาคะแนนของคำร้อง (ลำดับแสดง) — ป้ายตรงกับสูตร kpi by_source ในทะเบียน */
export const EXEC_RATING_SOURCES = Object.freeze([
  { key: 'verified', label: 'ผู้ยื่นล็อกอินประเมินเอง' },
  { key: 'via_link', label: 'ผู้ถือลิงก์ติดตามเรื่อง' },
  { key: 'proxy', label: 'สท. บันทึกแทน' },
  { key: 'linked_anon', label: 'ผูกคำร้องแต่ไม่ล็อกอิน' },
])
const GENERAL_RATING_LABEL = 'แบบประเมินภาพรวม'

const ratingTally = (o) => {
  const v = asObj(o)
  return { complaints: execCount(v.complaints), sum: execCount(v.sum), cnt: execCount(v.cnt) }
}

export function normalizeSatisfactionSummary(data) {
  const d = asObj(data)
  const sources = asObj(d.sources)
  const general = asObj(d.general)
  return {
    closed: execCount(d.closed),
    anyRated: execCount(d.any_rated),
    sources: Object.fromEntries(EXEC_RATING_SOURCES.map((s) => [s.key, ratingTally(sources[s.key])])),
    genuine: ratingTally(d.genuine),
    general: { n: execCount(general.n), sum: execCount(general.sum) },
    low: Object.fromEntries(Object.entries(asObj(d.low)).map(([k, n]) => [k, execCount(n)]).filter(([, n]) => n > 0)),
    byDept: asList(d.by_dept).map((r) => ({
      dept: r?.dept ?? null, closed: execCount(r?.closed),
      genuineSum: execCount(r?.genuine_sum), genuineCnt: execCount(r?.genuine_cnt),
      allSum: execCount(r?.all_sum), allCnt: execCount(r?.all_cnt),
    })),
  }
}

export function normalizeDepartmentsSummary(data) {
  return {
    departments: asList(asObj(data).departments).map((r) => ({
      id: r?.id ?? null,
      name: typeof r?.name === 'string' && r.name.trim() ? r.name.trim() : null,
      shortName: r?.short_name ?? null,
      complaints: countsOf(r?.complaints, ['open', 'overdue', 'parked', 'done']),
      docs: countsOf(r?.docs, ['open', 'overdue', 'done']),
    })),
  }
}

export function normalizePatientTransportSummary(data) {
  const d = asObj(data)
  const bookings = asObj(d.bookings)
  const trips = asObj(d.trips)
  const kinds = ['patient', 'community']
  return {
    bookings: Object.fromEntries(kinds.map((k) => [k, countsOf(bookings[k], ['total', 'submitted', 'confirmed', 'completed', 'cancelled'])])),
    trips: Object.fromEntries(kinds.map((k) => [k, countsOf(trips[k], ['ran', 'completed', 'waiting', 'issue', 'cancelled'])])),
  }
}

export function normalizeFleetSummary(data) {
  const d = asObj(data)
  const m = asObj(d.maintenance)
  return {
    maintenance: { overdue: execCount(m.overdue), oldestDueOn: asDay(m.oldest_due_on), dueSoon: execCount(m.due_soon) },
    incidents: countsOf(d.incidents, ['damage', 'loss']),
  }
}

export function normalizeBorrowableSummary(data) {
  const d = asObj(data)
  return {
    submitted: execCount(d.submitted), oldestSubmittedOn: asDay(d.oldest_submitted_on), approved: execCount(d.approved),
    issued: execCount(d.issued), overdueReturn: execCount(d.overdue_return), oldestReturnDue: asDay(d.oldest_return_due),
    settlement: execCount(d.settlement),
  }
}

export function normalizeProjectsSummary(data) {
  const d = asObj(data)
  const change = asObj(d.change_pending)
  const schedule = countsOf(d.schedule, ['projects', 'behind', 'on_track', 'ahead', 'unknown', 'no_report', 'stale_report'])
  return {
    byStage: Object.fromEntries(Object.entries(asObj(d.by_stage)).map(([k, n]) => [k, execCount(n)]).filter(([, n]) => n > 0)),
    suspended: execCount(d.suspended),
    changePending: { n: execCount(change.n), oldestOn: asDay(change.oldest_on) },
    schedule: {
      projects: schedule.projects, behind: schedule.behind, onTrack: schedule.on_track, ahead: schedule.ahead,
      unknown: schedule.unknown, noReport: schedule.no_report, staleReport: schedule.stale_report,
    },
    contract: { endingSoon: execCount(asObj(d.contract).ending_soon), pastEnd: execCount(asObj(d.contract).past_end), noEnd: execCount(asObj(d.contract).no_end) },
  }
}

export function normalizeLocalPlanSummary(data) {
  const d = asObj(data)
  const fy = d.current_fy == null ? null : asObj(d.current_fy)
  return {
    opDrafts: { n: execCount(asObj(d.op_drafts).n) },
    devDrafts: execCount(d.dev_drafts),
    currentFy: fy ? { fiscalYear: execCount(fy.fiscal_year) || null, publishedMain: fy.published_main === true, latestPublishedOn: asDay(fy.latest_published_on) } : null,
  }
}

export function normalizeWaterSummary(data) {
  const d = asObj(data)
  return {
    announcePending: { n: execCount(asObj(d.announce_pending).n), draftedAt: asObj(d.announce_pending).drafted_at ?? null },
    openEvents: { n: execCount(asObj(d.open_events).n), oldestOpenedAt: asObj(d.open_events).oldest_opened_at ?? null },
  }
}

const NORMALIZERS = Object.freeze({
  complaints: normalizeComplaintsSummary,
  doc_requests: normalizeDocRequestsSummary,
  satisfaction: normalizeSatisfactionSummary,
  departments: normalizeDepartmentsSummary,
  patient_transport: normalizePatientTransportSummary,
  fleet: normalizeFleetSummary,
  borrowable_assets: normalizeBorrowableSummary,
  projects: normalizeProjectsSummary,
  local_plan: normalizeLocalPlanSummary,
  water: normalizeWaterSummary,
})

/** summaryKey (ฝั่ง SQL) → ชื่อช่องใน model ฝั่งหน้าจอ */
export const EXEC_MODEL_FIELDS = Object.freeze({
  complaints: 'complaints', doc_requests: 'docRequests', satisfaction: 'satisfaction', departments: 'departments',
  patient_transport: 'patientTransport', fleet: 'fleet', borrowable_assets: 'borrowable', projects: 'projects',
  local_plan: 'localPlan', water: 'water',
})

/**
 * summaries ของ executive_overview → model รายการละ { state, data }
 *   ok = ใช้ได้ (data ปรับรูปแล้ว) · error = การ์ดนั้น "โหลดไม่ได้" (ok:false/ไม่รู้จักคีย์) · missing = ไม่ได้ขอ (โมดูลปิด)
 * ไม่มีทางทำให้ทั้งหน้าพัง: ค่าผิดรูปถูกปรับเป็น 0/ว่างที่ normalizer
 */
export function buildExecModel(summaries) {
  const model = {}
  for (const [key, field] of Object.entries(EXEC_MODEL_FIELDS)) {
    const raw = summaries?.[key]
    if (raw == null) model[field] = { state: 'missing', data: null }
    else if (raw.ok === true) model[field] = { state: 'ok', data: NORMALIZERS[key](raw.data) }
    else model[field] = { state: 'error', data: null }
  }
  return model
}

const dataOf = (model, field) => (model?.[field]?.state === 'ok' ? model[field].data : null)

/**
 * summaryKey ที่ต้องขอ — จากรายการที่ขึ้นจอ (ตัดค่าซ้ำ/null/ว่าง) เรียงคงที่ เพื่อให้คีย์แคชเท่ากันทุกรอบ
 * รายการใดถือ document_type (docTypes) = ตาราง ②-2 ต้องใช้แถวคำขอจาก doc_requests แม้โมดูลกล่องงาน (inbox) ปิดอยู่
 * (เช่น ประปา/รถรับ-ส่งผู้ป่วยเปิด แต่ inbox ปิด) — ไม่งั้นตารางขึ้น "โหลดไม่ได้" ลวง หรือค้าง "กำลังโหลด" ตลอด
 */
export function execSummaryKeys(entries) {
  const list = entries ?? []
  const keys = list.map((e) => e?.summaryKey).filter((k) => typeof k === 'string' && k)
  if (list.some((e) => (e?.docTypes?.length ?? 0) > 0)) keys.push('doc_requests')
  return [...new Set(keys)].sort()
}

// ───────────────────────── ค้างอยู่ตอนนี้ / เลยกำหนด / คอขวด ─────────────────────────

/** กลุ่มอายุเรื่อง (วันทำการนับจากวันที่แจ้ง) — ตรงกับสูตร kpi bottleneck: 0–3 / 4–7 / 8–15 / มากกว่า 15 */
export const EXEC_AGE_BUCKETS = Object.freeze([
  { key: '0-3', label: '0–3 วัน', max: 3 },
  { key: '4-7', label: '4–7 วัน', max: 7 },
  { key: '8-15', label: '8–15 วัน', max: 15 },
  { key: '15+', label: 'มากกว่า 15 วัน', max: Infinity },
])

export const EXEC_COMPLAINT_STAGES = Object.freeze([
  { s: 'new', label: 'ยังไม่รับเรื่อง' },
  { s: 'received', label: 'รับเรื่องแล้ว' },
  { s: 'in_progress', label: 'กำลังดำเนินการ' },
])

/**
 * วิเคราะห์ยอดค้าง (backlog: แถวจัดกลุ่มตามขั้น/due/วันที่แจ้ง) — วันทำการคิดที่นี่ด้วย workingDays.js ตัวเดียว
 *   overdue    = due < วันนี้ (วันปฏิทิน — due_date ตั้งตามวันทำการตอนรับเรื่องอยู่แล้ว)
 *   overdue5wd = due < วันนี้ และเกิน 5 วันทำการ (workingDaysBetween(due, วันนี้) > 5)
 *   อายุ = วันทำการจากวันที่แจ้งถึงวันนี้ · เฉลี่ยรายขั้นถ่วงตามจำนวนเรื่อง · แถวไม่มีวันที่แจ้งไม่เข้ากลุ่มอายุ (ageUnknown)
 *   worstStage = ขั้นที่ค้างมากสุด (เท่ากัน = ขั้นที่อายุเฉลี่ยสูงกว่า) · ไม่มียอดค้าง = null
 * @param {Array<{s:string,due:string|null,c:string|null,u:boolean,n:number}>} rows
 */
export function backlogAnalysis(rows, today) {
  const stages = new Map()
  const buckets = EXEC_AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, n: 0 }))
  let total = 0, overdue = 0, overdue5wd = 0, unassigned = 0, ageUnknown = 0, ageSum = 0, ageN = 0
  for (const r of asList(rows)) {
    const n = execCount(r?.n)
    if (n <= 0) continue
    total += n
    if (r.u === true) unassigned += n
    const st = stages.get(r.s) ?? { s: r.s, n: 0, ageSum: 0, ageN: 0 }
    st.n += n
    if (r.due && r.due < today) {
      overdue += n
      const late = workingDaysBetween(r.due, today)
      if (late != null && late > EXEC_OVERDUE_WD) overdue5wd += n
    }
    if (r.c) {
      const age = workingDaysSince(r.c, today)
      st.ageSum += age * n; st.ageN += n
      ageSum += age * n; ageN += n
      buckets[EXEC_AGE_BUCKETS.findIndex((b) => age <= b.max)].n += n
    } else ageUnknown += n
    stages.set(r.s, st)
  }
  const stageRows = [...stages.values()].map((st) => ({ s: st.s, n: st.n, avgAge: st.ageN > 0 ? round1(st.ageSum / st.ageN) : null }))
  const rank = (s) => { const i = EXEC_COMPLAINT_STAGES.findIndex((x) => x.s === s); return i === -1 ? 99 : i }
  stageRows.sort((a, b) => rank(a.s) - rank(b.s) || String(a.s).localeCompare(String(b.s)))
  const worst = [...stageRows].sort((a, b) => (b.n - a.n) || ((b.avgAge ?? -1) - (a.avgAge ?? -1)))[0] ?? null
  return {
    total, overdue, overdue5wd, unassigned, ageUnknown,
    avgAge: ageN > 0 ? round1(ageSum / ageN) : null,
    stages: stageRows, ageBuckets: buckets, worstStage: worst ? worst.s : null,
  }
}

/** แจกแจงยอดค้างของคำขอรายประเภท → Map<ประเภท, { open, overdue, overdue5wd }> */
export function backlogByType(rows, today) {
  const groups = new Map()
  for (const r of asList(rows)) {
    if (!r?.t) continue
    if (!groups.has(r.t)) groups.set(r.t, [])
    groups.get(r.t).push(r)
  }
  return new Map([...groups].map(([t, list]) => {
    const a = backlogAnalysis(list, today)
    return [t, { open: a.total, overdue: a.overdue, overdue5wd: a.overdue5wd }]
  }))
}

// ───────────────────────── % ทันกำหนด ─────────────────────────

/**
 * ทันกำหนด ÷ (ทันกำหนด + เกินกำหนด + ค้างที่เลยกำหนด ณ สิ้นช่วง) — สูตร kpi on_time_pct ในทะเบียน
 * ตัวหาร 0 = pct null (หน้าจอแสดงขีด ไม่ใช่ 0% และไม่ใช่ 100%)
 * รับได้ทั้งรูปจาก RPC (on_time/open_past_due) และรูปที่ปรับแล้ว (onTime/openPastDue)
 */
export function onTimeSummary(input) {
  const v = asObj(input)
  const o = 'onTime' in v || 'openPastDue' in v
    ? { completed: execCount(v.completed), onTime: execCount(v.onTime), late: execCount(v.late), noDue: execCount(v.noDue), openPastDue: execCount(v.openPastDue), undated: execCount(v.undated) }
    : normalizeOnTime(v)
  const denominator = o.onTime + o.late + o.openPastDue
  return { ...o, denominator, pct: execPercent(o.onTime, denominator) }
}

/** รวมหลายชุด (เช่น รายประเภทของคำขอ → ทั้งคำขอ · คำร้อง+คำขอ → ภาพรวม) */
export function sumOnTime(list) {
  return asList(list).reduce((sum, x) => {
    const o = onTimeSummary(x)
    return {
      completed: sum.completed + o.completed, onTime: sum.onTime + o.onTime, late: sum.late + o.late,
      noDue: sum.noDue + o.noDue, openPastDue: sum.openPastDue + o.openPastDue, undated: sum.undated + o.undated,
    }
  }, { completed: 0, onTime: 0, late: 0, noDue: 0, openPastDue: 0, undated: 0 })
}

// ───────────────────────── ความพึงพอใจ ─────────────────────────

/**
 * มุมมองคะแนน: เสียงผู้รับบริการตัวจริง (genuine) คู่กับทุกที่มา · อัตราตอบ = เรื่องที่มีคะแนน ÷ เรื่องที่ปิดในช่วง
 * คะแนนเฉลี่ย cnt 0 = null (ไม่ใช่ 0) · อัตราตอบ ตัวหาร 0 = null
 */
export function satisfactionView(sat) {
  const s = sat ?? normalizeSatisfactionSummary(null)
  const all = EXEC_RATING_SOURCES.reduce((t, src) => ({ sum: t.sum + s.sources[src.key].sum, cnt: t.cnt + s.sources[src.key].cnt }), { sum: 0, cnt: 0 })
  const lowLabels = { ...Object.fromEntries(EXEC_RATING_SOURCES.map((x) => [x.key, x.label])), general: GENERAL_RATING_LABEL }
  const low = Object.entries(s.low).map(([key, n]) => ({ key, label: lowLabels[key] ?? key, n }))
  return {
    closed: s.closed, anyRated: s.anyRated,
    responseRate: execPercent(s.anyRated, s.closed),
    genuineAvg: execAverage(s.genuine.sum, s.genuine.cnt), genuineCnt: s.genuine.cnt, genuineComplaints: s.genuine.complaints,
    allAvg: execAverage(all.sum, all.cnt), allCnt: all.cnt,
    sources: EXEC_RATING_SOURCES.map((x) => ({ ...x, complaints: s.sources[x.key].complaints, cnt: s.sources[x.key].cnt, avg: execAverage(s.sources[x.key].sum, s.sources[x.key].cnt) })),
    general: { n: s.general.n, avg: execAverage(s.general.sum, s.general.n) },
    low, lowTotal: low.reduce((t, x) => t + x.n, 0),
  }
}

// ───────────────────────── รายกอง ⑥ ─────────────────────────

export const EXEC_NO_DEPT_KEY = '__none__'
export const EXEC_NO_DEPT_LABEL = 'ไม่ระบุกอง'

/**
 * 1 แถวต่อกอง (ชื่อจากข้อมูล · ไม่มีรหัสกอง = "ไม่ระบุกอง") + คะแนนเสียงจริงรายกองจาก satisfaction.byDept
 * ไม่จัดอันดับ — คงลำดับตามที่ฐานข้อมูลคืน (ตามทะเบียนกอง · ไม่ระบุกองอยู่ท้าย)
 */
export function buildDeptRows(departments, satisfaction = null) {
  const rating = new Map(asList(satisfaction?.byDept).map((r) => [r.dept ?? EXEC_NO_DEPT_KEY, r]))
  return asList(departments?.departments).map((d) => {
    const key = d.id ?? EXEC_NO_DEPT_KEY
    const r = rating.get(key)
    return {
      key, id: d.id, name: d.name ?? (d.id == null ? EXEC_NO_DEPT_LABEL : 'ไม่ทราบชื่อกอง'),
      complaints: d.complaints, docs: d.docs,
      openTotal: d.complaints.open + d.docs.open,
      overdueTotal: d.complaints.overdue + d.docs.overdue,
      doneTotal: d.complaints.done + d.docs.done,
      rating: r ? { avg: execAverage(r.genuineSum, r.genuineCnt), cnt: r.genuineCnt, allAvg: execAverage(r.allSum, r.allCnt), allCnt: r.allCnt } : null,
    }
  })
}

// ───────────────────────── ตาราง ②-2 รุ่น E2 ─────────────────────────

/**
 * เติม "เลยกำหนด" และ "% ทันกำหนด" ให้แถวของ buildServiceRows
 *   แถวคำร้อง ← backlog/on_time ของคำร้อง · แถวคำขอ ← backlog/on_time ของประเภทนั้น
 *   ไม่มีข้อมูลฝั่ง RPC (การ์ดนั้นโหลดไม่ได้) = overdue/onTimePct เป็น null (ขีด) ไม่ใช่ 0
 * @param {object} model ผลของ buildExecModel
 */
export function decorateServiceRows(rows, { model, today }) {
  const c = dataOf(model, 'complaints')
  const d = dataOf(model, 'docRequests')
  const cBacklog = c ? backlogAnalysis(c.backlog, today) : null
  const dByType = d ? backlogByType(d.backlog, today) : null
  const dOnTime = d ? new Map(d.onTimeByType.map((r) => [r.t, onTimeSummary(r)])) : null
  return rows.map((row) => {
    if (row.kind === 'complaint') {
      return { ...row, overdue: cBacklog ? cBacklog.overdue : null, onTimePct: c ? onTimeSummary(c.onTime).pct : null }
    }
    if (!d) return { ...row, overdue: null, onTimePct: null }
    return { ...row, overdue: dByType.get(row.docType)?.overdue ?? 0, onTimePct: dOnTime.get(row.docType)?.pct ?? null }
  })
}

// ───────────────────────── รอตัดสิน ① / สัญญาณเตือน ③ ─────────────────────────

/** รอมากี่วันทำการ นับจากวันที่ (ไม่มีวันที่ = null) */
export function waitingWorkdays(since, today) {
  const d = execDateOnly(since)
  return d && today ? workingDaysSince(d, today) : null
}

export const waitText = (days) => (days == null ? null : days === 0 ? 'ตั้งแต่วันนี้' : `รอมา ${days} วันทำการ`)

const fmtDay = (iso) => (iso ? thaiShortDate(iso) : null)

// กฎของ kpi ที่เป็น "เรื่องรอท่านตัดสิน" — คีย์ = `${entry.key}:${kpi.id}` ต้องมี kpi นั้นในทะเบียน (สูตร ⓘ ดึงจากทะเบียน)
const DECISION_RULES = {
  'borrowable-assets:awaiting': (m) => m.borrowable && { count: m.borrowable.submitted, since: m.borrowable.oldestSubmittedOn },
  'borrowable-assets:settlement': (m) => m.borrowable && { count: m.borrowable.settlement, since: null },
  'projects:change_pending': (m) => m.projects && { count: m.projects.changePending.n, since: m.projects.changePending.oldestOn },
  'water-situation:announce_pending': (m) => m.water && { count: m.water.announcePending.n, since: m.water.announcePending.draftedAt },
  'local-plan:drafts': (m) => m.localPlan && { count: m.localPlan.opDrafts.n + m.localPlan.devDrafts, since: null },
}

const dataMap = (model) => Object.fromEntries(Object.values(EXEC_MODEL_FIELDS).map((field) => [field, dataOf(model, field)]))
const stateOfEntry = (model, entry) => (entry.summaryKey ? model?.[EXEC_MODEL_FIELDS[entry.summaryKey]]?.state : null)

/**
 * เรื่องรอท่านตัดสิน (โซน ①) จากทะเบียน × model — แสดงเฉพาะที่มีเรื่อง (count > 0)
 * waitDays นับวันทำการจากวันที่ที่ข้อมูลให้ (ไม่มีวันที่ = null ไม่เดา) · warn = เกิน 2 วันทำการ
 * failures = รายการที่ควรมีแต่การ์ดโหลดไม่ได้ (หน้าจอบอกว่า "ตรวจไม่ได้" ไม่ใช่ปล่อยให้ดูเหมือนไม่มีเรื่อง)
 */
export function buildDecisionQueue({ entries, model, today }) {
  const m = dataMap(model)
  const items = []
  const failures = []
  for (const entry of entries ?? []) {
    if (!entry.zones.includes('decision')) continue
    const state = stateOfEntry(model, entry)
    for (const kpi of entry.kpis) {
      const rule = DECISION_RULES[`${entry.key}:${kpi.id}`]
      if (!rule || !isPhaseLive(kpi.phase)) continue
      if (state === 'error') { if (!failures.includes(entry.label)) failures.push(entry.label); continue }
      const v = rule(m)
      if (!v || v.count <= 0) continue
      const waitDays = waitingWorkdays(v.since, today)
      items.push({
        id: `${entry.key}:${kpi.id}`, entry, kpi, label: kpi.label, unit: kpi.unit, count: v.count,
        sinceDay: execDateOnly(v.since), waitDays, warn: waitDays != null && waitDays > EXEC_WAIT_WARN_WD,
      })
    }
  }
  return { items, failures }
}

const sumValues = (o) => Object.values(o ?? {}).reduce((t, n) => t + n, 0)

// กฎของ alert ในทะเบียน — คีย์ = `${entry.key}:${alert.id}` · คืน null/undefined = ไม่มีเรื่อง (ไม่ขึ้นจอ)
const ALERT_RULES = {
  'complaints:overdue_5wd': (m, ctx) => {
    const a = m.complaints && backlogAnalysis(m.complaints.backlog, ctx.today)
    return a && a.overdue5wd > 0 ? { count: a.overdue5wd, unit: 'เรื่อง', detail: `เลยกำหนดทั้งหมด ${a.overdue} เรื่อง (นับทุกเรื่องที่ค้าง)` } : null
  },
  'complaints:low_rating': (m) => {
    const v = m.satisfaction && satisfactionView(m.satisfaction)
    return v && v.lowTotal > 0 ? { count: v.lowTotal, unit: 'คะแนน', detail: v.low.map((x) => `${x.label} ${x.n}`).join(' · ') } : null
  },
  'inbox:overdue_5wd': (m, ctx) => {
    const a = m.docRequests && backlogAnalysis(m.docRequests.backlog, ctx.today)
    return a && a.overdue5wd > 0 ? { count: a.overdue5wd, unit: 'เรื่อง', detail: `เลยกำหนดทั้งหมด ${a.overdue} เรื่อง` } : null
  },
  'fleet:maintenance_due': (m) => (m.fleet && m.fleet.maintenance.overdue > 0
    ? { count: m.fleet.maintenance.overdue, unit: 'คัน', detail: m.fleet.maintenance.oldestDueOn ? `รอบเก่าสุดครบ ${fmtDay(m.fleet.maintenance.oldestDueOn)}` : null }
    : null),
  'fleet:incidents': (m) => (m.fleet && sumValues(m.fleet.incidents) > 0
    ? { count: sumValues(m.fleet.incidents), unit: 'เหตุ', detail: `เสียหาย ${m.fleet.incidents.damage} · สูญหาย ${m.fleet.incidents.loss}` }
    : null),
  'borrowable-assets:overdue_return': (m) => (m.borrowable && m.borrowable.overdueReturn > 0
    ? { count: m.borrowable.overdueReturn, unit: 'ใบ', detail: m.borrowable.oldestReturnDue ? `ครบกำหนดคืนเก่าสุด ${fmtDay(m.borrowable.oldestReturnDue)}` : null }
    : null),
  'projects:behind': (m) => (m.projects && m.projects.schedule.behind > 0 ? { count: m.projects.schedule.behind, unit: 'โครงการ' } : null),
  'projects:contract_ending': (m) => (m.projects && m.projects.contract.endingSoon > 0 ? { count: m.projects.contract.endingSoon, unit: 'โครงการ' } : null),
  'projects:contract_past': (m) => (m.projects && m.projects.contract.pastEnd > 0 ? { count: m.projects.contract.pastEnd, unit: 'โครงการ' } : null),
  'projects:report_missing': (m) => {
    const sch = m.projects?.schedule
    const n = sch ? sch.noReport + sch.staleReport : 0
    return n > 0 ? { count: n, unit: 'โครงการ', detail: `ไม่มีฉบับล็อก ${sch.noReport} · ฉบับล่าสุดเก่าเกิน 14 วัน ${sch.staleReport}` } : null
  },
  'local-plan:result_missing': (m, ctx) => (ctx.resultMissing > 0 ? { count: ctx.resultMissing, unit: 'รายการ' } : null),
  'local-plan:no_published_plan': (m) => (m.localPlan?.currentFy && !m.localPlan.currentFy.publishedMain
    ? { count: 1, unit: '', showCount: false, detail: m.localPlan.currentFy.fiscalYear ? `ปีงบ ${m.localPlan.currentFy.fiscalYear}` : null }
    : null),
  'water-situation:event_open': (m) => {
    const w = m.water?.openEvents
    if (!w || w.n <= 0) return null
    const since = execDateOnly(w.oldestOpenedAt)
    return { count: w.n, unit: 'เหตุการณ์', detail: since ? `เก่าสุดเปิดเมื่อ ${fmtDay(since)}` : null }
  },
}

// กฎที่อ่านข้อมูลจากสรุปคีย์อื่น (ไม่ใช่ summaryKey ของรายการเจ้าของ alert) — ต้องเช็กสถานะของคีย์นั้นแทน
// ไม่งั้นสรุปที่อ่านอยู่พัง (ok:false) แล้ว alert หายเงียบโดยไม่ขึ้นใน failures (code review #685)
const ALERT_RULE_SOURCES = Object.freeze({
  'complaints:low_rating': 'satisfaction',
})

const SEVERITY_RANK = { critical: 0, warn: 1, info: 2 }

/** `${entry.key}:${alert.id}` ที่มีกฎคำนวณแล้ว — เทสต์ตรวจว่าทุก alert เฟส live ในทะเบียนมีกฎ (ไม่งั้นเตือนหายเงียบ) */
export const EXEC_ALERT_RULE_KEYS = Object.freeze(Object.keys(ALERT_RULES))

/**
 * สัญญาณเตือน (โซน ③) — ขึ้นเฉพาะที่มีเรื่อง · เรียง critical → warn → info (คงลำดับทะเบียนในระดับเดียวกัน)
 * @param {{ entries: object[], model: object, today: string, resultMissing?: number }} input
 *   resultMissing = จำนวนรายการแผนที่ถึงกำหนดแต่ยังไม่มีผล (คิดจาก localPlanProgress ฝั่งหน้าจอ — ไม่ได้มาจาก SQL)
 * @returns {{ items: object[], failures: string[] }} failures = โมดูลที่ตรวจเตือนไม่ได้เพราะการ์ดโหลดไม่ได้
 */
export function buildAlerts({ entries, model, today, resultMissing = 0 }) {
  const m = dataMap(model)
  const items = []
  const failures = []
  for (const entry of entries ?? []) {
    const state = stateOfEntry(model, entry)
    for (const alert of entry.alerts) {
      const ruleKey = `${entry.key}:${alert.id}`
      const rule = ALERT_RULES[ruleKey]
      if (!rule || !isPhaseLive(alert.phase)) continue
      const source = ALERT_RULE_SOURCES[ruleKey]
      const ruleState = source ? model?.[source]?.state : state
      if (ruleState === 'error') { if (!failures.includes(entry.label)) failures.push(entry.label); continue }
      const v = rule(m, { today, resultMissing })
      if (!v) continue
      items.push({
        id: `${entry.key}:${alert.id}`, entry, alert, label: alert.label, severity: alert.severity, rule: alert.rule,
        count: v.count, unit: v.unit ?? '', showCount: v.showCount !== false, detail: v.detail ?? null,
      })
    }
  }
  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
  return { items, failures }
}

// ───────────────────────── โครงการ ⑤ ─────────────────────────

/** โครงการตามขั้น เรียงตามวงจร (STAGES) · ขั้นที่ไม่รู้จักต่อท้ายด้วยรหัสขั้น (ไม่ทิ้งเงียบ) */
export function projectStageRows(byStage) {
  const counts = asObj(byStage)
  const known = STAGES.filter((s) => execCount(counts[s]) > 0).map((s) => ({ stage: s, label: STAGE_LABELS[s] ?? s, n: execCount(counts[s]) }))
  const unknown = Object.keys(counts).filter((s) => !STAGES.includes(s) && execCount(counts[s]) > 0).sort()
    .map((s) => ({ stage: s, label: s, n: execCount(counts[s]) }))
  return [...known, ...unknown]
}

/**
 * รายการแผนที่ "ถึงกำหนดแต่ยังไม่มีผล" — เดือนสิ้นสุด (month_to เป็นเดือนที่ของปีงบ 1–12) ผ่านไปแล้ว + ยังไม่มีผล (none)
 * และผลไม่ได้มาจากงานก่อสร้างที่ผูกไว้ (source 'civil' = ผูกโครงการก่อสร้างอยู่ ไม่นับว่าค้าง) · นับเฉพาะปีงบปัจจุบันเท่านั้น
 * @param {Array<{ item: { month_to?: number|null }, resolved: { status: string, source: string } }>} rows ผลของ buildProgressRows
 */
export function planResultMissingCount(rows, { today, fiscalYear }) {
  if (!today || !fiscalYear || fiscalYearOfIso(today) !== Number(fiscalYear)) return 0
  let n = 0
  for (const row of asList(rows)) {
    if (row?.resolved?.status !== 'none' || row?.resolved?.source === 'civil') continue
    const to = row?.item?.month_to
    if (to == null || to === '') continue
    const range = fiscalMonthRange(fiscalYear, Number(to), Number(to))
    if (range && range.to < today) n += 1
  }
  return n
}

// ───────────────────────── กำหนดการ ④ ─────────────────────────

export const EXEC_SCHEDULE_DAYS = 7

/**
 * กำหนดการวันนี้ถึงอีก 7 วัน จากกิจกรรมที่ list_events_for_staff_between คืน (กรองช่วงที่ฐานแล้ว — ยังกรองซ้ำที่นี่เพราะรายการส่วนตัวมาทั้งหมด)
 * + รายการส่วนตัวของท่าน (personal_events → toPersonalEvent แล้ว)
 * กิจกรรมหลายวันที่คาบเกี่ยวช่วงนี้นับด้วย · เรียงตามวัน (ที่ตกในช่วง) แล้วตามเวลา (ไม่ระบุเวลาไว้ท้ายวัน)
 * เก็บเฉพาะช่องที่ใช้ — ไม่ส่งรายละเอียด/ไฟล์แนบ/ผู้รับมอบหมายต่อ
 */
export function upcomingEvents(events, today, days = EXEC_SCHEDULE_DAYS) {
  const last = addDays(today, days)
  const seen = new Set()
  const out = []
  for (const ev of asList(events)) {
    const start = asDay(ev?.event_date)
    if (!start) continue
    const end = asDay(ev?.end_date) ?? start
    if (end < today || start > last) continue
    const id = String(ev.id ?? `${start}|${ev.title ?? ''}`)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      title: typeof ev.title === 'string' && ev.title.trim() ? ev.title.trim() : 'กิจกรรมไม่ระบุชื่อ',
      start, end,
      day: start < today ? today : start,
      time: typeof ev.event_time === 'string' && ev.event_time ? ev.event_time.slice(0, 5) : null,
      personal: ev.is_personal === true,
    })
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.title.localeCompare(b.title, 'th'))
}

// ───────────────────────── รวมที่หลายโซนใช้ร่วมกัน ─────────────────────────

/**
 * ตัวเลขสรุปที่หลายโซนใช้ร่วมกัน (ผู้เรียก memo ไว้ — วันทำการขึ้นกับตารางวันหยุดที่โหลดทีหลัง)
 * overdue = คำร้อง + คำขอที่ค้างและเลยกำหนด (ไม่ขึ้นกับช่วงที่เลือก)
 * % ทันกำหนดแยก complaintOnTime / docOnTime เท่านั้น — ไม่มีค่ารวม (เจ้าของระบบเลือก 2569-11-10):
 * คำร้องนับกำหนดเป็นวันทำการ คำขอเป็นวันปฏิทิน รวมในตัวหารเดียวแล้วตรวจย้อนตามสูตรเดียวไม่ได้
 */
export function deriveExec({ model, today }) {
  const c = dataOf(model, 'complaints')
  const d = dataOf(model, 'docRequests')
  const s = dataOf(model, 'satisfaction')
  const complaintBacklog = c ? backlogAnalysis(c.backlog, today) : null
  const docBacklog = d ? backlogAnalysis(d.backlog, today) : null
  const complaintOnTime = c ? onTimeSummary(c.onTime) : null
  const docOnTime = d ? onTimeSummary(sumOnTime(d.onTimeByType)) : null
  return {
    complaintBacklog, docBacklog,
    overdue: complaintBacklog || docBacklog ? {
      total: (complaintBacklog?.overdue ?? 0) + (docBacklog?.overdue ?? 0),
      complaints: complaintBacklog?.overdue ?? null, docs: docBacklog?.overdue ?? null,
      over5wd: (complaintBacklog?.overdue5wd ?? 0) + (docBacklog?.overdue5wd ?? 0),
    } : null,
    complaintOnTime, docOnTime,
    satisfaction: s ? satisfactionView(s) : null,
    deptRows: dataOf(model, 'departments') ? buildDeptRows(dataOf(model, 'departments'), s) : null,
  }
}

// ───────────────────────── ตัวช่วยแสดงผล ─────────────────────────

/** ตัวเลขแบบไทย · null = ขีด (ไม่มีข้อมูล ห้ามแสดงเป็น 0) */
export const execNf = (n) => (n == null ? '—' : Number(n).toLocaleString('th-TH'))

/**
 * สูตรของ kpi จากรายการที่ขึ้นจอ — คัดตรงจากทะเบียน (executiveRegistry.js) ไม่เขียนถ้อยคำเอง (ⓘ ให้ สตง./ป.ป.ช. ตรวจ)
 * @param {Array<{ label: string, kpis: Array }>} entries
 * @param {string|string[]} kpiIds
 * @returns {Array<{ who: string, formula: string, source?: string }>}
 */
export function execFormulas(entries, kpiIds) {
  const ids = Array.isArray(kpiIds) ? kpiIds : [kpiIds]
  return (entries ?? []).flatMap((e) => (e.kpis ?? [])
    .filter((k) => ids.includes(k.id) && isPhaseLive(k.phase))
    .map((k) => ({ who: e.label, formula: k.formula, source: k.source })))
}

/** ป้ายวัน: วันนี้ / พรุ่งนี้ / "พฤ. 12 พ.ย." (เวลาไทย ไม่ขึ้นกับโซนเวลาเครื่อง) */
export function thaiDayLabel(day, today) {
  if (day === today) return 'วันนี้'
  if (day === addDays(today, 1)) return 'พรุ่งนี้'
  const d = new Date(`${day}T00:00:00+07:00`)
  return Number.isNaN(d.getTime()) ? String(day) : d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short' })
}

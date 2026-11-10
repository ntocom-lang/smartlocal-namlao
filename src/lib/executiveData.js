// ตัวเลขของ "ห้องผู้บริหาร" เฟส E1 — ฟังก์ชันบริสุทธิ์ล้วน (ไม่ import React/supabase เทสต์ด้วย node ได้)
//
// แหล่งข้อมูลมีแค่ RPC ใน EXEC_E1_RPCS (executiveRegistry.js) — viewer/ปลัดอ่านตาราง complaints/document_requests
// ตรงๆ ไม่ได้ (RLS) หน้านี้จึงห้าม supabase.from('complaints'|'document_requests') เด็ดขาด
// ตัวเลขทุกตัวต้องตรงกับหน้าสถิติสาธารณะ (/reports/complaints, /doc-stats) เพราะใช้ RPC ชุดเดียวกัน

import { addDays, bangkokIsoDate, thaiDateRange, thaiShortDate } from './complaintReportPeriods.js'
import { BASE_DOCUMENT_TYPES, allDocumentTypes } from './documentTypes.js'
import { categoryNameOf } from './complaintCategoryLabels.js'
import { fiscalYearBounds, fiscalYearOf } from './fiscalYear.js'
import { ownerOfDocType } from './executiveRegistry.js'

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
 *   docRows: Array|null,          // projectDocRows(doc_requests_public_fy) · null = ไม่แสดงแถวคำขอ
 *   tenant: object|null,
 *   isModuleEnabled?: (key: string) => boolean,
 *   complaintEntry?: object,      // รายการ 'complaints' จากทะเบียน (ใช้ทำลิงก์)
 * }} input
 */
export function buildServiceRows({ complaintStats, docRows, tenant = null, isModuleEnabled = () => true, complaintEntry = null }) {
  const rows = []

  if (complaintStats) {
    const c = normalizeComplaintStats(complaintStats)
    rows.push({
      id: 'complaints', kind: 'complaint', label: complaintEntry?.label ?? 'คำร้อง/ร้องทุกข์', docType: null, closed: false,
      owner: complaintEntry, total: c.total, open: c.open, done: c.done, rejected: c.rejected, avgDays: c.avgDays,
    })
  }

  if (docRows) {
    const tallies = tallyDocRows(docRows)
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
 * @returns {{ withData: object[], empty: object[] }}
 */
export function splitServiceRows(rows = []) {
  const withData = []
  const empty = []
  for (const row of rows) (execCount(row?.total) > 0 ? withData : empty).push(row)
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

// ตรรกะคำนวณ "รายงานผลการก่อสร้างประจำสัปดาห์" ของโมดูลโครงการก่อสร้าง (เมนูกองช่าง ฝั่งเจ้าหน้าที่)
//
// ต้นฉบับ = ไฟล์ HTML เดี่ยวที่เจ้าของระบบส่งมา 2569-11-06 — ใช้สูตรเดียวกัน แก้เฉพาะจุดพัง
//   สะสม = ก่อนหน้า + ในสัปดาห์ · ผลถ่วงน้ำหนัก = สัดส่วน × สะสม ÷ 100 · รวม = Σ
//   เร็ว/ช้า = จริง − แผน (|ต่าง| < 0.5 = ตามแผน) · แผนตามเวลา = วันที่ผ่านมา ÷ ระยะสัญญา (นับวันแรกด้วย; เกณฑ์ใกล้เคียง < 1)
// จุดที่ต่างจากต้นฉบับโดยตั้งใจ
//   1) ยอด "ก่อนหน้า" ไม่ต้องกรอก — รวมจากสัปดาห์ก่อนๆ (ยกเว้นยอดตั้งต้น `base` ของสัปดาห์แรกสุด กรณีเริ่มบันทึกกลางโครงการ)
//   2) แผนสะสมไม่ต้องกรอกทุกสัปดาห์ — คำนวณเชิงเส้นจากวัน เริ่ม–สิ้นสุดของแต่ละรายการ แก้ทับรายสัปดาห์ได้ (`plan`)
//   3) "วันคงเหลือ" นับ ณ วันสิ้นสุดช่วงรายงาน ไม่ใช่วันนี้ → พิมพ์สัปดาห์เก่าย้อนหลังได้เลขเดิม
//   4) วันที่เป็น ISO (YYYY-MM-DD) ทั้งหมด ไม่อ่านข้อความอิสระ (ต้นฉบับอ่านชื่อเดือนที่ไม่รู้จักเป็น "มกราคม" เงียบๆ)
//   5) ตรวจสัดส่วนรวม = 100 และสะสมไม่เกิน 100 ก่อนล็อกรายงาน · ยอดรวมไม่ทะลุ 100
// ⚠️ ไม่คำนวณค่าปรับ / ขยายเวลา / งวดเงิน — เป็นดุลพินิจและการอนุมัติเงิน ระบบเก็บข้อเท็จจริงที่คนบันทึกเท่านั้น
// ⚠️ ป้าย "เร็ว/ช้า" เทียบกับ "แผนที่ตั้งในระบบ" ไม่ใช่แผนตามสัญญา (เจ้าของเลือกแผนเชิงเส้น 2569-11-06) — ใบพิมพ์ต้องเขียนอย่างนั้น
// ไฟล์นี้ต้องไม่ import supabase/React — เทสต์รันด้วย node ตรงๆ

import { addDays, thaiShortDate } from './complaintReportPeriods.js'

// ── ค่าคงที่ ─────────────────────────────────────────────────────────────

export const WEEK_DAYS = 7
// ใบพิมพ์แนวตั้งพื้นที่ 160 มม. ใส่ตารางรายวันได้ 7 คอลัมน์ (ต้นฉบับยืดได้ถึง 15 วัน — ที่ 14 วันไม่พอ)
export const MAX_PERIOD_DAYS = 7
export const PLAN_TOLERANCE = 0.5
export const TIME_PLAN_TOLERANCE = 1
export const WEIGHT_SUM_TOLERANCE = 0.05

export const WEATHER_KEYS = ['clear', 'light', 'moderate', 'heavy']
export const WEATHER_LABELS = {
  clear: 'แจ่มใส',
  light: 'ฝนตกเล็กน้อย',
  moderate: 'ฝนตกปานกลาง',
  heavy: 'ฝนตกหนัก',
}
// แถวของตารางสภาพอากาศตามต้นฉบับ: แจ่มใส 1 แถว + ฝนตก 3 ระดับ
export const WEATHER_ROWS = [
  { key: 'clear', group: 'แจ่มใส', label: '' },
  { key: 'light', group: 'ฝนตก', label: 'เล็กน้อย' },
  { key: 'moderate', group: 'ฝนตก', label: 'ปานกลาง' },
  { key: 'heavy', group: 'ฝนตก', label: 'หนัก' },
]

// กลุ่มบุคคลของโครงการ — ถ้อยคำคัดจากแบบต้นฉบับ (ไม่ใช่ถ้อยคำทางกฎหมาย) ค่าตั้งต้นของคอลัมน์ "หน้าที่" ตามต้นฉบับ
export const PEOPLE_GROUPS = [
  {
    key: 'committee',
    title: 'รายนามคณะกรรมการตรวจการจ้าง',
    positionLabel: 'ตำแหน่ง',
    defaultDuties: ['ประธานกรรมการ', 'กรรมการ', 'กรรมการ', 'กรรมการ', 'กรรมการ'],
  },
  {
    key: 'supervisor',
    title: 'รายชื่อผู้ควบคุมงานของผู้ว่าจ้าง',
    positionLabel: 'ตำแหน่ง',
    defaultDuties: ['หัวหน้าผู้ควบคุมงาน', 'ผู้ควบคุมงานด้าน', 'ผู้ควบคุมงานด้าน', 'ผู้ควบคุมงานด้าน'],
  },
  {
    key: 'contractor_rep',
    title: 'รายชื่อตัวแทนผู้รับจ้าง',
    positionLabel: 'วุฒิ',
    defaultDuties: ['ผู้จัดการโครงการ', 'วิศวกรโครงการ', 'วิศวกรสนาม'],
  },
]

// รายการแนะนำสำหรับงานถนน (ตามต้นฉบับ) — ใช้เป็นปุ่มเพิ่มเร็ว ไม่ใช่ค่าบังคับ
export const ROAD_WORK_PRESETS = [
  'งานเตรียมพื้นที่และงานดินตัด/ถม',
  'งานชั้นรองพื้นทาง (Subbase)',
  'งานชั้นพื้นทาง (Base Course)',
  'งานผิวทางคอนกรีตเสริมเหล็ก (คสล.)',
  'งานผิวทางลาดยาง (Asphalt)',
  'งานไหล่ทางและรางระบายน้ำ',
  'งานเครื่องหมายจราจรและป้าย',
  'งานสะพาน/ท่อระบายน้ำข้ามทาง',
]
export const ROAD_CREW_PRESETS = [
  'วิศวกรโยธา/ควบคุมงาน',
  'ช่างสำรวจ',
  'โฟร์แมน',
  'คนขับรถบด/เกรด',
  'ช่างปูน/คอนกรีตถนน',
  'คนงานปูยาง/ลาดยาง',
  'กรรมกรทั่วไป',
]
export const ROAD_MACHINERY_PRESETS = [
  'รถเกรด (Motor Grader)',
  'รถบดถนน (Road Roller)',
  'รถปูยาง (Asphalt Paver)',
  'รถปูคอนกรีต (Concrete Paver)',
  'รถแบคโฮ (Excavator)',
  'รถบรรทุก 10 ล้อ',
  'รถผสมคอนกรีต (Mixer)',
  'โดรนสำรวจ (Drone)',
]

// ── ตัวเลข / วันที่ ───────────────────────────────────────────────────────

const DAY_MS = 86_400_000

// คอลัมน์ numeric ของ Postgres อาจมาเป็นสตริง · null/ว่าง/ไม่ใช่ตัวเลข = ไม่ได้กรอก (ต่างจาก 0 ที่กรอกว่าศูนย์)
const numOrNull = value => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
const num0 = value => numOrNull(value) ?? 0
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/** ปัดทศนิยม 2 ตำแหน่ง (กันเลขลอยตัวอย่าง 8.399999999) */
export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100
const fmt = n => String(round2(n))

export const formatPct = (n, digits = 2) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toFixed(digits)}%`)

/** วันที่ ISO ที่มีอยู่จริงในปฏิทิน (31 เม.ย., 30 ก.พ. ไม่ผ่าน) */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const t = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value
}

/** จำนวนวันปฏิทินจาก from ถึง to (to − from) · ค่าที่ไม่ใช่วันที่จริงคืน null · คำนวณบน UTC ไม่พึ่งนาฬิกาเครื่อง */
export function daysBetween(fromIso, toIso) {
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) return null
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS)
}

/** นับวันแรกและวันสุดท้ายด้วย (1–7 ต.ค. = 7 วัน) */
export function inclusiveDays(fromIso, toIso) {
  const d = daysBetween(fromIso, toIso)
  return d === null ? null : d + 1
}

/** รายการวันที่ ISO จาก from ถึง to (รวมทั้งสองวัน) · ช่วงผิด/ย้อนกลับ = [] · เพดาน 370 วันกันลูปบาน */
export function periodDates(fromIso, toIso) {
  const n = inclusiveDays(fromIso, toIso)
  if (n === null || n < 1) return []
  return Array.from({ length: Math.min(n, 370) }, (_, i) => addDays(fromIso, i))
}

/** ปีงบประมาณ (พ.ศ.) ของวันที่ ISO — อ่านจากตัวอักษรตรงๆ ไม่ผ่าน Date (ไม่พึ่งโซนเวลาเครื่อง) */
export function fiscalYearOfIso(iso) {
  if (!isIsoDate(iso)) return null
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  return (month >= 10 ? year + 1 : year) + 543
}

// ── ป้ายเร็ว/ช้า ─────────────────────────────────────────────────────────

/** ถ้อยคำเดียวกับต้นฉบับ: "ตามแผน" · "เร็ว +1.2%" · "ช้า -1.9%" */
export function scheduleLabel(variance, tolerance = PLAN_TOLERANCE) {
  if (variance === null || variance === undefined || !Number.isFinite(variance)) return { key: 'unknown', text: '—' }
  if (Math.abs(variance) < tolerance) return { key: 'on_track', text: 'ตามแผน' }
  // toFixed(1) ของ -1.85 ให้ -1.8 หรือ -1.9 ตามเศษลอยตัว (ต้นฉบับก็เป็น) → ปัดจากค่า 2 ตำแหน่งแบบครึ่งขึ้นเสมอ ให้ได้ตัวเลขเดิมทุกครั้ง
  const tenths = Math.round(Math.abs(round2(variance)) * 10 + 1e-9) / 10
  const text = tenths.toFixed(1)
  return variance > 0 ? { key: 'ahead', text: `เร็ว +${text}%` } : { key: 'behind', text: `ช้า -${text}%` }
}

// ── แผนสะสมของรายการงาน ──────────────────────────────────────────────────

/**
 * แผนสะสม (%) ของรายการ ณ สิ้นวัน asOfIso
 *   override ที่ผู้ควบคุมงานแก้ทับมาก่อน (0 ก็นับว่ากรอก) → ไม่มีก็เชิงเส้นจาก plan_start–plan_end (นับวันแรกด้วย)
 *   ก่อนเริ่ม = 0 · ถึงวันสิ้นสุดแล้ว = 100 · ไม่ได้ตั้งวันหรือวันผิดลำดับ = null (ไม่รู้ ไม่เดาเป็น 0)
 */
export function plannedPct(item, asOfIso, override = null) {
  const forced = numOrNull(override)
  if (forced !== null) return clamp(forced, 0, 100)
  const start = item?.plan_start
  const end = item?.plan_end
  if (!isIsoDate(start) || !isIsoDate(end) || !isIsoDate(asOfIso) || end < start) return null
  if (asOfIso < start) return 0
  if (asOfIso >= end) return 100
  return clamp((inclusiveDays(start, asOfIso) / inclusiveDays(start, end)) * 100, 0, 100)
}

// ── เวลาตามสัญญา ─────────────────────────────────────────────────────────

/** วันสิ้นสุดที่ใช้จริง = วันต่อสัญญา (ถ้าเลยวันสิ้นสุดเดิม) ไม่งั้นวันสิ้นสุดเดิม */
export function effectiveEndDate(contract) {
  const end = isIsoDate(contract?.end_date) ? contract.end_date : null
  const extended = isIsoDate(contract?.extended_until) ? contract.extended_until : null
  if (extended && (!end || extended > end)) return extended
  return end
}

/**
 * ตัวเลขเวลาตามสัญญา ณ วัน asOfIso (ใช้วันสิ้นสุดช่วงรายงาน ไม่ใช่วันนี้)
 *   remainingDays ติดลบ = เกินกำหนด · elapsed + remaining = duration เมื่ออยู่ในช่วงสัญญา
 * ขาดวันเริ่ม/สิ้นสุด หรือสิ้นสุดก่อนเริ่ม = null
 */
export function contractTiming(contract, asOfIso) {
  const start = isIsoDate(contract?.start_date) ? contract.start_date : null
  const end = effectiveEndDate(contract)
  if (!start || !end || !isIsoDate(asOfIso) || end < start) return null
  const durationDays = inclusiveDays(start, end)
  const elapsedRaw = asOfIso < start ? 0 : inclusiveDays(start, asOfIso)
  const remainingDays = daysBetween(asOfIso, end)
  return {
    start,
    end,
    durationDays,
    elapsedDays: Math.min(durationDays, elapsedRaw),
    remainingDays,
    overdueDays: Math.max(0, -remainingDays),
    remainingPct: round2(clamp((remainingDays / durationDays) * 100, 0, 100)),
    timePlanPct: round2(clamp((elapsedRaw / durationDays) * 100, 0, 100)),
  }
}

// ── สิทธิ์ (ฝั่งหน้าจอ: ซ่อนปุ่มให้ตรงกับ policy) ───────────────────────────────

/**
 * ผู้ใช้คนนี้ทำอะไรกับโครงการนี้ได้ — ต้องตรงกับฟังก์ชัน civil_can_manage/read/write_project และ policy ของ civil_projects ใน
 * supabase/migrations/20261106100100_civil_reports_rls_triggers.sql + 20260802060000 (ตัวตัดสินจริงคือฐานข้อมูล ตรงนี้แค่ซ่อนปุ่มที่กดไปก็ไม่ผ่าน)
 *   manage   = superadmin · admin ของ อปท. · officer ของกองที่ถือโครงการ (ปลดล็อกรายงาน ลบ ย้ายกอง)
 *   read     = manage หรือ staff/technician ที่กองเดียวกัน/เป็นผู้สร้าง/ถูกระบุชื่อในโครงการ
 *   write    = manage หรือ staff/technician ที่เป็นผู้สร้าง หรือถูกระบุเป็น "ผู้ควบคุมงาน"
 *   editBase = แก้แถวทะเบียนโครงการเดิม (civil_projects) ได้ — policy เดิมให้ staff/technician แก้ได้เฉพาะโครงการที่ตนสร้าง
 * @param {{ role?: string, userId?: string, departmentId?: string|null, project: object, listed?: { any?: boolean, supervisor?: boolean } }} args
 */
export function projectAccess({ role, userId, departmentId = null, project, listed = {} }) {
  const none = { read: false, write: false, manage: false, editBase: false }
  if (!project) return none
  if (role === 'superadmin' || role === 'admin') return { read: true, write: true, manage: true, editBase: true }
  const sameDepartment = Boolean(departmentId) && project.department_id === departmentId
  if (role === 'officer') {
    return sameDepartment ? { read: true, write: true, manage: true, editBase: true } : none
  }
  if (role === 'staff' || role === 'technician') {
    const creator = Boolean(userId) && project.created_by === userId
    return {
      read: sameDepartment || creator || Boolean(listed.any),
      write: creator || Boolean(listed.supervisor),
      manage: false,
      editBase: creator,
    }
  }
  return none
}

// ── ตรวจข้อมูล ───────────────────────────────────────────────────────────

const problem = (level, code, message, extra = {}) => ({ level, code, message, ...extra })

const normalizeItems = items => [...(items ?? [])]
  .map((it, i) => ({
    id: it.id ?? `#${i}`,
    name: String(it.name ?? '').trim(),
    sort_order: numOrNull(it.sort_order) ?? i,
    weight: num0(it.weight_pct ?? it.weight),
    plan_start: it.plan_start ?? null,
    plan_end: it.plan_end ?? null,
  }))
  .sort((a, b) => a.sort_order - b.sort_order)

/** ตรวจรายการงานตอนตั้งโครงการ — level 'error' = บันทึกแล้วคำนวณผิด/ล็อกรายงานไม่ได้ · 'info' = แค่แจ้ง ไม่ขวาง */
export function validateItems(items) {
  const rows = normalizeItems(items)
  const out = []
  if (!rows.length) {
    out.push(problem('error', 'no_items', 'ยังไม่มีรายการงาน — เพิ่มรายการงานและสัดส่วนก่อน'))
    return out
  }
  let sum = 0
  let noPlan = 0
  for (const row of rows) {
    sum += row.weight
    if (!row.name) out.push(problem('error', 'item_name', 'มีรายการงานที่ยังไม่ได้ตั้งชื่อ', { itemId: row.id }))
    if (row.weight < 0 || row.weight > 100) {
      out.push(problem('error', 'item_weight', `สัดส่วนของ "${row.name || 'รายการที่ไม่มีชื่อ'}" ต้องอยู่ระหว่าง 0–100%`, { itemId: row.id }))
    }
    if (isIsoDate(row.plan_start) && isIsoDate(row.plan_end) && row.plan_end < row.plan_start) {
      out.push(problem('error', 'plan_range', `วันสิ้นสุดของ "${row.name || 'รายการที่ไม่มีชื่อ'}" อยู่ก่อนวันเริ่ม`, { itemId: row.id }))
    } else if (!isIsoDate(row.plan_start) || !isIsoDate(row.plan_end)) {
      noPlan += 1
    }
  }
  if (Math.abs(sum - 100) > WEIGHT_SUM_TOLERANCE) {
    out.push(problem('error', 'weight_sum', `สัดส่วนงานรวม ${fmt(sum)}% (ต้องเท่ากับ 100%)`))
  }
  if (noPlan) {
    out.push(problem('info', 'no_plan', `${noPlan} รายการยังไม่ได้ตั้งวัน เริ่ม–สิ้นสุด ระบบจึงเทียบเร็ว/ช้าให้ไม่ได้`))
  }
  return out
}

const sortReports = reports => [...(reports ?? [])].sort((a, b) => Number(a.week_no) - Number(b.week_no))

/** ตรวจช่วงวันที่ของรายงาน: ต้องจริง · ไม่ย้อนกลับ · ไม่เกิน MAX_PERIOD_DAYS · ต่อเนื่องจากสัปดาห์ก่อน (ไม่ข้าม ไม่ทับ) */
export function validatePeriod({ reports = [], report }) {
  const out = []
  const weekNo = Number(report?.week_no)
  if (!Number.isInteger(weekNo) || weekNo < 1) {
    out.push(problem('error', 'week_no', 'เลขสัปดาห์ต้องเป็นจำนวนเต็มตั้งแต่ 1'))
  }
  const start = report?.period_start
  const end = report?.period_end
  if (!isIsoDate(start) || !isIsoDate(end)) {
    out.push(problem('error', 'period_invalid', 'ยังไม่ได้เลือกช่วงวันที่ของรายงาน'))
    return out
  }
  if (end < start) {
    out.push(problem('error', 'period_order', 'วันสิ้นสุดอยู่ก่อนวันเริ่มต้น'))
    return out
  }
  const days = inclusiveDays(start, end)
  if (days > MAX_PERIOD_DAYS) {
    out.push(problem('error', 'period_too_long', `ช่วงรายงานยาว ${days} วัน (ไม่เกิน ${MAX_PERIOD_DAYS} วันต่อฉบับ)`))
  }
  const previous = sortReports(reports.filter(r => Number(r.week_no) < weekNo)).pop()
  if (previous && isIsoDate(previous.period_end)) {
    const expected = addDays(previous.period_end, 1)
    if (start !== expected) {
      const overlap = start < expected
      out.push(problem(
        'error',
        overlap ? 'period_overlap' : 'period_gap',
        `ช่วงรายงานควรเริ่มวันที่ ${thaiShortDate(expected)} ต่อจากสัปดาห์ที่ ${previous.week_no} (${overlap ? 'ซ้อนทับกับสัปดาห์ก่อน' : 'ข้ามวันไป'})`,
      ))
    }
  }
  return out
}

// ── รายงานสัปดาห์: ตารางผลงาน ─────────────────────────────────────────────

/**
 * คำนวณตารางผลงานของรายงานหนึ่งฉบับ (หน้า 1 สรุป · หน้า 3 ตารางงาน · หน้า 6 กราฟ)
 * @param {object}   args
 * @param {Array}    args.items     รายการงาน [{id, name, weight_pct, plan_start, plan_end, sort_order}]
 * @param {Array}    args.reports   รายงานทั้งหมดของโครงการ (ร่างหรือล็อกก็ได้ จะมี/ไม่มีฉบับนี้ก็ได้)
 * @param {object}   args.report    ฉบับที่คำนวณ {week_no, period_start, period_end, progress}
 *                                  progress = { [itemId]: { week: % ในสัปดาห์นี้, plan: แผนสะสมแก้ทับ|null, base: ยอดตั้งต้น|null } }
 *                                  `base` มีผลเฉพาะสัปดาห์แรกสุดของโครงการ (เริ่มบันทึกกลางโครงการ)
 * @param {object}   args.contract  {start_date, end_date, extended_until}
 * @returns ออบเจ็กต์ JSON-safe (ไม่มี NaN/undefined) เก็บเป็น frozen ได้ตรงๆ
 */
export function buildReportSheet({ items, reports = [], report, contract }) {
  const rows = normalizeItems(items)
  const weekNo = Number(report?.week_no)
  const others = reports.filter(r => Number(r.week_no) !== weekNo)
  const earlier = sortReports(others.filter(r => Number(r.week_no) < weekNo))
  const first = sortReports([...others, report])[0]
  const progressOf = (r, id) => r?.progress?.[id] ?? null

  const issues = [...validatePeriod({ reports, report })]
  const itemProblems = validateItems(items)
  issues.push(...itemProblems)

  const periodEnd = report?.period_end
  const raws = [] // ค่าก่อนปัดของแต่ละแถว ไว้รวมยอดไม่ให้เพี้ยนจากการปัดซ้ำ (ไม่เก็บลงผลลัพธ์)
  const itemRows = rows.map(item => {
    const prev = num0(progressOf(first, item.id)?.base)
      + earlier.reduce((sum, r) => sum + Math.max(0, num0(progressOf(r, item.id)?.week)), 0)
    const weekRaw = num0(progressOf(report, item.id)?.week)
    const week = Math.max(0, weekRaw)
    const cum = prev + week
    const cumClamped = clamp(cum, 0, 100)
    const override = numOrNull(progressOf(report, item.id)?.plan)
    const plan = plannedPct(item, periodEnd, override)
    const variance = plan === null ? null : cum - plan
    if (weekRaw < 0) {
      issues.push(problem('error', 'negative_week', `ผลงานในสัปดาห์ของ "${item.name || 'รายการที่ไม่มีชื่อ'}" ติดลบไม่ได้`, { itemId: item.id }))
    }
    if (cum > 100 + 1e-9) {
      issues.push(problem('error', 'over_100', `"${item.name || 'รายการที่ไม่มีชื่อ'}" สะสมเกิน 100% (${fmt(cum)}%)`, { itemId: item.id }))
    }
    raws.push({
      weighted: (item.weight * cumClamped) / 100,
      weightedPlan: plan === null ? null : (item.weight * plan) / 100,
      weightedWeek: (item.weight * clamp(week, 0, 100)) / 100,
      weightedPrev: (item.weight * clamp(prev, 0, 100)) / 100,
    })
    return {
      id: item.id,
      name: item.name,
      weight: round2(item.weight),
      prev: round2(prev),
      week: round2(week),
      cum: round2(cum),
      plan: plan === null ? null : round2(plan),
      planSource: override !== null ? 'override' : plan === null ? null : 'linear',
      variance: variance === null ? null : round2(variance),
      label: scheduleLabel(variance),
      weighted: round2((item.weight * cumClamped) / 100),
      weightedPlan: plan === null ? null : round2((item.weight * plan) / 100),
      weightedWeek: round2((item.weight * clamp(week, 0, 100)) / 100),
      weightedPrev: round2((item.weight * clamp(prev, 0, 100)) / 100),
    }
  })

  const sumRaw = key => raws.reduce((s, r) => s + r[key], 0)
  const allPlanned = itemRows.length > 0 && itemRows.every(r => r.plan !== null)
  const actual = sumRaw('weighted')
  const planTotal = allPlanned ? sumRaw('weightedPlan') : null
  const variance = planTotal === null ? null : actual - planTotal
  const overall = {
    prev: round2(sumRaw('weightedPrev')),
    week: round2(sumRaw('weightedWeek')),
    actual: round2(actual),
    plan: planTotal === null ? null : round2(planTotal),
    variance: variance === null ? null : round2(variance),
    label: scheduleLabel(variance),
  }

  const t = contractTiming(contract, periodEnd)
  const timing = t && {
    ...t,
    planPct: t.timePlanPct,
    variance: round2(actual - t.timePlanPct),
    label: scheduleLabel(actual - t.timePlanPct, TIME_PLAN_TOLERANCE),
  }
  if (!timing) {
    issues.push(problem('info', 'no_contract_dates', 'ยังไม่ได้ตั้งวันเริ่ม–สิ้นสุดสัญญา — คำนวณแผนตามเวลาและวันคงเหลือไม่ได้'))
  }

  const seen = new Set()
  const problems = issues.filter(p => {
    const key = `${p.code}|${p.itemId ?? ''}|${p.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    version: 1,
    weekNo: Number.isInteger(weekNo) ? weekNo : null,
    periodStart: report?.period_start ?? null,
    periodEnd: periodEnd ?? null,
    items: itemRows,
    overall,
    timing,
    problems,
    canFinalize: problems.every(p => p.level !== 'error'),
  }
}

/** ตารางที่เก็บลง `frozen` ตอนล็อกรายงาน — ตัด problems ออก (ล็อกได้แปลว่าไม่มี error) */
export function freezeSheet(sheet) {
  const frozen = { ...sheet, version: 1 }
  delete frozen.problems
  delete frozen.canFinalize
  return frozen
}

// ── สร้างรายงานสัปดาห์ถัดไป ──────────────────────────────────────────────

/** เลขสัปดาห์ + ช่วงวันที่ถัดไป: ต่อวันถัดจากสัปดาห์ล่าสุด 7 วัน · ฉบับแรกเริ่มที่วันเริ่มสัญญา (ไม่มี = null ให้เลือกเอง) */
export function nextReportDraft({ reports = [], contract } = {}) {
  const last = sortReports(reports).pop()
  if (!last) {
    const start = isIsoDate(contract?.start_date) ? contract.start_date : null
    return { week_no: 1, period_start: start, period_end: start ? addDays(start, WEEK_DAYS - 1) : null }
  }
  const start = isIsoDate(last.period_end) ? addDays(last.period_end, 1) : null
  return {
    week_no: Number(last.week_no) + 1,
    period_start: start,
    period_end: start ? addDays(start, WEEK_DAYS - 1) : null,
  }
}

export const emptyFinance = () => ({ advance_amount: null, advance_pct: null, budget_rows: [] })

/**
 * ค่าตั้งต้นของรายงานฉบับใหม่จากฉบับก่อน (ระบบร่าง คนตรวจแล้วแก้เฉพาะที่เปลี่ยน)
 *   คัดลอก: ชื่อแถวกำลังคน/เครื่องจักร (จำนวนเป็น 0) · ยอดงวด/ค่าจ้างล่วงหน้า · "เรียน"
 *   ไม่คัดลอก: ผลงานในสัปดาห์ · สภาพอากาศ · บันทึกรายวัน · ปัญหา-อุปสรรค — เป็นข้อเท็จจริงของสัปดาห์นั้น ห้ามเดา
 */
export function draftFromPrevious(previous, period) {
  const dates = periodDates(period?.period_start, period?.period_end)
  const zeros = () => dates.map(() => 0)
  const namesOnly = rows => (rows ?? []).map(r => ({ name: r.name, days: zeros() }))
  return {
    memo_to: previous?.memo_to ?? '',
    progress: {},
    crew: namesOnly(previous?.crew),
    machinery: namesOnly(previous?.machinery),
    weather: {},
    daily_log: [],
    issues: { problems: '', solution: '', other: '' },
    finance: previous?.finance ? JSON.parse(JSON.stringify(previous.finance)) : emptyFinance(),
  }
}

// ── ภาพรวมหลายสัปดาห์ ───────────────────────────────────────────────────

/** จุดข้อมูลรายสัปดาห์ของกราฟ/ตารางสรุป — ฉบับที่ล็อกแล้วใช้ตัวเลขที่แช่แข็งไว้ ไม่คำนวณใหม่ */
export function progressSeries({ items, reports = [], contract }) {
  const sorted = sortReports(reports)
  return sorted.map(r => {
    const frozen = r.status === 'final' && r.frozen?.version === 1 ? r.frozen : null
    const sheet = frozen ?? buildReportSheet({ items, reports: sorted, report: r, contract })
    return {
      week_no: Number(r.week_no),
      period_start: r.period_start,
      period_end: r.period_end,
      status: r.status ?? 'draft',
      actual: sheet.overall.actual,
      plan: sheet.overall.plan,
      week: sheet.overall.week,
      timePlan: sheet.timing?.planPct ?? null,
      label: sheet.overall.label,
    }
  })
}

/** รวมจุดรายสัปดาห์เป็นรายเดือน (ตามเดือนของวันสิ้นสุดช่วง) หรือรายปีงบประมาณ — ยอดสะสมของกลุ่ม = ฉบับสุดท้ายในกลุ่ม */
export function groupSeries(series, by) {
  const groups = new Map()
  for (const point of series) {
    const key = by === 'fiscal' ? fiscalYearOfIso(point.period_end) : String(point.period_end ?? '').slice(0, 7)
    if (key === null || key === '') continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(point)
  }
  return [...groups.entries()].map(([key, points]) => {
    const last = points[points.length - 1]
    return {
      key,
      weeks: points.length,
      from: points[0].period_start,
      to: last.period_end,
      endActual: last.actual,
      endPlan: last.plan,
      gained: round2(points.reduce((sum, p) => sum + p.week, 0)),
    }
  })
}

// ทะเบียนใบอนุญาต (ขั้น 1B / E3) — ฟังก์ชันบริสุทธิ์ของหน้าจอ (ไม่ import supabase/React เทสต์ด้วย node ได้)
// ฐานข้อมูล: supabase/migrations/20261208100000_licence_registry_tables.sql + 20261208100100_licence_registry_rls_rpc.sql
//
// หลักของโมดูลนี้: ระบบ "บันทึก/คำนวณ/เตือน" ตามกฎที่ตั้งไว้ ไม่ตัดสินแทนเจ้าพนักงานท้องถิ่น
//   - การรับค่าธรรมเนียม = เจ้าหน้าที่ยืนยันพร้อมเลขใบเสร็จ ระบบแค่ขยายวันหมดอายุตามกฎ
//   - พักใช้/เพิกถอน = คำสั่งของเจ้าพนักงานท้องถิ่น ระบบเก็บเลขคำสั่ง+เหตุผลที่เจ้าหน้าที่กรอก
//   - "หมดอายุ" ไม่ใช่สถานะในฐาน คำนวณจากวันนี้ (เวลาไทย) เทียบ expires_on
// ⚠️ ฐานกฎหมาย/อัตราในไฟล์นี้เป็น "ค่าเริ่มต้นให้แก้ได้" ที่คัดจากฉบับรวมของกรมอนามัย — ตัวบทจริงอยู่ที่ราชกิจจานุเบกษา
//    ต้องยืนยันกับฉบับปัจจุบัน (พ.ร.บ.การสาธารณสุข พ.ศ. 2535 และข้อกำหนดของท้องถิ่นแต่ละแห่ง) ก่อนอ้างอิงเป็นทางการ

import { normalizeHeader } from './spreadsheetRead.js'

export const LICENCE_MODULE_KEY = 'licence-registry'

/** หมวดตามตัวบท (ตรงกับ CHECK ของ licence_types.category) — ป้ายไทย + ฐานกฎหมายเริ่มต้น + ค่าเริ่มต้นการต่ออายุ */
export const LICENCE_CATEGORIES = Object.freeze([
  { value: 'health_hazard', label: 'กิจการที่เป็นอันตรายต่อสุขภาพ', legalBasis: 'ม.33 พ.ร.บ.การสาธารณสุข พ.ศ. 2535', docKind: 'licence', renewalByFee: true },
  { value: 'market', label: 'การจัดตั้งตลาด', legalBasis: 'ม.34 พ.ร.บ.การสาธารณสุข พ.ศ. 2535', docKind: 'licence', renewalByFee: true },
  { value: 'food_premises', label: 'สถานที่จำหน่าย/สะสมอาหาร (เกิน 200 ตร.ม.)', legalBasis: 'ม.38 พ.ร.บ.การสาธารณสุข พ.ศ. 2535', docKind: 'licence', renewalByFee: true },
  { value: 'food_notice', label: 'สถานที่จำหน่าย/สะสมอาหาร (ไม่เกิน 200 ตร.ม.)', legalBasis: 'ม.38/48 พ.ร.บ.การสาธารณสุข พ.ศ. 2535', docKind: 'notice_certificate', renewalByFee: false },
  { value: 'street_vending', label: 'การจำหน่ายสินค้าในที่หรือทางสาธารณะ', legalBasis: 'ม.41 พ.ร.บ.การสาธารณสุข พ.ศ. 2535', docKind: 'licence', renewalByFee: true },
  // ม.19 ไม่อยู่ในบัญชีท้ายของ พ.ร.ฎ. ปี 2564 ตามแนวทางที่อ่าน ⇒ เริ่มต้น "ไม่ต่ออายุโดยชำระค่าธรรมเนียม" (แก้ได้ที่หน้าประเภท) — ต้องยืนยันกับตัวบท
  { value: 'waste_service', label: 'การรับทำการเก็บ ขน กำจัดสิ่งปฏิกูลหรือมูลฝอย', legalBasis: 'ม.19 พ.ร.บ.การสาธารณสุข พ.ศ. 2535', docKind: 'licence', renewalByFee: false },
  { value: 'other', label: 'อื่น ๆ (ตามข้อกำหนดของท้องถิ่น)', legalBasis: '', docKind: 'licence', renewalByFee: true },
])

const CATEGORY_BY_VALUE = new Map(LICENCE_CATEGORIES.map((c) => [c.value, c]))
export const categoryOf = (value) => CATEGORY_BY_VALUE.get(value) ?? null
export const categoryLabel = (value) => categoryOf(value)?.label ?? 'ไม่ระบุหมวด'

/** ค่าเริ่มต้นของฟอร์มประเภทเมื่อเลือกหมวด (ฐานข้อมูลคำนวณ doc_kind/อายุ/การต่ออายุจากหมวดซ้ำเสมอ — ที่นี่แค่ให้หน้าจอตรงกัน) */
export function categoryDefaults(value) {
  const c = categoryOf(value)
  if (!c) return { doc_kind: 'licence', validity_months: 12, renewal_by_fee: true, legal_basis: '' }
  return {
    doc_kind: c.docKind,
    validity_months: c.docKind === 'licence' ? 12 : null,
    renewal_by_fee: c.renewalByFee,
    legal_basis: c.legalBasis,
  }
}

export const DOC_KIND_LABEL = Object.freeze({ licence: 'ใบอนุญาต', notice_certificate: 'หนังสือรับรองการแจ้ง' })
export const docKindLabel = (kind) => DOC_KIND_LABEL[kind] ?? 'เอกสาร'

export const STATUS_LABEL = Object.freeze({ active: 'ใช้งาน', suspended: 'พักใช้', revoked: 'เพิกถอน', closed: 'เลิกกิจการ' })
export const STATUS_ORDER_OPTIONS = Object.freeze([
  { value: 'suspended', label: 'พักใช้', needsOrder: true },
  { value: 'revoked', label: 'เพิกถอน', needsOrder: true },
  { value: 'closed', label: 'เลิกกิจการ', needsOrder: false },
  { value: 'active', label: 'คืนสถานะใช้งาน', needsOrder: false },
])

/** พักใช้ได้ไม่เกินกี่วัน (ม.59 — นับวันเริ่มเป็นวันที่ 1) · ต้องยืนยันกับฉบับปัจจุบัน */
export const SUSPEND_MAX_DAYS = 15
/** ค่าปรับร้อยละ 20 ของค่าธรรมเนียมรายปีเมื่อชำระช้า (ม.65) — เป็น "ข้อเสนอ" ให้เจ้าหน้าที่ยืนยัน/แก้ยอด */
export const SURCHARGE_RATE = 0.2
/** เกณฑ์ "ใกล้ครบกำหนด" ของป้ายสถานะ/แท็บต้องดำเนินการ เมื่อ อปท. ไม่ได้ตั้งวันเตือน */
export const DEFAULT_REMIND_DAYS = Object.freeze([60, 30, 7, 0])
export const REMIND_DAYS_MAX_COUNT = 6
export const REMIND_DAY_MAX = 180

// ── วันที่ (ISO yyyy-mm-dd ล้วน ไม่ผ่าน timezone ของเครื่อง) ─────────────────────────

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** ตรวจว่าเป็นวันที่ปฏิทินจริง (กัน 2026-02-30) */
export function isIsoDate(value) {
  if (typeof value !== 'string') return false
  const m = ISO_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

const toUtc = (iso) => { const m = ISO_RE.exec(iso); return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) }
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10)

/** วันนี้ตามเวลาไทย (ISO) — now ส่งเข้ามาเพื่อเทสต์ */
export function todayBangkok(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t) => parts.find((p) => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** b − a เป็นจำนวนวัน (ติดลบ = b อยู่ก่อน a) */
export function daysBetween(a, b) {
  if (!isIsoDate(a) || !isIsoDate(b)) return null
  return Math.round((toUtc(b) - toUtc(a)) / 86400000)
}

export function addDays(iso, days) {
  if (!isIsoDate(iso)) return null
  return fromUtc(toUtc(iso) + days * 86400000)
}

/** บวกเดือนแบบเดียวกับ Postgres (date + interval 'N months'): วันที่เกินสิ้นเดือนปลายทางถอยเป็นวันสุดท้ายของเดือน */
export function addMonths(iso, months) {
  if (!isIsoDate(iso)) return null
  const [y, m, d] = iso.split('-').map(Number)
  const index = y * 12 + (m - 1) + months
  const ty = Math.floor(index / 12)
  const tm = (index % 12) + 1
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate()
  return `${String(ty).padStart(4, '0')}-${String(tm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

// ── เป้าหมายวัน/สถานะที่คำนวณ ───────────────────────────────────────────────────────

/** วันที่ที่ใช้เตือน: ใบอนุญาต = expires_on · หนังสือรับรองการแจ้ง = next_fee_due_on */
export function targetDate(licence, docKind) {
  if (!licence) return null
  return (docKind === 'notice_certificate' ? licence.next_fee_due_on : licence.expires_on) ?? null
}

/** วันคงเหลือ (target − วันนี้ตามเวลาไทย) · ติดลบ = เลยแล้ว · null = ไม่มีวันที่ */
export function daysRemaining(licence, docKind, today) {
  const t = targetDate(licence, docKind)
  return t ? daysBetween(today, t) : null
}

/** ค่าวันเตือนที่ใช้จริง: ไม่มี/ผิดรูป → ค่าเริ่มต้น */
export function effectiveRemindDays(remindDays) {
  const list = normalizeRemindDays(remindDays)
  return list.length ? list : [...DEFAULT_REMIND_DAYS]
}

/**
 * ใบนี้ "ต้องดำเนินการ" เรื่องอะไร (เฉพาะใบที่ยังใช้งาน/พักใช้ — เพิกถอน/เลิกกิจการไม่มีอะไรให้ทำ)
 *   expired  ใบอนุญาตสิ้นอายุแล้ว (ต้องยื่นขอใหม่)   expiring ใบอนุญาตใกล้สิ้นอายุ
 *   overdue  หนังสือรับรองการแจ้งเลยวันครบกำหนดชำระ   due      ใกล้ครบกำหนดชำระ
 * soonDays = ค่ามากสุดของวันเตือน (เกณฑ์ "ใกล้")
 */
export function actionKind(licence, docKind, today, soonDays = Math.max(...DEFAULT_REMIND_DAYS)) {
  if (!licence || !['active', 'suspended'].includes(licence.status)) return null
  const d = daysRemaining(licence, docKind, today)
  if (d === null) return null
  if (docKind === 'notice_certificate') return d < 0 ? 'overdue' : d <= soonDays ? 'due' : null
  return d < 0 ? 'expired' : d <= soonDays ? 'expiring' : null
}

const TONES = Object.freeze({
  ok: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-800',
  danger: 'bg-red-50 text-red-700',
  muted: 'bg-gray-100 text-gray-600',
})

/**
 * ป้ายสถานะของใบ (คำนวณ ไม่ใช่ค่าในฐาน)
 * ใช้งาน / ใกล้หมดอายุ / หมดอายุแล้ว / พักใช้ / พ้นกำหนดพักใช้ / เพิกถอน / เลิกกิจการ / ครบกำหนดชำระ / ค้างชำระ
 */
export function licenceBadge(licence, docKind, today, soonDays) {
  const status = licence?.status
  if (status === 'revoked') return { id: 'revoked', label: STATUS_LABEL.revoked, tone: TONES.danger }
  if (status === 'closed') return { id: 'closed', label: STATUS_LABEL.closed, tone: TONES.muted }
  if (status === 'suspended') {
    // พ้นวันสิ้นสุดแล้วแต่ยังไม่มีใครบันทึกคืนสถานะ → บอกให้เห็น (ระบบไม่คืนสถานะเอง — ต้องมีเจ้าหน้าที่บันทึก)
    if (licence.status_until && isIsoDate(licence.status_until) && licence.status_until < today) {
      return { id: 'suspension_over', label: 'พ้นกำหนดพักใช้', tone: TONES.warn }
    }
    return { id: 'suspended', label: STATUS_LABEL.suspended, tone: TONES.warn }
  }
  const kind = actionKind(licence, docKind, today, soonDays)
  if (kind === 'expired') return { id: 'expired', label: 'หมดอายุแล้ว', tone: TONES.danger }
  if (kind === 'expiring') return { id: 'expiring', label: 'ใกล้หมดอายุ', tone: TONES.warn }
  if (kind === 'overdue') return { id: 'overdue', label: 'ค้างชำระ', tone: TONES.danger }
  if (kind === 'due') return { id: 'due', label: 'ครบกำหนดชำระ', tone: TONES.warn }
  return { id: 'active', label: STATUS_LABEL.active, tone: TONES.ok }
}

/** ตัวกรองสถานะในแท็บทะเบียน — id ตรงกับ licenceBadge().id (+ all) */
export const BADGE_FILTERS = Object.freeze([
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'active', label: 'ใช้งาน' },
  { id: 'expiring', label: 'ใกล้หมดอายุ' },
  { id: 'expired', label: 'หมดอายุแล้ว' },
  { id: 'due', label: 'ครบกำหนดชำระ' },
  { id: 'overdue', label: 'ค้างชำระ' },
  { id: 'suspended', label: 'พักใช้' },
  { id: 'revoked', label: 'เพิกถอน' },
  { id: 'closed', label: 'เลิกกิจการ' },
])

/** วันคงเหลือเป็นข้อความ: "อีก 12 วัน" · "วันนี้" · "เลยมา 5 วัน" */
export function remainingText(days) {
  if (days === null || days === undefined) return '—'
  if (days === 0) return 'วันนี้'
  return days > 0 ? `อีก ${days} วัน` : `เลยมา ${-days} วัน`
}

// ── ค่าธรรมเนียม / ต่ออายุ ───────────────────────────────────────────────────────────

/** ข้อเสนอค่าปรับร้อยละ 20 (ปัดเป็นสตางค์) — เจ้าหน้าที่ยืนยันหรือแก้ยอดเอง ระบบไม่ตัดสิน */
export function suggestSurcharge(fee) {
  const n = Number(fee)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * SURCHARGE_RATE * 100) / 100
}

/** ชำระรายปีช้าไหม (วันที่ชำระ > วันครบกำหนด) */
export function isLateAnnual(paidOn, dueOn) {
  if (!isIsoDate(paidOn) || !isIsoDate(dueOn)) return false
  return paidOn > dueOn
}

/**
 * ตรวจสิทธิ์ต่ออายุโดยชำระค่าธรรมเนียม (พ.ร.ฎ. 2564 — ชำระภายในวันสุดท้ายของใบ) ตามกฎเดียวกับ licence_record_fee
 * คืน { ok, reason } — reason เป็นข้อความไทยบอกเหตุที่ต่อไม่ได้
 * ⚠️ ฐานข้อมูลตรวจซ้ำเสมอ (ตัวบังคับจริง) ฟังก์ชันนี้แค่ให้หน้าจอบอกก่อนกดยืนยัน
 */
export function checkRenewal({ licence, type, paidOn, noMaterialChange }) {
  if (!licence || !type) return { ok: false, reason: 'ไม่พบข้อมูลใบหรือประเภท' }
  if (type.doc_kind !== 'licence') return { ok: false, reason: 'หนังสือรับรองการแจ้งไม่มีการต่ออายุ — บันทึกค่าธรรมเนียมรายปีแทน' }
  if (!type.renewal_by_fee) return { ok: false, reason: 'ประเภทนี้ไม่ได้ตั้งให้ต่ออายุโดยชำระค่าธรรมเนียม — ให้ผู้ประกอบการยื่นคำขอตามปกติ' }
  if (!['active', 'suspended'].includes(licence.status)) return { ok: false, reason: 'ใบที่ถูกเพิกถอน/เลิกกิจการแล้ว รับค่าธรรมเนียมต่ออายุไม่ได้' }
  if (!isIsoDate(paidOn)) return { ok: false, reason: 'ระบุวันที่ชำระ' }
  if (!isIsoDate(licence.expires_on)) return { ok: false, reason: 'ใบนี้ไม่มีวันหมดอายุในทะเบียน' }
  if (paidOn > licence.expires_on) {
    return { ok: false, reason: 'ชำระหลังใบอนุญาตสิ้นอายุ — ต่ออายุโดยชำระค่าธรรมเนียมไม่ได้ ต้องยื่นคำขอรับใบอนุญาตใหม่' }
  }
  if (type.renewal_window_days && paidOn < addDays(licence.expires_on, -type.renewal_window_days)) {
    return { ok: false, reason: `ยังไม่ถึงช่วงต่ออายุตามข้อกำหนดของท้องถิ่น (ล่วงหน้าได้ไม่เกิน ${type.renewal_window_days} วัน)` }
  }
  // ต่อล่วงหน้าเกิน 1 รอบไม่ได้ (ตรงกับด่านใน licence_record_fee): ต้องชำระภายในรอบอายุปัจจุบันของใบ
  const months = type.validity_months ?? 12
  const earliest = addMonths(addDays(licence.expires_on, 1), -months)
  if (earliest && paidOn < earliest) return { ok: false, reason: `ใบนี้ต่ออายุไว้ล่วงหน้าแล้ว (ใช้ได้ถึง ${licence.expires_on}) — ต่อซ้อนเกิน 1 รอบไม่ได้` }
  if (noMaterialChange === false) return { ok: false, reason: 'ต้องมีการรับรองว่าไม่เปลี่ยนแปลงสาระสำคัญ — ถ้ามีการเปลี่ยนแปลง ต้องยื่นคำขอ' }
  return { ok: true, reason: '' }
}

/**
 * ตรวจการรับค่าธรรมเนียมรายปีของหนังสือรับรองการแจ้ง ตามด่านใน licence_record_fee
 * ชำระซ้อนเกิน 1 รอบไม่ได้: วันที่ชำระต้องไม่ก่อน (วันครบกำหนดถัดไป − 12 เดือน)
 */
export function checkAnnual({ licence, paidOn }) {
  if (!licence?.next_fee_due_on || !isIsoDate(licence.next_fee_due_on)) return { ok: false, reason: 'ใบนี้ยังไม่ได้ตั้งวันครบกำหนดชำระค่าธรรมเนียม' }
  if (!isIsoDate(paidOn)) return { ok: false, reason: 'ระบุวันที่ชำระ' }
  const earliest = addMonths(licence.next_fee_due_on, -12)
  if (earliest && paidOn < earliest) return { ok: false, reason: `ค่าธรรมเนียมรอบนี้ชำระไว้แล้ว (ครบกำหนดครั้งถัดไป ${licence.next_fee_due_on}) — ชำระซ้อนเกิน 1 รอบไม่ได้` }
  return { ok: true, reason: '' }
}

/**
 * สถานะของปุ่ม "บันทึกรับค่าธรรมเนียม" ของใบนี้ ณ วันนี้ — ปุ่มปิดพร้อมเหตุผลเมื่อใบอนุญาตสิ้นอายุแล้ว
 * @returns {{ enabled: boolean, kind: 'renewal'|'annual'|null, reason: string }}
 */
export function feeButtonState({ licence, type, today }) {
  if (!licence || !type) return { enabled: false, kind: null, reason: '' }
  if (!['active', 'suspended'].includes(licence.status)) {
    return { enabled: false, kind: null, reason: 'ใบที่ถูกเพิกถอน/เลิกกิจการแล้ว รับค่าธรรมเนียมไม่ได้' }
  }
  if (type.doc_kind === 'notice_certificate') {
    if (!licence.next_fee_due_on) return { enabled: false, kind: 'annual', reason: 'ยังไม่ได้ตั้งวันครบกำหนดชำระค่าธรรมเนียม — แก้ที่ข้อมูลใบ' }
    // ชำระซ้อนเกิน 1 รอบไม่ได้ (ปุ่มปิดพร้อมเหตุผล) — ฐานข้อมูลตรวจซ้ำ
    const stacked = checkAnnual({ licence, paidOn: today })
    if (!stacked.ok) return { enabled: false, kind: 'annual', reason: stacked.reason }
    return { enabled: true, kind: 'annual', reason: '' }
  }
  if (!type.renewal_by_fee) return { enabled: false, kind: 'renewal', reason: 'ประเภทนี้ไม่ได้ตั้งให้ต่ออายุโดยชำระค่าธรรมเนียม — ให้ผู้ประกอบการยื่นคำขอตามปกติ' }
  if (licence.expires_on && today > licence.expires_on) {
    return { enabled: false, kind: 'renewal', reason: 'ใบอนุญาตสิ้นอายุแล้ว — ต่ออายุโดยชำระค่าธรรมเนียมไม่ได้ ต้องยื่นคำขอรับใบอนุญาตใหม่' }
  }
  // ต่อซ้อนเกิน 1 รอบไม่ได้ / ยังไม่ถึงช่วงต่ออายุ ณ วันนี้ → ปุ่มปิดพร้อมเหตุผล (ค่าเริ่มต้นเข้มของ licence_record_fee)
  // ⚠️ ปุ่มวัดจากวันนี้ — ใบเสร็จที่ผู้ประกอบการชำระไว้ในอดีตแล้วเพิ่งมาบันทึก ฐานข้อมูลรับย้อนหลังได้ ≤ 400 วันแต่ปุ่มนี้ปิดตามวันนี้
  const gate = checkRenewal({ licence, type, paidOn: today })
  if (!gate.ok) return { enabled: false, kind: 'renewal', reason: gate.reason }
  return { enabled: true, kind: 'renewal', reason: '' }
}

/**
 * ตัวอย่างผลก่อนกดยืนยัน (ตรงกับที่ licence_record_fee จะคำนวณ)
 *   renewal: วันหมดอายุใหม่ = (วันหมดอายุเดิม + 1 วัน + อายุใบ เดือน) − 1 วัน
 *   annual : วันครบกำหนดถัดไป = วันครบกำหนดเดิม + 12 เดือน
 */
export function previewFeeResult({ kind, licence, type }) {
  if (!licence) return null
  if (kind === 'renewal') {
    // เหมือน SQL: นับจากวันเริ่มรอบใหม่ (หมดอายุเดิม + 1) บวกอายุใบ แล้วลบ 1 วัน — วันปลายเดือนไม่เพี้ยนสะสม
    const months = type?.validity_months ?? 12
    const from = addDays(licence.expires_on, 1)
    const to = from ? addDays(addMonths(from, months), -1) : null
    return to ? { label: 'วันหมดอายุใหม่', from, to, newDate: to } : null
  }
  const next = addMonths(licence.next_fee_due_on, 12)
  return next ? { label: 'วันครบกำหนดชำระครั้งถัดไป', from: licence.next_fee_due_on, to: addDays(next, -1), newDate: next } : null
}

/** พักใช้ครบกี่วัน (นับวันเริ่มเป็นวันที่ 1) · ผิดรูป = null */
export function suspendDays(from, until) {
  const d = daysBetween(from, until)
  return d === null ? null : d + 1
}

/** ตรวจกล่องบันทึกคำสั่ง — คืนข้อความผิดพลาดไทย หรือ '' เมื่อผ่าน (ฐานข้อมูลตรวจซ้ำ) */
export function validateStatusOrder({ status, reason, orderRef, from, until, currentStatus }) {
  if (!STATUS_LABEL[status]) return 'เลือกสถานะ'
  const r = String(reason ?? '').trim()
  if (r.length < 3) return 'ต้องระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)'
  if (r.length > 2000) return 'เหตุผลยาวเกิน 2,000 ตัวอักษร'
  const ref = String(orderRef ?? '').trim()
  if (ref.length > 200) return 'เลขที่คำสั่งยาวเกิน 200 ตัวอักษร'
  // เพิกถอน/เลิกกิจการแล้ว เปลี่ยนไปสถานะอื่นได้เมื่อมีคำสั่ง/หนังสือที่ให้เปลี่ยน (ตรงกับ licence_set_status)
  if (['revoked', 'closed'].includes(currentStatus) && status !== currentStatus && !ref) return 'ใบที่ถูกเพิกถอน/เลิกกิจการ เปลี่ยนสถานะได้เมื่อระบุเลขที่คำสั่ง/หนังสือที่ให้เปลี่ยน'
  if (status === 'suspended') {
    if (!ref) return 'พักใช้ต้องระบุเลขที่คำสั่ง'
    if (!isIsoDate(from) || !isIsoDate(until)) return 'พักใช้ต้องระบุวันเริ่มและวันสิ้นสุด'
    if (until < from) return 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'
    if (suspendDays(from, until) > SUSPEND_MAX_DAYS) return `พักใช้ได้ไม่เกิน ${SUSPEND_MAX_DAYS} วัน (นับวันเริ่มเป็นวันที่ 1)`
  }
  if (status === 'revoked' && !ref) return 'เพิกถอนต้องระบุเลขที่คำสั่ง'
  return ''
}

// ── วันเตือน (ค่าตั้งของ อปท.) ───────────────────────────────────────────────────────

/** รับค่าอะไรก็ได้ → จำนวนเต็ม 0–180 ไม่ซ้ำ เรียงมาก→น้อย สูงสุด 6 ค่า */
export function normalizeRemindDays(values) {
  if (!Array.isArray(values)) return []
  const set = new Set()
  for (const v of values) {
    const n = Number(v)
    if (Number.isInteger(n) && n >= 0 && n <= REMIND_DAY_MAX) set.add(n)
  }
  return [...set].sort((a, b) => b - a).slice(0, REMIND_DAYS_MAX_COUNT)
}

export function validateRemindDays(values) {
  if (!Array.isArray(values) || values.length === 0) return 'ตั้งวันเตือนอย่างน้อย 1 ค่า'
  if (values.length > REMIND_DAYS_MAX_COUNT) return `ตั้งวันเตือนได้สูงสุด ${REMIND_DAYS_MAX_COUNT} ค่า`
  if (values.some((v) => !Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > REMIND_DAY_MAX)) return `วันเตือนต้องเป็นจำนวนเต็ม 0–${REMIND_DAY_MAX}`
  if (new Set(values.map(Number)).size !== values.length) return 'วันเตือนซ้ำกัน'
  return ''
}

// ── ลิงก์ภายนอก (Biz Portal ฯลฯ) ─────────────────────────────────────────────────────

/** https เท่านั้น ไม่มีช่องว่าง/อักขระอันตราย ยาวไม่เกิน 500 — ตรงกับ CHECK ของ licence_types.external_url */
export function isSafeExternalUrl(value) {
  const s = String(value ?? '').trim()
  if (!s || s.length > 500 || !/^https:\/\/[^\s<>"]+$/.test(s)) return false
  try { return new URL(s).protocol === 'https:' } catch { return false }
}

// ── ฟอร์มประเภท / ฟอร์มใบ ────────────────────────────────────────────────────────────

export function validateTypeForm(f) {
  if (!categoryOf(f.category)) return 'เลือกหมวด'
  const name = String(f.name ?? '').trim()
  if (name.length < 2 || name.length > 200) return 'ชื่อประเภท 2–200 ตัวอักษร'
  if (f.category === 'other') {
    const m = Number(f.validity_months)
    if (!Number.isInteger(m) || m < 1 || m > 60) return 'อายุใบ (เดือน) ต้องเป็นจำนวนเต็ม 1–60'
  }
  if (f.renewal_window_days !== '' && f.renewal_window_days != null) {
    const w = Number(f.renewal_window_days)
    if (!Number.isInteger(w) || w < 1 || w > 365) return 'ช่วงต่ออายุล่วงหน้าต้องเป็น 1–365 วัน (เว้นว่าง = ไม่จำกัด)'
  }
  if (f.default_fee !== '' && f.default_fee != null && !(Number(f.default_fee) >= 0)) return 'ค่าธรรมเนียมต้องไม่ติดลบ'
  if (String(f.ordinance_ref ?? '').length > 300) return 'ข้อกำหนดของท้องถิ่นยาวเกิน 300 ตัวอักษร'
  if (String(f.legal_basis ?? '').length > 200) return 'ฐานกฎหมายยาวเกิน 200 ตัวอักษร'
  const url = String(f.external_url ?? '').trim()
  if (url && !isSafeExternalUrl(url)) return 'ลิงก์ระบบอื่นต้องขึ้นต้นด้วย https:// และไม่เกิน 500 ตัวอักษร'
  if (String(f.external_label ?? '').length > 100) return 'ชื่อปุ่มลิงก์ยาวเกิน 100 ตัวอักษร'
  return ''
}

export function validateLicenceForm(f, type) {
  if (!f.licence_type_id || !type) return 'เลือกประเภทใบอนุญาต'
  if (!String(f.business_name ?? '').trim()) return 'ระบุชื่อสถานประกอบการ'
  if (!String(f.holder_name ?? '').trim()) return 'ระบุชื่อผู้ประกอบการ/ผู้รับใบอนุญาต'
  if (f.holder_phone && !/^[0-9+\- ]{6,20}$/.test(String(f.holder_phone).trim())) return 'เบอร์โทรใช้ตัวเลข + - เว้นวรรค (6–20 ตัว)'
  for (const k of ['issued_on', 'expires_on', 'next_fee_due_on']) {
    if (f[k] && !isIsoDate(f[k])) return 'วันที่ไม่ถูกต้อง'
  }
  if (type.doc_kind === 'licence') {
    if (!f.expires_on) return 'ใบอนุญาตต้องมีวันหมดอายุ'
    if (f.issued_on && f.expires_on <= f.issued_on) return 'วันหมดอายุต้องหลังวันที่ออกใบ'
  }
  for (const k of ['area_sqm', 'fee_amount']) {
    if (f[k] !== '' && f[k] != null && !(Number(f[k]) >= 0)) return 'พื้นที่/ค่าธรรมเนียมต้องไม่ติดลบ'
  }
  return ''
}

/** วันหมดอายุที่เสนอตอนกรอกวันออกใบ (ออกใบ + อายุใบ − 1 วัน) — เจ้าหน้าที่แก้ได้ ไม่บังคับ */
export function suggestExpiry(issuedOn, type) {
  if (!isIsoDate(issuedOn) || type?.doc_kind !== 'licence') return null
  const to = addMonths(issuedOn, type.validity_months ?? 12)
  return to ? addDays(to, -1) : null
}

// ── นำเข้า Excel/CSV ─────────────────────────────────────────────────────────────────

export const IMPORT_BATCH_SIZE = 200
export const IMPORT_MAX_ROWS = 2000

const HEADER_ALIASES = {
  type_name: ['ประเภท', 'ประเภทใบอนุญาต', 'ชื่อประเภท', 'type'],
  licence_no: ['เลขที่ใบอนุญาต', 'เลขที่', 'เลขใบอนุญาต', 'licenceno', 'licenseno'],
  business_name: ['ชื่อสถานประกอบการ', 'ชื่อร้าน', 'ชื่อกิจการ', 'สถานประกอบการ', 'businessname'],
  sub_type: ['ประเภทย่อย', 'ลำดับ/ประเภทย่อย', 'กิจการ', 'subtype'],
  holder_name: ['ชื่อผู้ประกอบการ', 'ผู้ประกอบการ', 'ผู้รับใบอนุญาต', 'ชื่อผู้รับใบอนุญาต', 'holdername'],
  holder_phone: ['เบอร์โทร', 'โทรศัพท์', 'เบอร์โทรศัพท์', 'โทร', 'phone'],
  address: ['ที่อยู่', 'ที่ตั้ง', 'address'],
  village: ['หมู่บ้าน', 'หมู่ที่', 'หมู่', 'village'],
  area_sqm: ['พื้นที่', 'พื้นที่ตร.ม.', 'พื้นที่ตารางเมตร', 'พื้นที่ตรม', 'areasqm'],
  fee_amount: ['ค่าธรรมเนียม', 'ค่าธรรมเนียมต่อปี', 'ค่าธรรมเนียมรายปี', 'feeamount'],
  issued_on: ['วันที่ออกใบ', 'วันออกใบ', 'วันที่ออก', 'issuedon'],
  expires_on: ['วันหมดอายุ', 'หมดอายุ', 'วันสิ้นอายุ', 'expireson'],
  next_fee_due_on: ['วันครบกำหนดชำระ', 'ครบกำหนดชำระ', 'วันครบกำหนดค่าธรรมเนียม', 'nextfeedueon'],
  note: ['หมายเหตุ', 'note'],
}

export const IMPORT_TEMPLATE_HEADERS = Object.freeze([
  'ประเภท', 'เลขที่ใบอนุญาต', 'ชื่อสถานประกอบการ', 'ประเภทย่อย', 'ชื่อผู้ประกอบการ', 'เบอร์โทร', 'ที่อยู่', 'หมู่บ้าน',
  'พื้นที่ (ตร.ม.)', 'ค่าธรรมเนียม', 'วันที่ออกใบ', 'วันหมดอายุ', 'วันครบกำหนดชำระ', 'หมายเหตุ',
])


/** แมปหัวคอลัมน์ภาษาไทย → คีย์ช่อง · คืน { index: { key: columnIndex|-1 } } */
export function mapImportHeaders(headers) {
  const normalized = (headers ?? []).map(normalizeHeader)
  const index = {}
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const set = aliases.map(normalizeHeader)
    index[key] = normalized.findIndex((h) => set.includes(h))
  }
  return index
}

/**
 * แปลงวันที่จากไฟล์: ISO · วว/ดด/ปปปป (ปี พ.ศ. หรือ ค.ศ. — ปี > 2400 ถือเป็น พ.ศ.) · เลขลำดับวันของ Excel (1900 date system)
 * @returns {string|null|undefined} ISO · null = ช่องว่าง · undefined = อ่านไม่ได้
 */
export function parseImportDate(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y] = s.split('-').map(Number)
    const iso = y > 2400 ? `${y - 543}${s.slice(4)}` : s
    return isIsoDate(iso) ? iso : undefined
  }
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m) {
    let y = Number(m[3])
    if (y > 2400) y -= 543
    const iso = `${String(y).padStart(4, '0')}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    return isIsoDate(iso) ? iso : undefined
  }
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s))
    if (serial < 20000 || serial > 80000) return undefined
    const iso = fromUtc(Date.UTC(1899, 11, 30) + serial * 86400000)
    return isIsoDate(iso) ? iso : undefined
  }
  return undefined
}

function parseNumberCell(raw) {
  const s = String(raw ?? '').replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * ตรวจแถวนำเข้าก่อนบันทึก (พรีวิว) — แถวผิดไม่ถูกนำเข้า ผู้ใช้เห็นเหตุผลรายแถว
 * @param {unknown[][]} matrix แถวแรกคือหัวคอลัมน์
 * @param {{ types: Array<{id:string,name:string,doc_kind:string}>, existing?: Array<{licence_type_id:string,licence_no:string|null}>, municipalityId?: string }} ctx
 * @returns {{ rows: Array<{ line:number, status:'ready'|'invalid', errors:string[], payload:object|null, label:string }>, missingHeaders: string[] }}
 */
export function buildImportPreview(matrix, { types, existing = [] }) {
  const [headers = [], ...body] = matrix ?? []
  const idx = mapImportHeaders(headers)
  const required = [['type_name', 'ประเภท'], ['business_name', 'ชื่อสถานประกอบการ'], ['holder_name', 'ชื่อผู้ประกอบการ']]
  const missingHeaders = required.filter(([k]) => idx[k] < 0).map(([, label]) => label)
  if (missingHeaders.length) return { rows: [], missingHeaders }

  const typeByName = new Map((types ?? []).map((t) => [normalizeHeader(t.name), t]))
  const seen = new Set((existing ?? []).filter((e) => e.licence_no).map((e) => `${e.licence_type_id}|${String(e.licence_no).trim()}`))
  const cell = (row, key) => (idx[key] >= 0 ? String(row[idx[key]] ?? '').trim() : '')

  const rows = body.slice(0, IMPORT_MAX_ROWS).map((row, i) => {
    const errors = []
    const type = typeByName.get(normalizeHeader(cell(row, 'type_name')))
    if (!type) errors.push(`ไม่พบประเภท "${cell(row, 'type_name') || '(ว่าง)'}" ในหน้าประเภทใบอนุญาต`)
    const business = cell(row, 'business_name')
    const holder = cell(row, 'holder_name')
    if (!business) errors.push('ไม่มีชื่อสถานประกอบการ')
    if (!holder) errors.push('ไม่มีชื่อผู้ประกอบการ')
    const phone = cell(row, 'holder_phone')
    if (phone && !/^[0-9+\- ]{6,20}$/.test(phone)) errors.push('เบอร์โทรไม่ถูกต้อง')
    const dates = {}
    for (const k of ['issued_on', 'expires_on', 'next_fee_due_on']) {
      const d = parseImportDate(idx[k] >= 0 ? row[idx[k]] : '')
      if (d === undefined) errors.push(`วันที่ในช่อง "${k === 'issued_on' ? 'วันที่ออกใบ' : k === 'expires_on' ? 'วันหมดอายุ' : 'วันครบกำหนดชำระ'}" อ่านไม่ได้`)
      dates[k] = d ?? null
    }
    const area = parseNumberCell(idx.area_sqm >= 0 ? row[idx.area_sqm] : '')
    const fee = parseNumberCell(idx.fee_amount >= 0 ? row[idx.fee_amount] : '')
    if (area === undefined) errors.push('พื้นที่ต้องเป็นตัวเลขไม่ติดลบ')
    if (fee === undefined) errors.push('ค่าธรรมเนียมต้องเป็นตัวเลขไม่ติดลบ')
    if (type?.doc_kind === 'licence') {
      if (!dates.expires_on) errors.push('ใบอนุญาตต้องมีวันหมดอายุ')
      if (dates.issued_on && dates.expires_on && dates.expires_on <= dates.issued_on) errors.push('วันหมดอายุต้องหลังวันที่ออกใบ')
    } else if (type?.doc_kind === 'notice_certificate') {
      if (dates.expires_on) errors.push('หนังสือรับรองการแจ้งไม่มีวันหมดอายุ (ใช้วันครบกำหนดชำระแทน)')
      if (!dates.next_fee_due_on) errors.push('หนังสือรับรองการแจ้งต้องมีวันครบกำหนดชำระ')
    }
    const no = cell(row, 'licence_no') || null
    if (type && no) {
      const key = `${type.id}|${no}`
      if (seen.has(key)) errors.push(`เลขที่ใบอนุญาต ${no} ซ้ำ (ในทะเบียนแล้ว หรือซ้ำในไฟล์)`)
      else seen.add(key)
    }
    const ok = errors.length === 0
    return {
      line: i + 2,
      status: ok ? 'ready' : 'invalid',
      errors,
      label: business || '(ไม่มีชื่อ)',
      payload: ok ? {
        licence_type_id: type.id,
        licence_no: no,
        business_name: business,
        sub_type: cell(row, 'sub_type') || null,
        holder_name: holder,
        holder_phone: phone || null,
        address: cell(row, 'address') || null,
        village: cell(row, 'village') || null,
        area_sqm: area,
        fee_amount: fee,
        issued_on: dates.issued_on,
        expires_on: type.doc_kind === 'licence' ? dates.expires_on : null,
        next_fee_due_on: type.doc_kind === 'notice_certificate' ? dates.next_fee_due_on : null,
        note: cell(row, 'note') || null,
      } : null,
    }
  })
  return { rows, missingHeaders: [] }
}

/** แบ่งก้อนละ size แถว */
export function chunk(list, size = IMPORT_BATCH_SIZE) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// ── ค้นหา/กรอง/เรียง ─────────────────────────────────────────────────────────────────

/** ข้อความค้นหารวมช่องที่เจ้าหน้าที่ใช้หาใบ */
export function searchText(licence, type) {
  return [licence.business_name, licence.holder_name, licence.licence_no, licence.village, licence.address, licence.holder_phone, type?.name]
    .filter(Boolean).join(' ').toLocaleLowerCase('th-TH')
}

/** เรียงแท็บ "ต้องดำเนินการ": วันคงเหลือน้อยสุด (เลยมานานสุด) ก่อน */
export function sortByUrgency(items) {
  return [...items].sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
}

// ── ประวัติ (licence_events) ─────────────────────────────────────────────────────────

export const EVENT_ACTION_LABEL = Object.freeze({
  insert: 'เพิ่มใบเข้าทะเบียน', update: 'แก้ไขข้อมูล', delete: 'ลบ', status: 'บันทึกคำสั่ง/เปลี่ยนสถานะ',
  renew: 'บันทึกรับค่าธรรมเนียมต่ออายุ', fee: 'บันทึกรับค่าธรรมเนียมรายปี', void: 'ยกเลิกรายการรับเงิน',
})

const FIELD_LABEL = Object.freeze({
  licence_type_id: 'ประเภท', licence_no: 'เลขที่ใบอนุญาต', business_name: 'ชื่อสถานประกอบการ', sub_type: 'ประเภทย่อย',
  holder_name: 'ชื่อผู้ประกอบการ', holder_phone: 'เบอร์โทร', address: 'ที่อยู่', village: 'หมู่บ้าน', area_sqm: 'พื้นที่ (ตร.ม.)',
  fee_amount: 'ค่าธรรมเนียม', issued_on: 'วันที่ออกใบ', expires_on: 'วันหมดอายุ', next_fee_due_on: 'วันครบกำหนดชำระ',
  status: 'สถานะ', status_from: 'ตั้งแต่', status_until: 'ถึง', status_order_ref: 'เลขที่คำสั่ง', status_reason: 'เหตุผล', note: 'หมายเหตุ',
  receipt_no: 'เลขใบเสร็จ', amount: 'จำนวนเงิน', kind: 'ชนิด',
})

/**
 * แปลง changes ของ licence_events เป็นบรรทัดอ่านง่าย — update = [เดิม, ใหม่] · ชนิดอื่น = ค่าที่บันทึก
 * formatValue(key, value) ให้หน้าจอแปลงวันที่เป็น พ.ศ./ชื่อประเภท (ไม่ส่ง = แสดงค่าดิบ)
 */
export function describeEventChanges(action, changes, formatValue = (_k, v) => v) {
  const out = []
  if (!changes || typeof changes !== 'object') return out
  const show = (k, v) => {
    if (k === 'status') return STATUS_LABEL[v] ?? v
    if (k === 'kind') return v === 'renewal' ? 'ต่ออายุ' : v === 'annual' ? 'รายปี' : v
    const f = formatValue(k, v)
    return f === null || f === undefined || f === '' ? '—' : String(f)
  }
  for (const [k, v] of Object.entries(changes)) {
    const label = FIELD_LABEL[k] ?? k
    // เบอร์โทร/ที่อยู่ ฐานข้อมูลไม่เก็บค่าในประวัติ (PDPA) เก็บแค่ว่ามีการแก้ ('changed')
    if (v === 'changed') { out.push(`${label}: มีการแก้ไข (ไม่บันทึกค่าลงประวัติ)`); continue }
    if (action === 'update' || action === 'status' || action === 'renew' || action === 'fee' || action === 'void') {
      if (Array.isArray(v) && v.length === 2) { out.push(`${label}: ${show(k, v[0])} → ${show(k, v[1])}`); continue }
    }
    out.push(`${label}: ${show(k, v)}`)
  }
  return out
}

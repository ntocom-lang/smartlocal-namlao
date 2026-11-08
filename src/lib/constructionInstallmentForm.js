// ฟอร์มงวดงาน / ขยายเวลา-แก้สัญญา / ตรวจความชำรุด / เอกสารแนบ ของวงจรโครงการก่อสร้าง (PR-C2) — คำนวณล้วน ไม่ต่อฐานข้อมูล ไม่ import supabase/React
// แปลงค่าจากฟอร์ม → "patch" ที่ส่งเฉพาะช่องที่เปลี่ยน (ค่าว่าง = null) · ตรวจค่าก่อนส่งตาม CHECK ของ migration 20261108100100
//
// ⚠️ รายชื่อ "ช่องผู้จัดการเท่านั้น" / "ช่องที่ล็อกเมื่อมีผลแล้ว" ต้องตรงกับอาร์กิวเมนต์ของ trigger civil_manage_columns_guard
//    ใน 20261108100200 ทุกตัว (tests/construction-installments.test.mjs อ่านไฟล์ migration มาเทียบ) — ตัวตัดสินจริงคือฐานข้อมูล
//    ตรงนี้ตัดช่องทิ้งก่อนส่งเพื่อให้คนที่ไม่มีสิทธิ์ไม่เจอ error 42501 จากช่องที่ตัวเองไม่ได้แก้
// ⚠️ ระบบไม่ตัดสินแทนคน: ผลตรวจรับ ผลพิจารณาขยายเวลา/แก้สัญญา = ข้อเท็จจริงตามหนังสือที่ผู้มีอำนาจลงนามแล้ว ฟังก์ชัน suggested* เป็นแค่ "ค่าที่ระบบเสนอ" คนแก้ได้
import { addDays, bangkokIsoDate, thaiShortDate } from './complaintReportPeriods.js'
import { isIsoDate } from './constructionReport.js'
import { CHANGE_KINDS, DEFECT_KINDS, DEFECT_RESULTS, INSPECTION_RESULTS, STAGES } from './constructionLifecycle.js'
import { DRIVE_MODULES, driveFolderPath } from './driveFolders.js'

export const MANAGER_ONLY_NOTE = 'บันทึกได้เฉพาะหัวหน้ากองหรือผู้ดูแลระบบ'

// ── สเปกช่อง ───────────────────────────────────────────────────────────────────
// type: text (≤200) · longtext (≤4000) · date · money (≥0, 2 ตำแหน่ง) · pct (0–100, 3 ตำแหน่ง) · int (≥0) · bool · select (options)

export const INSTALLMENT_GROUPS = [
  {
    key: 'delivery', title: 'ส่งมอบงาน', fields: [
      { key: 'installment_no', label: 'งวดที่', type: 'int', readOnly: true },
      { key: 'work_pct', label: 'สัดส่วนงานของงวด (ร้อยละ)', type: 'pct' },
      { key: 'amount', label: 'เงินงวดตามสัญญา (บาท)', type: 'money' },
      { key: 'description', label: 'รายละเอียดงานของงวด', type: 'longtext' },
      { key: 'due_on', label: 'กำหนดส่งมอบตามสัญญา', type: 'date', hint: 'ระบบนับรายงานผู้ควบคุมงานใน 3 วันทำการจากวันนี้ (ข้อ 178(4))' },
      { key: 'due_report_on', label: 'ผู้ควบคุมงานรายงาน ณ วันครบกำหนด — วันที่', type: 'date' },
      { key: 'due_report_ref', label: 'ผู้ควบคุมงานรายงาน ณ วันครบกำหนด — เลขที่', type: 'text' },
      { key: 'delivered_on', label: 'วันที่ผู้รับจ้างส่งมอบงาน', type: 'date' },
      { key: 'delivery_ref_no', label: 'เลขรับหนังสือส่งมอบ', type: 'text' },
      { key: 'chair_acknowledged_on', label: 'วันที่ประธานกรรมการตรวจรับทราบการส่งมอบ', type: 'date', hint: 'ระบบนับ 3 วันทำการตรวจรับจากวันนี้ (ข้อ 176(5))' },
    ],
  },
  {
    key: 'inspection', title: 'ตรวจรับงาน', fields: [
      { key: 'inspected_on', label: 'วันที่ตรวจรับ', type: 'date' },
      { key: 'inspection_result', label: 'ผลการตรวจรับ (ตามใบที่คณะกรรมการลงนามแล้ว)', type: 'select', options: INSPECTION_RESULTS },
      { key: 'inspection_reason', label: 'เหตุผล (กรณีไม่ตรวจรับ หรือมีข้อสังเกต)', type: 'longtext' },
      { key: 'inspection_dissent', label: 'ความเห็นแย้งของกรรมการ (ถ้ามี)', type: 'longtext' },
      { key: 'egp_inspection_no', label: 'เลขคุมใบตรวจรับใน e-GP', type: 'text' },
    ],
  },
  {
    key: 'fine', title: 'ค่าปรับ', fields: [
      { key: 'fine_notice_no', label: 'หนังสือแจ้งสิทธิเรียกค่าปรับ — เลขที่', type: 'text' },
      { key: 'fine_notice_date', label: 'หนังสือแจ้งสิทธิเรียกค่าปรับ — ลงวันที่', type: 'date', hint: 'ระบบนับ 7 วันทำการจากวันครบกำหนด (ข้อ 181)' },
      { key: 'fine_reserved', label: 'บอกสงวนสิทธิ์เรียกค่าปรับขณะรับมอบงานแล้ว', type: 'bool' },
    ],
  },
  {
    key: 'payment', title: 'เบิกจ่าย (คัดจากฎีกา e-LAAS)', fields: [
      { key: 'voucher_no', label: 'เลขที่ฎีกา', type: 'text' },
      { key: 'paid_on', label: 'วันที่จ่าย', type: 'date' },
      { key: 'paid_gross', label: 'ยอดเบิก (บาท)', type: 'money' },
      { key: 'deduct_advance', label: 'หักคืนเงินล่วงหน้า', type: 'money' },
      { key: 'deduct_retention', label: 'หักเงินประกันผลงาน', type: 'money' },
      { key: 'deduct_fine', label: 'หักค่าปรับ', type: 'money' },
      { key: 'deduct_other', label: 'หักอื่น ๆ', type: 'money' },
      { key: 'paid_net', label: 'ยอดสุทธิที่จ่าย (บาท)', type: 'money' },
      { key: 'note', label: 'หมายเหตุ', type: 'longtext' },
    ],
  },
]
export const INSTALLMENT_FIELDS = INSTALLMENT_GROUPS.flatMap(g => g.fields)

/** ช่องผลตรวจรับ — ผู้จัดการโครงการเท่านั้น (= ชุดก่อน '--' ของ civil_installments_manage_guard_trigger) */
export const INSTALLMENT_MANAGER_COLUMNS = ['inspection_result', 'inspection_reason', 'inspection_dissent', 'egp_inspection_no']
/** ช่องที่ล็อกเมื่อมี inspection_result แล้ว — คนที่ไม่ใช่ผู้จัดการแก้ไม่ได้ (= ชุดหลัง '--') */
export const INSTALLMENT_LOCKED_COLUMNS = [
  'installment_no', 'amount', 'work_pct', 'due_on', 'delivered_on', 'delivery_ref_no', 'chair_acknowledged_on', 'inspected_on', 'fine_reserved',
]

export const CHANGE_DECISIONS = { approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ' }
export const CHANGE_FIELDS = [
  { key: 'kind', label: 'ชนิดรายการ', type: 'select', options: CHANGE_KINDS },
  { key: 'cause', label: 'เหตุที่ขอ (ตามหนังสือผู้รับจ้าง)', type: 'longtext' },
  { key: 'cause_ended_on', label: 'วันที่เหตุสิ้นสุด', type: 'date', hint: 'ระบบนับ 15 วันที่ผู้รับจ้างต้องแจ้ง (ข้อ 182)' },
  { key: 'request_received_on', label: 'วันที่รับหนังสือขอของผู้รับจ้าง', type: 'date' },
  { key: 'requested_days', label: 'จำนวนวันที่ขอขยาย', type: 'int' },
  { key: 'ref_no', label: 'เลขที่หนังสือ', type: 'text' },
  { key: 'ref_date', label: 'หนังสือลงวันที่', type: 'date' },
  { key: 'decision', label: 'ผลพิจารณา', type: 'select', options: CHANGE_DECISIONS },
  { key: 'approved_on', label: 'วันที่พิจารณา (ลงนามผลพิจารณา)', type: 'date' },
  { key: 'approved_days', label: 'จำนวนวันที่อนุมัติ', type: 'int' },
  { key: 'new_end_date', label: 'วันสิ้นสุดสัญญาใหม่', type: 'date' },
  { key: 'amount_change', label: 'วงเงินที่เปลี่ยน (บาท · ลดให้ใส่ติดลบ)', type: 'money', signed: true },
  { key: 'egp_published_on', label: 'วันที่เผยแพร่การแก้ไขสัญญาใน e-GP (ม.98)', type: 'date' },
  { key: 'note', label: 'หมายเหตุ', type: 'longtext' },
]
/** ผลการพิจารณา — ผู้จัดการโครงการเท่านั้น (= ชุดก่อน '--' ของ civil_changes_manage_guard_trigger) */
export const CHANGE_MANAGER_COLUMNS = ['decision', 'approved_on', 'approved_days', 'new_end_date', 'amount_change']
/** ล็อกเมื่อมี decision แล้ว (= ชุดหลัง '--') */
export const CHANGE_LOCKED_COLUMNS = ['kind', 'cause', 'cause_ended_on', 'request_received_on', 'requested_days', 'ref_no', 'ref_date']
/** ช่องเฉพาะชนิด — ชนิดอื่นไม่แสดง/ไม่เก็บ (ล้างเป็น null ตอนบันทึก) */
export const CHANGE_KIND_FIELDS = {
  extend_time: ['requested_days', 'approved_days', 'new_end_date'],
  amend_contract: ['amount_change', 'egp_published_on'],
}
const KIND_SPECIFIC = [...new Set(Object.values(CHANGE_KIND_FIELDS).flat())]
export const changeFieldApplies = (kind, key) => !KIND_SPECIFIC.includes(key) || (CHANGE_KIND_FIELDS[kind] ?? []).includes(key)

export const DEFECT_FIELDS = [
  { key: 'inspected_on', label: 'วันที่ตรวจ', type: 'date' },
  { key: 'kind', label: 'ชนิดการตรวจ', type: 'select', options: DEFECT_KINDS },
  { key: 'result', label: 'ผลการตรวจ', type: 'select', options: DEFECT_RESULTS },
  { key: 'detail', label: 'รายละเอียดที่ตรวจพบ', type: 'longtext' },
  { key: 'notice_no', label: 'หนังสือแจ้งผู้รับจ้างให้แก้ไข — เลขที่', type: 'text' },
  { key: 'notice_date', label: 'หนังสือแจ้งผู้รับจ้างให้แก้ไข — ลงวันที่', type: 'date' },
  { key: 'guarantor_notified_on', label: 'วันที่แจ้งผู้ค้ำประกัน', type: 'date' },
  { key: 'fix_due_on', label: 'กำหนดเข้าแก้ไขตามหนังสือแจ้ง', type: 'date' },
  { key: 'fixed_on', label: 'วันที่ผู้รับจ้างแก้ไขแล้วเสร็จ', type: 'date' },
  { key: 'note', label: 'หมายเหตุ', type: 'longtext' },
]
/** ช่องที่ใช้เมื่อ "พบความชำรุดบกพร่อง" เท่านั้น */
export const DEFECT_ONLY_FIELDS = ['notice_no', 'notice_date', 'guarantor_notified_on', 'fix_due_on', 'fixed_on']

// ── ตรวจ/แปลงค่า ──────────────────────────────────────────────────────────────

const MONEY_MAX = 9999999999999.99   // numeric(15,2)
const INT_MAX = 36500                // วัน (ฐานข้อมูลเป็น integer — เพดานนี้กันค่าพิมพ์ผิดหลายหลัก)
const SHORT_MAX = 200
const LONG_MAX = 4000
const blank = v => v === null || v === undefined || String(v).trim() === ''
const round = (n, digits) => { const f = 10 ** digits; return Math.round(n * f) / f }
const NUMBER = /^-?\d+(\.\d+)?$/

/** ค่าจากฟอร์ม 1 ช่อง → { value } | { error } (ค่าว่าง = null) */
function normalize(spec, raw) {
  const { label, type } = spec
  if (type === 'bool') return { value: Boolean(raw) }
  if (blank(raw)) return { value: null }
  const s = String(raw).trim()
  switch (type) {
    case 'text':
    case 'longtext': {
      const max = type === 'text' ? SHORT_MAX : LONG_MAX
      return s.length > max ? { error: `${label}ยาวเกิน ${max.toLocaleString('th-TH')} ตัวอักษร` } : { value: s }
    }
    case 'date': return isIsoDate(s) ? { value: s } : { error: `${label}ไม่ใช่วันที่ที่ถูกต้อง` }
    case 'select': return Object.keys(spec.options).includes(s) ? { value: s } : { error: `${label}ไม่ถูกต้อง` }
    case 'money':
    case 'pct':
    case 'int': {
      const text = s.replace(/[,\s]/g, '')
      if (!NUMBER.test(text)) return { error: `${label}ต้องเป็นตัวเลข` }
      const n = Number(text)
      if (type === 'int') {
        if (!Number.isInteger(n)) return { error: `${label}ต้องเป็นจำนวนเต็ม` }
        if (n < 0) return { error: `${label}ต้องไม่ติดลบ` }
        if (n > INT_MAX) return { error: `${label}ต้องไม่เกิน ${INT_MAX.toLocaleString('th-TH')}` }
        return { value: n }
      }
      if (type === 'pct') {
        if (n < 0 || n > 100) return { error: `${label}ต้องอยู่ระหว่าง 0–100` }
        return { value: round(n, 3) }
      }
      if (n < 0 && !spec.signed) return { error: `${label}ต้องไม่ติดลบ` }
      if (Math.abs(n) > MONEY_MAX) return { error: `${label}เกินช่วงที่ฐานข้อมูลรับ` }
      return { value: round(n, 2) }
    }
    default: return { error: `${label}ไม่รู้จักชนิดช่อง` }
  }
}

/** ค่าที่อ่านจากฐานข้อมูลให้อยู่รูปเดียวกับ normalize (เทียบแบบไม่สนรูปตัวเลข/วันที่) */
function fromRow(spec, raw) {
  if (spec.type === 'bool') return Boolean(raw)
  if (blank(raw)) return null
  if (spec.type === 'money' || spec.type === 'pct' || spec.type === 'int') { const n = Number(raw); return Number.isFinite(n) ? n : null }
  if (spec.type === 'date') return String(raw).slice(0, 10)
  return String(raw).trim()
}

/**
 * แกนกลางของ installmentPatch/changePatch/defectPatch
 *   blocked = ช่องที่ผู้ใช้คนนี้แก้ไม่ได้ (ใช้ค่าเดิมจากแถว) · refine(next, blocked) → ล้างช่องที่ใช้ไม่ได้ + ตรวจข้ามช่อง · คืนข้อความผิดพลาด
 */
function buildPatch(specs, values, original, { blocked, refine }) {
  const next = {}
  for (const spec of specs) {
    if (blocked.has(spec.key)) { next[spec.key] = fromRow(spec, original?.[spec.key]); continue }
    const raw = values && spec.key in values ? values[spec.key] : original?.[spec.key]
    const result = normalize(spec, raw)
    if (result.error) return { error: result.error }
    next[spec.key] = result.value
  }
  const problem = refine?.(next, blocked)
  if (problem) return { error: problem }
  const patch = {}
  for (const spec of specs) {
    if (blocked.has(spec.key)) continue
    if (next[spec.key] !== fromRow(spec, original?.[spec.key])) patch[spec.key] = next[spec.key]
  }
  return Object.keys(patch).length ? { patch } : { error: 'ไม่มีอะไรเปลี่ยน' }
}

/**
 * งวดงาน: ค่าในฟอร์ม → patch เฉพาะช่องที่ต่างจากแถวเดิม (original = null เมื่อเป็นงวดใหม่)
 *   ไม่ใช่ผู้จัดการ: ตัดช่องผลตรวจรับทิ้ง · ถ้าแถวเดิมมีผลตรวจรับแล้ว ตัดช่องที่ล็อกทิ้งด้วย
 *   installment_no ไม่เข้า patch เสมอ (ใช้ตอน INSERT ที่ชั้น API)
 */
export function installmentPatch(values, original, { manage = false } = {}) {
  const blocked = new Set(['installment_no'])
  if (!manage) {
    INSTALLMENT_MANAGER_COLUMNS.forEach(k => blocked.add(k))
    if (!blank(original?.inspection_result)) INSTALLMENT_LOCKED_COLUMNS.forEach(k => blocked.add(k))
  }
  return buildPatch(INSTALLMENT_FIELDS, values, original, {
    blocked,
    refine: next => (next.inspection_result && !next.inspected_on ? 'ต้องกรอกวันที่ตรวจรับก่อนบันทึกผลตรวจรับ' : null),
  })
}

/** ขยายเวลา / งดลดค่าปรับ / แก้สัญญา — ช่องเฉพาะชนิดที่ชนิดปัจจุบันไม่ใช้ ถูกล้างเป็น null */
export function changePatch(values, original, { manage = false } = {}) {
  const blocked = new Set()
  if (!manage) {
    CHANGE_MANAGER_COLUMNS.forEach(k => blocked.add(k))
    if (!blank(original?.decision)) CHANGE_LOCKED_COLUMNS.forEach(k => blocked.add(k))
  }
  return buildPatch(CHANGE_FIELDS, values, original, {
    blocked,
    refine: next => {
      if (!next.kind) return 'เลือกชนิดรายการ (ขยายเวลา / งดค่าปรับ / ลดค่าปรับ / แก้ไขสัญญา)'
      for (const key of KIND_SPECIFIC) {
        if (!blocked.has(key) && !changeFieldApplies(next.kind, key)) next[key] = null
      }
      const decided = ['approved_on', 'approved_days', 'new_end_date', 'amount_change'].some(k => next[k] !== null)
      if (decided && !next.decision) return 'เลือกผลพิจารณา (อนุมัติ / ไม่อนุมัติ) ก่อนบันทึกวันที่หรือจำนวนที่พิจารณา'
      if (next.decision && !next.approved_on) return 'ผลพิจารณาต้องมีวันที่พิจารณา (วันที่ลงนามผลพิจารณา)'
      if (next.decision === 'approved' && next.kind === 'extend_time' && !next.new_end_date) {
        return 'อนุมัติขยายเวลาต้องระบุวันสิ้นสุดสัญญาใหม่ — ใช้ปุ่ม "ใช้ค่าที่ระบบคำนวณ" หรือกรอกตามหนังสือ'
      }
      return null
    },
  })
}

/** ผลตรวจความชำรุดบกพร่อง — ช่องวันที่แก้ไข/หนังสือแจ้งใช้เมื่อ "พบความชำรุด" เท่านั้น (ผลปกติล้างเป็น null) */
export function defectPatch(values, original) {
  return buildPatch(DEFECT_FIELDS, values, original, {
    blocked: new Set(),
    refine: next => {
      if (!next.inspected_on) return 'กรอกวันที่ตรวจ'
      if (!next.kind) return 'เลือกชนิดการตรวจ'
      if (!next.result) return 'เลือกผลการตรวจ'
      if (next.result !== 'defect') for (const key of DEFECT_ONLY_FIELDS) next[key] = null
      return null
    },
  })
}

// ── ค่าตั้งต้นของฟอร์ม (ค่าว่าง = '') ─────────────────────────────────────────────

const draftOf = (specs, row) => Object.fromEntries(specs.map(s => [s.key, s.type === 'bool' ? Boolean(row?.[s.key]) : (row?.[s.key] ?? '')]))
export const installmentDraft = (row, installmentNo) => ({ ...draftOf(INSTALLMENT_FIELDS, row), installment_no: row?.installment_no ?? installmentNo ?? '' })
export const changeDraft = row => draftOf(CHANGE_FIELDS, row)
export const defectDraft = row => draftOf(DEFECT_FIELDS, row)

// ── แถวงวด ───────────────────────────────────────────────────────────────────

const MAX_SLOTS = 200   // กันค่า installments_total ผิดปกติทำหน้าจอค้าง

/**
 * แถวงวด 1..max(จำนวนงวดในสัญญา, เลขงวดสูงสุดที่บันทึก) — ระบบขึ้นแถวที่ยังไม่บันทึกให้เอง (saved:false)
 * ไม่มีจำนวนงวดและไม่มีแถวเลย = [] (หน้าจอมีปุ่ม "เพิ่มงวด")
 */
export function installmentSlots(bundle) {
  const rows = (bundle?.installments ?? []).filter(r => Number.isInteger(Number(r?.installment_no)) && Number(r.installment_no) >= 1)
  const byNo = new Map(rows.map(r => [Number(r.installment_no), r]))
  const totalRaw = Number(bundle?.contract?.installments_total)
  const total = Number.isInteger(totalRaw) && totalRaw > 0 ? totalRaw : 0
  const max = Math.min(MAX_SLOTS, Math.max(total, ...byNo.keys(), 0))
  const out = []
  for (let no = 1; no <= max; no++) out.push(byNo.has(no) ? { ...byNo.get(no), installment_no: no, saved: true } : { installment_no: no, saved: false })
  return out
}

// ── ค่าที่ระบบเสนอ (คนแก้ได้ ไม่เขียนทับค่าที่กรอกแล้ว) ──────────────────────────────

const numOrNull = v => { if (blank(v)) return null; const n = Number(String(v).replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : null }

/** เงินงวด = วงเงินสัญญา × สัดส่วนงาน (ปัด 2 ตำแหน่ง) */
export function suggestedAmount(contractAmount, workPct) {
  const base = numOrNull(contractAmount)
  const pct = numOrNull(workPct)
  if (base === null || pct === null || base < 0 || pct < 0 || pct > 100) return null
  return round((base * pct) / 100, 2)
}

/** ยอดสุทธิ = ยอดเบิก − ผลรวมยอดหัก · ติดลบ/ไม่มียอดเบิก = null */
export function suggestedNet(row) {
  const gross = numOrNull(row?.paid_gross)
  if (gross === null) return null
  const deducted = ['deduct_advance', 'deduct_retention', 'deduct_fine', 'deduct_other'].reduce((sum, k) => sum + (numOrNull(row?.[k]) ?? 0), 0)
  const net = round(gross - deducted, 2)
  return net < 0 ? null : net
}

/** เตือนเบาๆ เมื่อยอดสุทธิที่กรอกไม่เท่ากับยอดเบิกหักรายการ (ไม่บล็อก) */
export function netWarning(row) {
  const suggested = suggestedNet(row)
  const entered = numOrNull(row?.paid_net)
  if (suggested === null || entered === null || Math.abs(entered - suggested) < 0.005) return null
  return 'ยอดสุทธิไม่เท่ากับยอดเบิกหักรายการ — ตรวจกับฎีกา (อาจมีภาษีหัก ณ ที่จ่าย)'
}

/** วันสิ้นสุดใหม่ = วันสิ้นสุดที่ใช้อยู่ + จำนวนวันที่อนุมัติ */
export function suggestedNewEnd(currentEffectiveEnd, approvedDays) {
  const days = numOrNull(approvedDays)
  if (!isIsoDate(currentEffectiveEnd) || days === null || !Number.isInteger(days) || days < 0) return null
  return addDays(currentEffectiveEnd, days)
}

// ── เอกสารแนบ ────────────────────────────────────────────────────────────────

export const DOC_SOURCE_LABELS = { egp: 'e-GP', elaas: 'e-LAAS', system: 'ออกจากระบบนี้', other: 'อื่น ๆ' }

/** แคตาล็อกชนิดเอกสาร (doc_kind ตรง ^[a-z][a-z0-9_]{1,62}$) · source = ที่มาเริ่มต้น */
export const DOC_KINDS = [
  { key: 'contract', label: 'สัญญาจ้าง', source: 'other' },
  { key: 'guarantee', label: 'หลักประกันสัญญา', source: 'other' },
  { key: 'notice_to_proceed', label: 'หนังสือแจ้งให้เริ่มทำงาน', source: 'other' },
  { key: 'delivery_letter', label: 'หนังสือส่งมอบงาน', source: 'other' },
  { key: 'inspection_record', label: 'ใบตรวจรับงาน (e-GP)', source: 'egp' },
  { key: 'performance_cert', label: 'ใบรับรองผลการปฏิบัติงาน', source: 'other' },
  { key: 'fine_notice', label: 'หนังสือแจ้งสิทธิเรียกค่าปรับ (e-GP)', source: 'egp' },
  { key: 'change_request', label: 'หนังสือขอขยายเวลา / แก้ไขสัญญา', source: 'other' },
  { key: 'change_approval', label: 'หนังสือแจ้งผลพิจารณา', source: 'other' },
  { key: 'defect_notice', label: 'หนังสือแจ้งแก้ไขความชำรุดบกพร่อง', source: 'other' },
  { key: 'voucher', label: 'ฎีกาเบิกจ่าย (e-LAAS)', source: 'elaas' },
  { key: 'egp_announcement', label: 'ประกาศ / เอกสารจาก e-GP', source: 'egp' },
  { key: 'photo', label: 'ภาพถ่าย', source: 'other' },
  { key: 'other', label: 'อื่น ๆ', source: 'other' },
]
export const DOC_KIND_BY_KEY = Object.fromEntries(DOC_KINDS.map(k => [k.key, k]))
export const DOC_KIND_PATTERN = /^[a-z][a-z0-9_]{1,62}$/
export const DOC_SOURCES = Object.keys(DOC_SOURCE_LABELS)

/** เพดานไฟล์แนบ 20 MB (Edge Function drive-upload รับ ≤ 25 MB หลัง base64 ซึ่งบวม ~1.33 เท่า) */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024
const ATTACHMENT_EXT_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif' }
const extOf = name => String(name ?? '').split('.').pop()?.toLowerCase() ?? ''

/** ไฟล์แนบ: PDF หรือรูปเท่านั้น ≤ 20 MB · คืนข้อความผิดพลาด หรือ null ถ้าใช้ได้ (กล้องมือถือบางรุ่นส่ง type ว่าง จึงดูนามสกุลแทน) */
export function validateAttachment(file) {
  if (!file) return 'ไม่พบไฟล์'
  const type = file.type || ATTACHMENT_EXT_TYPES[extOf(file.name)] || ''
  if (type !== 'application/pdf' && !type.startsWith('image/')) return 'แนบได้เฉพาะไฟล์ PDF หรือรูปภาพ'
  if (!(file.size > 0)) return 'ไฟล์ว่างเปล่า'
  if (file.size > ATTACHMENT_MAX_BYTES) return `ไฟล์ใหญ่เกิน ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB`
  return null
}

/** โฟลเดอร์บน Drive: โครงการก่อสร้าง / ปีงบ <ปี> / สัญญา <เลขที่> — ⚠️ ห้ามมีชื่อบุคคล (PDPA) ใช้เลขที่สัญญา/รหัสโครงการเท่านั้น */
export function attachmentFolder(project) {
  const contractNo = String(project?.contract_no ?? '').trim()
  return driveFolderPath(
    DRIVE_MODULES.construction,
    project?.fiscal_year ? `ปีงบ ${project.fiscal_year}` : null,
    contractNo ? `สัญญา ${contractNo}` : `โครงการ ${String(project?.id ?? '').slice(0, 8)}`,
  )
}

/** ชื่อไฟล์บน Drive: <ป้ายชนิดเอกสาร>[-งวด N]-<วันที่ YYYYMMDD>.<นามสกุล> — ไม่มีชื่อคน */
export function attachmentFileName({ docKind, installmentNo, ext, date = bangkokIsoDate() } = {}) {
  const label = DOC_KIND_BY_KEY[docKind]?.label ?? docKind ?? 'เอกสาร'
  const safeExt = /^[a-z0-9]{1,5}$/.test(String(ext ?? '').toLowerCase()) ? String(ext).toLowerCase() : 'bin'
  const parts = [label.replace(/[\\/:*?"<>|]/g, '-'), installmentNo ? `งวด${installmentNo}` : null, String(date).replace(/-/g, '')]
  return `${parts.filter(Boolean).join('-')}.${safeExt}`
}

export const documentStageOf = project => {
  const stage = project?.stage === 'suspended' ? project.stage_before_hold : project?.stage
  return STAGES.includes(stage) ? stage : null
}

// ── ข้อความประวัติ (civil_project_events kind = note) ─────────────────────────────

const day = iso => (isIsoDate(String(iso ?? '').slice(0, 10)) ? thaiShortDate(String(iso).slice(0, 10)) : null)
const baht = n => (numOrNull(n) === null ? null : Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 }))
const changed = (before, after, key) => (after?.[key] ?? null) !== (before?.[key] ?? null)
const clip = s => (s.length > LONG_MAX ? `${s.slice(0, LONG_MAX - 1)}…` : s)
const CHANGE_SHORT = { extend_time: 'ขยายเวลา', waive_fine: 'งดค่าปรับ', reduce_fine: 'ลดค่าปรับ', amend_contract: 'แก้ไขสัญญา' }
const withRef = (head, ref) => (blank(ref) ? head : `${head} (${ref})`)

/**
 * ข้อความสั้นสำหรับประวัติโครงการ
 *   kind: installment · installment_delete · change · change_delete · defect · defect_delete · document_add · document_delete
 *   before = แถวเดิม (null = เพิ่มใหม่) · after = แถวหลังบันทึก (ลบ = null)
 */
export function historyNote(kind, before, after) {
  switch (kind) {
    case 'installment': {
      const no = after?.installment_no ?? before?.installment_no
      const parts = []
      if (changed(before, after, 'delivered_on') && day(after?.delivered_on)) parts.push(`ส่งมอบ ${day(after.delivered_on)}${blank(after.delivery_ref_no) ? '' : ` (เลขรับ ${after.delivery_ref_no})`}`)
      if (changed(before, after, 'chair_acknowledged_on') && day(after?.chair_acknowledged_on)) parts.push(`ประธานกรรมการทราบการส่งมอบ ${day(after.chair_acknowledged_on)}`)
      if (changed(before, after, 'due_report_on') && day(after?.due_report_on)) parts.push(`ผู้ควบคุมงานรายงาน ณ วันครบกำหนด ${day(after.due_report_on)}`)
      if (changed(before, after, 'fine_notice_date') || changed(before, after, 'fine_notice_no')) {
        if (day(after?.fine_notice_date) || !blank(after?.fine_notice_no)) parts.push(`หนังสือแจ้งสิทธิเรียกค่าปรับ${blank(after.fine_notice_no) ? '' : ` เลขที่ ${after.fine_notice_no}`}${day(after.fine_notice_date) ? ` ลว. ${day(after.fine_notice_date)}` : ''}`)
      }
      if (changed(before, after, 'paid_on') || changed(before, after, 'paid_gross')) {
        if (day(after?.paid_on) || baht(after?.paid_gross)) parts.push(withRef(`เบิกจ่าย${baht(after.paid_gross) ? ` ${baht(after.paid_gross)} บาท` : ''}${day(after.paid_on) ? ` ${day(after.paid_on)}` : ''}`, blank(after.voucher_no) ? null : `ฎีกา ${after.voucher_no}`))
      }
      const lines = []
      if (changed(before, after, 'inspection_result') && after?.inspection_result) {
        lines.push(`บันทึกผลตรวจรับงวดที่ ${no}: ${INSPECTION_RESULTS[after.inspection_result] ?? after.inspection_result}`)
      }
      if (parts.length || !lines.length) lines.unshift(`บันทึกงวดที่ ${no}: ${parts.length ? parts.join(' · ') : before ? 'แก้ไขข้อมูล' : 'เพิ่มงวด'}`)
      return clip(lines.join(' · '))
    }
    case 'installment_delete': return clip(`ลบงวดที่ ${before?.installment_no ?? '—'}`)
    case 'change': {
      const row = after ?? before
      const label = CHANGE_SHORT[row?.kind] ?? 'รายการแก้ไขสัญญา'
      if (changed(before, after, 'decision') && after?.decision) {
        const detail = after.decision === 'approved'
          ? [after.kind === 'extend_time' && after.approved_days !== null && after.approved_days !== undefined ? `อนุมัติ ${after.approved_days} วัน` : 'อนุมัติ',
            day(after.new_end_date) ? `สิ้นสุดใหม่ ${day(after.new_end_date)}` : null,
            after.kind === 'amend_contract' && baht(after.amount_change) ? `วงเงินเปลี่ยน ${baht(after.amount_change)} บาท` : null].filter(Boolean).join(' ')
          : 'ไม่อนุมัติ'
        return clip(`บันทึกผลพิจารณา${label}: ${detail}`)
      }
      if (!before) return clip(`บันทึกคำขอ${label}${row?.kind === 'extend_time' && row.requested_days ? ` ${row.requested_days} วัน` : ''}`)
      return clip(`แก้ไขรายการ${label}`)
    }
    case 'change_delete': return clip(`ลบรายการ${CHANGE_SHORT[before?.kind] ?? 'แก้ไขสัญญา'}`)
    case 'defect': {
      const row = after ?? before
      const head = `บันทึกผลตรวจความชำรุดบกพร่อง${day(row?.inspected_on) ? ` ${day(row.inspected_on)}` : ''}: ${DEFECT_RESULTS[row?.result] ?? '—'}`
      return clip(before ? head.replace('บันทึก', 'แก้ไข') : head)
    }
    case 'defect_delete': return clip(`ลบผลตรวจความชำรุดบกพร่อง${day(before?.inspected_on) ? ` ${day(before.inspected_on)}` : ''}`)
    case 'document_add': return clip(`แนบเอกสาร: ${after?.title ?? '—'}`)
    case 'document_delete': return clip(`ลบเอกสารแนบ: ${before?.title ?? '—'}`)
    default: return clip(String(kind ?? ''))
  }
}

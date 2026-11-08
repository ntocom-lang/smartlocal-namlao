// ช่องสัญญา/หลักประกัน/ระยะประกัน ที่ migration 20261108100000 เพิ่ม (civil_project_contracts + civil_projects) — ค่าตั้งต้นฟอร์ม · ตรวจก่อนส่ง · แปลงเป็นคอลัมน์
// คำนวณล้วน ไม่ต่อฐานข้อมูล · ช่วงค่าที่รับต้องตรง CHECK ใน migration (tests/construction-lifecycle-ui.test.mjs เทียบกับไฟล์ SQL)
// ใช้โดย ProjectSheet (ฟอร์ม) และ saveProject ใน constructionReportApi.js (ตรวจซ้ำก่อนยิงฐาน — ค่าผิดไม่ถึงฐานข้อมูล)
import { GUARANTEE_TYPES, PRICE_KINDS, WORK_GROUPS } from './constructionLifecycle'
import { isIsoDate } from './constructionReport'

/** ชื่อช่องในฟอร์ม = ชื่อคอลัมน์ civil_project_contracts */
export const LIFECYCLE_CONTRACT_FIELDS = [
  'price_kind', 'guarantee_type', 'guarantee_amount', 'guarantee_ref', 'guarantee_expires_on',
  'advance_pct', 'advance_amount', 'retention_pct', 'supervision_fee_per_day',
  'warranty_months', 'warranty_starts_on', 'warranty_ends_on',
  'notice_to_proceed_no', 'notice_to_proceed_date', 'start_within_days', 'finish_within_days',
]
/** ชื่อช่องในฟอร์ม = ชื่อคอลัมน์ civil_projects (แก้ได้เฉพาะ editBase) */
export const LIFECYCLE_PROJECT_FIELDS = ['work_group', 'operator_eval_required']

/** ค่าตั้งต้นของฟอร์ม (ค่าว่าง = '') */
export function lifecycleFormDefaults(project, contract) {
  const out = {}
  for (const f of LIFECYCLE_CONTRACT_FIELDS) out[f] = contract?.[f] ?? ''
  out.work_group = project?.work_group ?? ''
  out.operator_eval_required = Boolean(project?.operator_eval_required)
  return out
}

const blank = v => v === null || v === undefined || String(v).trim() === ''
/** ว่าง → null · ตัวเลขที่อ่านไม่ได้ → NaN (ให้ตัวตรวจจับ) · ตัดจุลภาคคั่นหลักพัน */
const parse = v => (blank(v) ? null : Number(String(v).replace(/[,\s]/g, '')))
const textOrNull = v => (blank(v) ? null : String(v).trim())

const MONEY_MAX = 9999999999999.99   // numeric(15,2): จำนวนเต็มได้ 13 หลัก
const FEE_MAX = 9999999999.99       // numeric(12,2): จำนวนเต็มได้ 10 หลัก

/**
 * ตรวจช่องเหล่านี้ทั้งชุดตาม CHECK จริง — คืนข้อความไทยข้อแรกที่ผิด หรือ null ถ้าผ่าน
 * @param {object} form
 * @param {{ editBase?: boolean }} options editBase = ฟอร์มนี้จะเขียน civil_projects ด้วยหรือไม่ (ช่องทะเบียนตรวจเฉพาะตอนเขียนจริง)
 */
export function validateLifecycleForm(form, { editBase = true } = {}) {
  const num = (key, label, { min = 0, max = null, integer = false, exclusiveMin = false } = {}) => {
    const n = parse(form[key])
    if (n === null) return null
    if (!Number.isFinite(n)) return `${label}ต้องเป็นตัวเลข`
    if (integer && !Number.isInteger(n)) return `${label}ต้องเป็นจำนวนเต็ม`
    if (exclusiveMin ? n <= min : n < min) return `${label}ต้อง${exclusiveMin ? 'มากกว่า' : 'ไม่น้อยกว่า'} ${min.toLocaleString('th-TH')}`
    if (max !== null && n > max) return `${label}ต้องไม่เกิน ${max.toLocaleString('th-TH')}`
    return null
  }
  const date = (key, label) => (blank(form[key]) || isIsoDate(String(form[key]).trim()) ? null : `${label}ไม่ใช่วันที่ที่ถูกต้อง`)
  const oneOf = (key, label, allowed) => (blank(form[key]) || Object.keys(allowed).includes(String(form[key]).trim()) ? null : `${label}ไม่ถูกต้อง`)

  const checks = [
    oneOf('price_kind', 'ชนิดราคา', PRICE_KINDS),
    oneOf('guarantee_type', 'ชนิดหลักประกันสัญญา', GUARANTEE_TYPES),
    num('guarantee_amount', 'จำนวนเงินหลักประกัน', { max: MONEY_MAX }),
    String(form.guarantee_ref ?? '').length > 200 ? 'เลขที่หลักประกันยาวเกิน 200 ตัวอักษร' : null,
    date('guarantee_expires_on', 'วันหมดอายุหลักประกัน'),
    num('advance_pct', 'ร้อยละเงินล่วงหน้า', { max: 100 }),
    num('advance_amount', 'จำนวนเงินล่วงหน้า', { max: MONEY_MAX }),
    num('retention_pct', 'ร้อยละเงินประกันผลงาน', { max: 100 }),
    num('supervision_fee_per_day', 'ค่าควบคุมงานต่อวัน', { max: FEE_MAX }),
    num('warranty_months', 'ระยะประกัน (เดือน)', { max: 600, integer: true }),
    date('warranty_starts_on', 'วันเริ่มระยะประกัน'),
    date('warranty_ends_on', 'วันสิ้นสุดระยะประกัน'),
    String(form.notice_to_proceed_no ?? '').length > 200 ? 'เลขที่หนังสือแจ้งเริ่มงานยาวเกิน 200 ตัวอักษร' : null,
    date('notice_to_proceed_date', 'วันที่หนังสือแจ้งให้เริ่มทำงาน'),
    num('start_within_days', 'จำนวนวันเริ่มงาน', { max: 36500, integer: true }),
    num('finish_within_days', 'จำนวนวันแล้วเสร็จ', { max: 36500, integer: true, exclusiveMin: true }),
    !blank(form.warranty_starts_on) && !blank(form.warranty_ends_on) && String(form.warranty_ends_on) < String(form.warranty_starts_on)
      ? 'วันสิ้นสุดระยะประกันต้องไม่ก่อนวันเริ่ม' : null,
  ]
  if (editBase) checks.push(oneOf('work_group', 'กลุ่มงาน', WORK_GROUPS))
  return checks.find(Boolean) ?? null
}

/** คอลัมน์ civil_project_contracts จากฟอร์ม (ค่าว่าง = null) — เรียกหลัง validateLifecycleForm ผ่านเท่านั้น */
export function lifecycleContractColumns(form) {
  const n = key => parse(form[key])
  return {
    price_kind: textOrNull(form.price_kind),
    guarantee_type: textOrNull(form.guarantee_type),
    guarantee_amount: n('guarantee_amount'),
    guarantee_ref: textOrNull(form.guarantee_ref),
    guarantee_expires_on: textOrNull(form.guarantee_expires_on),
    advance_pct: n('advance_pct'),
    advance_amount: n('advance_amount'),
    retention_pct: n('retention_pct'),
    supervision_fee_per_day: n('supervision_fee_per_day'),
    warranty_months: n('warranty_months'),
    warranty_starts_on: textOrNull(form.warranty_starts_on),
    warranty_ends_on: textOrNull(form.warranty_ends_on),
    notice_to_proceed_no: textOrNull(form.notice_to_proceed_no),
    notice_to_proceed_date: textOrNull(form.notice_to_proceed_date),
    start_within_days: n('start_within_days'),
    finish_within_days: n('finish_within_days'),
  }
}

/** คอลัมน์ civil_projects ที่ฟอร์มนี้รู้จัก (ส่งเฉพาะเมื่อ editBase) */
export function lifecycleProjectColumns(form) {
  return { work_group: textOrNull(form.work_group), operator_eval_required: Boolean(form.operator_eval_required) }
}

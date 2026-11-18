// ตัวสร้างแบบฟอร์มออนไลน์ของ "ประเภทคำขอที่ อปท. เพิ่มเอง" — ฟังก์ชันบริสุทธิ์ ไม่มี React/supabase
// (เทสต์ด้วย node ได้ที่ tests/custom-form-fields.test.mjs)
//
// ที่เก็บข้อมูล (ไม่มี migration):
//   นิยามช่อง  → municipalities.fee_schedule._custom_types[].fields  (เขียนที่เดียวคือ DocumentTypeAssignments.jsx)
//   คำตอบ      → document_requests.permit_form_data.custom_form      (คอลัมน์ jsonb เดิม)
//
// ⚠️ คำตอบเก็บ "snapshot ชื่อช่อง ณ ตอนยื่น" ไว้ในแถวเอง ไม่อ้างนิยามปัจจุบัน — แอดมินเปลี่ยนชื่อ/ลบช่องทีหลัง
// คำขอเก่าต้องยังอ่านถูกและพิมพ์ได้เหมือนวันที่ยื่น (เอกสารราชการแก้ย้อนหลังไม่ได้) ตัวอ่าน customFormRows()
// จึงอ่านจาก snapshot เท่านั้น ห้ามเอาไป join กับนิยามปัจจุบัน
//
// ⚠️ ข้อมูลทุกค่าที่ออกจากไฟล์นี้ถือว่ามาจากผู้ใช้ — ผู้ยื่นแบบ guest ยิง insert ตรงด้วย anon key ใส่ JSON อะไรก็ได้
// ตัวอ่านจึงต้องไม่ throw และต้องบังคับชนิด/ความยาวเอง · ใบพิมพ์ต้อง escape HTML ทุกค่าอีกชั้น (customRequestPrint.js)

import { thaiDateFromDateInput } from './thaiDate.js'

export const CUSTOM_FIELD_TYPES = {
  text: 'ข้อความสั้น',
  textarea: 'ข้อความยาว',
  number: 'ตัวเลข',
  date: 'วันที่',
  choice: 'เลือก 1 ข้อ',
  checkbox: 'ติ๊กยืนยัน',
}

// ขีดจำกัด — ฝั่งแอดมิน (นิยามช่อง) และฝั่งประชาชน (คำตอบ) ใช้ค่าชุดเดียวกัน
export const CUSTOM_FIELDS_MAX = 12
export const CUSTOM_LABEL_MAX = 100
export const CUSTOM_HELP_MAX = 200
export const CUSTOM_OPTIONS_MIN = 2
export const CUSTOM_OPTIONS_MAX = 20
export const CUSTOM_OPTION_MAX = 100
export const CUSTOM_TEXT_MAX = 300
// ⚠️ ลดจาก 800 เหลือ 450 หลังวัดใบพิมพ์จริง (tests/custom-form-fields.test.mjs + npm run test:staff-sign):
// ใบคำขอ A4 แนวตั้งพร้อมช่องลงนามเจ้าหน้าที่เหลือที่ให้ตารางคำตอบราว 13 บรรทัดรวมทุกช่อง (พื้นที่พิมพ์สูง 276 มม.)
//   · ข้อความยาว 1 ช่อง 450 ตัวอักษร (+ช่องสั้นอีก 3) จบ 1 แผ่น (ล่างสุด 247 มม.)
//   · 12 ช่อง ช่องละ 1 บรรทัด (~40 ตัวอักษร) จบ 1 แผ่น (266.6 มม.) แต่ช่องละ 60 ตัวอักษรขึ้นไป (2 บรรทัด) ล้นเป็น 2 แผ่น
//   · 12 ช่อง × 800 ตัวอักษร = ~1,515 มม. (ราว 6 แผ่น) ไม่มีทางจบ 1 แผ่นด้วยการลดเพดานรายช่องที่ใช้งานได้จริง
// จึงไม่มีเพดานที่รับประกัน "12 ช่องยาวสุดจบ 1 แผ่น" — ผลรวมเกินความจุ = ตารางต่อหน้า 2 (ช่องลงนามย้ายตามทั้งก้อน)
// ห้ามเพิ่มค่านี้โดยไม่รัน npm run test:staff-sign
export const CUSTOM_TEXTAREA_MAX = 450
export const CUSTOM_NUMBER_MAX_LEN = 20

const FIELD_ID_RE = /^f_[a-z0-9]{4,12}$/
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

const str = value => (typeof value === 'string' ? value : '')
const trimmed = value => str(value).trim()

/** สุ่มรหัสช่อง f_xxxxxx ครั้งเดียวตอนสร้าง — ไม่เปลี่ยนเมื่อแก้ชื่อช่อง (คำตอบอ้างด้วยรหัสนี้) */
export function newFieldId(taken = []) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let id = 'f_'
    for (let i = 0; i < 6; i += 1) id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]
    if (!taken.includes(id)) return id
  }
  return `f_${Date.now().toString(36)}`
}

function cleanOptions(options) {
  if (!Array.isArray(options)) return []
  const seen = new Set()
  const out = []
  for (const raw of options) {
    const text = trimmed(raw).slice(0, CUSTOM_OPTION_MAX)
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= CUSTOM_OPTIONS_MAX) break
  }
  return out
}

/**
 * ทำความสะอาดนิยามช่องก่อนบันทึก/ก่อนใช้ — trim, ตัดความยาว, ทิ้งช่องที่ไม่ถูกต้อง
 * (ไม่มีชื่อ, ชนิดไม่รู้จัก, choice มีตัวเลือกไม่ถึง 2) · รหัสช่องที่หาย/ซ้ำ/รูปผิดจะสุ่มใหม่
 * @returns {Array<{id:string,label:string,type:string,required:boolean,help?:string,options?:string[]}>}
 */
export function sanitizeFieldDefs(defs) {
  if (!Array.isArray(defs)) return []
  const out = []
  const ids = []
  for (const def of defs) {
    if (out.length >= CUSTOM_FIELDS_MAX) break
    if (!def || typeof def !== 'object') continue
    const label = trimmed(def.label).slice(0, CUSTOM_LABEL_MAX).trim()
    if (!label) continue
    if (!Object.hasOwn(CUSTOM_FIELD_TYPES, def.type)) continue
    const field = { id: '', label, type: def.type, required: def.required === true }
    const help = trimmed(def.help).slice(0, CUSTOM_HELP_MAX).trim()
    if (help) field.help = help
    if (def.type === 'choice') {
      const options = cleanOptions(def.options)
      if (options.length < CUSTOM_OPTIONS_MIN) continue
      field.options = options
    }
    field.id = typeof def.id === 'string' && FIELD_ID_RE.test(def.id) && !ids.includes(def.id)
      ? def.id : newFieldId(ids)
    ids.push(field.id)
    out.push(field)
  }
  return out
}

/** ประเภทที่ อปท. เพิ่มเอง — DocumentTypeAssignments สร้าง value เป็น custom_<เวลา> เสมอ */
export function isCustomDocumentType(value) {
  return typeof value === 'string' && value.startsWith('custom_')
}

/** นิยามช่องของประเภทที่ อปท. เพิ่มเอง — ไม่พบประเภท/ไม่มีช่อง = [] (ฟอร์มกลางเดิม) */
export function customTypeFields(tenant, value) {
  const list = tenant?.fee_schedule?._custom_types
  if (!Array.isArray(list)) return []
  const entry = list.find(t => t?.value === value)
  return sanitizeFieldDefs(entry?.fields)
}

/** ชื่อประเภทที่เพิ่มเอง (ไม่รวม emoji) — ประเภทถูกลบไปแล้วใช้ข้อความสำรอง ไม่แสดงรหัสดิบ */
export function customTypeLabel(tenant, value, fallback = 'บริการเพิ่มเติม') {
  const list = tenant?.fee_schedule?._custom_types
  const entry = Array.isArray(list) ? list.find(t => t?.value === value) : null
  return trimmed(entry?.label) || fallback
}

function isRealDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

const NUMBER_RE = /^-?\d+(\.\d+)?$/

/**
 * ตรวจคำตอบของประชาชนกับนิยามช่อง — ข้อความผิดพลาดเป็นภาษาไทยพร้อมแสดงใต้ช่อง
 * @param {ReturnType<typeof sanitizeFieldDefs>} fields
 * @param {Record<string, unknown>} answers
 * @returns {{ ok: boolean, errors: Record<string,string> }}
 */
export function validateCustomAnswers(fields, answers) {
  const errors = {}
  const given = answers && typeof answers === 'object' ? answers : {}
  for (const field of fields || []) {
    const raw = given[field.id]
    if (field.type === 'checkbox') {
      if (field.required && raw !== true) errors[field.id] = 'กรุณาติ๊กยืนยัน'
      continue
    }
    const text = typeof raw === 'number' ? String(raw) : trimmed(raw)
    if (!text) {
      if (field.required) errors[field.id] = 'กรุณากรอกข้อมูลช่องนี้'
      continue
    }
    if (field.type === 'text' && text.length > CUSTOM_TEXT_MAX) {
      errors[field.id] = `ยาวเกินไป (ไม่เกิน ${CUSTOM_TEXT_MAX} ตัวอักษร)`
    } else if (field.type === 'textarea' && text.length > CUSTOM_TEXTAREA_MAX) {
      errors[field.id] = `ยาวเกินไป (ไม่เกิน ${CUSTOM_TEXTAREA_MAX} ตัวอักษร)`
    } else if (field.type === 'number') {
      if (text.length > CUSTOM_NUMBER_MAX_LEN || !NUMBER_RE.test(text) || !Number.isFinite(Number(text))) {
        errors[field.id] = 'กรุณากรอกเป็นตัวเลข เช่น 12 หรือ 3.5'
      }
    } else if (field.type === 'date') {
      if (!isRealDate(text)) errors[field.id] = 'กรุณาเลือกวันที่ให้ถูกต้อง'
    } else if (field.type === 'choice') {
      if (!(field.options || []).includes(text)) errors[field.id] = 'กรุณาเลือกจากตัวเลือกที่กำหนด'
    }
  }
  return { ok: Object.keys(errors).length === 0, errors }
}

/**
 * สร้างก้อน permit_form_data ของคำขอ — เรียกหลัง validateCustomAnswers ผ่านแล้ว
 * บังคับชนิด/ตัดความยาวซ้ำอีกชั้น และเก็บเฉพาะรหัสช่องที่อยู่ในนิยามจริง
 */
export function buildCustomFormData(fields, answers) {
  const given = answers && typeof answers === 'object' ? answers : {}
  const snapshot = []
  const kept = {}
  for (const field of fields || []) {
    const item = { id: field.id, label: field.label, type: field.type }
    if (field.type === 'choice') item.options = [...(field.options || [])]
    snapshot.push(item)
    const raw = given[field.id]
    if (field.type === 'checkbox') {
      kept[field.id] = raw === true
      continue
    }
    const text = typeof raw === 'number' ? String(raw) : trimmed(raw)
    if (!text) continue
    kept[field.id] = field.type === 'textarea' ? text.slice(0, CUSTOM_TEXTAREA_MAX)
      : field.type === 'text' ? text.slice(0, CUSTOM_TEXT_MAX)
      : text.slice(0, Math.max(CUSTOM_NUMBER_MAX_LEN, CUSTOM_OPTION_MAX))
  }
  return { custom_form: { v: 1, fields: snapshot, answers: kept } }
}

/**
 * แถว label/value สำหรับแสดงผล (จอเจ้าหน้าที่ / จอประชาชน / ใบพิมพ์) — อ่านจาก snapshot ในแถวคำขอ
 * รูปผิด/ไม่มี custom_form = [] ห้าม throw (permit_form_data ของคำขอประเภทอื่นเป็นก้อนอื่นทั้งหมด)
 * @returns {Array<{ label: string, value: string }>}
 */
export function customFormRows(permitFormData, documentType) {
  // แสดงเฉพาะประเภทที่ อปท. เพิ่มเอง (custom_*) — ผู้ยื่น guest ยิง insert ตรงใส่ custom_form ลงคำขอประเภทมาตรฐานได้
  // ถ้าไม่กรอง ช่องปลอมจะขึ้นจอเจ้าหน้าที่และพิมพ์ปนใบได้ · ไม่ส่ง documentType = ไม่กรอง (ใช้ในเทสต์/ใบพิมพ์ที่กรองมาแล้ว)
  if (documentType !== undefined && !isCustomDocumentType(documentType)) return []
  const form = permitFormData && typeof permitFormData === 'object' ? permitFormData.custom_form : null
  if (!form || typeof form !== 'object' || !Array.isArray(form.fields)) return []
  const answers = form.answers && typeof form.answers === 'object' ? form.answers : {}
  const rows = []
  for (const field of form.fields.slice(0, CUSTOM_FIELDS_MAX)) {
    if (!field || typeof field !== 'object') continue
    const label = trimmed(field.label).slice(0, CUSTOM_LABEL_MAX)
    if (!label || !Object.hasOwn(CUSTOM_FIELD_TYPES, field.type)) continue
    const raw = Object.hasOwn(answers, field.id) ? answers[field.id] : undefined
    let value = ''
    if (field.type === 'checkbox') {
      value = raw === true ? 'ยืนยัน' : 'ไม่ได้ติ๊ก'
    } else if (field.type === 'date') {
      value = thaiDateFromDateInput(typeof raw === 'string' ? raw : '')
    } else if (typeof raw === 'string') {
      value = raw.trim().slice(0, CUSTOM_TEXTAREA_MAX)
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      value = String(raw)
    }
    rows.push({ label, value: value || '—' })
  }
  return rows
}

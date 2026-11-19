// นำเข้าสมุดเบอร์โทรจาก Excel/CSV — ฟังก์ชันล้วน (ไม่ import supabase/React เทสต์ด้วย node ได้)
// หน้าจอ: components/admin/ContactImportSheet.jsx · ตาราง: emergency_contacts (แอดมินของ อปท. insert ได้ตาม RLS เดิม)
// ใช้ร่วมกันทั้ง 2 สมุด (book = 'urgent' | 'directory') — เบอร์ซ้ำตรวจเฉพาะในสมุดเดียวกัน
//
// หลักของโมดูลนี้ (ลอกโครงจาก licenceRegistry.js):
//   - ระบบ "ตรวจ/จัดรูป/เตรียมให้" แอดมินเห็นพรีวิวรายแถวแล้วกดยืนยันครั้งเดียว ไม่ตัดสินแทนคน
//   - เบอร์มือถือส่วนบุคคลที่ยังไม่ติ๊กยินยอม = "เตือน" ไม่บล็อก (เจ้าของระบบเลือกแล้ว — แบบเดียวกับป้ายเตือนตอนเพิ่มทีละเบอร์)
//     แต่ consent_at ต้องเป็น null เสมอถ้าไม่ได้ยินยอม ระบบห้ามประทับความยินยอมแทนเจ้าของเบอร์
//   - แถวผิดไม่ถูกนำเข้า (ข้าม + เหตุผลรายแถว) ส่วนแถวที่ผ่านบันทึกทั้งชุดในคำสั่งเดียว

import { normalizeHeader } from './spreadsheetRead.js'
import { EMERGENCY_CATEGORIES, DEFAULT_EMERGENCY_CATEGORY, guessCategory } from './emergencyCategories.js'
import { CONTACT_BOOK_MAP, looksLikePersonalMobile } from './contactBooks.js'

export const CONTACT_IMPORT_MAX_ROWS = 300

// ค่าสี/ไอคอนตั้งต้นของแถวใหม่ — ต้องตรงกับค่าเริ่มต้นของฟอร์มเพิ่มทีละเบอร์ใน AdminDashboard.jsx (EmergencyManager: useState form)
// ฟอร์มนั้นไม่เปลี่ยนสี/พื้นตามหมวด (หมวดมีสีของตัวเองที่หน้าประชาชนวาดจาก category) แถวนำเข้าจึงได้ค่าเดียวกัน
export const CONTACT_IMPORT_DEFAULT_EMOJI = '📞'
export const CONTACT_IMPORT_DEFAULT_COLOR = '#1d4ed8'
export const CONTACT_IMPORT_DEFAULT_BG = '#dbeafe'

// หัวคอลัมน์ที่รับ — เทียบหลัง normalizeHeader (ตัดช่องว่าง/ขีด/วงเล็บ/จุด + ตัวพิมพ์เล็ก) ผู้ใช้จึงพิมพ์ "ชื่อ-สกุล" หรือ "ชื่อ สกุล" ก็ได้
const HEADER_ALIASES = {
  label: ['ชื่อ', 'ชื่อหน่วยงาน', 'ชื่อ-สกุล', 'ชื่อนามสกุล', 'ชื่อ-นามสกุล', 'ชื่อหน่วยงาน/บุคคล', 'หน่วยงาน', 'รายการ', 'label', 'name'],
  number: ['เบอร์โทร', 'เบอร์', 'โทรศัพท์', 'เบอร์โทรศัพท์', 'โทร', 'หมายเลขโทรศัพท์', 'เบอร์ติดต่อ', 'เบอร์โทรติดต่อ', 'number', 'phone', 'tel'],
  category: ['หมวด', 'หมวดหมู่', 'ประเภท', 'category'],
  note: ['หมายเหตุ', 'note'],
  consent: ['ยินยอม', 'ยินยอมเผยแพร่', 'ความยินยอม', 'ได้รับความยินยอม', 'consent'],
}

export const CONTACT_IMPORT_TEMPLATE_HEADERS = Object.freeze(['ชื่อ', 'เบอร์โทร', 'หมวด', 'หมายเหตุ', 'ยินยอม'])

// แถวตัวอย่างในไฟล์แม่แบบ — เบอร์สมมติเท่านั้น (ห้ามใส่เบอร์คนจริง) · ผู้ใช้ต้องลบแถวเหล่านี้ก่อนนำเข้า (หน้าจอบอกไว้)
const TEMPLATE_SAMPLE_ROWS = Object.freeze([
  ['สำนักงานตัวอย่าง', '055-000000', 'หน่วยงานราชการ', 'เวลาราชการ จ-ศ 08.30-16.30', ''],
  ['ผู้ใหญ่บ้านตัวอย่าง หมู่ 1', '081-000-0000', 'ผู้นำท้องถิ่น', '', 'ใช่'],
])

/** ไฟล์แม่แบบ CSV — ขึ้นต้นด้วย BOM UTF-8 เพื่อให้ Excel เปิดภาษาไทยไม่เพี้ยน */
export function buildContactTemplateCsv() {
  const csv = [CONTACT_IMPORT_TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE_ROWS]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  return String.fromCharCode(0xfeff) + csv
}

/** แมปหัวคอลัมน์ → { label, number, category, note, consent: columnIndex|-1 } */
export function mapContactHeaders(headers) {
  const normalized = (headers ?? []).map(normalizeHeader)
  const index = {}
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const set = aliases.map(normalizeHeader)
    index[key] = normalized.findIndex((h) => set.includes(h))
  }
  return index
}

// ── เบอร์โทร ──────────────────────────────────────────────────────────────────────

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'
const toAsciiDigits = (s) => String(s).replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))

/**
 * ตรวจ+จัดรูปเบอร์ที่ผู้ใช้พิมพ์
 *  - ตัวอักษรอื่นที่ไม่ใช่ตัวเลข/ขีด/จุด/วงเล็บ/ช่องว่าง (และ "ต่อ เลขต่อ") = ไม่ผ่าน
 *  - +66 → 0 · Excel ตัดเลข 0 นำหน้า: มือถือ 9 หลัก (812345678) และเบอร์บ้าน 8 หลักที่ขึ้นต้น 2–7 → เติม 0
 *  - เบอร์สั้น 3–5 หลัก (191, 1669, 1300) ใช้ได้ · 6–10 หลักรับตามที่พิมพ์ · นอกช่วงนี้ไม่ผ่าน
 * @returns {{ ok: true, number: string, digits: string, key: string, corrected: boolean } | { ok: false, error: string }}
 *   number = ค่าที่จะเก็บ (ตามที่พิมพ์ trim แล้ว · ถ้าแก้รูป +66/เติม 0 เก็บเป็นตัวเลขล้วนที่แก้แล้ว)
 *   key    = ตัวเลขล้วนไว้เทียบซ้ำ (รวมเลขต่อ) — ขีด/ช่องว่างไม่ทำให้เบอร์เดียวกันเป็นคนละเบอร์
 */
export function analyzeContactNumber(raw) {
  const s = toAsciiDigits(String(raw ?? '')).trim()
  if (!s) return { ok: false, error: 'ไม่มีเบอร์โทร' }

  // เลขต่อ: "02-123-4567 ต่อ 12" — ส่วนหลัง "ต่อ" ต้องเป็นตัวเลขล้วน
  const extMatch = /^(.*?)\s*ต่อ\s*(.*)$/.exec(s)
  const main = (extMatch ? extMatch[1] : s).trim()
  const ext = extMatch ? extMatch[2].trim() : ''
  if (extMatch && !/^[0-9]{1,6}$/.test(ext)) return { ok: false, error: 'เลขต่อไม่ถูกต้อง (ต้องเป็นตัวเลข)' }

  if (!/^\+?[0-9\s\-().]+$/.test(main) || !/[0-9]/.test(main)) {
    return { ok: false, error: 'เบอร์โทรมีตัวอักษรที่ไม่ใช่ตัวเลข' }
  }

  let digits = main.replace(/\D/g, '')
  let corrected = false
  if (main.startsWith('+')) {
    if (!digits.startsWith('66')) return { ok: false, error: 'รองรับเฉพาะรหัสประเทศ +66' }
    let rest = digits.slice(2)
    if (rest.length === 10 && rest.startsWith('0')) rest = rest.slice(1) // "+66 (0)81..." เขียนซ้ำเลข 0
    digits = `0${rest}`
    corrected = true
  } else if (digits.length === 9 && /^[689]/.test(digits)) {
    digits = `0${digits}` // มือถือ 10 หลักที่ Excel ตัด 0 หน้าทิ้ง
    corrected = true
  } else if (digits.length === 8 && /^[2-7]/.test(digits)) {
    digits = `0${digits}` // เบอร์บ้าน/สำนักงาน 9 หลักที่ Excel ตัด 0 หน้าทิ้ง (02/03/04/05/07)
    corrected = true
  }

  if (digits.length < 3) return { ok: false, error: 'เบอร์โทรสั้นเกินไป' }
  if (digits.length > 10) return { ok: false, error: 'เบอร์โทรยาวเกินไป (เกิน 10 หลัก)' }

  const extPart = ext ? ` ต่อ ${ext}` : ''
  return {
    ok: true,
    number: corrected ? `${digits}${extPart}` : s,
    digits,
    key: ext ? `${digits}x${ext}` : digits,
    corrected,
  }
}

/** กุญแจเทียบซ้ำของเบอร์ที่มีอยู่แล้วในฐาน — เบอร์เก่าอาจรูปแบบแปลก จึงตกไปใช้ตัวเลขล้วนถ้าตรวจรูปไม่ผ่าน */
function existingKey(number) {
  const a = analyzeContactNumber(number)
  return a.ok ? a.key : String(number ?? '').replace(/\D/g, '')
}

// ── หมวด / ยินยอม ───────────────────────────────────────────────────────────────

const CATEGORY_LOOKUP = new Map()
for (const c of EMERGENCY_CATEGORIES) {
  CATEGORY_LOOKUP.set(normalizeHeader(c.key), c.key)
  CATEGORY_LOOKUP.set(normalizeHeader(c.label), c.key)
}
const categoryLabelOf = (key) => EMERGENCY_CATEGORIES.find((c) => c.key === key)?.label ?? key

/** @returns {{ key: string|null, matched: boolean }} key = หมวดที่จับได้จากข้อความ (null = ไม่รู้จัก) */
function matchCategory(raw) {
  const key = CATEGORY_LOOKUP.get(normalizeHeader(raw))
  return { key: key ?? null, matched: Boolean(key) }
}

const CONSENT_TRUE = new Set(['ใช่', 'ยินยอม', 'y', 'yes', 'true', '1', '✓', '✔', '✔️'])
export function parseConsent(raw) {
  return CONSENT_TRUE.has(String(raw ?? '').trim().toLocaleLowerCase('th-TH'))
}

// ── พรีวิว ────────────────────────────────────────────────────────────────────────

/**
 * ตรวจแถวนำเข้าก่อนบันทึก (พรีวิว)
 * @param {unknown[][]} matrix แถวแรกคือหัวคอลัมน์ (ผลจาก parseCsv/parseXlsx)
 * @param {{ existing?: Array<{ number: string }>, book?: string }} ctx existing = เบอร์ที่มีอยู่แล้วใน "สมุดเดียวกัน"
 * @returns {{
 *   errors: string[],
 *   toInsert: Array<{ rowNo:number, label:string, number:string, digits:string, category:string, note:string|null, consent:boolean }>,
 *   skipped: Array<{ rowNo:number, reason:string }>,
 *   warnings: Array<{ rowNo:number, kind:'consent'|'category', reason:string }>,
 * }}
 *   errors = ผิดทั้งไฟล์ (ไม่มีคอลัมน์บังคับ/เกิน 300 แถว/ไม่มีข้อมูล) — มี error แล้ว toInsert ว่างเสมอ
 *   rowNo = เลขแถวในไฟล์ (หัวคอลัมน์ = แถว 1 แถวข้อมูลแรก = 2) แถวว่างทั้งแถวข้ามเงียบ ไม่ขึ้นใน skipped
 */
export function buildContactImportPreview(matrix, { existing = [], book } = {}) {
  const result = { errors: [], toInsert: [], skipped: [], warnings: [] }
  const [headers = [], ...body] = matrix ?? []
  const idx = mapContactHeaders(headers)

  const missing = [['label', 'ชื่อ'], ['number', 'เบอร์โทร']].filter(([k]) => idx[k] < 0).map(([, label]) => label)
  if (missing.length) {
    result.errors.push(`ไม่พบหัวคอลัมน์ที่จำเป็น: ${missing.join(', ')}`)
    return result
  }

  const cell = (row, key) => (idx[key] >= 0 ? String(row[idx[key]] ?? '').trim() : '')
  const dataRows = body
    .map((row, i) => ({ row: row ?? [], rowNo: i + 2 }))
    .filter(({ row }) => row.some((v) => String(v ?? '').trim()))

  if (dataRows.length === 0) {
    result.errors.push('ไม่พบแถวข้อมูลในไฟล์ (มีแต่หัวคอลัมน์)')
    return result
  }
  if (dataRows.length > CONTACT_IMPORT_MAX_ROWS) {
    result.errors.push(`ไฟล์มี ${dataRows.length.toLocaleString('th-TH')} แถว เกิน ${CONTACT_IMPORT_MAX_ROWS} แถวต่อครั้ง — แบ่งไฟล์แล้วนำเข้าทีละส่วน`)
    return result
  }

  const bookLabel = CONTACT_BOOK_MAP[book]?.label ?? 'สมุดนี้'
  const existingKeys = new Set((existing ?? []).map((c) => existingKey(c?.number)).filter(Boolean))
  const seenInFile = new Map() // key → rowNo แถวแรกที่ใช้เบอร์นี้

  for (const { row, rowNo } of dataRows) {
    const label = cell(row, 'label')
    const rawNumber = cell(row, 'number')
    if (!label) { result.skipped.push({ rowNo, reason: 'ไม่มีชื่อ' }); continue }
    if (!rawNumber) { result.skipped.push({ rowNo, reason: 'ไม่มีเบอร์โทร' }); continue }
    const phone = analyzeContactNumber(rawNumber)
    if (!phone.ok) { result.skipped.push({ rowNo, reason: phone.error }); continue }

    if (existingKeys.has(phone.key)) {
      result.skipped.push({ rowNo, reason: `เบอร์ซ้ำกับที่มีอยู่แล้วใน${bookLabel}` })
      continue
    }
    if (seenInFile.has(phone.key)) {
      result.skipped.push({ rowNo, reason: `เบอร์ซ้ำกับแถว ${seenInFile.get(phone.key)} ในไฟล์` })
      continue
    }
    seenInFile.set(phone.key, rowNo)

    // หมวด: ระบุในไฟล์และรู้จัก → ใช้ · ว่าง → เดาจากชื่อ · เดาไม่ได้/เขียนมาแต่ไม่รู้จัก → "อื่น ๆ" (ไม่ error แต่บอกเหตุผล)
    const rawCategory = cell(row, 'category')
    const given = matchCategory(rawCategory)
    let category
    if (given.matched) category = given.key
    else if (!rawCategory) category = guessCategory(label)
    else category = DEFAULT_EMERGENCY_CATEGORY
    if (!given.matched && category === DEFAULT_EMERGENCY_CATEGORY) {
      result.warnings.push({
        rowNo,
        kind: 'category',
        reason: rawCategory
          ? `ไม่รู้จักหมวด "${rawCategory}" — ใช้ "${categoryLabelOf(category)}"`
          : `ไม่ได้ระบุหมวดและเดาจากชื่อไม่ได้ — ใช้ "${categoryLabelOf(category)}"`,
      })
    }

    const consent = parseConsent(cell(row, 'consent'))
    if (looksLikePersonalMobile(phone.digits) && !consent) {
      result.warnings.push({ rowNo, kind: 'consent', reason: 'เบอร์มือถือส่วนตัว ยังไม่ได้ติ๊กยินยอม — ขึ้นหน้าสาธารณะ' })
    }

    result.toInsert.push({
      rowNo,
      label,
      number: phone.number,
      digits: phone.digits,
      category,
      note: cell(row, 'note') || null,
      consent,
    })
  }
  return result
}

/**
 * สร้างแถวสำหรับ insert (ตรงกับคอลัมน์ที่ addContact ใส่ทีละเบอร์) — display_order ต่อท้ายจาก startOrder ตามลำดับในไฟล์
 * @param {ReturnType<typeof buildContactImportPreview>['toInsert']} items
 * @param {{ municipalityId: string, book: string, startOrder: number, now?: Date, guessEmoji?: (label: string) => string }} ctx
 *   guessEmoji = ตัวเดาไอคอนจากชื่อตัวเดียวกับฟอร์มเพิ่มทีละเบอร์ (ส่งมาจาก AdminDashboard ไม่ก๊อปซ้ำ) ไม่ส่ง = 📞
 *   consent_at = เวลานำเข้า (ISO) เมื่อไฟล์ระบุยินยอม ไม่งั้น null
 */
export function buildContactInsertPayload(items, { municipalityId, book, startOrder, now = new Date(), guessEmoji } = {}) {
  const consentAt = now.toISOString()
  return (items ?? []).map((it, i) => ({
    municipality_id: municipalityId,
    label: it.label,
    number: it.number,
    emoji: (typeof guessEmoji === 'function' ? guessEmoji(it.label) : '') || CONTACT_IMPORT_DEFAULT_EMOJI,
    color: CONTACT_IMPORT_DEFAULT_COLOR,
    bg: CONTACT_IMPORT_DEFAULT_BG,
    category: it.category,
    book,
    note: it.note ?? null,
    consent_at: it.consent ? consentAt : null,
    display_order: startOrder + i,
  }))
}

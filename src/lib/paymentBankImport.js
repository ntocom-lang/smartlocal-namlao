// รับชำระเงิน · แปลงไฟล์ธนาคาร (CSV/XLSX) เป็นแถวเงินเข้าสำหรับ payment_import_bank_rows (ขั้น 1C / E4 PR2)
// ฟังก์ชันบริสุทธิ์ (ไม่ import React/supabase เทสต์ด้วย node ได้) · รับ matrix จาก spreadsheetRead.js (parseCsv / parseXlsx)
// ฐานข้อมูล: supabase/migrations/20261212100100_payment_bank_match_rpc.sql (payment_import_bank_rows / payment_save_bank_mapping)
//
// หลักของไฟล์นี้
//  - ไม่เก็บ/ไม่ส่งชื่อหรือเลขบัญชีผู้โอน (เจ้าของระบบตัดสิน 2026-11-18 · PDPA): อ่านเฉพาะคอลัมน์ที่ผู้ใช้จับคู่ไว้ 7 ช่อง
//    แถวที่ส่งออกมีแค่ { txn_at, amount, ref1, ref2, bank_ref } · คอลัมน์ที่หัวเป็นชื่อ/บัญชี/รายละเอียด จับคู่ไม่ได้ (isBlockedHeader)
//  - ไม่เดา: วันที่/ยอดที่ไม่แน่ใจ = ข้ามแถวพร้อมเหตุผลที่คนอ่านรู้เรื่อง (หน้าจอแสดงรายการแถวที่ข้ามก่อนยืนยันเสมอ)
//    ฐานปฏิเสธทั้งไฟล์เมื่อแถวเดียวผิด จึงกรองฝั่งนี้ให้ก่อน ไม่ให้แถวเดียวทำให้เงินที่เหลือเข้าไม่ได้
//  - ข้อสมมติที่ต้องตรวจจากพรีวิว: วันที่ที่ทั้งวันและเดือน ≤ 12 (เช่น 03/04/2026) อ่านเป็น "วัน/เดือน/ปี" ตามแบบไทย

import { normalizeHeader } from './spreadsheetRead.js'

// ⚠️ normalizeHeader ใช้ NFKC ซึ่งแตก "ำ" (สระอำ) เป็น นิคหิต+สระอา — ลวดลายที่เทียบกับหัวคอลัมน์ต้องผ่าน NFKC เหมือนกัน
// ไม่งั้น "จำนวนเงิน" / "ผู้ทำรายการ" ในลวดลายไม่เคยตรงกับหัวจริง (เทสต์เดาคอลัมน์จับได้)
const nfkc = pattern => new RegExp(pattern.source.normalize('NFKC'))

export const MAX_IMPORT_ROWS = 5000
/** ฐานรับย้อนหลังไม่เกิน 400 วัน และไม่รับวันในอนาคต (ตรงกับ payment_import_bank_rows) */
export const MAX_AGE_DAYS = 400
const MAX_AMOUNT = 10000000
const BANK_REF_RE = /^[A-Za-z0-9/_.:-]{1,64}$/

/** ชนิดไฟล์ (ค่าตรงกับ CHECK file_kind ของฐาน) */
export const FILE_KINDS = Object.freeze({
  bill_payment: { label: 'รายงานรับชำระ Bill Payment', hint: 'มีเลข Ref1 ของใบแจ้งชำระ — ระบบจับคู่ให้เองเมื่อ Ref1 และยอดตรง' },
  account: { label: 'รายการเงินเข้าบัญชี (พร้อมเพย์/โอน)', hint: 'ไม่มีเลขอ้างอิงของใบแจ้งชำระ — ระบบเสนอคู่ให้ เจ้าหน้าที่กดยืนยัน' },
})

// ── คอลัมน์ ──────────────────────────────────────────────────────────────────────────

/** ช่องที่จับคู่ได้ · key = ชื่อช่องใน mapping (ตัวเลข = ลำดับคอลัมน์ฐาน 0) */
export const MAPPING_FIELDS = Object.freeze([
  { key: 'date', label: 'วันที่', required: true },
  { key: 'time', label: 'เวลา', hint: 'ไม่บังคับ — ถ้าวันที่และเวลาอยู่ช่องเดียวกัน ไม่ต้องเลือก' },
  { key: 'amount', label: 'จำนวนเงิน', hint: 'ใช้ช่องนี้หรือ "เงินเข้า" อย่างใดอย่างหนึ่ง' },
  { key: 'credit', label: 'เงินเข้า (เครดิต)', hint: 'ไฟล์ที่แยกคอลัมน์เงินเข้า/เงินออก — แถวที่ว่างหรือไม่เกิน 0 จะถูกข้าม' },
  { key: 'ref1', label: 'Ref1', hint: 'เลขอ้างอิงของใบแจ้งชำระ' },
  { key: 'ref2', label: 'Ref2', hint: 'ไม่บังคับ — ระบบไม่เก็บค่านี้ไว้แสดง (ใช้ช่วยกันนำเข้าไฟล์ซ้ำเท่านั้น)' },
  { key: 'bankRef', label: 'เลขอ้างอิงธนาคาร', hint: 'เลขที่รายการ/Transaction ID ใช้กันนำเข้าซ้ำ — ต้องเป็นตัวอักษรละติน/ตัวเลขเท่านั้น (กันชื่อคนหลุดมาจากคอลัมน์ที่เลือกผิด)' },
])
const FIELD_KEYS = MAPPING_FIELDS.map(f => f.key)
/** ชื่อใน mapping ที่บันทึกขึ้นฐาน (คีย์ a-z0-9_ ตามที่ฐานบังคับ) */
const SAVED_KEY = Object.freeze({ date: 'date_col', time: 'time_col', amount: 'amount_col', credit: 'credit_col', ref1: 'ref1_col', ref2: 'ref2_col', bankRef: 'bank_ref_col' })

/**
 * หัวคอลัมน์ที่อาจมีชื่อ/เลขบัญชีผู้โอนหรือข้อความอิสระ — จับคู่ไม่ได้และไม่เดาให้ (PDPA)
 * "รายละเอียด/หมายเหตุ" รวมด้วย เพราะธนาคารมักเอาชื่อผู้โอนไปใส่ในช่องนี้
 */
const BLOCKED_HEADER = nfkc(/(ชื่อ|บัญชี|ผู้โอน|ผู้ส่ง|ผู้จ่าย|ผู้ชำระ|ผู้ฝาก|ผู้ทำรายการ|รายละเอียด|หมายเหตุ|name|account|acct|payer|payor|sender|remitter|depositor|description|detail|remark|memo|note|from)/)
/**
 * หัวคอลัมน์ "วันที่ลงบัญชี/Posting date/Value date" — ไม่ใช่วันที่ผู้ชำระทำรายการ (ธนาคารลงบัญชีช้ากว่า 1 วันทำการ หรือข้ามวันหยุด)
 * ใช้เป็นวันที่รับเงินแล้วเงินที่จ่ายทันวันหมดอายุจะถูกมองว่าจ่ายช้า (ผลตรวจ H-1) → เดาเลือกวันทำรายการก่อนเสมอ และเตือนบนจอถ้าต้องใช้วันลงบัญชี
 * ไม่ถือเป็นคอลัมน์ต้องห้ามแม้มีคำว่า "บัญชี" (เป็นวันที่ ไม่ใช่เลข/ชื่อบัญชี)
 */
const POSTING_DATE = nfkc(/^(วันที่ลงบัญชี|วันลงบัญชี|วันที่ผ่านรายการ|วันที่มีผล|วันที่ตีราคา|postingdate|postdate|valuedate|valdate|effectivedate|accountingdate)/)
export const isPostingDateHeader = header => POSTING_DATE.test(normalizeHeader(header))
export const isBlockedHeader = header => BLOCKED_HEADER.test(normalizeHeader(header)) && !isPostingDateHeader(header)

/** วันที่ที่เลือกเป็นวันลงบัญชี (ไม่ใช่วันทำรายการ) หรือไม่ — หน้าจอเตือนว่าเงินที่จ่ายวันหมดอายุอาจถูกมองว่าจ่ายช้า */
export const postingDateWarning = (headers, mapping) => {
  const idx = mapping?.cols?.date
  return Number.isInteger(idx) && idx >= 0 && idx < (headers?.length ?? 0) && isPostingDateHeader(headers[idx])
}

// ข้อความหัวคอลัมน์สำหรับแสดง/บันทึก: ไม่ผ่าน NFKC (NFKC แตก "ำ" เป็นสองตัวอักษร หัวคอลัมน์จะเพี้ยนบนจอ) — การเทียบใช้ normalizeHeader ที่ผ่าน NFKC ทั้งสองข้าง
// eslint-disable-next-line no-control-regex -- ตัดอักขระควบคุม/ช่องว่างความกว้างศูนย์ที่ติดมากับไฟล์ธนาคาร ตั้งใจให้ตรงช่วงนี้
const labelText = value => String(value ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, '').trim()
// eslint-disable-next-line no-control-regex -- เหตุผลเดียวกับ labelText
const cellText = value => String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, '').trim()

/** หัวคอลัมน์ที่แสดงให้เลือก: ว่าง = "คอลัมน์ N" */
export function headerLabels(matrix, headerRow) {
  const row = matrix?.[headerRow - 1] ?? []
  const width = Math.max(row.length, ...(matrix ?? []).slice(headerRow, headerRow + 50).map(r => r?.length ?? 0), 0)
  return Array.from({ length: width }, (_, i) => labelText(row[i]) || `คอลัมน์ ${i + 1}`)
}

// รูปแบบหัวตารางที่เดาได้ (หลัง normalizeHeader: ตัวพิมพ์เล็ก ตัดช่องว่าง _ - / ( ) .)
const NOT_CREDIT = nfkc(/(debit|ถอน|เงินออก|จ่ายออก|ยอดคงเหลือ|balance)/)
const NOT_AMOUNT = nfkc(/รายการ|ครั้ง|ธุรกรรม/)
const GUESS = Object.freeze({
  time: nfkc(/^(เวลา|time)/),
  date: nfkc(/^(วันที่|วัน|date|transactiondate|txndate|paymentdate|transferdate)/),
  credit: nfkc(/(เงินเข้า|เงินฝาก|ฝากเงิน|^ฝาก|credit|deposit|เครดิต)/),
  amount: nfkc(/^(จำนวนเงิน|ยอดเงิน|ยอดชำระ|จำนวน|amount|paidamount|paymentamount|txnamount|transactionamount)/),
  ref1: nfkc(/(ref|reference|อ้างอิง)(no|number)?1$/),
  ref2: nfkc(/(ref|reference|อ้างอิง)(no|number)?2$/),
  bankRef: nfkc(/(banktxnid|transactionid|txnid|transactionref|transref|traceno|เลขที่รายการ|รหัสรายการ|เลขที่ธุรกรรม|เลขอ้างอิงธนาคาร|หมายเลขอ้างอิง|referenceno|refno|^เลขอ้างอิง$|^เลขที่อ้างอิง$|^reference$)/),
})

/**
 * เดาคอลัมน์จากหัวตาราง (ไทย/อังกฤษ) → { date, time, amount, credit, ref1, ref2, bankRef } (ลำดับคอลัมน์ฐาน 0 หรือ null)
 * เป็นแค่ค่าเสนอให้คนยืนยัน · ไม่เดาคอลัมน์ที่หัวเป็นชื่อ/บัญชี/รายละเอียด · คอลัมน์หนึ่งใช้ได้ช่องเดียว
 * มีทั้ง "เงินเข้า" และ "จำนวนเงิน" = ใช้เงินเข้า (ใบแจ้งยอดมักมี เงินออก/เงินเข้า แยกกัน)
 */
export function guessMapping(headers) {
  const norm = (headers ?? []).map(h => normalizeHeader(h))
  const blocked = (headers ?? []).map(h => isBlockedHeader(h))
  const used = new Set()
  const pick = (test, skip) => {
    const i = norm.findIndex((h, idx) => h && !used.has(idx) && !blocked[idx] && test(h) && !(skip && skip(h)))
    if (i >= 0) used.add(i)
    return i >= 0 ? i : null
  }
  const out = { date: null, time: null, amount: null, credit: null, ref1: null, ref2: null, bankRef: null }
  out.time = pick(h => GUESS.time.test(h))
  // วันทำรายการ/วันที่ชำระมาก่อนเสมอ แม้วันลงบัญชีอยู่ซ้ายกว่า — เจอแค่วันลงบัญชีค่อยใช้ (หน้าจอเตือนด้วย postingDateWarning)
  out.date = pick(h => GUESS.date.test(h), h => POSTING_DATE.test(h)) ?? pick(h => POSTING_DATE.test(h))
  out.ref1 = pick(h => GUESS.ref1.test(h))
  out.ref2 = pick(h => GUESS.ref2.test(h))
  out.credit = pick(h => GUESS.credit.test(h), h => NOT_CREDIT.test(h))
  if (out.credit === null) out.amount = pick(h => GUESS.amount.test(h), h => NOT_CREDIT.test(h) || NOT_AMOUNT.test(h))
  out.bankRef = pick(h => GUESS.bankRef.test(h) && !GUESS.ref1.test(h) && !GUESS.ref2.test(h))
  return out
}

/** แถวหัวตาราง (1-based) = แถวแรกใน 15 แถวแรกที่มีหัววันที่และหัวยอดเงิน/เงินเข้าในแถวเดียวกัน · ไม่เจอ = 1 */
export function guessHeaderRow(matrix) {
  const limit = Math.min(15, matrix?.length ?? 0)
  for (let i = 0; i < limit; i += 1) {
    const g = guessMapping((matrix[i] ?? []).map(cellText))
    if (g.date !== null && (g.amount !== null || g.credit !== null)) return i + 1
  }
  return 1
}

/** mapping ที่เก็บในฐาน (payment_settings.bank_file_mapping[kind]) → mapping ของหน้าจอ · หัวคอลัมน์เปลี่ยน/หาไม่เจอ = ช่องนั้นว่าง (ให้คนเลือกใหม่) */
export function resolveSavedMapping(saved, matrix) {
  if (!saved || typeof saved !== 'object') return null
  const headerRow = Number(saved.header_row)
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > (matrix?.length ?? 0)) return null
  const headers = headerLabels(matrix, headerRow)
  const norm = headers.map(h => normalizeHeader(h))
  const cols = {}
  for (const key of FIELD_KEYS) {
    const ref = saved[SAVED_KEY[key]]
    let idx = null
    if (typeof ref === 'string' && /^#\d{1,3}$/.test(ref)) idx = Number(ref.slice(1)) - 1
    else if (typeof ref === 'string' && ref) idx = norm.findIndex(h => h && h === normalizeHeader(ref))
    cols[key] = Number.isInteger(idx) && idx >= 0 && idx < headers.length && !isBlockedHeader(headers[idx]) ? idx : null
  }
  return { headerRow, cols }
}

/** mapping ของหน้าจอ → ก้อนที่บันทึกขึ้นฐาน: เก็บ "ข้อความหัวคอลัมน์" (หัวว่าง = #ลำดับ) ไม่เก็บค่าในไฟล์ · ไม่มีช่องที่เป็นชื่อ/บัญชีอยู่แล้ว (validateMapping กั้น) */
export function mappingToSaved(mapping, headers) {
  const out = { header_row: mapping.headerRow }
  for (const key of FIELD_KEYS) {
    const idx = mapping.cols?.[key]
    if (!Number.isInteger(idx) || idx < 0) continue
    const text = labelText(headers[idx])
    out[SAVED_KEY[key]] = !text || /^คอลัมน์ \d+$/.test(text) ? `#${idx + 1}` : text.slice(0, 100)
  }
  return out
}

/** ตรวจการจับคู่ → ข้อความไทยของข้อผิดพลาดแรก หรือ '' */
export function validateMapping(mapping, headers) {
  const cols = mapping?.cols ?? {}
  const has = key => Number.isInteger(cols[key]) && cols[key] >= 0
  if (!Number.isInteger(mapping?.headerRow) || mapping.headerRow < 1) return 'เลือกแถวที่เป็นหัวตาราง'
  if (!has('date')) return 'เลือกคอลัมน์วันที่'
  if (!has('amount') && !has('credit')) return 'เลือกคอลัมน์จำนวนเงิน หรือคอลัมน์เงินเข้า'
  if (has('amount') && has('credit')) return 'เลือกคอลัมน์ยอดเงินเพียงแบบเดียว (จำนวนเงิน หรือ เงินเข้า)'
  const seen = new Set()
  for (const key of FIELD_KEYS) {
    if (!has(key)) continue
    const idx = cols[key]
    if (idx >= headers.length) return 'คอลัมน์ที่เลือกไม่อยู่ในไฟล์นี้'
    if (isBlockedHeader(headers[idx])) return `คอลัมน์ "${headers[idx]}" อาจมีชื่อหรือเลขบัญชีผู้โอน — ระบบไม่รับข้อมูลส่วนนี้ เลือกคอลัมน์อื่น`
    if (seen.has(idx)) return `คอลัมน์ "${headers[idx]}" ถูกเลือกซ้ำกันสองช่อง`
    seen.add(idx)
  }
  return ''
}

// ── วันที่ ──────────────────────────────────────────────────────────────────────────

const pad2 = n => String(n).padStart(2, '0')
const isoOf = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`

function validDate(y, m, d) {
  if (!(y >= 1900 && y <= 2999) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** เลขลำดับวันของ Excel → { date, time } (ฐาน 1899-12-30) · นอกช่วงปี 2000–2099 = null (ไม่เดา) */
function excelSerial(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 36526 || n >= 73415) return null
  const whole = Math.floor(n)
  const dt = new Date(Date.UTC(1899, 11, 30 + whole))
  const seconds = Math.round((n - whole) * 86400)
  const time = seconds > 0 && seconds < 86400 ? `${pad2(Math.floor(seconds / 3600))}:${pad2(Math.floor((seconds % 3600) / 60))}:${pad2(seconds % 60)}` : null
  return { date: isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()), time }
}

/** เวลา → 'HH:MM:SS' | null · รับ HH:MM[:SS] [น.], เลขเศษส่วนวันของ Excel (0 ≤ x < 1), HHMM / HHMMSS ล้วน */
export function parseBankTime(value) {
  const text = cellText(value).replace(/\s*น\.?$/, '')
  if (!text) return null
  let h; let mi; let s
  let m = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/)
  if (m) { h = Number(m[1]); mi = Number(m[2]); s = Number(m[3] ?? 0) } else if ((m = text.match(/^(\d{2})(\d{2})(\d{2})?$/))) {
    h = Number(m[1]); mi = Number(m[2]); s = Number(m[3] ?? 0)
  } else if (/^0?\.\d+$|^0\.\d+$/.test(text)) {
    const seconds = Math.round(Number(text) * 86400)
    if (!(seconds >= 0 && seconds < 86400)) return null
    h = Math.floor(seconds / 3600); mi = Math.floor((seconds % 3600) / 60); s = seconds % 60
  } else return null
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59)) return null
  return `${pad2(h)}:${pad2(mi)}:${pad2(s)}`
}

/**
 * วันที่ (+เวลาในช่องเดียวกันถ้ามี) → { date: 'YYYY-MM-DD', time: 'HH:MM:SS'|null, shortYear } หรือ { error }
 * รับ dd/mm/yyyy · d/m/yy · yyyy-mm-dd · yyyy/mm/dd · ปี พ.ศ. (> 2400 ลบ 543) · เลขลำดับวันของ Excel · วันที่+เวลาช่องเดียว (เว้นวรรคหรือ T)
 * ปี 2 หลัก = 20yy (ไม่เดาเป็น พ.ศ.) แล้วให้ด่านช่วงวันที่ตัดสิน · รูปแบบอื่น = error (ไม่เดา)
 */
export function parseBankDate(value) {
  const text = cellText(value)
  if (!text) return { error: 'ไม่มีวันที่' }
  if (/^\d+(\.\d+)?$/.test(text) && Number(text) >= 20000) {
    const serial = excelSerial(text)
    return serial ? { ...serial, shortYear: false } : { error: `อ่านวันที่ "${text}" ไม่ได้` }
  }
  const [datePart, ...rest] = text.split(/[\sT]+/)
  const timePart = rest.join(' ')
  let y; let mo; let d; let shortYear = false
  let m = datePart.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (m) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]) } else if ((m = datePart.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/))) {
    d = Number(m[1]); mo = Number(m[2]); y = Number(m[3])
    if (m[3].length === 2) { y += 2000; shortYear = true }
  } else return { error: `อ่านวันที่ "${text.slice(0, 40)}" ไม่ได้ (รูปแบบไม่รู้จัก)` }
  if (y > 2400) y -= 543
  if (!validDate(y, mo, d)) return { error: `วันที่ "${text.slice(0, 40)}" ไม่ถูกต้อง` }
  let time = null
  if (timePart) {
    time = parseBankTime(timePart)
    if (!time) return { error: `อ่านเวลา "${timePart.slice(0, 20)}" ไม่ได้` }
  }
  return { date: isoOf(y, mo, d), time, shortYear }
}

// ── ยอดเงิน ──────────────────────────────────────────────────────────────────────────

/**
 * ยอด → { amount: '1234.50' } | { skip: 'ไม่ใช่เงินเข้า' } | { error }
 * ตัด , ฿ บาท THB และช่องว่าง · ทศนิยมเกิน 2 ตำแหน่ง (ที่ไม่ใช่ศูนย์) = error · ≤ 0 = ไม่ใช่เงินเข้า
 */
export function parseBankAmount(value) {
  const text = cellText(value).replace(/[,฿\s]/g, '').replace(/(บาท|thb)$/i, '').replace(/^\+/, '')
  if (!text) return { skip: 'ไม่ใช่เงินเข้า' }
  if (/^\(.*\)$/.test(text) || text.startsWith('-')) return { skip: 'ไม่ใช่เงินเข้า' }
  const m = text.match(/^(\d{1,12})(?:\.(\d+))?$/)
  if (!m) return { error: `อ่านยอดเงิน "${text.slice(0, 30)}" ไม่ได้` }
  const frac = m[2] ?? ''
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) return { error: `ยอดเงิน "${text.slice(0, 30)}" มีทศนิยมเกิน 2 ตำแหน่ง` }
  const whole = m[1].replace(/^0+(?=\d)/, '')
  const amount = `${whole}.${(frac + '00').slice(0, 2)}`
  const num = Number(amount)
  if (!(num > 0)) return { skip: 'ไม่ใช่เงินเข้า' }
  if (num > MAX_AMOUNT) return { error: 'ยอดเงินเกิน 10 ล้านบาท' }
  return { amount }
}

// ── แปลงทั้งไฟล์ ────────────────────────────────────────────────────────────────────

/** วันนี้ตามเวลาไทย (ค่าเริ่มต้นของด่านช่วงวันที่) */
function bangkokToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
const dayNumber = iso => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000)

/**
 * matrix + การจับคู่คอลัมน์ → { rows, lines, skipped, dataRows }
 *   rows    แถวที่ส่งขึ้นฐานได้ [{ txn_at, amount, ref1, ref2, bank_ref }] (ไม่มีชื่อ/บัญชี — อ่านเฉพาะคอลัมน์ที่จับคู่)
 *   lines   ลำดับแถวในไฟล์ (นับจาก 1 ไม่รวมแถวว่าง) ของ rows แต่ละตัว — ไว้แปล "แถวที่ N" ที่ฐานแจ้งกลับ
 *   skipped [{ line, reason }] แถวที่ข้ามพร้อมเหตุผล · dataRows จำนวนแถวหลังหัวตาราง
 * ผิดช่วง (อนาคต / เก่ากว่า 400 วัน) = ข้ามพร้อมเหตุผล (ฐานจะปฏิเสธทั้งไฟล์ถ้าส่งไป)
 * @param {{ headerRow: number, cols: Record<string, number|null> }} mapping
 */
export function parseBankRows(matrix, mapping, { today = bangkokToday() } = {}) {
  const cols = mapping?.cols ?? {}
  const col = key => (Number.isInteger(cols[key]) && cols[key] >= 0 ? cols[key] : null)
  const rows = []
  const lines = []
  const skipped = []
  const body = (matrix ?? []).slice(mapping?.headerRow ?? 1)
  const todayNo = dayNumber(today)
  const amountCol = col('credit') ?? col('amount')
  const isCredit = col('credit') !== null

  body.forEach((raw, i) => {
    const line = (mapping?.headerRow ?? 1) + i + 1
    const row = raw ?? []
    const dateCell = col('date') === null ? '' : row[col('date')]
    const amountCell = amountCol === null ? '' : row[amountCol]
    if (!cellText(dateCell) && !cellText(amountCell)) { skipped.push({ line, reason: 'ไม่มีวันที่และยอดเงิน' }); return }

    const amount = parseBankAmount(amountCell)
    if (amount.skip) { skipped.push({ line, reason: !cellText(amountCell) ? (isCredit ? 'ไม่ใช่เงินเข้า (ช่องเงินเข้าว่าง)' : 'ไม่มียอดเงิน') : amount.skip }); return }
    if (amount.error) { skipped.push({ line, reason: amount.error }); return }

    const date = parseBankDate(dateCell)
    if (date.error) { skipped.push({ line, reason: date.error }); return }
    let time = date.time
    if (col('time') !== null && cellText(row[col('time')])) {
      const t = parseBankTime(row[col('time')])
      if (!t) { skipped.push({ line, reason: `อ่านเวลา "${cellText(row[col('time')]).slice(0, 20)}" ไม่ได้` }); return }
      time = t
    }
    const dayNo = dayNumber(date.date)
    if (dayNo > todayNo) { skipped.push({ line, reason: `วันที่ ${date.date} เป็นวันในอนาคต${date.shortYear ? ' (ปี 2 หลัก อ่านเป็น ค.ศ. — ถ้าเป็น พ.ศ. ให้แก้ไฟล์เป็นปี 4 หลัก)' : ' (ปีเป็น พ.ศ. หรือเปล่า?)'}` }); return }
    if (todayNo - dayNo > MAX_AGE_DAYS) { skipped.push({ line, reason: `วันที่ ${date.date} เก่ากว่า ${MAX_AGE_DAYS} วัน — ระบบรับย้อนหลังไม่เกินนี้` }); return }

    const ref1 = col('ref1') === null ? '' : cellText(row[col('ref1')]).replace(/[\s-]/g, '')
    if (ref1 && !/^\d{1,20}$/.test(ref1)) { skipped.push({ line, reason: `Ref1 "${ref1.slice(0, 24)}" ไม่ใช่ตัวเลข 1–20 หลัก (เลขใน Excel อาจถูกแปลงเป็น 1.23E+11)` }); return }
    const ref2 = col('ref2') === null ? '' : cellText(row[col('ref2')]).replace(/[\s-]/g, '')
    if (ref2 && !/^[0-9A-Za-z]{1,20}$/.test(ref2)) { skipped.push({ line, reason: `Ref2 "${ref2.slice(0, 24)}" รูปแบบไม่ถูกต้อง` }); return }
    // ฐานรับเลขอ้างอิงธนาคารเฉพาะ A-Z a-z 0-9 / _ . : - (ยาว 1–64) — ข้อความไทย/ชื่อคน = เลือกคอลัมน์ผิด ข้ามแถวและบอกเหตุผล ไม่ส่งขึ้นฐาน (PDPA)
    const bankRef = col('bankRef') === null ? '' : cellText(row[col('bankRef')]).replace(/\s+/g, '')
    if (bankRef.length > 64) { skipped.push({ line, reason: 'เลขอ้างอิงธนาคารยาวเกิน 64 ตัว' }); return }
    if (bankRef && !BANK_REF_RE.test(bankRef)) { skipped.push({ line, reason: 'เลขอ้างอิงธนาคารมีตัวอักษรที่ไม่ใช่ละติน/ตัวเลข — ตรวจว่าเลือกคอลัมน์ถูก (ห้ามเลือกคอลัมน์ที่มีชื่อ)' }); return }

    rows.push({
      txn_at: time ? `${date.date} ${time}` : date.date,
      amount: amount.amount,
      ref1: ref1 || null,
      ref2: ref2 || null,
      bank_ref: bankRef || null,
    })
    lines.push(line)
  })
  return { rows, lines, skipped, dataRows: body.length }
}

/**
 * แบ่งชุดละ ≤ 5,000 แถวตามที่ฐานรับ (ข้อจำกัดต่อครั้ง)
 * ⚠️ ฐานกันซ้ำด้วยลำดับที่ของ "แถวที่เหมือนกันทุกช่อง" ภายในการนำเข้าครั้งเดียว — ถ้าแถวเหมือนกันถูกแบ่งคนละชุด จะชนกันเองแล้วหายเงียบ
 * จึงเรียงตามเวลาที่เงินเข้า (คงลำดับเดิมของแถวเหมือนกัน) แล้วตัดเฉพาะรอยต่อที่เวลาเปลี่ยน — แถวเหมือนกันอยู่ชุดเดียวกันเสมอ
 * @returns {Array<{ rows: object[], lines: number[] }>}
 */
export function chunkBankRows(rows, lines, size = MAX_IMPORT_ROWS) {
  const order = rows.map((row, i) => ({ row, line: lines?.[i] ?? i + 1, i }))
    .sort((a, b) => (a.row.txn_at < b.row.txn_at ? -1 : a.row.txn_at > b.row.txn_at ? 1 : a.i - b.i))
  const chunks = []
  let start = 0
  while (start < order.length) {
    let end = Math.min(start + size, order.length)
    if (end < order.length) {
      let cut = end
      while (cut > start && order[cut].row.txn_at === order[cut - 1].row.txn_at) cut -= 1
      if (cut > start) end = cut // ถ้ากลุ่มเวลาเดียวกันเกินชุดทั้งชุด (ไม่น่าเกิดจริง) ตัดตรงขีดจำกัด
    }
    const part = order.slice(start, end)
    chunks.push({ rows: part.map(p => p.row), lines: part.map(p => p.line) })
    start = end
  }
  return chunks
}

/** ข้อความผิดพลาดจากฐานที่บอก "แถวที่ N" (ลำดับในชุดที่ส่ง) → เติมลำดับแถวในไฟล์ให้คนไปแก้ถูกที่ */
export function explainRowError(message, lines) {
  const text = String(message ?? '')
  const m = text.match(/แถวที่ (\d+)/)
  const line = m ? lines?.[Number(m[1]) - 1] : null
  return line ? `${text} (อยู่ที่แถวที่ ${line} ของไฟล์ ไม่นับแถวว่าง)` : text
}

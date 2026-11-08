// อ่านตารางข้อความ (CSV / TSV / ข้อความที่คัดลอกจาก Excel-Word) เป็นแถว×คอลัมน์ — ใช้ซ้ำได้ทุกโมดูลที่มีเมนูนำเข้า
//
// หลักความปลอดภัย: ไม่ eval อะไรทั้งสิ้น ทุกค่าเป็นข้อความล้วน (string) ไม่ตีความสูตร
// ⚠️ ผู้เรียกต้องแสดงผลผ่าน React / esc() เท่านั้น และถ้าอนาคตส่งออกกลับเป็น CSV ต้องกันสูตรที่ขึ้นต้นด้วย = + - @
//    (CSV injection) ไฟล์นี้อ่านอย่างเดียว ไม่เขียน CSV
// ไม่รู้จักไฟล์ .xlsx (เป็น zip) — ให้ผู้ใช้บันทึกเป็น CSV หรือคัดลอกตารางมาวาง

/** ขนาดไฟล์ข้อความสูงสุดที่ยอมอ่าน */
export const MAX_BYTES = 2 * 1024 * 1024
/** จำนวนแถวสูงสุดที่ parse (เกินตัดทิ้งแล้วแจ้ง truncated) — กันไฟล์ใหญ่ค้างเบราว์เซอร์ */
export const MAX_ROWS = 2000

// ── ถอดรหัสไบต์ ─────────────────────────────────────────────────────────────

/**
 * ไบต์ของไฟล์ → ข้อความ · ลอง UTF-8 แบบเข้มงวดก่อน ไม่ผ่าน (ไฟล์ CSV ภาษาไทยจาก Excel เก่ามักเป็น TIS-620)
 * ใช้ windows-874 · ไฟล์ UTF-16 (Excel "Unicode Text") มี BOM ให้ถอดตาม BOM · ตัด BOM ออกเสมอ
 * คืน { text, encoding } · เกินขนาด / ไม่ใช่ไฟล์ข้อความ → throw Error ข้อความไทย
 */
export function decodeTextBytes(input) {
  const bytes = input instanceof Uint8Array
    ? input
    : ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input)
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(`ไฟล์ใหญ่เกิน ${MAX_BYTES / 1024 / 1024} MB — แบ่งเป็นหลายไฟล์หรือตัดแถวที่ไม่ใช้ออกก่อน`)
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: stripBom(new TextDecoder('utf-16le').decode(bytes)), encoding: 'utf-16le' }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: stripBom(new TextDecoder('utf-16be').decode(bytes)), encoding: 'utf-16be' }
  }
  // ไฟล์ไบนารี (xlsx/zip/pdf/รูป) มีไบต์ 0 ปนเสมอ — ถอดเป็น windows-874 ไม่มีวัน "ไม่ผ่าน" จึงต้องกันก่อน ไม่งั้นได้ขยะเงียบๆ
  const probe = Math.min(bytes.length, 8192)
  for (let i = 0; i < probe; i++) {
    if (bytes[i] === 0) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์ข้อความ (.csv / .txt) — ถ้าเป็น Excel ให้บันทึกเป็น CSV หรือคัดลอกตารางมาวาง')
  }
  try {
    return { text: stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), encoding: 'utf-8' }
  } catch {
    return { text: stripBom(new TextDecoder('windows-874').decode(bytes)), encoding: 'windows-874' }
  }
}

const stripBom = s => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

// ── แยกเครื่องหมายคั่น ───────────────────────────────────────────────────────

const CANDIDATE_DELIMITERS = ['\t', ',', ';']
const DETECT_ROWS = 20

/**
 * เดาตัวคั่น: นับจำนวนช่องต่อแถว "นอกเครื่องหมายคำพูด" ใน DETECT_ROWS แถวแรก แล้วเลือกตัวที่ให้จำนวนช่องเท่ากันบ่อยที่สุด
 * (ต้อง > 1 ช่อง; เสมอกันเลือกตัวที่ได้ช่องมากกว่า แล้วลำดับ tab > , > ;) — ข้อความจาก clipboard ของ Excel/Word เป็น tab
 * แถวชื่อเรื่องที่มีช่องเดียวไม่ถูกนับ ไม่งั้นทุกตัวคั่นเสมอกันหมด · ไม่เจอตัวไหนเลยคืน ','
 */
export function detectDelimiter(text) {
  let best = null
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const { rows } = scanRows(String(text ?? ''), delimiter, DETECT_ROWS)
    const counts = new Map()
    for (const r of rows) if (r.length > 1) counts.set(r.length, (counts.get(r.length) || 0) + 1)
    let modal = 0
    let freq = 0
    for (const [cols, n] of counts) if (n > freq || (n === freq && cols > modal)) { modal = cols; freq = n }
    if (freq === 0) continue
    if (!best || freq > best.freq || (freq === best.freq && modal > best.modal)) best = { delimiter, freq, modal }
  }
  return best ? best.delimiter : ','
}

// ── parser (RFC 4180) ───────────────────────────────────────────────────────

/**
 * สแกนข้อความเป็นแถว — เครื่องหมายคำพูดเปิดได้เฉพาะ "ต้นช่อง" ("" ข้างในคือคำพูดหนึ่งตัว) ส่วนคำพูดกลางช่องถือเป็นตัวอักษรธรรมดา
 * newline ในช่องที่มีคำพูดเป็นส่วนของช่อง · CRLF / LF / CR ได้หมด · maxRows: หยุดเมื่อครบจำนวนแถว (truncated = ยังมีข้อมูลเหลือ)
 */
function scanRows(text, delimiter, maxRows) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let quoted = false // ช่องนี้เปิดด้วยคำพูด (ช่อง "" ว่างต้องนับเป็นช่อง ไม่ใช่ไม่มีช่อง)
  let truncated = false
  let i = 0
  for (; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"' && field === '' && !quoted) { inQuotes = true; quoted = true; continue }
    if (c === delimiter) { row.push(field); field = ''; quoted = false; continue }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []; field = ''; quoted = false
      if (rows.length >= maxRows && text.slice(i + 1).trim() !== '') { truncated = true; break }
      continue
    }
    field += c
  }
  const unclosedQuote = inQuotes
  if (!truncated && (field !== '' || row.length > 0 || quoted)) { row.push(field); rows.push(row) }
  return { rows, truncated, unclosedQuote }
}

/**
 * ข้อความ → { rows: string[][], delimiter, truncated, warnings: string[] }
 * ไม่ throw กับข้อมูลเสีย (คำพูดไม่ปิด → warning) · บรรทัดว่างท้ายข้อความตัดทิ้ง · เกิน MAX_ROWS ตัดแล้ว truncated = true
 * ช่องที่ได้เป็นข้อความดิบ (ยังไม่ normalizeCell) — ให้ผู้เรียกเรียก normalizeCell เองตอนใช้
 */
export function parseDelimited(text, { delimiter } = {}) {
  const source = stripBom(String(text ?? ''))
  const used = delimiter || detectDelimiter(source)
  const { rows, truncated, unclosedQuote } = scanRows(source, used, MAX_ROWS)
  while (rows.length && rows[rows.length - 1].every(c => c === '')) rows.pop()
  const warnings = []
  if (unclosedQuote) warnings.push('พบเครื่องหมายคำพูด (") ที่ไม่ได้ปิด — ข้อความหลังจุดนั้นถูกรวมเป็นช่องเดียว ตรวจแถวท้ายๆ ของไฟล์')
  if (truncated) warnings.push(`ไฟล์มีมากกว่า ${MAX_ROWS} แถว — อ่านเฉพาะ ${MAX_ROWS} แถวแรก`)
  return { rows, delimiter: used, truncated, warnings }
}

// ── ทำความสะอาดตาราง ────────────────────────────────────────────────────────

/** ล้างช่อง: NBSP / ช่องว่างพิเศษ→ช่องว่าง, ZWSP/BOM ลบทิ้ง, newline/tab ในช่อง→ช่องว่างเดียว, ยุบช่องว่างซ้ำ, trim */
export function normalizeCell(s) {
  return String(s ?? '')
    .replace(/[\u{200B}\u{200C}\u{2060}]|\u{200D}|\u{FEFF}/gu, '')
    .replace(/[\u{00A0}\u{2007}\u{202F}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** เติมช่องว่างท้ายแถวให้ทุกแถวยาวเท่าแถวที่ยาวที่สุด (ไม่แก้อาร์เรย์เดิม) */
export function padRows(rows) {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  return rows.map(r => (r.length >= width ? r.slice() : [...r, ...Array(width - r.length).fill('')]))
}

const isEmptyCell = c => normalizeCell(c) === ''

/** ตัดแถวที่ทุกช่องว่างทิ้ง (เลขแถวของเดิมเลื่อน — ถ้าต้องอ้างเลขแถวในไฟล์ อย่าเรียกก่อนทำพรีวิว) */
export function dropEmptyRows(rows) {
  return rows.filter(r => !r.every(isEmptyCell))
}

/** ตัดคอลัมน์ที่ทุกแถวว่างทิ้ง (index คอลัมน์เลื่อน — ทำ mapping หลังตัด ไม่ใช่ก่อน) */
export function dropEmptyColumns(rows) {
  const padded = padRows(rows)
  if (!padded.length) return padded
  const keep = []
  for (let c = 0; c < padded[0].length; c++) if (!padded.every(r => isEmptyCell(r[c]))) keep.push(c)
  return padded.map(r => keep.map(c => r[c]))
}

// ── หัวตาราง ────────────────────────────────────────────────────────────────

/**
 * หาแถวหัวตารางใน maxScan แถวแรก — ไฟล์จริงมักมีชื่อเรื่อง/ปกอยู่ข้างบน
 * scoreFn(row, index) → คะแนน ; คืน index ของแถวคะแนนสูงสุด (เท่ากันเอาแถวบนสุด) · ไม่มีแถวไหนคะแนน > 0 คืน -1
 */
export function findHeaderRow(rows, scoreFn, maxScan = 15) {
  let bestIndex = -1
  let best = 0
  const limit = Math.min(rows.length, maxScan)
  for (let i = 0; i < limit; i++) {
    const score = scoreFn(rows[i], i)
    if (score > best) { best = score; bestIndex = i }
  }
  return bestIndex
}

/**
 * รวมหัวตารางหลายแถว (เช่น แถวไตรมาส + แถวเดือน) เป็นข้อความเดียวต่อคอลัมน์ — ต่อด้วยช่องว่าง ข้ามช่องว่างและข้อความซ้ำติดกัน
 * rows[idx .. idx+count-1] ; คืน string[] ยาวเท่าแถวที่ยาวที่สุดในช่วงนั้น
 */
export function mergeHeaderRows(rows, idx, count = 1) {
  const slice = rows.slice(idx, idx + Math.max(1, count))
  const width = slice.reduce((w, r) => Math.max(w, r.length), 0)
  const out = []
  for (let c = 0; c < width; c++) {
    const parts = []
    for (const r of slice) {
      const cell = normalizeCell(r[c])
      if (cell && parts[parts.length - 1] !== cell) parts.push(cell)
    }
    out.push(parts.join(' '))
  }
  return out
}

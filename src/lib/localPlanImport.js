// นำเข้า "ฉบับร่างแผนการดำเนินงาน" จากตาราง (CSV / ข้อความที่คัดลอกจาก Excel) → รายการพรีวิวพร้อมบันทึก local_op_plan_items
//
// ไฟล์นี้อ่านตารางที่ tabularImport.js แยกเป็นแถวแล้ว: เดาคอลัมน์จากหัวตาราง, แปลงงบ/ลำดับ/เดือน, จับคู่กอง+โครงการกับทะเบียน
// ไม่ throw กับข้อมูลเสีย — ทุกอย่างที่อ่านไม่ได้กลายเป็น errors/warnings ของแถวนั้น ให้เจ้าหน้าที่เห็นแล้วแก้ก่อนยืนยัน
// ระบบ "เตรียมให้ คนตรวจแล้วกดยืนยันครั้งเดียว" — ไม่บันทึกอะไรเอง
//
// ความปลอดภัย: ข้อความทุกช่องถูกเก็บเป็นข้อความล้วน ไม่ตีความสูตร ไม่ eval ; แสดงผลผ่าน React / esc() เท่านั้น
// ⚠️ ถ้าในอนาคตส่งออกเป็น CSV ต้องกันสูตรที่ขึ้นต้นด้วย = + - @ (CSV injection)
import { findHeaderRow, normalizeCell } from './tabularImport.js'
import { parseMonthSpan, parseMonthToken, toAsciiDigits, validateSpan } from './localPlanCalendar.js'

// ── ขีดจำกัด (ต้องตรง CHECK / ชนิดคอลัมน์ของ local_op_plan_items — tests/local-plan-import.test.mjs เทียบกับ migration) ──
export const LIMITS = {
  itemNameMax: 1000,   // CHECK length(btrim(item_name)) BETWEEN 1 AND 1000
  noteMax: 2000,       // CHECK length(note) <= 2000
  seqMin: 1,           // CHECK seq_no BETWEEN 1 AND 9999
  seqMax: 9999,
  amountPrecision: 15, // numeric(15, 2) → ก่อนจุดทศนิยมได้ 13 หลัก
  amountScale: 2,
  monthMin: 1,         // CHECK month_from BETWEEN 1 AND 12 (เดือนที่ของปีงบ)
  monthMax: 12,
}
const AMOUNT_INT_DIGITS = LIMITS.amountPrecision - LIMITS.amountScale

// ── คอลัมน์ที่นำเข้าได้ ─────────────────────────────────────────────────────
// synonyms เทียบหลัง normalizeHeader (ลบช่องว่าง/จุด, เลขไทย→อารบิก, ตัวพิมพ์เล็ก)
export const IMPORT_FIELDS = [
  { key: 'seq_no', label: 'ลำดับที่', synonyms: ['ที่', 'ลำดับ', 'ลำดับที่', 'no', 'no.'] },
  {
    key: 'item_name', label: 'ชื่อโครงการ/กิจกรรม',
    synonyms: ['โครงการ', 'ชื่อโครงการ', 'โครงการ/กิจกรรม', 'ชื่อโครงการ/กิจกรรม', 'ชื่อกิจกรรม', 'กิจกรรม', 'รายการ'],
  },
  {
    key: 'amount', label: 'งบประมาณ (บาท)',
    synonyms: ['งบประมาณ', 'งบประมาณ(บาท)', 'จำนวนเงิน', 'จำนวนเงิน(บาท)', 'วงเงิน', 'วงเงินงบประมาณ'],
  },
  {
    key: 'department', label: 'ผู้รับผิดชอบ (กอง)',
    synonyms: ['ผู้รับผิดชอบ', 'หน่วยงานรับผิดชอบ', 'หน่วยงานที่รับผิดชอบ', 'หน่วยดำเนินการ', 'ส่วนราชการ', 'กอง'],
  },
  { key: 'note', label: 'หมายเหตุ', synonyms: ['หมายเหตุ'] },
  { key: 'month_from', label: 'เดือนเริ่ม', synonyms: ['เดือนเริ่ม', 'เดือนเริ่มต้น'] },
  { key: 'month_to', label: 'เดือนสิ้นสุด', synonyms: ['เดือนสิ้นสุด', 'เดือนสุดท้าย'] },
  {
    key: 'period_text', label: 'ระยะเวลา (ข้อความ)',
    synonyms: ['ระยะเวลา', 'ระยะเวลาดำเนินการ', 'ช่วงเวลา', 'ช่วงเวลาดำเนินการ'],
  },
]
const FIELD_KEYS = new Set(IMPORT_FIELDS.map(f => f.key))

/** หัวตาราง/ชื่อคอลัมน์ → รูปเทียบ : ลบช่องว่างทุกชนิดกับจุด/จุดคู่ เลขไทย→อารบิก ตัวพิมพ์เล็ก */
function normalizeHeader(s) {
  return toAsciiDigits(normalizeCell(s)).replace(/[\s.:*]/g, '').toLowerCase()
}

const SYNONYMS = IMPORT_FIELDS.flatMap(f => f.synonyms.map(s => ({ key: f.key, syn: normalizeHeader(s) })))
// synonym สั้นกว่านี้ใช้ได้เฉพาะตรงตัว ('ที่' เป็นส่วนของ "หน่วยงานที่รับผิดชอบ" / "สถานที่")
const CONTAINS_MIN_LEN = 4

/** คะแนนความตรงของหัวคอลัมน์กับแต่ละ field : ตรงตัว = 1000+ความยาว · มี synonym อยู่ในข้อความ (ยาวพอ) = ความยาว synonym */
function fieldScores(header, { exactOnly = false } = {}) {
  const h = normalizeHeader(header)
  const scores = {}
  if (!h) return scores
  for (const { key, syn } of SYNONYMS) {
    let s = 0
    if (h === syn) s = 1000 + syn.length
    else if (!exactOnly && syn.length >= CONTAINS_MIN_LEN && h.includes(syn)) s = syn.length
    if (s > (scores[key] || 0)) scores[key] = s
  }
  return scores
}

const QUARTER_PREFIX = /^(?:ไตรมาส(?:ที่)?|q)\s*[1-4]\s*/i

/** หัวคอลัมน์เป็นชื่อเดือน → เดือนที่ของปีงบ (1–12) หรือ null · รับ 'ต.ค.' 'ต.ค.68' 'ตุลาคม' และที่มีไตรมาสนำหน้า (หัว 2 แถวที่รวมแล้ว) */
function monthOfHeader(header) {
  const t = toAsciiDigits(normalizeCell(header)).replace(QUARTER_PREFIX, '')
  const token = parseMonthToken(t)
  return token ? token.fiscalMonth : null
}

/**
 * เดาการจับคู่คอลัมน์จากหัวตาราง (headerCells = ข้อความหัวต่อคอลัมน์ ผ่าน mergeHeaderRows แล้วถ้าหัว 2 แถว)
 * → { mapping: { [colIndex]: fieldKey }, monthColumns: { [colIndex]: fiscalMonth } }
 *   monthColumns มีค่าก็ต่อเมื่อเจอหัวเดือนครบ 12 เดือน (เจอเดือนซ้ำใช้ตัวซ้ายสุด)
 *   ห้าม map field เดียวกันสองคอลัมน์ : เลือกคอลัมน์ที่ตรงกว่า (ตรงตัว > มีคำอยู่ในข้อความ; เท่ากันเอาซ้ายสุด)
 */
export function guessMapping(headerCells) {
  const cells = Array.isArray(headerCells) ? headerCells : []
  const monthByCol = {}
  const seenMonths = new Set()
  cells.forEach((cell, col) => {
    const fm = monthOfHeader(cell)
    if (fm !== null && !seenMonths.has(fm)) { seenMonths.add(fm); monthByCol[col] = fm }
  })
  const monthColumns = seenMonths.size === 12 ? monthByCol : {}

  // แต่ละคอลัมน์ (ที่ไม่ใช่คอลัมน์เดือน) เลือก field ที่คะแนนสูงสุด แล้วให้แต่ละ field เก็บคอลัมน์ที่คะแนนสูงสุดเพียงตัวเดียว
  const bestForField = {}
  cells.forEach((cell, col) => {
    if (col in monthColumns) return
    const scores = fieldScores(cell)
    let key = null
    let top = 0
    for (const [k, s] of Object.entries(scores)) if (s > top) { top = s; key = k }
    if (key && (!bestForField[key] || top > bestForField[key].score)) bestForField[key] = { col, score: top }
  })
  const mapping = {}
  for (const [key, { col }] of Object.entries(bestForField)) mapping[col] = key
  return { mapping, monthColumns }
}

/** คะแนนแถวหัวตาราง (ใช้กับ findHeaderRow) : field ที่ตรงตัวไม่ซ้ำ ×2 + จำนวนเดือนที่ต่างกัน — นับเฉพาะตรงตัว ไม่งั้นชื่อโครงการที่มีคำว่า "โครงการ" จะดูเหมือนหัว */
export function headerScore(row) {
  const fields = new Set()
  const months = new Set()
  for (const cell of row || []) {
    const fm = monthOfHeader(cell)
    if (fm !== null) { months.add(fm); continue }
    const scores = fieldScores(cell, { exactOnly: true })
    for (const k of Object.keys(scores)) fields.add(k)
  }
  return fields.size * 2 + months.size
}

const countFields = row => {
  const s = new Set()
  for (const cell of row || []) for (const k of Object.keys(fieldScores(cell, { exactOnly: true }))) s.add(k)
  return s.size
}
const countMonths = row => new Set((row || []).map(monthOfHeader).filter(m => m !== null)).size
const countQuarters = row => (row || []).filter(c => /^(?:ไตรมาส|q\s*[1-4])/i.test(toAsciiDigits(normalizeCell(c)))).length

/**
 * หาแถวหัวตารางจากตารางดิบ → { headerRowIndex, headerRowCount } หรือ null ถ้าไม่เจอ
 * รู้จักหัว 2 แถว 3 แบบ: (ก) แถวไตรมาสอยู่บน แถวชื่อคอลัมน์+เดือนอยู่ล่าง (ข) แถวชื่อคอลัมน์บน แถวเดือนล้วนอยู่ล่าง
 * (ค) แถวชื่อคอลัมน์ล้วนอยู่บน แถวเดือนล้วนอยู่ล่าง แต่คะแนนสูงสุดตกที่แถวเดือน
 */
export function detectHeaderRows(rows) {
  const best = findHeaderRow(rows, headerScore)
  if (best < 0) return null
  const here = { fields: countFields(rows[best]), months: countMonths(rows[best]) }
  const above = best > 0 ? rows[best - 1] : null
  const below = best + 1 < rows.length ? rows[best + 1] : null
  if (here.fields === 0 && here.months >= 6 && above && countFields(above) >= 2) {
    return { headerRowIndex: best - 1, headerRowCount: 2 }
  }
  if (here.months < 6 && below && countMonths(below) >= 6 && countFields(below) === 0) {
    return { headerRowIndex: best, headerRowCount: 2 }
  }
  if (above && countQuarters(above) > 0 && countFields(above) === 0) {
    return { headerRowIndex: best - 1, headerRowCount: 2 }
  }
  return { headerRowIndex: best, headerRowCount: 1 }
}

// ── แปลงค่า ─────────────────────────────────────────────────────────────────

const DASH_ONLY = /^[-\u{2010}-\u{2015}\u{2212}]+$/u

/**
 * จำนวนเงิน → { value: number|null, error? }
 * รับ '1,234,500' '1,234,500.00' '1234500 บาท' เลขไทย ; '' '-' '–' = ไม่ระบุ (null ไม่ใช่ error)
 * error : ติดลบ / ไม่ใช่ตัวเลข / ทศนิยมเกิน 2 ตำแหน่ง (เศษศูนย์ท้ายยอมได้) / เกิน numeric(15,2)
 * ตรวจจากสตริงโดยตรง ไม่ผ่านเลขทศนิยมลอย — ค่าสุดท้ายแปลงจากสตริงที่ตรวจแล้ว (สูงสุด 15 หลักนัยสำคัญ ปลอดภัยในช่วงของ double)
 */
export function parseAmount(s) {
  let t = toAsciiDigits(normalizeCell(s)).replace(/\s+/g, '')
  t = t.replace(/^฿/, '').replace(/(?:บาท|฿|baht|thb)$/i, '')
  if (t === '' || DASH_ONLY.test(t)) return { value: null }
  if (/^[-\u{2212}\u{2013}\u{2014}]\d/u.test(t) || /^\(.*\)$/.test(t)) return { error: 'จำนวนเงินติดลบไม่ได้', value: null }
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(t)
  if (!m) return { error: `อ่านจำนวนเงิน "${clip(normalizeCell(s))}" ไม่ได้`, value: null }
  const frac = m[2] || ''
  if (frac.length > LIMITS.amountScale && /[1-9]/.test(frac.slice(LIMITS.amountScale))) {
    return { error: `จำนวนเงินมีทศนิยมเกิน ${LIMITS.amountScale} ตำแหน่ง`, value: null }
  }
  const int = m[1].replace(/,/g, '').replace(/^0+(?=\d)/, '')
  if (int.length > AMOUNT_INT_DIGITS) {
    return { error: `จำนวนเงินเกินขนาดที่เก็บได้ (ไม่เกิน ${AMOUNT_INT_DIGITS} หลักก่อนจุดทศนิยม)`, value: null }
  }
  return { value: Number(`${int}.${frac.slice(0, LIMITS.amountScale).padEnd(LIMITS.amountScale, '0')}`) }
}

const clip = (s, n = 40) => ([...s].length > n ? `${[...s].slice(0, n).join('')}…` : s)

/** ลำดับที่ → { value: number|null, error? } : '1' '๑' '1.' '1)' ได้ ; ว่าง = null ; นอก 1–9999 หรือไม่ใช่เลข = error */
export function parseSeq(s) {
  const t = toAsciiDigits(normalizeCell(s))
  if (t === '') return { value: null }
  const m = /^(\d{1,6})\s*[.)]?$/.exec(t)
  if (!m) return { error: `อ่านลำดับที่ "${clip(t)}" ไม่ได้`, value: null }
  const n = Number(m[1])
  if (n < LIMITS.seqMin || n > LIMITS.seqMax) return { error: `ลำดับที่ต้องอยู่ระหว่าง ${LIMITS.seqMin}–${LIMITS.seqMax}`, value: null }
  return { value: n }
}

const isMarked = v => {
  const t = normalizeCell(v)
  return t !== '' && !DASH_ONLY.test(t) // ขีดล้วนในช่องเดือน = ไม่ได้ทำเดือนนั้น
}

/**
 * ช่องเดือนที่ "มีอะไรอยู่" (ลูกศร ↔ ← → ✓ x * หรือข้อความใดๆ ที่ไม่ว่าง) = เดือนที่ทำงาน
 * cellsByFiscalMonth : { 1: '←', 2: '↔', … } (คีย์ = เดือนที่ของปีงบ) หรืออาร์เรย์ 12 ช่อง (index 0 = เดือนที่ 1)
 * → { from, to, warning? } · ไม่มีช่องไหนมีเครื่องหมาย → { from: null, to: null } · ไม่ต่อเนื่อง → from=ต่ำสุด to=สูงสุด + warning
 */
export function monthsFromMarks(cellsByFiscalMonth) {
  const entries = Array.isArray(cellsByFiscalMonth)
    ? cellsByFiscalMonth.map((v, i) => [i + 1, v])
    : Object.entries(cellsByFiscalMonth || {}).map(([k, v]) => [Number(k), v])
  const marked = entries
    .filter(([m, v]) => Number.isInteger(m) && m >= LIMITS.monthMin && m <= LIMITS.monthMax && isMarked(v))
    .map(([m]) => m)
    .sort((a, b) => a - b)
  if (!marked.length) return { from: null, to: null }
  const from = marked[0]
  const to = marked[marked.length - 1]
  return marked.length === to - from + 1 ? { from, to } : { from, to, warning: 'เดือนไม่ต่อเนื่อง' }
}

// ── จับคู่ชื่อกับทะเบียน (ตรงตัวหลัง normalize ไม่ fuzzy) ─────────────────────────

/** รูปเทียบชื่อ : ตัดช่องว่างทั้งหมด, เลขไทย→อารบิก, ลบเครื่องหมายคำพูด, ตัด 'โครงการ' นำหน้า, ตัวพิมพ์เล็ก */
export function normalizeName(s) {
  const t = toAsciiDigits(normalizeCell(s)).replace(/\s+/g, '').replace(/["'“”‘’«»]/g, '').toLowerCase()
  return t.startsWith('โครงการ') && t.length > 'โครงการ'.length ? t.slice('โครงการ'.length) : t
}

function matchBy(text, list, namesOf) {
  const n = normalizeName(text)
  if (!n) return { id: null, status: 'none' }
  const hits = []
  for (const row of list || []) {
    if (namesOf(row).some(name => name && normalizeName(name) === n) && !hits.includes(row.id)) hits.push(row.id)
  }
  if (hits.length === 1) return { id: hits[0], status: 'exact' }
  return { id: null, status: hits.length > 1 ? 'ambiguous' : 'none' }
}

/** ข้อความผู้รับผิดชอบ → กองในทะเบียน (ตรงกับ name หรือ code ที่ normalize แล้ว ไม่เดาตัวย่อ) · ตรงมากกว่า 1 กอง = ambiguous */
export function matchDepartment(text, departments) {
  return matchBy(text, departments, d => [d.name, d.code])
}

/** ชื่อโครงการ → โครงการในทะเบียนของแผนพัฒนา (ตรงกับ official_name ที่ normalize แล้ว) · ตรงมากกว่า 1 โครงการ = ambiguous */
export function matchProject(name, projects) {
  return matchBy(name, projects, p => [p.official_name])
}

// ── พรีวิว ──────────────────────────────────────────────────────────────────

// แถวสรุปยอดท้ายตาราง ไม่ใช่โครงการ (ตรงตัวทั้งช่อง — ไม่ใช้ "ขึ้นต้นด้วยรวม" เพราะมีโครงการชื่อ "รวมพลัง…" ได้)
const TOTAL_LABEL = /^(?:รวม(?:ทั้งสิ้น|ทั้งหมด|งบประมาณ|เป็นเงิน|เงิน|ทั้งสิ้นเป็นเงิน)?|ยอดรวม|total|grandtotal|subtotal|sum)$/i
const isTotalLabel = s => TOTAL_LABEL.test(normalizeHeader(s).replace(/\([^)]*\)/g, ''))

const monthOfText = text => {
  const token = parseMonthToken(toAsciiDigits(text))
  return token ? token.fiscalMonth : null
}

/**
 * สร้างพรีวิวการนำเข้า
 * rows : ตารางดิบจาก parseDelimited · headerRowIndex/headerRowCount : หัวตาราง (ดู detectHeaderRows) ; ข้อมูลเริ่มถัดจากหัว
 * mapping / monthColumns : จาก guessMapping (ผู้ใช้แก้แล้วส่งมาได้) · departments [{id,name,code?}] · projects [{id,official_name}]
 * fiscalYearBE : ปีงบของแผนฉบับนี้ ใช้ตรวจปีที่พิมพ์ในข้อความระยะเวลา
 *
 * คืน { items, summary, skipped }
 *   items[i] = { rowNumber (ลำดับแถวในตารางที่อ่านได้ นับจาก 1 = แถวแรกของไฟล์), values, raw, errors, warnings }
 *     values = { seq_no, item_name, amount, department_id, month_from, month_to, note, dev_project_id } (ช่องที่อ่านไม่ได้เป็น null)
 *     แถวมี errors → ห้ามบันทึก (หน้าจอให้แก้หรือข้าม) ; มีแต่ warnings → บันทึกได้ แต่เจ้าหน้าที่ควรเห็น
 *   skipped[i] = { rowNumber, reason: 'empty'|'total' } ; แถวว่างล้วนและแถวรวมยอดไม่เข้า items
 *   summary = { total, ok (ไม่มีทั้ง error/warning), withWarnings, withErrors, unmatchedProjects, unmatchedDepartments, skippedTotals, skippedEmpty }
 */
export function buildImportPreview({
  rows, headerRowIndex, headerRowCount = 1, mapping = {}, monthColumns = {},
  departments = [], projects = [], fiscalYearBE,
}) {
  const items = []
  const skipped = []
  const fieldCols = Object.entries(mapping).filter(([, key]) => FIELD_KEYS.has(key))
  const monthCols = Object.entries(monthColumns).map(([col, fm]) => [Number(col), Number(fm)])
  const start = Math.max(0, Number(headerRowIndex) + Math.max(1, headerRowCount))

  for (let r = start; r < (rows || []).length; r++) {
    const row = rows[r] || []
    const rowNumber = r + 1
    const texts = {}
    for (const [col, key] of fieldCols) texts[key] = normalizeCell(row[col])
    const marks = {}
    for (const [col, fm] of monthCols) if (isMarked(row[col])) marks[fm] = normalizeCell(row[col])

    const anyText = Object.values(texts).some(v => v !== '')
    if (!anyText && !Object.keys(marks).length) { skipped.push({ rowNumber, reason: 'empty' }); continue }

    const name = texts.item_name || ''
    const labelIsTotal = [texts.item_name, texts.seq_no, texts.department].some(v => v && isTotalLabel(v))
    if (labelIsTotal || (!name && texts.amount && !texts.seq_no)) { skipped.push({ rowNumber, reason: 'total' }); continue }

    const errors = []
    const warnings = []
    const values = {
      seq_no: null, item_name: name, amount: null, department_id: null,
      month_from: null, month_to: null, note: null, dev_project_id: null,
    }

    // ชื่อโครงการ
    if (!name) errors.push('ไม่มีชื่อโครงการ')
    else if ([...name].length > LIMITS.itemNameMax) errors.push(`ชื่อโครงการยาวเกิน ${LIMITS.itemNameMax} ตัวอักษร`)

    // ลำดับ / งบ / หมายเหตุ
    if (texts.seq_no) {
      const seq = parseSeq(texts.seq_no)
      if (seq.error) errors.push(seq.error)
      values.seq_no = seq.value
    }
    if (texts.amount) {
      const amount = parseAmount(texts.amount)
      if (amount.error) errors.push(amount.error)
      values.amount = amount.value
    }
    if (texts.note) {
      if ([...texts.note].length > LIMITS.noteMax) errors.push(`หมายเหตุยาวเกิน ${LIMITS.noteMax} ตัวอักษร`)
      values.note = texts.note
    }

    // เดือน : ช่องเดือนที่มีเครื่องหมาย > ข้อความระยะเวลา > คอลัมน์เดือนเริ่ม/สิ้นสุด
    if (Object.keys(marks).length) {
      const span = monthsFromMarks(marks)
      values.month_from = span.from
      values.month_to = span.to
      if (span.warning) warnings.push(span.warning)
    } else if (texts.period_text) {
      const span = parseMonthSpan(texts.period_text, { fiscalYearBE })
      if (!span) errors.push(`อ่านระยะเวลา "${clip(texts.period_text)}" ไม่ได้ (เช่น ต.ค.–ธ.ค. หรือ ไตรมาส 1–2)`)
      else {
        values.month_from = span.from
        values.month_to = span.to
        if (span.warning) warnings.push(span.warning)
      }
    } else if (texts.month_from || texts.month_to) {
      const from = texts.month_from ? monthOfText(texts.month_from) : null
      const to = texts.month_to ? monthOfText(texts.month_to) : null
      if (texts.month_from && from === null) errors.push(`อ่านเดือนเริ่ม "${clip(texts.month_from)}" ไม่ได้ (ใช้ชื่อเดือน เช่น ต.ค.)`)
      else if (texts.month_to && to === null) errors.push(`อ่านเดือนสิ้นสุด "${clip(texts.month_to)}" ไม่ได้ (ใช้ชื่อเดือน เช่น ธ.ค.)`)
      else {
        const problem = validateSpan(from, to)
        if (problem) errors.push(problem)
        else { values.month_from = from; values.month_to = to }
      }
    }

    // กองผู้รับผิดชอบ
    if (texts.department) {
      const dept = matchDepartment(texts.department, departments)
      if (dept.status === 'exact') values.department_id = dept.id
      else if (dept.status === 'ambiguous') warnings.push(`ชื่อกอง "${clip(texts.department)}" ตรงกับหลายกองในทะเบียน — เลือกกองเอง`)
      else warnings.push(`ไม่พบกอง "${clip(texts.department)}" ในรายชื่อกอง — เลือกกองเอง`)
    }

    // ผูกทะเบียนโครงการของแผนพัฒนา (ข้อ 25 : เตือนไม่บล็อก)
    let projectStatus = 'none'
    if (name) {
      const project = matchProject(name, projects)
      projectStatus = project.status
      if (project.status === 'exact') values.dev_project_id = project.id
      else if (project.status === 'ambiguous') warnings.push('ชื่อโครงการตรงกับหลายโครงการในทะเบียนของแผนพัฒนา — เลือกเอง (ข้อ 25)')
      else warnings.push('ไม่พบในทะเบียนโครงการของแผนพัฒนา (ข้อ 25)')
    }

    items.push({
      rowNumber, values, raw: { ...texts, marks }, errors, warnings,
      _projectStatus: projectStatus,
      _departmentUnmatched: Boolean(texts.department) && values.department_id === null,
    })
  }

  const summary = {
    total: items.length,
    ok: items.filter(i => !i.errors.length && !i.warnings.length).length,
    withWarnings: items.filter(i => !i.errors.length && i.warnings.length).length,
    withErrors: items.filter(i => i.errors.length).length,
    unmatchedProjects: items.filter(i => i.values.item_name && i._projectStatus !== 'exact').length,
    unmatchedDepartments: items.filter(i => i._departmentUnmatched).length,
    skippedTotals: skipped.filter(s => s.reason === 'total').length,
    skippedEmpty: skipped.filter(s => s.reason === 'empty').length,
  }
  for (const i of items) { delete i._projectStatus; delete i._departmentUnmatched }
  return { items, summary, skipped }
}

// ตัวอ่านตารางและตัวนำเข้าฉบับร่างแผนการดำเนินงาน (src/lib/tabularImport.js, localPlanImport.js)
// คำนวณล้วน ไม่ใช้เน็ต ไม่แตะข้อมูลจริง — ตัวอย่างทั้งหมดเป็นข้อมูลสมมติ ไม่ใช่แผนของ อปท. ใด
//   node tests/local-plan-import.test.mjs
// ส่วน LIMITS อ่านจากไฟล์ migration ตรงๆ ไม่คัดเลขมาเขียนซ้ำ — ถ้าฐานข้อมูลเปลี่ยนขนาด เทสต์นี้ต้องแดง
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

process.env.TZ = 'America/Los_Angeles'
const T = await import('../src/lib/tabularImport.js')
const I = await import('../src/lib/localPlanImport.js')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const bytesOf = s => new TextEncoder().encode(s)
// TIS-620 / windows-874 : อักษรไทย U+0E01–U+0E5B ↔ 0xA1–0xFB (code - 0x0E01 + 0xA1) ; ASCII คงเดิม
const tis620 = s => Uint8Array.from([...s].map(ch => {
  const c = ch.codePointAt(0)
  if (c < 0x80) return c
  assert.ok(c >= 0x0e01 && c <= 0x0e5b, 'ตัวอักษรนอกชุด TIS-620: ' + ch)
  return c - 0x0e01 + 0xa1
}))

// ── CSV (RFC 4180) ─────────────────────────────────────────────────────────

test('parseDelimited: คำพูดห่อช่อง, "" = คำพูดหนึ่งตัว, ตัวคั่นในคำพูด', () => {
  const r = T.parseDelimited('a,"b,c","d ""q"" e"\n1,2,3\n', { delimiter: ',' })
  assert.deepEqual(r.rows, [['a', 'b,c', 'd "q" e'], ['1', '2', '3']])
  assert.equal(r.truncated, false)
  assert.deepEqual(r.warnings, [])
})

test('parseDelimited: newline ในช่องที่มีคำพูด + CRLF/LF/CR + ช่องว่างในคำพูดคงอยู่', () => {
  const r = T.parseDelimited('x,"บรรทัด 1\nบรรทัด 2",z\r\n4,5,6\r7,8,9\n', { delimiter: ',' })
  assert.deepEqual(r.rows, [['x', 'บรรทัด 1\nบรรทัด 2', 'z'], ['4', '5', '6'], ['7', '8', '9']])
  assert.equal(T.normalizeCell(r.rows[0][1]), 'บรรทัด 1 บรรทัด 2')
})

test('parseDelimited: BOM นำหน้า, บรรทัดว่างท้ายไฟล์ตัดทิ้ง, ช่อง "" ว่างยังเป็นช่อง, คำพูดกลางช่องเป็นตัวอักษรธรรมดา', () => {
  const r = T.parseDelimited('\u{FEFF}หัว1,หัว2\n"",x\n5" ท่อ,y\n\n\n,,\n', { delimiter: ',' })
  assert.deepEqual(r.rows, [['หัว1', 'หัว2'], ['', 'x'], ['5" ท่อ', 'y']])
})

test('parseDelimited: คำพูดไม่ปิด → warning ไม่ throw, ที่เหลือรวมเป็นช่องเดียว', () => {
  const r = T.parseDelimited('a,b\nc,"ไม่ปิด\nd,e\n', { delimiter: ',' })
  assert.equal(r.rows.length, 2)
  assert.deepEqual(r.rows[0], ['a', 'b'])
  assert.equal(r.rows[1][0], 'c')
  assert.match(r.rows[1][1], /^ไม่ปิด\nd,e/)
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0], /ไม่ได้ปิด/)
})

test('parseDelimited: เกิน MAX_ROWS ตัดแล้ว truncated = true + warning', () => {
  assert.equal(T.MAX_ROWS, 2000)
  const lines = Array.from({ length: T.MAX_ROWS + 5 }, (_, i) => `r${i},v`).join('\n')
  const r = T.parseDelimited(lines, { delimiter: ',' })
  assert.equal(r.rows.length, T.MAX_ROWS)
  assert.equal(r.rows[T.MAX_ROWS - 1][0], `r${T.MAX_ROWS - 1}`)
  assert.equal(r.truncated, true)
  assert.match(r.warnings[0], /2000/)
  // พอดี MAX_ROWS แถว (มี newline ท้าย) ไม่ถือว่าตัด
  const exact = T.parseDelimited(Array.from({ length: T.MAX_ROWS }, (_, i) => `r${i},v`).join('\n') + '\n\n', { delimiter: ',' })
  assert.equal(exact.rows.length, T.MAX_ROWS)
  assert.equal(exact.truncated, false)
})

test('parseDelimited: ข้อความว่าง/null ไม่ throw', () => {
  assert.deepEqual(T.parseDelimited('').rows, [])
  assert.deepEqual(T.parseDelimited(null).rows, [])
})

// ── ตัวคั่น ────────────────────────────────────────────────────────────────

test('detectDelimiter: TSV จาก Excel (ช่องที่มี newline ห่อด้วย "..." และมี comma ในตัวเลข)', () => {
  const tsv = [
    'แผนงาน\t\t',
    'ที่\tโครงการ\tงบประมาณ',
    '1\t"โครงการ ก\nต่อเนื่อง"\t1,234,500.00',
    '2\tโครงการ ข\t2,000',
    '3\tโครงการ ค\t300',
  ].join('\n')
  assert.equal(T.detectDelimiter(tsv), '\t')
  const r = T.parseDelimited(tsv)
  assert.equal(r.delimiter, '\t')
  assert.deepEqual(r.rows[2], ['1', 'โครงการ ก\nต่อเนื่อง', '1,234,500.00'])
})

test('detectDelimiter: comma / semicolon / ไม่เจอ → comma', () => {
  assert.equal(T.detectDelimiter('a,b,c\n1,2,3\n4,5,6'), ',')
  assert.equal(T.detectDelimiter('a;b;c\n1;2;3\n4;5;6'), ';')
  assert.equal(T.detectDelimiter('a,"x;y;z",c\n1,2,3\n4,"p;q",6'), ',') // ; ในคำพูดไม่นับ
  assert.equal(T.detectDelimiter('ข้อความบรรทัดเดียว'), ',')
  assert.equal(T.detectDelimiter(''), ',')
  // ชื่อเรื่องช่องเดียวด้านบนไม่ทำให้ตัวคั่นเสมอกัน
  assert.equal(T.detectDelimiter('ชื่อเรื่อง\na;b;c\n1;2;3'), ';')
})

// ── ถอดรหัสไบต์ ─────────────────────────────────────────────────────────────

test('decodeTextBytes: UTF-8 ไทย (รับทั้ง Uint8Array และ ArrayBuffer) + ตัด BOM', () => {
  const utf8 = bytesOf('\u{FEFF}โครงการทดสอบ ก')
  const a = T.decodeTextBytes(utf8)
  assert.deepEqual(a, { text: 'โครงการทดสอบ ก', encoding: 'utf-8' })
  const buf = utf8.buffer.slice(utf8.byteOffset, utf8.byteOffset + utf8.byteLength)
  assert.equal(T.decodeTextBytes(buf).text, 'โครงการทดสอบ ก')
})

test('decodeTextBytes: windows-874 (TIS-620) ไทย — สร้างไบต์เอง', () => {
  const bytes = tis620('โครงการ')
  assert.deepEqual([...bytes], [0xe2, 0xa4, 0xc3, 0xa7, 0xa1, 0xd2, 0xc3])
  const r = T.decodeTextBytes(bytes)
  assert.equal(r.encoding, 'windows-874')
  assert.equal(r.text, 'โครงการ')
  assert.equal(T.decodeTextBytes(tis620('ที่,โครงการ,งบประมาณ\n1,ก,100')).text, 'ที่,โครงการ,งบประมาณ\n1,ก,100')
})

test('decodeTextBytes: UTF-16LE (Excel "Unicode Text") + ไฟล์ไบนารี throw + เกินขนาด throw', () => {
  const le = new Uint8Array([0xff, 0xfe, ...[...'ก\tข'].flatMap(ch => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])])
  assert.deepEqual(T.decodeTextBytes(le), { text: 'ก\tข', encoding: 'utf-16le' })
  assert.throws(() => T.decodeTextBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])), /ไม่ใช่ไฟล์ข้อความ/)
  assert.equal(T.MAX_BYTES, 2 * 1024 * 1024)
  assert.throws(() => T.decodeTextBytes(new Uint8Array(T.MAX_BYTES + 1)), /ใหญ่เกิน 2 MB/)
  assert.doesNotThrow(() => T.decodeTextBytes(new Uint8Array(T.MAX_BYTES).fill(0x41)))
})

// ── ทำความสะอาดตาราง ───────────────────────────────────────────────────────

test('normalizeCell / padRows / dropEmptyRows / dropEmptyColumns', () => {
  assert.equal(T.normalizeCell('  a\u{00A0}\u{00A0}b\u{200B}c\nd\t e  '), 'a bc d e')
  assert.equal(T.normalizeCell(null), '')
  assert.equal(T.normalizeCell(12), '12')
  assert.deepEqual(T.padRows([['a'], ['b', 'c', 'd'], []]), [['a', '', ''], ['b', 'c', 'd'], ['', '', '']])
  assert.deepEqual(T.dropEmptyRows([['a', ''], ['', ' '], ['\u{00A0}', ''], ['b']]), [['a', ''], ['b']])
  assert.deepEqual(T.dropEmptyColumns([['a', '', 'c'], ['d', ' ', ''], ['e']]), [['a', 'c'], ['d', ''], ['e', '']])
  assert.deepEqual(T.dropEmptyColumns([]), [])
})

test('findHeaderRow / mergeHeaderRows', () => {
  const rows = [['ชื่อเรื่อง'], ['', 'ไตรมาส 1', '', '', 'ไตรมาส 2'], ['ที่', 'โครงการ', 'งบ'], ['1', 'ก', '100']]
  const score = r => r.filter(c => ['ที่', 'โครงการ', 'งบ'].includes(c)).length
  assert.equal(T.findHeaderRow(rows, score), 2)
  assert.equal(T.findHeaderRow(rows, () => 0), -1)
  assert.equal(T.findHeaderRow(rows, score, 2), -1) // อยู่นอกช่วงสแกน
  assert.deepEqual(T.mergeHeaderRows(rows, 1, 2), ['ที่', 'ไตรมาส 1 โครงการ', 'งบ', '', 'ไตรมาส 2'])
  assert.deepEqual(T.mergeHeaderRows([['ก', 'ข'], ['ก', '']], 0, 2), ['ก', 'ข']) // ข้อความซ้ำติดกันไม่ซ้ำ
})

// ── แปลงค่า ────────────────────────────────────────────────────────────────

test('parseAmount: รูปแบบที่ต้องรับ', () => {
  assert.deepEqual(I.parseAmount('1,234,500'), { value: 1234500 })
  assert.deepEqual(I.parseAmount('1,234,500.00'), { value: 1234500 })
  assert.deepEqual(I.parseAmount('1234500 บาท'), { value: 1234500 })
  assert.deepEqual(I.parseAmount('฿ 1,000.50'), { value: 1000.5 })
  assert.deepEqual(I.parseAmount('๑,๒๓๔,๕๐๐.๕๐'), { value: 1234500.5 })
  assert.deepEqual(I.parseAmount('0'), { value: 0 })
  assert.deepEqual(I.parseAmount('0.1'), { value: 0.1 })
  assert.deepEqual(I.parseAmount('12.5'), { value: 12.5 })
  assert.deepEqual(I.parseAmount('100.500'), { value: 100.5 }) // เศษศูนย์ท้ายยอมได้
  assert.deepEqual(I.parseAmount('9,999,999,999,999.99'), { value: 9999999999999.99 })
})

test('parseAmount: ว่าง/ขีด = ไม่ระบุ (null ไม่ใช่ error)', () => {
  for (const s of ['', '   ', '-', '–', '—', '--', null, undefined]) assert.deepEqual(I.parseAmount(s), { value: null })
})

test('parseAmount: error — ติดลบ / ไม่ใช่ตัวเลข / ทศนิยม >2 / เกินขนาด / รูปแบบเลขยุโรป', () => {
  assert.match(I.parseAmount('-500').error, /ติดลบ/)
  assert.match(I.parseAmount('(1,000)').error, /ติดลบ/)
  assert.match(I.parseAmount('abc').error, /อ่านจำนวนเงิน/)
  assert.match(I.parseAmount('12a').error, /อ่านจำนวนเงิน/)
  assert.match(I.parseAmount('1.234.500,00').error, /อ่านจำนวนเงิน/)
  assert.match(I.parseAmount('1,23').error, /อ่านจำนวนเงิน/)
  assert.match(I.parseAmount('1.005').error, /ทศนิยมเกิน 2/)
  assert.match(I.parseAmount('10,000,000,000,000').error, /เกินขนาด/) // 14 หลัก
  assert.match(I.parseAmount('99999999999999.99').error, /เกินขนาด/)
  assert.equal(I.parseAmount('abc').value, null)
})

test('parseSeq: เลขอารบิก/ไทย/มีจุดตาม, ว่าง, error', () => {
  assert.deepEqual(I.parseSeq('1'), { value: 1 })
  assert.deepEqual(I.parseSeq('๑'), { value: 1 })
  assert.deepEqual(I.parseSeq('1.'), { value: 1 })
  assert.deepEqual(I.parseSeq(' ๑๒) '), { value: 12 })
  assert.deepEqual(I.parseSeq('9999'), { value: 9999 })
  assert.deepEqual(I.parseSeq(''), { value: null })
  assert.deepEqual(I.parseSeq(null), { value: null })
  assert.match(I.parseSeq('0').error, /1–9999/)
  assert.match(I.parseSeq('10000').error, /1–9999/)
  assert.match(I.parseSeq('1.2').error, /ลำดับ/)
  assert.match(I.parseSeq('ก').error, /ลำดับ/)
})

test('monthsFromMarks: ต่อเนื่อง / เดือนเดียว / ไม่ต่อเนื่อง+warning / ว่าง / อาร์เรย์ / ขีดไม่นับ', () => {
  assert.deepEqual(I.monthsFromMarks({ 1: '←', 2: '↔', 3: '→' }), { from: 1, to: 3 })
  assert.deepEqual(I.monthsFromMarks({ 5: '✓' }), { from: 5, to: 5 })
  assert.deepEqual(I.monthsFromMarks({ 1: 'x', 4: '*' }), { from: 1, to: 4, warning: 'เดือนไม่ต่อเนื่อง' })
  assert.deepEqual(I.monthsFromMarks({ 1: '', 2: '  ' }), { from: null, to: null })
  assert.deepEqual(I.monthsFromMarks({}), { from: null, to: null })
  assert.deepEqual(I.monthsFromMarks(['', '', 'ทำ', 'ทำ', '', '', '', '', '', '', '', '']), { from: 3, to: 4 })
  assert.deepEqual(I.monthsFromMarks({ 1: '-', 2: '–', 3: '↔' }), { from: 3, to: 3 })
  assert.deepEqual(I.monthsFromMarks({ 0: 'x', 13: 'x', 6: 'x' }), { from: 6, to: 6 }) // นอก 1–12 ไม่นับ
})

test('normalizeName / matchDepartment / matchProject: ตรงตัวหลัง normalize ไม่ fuzzy', () => {
  assert.equal(I.normalizeName('  โครงการ ก่อสร้าง  ถนน ๑ '), 'ก่อสร้างถนน1')
  assert.equal(I.normalizeName('"โครงการทดสอบ ก"'), 'ทดสอบก')
  assert.equal(I.normalizeName('โครงการ'), 'โครงการ') // ไม่เหลือว่าง
  assert.equal(I.normalizeName('ABC Test'), 'abctest')

  const depts = [
    { id: 'd1', name: 'กองช่าง', code: 'ENG' },
    { id: 'd2', name: 'สำนักปลัด' },
    { id: 'd3', name: 'กอง การศึกษา' },
    { id: 'd4', name: 'กองการศึกษา' }, // ซ้ำหลัง normalize → ambiguous
  ]
  assert.deepEqual(I.matchDepartment('กอง ช่าง', depts), { id: 'd1', status: 'exact' })
  assert.deepEqual(I.matchDepartment('eng', depts), { id: 'd1', status: 'exact' })
  assert.deepEqual(I.matchDepartment('สำนักปลัด', depts), { id: 'd2', status: 'exact' })
  assert.deepEqual(I.matchDepartment('กองการศึกษา', depts), { id: null, status: 'ambiguous' })
  assert.deepEqual(I.matchDepartment('กองคลัง', depts), { id: null, status: 'none' })
  assert.deepEqual(I.matchDepartment('', depts), { id: null, status: 'none' })
  assert.deepEqual(I.matchDepartment('สป.', depts), { id: null, status: 'none' }) // ไม่เดาตัวย่อ
  assert.deepEqual(I.matchDepartment('กองช่าง', []), { id: null, status: 'none' })

  const projects = [
    { id: 'p1', official_name: 'โครงการทดสอบ ก' },
    { id: 'p2', official_name: 'ซ่อมแซมถนน' },
    { id: 'p3', official_name: 'โครงการ ซ่อมแซม ถนน' },
  ]
  assert.deepEqual(I.matchProject('ทดสอบ ก', projects), { id: 'p1', status: 'exact' })
  assert.deepEqual(I.matchProject('โครงการทดสอบก', projects), { id: 'p1', status: 'exact' })
  assert.deepEqual(I.matchProject('ซ่อมแซมถนน', projects), { id: null, status: 'ambiguous' })
  assert.deepEqual(I.matchProject('ทดสอบ ข', projects), { id: null, status: 'none' })
})

// ── ตัวอย่างจำลองฉบับร่างแผนดำเนินงาน (ข้อมูลสมมติ) ─────────────────────────────

const MONTH_HEADS = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.']
const marks = obj => MONTH_HEADS.map((_, i) => obj[i + 1] || '')
// คอลัมน์: 0 ที่ · 1 โครงการ · 2 งบประมาณ (บาท) · 3–14 เดือน (ต.ค.–ก.ย.) · 15 ผู้รับผิดชอบ · 16 หมายเหตุ
const row = (seq, name, amount, monthMarks, dept, note = '') => [seq, name, amount, ...marks(monthMarks), dept, note]
const SAMPLE_ROWS = [
  ['แผนการดำเนินงาน ประจำปีงบประมาณ พ.ศ. 2569'],
  ['เทศบาลตำบลทดสอบ อำเภอสมมติ จังหวัดสมมติ'],
  ['', '', '', 'ไตรมาสที่ 1', '', '', 'ไตรมาสที่ 2', '', '', 'ไตรมาสที่ 3', '', '', 'ไตรมาสที่ 4', '', '', '', ''],
  ['ที่', 'โครงการ', 'งบประมาณ (บาท)', ...MONTH_HEADS, 'ผู้รับผิดชอบ', 'หมายเหตุ'],
  row('๑', 'โครงการทดสอบ ก', '1,234,500.00', { 1: '←', 2: '↔', 3: '→' }, 'กองช่าง'),                       // 5: ปกติ ผูกทะเบียนได้
  row('', 'โครงการทดสอบ ข', '-', { 5: '↔', 6: '→' }, 'กอง สาธารณสุข', 'ไม่มีเลขลำดับ'),                       // 6: กองไม่อยู่ในรายชื่อ
  row('3', 'โครงการนอกทะเบียน', '๒๐๐,๐๐๐', { 1: '←', 4: '→' }, 'สำนักปลัด'),                                    // 7: เดือนไม่ต่อเนื่อง + ไม่อยู่ในทะเบียน
  row('', '', '', {}, ''),                                                                                       // 8: ว่างล้วน
  row('', 'รวม', '1,434,500.00', {}, ''),                                                                        // 9: แถวรวม
  row('', '', '5,000,000', {}, ''),                                                                              // 10: ไม่มีชื่อแต่มีตัวเลข = รวม
  row('9', '', '100', { 1: 'x' }, 'กองช่าง'),                                                                    // 11: มีลำดับแต่ไม่มีชื่อ = error
  row('10', 'โครงการงบผิด', '12.345', { 2: 'x' }, 'กองช่าง'),                                                   // 12: ทศนิยม 3 ตำแหน่ง = error
  row('11', 'โครงการงบไม่ใช่เลข', 'ไม่ระบุ', {}, 'กองช่าง', 'ไม่มีเดือน'),                                      // 13: error + เดือนว่าง
  row('', 'รวมทั้งสิ้น', '9,999,999', {}, ''),                                                                  // 14: แถวรวม (ป้ายอยู่ในช่องโครงการ)
]
const DEPARTMENTS = [{ id: 'dept-eng', name: 'กองช่าง' }, { id: 'dept-clerk', name: 'สำนักปลัด' }]
const PROJECTS = [
  { id: 'proj-a', official_name: 'โครงการทดสอบ ก' },
  { id: 'proj-b', official_name: 'โครงการ ทดสอบ ข' },
]

test('ตัวอย่างฉบับร่าง: findHeaderRow + detectHeaderRows เจอแถวหัว 2 แถว (ไตรมาส + ชื่อคอลัมน์)', () => {
  assert.equal(T.findHeaderRow(SAMPLE_ROWS, I.headerScore), 3)
  assert.ok(I.headerScore(SAMPLE_ROWS[3]) > I.headerScore(SAMPLE_ROWS[4])) // แถวข้อมูลที่มีคำว่า "โครงการ" ไม่ใช่หัว
  assert.equal(I.headerScore(SAMPLE_ROWS[0]), 0)
  assert.deepEqual(I.detectHeaderRows(SAMPLE_ROWS), { headerRowIndex: 2, headerRowCount: 2 })
  assert.equal(I.detectHeaderRows([['ก'], ['ข']]), null)
})

test('detectHeaderRows: หัวแบบอื่น — แถวเดียว / ชื่อคอลัมน์บน+เดือนล้วนล่าง / เดือนล้วนล่างมีไตรมาสไม่มี', () => {
  const one = [['ชื่อเรื่อง'], ['ที่', 'โครงการ', 'งบประมาณ'], ['1', 'ก', '100']]
  assert.deepEqual(I.detectHeaderRows(one), { headerRowIndex: 1, headerRowCount: 1 })
  const split = [['ที่', 'โครงการ', 'งบประมาณ', '', '', '', '', '', '', '', '', '', '', '', '', 'ผู้รับผิดชอบ'], ['', '', '', ...MONTH_HEADS, ''], ['1', 'ก', '1', ...MONTH_HEADS.map(() => ''), '']]
  assert.deepEqual(I.detectHeaderRows(split), { headerRowIndex: 0, headerRowCount: 2 })
  const mapped = I.guessMapping(T.mergeHeaderRows(split, 0, 2))
  assert.deepEqual(mapped.mapping, { 0: 'seq_no', 1: 'item_name', 2: 'amount', 15: 'department' })
  assert.equal(Object.keys(mapped.monthColumns).length, 12)
})

test('ตัวอย่างฉบับร่าง: guessMapping — field ครบ + monthColumns ครบ 12 (หัวรวม 2 แถวมี "ไตรมาสที่ 1" ติดหน้า ต.ค.)', () => {
  const merged = T.mergeHeaderRows(SAMPLE_ROWS, 2, 2)
  assert.equal(merged[3], 'ไตรมาสที่ 1 ต.ค.')
  const { mapping, monthColumns } = I.guessMapping(merged)
  assert.deepEqual(mapping, { 0: 'seq_no', 1: 'item_name', 2: 'amount', 15: 'department', 16: 'note' })
  assert.deepEqual(monthColumns, { 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, 11: 9, 12: 10, 13: 11, 14: 12 })
})

test('guessMapping: synonyms หลายรูป, หัวเดือนชื่อเต็ม/มีปี, ไม่ map field ซ้ำ, ไม่เหมา "ที่" ในคำอื่น', () => {
  const g = I.guessMapping(['ลำดับที่', 'ชื่อโครงการ/กิจกรรม', 'จำนวนเงิน (บาท)', 'หน่วยงานรับผิดชอบ', 'ระยะเวลาดำเนินการ', 'หมายเหตุ'])
  assert.deepEqual(g.mapping, { 0: 'seq_no', 1: 'item_name', 2: 'amount', 3: 'department', 4: 'period_text', 5: 'note' })
  assert.deepEqual(g.monthColumns, {})
  // "หน่วยงานที่รับผิดชอบ" ต้องเป็น department ไม่ใช่ seq_no ('ที่')
  assert.deepEqual(I.guessMapping(['หน่วยงานที่รับผิดชอบ']).mapping, { 0: 'department' })
  // field ซ้ำ : ตัวที่ตรงตัวชนะ (งบประมาณ ตรงตัวกว่า งบประมาณโครงการรวม)
  assert.deepEqual(I.guessMapping(['งบประมาณโครงการรวม', 'งบประมาณ']).mapping, { 1: 'amount' })
  assert.deepEqual(I.guessMapping(['โครงการ', 'โครงการ']).mapping, { 0: 'item_name' }) // เสมอ → ซ้ายสุด
  // "ผู้รับผิดชอบโครงการ" มีทั้งคำว่าโครงการและผู้รับผิดชอบ → เอาคำยาวกว่า = department
  assert.deepEqual(I.guessMapping(['ผู้รับผิดชอบโครงการ']).mapping, { 0: 'department' })
  // หัวเดือนชื่อเต็ม + ปีต่อท้าย
  const full = ['ตุลาคม', 'พฤศจิกายน', 'ธันวาคม', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน']
  assert.equal(Object.keys(I.guessMapping(full).monthColumns).length, 12)
  const withYear = ['ต.ค.68', 'พ.ย.68', 'ธ.ค.68', 'ม.ค.69', 'ก.พ.69', 'มี.ค.69', 'เม.ย.69', 'พ.ค.69', 'มิ.ย.69', 'ก.ค.69', 'ส.ค.69', 'ก.ย.69']
  assert.deepEqual(I.guessMapping(withYear).monthColumns, { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 10: 11, 11: 12 })
  // เดือนไม่ครบ 12 → ไม่ถือเป็นคอลัมน์เดือน
  assert.deepEqual(I.guessMapping(['ต.ค.', 'พ.ย.']).monthColumns, {})
})

const preview = (overrides = {}) => {
  const merged = T.mergeHeaderRows(SAMPLE_ROWS, 2, 2)
  const { mapping, monthColumns } = I.guessMapping(merged)
  return I.buildImportPreview({
    rows: SAMPLE_ROWS, headerRowIndex: 2, headerRowCount: 2, mapping, monthColumns,
    departments: DEPARTMENTS, projects: PROJECTS, fiscalYearBE: 2569, ...overrides,
  })
}

test('ตัวอย่างฉบับร่าง: buildImportPreview — ค่าแต่ละแถว (เลขแถว/ลำดับ/งบ/เดือน/กอง/ทะเบียน)', () => {
  const { items } = preview()
  assert.deepEqual(items.map(i => i.rowNumber), [5, 6, 7, 11, 12, 13])
  const [a, b, c] = items
  assert.deepEqual(a.values, {
    seq_no: 1, item_name: 'โครงการทดสอบ ก', amount: 1234500, department_id: 'dept-eng',
    month_from: 1, month_to: 3, note: null, dev_project_id: 'proj-a',
  })
  assert.deepEqual(a.errors, [])
  assert.deepEqual(a.warnings, [])
  assert.deepEqual(b.values, {
    seq_no: null, item_name: 'โครงการทดสอบ ข', amount: null, department_id: null,
    month_from: 5, month_to: 6, note: 'ไม่มีเลขลำดับ', dev_project_id: 'proj-b',
  })
  assert.deepEqual(c.values, {
    seq_no: 3, item_name: 'โครงการนอกทะเบียน', amount: 200000, department_id: 'dept-clerk',
    month_from: 1, month_to: 4, note: null, dev_project_id: null,
  })
  assert.deepEqual(a.raw.marks, { 1: '←', 2: '↔', 3: '→' })
  assert.equal(a.raw.amount, '1,234,500.00')
})

test('ตัวอย่างฉบับร่าง: buildImportPreview — errors/warnings ตามกติกา', () => {
  const { items } = preview()
  const [, b, c, noName, badAmount, textAmount] = items
  assert.deepEqual(b.errors, [])
  assert.equal(b.warnings.length, 1)
  assert.match(b.warnings[0], /ไม่พบกอง "กอง สาธารณสุข"/)
  assert.deepEqual(c.errors, [])
  assert.deepEqual(c.warnings, ['เดือนไม่ต่อเนื่อง', 'ไม่พบในทะเบียนโครงการของแผนพัฒนา (ข้อ 25)'])
  assert.deepEqual(noName.errors, ['ไม่มีชื่อโครงการ'])
  assert.equal(noName.values.seq_no, 9)
  assert.equal(badAmount.errors.length, 1)
  assert.match(badAmount.errors[0], /ทศนิยมเกิน 2/)
  assert.equal(badAmount.values.amount, null)
  assert.match(textAmount.errors[0], /อ่านจำนวนเงิน "ไม่ระบุ" ไม่ได้/)
  assert.equal(textAmount.values.month_from, null) // ไม่มีเครื่องหมายเดือน = เดือนว่าง ไม่ใช่ error
  assert.equal(textAmount.values.note, 'ไม่มีเดือน')
})

test('ตัวอย่างฉบับร่าง: buildImportPreview — summary + แถวที่ข้าม (ว่าง/รวม)', () => {
  const { summary, skipped } = preview()
  assert.deepEqual(skipped, [
    { rowNumber: 8, reason: 'empty' },
    { rowNumber: 9, reason: 'total' },
    { rowNumber: 10, reason: 'total' },
    { rowNumber: 14, reason: 'total' },
  ])
  assert.deepEqual(summary, {
    total: 6,
    ok: 1,
    withWarnings: 2,
    withErrors: 3,
    unmatchedProjects: 3, // โครงการนอกทะเบียน + โครงการงบผิด + โครงการงบไม่ใช่เลข (แถวไม่มีชื่อไม่นับ)
    unmatchedDepartments: 1,
    skippedTotals: 3,
    skippedEmpty: 1,
  })
  assert.equal(summary.ok + summary.withWarnings + summary.withErrors, summary.total)
})

test('buildImportPreview: ไม่มีคอลัมน์เดือน → ใช้ข้อความระยะเวลา (period_text) / คอลัมน์เดือนเริ่ม-สิ้นสุด', () => {
  const rows = [
    ['ที่', 'โครงการ', 'ระยะเวลา'],
    ['1', 'ก', 'ต.ค.68–มี.ค.69'],
    ['2', 'ข', 'ไตรมาส 2'],
    ['3', 'ค', 'ต.ค.67–ธ.ค.67'],   // ปีนอกปีงบ → warning
    ['4', 'ง', 'ธ.ค.–ต.ค.'],        // ช่วงย้อน → error
    ['5', 'จ', 'ตลอดปี'],            // อ่านไม่ได้ → error
    ['6', 'ฉ', ''],                  // ว่าง → เดือนว่าง
  ]
  const { mapping } = I.guessMapping(rows[0])
  const { items } = I.buildImportPreview({ rows, headerRowIndex: 0, mapping, fiscalYearBE: 2569 })
  assert.deepEqual(items.map(i => [i.values.month_from, i.values.month_to]), [[1, 6], [4, 6], [1, 3], [null, null], [null, null], [null, null]])
  assert.ok(items[2].warnings.some(w => /ไม่อยู่ในปีงบประมาณ 2569/.test(w)))
  assert.match(items[3].errors[0], /อ่านระยะเวลา "ธ.ค.–ต.ค." ไม่ได้/)
  assert.match(items[4].errors[0], /อ่านระยะเวลา "ตลอดปี" ไม่ได้/)
  assert.deepEqual(items[5].errors, [])

  const rows2 = [['โครงการ', 'เดือนเริ่ม', 'เดือนสิ้นสุด'], ['ก', 'ต.ค.', 'ธ.ค.'], ['ข', 'มี.ค.', 'ม.ค.'], ['ค', '3', 'ธ.ค.'], ['ง', 'ต.ค.', '']]
  const m2 = I.guessMapping(rows2[0]).mapping
  assert.deepEqual(m2, { 0: 'item_name', 1: 'month_from', 2: 'month_to' })
  const r2 = I.buildImportPreview({ rows: rows2, headerRowIndex: 0, mapping: m2 }).items
  assert.deepEqual([r2[0].values.month_from, r2[0].values.month_to], [1, 3])
  assert.match(r2[1].errors[0], /ไม่ก่อน/)
  assert.match(r2[2].errors[0], /อ่านเดือนเริ่ม "3" ไม่ได้/) // เลขเดือนกำกวมระหว่างปฏิทิน/ปีงบ จึงไม่รับ
  assert.match(r2[3].errors[0], /ทั้งคู่/)
})

test('buildImportPreview: ข้อความยาวเกิน, กองซ้ำชื่อ, โครงการซ้ำชื่อในทะเบียน, ไม่ throw กับตารางว่าง', () => {
  const rows = [
    ['ที่', 'โครงการ', 'ผู้รับผิดชอบ', 'หมายเหตุ'],
    ['1', 'ก'.repeat(I.LIMITS.itemNameMax + 1), 'กองซ้ำ', 'ข'.repeat(I.LIMITS.noteMax + 1)],
    ['2', 'ก'.repeat(I.LIMITS.itemNameMax), 'กองซ้ำ', 'ข'.repeat(I.LIMITS.noteMax)],
    ['20000', 'ซ้ำ', '', ''],
  ]
  const { mapping } = I.guessMapping(rows[0])
  const depts = [{ id: 'x1', name: 'กองซ้ำ' }, { id: 'x2', name: 'กอง ซ้ำ' }]
  const projects = [{ id: 'q1', official_name: 'ซ้ำ' }, { id: 'q2', official_name: 'โครงการซ้ำ' }]
  const { items } = I.buildImportPreview({ rows, headerRowIndex: 0, mapping, departments: depts, projects })
  assert.equal(items[0].errors.length, 2)
  assert.match(items[0].errors[0], /ชื่อโครงการยาวเกิน 1000/)
  assert.match(items[0].errors[1], /หมายเหตุยาวเกิน 2000/)
  assert.deepEqual(items[1].errors, []) // พอดีขีดจำกัด ผ่าน
  assert.ok(items[1].warnings.some(w => /หลายกอง/.test(w)))
  assert.match(items[2].errors[0], /1–9999/)
  assert.ok(items[2].warnings.some(w => /หลายโครงการ/.test(w)))
  assert.deepEqual(I.buildImportPreview({ rows: [], headerRowIndex: 0, mapping: {} }).summary.total, 0)
  assert.deepEqual(I.buildImportPreview({ rows: [['ที่']], headerRowIndex: 0, mapping: { 0: 'seq_no' } }).items, [])
})

test('ทดสอบครบสาย: ไบต์ TIS-620 → decode → TSV → หัว 2 แถว → พรีวิว', () => {
  // ลูกศรไม่อยู่ใน TIS-620 — ไฟล์เก่าจริงๆ จึงใช้เครื่องหมายอื่นในช่องเดือน (ช่วงเดือนที่ได้ต้องเท่ากัน)
  const tsv = SAMPLE_ROWS.map(r => r.join('\t')).join('\r\n').replace(/[←↔→]/g, '*') + '\r\n'
  const decoded = T.decodeTextBytes(tis620(tsv))
  assert.equal(decoded.encoding, 'windows-874')
  const parsed = T.parseDelimited(decoded.text)
  assert.equal(parsed.delimiter, '\t')
  assert.equal(parsed.rows.length, SAMPLE_ROWS.length)
  const header = I.detectHeaderRows(parsed.rows)
  assert.deepEqual(header, { headerRowIndex: 2, headerRowCount: 2 })
  const { mapping, monthColumns } = I.guessMapping(T.mergeHeaderRows(parsed.rows, header.headerRowIndex, header.headerRowCount))
  const result = I.buildImportPreview({ rows: parsed.rows, ...header, mapping, monthColumns, departments: DEPARTMENTS, projects: PROJECTS, fiscalYearBE: 2569 })
  assert.deepEqual(result.summary, preview().summary)
})

// ── LIMITS เทียบกับ migration ───────────────────────────────────────────────

const migration = await readFile(new URL('../supabase/migrations/20261109100100_local_plan_tables.sql', import.meta.url), 'utf8')
const table = migration.match(/CREATE TABLE IF NOT EXISTS public\.local_op_plan_items \([\s\S]*?\n\);/)
assert.ok(table, 'หาตาราง local_op_plan_items ใน migration ไม่เจอ — รูปแบบ SQL เปลี่ยน ต้องแก้เทสต์')
const sql = table[0]
const grab = (re, what) => {
  const m = sql.match(re)
  assert.ok(m, `หา ${what} ใน migration ไม่เจอ — รูปแบบ SQL เปลี่ยน ต้องแก้เทสต์/LIMITS ให้ตรง`)
  return m.slice(1).map(Number)
}
test('LIMITS: item_name / note / seq_no / month / amount ตรง migration', () => {
  assert.deepEqual(grab(/item_name\s+text NOT NULL CHECK \(length\(btrim\(item_name\)\) BETWEEN (\d+) AND (\d+)\)/, 'CHECK item_name'), [1, I.LIMITS.itemNameMax])
  assert.deepEqual(grab(/note\s+text CHECK \(note IS NULL OR length\(note\) <= (\d+)\)/, 'CHECK note'), [I.LIMITS.noteMax])
  assert.deepEqual(grab(/seq_no\s+integer CHECK \(seq_no IS NULL OR seq_no BETWEEN (\d+) AND (\d+)\)/, 'CHECK seq_no'), [I.LIMITS.seqMin, I.LIMITS.seqMax])
  assert.deepEqual(grab(/month_from\s+smallint CHECK \(month_from IS NULL OR month_from BETWEEN (\d+) AND (\d+)\)/, 'CHECK month_from'), [I.LIMITS.monthMin, I.LIMITS.monthMax])
  assert.deepEqual(grab(/month_to\s+smallint CHECK \(month_to IS NULL OR month_to BETWEEN (\d+) AND (\d+)\)/, 'CHECK month_to'), [I.LIMITS.monthMin, I.LIMITS.monthMax])
  assert.deepEqual(grab(/amount\s+numeric\((\d+),\s*(\d+)\)/, 'ชนิด amount'), [I.LIMITS.amountPrecision, I.LIMITS.amountScale])
})

test('LIMITS: ค่าขอบที่ parser ยอมรับ = ค่าที่ migration ยอมรับ (งบสูงสุด 13 หลัก, ลำดับ 1–9999)', () => {
  const [precision, scale] = grab(/amount\s+numeric\((\d+),\s*(\d+)\)/, 'ชนิด amount')
  const maxText = '9'.repeat(precision - scale) + '.' + '9'.repeat(scale)
  assert.equal(I.parseAmount(maxText).error, undefined)
  assert.match(I.parseAmount('9'.repeat(precision - scale + 1)).error, /เกินขนาด/)
  const [lo, hi] = grab(/seq_no\s+integer CHECK \(seq_no IS NULL OR seq_no BETWEEN (\d+) AND (\d+)\)/, 'CHECK seq_no')
  assert.equal(I.parseSeq(String(lo)).error, undefined)
  assert.equal(I.parseSeq(String(hi)).error, undefined)
  assert.ok(I.parseSeq(String(lo - 1)).error)
  assert.ok(I.parseSeq(String(hi + 1)).error)
})

console.log(`\nlocal-plan-import: ${cases} cases passed`)

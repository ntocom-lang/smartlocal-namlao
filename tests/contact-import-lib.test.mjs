// นำเข้าสมุดเบอร์โทรจาก Excel (src/lib/contactImport.js) — ฟังก์ชันล้วน รันด้วย node ได้
//   node tests/contact-import-lib.test.mjs   (หรือ npm run test:contact-import)
// กันเรื่องที่เงียบแล้วพังตอนใช้จริง:
//   (1) Excel ตัดเลข 0 นำหน้ามือถือ → เบอร์ในหน้าสาธารณะโทรไม่ติด / ซ้ำกับเบอร์เดิมแต่ตรวจไม่เจอ
//   (2) แถวผิด/ซ้ำหลุดเข้าชุด insert (คำสั่งเดียวทั้งชุด แถวผิดแถวเดียวพังทั้งชุด)
//   (3) ระบบประทับ consent_at แทนเจ้าของเบอร์ (PDPA) — ต้องเป็น null ถ้าไฟล์ไม่ได้ระบุยินยอม
//   (4) payload ไม่ตรงกับคอลัมน์ที่ addContact ใส่ทีละเบอร์ (หน้าประชาชนจัดกลุ่ม/เรียงเพี้ยน)
import assert from 'node:assert/strict'
import * as C from '../src/lib/contactImport.js'

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

const H = ['ชื่อ', 'เบอร์โทร', 'หมวด', 'หมายเหตุ', 'ยินยอม']
const preview = (rows, ctx = {}) => C.buildContactImportPreview([H, ...rows], { book: 'directory', ...ctx })
const one = (row, ctx) => preview([row], ctx)

// ── หัวคอลัมน์ ──────────────────────────────────────────────────────────────────

await test('หัวคอลัมน์คำพ้อง: ชื่อหน่วยงาน/ชื่อ-สกุล · เบอร์/โทรศัพท์ · ตัวพิมพ์/ช่องว่าง/ขีดไม่ทำให้พลาด', () => {
  for (const [nameH, phoneH] of [['ชื่อหน่วยงาน', 'เบอร์'], ['ชื่อ-สกุล', 'โทรศัพท์'], ['ชื่อ สกุล', 'เบอร์โทรศัพท์'], ['Name', 'Phone'], ['ชื่อ', 'หมายเลขโทรศัพท์']]) {
    const p = C.buildContactImportPreview([[nameH, phoneH], ['สภ.ตัวอย่าง', '055-111222']], { book: 'urgent' })
    assert.deepEqual(p.errors, [], `${nameH}/${phoneH}`)
    assert.equal(p.toInsert.length, 1)
    assert.equal(p.toInsert[0].label, 'สภ.ตัวอย่าง')
  }
})

await test('ขาดคอลัมน์บังคับ = error ทั้งไฟล์ บอกชื่อคอลัมน์ที่ขาด และไม่มีแถวเข้าชุด', () => {
  const noPhone = C.buildContactImportPreview([['ชื่อ', 'หมายเหตุ'], ['ก', 'ข']], {})
  assert.equal(noPhone.errors.length, 1)
  assert.match(noPhone.errors[0], /เบอร์โทร/)
  assert.doesNotMatch(noPhone.errors[0], /ชื่อ,/)
  assert.equal(noPhone.toInsert.length, 0)
  const neither = C.buildContactImportPreview([['อะไรสักอย่าง', 'อีกอย่าง'], ['ก', 'ข']], {})
  assert.match(neither.errors[0], /ชื่อ.*เบอร์โทร/)
  const empty = C.buildContactImportPreview([H], {})
  assert.equal(empty.errors.length, 1)
  assert.match(empty.errors[0], /ไม่พบแถวข้อมูล/)
})

await test('แถวว่างทั้งแถวข้ามเงียบ (ไม่ขึ้น skipped) และเลขแถวนับตามไฟล์ (หัว = 1)', () => {
  const p = preview([['', '', '', '', ''], ['สำนักงานตัวอย่าง', '055-111222', '', '', ''], [undefined, ' ', '', '', '']])
  assert.equal(p.skipped.length, 0)
  assert.equal(p.toInsert.length, 1)
  assert.equal(p.toInsert[0].rowNo, 3)
})

// ── เบอร์โทร ────────────────────────────────────────────────────────────────────

await test('จัดรูปเบอร์: +66 → 0 · Excel ตัด 0 มือถือ 9 หลัก → เติม 0 · บ้าน 8 หลัก → เติม 0', () => {
  assert.equal(C.analyzeContactNumber('+66 81 234 5678').number, '0812345678')
  assert.equal(C.analyzeContactNumber('+66812345678').number, '0812345678')
  assert.equal(C.analyzeContactNumber('+66 (0) 81 234 5678').number, '0812345678')
  const lost = C.analyzeContactNumber('812345678')
  assert.equal(lost.number, '0812345678')
  assert.equal(lost.corrected, true)
  assert.equal(C.analyzeContactNumber('54511234').number, '054511234')
  assert.equal(C.analyzeContactNumber('943211234').number, '0943211234')
})

await test('เบอร์ปกติเก็บตามที่พิมพ์ (trim) ไม่แก้รูป · เลขไทยแปลงเป็นเลขอารบิก', () => {
  const a = C.analyzeContactNumber('  081-234-5678 ')
  assert.equal(a.number, '081-234-5678')
  assert.equal(a.digits, '0812345678')
  assert.equal(a.corrected, false)
  assert.equal(C.analyzeContactNumber('๐๘๑-๒๓๔-๕๖๗๘').number, '081-234-5678')
  assert.equal(C.analyzeContactNumber('(055) 511-234').digits, '055511234')
})

await test('เบอร์สั้น 3–5 หลักใช้ได้ (191 / 1669 / 1300) · 1–2 หลักและเกิน 10 หลักไม่ผ่าน', () => {
  for (const n of ['191', '1669', '1300', '12345']) assert.equal(C.analyzeContactNumber(n).ok, true, n)
  assert.equal(C.analyzeContactNumber('191').number, '191')
  assert.equal(C.analyzeContactNumber('19').ok, false)
  assert.equal(C.analyzeContactNumber('08123456789').ok, false)
})

await test('ตัวอักษรที่ไม่ใช่ตัวเลข/ขีด/วงเล็บ/ต่อ = ไม่ผ่าน · "ต่อ" เลขต่อผ่านและไม่ทำให้เบอร์ซ้ำกับเบอร์หลัก', () => {
  for (const bad of ['081-234-ABCD', 'โทรหาผม', '081 234 5678 โทรได้', '12.34.ab', '+1 555 123 4567', '']) {
    assert.equal(C.analyzeContactNumber(bad).ok, false, bad)
  }
  const ext = C.analyzeContactNumber('055-511234 ต่อ 12')
  assert.equal(ext.ok, true)
  assert.equal(ext.digits, '055511234')
  assert.notEqual(ext.key, C.analyzeContactNumber('055-511234').key)
  assert.equal(C.analyzeContactNumber('055-511234 ต่อ abc').ok, false)
})

await test('ในพรีวิว: เบอร์ผิดไปอยู่ skipped พร้อมเหตุผลและเลขแถว ไม่เข้า toInsert', () => {
  const p = preview([['ก', '081-ABC', '', '', ''], ['ข', '', '', '', ''], ['', '191', '', '', ''], ['ง', '191', '', '', '']])
  assert.deepEqual(p.skipped.map((s) => s.rowNo), [2, 3, 4])
  assert.match(p.skipped[0].reason, /ตัวอักษร/)
  assert.match(p.skipped[1].reason, /ไม่มีเบอร์/)
  assert.match(p.skipped[2].reason, /ไม่มีชื่อ/)
  assert.equal(p.toInsert.length, 1)
  assert.equal(p.toInsert[0].label, 'ง')
})

// ── ซ้ำ ─────────────────────────────────────────────────────────────────────────

await test('ซ้ำกับของเดิมในสมุดเดียวกัน = ข้าม (เทียบตัวเลขล้วน: ขีด/ช่องว่าง/0 ที่หายไม่ทำให้รอด)', () => {
  const existing = [{ number: '081-234-5678' }, { number: '191' }, { number: '055 511 234' }]
  const p = preview([
    ['ก', '0812345678', '', '', ''],
    ['ข', '812345678', '', '', ''], // Excel ตัด 0
    ['ค', '+66 81 234 5678', '', '', ''],
    ['ง', '191', '', '', ''],
    ['จ', '055-511234', '', '', ''],
    ['ฉ', '055-999999', '', '', ''],
  ], { existing })
  assert.deepEqual(p.skipped.map((s) => s.rowNo), [2, 3, 4, 5, 6])
  for (const s of p.skipped) assert.match(s.reason, /ซ้ำกับที่มีอยู่แล้ว/)
  assert.match(p.skipped[0].reason, /เบอร์โทรสำคัญ/) // ชื่อสมุดตาม book
  assert.deepEqual(p.toInsert.map((t) => t.label), ['ฉ'])
})

await test('ซ้ำกันเองในไฟล์ = เก็บแถวแรก ข้ามแถวหลังพร้อมบอกว่าซ้ำแถวไหน', () => {
  const p = preview([['ก', '081-111-2222', '', '', ''], ['ข', '0811112222', '', '', ''], ['ค', '055-000111', '', '', '']])
  assert.deepEqual(p.toInsert.map((t) => t.label), ['ก', 'ค'])
  assert.equal(p.skipped.length, 1)
  assert.equal(p.skipped[0].rowNo, 3)
  assert.match(p.skipped[0].reason, /แถว 2 ในไฟล์/)
})

await test('ไม่ส่ง existing = ไม่เทียบกับของเดิม ไม่พัง', () => {
  const p = C.buildContactImportPreview([H, ['ก', '191', '', '', '']])
  assert.equal(p.toInsert.length, 1)
  assert.deepEqual(p.errors, [])
})

// ── จำกัดแถว ────────────────────────────────────────────────────────────────────

await test('เกิน 300 แถว = error ทั้งไฟล์ (ไม่มีแถวใดเข้าชุด) · 300 พอดีผ่าน', () => {
  assert.equal(C.CONTACT_IMPORT_MAX_ROWS, 300)
  const mk = (n) => Array.from({ length: n }, (_, i) => [`หน่วยงาน ${i + 1}`, `055${String(100000 + i)}`, '', '', ''])
  const over = preview(mk(301))
  assert.equal(over.errors.length, 1)
  assert.match(over.errors[0], /300/)
  assert.equal(over.toInsert.length, 0)
  const ok = preview(mk(300))
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.toInsert.length, 300)
})

// ── หมวด ────────────────────────────────────────────────────────────────────────

await test('หมวด: ป้ายไทย · key อังกฤษ · "อื่นๆ" ไม่มีช่องว่างก็จับได้', () => {
  const p = preview([
    ['ก', '055-000001', 'หน่วยงานราชการ', '', ''],
    ['ข', '055-000002', 'health', '', ''],
    ['ค', '055-000003', 'ผู้นำท้องถิ่น', '', ''],
    ['ง', '055-000004', 'อื่นๆ', '', ''],
    ['จ', '055-000005', 'อื่น ๆ', '', ''],
    ['ฉ', '055-000006', 'เหตุด่วนเหตุร้าย', '', ''],
  ])
  assert.deepEqual(p.toInsert.map((t) => t.category), ['government', 'health', 'leader', 'other', 'other', 'emergency'])
  assert.equal(p.warnings.length, 0) // ระบุชัดว่า "อื่นๆ" ไม่ใช่ความเดา — ไม่ต้องเตือน
})

await test('หมวดว่าง → เดาจากชื่อ (guessCategory) · เดาไม่ได้ → other พร้อมเหตุผลใน warnings', () => {
  const p = preview([
    ['สถานีตำรวจตัวอย่าง', '055-000011', '', '', ''],
    ['โรงพยาบาลตัวอย่าง', '055-000012', '', '', ''],
    ['ร้านลุงตัวอย่าง', '055-000013', '', '', ''],
  ])
  assert.deepEqual(p.toInsert.map((t) => t.category), ['emergency', 'health', 'other'])
  assert.equal(p.warnings.length, 1)
  assert.equal(p.warnings[0].rowNo, 4)
  assert.equal(p.warnings[0].kind, 'category')
  assert.match(p.warnings[0].reason, /อื่น ๆ/)
})

await test('หมวดที่ไม่รู้จัก → other (ไม่ error ไม่ข้าม) พร้อมบอกว่าไม่รู้จักคำไหน', () => {
  const p = one(['สำนักงานตัวอย่าง', '055-000021', 'หมวดมั่วๆ', '', ''])
  assert.equal(p.skipped.length, 0)
  assert.equal(p.toInsert[0].category, 'other')
  assert.match(p.warnings[0].reason, /ไม่รู้จักหมวด "หมวดมั่วๆ"/)
  assert.match(p.warnings[0].reason, /อื่น ๆ/)
})

// ── ยินยอม + warning ────────────────────────────────────────────────────────────

await test('ยินยอม: ใช่/ยินยอม/y/yes/true/1/✓ = true · นอกนั้น false', () => {
  for (const v of ['ใช่', 'ยินยอม', 'y', 'Y', 'yes', 'YES', 'true', 'TRUE', '1', '✓']) assert.equal(C.parseConsent(v), true, v)
  for (const v of ['', 'ไม่', 'ไม่ยินยอม', 'no', 'false', '0', 'x', undefined, null]) assert.equal(C.parseConsent(v), false, String(v))
})

await test('warning: มือถือส่วนตัวที่ไม่ยินยอม = เตือน (ไม่บล็อก ยังเข้าชุด) · ยินยอมแล้ว/เบอร์หน่วยงาน/เบอร์สั้น = ไม่เตือน', () => {
  const p = preview([
    ['นายตัวอย่าง ก', '081-000-0001', 'ผู้นำท้องถิ่น', '', ''],
    ['นายตัวอย่าง ข', '081-000-0002', 'ผู้นำท้องถิ่น', '', 'ใช่'],
    ['สำนักงานตัวอย่าง', '055-000003', 'หน่วยงานราชการ', '', ''],
    ['สายด่วนตัวอย่าง', '1669', 'เหตุด่วนเหตุร้าย', '', ''],
    ['นายตัวอย่าง ค', '81 000 0004', 'ผู้นำท้องถิ่น', '', ''], // Excel ตัด 0 แต่ยังเป็นมือถือ
  ])
  assert.equal(p.toInsert.length, 5)
  const consentWarn = p.warnings.filter((w) => w.kind === 'consent')
  assert.deepEqual(consentWarn.map((w) => w.rowNo), [2, 6])
  assert.match(consentWarn[0].reason, /เบอร์มือถือส่วนตัว ยังไม่ได้ติ๊กยินยอม — ขึ้นหน้าสาธารณะ/)
})

// ── payload ─────────────────────────────────────────────────────────────────────

await test('payload: คอลัมน์ตรงกับ addContact · display_order ต่อท้ายตามลำดับในไฟล์ · note ว่าง = null', () => {
  const p = preview([
    ['สำนักงานตัวอย่าง', '055-000001', 'หน่วยงานราชการ', 'เวลาราชการ', ''],
    ['ร้านตัวอย่าง', '055-000002', '', '', ''],
  ])
  const now = new Date('2026-11-19T05:00:00Z')
  const rows = C.buildContactInsertPayload(p.toInsert, { municipalityId: 'm-1', book: 'directory', startOrder: 8, now })
  assert.equal(rows.length, 2)
  assert.deepEqual(Object.keys(rows[0]).sort(), ['bg', 'book', 'category', 'color', 'consent_at', 'display_order', 'emoji', 'label', 'municipality_id', 'note', 'number'])
  assert.deepEqual(rows.map((r) => r.display_order), [8, 9])
  assert.equal(rows[0].municipality_id, 'm-1')
  assert.equal(rows[0].book, 'directory')
  assert.equal(rows[0].category, 'government')
  assert.equal(rows[0].note, 'เวลาราชการ')
  assert.equal(rows[1].note, null)
  assert.equal(rows[0].emoji, '📞')
  assert.equal(rows[0].color, '#1d4ed8')
  assert.equal(rows[0].bg, '#dbeafe')
})

await test('payload: guessEmoji ที่ส่งมาถูกใช้ · คืนค่าว่าง = ตกไป 📞', () => {
  const p = preview([['สถานีตำรวจตัวอย่าง', '055-000001', '', '', ''], ['อะไรสักอย่าง', '055-000002', '', '', '']])
  const rows = C.buildContactInsertPayload(p.toInsert, {
    municipalityId: 'm', book: 'urgent', startOrder: 1,
    guessEmoji: (l) => (l.includes('ตำรวจ') ? '👮' : ''),
  })
  assert.deepEqual(rows.map((r) => r.emoji), ['👮', '📞'])
})

await test('payload: consent_at = ISO ตอนนำเข้าเฉพาะแถวที่ยินยอม ไม่งั้น null (ระบบไม่ประทับยินยอมแทนเจ้าของเบอร์)', () => {
  const p = preview([
    ['นายตัวอย่าง ก', '081-000-0001', 'ผู้นำท้องถิ่น', '', 'ใช่'],
    ['นายตัวอย่าง ข', '081-000-0002', 'ผู้นำท้องถิ่น', '', ''],
    ['สำนักงานตัวอย่าง', '055-000003', 'หน่วยงานราชการ', '', 'ไม่'],
  ])
  const now = new Date('2026-11-19T05:00:00Z')
  const rows = C.buildContactInsertPayload(p.toInsert, { municipalityId: 'm', book: 'directory', startOrder: 1, now })
  assert.equal(rows[0].consent_at, '2026-11-19T05:00:00.000Z')
  assert.equal(rows[1].consent_at, null)
  assert.equal(rows[2].consent_at, null)
})

await test('payload: เบอร์ที่แก้รูปแล้ว (เติม 0 / +66) ถูกเก็บเป็นเบอร์ที่แก้แล้ว ไม่ใช่ค่าที่ Excel ทำหาย', () => {
  const p = preview([['นายตัวอย่าง', '812345678', 'ผู้นำท้องถิ่น', '', 'ใช่'], ['นายตัวอย่าง ข', '+66 82 345 6789', 'ผู้นำท้องถิ่น', '', 'ใช่']])
  const rows = C.buildContactInsertPayload(p.toInsert, { municipalityId: 'm', book: 'directory', startOrder: 1 })
  assert.deepEqual(rows.map((r) => r.number), ['0812345678', '0823456789'])
})

await test('ไฟล์แม่แบบ: BOM UTF-8 · หัวคอลัมน์ครบ · parse กลับด้วยตัวอ่านกลางผ่านพรีวิวโดยไม่มี error (เบอร์ตัวอย่างสมมติ)', async () => {
  const { parseCsv } = await import('../src/lib/spreadsheetRead.js')
  const csv = C.buildContactTemplateCsv()
  assert.equal(csv.charCodeAt(0), 0xfeff)
  const matrix = parseCsv(csv.slice(1))
  assert.deepEqual(matrix[0], [...C.CONTACT_IMPORT_TEMPLATE_HEADERS])
  const p = C.buildContactImportPreview(matrix, { book: 'directory' })
  assert.deepEqual(p.errors, [])
  assert.equal(p.toInsert.length, matrix.length - 1)
  for (const row of matrix.slice(1)) assert.match(row[1], /000/, 'เบอร์ตัวอย่างต้องเป็นเบอร์สมมติ')
})

console.log(`\n${cases} cases passed`)

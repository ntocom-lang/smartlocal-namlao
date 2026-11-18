// รับชำระเงิน · แปลงไฟล์ธนาคาร + ตัวช่วยหน้าเงินเข้า (ขั้น 1C / E4 PR2) — เทสต์ตรรกะล้วน (ไม่ใช้เน็ต/ฐานข้อมูล/เบราว์เซอร์) · รันด้วย node
//   ครอบคลุม: วันที่ (ค.ศ./พ.ศ./ปี 2 หลัก/เลขลำดับ Excel/วันที่+เวลาช่องเดียว) · ยอด (ตัดสัญลักษณ์/ทศนิยมเกิน/ไม่ใช่เงินเข้า) · ข้ามแถวพร้อมเหตุผล
//   เดาคอลัมน์จากหัวไทย/อังกฤษ · ไม่แม็ปคอลัมน์ชื่อ/บัญชี · mapping เก็บ/คืนค่า · แบ่งชุด ≤ 5,000 (แถวเหมือนกันไม่ถูกแยกชุด)
//   ตัวช่วยของแท็บ: สรุปรายวัน · ป้ายเงินเข้าที่ยอดค้าง · ค่าเติมใบเสร็จ · สถานะแจ้งผู้บริหารบนแบนเนอร์เปลี่ยนบัญชี
import assert from 'node:assert/strict'
import {
  MAX_IMPORT_ROWS, chunkBankRows, explainRowError, guessHeaderRow, guessMapping, headerLabels, isBlockedHeader, mappingToSaved,
  parseBankAmount, parseBankDate, parseBankRows, parseBankTime, postingDateWarning, resolveSavedMapping, validateMapping,
} from '../src/lib/paymentBankImport.js'
import {
  BANK_FILTERS, MATCH_MODE_TEXT, accountAlertNotice, accountChangeBanner, awaitingBankFile, bankTxnChannel, dailyBankSummary, matchedTxnByDue, receiptPrefillOf, searchBankTxns, sumBankAmount,
} from '../src/lib/paymentDues.js'

let cases = 0
const test = (label, run) => { run(); cases += 1; console.log('PASS ' + label) }

const TODAY = '2026-11-18'

// ── วันที่ ────────────────────────────────────────────────────────────────────────────
test('วันที่: dd/mm/yyyy · d/m/yy · yyyy-mm-dd · yyyy/mm/dd รับได้ (วัน/เดือน/ปี ตามแบบไทย)', () => {
  assert.deepEqual(parseBankDate('18/11/2026'), { date: '2026-11-18', time: null, shortYear: false })
  assert.equal(parseBankDate('3/4/2026').date, '2026-04-03')
  assert.equal(parseBankDate('2026-11-18').date, '2026-11-18')
  assert.equal(parseBankDate('2026/11/18').date, '2026-11-18')
  assert.equal(parseBankDate('18-11-2026').date, '2026-11-18')
  const short = parseBankDate('5/11/26')
  assert.equal(short.date, '2026-11-05')
  assert.equal(short.shortYear, true, 'ปี 2 หลักอ่านเป็น 20yy และติดธงไว้ให้ด่านช่วงวันที่/ข้อความบอกคน')
})

test('วันที่: ปี พ.ศ. (> 2400 ลบ 543) ทั้งแบบ dd/mm/yyyy และ yyyy-mm-dd', () => {
  assert.equal(parseBankDate('18/11/2569').date, '2026-11-18')
  assert.equal(parseBankDate('2569-11-18').date, '2026-11-18')
  assert.equal(parseBankDate('1/1/2569').date, '2026-01-01')
})

test('วันที่: เลขลำดับวันของ Excel (xlsx คืนเป็นสตริงตัวเลข) + เศษส่วนวัน = เวลา', () => {
  // 46344 = 2026-11-18 (ฐาน 1899-12-30)
  assert.equal(parseBankDate('46344').date, '2026-11-18')
  assert.equal(parseBankDate('46344').time, null)
  const withTime = parseBankDate('46344.4375') // 0.4375 วัน = 10:30:00
  assert.deepEqual([withTime.date, withTime.time], ['2026-11-18', '10:30:00'])
  assert.ok(parseBankDate('99999999').error, 'เลขใหญ่ (เช่น 20261118 ติดกัน) ไม่เดา')
})

test('วันที่+เวลาในช่องเดียว: เว้นวรรค · T · น. · มี/ไม่มีวินาที', () => {
  assert.deepEqual([parseBankDate('18/11/2569 10:30:15').date, parseBankDate('18/11/2569 10:30:15').time], ['2026-11-18', '10:30:15'])
  assert.equal(parseBankDate('2026-11-18T09:05').time, '09:05:00')
  assert.equal(parseBankDate('18/11/2026 9:05 น.').time, '09:05:00')
})

test('วันที่ที่ไม่แน่ใจ = error (ไม่เดา): ตัวอักษร · เดือน 13 · วัน 31 ของเดือนที่มี 30 · ว่าง · เวลาผิด', () => {
  for (const bad of ['abc', '32/01/2026', '31/04/2026', '18/13/2026', '2026-02-30', '18 พ.ย. 2569', '18/11/2026 25:00', '18/11/2026 10:30 PM']) {
    assert.ok(parseBankDate(bad).error, `ควรอ่านไม่ได้: ${bad}`)
  }
  assert.equal(parseBankDate('').error, 'ไม่มีวันที่')
})

test('เวลา: HH:MM[:SS] · HHMM / HHMMSS ล้วน · เศษส่วนวัน · ผิด = null', () => {
  assert.equal(parseBankTime('10:30'), '10:30:00')
  assert.equal(parseBankTime('1030'), '10:30:00')
  assert.equal(parseBankTime('103015'), '10:30:15')
  assert.equal(parseBankTime('0.5'), '12:00:00')
  assert.equal(parseBankTime('10:30:15 น.'), '10:30:15')
  assert.equal(parseBankTime('24:00'), null)
  assert.equal(parseBankTime('10:61'), null)
  assert.equal(parseBankTime('สิบโมง'), null)
  assert.equal(parseBankTime(''), null)
})

// ── ยอด ───────────────────────────────────────────────────────────────────────────────
test('ยอด: ตัด , ฿ ช่องว่าง บาท → สตริง 2 ตำแหน่ง (ไม่ใช้ทศนิยมลอยตัว)', () => {
  assert.equal(parseBankAmount('1,234.5').amount, '1234.50')
  assert.equal(parseBankAmount('฿ 1,000').amount, '1000.00')
  assert.equal(parseBankAmount(' 250.00 บาท').amount, '250.00')
  assert.equal(parseBankAmount('+500').amount, '500.00')
  assert.equal(parseBankAmount('0.10').amount, '0.10')
  assert.equal(parseBankAmount('100.000').amount, '100.00', 'ศูนย์ท้ายเกิน 2 ตำแหน่งไม่เปลี่ยนค่า')
  assert.equal(parseBankAmount('007.5').amount, '7.50')
})

test('ยอด: ทศนิยมเกิน 2 ตำแหน่ง (ไม่ใช่ศูนย์) = error · ไม่ใช่ตัวเลข = error · เกิน 10 ล้าน = error', () => {
  assert.match(parseBankAmount('100.123').error, /ทศนิยมเกิน 2/)
  assert.ok(parseBankAmount('12abc').error)
  assert.ok(parseBankAmount('1.2E+3').error)
  assert.match(parseBankAmount('10000000.01').error, /10 ล้าน/)
  assert.equal(parseBankAmount('10000000').amount, '10000000.00')
})

test('ยอด: ว่าง / 0 / ติดลบ / วงเล็บ = ข้ามว่า "ไม่ใช่เงินเข้า"', () => {
  for (const v of ['', '0', '0.00', '-100', '(100.00)']) assert.equal(parseBankAmount(v).skip, 'ไม่ใช่เงินเข้า', `ค่า "${v}"`)
})

// ── H-1: วันทำรายการก่อนวันลงบัญชี ───────────────────────────────────────────────────────
test('เดาวันที่: วันทำรายการ/วันที่ชำระมาก่อนวันลงบัญชีเสมอ แม้วันลงบัญชีอยู่ซ้ายกว่า · เจอแค่วันลงบัญชี = ใช้ แต่เตือน', () => {
  const both = ['วันที่ลงบัญชี', 'วันที่ทำรายการ', 'จำนวนเงิน', 'Ref1']
  assert.equal(guessMapping(both).date, 1)
  assert.equal(postingDateWarning(both, { cols: { date: guessMapping(both).date } }), false)
  const eng = ['Posting Date', 'Value Date', 'Transaction Date', 'Amount']
  assert.equal(guessMapping(eng).date, 2)
  const pay = ['Value date', 'วันที่ชำระ', 'Credit']
  assert.equal(guessMapping(pay).date, 1)
  // เจอแค่วันลงบัญชี: ยังเดาให้ (ไม่ใช่ null) และเตือน — ห้ามถูกกั้นเป็นคอลัมน์ "บัญชี"
  const only = ['วันที่ลงบัญชี', 'จำนวนเงิน']
  assert.equal(isBlockedHeader('วันที่ลงบัญชี'), false, 'วันลงบัญชีเป็นวันที่ ไม่ใช่เลข/ชื่อบัญชี')
  assert.equal(isBlockedHeader('เลขที่บัญชี'), true, 'เลขบัญชียังถูกกั้น')
  assert.equal(guessMapping(only).date, 0)
  assert.equal(postingDateWarning(only, { cols: { date: 0 } }), true)
  assert.equal(postingDateWarning(['Posting Date', 'Amount'], { cols: { date: 0 } }), true)
  assert.equal(postingDateWarning(['วันที่', 'ยอด'], { cols: { date: 0 } }), false, 'หัวกลางๆ ไม่เตือน')
  assert.equal(postingDateWarning(only, { cols: { date: null } }), false)
  assert.equal(validateMapping({ headerRow: 1, cols: { date: 0, amount: 1 } }, only), '', 'เลือกวันลงบัญชีได้ (เตือนอย่างเดียว ไม่ห้าม)')
})

// ── แปลงทั้งไฟล์ ──────────────────────────────────────────────────────────────────────
const BILL = [
  ['รายงานรับชำระ Bill Payment', '', '', '', '', ''],
  ['วันที่', 'เวลา', 'จำนวนเงิน', 'Ref1', 'Ref2', 'ชื่อผู้ชำระ'],
  ['18/11/2569', '10:30:15', '1,000.00', '123456789012', 'A1', 'นายสมชาย ใจดี'],
  ['18/11/2569', '11:00', '500.50', '', '', 'นางสมหญิง'],
  ['17/11/2569', '', '250', '9876', '', 'ลับ ลับ'],
]
const billMapping = () => {
  const headerRow = guessHeaderRow(BILL)
  return { headerRow, cols: guessMapping(headerLabels(BILL, headerRow)) }
}

test('ไฟล์ตัวอย่าง Bill Payment: เดาแถวหัวตาราง+คอลัมน์ถูก และไม่แม็ปคอลัมน์ "ชื่อผู้ชำระ"', () => {
  const m = billMapping()
  assert.equal(m.headerRow, 2)
  assert.deepEqual(m.cols, { date: 0, time: 1, amount: 2, credit: null, ref1: 3, ref2: 4, bankRef: null })
  assert.equal(Object.values(m.cols).includes(5), false, 'ชื่อผู้ชำระ (คอลัมน์ 5) ห้ามถูกแม็ป')
  assert.equal(validateMapping(m, headerLabels(BILL, 2)), '')
})

test('แปลงแถว: ส่งเฉพาะ txn_at/amount/ref1/ref2/bank_ref · ไม่มีชื่อผู้โอนหลุดไปในค่าใดเลย', () => {
  const out = parseBankRows(BILL, billMapping(), { today: TODAY })
  assert.equal(out.rows.length, 3)
  assert.deepEqual(out.rows[0], { txn_at: '2026-11-18 10:30:15', amount: '1000.00', ref1: '123456789012', ref2: 'A1', bank_ref: null })
  assert.deepEqual(out.rows[1], { txn_at: '2026-11-18 11:00:00', amount: '500.50', ref1: null, ref2: null, bank_ref: null })
  assert.deepEqual(out.rows[2], { txn_at: '2026-11-17', amount: '250.00', ref1: '9876', ref2: null, bank_ref: null }, 'ไม่มีเวลา = ส่งเฉพาะวันที่')
  assert.deepEqual(out.lines, [3, 4, 5])
  assert.equal(out.dataRows, 3)
  const wire = JSON.stringify(out.rows)
  for (const secret of ['สมชาย', 'สมหญิง', 'ลับ', 'ใจดี']) assert.equal(wire.includes(secret), false, `ชื่อ "${secret}" หลุดเข้าแถวที่จะส่ง`)
  for (const row of out.rows) assert.deepEqual(Object.keys(row).sort(), ['amount', 'bank_ref', 'ref1', 'ref2', 'txn_at'])
})

test('คอลัมน์เงินเข้า (credit): แถวว่าง/≤0 ข้ามพร้อมเหตุผล "ไม่ใช่เงินเข้า" · เลือกทั้งสองแบบพร้อมกันไม่ได้', () => {
  const stmt = [
    ['วันที่', 'เงินออก', 'เงินเข้า', 'คงเหลือ', 'รายละเอียด'],
    ['18/11/2569', '300.00', '', '9,700.00', 'โอนไปบัญชีอื่น'],
    ['18/11/2569', '', '1,500.00', '11,200.00', 'จาก นายสมชาย'],
    ['18/11/2569', '', '0.00', '11,200.00', ''],
  ]
  const headers = headerLabels(stmt, 1)
  const g = guessMapping(headers)
  assert.equal(g.credit, 2)
  assert.equal(g.amount, null, 'มีเงินเข้าแล้วไม่เดาจำนวนเงินซ้ำ')
  assert.equal(g.date, 0)
  const out = parseBankRows(stmt, { headerRow: 1, cols: g }, { today: TODAY })
  assert.deepEqual(out.rows.map(r => r.amount), ['1500.00'])
  assert.equal(out.skipped.length, 2)
  assert.ok(out.skipped.every(s => s.reason.includes('ไม่ใช่เงินเข้า')), JSON.stringify(out.skipped))
  assert.match(validateMapping({ headerRow: 1, cols: { ...g, amount: 1 } }, headers), /เพียงแบบเดียว/)
})

test('ข้ามแถวพร้อมเหตุผล: วันที่อ่านไม่ได้ · ยอดทศนิยมเกิน · เวลาผิด · Ref1 ไม่ใช่ตัวเลข · แถวสรุปท้ายตาราง', () => {
  const grid = [
    ['วันที่', 'เวลา', 'จำนวนเงิน', 'Ref1'],
    ['ไม่ใช่วันที่', '', '100', ''],
    ['18/11/2026', '', '100.123', ''],
    ['18/11/2026', '25:61', '100', ''],
    ['18/11/2026', '', '100', '1.2E+11'],
    ['18/11/2026', '09:00', '100', '12 3456-7890'],
    ['รวม', '', '', ''],
  ]
  const out = parseBankRows(grid, { headerRow: 1, cols: { date: 0, time: 1, amount: 2, credit: null, ref1: 3, ref2: null, bankRef: null } }, { today: TODAY })
  assert.equal(out.rows.length, 1)
  assert.equal(out.rows[0].ref1, '1234567890', 'ตัดช่องว่าง/ขีดใน Ref1')
  assert.deepEqual(out.skipped.map(s => s.line), [2, 3, 4, 5, 7])
  assert.match(out.skipped[0].reason, /อ่านวันที่/)
  assert.match(out.skipped[1].reason, /ทศนิยมเกิน 2/)
  assert.match(out.skipped[2].reason, /เวลา/)
  assert.match(out.skipped[3].reason, /Ref1/)
  assert.match(out.skipped[4].reason, /ไม่มียอดเงิน/)
})

test('ด่านช่วงวันที่เหมือนฐาน: อนาคต / เก่ากว่า 400 วัน = ข้ามพร้อมคำแนะนำ (แถวเดียวไม่ทำให้ฐานปฏิเสธทั้งไฟล์)', () => {
  const grid = [['วันที่', 'ยอด'], ['19/11/2026', '100'], ['18/11/2026', '100'], ['14/10/2025', '100'], ['13/10/2025', '100'], ['5/11/69', '100']]
  const out = parseBankRows(grid, { headerRow: 1, cols: { date: 0, time: null, amount: 1, credit: null, ref1: null, ref2: null, bankRef: null } }, { today: TODAY })
  // 14/10/2025 = ย้อนหลัง 400 วันพอดี (รับ) · 13/10/2025 = 401 วัน (ข้าม)
  assert.deepEqual(out.rows.map(r => r.txn_at), ['2026-11-18', '2025-10-14'])
  assert.match(out.skipped.find(s => s.line === 2).reason, /ในอนาคต/)
  assert.match(out.skipped.find(s => s.line === 5).reason, /เก่ากว่า 400 วัน/)
  assert.match(out.skipped.find(s => s.line === 6).reason, /ปี 2 หลัก/, 'ปี 2 หลักที่ตกอนาคต ต้องบอกให้แก้เป็นปี 4 หลัก')
})

test('เวลาจากคอลัมน์เวลาแยกชนะเวลาในช่องวันที่ · วันที่+เวลาช่องเดียวใช้ได้เมื่อไม่มีคอลัมน์เวลา', () => {
  const grid = [['วันที่/เวลา', 'ยอด'], ['18/11/2569 10:30:15', '100']]
  const out = parseBankRows(grid, { headerRow: 1, cols: { date: 0, time: null, amount: 1, credit: null, ref1: null, ref2: null, bankRef: null } }, { today: TODAY })
  assert.equal(out.rows[0].txn_at, '2026-11-18 10:30:15')
})

test('เลขอ้างอิงธนาคาร: รับเฉพาะ A-Z a-z 0-9 / _ . : - (ตัดช่องว่างก่อน) · ข้อความไทย/ชื่อคน = ข้ามแถว ไม่ส่งขึ้นฐาน (เลือกคอลัมน์ผิด)', () => {
  const grid = [['วันที่', 'ยอด', 'เลขที่รายการ'], ['18/11/2569', '100', 'TXN 0001/ab:9'], ['18/11/2569', '100', 'นายสมชาย ใจดี'], ['18/11/2569', '100', 'REF-ชื่อ']]
  const out = parseBankRows(grid, { headerRow: 1, cols: { date: 0, time: null, amount: 1, credit: null, ref1: null, ref2: null, bankRef: 2 } }, { today: TODAY })
  assert.deepEqual(out.rows.map(r => r.bank_ref), ['TXN0001/ab:9'])
  assert.equal(out.skipped.length, 2)
  assert.ok(out.skipped.every(s => s.reason.includes('ไม่ใช่ละติน/ตัวเลข')), JSON.stringify(out.skipped))
  assert.equal(JSON.stringify(out.rows).includes('สมชาย'), false, 'ชื่อคนไม่หลุดไปในแถวที่จะส่ง')
})

test('Excel (xlsx): วันที่เป็นเลขลำดับ ยอดเป็นสตริงตัวเลขดิบ · เลขอ้างอิงธนาคารยาวเกิน 64 ตัว = ข้าม', () => {
  const grid = [['Date', 'Amount', 'Ref.1', 'Transaction ID'], ['46344.4375', '1234.5', '123456789012', 'TXN0001'], ['46344', '10', '', 'x'.repeat(65)]]
  const m = guessMapping(headerLabels(grid, 1))
  assert.deepEqual(m, { date: 0, time: null, amount: 1, credit: null, ref1: 2, ref2: null, bankRef: 3 })
  const out = parseBankRows(grid, { headerRow: 1, cols: m }, { today: TODAY })
  assert.deepEqual(out.rows[0], { txn_at: '2026-11-18 10:30:00', amount: '1234.50', ref1: '123456789012', ref2: null, bank_ref: 'TXN0001' })
  assert.equal(out.skipped.length, 1)
  assert.match(out.skipped[0].reason, /ยาวเกิน 64/)
})

// ── เดาคอลัมน์ / ห้ามแม็ปชื่อ ─────────────────────────────────────────────────────────
test('เดาคอลัมน์จากหัวไทย/อังกฤษหลายแบบ (Reference 1, เลขอ้างอิง 1, Credit, เวลา)', () => {
  const a = guessMapping(['Transaction Date', 'Time', 'Credit Amount', 'Reference 1', 'Reference 2', 'Bank Txn ID'])
  assert.deepEqual(a, { date: 0, time: 1, amount: null, credit: 2, ref1: 3, ref2: 4, bankRef: 5 })
  const b = guessMapping(['วันที่รับชำระ', 'เวลา', 'จำนวนเงิน (บาท)', 'เลขอ้างอิง 1', 'เลขอ้างอิง 2', 'เลขที่รายการ'])
  assert.deepEqual(b, { date: 0, time: 1, amount: 2, credit: null, ref1: 3, ref2: 4, bankRef: 5 })
  const c = guessMapping(['วันที่/เวลา', 'ฝาก', 'Ref.1'])
  assert.deepEqual(c, { date: 0, time: null, amount: null, credit: 1, ref1: 2, ref2: null, bankRef: null })
})

test('หัวคอลัมน์ที่เป็นชื่อ/บัญชี/รายละเอียด: ไม่เดา · เลือกเองไม่ได้ (validateMapping ปฏิเสธ) · คอลัมน์ซ้ำไม่ได้', () => {
  for (const h of ['ชื่อผู้โอน', 'ชื่อบัญชี', 'เลขที่บัญชี', 'Account No', 'Payer Name', 'Sender', 'รายละเอียด', 'Description', 'หมายเหตุ', 'ผู้ชำระเงิน', 'Transfer From']) {
    assert.equal(isBlockedHeader(h), true, `ควรถูกกั้น: ${h}`)
  }
  for (const h of ['วันที่', 'จำนวนเงิน', 'Ref1', 'Reference 2', 'เลขที่รายการ', 'Transaction ID', 'เงินเข้า']) {
    assert.equal(isBlockedHeader(h), false, `ไม่ควรถูกกั้น: ${h}`)
  }
  // ชื่อคอลัมน์ชื่อ/รายละเอียดอยู่ก่อน — ต้องไม่ถูกเดาเป็น Ref/เลขอ้างอิงธนาคาร แม้อยู่ในตำแหน่งที่น่าจะใช่
  const g = guessMapping(['วันที่', 'ชื่อผู้โอน', 'รายละเอียด', 'จำนวนเงิน', 'Ref1'])
  assert.deepEqual(g, { date: 0, time: null, amount: 3, credit: null, ref1: 4, ref2: null, bankRef: null })
  const headers = ['วันที่', 'ชื่อผู้โอน', 'จำนวนเงิน', 'Ref1']
  assert.match(validateMapping({ headerRow: 1, cols: { date: 0, amount: 2, ref1: 1 } }, headers), /ชื่อหรือเลขบัญชีผู้โอน/)
  assert.match(validateMapping({ headerRow: 1, cols: { date: 0, amount: 2, ref1: 2 } }, headers), /ซ้ำ/)
  assert.match(validateMapping({ headerRow: 1, cols: { amount: 2 } }, headers), /วันที่/)
  assert.match(validateMapping({ headerRow: 1, cols: { date: 0 } }, headers), /จำนวนเงิน/)
})

test('mapping บันทึก/คืนค่า: เก็บข้อความหัวคอลัมน์ (หัวว่าง = #ลำดับ) · หัวเปลี่ยน = ช่องว่าง · ไม่เก็บค่าในไฟล์ · คีย์ตรงกฎฐาน', () => {
  const grid = [['วันที่', 'เวลา', 'จำนวนเงิน', 'Ref1', ''], ['18/11/2569', '10:00', '100', '123', 'x']]
  const mapping = { headerRow: 1, cols: { date: 0, time: 1, amount: 2, credit: null, ref1: 3, ref2: null, bankRef: 4 } }
  const saved = mappingToSaved(mapping, headerLabels(grid, 1))
  assert.deepEqual(saved, { header_row: 1, date_col: 'วันที่', time_col: 'เวลา', amount_col: 'จำนวนเงิน', ref1_col: 'Ref1', bank_ref_col: '#5' })
  for (const [key, value] of Object.entries(saved)) {
    assert.match(key, /^[a-z][a-z0-9_]{0,30}$/, 'คีย์ต้องตรงกฎ payment_save_bank_mapping')
    assert.ok(typeof value === 'number' || (typeof value === 'string' && value.length <= 100))
  }
  assert.ok(Object.keys(saved).length <= 20)
  assert.deepEqual(resolveSavedMapping(saved, grid), { headerRow: 1, cols: { date: 0, time: 1, amount: 2, credit: null, ref1: 3, ref2: null, bankRef: 4 } })
  // ธนาคารเปลี่ยนหัวคอลัมน์ "Ref1" เป็นอย่างอื่น = ช่องนั้นว่างให้คนเลือกใหม่ ไม่เดาตำแหน่งเดิม
  const renamed = [['วันที่', 'เวลา', 'จำนวนเงิน', 'เลขอ้างอิงลูกค้า', ''], grid[1]]
  assert.equal(resolveSavedMapping(saved, renamed).cols.ref1, null)
  // แถวหัวตารางเกินจำนวนแถวในไฟล์ = ใช้ไม่ได้ (null)
  assert.equal(resolveSavedMapping({ ...saved, header_row: 9 }, grid), null)
  assert.equal(resolveSavedMapping(null, grid), null)
  // mapping ที่บันทึกไว้ชี้ไปคอลัมน์ชื่อ (ไฟล์ใหม่สลับตำแหน่ง) = ไม่ใช้คอลัมน์ที่ถูกกั้น
  const swapped = [['วันที่', 'เวลา', 'จำนวนเงิน', 'ชื่อผู้โอน', ''], grid[1]]
  assert.equal(resolveSavedMapping({ ...saved, ref1_col: '#4' }, swapped).cols.ref1, null)
})

// ── แบ่งชุด ───────────────────────────────────────────────────────────────────────────
test('แบ่งชุด ≤ 5,000: จำนวนครบ ไม่ซ้ำไม่ตก · เรียงตามเวลา · เลขแถวในไฟล์ตามไปด้วย', () => {
  const rows = Array.from({ length: 12000 }, (_, i) => ({ txn_at: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')} ${String(i % 24).padStart(2, '0')}:00:00`, amount: '1.00', ref1: String(i), ref2: null, bank_ref: null }))
  const lines = rows.map((_, i) => i + 10)
  const chunks = chunkBankRows(rows, lines)
  assert.ok(chunks.length >= 3)
  assert.ok(chunks.every(c => c.rows.length <= MAX_IMPORT_ROWS && c.rows.length === c.lines.length))
  assert.equal(chunks.reduce((t, c) => t + c.rows.length, 0), 12000)
  assert.equal(new Set(chunks.flatMap(c => c.lines)).size, 12000)
  const flat = chunks.flatMap(c => c.rows.map(r => r.txn_at))
  assert.deepEqual(flat, [...flat].sort(), 'เรียงตามเวลาข้ามชุด')
  const first = chunks[0]
  first.rows.forEach((row, i) => assert.equal(row.ref1, String(first.lines[i] - 10), 'เลขแถวผูกกับแถวเดิม'))
  assert.deepEqual(chunkBankRows([], []), [])
  assert.equal(chunkBankRows(rows.slice(0, 5000), lines).length, 1)
})

test('แบ่งชุด: แถวที่เหมือนกันทุกช่อง (เวลาเดียวกัน) ไม่ถูกแยกคนละชุด — ฐานนับลำดับซ้ำภายในชุดเดียว แยกแล้วจะชนกันเองแล้วหายเงียบ', () => {
  const same = { txn_at: '2026-11-18 10:00:00', amount: '100.00', ref1: null, ref2: null, bank_ref: null }
  // 4,998 แถวที่เวลาต่างกัน แล้วตามด้วยแถวเหมือนกัน 5 แถว (ตกคร่อมขอบที่ 5,000) — ทั้ง 5 ต้องไปอยู่ชุดเดียวกัน
  const head = Array.from({ length: 4998 }, (_, i) => ({ ...same, txn_at: `2026-10-01 ${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00` }))
  const rows = [...head, ...Array.from({ length: 5 }, () => ({ ...same }))]
  const chunks = chunkBankRows(rows, rows.map((_, i) => i + 1))
  const holders = chunks.map(c => c.rows.filter(r => r.txn_at === same.txn_at).length).filter(n => n > 0)
  assert.deepEqual(holders, [5], 'แถวเหมือนกัน 5 แถวต้องอยู่ชุดเดียวกัน')
  assert.ok(chunks.every(c => c.rows.length <= MAX_IMPORT_ROWS))
})

test('ข้อความ "แถวที่ N" จากฐานถูกแปลเป็นเลขแถวในไฟล์', () => {
  assert.match(explainRowError('แถวที่ 2 : ยอดเงินไม่ถูกรูปแบบ — ไม่ได้นำเข้าทั้งไฟล์', [7, 19, 20]), /แถวที่ 19 ของไฟล์/)
  assert.equal(explainRowError('ไม่มีสิทธิ์', [1]), 'ไม่มีสิทธิ์')
})

// ── ตัวช่วยของแท็บเงินเข้า ───────────────────────────────────────────────────────────
test('ตัวกรองแท็บ: 4 สถานะตรงกับ CHECK ของฐาน (ยังระบุไม่ได้ / จับคู่แล้ว / ปิดยอดแล้ว / ไม่ใช่เงินของระบบนี้)', () => {
  assert.deepEqual(BANK_FILTERS.map(f => f.id), ['unmatched', 'matched', 'receipted', 'not_ours'])
  assert.ok(BANK_FILTERS.every(f => f.label && f.hint))
})

test('รอไฟล์ธนาคาร: ยอดต่ออายุที่ยังรอชำระและพ้นวันหมดอายุแล้ว (เฉพาะ renewal/open) · รายปี/ปิดแล้ว/ยังไม่พ้น = ไม่ใช่', () => {
  const d = (over = {}) => ({ status: 'open', kind: 'renewal', due_on: '2026-11-15', ...over })
  assert.equal(awaitingBankFile(d(), '2026-11-18'), true)
  assert.equal(awaitingBankFile(d({ due_on: '2026-11-18' }), '2026-11-18'), false, 'วันหมดอายุคือวันนี้ ยังรับที่เคาน์เตอร์ได้')
  assert.equal(awaitingBankFile(d({ kind: 'annual' }), '2026-11-18'), false)
  assert.equal(awaitingBankFile(d({ status: 'lapsed' }), '2026-11-18'), false)
  assert.equal(awaitingBankFile(d({ due_on: null }), '2026-11-18'), false)
  assert.equal(awaitingBankFile(null, '2026-11-18'), false)
})

test('ข้อความตาม mode ของคู่ที่เสนอ: open ผูกรอเลขใบเสร็จ · reopen เปิดยอดกลับ · evidence ผูกเป็นหลักฐาน (ไม่ใช่เงินซ้ำ ไม่ต้องกรอกเลขใบเสร็จ)', () => {
  assert.deepEqual(Object.keys(MATCH_MODE_TEXT).sort(), ['evidence', 'open', 'reopen'])
  assert.match(MATCH_MODE_TEXT.open.badge, /รอเลขใบเสร็จ/)
  assert.match(MATCH_MODE_TEXT.reopen.badge, /เปิดยอด/)
  assert.match(MATCH_MODE_TEXT.reopen.detail, /หมดอายุ/)
  assert.match(MATCH_MODE_TEXT.evidence.badge, /หลักฐาน/)
  assert.match(MATCH_MODE_TEXT.evidence.detail, /ไม่ต้องกรอกเลขใบเสร็จอีก/)
})

test('ค่าเติมแผ่นเลขใบเสร็จ: ไฟล์ Bill Payment → bill_payment · ไฟล์เงินเข้าบัญชี → promptpay · วันที่รับ = วันที่เงินเข้า', () => {
  assert.equal(bankTxnChannel({ file_kind: 'bill_payment' }), 'bill_payment')
  assert.equal(bankTxnChannel({ file_kind: 'account' }), 'promptpay')
  assert.deepEqual(receiptPrefillOf({ id: 't1', file_kind: 'account', txn_date: '2026-11-17', amount: '1000.00' }), { paidOn: '2026-11-17', amount: '1000.00', channel: 'promptpay', txnId: 't1' })
  assert.equal(receiptPrefillOf(null), null)
})

test('ป้ายที่แท็บรอชำระ: แมปเฉพาะเงินเข้าสถานะ matched ด้วย due.id', () => {
  const map = matchedTxnByDue([
    { id: 't1', status: 'matched', due: { id: 'd1' } }, { id: 't2', status: 'receipted', due: { id: 'd2' } },
    { id: 't3', status: 'unmatched', due: null }, { id: 't4', status: 'matched', due: { id: 'd4' } },
  ])
  assert.deepEqual([...map.keys()].sort(), ['d1', 'd4'])
  assert.equal(map.get('d1').id, 't1')
  assert.equal(matchedTxnByDue(null).size, 0)
})

test('สรุปรายวัน: จับคู่แล้ว (รอเลขใบเสร็จ+ปิดยอด) แยกจากยังระบุไม่ได้ · ไม่นับ not_ours · ใหม่สุดก่อน · ปัดสตางค์', () => {
  const rows = [
    { txn_date: '2026-11-17', amount: '100.10', status: 'matched' }, { txn_date: '2026-11-17', amount: '200.20', status: 'receipted' },
    { txn_date: '2026-11-17', amount: '300.30', status: 'unmatched' }, { txn_date: '2026-11-17', amount: '999.00', status: 'not_ours' },
    { txn_date: '2026-11-18', amount: '50', status: 'unmatched' },
  ]
  const days = dailyBankSummary(rows)
  assert.deepEqual(days.map(d => d.date), ['2026-11-18', '2026-11-17'])
  assert.deepEqual(days[1], { date: '2026-11-17', total: { n: 3, amount: 600.6 }, matched: { n: 2, amount: 300.3 }, unmatched: { n: 1, amount: 300.3 } })
  assert.deepEqual(days[0].unmatched, { n: 1, amount: 50 })
  assert.equal(dailyBankSummary(rows, 1).length, 1)
  assert.deepEqual(dailyBankSummary([]), [])
  assert.equal(sumBankAmount([{ amount: '0.1' }, { amount: '0.2' }]), 0.3)
})

test('ค้นเงินเข้า: Ref1/Ref2/เลขอ้างอิงธนาคาร/ยอด/ชื่อร้านที่ผูกหรือที่เสนอ · ค้นว่างได้ทั้งหมด · เครื่องหมายล้วนไม่ดึงทั้งหมด', () => {
  const rows = [
    { id: 'a', amount: '1000.00', ref1: '123456789012', ref2: null, bank_ref: 'TXN-77', due: null, candidates: [{ business_name: 'ร้านสมใจ', licence_no: 'ส.1/2569', ref1: '1' }] },
    { id: 'b', amount: '250.50', ref1: null, ref2: 'ZZ9', bank_ref: null, due: { business_name: 'ร้านบุญมี', ref1: '555', licence_no: 'ล.2/2569', receipt_no: 'R-9' }, candidates: [] },
  ]
  const ids = q => searchBankTxns(rows, q).map(r => r.id)
  assert.deepEqual(ids(''), ['a', 'b'])
  assert.deepEqual(ids('123456789012'), ['a'])
  assert.deepEqual(ids('txn-77'), ['a'])
  assert.deepEqual(ids('1000'), ['a'])
  assert.deepEqual(ids('250.5'), ['b'])
  assert.deepEqual(ids('สมใจ'), ['a'])
  assert.deepEqual(ids('บุญมี'), ['b'])
  assert.deepEqual(ids('R-9'), ['b'])
  assert.deepEqual(ids('zz9'), ['b'])
  assert.deepEqual(ids(','), [], 'เครื่องหมายล้วน (ตัดแล้วเป็นเลขว่าง) ไม่ตรงทุกแถว')
})

// ── แบนเนอร์เปลี่ยนบัญชี + สถานะแจ้งผู้บริหาร ─────────────────────────────────────────
const CHANGED = '2026-11-16T03:00:00Z'
const settingsChanged = { account_changed_at: CHANGED }
const alertRow = (over = {}) => ({ event_id: 5, status: 'sent', attempts: 1, delivery_note: 'กลุ่ม ✓ · ส่วนตัว 2/3', sent_at: '2026-11-16T03:05:00Z', created_at: CHANGED, ...over })

test('แบนเนอร์เปลี่ยนบัญชี: เรียกแบบเดิม (2 พารามิเตอร์) ผลเดิมไม่มีช่อง notice · ส่ง alert มาด้วยจึงมี notice', () => {
  assert.deepEqual(accountChangeBanner(settingsChanged, '2026-11-16'), { date: '2026-11-16', days: 0 })
  const withAlert = accountChangeBanner(settingsChanged, '2026-11-16', alertRow())
  assert.equal(withAlert.date, '2026-11-16')
  assert.equal(withAlert.notice.tone, 'ok')
  assert.equal(accountChangeBanner(settingsChanged, '2026-12-17', alertRow()), null, 'เกิน 30 วัน = ไม่ขึ้นแบนเนอร์')
})

test('สถานะแจ้งผู้บริหาร: แจ้งแล้ว (+หมายเหตุผลส่ง) · รอส่ง · ส่งไม่สำเร็จ (ยังลองใหม่/หยุดลองแล้ว) · ไม่มีปลายทาง · ไม่มีบันทึก', () => {
  const sent = accountAlertNotice(alertRow(), settingsChanged)
  assert.deepEqual([sent.tone, sent.text], ['ok', 'แจ้งผู้บริหารทาง Telegram แล้ว (กลุ่ม ✓ · ส่วนตัว 2/3)'])
  for (const status of ['pending', 'sending']) assert.match(accountAlertNotice(alertRow({ status }), settingsChanged).text, /รอระบบส่ง/)
  const retry = accountAlertNotice(alertRow({ status: 'failed', attempts: 2 }), settingsChanged)
  assert.equal(retry.tone, 'warn')
  assert.match(retry.text, /ไม่สำเร็จ — ระบบจะลองใหม่เอง/)
  assert.match(accountAlertNotice(alertRow({ status: 'failed', attempts: 6 }), settingsChanged).text, /หยุดลองแล้ว/)
  const skipped = accountAlertNotice(alertRow({ status: 'skipped', delivery_note: null }), settingsChanged)
  assert.equal(skipped.tone, 'warn')
  assert.match(skipped.text, /ไม่มีปลายทาง/)
  assert.match(skipped.text, /ผูกกลุ่ม Telegram/)
  assert.match(accountAlertNotice(null, settingsChanged).text, /ไม่พบบันทึกการแจ้ง/)
  assert.match(accountAlertNotice(alertRow({ status: 'weird' }), settingsChanged).text, /ไม่ทราบสถานะ/)
})

test('แถวคิวเก่ากว่าการเปลี่ยนล่าสุด = ไม่ใช่ของครั้งนี้ ห้ามอ้างว่า "แจ้งแล้ว" (เปลี่ยนก่อนเปิดระบบแจ้งเตือน)', () => {
  const stale = alertRow({ created_at: '2026-11-01T03:00:00Z', status: 'sent' })
  const n = accountAlertNotice(stale, settingsChanged)
  assert.equal(n.tone, 'warn')
  assert.match(n.text, /ไม่พบบันทึกการแจ้ง/)
  // ลงคิวห่างจากเวลาเปลี่ยนไม่กี่วินาที (คนละธุรกรรม) ยังนับเป็นครั้งเดียวกัน
  assert.equal(accountAlertNotice(alertRow({ created_at: '2026-11-16T03:00:02Z' }), settingsChanged).tone, 'ok')
  assert.equal(accountAlertNotice(alertRow({ created_at: '2026-11-16T02:58:00Z' }), settingsChanged).tone, 'ok')
})

test('ข้อความสถานะไม่มี chat id หรือเลขบัญชีเต็ม (ฐานส่งมาแค่สรุป "กลุ่ม ✓ · ส่วนตัว 2/3")', () => {
  const texts = ['sent', 'pending', 'failed', 'skipped'].map(status => accountAlertNotice(alertRow({ status }), settingsChanged).text).join('\n')
  assert.doesNotMatch(texts, /\d{9,}/)
})

console.log(`\nok — ${cases} cases`)

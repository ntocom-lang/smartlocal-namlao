// รับชำระเงิน · ยอดค้าง (ขั้น 1C / E4 PR1) — เทสต์ตรรกะล้วน (ไม่ใช้เน็ต/ฐานข้อมูล/เบราว์เซอร์) · รันด้วย node
//   ครอบคลุม: ช่องทางที่ใช้ได้จริง · Luhn ของ Ref1 · payload Bill Payment (CRC/โครง tag 30/ยอด) · promptpay เดิมไม่เปลี่ยน
//   ค่าปรับที่เสนอ · ค้นหา · ฟอร์มตั้งค่า · ป้ายเปลี่ยนบัญชี · ใบแจ้งชำระ (escape กัน XSS / 1 ยอด 1 หน้า / ไม่มีเบอร์โทร)
import assert from 'node:assert/strict'
import {
  CHANNEL_IDS, accountChangeBanner, accountChanged, amountDue, buildDueQr, defaultRecordChannel, describeSkipped, describeSync,
  dueState, enabledChannels, filterByTab, formToRpcArgs, formatRef1, isElaasInvoice, isValidRef1, luhnCheckDigit,
  needsSettingsNotice, qrChannelFor, receiptPreview, recordChannelOptions, searchDues, settingsToForm, suggestedSurcharge,
  usableChannels, validateSettingsForm,
} from '../src/lib/paymentDues.js'
import { generateBillPaymentPayload, generatePromptPayPayload } from '../src/lib/promptpay.js'
import { buildPaymentNoticeHtml } from '../src/lib/paymentNoticePrint.js'

let cases = 0
const test = (label, run) => { run(); cases += 1; console.log('PASS ' + label) }

// ── ข้อมูลตัวอย่าง ────────────────────────────────────────────────────────────────────
const settings = (over = {}) => ({
  municipality_id: 'm1', counter_enabled: true, promptpay_enabled: true, bill_payment_enabled: true,
  promptpay_id: '0994000012345', biller_id: '099400001234501', bank_name: 'ธนาคารตัวอย่าง', payee_name: 'อบต.ตัวอย่าง',
  source_channels: { licence: ['counter', 'promptpay', 'bill_payment'] }, elaas_invoice_sources: [],
  due_lead_days: 60, finance_department_id: null, finance_can_record: false, account_changed_at: null, updated_at: '2026-12-11T01:00:00Z', ...over,
})
const ref1Of = base11 => base11 + luhnCheckDigit(base11)
const due = (over = {}) => ({
  id: 'd1', source: 'licence', kind: 'renewal', licence_id: 'l1', period_from: '2027-01-01', due_on: '2026-12-31', amount: 1000, ref1: ref1Of('12345678901'),
  status: 'open', business_name: 'ร้านตัวอย่าง', holder_name: 'นายสมชาย ใจดี', licence_no: 'ส.1/2569', type_name: 'กิจการที่เป็นอันตรายต่อสุขภาพ',
  category: 'hazardous', address: '12 หมู่ 3', village: 'บ้านตัวอย่าง', ...over,
})

// ── ช่องทางที่ใช้ได้จริง ──────────────────────────────────────────────────────────────
test('usableChannels = ช่องที่ตั้งให้บริการ ∩ ช่องที่เปิด (เรียงตามลำดับมาตรฐาน)', () => {
  assert.deepEqual(usableChannels(settings(), 'licence'), ['counter', 'promptpay', 'bill_payment'])
  assert.deepEqual(usableChannels(settings({ promptpay_enabled: false }), 'licence'), ['counter', 'bill_payment'])
  assert.deepEqual(usableChannels(settings({ source_channels: { licence: ['promptpay'] } }), 'licence'), ['promptpay'])
  assert.deepEqual(usableChannels(settings({ source_channels: { licence: ['bill_payment'] }, bill_payment_enabled: false }), 'licence'), [])
  assert.deepEqual(usableChannels(settings({ source_channels: {} }), 'licence'), [])
  assert.deepEqual(usableChannels(settings(), 'unknown'), [])
  assert.deepEqual(usableChannels(null, 'licence'), [])
  assert.deepEqual(usableChannels(settings({ source_channels: { licence: 'counter' } }), 'licence'), [])
})

test('ค่าเริ่มต้นปลอดภัย: ไม่มีแถวตั้งค่า / ปิดทุกช่อง = ไม่มีช่องทาง ไม่มี QR และมีป้ายบอกแอดมิน', () => {
  assert.deepEqual(enabledChannels(null), [])
  assert.equal(needsSettingsNotice(null), true)
  assert.equal(needsSettingsNotice(settings({ counter_enabled: false, promptpay_enabled: false, bill_payment_enabled: false })), true)
  assert.equal(needsSettingsNotice(settings()), false)
  assert.equal(qrChannelFor(null, 'licence'), null)
})

test('QR: Bill Payment ก่อน ไม่มีก็พร้อมเพย์ · ไม่มีรหัสปลายทาง/ช่องไม่เปิด = ไม่มี QR', () => {
  assert.equal(qrChannelFor(settings(), 'licence'), 'bill_payment')
  assert.equal(qrChannelFor(settings({ bill_payment_enabled: false }), 'licence'), 'promptpay')
  assert.equal(qrChannelFor(settings({ biller_id: null }), 'licence'), 'promptpay')
  assert.equal(qrChannelFor(settings({ biller_id: null, promptpay_id: null }), 'licence'), null)
  assert.equal(qrChannelFor(settings({ source_channels: { licence: ['counter'] } }), 'licence'), null)
})

test('บริการที่ e-LAAS ออกใบแจ้งหนี้อยู่แล้ว = ไม่สร้าง QR (แต่ยังรู้ว่าเป็น e-LAAS)', () => {
  const s = settings({ elaas_invoice_sources: ['licence'] })
  assert.equal(isElaasInvoice(s, 'licence'), true)
  assert.equal(qrChannelFor(s, 'licence'), null)
  assert.equal(buildDueQr(s, due(), '2026-12-11'), null)
  assert.equal(isElaasInvoice(settings(), 'licence'), false)
})

test('ช่องทางบนแผ่นบันทึกเลขใบเสร็จ: ช่องที่เปิด + อื่นๆ · ยังไม่มีช่อง = เคาน์เตอร์ + อื่นๆ', () => {
  assert.deepEqual(recordChannelOptions(settings(), 'licence'), ['counter', 'promptpay', 'bill_payment', 'other'])
  assert.deepEqual(recordChannelOptions(settings({ counter_enabled: false }), 'licence'), ['promptpay', 'bill_payment', 'other'])
  assert.deepEqual(recordChannelOptions(null, 'licence'), ['counter', 'other'])
  assert.equal(defaultRecordChannel(settings({ counter_enabled: false }), 'licence'), 'promptpay')
  assert.equal(defaultRecordChannel(null, 'licence'), 'counter')
  assert.ok(CHANNEL_IDS.every(id => ['counter', 'promptpay', 'bill_payment'].includes(id)))
})

// ── Luhn ──────────────────────────────────────────────────────────────────────────────
test('Luhn: ค่ามาตรฐาน 7992739871 → 3 · Ref1 12 หลักถูกต้อง/ผิด 1 หลักถูกจับได้ทุกตำแหน่ง', () => {
  assert.equal(luhnCheckDigit('7992739871'), '3')
  assert.equal(luhnCheckDigit('abc'), null)
  const ref1 = ref1Of('12345678901')
  assert.equal(isValidRef1(ref1), true)
  for (let i = 0; i < 12; i += 1) {
    const wrong = ref1.slice(0, i) + String((Number(ref1[i]) + 1) % 10) + ref1.slice(i + 1)
    assert.equal(isValidRef1(wrong), false, `ผิดหลักที่ ${i + 1} ต้องจับได้`)
  }
  assert.equal(isValidRef1('12345'), false)
  assert.equal(isValidRef1('12345678901a'), false)
  assert.equal(isValidRef1(null), false)
})

test('Luhn ตรงกับสูตรใน SQL (payment_luhn_digit) ทุกเลขสุ่ม 500 ชุด', () => {
  // พอร์ตตรงจากฟังก์ชัน SQL: ตำแหน่ง i (1..n) คูณ 2 เมื่อ (n - i) เป็นเลขคู่
  const sql = digits => {
    let sum = 0
    for (let i = 1; i <= digits.length; i += 1) {
      const d = Number(digits[i - 1])
      sum += (digits.length - i) % 2 === 0 ? (d * 2 > 9 ? d * 2 - 9 : d * 2) : d
    }
    return String((10 - (sum % 10)) % 10)
  }
  let seed = 20261211
  for (let n = 0; n < 500; n += 1) {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    const base = String(seed % 100000000000).padStart(11, '0')
    assert.equal(luhnCheckDigit(base), sql(base), base)
  }
})

test('formatRef1 แบ่ง 4-4-4 · ค่าที่ไม่ใช่ 12 หลักไม่แตะ', () => {
  assert.equal(formatRef1('123456789012'), '1234 5678 9012')
  assert.equal(formatRef1('abc'), 'abc')
})

// ── QR payload ───────────────────────────────────────────────────────────────────────
const crc16 = text => {
  let crc = 0xFFFF
  for (const ch of text) {
    crc ^= ch.charCodeAt(0) << 8
    for (let j = 0; j < 8; j += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}
const parseTlv = text => {
  const out = []
  for (let i = 0; i < text.length;) {
    const tag = text.slice(i, i + 2)
    const len = Number(text.slice(i + 2, i + 4))
    assert.ok(Number.isInteger(len) && i + 4 + len <= text.length, `TLV ยาวเกินที่ ${i}`)
    out.push([tag, text.slice(i + 4, i + 4 + len)])
    i += 4 + len
  }
  return out
}

test('Bill Payment: CRC ถูก · โครง tag 30 (00=A000000677010112, 01=Biller, 02=Ref1) · dynamic · THB · ยอด 2 ตำแหน่ง', () => {
  const ref1 = ref1Of('12345678901')
  const payload = generateBillPaymentPayload({ billerId: '099400001234501', ref1, amount: 1200 })
  assert.equal(payload.slice(-4), crc16(payload.slice(0, -4)), 'CRC16 ต้องตรงกับที่คำนวณเอง')
  const tags = parseTlv(payload)
  assert.deepEqual(tags.map(([tag]) => tag), ['00', '01', '30', '53', '54', '58', '63'])
  const byTag = Object.fromEntries(tags)
  assert.equal(byTag['00'], '01')
  assert.equal(byTag['01'], '12')
  assert.equal(byTag['53'], '764')
  assert.equal(byTag['54'], '1200.00')
  assert.equal(byTag['58'], 'TH')
  assert.deepEqual(parseTlv(byTag['30']), [['00', 'A000000677010112'], ['01', '099400001234501'], ['02', ref1]])
  assert.ok(payload.includes('6304'), 'ต้องมี tag CRC นำหน้าค่า CRC')
})

test('Bill Payment: ยอดทศนิยม 2 ตำแหน่งเสมอ · Ref2 (ถ้ามี) อยู่ใน sub 03 · ข้อมูลผิดรูป = null ไม่เดา', () => {
  const base = { billerId: '099400001234501', ref1: '123456789012' }
  assert.equal(Object.fromEntries(parseTlv(generateBillPaymentPayload({ ...base, amount: 1234.5 })))['54'], '1234.50')
  assert.equal(Object.fromEntries(parseTlv(generateBillPaymentPayload({ ...base, amount: 0.1 })))['54'], '0.10')
  const withRef2 = generateBillPaymentPayload({ ...base, ref2: 'AB12', amount: 10 })
  assert.deepEqual(parseTlv(Object.fromEntries(parseTlv(withRef2))['30']).at(-1), ['03', 'AB12'])
  assert.equal(withRef2.slice(-4), crc16(withRef2.slice(0, -4)))
  assert.equal(generateBillPaymentPayload({ ...base, billerId: '12345', amount: 10 }), null)
  assert.equal(generateBillPaymentPayload({ ...base, ref1: 'ab c', amount: 10 }), null)
  assert.equal(generateBillPaymentPayload({ ...base, amount: 0 }), null)
  assert.equal(generateBillPaymentPayload({ ...base, amount: -5 }), null)
  assert.equal(generateBillPaymentPayload({ ...base, amount: 'x' }), null)
  assert.equal(generateBillPaymentPayload({}), null)
  assert.equal(generateBillPaymentPayload(), null)
})

test('promptpay เดิมได้ payload เดิมเป๊ะ (snapshot ก่อนแก้ไฟล์)', () => {
  const snapshot = [
    ['0812345678', 0, '00020101021129370016A0000006770101110113006681234567853037645802TH6304823E'],
    ['0812345678', 150, '00020101021229370016A0000006770101110113006681234567853037645406150.005802TH6304C40C'],
    ['0994000012345', 0, '00020101021129370016A0000006770101110213099400001234553037645802TH6304F676'],
    ['0994000012345', 1234.5, '00020101021229370016A00000067701011102130994000012345530376454071234.505802TH630452A1'],
    ['0994000012345', 20.075, '00020101021229370016A000000677010111021309940000123455303764540520.075802TH6304DF83'],
    ['', 10, null],
  ]
  for (const [target, amount, expected] of snapshot) assert.equal(generatePromptPayPayload(target, amount), expected, `${target} ${amount}`)
})

// ── ค่าปรับที่เสนอ + ยอด QR ─────────────────────────────────────────────────────────
test('ค่าปรับเสนอ 20% เฉพาะ annual ที่ชำระหลังวันครบกำหนด · renewal/ภายในกำหนด = 0', () => {
  const annual = due({ kind: 'annual', amount: 1500, due_on: '2026-12-01', period_from: '2026-12-01' })
  assert.equal(suggestedSurcharge(annual, '2026-12-02'), 300)
  assert.equal(suggestedSurcharge(annual, '2026-12-01'), 0, 'ชำระในวันครบกำหนดยังไม่ช้า')
  assert.equal(suggestedSurcharge(annual, '2026-11-30'), 0)
  assert.equal(suggestedSurcharge(due({ kind: 'renewal', amount: 1500 }), '2030-01-01'), 0)
  assert.equal(suggestedSurcharge(annual, 'ไม่ใช่วัน'), 0)
  assert.equal(suggestedSurcharge(null, '2026-12-02'), 0)
  assert.deepEqual(amountDue(annual, '2026-12-02'), { amount: 1500, surcharge: 300, total: 1800 })
  assert.deepEqual(amountDue(due({ kind: 'annual', amount: 333.33, due_on: '2026-12-01' }), '2026-12-05'), { amount: 333.33, surcharge: 66.67, total: 400 })
})

test('ยอดใน QR = ยอด (+ ค่าปรับเสนอถ้า annual เลยกำหนด) และชี้ช่องทางถูก', () => {
  const s = settings()
  const onTime = buildDueQr(s, due({ amount: 1000 }), '2026-12-11')
  assert.equal(onTime.channel, 'bill_payment')
  assert.equal(onTime.total, 1000)
  assert.equal(Object.fromEntries(parseTlv(onTime.payload))['54'], '1000.00')
  const late = buildDueQr(s, due({ kind: 'annual', amount: 1500, due_on: '2026-12-01', period_from: '2026-12-01' }), '2026-12-11')
  assert.equal(late.surcharge, 300)
  assert.equal(Object.fromEntries(parseTlv(late.payload))['54'], '1800.00')
  const pp = buildDueQr(settings({ bill_payment_enabled: false }), due({ amount: 250 }), '2026-12-11')
  assert.equal(pp.channel, 'promptpay')
  assert.equal(pp.payload, generatePromptPayPayload('0994000012345', 250))
  assert.equal(buildDueQr(s, due({ amount: 0 }), '2026-12-11'), null, 'ยอด 0 = ไม่มี QR')
  assert.equal(buildDueQr(null, due(), '2026-12-11'), null)
  // ต่ออายุที่พ้นวันหมดอายุแล้ว (ระบบรอไฟล์ธนาคาร) ห้ามออก QR — จ่ายตอนนี้ต่ออายุไม่ได้ ต้องคืนเงิน (ผลตรวจรอบ 2 M-3)
  assert.equal(buildDueQr(s, due({ kind: 'renewal', status: 'open', amount: 1000, due_on: '2026-12-10' }), '2026-12-11'), null)
  assert.ok(buildDueQr(s, due({ kind: 'renewal', status: 'open', amount: 1000, due_on: '2026-12-11' }), '2026-12-11'), 'วันหมดอายุพอดียังจ่ายได้')
})

// ── สถานะ/ค้นหา/ผลปรับยอด ────────────────────────────────────────────────────────────
test('dueState: นับถอยหลัง · เลยกำหนด · ยอดที่ปิดแล้วไม่คิด', () => {
  assert.deepEqual(dueState(due({ due_on: '2026-12-31' }), '2026-12-11'), { days: 20, overdue: false, text: 'อีก 20 วัน' })
  assert.deepEqual(dueState(due({ due_on: '2026-12-01' }), '2026-12-11'), { days: -10, overdue: true, text: 'เลยมา 10 วัน' })
  assert.equal(dueState(due({ due_on: '2026-12-11' }), '2026-12-11').overdue, false)
  assert.equal(dueState(due({ status: 'paid' }), '2026-12-11').days, null)
})

test('ค้นหาชื่อร้าน/ผู้ประกอบการ/เลขใบ/Ref1 + เตือน Ref1 หลักตรวจไม่ผ่าน', () => {
  const ref1 = ref1Of('12345678901')
  const rows = [due(), due({ id: 'd2', business_name: 'ร้านอื่น', holder_name: 'นางสมศรี', licence_no: 'ข.9', ref1: ref1Of('99999999999') })]
  assert.equal(searchDues(rows, '').rows.length, 2)
  assert.deepEqual(searchDues(rows, 'ตัวอย่าง').rows.map(r => r.id), ['d1'])
  assert.deepEqual(searchDues(rows, 'สมศรี').rows.map(r => r.id), ['d2'])
  assert.deepEqual(searchDues(rows, 'ข.9').rows.map(r => r.id), ['d2'])
  assert.deepEqual(searchDues(rows, ref1).rows.map(r => r.id), ['d1'])
  assert.deepEqual(searchDues(rows, formatRef1(ref1)).rows.map(r => r.id), ['d1'], 'พิมพ์แบบเว้นวรรค 4-4-4 ก็เจอ')
  assert.equal(searchDues(rows, ref1).ref1Typo, false)
  const typo = ref1.slice(0, 11) + String((Number(ref1[11]) + 1) % 10)
  assert.equal(searchDues(rows, typo).ref1Typo, true)
  assert.equal(searchDues(rows, '12345').ref1Typo, false, 'พิมพ์ไม่ครบ 12 หลักไม่ถือว่าผิด')
})

test('แท็บ: ปิดแล้ว = lapsed + cancelled', () => {
  const rows = ['open', 'paid', 'lapsed', 'cancelled'].map(status => due({ id: status, status }))
  assert.deepEqual(filterByTab(rows, 'open').map(r => r.id), ['open'])
  assert.deepEqual(filterByTab(rows, 'paid').map(r => r.id), ['paid'])
  assert.deepEqual(filterByTab(rows, 'closed').map(r => r.id), ['lapsed', 'cancelled'])
  assert.deepEqual(filterByTab(rows, 'อื่น'), [])
})

test('ผลปรับยอดอัตโนมัติ: ไม่เปลี่ยนอะไร = ไม่ขึ้นข้อความ · ใบไม่มีอัตราขึ้นป้ายบอกไปตั้งที่ทะเบียน', () => {
  assert.deepEqual(describeSync({ created: 0, paid: 0, lapsed: 0, updated: 0, skipped_no_fee: 0, lead_days: 60 }), [])
  assert.deepEqual(describeSync(null), [])
  const lines = describeSync({ created: 3, paid: 1, lapsed: 2, updated: 4, lead_days: 60 })
  assert.equal(lines.length, 4)
  assert.ok(lines[0].includes('3 รายการ') && lines[0].includes('60'))
  assert.equal(describeSkipped({ skipped_no_fee: 0 }), '')
  assert.equal(describeSkipped({ skipped_no_fee: 5 }), 'มี 5 ใบที่ยังไม่ได้ตั้งอัตราค่าธรรมเนียม — ตั้งที่เมนูทะเบียนใบอนุญาต')
})

test('ป้ายเปลี่ยนบัญชีภายใน 30 วัน (เวลาไทย): วันที่ 0–30 ขึ้น · 31 ไม่ขึ้น · ไม่เคยเปลี่ยน/อนาคตไม่ขึ้น', () => {
  const at = '2026-11-15T20:00:00Z' // 16 พ.ย. 03:00 เวลาไทย
  assert.deepEqual(accountChangeBanner(settings({ account_changed_at: at }), '2026-11-16'), { date: '2026-11-16', days: 0 })
  assert.equal(accountChangeBanner(settings({ account_changed_at: at }), '2026-12-16')?.days, 30)
  assert.equal(accountChangeBanner(settings({ account_changed_at: at }), '2026-12-17'), null)
  assert.equal(accountChangeBanner(settings({ account_changed_at: at }), '2026-11-15'), null)
  assert.equal(accountChangeBanner(settings(), '2026-11-16'), null)
  assert.equal(accountChangeBanner(null, '2026-11-16'), null)
  assert.equal(accountChangeBanner(settings({ account_changed_at: 'ไม่ใช่เวลา' }), '2026-11-16'), null)
})

// ── ฟอร์มตั้งค่า ──────────────────────────────────────────────────────────────────────
test('ฟอร์มตั้งค่า: ไม่มีแถว = ปิดทุกช่อง · แปลงเป็นพารามิเตอร์ RPC 13 ตัวตรงชื่อ', () => {
  const empty = settingsToForm(null)
  assert.equal(empty.counter || empty.promptpay || empty.billPayment, false)
  assert.equal(empty.leadDays, '60')
  assert.equal(validateSettingsForm(empty), '')
  const args = formToRpcArgs('m1', { ...settingsToForm(settings()), promptpayId: '099-400 0012345', billerId: ' 099400001234501 ', financeCanRecord: true, financeDepartmentId: 'dept1', elaasLicence: true })
  assert.deepEqual(Object.keys(args), [
    'p_municipality_id', 'p_counter_enabled', 'p_promptpay_enabled', 'p_bill_payment_enabled', 'p_promptpay_id', 'p_biller_id', 'p_bank_name',
    'p_payee_name', 'p_source_channels', 'p_elaas_invoice_sources', 'p_due_lead_days', 'p_finance_department_id', 'p_finance_can_record',
  ])
  assert.equal(args.p_promptpay_id, '0994000012345')
  assert.equal(args.p_biller_id, '099400001234501')
  assert.deepEqual(args.p_source_channels, { licence: ['counter', 'promptpay', 'bill_payment'] })
  assert.deepEqual(args.p_elaas_invoice_sources, ['licence'])
  assert.equal(args.p_due_lead_days, 60)
  assert.equal(args.p_finance_department_id, 'dept1')
  assert.equal(formToRpcArgs('m1', settingsToForm(null)).p_promptpay_id, null)
})

test('ตรวจฟอร์ม: เปิดช่องต้องมีรหัสปลายทาง+ชื่อบัญชี · รูปแบบเลข · จำนวนวัน · กองคลัง', () => {
  const base = settingsToForm(null)
  assert.ok(validateSettingsForm({ ...base, promptpay: true }).includes('พร้อมเพย์'))
  assert.ok(validateSettingsForm({ ...base, billPayment: true }).includes('Biller ID'))
  assert.ok(validateSettingsForm({ ...base, promptpay: true, promptpayId: '0994000012345' }).includes('ชื่อบัญชีผู้รับ'))
  assert.equal(validateSettingsForm({ ...base, promptpay: true, promptpayId: '0994000012345', payeeName: 'อบต.ตัวอย่าง' }), '')
  assert.ok(validateSettingsForm({ ...base, promptpayId: '12345' }).includes('13 หลัก'))
  assert.ok(validateSettingsForm({ ...base, billerId: '12345' }).includes('15 หลัก'))
  assert.ok(validateSettingsForm({ ...base, leadDays: '0' }).includes('1–180'))
  assert.ok(validateSettingsForm({ ...base, leadDays: '181' }).includes('1–180'))
  assert.ok(validateSettingsForm({ ...base, leadDays: '' }).includes('1–180'))
  assert.ok(validateSettingsForm({ ...base, leadDays: '1.5' }).includes('1–180'))
  assert.ok(validateSettingsForm({ ...base, financeCanRecord: true }).includes('กองคลัง'))
  assert.equal(validateSettingsForm({ ...base, financeCanRecord: true, financeDepartmentId: 'd1' }), '')
})

test('accountChanged: เปลี่ยนเลขพร้อมเพย์/Biller/ธนาคาร/ชื่อบัญชีเท่านั้นถึงนับ · เปลี่ยนช่องทาง/จำนวนวันไม่นับ', () => {
  const s = settings()
  const same = settingsToForm(s)
  assert.equal(accountChanged(s, same), false)
  assert.equal(accountChanged(s, { ...same, leadDays: '90', counter: false }), false)
  assert.equal(accountChanged(s, { ...same, promptpayId: '0812345678' }), true)
  assert.equal(accountChanged(s, { ...same, billerId: '' }), true)
  assert.equal(accountChanged(s, { ...same, payeeName: 'ชื่ออื่น' }), true)
  assert.equal(accountChanged(s, { ...same, bankName: ' ธนาคารตัวอย่าง ' }), false, 'ช่องว่างหัวท้ายไม่นับ')
  assert.equal(accountChanged(null, settingsToForm(null)), false)
  assert.equal(accountChanged(null, { ...settingsToForm(null), payeeName: 'x' }), true)
})

test('ผลล่วงหน้า: รายปี = วันครบกำหนดถัดไป +12 เดือน · ต่ออายุต้องรู้อายุใบ (ไม่มี type = ไม่เดา)', () => {
  const annual = receiptPreview(due({ kind: 'annual', period_from: '2026-12-01', due_on: '2026-12-01' }), null)
  assert.equal(annual.newDate, '2027-12-01')
  assert.equal(receiptPreview(due({ kind: 'renewal', period_from: '2027-01-01' }), null), null)
  const renewal = receiptPreview(due({ kind: 'renewal', period_from: '2027-01-01' }), { validity_months: 12 })
  assert.equal(renewal.from, '2027-01-01')
  assert.equal(renewal.newDate, '2027-12-31')
})

// ── ใบแจ้งชำระ ───────────────────────────────────────────────────────────────────────
const tenant = { name: 'องค์การบริหารส่วนตำบลตัวอย่าง', logo_url: 'https://example.com/logo.png', phone: '055-000000' }

test('ใบแจ้งชำระ: escape ทุกช่อง — ชื่อร้าน/ผู้ประกอบการ/ที่อยู่/ชื่อ อปท./ชื่อบัญชีไม่หลุดเป็น tag', () => {
  const evil = '<img src=x onerror=alert(1)>'
  const html = buildPaymentNoticeHtml({
    tenant: { ...tenant, name: evil, logo_url: 'javascript:alert(1)' },
    settings: settings({ payee_name: evil, bank_name: evil }),
    dues: [due({ business_name: evil, holder_name: evil, address: evil, village: evil, licence_no: evil, type_name: evil })],
    today: '2026-12-11',
  })
  assert.equal(/<img\s+src=x/i.test(html), false, 'ต้องไม่มี <img src=x เป็น tag')
  assert.equal(/onerror=alert/.test(html.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')), false)
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert.equal(/<img[^>]*logo/i.test(html) || /javascript:/i.test(html), false, 'โลโก้ที่ไม่ใช่ https ต้องถูกทิ้ง')
})

test('ใบแจ้งชำระ: 1 ยอด 1 หน้า · มี Ref1/ยอด/QR/ชื่อบัญชี/หมายเหตุไม่ใช่ใบเสร็จ/เคาน์เตอร์ · ไม่มีเบอร์โทร ไม่มีช่องลงนาม', () => {
  const rows = [due({ id: 'a' }), due({ id: 'b', business_name: 'ร้านที่สอง', ref1: ref1Of('55555555555') })]
  const html = buildPaymentNoticeHtml({ tenant, settings: settings(), dues: rows, today: '2026-12-11' })
  assert.equal((html.match(/<div class="sheet">/g) ?? []).length, 2)
  assert.ok(html.includes('ใบแจ้งชำระค่าธรรมเนียม'))
  assert.ok(html.includes(formatRef1(rows[0].ref1)))
  assert.ok(html.includes(formatRef1(rows[1].ref1)))
  assert.ok(html.includes('1,000.00 บาท'))
  assert.ok(html.includes('<svg'), 'ต้องมี QR')
  assert.ok(html.includes('อบต.ตัวอย่าง'), 'ชื่อบัญชีผู้รับ')
  assert.ok(html.includes('ใบนี้ไม่ใช่ใบเสร็จรับเงิน ใบเสร็จรับเงินออกโดย องค์การบริหารส่วนตำบลตัวอย่าง'))
  assert.ok(html.includes('ชำระได้ที่ องค์การบริหารส่วนตำบลตัวอย่าง ในวันและเวลาราชการ'))
  assert.equal(html.includes('055-000000'), false, 'ไม่ใส่เบอร์โทร')
  assert.equal(/ลงชื่อ|ผู้ลงนาม/.test(html), false, 'ไม่มีช่องลงนาม')
  assert.ok(html.includes('THSarabunPSK') && html.includes('font-size-adjust: 0.45') && html.includes('@page'), 'ใช้ govDocStyle')
})

test('ใบแจ้งชำระ: ใบที่ e-LAAS ออกใบแจ้งหนี้อยู่แล้ว = ไม่มี QR บอกว่าออกจาก e-LAAS · ยังไม่ตั้งค่า = ไม่มี QR แต่มีทางชำระที่ อปท.', () => {
  const elaas = buildPaymentNoticeHtml({ tenant, settings: settings({ elaas_invoice_sources: ['licence'] }), dues: [due()], today: '2026-12-11' })
  assert.equal(elaas.includes('<svg'), false)
  assert.ok(elaas.includes('ใบแจ้งหนี้ออกจาก e-LAAS'))
  const none = buildPaymentNoticeHtml({ tenant, settings: null, dues: [due()], today: '2026-12-11' })
  assert.equal(none.includes('<svg'), false)
  assert.ok(none.includes('ชำระได้ที่ องค์การบริหารส่วนตำบลตัวอย่าง ในวันและเวลาราชการ'))
  const pp = buildPaymentNoticeHtml({ tenant, settings: settings({ bill_payment_enabled: false, source_channels: { licence: ['promptpay'] } }), dues: [due()], today: '2026-12-11' })
  assert.ok(pp.includes('<svg') && pp.includes('พร้อมเพย์'))
  assert.equal(pp.includes('ชำระได้ที่ องค์การบริหารส่วนตำบลตัวอย่าง ในวันและเวลาราชการ'), false, 'เคาน์เตอร์ไม่ได้เปิด ไม่พิมพ์ช่องนี้เมื่อมี QR')
})

test('ใบแจ้งชำระ: annual เลยกำหนดแสดงค่าปรับที่เสนอ และยอดรวมตรงกับยอดใน QR', () => {
  const late = due({ kind: 'annual', amount: 1500, due_on: '2026-12-01', period_from: '2026-12-01' })
  const html = buildPaymentNoticeHtml({ tenant, settings: settings(), dues: [late], today: '2026-12-11' })
  assert.ok(html.includes('1,500.00 บาท') && html.includes('300.00 บาท') && html.includes('1,800.00 บาท'))
  assert.ok(html.includes('ค่าปรับร้อยละ 20'))
})

test('ใบแจ้งชำระ: ไม่มียอดให้พิมพ์ = เอกสารว่างที่ยังเป็น HTML ถูกต้อง', () => {
  const html = buildPaymentNoticeHtml({ tenant, settings: settings(), dues: [], today: '2026-12-11' })
  assert.ok(html.startsWith('<!DOCTYPE html>') && html.includes('</html>'))
  assert.equal((html.match(/<div class="sheet">/g) ?? []).length, 0)
})

console.log(`\nสรุป: ผ่าน ${cases} กลุ่มเทสต์`)

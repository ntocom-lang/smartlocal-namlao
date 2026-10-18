// ยอดตามบิลต้องชนะยอดคำนวณบนเอกสารทุกใบ และเลย์เอาต์ของใบต้องไม่ขยับ
//
// เคสจริง เทศบาลตำบลน้ำเลา 7 ก.ย. 2569
//   บิล: 50.25 ลิตร x 39.80 บาท = 2,000.00 บาท (ปั๊มเติมเป็นยอดเงินกลม)
//   ระบบ: round(50.25 * 39.80, 2) = 1,999.95 บาท
// เอกสารเคยพิมพ์ 1,999.95 ทำให้ยอดรวมทั้งเดือนไม่ตรงใบกำกับภาษี สอบยันกับฎีกาไม่ผ่าน

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fuelAmountDiffersFromCalc, fuelInvoiceReminder, fuelRecordAmount } from '../src/lib/fleetFuelAmount.js'
import { buildFleetFuelLedgerHtml, ledgerTotals } from '../src/lib/fleetFuelLedgerPrint.js'
import { buildFleetFuelMemoHtml, buildMemoRows } from '../src/lib/fleetFuelMemoPrint.js'
import { buildFleetFuelRecordHtml } from '../src/lib/fleetFuelPrint.js'

const vehicle = { id: 'v1', name: 'รถยนต์นั่งส่วนบุคคลไม่เกิน 7 คน', license_plate: 'กธ 3393 แพร่' }

// รายการจริง: ลิตรกับราคาตามที่พิมพ์บนบิล ส่วน total_cost เป็นค่าที่ DB คำนวณให้เอง
const billed = {
  id: 'f1', vehicle_id: 'v1', filled_at: '2026-09-07',
  fuel_type: 'diesel', liters: 50.25, price_per_liter: 39.80,
  total_cost: 1999.95, invoice_total: 2000,
  receipt_no: 'DCO0001690000021',
}
// รายการเก่าก่อนมีช่องยอดบิล — ต้องพิมพ์เหมือนเดิมทุกประการ
const legacy = { ...billed, id: 'f2', invoice_total: null, receipt_no: 'OLD-1' }

/* ── 1. ตัวตัดสินยอด ── */
assert.equal(fuelRecordAmount(billed), 2000, 'มียอดบิลต้องใช้ยอดบิล')
assert.equal(fuelRecordAmount(legacy), 1999.95, 'ไม่มียอดบิลต้องตกไปใช้ยอดคำนวณ')
assert.equal(fuelRecordAmount({ liters: 50.25, price_per_liter: 39.8 }), 1999.95,
  'ไม่มีทั้งสองต้องคำนวณจากลิตร x ราคา')
assert.equal(fuelRecordAmount({ invoice_total: 0, total_cost: 1999.95 }), 0,
  'ยอดบิล 0 บาทต้องไม่ถูกมองว่า "ไม่มีค่า" แล้วตกไปใช้ยอดคำนวณ')
assert.equal(fuelRecordAmount({}), null, 'ไม่มีข้อมูลพอต้องคืน null ไม่ใช่ 0')
assert.equal(fuelAmountDiffersFromCalc(billed), true)
assert.equal(fuelAmountDiffersFromCalc(legacy), false)

/* ── 2. สมุดคุมปริมาณการเบิกใช้น้ำมัน ── */
const ledger = buildFleetFuelLedgerHtml({
  vehicle, records: [billed], periodLabel: 'ประจำเดือน กันยายน พ.ศ. 2569', orgName: 'เทศบาลตำบลทดสอบ',
})
assert.ok(ledger.includes('>2,000.00<'), 'ช่องจำนวน(บาท) ต้องพิมพ์ยอดตามบิล')
assert.ok(!ledger.includes('1,999.95'), 'ยอดคำนวณต้องไม่โผล่บนใบเลย')
assert.ok(ledger.includes('>39.80<'), 'ราคา/หน่วย ต้องเป็นเลขบนบิล ห้ามบิดให้คูณลงตัว')
assert.ok(ledger.includes('>50.25<'), 'จำนวนลิตร ต้องเป็นเลขบนบิล')

const legacyLedger = buildFleetFuelLedgerHtml({ vehicle, records: [legacy] })
assert.ok(legacyLedger.includes('>1,999.95<'), 'รายการเก่าต้องพิมพ์ยอดคำนวณเหมือนเดิม')

// ยอดรวมท้ายตารางต้องบวกจากยอดบิล ไม่ใช่บวกยอดคำนวณ
assert.equal(ledgerTotals([billed, legacy]).cost, 3999.95)
assert.equal(ledgerTotals([billed]).cost, 2000)

/* ── 3. เลย์เอาต์ของใบต้องไม่ขยับแม้แต่ตัวอักษรเดียว ── */
for (const header of ['วัน/เดือน/ปี', 'ใบส่งของ', 'ประเภท', 'ราคา/หน่วย',
  'การเติมน้ำมันเชื้อเพลิง', 'จำนวน/ลิตร', 'จำนวน(บาท)', 'หมายเหตุ', 'รวมทั้งสิ้น']) {
  assert.ok(ledger.includes(header), `หัวตารางสมุดคุมต้องมี "${header}" เหมือนเดิม`)
}
// 7 คอลัมน์ แต่ 8 <th> เพราะ "การเติมน้ำมันเชื้อเพลิง" คร่อม 2 ช่องย่อย (ลิตร/บาท)
// จึงยึด <col> เป็นตัวนับคอลัมน์จริง และคุม <th> ไว้ด้วยกันเผลอเพิ่มหัวซ้อน
assert.equal((ledger.match(/<col /g) || []).length, 7, 'สมุดคุมต้องมี 7 คอลัมน์เท่าเดิม')
assert.equal((ledger.match(/<th /g) || []).length, 8, 'โครงหัวตาราง 2 ชั้นต้องเท่าเดิม')
assert.ok(!ledger.includes('ยอดตามบิล') && !ledger.includes('invoice'),
  'ห้ามเพิ่มคอลัมน์หรือข้อความใหม่ลงบนใบ — แก้ได้แค่ว่าเลขมาจากไหน')

/* ── 4. บันทึกข้อความสรุปน้ำมัน (ทุกคัน) ── */
const rows = buildMemoRows({
  vehicles: [vehicle],
  trips: [{ vehicle_id: 'v1', trip_date: '2026-09-07', odometer_start: 54000, odometer_end: 54472 }],
  fuel: [billed],
})
assert.equal(rows.length, 1)
assert.equal(rows[0].cost, 2000, 'ยอดรวมรายคันในบันทึกข้อความต้องบวกจากยอดบิล')

const memo = buildFleetFuelMemoHtml({
  orgName: 'เทศบาลตำบลทดสอบ', rows, from: '2026-09-01', to: '2026-09-30',
})
assert.ok(!memo.includes('1,999.95'), 'บันทึกข้อความต้องไม่โผล่ยอดคำนวณ')

/* ── 5. ใบพิมพ์รายการเดี่ยว ── */
const single = buildFleetFuelRecordHtml({ record: { ...billed, fleet_vehicles: vehicle }, tenant: { name: 'เทศบาลตำบลทดสอบ' } })
assert.ok(single.includes('2,000.00 บาท'), 'ใบรายการเดี่ยวต้องพิมพ์ยอดตามบิล')
assert.ok(!single.includes('1,999.95'), 'ใบรายการเดี่ยวต้องไม่พิมพ์ยอดคำนวณ')

/* ── 6. ไม่มี artifact แปลกปลอม ── */
for (const doc of [ledger, memo, single]) {
  assert.ok(!doc.includes('undefined') && !doc.includes('NaN') && !doc.includes('Invalid Date'))
}

/* ── 7. เตือนให้กรอกยอดตามบิลก่อนบันทึก (เจ้าของระบบสั่ง 2026-10-18) ──
   เคสจริง กค 9700 12 ต.ค. 2569: 34.4 ล. × 43.60 = 1,499.84 แต่จ่ายจริง 1,500 แล้วไม่ได้กรอกยอดบิล */
assert.equal(fuelInvoiceReminder({ liters: '34.4', price_per_liter: '43.60', invoice_total: '' }), 1499.84,
  'ยอดคำนวณมีเศษสตางค์ + ยังไม่กรอกยอดบิล ต้องเตือน')
assert.equal(fuelInvoiceReminder({ liters: 34.4, price_per_liter: 43.6, invoice_total: 1500 }), null, 'กรอกยอดบิลแล้วไม่ต้องเตือน')
assert.equal(fuelInvoiceReminder({ liters: 34.4, price_per_liter: 43.6, invoice_total: 0 }), null, 'ยอดบิล 0 = กรอกแล้ว ไม่ใช่ว่าง')
assert.equal(fuelInvoiceReminder({ liters: 40, price_per_liter: 37.5, invoice_total: '' }), null, 'ยอดเต็มบาท (1,500.00) ไม่ต้องเตือน')
// 50.25 × 39.80 ทศนิยมลอยตัวได้ 1999.9499999 — ต้องปัดเป็นสตางค์ก่อนตัดสิน
assert.equal(fuelInvoiceReminder({ liters: 50.25, price_per_liter: 39.8, invoice_total: null }), 1999.95)
assert.equal(fuelInvoiceReminder({ liters: 50, price_per_liter: 40, invoice_total: null }), null)
assert.equal(fuelInvoiceReminder({ liters: '', price_per_liter: '43.60', invoice_total: '' }), null, 'ยังกรอกไม่ครบไม่ต้องเตือน')
assert.equal(fuelInvoiceReminder({ liters: '34.4', price_per_liter: '', invoice_total: '' }), null)
// หน้าบันทึกต้องใช้ตัวตัดสินนี้ทั้งตอนกรอกและตอนกดบันทึก และพากลับไปช่องยอดบิลเมื่อกดยกเลิก
const fuelLog = readFileSync('src/components/fleet/FleetFuelLog.jsx', 'utf8')
assert.ok(fuelLog.includes('fuelInvoiceReminder(form)'), 'FleetFuelLog ต้องใช้ fuelInvoiceReminder')
assert.ok(/invoiceReminder !== null && !confirm\(/.test(fuelLog), 'ต้องถามก่อนบันทึกเมื่อยังไม่กรอกยอดบิล')
assert.ok(fuelLog.includes('invoiceInputRef.current?.focus()'), 'กดยกเลิกแล้วต้องพากลับไปช่องยอดตามบิล')
assert.ok(/ref=\{invoiceInputRef\}/.test(fuelLog), 'ช่องยอดตามบิลต้องผูก ref')

console.log('fleet-fuel-invoice-total.test.mjs PASS')

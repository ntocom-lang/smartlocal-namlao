// สรุปข้อมูลรายคันของหน้า "รายละเอียดรถ" — ตรวจสูตรล้วน ไม่เปิดเบราว์เซอร์ ไม่แตะฐานข้อมูล
// รันด้วย: npm run test:fleet:vehicle-summary
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildMonthlySeries, costSplit, documentReadiness, DOCUMENT_SOON_DAYS, efficiencyVsStandard, fiscalYearRange,
  fuelCostPerKm, maintenanceTitle, recentActivity, sumSeries, vehicleAgeText, vehicleCompleteness,
} from '../src/lib/fleetVehicleSummary.js'

// ── ปีงบประมาณ ─────────────────────────────────────────────────────────────────────
const fy = fiscalYearRange(new Date(2026, 9, 18)) // 18 ต.ค. 2569 → ปีงบ 2570
assert.equal(fy.labelBE, 2570)
assert.equal(fy.from.getMonth(), 9)
assert.equal(fiscalYearRange(new Date(2027, 8, 30)).labelBE, 2570, '30 ก.ย. ยังเป็นปีงบเดิม')

// ── 12 เดือนครบ ต.ค.→ก.ย. + ยอดน้ำมันตามบิลชนะยอดคำนวณ ───────────────────────────────
const series = buildMonthlySeries({
  from: fy.from,
  trips: [{ trip_date: '2026-10-16', distance_km: 9 }, { trip_date: '2026-10-16', distance_km: 31 }, { trip_date: '2027-01-05', distance_km: 20 }],
  fuel: [
    // เคสจริง กค 9700: ลิตร×ราคา = 1,499.84 แต่บิล 1,500 → ต้องได้ 1,500
    { filled_at: '2026-10-12', liters: 34.08, price_per_liter: 44.01, total_cost: 1499.84, invoice_total: 1500 },
    { filled_at: '2026-11-01T03:00:00Z', liters: 10, total_cost: 400 },
    { filled_at: '2025-09-30', liters: 99, total_cost: 9999 }, // ปีงบก่อน ไม่นับ
  ],
  maint: [{ service_date: '2026-10-20', cost: 850 }, { service_date: '2027-09-30', cost: 150 }],
})
assert.equal(series.length, 12, 'ต้องมีครบ 12 เดือน แม้เดือนที่ไม่มีข้อมูล')
assert.deepEqual(series.map(m => m.short), ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'])
assert.equal(series[0].label, 'ต.ค. 2569')
assert.equal(series[0].trips, 2)
assert.equal(series[0].distance, 40)
assert.equal(series[0].fuelCost, 1500, 'ยอดตามบิลต้องชนะยอดคำนวณ (fuelRecordAmount)')
assert.equal(series[0].maintCount, 1)
assert.equal(series[1].fuelCost, 400)
assert.equal(series[11].maintCost, 150, 'ก.ย. ปีถัดไปยังอยู่ในปีงบ')
const totals = sumSeries(series)
assert.deepEqual(totals, { trips: 3, distance: 60, fuelLiters: 44.08, fuelCost: 1900, fuelCount: 2, maintCost: 1000, maintCount: 2 })

// ── สัดส่วน: รวมได้ 100 พอดีเสมอ ─────────────────────────────────────────────────────
assert.deepEqual(costSplit({ fuelCost: 1500, maintCost: 0 }), { total: 1500, fuelPct: 100, maintPct: 0 })
assert.deepEqual(costSplit({ fuelCost: 0, maintCost: 0 }), { total: 0, fuelPct: 0, maintPct: 0 })
const third = costSplit({ fuelCost: 1, maintCost: 2 })
assert.equal(third.fuelPct + third.maintPct, 100)

// ── ค่าน้ำมัน/กม. จากอัตราจริง ไม่ใช่ระยะทางในใบเดินทาง ────────────────────────────────
// รถกระเช้าน้ำเลา: ฿1,500 / 34 ล. / 4.9 กม./ล. ≈ ฿9.00 (ถ้าหารระยะทางในใบเดินทาง 79 กม. จะได้ ฿19 เกินจริง)
assert.equal(fuelCostPerKm({ fuelCost: 1500, fuelLiters: 34, efficiencyKml: 4.9 }), 9)
assert.equal(fuelCostPerKm({ fuelCost: 1500, fuelLiters: 34, efficiencyKml: null }), null)
assert.equal(fuelCostPerKm({ fuelCost: 0, fuelLiters: 0, efficiencyKml: 5 }), null)

// ── อัตราจริงเทียบอัตราที่กำหนด ───────────────────────────────────────────────────────
assert.deepEqual(efficiencyVsStandard(4.9, 6), { actual: 4.9, standard: 6, pct: 82, meets: false })
assert.equal(efficiencyVsStandard(7, '6').meets, true)
assert.equal(efficiencyVsStandard(null, 6), null)
assert.equal(efficiencyVsStandard(5, ''), null)

// ── เอกสารรถ: ฟอร์มตั้ง 4 ค่าเป็นวันเดียวกัน → รวมเป็นรายการเดียว ───────────────────────
const today = '2026-10-18'
const same = documentReadiness({ insurance_expiry: '2026-11-17', act_expiry: '2026-11-17', registration_expiry: '2026-11-17', inspection_expiry: '2026-11-17' }, today)
assert.equal(same.length, 1, 'วันเดียวกันทั้ง 4 ต้องรวมเป็นรายการเดียว')
assert.equal(same[0].daysLeft, 30)
assert.equal(same[0].state, 'soon', `เหลือ ≤ ${DOCUMENT_SOON_DAYS} วัน = ใกล้หมด`)
const empty = documentReadiness({}, today)
assert.equal(empty.length, 1)
assert.equal(empty[0].state, 'missing')
const mixed = documentReadiness({ insurance_expiry: '2026-10-01', act_expiry: '2027-06-01' }, today)
assert.equal(mixed.length, 4, 'วันไม่ตรงกัน (ข้อมูลเก่า) ต้องแยกแสดงทีละอย่าง')
assert.deepEqual(mixed.map(d => d.state), ['expired', 'ok', 'missing', 'missing'])
assert.deepEqual(documentReadiness({ asset_kind: 'equipment' }, today), [], 'ไม่ใช่ยานพาหนะ = ไม่มีเอกสารรถ')

// ── ความครบของข้อมูลทะเบียน ───────────────────────────────────────────────────────────
const namlaoLike = { is_pool: true, brand: 'Isuzu', model: 'NPR', fuel_type: 'diesel', tank_capacity: 100, fuel_rate_standard_kml: 6 }
const c1 = vehicleCompleteness(namlaoLike)
assert.equal(c1.total, 8, 'รถใช้ร่วมทุกกองไม่ต้องมีกอง')
assert.equal(c1.filled, 4)
assert.deepEqual(c1.missing, ['รุ่นปี', 'ขนาดเครื่องยนต์ (ซีซี)', 'ราคา', 'วันที่ได้มา'])
assert.ok(vehicleCompleteness({ fuel_type: 'electric', is_pool: true }).missing.every(label => !/ถัง|ซีซี|กม\./.test(label)),
  'รถไฟฟ้าไม่ต้องมีถัง/ซีซี/อัตรา กม./ล.')
assert.ok(vehicleCompleteness({ is_pool: false }).missing.includes('กองที่สังกัด'))
assert.equal(vehicleCompleteness({ ...namlaoLike, manufacture_year: 2020, engine_cc: 2999, purchase_price: 0, acquired_date: '2020-01-01' }).missing.length, 0,
  'ราคา 0 ถือว่ากรอกแล้ว (รับบริจาค) ไม่ใช่ช่องว่าง')

// ── อายุใช้งาน ────────────────────────────────────────────────────────────────────────
assert.equal(vehicleAgeText('2023-08-18', today), '3 ปี 2 เดือน')
assert.equal(vehicleAgeText('2025-10-18', today), '1 ปี')
assert.equal(vehicleAgeText('2026-10-01', today), 'ไม่ถึง 1 เดือน')
assert.equal(vehicleAgeText('2026-12-01', today), '', 'วันที่ได้มาในอนาคต = ไม่แสดง')
assert.equal(vehicleAgeText('', today), '')

// ── รายการล่าสุด: ใหม่ไปเก่า รวมเติม+ซ่อม ตัดที่ 5 ─────────────────────────────────────
const recent = recentActivity({
  fuel: [{ id: 'f1', filled_at: '2026-10-16', liters: 34, total_cost: 1499.84, invoice_total: 1500 }, { id: 'f2', filled_at: '2026-09-01', liters: 5, total_cost: 200 }],
  maint: [{ id: 'm1', service_date: '2026-10-17', cost: 300 }, { id: 'm2', service_date: '2026-08-01', cost: 100 }],
  limit: 3,
})
assert.deepEqual(recent.map(r => r.row.id), ['m1', 'f1', 'f2'])
assert.equal(recent[1].amount, 1500, 'รายการล่าสุดก็ใช้ยอดตามบิล')

// ── ชื่อรายการซ่อม: "อื่นๆ" เก็บรวมใน description แบบเดียวกับฟอร์มซ่อม ─────────────────────
const LABELS = { repair: 'ซ่อมแซม', other: 'อื่นๆ' }
assert.deepEqual(maintenanceTitle({ maintenance_type: 'repair', description: 'เปลี่ยนผ้าเบรก' }, LABELS), { title: 'ซ่อมแซม', detail: 'เปลี่ยนผ้าเบรก' })
assert.deepEqual(maintenanceTitle({ maintenance_type: 'other', description: '[ล้างแอร์] ล้างตู้แอร์' }, LABELS), { title: 'ล้างแอร์', detail: 'ล้างตู้แอร์' })
assert.deepEqual(maintenanceTitle({ maintenance_type: 'other', description: 'ติดฟิล์ม' }, LABELS), { title: 'ติดฟิล์ม', detail: '' })
assert.deepEqual(maintenanceTitle({ maintenance_type: 'other', description: '' }, LABELS), { title: 'อื่นๆ', detail: '' })

// ── หน้าจอ: ดึงช่องที่ fuelRecordAmount ต้องใช้ + ไม่คิด ฿/กม. จากใบเดินทาง ────────────────
const ui = readFileSync('src/components/fleet/FleetVehicleDetail.jsx', 'utf8')
assert.ok(/select\('filled_at, liters, total_cost, invoice_total, price_per_liter, efficiency_kml'\)/.test(ui),
  'ต้องดึง invoice_total/price_per_liter ไม่งั้นยอดตามบิลไม่ชนะ (ตัวเลขไม่ตรงรายงาน)')
assert.ok(ui.includes('fuelCostPerKm('), 'ค่าน้ำมัน/กม. ต้องมาจาก fuelCostPerKm (อัตราจริง)')
assert.equal(/fuelCost\s*\/\s*totals\.distance|totals\.fuelCost\s*\/\s*totals\.distance/.test(ui), false,
  'ห้ามคิดค่าน้ำมัน/กม. จากระยะทางในใบเดินทาง')
// เจอจริงตอนเปิดหน้าบนสนามซ้อม: fleet_maintenance ไม่มีคอลัมน์ other_type → คำขอ 400 รายการล่าสุดหายเงียบ
assert.equal(/fleet_maintenance'\)\.select\([^)]*other_type/.test(ui), false, 'ห้าม select other_type (ไม่มีคอลัมน์นี้)')

console.log('fleet vehicle summary assertions passed')

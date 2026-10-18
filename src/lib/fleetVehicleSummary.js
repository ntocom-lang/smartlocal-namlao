// สรุปข้อมูลรายคันสำหรับหน้า "รายละเอียดรถ" (FleetVehicleDetail) — ฟังก์ชันล้วน ไม่อ่านนาฬิกาเอง
// (ส่ง today/now เข้ามา) เทสได้โดยไม่ต้องเปิดเบราว์เซอร์: npm run test:fleet:vehicle-summary
import { isVehicleAsset } from './fleetAssets.js'
import { fuelRecordAmount } from './fleetFuelAmount.js'

export const MONTH_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

// เอกสารรถเตือนล่วงหน้า 60 วัน — ค่าเดียวกับคอลัมน์ "เอกสาร" ในตารางรถ (FleetVehicles) ห้ามแยกเกณฑ์
export const DOCUMENT_SOON_DAYS = 60

// ปีงบประมาณไทย: 1 ต.ค. ถึง 30 ก.ย. ปีถัดไป (เดือนปัจจุบัน ≥ ต.ค. = ปีงบเริ่มปีนี้)
export function fiscalYearRange(now = new Date()) {
  const y = now.getFullYear()
  const startYear = now.getMonth() >= 9 ? y : y - 1
  const from = new Date(startYear, 9, 1)
  const to = new Date(startYear + 1, 8, 30, 23, 59, 59)
  return { from, to, labelBE: startYear + 1 + 543 }
}

function monthKey(dateStr) {
  // 'YYYY-MM-DD' หรือ timestamp — ตัดจากสตริงตรงๆ กันเขตเวลาเลื่อนวันที่ 1 ไปเดือนก่อน
  const text = String(dateStr ?? '')
  if (/^\d{4}-\d{2}/.test(text)) return text.slice(0, 7)
  const d = new Date(dateStr)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function num(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * 12 เดือนของปีงบ เรียง ต.ค. → ก.ย. ครบทุกเดือน (เดือนที่ไม่มีข้อมูล = 0) กราฟจะเห็นจังหวะการใช้รถ
 * ยอดน้ำมันใช้ fuelRecordAmount() — ยอดตามบิลชนะยอดคำนวณ ตัวเลขจึงตรงกับรายงาน/เอกสารเบิก
 */
export function buildMonthlySeries({ from, trips = [], fuel = [], maint = [] }) {
  const months = []
  const byKey = {}
  for (let i = 0; i < 12; i++) {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const row = {
      key,
      short: MONTH_TH[d.getMonth()],
      label: `${MONTH_TH[d.getMonth()]} ${d.getFullYear() + 543}`,
      trips: 0, distance: 0, fuelLiters: 0, fuelCost: 0, fuelCount: 0, maintCost: 0, maintCount: 0,
    }
    months.push(row)
    byKey[key] = row
  }
  for (const t of trips) {
    const row = byKey[monthKey(t.trip_date)]
    if (!row) continue
    row.trips += 1
    row.distance += num(t.distance_km) ?? 0
  }
  for (const f of fuel) {
    const row = byKey[monthKey(f.filled_at)]
    if (!row) continue
    row.fuelLiters += num(f.liters) ?? 0
    row.fuelCost += fuelRecordAmount(f) ?? 0
    row.fuelCount += 1
  }
  for (const m of maint) {
    const row = byKey[monthKey(m.service_date)]
    if (!row) continue
    row.maintCost += num(m.cost) ?? 0
    row.maintCount += 1
  }
  return months
}

export function sumSeries(series) {
  return series.reduce((acc, m) => ({
    trips: acc.trips + m.trips,
    distance: acc.distance + m.distance,
    fuelLiters: acc.fuelLiters + m.fuelLiters,
    fuelCost: acc.fuelCost + m.fuelCost,
    fuelCount: acc.fuelCount + m.fuelCount,
    maintCost: acc.maintCost + m.maintCost,
    maintCount: acc.maintCount + m.maintCount,
  }), { trips: 0, distance: 0, fuelLiters: 0, fuelCost: 0, fuelCount: 0, maintCost: 0, maintCount: 0 })
}

/** สัดส่วนค่าน้ำมัน/ค่าซ่อม เป็น % ที่รวมกันได้ 100 พอดี (ยังไม่มีค่าใช้จ่าย = 0 ทั้งคู่) */
export function costSplit({ fuelCost = 0, maintCost = 0 }) {
  const total = Math.max(0, fuelCost) + Math.max(0, maintCost)
  if (total <= 0) return { total: 0, fuelPct: 0, maintPct: 0 }
  const fuelPct = Math.round((Math.max(0, fuelCost) / total) * 100)
  return { total, fuelPct, maintPct: 100 - fuelPct }
}

/**
 * ค่าน้ำมันต่อ กม. = ราคาเฉลี่ยต่อลิตร ÷ อัตราสิ้นเปลืองจริง (เติมเต็มถัง)
 * ⚠️ ห้ามคิดจาก (ค่าน้ำมัน ÷ ระยะทางในใบเดินทาง) — บางเที่ยวไม่ได้ลงใบแต่ใบเสร็จลงครบ
 * ตัวหารจึงเล็กเกินจริง (รถกระเช้าน้ำเลาได้ ฿19/กม. แทน ~฿9) ไม่มีข้อมูลพอ = null
 */
export function fuelCostPerKm({ fuelCost, fuelLiters, efficiencyKml }) {
  const eff = num(efficiencyKml)
  if (!(fuelLiters > 0) || !(fuelCost > 0) || !(eff > 0)) return null
  return Math.round((fuelCost / fuelLiters / eff) * 100) / 100
}

/** อัตราจริงเทียบอัตราที่กำหนด (กม./ล. — มากกว่า = ประหยัดกว่า) · ไม่มีเกณฑ์/ไม่มีค่าจริง = null */
export function efficiencyVsStandard(actual, standard) {
  const a = num(actual)
  const s = num(standard)
  if (!(a > 0) || !(s > 0)) return null
  const pct = Math.round((a / s) * 100)
  return { actual: a, standard: s, pct, meets: a >= s }
}

function daysBetween(todayIso, dateIso) {
  const from = Date.parse(`${todayIso}T00:00:00Z`)
  const to = Date.parse(`${String(dateIso).slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return Math.round((to - from) / 86_400_000)
}

function docState(daysLeft) {
  if (daysLeft === null) return 'missing'
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= DOCUMENT_SOON_DAYS) return 'soon'
  return 'ok'
}

const DOCUMENT_FIELDS = [
  { key: 'insurance_expiry', label: 'ประกันภัย' },
  { key: 'act_expiry', label: 'พ.ร.บ.' },
  { key: 'registration_expiry', label: 'ทะเบียน' },
  { key: 'inspection_expiry', label: 'ตรวจสภาพ' },
]

/**
 * ความพร้อมของเอกสารรถ · today = 'YYYY-MM-DD' เวลาไทย
 * ฟอร์มรถมีช่อง "วันหมดอายุเอกสาร" ช่องเดียวที่ตั้งทั้ง 4 ค่าพร้อมกัน — วันเดียวกันหมด (หรือว่างหมด)
 * รวมเป็นรายการเดียว ไม่งั้นได้ 4 จุดที่บอกเรื่องเดียวกัน · ข้อมูลเก่าที่วันต่างกันจริงจึงแยกแสดง
 */
export function documentReadiness(vehicle, today) {
  if (!isVehicleAsset(vehicle)) return []
  const dates = DOCUMENT_FIELDS.map(f => vehicle?.[f.key] ? String(vehicle[f.key]).slice(0, 10) : null)
  const distinct = new Set(dates)
  if (distinct.size === 1) {
    const date = dates[0]
    const daysLeft = date ? daysBetween(today, date) : null
    return [{ key: 'documents', label: 'เอกสารรถ', detail: DOCUMENT_FIELDS.map(f => f.label).join(' · '), date, daysLeft, state: docState(daysLeft) }]
  }
  return DOCUMENT_FIELDS.map((f, i) => {
    const daysLeft = dates[i] ? daysBetween(today, dates[i]) : null
    return { key: f.key, label: f.label, detail: '', date: dates[i], daysLeft, state: docState(daysLeft) }
  })
}

/**
 * ช่องข้อมูลทะเบียน/สเปกที่ควรมี (ทะเบียนยานพาหนะ แบบ 1/2 + ใช้คำนวณในระบบ)
 * วันหมดอายุเอกสารไม่นับตรงนี้ — แสดงในส่วนความพร้อมอยู่แล้ว ไม่เตือนซ้ำสองที่
 * รถใช้ร่วมทุกกองไม่ต้องมีกอง · รถไฟฟ้าไม่มีถังน้ำมัน/อัตรา กม./ล. · เครื่องจักรไม่มีซีซี/อัตรา
 */
export function vehicleCompleteness(vehicle) {
  const vehicleLike = isVehicleAsset(vehicle)
  const electric = vehicle?.fuel_type === 'electric'
  const fields = [
    { key: 'brand', label: 'ยี่ห้อ' },
    { key: 'model', label: 'รุ่น' },
    vehicleLike && { key: 'manufacture_year', label: 'รุ่นปี' },
    vehicleLike && !electric && { key: 'engine_cc', label: 'ขนาดเครื่องยนต์ (ซีซี)' },
    { key: 'purchase_price', label: 'ราคา' },
    { key: 'acquired_date', label: 'วันที่ได้มา' },
    !vehicle?.is_pool && { key: 'department_id', label: 'กองที่สังกัด' },
    !electric && { key: 'tank_capacity', label: 'ความจุถัง' },
    vehicleLike && !electric && { key: 'fuel_rate_standard_kml', label: 'อัตราที่กำหนด (กม./ล.)' },
  ].filter(Boolean)
  const missing = fields.filter(f => {
    const value = vehicle?.[f.key]
    return value === null || value === undefined || String(value).trim() === ''
  })
  return { filled: fields.length - missing.length, total: fields.length, missing: missing.map(f => f.label) }
}

/** อายุใช้งานนับจากวันที่ได้มา เช่น "3 ปี 2 เดือน" · ไม่มีวันที่ได้มา/อนาคต = '' */
export function vehicleAgeText(acquiredDate, today) {
  if (!acquiredDate || !today) return ''
  const [ay, am, ad] = String(acquiredDate).slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = String(today).slice(0, 10).split('-').map(Number)
  if (![ay, am, ad, ty, tm, td].every(Number.isFinite)) return ''
  let months = (ty - ay) * 12 + (tm - am) - (td < ad ? 1 : 0)
  if (months < 0) return ''
  const years = Math.floor(months / 12)
  months -= years * 12
  if (years === 0 && months === 0) return 'ไม่ถึง 1 เดือน'
  return [years ? `${years} ปี` : '', months ? `${months} เดือน` : ''].filter(Boolean).join(' ')
}

/**
 * ชื่อรายการซ่อม + รายละเอียด · ประเภท "อื่นๆ" ไม่มีคอลัมน์แยก — ฟอร์มซ่อมเก็บรวมใน description
 * เป็น "[ประเภท] รายละเอียด" (หรือประเภทล้วน) ต้องแยกแบบเดียวกับ FleetMaintenance ตอนเปิดแก้ไข
 * (ห้าม select คอลัมน์ other_type — ไม่มีอยู่จริง ทั้งคำขอจะ 400)
 */
export function maintenanceTitle(row, typeLabels = {}) {
  const description = String(row?.description ?? '').trim()
  if (row?.maintenance_type === 'other') {
    const m = description.match(/^\[(.+?)\]\s*(.*)$/)
    if (m) return { title: m[1], detail: m[2] }
    return { title: description || typeLabels.other || 'อื่นๆ', detail: '' }
  }
  return { title: typeLabels[row?.maintenance_type] || 'ซ่อมบำรุง', detail: description }
}

/**
 * รายการล่าสุดของคันนี้ (เติมน้ำมัน + ซ่อม) เรียงใหม่ไปเก่า ตัดที่ limit
 * วันเดียวกัน = ไม่สลับลำดับเดิมของแต่ละชุด (sort เสถียร)
 */
export function recentActivity({ fuel = [], maint = [], limit = 5 }) {
  const rows = [
    ...fuel.map(f => ({ kind: 'fuel', date: String(f.filled_at ?? '').slice(0, 10), amount: fuelRecordAmount(f), liters: num(f.liters), row: f })),
    ...maint.map(m => ({ kind: 'maint', date: String(m.service_date ?? '').slice(0, 10), amount: num(m.cost), row: m })),
  ].filter(r => r.date)
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return rows.slice(0, limit)
}

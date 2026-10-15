// สถานการณ์น้ำ-ฝนรายหมู่ ("หมู่ของฉัน") — ฟังก์ชันล้วน ทดสอบใน node (tests/water-village.test.mjs)
//
// ตอบคำถามประชาชนว่า "หมู่ฉันตอนนี้เป็นอย่างไร" จากสถานีที่เจ้าหน้าที่ผูกกับหมู่ไว้ (water_village_stations)
// ไม่สร้างเกณฑ์ใหม่: ทุกอย่างอ่านจาก waterSituation.js เดิม — buildAlerts() ตัวเดียวกับแถบหน้าแรกและ Telegram
// ไม่พยากรณ์ ไม่ประเมินความปลอดภัยของหมู่ ไม่ใช่ประกาศของ อบต. (ประกาศเป็นงานเฟส 2)
//
// ลำดับความรุนแรงของสถานะ (ซ้ายเบาสุด): ok < nodata < watch < high
//   "ข้อมูลไม่พอ" แพ้ "เฝ้าระวัง" เพราะค่าที่วัดได้ถึงเกณฑ์แล้วต้องบอก แม้สถานีอื่นของหมู่ค้าง
//   แต่ "ข้อมูลไม่พอ" ชนะ "ปกติ" เสมอ — ห้ามบอกว่าปกติทั้งที่มีสถานีที่ผูกไว้ไม่มีค่าใหม่ (บทเรียนเตือนผิด 28 ก.ย.)

import {
  DAM_STALE_HOURS, STATION_STALE_HOURS,
  buildAlerts, damLevel, formatMm, isStale, levelRank, measuredAtText, rainLevel, stationPlace, toNum, waterTrend,
} from './waterSituation.js'
import { haversineKm } from './tourismPlaces.js'

// ระยะที่นับว่า "ใกล้หมู่" — เกณฑ์เดียวกับโหมดแชร์ "ไม่เกิน 5 กม." ที่เจ้าของระบบเลือกไว้แล้ว (shareWaterSituation)
export const VILLAGE_NEARBY_KM = 5

// ชนิดสถานีที่ผูกกับหมู่ได้ (ตรงกับ CHECK ของ water_village_stations) — สถานีเตือนภัย 'ews' ติดมากับสถานีฝนรหัสเดียวกัน
export const LINKABLE_TYPES = ['rain', 'waterlevel', 'dam']

export const VILLAGE_STATUSES = {
  ok: { key: 'ok', label: 'ค่าที่วัดได้ปกติ' },
  nodata: { key: 'nodata', label: 'ข้อมูลไม่พอ' },
  watch: { key: 'watch', label: 'เฝ้าระวัง' },
  high: { key: 'high', label: 'ระวังสูง' },
}

// ค่าที่ใช้ตัดสินว่าสถานีหนึ่ง "มีค่า" — สถานีที่มีเวลาวัดแต่ไม่มีตัวเลขของตัวชี้วัดนั้นนับว่าไม่มีค่า
const METRIC = { rain: 'rain_24h_mm', waterlevel: 'bank_diff_m', dam: 'storage_percent' }
const staleHours = type => (type === 'dam' ? DAM_STALE_HOURS : STATION_STALE_HOURS)

// "สด" = มีตัวเลข และเวลาวัดไม่เก่ากว่าเกณฑ์เดิมของชนิดนั้น (สถานีโทรมาตร 3 ชม. · อ่างรายวัน 48 ชม.)
export function stationIsFresh(station, now) {
  const metric = METRIC[station?.station_type]
  if (!metric || !station.recorded_at || toNum(station[metric]) === null) return false
  return !isStale(station.recorded_at, now, staleHours(station.station_type))
}

// ระดับน้ำเทียบตลิ่งเป็นเซนติเมตร (ภาษาชาวบ้าน) — waterSituation.bankText ใช้ "ม." ซึ่งอ่านยากสำหรับหน้าประชาชน
export function bankTextCm(diff) {
  const d = toNum(diff)
  if (d === null) return null
  if (Math.abs(d) < 0.005) return 'ระดับน้ำเสมอตลิ่ง'
  const cm = Math.max(1, Math.round(Math.abs(d) * 100))
  return d > 0 ? `ต่ำกว่าตลิ่ง ${cm} ซม.` : `สูงกว่าตลิ่ง ${cm} ซม.`
}

// เทียบกับรอบวัดก่อนหน้าที่ RPC ส่งมา (50 นาที–3 ชม. ก่อน) · บอกเวลาของรอบนั้นด้วย ไม่เขียนว่า "1 ชม." ตายตัว
export function levelTrendText(station, now) {
  const t = waterTrend(station?.waterlevel_msl, station?.prev_waterlevel_msl)
  if (!t) return null
  const when = measuredAtText(station.prev_recorded_at, now)
  const tail = when ? ` (เทียบรอบวัด ${when})` : ''
  if (t.dir === 'flat') return `ทรงตัว${tail}`
  const cm = Math.max(1, Math.round(Math.abs(t.diff) * 100))
  return `${t.dir === 'up' ? 'สูงขึ้น' : 'ลดลง'} ${cm} ซม.${tail}`
}

function percentText(value) {
  const v = toNum(value)
  return v === null ? '–' : `${v.toLocaleString('th-TH', { maximumFractionDigits: 1 })}%`
}

// ระยะสถานี↔หมู่ · ใช้พิกัดกลางหมู่ถ้าปักไว้ ไม่งั้นถอยไปใช้ระยะจากสำนักงานที่เก็บไว้ในตั้งค่าสถานี
// from บอกที่มาของตัวเลข เพื่อให้หน้าจอเขียนว่า "จากหมู่" หรือ "จากสำนักงาน" ไม่ให้เข้าใจผิดว่าวัดจากหมู่
export function stationDistance(village, station) {
  const vLat = toNum(village?.latitude)
  const vLng = toNum(village?.longitude)
  const sLat = toNum(station?.latitude)
  const sLng = toNum(station?.longitude)
  if (vLat !== null && vLng !== null && sLat !== null && sLng !== null) {
    const km = haversineKm({ lat: vLat, lng: vLng }, { lat: sLat, lng: sLng })
    if (Number.isFinite(km)) return { km, from: 'village' }
  }
  const office = toNum(station?.distance_km)
  return office !== null && office >= 0 ? { km: office, from: 'office' } : { km: null, from: null }
}

// จับคู่การผูกของหมู่กับแถวสถานีจาก get_public_water_situation() ด้วย (ชนิด, รหัส)
// ⚠️ รหัสเดียวกันมีได้หลายชนิด (YOM003 เป็นทั้งสถานีฝนและระดับน้ำของทุ่งแค้ว) ห้ามจับคู่ด้วยรหัสอย่างเดียว
export function resolveLinks(village, stations) {
  const links = Array.isArray(village?.stations) ? village.stations : []
  const index = new Map()
  for (const s of Array.isArray(stations) ? stations : []) {
    if (LINKABLE_TYPES.includes(s?.station_type)) index.set(`${s.station_type}:${s.station_code}`, s)
  }
  const found = []
  const missing = []
  for (const link of links) {
    const station = index.get(`${link?.station_type}:${link?.station_code}`)
    if (station) found.push(station)
    else missing.push(link)
  }
  return { found, missing }
}

const joinNames = stations => stations.map(s => s.station_name).join(', ')

/**
 * สถานะของหมู่หนึ่ง
 * @param {{ village: object, stations: object[], warnings?: object[], now: number|Date }} input
 *   stations = แถวสถานีทั้งหมดจาก get_public_water_situation() (รวม ews) · warnings = ข้อความ สสน. ชุดเดียวกับแถบหน้าแรก
 * @returns {{ status: 'ok'|'nodata'|'watch'|'high', label: string, reason: string, reasons: string[],
 *             stale: object[], missingCount: number, linkedCount: number }}
 */
export function villageStatus({ village, stations, warnings = [], now }) {
  const { found, missing } = resolveLinks(village, stations)
  const linkedCount = found.length + missing.length
  const byType = type => found.filter(s => s.station_type === type)
  const rainRows = byType('rain')
  const rainCodes = new Set(rainRows.map(s => s.station_code))
  const ews = (Array.isArray(stations) ? stations : []).filter(s => s?.station_type === 'ews' && rainCodes.has(s.station_code))

  // เกณฑ์ "ระวังสูง" = buildAlerts() ตัวเดิมทั้งหมด (ตัวมันกรองสถานีที่ค้างออกเองแล้ว)
  // ข้อความ สสน. เป็นระดับอำเภอ ใช้กับทุกหมู่ — แถบหน้าแรกแสดงให้ทุกคนเห็นอยู่แล้ว
  // ถ้าการ์ดหมู่บอก "ปกติ" ใต้แถบที่บอกเตือน ประชาชนจะเชื่อการ์ดที่ดูเฉพาะเจาะจงกว่า
  const alerts = buildAlerts({ rain: rainRows, ews, warnings, levels: byType('waterlevel'), dams: byType('dam'), now })
  const high = []
  for (const s of alerts.overbank) high.push(`ระดับน้ำที่${s.station_name} ${bankTextCm(s.bank_diff_m)}`)
  for (const { station, alert } of alerts.ews) high.push(`${station.station_name} · ${alert.text}`)
  for (const s of alerts.heavyRain) high.push(`ฝนสะสม 24 ชม. ที่${s.station_name} ${formatMm(s.rain_24h_mm)} มม. (ฝนหนักมาก)`)
  if (alerts.warnings.length > 0) high.push('มีข้อความเตือนจาก สสน. ในอำเภอ')
  for (const s of alerts.damOver) high.push(`${s.station_name} ${percentText(s.storage_percent)} เกินความจุที่ระดับเก็บกัก`)

  const stale = found.filter(s => !stationIsFresh(s, now))
  const result = (status, reasons) => ({
    status, label: VILLAGE_STATUSES[status].label, reason: reasons[0] ?? '', reasons, stale,
    missingCount: missing.length, linkedCount,
  })

  if (high.length > 0) return result('high', high)

  // เฝ้าระวัง: สถานีระดับน้ำที่ผูก "สด" และต่ำกว่าตลิ่งไม่เกิน 1 ม. · เรียงตัวที่ใกล้ตลิ่งที่สุดก่อน
  // ฝนหนัก (35–90 มม.) และอ่าง "น้ำมาก" ไม่ดันสถานะโดยตั้งใจ — ระบบเดิมไม่มีขั้นเตือนจากสองอย่างนี้ (#329)
  const watch = byType('waterlevel')
    .filter(s => stationIsFresh(s, now) && levelRank(s.bank_diff_m) === 1)
    .sort((a, b) => toNum(a.bank_diff_m) - toNum(b.bank_diff_m))
    .map(s => `ระดับน้ำที่${s.station_name} ${bankTextCm(s.bank_diff_m)} (ไม่ถึง 1 ม.)`)
  if (watch.length > 0) return result('watch', watch)

  if (linkedCount === 0) return result('nodata', ['หมู่นี้ยังไม่ได้เลือกสถานีวัด'])
  if (stale.length > 0 || missing.length > 0) {
    const reasons = []
    if (stale.length > 0) reasons.push(`สถานี${joinNames(stale)} ไม่มีค่าใหม่`)
    if (missing.length > 0) reasons.push('สถานีที่เลือกไว้ถูกถอดออกจากระบบ')
    return result('nodata', reasons)
  }
  return result('ok', ['ค่าที่วัดได้ยังไม่ถึงเกณฑ์เฝ้าระวัง'])
}

/**
 * ข้อเท็จจริงรายสถานีที่แสดงบนการ์ดหมู่ — เรียงตามลำดับที่ผูก (ฝน → ระดับน้ำ → อ่าง ตามที่ RPC ส่งมา)
 * สถานีที่ผูกไว้แต่หาไม่เจอในรายการ (ถูกปิด/ถอด) ได้แถว missing: true ไม่หายไปเงียบๆ
 */
export function villageFacts({ village, stations, homeAmphoe, now }) {
  const { found, missing } = resolveLinks(village, stations)
  const rows = found.map(s => {
    const fresh = stationIsFresh(s, now)
    const dist = stationDistance(village, s)
    const base = {
      key: `${s.station_type}:${s.station_code}`, type: s.station_type, code: s.station_code,
      name: s.station_name, river: s.river_name || null, place: stationPlace(s, homeAmphoe),
      distanceKm: dist.km, distanceFrom: dist.from, fresh, missing: false,
      measuredAt: s.recorded_at ? measuredAtText(s.recorded_at, now) : '',
    }
    if (s.station_type === 'rain') {
      const mm = toNum(s.rain_24h_mm)
      return { ...base, label: 'ฝนสะสม 24 ชม.', value: mm === null ? null : `${formatMm(mm)} มม.`, note: mm === null ? null : rainLevel(mm)?.label ?? null }
    }
    if (s.station_type === 'waterlevel') {
      return { ...base, label: 'น้ำเทียบตลิ่ง', value: bankTextCm(s.bank_diff_m), note: levelTrendText(s, now) }
    }
    const pct = toNum(s.storage_percent)
    return { ...base, label: 'ปริมาตรน้ำในอ่าง', value: pct === null ? null : `${percentText(pct)} ของความจุ`, note: pct === null ? null : damLevel(pct)?.label ?? null }
  })
  for (const link of missing) {
    rows.push({
      key: `${link.station_type}:${link.station_code}`, type: link.station_type, code: link.station_code,
      name: link.station_code, river: null, place: '', distanceKm: null, distanceFrom: null,
      fresh: false, missing: true, measuredAt: '', label: '', value: null, note: null,
    })
  }
  return rows
}

const TYPE_ORDER = { rain: 0, waterlevel: 1, dam: 2 }

/**
 * สถานีทั้งหมดที่ผูกกับหมู่ได้ เรียงตามชนิดแล้วใกล้ไปไกล — ให้หน้าตั้งค่าของเจ้าหน้าที่
 * nearby = อยู่ในระยะ VILLAGE_NEARBY_KM · ไม่มีระยะ = ไม่นับว่าใกล้ (ไม่รู้ ≠ ใกล้)
 */
export function rankStations(village, stations) {
  return (Array.isArray(stations) ? stations : [])
    .filter(s => LINKABLE_TYPES.includes(s?.station_type))
    .map(s => {
      const dist = stationDistance(village, s)
      return { station: s, km: dist.km, from: dist.from, nearby: dist.km !== null && dist.km <= VILLAGE_NEARBY_KM }
    })
    .sort((a, b) => TYPE_ORDER[a.station.station_type] - TYPE_ORDER[b.station.station_type]
      || (a.km ?? Infinity) - (b.km ?? Infinity))
}

/**
 * สถานีที่ระบบแนะนำให้หมู่: ฝนใกล้สุด 1 + ระดับน้ำใกล้สุด 1 ภายใน VILLAGE_NEARBY_KM
 * แนะนำจากระยะเท่านั้น — "อยู่ลำน้ำเดียวกันไหม" ระบบรู้ไม่ได้ เจ้าหน้าที่ต้องดู river_name แล้วกดยืนยันเอง
 * ไม่แนะนำอ่าง (ปริมาตรอ่างไม่ได้บอกสถานการณ์น้ำที่หมู่)
 */
export function suggestStations(village, stations) {
  const ranked = rankStations(village, stations).filter(r => r.nearby)
  const nearest = type => ranked.find(r => r.station.station_type === type)?.station ?? null
  const rain = nearest('rain')
  const waterlevel = nearest('waterlevel')
  return { rain, waterlevel, list: [rain, waterlevel].filter(Boolean) }
}

export function villageTitle(village) {
  const name = typeof village?.name === 'string' ? village.name.trim() : ''
  return name ? `หมู่ ${village.moo_no} ${name}` : `หมู่ ${village?.moo_no}`
}

// ───────── จำหมู่ที่เลือกไว้ในเครื่อง (ไม่ส่งขึ้นเซิร์ฟเวอร์) ─────────
// storage ถูกส่งเข้ามา เพื่อทดสอบใน node ได้ และเพื่อให้ localStorage ที่ใช้ไม่ได้ (โหมดส่วนตัว/ปิดคุกกี้) ไม่ทำหน้าพัง
const chosenKey = slug => `water-village:${slug || 'default'}`

export function loadChosenMoo(storage, slug, villages) {
  try {
    const raw = storage?.getItem(chosenKey(slug))
    if (raw === null || raw === undefined || raw === '') return null
    const moo = Number(raw)
    return (villages ?? []).some(v => Number(v.moo_no) === moo) ? moo : null
  } catch {
    return null
  }
}

export function saveChosenMoo(storage, slug, moo) {
  try {
    if (moo === null || moo === undefined) storage?.removeItem(chosenKey(slug))
    else storage?.setItem(chosenKey(slug), String(moo))
  } catch {
    // เก็บไม่ได้ก็เลือกใหม่ทุกครั้ง ไม่ใช่เรื่องร้ายแรง
  }
}

// ภาพแชร์แจ้งเตือนน้ำ-ฝน 1 ภาพ (1080×1350 PNG สำหรับแชร์ FB/LINE) — ส่วน "ตัดสินใจ + ประกอบข้อมูล" ล้วน ไม่มี DOM
// ทดสอบใน node (tests/water-alert-poster.test.mjs) · ส่วนวาดลง canvas อยู่ที่ waterAlertPosterImage.js
// หัวภาพ 4 แบบ เรียงตามความสำคัญ: สถานีเตือนภัยระดับวิกฤติ → น้ำเสมอ/สูงกว่าตลิ่ง → สถานีเตือนภัยระดับเตรียมพร้อม → อ่าง >100% → ฝนหนักมาก (ดู posterTopicCandidates)
//
// ⚠️ ไฟล์นี้ไม่ตัดสินสถานการณ์เอง: เกณฑ์ทุกอย่างมาจาก buildAlerts() ของ waterSituation.js (ชุดเดียวกับแถบบนหน้าแรก
//    หน้า /water-situation และ Telegram) — ห้ามเขียนเกณฑ์ "เก่าเกินไป" ซ้ำคนละค่าที่นี่ (ค่าเก่าถูก buildAlerts กรองให้แล้ว)
//    ส่วนค่าประกอบที่ไม่ใช่เหตุเตือน (อ่างในช่องตัวเลขตอนหัวภาพเป็นฝน) ใช้ค่าคงที่ DAM_STALE_HOURS ตัวเดียวกัน
// ⚠️ ห้ามแต่งตัวเลข/เบอร์โทร: ทุกค่ามาจากแถวสถานี (RPC get_public_water_situation) หรือสมุดสายด่วนของ อปท. เท่านั้น
//    ไม่มีเบอร์ = ช่องนั้นหาย (ไม่มีเบอร์สำรอง/เบอร์กลาง) · PDPA: มีแต่ชื่อสถานี ตัวเลข เวลา — ไม่มีข้อมูลบุคคล

import {
  DAM_LEVELS, DAM_STALE_HOURS, DAM_TREND_FLAT_MCM, LEVEL_TIERS, LEVEL_WATCH_M, RAIN_LEVELS, STATION_STALE_HOURS, TREND_FLAT_M,
  buildAlerts, damLevel, distanceText, formatMm, isStale, levelRank, measuredAtText, rainLevel, stationPlace, toNum, waterTrend,
} from './waterSituation.js'
import { orgNameParts } from './orgTerms.js'

export const POSTER_WIDTH = 1080
export const POSTER_HEIGHT = 1350

// สีหัวช่องของ "ค่าประกอบ" (ไหลเข้า/ระบายออก/ฝนชั่วโมงล่าสุด) — เทาเข้ม ไม่ใช่สีระดับเตือน
export const NEUTRAL_HEAD = '#3d3236'
// บรรทัดรองของป้ายหน่วยงาน: ชื่อระบบ + คำขวัญ Smart City (วาดเป็นแคปซูลสีฟ้าแยกต่างหาก ให้เด่นกว่าตัวหนังสือครีมเดิม)
export const POSTER_BADGE_SYSTEM = 'ระบบข้อมูลน้ำ–ฝน'
export const POSTER_BADGE_TAG = 'มุ่งสู่เมืองอัจฉริยะ (Smart City)'
export const DAM_SCALE_MAX = 120
export const RAIN_SCALE_MAX = 150

// สีชั้นเตือนภัยของแถบเกณฑ์ที่ไม่ใช่ฝน/อ่าง (เขียว → เหลืองทอง → แดง) — ใช้ชุดเดียวกันทั้งสถานีเตือนภัย (กรมทรัพยากรน้ำ
// เฝ้าระวัง/เตรียมพร้อม/วิกฤติ) และระดับน้ำเทียบตลิ่ง (กรมชลประทาน ปกติ/เฝ้าระวัง/แจ้งเตือนภัย) · "เหลือง" ของกรมใช้เหลืองทอง
// ให้อ่านออกบนพื้นขาว
export const TIER_COLORS = ['#27b376', '#f5b400', '#bf212f']
// แถบเกณฑ์ระดับน้ำเทียบตลิ่ง: แกน = ม. เทียบตลิ่ง (ติดลบ = ต่ำกว่าตลิ่ง) ช่วง −2 ถึง +1
export const BANK_SCALE_MIN = -2
export const BANK_SCALE_MAX = 1

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

// วัน-เวลาตามเวลาไทย (UTC+7) — ไม่พึ่ง ICU/โซนเวลาเครื่อง ให้วันที่ในภาพเท่ากันทุกเครื่อง · อ่านไม่ได้คืน null
function bangkokParts(value) {
  if (value === null || value === undefined || value === '') return null
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return null
  const shifted = new Date(time + 7 * 3600 * 1000)
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate(), hh: shifted.getUTCHours(), mm: shifted.getUTCMinutes() }
}

/** "15 พฤศจิกายน 2569" — อ่านวันไม่ได้คืนสตริงว่าง */
export function posterDateLong(value) {
  const p = bangkokParts(value)
  return p ? `${p.d} ${THAI_MONTHS[p.m]} ${p.y + 543}` : ''
}

/** "11 พ.ย. 69" */
export function posterDateShort(value) {
  const p = bangkokParts(value)
  return p ? `${p.d} ${THAI_MONTHS_SHORT[p.m]} ${String((p.y + 543) % 100).padStart(2, '0')}` : ''
}

/** "10:00" ตามเวลาไทย */
export function posterTime(value) {
  const p = bangkokParts(value)
  return p ? `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}` : ''
}

/** สีตัวอักษรที่อ่านออกบนพื้นสี hex นั้น — พื้นสว่าง (เหลือง/ฟ้าอ่อน/ส้ม) ใช้ตัวเข้ม */
export function readableTextOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''))
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
  return lum > 0.6 ? '#1a0306' : '#ffffff'
}

/**
 * คำเรียก อปท. ในประโยค "แจ้ง…ทันที" — ตัดสินจากชื่อหน่วยงานเป็นหลัก (org_type ของข้อมูลเก่าบางแถวว่าง)
 * เทศบาล → "เทศบาล" (ตามต้นแบบที่เจ้าของระบบอนุมัติ) · อบต. → "อบต." · อบจ. → "อบจ." · ไม่รู้ประเภท → ชื่อหน่วยงานเอง
 */
export function orgCallName(tenant) {
  const name = String(tenant?.name ?? '').trim()
  const type = String(tenant?.org_type ?? '').trim()
  if (name.startsWith('เทศบาล') || type.startsWith('เทศบาล')) return 'เทศบาล'
  if (name.startsWith('องค์การบริหารส่วนจังหวัด') || type === 'อบจ.') return 'อบจ.'
  if (name.startsWith('องค์การบริหารส่วนตำบล') || type === 'อบต.') return 'อบต.'
  return name || 'หน่วยงาน'
}

const callOut = org => (/\.$/.test(org) ? `แจ้ง ${org} ทันที` : `แจ้ง${org}ทันที`)

/**
 * เรื่องที่เป็นหัวภาพได้ เรียงจากสำคัญมากไปน้อยตามผล buildAlerts:
 *   สถานีเตือนภัย ระดับ 3 (วิกฤติ) → น้ำเสมอ/สูงกว่าตลิ่ง → สถานีเตือนภัย ระดับ 2 (เตรียมพร้อม) → อ่างเกินความจุเก็บกัก → ฝนหนักมาก
 * เหตุผล (ตามนิยามของกรมทรัพยากรน้ำ): วิกฤติ = ให้เคลื่อนย้ายไปพื้นที่ปลอดภัย · น้ำเสมอ/ล้นตลิ่ง = เกิดขึ้นแล้ว ·
 *   เตรียมพร้อม = เก็บข้าวของเตรียมอพยพ (ยังเป็นการเตรียมตัว) · อ่าง/ฝนเป็นปริมาณน้ำต้นเหตุที่ยังไม่ถึงคน
 * ⚠️ ลำดับนี้ "ต่างจากแถบหน้าแรก" (alertSummary) โดยตั้งใจ: แถบเอาฝนมาก่อนอ่าง ภาพเอาอ่างมาก่อนฝน (เจ้าของระบบอนุมัติ)
 * ews ใน alerts เป็น [{ station, alert }] เรียงระดับมากก่อนแล้ว และมีแต่ระดับ ≥ 2 ที่ค่ายังสด (buildAlerts กรองให้)
 */
export function posterTopicCandidates(alerts) {
  const ews = Array.isArray(alerts?.ews) ? alerts.ews : []
  const ewsAt = level => ews.find(x => x?.alert?.level === level)
  const out = []
  const push = (kind, station, alert) => { if (station) out.push(alert ? { kind, station, alert } : { kind, station }) }
  const e3 = ewsAt(3)
  push('ews', e3?.station, e3?.alert)
  push('overbank', alerts?.overbank?.[0])
  const e2 = ewsAt(2)
  push('ews', e2?.station, e2?.alert)
  push('dam', alerts?.damOver?.[0])
  push('rain', alerts?.heavyRain?.[0])
  return out
}

/**
 * เลือกเรื่องของหัวภาพ = ตัวแรกของ posterTopicCandidates · ไม่มีเลย = null (ไม่มีภาพ ไม่มีปุ่ม)
 * อ่าง 80–100% ไม่ขึ้นหัวภาพ (buildAlerts ไม่ใส่ใน damOver) · สถานีเตือนภัยระดับ 1/ค่าเก่า ไม่ขึ้น (buildAlerts กรองแล้ว)
 * คืน { kind: 'ews', station, alert } | { kind: 'overbank'|'dam'|'rain', station }
 */
export function selectPosterTopic(alerts) {
  return posterTopicCandidates(alerts)[0] ?? null
}

const isFreshAt = (iso, now, hours) => Boolean(iso) && !isStale(iso, now, hours)

// ค่าฝน 24 ชม. ที่ยังเป็นปัจจุบัน — เก่ากว่าเกณฑ์สถานี = ไม่มีค่า (ไม่นำมาจัดอันดับ ไม่วาดแท่ง)
function freshRainMm(station, now) {
  return isFreshAt(station?.recorded_at, now, STATION_STALE_HOURS) ? toNum(station.rain_24h_mm) : null
}

const byDistance = (a, b) => (toNum(a.distance_km) ?? Infinity) - (toNum(b.distance_km) ?? Infinity)

/**
 * ฝน 2 แถว: สถานีในตำบล (is_primary — ตัวเดียวกับป้าย "ในตำบล" ของหน้า) ก่อน แล้วเติมด้วยสถานีที่ฝนมากที่สุด · ไม่บวกรวมฝน
 * ถ้าหัวภาพเป็นฝน สถานีต้นเหตุต้องอยู่ในแถว (ไม่งั้นตัวเลขหัวภาพไม่มีที่มา) — แทนแถวที่ 2
 */
export function pickRainRows(rain, now, mustInclude = null, limit = 2) {
  const list = (Array.isArray(rain) ? rain : []).filter(s => s?.station_type === 'rain' || s?.station_type === undefined)
  const byRain = (a, b) => (freshRainMm(b, now) ?? -1) - (freshRainMm(a, now) ?? -1) || byDistance(a, b)
  const local = list.filter(s => s.is_primary === true).sort(byRain)
  const others = list.filter(s => s.is_primary !== true).sort(byRain)
  const picked = [...local, ...others].slice(0, limit)
  if (mustInclude && !picked.includes(mustInclude)) {
    picked.splice(Math.max(0, limit - 1), picked.length, mustInclude)
    // กันซ้ำเมื่อ mustInclude อยู่ในรายการอยู่แล้วแต่เป็นคนละอ็อบเจกต์เดียวกันตามรหัส
    return picked.filter((s, i) => picked.findIndex(o => o.station_code === s.station_code) === i)
  }
  return picked
}

// อ่างที่ใช้เป็น "ค่าประกอบ" ตอนหัวภาพเป็นฝน: ค่ายังเป็นปัจจุบัน (DAM_STALE_HOURS เดียวกับ buildAlerts) · ในตำบลก่อน แล้วใกล้สุด
export function pickContextDam(dams, now) {
  return (Array.isArray(dams) ? dams : [])
    .filter(s => isFreshAt(s?.recorded_at, now, DAM_STALE_HOURS) && toNum(s.storage_percent) !== null)
    .sort((a, b) => Number(b.is_primary === true) - Number(a.is_primary === true) || byDistance(a, b))[0] ?? null
}

// อ่างใกล้เคียง (มุมล่างขวาของกรอบข้อควรทำ) — เจ้าของระบบสั่ง 2026-11-15: ชาวบ้านบางพื้นที่ใช้น้ำจากอ่างตำบลข้างเคียง
// เป็นข้อมูลประกอบ ต้องเด่นน้อยกว่าอ่าง/ฝนของเรา · ไม่ทำให้เกิดภาพเตือนเพิ่ม
export const NEARBY_DAM_KM = 5
// กติกา: ห่าง ≤ NEARBY_DAM_KM · ไม่ใช่อ่างที่อยู่บนหัวภาพ/ช่องตัวเลขแล้ว · ค่ายังสด (DAM_STALE_HOURS) · ใกล้สุดอ่างเดียว
export function pickNearbyDam(dams, now, exclude = null) {
  const skip = exclude?.station_code ?? null
  return (Array.isArray(dams) ? dams : [])
    .filter(s => s && s !== exclude && (skip === null || s.station_code !== skip))
    .filter(s => { const d = toNum(s.distance_km); return d !== null && d <= NEARBY_DAM_KM })
    .filter(s => isFreshAt(s.recorded_at, now, DAM_STALE_HOURS) && toNum(s.storage_percent) !== null)
    .sort(byDistance)[0] ?? null
}

const damColor = pct => damLevel(pct)?.color ?? NEUTRAL_HEAD
const rainColor = mm => rainLevel(mm)?.bar ?? NEUTRAL_HEAD
const num1 = v => v.toLocaleString('th-TH', { maximumFractionDigits: 1 })
const mcm2 = v => { const n = toNum(v); return n === null ? '–' : n.toFixed(2) }
// "อ่างเก็บน้ำแม่คำปอง" → "อ่างแม่คำปอง" (ใช้ในป้ายแคบ)
const shortDamName = name => String(name ?? '').replace(/^อ่างเก็บน้ำ/, 'อ่าง')

// "ลำน้ำ" + ชื่อ เว้นแต่ชื่อขึ้นต้นด้วยคำเรียกแหล่งน้ำอยู่แล้ว (ไม่ให้เป็น "ลำน้ำแม่น้ำยม")
function riverPhrase(riverName) {
  const river = String(riverName ?? '').trim()
  if (!river) return 'ลำน้ำท้ายอ่าง'
  return /^(ลำน้ำ|แม่น้ำ|น้ำ|ห้วย|คลอง|ลำ)/.test(river) ? river : `ลำน้ำ${river}`
}

// ตัดชื่อยาวให้สั้นลงด้วย "…" (ใช้ในป้ายหมุดบนแถบเกณฑ์ ที่ต้องเหลือที่ให้ค่าท้ายป้ายเสมอ)
const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

const stripPrefix = (value, re) => String(value ?? '').trim().replace(re, '').trim()

// ตัดอักขระควบคุม/ช่องว่างซ้ำ + จำกัดความยาว — ข้อความจากต้นทางเข้าภาพ (ไม่ใช่ HTML จึงไม่มีช่องโหว่ฝังสคริปต์ แต่กันบรรทัดบวม)
function clean(value, max = 400) {
  return String(value ?? '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * เบอร์ที่ขึ้นในภาพ: tenant.phone + สายด่วน 2 อันดับแรกของสมุด urgent · ไม่มีเบอร์ = ไม่มีรายการ (ช่องหายทั้งแถบ)
 * ห้ามเติมเบอร์สำรอง/เบอร์กลาง/เบอร์ที่เดา · เบอร์ซ้ำกัน (ตามตัวเลข) ขึ้นครั้งเดียว
 */
export function buildPosterPhones(tenant, contacts) {
  const out = []
  const seen = new Set()
  const add = (label, number) => {
    // ตัดแท็ก HTML ก่อน (ไม่งั้น "</b>" ทิ้ง "/" ไว้ท้ายเบอร์) แล้วกรองเหลือเฉพาะอักขระของเบอร์ · ตัวคั่นที่ค้างหัวท้ายทิ้ง
    const n = clean(number, 40).replace(/<[^>]*>/g, '').replace(/[^0-9+() ,/#*-]/g, '').replace(/^[\s,/-]+|[\s,/-]+$/g, '')
    const digits = n.replace(/\D/g, '')
    if (!digits || n.length > 20 || seen.has(digits)) return
    seen.add(digits)
    out.push({ label: clean(label, 40), number: n })
  }
  if (tenant?.phone) add(tenant.name ?? '', tenant.phone)
  const urgent = (Array.isArray(contacts) ? contacts : []).filter(c => c && typeof c.number !== 'undefined' && String(c.number).replace(/\D/g, ''))
  for (const c of urgent.slice(0, 2)) add(c.label ?? '', c.number)
  return out
}

function rainRow(station, now, homeAmphoe) {
  const mm = freshRainMm(station, now)
  const level = mm === null ? null : rainLevel(mm)
  const at = station.recorded_at ? measuredAtText(station.recorded_at, now) : ''
  const stale = Boolean(station.recorded_at) && isStale(station.recorded_at, now, STATION_STALE_HOURS)
  const when = mm !== null ? (at ? `วัดเมื่อ ${at}` : '')
    : stale ? (at ? `ไม่มีค่าใหม่ตั้งแต่ ${at}` : 'ไม่มีค่าใหม่') : 'ไม่มีข้อมูล'
  return {
    code: station.station_code ?? null,
    name: clean(station.station_name, 80),
    inTambon: station.is_primary === true,
    sub: [stationPlace(station, homeAmphoe), distanceText(station.distance_km), when].filter(Boolean).join(' · '),
    mm,
    mmText: mm === null ? '–' : formatMm(mm),
    color: level?.bar ?? null,
    levelLabel: level?.label ?? null,
  }
}

const round2 = v => Math.round(v * 100) / 100
const isRaining = mm => mm !== null && mm >= RAIN_LEVELS[0].below

// หมู่บ้านที่สถานีเตือนภัยดูแล — ใช้เฉพาะ note ที่ขึ้นต้นด้วยข้อความมาตรฐานของ thaiwater-sync ("หมู่บ้านที่สถานีดูแล: …")
// note รูปแบบอื่นไม่เอาเข้าภาพ (ไม่รู้ว่าเป็นข้อความอะไร) · ยาวเกิน 120 ตัวอักษร ตัดที่ตัวคั่นรายชื่อล่าสุดแล้วต่อ "ฯลฯ"
const VILLAGE_NOTE_PREFIX = /^หมู่บ้านที่สถานีดูแล\s*[:：]\s*/
function ewsVillages(note) {
  const text = clean(note, 400)
  if (!VILLAGE_NOTE_PREFIX.test(text)) return ''
  const list = text.replace(VILLAGE_NOTE_PREFIX, '').trim()
  if (list.length <= 120) return list
  const cut = list.slice(0, 120)
  const at = cut.lastIndexOf(',')
  return `${(at > 0 ? cut.slice(0, at) : cut).trim()} ฯลฯ`
}

// สถานีวัดฝนที่ station_code เดียวกับสถานีเตือนภัย — ไม่มี/ค่าเก่า = ค่าเป็น null (ไม่เดา ไม่ใช้สถานีอื่นแทน)
function ewsStationRain(station, rain, now) {
  const code = station?.station_code
  const none = { station: null, mm: null, mm1h: null }
  if (code === null || code === undefined || code === '') return none
  const found = (Array.isArray(rain) ? rain : []).find(s => s && (s.station_type === 'rain' || s.station_type === undefined) && String(s.station_code) === String(code))
  if (!found) return none
  const mm = freshRainMm(found, now)
  return { station: found, mm, mm1h: mm === null ? null : toNum(found.rain_1h_mm) }
}

// "09:30 น." ถ้าอยู่วันเดียวกับค่าปัจจุบัน · "14 พ.ย. 69 21:00 น." ถ้าคนละวัน (ตามเวลาไทย)
function sinceText(prevAt, currentAt) {
  const p = bangkokParts(prevAt)
  const c = bangkokParts(currentAt)
  if (!p) return 'ค่าก่อนหน้า'
  const sameDay = c && c.y === p.y && c.m === p.m && c.d === p.d
  return `${sameDay ? '' : `${posterDateShort(prevAt)} `}${posterTime(prevAt)} น.`
}

/**
 * ประโยควิเคราะห์สถานการณ์ที่ต่อท้ายย่อหน้าเปิด — กฎตรงไปตรงมา ไม่ใช่ AI (เจ้าของระบบเลือก 2026-11-15)
 * กติกา: ทุกประโยคคิดจากตัวเลขที่ "อยู่ในภาพเดียวกัน" (ช่องตัวเลข/แถวฝน) คนอ่านคำนวณซ้ำได้เอง
 *   · ไม่พยากรณ์ล่วงหน้า (ไม่มี "จะล้นใน N ชม.") · ไม่สั่งอพยพ (อำนาจของ อปท. ไม่ใช่ภาพอัตโนมัติ)
 *   · ค่าที่ใช้ขาด = ประโยคนั้นไม่ขึ้น (ไม่เดา) · ไม่มีอุปมา เช่น "เท่าสระว่ายน้ำ" (เจ้าของระบบ: ไม่เป็นทางการ)
 * คืน { excess, sentences: [{ key, runs }] } — excess = ปริมาตรเกินระดับเก็บกัก (ล้าน ลบ.ม.) ที่ต่อท้ายคำว่า "เกินความจุ…"
 */
export function buildSituationAnalysis({ kind, top, dam, damPct, rows, heavyRain = [], rain = [], now }) {
  const sentences = []
  if (kind === 'ews') {
    // หมู่บ้านที่สถานีดูแล (จาก note ของแถว) มาก่อน แล้วฝนของสถานีเดียวกัน — ขึ้นเป็นข้อเท็จจริงคู่กัน ไม่อ้างว่าฝนเป็นเหตุที่ทำให้เตือน
    // (แถว ews ไม่มีค่าที่ทำให้เตือน และไม่รู้ว่าเตือนด้วยฝนหรือระดับน้ำ)
    const villages = ewsVillages(top.note)
    if (villages) sentences.push({ key: 'villages', runs: [{ t: 'หมู่บ้านที่สถานีดูแล: ' }, { t: villages }] })
    const mm = ewsStationRain(top, rain, now).mm
    if (mm !== null && mm > RAIN_LEVELS[2].upTo) {
      sentences.push({ key: 'rain-at-station', runs: [{ t: `สถานีวัดฝนที่สถานีเดียวกันวัดฝนสะสม 24 ชม. ได้ ${formatMm(mm)} มม. ` }, { t: rainLevel(mm)?.label ?? 'ฝนหนัก', em: true }] })
    }
    return { excess: null, sentences }
  }
  if (kind === 'overbank') {
    // แนวโน้มระดับน้ำจากค่าก่อนหน้าที่ต้นทางส่งมา (ไม่พยากรณ์) — ขาดค่าใดค่าหนึ่ง = ไม่มีประโยค
    const trend = waterTrend(top.waterlevel_msl, top.prev_waterlevel_msl)
    if (trend) {
      const since = top.prev_recorded_at ? ` เทียบกับ ${sinceText(top.prev_recorded_at, top.recorded_at)}` : ' เทียบกับค่าก่อนหน้า'
      sentences.push({
        key: 'trend',
        runs: trend.dir === 'flat'
          ? [{ t: 'ระดับน้ำ' }, { t: 'ทรงตัว', em: true }, { t: since }]
          : [{ t: 'ระดับน้ำ' }, { t: `${trend.dir === 'up' ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(trend.diff).toFixed(2)} ม.`, em: true }, { t: since }],
      })
    }
    const wet = rows.filter(r => r.mm !== null && r.mm > RAIN_LEVELS[2].upTo).sort((a, b) => b.mm - a.mm)[0]
    if (wet) sentences.push({ key: 'rain-too', runs: [{ t: 'ประกอบกับ' }, { t: `${wet.levelLabel}ในพื้นที่`, em: true }, { t: ` (${wet.name} ${wet.mmText} มม.)` }] })
    return { excess: null, sentences }
  }
  if (kind === 'dam') {
    // ใช้ค่าปัดทศนิยม 2 ตำแหน่งแบบเดียวกับช่องตัวเลข — ลบกันในภาพแล้วได้เลขเดียวกัน
    const storage = toNum(dam.dam_storage_mcm)
    const cap = toNum(dam.dam_capacity_mcm)
    const ex = storage !== null && cap !== null ? round2(round2(storage) - round2(cap)) : null
    const inflow = toNum(dam.dam_inflow_mcm)
    const outflow = toNum(dam.dam_released_mcm)
    if (inflow !== null && outflow !== null) {
      const diff = round2(round2(inflow) - round2(outflow))
      if (Math.abs(diff) < DAM_TREND_FLAT_MCM) {
        sentences.push({ key: 'trend-flat', runs: [{ t: 'น้ำไหลลงอ่างเท่ากับที่ระบายออก ปริมาณน้ำจึง' }, { t: 'ทรงตัว', em: true }, { t: 'อยู่เหนือระดับเก็บกัก' }] })
      } else if (diff > 0) {
        sentences.push({ key: 'trend-up', runs: [{ t: `น้ำไหลลงอ่างมากกว่าที่ระบายออกวันละ ${diff.toFixed(2)} ล้าน ลบ.ม. น้ำในอ่าง` }, { t: 'มีแนวโน้มเพิ่มขึ้น', em: true }] })
      } else {
        sentences.push({ key: 'trend-down', runs: [{ t: `น้ำระบายออกมากกว่าที่ไหลลงอ่างวันละ ${(-diff).toFixed(2)} ล้าน ลบ.ม. น้ำในอ่าง` }, { t: 'มีแนวโน้มลดลง', em: true }] })
      }
    }
    // ฝนหนักขึ้นไปในแถวฝนของภาพ — บอกว่ามีพร้อมกัน ไม่อ้างว่าฝนตกลงอ่าง (สถานีอาจไม่อยู่ในลุ่มน้ำของอ่าง)
    const wet = rows.filter(r => r.mm !== null && r.mm > RAIN_LEVELS[2].upTo).sort((a, b) => b.mm - a.mm)[0]
    if (wet) sentences.push({ key: 'rain-too', runs: [{ t: 'ประกอบกับ' }, { t: `${wet.levelLabel}ในพื้นที่`, em: true }, { t: ` (${wet.name} ${wet.mmText} มม.)` }] })
    return { excess: ex !== null && ex >= DAM_TREND_FLAT_MCM ? ex : null, sentences }
  }

  // หัวภาพเป็นฝน — top ผ่าน buildAlerts แล้ว (ค่ายังสด) ฝนชั่วโมงล่าสุดจึงเป็นของเวลาเดียวกัน
  const rain1h = toNum(top.rain_1h_mm)
  if (rain1h !== null) {
    sentences.push(isRaining(rain1h)
      ? { key: 'still-raining', runs: [{ t: `ชั่วโมงล่าสุดยังวัดฝนได้ ${formatMm(rain1h)} มม. ` }, { t: 'ฝนยังตกอยู่', em: true }] }
      : { key: 'stopped', runs: [{ t: 'ชั่วโมงล่าสุดฝนหยุดแล้ว แต่' }, { t: 'น้ำป่าอาจยังไหลตามมา', em: true }] })
  }
  if (heavyRain.length >= 2) {
    sentences.push({ key: 'widespread', runs: [{ t: `ฝนหนักมาก ${heavyRain.length} สถานี ` }, { t: 'เป็นวงกว้าง', em: true }] })
  } else {
    // เฉพาะจุด = สถานีอื่นที่ค่ายังสดมีอย่างน้อย 1 และไม่มีตัวไหนถึง "ฝนหนัก" · ไม่มีสถานีอื่นให้เทียบ = ไม่สรุป
    const others = (Array.isArray(rain) ? rain : []).filter(s => s && s !== top && s.station_code !== top.station_code)
      .map(s => ({ s, mm: freshRainMm(s, now) })).filter(o => o.mm !== null)
    const wettest = others.sort((a, b) => b.mm - a.mm)[0]
    if (wettest && wettest.mm <= RAIN_LEVELS[2].upTo) {
      sentences.push({ key: 'local', runs: [{ t: 'สถานีอื่นใกล้พื้นที่ฝนไม่ถึงเกณฑ์ฝนหนัก เป็น' }, { t: 'ฝนหนักเฉพาะจุด', em: true }] })
    } else if (wettest) {
      const nearName = clean(wettest.s.station_name, 40)
      sentences.push({ key: 'nearby-heavy', runs: [{ t: `${/^สถานี/.test(nearName) ? '' : 'สถานี'}${nearName} ` }, { t: `ก็มี${rainLevel(wettest.mm)?.label ?? 'ฝนหนัก'}`, em: true }, { t: ` ${formatMm(wettest.mm)} มม.` }] })
    }
  }
  // อ่างประกอบที่น้ำมาก (80–100%) — >100% จะเป็นหัวภาพอ่างไปแล้ว
  if (dam && damPct !== null && damPct > DAM_LEVELS[2].upTo) {
    sentences.push({ key: 'dam-high', runs: [{ t: `${shortDamName(clean(dam.station_name, 60))}มีน้ำแล้ว ${num1(damPct)}% ` }, { t: 'ใกล้เต็มความจุ', em: true }] })
  }
  return { excess: null, sentences }
}

// ต่อประโยควิเคราะห์เป็นย่อหน้าเดียว (คั่นด้วยช่องว่าง) · ไม่มีประโยค = คงท้ายเดิม "รายละเอียดดังนี้"
function withAnalysis(runs, sentences) {
  if (!sentences.length) return [...runs, { t: ' รายละเอียดดังนี้' }]
  return [...runs, ...sentences.flatMap(s => [{ t: ' ' }, ...s.runs])]
}

/**
 * ประกอบข้อมูลทั้งภาพ — คืน null เมื่อไม่มีเรื่องเข้าเกณฑ์หัวภาพ (ไม่มีภาพ/ไม่มีปุ่ม)
 * รับรูปแบบเดียวกับที่ WaterAlertBanner / AlertBanner แยกจากแถวสถานีอยู่แล้ว (ไม่ยิง RPC เพิ่ม)
 * @param {{ rain?: object[], ews?: object[], levels?: object[], dams?: object[], warnings?: object[], tenant?: object,
 *   now: number|Date, contacts?: object[] }} input
 */
export function buildPosterModel({ rain = [], ews = [], levels = [], dams = [], warnings = [], tenant = null, now, contacts = [] }) {
  const alerts = buildAlerts({ rain, ews, levels, dams, warnings, now })
  const candidates = posterTopicCandidates(alerts)
  const topic = candidates[0] ?? null
  if (!topic) return null

  const homeAmphoe = tenant?.district
  const tenantName = clean(tenant?.name, 80) || 'หน่วยงาน'
  const org = orgCallName(tenant)
  const kind = topic.kind
  const top = topic.station
  const topRainRows = pickRainRows(rain, now, kind === 'rain' ? top : null)
  const rows = topRainRows.map(s => rainRow(s, now, homeAmphoe))

  // อ่างที่ใช้ในช่องตัวเลข/ภาพประกอบ: หัวภาพเป็นอ่าง = อ่างนั้น · หัวภาพเป็นฝน/สถานีเตือนภัย = อ่างที่ค่ายังสด (ถ้ามี)
  // หัวภาพเป็นน้ำเสมอตลิ่ง = ไม่ใส่อ่างในภาพ (4 ช่องของภาพนั้นกำหนดไว้แล้ว: ตลิ่ง/ระดับน้ำ/แนวโน้ม/ฝน)
  const dam = kind === 'dam' ? top : kind === 'overbank' ? null : pickContextDam(dams, now)
  const damPct = dam ? toNum(dam.storage_percent) : null
  const damName = dam ? clean(dam.station_name, 80) : ''
  const place = s => [stationPlace(s, homeAmphoe), distanceText(s.distance_km)].filter(Boolean).join(' ')
  const analysis = buildSituationAnalysis({ kind, top, dam, damPct, rows, heavyRain: alerts.heavyRain, rain, now })

  // ฝนของสถานีวัดฝนรหัสเดียวกับสถานีเตือนภัย (เฉพาะหัวภาพ ews)
  const ewsRain = kind === 'ews' ? ewsStationRain(top, rain, now) : null

  // sourceLead/sourceLine = ข้อความแหล่งข้อมูลบรรทัดแรก/ขึ้นต้นบรรทัดสองของท้ายภาพ (ขึ้นกับชนิดหัวภาพ) · todo/illustration ของ dam/rain กำหนดท้ายบล็อก
  let headline, ribbon, introBase, tiles, scale, todo, sourceLead, sourceLine, illustration
  if (kind === 'ews') {
    const alert = topic.alert
    const alertText = clean(alert.text, 40)
    const name = clean(top.station_name, 80)
    const lv = alert.level
    headline = { sub: 'สถานีเตือนภัยน้ำหลาก-ดินถล่ม', level: `ระดับ${alertText}`, name }
    ribbon = `สถานะ ณ วันที่ ${posterDateLong(top.recorded_at)} · ${posterTime(top.recorded_at)} น.`
    const bits = [top.is_primary === true ? 'ในตำบล' : '', place(top)].filter(Boolean).join(' ')
    // ความหมายของระดับตามเกณฑ์ของกรมทรัพยากรน้ำ (ไม่แต่งเอง) · ข้อความหมู่บ้านที่ดูแลอยู่ในประโยควิเคราะห์ (ตัดทิ้งได้เมื่อภาพแน่น)
    const meaning = lv === 3
      ? ' ตามเกณฑ์ของกรมทรัพยากรน้ำ ระดับนี้หมายถึงให้เคลื่อนย้ายไปยังพื้นที่ปลอดภัยที่ได้แจ้งไว้'
      : ' ตามเกณฑ์ของกรมทรัพยากรน้ำ ระดับนี้หมายถึงให้ระมัดระวัง ติดตามสถานการณ์ รอประกาศจากผู้รู้หรือหอกระจายข่าว'
    // ⚠️ แถว ews ไม่มีค่าที่ทำให้เตือน และไม่รู้ว่าเตือนด้วยฝนหรือระดับน้ำ — ห้ามเขียนว่าเตือนเพราะอะไร
    introBase = [
      { t: `สถานีเตือนภัยล่วงหน้าของกรมทรัพยากรน้ำ ${name}${bits ? ` (${bits})` : ''} รายงานสถานะ ` },
      { t: `ระดับ${alertText}`, em: true },
      { t: meaning },
    ]
    tiles = [
      { key: 'ews-level', icon: 'alert', color: TIER_COLORS[lv - 1], neutral: false, label: 'ระดับเตือนภัย\nกรมทรัพยากรน้ำ', value: alertText, unit: `ระดับ ${lv} จาก 3` },
      { key: 'rain24', icon: 'rain', color: ewsRain.mm === null ? NEUTRAL_HEAD : rainColor(ewsRain.mm), neutral: ewsRain.mm === null, label: 'ฝนสะสม 24 ชม.\nที่สถานีนี้',
        value: ewsRain.mm === null ? '–' : formatMm(ewsRain.mm), unit: ewsRain.mm === null ? 'ไม่มีข้อมูล' : `มม. ${rainLevel(ewsRain.mm)?.label ?? ''}`.trim() },
      { key: 'rain1h', icon: 'rain', color: NEUTRAL_HEAD, neutral: true, label: 'ฝนชั่วโมง\nล่าสุด',
        value: ewsRain.mm1h === null ? '–' : formatMm(ewsRain.mm1h), unit: ewsRain.mm1h === null ? 'ไม่มีข้อมูล' : 'มม.' },
    ]
    if (dam) {
      tiles.push({ key: 'pct', icon: 'pct', color: damColor(damPct), neutral: false, label: `${shortDamName(damName)}\n% ความจุ`, value: num1(damPct), unit: '%' })
    }
    // แถบเกณฑ์ 3 ช่องเท่ากัน หมุดอยู่กลางช่องของระดับปัจจุบัน — ไม่ขึ้นตัวเลข 1/2 ที่รอยต่อ (ระดับไม่ใช่ปริมาณที่วัดได้)
    scale = {
      kind: 'equal', heading: 'ระดับของสถานีเตือนภัย (กรมทรัพยากรน้ำ)', max: 3, value: lv - 0.5, activeIndex: lv - 1, ticks: false,
      zones: ['เฝ้าระวัง', 'เตรียมพร้อม', 'วิกฤติ'].map((label, i) => ({ label, from: i, to: i + 1, color: TIER_COLORS[i] })),
      markLabel: `${cut(clean(top.station_name, 80), 24)} ${alertText}`,
    }
    todo = lv === 3
      ? [
        [{ t: 'กรมทรัพยากรน้ำกำหนดว่าระดับวิกฤติ ' }, { t: 'ให้เคลื่อนย้ายไปพื้นที่ปลอดภัย', b: true }, { t: 'ที่ได้แจ้งไว้' }],
        [{ t: 'ฟังประกาศผู้นำชุมชน หอกระจายข่าว', b: true }, { t: ' หลีกเลี่ยงแนวน้ำไหลเชี่ยวและแนวดินไหล' }],
        [{ t: 'พบเหตุฉุกเฉิน ' }, { t: callOut(org), b: true }],
      ]
      : [
        [{ t: 'เก็บข้าวของ เตรียมพร้อมอพยพ', b: true }, { t: ' ติดตามสถานการณ์ใกล้ชิด' }],
        [{ t: 'รอฟังประกาศผู้นำชุมชน หอกระจายข่าว', b: true }, { t: ' สังเกตเสียงต้นไม้หัก หินตก น้ำขุ่น' }],
        [{ t: 'พบเหตุฉุกเฉิน ' }, { t: callOut(org), b: true }],
      ]
    sourceLead = 'แหล่งข้อมูล: สถานะสถานีเตือนภัย ระบบเตือนภัยล่วงหน้า กรมทรัพยากรน้ำ (ews.dwr.go.th) · ค่าฝน คลังข้อมูลน้ำแห่งชาติ (ThaiWater) สสน. · เกณฑ์ฝน กรมอุตุนิยมวิทยา'
    sourceLine = 'ข้อมูลจากกรมทรัพยากรน้ำและ ThaiWater (สสน.)'
    illustration = { kind: 'ews', rainy: true, pct: damPct, ewsLevel: lv, levelText: alertText }
  } else if (kind === 'overbank') {
    const diff = toNum(top.bank_diff_m)
    const atBank = Math.abs(diff) < 0.005
    const over = Math.abs(diff).toFixed(2)
    const river = clean(top.river_name, 60)
    const stationName = clean(top.station_name, 80)
    headline = {
      sub: 'สถานการณ์น้ำในลำน้ำ', level: atBank ? 'น้ำเสมอตลิ่ง' : `น้ำสูงกว่าตลิ่ง ${over} ม.`,
      name: river ? `${river} ${/^สถานี/.test(stationName) ? '' : 'สถานี'}${stationName}` : stationName,
    }
    ribbon = `วัดเมื่อ ${posterDateLong(top.recorded_at)} · ${posterTime(top.recorded_at)} น.`
    const bits = [river, [top.is_primary === true ? 'ในตำบล' : '', place(top)].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
    introBase = [
      { t: `สถานีวัดระดับน้ำ${stationName.replace(/^สถานี/, '')}${bits ? ` (${bits})` : ''} ${atBank ? 'ระดับน้ำเสมอตลิ่ง' : `ระดับน้ำสูงกว่าตลิ่ง ${over} ม.`} อยู่ในเกณฑ์` },
      { t: 'แจ้งเตือนภัย', em: true },
      { t: 'ของกรมชลประทาน' },
    ]
    const level = toNum(top.waterlevel_msl)
    const trend = waterTrend(top.waterlevel_msl, top.prev_waterlevel_msl)
    const bestRain = rows.filter(r => r.mm !== null).sort((a, b) => b.mm - a.mm)[0] ?? null
    tiles = [
      { key: 'bank', icon: 'bank', color: TIER_COLORS[2], neutral: false, label: 'เทียบกับตลิ่ง', value: atBank ? '0.00' : `+${over}`, unit: atBank ? 'ม. เสมอตลิ่ง' : 'ม. สูงกว่าตลิ่ง' },
      { key: 'level', icon: 'level', color: NEUTRAL_HEAD, neutral: true, label: 'ระดับน้ำ', value: level === null ? '–' : level.toFixed(2), unit: level === null ? 'ไม่มีข้อมูล' : 'ม.รทก.' },
      { key: 'trend', icon: 'trend', color: NEUTRAL_HEAD, neutral: true, label: 'แนวโน้ม',
        value: !trend ? '–' : trend.dir === 'up' ? 'ขึ้น' : trend.dir === 'down' ? 'ลง' : 'ทรงตัว',
        unit: !trend ? 'ไม่มีข้อมูลก่อนหน้า' : trend.dir === 'flat' ? `ต่างไม่ถึง ${TREND_FLAT_M} ม.` : `${Math.abs(trend.diff).toFixed(2)} ม.` },
    ]
    if (bestRain) {
      tiles.push({ key: 'rain24', icon: 'rain', color: rainColor(bestRain.mm), neutral: false, label: 'ฝนสะสม 24 ชม.\nสูงสุด', value: formatMm(bestRain.mm), unit: `มม. ${bestRain.name}` })
    }
    // แกน = ม. เทียบตลิ่ง (ติดลบ = ต่ำกว่าตลิ่ง) · ช่องที่ค่าอยู่กำหนดตรงๆ ตามขั้นของกรมชลประทาน (เสมอตลิ่งพอดีคือขั้นแจ้งเตือนภัย ไม่ใช่เฝ้าระวัง)
    scale = {
      kind: 'proportional', heading: 'ระดับน้ำเทียบตลิ่ง (เกณฑ์กรมชลประทาน)', min: BANK_SCALE_MIN, max: BANK_SCALE_MAX, value: 0 - diff, activeIndex: 2,
      zones: [
        { label: LEVEL_TIERS[0].label, from: BANK_SCALE_MIN, to: -1, color: TIER_COLORS[0] },
        { label: LEVEL_TIERS[1].label, from: -1, to: 0, color: TIER_COLORS[1], tickLabel: '−1 ม.' },
        { label: LEVEL_TIERS[2].label, from: 0, to: BANK_SCALE_MAX, color: TIER_COLORS[2], tickLabel: 'ตลิ่ง' },
      ],
      markLabel: `${cut(stationName, 24)} ${atBank ? 'เสมอตลิ่ง' : `+${over} ม.`}`,
    }
    todo = [
      [{ t: 'ยกของขึ้นที่สูง', b: true }, { t: ' ปิดเครื่องใช้ไฟฟ้า เตาแก๊ส ' }, { t: 'ยกเบรกเกอร์', b: true }],
      // ชื่อลำน้ำยาว (> 14 ตัวอักษร) ข้ามไป — ข้อนี้ต้องจบ 1 บรรทัด ไม่งั้นแถบล่างล้น (ชื่อเต็มอยู่ที่หัวภาพแล้ว)
      [{ t: 'เตรียมของจำเป็น', b: true }, { t: ` น้ำดื่ม อาหารแห้ง ยา โทรศัพท์ · ติดตามระดับน้ำ${river && riverPhrase(river).length <= 14 ? ` ${riverPhrase(river)} ` : ''}ใกล้ชิด` }],
      [{ t: 'พบน้ำท่วมบ้านหรือเหตุฉุกเฉิน ' }, { t: callOut(org), b: true }],
    ]
    sourceLead = 'แหล่งข้อมูล: คลังข้อมูลน้ำแห่งชาติ (ThaiWater) สสน. · เกณฑ์ระดับน้ำ กรมชลประทาน (มาตรฐานข้อมูลน้ำ สสน.) · เกณฑ์ฝน กรมอุตุนิยมวิทยา'
    sourceLine = 'ข้อมูลจาก ThaiWater (สสน.)'
    illustration = { kind: 'overbank', bankDiff: diff, rainy: analysis.sentences.some(sn => sn.key === 'rain-too'), bankText: atBank ? 'เสมอตลิ่ง' : `+${over} ม.` }
  } else if (kind === 'dam') {
    const level = damLevel(damPct)
    headline = { sub: 'สถานการณ์น้ำ', level: level?.label ?? 'อ่างเก็บน้ำ', name: damName }
    ribbon = `ข้อมูลอ่าง ณ วันที่ ${posterDateLong(dam.recorded_at)}`
    const bits = [dam.is_primary === true ? 'อยู่ในตำบล' : '', place(dam)].filter(Boolean).join(' ')
    introBase = [
      { t: `${damName}${bits ? ` (${bits})` : ''} มีปริมาณน้ำ` },
      { t: 'เกินความจุที่ระดับเก็บกัก', em: true },
      ...(analysis.excess !== null ? [{ t: ` ${analysis.excess.toFixed(2)} ล้าน ลบ.ม.` }] : []),
    ]
    const cap = toNum(dam.dam_capacity_mcm)
    const storage = toNum(dam.dam_storage_mcm)
    tiles = [
      { key: 'pct', icon: 'pct', color: damColor(damPct), neutral: false, label: 'ความจุ\nที่ระดับเก็บกัก', value: num1(damPct), unit: '%' },
      { key: 'volume', icon: 'vol', color: damColor(damPct), neutral: false, label: 'ปริมาณน้ำ\nในอ่าง', value: mcm2(storage),
        unit: storage === null ? 'ไม่มีข้อมูล' : cap !== null ? `จาก ${mcm2(cap)} ล้าน ลบ.ม.` : 'ล้าน ลบ.ม.' },
      { key: 'inflow', icon: 'inn', color: NEUTRAL_HEAD, neutral: true, label: 'น้ำไหลลงอ่าง\nต่อวัน', value: mcm2(dam.dam_inflow_mcm),
        unit: toNum(dam.dam_inflow_mcm) === null ? 'ไม่มีข้อมูล' : 'ล้าน ลบ.ม.' },
      { key: 'outflow', icon: 'out', color: NEUTRAL_HEAD, neutral: true, label: 'น้ำระบายออก\nต่อวัน', value: mcm2(dam.dam_released_mcm),
        unit: toNum(dam.dam_released_mcm) === null ? 'ไม่มีข้อมูล' : 'ล้าน ลบ.ม.' },
    ]
    scale = {
      kind: 'proportional', heading: 'อยู่ระดับไหนของเกณฑ์ (% ความจุที่ระดับเก็บกัก)', max: DAM_SCALE_MAX, value: damPct,
      zones: DAM_LEVELS.map((l, i) => ({ label: l.label, from: i === 0 ? 0 : DAM_LEVELS[i - 1].upTo, to: Math.min(l.upTo, DAM_SCALE_MAX), color: l.color })),
      markLabel: `${shortDamName(damName)} ${num1(damPct)}%`,
    }
  } else {
    const mm = toNum(top.rain_24h_mm)
    const where = stationPlace(top, homeAmphoe)
    headline = { sub: 'สถานการณ์ฝน', level: `ฝนหนักมาก ${formatMm(mm)} มม.`, name: `ฝนตกหนักมาก ${where || clean(top.station_name, 40)}` }
    ribbon = `ข้อมูลฝน ณ วันที่ ${posterDateLong(top.recorded_at)} · ${posterTime(top.recorded_at)} น.`
    const bits = [top.is_primary === true ? 'ในตำบล' : '', place(top)].filter(Boolean).join(' ')
    introBase = [
      { t: `สถานีวัดฝน${clean(top.station_name, 80)}${bits ? ` (${bits})` : ''} วัดฝนสะสม 24 ชม. ได้ ${formatMm(mm)} มม. อยู่ในเกณฑ์` },
      { t: 'ฝนตกหนักมาก', em: true },
      { t: 'ของกรมอุตุนิยมวิทยา' },
    ]
    const rain1h = toNum(top.rain_1h_mm)
    tiles = [
      { key: 'rain24', icon: 'rain', color: rainColor(mm), neutral: false, label: 'ฝนสะสม 24 ชม.\nสูงสุด', value: formatMm(mm), unit: `มม. ${clean(top.station_name, 40)}` },
      { key: 'rain1h', icon: 'rain', color: NEUTRAL_HEAD, neutral: true, label: 'ฝนชั่วโมง\nล่าสุด', value: rain1h === null ? '–' : formatMm(rain1h), unit: rain1h === null ? 'ไม่มีข้อมูล' : 'มม.' },
    ]
    if (dam) {
      tiles.push(
        { key: 'pct', icon: 'pct', color: damColor(damPct), neutral: false, label: `${shortDamName(damName)}\n% ความจุ`, value: num1(damPct), unit: '%' },
        { key: 'outflow', icon: 'out', color: NEUTRAL_HEAD, neutral: true, label: 'น้ำระบายออก\nต่อวัน', value: mcm2(dam.dam_released_mcm),
          unit: toNum(dam.dam_released_mcm) === null ? 'ไม่มีข้อมูล' : 'ล้าน ลบ.ม.' },
      )
    }
    const bounds = [0, 10, 35, 90, RAIN_SCALE_MAX]
    scale = {
      kind: 'equal', heading: 'อยู่ระดับไหนของเกณฑ์ฝน (มม. ใน 24 ชม.)', max: RAIN_SCALE_MAX, value: mm,
      zones: RAIN_LEVELS.slice(1).map((l, i) => ({ label: l.label, from: bounds[i], to: bounds[i + 1], color: l.bar })),
      markLabel: `${clean(top.station_name, 40)} ${formatMm(mm)} มม.`,
    }
  }

  // ข้อความ สสน. ระดับอำเภอ — เฉพาะที่ buildAlerts ผ่านแล้ว (ไม่เกิน 24 ชม.) แสดงตามต้นฉบับ ไม่เขียนใหม่
  const district = stripPrefix(homeAmphoe, /^(อำเภอ|อ\.)/)
  const official = alerts.warnings
  const districtWarning = official.length
    ? { none: false, label: `ข้อความเตือนจาก สสน.${district ? ` ใน อ.${district}` : ''}`, text: clean(official[0].message, 300), more: official.length - 1 }
    : { none: true, label: `ประกาศเตือนของ สสน.${district ? ` สำหรับ อ.${district}` : ''}`, text: 'ไม่มีในขณะนี้', more: 0 }

  // ข้อควรทำของภาพอ่าง/ฝน (ภาพสถานีเตือนภัย/น้ำเสมอตลิ่งกำหนดไว้ในบล็อกของตัวเองข้างบน)
  if (kind === 'dam' || kind === 'rain') todo = kind === 'dam'
    ? [
      [{ t: 'งดลงเล่นน้ำ จับปลา', b: true }, { t: ' ใกล้ทางระบายน้ำล้นและลำน้ำท้ายอ่าง' }],
      [{ t: `บ้านริม${riverPhrase(dam.river_name)} ` }, { t: 'ยกของขึ้นที่สูง', b: true }, { t: ' ติดตามระดับน้ำใกล้ชิด' }],
      [{ t: 'พบน้ำล้นตลิ่งหรือเหตุฉุกเฉิน ' }, { t: callOut(org), b: true }],
    ]
    : [
      [{ t: 'ระวัง' }, { t: 'น้ำป่าไหลหลาก ดินโคลนถล่ม', b: true }, { t: ' บริเวณเชิงเขาและริมลำห้วย' }],
      // ฝนหยุดแล้ว (ชั่วโมงล่าสุด 0 มม.) — "ขณะฝนตกหนัก" ไม่ตรงสถานการณ์ แต่น้ำป่ายังมาได้ จึงยังห้ามข้ามลำห้วย
      analysis.sentences.some(s => s.key === 'stopped')
        ? [{ t: 'งดเข้าป่า งดข้ามลำห้วย', b: true }, { t: ' แม้ฝนหยุดแล้ว' }]
        : [{ t: 'งดเข้าป่า งดข้ามลำห้วย', b: true }, { t: 'ขณะฝนตกหนัก' }],
      [{ t: 'พบน้ำท่วมฉับพลันหรือเหตุฉุกเฉิน ' }, { t: callOut(org), b: true }],
    ]

  // วันที่ต้นทางของค่าที่ใช้จริงในภาพ (อ่างรายวัน = วันที่ · ฝน/สถานะ/ระดับน้ำ = วันที่ + เวลา)
  const rainShown = rows.find(r => r.mm !== null) ? topRainRows.find(s => freshRainMm(s, now) !== null) : null
  const srcParts = []
  if (kind === 'ews') srcParts.push(`สถานะ ${posterDateShort(top.recorded_at)} ${posterTime(top.recorded_at)} น.`)
  if (kind === 'overbank') srcParts.push(`ค่าระดับน้ำ ${posterDateShort(top.recorded_at)} ${posterTime(top.recorded_at)} น.`)
  if (dam) srcParts.push(`ค่าอ่าง ${posterDateShort(dam.recorded_at)}`)
  const rainAt = kind === 'rain' ? top.recorded_at : rainShown?.recorded_at
  if (rainAt) srcParts.push(`ค่าฝน ${posterDateShort(rainAt)} ${posterTime(rainAt)} น.`)

  const province = stripPrefix(tenant?.province, /^(จังหวัด|จ\.)/)
  const locationText = [tenantName, district ? `อ.${district}` : '', province ? `จ.${province}` : ''].filter(Boolean).join(' ')
  const locality = orgNameParts(tenant ?? tenantName).locality

  // ข้อความแหล่งข้อมูล (บรรทัดแรก/ขึ้นต้นบรรทัดสอง) ของภาพอ่าง/ฝน · ข้อความสำหรับแชร์/alt = หัวเรื่อง + ชื่อ (ภาพสถานีเตือนภัยใส่ชนิดสถานีนำหน้า)
  sourceLead ??= 'แหล่งข้อมูล: คลังข้อมูลน้ำแห่งชาติ (ThaiWater) สสน. · เกณฑ์อ่าง สสน. และกรมชลประทาน · เกณฑ์ฝน กรมอุตุนิยมวิทยา'
  sourceLine ??= 'ข้อมูลจาก ThaiWater (สสน.)'
  const topicText = `${kind === 'ews' ? `${headline.sub} ` : ''}${headline.level} ${headline.name}`
  const sourceShort = sourceLine.replace(/\(สสน\.\)/, 'สสน.')

  return {
    kind,
    tenantName,
    orgCall: org,
    headline,
    ribbon,
    intro: withAnalysis(introBase, analysis.sentences),
    // ให้ตัววาดตัดประโยควิเคราะห์ท้ายสุดทิ้งทีละประโยคเมื่อเนื้อหาล้นภาพ (เรียงสำคัญมากไปน้อยแล้ว) — introFor(n) = ใช้ n ประโยคแรก
    introFor: n => withAnalysis(introBase, analysis.sentences.slice(0, Math.max(0, n))),
    analysis: analysis.sentences.map(s => s.key),
    tiles,
    scale,
    rain: {
      heading: 'ฝนสะสม 24 ชม. · สถานีวัดฝนใกล้พื้นที่',
      rows,
      chip: (() => {
        const best = rows.filter(r => r.mm !== null).sort((a, b) => b.mm - a.mm)[0]
        return best ? { label: best.levelLabel, color: best.color } : null
      })(),
      empty: rows.length === 0 ? 'ไม่มีข้อมูลสถานีวัดฝน ไม่ได้หมายความว่าฝนไม่ตก' : null,
      warning: districtWarning,
    },
    todo,
    nearbyDam: (() => {
      const near = pickNearbyDam(dams, now, dam)
      if (!near) return null
      const pct = toNum(near.storage_percent)
      return {
        code: near.station_code ?? null,
        name: shortDamName(clean(near.station_name, 80)),
        pct,
        pctText: num1(pct),
        color: damColor(pct),
        heading: near.is_primary === true ? 'อ่างในตำบล' : 'อ่างใกล้เคียง',
        sub: [stationPlace(near, homeAmphoe), distanceText(near.distance_km)].filter(Boolean).join(' · '),
      }
    })(),
    phones: buildPosterPhones(tenant, contacts),
    // บรรทัดรองของป้ายหน่วยงานมุมขวาบน — "มุ่งสู่" เมืองอัจฉริยะ (เจ้าของระบบสั่ง 2569-11-15 ข้อความเดียวกับภาพข่าว #713)
    // ⚠️ ยังไม่ได้รับรองเป็นเมืองอัจฉริยะ ห้ามเขียนว่า "เป็น"
    badge: { system: POSTER_BADGE_SYSTEM, tag: POSTER_BADGE_TAG },
    footer: {
      location: locationText,
      tags: ['#สถานการณ์น้ำ', locality ? `#${locality}` : ''].filter(Boolean).join(' '),
      lines: [
        `${sourceLead}${srcParts.length ? ` · ${srcParts.join(' · ')}` : ''}`,
        `${sourceLine} · ไม่ใช่ประกาศของ${tenantName} · ไม่มีข้อมูล ไม่ได้หมายความว่าสถานการณ์ปกติ · ดูค่าล่าสุดที่หน้า "สถานการณ์น้ำ–ฝน" ของ${tenantName}`,
      ],
    },
    illustration: illustration ?? { kind, rainy: kind === 'rain', pct: damPct },
    shareText: `แจ้งเตือนสถานการณ์น้ำ–ฝน ${tenantName}: ${topicText} (${sourceShort} ไม่ใช่ประกาศของ${tenantName})`,
    altText: `ภาพแจ้งเตือนสถานการณ์น้ำ–ฝน ${tenantName}: ${topicText} ${sourceLine} ไม่ใช่ประกาศของ${tenantName}`,
    fileName: `water-alert-${(() => { const p = bangkokParts(now instanceof Date ? now : Number(now)); return p ? `${p.y}${String(p.m + 1).padStart(2, '0')}${String(p.d).padStart(2, '0')}` : 'latest' })()}.png`,
  }
}

/* ───────── ภาพรายงานสถานการณ์ทุกสถานการณ์ (ไม่มีเรื่องเข้าเกณฑ์หัวภาพแจ้งเตือน) ───────── */
// เจ้าของระบบเลือก 2026-11-15 ("1ก 2 ทำ"): ปุ่มแชร์ขึ้นตลอด มีเรื่องเข้าเกณฑ์แจ้งเตือน = ภาพแจ้งเตือนเดิม (buildPosterModel)
// ไม่มี = ภาพสถานะ ตัดสินตามกฎ เรียงสำคัญมากไปน้อย: เฝ้าระวัง → น้ำน้อย → ข้อมูลไม่ครบ → ปกติ (selectStatus)
//   เฝ้าระวัง = ระดับน้ำต่ำกว่าตลิ่งไม่เกิน 1 ม. (กรมชลประทาน) · ฝนหนัก 35.1–90 มม./24 ชม. (กรมอุตุฯ) · ข้อความเตือนจาก สสน. ของอำเภอ
//   น้ำน้อย = อ่างที่ใช้ในภาพ (ในตำบลก่อน แล้วใกล้สุด ค่ายังสด) ≤ 50% · ≤ 30% = น้ำน้อยวิกฤติ (เกณฑ์ DAM_LEVELS ของกรมชลประทาน)
// ⚠️ ห้ามระบบเขียนคำว่าแล้งเชิงประกาศภัยในภาพนี้: การประกาศเขตภัยพิบัติกรณีภัยแล้งเป็นของจังหวัด/ปภ. ภาพอัตโนมัติจึงใช้ "น้ำน้อย"
//    ตามเกณฑ์กรมชลฯ (คำนั้นขึ้นได้ผ่านระบบประกาศที่มีเจ้าหน้าที่ยืนยัน #507 เท่านั้น) — เทสต์ตรวจว่าข้อความในภาพไม่มีคำนี้
// ⚠️ ข้อมูลไม่สด/ไม่ครบ = "ข้อมูลไม่ครบ" ห้ามขึ้น "ปกติ" — กรณีเดียวที่ภาพจะพูดผิดแบบอันตราย
// ⚠️ อ่าง 80–100% (น้ำมาก) ไม่ดันเป็นเฝ้าระวัง: หน้าฝนอ่างอยู่ช่วงนี้เป็นเดือน ภาพจะค้างเฝ้าระวังทั้งฤดู (เหตุผลเดียวกับ DAM_PUBLIC_ALERT_RANK)
// ไม่พยากรณ์ ไม่สั่งอพยพ ทุกประโยคคิดจากตัวเลขในภาพเดียวกัน และท้ายภาพมีบรรทัดเกณฑ์ให้คนอ่านตรวจย้อนได้

export const LOW_WATER_PCT = DAM_LEVELS.find(l => l.key === 'low').upTo // 50
export const LOW_WATER_CRITICAL_PCT = DAM_LEVELS.find(l => l.key === 'critical').upTo // 30
// บรรทัดเกณฑ์ท้ายภาพ (ให้ สตง./ประชาชนตรวจย้อนได้ว่าภาพตัดสินอย่างไร) — ต้องจบ 1 บรรทัด
export const STATUS_RULE_TEXT = `เกณฑ์ภาพ: เฝ้าระวัง = ฝน 35.1–90 มม./24 ชม. · น้ำต่ำกว่าตลิ่ง ≤${LEVEL_WATCH_M} ม. · มีข้อความเตือน สสน. │ น้ำน้อย = อ่าง ≤${LOW_WATER_PCT}% (≤${LOW_WATER_CRITICAL_PCT}% วิกฤติ) │ ค่าเก่า/ขาด = ข้อมูลไม่ครบ`

const STATUS_TEXT = {
  watch: { banner: 'เฝ้าระวัง', sticker: ['เฝ้าระวัง', 'ติดตามใกล้ชิด'] },
  low: { banner: 'น้ำน้อย', sticker: ['ใช้น้ำ', 'อย่างประหยัด'] },
  nodata: { banner: 'ข้อมูลไม่ครบ', sticker: ['ข้อมูลไม่ครบ', 'ยังสรุปไม่ได้'] },
  normal: { banner: 'ปกติ', sticker: ['ติดตามข้อมูล', 'น้ำ–ฝนทุกวัน'] },
}

const MISSING_TEXT = { rain: 'ฝน', 'rain-tambon': 'ฝนในตำบล', dam: 'อ่างเก็บน้ำ', level: 'ระดับน้ำในตำบล' }

const asRain = rain => (Array.isArray(rain) ? rain : []).filter(s => s && (s.station_type === 'rain' || s.station_type === undefined))
const freshLevel = (s, now) => isFreshAt(s?.recorded_at, now, STATION_STALE_HOURS) && toNum(s.bank_diff_m) !== null
const nowValue = now => (now instanceof Date ? now : Number(now))

// สถานีระดับน้ำที่ใช้เป็นค่าประกอบ: ค่ายังสด · ในตำบลก่อน แล้วใกล้สุด
export function pickContextLevel(levels, now) {
  return (Array.isArray(levels) ? levels : [])
    .filter(s => s && freshLevel(s, now))
    .sort((a, b) => Number(b.is_primary === true) - Number(a.is_primary === true) || byDistance(a, b))[0] ?? null
}

// ข้อมูลที่ขาดจนสรุป "ปกติ" ไม่ได้: ไม่มีค่าฝนสดเลย · สถานีฝนในตำบลไม่มีค่าสด · มีอ่างแต่ค่าเก่าหมด · สถานีระดับน้ำในตำบลไม่มีค่าสด
function missingData({ rain, levels, dams, dam, now }) {
  const out = []
  const rainList = asRain(rain)
  const primaryRain = rainList.filter(s => s.is_primary === true)
  if (!rainList.some(s => freshRainMm(s, now) !== null)) out.push('rain')
  else if (primaryRain.length && !primaryRain.some(s => freshRainMm(s, now) !== null)) out.push('rain-tambon')
  if ((Array.isArray(dams) ? dams : []).some(Boolean) && !dam) out.push('dam')
  const primaryLevel = (Array.isArray(levels) ? levels : []).filter(s => s?.is_primary === true)
  if (primaryLevel.length && !primaryLevel.some(s => freshLevel(s, now))) out.push('level')
  return out
}

/**
 * ตัดสินสถานะของภาพ — คืน { state: 'alert' } เมื่อมีเรื่องเข้าเกณฑ์หัวภาพแจ้งเตือน (ใช้ buildPosterModel แทน)
 * นอกนั้น { state: 'watch'|'low'|'nodata'|'normal', reason, station, missing, alerts }
 */
export function selectStatus({ rain = [], ews = [], levels = [], dams = [], warnings = [], now }) {
  const alerts = buildAlerts({ rain, ews, levels, dams, warnings, now })
  if (posterTopicCandidates(alerts).length) return { state: 'alert', alerts }
  const levelWatch = (Array.isArray(levels) ? levels : [])
    .filter(s => s && freshLevel(s, now) && levelRank(s.bank_diff_m) === 1)
    .sort((a, b) => toNum(a.bank_diff_m) - toNum(b.bank_diff_m))
  if (levelWatch.length) return { state: 'watch', reason: 'level', station: levelWatch[0], alerts }
  const rainWatch = asRain(rain)
    .filter(s => rainLevel(freshRainMm(s, now))?.key === 'heavy')
    .sort((a, b) => freshRainMm(b, now) - freshRainMm(a, now))
  if (rainWatch.length) return { state: 'watch', reason: 'rain', station: rainWatch[0], alerts }
  if (alerts.warnings.length) return { state: 'watch', reason: 'warning', station: null, alerts }
  const dam = pickContextDam(dams, now)
  const pct = dam ? toNum(dam.storage_percent) : null
  if (pct !== null && pct <= LOW_WATER_PCT) return { state: 'low', reason: pct <= LOW_WATER_CRITICAL_PCT ? 'critical' : 'low', station: dam, alerts }
  const missing = missingData({ rain, levels, dams, dam, now })
  if (missing.length) return { state: 'nodata', reason: 'missing', station: null, missing, alerts }
  return { state: 'normal', reason: 'none', station: null, alerts }
}

const damScaleOf = (damName, damPct) => ({
  kind: 'proportional', heading: 'อยู่ระดับไหนของเกณฑ์ (% ความจุที่ระดับเก็บกัก)', max: DAM_SCALE_MAX, value: damPct,
  zones: DAM_LEVELS.map((l, i) => ({ label: l.label, from: i === 0 ? 0 : DAM_LEVELS[i - 1].upTo, to: Math.min(l.upTo, DAM_SCALE_MAX), color: l.color })),
  markLabel: `${shortDamName(damName)} ${num1(damPct)}%`,
})

const RAIN_BOUNDS = [0, 10, 35, 90, RAIN_SCALE_MAX]
const rainScaleOf = (mm, name) => ({
  kind: 'equal', heading: 'อยู่ระดับไหนของเกณฑ์ฝน (มม. ใน 24 ชม.)', max: RAIN_SCALE_MAX, value: mm,
  zones: RAIN_LEVELS.slice(1).map((l, i) => ({ label: l.label, from: RAIN_BOUNDS[i], to: RAIN_BOUNDS[i + 1], color: l.bar })),
  markLabel: `${cut(name, 30)} ${formatMm(mm)} มม.`,
})

const bankScaleOf = (diff, name) => ({
  kind: 'proportional', heading: 'ระดับน้ำเทียบตลิ่ง (เกณฑ์กรมชลประทาน)', min: BANK_SCALE_MIN, max: BANK_SCALE_MAX, value: 0 - diff,
  activeIndex: levelRank(diff) ?? 0,
  zones: [
    { label: LEVEL_TIERS[0].label, from: BANK_SCALE_MIN, to: -1, color: TIER_COLORS[0] },
    { label: LEVEL_TIERS[1].label, from: -1, to: 0, color: TIER_COLORS[1], tickLabel: '−1 ม.' },
    { label: LEVEL_TIERS[2].label, from: 0, to: BANK_SCALE_MAX, color: TIER_COLORS[2], tickLabel: 'ตลิ่ง' },
  ],
  markLabel: `${cut(name, 24)} −${diff.toFixed(2)} ม.`,
})

/**
 * ประกอบข้อมูลภาพสถานะ — คืน null เมื่อมีเรื่องเข้าเกณฑ์แจ้งเตือน (ให้ใช้ buildPosterModel)
 * รูปแบบผลลัพธ์เดียวกับ buildPosterModel (ตัววาดเดียวกัน) + theme/banner/sticker ของสถานะ
 */
export function buildStatusPosterModel({ rain = [], ews = [], levels = [], dams = [], warnings = [], tenant = null, now, contacts = [] }) {
  const st = selectStatus({ rain, ews, levels, dams, warnings, now })
  if (st.state === 'alert') return null
  const text = STATUS_TEXT[st.state]
  const homeAmphoe = tenant?.district
  const district = stripPrefix(homeAmphoe, /^(อำเภอ|อ\.)/)
  const tenantName = clean(tenant?.name, 80) || 'หน่วยงาน'
  const org = orgCallName(tenant)
  const top = st.station
  const isRainWatch = st.state === 'watch' && st.reason === 'rain'
  const isLevelWatch = st.state === 'watch' && st.reason === 'level'
  const topRainRows = pickRainRows(rain, now, isRainWatch ? top : null)
  const rows = topRainRows.map(s => rainRow(s, now, homeAmphoe))
  const bestRain = rows.filter(r => r.mm !== null).sort((a, b) => b.mm - a.mm)[0] ?? null
  const dam = st.state === 'low' ? top : pickContextDam(dams, now)
  const damPct = dam ? toNum(dam.storage_percent) : null
  const damName = dam ? clean(dam.station_name, 80) : ''
  const damLv = damPct === null ? null : damLevel(damPct)
  const level = isLevelWatch ? top : pickContextLevel(levels, now)
  const levelDiff = level ? toNum(level.bank_diff_m) : null
  const levelName = level ? clean(level.station_name, 80) : ''
  const levelRiver = level ? clean(level.river_name, 60) : ''
  const place = s => [stationPlace(s, homeAmphoe), distanceText(s.distance_km)].filter(Boolean).join(' ')
  const bitsOf = s => [s.is_primary === true ? 'ในตำบล' : '', place(s)].filter(Boolean).join(' ')

  // ช่องตัวเลขที่ใช้ซ้ำ
  const tRain24 = r => ({ key: 'rain24', icon: 'rain', color: r ? (r.color ?? RAIN_LEVELS[0].bar) : NEUTRAL_HEAD, neutral: !r, label: 'ฝนสะสม 24 ชม.\nสูงสุด',
    value: r ? r.mmText : '–', unit: r ? `มม. ${r.levelLabel ?? ''}`.trim() : 'ไม่มีข้อมูล' })
  const tPct = () => ({ key: 'pct', icon: 'pct', color: damColor(damPct), neutral: false, label: `${shortDamName(damName)}\n% ความจุ`, value: num1(damPct), unit: `% ${damLv?.label ?? ''}`.trim() })
  const tVolume = () => {
    const storage = toNum(dam.dam_storage_mcm)
    const cap = toNum(dam.dam_capacity_mcm)
    return { key: 'volume', icon: 'vol', color: damColor(damPct), neutral: false, label: 'ปริมาณน้ำ\nในอ่าง', value: mcm2(storage),
      unit: storage === null ? 'ไม่มีข้อมูล' : cap !== null ? `จาก ${mcm2(cap)} ล้าน ลบ.ม.` : 'ล้าน ลบ.ม.' }
  }
  const tFlow = (key, field, label, icon) => ({ key, icon, color: NEUTRAL_HEAD, neutral: true, label, value: mcm2(dam[field]),
    unit: toNum(dam[field]) === null ? 'ไม่มีข้อมูล' : 'ล้าน ลบ.ม.' })
  const tBank = () => ({ key: 'bank', icon: 'bank', color: TIER_COLORS[levelRank(levelDiff) ?? 0], neutral: false, label: 'ระดับน้ำ\nเทียบตลิ่ง',
    value: `−${levelDiff.toFixed(2)}`, unit: 'ม. ต่ำกว่าตลิ่ง' })

  // ประโยคข้อเท็จจริงที่ใช้ซ้ำ (คิดจากตัวเลขในภาพ)
  const sRain = () => {
    if (!bestRain) return null
    return bestRain.mm < RAIN_LEVELS[0].below
      ? { key: 'no-rain', runs: [{ t: 'สถานีวัดฝนใกล้พื้นที่ ' }, { t: 'ไม่มีฝนวัดได้ใน 24 ชม.', em: true }] }
      : { key: 'rain', runs: [{ t: `ฝนสะสม 24 ชม. สูงสุด ${bestRain.mmText} มม. (${bestRain.name}) ` }, { t: bestRain.levelLabel ?? '', em: true }] }
  }
  const sDam = () => (dam && damPct !== null
    ? { key: 'dam', runs: [{ t: `${shortDamName(damName)}มีน้ำ ${num1(damPct)}% ` }, { t: damLv?.label ?? '', em: true }] }
    : null)
  const sLevel = () => (level && levelDiff !== null
    ? { key: 'level', runs: [{ t: `ระดับน้ำ${levelRiver ? riverPhrase(levelRiver) : levelName}` }, { t: `ต่ำกว่าตลิ่ง ${levelDiff.toFixed(2)} ม.`, em: true }] }
    : null)
  const sDamTrend = () => {
    const inflow = toNum(dam?.dam_inflow_mcm)
    const outflow = toNum(dam?.dam_released_mcm)
    if (inflow === null || outflow === null) return null
    const diff = round2(round2(inflow) - round2(outflow))
    if (Math.abs(diff) < DAM_TREND_FLAT_MCM) return { key: 'trend-flat', runs: [{ t: 'น้ำไหลลงอ่างเท่ากับที่ระบายออก ปริมาณน้ำ' }, { t: 'ทรงตัว', em: true }] }
    return diff > 0
      ? { key: 'trend-up', runs: [{ t: `น้ำไหลลงอ่างมากกว่าที่ระบายออกวันละ ${diff.toFixed(2)} ล้าน ลบ.ม. น้ำในอ่าง` }, { t: 'เพิ่มขึ้น', em: true }] }
      : { key: 'trend-down', runs: [{ t: `น้ำระบายออกมากกว่าที่ไหลลงอ่างวันละ ${(-diff).toFixed(2)} ล้าน ลบ.ม. น้ำในอ่าง` }, { t: 'ลดลง', em: true }] }
  }

  let headline, introBase, sentences, tiles, scale, todo, illustration
  if (isRainWatch) {
    const mm = freshRainMm(top, now)
    const where = stationPlace(top, homeAmphoe)
    const name = clean(top.station_name, 80)
    const bits = bitsOf(top)
    headline = { sub: 'สถานการณ์ฝน', level: `ฝนหนัก ${formatMm(mm)} มม.`, name: `ฝนตกหนัก ${where || clean(top.station_name, 40)}` }
    introBase = [
      { t: `สถานีวัดฝน${name}${bits ? ` (${bits})` : ''} วัดฝนสะสม 24 ชม. ได้ ${formatMm(mm)} มม. อยู่ในเกณฑ์` },
      { t: 'ฝนตกหนัก', em: true },
      { t: 'ของกรมอุตุนิยมวิทยา (ยังไม่ถึงฝนหนักมาก 90.1 มม.)' },
    ]
    const rain1h = toNum(top.rain_1h_mm)
    sentences = [
      rain1h === null ? null : isRaining(rain1h)
        ? { key: 'still-raining', runs: [{ t: `ชั่วโมงล่าสุดยังวัดฝนได้ ${formatMm(rain1h)} มม. ` }, { t: 'ฝนยังตกอยู่', em: true }] }
        : { key: 'stopped', runs: [{ t: 'ชั่วโมงล่าสุด' }, { t: 'ฝนหยุดแล้ว', em: true }] },
      sDam(),
    ].filter(Boolean)
    tiles = [
      { key: 'rain24', icon: 'rain', color: rainColor(mm), neutral: false, label: 'ฝนสะสม 24 ชม.\nสูงสุด', value: formatMm(mm), unit: `มม. ${clean(top.station_name, 40)}` },
      { key: 'rain1h', icon: 'rain', color: NEUTRAL_HEAD, neutral: true, label: 'ฝนชั่วโมง\nล่าสุด', value: rain1h === null ? '–' : formatMm(rain1h), unit: rain1h === null ? 'ไม่มีข้อมูล' : 'มม.' },
    ]
    if (dam) tiles.push(tPct(), tFlow('outflow', 'dam_released_mcm', 'น้ำระบายออก\nต่อวัน', 'out'))
    scale = rainScaleOf(mm, clean(top.station_name, 40))
    todo = [
      [{ t: 'ติดตามสถานการณ์ใกล้ชิด', b: true }, { t: ' ฟังประกาศผู้นำชุมชน หอกระจายข่าว' }],
      [{ t: 'ระวังน้ำป่าไหลหลาก', b: true }, { t: ' บริเวณเชิงเขาและริมลำห้วย งดข้ามลำห้วยขณะน้ำขึ้น' }],
      [{ t: 'พบเหตุฉุกเฉิน ' }, { t: callOut(org), b: true }],
    ]
    illustration = { kind: 'rain', rainy: true, pct: damPct }
  } else if (isLevelWatch) {
    const bits = [levelRiver, bitsOf(top)].filter(Boolean).join(' · ')
    headline = {
      sub: 'สถานการณ์น้ำในลำน้ำ', level: `ต่ำกว่าตลิ่ง ${levelDiff.toFixed(2)} ม.`,
      name: levelRiver ? `${levelRiver} ${/^สถานี/.test(levelName) ? '' : 'สถานี'}${levelName}` : levelName,
    }
    introBase = [
      { t: `สถานีวัดระดับน้ำ${levelName.replace(/^สถานี/, '')}${bits ? ` (${bits})` : ''} ระดับน้ำต่ำกว่าตลิ่ง ${levelDiff.toFixed(2)} ม. อยู่ในเกณฑ์` },
      { t: 'เฝ้าระวัง', em: true },
      { t: `ของกรมชลประทาน (ต่ำกว่าตลิ่งไม่เกิน ${LEVEL_WATCH_M} ม.)` },
    ]
    const trend = waterTrend(top.waterlevel_msl, top.prev_waterlevel_msl)
    const since = top.prev_recorded_at ? ` เทียบกับ ${sinceText(top.prev_recorded_at, top.recorded_at)}` : ' เทียบกับค่าก่อนหน้า'
    sentences = [
      trend ? { key: 'trend', runs: trend.dir === 'flat'
        ? [{ t: 'ระดับน้ำ' }, { t: 'ทรงตัว', em: true }, { t: since }]
        : [{ t: 'ระดับน้ำ' }, { t: `${trend.dir === 'up' ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(trend.diff).toFixed(2)} ม.`, em: true }, { t: since }] } : null,
      sRain(),
    ].filter(Boolean)
    const msl = toNum(top.waterlevel_msl)
    tiles = [
      tBank(),
      { key: 'level', icon: 'level', color: NEUTRAL_HEAD, neutral: true, label: 'ระดับน้ำ', value: msl === null ? '–' : msl.toFixed(2), unit: msl === null ? 'ไม่มีข้อมูล' : 'ม.รทก.' },
      { key: 'trend', icon: 'trend', color: NEUTRAL_HEAD, neutral: true, label: 'แนวโน้ม',
        value: !trend ? '–' : trend.dir === 'up' ? 'ขึ้น' : trend.dir === 'down' ? 'ลง' : 'ทรงตัว',
        unit: !trend ? 'ไม่มีข้อมูลก่อนหน้า' : trend.dir === 'flat' ? `ต่างไม่ถึง ${TREND_FLAT_M} ม.` : `${Math.abs(trend.diff).toFixed(2)} ม.` },
      tRain24(bestRain),
    ]
    scale = bankScaleOf(levelDiff, levelName)
    todo = [
      [{ t: 'ติดตามระดับน้ำใกล้ชิด', b: true }, { t: ' ฟังประกาศผู้นำชุมชน หอกระจายข่าว' }],
      [{ t: 'บ้านริมน้ำเตรียมยกของขึ้นที่สูง', b: true }, { t: ' หากระดับน้ำยังเพิ่มขึ้น' }],
      [{ t: 'พบน้ำล้นตลิ่งหรือเหตุฉุกเฉิน ' }, { t: callOut(org), b: true }],
    ]
    illustration = { kind: 'overbank', bankDiff: levelDiff, rainy: Boolean(bestRain && bestRain.mm > RAIN_LEVELS[2].upTo), bankText: `−${levelDiff.toFixed(2)} ม.` }
  } else if (st.state === 'watch') {
    // ข้อความเตือนจาก สสน. อย่างเดียว (ตัวเลขในพื้นที่ยังไม่ถึงเกณฑ์) — ข้อความต้นฉบับอยู่ในแผงฝนด้านล่างแล้ว ไม่เขียนใหม่
    headline = { sub: 'ประกาศเตือนจาก สสน.', level: 'มีข้อความเตือนสำหรับอำเภอ', name: district ? `อำเภอ${district}` : `พื้นที่${tenantName}` }
    introBase = [
      { t: `สสน. มีข้อความเตือนสำหรับ${district ? ` อ.${district}` : 'พื้นที่'} (ดูข้อความต้นฉบับด้านล่าง) ส่วนค่าที่สถานีวัดใกล้พื้นที่` },
      { t: 'ยังไม่ถึงเกณฑ์เฝ้าระวัง', em: true },
    ]
    sentences = [sRain(), sDam(), sLevel()].filter(Boolean)
    tiles = [tRain24(bestRain)]
    if (dam) tiles.push(tPct(), tVolume())
    if (level) tiles.push(tBank())
    scale = dam ? damScaleOf(damName, damPct) : rainScaleOf(bestRain?.mm ?? 0, bestRain?.name ?? 'ฝนสูงสุด')
    todo = [
      [{ t: 'ติดตามประกาศ', b: true }, { t: ' ของ สสน. ผู้นำชุมชน และหอกระจายข่าว' }],
      [{ t: 'ฝนตกหนักต่อเนื่อง', b: true }, { t: ' ระวังน้ำป่าไหลหลากบริเวณเชิงเขาและริมลำห้วย' }],
      [{ t: 'พบเหตุฉุกเฉิน ' }, { t: callOut(org), b: true }],
    ]
    illustration = { kind: dam ? 'dam' : 'rain', rainy: true, pct: damPct }
  } else if (st.state === 'low') {
    const bits = bitsOf(dam)
    const critical = st.reason === 'critical'
    headline = { sub: 'สถานการณ์น้ำในอ่าง', level: `${damLv.label} ${num1(damPct)}%`, name: damName }
    introBase = [
      { t: `${damName}${bits ? ` (${bits})` : ''} มีน้ำ ${num1(damPct)}% ของความจุที่ระดับเก็บกัก อยู่ในเกณฑ์` },
      { t: damLv.label, em: true },
      { t: `ของกรมชลประทาน (${critical ? `ไม่เกิน ${LOW_WATER_CRITICAL_PCT}%` : `${LOW_WATER_CRITICAL_PCT}–${LOW_WATER_PCT}%`})` },
    ]
    const noRain = sRain()
    sentences = [sDamTrend(), noRain?.key === 'no-rain' ? noRain : null].filter(Boolean)
    tiles = [
      { ...tPct(), label: 'ความจุ\nที่ระดับเก็บกัก', unit: '%' },
      tVolume(),
      tFlow('inflow', 'dam_inflow_mcm', 'น้ำไหลลงอ่าง\nต่อวัน', 'inn'),
      tFlow('outflow', 'dam_released_mcm', 'น้ำระบายออก\nต่อวัน', 'out'),
    ]
    scale = damScaleOf(damName, damPct)
    todo = [
      [{ t: 'ใช้น้ำอย่างประหยัด', b: true }, { t: ' กักเก็บน้ำสำรองไว้ใช้ในครัวเรือน' }],
      [{ t: 'วางแผนการเพาะปลูก', b: true }, { t: 'ให้เหมาะกับปริมาณน้ำ ติดตามประกาศของทางราชการ' }],
      [{ t: 'ขาดแคลนน้ำดื่มน้ำใช้ ' }, { t: callOut(org), b: true }],
    ]
    illustration = { kind: 'dam', rainy: false, pct: damPct, sky: 'dry', sign: true }
  } else {
    const isNormal = st.state === 'normal'
    headline = isNormal
      ? { sub: 'สถานการณ์น้ำ–ฝนวันนี้', level: 'ไม่มีเรื่องเข้าเกณฑ์เฝ้าระวัง', name: `พื้นที่${tenantName}` }
      : { sub: 'สถานการณ์น้ำ–ฝน', level: 'ยังสรุปสถานการณ์ไม่ได้', name: `พื้นที่${tenantName}` }
    const missing = (st.missing ?? []).map(k => MISSING_TEXT[k]).filter(Boolean).join(' · ')
    introBase = isNormal
      ? [{ t: 'ค่าล่าสุดจากสถานีวัดใกล้พื้นที่ ' }, { t: 'ยังไม่ถึงเกณฑ์เฝ้าระวัง', em: true }, { t: ' ของกรมอุตุนิยมวิทยาและกรมชลประทาน' }]
      : [{ t: `สถานีวัดบางแห่งไม่มีค่าใหม่ (${missing}) ระบบจึง` }, { t: 'ไม่สรุปว่าสถานการณ์ปกติ', em: true }, { t: ' ดูค่าล่าสุดอีกครั้งก่อนเชื่อภาพนี้' }]
    sentences = [sRain(), sDam(), sLevel()].filter(Boolean)
    tiles = [tRain24(bestRain)]
    if (dam) tiles.push(tPct(), tVolume())
    if (level) tiles.push(tBank())
    else if (dam) tiles.push(tFlow('outflow', 'dam_released_mcm', 'น้ำระบายออก\nต่อวัน', 'out'))
    scale = dam ? damScaleOf(damName, damPct) : rainScaleOf(bestRain?.mm ?? 0, bestRain?.name ?? 'ฝนสูงสุด')
    todo = isNormal
      ? [
        [{ t: 'ติดตามข้อมูลน้ำ–ฝนได้ทุกวัน', b: true }, { t: ` ที่หน้า "สถานการณ์น้ำ–ฝน" ของ${org}` }],
        [{ t: 'ใช้น้ำอย่างรู้คุณค่า', b: true }, { t: ' ช่วยกันดูแลแหล่งน้ำ ไม่ทิ้งขยะลงลำน้ำ' }],
        [{ t: 'พบเหตุฉุกเฉินหรือน้ำผิดปกติ ' }, { t: callOut(org), b: true }],
      ]
      : [
        [{ t: 'ดูค่าล่าสุดอีกครั้ง', b: true }, { t: ` ที่หน้า "สถานการณ์น้ำ–ฝน" ของ${org}` }],
        [{ t: 'ฝนตกหนักหรือน้ำขึ้นเร็ว ' }, { t: 'อย่ารอข้อมูลจากระบบ', b: true }, { t: ' ฟังประกาศผู้นำชุมชน' }],
        [{ t: 'พบเหตุฉุกเฉิน ' }, { t: callOut(org), b: true }],
      ]
    illustration = { kind: dam ? 'dam' : 'rain', rainy: false, pct: damPct, sky: isNormal ? 'day' : 'overcast', sign: false }
  }

  const official = st.alerts.warnings
  const districtWarning = official.length
    ? { none: false, label: `ข้อความเตือนจาก สสน.${district ? ` ใน อ.${district}` : ''}`, text: clean(official[0].message, 300), more: official.length - 1 }
    : { none: true, label: `ประกาศเตือนของ สสน.${district ? ` สำหรับ อ.${district}` : ''}`, text: 'ไม่มีในขณะนี้', more: 0 }

  const rainShown = rows.find(r => r.mm !== null) ? topRainRows.find(s => freshRainMm(s, now) !== null) : null
  const srcParts = []
  if (level && tiles.some(t => t.key === 'bank')) srcParts.push(`ค่าระดับน้ำ ${posterDateShort(level.recorded_at)} ${posterTime(level.recorded_at)} น.`)
  if (dam) srcParts.push(`ค่าอ่าง ${posterDateShort(dam.recorded_at)}`)
  const rainAt = isRainWatch ? top.recorded_at : rainShown?.recorded_at
  if (rainAt) srcParts.push(`ค่าฝน ${posterDateShort(rainAt)} ${posterTime(rainAt)} น.`)

  const province = stripPrefix(tenant?.province, /^(จังหวัด|จ\.)/)
  const locationText = [tenantName, district ? `อ.${district}` : '', province ? `จ.${province}` : ''].filter(Boolean).join(' ')
  const locality = orgNameParts(tenant ?? tenantName).locality
  const sourceLead = 'แหล่งข้อมูล: ThaiWater (สสน.) · เกณฑ์ฝน กรมอุตุนิยมวิทยา · เกณฑ์อ่าง/ระดับน้ำ กรมชลประทาน'
  const sourceLine = 'ข้อมูลจาก ThaiWater (สสน.)'
  const sourceShort = sourceLine.replace(/\(สสน\.\)/, 'สสน.')
  const at = nowValue(now)
  const p = bangkokParts(at)
  const topicText = `${text.banner} — ${headline.level}${headline.name ? ` ${headline.name}` : ''}`

  return {
    kind: 'status',
    state: st.state,
    reason: st.reason,
    theme: st.state,
    banner: text.banner,
    sticker: text.sticker,
    tenantName,
    orgCall: org,
    headline,
    ribbon: `รายงาน ณ วันที่ ${posterDateLong(at)} · ${posterTime(at)} น.`,
    intro: withAnalysis(introBase, sentences),
    introFor: n => withAnalysis(introBase, sentences.slice(0, Math.max(0, n))),
    analysis: sentences.map(s => s.key),
    tiles,
    scale,
    rain: {
      heading: 'ฝนสะสม 24 ชม. · สถานีวัดฝนใกล้พื้นที่',
      rows,
      chip: bestRain ? { label: bestRain.levelLabel, color: bestRain.color } : null,
      empty: rows.length === 0 ? 'ไม่มีข้อมูลสถานีวัดฝน ไม่ได้หมายความว่าฝนไม่ตก' : null,
      warning: districtWarning,
    },
    todo,
    nearbyDam: (() => {
      const near = pickNearbyDam(dams, now, dam)
      if (!near) return null
      const pct = toNum(near.storage_percent)
      return {
        code: near.station_code ?? null, name: shortDamName(clean(near.station_name, 80)), pct, pctText: num1(pct), color: damColor(pct),
        heading: near.is_primary === true ? 'อ่างในตำบล' : 'อ่างใกล้เคียง',
        sub: [stationPlace(near, homeAmphoe), distanceText(near.distance_km)].filter(Boolean).join(' · '),
      }
    })(),
    phones: buildPosterPhones(tenant, contacts),
    badge: { system: POSTER_BADGE_SYSTEM, tag: POSTER_BADGE_TAG },
    footer: {
      location: locationText,
      tags: ['#สถานการณ์น้ำ', locality ? `#${locality}` : ''].filter(Boolean).join(' '),
      lines: [
        `${sourceLead}${srcParts.length ? ` · ${srcParts.join(' · ')}` : ''}`,
        STATUS_RULE_TEXT,
        `ไม่ใช่ประกาศของ${tenantName} · ไม่มีข้อมูล ไม่ได้หมายความว่าสถานการณ์ปกติ · ดูค่าล่าสุดที่หน้า "สถานการณ์น้ำ–ฝน"`,
      ],
    },
    illustration,
    shareText: `สถานการณ์น้ำ–ฝน ${tenantName}: ${topicText} (${sourceShort} ไม่ใช่ประกาศของ${tenantName})`,
    altText: `ภาพรายงานสถานการณ์น้ำ–ฝน ${tenantName}: ${topicText} ${sourceLine} ไม่ใช่ประกาศของ${tenantName}`,
    fileName: `water-status-${p ? `${p.y}${String(p.m + 1).padStart(2, '0')}${String(p.d).padStart(2, '0')}` : 'latest'}.png`,
  }
}

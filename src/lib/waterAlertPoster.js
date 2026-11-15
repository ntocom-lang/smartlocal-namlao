// ภาพแชร์แจ้งเตือนน้ำ-ฝน 1 ภาพ (1080×1350 PNG สำหรับแชร์ FB/LINE) — ส่วน "ตัดสินใจ + ประกอบข้อมูล" ล้วน ไม่มี DOM
// ทดสอบใน node (tests/water-alert-poster.test.mjs) · ส่วนวาดลง canvas อยู่ที่ waterAlertPosterImage.js
//
// ⚠️ ไฟล์นี้ไม่ตัดสินสถานการณ์เอง: เกณฑ์ทุกอย่างมาจาก buildAlerts() ของ waterSituation.js (ชุดเดียวกับแถบบนหน้าแรก
//    หน้า /water-situation และ Telegram) — ห้ามเขียนเกณฑ์ "เก่าเกินไป" ซ้ำคนละค่าที่นี่ (ค่าเก่าถูก buildAlerts กรองให้แล้ว)
//    ส่วนค่าประกอบที่ไม่ใช่เหตุเตือน (อ่างในช่องตัวเลขตอนหัวภาพเป็นฝน) ใช้ค่าคงที่ DAM_STALE_HOURS ตัวเดียวกัน
// ⚠️ ห้ามแต่งตัวเลข/เบอร์โทร: ทุกค่ามาจากแถวสถานี (RPC get_public_water_situation) หรือสมุดสายด่วนของ อปท. เท่านั้น
//    ไม่มีเบอร์ = ช่องนั้นหาย (ไม่มีเบอร์สำรอง/เบอร์กลาง) · PDPA: มีแต่ชื่อสถานี ตัวเลข เวลา — ไม่มีข้อมูลบุคคล

import {
  DAM_LEVELS, DAM_STALE_HOURS, DAM_TREND_FLAT_MCM, RAIN_LEVELS, STATION_STALE_HOURS,
  bankText, buildAlerts, damLevel, distanceText, formatMm, isStale, measuredAtText, rainLevel, stationPlace, toNum,
} from './waterSituation.js'
import { orgNameParts } from './orgTerms.js'

export const POSTER_WIDTH = 1080
export const POSTER_HEIGHT = 1350

// สีหัวช่องของ "ค่าประกอบ" (ไหลเข้า/ระบายออก/ฝนชั่วโมงล่าสุด) — เทาเข้ม ไม่ใช่สีระดับเตือน
export const NEUTRAL_HEAD = '#3d3236'
export const DAM_SCALE_MAX = 120
export const RAIN_SCALE_MAX = 150

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
 * เลือกเรื่องของหัวภาพจากผล buildAlerts — อ่างเกินความจุเก็บกัก (damOver) มาก่อน แล้วฝนหนักมาก (heavyRain)
 * ไม่มีทั้งคู่ = null (ไม่มีภาพ ไม่มีปุ่ม) · อ่าง 80–100% ไม่ขึ้นหัวภาพ (buildAlerts ไม่ใส่ใน damOver)
 */
export function selectPosterTopic(alerts) {
  const dam = alerts?.damOver?.[0]
  if (dam) return { kind: 'dam', station: dam }
  const rain = alerts?.heavyRain?.[0]
  if (rain) return { kind: 'rain', station: rain }
  return null
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

/**
 * ประโยควิเคราะห์สถานการณ์ที่ต่อท้ายย่อหน้าเปิด — กฎตรงไปตรงมา ไม่ใช่ AI (เจ้าของระบบเลือก 2026-11-15)
 * กติกา: ทุกประโยคคิดจากตัวเลขที่ "อยู่ในภาพเดียวกัน" (ช่องตัวเลข/แถวฝน) คนอ่านคำนวณซ้ำได้เอง
 *   · ไม่พยากรณ์ล่วงหน้า (ไม่มี "จะล้นใน N ชม.") · ไม่สั่งอพยพ (อำนาจของ อปท. ไม่ใช่ภาพอัตโนมัติ)
 *   · ค่าที่ใช้ขาด = ประโยคนั้นไม่ขึ้น (ไม่เดา) · ไม่มีอุปมา เช่น "เท่าสระว่ายน้ำ" (เจ้าของระบบ: ไม่เป็นทางการ)
 * คืน { excess, sentences: [{ key, runs }] } — excess = ปริมาตรเกินระดับเก็บกัก (ล้าน ลบ.ม.) ที่ต่อท้ายคำว่า "เกินความจุ…"
 */
export function buildSituationAnalysis({ kind, top, dam, damPct, rows, heavyRain = [], rain = [], now }) {
  const sentences = []
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
  const topic = selectPosterTopic(alerts)
  if (!topic) return null

  const homeAmphoe = tenant?.district
  const tenantName = clean(tenant?.name, 80) || 'หน่วยงาน'
  const org = orgCallName(tenant)
  const kind = topic.kind
  const top = topic.station
  const topRainRows = pickRainRows(rain, now, kind === 'rain' ? top : null)
  const rows = topRainRows.map(s => rainRow(s, now, homeAmphoe))

  // อ่างที่ใช้ในช่องตัวเลข/ภาพประกอบ: หัวภาพเป็นอ่าง = อ่างนั้น · หัวภาพเป็นฝน = อ่างที่ค่ายังสด (ถ้ามี)
  const dam = kind === 'dam' ? top : pickContextDam(dams, now)
  const damPct = dam ? toNum(dam.storage_percent) : null
  const damName = dam ? clean(dam.station_name, 80) : ''
  const place = s => [stationPlace(s, homeAmphoe), distanceText(s.distance_km)].filter(Boolean).join(' ')
  const analysis = buildSituationAnalysis({ kind, top, dam, damPct, rows, heavyRain: alerts.heavyRain, rain, now })

  let headline, ribbon, introBase, tiles, scale
  if (kind === 'dam') {
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

  // เรื่องที่แรงกว่าหัวภาพ (น้ำเสมอ/สูงกว่าตลิ่ง · สถานีเตือนภัยระดับเตรียมพร้อมขึ้นไป) — ห้ามให้ภาพ "อ่างล้น" ดูเหมือนเรื่องเดียวที่ต้องระวัง
  const others = []
  if (alerts.overbank.length) {
    const s = alerts.overbank[0]
    others.push(`ระดับน้ำเสมอหรือสูงกว่าตลิ่ง สถานี${clean(s.station_name, 60)} ${bankText(s.bank_diff_m) ?? ''}`.trim())
  }
  if (alerts.ews.length) {
    const { station, alert } = alerts.ews[0]
    others.push(`สถานีเตือนภัยน้ำหลาก-ดินถล่ม ${clean(station.station_name, 60)} · ${clean(alert.text, 40)}`)
  }
  const otherNote = others.length ? `มีเรื่องอื่นที่ต้องระวังกว่า: ${others.join(' · ')}` : null

  const todo = kind === 'dam'
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

  // วันที่ต้นทางของค่าที่ใช้จริงในภาพ (อ่างรายวัน = วันที่ · ฝน = วันที่ + เวลา)
  const rainShown = rows.find(r => r.mm !== null) ? topRainRows.find(s => freshRainMm(s, now) !== null) : null
  const srcParts = []
  if (dam) srcParts.push(`ค่าอ่าง ${posterDateShort(dam.recorded_at)}`)
  const rainAt = kind === 'rain' ? top.recorded_at : rainShown?.recorded_at
  if (rainAt) srcParts.push(`ค่าฝน ${posterDateShort(rainAt)} ${posterTime(rainAt)} น.`)

  const province = stripPrefix(tenant?.province, /^(จังหวัด|จ\.)/)
  const locationText = [tenantName, district ? `อ.${district}` : '', province ? `จ.${province}` : ''].filter(Boolean).join(' ')
  const locality = orgNameParts(tenant ?? tenantName).locality

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
    otherNote,
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
    footer: {
      location: locationText,
      tags: ['#สถานการณ์น้ำ', locality ? `#${locality}` : ''].filter(Boolean).join(' '),
      lines: [
        `แหล่งข้อมูล: คลังข้อมูลน้ำแห่งชาติ (ThaiWater) สสน. · เกณฑ์อ่าง สสน. และกรมชลประทาน · เกณฑ์ฝน กรมอุตุนิยมวิทยา${srcParts.length ? ` · ${srcParts.join(' · ')}` : ''}`,
        `ข้อมูลจาก ThaiWater (สสน.) · ไม่ใช่ประกาศของ${tenantName} · ไม่มีข้อมูล ไม่ได้หมายความว่าสถานการณ์ปกติ · ดูค่าล่าสุดที่หน้า "สถานการณ์น้ำ–ฝน" ของ${tenantName}`,
      ],
    },
    illustration: { rainy: kind === 'rain', pct: damPct },
    shareText: `แจ้งเตือนสถานการณ์น้ำ–ฝน ${tenantName}: ${headline.level} ${headline.name} (ข้อมูลจาก ThaiWater สสน. ไม่ใช่ประกาศของ${tenantName})`,
    altText: `ภาพแจ้งเตือนสถานการณ์น้ำ–ฝน ${tenantName}: ${headline.level} ${headline.name} ข้อมูลจาก ThaiWater (สสน.) ไม่ใช่ประกาศของ${tenantName}`,
    fileName: `water-alert-${(() => { const p = bangkokParts(now instanceof Date ? now : Number(now)); return p ? `${p.y}${String(p.m + 1).padStart(2, '0')}${String(p.d).padStart(2, '0')}` : 'latest' })()}.png`,
  }
}

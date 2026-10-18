// ระบบน้ำของตำบล (ฤดูแล้ง เฟส 5 · PR 5.2) — ตรรกะล้วน ไม่มี React: ทะเบียนรายตำบล · ป้ายความสัมพันธ์ · อายุผัง · สรุปแนวโน้มอ่าง
// ดีไซน์ฉบับปิด: docs/water-system.md — ถอดจากผังน้ำจังหวัดแพร่ + ผังน้ำตำบล (+ ตำบลเพื่อนบ้าน) ของศูนย์บริหารจัดการน้ำจังหวัดแพร่
// ไม่โฮสต์ภาพผัง · ไม่คัดลอกความจุจากผัง · ไม่พยากรณ์ · ค่าว่างไม่เป็น 0
import { NAMLAO_SYSTEM } from './namlao.js'

// อปท. ที่เห็นส่วนนี้ — เลือกชัดเจน ไม่เดา (ต้องถอดผังรายตำบลทีละแห่ง) · อปท. ที่ไม่อยู่ในรายการ = ไม่เห็นหัวข้อนี้เลย ไม่โหลดโค้ด
//   preview: true = ดูระบบของ อปท. อื่นบน demo ได้ด้วย ?system=<id> (เฉพาะ demo — อปท. จริงที่ใส่พารามิเตอร์นี้ถูกเมินเสมอ)
export const WATER_SYSTEM_TENANTS = {
  namlao: { system: 'namlao', scope: '' },
  demo: { system: 'namlao', scope: 'ข้อมูลจริงของน้ำเลา ใช้สาธิต', preview: true },
}

export const SYSTEMS = { [NAMLAO_SYSTEM.id]: NAMLAO_SYSTEM }

export const SYSTEM_PREVIEW_SCOPES = {
  namlao: 'ข้อมูลจริงของน้ำเลา ใช้สาธิต',
}

export function systemById(id) {
  return Object.hasOwn(SYSTEMS, id || '') ? SYSTEMS[id] : null
}

export function systemTenant(slug) {
  return Object.hasOwn(WATER_SYSTEM_TENANTS, slug || '') ? WATER_SYSTEM_TENANTS[slug] : null
}

/** ระบบที่ต้องแสดงให้ อปท. นี้ — { system: id, scope } หรือ null (ไม่แสดงหัวข้อนี้เลย) */
export function resolveSystem(slug, previewId) {
  const tenant = systemTenant(slug)
  if (!tenant) return null
  if (tenant.preview && Object.hasOwn(SYSTEM_PREVIEW_SCOPES, previewId || '')) {
    return { system: previewId, scope: SYSTEM_PREVIEW_SCOPES[previewId] }
  }
  return { system: tenant.system, scope: tenant.scope }
}

// ── ป้ายความสัมพันธ์ (D4) — ทุกการ์ดอ่าง/สถานีระดับน้ำของ อปท. ที่มีระบบต้องมี ──
export const RELATIONS = {
  upstream: { label: 'ต้นน้ำของตำบล', tone: 'up' },
  inside: { label: 'อยู่ในตำบล', tone: 'in' },
  downstream: { label: 'ปลายน้ำของตำบล', tone: 'down' },
  side: { label: 'สายข้างเคียง', tone: 'side' },
  unspecified: { label: 'ผังไม่ระบุ', tone: 'unk' },
}
export const RELATION_KEYS = Object.keys(RELATIONS)

export const NODE_KINDS = ['stream', 'reservoir', 'weir', 'canal', 'pond', 'pump', 'supply', 'gauge', 'rain']
export const NODE_STATUSES = ['existing', 'planned', 'repair', 'unconfirmed']
export const NODE_ROLES = ['upstream', 'inside', 'downstream', 'side']

// ความสัมพันธ์ของสถานี (ชนิด:รหัส) ใน อปท. นั้น — null เมื่อ อปท. ไม่มีระบบ/ไม่ได้ระบุสถานีนี้ (การ์ดคงของเดิม)
export function relationOf(system, stationType, stationCode) {
  if (!system) return null
  const hit = system.relations?.[`${stationType}:${stationCode}`]
  return hit ? { ...RELATIONS[hit.relation], key: hit.relation, note: hit.note ?? '' } : null
}

// ── อายุผัง (D9) — คำนวณจากวันที่ของไฟล์ผังเอง ไม่ต้องมีคนทำ ──
export const STALE_DIAGRAM_MONTHS = 36

export function monthsBetween(fromISODate, now) {
  const from = new Date(`${fromISODate}T00:00:00Z`)
  const at = new Date(now)
  if (Number.isNaN(from.getTime()) || Number.isNaN(at.getTime())) return null
  let months = (at.getUTCFullYear() - from.getUTCFullYear()) * 12 + (at.getUTCMonth() - from.getUTCMonth())
  if (at.getUTCDate() < from.getUTCDate()) months -= 1
  return Math.max(0, months)
}

export function ageText(months) {
  if (months === null || months === undefined) return ''
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return `${rest} เดือน`
  return rest === 0 ? `${years} ปี` : `${years} ปี ${rest} เดือน`
}

// วันที่ไทย (YYYY-MM-DD) ของเวลาหนึ่ง — ค่าอ่างรายวันลงเวลาเที่ยงคืนไทย (= 17:00 UTC ของวันก่อน) ห้ามตัดวันที่จาก UTC ตรงๆ
export function bangkokISODate(ms) {
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10)
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
export function thaiDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '')
  if (!m) return ''
  return `${Number(m[3])} ${TH_MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}`
}

/** อายุของผังตำบลของระบบนี้ (ผังที่เก่าที่สุดที่ใช้เป็นแกน = ผังตำบลตัวเอง) */
export function diagramAge(system, now) {
  const own = system?.sources?.find(s => s.id === system.id)
  if (!own) return null
  const months = monthsBetween(own.date, now)
  return { months, text: ageText(months), date: own.date, dateText: thaiDate(own.date), stale: months !== null && months >= STALE_DIAGRAM_MONTHS }
}

// ── แนวโน้มอ่าง (D6) ──
export const TREND_MIN_DAYS = 7
export const TREND_WINDOW_DAYS = 30
const DAY_MS = 86_400_000
export const DAM_GAP_MS = 48 * 3_600_000 // เกณฑ์ความสดของอ่างเดิม (DAM_STALE_HOURS) — ช่วงที่ห่างกว่านี้ตัดเส้น ไม่ลากข้าม

// กราฟเส้นแนวโน้ม % ของอ่าง — สเกลคงที่ 0 ถึง 100% (เพดานขยายเมื่อค่าเกิน 100) ไม่ขยายตามข้อมูล: การลดลง 9% ต้องดูเป็น 9% ของถัง
// ไม่ใช่ถูกขยายเต็มกรอบ · ช่องว่างเกิน gapMs ตัดเส้น (ไม่ลากข้าม) · จุดที่โดดเดี่ยวคืนเป็น dots
export function trendChart(points, { width = 280, height = 72, pad = 5, gapMs = Infinity, ceiling = 100 } = {}) {
  const pts = (points || []).filter(p => p && Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t)
  if (pts.length === 0) return null
  const values = pts.map(p => p.v)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const top = Math.max(ceiling, max)
  const t0 = pts[0].t
  const spanT = pts[pts.length - 1].t - t0
  const x = t => (spanT === 0 ? width / 2 : pad + ((t - t0) / spanT) * (width - 2 * pad))
  const y = v => height - pad - (Math.max(v, 0) / top) * (height - 2 * pad)
  const round = n => Math.round(n * 10) / 10
  const segments = []
  let current = []
  for (const p of pts) {
    const last = current[current.length - 1]
    if (last && p.t - last.t > gapMs) { segments.push(current); current = [] }
    current.push(p)
  }
  segments.push(current)
  const paths = []
  const dots = []
  for (const seg of segments) {
    if (seg.length === 1) { dots.push({ x: round(x(seg[0].t)), y: round(y(seg[0].v)) }); continue }
    paths.push(seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(x(p.t))} ${round(y(p.v))}`).join(' '))
  }
  return { paths, dots, min, max, top, segments: segments.length, width, height, pad }
}

const num = v => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * ผลของ get_public_dam_history → แนวโน้มของอ่างหนึ่งแห่ง
 * คืน { state: 'none'|'building'|'ready', days, needDays?, since?, chart?, facts? }
 *   none = ไม่มีแถวเลย · building = มีวันที่ต่างกันไม่ถึง 7 วัน (เพิ่งเริ่มเก็บ) · ready = ≥ 7 วัน
 * ไม่เติมค่า ไม่ลากเส้นข้ามช่องว่าง ไม่คำนวณ "เหลืออีกกี่วัน"
 */
export function damTrendSummary(readings) {
  const rows = (Array.isArray(readings) ? readings : [])
    .map(r => ({ t: Date.parse(r?.recorded_at), pct: num(r?.storage_percent), mcm: num(r?.storage_mcm), cap: num(r?.capacity_mcm) }))
    .filter(r => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t)
  if (rows.length === 0) return { state: 'none', days: 0 }
  const span = Math.round((rows[rows.length - 1].t - rows[0].t) / DAY_MS)
  const days = span + 1 // วันแรกถึงวันสุดท้ายนับรวมปลาย (ใช้เขียน "N วันที่ผ่านมา")
  // "ครบ 7 วัน" = มีค่าจริงอย่างน้อย 7 วันที่ต่างกัน (ไม่ใช่แค่ช่วงห่างกัน 7 วัน — แถวสองแถวห่างกัน 8 วันไม่ใช่แนวโน้ม)
  const distinct = new Set(rows.map(r => bangkokISODate(r.t))).size
  if (distinct < TREND_MIN_DAYS) {
    return { state: 'building', days, needDays: TREND_MIN_DAYS - distinct, since: new Date(rows[0].t).toISOString() }
  }
  const points = rows.filter(r => r.pct !== null).map(r => ({ t: r.t, v: r.pct }))
  const chart = trendChart(points, { gapMs: DAM_GAP_MS })
  if (!chart) return { state: 'none', days } // มีแถวแต่ไม่มี % สักแถว — ไม่วาดอะไรให้เดา
  const first = rows.find(r => r.mcm !== null)
  const last = [...rows].reverse().find(r => r.mcm !== null)
  const capacity = last?.cap ?? first?.cap ?? null
  let facts = null
  if (first && last && first !== last && capacity) {
    const diff = Math.round((last.mcm - first.mcm) * 100) / 100
    const pctOfCap = Math.round(Math.abs(diff) / capacity * 1000) / 10
    facts = { dir: diff === 0 ? 'flat' : diff < 0 ? 'down' : 'up', mcm: Math.abs(diff), pctOfCapacity: pctOfCap, fromT: first.t, toT: last.t, days }
  }
  return { state: 'ready', days, chart, facts, since: new Date(rows[0].t).toISOString() }
}

export function trendFactText(facts) {
  if (!facts) return ''
  const unit = `${facts.mcm.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ล้าน ลบ.ม. (${facts.pctOfCapacity.toLocaleString('th-TH', { maximumFractionDigits: 1 })}% ของความจุ)`
  if (facts.dir === 'flat') return `${facts.days} วันที่ผ่านมา ปริมาณน้ำในอ่างเท่าเดิม`
  return `${facts.days} วันที่ผ่านมา ปริมาณน้ำในอ่าง${facts.dir === 'down' ? 'ลดลง' : 'เพิ่มขึ้น'} ${unit}`
}

// ── ค่าสดของโหนด (bind) ──
// bind = { type: 'dam'|'waterlevel'|'rain'|'small-reservoir', code } → คืน 'live' | 'none'
//   live = มีสถานีและมีค่า · none = ไม่มีสถานี/ไม่มีค่า → ป้าย "ไม่มีค่าสดในระบบ" (ข้อความเดียวทั้งระบบ ไม่เขียน "ปกติ")
export function liveState(node, stations) {
  // อ่าง/สถานีที่ควรมีค่าแต่ไม่ได้ผูกสถานี = ไม่มีค่าสดในระบบ · ฝาย ห้วย สระ ไม่ใช่ของที่วัดได้ → ไม่ขึ้นป้าย
  if (!node?.bind) return node && (node.kind === 'reservoir' || node.kind === 'gauge') && node.status === 'existing' ? 'none' : null
  const s = (stations || []).find(x => x.station_type === node.bind.type && x.station_code === node.bind.code)
  if (!s || !s.recorded_at) return 'none'
  if (node.bind.type === 'dam') return num(s.dam_storage_mcm) === null ? 'none' : 'live'
  if (node.bind.type === 'waterlevel') return num(s.bank_diff_m) === null && num(s.waterlevel_msl) === null ? 'none' : 'live'
  if (node.bind.type === 'rain') return num(s.rain_24h_mm) === null ? 'none' : 'live'
  return 'none'
}

export const NO_LIVE_TEXT = 'ไม่มีค่าสดในระบบ'

// คำกำกับบังคับบนหน้า — เทสต์ตรวจว่ามีครบ (ห้ามเอาออก)
export const SYSTEM_DISCLAIMER = ['ไม่ใช่ประกาศ', 'ไม่บอกเวลาน้ำถึง', 'ไม่ได้แสดงว่ามีน้ำไหลจริง', 'ไม่ได้รับรองว่าปลอดภัย']
export const SYSTEM_DISCLAIMER_LINE = SYSTEM_DISCLAIMER.join(' · ')
export const UPSTREAM_DEPTH_NOTE = 'ต้นน้ำอยู่ไกลกว่านี้ ผังที่ใช้ไม่ครอบคลุม'

// ระบบน้ำของตำบล (ฤดูแล้ง เฟส 5 · PR 5.2) — ตรรกะล้วน ไม่มี React: ทะเบียนรายตำบล · ป้ายความสัมพันธ์ · อายุผัง · ค่าสดของโหนด (ตัดสรุปแนวโน้มอ่าง 30 วันออกแล้ว 2026-10-19)
// ดีไซน์ฉบับปิด: docs/water-system.md — ถอดจากผังน้ำจังหวัดแพร่ + ผังน้ำตำบล (+ ตำบลเพื่อนบ้าน) ของศูนย์บริหารจัดการน้ำจังหวัดแพร่
// ไม่โฮสต์ภาพผัง · ไม่คัดลอกความจุจากผัง · ไม่พยากรณ์ · ค่าว่างไม่เป็น 0
import { NAMLAO_SYSTEM } from './namlao.js'
import { TAMNAKTHAM_SYSTEM } from './tamnaktham.js'
import { THUNGKAEW_SYSTEM } from './thungkaew.js'

// อปท. ที่เห็นส่วนนี้ — เลือกชัดเจน ไม่เดา (ต้องถอดผังรายตำบลทีละแห่ง) · อปท. ที่ไม่อยู่ในรายการ = ไม่เห็นหัวข้อนี้เลย ไม่โหลดโค้ด
//   preview: true = ดูระบบของ อปท. อื่นบน demo ได้ด้วย ?system=<id> (เฉพาะ demo — อปท. จริงที่ใส่พารามิเตอร์นี้ถูกเมินเสมอ)
export const WATER_SYSTEM_TENANTS = {
  namlao: { system: 'namlao', scope: '' },
  tamnaktham: { system: 'tamnaktham', scope: '' },
  thungkaew: { system: 'thungkaew', scope: '' },
  demo: { system: 'namlao', scope: 'ข้อมูลจริงของน้ำเลา ใช้สาธิต', preview: true },
}

export const SYSTEMS = {
  [NAMLAO_SYSTEM.id]: NAMLAO_SYSTEM,
  [TAMNAKTHAM_SYSTEM.id]: TAMNAKTHAM_SYSTEM,
  [THUNGKAEW_SYSTEM.id]: THUNGKAEW_SYSTEM,
}

// ป้ายบนส่วนระบบน้ำเมื่อ demo ดูระบบของ อปท. อื่นผ่าน ?system= — สถานีที่ขึ้นค่าสดคือสถานีที่สนามซ้อมติดตามอยู่
export const SYSTEM_PREVIEW_SCOPES = {
  namlao: 'ข้อมูลจริงของน้ำเลา ใช้สาธิต',
  tamnaktham: 'ตัวอย่างบนสนามซ้อม · ค่าสดคือสถานีที่สนามซ้อมติดตาม ไม่ใช่ของตำหนักธรรม',
  thungkaew: 'ตัวอย่างบนสนามซ้อม · ค่าสดคือสถานีที่สนามซ้อมติดตาม ไม่ใช่ของทุ่งแค้ว',
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

export const NODE_KINDS = ['stream', 'reservoir', 'weir', 'canal', 'pond', 'pump', 'supply', 'gauge', 'rain', 'gate', 'other']
export const NODE_STATUSES = ['existing', 'planned', 'repair', 'unconfirmed']
export const NODE_ROLES = ['upstream', 'inside', 'downstream', 'side']

// สรุปบรรทัดเดียวของขั้น "ในตำบล" — เขียนเฉพาะที่ผังวาดไว้จริง (จำนวน 0 ไม่เขียน) · ตั้งแต่ 10 ขึ้นไปเขียน "ประมาณ" เพราะนับจากภาพ
export function systemCountsText(counts) {
  const c = counts ?? {}
  const approx = n => (n >= 10 ? 'ประมาณ' : '')
  const part = (n, text) => (Number.isFinite(n) && n > 0 ? text(n) : null)
  return [
    part(c.reservoirs, n => `อ่าง ${n} แห่ง`),
    part(c.weirs, n => `ฝาย${approx(n)} ${n} แห่ง`),
    part(c.ponds, n => `${c.pondLabel || 'สระ'} ${n} แห่ง`),
    part(c.tributaries, n => `ห้วยสาขา${approx(n)} ${n} สาย`),
    part(c.planned, n => `แผนก่อสร้าง ${n} รายการ`),
  ].filter(Boolean).join(' · ')
}

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

const num = v => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

// ── ค่าสดของโหนด (bind) ──
// bind = { type: 'dam'|'waterlevel'|'rain'|'small-reservoir', code } → คืน 'live' | 'none'
//   live = มีสถานีและมีค่า · none = ไม่มีสถานี/ไม่มีค่า → ป้าย "ไม่มีค่าสดในระบบ" (ข้อความเดียวทั้งระบบ ไม่เขียน "ปกติ")
export function liveState(node, stations) {
  // อ่าง/สถานีที่ควรมีค่าแต่ไม่ได้ผูกสถานี (ผังวาดไว้ จะยืนยันความสัมพันธ์หรือไม่ก็ตาม) = ไม่มีค่าสดในระบบ · ฝาย ห้วย สระ ไม่ใช่ของที่วัดได้ → ไม่ขึ้นป้าย
  if (!node?.bind) return node && (node.kind === 'reservoir' || node.kind === 'gauge') && ['existing', 'unconfirmed'].includes(node.status) ? 'none' : null
  // อ่างเล็กของศูนย์ฯ แพร่ = รายงานรายสัปดาห์พิมพ์มือ (ไม่ใช่ค่าสด) มีการ์ดของตัวเองบนหน้า → ไม่ขึ้นป้ายค่าสด/ไม่มีค่าสด (note ของโหนดบอกที่ดูรายงาน)
  if (node.bind.type === 'small-reservoir') return null
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

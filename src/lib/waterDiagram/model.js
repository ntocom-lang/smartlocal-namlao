// ตรรกะล้วนของ "ผังน้ำเคลื่อนไหว" (src/components/water/WaterDiagram.jsx) — ทดสอบใน node (tests/water-diagram.test.mjs)
//
// หลักกันภาพหลอก (เจ้าของระบบ 2569-10-14 + บทเรียนเฟส "หมู่ของฉัน" 2569-10-15):
//  1) เส้นที่วิ่ง = ทิศทางน้ำตามผังที่ศูนย์ฯ แพร่วาดไว้ ไม่ได้แปลว่าตอนนี้มีน้ำไหลจริง — ไม่มีเซนเซอร์ที่ฝาย/คลอง/หนอง
//     จึงห้ามผูกการวิ่งกับค่าที่ไม่ได้วัด และห้ามเปลี่ยนความเร็ว/ความหนาตามระดับน้ำ
//  2) ค่าสดบนผังมีเฉพาะที่วัดได้จริงและมีที่มา เขียนชนิด/ระยะตรงๆ ไม่ลงสีสถานการณ์ (ไม่เดาว่าอ่างเล็ก/แม่น้ำ "ปกติ")
//  3) ไม่มีค่า/ค้าง = บอกว่าไม่มี ห้ามกลายเป็น 0 หรือ "ปกติ"
//  4) โครงสร้างที่ผังเองระบุว่า "ชำรุด" หรือ "แผนก่อสร้าง" และของที่ผังไม่ระบุทิศ ไม่เคลื่อนไหว

import {
  STATION_STALE_HOURS, bankText, distanceText, formatMm, isStale, measuredAtText, rainLevel, toNum,
} from '../waterSituation.js'
import { formatReportDay, reservoirSummary } from '../smallReservoirs.js'

// อปท. ที่เห็นผัง — เลือกชัดเจน ไม่เดา (ผังต่อตำบล ต้องวาดใหม่ทีละตำบล) · diagram = id ใน diagrams.js
//   thungkaew: ผังน้ำตำบลทุ่งแค้ว (เจ้าของระบบสั่ง 2569-10-14)
//   tamnaktham: ผังน้ำตำบลตำหนักธรรม (2569-10-16)
//   demo: ใช้ผัง+ค่าจริงของทุ่งแค้วเป็นตัวอย่างบนสนามซ้อม (แบบเดียวกับ SMALL_RESERVOIR_TENANTS.demo) — สถานีฝน/ระดับน้ำของ
//         ทุ่งแค้ว (RES038, YOM003) ไม่อยู่ในรายการของ demo ป้ายเหล่านั้นจึงขึ้น "ไม่มีค่าในระบบ" ตามจริง
//         preview: true = ดูผังอื่นบน demo ได้ด้วย ?diagram=<id> ไว้ตรวจก่อนเปิดให้ อปท. จริง (เฉพาะ demo)
export const WATER_DIAGRAM_TENANTS = {
  thungkaew: { diagram: 'thungkaew', scope: '' },
  tamnaktham: { diagram: 'tamnaktham', scope: '' },
  demo: { diagram: 'thungkaew', scope: 'ข้อมูลจริงของทุ่งแค้ว ใช้สาธิต', preview: true },
}

// ป้ายบอกว่าใช้ข้อมูลจริงของ อปท. ไหนเมื่อดูผังบน demo — ต้องมีครบทุกผังที่ดูตัวอย่างได้
export const DIAGRAM_PREVIEW_SCOPES = {
  thungkaew: 'ข้อมูลจริงของทุ่งแค้ว ใช้สาธิต',
  tamnaktham: 'ข้อมูลจริงของตำหนักธรรม ใช้สาธิต',
}

export function diagramTenant(slug) {
  return Object.hasOwn(WATER_DIAGRAM_TENANTS, slug || '') ? WATER_DIAGRAM_TENANTS[slug] : null
}

/**
 * ผังที่ต้องแสดงให้ อปท. นี้ — { diagram: id, scope } หรือ null (ไม่แสดงหัวข้อนี้เลย)
 * previewId ใช้ได้เฉพาะ อปท. ที่ตั้ง preview (demo) · อปท. จริงที่ใส่ ?diagram= มาถูกเมินเสมอ ไม่โชว์ผังของที่อื่น
 */
export function resolveDiagram(slug, previewId) {
  const tenant = diagramTenant(slug)
  if (!tenant) return null
  if (tenant.preview && Object.hasOwn(DIAGRAM_PREVIEW_SCOPES, previewId || '')) {
    return { diagram: previewId, scope: DIAGRAM_PREVIEW_SCOPES[previewId] }
  }
  return { diagram: tenant.diagram, scope: tenant.scope }
}

// สไตล์เส้นตามชนิด — dash = ลายเส้นสีขาวที่เลื่อนทับเส้นฟ้า (เฉพาะชนิดที่วิ่ง) · period = ผลรวมความยาวลาย
// ใช้เป็นระยะเลื่อนต่อรอบ ให้วนต่อเนื่องไม่กระตุก (ต้นแบบใช้ -30 ตายตัวกับทุกลาย ลาย 36/24/44 จึงกระโดดทุกรอบ)
export const EDGE_STYLES = {
  main:   { width: 9,  marker: 'aM', dash: '9 21',   period: 30, dur: 1.8 },
  big:    { width: 15, marker: 'aB', dash: '12 24',  period: 36, dur: 1.3 },
  branch: { width: 5,  marker: 'aS', dash: '7 17',   period: 24, dur: 2.3 },
  river:  { width: 15, marker: 'aR', dash: '14 30',  period: 44, dur: 2.6, dark: true },
  canal:  { width: 8,  marker: 'aM', shimmer: true },
  minor:  { width: 3,  marker: 'aS' },
  plan:   { width: 5,  marker: 'aP', red: true },
}

// สถานะของโครงสร้างตามผัง: existing = มีตามผัง · repair = ผังวาดว่าชำรุด · planned = ผังวาดสีแดง "จะก่อสร้างใหม่" · unknown = ไม่ระบุ
export const DIAGRAM_STATUSES = ['existing', 'repair', 'planned', 'unknown']

// เส้นที่วิ่งได้ = ชนิดที่มีลายเลื่อน และสถานะ existing เท่านั้น — ที่เดียวที่ตัดสิน (ทั้งตัววาดและเทสต์ใช้ฟังก์ชันนี้)
export function isAnimated(el) {
  if (!el || el.kind !== 'edge') return false
  const style = EDGE_STYLES[el.cls]
  return Boolean(style?.dash) && (el.status ?? 'existing') === 'existing'
}

// คลองสองปลายลูกศร: ระยิบ ไม่วิ่ง (ไม่ระบุทิศ)
export function isShimmer(el) {
  if (!el || el.kind !== 'edge') return false
  return Boolean(EDGE_STYLES[el.cls]?.shimmer) && (el.status ?? 'existing') === 'existing'
}

// ความกว้างป้ายตัวเลขบนผัง (หน่วยพิกัดผัง) — ไม่นับสระ/วรรณยุกต์ไทยที่ไม่กินที่
const THAI_NON_SPACING = /[ัิ-ฺ็-๎]/g
export function chipWidth(text, size = 19) {
  const visible = String(text ?? '').replace(THAI_NON_SPACING, '').length
  return Math.ceil(visible * size * 0.56 + 22)
}

const MISSING = { tone: 'na', text: 'ไม่มีค่าในระบบ', detail: 'ไม่มีค่าในระบบ' }
const findStation = (stations, type, code) =>
  (Array.isArray(stations) ? stations : []).find(s => s?.station_type === type && s?.station_code === code) ?? null

function damBadge(entry, now) {
  if (!entry || !entry.done) return { tone: 'na', text: 'กำลังโหลด', detail: 'กำลังโหลด' }
  const summary = entry.report ? reservoirSummary(entry.report, now) : null
  const pct = toNum(summary?.latest?.pct)
  if (!summary || pct === null) return { tone: 'na', text: 'ยังโหลดค่าไม่ได้', detail: 'ยังโหลดรายงานอ่างนี้ไม่ได้ในตอนนี้' }
  const value = `${formatMm(pct)}%`
  const day = formatReportDay(summary.latest.d)
  const refreshed = entry.failed ? ' · ดึงข้อมูลใหม่ไม่สำเร็จ แสดงของเดิม' : ''
  if (summary.stale) {
    return { tone: 'stale', text: `อ่าง ${value} · ไม่มีรายงานใหม่`, detail: `${value} · ไม่มีรายงานใหม่ตั้งแต่ ${day} (ผ่านมา ${summary.ageDays} วัน)${refreshed}` }
  }
  if (summary.showSame) {
    return { tone: 'warn', text: `อ่าง ${value} · ตัวเลขซ้ำเดิม`, detail: `${value} · รายงาน ${day} · ตัวเลขซ้ำเดิม ${summary.sameCount} รายงานติดกัน${refreshed}` }
  }
  return { tone: 'ok', text: `อ่าง ${value}`, detail: `${value} · รายงาน ${day}${refreshed}` }
}

function rainBadge(station, now) {
  const mm = toNum(station?.rain_24h_mm)
  if (!station || mm === null || !station.recorded_at) return MISSING
  if (isStale(station.recorded_at, now, STATION_STALE_HOURS)) {
    return { tone: 'stale', text: 'ฝน ไม่มีค่าใหม่', detail: `ไม่มีค่าใหม่ (วัดล่าสุด ${measuredAtText(station.recorded_at, now)})` }
  }
  const label = rainLevel(mm)?.label
  return {
    tone: 'ok', text: `ฝน ${formatMm(mm)} มม.`,
    detail: `ฝนสะสม 24 ชม. ${formatMm(mm)} มม.${label ? ` · ${label}` : ''} · วัดเมื่อ ${measuredAtText(station.recorded_at, now)}`,
  }
}

// ระดับน้ำ: เขียนเป็นข้อเท็จจริงของ "สถานีนั้น" พร้อมระยะ — ไม่ลงสี ไม่อ้างเป็นสถานการณ์ของแม่น้ำในตำบล (สถานีอยู่ห่างตำบล)
function levelBadge(station, now) {
  const diff = toNum(station?.bank_diff_m)
  if (!station || diff === null || !station.recorded_at) return MISSING
  const where = [station.station_name, distanceText(station.distance_km)].filter(Boolean).join(' ')
  if (isStale(station.recorded_at, now, STATION_STALE_HOURS)) {
    return { tone: 'stale', text: `${where} ไม่มีค่าใหม่`, detail: `${where} · ไม่มีค่าใหม่ (วัดล่าสุด ${measuredAtText(station.recorded_at, now)})` }
  }
  return {
    tone: 'ok', text: `${where} · ${bankText(diff)}`,
    detail: `${where} · ${bankText(diff)} · วัดเมื่อ ${measuredAtText(station.recorded_at, now)}`,
  }
}

/**
 * ป้ายค่าสดของทุกช่องบนผัง
 * @param {{ binds: Record<string, {type: string, id?: string, code?: string}>, reports: Record<string, {report: object|null, failed: boolean, done: boolean}>,
 *           stations: object[], now: number|Date }} input
 *   binds = ตารางช่อง → แหล่งค่า (อยู่ในไฟล์ข้อมูลผัง) · reports = ผลของ useReservoirReport รายอ่าง · stations = สถานีจาก get_public_water_situation()
 * @returns {Record<string, {tone: 'ok'|'warn'|'stale'|'na', text: string, detail: string}>}
 */
export function liveBadges({ binds, reports = {}, stations = [], now }) {
  const out = {}
  for (const [slot, bind] of Object.entries(binds ?? {})) {
    if (bind.type === 'small-dam') out[slot] = damBadge(reports[bind.id], now)
    else if (bind.type === 'rain') out[slot] = rainBadge(findStation(stations, 'rain', bind.code), now)
    else if (bind.type === 'level') out[slot] = levelBadge(findStation(stations, 'waterlevel', bind.code), now)
    else out[slot] = MISSING
  }
  return out
}

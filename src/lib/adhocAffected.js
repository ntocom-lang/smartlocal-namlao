// ตัวช่วยล้วน (ไม่แตะ React/DB) ของ "ผู้ได้รับผลกระทบ" รอบจุดต้นทางเรื่องเฉพาะกิจ (เฟส 2)
// ตาราง adhoc_affected_points (20261012140000) · ฟังก์ชัน adhoc_affected_list/save/delete (20261012140100)
// มีเทสต์ล็อกไว้ที่ tests/adhoc-affected.test.mjs
//
// ⚠️ นี่คือพิกัดบุคคล (พิกัดบ้านย่อมระบุตัวเจ้าของได้) — เก็บให้น้อยที่สุด: พิกัด + ชนิด + หมายเหตุสั้น ไม่มีชื่อ/เบอร์/เลขบัตร
//    ค่าขอบเขตด้านล่างต้องตรงกับ CHECK ของตาราง ถ้าแก้ที่นี่ต้องแก้ migration ด้วย (และกลับกัน) ฝั่ง DB เป็นด่านจริง
//    ฝั่งนี้มีไว้ให้หน้าจอไม่ปล่อยค่าที่ DB จะปฏิเสธ

import { normalizeRadii, validZoneCoords, zoneHideKey } from './adhocZones.js'

// ชนิดต้องตรงกับ adhoc_affected_points_kind ใน DB · "other" ต้องอยู่ท้ายสุดเสมอ (ใช้เป็นค่าสำรองของชนิดที่ไม่รู้จัก)
export const AFFECTED_KINDS = [
  { value: 'residence', label: 'บ้าน/ที่พักอาศัย', emoji: '🏠' },
  { value: 'school', label: 'โรงเรียน/ศูนย์เด็กเล็ก', emoji: '🏫' },
  { value: 'temple', label: 'วัด/ศาสนสถาน', emoji: '🛕' },
  { value: 'health', label: 'สถานพยาบาล', emoji: '🏥' },
  { value: 'other', label: 'อื่นๆ', emoji: '📍' },
]

export function affectedKind(value) {
  return AFFECTED_KINDS.find(k => k.value === value) ?? AFFECTED_KINDS[AFFECTED_KINDS.length - 1]
}

export const AFFECTED_NOTE_MAX = 120
export const AFFECTED_MAX_PER_ZONE = 200

export const AFFECTED_NOTICE =
  'เก็บเฉพาะพิกัด ชนิด และหมายเหตุสั้น — ห้ามใส่ชื่อ เบอร์โทร เลขบัตร หรือข้อมูลที่ระบุตัวบุคคลได้ · ทุกการเพิ่ม/เปิดดู/ลบถูกบันทึกใน audit log'

// ตรวจหมายเหตุก่อนส่ง — คืนข้อความเตือนภาษาไทย หรือ null ถ้าใช้ได้ (ตรงกับ CHECK 2 ข้อของ DB)
// ตัดช่องว่าง/ขีด/จุดออกก่อนนับ เพื่อจับเบอร์ที่พิมพ์เป็น 081-234-5678 · นับเลขไทยด้วย
// ⚠️ เป็นด่านกันพลาด ไม่ใช่การรับประกัน — เลขเต็มความกว้าง หรือเขียนเป็นตัวอักษร ยังหลุดได้ ต้องพึ่งการอบรมผู้ใช้ควบคู่
export function affectedNoteProblem(note) {
  const text = String(note ?? '')
  if (Array.from(text).length > AFFECTED_NOTE_MAX) return `หมายเหตุยาวเกิน ${AFFECTED_NOTE_MAX} ตัวอักษร`
  if (/[0-9๐-๙]{9,}/.test(text.replace(/[\s.-]/g, ''))) {
    return 'หมายเหตุมีตัวเลขยาวคล้ายเบอร์โทรหรือเลขบัตร — ห้ามใส่ข้อมูลที่ระบุตัวบุคคลได้'
  }
  return null
}

const EARTH_RADIUS_M = 6371000

// ระยะทางเป็นเมตร (haversine เหมือนฝั่ง DB ใน adhoc_zone_counts) รับ { lat, lng } สองจุด
export function distanceMeters(a, b) {
  const toRad = deg => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

// จุดนี้อยู่ในวงไหนของจุดต้นทาง — คืน { distance, index, radius } โดย index/radius เป็น null ถ้าอยู่นอกวงนอกสุด
// คืน null ถ้าพิกัดของจุดต้นทางหรือของจุดนี้ใช้ไม่ได้ (ไม่เดา)
export function ringOfPoint(zone, point) {
  const origin = validZoneCoords(zone?.latitude, zone?.longitude)
  const target = validZoneCoords(point?.latitude, point?.longitude)
  if (!origin || !target) return null
  const distance = distanceMeters(origin, target)
  const radii = normalizeRadii(zone.radii_m)
  const index = radii.findIndex(r => distance <= r)
  return { distance, index: index < 0 ? null : index, radius: index < 0 ? null : radii[index] }
}

// นับผู้ได้รับผลกระทบของจุดต้นทางหนึ่งจุดตามวง (สะสม: "ภายใน 2 กม." รวมที่อยู่ภายใน 1 กม. ด้วย เหมือนตัวนับคำร้อง)
// outside = อยู่นอกวงนอกสุด · total = ทุกจุดของจุดต้นทางนี้ที่พิกัดใช้ได้
export function countAffectedByRing(zone, points) {
  const radii = normalizeRadii(zone?.radii_m)
  const byRadius = new Map(radii.map(r => [r, 0]))
  let outside = 0
  let total = 0
  for (const point of Array.isArray(points) ? points : []) {
    if (!point || point.zone_id !== zone?.id) continue
    const ring = ringOfPoint(zone, point)
    if (!ring) continue
    total += 1
    if (ring.radius == null) { outside += 1; continue }
    for (const r of radii) if (ring.distance <= r) byRadius.set(r, byRadius.get(r) + 1)
  }
  return { byRadius, outside, total }
}

// หมุดผู้ได้รับผลกระทบที่จะวาดบนแผนที่ — ข้ามจุดของเรื่องที่ปิดแล้ว (is_active=false) และเรื่องที่ผู้ใช้ปิดส่วนตัว
// และข้ามพิกัดที่ใช้ไม่ได้ · layerOn=false → ไม่วาดอะไรเลย (ค่าเริ่มต้นของหน้าจอคือปิด ต้องกดเปิดเอง)
export function buildAffectedMarkers(points, zones, { layerOn = true, hidden = new Set() } = {}) {
  if (!layerOn) return []
  const zoneById = new Map(
    (Array.isArray(zones) ? zones : []).filter(z => z && z.is_active !== false).map(z => [z.id, z]),
  )
  const out = []
  for (const point of Array.isArray(points) ? points : []) {
    if (!point) continue
    const zone = zoneById.get(point.zone_id)
    if (!zone || hidden.has(zoneHideKey(zone.id))) continue
    const position = validZoneCoords(point.latitude, point.longitude)
    if (!position) continue
    out.push({ id: `affected-${point.id}`, position, point, zone, kind: affectedKind(point.kind), ring: ringOfPoint(zone, point) })
  }
  return out
}

// จำนวนจุดต่อจุดต้นทาง (ไว้โชว์ในแผง) — Map<zoneId, number>
export function countByZone(points) {
  const map = new Map()
  for (const point of Array.isArray(points) ? points : []) {
    if (!point?.zone_id) continue
    map.set(point.zone_id, (map.get(point.zone_id) ?? 0) + 1)
  }
  return map
}

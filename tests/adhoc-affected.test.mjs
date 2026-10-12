// ตรวจตัวช่วยผู้ได้รับผลกระทบ (src/lib/adhocAffected.js) — รันเร็ว ไม่ต้องต่อฐานข้อมูล
//
// ทำไมต้องมีเทสต์ตัวนี้: นี่คือพิกัดบุคคล กฎพวกนี้ตัดสินว่า "หมายเหตุแบบไหนถูกกันก่อนส่ง" และ "จุดไหนถูกวาดบนแผนที่"
//  - ถ้ากฎหมายเหตุหลวมกว่า DB หน้าจอปล่อยค่าที่ DB ปฏิเสธ ผู้ใช้เจอ error ดิบ · ถ้าเข้มกว่า DB ผู้ใช้ใส่ที่อยู่ปกติไม่ได้
//  - ถ้าจุดของเรื่องที่ปิดแล้วยังถูกวาด พิกัดบุคคลของเรื่องที่จบแล้วยังโผล่บนจอ (ขัดกับ "ปิดเรื่อง = ซ่อนให้ทุกคน")
//  - ถ้าชั้นนี้วาดทั้งที่ layerOn=false พิกัดบุคคลโผล่โดยผู้ใช้ไม่ได้ตั้งใจเปิด
// ชุดหมายเหตุด้านล่างเป็นชุดเดียวกับที่ด่าน DB ทดสอบ (ดู 20261012140100 และชุดทดสอบ rollback) ต้องให้ผลตรงกัน
//
//   node tests/adhoc-affected.test.mjs

import assert from 'node:assert/strict'
import {
  AFFECTED_KINDS, AFFECTED_NOTE_MAX, affectedKind, affectedNoteProblem, distanceMeters, ringOfPoint,
  countAffectedByRing, buildAffectedMarkers, countByZone,
} from '../src/lib/adhocAffected.js'
import { zoneHideKey } from '../src/lib/adhocZones.js'

// ── ชนิด ───────────────────────────────────────────────────────────────────
assert.deepEqual(AFFECTED_KINDS.map(k => k.value), ['residence', 'school', 'temple', 'health', 'other'], 'ต้องตรงกับ CHECK ของตาราง')
assert.equal(AFFECTED_KINDS[AFFECTED_KINDS.length - 1].value, 'other', '"other" ต้องอยู่ท้ายสุด (ใช้เป็นค่าสำรอง)')
assert.ok(AFFECTED_KINDS.every(k => k.label && k.emoji))
assert.equal(affectedKind('school').emoji, '🏫')
assert.equal(affectedKind('ไม่รู้จัก').value, 'other', 'ชนิดที่ไม่รู้จักตกไป other ไม่ throw')
assert.equal(affectedKind(null).value, 'other')
assert.equal(affectedKind(undefined).value, 'other')

// ── หมายเหตุ: ชุดเดียวกับด่าน DB ───────────────────────────────────────────────
const blocked = [
  '081-234-5678', '081 234 5678', '081.234.5678', '๐๘๑๒๓๔๕๖๗๘', '1234567890123',
  'โทร 0812345678 คุณสมชาย', '123456789', '0 8 1 2 3 4 5 6 7 8',
]
for (const text of blocked) assert.ok(affectedNoteProblem(text), `ต้องถูกกัน: ${text}`)

const allowed = [
  null, undefined, '', '   ', 'บ้านเลขที่ 12/3 หมู่ 5 ห่างฟาร์ม 1500 ม.', '12345678', 'ได้กลิ่นช่วงเช้า ผู้สูงอายุ 2 คน',
  'ก'.repeat(AFFECTED_NOTE_MAX),
]
for (const text of allowed) assert.equal(affectedNoteProblem(text), null, `ต้องผ่าน: ${text}`)

assert.ok(affectedNoteProblem('ก'.repeat(AFFECTED_NOTE_MAX + 1)), 'ยาวเกินต้องถูกกัน')
assert.match(affectedNoteProblem('ก'.repeat(AFFECTED_NOTE_MAX + 1)), /120/)
assert.match(affectedNoteProblem('0812345678'), /เบอร์โทรหรือเลขบัตร/)
// อีโมจิ 1 ตัวนับเป็น 1 ตัวอักษร (DB ใช้ char_length ไม่ใช่ขนาด UTF-16) — 120 ตัวพอดีต้องผ่าน
assert.equal(affectedNoteProblem('😀'.repeat(AFFECTED_NOTE_MAX)), null)
assert.ok(affectedNoteProblem('😀'.repeat(AFFECTED_NOTE_MAX + 1)))

// ── ระยะทาง: ต้องตรงกับ haversine ฝั่ง DB (ตัวนับคำร้องที่พิสูจน์แล้ว) ───────────
const O = { lat: 18.1, lng: 100.1 }
assert.equal(distanceMeters(O, O), 0)
// 0.009 องศาละติจูด ≈ 1,000.8 ม.
assert.ok(Math.abs(distanceMeters(O, { lat: 18.109, lng: 100.1 }) - 1000.8) < 1, 'ละติจูด 0.009° ≈ 1 กม.')
// ลองจิจูดสั้นลงตามละติจูด: 0.009° ที่ 18.1° ≈ 1000.8 × cos(18.1°) ≈ 951.5 ม.
const dLng = distanceMeters(O, { lat: 18.1, lng: 100.109 })
assert.ok(dLng > 940 && dLng < 960, `ลองจิจูดต้องสั้นกว่าละติจูดเท่ากัน (ได้ ${dLng})`)
assert.equal(distanceMeters(O, { lat: 18.109, lng: 100.1 }), distanceMeters({ lat: 18.109, lng: 100.1 }, O), 'สมมาตร')

// ── ringOfPoint ─────────────────────────────────────────────────────────────
const zone = { id: 'z1', label: 'ฟาร์ม ก', latitude: 18.1, longitude: 100.1, radii_m: [2000, 1000], is_active: true }
const at = meters => ({ latitude: 18.1 + meters / 111195, longitude: 100.1 })  // 1° ละติจูด ≈ 111,195 ม. ที่รัศมีโลก 6,371 กม.

{
  const inner = ringOfPoint(zone, at(500))
  assert.equal(inner.radius, 1000)
  assert.equal(inner.index, 0, 'วงในสุด = index 0 (เรียงจากรัศมีน้อยไปมาก ไม่ใช่ตามลำดับใน DB)')
  const mid = ringOfPoint(zone, at(1500))
  assert.equal(mid.radius, 2000)
  assert.equal(mid.index, 1)
  const out = ringOfPoint(zone, at(2500))
  assert.equal(out.radius, null)
  assert.equal(out.index, null, 'นอกวงนอกสุด')
  assert.ok(out.distance > 2400 && out.distance < 2600)
  assert.equal(ringOfPoint(zone, at(0)).radius, 1000, 'ตรงจุดต้นทางพอดีอยู่วงในสุด')
}
assert.equal(ringOfPoint(zone, { latitude: null, longitude: null }), null, 'พิกัดว่างต้องไม่กลายเป็น (0,0)')
assert.equal(ringOfPoint(zone, { latitude: 0, longitude: 0 }), null, '(0,0) นอกกรอบประเทศไทย')
assert.equal(ringOfPoint({ ...zone, latitude: null }, at(500)), null, 'จุดต้นทางเสียต้องไม่เดา')
assert.equal(ringOfPoint(null, at(500)), null)

// ── countAffectedByRing: สะสม + นอกวง + ข้ามจุดของเรื่องอื่น ──────────────────────
{
  const points = [
    { id: 'a', zone_id: 'z1', ...at(300) },
    { id: 'b', zone_id: 'z1', ...at(900) },
    { id: 'c', zone_id: 'z1', ...at(1400) },
    { id: 'd', zone_id: 'z1', ...at(2600) },
    { id: 'e', zone_id: 'อื่น', ...at(100) },
    { id: 'f', zone_id: 'z1', latitude: null, longitude: null },
  ]
  const r = countAffectedByRing(zone, points)
  assert.equal(r.byRadius.get(1000), 2, 'ภายใน 1 กม. = a, b')
  assert.equal(r.byRadius.get(2000), 3, 'ภายใน 2 กม. สะสมรวมวงใน = a, b, c')
  assert.equal(r.outside, 1, 'd อยู่นอกวง')
  assert.equal(r.total, 4, 'ไม่นับจุดของเรื่องอื่น และจุดที่พิกัดเสีย')
  assert.deepEqual([...r.byRadius.keys()], [1000, 2000], 'เรียงน้อย→มาก')
  const empty = countAffectedByRing(zone, [])
  assert.deepEqual([empty.total, empty.outside, empty.byRadius.get(1000)], [0, 0, 0])
  assert.equal(countAffectedByRing(zone, null).total, 0)
}

// ── buildAffectedMarkers ────────────────────────────────────────────────────
const pts = [
  { id: 'p1', zone_id: 'z1', kind: 'residence', ...at(500) },
  { id: 'p2', zone_id: 'z2', kind: 'school', latitude: 18.2, longitude: 100.2 },
  { id: 'p3', zone_id: 'z1', kind: 'temple', latitude: null, longitude: null },
  { id: 'p4', zone_id: 'หายไป', kind: 'other', latitude: 18.3, longitude: 100.3 },
]
const zones = [zone, { id: 'z2', label: 'ฟาร์ม ข', latitude: 18.15, longitude: 100.15, radii_m: [1000], is_active: true }]

{
  const m = buildAffectedMarkers(pts, zones)
  assert.deepEqual(m.map(x => x.point.id), ['p1', 'p2'], 'ข้ามพิกัดเสีย และจุดของเรื่องที่ไม่รู้จัก')
  assert.equal(m[0].id, 'affected-p1')
  assert.equal(m[0].kind.emoji, '🏠')
  assert.equal(m[0].ring.radius, 1000)
  assert.equal(m[1].ring.radius, null, 'p2 อยู่ไกลจาก z2 → นอกวง')
  assert.equal(m[0].zone.id, 'z1')
}
assert.deepEqual(buildAffectedMarkers(pts, zones, { layerOn: false }), [], 'layerOn=false → ไม่วาดอะไรเลย')
assert.deepEqual(buildAffectedMarkers(pts, zones, { hidden: new Set([zoneHideKey('z1')]) }).map(x => x.point.id), ['p2'], 'ซ่อนเรื่อง z1 ส่วนตัว → จุดของ z1 หาย')
{
  // ปิดเรื่องแล้ว (is_active=false) → ไม่วาดไม่ว่าสวิตช์ส่วนตัวจะเป็นอะไร
  const closed = [{ ...zone, is_active: false }, zones[1]]
  assert.deepEqual(buildAffectedMarkers(pts, closed).map(x => x.point.id), ['p2'])
}
assert.deepEqual(buildAffectedMarkers(null, zones), [])
assert.deepEqual(buildAffectedMarkers(pts, null), [])
assert.deepEqual(buildAffectedMarkers([null, undefined], zones), [])

// ไม่ mutate ข้อมูลต้นทาง (React ส่งอ็อบเจ็กต์เดียวกันเข้ามาทุกครั้งที่เรนเดอร์)
{
  const snapshot = JSON.stringify([pts, zones])
  buildAffectedMarkers(pts, zones)
  countAffectedByRing(zone, pts)
  assert.equal(JSON.stringify([pts, zones]), snapshot)
}

// ── countByZone ─────────────────────────────────────────────────────────────
{
  const c = countByZone([{ zone_id: 'a' }, { zone_id: 'a' }, { zone_id: 'b' }, { zone_id: null }, null])
  assert.equal(c.get('a'), 2)
  assert.equal(c.get('b'), 1)
  assert.equal(c.size, 2)
  assert.equal(countByZone(null).size, 0)
}

console.log('adhoc-affected: ผ่านทั้งหมด')

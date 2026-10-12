// ตรวจตัวช่วยวงรัศมีเรื่องเฉพาะกิจ (src/lib/adhocZones.js) — รันเร็ว ไม่ต้องต่อฐานข้อมูล
//
// ทำไมต้องมีเทสต์ตัวนี้: กฎพวกนี้ตัดสินว่า "วงไหนถูกวาด" และ "ค่าที่ DB จะปฏิเสธถูกกันไว้ก่อนไหม"
//  - ถ้าวงของเรื่องที่ปิดแล้วยังถูกวาด เจ้าหน้าที่จะเห็นวงของเรื่องที่ไม่มีใครตามอยู่เป็นปัญหาค้าง
//  - ถ้า kmToMeters รับค่านอกช่วง CHECK ของตาราง ผู้ใช้กดบันทึกแล้วเจอ error ดิบจาก DB
//  - ถ้าสวิตช์ส่วนตัวเก็บเป็นรายการที่ "เปิด" เรื่องใหม่จะไม่ขึ้นเองสำหรับคนที่เคยปิดไว้
//
//   node tests/adhoc-zones.test.mjs

import assert from 'node:assert/strict'
import {
  MIN_RADIUS_M, MAX_RADIUS_M, MAX_RINGS, DEFAULT_RADII_M,
  kmToMeters, normalizeRadii, formatRadius, ringColor, zoneHideKey, ringHideKey,
  validZoneCoords, zoomForRadius, buildZoneOverlays, indexCounts, readHiddenKeys, writeHiddenKeys, readLayerOn, writeLayerOn,
  readNamesOn, writeNamesOn, HIDDEN_STORAGE_KEY, LAYER_STORAGE_KEY, NAMES_STORAGE_KEY,
} from '../src/lib/adhocZones.js'

// ── kmToMeters ──────────────────────────────────────────────────────────────
assert.equal(kmToMeters('1'), 1000)
assert.equal(kmToMeters('2'), 2000)
assert.equal(kmToMeters('1.5'), 1500)
assert.equal(kmToMeters(' 0.5 '), 500)
assert.equal(kmToMeters('0,5'), 500, 'จุดทศนิยมแบบคอมมา')
assert.equal(kmToMeters('๒'), 2000, 'เลขไทย')
assert.equal(kmToMeters('๑.๕'), 1500)
assert.equal(kmToMeters('0.05'), 50, 'ขอบล่างพอดี')
assert.equal(kmToMeters('20'), 20000, 'ขอบบนพอดี')
assert.equal(kmToMeters('0.049'), null, 'ต่ำกว่า 50 ม. DB ปฏิเสธ')
assert.equal(kmToMeters('20.1'), null, 'เกิน 20 กม. DB ปฏิเสธ')
assert.equal(kmToMeters('0'), null)
assert.equal(kmToMeters('-1'), null)
assert.equal(kmToMeters('abc'), null)
assert.equal(kmToMeters('1 กม.'), null, 'ต้องเป็นตัวเลขล้วน')
assert.equal(kmToMeters('1e3'), null, 'ไม่รับรูปแบบเลขยกกำลัง')
assert.equal(kmToMeters('1.2.3'), null)
assert.equal(kmToMeters(''), null)
assert.equal(kmToMeters(null), null)
assert.equal(kmToMeters(undefined), null)
assert.equal(kmToMeters('1.0004'), 1000, 'ปัดเป็นเมตรจำนวนเต็ม')

// ── normalizeRadii ──────────────────────────────────────────────────────────
assert.deepEqual(normalizeRadii([2000, 1000]), [1000, 2000], 'เรียงน้อย→มาก')
assert.deepEqual(normalizeRadii([1000, 1000, 2000]), [1000, 2000], 'ตัดซ้ำ')
assert.deepEqual(normalizeRadii([1000.4, 1000.2]), [1000], 'ปัดแล้วซ้ำ → ตัดซ้ำ')
assert.deepEqual(normalizeRadii([10, 1000, 99999]), [1000], 'ทิ้งค่านอกช่วง')
assert.deepEqual(normalizeRadii(['1000', 'x', null, undefined, NaN]), [1000], 'ทิ้งสิ่งที่ไม่ใช่ตัวเลข')
assert.deepEqual(normalizeRadii(null), [])
assert.deepEqual(normalizeRadii(undefined), [])
assert.deepEqual(normalizeRadii('1000'), [], 'ไม่ใช่อาร์เรย์ → ว่าง')
assert.equal(normalizeRadii([100, 200, 300, 400, 500, 600, 700, 800]).length, MAX_RINGS, `ไม่เกิน ${MAX_RINGS} วง`)
assert.deepEqual(normalizeRadii([100, 200, 300, 400, 500, 600, 700, 800]), [100, 200, 300, 400, 500, 600], 'เก็บวงในไว้ ตัดวงนอกสุด')
assert.deepEqual(normalizeRadii(DEFAULT_RADII_M), DEFAULT_RADII_M, 'ค่าเริ่มต้นต้องผ่านด่านของตัวเอง')
assert.deepEqual(normalizeRadii([MIN_RADIUS_M, MAX_RADIUS_M]), [MIN_RADIUS_M, MAX_RADIUS_M])

// ── formatRadius ────────────────────────────────────────────────────────────
assert.equal(formatRadius(500), '500 ม.')
assert.equal(formatRadius(50), '50 ม.')
assert.equal(formatRadius(999), '999 ม.')
assert.equal(formatRadius(1000), '1 กม.')
assert.equal(formatRadius(1500), '1.5 กม.')
assert.equal(formatRadius(2250), '2.25 กม.')
assert.equal(formatRadius(20000), '20 กม.')
assert.equal(formatRadius('2000'), '2 กม.')
assert.equal(formatRadius('x'), '')

// ── ringColor: คงที่ตามลำดับ ไม่ออกนอกชุดสี ────────────────────────────────────
assert.equal(ringColor(0), '#dc2626')
assert.notEqual(ringColor(0), ringColor(1))
assert.equal(ringColor(99), ringColor(5), 'เกินลำดับสุดท้ายใช้สีสุดท้าย')
assert.equal(ringColor(-3), ringColor(0), 'ลำดับติดลบใช้สีแรก')

// ── validZoneCoords: ห้ามให้พิกัดว่างกลายเป็น (0,0) ────────────────────────────────
assert.deepEqual(validZoneCoords(18.1, 100.1), { lat: 18.1, lng: 100.1 })
assert.deepEqual(validZoneCoords('18.1', '100.1'), { lat: 18.1, lng: 100.1 }, 'ค่าสตริงจาก DB/ฟอร์ม')
assert.equal(validZoneCoords(null, 100.1), null, 'Number(null)=0 ต้องไม่หลุดผ่าน')
assert.equal(validZoneCoords(18.1, null), null)
assert.equal(validZoneCoords('', ''), null)
assert.equal(validZoneCoords(undefined, undefined), null)
assert.equal(validZoneCoords(0, 0), null, '(0,0) อยู่นอกกรอบประเทศไทย')
assert.equal(validZoneCoords(4.99, 100), null)
assert.equal(validZoneCoords(21.01, 100), null)
assert.equal(validZoneCoords(18, 95.99), null)
assert.equal(validZoneCoords(18, 106.01), null)
assert.deepEqual(validZoneCoords(5, 96), { lat: 5, lng: 96 }, 'ขอบพอดีผ่าน ตรงกับ CHECK ของตาราง')
assert.deepEqual(validZoneCoords(21, 106), { lat: 21, lng: 106 })
assert.equal(validZoneCoords('x', 100), null)
assert.equal(validZoneCoords(NaN, 100), null)

// ── zoomForRadius ───────────────────────────────────────────────────────────
assert.equal(zoomForRadius(18, 2000), 13, 'วง 2 กม. ที่ละติจูด 18° (น่าน/แพร่) คำนวณได้ 13.86 → ปัดลง 13 ให้วงไม่ล้นจอมือถือ')
assert.ok(zoomForRadius(18, 500) > zoomForRadius(18, 2000), 'วงเล็กลง → ซูมเข้ามากขึ้น')
assert.ok(zoomForRadius(18, 20000) < zoomForRadius(18, 2000), 'วงใหญ่ขึ้น → ซูมออก')
assert.equal(zoomForRadius(18, 20000), 10)
assert.equal(zoomForRadius(18, 1), 17, 'ล็อกเพดานบน')
assert.equal(zoomForRadius(18, 1e9), 8, 'ล็อกเพดานล่าง')
assert.equal(zoomForRadius(null, 2000), 14, 'ข้อมูลเสียใช้ค่ากลาง ไม่ใช่ NaN')
assert.equal(zoomForRadius(18, 0), 14)
assert.equal(zoomForRadius(18, -5), 14)
assert.equal(zoomForRadius(18, 'x'), 14)

// ── buildZoneOverlays ───────────────────────────────────────────────────────
const zone = (over = {}) => ({
  id: 'z1', label: 'ฟาร์ม ก', category: 'odor', latitude: 18.1, longitude: 100.1,
  radii_m: [1000, 2000], is_active: true, ...over,
})

{
  const { circles, pins } = buildZoneOverlays([zone()])
  assert.equal(pins.length, 1)
  assert.deepEqual(pins[0].position, { lat: 18.1, lng: 100.1 })
  assert.equal(circles.length, 2)
  assert.deepEqual(circles.map(c => c.radius), [2000, 1000], 'วงใหญ่ก่อน วงเล็กซ้อนบน')
  const byRadius = Object.fromEntries(circles.map(c => [c.radius, c]))
  assert.equal(byRadius[1000].color, ringColor(0), 'วงในสุดได้สีแรก แม้ถูกวาดทีหลัง')
  assert.equal(byRadius[2000].color, ringColor(1))
  assert.equal(byRadius[1000].label, '1 กม.')
  assert.equal(byRadius[2000].label, '2 กม.')
  assert.ok(circles.every(c => c.center.lat === 18.1 && c.center.lng === 100.1))
  assert.deepEqual(circles.map(c => [c.radius, c.labelAngle]).sort((x, y) => x[0] - y[0]), [[1000, 0], [2000, 40]], 'ป้ายวงในอยู่ทิศเหนือ วงถัดไปเอียง 40° กันป้ายทับกัน')
}

// layerOn=false → ไม่วาดอะไรเลย
{
  const out = buildZoneOverlays([zone()], { layerOn: false })
  assert.deepEqual(out, { circles: [], pins: [] })
}

// ปิดเรื่องแล้ว (is_active=false) → ไม่วาด ไม่ว่าสวิตช์ส่วนตัวจะเป็นอะไร
{
  const out = buildZoneOverlays([zone({ is_active: false })])
  assert.deepEqual(out, { circles: [], pins: [] })
}

// ปิดทั้งเรื่องแบบส่วนตัว → ไม่วาดทั้งหมุดและวง
{
  const out = buildZoneOverlays([zone()], { hidden: new Set([zoneHideKey('z1')]) })
  assert.deepEqual(out, { circles: [], pins: [] })
}

// ปิดรายวง → ยังเห็นหมุดและวงอื่น
{
  const out = buildZoneOverlays([zone()], { hidden: new Set([ringHideKey('z1', 2000)]) })
  assert.equal(out.pins.length, 1)
  assert.deepEqual(out.circles.map(c => c.radius), [1000])
}

// ปิดวงของเรื่องหนึ่ง ต้องไม่กระทบอีกเรื่องที่รัศมีเท่ากัน
{
  const zs = [zone({ id: 'a' }), zone({ id: 'b', latitude: 18.2 })]
  const out = buildZoneOverlays(zs, { hidden: new Set([ringHideKey('a', 1000)]) })
  assert.equal(out.circles.filter(c => c.id.startsWith('zone-a-')).length, 1)
  assert.equal(out.circles.filter(c => c.id.startsWith('zone-b-')).length, 2)
}

// พิกัดเสีย / ข้อมูลแปลก ต้องไม่ทำให้ทั้งชั้นพัง
{
  const out = buildZoneOverlays([zone({ latitude: null }), zone({ id: 'ok' }), null, undefined, zone({ id: 'nan', longitude: 'x' })])
  assert.deepEqual(out.pins.map(p => p.zone.id), ['ok'])
}

// รัศมีนอกช่วง/ซ้ำ ใน row ถูกจัดก่อนวาด
{
  const out = buildZoneOverlays([zone({ radii_m: [2000, 2000, 5, 1000] })])
  assert.deepEqual(out.circles.map(c => c.radius), [2000, 1000])
}

// ไม่มีรายการ / ไม่ใช่อาร์เรย์
assert.deepEqual(buildZoneOverlays([]), { circles: [], pins: [] })
assert.deepEqual(buildZoneOverlays(null), { circles: [], pins: [] })

// ไม่ mutate ข้อมูลต้นทาง (React ส่งอ็อบเจ็กต์เดียวกันเข้ามาทุกครั้งที่เรนเดอร์)
{
  const z = zone({ radii_m: [2000, 1000] })
  const snapshot = JSON.stringify(z)
  buildZoneOverlays([z])
  assert.equal(JSON.stringify(z), snapshot)
}

// ── indexCounts ─────────────────────────────────────────────────────────────
{
  const idx = indexCounts([
    { zone_id: 'a', radius_m: 1000, complaint_count: 3 },
    { zone_id: 'a', radius_m: 2000, complaint_count: 7 },
    { zone_id: 'b', radius_m: 1000, complaint_count: '0' },
    { zone_id: null, radius_m: 1000, complaint_count: 9 },
    { zone_id: 'c', radius_m: 500, complaint_count: 'x' },
  ])
  assert.equal(idx.get('a').get(1000), 3)
  assert.equal(idx.get('a').get(2000), 7)
  assert.equal(idx.get('b').get(1000), 0)
  assert.equal(idx.get('c').get(500), 0, 'ค่าเสียกลายเป็น 0 ไม่ใช่ NaN')
  assert.equal(idx.has(null), false)
  assert.equal(indexCounts(null).size, 0)
}

// ── ค่าส่วนตัวใน storage ─────────────────────────────────────────────────────
const fakeStorage = (initial = {}) => {
  const m = new Map(Object.entries(initial))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, _m: m }
}

{
  const st = fakeStorage()
  assert.equal(readHiddenKeys(st).size, 0, 'ยังไม่เคยตั้ง → ไม่มีอะไรถูกปิด (ทุกอย่างขึ้น)')
  writeHiddenKeys(st, new Set([zoneHideKey('a'), ringHideKey('a', 1000)]))
  const back = readHiddenKeys(st)
  assert.ok(back.has('z:a') && back.has('r:a:1000'))
  assert.equal(back.size, 2)
}
{
  assert.equal(readHiddenKeys(fakeStorage({ [HIDDEN_STORAGE_KEY]: '{bad json' })).size, 0, 'JSON เสียต้องไม่ทำหน้าล้ม')
  assert.equal(readHiddenKeys(fakeStorage({ [HIDDEN_STORAGE_KEY]: '{"a":1}' })).size, 0, 'ไม่ใช่อาร์เรย์ → ว่าง')
  assert.deepEqual([...readHiddenKeys(fakeStorage({ [HIDDEN_STORAGE_KEY]: '["z:a",5,null,"r:a:1"]' }))], ['z:a', 'r:a:1'], 'เก็บเฉพาะสตริง')
  assert.equal(readHiddenKeys(null).size, 0)
  assert.equal(readHiddenKeys(undefined).size, 0)
}
{
  // storage ที่โยน error (โหมดส่วนตัว / ปิด storage) ต้องไม่ทำให้หน้าล้ม
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(readHiddenKeys(broken).size, 0)
  assert.doesNotThrow(() => writeHiddenKeys(broken, new Set(['z:a'])))
  assert.equal(readLayerOn(broken), true, 'อ่านไม่ได้ → เปิดไว้')
  assert.doesNotThrow(() => writeLayerOn(broken, false))
}
{
  const st = fakeStorage()
  assert.equal(readLayerOn(st), true, 'ค่าเริ่มต้น = เปิด')
  writeLayerOn(st, false)
  assert.equal(st._m.get(LAYER_STORAGE_KEY), 'off')
  assert.equal(readLayerOn(st), false)
  writeLayerOn(st, true)
  assert.equal(readLayerOn(st), true)
}
{
  // ป้ายชื่อฟาร์ม: ค่าเริ่มต้น = เปิด · เก็บแยกคีย์จากชั้นวงรัศมี (ปิดชื่อแล้ววง/หมุดต้องไม่หาย และกลับกัน)
  const st = fakeStorage()
  assert.equal(readNamesOn(st), true, 'ยังไม่เคยตั้ง → แสดงชื่อ')
  writeNamesOn(st, false)
  assert.equal(st._m.get(NAMES_STORAGE_KEY), 'off')
  assert.equal(readNamesOn(st), false)
  assert.equal(readLayerOn(st), true, 'ปิดชื่อแล้วชั้นวงรัศมีต้องยังเปิดอยู่')
  writeNamesOn(st, true)
  assert.equal(readNamesOn(st), true)
  writeLayerOn(st, false)
  assert.equal(readNamesOn(st), true, 'ปิดชั้นวงรัศมีแล้วค่าชื่อต้องไม่ถูกแตะ (จำไว้ตอนเปิดกลับมา)')
  assert.notEqual(NAMES_STORAGE_KEY, LAYER_STORAGE_KEY)
  assert.notEqual(NAMES_STORAGE_KEY, HIDDEN_STORAGE_KEY)
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(readNamesOn(broken), true, 'อ่านไม่ได้ → แสดงชื่อ')
  assert.doesNotThrow(() => writeNamesOn(broken, false))
  assert.equal(readNamesOn(null), true)
}
{
  // เพดานจำนวนคีย์ กัน storage บวมถ้ามีบั๊กเขียนวน
  const st = fakeStorage()
  writeHiddenKeys(st, new Set(Array.from({ length: 900 }, (_, i) => `z:${i}`)))
  assert.equal(readHiddenKeys(st).size, 500)
}

console.log('adhoc-zones: ผ่านทั้งหมด')

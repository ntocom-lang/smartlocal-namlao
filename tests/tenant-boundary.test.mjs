// ตัวตรวจ "หมุดอยู่นอกเขตตำบลหรือไม่" (src/lib/tenantBoundary.js) — ไม่ต้องเปิดเบราว์เซอร์ ไม่ต่อเน็ต ไม่แตะ DB
// รันด้วย: node tests/tenant-boundary.test.mjs
//
// ทำไมต้องมี: ตัวนี้ตัดสินว่าจะ "เตือนประชาชน" หรือไม่ ถ้าผิดทางไหนก็เสียหาย —
//   เตือนมั่ว (หมุดอยู่ในเขตแต่ขึ้นเตือน) ทำให้ประชาชนเลิกเชื่อคำเตือนทุกครั้ง
//   ไม่เตือนทั้งที่ควรเตือน ทำให้เจ้าหน้าที่ต้องโทรถามกลับเหมือนเดิม
// ตรวจกับไฟล์ขอบเขตจริงใน public/boundaries ไม่ใช่รูปจำลอง และตรวจคณิตศาสตร์ระยะทางกับสูตร haversine
// ซึ่งเป็นคนละวิธีกับที่ตัวจริงใช้ (กันเทสต์ที่ตอบเฉลยของตัวเอง)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evaluatePoint, describeDistance, loadTenantBoundary, OUTSIDE_TOLERANCE_M } from '../src/lib/tenantBoundary.js'

const load = slug => JSON.parse(readFileSync(new URL(`../public/boundaries/${slug}.geojson`, import.meta.url), 'utf8'))
const namlao = load('namlao')
const thungkaew = load('thungkaew')
const tamnaktham = load('tamnaktham')
const outerRing = gj => gj.features[0].geometry.coordinates[0]

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }
const tAsync = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

// haversine (เมตร) — ใช้เป็นเฉลยอิสระของระยะไกล
const haversineM = (a, b) => {
  const R = 6_371_000, rad = d => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

console.log('จุดที่รู้ว่าอยู่ในตำบลจริง')
t('น้ำเลา: ศูนย์แผนที่ของระบบ (18.257853, 100.311334) อยู่ในเขต ไม่เตือน', () => {
  const r = evaluatePoint({ lat: 18.257853, lng: 100.311334 }, namlao)
  assert.equal(r.inside, true); assert.equal(r.warn, false); assert.equal(r.distanceM, 0)
})
t('ทุ่งแค้ว: พิกัดจากภาพของผู้ใช้ (18.301407, 100.151025) อยู่ในเขต ไม่เตือน', () => {
  const r = evaluatePoint({ lat: 18.301407, lng: 100.151025 }, thungkaew)
  assert.equal(r.inside, true); assert.equal(r.warn, false)
})
t('รับพิกัดเป็นสตริงได้ (ค่าจากฟอร์ม/URL) ผลเท่ากับตัวเลข', () => {
  assert.deepEqual(evaluatePoint({ lat: '18.257853', lng: '100.311334' }, namlao), evaluatePoint({ lat: 18.257853, lng: 100.311334 }, namlao))
})

console.log('จุดที่อยู่นอกเขต')
t('จุดทุ่งแค้วเทียบกับขอบเขตน้ำเลา → นอกเขต ห่างหลายกิโลเมตร เตือน', () => {
  const r = evaluatePoint({ lat: 18.301407, lng: 100.151025 }, namlao)
  assert.equal(r.inside, false); assert.equal(r.warn, true)
  assert.ok(r.distanceM > 5_000 && r.distanceM < 40_000, `ห่าง ${Math.round(r.distanceM)} ม.`)
})
t('จุดน้ำเลาเทียบกับขอบเขตทุ่งแค้ว และตำหนักธรรม → นอกเขตทั้งคู่ (กันสลับไฟล์ข้าม อปท.)', () => {
  for (const gj of [thungkaew, tamnaktham]) {
    const r = evaluatePoint({ lat: 18.257853, lng: 100.311334 }, gj)
    assert.equal(r.inside, false); assert.equal(r.warn, true)
  }
})
t('กรุงเทพฯ vs น้ำเลา: ระยะตรงกับ haversine ไปจุดยอดที่ใกล้ที่สุด (คนละวิธีกัน คลาดไม่เกิน 3%)', () => {
  const bkk = { lat: 13.7447, lng: 100.5331 }
  const r = evaluatePoint(bkk, namlao)
  const nearestVertex = Math.min(...outerRing(namlao).map(([lng, lat]) => haversineM(bkk, { lat, lng })))
  assert.equal(r.warn, true)
  // ระยะถึงเส้นขอบ ≤ ระยะถึงจุดยอดเสมอ และต่างกันน้อยมากเมื่อห่าง ~500 กม.
  assert.ok(r.distanceM <= nearestVertex * 1.005, `${r.distanceM} > ${nearestVertex}`)
  assert.ok(r.distanceM >= nearestVertex * 0.97, `${r.distanceM} << ${nearestVertex}`)
  assert.ok(r.distanceM > 400_000 && r.distanceM < 650_000)
})

console.log('ขอบเขตของระยะเว้น (OUTSIDE_TOLERANCE_M = ' + OUTSIDE_TOLERANCE_M + ' ม.)')
{
  // จุดยอดที่อยู่ตะวันออกสุด: ขยับไปทางตะวันออกต่อ = นอกเขตแน่นอน และจุดใกล้สุดบนเส้นคือจุดยอดนั้นเอง
  const east = outerRing(namlao).reduce((a, p) => (p[0] > a[0] ? p : a))
  const at = metersEast => ({ lat: east[1], lng: east[0] + metersEast / (111_195 * Math.cos((east[1] * Math.PI) / 180)) })
  t('นอกเส้น ~100 ม. (ใกล้เส้น) → นอกเขตแต่ไม่เตือน', () => {
    const r = evaluatePoint(at(100), namlao)
    assert.equal(r.inside, false); assert.equal(r.warn, false)
    assert.ok(Math.abs(r.distanceM - 100) < 3, `ได้ ${r.distanceM}`)
  })
  t('นอกเส้น ~420 ม. → เตือน', () => {
    const r = evaluatePoint(at(420), namlao)
    assert.equal(r.warn, true)
    assert.ok(Math.abs(r.distanceM - 420) < 5, `ได้ ${r.distanceM}`)
  })
  t('นอกเส้นพอดี ~300 ม. → ไม่เตือน (เตือนเมื่อ "เกิน" เท่านั้น)', () => {
    assert.equal(evaluatePoint(at(299), namlao).warn, false)
    assert.equal(evaluatePoint(at(305), namlao).warn, true)
  })
  t('ตั้งระยะเว้นเองได้ (ศูนย์ = เตือนทันทีที่นอกเส้น)', () => {
    assert.equal(evaluatePoint(at(100), namlao, 0).warn, true)
  })
  t('หมุดอยู่บนจุดยอดของเส้นพอดี → ไม่เตือนไม่ว่าจะนับเป็นในหรือนอก', () => {
    assert.equal(evaluatePoint({ lat: east[1], lng: east[0] }, namlao).warn, false)
  })
}

console.log('รูปทรงที่ไม่ใช่ polygon เดี่ยวธรรมดา')
t('polygon มีรู: จุดในรู = นอกเขต, จุดในเนื้อ = ในเขต', () => {
  const ring = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
  const donut = { type: 'Polygon', coordinates: [ring(100, 18, 100.1, 18.1), ring(100.04, 18.04, 100.06, 18.06)] }
  assert.equal(evaluatePoint({ lat: 18.05, lng: 100.05 }, donut).inside, false)
  assert.equal(evaluatePoint({ lat: 18.02, lng: 100.02 }, donut).inside, true)
})
t('MultiPolygon: อยู่ในชิ้นใดชิ้นหนึ่ง = ในเขต', () => {
  const ring = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
  const two = { type: 'MultiPolygon', coordinates: [[ring(100, 18, 100.1, 18.1)], [ring(101, 18, 101.1, 18.1)]] }
  assert.equal(evaluatePoint({ lat: 18.05, lng: 101.05 }, two).inside, true)
  assert.equal(evaluatePoint({ lat: 18.05, lng: 100.5 }, two).inside, false)
})
t('รับ Feature เดี่ยวและ geometry เปล่าๆ ได้เหมือน FeatureCollection', () => {
  const g = namlao.features[0]
  assert.equal(evaluatePoint({ lat: 18.257853, lng: 100.311334 }, g).inside, true)
  assert.equal(evaluatePoint({ lat: 18.257853, lng: 100.311334 }, g.geometry).inside, true)
})

console.log('ประเมินไม่ได้ → null (ผู้เรียกต้องถือว่าไม่เตือน)')
t('ไม่มี geojson / ไม่มีรูปที่ใช้ได้ / พิกัดเสีย', () => {
  const p = { lat: 18.25, lng: 100.3 }
  for (const bad of [null, undefined, {}, { type: 'FeatureCollection', features: [] }, 'x', { type: 'Point', coordinates: [100, 18] }]) {
    assert.equal(evaluatePoint(p, bad), null)
  }
  for (const badPoint of [null, {}, { lat: NaN, lng: 100 }, { lat: 91, lng: 100 }, { lat: 18, lng: 181 }, { lat: 'abc', lng: 100 }]) {
    assert.equal(evaluatePoint(badPoint, namlao), null)
  }
})

console.log('ข้อความระยะ')
t('describeDistance ปัดให้สมกับคำว่า "ประมาณ"', () => {
  assert.equal(describeDistance(420), '400 เมตร')
  assert.equal(describeDistance(2431), '2.4 กม.')
  assert.equal(describeDistance(612_345), '612 กม.')
  assert.equal(describeDistance(NaN), '')
  assert.equal(describeDistance(-5), '')
})

console.log('โหลดไฟล์ขอบเขต (จำลอง fetch)')
const realFetch = globalThis.fetch
const stubFetch = handler => { const calls = []; globalThis.fetch = async url => { calls.push(String(url)); return handler(String(url)) }; return calls }
const json = (body, ok = true) => ({ ok, json: async () => body })
try {
  await tAsync('ไฟล์ถูกต้อง → ได้ข้อมูลกลับ และขอครั้งเดียวแม้เรียกซ้ำ', async () => {
    const calls = stubFetch(() => json(namlao))
    const [a, b] = await Promise.all([loadTenantBoundary('slug-ok'), loadTenantBoundary('slug-ok')])
    assert.ok(a && a === b); assert.equal(calls.length, 1); assert.equal(calls[0], '/boundaries/slug-ok.geojson')
  })
  await tAsync('Cloudflare ตอบหน้า index.html พร้อม 200 (แปลง JSON ไม่ได้) → null ไม่ค้าง ไม่โยน error', async () => {
    stubFetch(() => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <') } }))
    assert.equal(await loadTenantBoundary('slug-html'), null)
  })
  await tAsync('ตอบ 404 → null', async () => {
    stubFetch(() => json(null, false))
    assert.equal(await loadTenantBoundary('slug-404'), null)
  })
  await tAsync('JSON ถูกแต่ไม่มี polygon → null', async () => {
    stubFetch(() => json({ type: 'FeatureCollection', features: [] }))
    assert.equal(await loadTenantBoundary('slug-empty'), null)
  })
  await tAsync('เครือข่ายล้ม → null และไม่จำความล้มเหลว (เปิดแผนที่ครั้งหน้าลองใหม่ได้)', async () => {
    let attempt = 0
    const calls = stubFetch(() => { attempt++; if (attempt === 1) throw new TypeError('Failed to fetch'); return json(namlao) })
    assert.equal(await loadTenantBoundary('slug-flaky'), null)
    assert.ok(await loadTenantBoundary('slug-flaky'))
    assert.equal(calls.length, 2)
  })
  await tAsync('slug แปลกปลอมไม่ถูกส่งออกไปเป็น path', async () => {
    const calls = stubFetch(() => json(namlao))
    for (const bad of ['../secret', 'a/b', '', '  ', null, undefined, 'x.geojson?y']) assert.equal(await loadTenantBoundary(bad), null)
    assert.equal(calls.length, 0)
  })
} finally {
  globalThis.fetch = realFetch
}

console.log(`\n✓ tenant-boundary: ผ่านทั้งหมด ${passed} ข้อ`)

// แคชค่าสถานการณ์น้ำในเครื่องผู้ชม (src/lib/waterCache.js) + จุดต่อในหน้า (WaterSituationPage.jsx) + ปุ่มเรดาร์ฝน
//   node tests/water-cache.test.mjs
// ตรวจ: อายุนับจากเวลาของข้อมูล ไม่ใช่เวลาบันทึก · แยกตาม อปท./สถานี · ของเสีย/เกินขนาด/storage พัง = ไม่แคช ไม่ล้ม
//       · หน้าใช้แคชเฉพาะตอนดึงไม่สำเร็จ (ไม่ขึ้นจอระหว่างรอ) · ปุ่มเรดาร์เป็นลิงก์ออกหน้าทางการ ไม่ฝังตัวเล่นบุคคลที่สาม
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  WATER_CACHE_MAX_AGE_MS, hydroCacheKey, readHydroCache, readSituationCache, saveHydroCache, saveSituationCache, situationCacheKey,
} from '../src/lib/waterCache.js'

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-28T06:00:00Z')
const iso = ms => new Date(ms).toISOString()
const memory = () => {
  const map = new Map()
  return { map, getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)) } }
}
const situation = (hoursAgo, extra = {}) => ({ synced_at: iso(NOW - hoursAgo * HOUR), stations: [{ station_type: 'rain', station_code: 'STN1', station_name: 'บ้านทดสอบ', rain_24h_mm: 3 }], warnings: [], ...extra })
const hydro = (hoursAgo, extra = {}) => ({ station: 'Y.38', points: [{ at: NOW - hoursAgo * HOUR, level: 0.2, discharge: 0.3 }], fetchedAt: iso(NOW - hoursAgo * HOUR), refreshFailed: false, ...extra })
let n = 0
const ok = name => { n++; console.log(`PASS  ${name}`) }

// 1) ไป-กลับ + แยกตาม อปท.
{
  const s = memory()
  assert.equal(saveSituationCache(s, 'T1', situation(1), NOW), true)
  const hit = readSituationCache(s, 'T1', NOW)
  assert.deepEqual(hit.value, situation(1))
  assert.equal(hit.dataAt, NOW - HOUR)
  assert.equal(readSituationCache(s, 'T2', NOW), null, 'อปท. อื่นต้องไม่เห็นแคชของ T1')
  // คัดลอกแคชของ T1 ไปไว้ใต้คีย์ของ T2 (เครื่องที่เปิดหลาย อปท. / ข้อมูลเพี้ยน) — ต้องไม่ยอมรับ เพราะ id ในแถวไม่ตรง
  s.map.set(situationCacheKey('T2'), s.map.get(situationCacheKey('T1')))
  assert.equal(readSituationCache(s, 'T2', NOW), null, 'แถวที่ id ไม่ตรงกับ อปท. ที่ถามต้องไม่ถูกใช้')
  ok('ไป-กลับ และแยกตาม อปท.')
}

// 2) อายุนับจากเวลาของข้อมูล ไม่ใช่เวลาที่บันทึก
{
  const s = memory()
  saveSituationCache(s, 'T1', situation(23), NOW)
  assert.ok(readSituationCache(s, 'T1', NOW), 'ข้อมูลอายุ 23 ชม. ยังใช้ได้')
  const s2 = memory()
  saveSituationCache(s2, 'T1', situation(25), NOW) // บันทึกเดี๋ยวนี้ แต่ข้อมูลเก่า 25 ชม.
  assert.equal(readSituationCache(s2, 'T1', NOW), null, 'บันทึกวันนี้แต่ข้อมูลเก่า 25 ชม. ต้องไม่ใช้')
  assert.equal(readSituationCache(s, 'T1', NOW + 2 * HOUR), null, 'เวลาผ่านไปจนข้อมูลเกิน 24 ชม. ต้องหมดอายุ')
  const future = memory()
  saveSituationCache(future, 'T1', situation(0), NOW)
  assert.ok(readSituationCache(future, 'T1', NOW - 4 * 60_000), 'นาฬิกาเครื่องเอียงไม่เกิน 5 นาทียังรับ')
  assert.equal(readSituationCache(future, 'T1', NOW - 2 * HOUR), null, 'ข้อมูลอยู่ในอนาคตเกินนาฬิกาเอียงที่ยอมรับ ต้องไม่ใช้')
  assert.equal(WATER_CACHE_MAX_AGE_MS, 24 * HOUR)
  ok('อายุนับจากเวลาของข้อมูล · หมดอายุ 24 ชม. · ไม่รับเวลาอนาคต')
}

// 3) ของที่ไม่ควรเก็บ
{
  const s = memory()
  assert.equal(saveSituationCache(s, 'T1', { stations: [] }, NOW), false, 'ไม่มี synced_at = ระบบยังไม่เคยดึงสำเร็จ ไม่มีอะไรให้เก็บ')
  assert.equal(saveSituationCache(s, 'T1', { synced_at: 'ไม่ใช่วันที่', stations: [] }, NOW), false)
  assert.equal(saveSituationCache(s, 'T1', { synced_at: iso(NOW), stations: null }, NOW), false)
  assert.equal(saveSituationCache(s, '', situation(1), NOW), false)
  assert.equal(saveSituationCache(s, 'T1', situation(1, { stations: Array.from({ length: 4000 }, (_, i) => ({ station_code: `S${i}`, station_name: 'ก'.repeat(80) })) }), NOW), false, 'ใหญ่ผิดปกติไม่เก็บ')
  assert.equal(s.map.size, 0)
  ok('ไม่เก็บข้อมูลที่ไม่มีเวลา/รูปผิด/ใหญ่ผิดปกติ')
}

// 4) ของเสียในที่เก็บ + storage พัง ต้องไม่ล้ม
{
  const s = memory()
  const key = situationCacheKey('T1')
  for (const raw of ['{ไม่ใช่ json', 'null', '[]', JSON.stringify({ v: 99, id: 'T1', dataAt: NOW, value: situation(0) }),
    JSON.stringify({ v: 1, id: 'T1', dataAt: 'x', value: situation(0) }),
    JSON.stringify({ v: 1, id: 'T1', dataAt: NOW, value: { stations: 'ไม่ใช่ลิสต์', synced_at: iso(NOW) } }),
    'x'.repeat(500_000)]) {
    s.map.set(key, raw)
    assert.equal(readSituationCache(s, 'T1', NOW), null)
  }
  // เปลี่ยน dataAt ในแถวให้ดูใหม่ ทั้งที่ข้อมูลข้างในเก่า — ต้องจับได้ (ไม่งั้นต่ออายุแคชปลอมๆ ได้)
  const stale = situation(30)
  s.map.set(key, JSON.stringify({ v: 1, id: 'T1', savedAt: NOW, dataAt: NOW - HOUR, value: stale }))
  assert.equal(readSituationCache(s, 'T1', NOW), null, 'dataAt ไม่ตรงกับ synced_at ในข้อมูล ต้องไม่ใช้')
  const broken = { getItem() { throw new Error('SecurityError') }, setItem() { throw new Error('QuotaExceededError') } }
  assert.equal(readSituationCache(broken, 'T1', NOW), null)
  assert.equal(saveSituationCache(broken, 'T1', situation(1), NOW), false)
  assert.equal(readHydroCache(broken, 'Y.38', NOW), null)
  assert.equal(saveHydroCache(broken, 'Y.38', hydro(1), NOW), false)
  assert.equal(readSituationCache(null, 'T1', NOW), null)
  assert.equal(saveSituationCache(null, 'T1', situation(1), NOW), false)
  ok('ของเสีย/เวอร์ชันอื่น/dataAt ปลอม/storage พัง/ไม่มี storage = ไม่แคช ไม่ล้ม')
}

// 5) รายงานรายชั่วโมง
{
  const s = memory()
  assert.equal(saveHydroCache(s, 'Y.38', hydro(1), NOW), true)
  const hit = readHydroCache(s, 'Y.38', NOW)
  assert.equal(hit.value.station, 'Y.38')
  assert.equal('refreshFailed' in hit.value, false, 'ไม่เก็บ refreshFailed — ให้หน้าตัดสินเองจากเวลาข้อมูล')
  assert.equal(readHydroCache(s, 'Y.20', NOW), null)
  assert.equal(saveHydroCache(memory(), 'Y.38', hydro(1, { refreshFailed: true }), NOW), false, 'ค่าเก่าที่ Worker ส่งมาตอนต้นทางล่ม ห้ามเขียนทับ (จะต่ออายุแคชด้วยค่าเดิม)')
  assert.equal(saveHydroCache(memory(), 'Y.38', hydro(1, { station: 'Y.20' }), NOW), false, 'สถานีไม่ตรงรหัสที่ขอ')
  assert.equal(saveHydroCache(memory(), 'Y.38', hydro(1, { points: null }), NOW), false)
  assert.equal(saveHydroCache(memory(), 'Y.38', hydro(1, { fetchedAt: 'x' }), NOW), false)
  const old = memory()
  saveHydroCache(old, 'Y.38', hydro(26), NOW)
  assert.equal(readHydroCache(old, 'Y.38', NOW), null, 'รายงานอายุ 26 ชม. ไม่ใช้')
  assert.notEqual(hydroCacheKey('Y.38'), hydroCacheKey('Y.20'))
  ok('รายงานรายชั่วโมง: ไป-กลับ · ไม่เก็บค่าที่ล้มเหลว/ผิดสถานี · หมดอายุ')
}

// 6) จุดต่อในหน้า — อ่านจากซอร์ส
const page = readFileSync(new URL('../src/pages/WaterSituationPage.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const count = (text, part) => text.split(part).length - 1
{
  assert.equal(count(page, 'readSituationCache('), 1, 'อ่านแคชค่าสถานีได้ที่เดียว')
  const apply = page.slice(page.indexOf('const applyResult = useCallback'), page.indexOf('}, [tenantId])'))
  assert.ok(apply.length > 100, 'หา applyResult ไม่เจอ')
  const errorGate = apply.indexOf('if (gotLiveData.current) return')
  assert.ok(errorGate > 0 && apply.indexOf('readSituationCache(') > errorGate, 'อ่านแคชได้หลังตรวจว่าเคยได้ค่าจริงแล้วเท่านั้น (ไม่ทับค่าสดด้วยค่าเก่า)')
  const success = apply.slice(apply.indexOf('if (!error) {'), apply.indexOf('if (gotLiveData.current) return'))
  assert.ok(success.includes('saveSituationCache(') && success.includes('setFromCache(false)') && success.includes('gotLiveData.current = true'), 'ดึงสำเร็จ: เก็บแคช · ล้างป้ายแคช · จำว่าเคยได้ค่าจริง')
  assert.ok(!apply.slice(0, apply.indexOf('if (!error) {')).includes('readSituationCache'), 'ห้ามอ่านแคชก่อนรู้ผลการดึง')
  // ห้ามเอาแคชขึ้นจอระหว่างรอ: effect โหลดครั้งแรกต้องไม่แตะแคช
  const firstLoad = page.slice(page.indexOf('fetchSituation(tenantId)\n      .then'), page.indexOf('}, [tenantId, applyResult])'))
  assert.ok(firstLoad.length > 50 && !firstLoad.includes('Cache'), 'effect โหลดครั้งแรกต้องไม่อ่านแคช (กันตัวเลขเก่าวาบก่อนค่าจริง)')
  const hydroCatch = page.slice(page.indexOf('} catch {\n        // ดึงไม่สำเร็จ'), page.indexOf('}, [hydroCode])'))
  assert.ok(hydroCatch.includes('readHydroCache(') && hydroCatch.includes('failed: true'), 'รายงานรายชั่วโมงจากแคชต้องติด failed: true เสมอ')
  assert.ok(page.includes('saveHydroCache(browserStorage(), hydroCode, report)'))
  ok('หน้าใช้แคชเฉพาะตอนดึงไม่สำเร็จ · เก็บแคชเมื่อสำเร็จ · ไม่ขึ้นจอระหว่างรอ')
}
{
  const sync = page.slice(page.indexOf('function SyncStatus'), page.indexOf('// แถบเตือนบนสุดของหน้า'))
  assert.ok(sync.indexOf('if (fromCache)') > 0 && sync.indexOf('if (fromCache)') < sync.indexOf('if (!syncedAt)'), 'ป้ายแคชต้องมาก่อนสถานะอื่นของแถบ')
  assert.ok(sync.includes('data-water-from-cache') && sync.includes('measuredAtText(syncedAt, now)') && sync.includes('ค่าจริงตอนนี้อาจต่างจากที่เห็น'), 'ป้ายแคชต้องบอกเวลาข้อมูลและเตือนว่าอาจต่างจากค่าจริง')
  assert.ok(sync.includes('role="alert"'))
  ok('ป้ายแคชมาก่อนสถานะอื่น · บอกเวลาข้อมูล · เตือนว่าอาจต่างจากค่าจริง')
}

// 7) ปุ่มเรดาร์ฝน
{
  const block = page.slice(page.indexOf('const RADAR_LINKS = ['), page.indexOf(']\n', page.indexOf('const RADAR_LINKS = [')) + 1)
  const hrefs = [...block.matchAll(/href: '([^']+)'/g)].map(m => m[1])
  assert.ok(hrefs.length >= 1)
  const allowed = new Set(['www.thaiwater.net', 'weather.tmd.go.th'])
  for (const href of hrefs) {
    const url = new URL(href)
    assert.equal(url.protocol, 'https:')
    assert.ok(allowed.has(url.hostname), `เรดาร์ต้องเป็นหน้าหน่วยงานทางการที่ตรวจแล้ว: ${href}`)
  }
  const comp = page.slice(page.indexOf('function RadarLinks'), page.indexOf('function SourceNote'))
  assert.ok(comp.includes('target="_blank"') && comp.includes('rel="noopener noreferrer"'))
  assert.ok(comp.includes('min-h-[48px]'), 'ปุ่มต้องสูงอย่างน้อย 44px')
  assert.ok(comp.includes('ไม่ใช่ประกาศเตือนภัย'), 'ต้องกำกับว่าไม่ใช่ประกาศเตือนภัย')
  assert.ok(!/<iframe|<script|windy/i.test(page), 'ห้ามฝังตัวเล่นหรือสคริปต์บุคคลที่สามในหน้า')
  assert.ok(page.indexOf('<RadarLinks') > page.indexOf('<SmallReservoirSection') && page.indexOf('<RadarLinks') < page.indexOf('<SourceNote'), 'เรดาร์อยู่หลังส่วนข้อมูล ก่อนกล่องที่มา')
  ok('ปุ่มเรดาร์: ลิงก์ออกหน้าทางการที่ตรวจแล้ว · แท็บใหม่ · ไม่ฝังบุคคลที่สาม · กำกับว่าไม่ใช่ประกาศ')
}

console.log(`\n${n} ชุดผ่าน`)

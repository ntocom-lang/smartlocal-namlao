// เทสต์ตรรกะ "หมู่ของฉัน" (src/lib/waterVillage.js) + กฎของ migration 3 ไฟล์
// จุดที่ต้องไม่พลาด: (1) "ปกติ" ห้ามขึ้นเมื่อมีสถานีที่ผูกไว้ไม่มีค่าใหม่ (2) "ระวังสูง" ต้องตรงกับ buildAlerts() เดิมทุกข้อ
// (3) สถานีที่ไม่ได้ผูกกับหมู่ต้องไม่กระทบสถานะของหมู่ (YOM003 เป็นทั้งสถานีฝนและระดับน้ำ)
// รันด้วย: node tests/water-village.test.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { buildAlerts } from '../src/lib/waterSituation.js'
import {
  LINKABLE_TYPES, VILLAGE_NEARBY_KM, VILLAGE_STATUSES,
  bankTextCm, levelTrendText, loadChosenMoo, rankStations, resolveLinks, saveChosenMoo, stationDistance,
  stationIsFresh, suggestStations, villageFacts, villageStatus, villageTitle,
} from '../src/lib/waterVillage.js'

const now = Date.parse('2026-10-15T10:00:00Z')
const ago = hours => new Date(now - hours * 3600_000).toISOString()

const rain = (code, mm, hoursAgo = 0.5, extra = {}) => ({
  station_type: 'rain', station_code: code, station_name: `ฝน ${code}`, rain_24h_mm: mm, recorded_at: ago(hoursAgo), ...extra,
})
const level = (code, diff, hoursAgo = 0.5, extra = {}) => ({
  station_type: 'waterlevel', station_code: code, station_name: `น้ำ ${code}`, river_name: 'แม่น้ำยม',
  bank_diff_m: diff, waterlevel_msl: 100, recorded_at: ago(hoursAgo), ...extra,
})
const dam = (code, pct, hoursAgo = 1, extra = {}) => ({
  station_type: 'dam', station_code: code, station_name: `อ่าง ${code}`, storage_percent: pct, recorded_at: ago(hoursAgo), ...extra,
})
const link = s => ({ station_type: s.station_type, station_code: s.station_code })
const villageOf = (...stations) => ({ moo_no: 5, name: 'บ้านห้วยสัก', latitude: null, longitude: null, stations: stations.map(link) })
const statusOf = (stations, linked = stations, warnings = []) =>
  villageStatus({ village: villageOf(...linked), stations, warnings, now })

// ── ตัวช่วยแปลงค่า ──
{
  assert.equal(bankTextCm(0.85), 'ต่ำกว่าตลิ่ง 85 ซม.')
  assert.equal(bankTextCm('2.10'), 'ต่ำกว่าตลิ่ง 210 ซม.', 'ค่าจาก RPC มาเป็นสตริงได้')
  assert.equal(bankTextCm(0), 'ระดับน้ำเสมอตลิ่ง')
  assert.equal(bankTextCm(0.004), 'ระดับน้ำเสมอตลิ่ง')
  assert.equal(bankTextCm(-0.12), 'สูงกว่าตลิ่ง 12 ซม.')
  assert.equal(bankTextCm(0.006), 'ต่ำกว่าตลิ่ง 1 ซม.', 'ไม่ปัดเหลือ 0 ซม. ทั้งที่ยังไม่เสมอตลิ่ง')
  for (const empty of [null, undefined, '', 'abc']) assert.equal(bankTextCm(empty), null, `ว่าง (${empty}) ต้องไม่กลายเป็น 0`)

  const trend = (now2, prev, prevAt = ago(1.2)) => levelTrendText({ waterlevel_msl: now2, prev_waterlevel_msl: prev, prev_recorded_at: prevAt }, now)
  assert.ok(trend(100.04, 100).startsWith('สูงขึ้น 4 ซม.'), trend(100.04, 100))
  assert.ok(trend(99.9, 100).startsWith('ลดลง 10 ซม.'))
  assert.ok(trend(100.01, 100).startsWith('ทรงตัว'), 'ต่ำกว่า 2 ซม. ถือว่าทรงตัวตามเกณฑ์เดิม')
  assert.equal(trend(100.04, null), null, 'ไม่มีรอบก่อนหน้า = ไม่เดา')
  assert.equal(levelTrendText({}, now), null)
}

// ── ความสด: ฝน/ระดับน้ำ 3 ชม. · อ่าง 48 ชม. · ต้องมีตัวเลขของตัวชี้วัดนั้นจริง ──
{
  assert.equal(stationIsFresh(rain('R', 0, 2.9), now), true)
  assert.equal(stationIsFresh(rain('R', 0, 3.1), now), false)
  assert.equal(stationIsFresh(level('L', 1.5, 2.9), now), true)
  assert.equal(stationIsFresh(level('L', 1.5, 3.1), now), false)
  assert.equal(stationIsFresh(dam('D', 50, 47), now), true)
  assert.equal(stationIsFresh(dam('D', 50, 49), now), false)
  assert.equal(stationIsFresh(level('L', null), now), false, 'มีเวลาวัดแต่ไม่มีตัวเลข = ไม่มีค่า (ห้ามกลายเป็น 0 = เสมอตลิ่ง)')
  assert.equal(stationIsFresh(rain('R', ''), now), false)
  assert.equal(stationIsFresh({ station_type: 'rain', rain_24h_mm: 0 }, now), false, 'ไม่มีเวลาวัด')
  assert.equal(stationIsFresh({ station_type: 'ews', situation_level: 2, recorded_at: ago(0) }, now), false, 'ชนิดที่ไม่ใช่ตัวแทนของหมู่')
  assert.equal(stationIsFresh(null, now), false)
}

// ── จับคู่การผูกด้วย (ชนิด, รหัส) ──
{
  assert.deepEqual(LINKABLE_TYPES, ['rain', 'waterlevel', 'dam'])
  const yomRain = rain('YOM003', 0)
  const yomLevel = level('YOM003', 4)
  const { found, missing } = resolveLinks(villageOf(yomLevel), [yomRain, yomLevel])
  assert.deepEqual(found, [yomLevel], 'รหัสเดียวกันคนละชนิดต้องไม่ปนกัน')
  assert.deepEqual(missing, [])
  const gone = resolveLinks({ stations: [{ station_type: 'rain', station_code: 'X9' }] }, [yomRain])
  assert.deepEqual(gone.found, [])
  assert.equal(gone.missing.length, 1)
  assert.deepEqual(resolveLinks(null, null), { found: [], missing: [] }, 'ข้อมูลว่างต้องไม่โยน error')
  assert.equal(resolveLinks({ stations: [{ station_type: 'ews', station_code: 'E' }] }, [{ station_type: 'ews', station_code: 'E' }]).found.length, 0,
    'สถานีเตือนภัยผูกเดี่ยวไม่ได้')
}

// ── กฎสถานะ 4 ระดับ ──
{
  // ปกติ: ทุกสถานีที่ผูกสดและไม่ถึงเกณฑ์
  const okRain = rain('R1', 0)
  const okLevel = level('L1', 2.1)
  let s = statusOf([okRain, okLevel])
  assert.equal(s.status, 'ok')
  assert.equal(s.label, 'ค่าที่วัดได้ปกติ')
  assert.deepEqual(s.stale, [])

  // ฝนหนัก (35–90 มม.) ไม่ดันสถานะ · อ่าง "น้ำมาก" (80–100%) ไม่ดันสถานะ
  assert.equal(statusOf([rain('R1', 35.1), level('L1', 2.1)]).status, 'ok')
  assert.equal(statusOf([rain('R1', 90.0), level('L1', 2.1)]).status, 'ok', '90.0 ยังเป็นฝนหนัก ขอบ "หนักมาก" เริ่ม 90.1')
  assert.equal(statusOf([level('L1', 2.1), dam('D1', 95)]).status, 'ok')
  assert.equal(statusOf([level('L1', 2.1), dam('D1', 100)]).status, 'ok', '100% พอดียังไม่ใช่ "เกินความจุ"')

  // เฝ้าระวัง: ระดับน้ำต่ำกว่าตลิ่งไม่เกิน 1 ม. (1.00 พอดีนับเป็นเฝ้าระวัง ตามที่เจ้าของระบบเลือก)
  s = statusOf([okRain, level('L1', 0.85)])
  assert.equal(s.status, 'watch')
  assert.equal(s.reason, 'ระดับน้ำที่น้ำ L1 ต่ำกว่าตลิ่ง 85 ซม. (ไม่ถึง 1 ม.)')
  assert.equal(statusOf([level('L1', 1)]).status, 'watch')
  assert.equal(statusOf([level('L1', 1.01)]).status, 'ok')
  assert.equal(statusOf([level('L1', 0.01)]).status, 'watch')

  // ระวังสูง: ตรงกับ buildAlerts() เดิม
  s = statusOf([okRain, level('L1', 0)])
  assert.equal(s.status, 'high')
  assert.equal(s.reason, 'ระดับน้ำที่น้ำ L1 ระดับน้ำเสมอตลิ่ง')
  assert.equal(statusOf([level('L1', -0.35)]).status, 'high')
  assert.equal(statusOf([level('L1', -0.35)]).reason, 'ระดับน้ำที่น้ำ L1 สูงกว่าตลิ่ง 35 ซม.')
  s = statusOf([rain('R1', 90.1), level('L1', 2.1)])
  assert.equal(s.status, 'high')
  assert.equal(s.reason, 'ฝนสะสม 24 ชม. ที่ฝน R1 90.1 มม. (ฝนหนักมาก)')
  s = statusOf([level('L1', 2.1), dam('D1', 100.5)])
  assert.equal(s.status, 'high')
  assert.ok(s.reason.includes('เกินความจุที่ระดับเก็บกัก'), s.reason)

  // ข้อความ สสน. ระดับอำเภอ: ใช้กับทุกหมู่ รวมหมู่ที่ยังไม่ผูกสถานี (เหมือนแถบหน้าแรก)
  const warning = { issued_at: ago(2), message: 'เฝ้าระวังน้ำหลาก', station_name: 'สถานี X' }
  s = statusOf([okRain, level('L1', 2.1)], [okRain, level('L1', 2.1)], [warning])
  assert.equal(s.status, 'high')
  assert.equal(s.reason, 'มีข้อความเตือนจาก สสน. ในอำเภอ')
  assert.equal(statusOf([], [], [warning]).status, 'high', 'หมู่ที่ยังไม่ผูกสถานีก็ต้องไม่บอกว่า "ไม่มีข้อมูล" ใต้แถบที่ขึ้นเตือน')
  const oldWarning = { issued_at: ago(25), message: 'เก่า' }
  assert.equal(statusOf([okRain, level('L1', 2.1)], undefined, [oldWarning]).status, 'ok', 'ข้อความเก่ากว่า 24 ชม. ไม่นับ')

  // ลำดับชนะ: high > watch > nodata > ok
  assert.equal(statusOf([level('L1', 0), level('L2', 0.5)]).status, 'high')
  assert.equal(statusOf([level('L1', 0.5), level('L2', 3, 5)]).status, 'watch', 'สถานีหนึ่งค้าง อีกสถานีถึงเฝ้าระวังแล้ว ต้องบอก "เฝ้าระวัง"')
  assert.equal(statusOf([level('L1', 0.5), level('L2', 3, 5)]).stale.length, 1, 'แต่ยังต้องบอกว่ามีสถานีค้าง')
}

// ── "ข้อมูลไม่พอ" ห้ามกลายเป็น "ปกติ" ──
{
  // ไม่ผูกสถานี
  let s = villageStatus({ village: { moo_no: 1, stations: [] }, stations: [rain('R1', 0)], now })
  assert.equal(s.status, 'nodata')
  assert.equal(s.reason, 'หมู่นี้ยังไม่ได้เลือกสถานีวัด')
  assert.equal(s.linkedCount, 0)

  // สถานีที่ผูกถูกถอด
  s = villageStatus({ village: { moo_no: 1, stations: [{ station_type: 'rain', station_code: 'X9' }] }, stations: [rain('R1', 0)], now })
  assert.equal(s.status, 'nodata')
  assert.equal(s.missingCount, 1)
  assert.equal(s.reason, 'สถานีที่เลือกไว้ถูกถอดออกจากระบบ')

  // สถานีหนึ่งปกติ อีกสถานีค้าง → ห้ามบอกปกติ (นี่คือกรณีที่ปรับเกณฑ์ผิดแล้วเสี่ยงที่สุด)
  s = statusOf([rain('R1', 0), level('L1', 3, 3.5)])
  assert.equal(s.status, 'nodata')
  assert.equal(s.reason, 'สถานีน้ำ L1 ไม่มีค่าใหม่')
  assert.equal(s.stale.length, 1)

  // ค่าว่างต้องไม่กลายเป็น 0 (เสมอตลิ่ง) หรือ "ปกติ"
  assert.equal(statusOf([level('L1', null)]).status, 'nodata')
  assert.equal(statusOf([level('L1', '')]).status, 'nodata')
  assert.equal(statusOf([rain('R1', null)]).status, 'nodata')

  // สถานีที่ค้างไม่ถูกนับเป็นเรื่องเตือน (buildAlerts กรองให้) — น้ำล้นตลิ่งเมื่อ 4 ชม. ก่อนไม่ทำให้ "ระวังสูง"
  assert.equal(statusOf([level('L1', -0.2, 4)]).status, 'nodata')
  // ... และค่าที่ถึงเกณฑ์ "เฝ้าระวัง" แต่ค้างก็ไม่นับเช่นกัน — ค่าเก่า 4 ชม. ไม่ใช่สถานการณ์ตอนนี้
  assert.equal(statusOf([level('L1', 0.5, 4)]).status, 'nodata')
  assert.equal(statusOf([level('L1', 0.5, 2.9)]).status, 'watch', 'ก่อนครบ 3 ชม. ยังสด')

  // รายการสถานีทั้งหมดว่าง/ไม่ใช่อาร์เรย์ ต้องไม่โยน error
  assert.equal(villageStatus({ village: villageOf(rain('R1', 0)), stations: null, now }).status, 'nodata')
  assert.equal(villageStatus({ village: null, stations: [], now }).status, 'nodata')
}

// ── สถานีที่ไม่ได้ผูกต้องไม่กระทบหมู่ ──
{
  const yomRain = rain('YOM003', 0)
  const yomLevelOver = level('YOM003', -0.5)
  // หมู่ผูกแค่ "ฝน YOM003" ส่วนระดับน้ำ YOM003 ล้นตลิ่ง → หมู่นี้ต้องไม่ถูกลากเป็นระวังสูง
  assert.equal(statusOf([yomRain, yomLevelOver], [yomRain]).status, 'ok')
  assert.equal(statusOf([yomRain, yomLevelOver], [yomLevelOver]).status, 'high')
  // สถานีอื่นของ อปท. ที่ไม่ได้ผูก ไม่นับ
  assert.equal(statusOf([rain('R1', 0), level('L9', -1)], [rain('R1', 0)]).status, 'ok')
}

// ── ตรงกับ buildAlerts() เดิมทุกกรณี: "ระวังสูง" ⇔ buildAlerts().any (สุ่มแบบกำหนด seed ไว้ซ้ำได้) ──
{
  let seed = 20261015
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
  const pick = list => list[Math.floor(rnd() * list.length)]
  const ages = [0.2, 2.5, 3.5, 30, 60]
  let highCount = 0
  for (let i = 0; i < 500; i++) {
    const stations = []
    if (rnd() < 0.8) stations.push(rain('R1', pick([0, 12, 36, 90, 90.1, 140, null]), pick(ages)))
    if (rnd() < 0.8) stations.push(level('L1', pick([3, 1.2, 1, 0.4, 0, -0.3, null]), pick(ages)))
    if (rnd() < 0.5) stations.push(dam('D1', pick([20, 79, 85, 100, 101, null]), pick([1, 40, 60])))
    const warnings = rnd() < 0.2 ? [{ issued_at: ago(pick([1, 23, 30])), message: 'ข้อความ' }] : []
    const expected = buildAlerts({
      rain: stations.filter(s => s.station_type === 'rain'), levels: stations.filter(s => s.station_type === 'waterlevel'),
      dams: stations.filter(s => s.station_type === 'dam'), warnings, now,
    }).any
    const status = statusOf(stations, stations, warnings).status
    assert.equal(status === 'high', expected, `รอบ ${i}: ${JSON.stringify({ stations, warnings, status, expected })}`)
    if (expected) highCount++
    if (status === 'ok') assert.ok(stations.length > 0 && stations.every(s => stationIsFresh(s, now)), `รอบ ${i}: "ปกติ" ต้องสดครบทุกสถานี`)
  }
  assert.ok(highCount > 30 && highCount < 470, `ชุดสุ่มต้องครอบทั้งกรณีเตือนและไม่เตือน (ได้ ${highCount})`)
}

// ── ข้อเท็จจริงรายสถานีบนการ์ด ──
{
  const village = { moo_no: 5, latitude: 18.31, longitude: 100.14, stations: [] }
  const r = rain('RES038', 38, 0.5, { station_name: 'อ่างห้วยยอย', tambon_name: 'ทุ่งแค้ว', amphoe_name: 'หนองม่วงไข่', latitude: 18.30968, longitude: 100.13674, distance_km: 1.8 })
  const l = level('YOM003', 0.85, 0.5, { station_name: 'หนองม่วงไข่', tambon_name: 'น้ำรัด', amphoe_name: 'หนองม่วงไข่', latitude: 18.26591, longitude: 100.17706, distance_km: 4.8, waterlevel_msl: 143.14, prev_waterlevel_msl: 143.1, prev_recorded_at: ago(1.5) })
  const d = dam('D1', 73.2, 3, { station_name: 'อ่างแม่ถาง' })
  const gone = { station_type: 'rain', station_code: 'X9' }
  const facts = villageFacts({ village: { ...village, stations: [link(r), link(l), link(d), gone] }, stations: [r, l, d], homeAmphoe: 'หนองม่วงไข่', now })
  assert.deepEqual(facts.map(f => f.key), ['rain:RES038', 'waterlevel:YOM003', 'dam:D1', 'rain:X9'])
  assert.equal(facts[0].value, '38 มม.')
  assert.equal(facts[0].note, 'ฝนหนัก', 'ฝนหนักเป็นบรรทัดข้อเท็จจริง ไม่ใช่สถานะ')
  assert.equal(facts[0].place, 'ต.ทุ่งแค้ว')
  assert.equal(facts[0].distanceFrom, 'village', 'มีพิกัดหมู่ → วัดจากหมู่')
  assert.ok(facts[0].distanceKm > 0 && facts[0].distanceKm < 3, String(facts[0].distanceKm))
  assert.equal(facts[1].value, 'ต่ำกว่าตลิ่ง 85 ซม.')
  assert.ok(facts[1].note.startsWith('สูงขึ้น 4 ซม.'), facts[1].note)
  assert.equal(facts[1].river, 'แม่น้ำยม')
  assert.equal(facts[2].value, '73.2% ของความจุ')
  assert.equal(facts[2].fresh, true)
  assert.equal(facts[3].missing, true)
  assert.equal(facts[3].fresh, false)
  assert.equal(villageFacts({ village: { stations: [link(r)] }, stations: [r], now })[0].distanceFrom, 'office', 'ไม่มีพิกัดหมู่ → ถอยไปใช้ระยะจากสำนักงาน และบอกที่มา')
  const stale = villageFacts({ village: { stations: [link(rain('R', 5, 9))] }, stations: [rain('R', 5, 9)], now })[0]
  assert.equal(stale.fresh, false)
}

// ── ระยะและข้อแนะนำสถานี ──
{
  assert.deepEqual(stationDistance({}, { distance_km: 4.8 }), { km: 4.8, from: 'office' })
  assert.deepEqual(stationDistance({}, { distance_km: '2' }), { km: 2, from: 'office' })
  assert.deepEqual(stationDistance({}, {}), { km: null, from: null })
  assert.deepEqual(stationDistance({}, { distance_km: -1 }), { km: null, from: null }, 'ระยะติดลบ = ข้อมูลเสีย ไม่เดา')
  assert.deepEqual(stationDistance({ latitude: 18, longitude: 100 }, { latitude: 18, longitude: 100.0001 }).from, 'village')
  assert.equal(stationDistance({ latitude: null, longitude: 100 }, { latitude: 18, longitude: 100, distance_km: 3 }).from, 'office', 'พิกัดหมู่ไม่ครบ = ไม่ใช้')

  assert.equal(VILLAGE_NEARBY_KM, 5)
  const near = rain('R-near', 0, 0.5, { distance_km: 1.8 })
  const edge = rain('R-edge', 0, 0.5, { distance_km: 5 })
  const far = rain('R-far', 0, 0.5, { distance_km: 5.01 })
  const unknown = rain('R-unknown', 0, 0.5, {})
  const lvNear = level('L-near', 3, 0.5, { distance_km: 4.8 })
  const lvFar = level('L-far', 3, 0.5, { distance_km: 9 })
  const dm = dam('D-near', 50, 1, { distance_km: 0.5 })
  const ews = { station_type: 'ews', station_code: 'R-near', distance_km: 0.1, recorded_at: ago(0) }

  let sug = suggestStations({}, [far, edge, near, unknown, lvFar, lvNear, dm, ews])
  assert.equal(sug.rain.station_code, 'R-near', 'ฝนที่ใกล้สุด')
  assert.equal(sug.waterlevel.station_code, 'L-near')
  assert.equal(sug.list.length, 2, 'ไม่แนะนำอ่างและสถานีเตือนภัย')
  assert.equal(suggestStations({}, [edge]).rain.station_code, 'R-edge', '5.0 กม. พอดียังนับว่าใกล้')
  assert.equal(suggestStations({}, [far, unknown]).rain, null, 'เกิน 5 กม. หรือไม่รู้ระยะ ไม่แนะนำ')
  assert.deepEqual(suggestStations({}, [lvFar]), { rain: null, waterlevel: null, list: [] })
  assert.deepEqual(suggestStations(null, null), { rain: null, waterlevel: null, list: [] })

  // พิกัดหมู่ชนะระยะสำนักงาน: สถานีที่ห่างสำนักงาน 1.8 กม. แต่ห่างหมู่ ~25 กม. ต้องไม่ถูกแนะนำ
  const farFromVillage = rain('R-x', 0, 0.5, { distance_km: 1.8, latitude: 18.3, longitude: 100.1 })
  assert.equal(suggestStations({ latitude: 18.5, longitude: 100.3 }, [farFromVillage]).rain, null)
  assert.equal(suggestStations({ latitude: 18.301, longitude: 100.101 }, [farFromVillage]).rain.station_code, 'R-x')

  const ranked = rankStations({}, [lvFar, far, dm, near, lvNear, ews])
  assert.deepEqual(ranked.map(r => r.station.station_code), ['R-near', 'R-far', 'L-near', 'L-far', 'D-near'], 'ฝน → ระดับน้ำ → อ่าง แต่ละชนิดใกล้ไปไกล ไม่มี ews')
  assert.deepEqual(ranked.map(r => r.nearby), [true, false, true, false, true])
}

// ── หัวข้อหมู่ และการจำหมู่ที่เลือก ──
{
  assert.equal(villageTitle({ moo_no: 5, name: ' บ้านห้วยสัก ' }), 'หมู่ 5 บ้านห้วยสัก')
  assert.equal(villageTitle({ moo_no: 2, name: null }), 'หมู่ 2')

  const store = new Map()
  const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
  const villages = [{ moo_no: 1 }, { moo_no: 5 }]
  assert.equal(loadChosenMoo(storage, 'thungkaew', villages), null)
  saveChosenMoo(storage, 'thungkaew', 5)
  assert.equal(loadChosenMoo(storage, 'thungkaew', villages), 5)
  assert.equal(loadChosenMoo(storage, 'namlao', villages), null, 'แยกตาม tenant')
  assert.equal(loadChosenMoo(storage, 'thungkaew', [{ moo_no: 1 }]), null, 'หมู่ที่ถูกลบออกจากทะเบียนแล้ว = ไม่เลือกให้')
  store.set('water-village:thungkaew', 'abc')
  assert.equal(loadChosenMoo(storage, 'thungkaew', villages), null, 'ค่าเสีย = ไม่เลือก')
  saveChosenMoo(storage, 'thungkaew', null)
  assert.equal(store.has('water-village:thungkaew'), false)
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.equal(loadChosenMoo(broken, 'thungkaew', villages), null, 'localStorage ใช้ไม่ได้ต้องไม่ทำหน้าพัง')
  assert.doesNotThrow(() => saveChosenMoo(broken, 'thungkaew', 5))
  assert.equal(loadChosenMoo(undefined, 'thungkaew', villages), null)
}

assert.deepEqual(Object.keys(VILLAGE_STATUSES), ['ok', 'nodata', 'watch', 'high'])
assert.deepEqual(Object.values(VILLAGE_STATUSES).map(s => s.label), ['ค่าที่วัดได้ปกติ', 'ข้อมูลไม่พอ', 'เฝ้าระวัง', 'ระวังสูง'])

// ── migration 3 ไฟล์: สิทธิ์ ข้อจำกัด และการไม่ทับของเดิม ──
{
  const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
  const cols = read('20261015100000_water_village_coords_columns.sql')
  const table = read('20261015100100_water_village_stations_table.sql')
  const rls = read('20261015100200_water_village_rls_rpc.sql')
  const noComments = sql => sql.replace(/--.*$/gm, '')

  // ไฟล์ 1: เพิ่มคอลัมน์ว่างล้วน ไม่แตะอย่างอื่น (NOTES §3: 1 ไฟล์ = 1 เฟส)
  assert.match(noComments(cols), /ADD COLUMN IF NOT EXISTS latitude\s+numeric/)
  assert.match(noComments(cols), /ADD COLUMN IF NOT EXISTS longitude\s+numeric/)
  assert.doesNotMatch(noComments(cols), /CREATE (TABLE|FUNCTION)|CONSTRAINT|POLICY/i, 'ไฟล์ 1 มีแต่ ADD COLUMN')

  // ไฟล์ 2: ตารางผูก — คีย์ 4 ช่อง และ FK ทั้งสองทางตรงกับ UNIQUE ที่มีจริง
  const t = noComments(table)
  assert.match(t, /PRIMARY KEY \(municipality_id, moo_no, station_type, station_code\)/)
  assert.match(t, /REFERENCES public\.waste_villages \(municipality_id, moo_no\) ON DELETE CASCADE/)
  assert.match(t, /REFERENCES public\.water_station_config \(municipality_id, station_type, station_code\) ON DELETE CASCADE/)
  assert.match(t, /station_type\s+text\s+NOT NULL CHECK \(station_type IN \('rain', 'waterlevel', 'dam'\)\)/)
  assert.doesNotMatch(t, /POLICY|GRANT|REVOKE/i, 'สิทธิ์อยู่ไฟล์ 3')
  assert.match(read('20260914100000_waste_schedule_tables.sql'), /UNIQUE \(municipality_id, moo_no\)/, 'FK ไปหมู่ต้องมี UNIQUE รองรับ')
  assert.match(read('20260918150000_water_station_config_table.sql'), /UNIQUE \(municipality_id, station_type, station_code\)/, 'FK ไปสถานีต้องมี UNIQUE รองรับ')

  // ไฟล์ 3: ถอนสิทธิ์ก่อนให้ · ไม่มี TRUNCATE/UPDATE ให้ authenticated · ไม่ให้ anon แตะตาราง
  const r = noComments(rls)
  const revokeAt = r.indexOf('REVOKE ALL ON public.water_village_stations FROM anon, PUBLIC')
  const grantAt = r.indexOf('GRANT SELECT, INSERT, DELETE ON public.water_village_stations TO authenticated')
  assert.ok(revokeAt >= 0 && grantAt >= 0 && revokeAt < grantAt,
    'ต้องมีทั้งสองบรรทัด และถอนสิทธิ์ก่อนให้ (ค่าเริ่มต้นของ Supabase ให้ anon ALL รวม TRUNCATE)')
  assert.match(r, /REVOKE TRUNCATE, TRIGGER, REFERENCES, UPDATE ON public\.water_village_stations FROM authenticated/)
  assert.doesNotMatch(r, /GRANT[^;]*public\.water_village_stations[^;]*TO[^;]*anon/i)
  assert.match(r, /ALTER TABLE public\.water_village_stations ENABLE ROW LEVEL SECURITY/)
  assert.equal([...r.matchAll(/can_manage_waste_schedule\(municipality_id\)/g)].length, 2, 'เพิ่ม/ลบการผูกต้องผ่านตัวตัดสินสิทธิ์เดียวกับทะเบียนหมู่')
  assert.match(r, /get_my_role\(\) <> 'citizen'/, 'ประชาชนอ่านตารางตรงไม่ได้')
  assert.doesNotMatch(r, /FOR UPDATE/i)

  // RPC สาธารณะ: SECURITY DEFINER + search_path ล็อก · ปัดพิกัด · ไม่คืนตัวตนเจ้าหน้าที่ · ว่างเมื่อยังไม่เปิดใช้
  assert.match(r, /get_public_water_villages\(_municipality_id uuid\)[\s\S]*SECURITY DEFINER\s+SET search_path = pg_catalog, public/)
  assert.match(r, /round\(v\.latitude, 3\)/)
  assert.match(r, /round\(v\.longitude, 3\)/)
  assert.doesNotMatch(r.slice(r.indexOf('get_public_water_villages')), /created_by/, 'RPC สาธารณะต้องไม่คืนตัวตนเจ้าหน้าที่')
  assert.match(r, /WHEN EXISTS \(SELECT 1 FROM public\.water_village_stations/)
  assert.match(r, /REVOKE ALL ON FUNCTION public\.get_public_water_villages\(uuid\) FROM PUBLIC/)
  assert.match(r, /GRANT EXECUTE ON FUNCTION public\.get_public_water_villages\(uuid\) TO anon, authenticated/)
  assert.match(r, /\(latitude IS NULL\) = \(longitude IS NULL\)/, 'พิกัดต้องครบคู่')

  // ไม่ทับของเดิม (NOTES §5): CREATE OR REPLACE ได้เฉพาะฟังก์ชันชื่อใหม่ของงานนี้
  const replaced = [...r.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map(m => m[1]).sort()
  assert.deepEqual(replaced, ['get_public_water_villages', 'stamp_water_village_station'])
  for (const name of replaced) {
    assert.equal(
      readdirMigrationsContaining(name).length, 1, `${name} ต้องมีอยู่ในไฟล์ migration นี้ไฟล์เดียว ไม่ใช่ชื่อเดิมของใคร`)
  }

  // guard ตรวจลำดับการ apply ครบทั้งไฟล์ 2 และ 3
  assert.match(table, /RAISE EXCEPTION 'ต้อง apply 20261015100000/)
  assert.match(rls, /RAISE EXCEPTION 'ต้อง apply 20261015100100/)
  assert.match(rls, /RAISE EXCEPTION 'ต้อง apply 20260914100100/)
}

function readdirMigrationsContaining(functionName) {
  return readdirSyncSafe().filter(file => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
    .replace(/--.*$/gm, '').includes(`FUNCTION public.${functionName}(`))
}

function readdirSyncSafe() {
  return readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(f => f.endsWith('.sql'))
}

console.log('✅ water-village: ผ่านทุกข้อ')

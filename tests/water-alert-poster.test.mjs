// ภาพแชร์แจ้งเตือนน้ำ-ฝน — ส่วนตัดสินใจ/ประกอบข้อมูล (src/lib/waterAlertPoster.js) ทดสอบใน node ไม่มี DOM
// ส่วนวาดจริงอยู่ที่ tests/water-alert-poster.playwright.mjs (Chrome)
import assert from 'node:assert/strict'
import { DAM_LEVELS, RAIN_LEVELS } from '../src/lib/waterSituation.js'
import {
  NEARBY_DAM_KM, NEUTRAL_HEAD, buildPosterModel, pickNearbyDam, buildPosterPhones, orgCallName, pickRainRows, posterDateLong, posterTime, readableTextOn, selectPosterTopic,
} from '../src/lib/waterAlertPoster.js'
import { buildAlerts } from '../src/lib/waterSituation.js'

// 15 พ.ย. 2569 10:00 น. (เวลาไทย) — ค่าฝนวัด 09:30 น. · ค่าอ่างรายวัน (เที่ยงคืนไทยของวันนี้)
const NOW = Date.parse('2026-11-15T03:00:00Z')
const FRESH_RAIN = '2026-11-15T02:30:00Z'
const DAM_AT = '2026-11-14T17:00:00Z'
const tenant = { name: 'เทศบาลตำบลน้ำเลา', org_type: 'เทศบาลตำบล', district: 'ร้องกวาง', province: 'แพร่', phone: '054-522-092' }

const base = { amphoe_name: 'ร้องกวาง', province_name: 'แพร่', tambon_name: 'น้ำเลา', river_name: null, is_primary: false }
const dam = (extra = {}) => ({
  ...base, station_type: 'dam', station_code: '305', station_name: 'อ่างเก็บน้ำแม่คำปอง', distance_km: 3.6, is_primary: true,
  recorded_at: DAM_AT, storage_percent: 105.1, dam_storage_mcm: 7.1, dam_capacity_mcm: 6.76, dam_inflow_mcm: 0.16, dam_released_mcm: 0.16, ...extra,
})
const rain = (code, name, mm, extra = {}) => ({
  ...base, station_type: 'rain', station_code: code, station_name: name, distance_km: 2.6, recorded_at: FRESH_RAIN, rain_24h_mm: mm, rain_1h_mm: null, ...extra,
})
const input = extra => ({ rain: [], ews: [], levels: [], dams: [], warnings: [], tenant, now: NOW, ...extra })

// ── หัวภาพ ──
{
  // อ่าง >100% ชนะฝนหนักมาก
  const m = buildPosterModel(input({ dams: [dam()], rain: [rain('R1', 'บ้านบุญแจ่ม', 96.5, { is_primary: true })] }))
  assert.equal(m.kind, 'dam')
  assert.equal(m.headline.level, 'เกินความจุเก็บกัก')
  assert.equal(m.headline.name, 'อ่างเก็บน้ำแม่คำปอง')
  assert.equal(m.illustration.rainy, false)
  assert.equal(m.illustration.pct, 105.1)
  // ฝนหนักมากอย่างเดียว (อ่างไม่ล้น) → หัวภาพเป็นฝน
  const r = buildPosterModel(input({ dams: [dam({ storage_percent: 86.4 })], rain: [rain('R1', 'บ้านบุญแจ่ม', 96.5, { is_primary: true, rain_1h_mm: 12 })] }))
  assert.equal(r.kind, 'rain')
  assert.equal(r.headline.level, 'ฝนหนักมาก 96.5 มม.')
  assert.equal(r.headline.name, 'ฝนตกหนักมาก ต.น้ำเลา')
  assert.equal(r.illustration.rainy, true)
}
{
  // อ่าง 80–100% ไม่ขึ้นหัวภาพ · ไม่มีฝนหนักมาก = ไม่มีภาพ
  assert.equal(buildPosterModel(input({ dams: [dam({ storage_percent: 99.9 })] })), null)
  assert.equal(buildPosterModel(input({ dams: [dam({ storage_percent: 86 })], rain: [rain('R1', 'ก', 90.0)] })), null) // 90.0 ยังเป็น "ฝนหนัก"
  assert.equal(buildPosterModel(input({})), null)
  // ค่าเก่าเกินเกณฑ์ของ buildAlerts ไม่นับ: ฝน > 3 ชม. · อ่าง > 48 ชม. (isStale ใช้ ">" — เก่าพอดี 3 ชม. ยังนับว่าสด จึงทดสอบที่ 4 ชม.)
  assert.equal(buildPosterModel(input({ rain: [rain('R1', 'ก', 120, { recorded_at: '2026-11-14T23:00:00Z' })] })), null)
  assert.equal(buildPosterModel(input({ dams: [dam({ recorded_at: '2026-11-12T17:00:00Z' })] })), null)
  // ไม่มี recorded_at = ไม่นับ
  assert.equal(buildPosterModel(input({ dams: [dam({ recorded_at: null })] })), null)
  // selectPosterTopic ตรงกับ buildAlerts (อ่างมาก่อน)
  const alerts = buildAlerts({ dams: [dam()], rain: [rain('R1', 'ก', 100)], now: NOW })
  assert.equal(selectPosterTopic(alerts).kind, 'dam')
  assert.equal(selectPosterTopic({ damOver: [], heavyRain: [] }), null)
}

// ── เลือกฝน 2 แถว ──
{
  const stations = [
    rain('A', 'ก', 5, { is_primary: true, distance_km: 2 }),
    rain('B', 'ข', 0, { is_primary: true, distance_km: 3 }),
    rain('C', 'ค', 70, { distance_km: 1 }),
    rain('D', 'ง', 40, { distance_km: 4 }),
  ]
  // ในตำบลก่อน (แม้ฝนน้อยกว่า) · ไม่บวกรวม
  assert.deepEqual(pickRainRows(stations, NOW).map(s => s.station_code), ['A', 'B'])
  // ในตำบลแค่ 1 → เติมด้วยฝนมากสุด
  assert.deepEqual(pickRainRows(stations.slice(0, 1).concat(stations.slice(2)), NOW).map(s => s.station_code), ['A', 'C'])
  // ไม่มีในตำบลเลย → ฝนมากสุด 2 อันดับ
  assert.deepEqual(pickRainRows(stations.slice(2), NOW).map(s => s.station_code), ['C', 'D'])
  // ค่าเก่าไม่ถูกจัดอันดับว่าฝนมาก
  const stale = [rain('S', 'เก่า', 200, { recorded_at: '2026-11-14T00:00:00Z' }), rain('F', 'สด', 10)]
  assert.deepEqual(pickRainRows(stale, NOW).map(s => s.station_code), ['F', 'S'])
  // ต้นเหตุหัวภาพ (นอกตำบล) ต้องอยู่ในแถวแม้มีสถานีในตำบลครบ 2
  const cause = rain('X', 'ต้นเหตุ', 110, { distance_km: 4 })
  const picked = pickRainRows([stations[0], stations[1], cause], NOW, cause).map(s => s.station_code)
  assert.deepEqual(picked, ['A', 'X'])
  const m = buildPosterModel(input({ rain: [stations[0], stations[1], cause] }))
  assert.equal(m.kind, 'rain')
  assert.deepEqual(m.rain.rows.map(r => r.name), ['ก', 'ต้นเหตุ'])
  assert.equal(m.rain.rows[0].inTambon, true)
  assert.equal(m.rain.rows[1].inTambon, false)
  assert.equal(m.rain.rows[0].sub, 'ต.น้ำเลา · ห่าง 2 กม. · วัดเมื่อ 09:30 น.')
}

// ── สีหัวช่องตามเกณฑ์ / ค่าประกอบเทา ──
{
  const m = buildPosterModel(input({ dams: [dam()] }))
  const by = key => m.tiles.find(t => t.key === key)
  const over = DAM_LEVELS.find(l => l.key === 'over').color
  assert.equal(by('pct').color, over)
  assert.equal(by('volume').color, over)
  assert.equal(by('inflow').color, NEUTRAL_HEAD)
  assert.equal(by('outflow').color, NEUTRAL_HEAD)
  assert.equal(by('inflow').neutral, true)
  assert.equal(by('pct').value, '105.1')
  assert.equal(by('volume').value, '7.10')
  assert.equal(by('volume').unit, 'จาก 6.76 ล้าน ลบ.ม.')
  assert.equal(m.scale.kind, 'proportional')
  assert.deepEqual(m.scale.zones.map(z => z.color), DAM_LEVELS.map(l => l.color))
  assert.equal(m.scale.zones.at(-1).to, 120)

  // สีไม่ผูกกับลำดับช่อง: เปลี่ยนค่า % ที่ช่อง pct ต้องเปลี่ยนสีตามเกณฑ์ (ที่ rain-topic ช่องอ่างใช้ 60% = น้ำปานกลาง สีน้ำเงิน)
  const r = buildPosterModel(input({ dams: [dam({ storage_percent: 60 })], rain: [rain('R1', 'บ้านบุญแจ่ม', 96.5, { is_primary: true, rain_1h_mm: 12 })] }))
  const rb = key => r.tiles.find(t => t.key === key)
  assert.equal(rb('rain24').color, RAIN_LEVELS.find(l => l.key === 'veryHeavy').bar)
  assert.equal(rb('rain1h').color, NEUTRAL_HEAD)
  assert.equal(rb('rain1h').value, '12')
  assert.equal(rb('pct').color, DAM_LEVELS.find(l => l.key === 'moderate').color)
  assert.equal(rb('outflow').color, NEUTRAL_HEAD)
  assert.equal(r.scale.kind, 'equal')
  assert.deepEqual(r.scale.zones.map(z => z.color), RAIN_LEVELS.slice(1).map(l => l.bar))
  assert.deepEqual(r.scale.zones.map(z => [z.from, z.to]), [[0, 10], [10, 35], [35, 90], [90, 150]])
  assert.equal(r.illustration.pct, 60)

  // ฝนหนักมากแต่ไม่มีอ่าง → ช่องอ่างหาย (ไม่แต่งค่า) · ช่องฝนชั่วโมงล่าสุดไม่มีค่า = "–" ไม่ใช่ 0
  const noDam = buildPosterModel(input({ rain: [rain('R1', 'บ้านบุญแจ่ม', 96.5, { is_primary: true })] }))
  assert.deepEqual(noDam.tiles.map(t => t.key), ['rain24', 'rain1h'])
  assert.equal(noDam.tiles[1].value, '–')
  assert.equal(noDam.tiles[1].unit, 'ไม่มีข้อมูล')
  assert.equal(noDam.illustration.pct, null)

  // อ่างเก่าเกินเกณฑ์ไม่ถูกหยิบมาเป็นค่าประกอบ
  const staleDam = buildPosterModel(input({ dams: [dam({ recorded_at: '2026-11-10T17:00:00Z', storage_percent: 70 })], rain: [rain('R1', 'ก', 96.5)] }))
  assert.deepEqual(staleDam.tiles.map(t => t.key), ['rain24', 'rain1h'])

  // ไม่มีค่าไหลเข้า/ระบาย = "–" + "ไม่มีข้อมูล"
  const noFlow = buildPosterModel(input({ dams: [dam({ dam_inflow_mcm: null, dam_released_mcm: null })] }))
  assert.equal(noFlow.tiles.find(t => t.key === 'inflow').value, '–')
  assert.equal(noFlow.tiles.find(t => t.key === 'outflow').unit, 'ไม่มีข้อมูล')
}
assert.equal(readableTextOn('#FFC000'), '#1a0306')
assert.equal(readableTextOn('#C70000'), '#ffffff')
assert.equal(readableTextOn('#7dd3fc'), '#1a0306')
assert.equal(readableTextOn('ไม่ใช่สี'), '#ffffff')

// ── เบอร์โทร: ไม่มี = ช่องหาย · ห้ามเบอร์สำรอง ──
{
  assert.deepEqual(buildPosterPhones({ name: 'ทต.ก' }, []), [])
  assert.deepEqual(buildPosterPhones(null, null), [])
  assert.deepEqual(buildPosterPhones({ name: 'ทต.ก', phone: '  ' }, []), [])
  assert.deepEqual(buildPosterPhones({ name: 'ทต.ก', phone: '054-522-092' }, []), [{ label: 'ทต.ก', number: '054-522-092' }])
  const contacts = [
    { label: 'มูลนิธิ', number: '054-068-199' }, { label: 'กู้ชีพ', number: '1669' }, { label: 'ตำรวจ', number: '191' }, { label: 'ซ้ำ', number: '054-522-092' },
  ]
  // เอา 2 อันดับแรกของสายด่วน (ตำรวจ 191 ไม่ถูกหยิบ)
  assert.deepEqual(buildPosterPhones({ name: 'ทต.ก', phone: '054-522-092' }, contacts).map(p => p.number), ['054-522-092', '054-068-199', '1669'])
  // ไม่มีเบอร์สำนักงาน → มีแต่สายด่วนที่ส่งมา
  assert.deepEqual(buildPosterPhones({ name: 'ทต.ก' }, contacts.slice(0, 1)).map(p => p.number), ['054-068-199'])
  // เบอร์ซ้ำ (ตามตัวเลข) ขึ้นครั้งเดียว · ค่าที่ไม่ใช่เบอร์ถูกข้าม · ตัวอักษรแปลกถูกตัด
  assert.deepEqual(buildPosterPhones({ name: 'ก', phone: '054-522-092' }, [{ label: 'ข', number: '0545 22092' }, { label: 'ค', number: 'ไม่มี' }]).length, 1)
  assert.equal(buildPosterPhones({ name: 'ก' }, [{ label: 'ข', number: '<b>191</b>' }])[0].number, '191')
  // ไม่มีสายด่วนเลยในสมุด → ภาพไม่มีเบอร์ใดนอกจากของสำนักงาน และไม่เติม 191/1669
  const m = buildPosterModel(input({ dams: [dam()], contacts: [] }))
  assert.deepEqual(m.phones, [{ label: 'เทศบาลตำบลน้ำเลา', number: '054-522-092' }])
  const none = buildPosterModel(input({ dams: [dam()], tenant: { ...tenant, phone: null }, contacts: [] }))
  assert.deepEqual(none.phones, [])
  assert.equal(/1669|191/.test(JSON.stringify(none)), false)
}

// ── เรื่องอื่นที่ต้องระวังกว่า ──
{
  const level = (diff, extra = {}) => ({ ...base, station_type: 'waterlevel', station_code: 'W1', station_name: 'แม่น้ำยม', distance_km: 6, recorded_at: FRESH_RAIN, bank_diff_m: diff, ...extra })
  const ews = lv => ({ ...base, station_type: 'ews', station_code: 'E1', station_name: 'สถานีเตือนภัยก', distance_km: 5, recorded_at: FRESH_RAIN, situation_level: lv, situation_text: 'เตรียมพร้อม', situation_color: '#f59e0b' })
  const plain = buildPosterModel(input({ dams: [dam()], levels: [level(1.4)], ews: [ews(1)] }))
  assert.equal(plain.otherNote, null) // ต่ำกว่าตลิ่ง 1.4 ม. และ ews ระดับ 1 ไม่ใช่เรื่องที่แรงกว่า
  const over = buildPosterModel(input({ dams: [dam()], levels: [level(-0.2)] }))
  assert.match(over.otherNote, /^มีเรื่องอื่นที่ต้องระวังกว่า: ระดับน้ำเสมอหรือสูงกว่าตลิ่ง สถานีแม่น้ำยม สูงกว่าตลิ่ง 0\.20 ม\.$/)
  const flush = buildPosterModel(input({ dams: [dam()], levels: [level(0)] }))
  assert.match(flush.otherNote, /ระดับน้ำเสมอตลิ่ง/)
  const e = buildPosterModel(input({ rain: [rain('R1', 'ก', 100)], ews: [ews(2)] }))
  assert.match(e.otherNote, /สถานีเตือนภัยน้ำหลาก-ดินถล่ม สถานีเตือนภัยก · เตรียมพร้อม/)
  const both = buildPosterModel(input({ dams: [dam()], levels: [level(-0.1)], ews: [ews(3)] }))
  assert.match(both.otherNote, /สถานีแม่น้ำยม.* · สถานีเตือนภัยน้ำหลาก/)
  // ค่าระดับน้ำเก่าเกิน 3 ชม. ไม่นับ
  assert.equal(buildPosterModel(input({ dams: [dam()], levels: [level(-0.2, { recorded_at: '2026-11-14T00:00:00Z' })] })).otherNote, null)
}

// ── ข้อความ ──
{
  const m = buildPosterModel(input({ dams: [dam({ river_name: 'แม่คำปอง' })], contacts: [{ label: 'กู้ชีพ', number: '1669' }] }))
  const flat = runs => runs.map(r => r.t).join('')
  assert.equal(flat(m.todo[0]), 'งดลงเล่นน้ำ จับปลา ใกล้ทางระบายน้ำล้นและลำน้ำท้ายอ่าง')
  assert.equal(flat(m.todo[1]), 'บ้านริมลำน้ำแม่คำปอง ยกของขึ้นที่สูง ติดตามระดับน้ำใกล้ชิด')
  assert.equal(flat(m.todo[2]), 'พบน้ำล้นตลิ่งหรือเหตุฉุกเฉิน แจ้งเทศบาลทันที')
  assert.equal(m.todo[2].at(-1).b, true)
  // ไม่มีชื่อลำน้ำ → ไม่แต่งชื่อ · ชื่อที่ขึ้นต้นด้วยคำเรียกแหล่งน้ำอยู่แล้วไม่ซ้ำ
  assert.equal(flat(buildPosterModel(input({ dams: [dam()] })).todo[1]), 'บ้านริมลำน้ำท้ายอ่าง ยกของขึ้นที่สูง ติดตามระดับน้ำใกล้ชิด')
  assert.match(flat(buildPosterModel(input({ dams: [dam({ river_name: 'แม่น้ำยม' })] })).todo[1]), /^บ้านริมแม่น้ำยม /)
  // ฝน: ข้อความคงที่ตามต้นแบบ
  const r = buildPosterModel(input({ rain: [rain('R1', 'ก', 100)] }))
  assert.equal(flat(r.todo[0]), 'ระวังน้ำป่าไหลหลาก ดินโคลนถล่ม บริเวณเชิงเขาและริมลำห้วย')
  assert.equal(flat(r.todo[1]), 'งดเข้าป่า งดข้ามลำห้วยขณะฝนตกหนัก')
  assert.equal(flat(r.todo[2]), 'พบน้ำท่วมฉับพลันหรือเหตุฉุกเฉิน แจ้งเทศบาลทันที')
  // ── ประโยควิเคราะห์สถานการณ์ (กฎ ไม่ใช่ AI) ──
  // อ่าง: ไหลเข้า = ระบายออก → ทรงตัว · ปริมาตรเกิน = 7.10 − 6.76 (ค่าเดียวกับช่องตัวเลข)
  assert.deepEqual(m.analysis, ['trend-flat'])
  assert.equal(flat(m.intro), 'อ่างเก็บน้ำแม่คำปอง (อยู่ในตำบล ต.น้ำเลา ห่าง 3.6 กม.) มีปริมาณน้ำเกินความจุที่ระดับเก็บกัก 0.34 ล้าน ลบ.ม. น้ำไหลลงอ่างเท่ากับที่ระบายออก ปริมาณน้ำจึงทรงตัวอยู่เหนือระดับเก็บกัก')
  const up = buildPosterModel(input({ dams: [dam({ dam_inflow_mcm: 0.5, dam_released_mcm: 0.18 })] }))
  assert.deepEqual(up.analysis, ['trend-up'])
  assert.match(flat(up.intro), /น้ำไหลลงอ่างมากกว่าที่ระบายออกวันละ 0\.32 ล้าน ลบ\.ม\. น้ำในอ่างมีแนวโน้มเพิ่มขึ้น$/)
  const down = buildPosterModel(input({ dams: [dam({ dam_inflow_mcm: 0.1, dam_released_mcm: 0.25 })] }))
  assert.match(flat(down.intro), /น้ำระบายออกมากกว่าที่ไหลลงอ่างวันละ 0\.15 ล้าน ลบ\.ม\. น้ำในอ่างมีแนวโน้มลดลง$/)
  // ต่างกันแค่เศษปัดทศนิยม (0.161 vs 0.158 → 0.16 = 0.16) = ทรงตัว ตามตัวเลขที่คนเห็นในภาพ
  assert.deepEqual(buildPosterModel(input({ dams: [dam({ dam_inflow_mcm: 0.161, dam_released_mcm: 0.158 })] })).analysis, ['trend-flat'])
  // ขาดค่าไหลเข้า/ระบาย/ปริมาตร = ไม่มีประโยคนั้น (ไม่เดา) → คงท้ายเดิม "รายละเอียดดังนี้"
  const bare = buildPosterModel(input({ dams: [dam({ dam_inflow_mcm: null, dam_storage_mcm: null })] }))
  assert.deepEqual(bare.analysis, [])
  assert.match(flat(bare.intro), /เกินความจุที่ระดับเก็บกัก รายละเอียดดังนี้$/)
  // อ่าง + ฝนหนักในแถวฝน → "ประกอบกับฝน…ในพื้นที่" (ไม่อ้างว่าฝนตกลงอ่าง) · ฝนปานกลาง (≤35) ไม่ขึ้น
  const wet = buildPosterModel(input({ dams: [dam()], rain: [rain('R1', 'บ้านบุญแจ่ม', 96.5, { is_primary: true })] }))
  assert.deepEqual(wet.analysis, ['trend-flat', 'rain-too'])
  assert.match(flat(wet.intro), /ประกอบกับฝนหนักมากในพื้นที่ \(บ้านบุญแจ่ม 96\.5 มม\.\)$/)
  assert.deepEqual(buildPosterModel(input({ dams: [dam()], rain: [rain('R1', 'ก', 35)] })).analysis, ['trend-flat'])
  // ฝน: ชั่วโมงล่าสุด > 0 = ยังตก · 0 = หยุดแล้ว (ข้อควรทำข้อ 2 เปลี่ยนตาม) · ไม่มีค่า = ไม่สรุป
  const still = buildPosterModel(input({ rain: [rain('R1', 'ก', 100, { rain_1h_mm: 12 })] }))
  assert.deepEqual(still.analysis, ['still-raining'])
  assert.match(flat(still.intro), /ของกรมอุตุนิยมวิทยา ชั่วโมงล่าสุดยังวัดฝนได้ 12(\.0)? มม\. ฝนยังตกอยู่$/)
  assert.equal(flat(still.todo[1]), 'งดเข้าป่า งดข้ามลำห้วยขณะฝนตกหนัก')
  const stopped = buildPosterModel(input({ rain: [rain('R1', 'ก', 100, { rain_1h_mm: 0 })] }))
  assert.deepEqual(stopped.analysis, ['stopped'])
  assert.equal(flat(stopped.todo[1]), 'งดเข้าป่า งดข้ามลำห้วย แม้ฝนหยุดแล้ว')
  assert.match(flat(r.intro), /ของกรมอุตุนิยมวิทยา รายละเอียดดังนี้$/) // ไม่มีค่าชั่วโมง ไม่มีสถานีอื่น = ไม่มีประโยค
  // วงกว้าง (ฝนหนักมาก ≥ 2 สถานี) / เฉพาะจุด (สถานีอื่นที่ค่าสด ≤ 35) / สถานีอื่นก็ฝนหนัก (35.1–90)
  assert.deepEqual(buildPosterModel(input({ rain: [rain('R1', 'ก', 100), rain('R2', 'ข', 92)] })).analysis, ['widespread'])
  assert.deepEqual(buildPosterModel(input({ rain: [rain('R1', 'ก', 100), rain('R2', 'ข', 20)] })).analysis, ['local'])
  const near = buildPosterModel(input({ rain: [rain('R1', 'ก', 100), rain('R2', 'บ้านข', 60)] }))
  assert.deepEqual(near.analysis, ['nearby-heavy'])
  assert.match(flat(near.intro), /สถานีบ้านข ก็มีฝนหนัก 60(\.0)? มม\.$/)
  // สถานีอื่นค่าเก่า = ไม่ใช้เทียบ (ไม่สรุปว่าเฉพาะจุดจากค่าเก่า)
  assert.deepEqual(buildPosterModel(input({ rain: [rain('R1', 'ก', 100), rain('R2', 'ข', 0, { recorded_at: '2026-11-14T00:00:00Z' })] })).analysis, [])
  // อ่างประกอบ 80–100% → ใกล้เต็มความจุ · ≤ 80 ไม่ขึ้น
  assert.deepEqual(buildPosterModel(input({ dams: [dam({ storage_percent: 92.3 })], rain: [rain('R1', 'ก', 100)] })).analysis, ['dam-high'])
  assert.deepEqual(buildPosterModel(input({ dams: [dam({ storage_percent: 80 })], rain: [rain('R1', 'ก', 100)] })).analysis, [])
  // ห้ามมีคำสั่งอพยพ/พยากรณ์/อุปมาในประโยควิเคราะห์ทุกแบบ
  for (const mm of [still, stopped, near, wet, up, down]) assert.doesNotMatch(flat(mm.intro), /อพยพ|คาดว่า|ภายใน|สระว่ายน้ำ/)

  // อบต. ใช้คำเรียกตรงประเภท
  assert.equal(orgCallName({ name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', org_type: 'อบต.' }), 'อบต.')
  assert.equal(orgCallName({ name: 'เทศบาลตำบลน้ำเลา' }), 'เทศบาล')
  assert.equal(orgCallName({ name: 'ทต.ทดสอบ', org_type: 'เทศบาลตำบล' }), 'เทศบาล')
  assert.equal(orgCallName({ name: 'หน่วยงานทดสอบ' }), 'หน่วยงานทดสอบ')
  const tk = buildPosterModel(input({ rain: [rain('R1', 'ก', 100)], tenant: { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', org_type: 'อบต.', district: 'หนองม่วงไข่', province: 'แพร่' } }))
  assert.equal(flat(tk.todo[2]), 'พบน้ำท่วมฉับพลันหรือเหตุฉุกเฉิน แจ้ง อบต. ทันที')
  assert.equal(tk.footer.tags, '#สถานการณ์น้ำ #ทุ่งแค้ว')
  // ท้ายภาพ: ไม่ใช่ประกาศของ อปท. + ที่มา + ไม่มีข้อมูล ≠ ปกติ + วันที่ต้นทาง
  const foot = m.footer.lines.join(' ')
  assert.match(foot, /ข้อมูลจาก ThaiWater \(สสน\.\) · ไม่ใช่ประกาศของเทศบาลตำบลน้ำเลา/)
  assert.match(foot, /ไม่มีข้อมูล ไม่ได้หมายความว่าสถานการณ์ปกติ/)
  assert.match(foot, /ค่าอ่าง 15 พ\.ย\. 69/)
  assert.equal(m.footer.location, 'เทศบาลตำบลน้ำเลา อ.ร้องกวาง จ.แพร่')
  assert.equal(m.footer.tags, '#สถานการณ์น้ำ #น้ำเลา')
  assert.equal(m.ribbon, 'ข้อมูลอ่าง ณ วันที่ 15 พฤศจิกายน 2569')
  assert.equal(r.ribbon, 'ข้อมูลฝน ณ วันที่ 15 พฤศจิกายน 2569 · 09:30 น.')
  assert.equal(posterDateLong('2026-11-14T17:00:00Z'), '15 พฤศจิกายน 2569')
  assert.equal(posterTime('2026-11-15T02:30:00Z'), '09:30')
  assert.equal(posterDateLong('ไม่ใช่วันที่'), '')
  assert.equal(m.fileName, 'water-alert-20261115.png')
  assert.match(m.altText, /ไม่ใช่ประกาศของเทศบาลตำบลน้ำเลา/)
  // ข้อความ สสน. ระดับอำเภอ: ไม่มี = "ไม่มีในขณะนี้" · มี = ตามต้นฉบับ
  assert.equal(m.rain.warning.none, true)
  assert.equal(m.rain.warning.label, 'ประกาศเตือนของ สสน. สำหรับ อ.ร้องกวาง')
  const w = buildPosterModel(input({ dams: [dam()], warnings: [{ message: 'เฝ้าระวังฝนตกหนักและน้ำป่าไหลหลาก', issued_at: '2026-11-15T01:00:00Z' }] }))
  assert.equal(w.rain.warning.none, false)
  assert.equal(w.rain.warning.text, 'เฝ้าระวังฝนตกหนักและน้ำป่าไหลหลาก')
  // ข้อความเก่าเกิน 24 ชม. ไม่ขึ้น
  const oldW = buildPosterModel(input({ dams: [dam()], warnings: [{ message: 'เก่า', issued_at: '2026-11-13T01:00:00Z' }] }))
  assert.equal(oldW.rain.warning.none, true)
  // ไม่มีสถานีฝนเลย → บอกว่าไม่มีข้อมูล ไม่ใช่ว่าฝนไม่ตก
  assert.match(m.rain.empty, /ไม่ได้หมายความว่าฝนไม่ตก/)
}

// ── PDPA: ฟิลด์นอกรายการไม่หลุดเข้าภาพ ──
{
  const noisy = dam({ reporter_name: 'นายทดสอบ ใจดี', citizen_phone: '0812345678', note: 'ข้อความภายใน' })
  const m = buildPosterModel(input({ dams: [noisy] }))
  const text = JSON.stringify(m)
  assert.equal(/นายทดสอบ|0812345678|ข้อความภายใน/.test(text), false)
}

// อ่างใกล้เคียง: ≤ 5 กม. · ไม่ซ้ำอ่างหัวภาพ · ค่าเก่าไม่เอา · ใกล้สุดอ่างเดียว · ไม่ทำให้เกิดภาพเตือนเอง
{
  assert.equal(NEARBY_DAM_KM, 5)
  const main = dam()
  const thang = dam({ station_code: '310', station_name: 'อ่างเก็บน้ำแม่ถาง', distance_km: 4.3, is_primary: false, tambon_name: 'บ้านเวียง', storage_percent: 50.6 })
  const far = dam({ station_code: '311', station_name: 'อ่างเก็บน้ำไกล', distance_km: 5.1, is_primary: false, storage_percent: 70 })
  const closer = dam({ station_code: '312', station_name: 'อ่างเก็บน้ำใกล้กว่า', distance_km: 1.2, is_primary: false, storage_percent: 40 })
  const old = dam({ station_code: '313', station_name: 'อ่างเก็บน้ำค่าเก่า', distance_km: 0.5, is_primary: false, storage_percent: 40, recorded_at: '2026-11-01T17:00:00Z' })
  assert.equal(pickNearbyDam([main, thang], NOW, main)?.station_code, '310', 'ไม่เอาอ่างหัวภาพ')
  assert.equal(pickNearbyDam([main, far], NOW, main), null, 'เกิน 5 กม. ไม่เอา')
  assert.equal(pickNearbyDam([main, thang, closer], NOW, main)?.station_code, '312', 'ใกล้สุดก่อน')
  assert.equal(pickNearbyDam([main, old, thang], NOW, main)?.station_code, '310', 'ค่าเก่าไม่เอา')
  const m = buildPosterModel({ dams: [main, thang], tenant, now: NOW })
  assert.deepEqual(
    { name: m.nearbyDam.name, pctText: m.nearbyDam.pctText, heading: m.nearbyDam.heading },
    { name: 'อ่างแม่ถาง', pctText: '50.6', heading: 'อ่างใกล้เคียง' },
  )
  assert.match(m.nearbyDam.sub, /บ้านเวียง/)
  assert.match(m.nearbyDam.sub, /4\.3/)
  assert.equal(buildPosterModel({ dams: [main], tenant, now: NOW }).nearbyDam, null)
  // อ่างข้างเคียงเพียงลำพัง (ไม่เกินเกณฑ์) ไม่ทำให้มีภาพ
  assert.equal(buildPosterModel({ dams: [{ ...thang }], tenant, now: NOW }), null)
}

console.log('PASS: topic selection (dam>100 over heavy rain, 80-100 no poster, stale ignored, none = null), rain rows (in-tambon first, cause kept, no summing), tile head colors by threshold / neutral for supporting values, phones (none = hidden, no fallback), other-hazard note, wording by org type, footer disclaimers, PDPA')

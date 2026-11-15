// ภาพแชร์แจ้งเตือนน้ำ-ฝน — ส่วนตัดสินใจ/ประกอบข้อมูล (src/lib/waterAlertPoster.js) ทดสอบใน node ไม่มี DOM
// ส่วนวาดจริงอยู่ที่ tests/water-alert-poster.playwright.mjs (Chrome)
import assert from 'node:assert/strict'
import { DAM_LEVELS, RAIN_LEVELS } from '../src/lib/waterSituation.js'
import {
  NEARBY_DAM_KM, NEUTRAL_HEAD, buildPosterModel, pickNearbyDam, buildPosterPhones, orgCallName, pickRainRows, posterDateLong, posterTime,
  posterTopicCandidates, readableTextOn, selectPosterTopic,
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

// ── ลำดับหัวภาพ: EWS3 > น้ำเสมอ/สูงกว่าตลิ่ง > EWS2 > อ่าง >100% > ฝนหนักมาก ──
const level = (diff, extra = {}) => ({
  ...base, station_type: 'waterlevel', station_code: 'W1', station_name: 'บ้านน้ำปุ๊', river_name: 'แม่น้ำยม', distance_km: 6, recorded_at: FRESH_RAIN, bank_diff_m: diff,
  waterlevel_msl: 123.45, prev_waterlevel_msl: 123.1, prev_recorded_at: '2026-11-15T01:30:00Z', ...extra,
})
const ews = (lv, text, extra = {}) => ({
  ...base, station_type: 'ews', station_code: 'E1', station_name: 'สถานีเตือนภัยบ้านห้วยขึม', distance_km: 5, is_primary: true, recorded_at: FRESH_RAIN,
  note: 'หมู่บ้านที่สถานีดูแล: บ้านห้วยทรายขาว, บ้านน้ำเลาใต้', situation_level: lv, situation_text: text, situation_color: '#f59e0b', ...extra,
})
const E3 = (extra = {}) => ews(3, 'วิกฤติ', extra)
const E2 = (extra = {}) => ews(2, 'เตรียมพร้อม', { station_code: 'E2', station_name: 'สถานีเตือนภัยบ้านน้ำรัด', ...extra })
const flat = runs => runs.map(r => r.t).join('')

{
  const everything = { ews: [E2(), E3()], levels: [level(-0.2)], dams: [dam()], rain: [rain('R1', 'บ้านบุญแจ่ม', 96.5, { is_primary: true })] }
  // ทุกชั้นอยู่ครบ → EWS3 (แม้ใน rows เรียง ews ระดับ 2 ก่อน) · เก็บ alert ของ EWS ไว้ด้วย
  const m3 = buildPosterModel(input(everything))
  assert.equal(m3.kind, 'ews')
  assert.equal(m3.illustration.ewsLevel, 3)
  const topic = selectPosterTopic(buildAlerts({ ...everything, now: NOW }))
  assert.equal(topic.kind, 'ews')
  assert.equal(topic.station.station_code, 'E1')
  assert.equal(topic.alert.level, 3)
  assert.equal(topic.alert.text, 'วิกฤติ')
  // ไม่มี EWS3 → น้ำเสมอ/สูงกว่าตลิ่งชนะ EWS2 อ่าง ฝน
  const topicOf = extra => buildPosterModel(input(extra))?.kind ?? null
  assert.equal(topicOf({ ...everything, ews: [E2()] }), 'overbank')
  // ไม่มีล้นตลิ่ง → EWS2 ชนะอ่างกับฝน
  const m2 = buildPosterModel(input({ ...everything, ews: [E2()], levels: [] }))
  assert.equal(m2.kind, 'ews')
  assert.equal(m2.illustration.ewsLevel, 2)
  assert.equal(m2.headline.name, 'สถานีเตือนภัยบ้านน้ำรัด')
  // ไม่มี EWS → อ่างชนะฝน → ฝน
  assert.equal(topicOf({ ...everything, ews: [], levels: [] }), 'dam')
  assert.equal(topicOf({ ...everything, ews: [], levels: [], dams: [] }), 'rain')
  // ระดับ 1 หรือค่าเก่าเกิน 12 ชม. ไม่เป็นหัวภาพ (buildAlerts กรอง) — ตกไปที่เรื่องถัดไป/ไม่มีภาพ
  assert.equal(topicOf({ ews: [ews(1, 'เฝ้าระวัง')] }), null)
  assert.equal(topicOf({ ews: [ews(1, 'เฝ้าระวัง')], dams: [dam()] }), 'dam')
  assert.equal(topicOf({ ews: [E3({ recorded_at: '2026-11-14T13:00:00Z' })] }), null, 'สถานะเก่าเกิน 12 ชม.')
  assert.equal(topicOf({ ews: [E3({ recorded_at: '2026-11-14T13:00:00Z' })], dams: [dam()] }), 'dam')
  // ล้นตลิ่ง: ต่ำกว่าตลิ่ง/ไม่มีค่า/ค่าเก่า ไม่เป็นหัวภาพ
  assert.equal(topicOf({ levels: [level(null)] }), null)
  assert.equal(topicOf({ levels: [level('')] }), null)
  assert.equal(topicOf({ levels: [level(0.2)] }), null)
  assert.equal(topicOf({ levels: [level(-0.2, { recorded_at: '2026-11-14T00:00:00Z' })] }), null)
  assert.equal(topicOf({ levels: [level(0)] }), 'overbank')
  // selectPosterTopic: ไม่มีอะไรเลย = null
  assert.equal(selectPosterTopic({ ews: [], overbank: [], damOver: [], heavyRain: [] }), null)
  assert.equal(selectPosterTopic(null), null)
  // ลำดับรายการทั้งหมด
  const all = posterTopicCandidates(buildAlerts({ ...everything, now: NOW }))
  assert.deepEqual(all.map(c => `${c.kind}${c.alert ? c.alert.level : ''}`), ['ews3', 'overbank', 'ews2', 'dam', 'rain'])
}

// ── ภาพสถานีเตือนภัย: ค่าที่ทำให้เตือน (ews_warning_type / ews_rain_12h_mm / ews_waterlevel_m) ──
{
  const stationRain = (mm, extra = {}) => rain('E1', 'สถานีวัดฝนห้วยขึม', mm, { is_primary: true, rain_1h_mm: 12, ...extra })
  const withDam = { dams: [dam({ storage_percent: 62.4 })], rain: [stationRain(96.5)] }
  const plain = buildPosterModel(input({ ews: [E3()], ...withDam }))

  // (ก) เตือนจากฝน: intro บอกเหตุ + ช่อง ews-trigger แทน rain1h (จำนวนช่องเท่าเดิม)
  const r = buildPosterModel(input({ ews: [E3({ ews_warning_type: 'rain', ews_rain_12h_mm: '117.0' })], ...withDam }))
  assert.match(flat(r.intro), /รายงานสถานะ ระดับวิกฤติ จากปริมาณน้ำฝน \(ฝนสะสม 12 ชม\. 117 มม\.\) ตามเกณฑ์ของกรมทรัพยากรน้ำ/)
  assert.equal(r.intro.find(x => x.em).t, 'ระดับวิกฤติ')
  assert.equal(r.tiles.length, plain.tiles.length)
  assert.deepEqual(r.tiles.map(t => t.key), ['ews-level', 'rain24', 'ews-trigger', 'pct'])
  const tr = r.tiles.find(t => t.key === 'ews-trigger')
  assert.deepEqual({ icon: tr.icon, color: tr.color, neutral: tr.neutral, label: tr.label, value: tr.value, unit: tr.unit },
    { icon: 'rain', color: '#bf212f', neutral: false, label: 'ฝนสะสม 12 ชม.\nที่ทำให้เตือน', value: '117', unit: 'มม.' })
  // ไม่แตะส่วนอื่น: headline/ribbon/scale/todo เหมือนภาพที่ไม่มีช่องใหม่
  assert.deepEqual({ h: r.headline, rb: r.ribbon, sc: r.scale, td: r.todo }, { h: plain.headline, rb: plain.ribbon, sc: plain.scale, td: plain.todo })

  // (ข) ไม่มีช่องใหม่ (แถวเก่า) / ชนิดมีแต่ไม่มีตัวเลข / ระดับน้ำติดลบ / ชนิดแปลก: ช่องตัวเลขเหมือนเดิม
  assert.deepEqual(plain.tiles.map(t => t.key), ['ews-level', 'rain24', 'rain1h', 'pct'])
  assert.doesNotMatch(flat(plain.intro), /จากปริมาณน้ำฝน|จากระดับน้ำ/)
  const noValue = buildPosterModel(input({ ews: [E3({ ews_warning_type: 'rain', ews_rain_12h_mm: null })], ...withDam }))
  assert.deepEqual(noValue.tiles.map(t => t.key), ['ews-level', 'rain24', 'rain1h', 'pct'])
  assert.match(flat(noValue.intro), /ระดับวิกฤติ จากปริมาณน้ำฝน ตามเกณฑ์ของกรมทรัพยากรน้ำ/)
  assert.doesNotMatch(flat(noValue.intro), /ฝนสะสม 12 ชม\./)
  const neg = buildPosterModel(input({ ews: [E3({ ews_warning_type: 'wl', ews_waterlevel_m: -1 })], ...withDam }))
  assert.deepEqual(neg.tiles.map(t => t.key), ['ews-level', 'rain24', 'rain1h', 'pct'])
  const weird = buildPosterModel(input({ ews: [E3({ ews_warning_type: 'flood', ews_rain_12h_mm: 50 })], ...withDam }))
  assert.deepEqual(weird.tiles.map(t => t.key), ['ews-level', 'rain24', 'rain1h', 'pct'])
  assert.equal(flat(weird.intro), flat(plain.intro))

  // (ค) เตือนจากระดับน้ำ (ระดับ 2): ทศนิยม 2 ตำแหน่ง · ไอคอน alert (ภาพไม่มีไอคอนระดับน้ำ) · ไม่เทียบตลิ่ง
  const w = buildPosterModel(input({ ews: [E2({ ews_warning_type: 'wl', ews_waterlevel_m: 2.708 })], ...withDam }))
  assert.match(flat(w.intro), /รายงานสถานะ ระดับเตรียมพร้อม จากระดับน้ำ \(ระดับน้ำ 2\.71 ม\.\) ตามเกณฑ์ของกรมทรัพยากรน้ำ/)
  const tw = w.tiles.find(t => t.key === 'ews-trigger')
  assert.deepEqual({ icon: tw.icon, color: tw.color, label: tw.label, value: tw.value, unit: tw.unit },
    { icon: 'alert', color: '#f5b400', label: 'ระดับน้ำ\nที่ทำให้เตือน', value: '2.71', unit: 'ม.' })
  assert.doesNotMatch(flat(w.intro), /ตลิ่ง/)
}

// ── ภาพสถานีเตือนภัย (ews) ──
{
  const stationRain = (mm, extra = {}) => rain('E1', 'สถานีวัดฝนห้วยขึม', mm, { is_primary: true, rain_1h_mm: 12, ...extra })
  const m = buildPosterModel(input({ ews: [E3()], dams: [dam({ storage_percent: 62.4 })], rain: [stationRain(96.5), rain('R9', 'บ้านอื่น', 150)] }))
  assert.equal(m.kind, 'ews')
  assert.equal(m.headline.sub, 'สถานีเตือนภัยน้ำหลาก-ดินถล่ม')
  assert.equal(m.headline.level, 'ระดับวิกฤติ')
  assert.equal(m.headline.name, 'สถานีเตือนภัยบ้านห้วยขึม')
  assert.equal(m.ribbon, 'สถานะ ณ วันที่ 15 พฤศจิกายน 2569 · 09:30 น.')
  // ช่องตัวเลข: ระดับ (สีระดับ) · ฝนของสถานีรหัสเดียวกัน (ไม่ใช่สถานีอื่นที่ฝนมากกว่า) · ฝนชั่วโมงล่าสุด (เทา) · อ่าง
  assert.deepEqual(m.tiles.map(t => t.key), ['ews-level', 'rain24', 'rain1h', 'pct'])
  const t = key => m.tiles.find(x => x.key === key)
  assert.equal(t('ews-level').value, 'วิกฤติ')
  assert.equal(t('ews-level').unit, 'ระดับ 3 จาก 3')
  assert.equal(t('ews-level').color, '#bf212f')
  assert.equal(t('ews-level').neutral, false)
  assert.equal(t('rain24').value, '96.5')
  assert.equal(t('rain24').color, RAIN_LEVELS.find(l => l.key === 'veryHeavy').bar)
  assert.equal(t('rain1h').value, '12')
  assert.equal(t('rain1h').color, NEUTRAL_HEAD)
  assert.equal(t('rain1h').neutral, true)
  assert.equal(t('pct').color, DAM_LEVELS.find(l => l.key === 'moderate').color)
  // แถบเกณฑ์ 3 ช่องเท่ากัน หมุดกลางช่อง ไม่มีตัวเลขรอยต่อ
  assert.equal(m.scale.kind, 'equal')
  assert.equal(m.scale.heading, 'ระดับของสถานีเตือนภัย (กรมทรัพยากรน้ำ)')
  assert.deepEqual(m.scale.zones.map(z => [z.label, z.from, z.to, z.color]), [['เฝ้าระวัง', 0, 1, '#27b376'], ['เตรียมพร้อม', 1, 2, '#f5b400'], ['วิกฤติ', 2, 3, '#bf212f']])
  assert.equal(m.scale.value, 2.5)
  assert.equal(m.scale.ticks, false)
  assert.equal(m.scale.markLabel, 'สถานีเตือนภัยบ้านห้วยขึม วิกฤติ')
  // ข้อควรทำระดับวิกฤติ ตามเกณฑ์ของกรมทรัพยากรน้ำ
  assert.equal(flat(m.todo[0]), 'กรมทรัพยากรน้ำกำหนดว่าระดับวิกฤติ ให้เคลื่อนย้ายไปพื้นที่ปลอดภัยที่ได้แจ้งไว้')
  assert.equal(m.todo[0][1].b, true)
  assert.equal(flat(m.todo[1]), 'ฟังประกาศผู้นำชุมชน หอกระจายข่าว หลีกเลี่ยงแนวน้ำไหลเชี่ยวและแนวดินไหล')
  assert.equal(flat(m.todo[2]), 'พบเหตุฉุกเฉิน แจ้งเทศบาลทันที')
  assert.equal(m.todo[2].at(-1).b, true)
  // ท้ายภาพ: ที่มา ews.dwr.go.th · ไม่ใช่ประกาศของ อปท. · วันที่-เวลาของสถานะ
  assert.match(m.footer.lines[0], /ews\.dwr\.go\.th/)
  assert.match(m.footer.lines[0], /สถานะ 15 พ\.ย\. 69 09:30 น\./)
  assert.match(m.footer.lines[0], /ค่าอ่าง 15 พ\.ย\. 69/)
  assert.match(m.footer.lines[1], /^ข้อมูลจากกรมทรัพยากรน้ำและ ThaiWater \(สสน\.\) · ไม่ใช่ประกาศของเทศบาลตำบลน้ำเลา/)
  assert.match(m.shareText, /ไม่ใช่ประกาศของเทศบาลตำบลน้ำเลา/)
  assert.match(m.altText, /ไม่ใช่ประกาศของเทศบาลตำบลน้ำเลา/)
  assert.match(m.shareText, /^แจ้งเตือนสถานการณ์น้ำ–ฝน เทศบาลตำบลน้ำเลา: สถานีเตือนภัยน้ำหลาก-ดินถล่ม ระดับวิกฤติ สถานีเตือนภัยบ้านห้วยขึม/)
  assert.deepEqual({ kind: m.illustration.kind, rainy: m.illustration.rainy, pct: m.illustration.pct, ewsLevel: m.illustration.ewsLevel }, { kind: 'ews', rainy: true, pct: 62.4, ewsLevel: 3 })

  // ย่อหน้า: ความหมายตามกรม + หมู่บ้านที่ดูแล + ฝนของสถานีเดียวกัน (ข้อเท็จจริงคู่กัน ไม่อ้างเป็นสาเหตุ)
  const intro = flat(m.intro)
  assert.match(intro, /^สถานีเตือนภัยล่วงหน้าของกรมทรัพยากรน้ำ สถานีเตือนภัยบ้านห้วยขึม \(ในตำบล ต\.น้ำเลา ห่าง 5 กม\.\) รายงานสถานะ ระดับวิกฤติ ตามเกณฑ์ของกรมทรัพยากรน้ำ ระดับนี้หมายถึงให้เคลื่อนย้ายไปยังพื้นที่ปลอดภัยที่ได้แจ้งไว้/)
  assert.equal(m.intro.find(r => r.em).t, 'ระดับวิกฤติ')
  assert.deepEqual(m.analysis, ['villages', 'rain-at-station'])
  assert.match(intro, /หมู่บ้านที่สถานีดูแล: บ้านห้วยทรายขาว, บ้านน้ำเลาใต้/)
  assert.match(intro, /วัดฝนสะสม 24 ชม\. ได้ 96\.5 มม\. ฝนหนักมาก$/)
  // ⚠️ ไม่มีค่าที่ทำให้เตือน และไม่รู้ว่าเตือนด้วยอะไร → ห้ามมีคำอ้างสาเหตุ/ค่าเกณฑ์
  for (const text of [intro, m.shareText, m.altText, m.footer.lines.join(' ')]) assert.doesNotMatch(text, /เนื่องจาก|เพราะ|สาเหตุ|เตือนด้วย|ระดับน้ำเกิน|ฝนสะสมเกิน/)
  // ตัดประโยคท้ายทิ้งได้ทีละประโยค (introFor) · ความหมายของระดับไม่ถูกตัด
  assert.doesNotMatch(flat(m.introFor(1)), /วัดฝนสะสม/)
  assert.match(flat(m.introFor(1)), /หมู่บ้านที่สถานีดูแล/)
  assert.doesNotMatch(flat(m.introFor(0)), /หมู่บ้านที่สถานีดูแล/)
  assert.match(flat(m.introFor(0)), /ให้เคลื่อนย้ายไปยังพื้นที่ปลอดภัยที่ได้แจ้งไว้ รายละเอียดดังนี้$/)

  // ระดับ 2 (เตรียมพร้อม): ไม่มีอ่าง ไม่มีฝนที่สถานี → ช่องฝน "–" · 3 ช่อง · สีเหลืองทอง
  const p = buildPosterModel(input({ ews: [E2({ note: null })] }))
  assert.equal(p.headline.level, 'ระดับเตรียมพร้อม')
  assert.deepEqual(p.tiles.map(x => x.key), ['ews-level', 'rain24', 'rain1h'])
  assert.equal(p.tiles[0].color, '#f5b400')
  assert.equal(p.tiles[0].unit, 'ระดับ 2 จาก 3')
  assert.equal(p.tiles[1].value, '–')
  assert.equal(p.tiles[1].unit, 'ไม่มีข้อมูล')
  assert.equal(p.tiles[1].color, NEUTRAL_HEAD)
  assert.equal(p.tiles[2].value, '–')
  assert.equal(p.scale.value, 1.5)
  assert.equal(p.scale.activeIndex, 1)
  assert.match(flat(p.intro), /ระดับนี้หมายถึงให้ระมัดระวัง ติดตามสถานการณ์ รอประกาศจากผู้รู้หรือหอกระจายข่าว/)
  assert.equal(flat(p.todo[0]), 'เก็บข้าวของ เตรียมพร้อมอพยพ ติดตามสถานการณ์ใกล้ชิด')
  assert.equal(p.todo[0][0].b, true)
  assert.equal(flat(p.todo[1]), 'รอฟังประกาศผู้นำชุมชน หอกระจายข่าว สังเกตเสียงต้นไม้หัก หินตก น้ำขุ่น')
  assert.equal(flat(p.todo[2]), 'พบเหตุฉุกเฉิน แจ้งเทศบาลทันที')
  assert.doesNotMatch(flat(p.intro), /เคลื่อนย้าย/)
  assert.match(p.footer.lines[0], /ews\.dwr\.go\.th/)
  assert.match(p.footer.lines[1], /ไม่ใช่ประกาศของเทศบาลตำบลน้ำเลา/)
  assert.equal(p.illustration.pct, null)

  // ฝนที่หา: ต้อง station_code เดียวกันเท่านั้น · สถานีเดียวกันแต่ค่าเก่า = "–" · ไม่มีฝนเลย = "–" (ไม่ใช่ 0)
  const otherCode = buildPosterModel(input({ ews: [E2()], rain: [rain('R1', 'ก', 80)] }))
  assert.equal(otherCode.tiles.find(x => x.key === 'rain24').value, '–')
  const staleRain = buildPosterModel(input({ ews: [E2({ station_code: 'E1' })], rain: [rain('E1', 'ก', 80, { recorded_at: '2026-11-14T23:00:00Z' })] }))
  assert.equal(staleRain.tiles.find(x => x.key === 'rain24').value, '–')
  assert.equal(staleRain.tiles.find(x => x.key === 'rain1h').value, '–')
  const sameCode = buildPosterModel(input({ ews: [E2({ station_code: 'E1' })], rain: [rain('E1', 'ก', 12.5, { rain_1h_mm: 0 })] }))
  assert.equal(sameCode.tiles.find(x => x.key === 'rain24').value, '12.5')
  assert.equal(sameCode.tiles.find(x => x.key === 'rain1h').value, '0', 'ฝนชั่วโมงล่าสุด 0 = 0 ไม่ใช่ "–"')

  // note ที่ไม่ใช่รูปแบบ "หมู่บ้านที่สถานีดูแล: …" ไม่เข้าภาพ (PDPA/ข้อความภายใน) · ไม่มี note = ไม่มีประโยคหมู่บ้าน
  const odd = buildPosterModel(input({ ews: [E3({ note: 'โทรหานายทดสอบ 0812345678' })] }))
  assert.deepEqual(odd.analysis, [])
  assert.equal(/นายทดสอบ|0812345678/.test(JSON.stringify(odd)), false)
  assert.match(flat(odd.intro), /ที่ได้แจ้งไว้ รายละเอียดดังนี้$|ที่ได้แจ้งไว้$/)
  // รายชื่อหมู่บ้านยาวมาก = ตัดที่ตัวคั่นแล้วต่อ "ฯลฯ" (ไม่ตัดกลางชื่อ)
  const longList = Array.from({ length: 20 }, (_, i) => `บ้านทดสอบหมู่ที่${i + 1}`).join(', ')
  const longModel = buildPosterModel(input({ ews: [E3({ note: `หมู่บ้านที่สถานีดูแล: ${longList}` })] }))
  assert.match(flat(longModel.intro), /บ้านทดสอบหมู่ที่\d+ ฯลฯ$/)
  // อบต. ใช้คำเรียกตรงประเภทในข้อความข้อควรทำ
  const tk = buildPosterModel(input({ ews: [E3()], tenant: { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', org_type: 'อบต.', district: 'หนองม่วงไข่', province: 'แพร่' } }))
  assert.equal(flat(tk.todo[2]), 'พบเหตุฉุกเฉิน แจ้ง อบต. ทันที')
}

// ── ภาพน้ำเสมอ/สูงกว่าตลิ่ง (overbank) ──
{
  const wetRain = rain('R1', 'บ้านบุญแจ่ม', 60, { is_primary: true })
  const m = buildPosterModel(input({ levels: [level(-0.35)], rain: [wetRain] }))
  assert.equal(m.kind, 'overbank')
  assert.equal(m.headline.sub, 'สถานการณ์น้ำในลำน้ำ')
  assert.equal(m.headline.level, 'น้ำสูงกว่าตลิ่ง 0.35 ม.')
  assert.equal(m.headline.name, 'แม่น้ำยม สถานีบ้านน้ำปุ๊')
  assert.equal(m.ribbon, 'วัดเมื่อ 15 พฤศจิกายน 2569 · 09:30 น.')
  const t = key => m.tiles.find(x => x.key === key)
  assert.deepEqual(m.tiles.map(x => x.key), ['bank', 'level', 'trend', 'rain24'])
  assert.deepEqual([t('bank').value, t('bank').unit, t('bank').color, t('bank').neutral], ['+0.35', 'ม. สูงกว่าตลิ่ง', '#bf212f', false])
  assert.deepEqual([t('level').value, t('level').unit, t('level').neutral], ['123.45', 'ม.รทก.', true])
  assert.deepEqual([t('trend').value, t('trend').unit, t('trend').neutral], ['ขึ้น', '0.35 ม.', true])
  assert.equal(t('rain24').value, '60')
  assert.equal(t('rain24').color, RAIN_LEVELS.find(l => l.key === 'heavy').bar)
  // แถบ "ม. เทียบตลิ่ง": แกน −2..+1 · ค่า = −bank_diff · ช่องที่ค่าอยู่นับเสมอตลิ่งเป็นแจ้งเตือนภัย
  assert.equal(m.scale.kind, 'proportional')
  assert.equal(m.scale.heading, 'ระดับน้ำเทียบตลิ่ง (เกณฑ์กรมชลประทาน)')
  assert.deepEqual([m.scale.min, m.scale.max, m.scale.value, m.scale.activeIndex], [-2, 1, 0.35, 2])
  assert.deepEqual(m.scale.zones.map(z => [z.label, z.from, z.to, z.tickLabel ?? null]), [['ปกติ', -2, -1, null], ['เฝ้าระวัง', -1, 0, '−1 ม.'], ['แจ้งเตือนภัย', 0, 1, 'ตลิ่ง']])
  assert.equal(m.scale.markLabel, 'บ้านน้ำปุ๊ +0.35 ม.')
  // ย่อหน้า + ประโยคจากกฎ (แนวโน้มจากค่าก่อนหน้า · ฝนหนักในแถวฝน) ไม่พยากรณ์
  const intro = flat(m.intro)
  assert.match(intro, /^สถานีวัดระดับน้ำบ้านน้ำปุ๊ \(แม่น้ำยม · ต\.น้ำเลา ห่าง 6 กม\.\) ระดับน้ำสูงกว่าตลิ่ง 0\.35 ม\. อยู่ในเกณฑ์แจ้งเตือนภัยของกรมชลประทาน/)
  assert.equal(m.intro.find(r => r.em).t, 'แจ้งเตือนภัย')
  assert.deepEqual(m.analysis, ['trend', 'rain-too'])
  assert.match(intro, /ระดับน้ำเพิ่มขึ้น 0\.35 ม\. เทียบกับ 08:30 น\. ประกอบกับฝนหนักในพื้นที่ \(บ้านบุญแจ่ม 60 มม\.\)$/)
  assert.doesNotMatch(intro, /คาดว่า|จะ(ล้น|ท่วม)|อพยพ/)
  assert.deepEqual({ kind: m.illustration.kind, bankDiff: m.illustration.bankDiff, rainy: m.illustration.rainy }, { kind: 'overbank', bankDiff: -0.35, rainy: true })
  assert.equal(flat(m.todo[0]), 'ยกของขึ้นที่สูง ปิดเครื่องใช้ไฟฟ้า เตาแก๊ส ยกเบรกเกอร์')
  assert.equal(flat(m.todo[1]), 'เตรียมของจำเป็น น้ำดื่ม อาหารแห้ง ยา โทรศัพท์ · ติดตามระดับน้ำ แม่น้ำยม ใกล้ชิด')
  assert.equal(flat(m.todo[2]), 'พบน้ำท่วมบ้านหรือเหตุฉุกเฉิน แจ้งเทศบาลทันที')
  assert.match(m.footer.lines[0], /^แหล่งข้อมูล: คลังข้อมูลน้ำแห่งชาติ \(ThaiWater\) สสน\. · เกณฑ์ระดับน้ำ กรมชลประทาน \(มาตรฐานข้อมูลน้ำ สสน\.\) · เกณฑ์ฝน กรมอุตุนิยมวิทยา · ค่าระดับน้ำ 15 พ\.ย\. 69 09:30 น\. · ค่าฝน/)
  assert.match(m.footer.lines[1], /ไม่ใช่ประกาศของเทศบาลตำบลน้ำเลา/)
  assert.match(m.shareText, /ไม่ใช่ประกาศของเทศบาลตำบลน้ำเลา/)
  assert.match(m.altText, /น้ำสูงกว่าตลิ่ง 0\.35 ม\. แม่น้ำยม สถานีบ้านน้ำปุ๊/)

  // เสมอตลิ่ง (diff 0) → "น้ำเสมอตลิ่ง" ไม่ใช่ "สูงกว่าตลิ่ง 0.00 ม."
  const at = buildPosterModel(input({ levels: [level(0, { prev_waterlevel_msl: null, river_name: null })] }))
  assert.equal(at.kind, 'overbank')
  assert.equal(at.headline.level, 'น้ำเสมอตลิ่ง')
  assert.equal(at.headline.name, 'บ้านน้ำปุ๊')
  assert.equal(at.tiles[0].value, '0.00')
  assert.equal(at.tiles[0].unit, 'ม. เสมอตลิ่ง')
  assert.equal(at.scale.markLabel, 'บ้านน้ำปุ๊ เสมอตลิ่ง')
  assert.equal(at.scale.value, 0)
  assert.equal(at.scale.activeIndex, 2, 'ค่า 0 พอดีต้องนับเป็นแจ้งเตือนภัย ไม่ใช่เฝ้าระวัง')
  assert.equal(at.illustration.bankText, 'เสมอตลิ่ง')
  assert.match(flat(at.intro), /ระดับน้ำเสมอตลิ่ง อยู่ในเกณฑ์แจ้งเตือนภัย/)
  for (const text of [flat(at.intro), at.headline.level, at.shareText, at.altText, at.scale.markLabel]) assert.doesNotMatch(text, /สูงกว่าตลิ่ง|0\.00 ม\./)
  assert.equal(flat(at.todo[1]), 'เตรียมของจำเป็น น้ำดื่ม อาหารแห้ง ยา โทรศัพท์ · ติดตามระดับน้ำใกล้ชิด', 'ไม่มีชื่อลำน้ำ = ไม่แต่งชื่อ')
  assert.deepEqual(at.tiles.map(x => x.key), ['bank', 'level', 'trend'], 'ไม่มีฝน = ไม่มีช่องฝน')
  assert.equal(at.illustration.rainy, false)
  // ค่าเล็กกว่า 0.005 ม. ปัดเป็นเสมอตลิ่งเหมือน bankText
  assert.equal(buildPosterModel(input({ levels: [level(-0.004)] })).headline.level, 'น้ำเสมอตลิ่ง')

  // แนวโน้ม: ขึ้น/ลง/ทรงตัว/ไม่มีค่าเดิม (ต่างน้อยกว่า 0.02 ม. = ทรงตัว) — กฎล้วน ไม่พยากรณ์
  const trendOf = extra => buildPosterModel(input({ levels: [level(-0.2, extra)] }))
  const down = trendOf({ waterlevel_msl: 123.0, prev_waterlevel_msl: 123.3 })
  assert.deepEqual([down.tiles[2].value, down.tiles[2].unit], ['ลง', '0.30 ม.'])
  assert.match(flat(down.intro), /ระดับน้ำลดลง 0\.30 ม\. เทียบกับ 08:30 น\.$/)
  const same = trendOf({ waterlevel_msl: 123.31, prev_waterlevel_msl: 123.3 })
  assert.deepEqual([same.tiles[2].value, same.tiles[2].unit], ['ทรงตัว', 'ต่างไม่ถึง 0.02 ม.'])
  assert.match(flat(same.intro), /ระดับน้ำทรงตัว เทียบกับ 08:30 น\.$/)
  const none = trendOf({ prev_waterlevel_msl: null })
  assert.deepEqual([none.tiles[2].value, none.tiles[2].unit], ['–', 'ไม่มีข้อมูลก่อนหน้า'])
  assert.deepEqual(none.analysis, [])
  assert.match(flat(none.intro), /ของกรมชลประทาน รายละเอียดดังนี้$/)
  // ค่าก่อนหน้าคนละวัน → ใส่วันที่ · ไม่มีเวลาของค่าก่อนหน้า → "เทียบกับค่าก่อนหน้า"
  assert.match(flat(trendOf({ prev_recorded_at: '2026-11-14T14:00:00Z' }).intro), /เทียบกับ 14 พ\.ย\. 69 21:00 น\.$/)
  assert.match(flat(trendOf({ prev_recorded_at: null }).intro), /เพิ่มขึ้น 0\.35 ม\. เทียบกับค่าก่อนหน้า$/)
  // ไม่มีค่าระดับน้ำ (waterlevel_msl) → ช่อง "–" ไม่เดา
  const noLevel = trendOf({ waterlevel_msl: null })
  assert.deepEqual([noLevel.tiles[1].value, noLevel.tiles[1].unit], ['–', 'ไม่มีข้อมูล'])
  // ฝนปานกลาง (≤35) ไม่ทำให้เกิดประโยค "ประกอบกับฝนหนัก" แต่ช่องฝนยังแสดง
  const mild = buildPosterModel(input({ levels: [level(-0.2)], rain: [rain('R1', 'ก', 20, { is_primary: true })] }))
  assert.deepEqual(mild.analysis, ['trend'])
  assert.equal(mild.tiles.find(x => x.key === 'rain24').value, '20')
  assert.equal(mild.illustration.rainy, false)
  // หัวภาพเป็นน้ำเสมอตลิ่ง ไม่ใส่อ่างในช่อง/ภาพ แต่ยังเป็นภาพได้แม้มีอ่างค่าสด
  const withDam = buildPosterModel(input({ levels: [level(-0.2)], dams: [dam({ storage_percent: 60 })] }))
  assert.deepEqual(withDam.tiles.map(x => x.key), ['bank', 'level', 'trend'])
  assert.doesNotMatch(withDam.footer.lines[0], /ค่าอ่าง/)
}

// ── ป้ายหน่วยงาน: คำขวัญ Smart City (เจ้าของสั่ง 2569-11-15) ──
{
  const models = [buildPosterModel(input({ dams: [dam()] })), buildPosterModel(input({ ews: [E3()] })), buildPosterModel(input({ levels: [level(-0.2)] }))]
  for (const m of models) {
    assert.match(m.badge.tag, /^มุ่งสู่เมืองอัจฉริยะ \(Smart City\)$/)
    assert.equal(m.badge.system, 'ระบบข้อมูลน้ำ–ฝน')
    // ยังไม่ได้รับรองเป็นเมืองอัจฉริยะ ห้ามเขียนว่า "เป็น"
    assert.doesNotMatch(`${m.badge.system} ${m.badge.tag}`, /เป็นเมืองอัจฉริยะ|เมืองอัจฉริยะต้นแบบ/)
  }
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

console.log('PASS: topic selection (EWS3 > overbank > EWS2 > dam>100 > heavy rain, 80-100 no poster, stale ignored, none = null), ews + overbank models (wording from rules only, no cause claims, at-bank wording, trends), rain rows (in-tambon first, cause kept, no summing), tile head colors by threshold / neutral for supporting values, phones (none = hidden, no fallback), other-hazard note, wording by org type, footer disclaimers, PDPA')

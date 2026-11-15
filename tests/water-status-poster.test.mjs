// ภาพรายงานสถานการณ์น้ำ-ฝนทุกสถานการณ์ — กฎตัดสินสถานะ (selectStatus) + ข้อมูลภาพ (buildStatusPosterModel) ใน node ไม่มี DOM
// ส่วนวาดจริงอยู่ที่ tests/water-status-poster.playwright.mjs (Chrome)
// กฎที่เจ้าของระบบอนุมัติ 2026-11-15: แจ้งเตือน → เฝ้าระวัง → น้ำน้อย (≤50%, ≤30% วิกฤติ) → ข้อมูลไม่ครบ → ปกติ
import assert from 'node:assert/strict'
import { LOW_WATER_CRITICAL_PCT, LOW_WATER_PCT, STATUS_RULE_TEXT, buildPosterModel, buildStatusPosterModel, selectStatus } from '../src/lib/waterAlertPoster.js'

const NOW = Date.parse('2026-11-15T03:00:00Z') // 10:00 น. เวลาไทย
const FRESH = '2026-11-15T02:30:00Z'
const STALE = '2026-11-14T20:00:00Z' // 7 ชม. ก่อน (> 3 ชม.)
const DAM_AT = '2026-11-14T17:00:00Z'
const tenant = { name: 'เทศบาลตำบลน้ำเลา', org_type: 'เทศบาลตำบล', district: 'ร้องกวาง', province: 'แพร่', phone: '054-522-092' }
const base = { amphoe_name: 'ร้องกวาง', province_name: 'แพร่', tambon_name: 'น้ำเลา', river_name: null, is_primary: false }
const dam = (pct, extra = {}) => ({
  ...base, station_type: 'dam', station_code: '305', station_name: 'อ่างเก็บน้ำแม่คำปอง', distance_km: 3.6, is_primary: true,
  recorded_at: DAM_AT, storage_percent: pct, dam_storage_mcm: 3, dam_capacity_mcm: 6.76, dam_inflow_mcm: 0.02, dam_released_mcm: 0.04, ...extra,
})
const rain = (mm, extra = {}) => ({ ...base, station_type: 'rain', station_code: 'R1', station_name: 'บ้านบุญแจ่ม', distance_km: 2.6, is_primary: true, recorded_at: FRESH, rain_24h_mm: mm, rain_1h_mm: null, ...extra })
const level = (diff, extra = {}) => ({ ...base, station_type: 'waterlevel', station_code: 'W1', station_name: 'บ้านน้ำปุ๊', river_name: 'แม่น้ำยม', distance_km: 6, recorded_at: FRESH, bank_diff_m: diff, waterlevel_msl: 121, prev_waterlevel_msl: 120.9, ...extra })
const input = extra => ({ rain: [rain(2)], ews: [], levels: [], dams: [dam(72)], warnings: [], tenant, now: NOW, ...extra })
const state = extra => { const s = selectStatus(input(extra)); return `${s.state}/${s.reason ?? ''}` }

// ค่าเกณฑ์ผูกกับ DAM_LEVELS ของกรมชลฯ ตามที่เจ้าของเลือก (1ก)
assert.equal(LOW_WATER_PCT, 50)
assert.equal(LOW_WATER_CRITICAL_PCT, 30)

// ปกติ
assert.equal(state({}), 'normal/none')
// อ่าง 80–100% (น้ำมาก) ยังปกติ — ไม่ดันเป็นเฝ้าระวัง
assert.equal(state({ dams: [dam(80.1)] }), 'normal/none')
assert.equal(state({ dams: [dam(100)] }), 'normal/none')

// น้ำน้อย: ขอบ 50 / 50.1 · 30 / 30.1
assert.equal(state({ dams: [dam(50.1)] }), 'normal/none')
assert.equal(state({ dams: [dam(50)] }), 'low/low')
assert.equal(state({ dams: [dam(30.1)] }), 'low/low')
assert.equal(state({ dams: [dam(30)] }), 'low/critical')
// อ่างในตำบลมาก่อนอ่างที่ใกล้กว่า (pickContextDam) — อ่างนอกตำบลน้ำน้อยไม่ทำให้ภาพเป็นน้ำน้อย
assert.equal(state({ dams: [dam(72), dam(20, { station_code: '310', is_primary: false, distance_km: 1 })] }), 'normal/none')
// อ่างค่าเก่า (> 48 ชม.) ไม่ใช้ตัดสินน้ำน้อย และทำให้ "ข้อมูลไม่ครบ"
assert.equal(state({ dams: [dam(20, { recorded_at: '2026-11-12T17:00:00Z' })] }), 'nodata/missing')

// เฝ้าระวัง: ฝน 35.0 = ปานกลาง · 35.1 = หนัก · 90.1 = หนักมาก (= ภาพแจ้งเตือน ไม่ใช่ภาพสถานะ)
assert.equal(state({ rain: [rain(35)] }), 'normal/none')
assert.equal(state({ rain: [rain(35.1)] }), 'watch/rain')
assert.equal(state({ rain: [rain(90)] }), 'watch/rain')
assert.equal(selectStatus(input({ rain: [rain(90.1)] })).state, 'alert')
assert.equal(buildStatusPosterModel(input({ rain: [rain(90.1)] })), null)
assert.ok(buildPosterModel(input({ rain: [rain(90.1)] })))
// ฝนหนักค่าเก่า = ไม่นับ
assert.equal(state({ rain: [rain(60, { recorded_at: STALE }), rain(1, { station_code: 'R2' })] }), 'normal/none')
// ระดับน้ำ: ต่ำกว่าตลิ่ง 1.00 ม. = เฝ้าระวัง (ข้างปลอดภัย) · 1.01 = ปกติ · 0 = เสมอตลิ่ง = แจ้งเตือน
assert.equal(state({ levels: [level(1)] }), 'watch/level')
assert.equal(state({ levels: [level(1.01)] }), 'normal/none')
assert.equal(selectStatus(input({ levels: [level(0)] })).state, 'alert')
// เฝ้าระวังมาก่อนน้ำน้อย · ระดับน้ำมาก่อนฝน
assert.equal(state({ rain: [rain(50)], dams: [dam(20)] }), 'watch/rain')
assert.equal(state({ rain: [rain(50)], levels: [level(0.5)] }), 'watch/level')
// ข้อความเตือน สสน. ของอำเภออย่างเดียว = เฝ้าระวัง
assert.equal(state({ warnings: [{ message: 'เฝ้าระวังฝนตกหนัก', issued_at: '2026-11-15T01:00:00Z' }] }), 'watch/warning')

// ข้อมูลไม่ครบ — ห้ามขึ้นปกติ
assert.equal(state({ rain: [] }), 'nodata/missing')
assert.equal(state({ rain: [rain(0, { recorded_at: STALE })] }), 'nodata/missing')
assert.deepEqual(selectStatus(input({ rain: [rain(0, { recorded_at: STALE }), rain(0, { station_code: 'R9', is_primary: false })] })).missing, ['rain-tambon'])
assert.deepEqual(selectStatus(input({ levels: [level(3, { is_primary: true, recorded_at: STALE })] })).missing, ['level'])

// ข้อมูลภาพ: ไม่มีคำประกาศภัยแล้งทุกสถานะ · มีบรรทัดเกณฑ์ · ชื่อไฟล์/ข้อความแชร์เป็นภาพสถานะ
const scenes = {
  normal: {}, low: { dams: [dam(42)] }, critical: { dams: [dam(24)] }, rain: { rain: [rain(52)] }, level: { levels: [level(0.6)] },
  warning: { warnings: [{ message: 'เฝ้าระวังฝนตกหนัก', issued_at: '2026-11-15T01:00:00Z' }] }, nodata: { rain: [] },
}
for (const [key, extra] of Object.entries(scenes)) {
  const model = buildStatusPosterModel(input(extra))
  assert.ok(model, `${key}: ต้องมีภาพสถานะ`)
  assert.equal(model.kind, 'status')
  const text = JSON.stringify({ ...model, introFor: undefined })
  assert.equal(/ภัยแล้ง|แล้ง/.test(text), false, `${key}: ห้ามมีคำแล้งในภาพ`)
  assert.ok(model.footer.lines.includes(STATUS_RULE_TEXT), `${key}: ต้องมีบรรทัดเกณฑ์`)
  assert.match(model.fileName, /^water-status-20261115\.png$/)
  assert.match(model.shareText, /ไม่ใช่ประกาศของเทศบาลตำบลน้ำเลา/)
  assert.ok(model.tiles.length >= 1 && model.tiles.length <= 4, `${key}: ช่องตัวเลข 1–4 ช่อง`)
  assert.ok(model.todo.length === 3, `${key}: ข้อควรทำ 3 ข้อ`)
}
assert.equal(buildStatusPosterModel(input({})).banner, 'ปกติ')
assert.equal(buildStatusPosterModel(input({ rain: [] })).banner, 'ข้อมูลไม่ครบ')
assert.equal(buildStatusPosterModel(input({ dams: [dam(24)] })).headline.level, 'น้ำน้อยวิกฤติ 24%')
// ภาพปกติต้องมีตัวเลขจริง (ไม่ใช่แค่คำว่าปกติ)
assert.deepEqual(buildStatusPosterModel(input({})).tiles.map(t => t.key), ['rain24', 'pct', 'volume', 'outflow'])

console.log('PASS: status rules (alert > watch level > watch rain > watch warning > low ≤50/≤30 > nodata > normal; dam 80–100 stays normal; stale ignored; edges 30/50, 35/35.1/90/90.1, bank 1.00/1.01/0), status models (no drought wording, rule line, file name, share text)')

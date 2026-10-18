// หน้า "เหตุการณ์น้ำ-ฝน" ของเจ้าหน้าที่ (เฟส 3 · PR 3.2) — ตรรกะล้วนของ src/lib/waterEvents.js + ตรวจโค้ดหน้าจอ/ฟังก์ชันฐานข้อมูล (ไม่ใช้ฐานข้อมูล/เบราว์เซอร์)
// node tests/water-events-ui.test.mjs
//
// เรื่องที่ต้องไม่พลาด: (1) ค่าว่างไม่กลายเป็น 0 (2) เส้นกราฟไม่ลากข้ามช่วงที่สถานีไม่ส่งค่า (3) ข้อความเตือน สสน. ตามต้นฉบับ
// (4) ข้อความสถานะระบบจดไม่สั่งให้ใครทำอะไร (5) หน้านี้ "ไม่มีงานให้เจ้าหน้าที่": ไม่มีช่องกรอก ไม่มีทางเขียน ปุ่มมีแค่ open/back/retry/print
// (6) สิทธิ์ฝั่งหน้าเว็บตรงกับฟังก์ชันฐานข้อมูล (7) ฝั่งหน้าเว็บเรียกฟังก์ชันที่ migration มีจริง
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  RECORDER_LATE_HOURS, WATER_EVENT_CRITERIA, WATER_EVENT_CRITERIA_NOTES, WATER_EVENTS_DISCLAIMER,
  chartGapMs, closeReasonText, durationText, eventCard, eventSpan, gapText, isEventOpen, longestSameRun,
  openReasonLines, recorderStatus, sparkline, stationGaps, stationSummaries, thaiDateTime, triggerText, warningRows,
} from '../src/lib/waterEvents.js'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const HOUR = 3600_000
const T = (iso) => Date.parse(iso)
const NOW = T('2026-10-20T09:00:00Z')

// ── 1) เวลา/ระยะเวลา ──
{
  assert.equal(thaiDateTime('2026-10-20T03:20:00Z'), '20 ต.ค. 69 10:20 น.', 'ยึดเวลาไทย ปี พ.ศ. 2 หลัก')
  assert.equal(thaiDateTime('2026-10-20T17:30:00Z'), '21 ต.ค. 69 00:30 น.', 'ข้ามเที่ยงคืนตามเวลาไทย ไม่ใช่ UTC')
  assert.equal(thaiDateTime(null), ''); assert.equal(thaiDateTime(undefined), ''); assert.equal(thaiDateTime('ไม่ใช่วันที่'), '')
  assert.equal(durationText(10 * 60_000), 'ไม่ถึง 1 ชม.'); assert.equal(durationText(5 * HOUR), '5 ชม.')
  assert.equal(durationText(26 * HOUR), '1 วัน 2 ชม.'); assert.equal(durationText(48 * HOUR), '2 วัน')
  assert.equal(durationText(-1), ''); assert.equal(durationText(NaN), '')
  console.log('✓ เวลา: ยึดเวลาไทย + พ.ศ. · ช่วงเวลาอ่านง่าย · ค่าเสียไม่ทำให้พัง')
}

// ── 2) สถานะตัวจด: ไม่สั่งให้ใครทำอะไร ──
{
  assert.equal(RECORDER_LATE_HOURS, 3)
  const ok = recorderStatus({ last_ok_at: '2026-10-20T08:20:00Z' }, NOW)
  assert.equal(ok.kind, 'ok'); assert.match(ok.text, /ระบบตรวจล่าสุด 15:20 น\./)
  assert.equal(recorderStatus({ last_ok_at: new Date(NOW - 3 * HOUR).toISOString() }, NOW).kind, 'ok', 'ครบ 3 ชม. พอดียังไม่เตือน')
  const late = recorderStatus({ last_ok_at: new Date(NOW - 3 * HOUR - 1000).toISOString() }, NOW)
  assert.equal(late.kind, 'late'); assert.match(late.text, /ไม่ได้ตรวจมา 3 ชม\./); assert.match(late.text, /ข้อมูลช่วงนี้อาจไม่ครบ/)
  for (const status of [ok, late, recorderStatus(null, NOW), recorderStatus({}, NOW), recorderStatus({ last_ok_at: 'x' }, NOW)]) {
    assert.ok(!/แจ้ง|กรุณา|โปรด|ติดต่อ|ผู้ดูแลระบบ|กด|ตรวจสอบ/.test(status.text), `ข้อความสถานะต้องไม่สั่งงานเจ้าหน้าที่: ${status.text}`)
  }
  assert.equal(recorderStatus(null, NOW).kind, 'unknown'); assert.equal(recorderStatus({ last_ok_at: null }, NOW).kind, 'unknown')
  assert.equal(recorderStatus({ last_ok_at: 'ไม่ใช่วันที่' }, NOW).kind, 'unknown', 'เวลาเสีย = ไม่รู้ ไม่ใช่ ok')
  console.log('✓ สถานะตัวจด: ok / late (เกิน 3 ชม.) / unknown · ข้อความไม่สั่งงานเจ้าหน้าที่')
}

// ── 3) เหตุผลปิด + สาเหตุที่เปิด ──
{
  assert.match(closeReasonText('calm'), /24 ชม\./)
  assert.match(closeReasonText('data_lost'), /ไม่ได้แปลว่าเหตุการณ์จบจริง/)
  assert.match(closeReasonText('module_off'), /ปิดโมดูล/)
  assert.equal(closeReasonText(null), ''); assert.equal(closeReasonText('อะไรไม่รู้'), '', 'ค่าที่ไม่รู้จักไม่โชว์รหัสดิบ')
  assert.equal(triggerText({ kind: 'rain', station_name: 'บ้านบุญแจ่ม', value: 112.34 }), 'ฝนสะสม 24 ชม. 112.3 มม. ที่บ้านบุญแจ่ม')
  assert.equal(triggerText({ kind: 'waterlevel', station_name: 'Y.38', value: 0.8 }), 'Y.38 ต่ำกว่าตลิ่ง 0.80 ม.')
  assert.equal(triggerText({ kind: 'waterlevel', station_name: 'Y.38', value: 0 }), 'Y.38 ระดับน้ำเสมอตลิ่ง')
  assert.equal(triggerText({ kind: 'waterlevel', station_name: 'Y.38', value: -0.3 }), 'Y.38 สูงกว่าตลิ่ง 0.30 ม.')
  assert.equal(triggerText({ kind: 'ews', station_name: 'สถานี ก', value: 2 }), 'สถานีเตือนภัย สถานี ก ระดับ 2')
  assert.equal(triggerText({ kind: 'warning', station_name: 'น้ำท่วมฉับพลัน' }), 'ข้อความเตือนของ สสน. (น้ำท่วมฉับพลัน)')
  assert.equal(triggerText({ kind: 'rain', station_name: 'ก', value: null }), null, 'ค่าว่างไม่กลายเป็น "0 มม."')
  assert.equal(triggerText({ kind: 'waterlevel', station_name: 'ก', value: null }), null, 'ระดับน้ำว่างไม่กลายเป็น "เสมอตลิ่ง"')
  assert.equal(triggerText({ kind: 'dam', value: 99 }), null, 'อ่างไม่ใช่ตัวเปิดเหตุการณ์ — ชนิดที่ไม่รู้จักข้าม')
  assert.equal(triggerText(null), null)
  const r = openReasonLines({ triggers: [1, 2, 3, 4, 5].map(i => ({ kind: 'rain', station_name: `ส${i}`, value: 100 + i })) }, 3)
  assert.equal(r.lines.length, 3); assert.equal(r.more, 2)
  assert.deepEqual(openReasonLines({ triggers: [] }), { lines: [], more: 0 }); assert.deepEqual(openReasonLines(null), { lines: [], more: 0 })
  console.log('✓ สาเหตุ: เขียนจาก open_reason ตรงๆ · ค่าว่าง/ชนิดไม่รู้จักไม่กลายเป็นตัวเลขหรือรหัสดิบ')
}

// ── 4) การ์ดเหตุการณ์ ──
{
  const open = { id: 'e1', opened_at: '2026-10-20T03:20:00Z', closed_at: null, ended_at: null, close_reason: null,
    open_reason: { triggers: [{ kind: 'rain', station_name: 'ก', value: 95 }] }, stations_count: 3, readings_count: 1234, peak_rain_24h_mm: 110.5, min_bank_diff_m: 0.8, warnings_count: 2 }
  const c = eventCard(open, NOW)
  assert.equal(c.open, true); assert.equal(c.statusLabel, 'กำลังเกิดเหตุการณ์'); assert.equal(c.endText, ''); assert.equal(c.duration, '5 ชม.')
  assert.deepEqual(c.peaks, ['ฝนสะสม 24 ชม. สูงสุด 110.5 มม.', 'ใกล้ตลิ่งที่สุด: ต่ำกว่าตลิ่ง 0.80 ม.'])
  assert.equal(c.stationsCount, 3); assert.equal(c.warningsCount, 2); assert.equal(c.closeText, '')
  const closed = { ...open, closed_at: '2026-10-22T10:00:00Z', ended_at: '2026-10-21T09:20:00Z', close_reason: 'calm' }
  const cc = eventCard(closed, NOW)
  assert.equal(cc.open, false); assert.equal(cc.statusLabel, 'จบแล้ว'); assert.equal(cc.endText, '21 ต.ค. 69 16:20 น.'); assert.equal(cc.duration, '1 วัน 6 ชม.', 'นับถึงสัญญาณสุดท้าย (ended_at) ไม่ใช่เวลาปิดรอบ')
  assert.match(cc.closeText, /ระบบปิดเอง/)
  const empty = eventCard({ ...open, peak_rain_24h_mm: null, min_bank_diff_m: null, stations_count: 0, readings_count: 0, warnings_count: 0 }, NOW)
  assert.deepEqual(empty.peaks, [], 'ไม่มีค่าที่วัดได้ = ไม่แสดงบรรทัดค่าสูงสุด (ไม่ใช่ 0)')
  assert.equal(isEventOpen(open), true); assert.equal(isEventOpen(closed), false)
  assert.equal(eventSpan(open, NOW).open, true)
  console.log('✓ การ์ด: เปิดอยู่นับถึงตอนนี้ · ปิดแล้วนับถึงสัญญาณสุดท้าย · ไม่มีค่า = ไม่มีบรรทัดค่าสูงสุด')
}

// ── 5) กราฟเส้น: ไม่ลากข้ามช่วงที่ไม่มีค่า ──
{
  assert.equal(sparkline([]), null); assert.equal(sparkline(null), null)
  assert.equal(sparkline([{ t: NaN, v: 1 }, { t: 1, v: NaN }]), null, 'จุดเสียถูกตัด')
  const gapMs = 3 * HOUR
  const pts = [0, 1, 2, 3, 10, 11, 12].map((h, i) => ({ t: h * HOUR, v: [1, 3, 2, 5, 4, 6, 2][i] }))
  const s = sparkline(pts, { gapMs })
  assert.equal(s.paths.length, 2, 'ช่องว่าง 7 ชม. (> 3 ชม.) ต้องตัดเส้นเป็น 2 ท่อน ไม่ลากข้าม')
  assert.equal(s.segments, 2); assert.equal(s.min, 1); assert.equal(s.max, 6)
  const noGap = sparkline(pts, {}); assert.equal(noGap.paths.length, 1, 'ไม่กำหนดเกณฑ์ช่องว่าง = เส้นเดียว')
  const lone = sparkline([{ t: 0, v: 1 }, { t: 1 * HOUR, v: 2 }, { t: 20 * HOUR, v: 3 }], { gapMs })
  assert.equal(lone.paths.length, 1); assert.equal(lone.dots.length, 1, 'จุดโดดวาดเป็นจุด ไม่ใช่เส้นไปหาเพื่อนบ้านที่ห่างไกล')
  const single = sparkline([{ t: 5, v: 7 }]); assert.equal(single.paths.length, 0); assert.equal(single.dots.length, 1)
  const flat = sparkline([{ t: 0, v: 5 }, { t: HOUR, v: 5 }]); assert.ok(Number.isFinite(flat.max) && flat.paths[0].match(/NaN|Infinity/) === null, 'ค่าเท่ากันหมดไม่หารศูนย์')
  assert.equal(flat.paths[0], 'M4 32 L236 32', 'ค่าคงที่ที่ไม่มีฐานอ้างอิง = เส้นกลางกรอบ ไม่ใช่เส้นขอบล่าง')
  const flatZero = sparkline([{ t: 0, v: 0 }, { t: HOUR, v: 0 }], { baseline: 0 }); assert.equal(flatZero.paths[0], 'M4 60 L236 60', 'ฝน 0 ตลอด = อยู่ฐานกราฟ')
  const rain = sparkline([{ t: 0, v: 0 }, { t: HOUR, v: 0 }, { t: 2 * HOUR, v: 4 }], { baseline: 0, height: 64, pad: 4 })
  assert.match(rain.paths[0], /^M4 60 L/, 'ฝน 0 มม. อยู่ฐานกราฟ (ฐาน 0) ไม่ลอย')
  for (const p of [...s.paths, ...lone.paths, ...rain.paths]) assert.ok(!/NaN|Infinity/.test(p))
  assert.equal(chartGapMs('rain'), 3 * HOUR); assert.equal(chartGapMs('waterlevel'), 3 * HOUR); assert.equal(chartGapMs('dam'), 48 * HOUR)
  console.log('✓ กราฟ: ตัดเส้นตรงช่วงที่ไม่มีค่า · จุดโดดเป็นจุด · ค่าคงที่ไม่หารศูนย์ · ฝนใช้ฐาน 0')
}

// ── 6) ช่วงที่สถานีไม่ส่งค่า + ตัวเลขซ้ำเดิม ──
{
  const rs = [0, 1, 2, 8, 9].map(h => ({ t: new Date(T('2026-10-20T00:00:00Z') + h * HOUR).toISOString() }))
  const gaps = stationGaps(rs, 3)
  assert.equal(gaps.length, 1); assert.equal(gaps[0].to - gaps[0].from, 6 * HOUR)
  assert.equal(stationGaps(rs, 3, { now: T('2026-10-20T10:00:00Z') }).length, 1, 'ค่าล่าสุดห่างตอนนี้ 1 ชม. ยังไม่ขาด')
  const ongoing = stationGaps(rs, 3, { now: T('2026-10-20T15:00:00Z') })
  assert.equal(ongoing.length, 2); assert.equal(ongoing[1].ongoing, true)
  assert.match(gapText(ongoing[1]), /^ไม่มีค่าใหม่ตั้งแต่ .+ \(6 ชม\.\)$/)
  assert.match(gapText(gaps[0]), /^ไม่มีค่าช่วง .+ – .+ \(6 ชม\.\)$/)
  assert.deepEqual(stationGaps([], 3), []); assert.deepEqual(stationGaps(null, 3, { now: NOW }), [])

  const same = [{ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 1, b: 2 }, { a: 1, b: 3 }, { a: 1, b: 3 }]
  assert.equal(longestSameRun(same, ['a', 'b']), 3)
  assert.equal(longestSameRun([{ a: 1 }, {}, { a: 1 }, { a: 1 }], ['a']), 2, 'ค่าว่างคั่นกลางตัดรอบ ไม่นับเป็นซ้ำ')
  assert.equal(longestSameRun([{}, {}, {}, { a: null }], ['a']), 0, 'ค่าว่างหลายรายการติดกันไม่นับเป็น "ตัวเลขซ้ำเดิม"')
  assert.equal(longestSameRun([], ['a']), 0)
  console.log('✓ ช่วงไม่มีค่า: นับเฉพาะที่ห่างเกินเกณฑ์ · ค่าล่าสุดเก่าเกิน = ยังเงียบอยู่ (เฉพาะเหตุการณ์ที่เปิดอยู่) · ตัวเลขซ้ำนับถูก')
}

// ── 7) สรุปรายสถานี ──
{
  const at = (h) => new Date(T('2026-10-20T00:00:00Z') + h * HOUR).toISOString()
  const stations = [
    { station_type: 'dam', station_code: 'D1', station_name: 'อ่าง ค', readings: [
      { t: at(0), storage_pct: 101.2, dam_storage: 6.1, dam_inflow: 0.2, dam_released: 0.1 },
      { t: at(24), storage_pct: 101.2, dam_storage: 6.1, dam_inflow: 0.2, dam_released: 0.1 },
      { t: at(48), storage_pct: 101.2, dam_storage: 6.1, dam_inflow: 0.2, dam_released: 0.1 }] },
    { station_type: 'waterlevel', station_code: 'L1', station_name: 'สถานี ข', readings: [
      { t: at(0), level_msl: 150.5, bank_diff: 2.5 }, { t: at(1), bank_diff: 0.8 }, { t: at(2), level_msl: 151.7, bank_diff: 1.2 }] },
    { station_type: 'rain', station_code: 'R1', station_name: 'สถานี ก', readings: [
      { t: at(2), rain_24h: 0 }, { t: at(0), rain_24h: 95.5, rain_1h: 12 }, { t: at(1), rain_24h: 110 }] },
    { station_type: 'ews', station_code: 'E1', station_name: 'สถานีเตือน', readings: [
      { t: at(0), sit_level: 1, sit_text: 'เฝ้าระวัง' }, { t: at(1), sit_level: 2, sit_text: 'เตรียมพร้อม' }] },
  ]
  const out = stationSummaries(stations, { now: T(at(60)), open: false })
  assert.deepEqual(out.map(s => s.type), ['rain', 'waterlevel', 'dam', 'ews'], 'เรียงฝน → ระดับน้ำ → อ่าง → เตือนภัย')
  const [rain, level, dam, ews] = out
  assert.equal(rain.headline, 'ฝนสะสม 24 ชม. สูงสุด 110 มม. (ฝนหนักมาก)'); assert.ok(rain.lines.some(l => l.includes('ฝนรายชั่วโมงสูงสุด 12 มม.')))
  assert.ok(rain.lines.some(l => l.startsWith('ค่าล่าสุดที่จด 0 มม.')), 'ฝน 0 มม. ที่วัดได้แสดงเป็น 0 (วัดได้จริง)')
  assert.equal(rain.chart.length, 3); assert.equal(rain.baseline, 0)
  assert.equal(level.headline, 'ใกล้ตลิ่งที่สุด: ต่ำกว่าตลิ่ง 0.80 ม.'); assert.ok(level.lines.some(l => l.includes('151.70 ม.รทก.')))
  assert.equal(level.chart.length, 2, 'กราฟระดับน้ำใช้เฉพาะจุดที่มีค่าระดับน้ำ ไม่เติม 0 ให้จุดที่ว่าง')
  assert.equal(dam.headline, 'ปริมาณน้ำสูงสุด 101.2% ของความจุเก็บกัก (เกินความจุเก็บกัก)')
  assert.ok(dam.notes.some(n => n.includes('เกินความจุที่ระดับเก็บกักปกติ'))); assert.ok(dam.notes.some(n => n.includes('ซ้ำเดิม 3 รายงานติดกัน')))
  assert.equal(dam.gaps.length, 0, 'อ่างรายวันห่างกัน 24 ชม. ไม่นับเป็นช่วงขาด (เกณฑ์ 48 ชม.)')
  assert.equal(ews.headline, 'ระดับเตือนภัยสูงสุด 2 (เตรียมพร้อม)'); assert.equal(ews.chart, null)
  // brief = รูปย่อ 1 แถวต่อสถานี (ใบพิมพ์ A4) — ว่าง = ไม่มีค่า ไม่ใช่ 0
  assert.deepEqual(rain.brief, { metric: 'ฝนสะสม 24 ชม.', peakText: '110 มม. (ฝนหนักมาก)', peakAt: rain.brief.peakAt, lastText: rain.brief.lastText, flags: [] })
  assert.match(rain.brief.peakAt, /^\d+ [ก-๙.]+ 69 \d\d:\d\d น\.$/); assert.match(rain.brief.lastText, /^0 มม\. \(.+ น\.\)$/, 'ค่าล่าสุดที่วัดได้ 0 มม. ยังเป็น 0')
  assert.equal(level.brief.peakText, 'ต่ำกว่าตลิ่ง 0.80 ม.'); assert.match(level.brief.metric, /ใกล้ตลิ่งสุด/); assert.match(level.brief.lastText, /^ต่ำกว่าตลิ่ง 1\.20 ม\./)
  assert.equal(dam.brief.peakText, '101.2% ของความจุเก็บกัก (เกินความจุเก็บกัก)'); assert.equal(dam.brief.lastText, '')
  assert.deepEqual(dam.brief.flags, ['>100% = เกินความจุที่ระดับเก็บกักปกติ', 'ตัวเลขซ้ำเดิม 3 รายงาน'])
  assert.equal(ews.brief.peakText, 'ระดับ 2 (เตรียมพร้อม)'); assert.equal(ews.brief.metric, 'ระดับเตือนภัย')
  // ไม่มีค่าที่วัดได้ → บอกตรงๆ ไม่ใช่ 0
  const blank = stationSummaries([
    { station_type: 'rain', station_code: 'R2', station_name: 'ว่าง', readings: [{ t: at(0) }, { t: at(1) }] },
    { station_type: 'waterlevel', station_code: 'L2', station_name: 'ว่าง', readings: [{ t: at(0) }] },
    { station_type: 'dam', station_code: 'D2', station_name: 'ว่าง', readings: [{ t: at(0) }] },
    { station_type: 'ews', station_code: 'E2', station_name: 'ว่าง', readings: [] },
  ])
  assert.deepEqual(blank.map(s => s.headline), ['ไม่มีค่าฝนที่วัดได้', 'ไม่มีค่าระดับน้ำที่วัดได้', 'ไม่มีค่าปริมาณน้ำที่วัดได้', 'ไม่มีค่าระดับเตือนภัยที่วัดได้'])
  assert.ok(blank.every(s => s.brief.peakText === '' && s.brief.peakAt === '' && s.brief.lastText === ''), 'สถานีที่ไม่มีค่า brief ว่างทั้งหมด (ไม่ใช่ 0)')
  assert.ok(blank.every(s => s.hasValue === false), 'สถานีที่ไม่มีค่า hasValue ต้องเป็น false (ใบพิมพ์ใช้แยกออกไปเป็นบรรทัดเดียว)')
  assert.ok(out.every(s => s.hasValue === true), 'สถานีที่มีค่า hasValue ต้องเป็น true')
  assert.ok(blank.every(s => s.chart === null && !/\b0 มม|0%/.test(s.headline)))
  // เหตุการณ์ที่เปิดอยู่: สถานีเงียบตอนนี้ต้องบอก · ปิดแล้วไม่นับ
  const quiet = [{ station_type: 'rain', station_code: 'R3', station_name: 'เงียบ', readings: [{ t: at(0), rain_24h: 1 }, { t: at(1), rain_24h: 2 }] }]
  assert.ok(stationSummaries(quiet, { now: T(at(10)), open: true })[0].gaps[0].startsWith('ไม่มีค่าใหม่ตั้งแต่'))
  assert.equal(stationSummaries(quiet, { now: T(at(10)), open: false })[0].gaps.length, 0)
  // ชนิดไม่รู้จัก/ข้อมูลเสียไม่พัง
  assert.doesNotThrow(() => stationSummaries([{ station_type: 'x', readings: [{ t: 'เสีย' }] }, null, {}]))
  assert.deepEqual(stationSummaries(null), []); assert.deepEqual(stationSummaries([]), [])
  console.log('✓ รายสถานี: ค่าสูงสุด/ใกล้ตลิ่งสุดถูก · ว่าง = "ไม่มีค่า" ไม่ใช่ 0 · อ่าง >100% มีคำอธิบาย · ตัวเลขซ้ำเดิมขึ้นหมายเหตุ · ข้อมูลเสียไม่พัง')
}

// ── 8) ข้อความ สสน. ตามต้นฉบับ ──
{
  const rows = warningRows([
    { issued_at: '2026-10-20T02:00:00Z', message: 'ข้อความ <b>ไม่ตัดแต่ง</b>\nบรรทัดสอง', station_name: 'สถานี ก', tambon_name: 'ต.หนึ่ง' },
    { issued_at: '2026-10-20T03:00:00Z', message: '   ' }, { message: 123 }, null,
  ])
  assert.equal(rows.length, 1); assert.equal(rows[0].message, 'ข้อความ <b>ไม่ตัดแต่ง</b>\nบรรทัดสอง', 'ส่งต่อตามต้นฉบับ (React เป็นคน escape)')
  assert.equal(rows[0].source, 'สถานี ก · ต.หนึ่ง'); assert.equal(rows[0].issuedText, '20 ต.ค. 69 09:00 น.')
  assert.deepEqual(warningRows(null), [])
  console.log('✓ ข้อความ สสน.: ตามต้นฉบับ ไม่ตัดแต่ง · แถวว่าง/ผิดชนิดถูกข้าม')
}

// ── 9) เกณฑ์ที่แสดงตรงกับของจริง ──
{
  assert.ok(WATER_EVENT_CRITERIA[0].includes('90.1')); assert.ok(WATER_EVENT_CRITERIA[1].includes('1 ม.'))
  assert.equal(WATER_EVENT_CRITERIA.length, 4)
  const tick = read('supabase/migrations/20261016100100_water_events_tick_cron.sql')
  assert.match(tick, /c_heavy_rain[^;]*90\.1/); assert.match(tick, /c_level_watch[^;]*\b1\b/)
  assert.ok(WATER_EVENT_CRITERIA_NOTES.some(n => n.includes('อ่างเก็บน้ำไม่ใช้เปิดเหตุการณ์')))
  assert.match(WATER_EVENTS_DISCLAIMER, /ไม่ใช่การประเมินความเสียหาย/); assert.match(WATER_EVENTS_DISCLAIMER, /ไม่ใช่ 0/)
  console.log('✓ เกณฑ์บนหน้า: ตรงกับ SQL (90.1 มม. / 1 ม.) · คำกำกับครบ')
}

// ── 10) หน้านี้ไม่มีงานให้เจ้าหน้าที่: ไม่มีช่องกรอก ไม่มีทางเขียน ปุ่มมีแค่ open/back/retry/print ──
// print = พิมพ์สรุป A4 (PR 3.3) กดแล้วเปิดหน้าต่างพิมพ์ทันที ไม่มีอะไรให้กรอก — มีที่เดียว เฉพาะหน้ารายละเอียด
const panel = read('src/components/staff/WaterEventsPanel.jsx')
{
  const code = panel.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  for (const forbidden of ['<input', '<textarea', '<select', '<form', 'contentEditable', 'onSubmit', 'onChange', 'dangerouslySetInnerHTML', 'type="submit"', 'type="checkbox"', 'type="radio"', 'window.confirm', 'confirm(', 'prompt(']) {
    assert.ok(!code.includes(forbidden), `หน้านี้ห้ามมี ${forbidden}`)
  }
  for (const writer of ['.insert(', '.update(', '.delete(', '.upsert(', '.from(', '.storage', 'fetch(']) assert.ok(!code.includes(writer), `หน้านี้ห้ามเขียน/อ่านตารางตรง: ${writer}`)
  const rpcs = [...code.matchAll(/supabase\.rpc\('([a-z_]+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(rpcs, ['get_water_event', 'list_water_events'], 'เรียกได้แค่ฟังก์ชันอ่าน 2 ตัว')
  const buttons = [...code.matchAll(/<button\b[^>]*>/g)].map(m => m[0])
  assert.ok(buttons.length >= 5)
  for (const b of buttons) assert.match(b, /data-we-nav="(open|back|retry|print)"/, `ปุ่มต้องเป็น open/back/retry/print เท่านั้น: ${b.slice(0, 80)}`)
  const navs = new Set(buttons.map(b => b.match(/data-we-nav="(\w+)"/)[1]))
  assert.deepEqual([...navs].sort(), ['back', 'open', 'print', 'retry'])
  assert.ok(!/<a\b/.test(code), 'ไม่มีลิงก์ออก')
  console.log(`✓ หน้าจอ: ไม่มี input/textarea/select/form/ลบ/แก้ · อ่านผ่านฟังก์ชัน 2 ตัวเท่านั้น · ปุ่ม ${buttons.length} ปุ่ม มีแค่ open/back/retry/print`)
}

// ── 11) ฟังก์ชันที่หน้าเว็บเรียกมีจริงใน migration + พารามิเตอร์ตรงกัน + สิทธิ์ตรงกัน ──
{
  const mig = read('supabase/migrations/20261017100000_water_events_staff_rpc.sql')
  assert.match(mig, /FUNCTION public\.list_water_events\(_municipality_id uuid, _limit integer DEFAULT 50\)/)
  assert.match(mig, /FUNCTION public\.get_water_event\(_municipality_id uuid, _event_id uuid\)/)
  assert.match(panel, /rpc\('list_water_events', \{ _municipality_id: tenantId \}\)/)
  assert.match(panel, /rpc\('get_water_event', \{ _municipality_id: tenantId, _event_id: selectedId \}\)/)

  const sqlRoles = [...mig.match(/profile\.role IN \(([^)]*)\)/)[1].matchAll(/'(\w+)'/g)].map(m => m[1]).sort()
  assert.ok(/profile\.role = 'superadmin'/.test(mig))
  const dash = read('src/pages/StaffDashboard.jsx')
  const jsRoles = [...dash.match(/const hasWaterEventsAccess = \[([^\]]*)\]/)[1].matchAll(/'(\w+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(jsRoles, [...sqlRoles, 'superadmin'].sort(), 'บทบาทที่เห็นเมนูต้องตรงกับ can_view_water_events() เป๊ะ (กันเมนูหลอก)')
  assert.match(dash, /tenant\.enabled_modules\.includes\('water-situation'\)/, 'เมนูโผล่เมื่อ อปท. เปิดโมดูลสถานการณ์น้ำ-ฝน')
  assert.match(dash, /\.\.\.\(hasWaterEventsAccess \? \[\] : \['water-events'\]\)/, 'คนที่ไม่มีสิทธิ์ถูกซ่อนเมนู')
  assert.match(dash, /activeModule === 'water-events' && visibleModules\.some\(m => m\.key === 'water-events'\)/, 'เปิดตรงๆ ผ่าน state ต้องเช็คสิทธิ์ซ้ำ')
  assert.ok(!/'water-events'/.test(read('src/lib/staffModules.js')), 'ไม่เพิ่มคีย์ enabled_modules ใหม่ (ไม่ต้องแตะข้อมูลทุก อปท.)')
  assert.match(dash, /key: 'water-events', label: 'เหตุการณ์น้ำ-ฝน'/)
  console.log('✓ เชื่อมต่อ: ชื่อฟังก์ชัน/พารามิเตอร์ตรง migration · บทบาทฝั่งหน้าเว็บตรงกับฝั่งฐานข้อมูล · ไม่เพิ่มคีย์ enabled_modules')
}

// ── 12) ไลบรารีเป็นฟังก์ชันล้วน ──
{
  const lib = read('src/lib/waterEvents.js')
  assert.ok(!/supabase|fetch\(|localStorage|document\.|window\./.test(lib.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')), 'ไลบรารีต้องเป็นฟังก์ชันล้วน')
  console.log('✓ ไลบรารีเป็นฟังก์ชันล้วน ไม่แตะเครือข่าย/เบราว์เซอร์')
}

console.log('\n✅ water-events-ui: ผ่านทุกข้อ')

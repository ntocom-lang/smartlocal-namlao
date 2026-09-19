// เทสต์ตัวจัดรูปแบบหน้า "สถานการณ์น้ำ-ฝน" — เกณฑ์ฝนต้องตรงกรมอุตุฯ ทุกขอบช่วง และข้อความต้องไม่ทำให้
// ประชาชนเข้าใจผิดว่าสถานีนอกพื้นที่วัดในหมู่บ้าน
// รันด้วย: node tests/water-situation.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DAM_LEVELS, DAM_STALE_HOURS, EWS_FRESH_HOURS, RAIN_LEVELS, STATION_STALE_HOURS, bankText, buildAlerts, damLevel,
  damTrend, dataDayText, distanceText, ewsAlert, formatMcm, formatMm, isStale, mapUrl, measuredAtText, rainLevel, safeColor, stationPlace, waterTrend,
} from '../src/lib/waterSituation.js'

// ── เกณฑ์ปริมาณฝนของกรมอุตุนิยมวิทยา (ขอบช่วงทุกจุด) ──
{
  const key = (mm) => rainLevel(mm)?.key ?? null
  assert.equal(key(0), 'none')
  assert.equal(key(0.05), 'none')
  assert.equal(key(0.1), 'light')
  assert.equal(key(10.0), 'light')
  assert.equal(key(10.1), 'moderate')
  assert.equal(key(35.0), 'moderate')
  assert.equal(key(35.1), 'heavy')
  assert.equal(key(90.0), 'heavy')
  assert.equal(key(90.1), 'veryHeavy')
  assert.equal(key(132.5), 'veryHeavy')
  assert.equal(key('97.5'), 'veryHeavy', 'ต้นทางส่งตัวเลขเป็นสตริงได้')
  // ไม่มีค่า/ค่าผิดรูป ต้องไม่เดาเป็น "ไม่มีฝน" — คนละความหมายกับฝน 0 มม.
  assert.equal(key(null), null)
  assert.equal(key(''), null)
  assert.equal(key('abc'), null)
  assert.equal(key(-1), null)
  assert.equal(rainLevel(35.1).label, 'ฝนหนัก')
}

// ── ตัวเลขปริมาณฝน ──
assert.equal(formatMm(132.5), '132.5')
assert.equal(formatMm(2), '2')
assert.equal(formatMm(0), '0')
assert.equal(formatMm(null), '–')

// ── ระยะจากตลิ่ง (bank_diff_m = ตลิ่งต่ำสุด − ระดับน้ำ) ──
assert.equal(bankText(1.96), 'ต่ำกว่าตลิ่ง 1.96 ม.')
assert.equal(bankText('4.73'), 'ต่ำกว่าตลิ่ง 4.73 ม.')
assert.equal(bankText(-0.35), 'สูงกว่าตลิ่ง 0.35 ม.')
assert.equal(bankText(0), 'ระดับน้ำเสมอตลิ่ง')
assert.equal(bankText(null), null)

// ── แนวโน้มระดับน้ำ ──
assert.deepEqual(waterTrend(172.84, 172.39), { dir: 'up', diff: 0.45, label: 'น้ำขึ้น 0.45 ม.' })
assert.deepEqual(waterTrend(154.5, 155), { dir: 'down', diff: -0.5, label: 'น้ำลง 0.50 ม.' })
assert.equal(waterTrend(154.91, 154.9).dir, 'flat', 'ต่างกัน 1 ซม. = ทรงตัว')
assert.equal(waterTrend(154.91, null), null, 'ยังไม่มีค่าก่อนหน้า ต้องไม่เดาแนวโน้ม')

// ── ข้อมูลเก่า ──
{
  const now = new Date('2026-09-18T07:00:00Z')
  assert.equal(isStale('2026-09-18T04:01:00Z', now, 3), false)
  assert.equal(isStale('2026-09-18T03:59:00Z', now, 3), true)
  assert.equal(isStale(null, now, 3), true)
  assert.equal(isStale('ไม่ใช่วันที่', now, 3), true)
}

// ── เวลาที่วัด: ยึดเวลาไทยเสมอ ──
{
  const now = new Date('2026-09-18T04:40:00Z') // 11:40 น. เวลาไทย
  assert.equal(measuredAtText('2026-09-18T03:00:00.000Z', now), '10:00 น.')
  // 23:30 น. ของวันก่อน (ตามเวลาไทย) ต้องมีวันที่กำกับ แม้ใน UTC จะยังเป็นวันเดียวกัน
  assert.equal(measuredAtText('2026-09-17T16:30:00.000Z', now), '17 ก.ย. 23:30 น.')
  assert.equal(measuredAtText(null, now), '')
}

// ── ที่ตั้งสถานี: โชว์อำเภอเฉพาะตอนอยู่นอกอำเภอของสำนักงาน ──
assert.equal(stationPlace({ tambon_name: 'บ้านเวียง', amphoe_name: 'ร้องกวาง' }, 'ร้องกวาง'), 'ต.บ้านเวียง')
assert.equal(stationPlace({ tambon_name: 'น้ำรัด', amphoe_name: 'หนองม่วงไข่' }, 'ร้องกวาง'), 'ต.น้ำรัด อ.หนองม่วงไข่')
assert.equal(stationPlace({ tambon_name: 'น้ำรัด', amphoe_name: 'หนองม่วงไข่' }, null), 'ต.น้ำรัด อ.หนองม่วงไข่')
assert.equal(distanceText(14.1), 'ห่าง 14.1 กม.')
assert.equal(distanceText(null), '')

// ── ลิงก์แผนที่ + สีจากต้นทาง ──
assert.equal(mapUrl(18.26591, 100.17706), 'https://www.google.com/maps/search/?api=1&query=18.26591,100.17706')
assert.equal(mapUrl(null, 100), null)
assert.equal(mapUrl(95, 100), null)
assert.equal(safeColor('#00B050'), '#00B050')
assert.equal(safeColor('red'), '#9ca3af')
assert.equal(safeColor('url(javascript:alert(1))'), '#9ca3af')

// ── เกณฑ์ปริมาณน้ำในอ่าง (% รนก.) ต้องตรงรายงาน สสน. / กรมชลประทาน ทุกขอบช่วง ──
// ≤30 วิกฤติ · >30–50 น้ำน้อย · >50–80 ปานกลาง · >80–100 น้ำมาก · >100 เกินความจุเก็บกัก
{
  const key = (p) => damLevel(p)?.key ?? null
  assert.equal(key(0), 'critical')
  assert.equal(key(30), 'critical', '30% พอดียังเป็นน้ำน้อยวิกฤติ (≤30)')
  assert.equal(key(30.01), 'low')
  assert.equal(key(50), 'low')
  assert.equal(key(50.01), 'moderate')
  assert.equal(key(51.86), 'moderate', 'แม่ถาง 2569-09-18')
  assert.equal(key(80), 'moderate')
  assert.equal(key(80.01), 'high')
  assert.equal(key(88.55), 'high', 'แม่คำปอง 2569-09-18')
  assert.equal(key(100), 'high', '100% พอดียังไม่เกินความจุเก็บกัก')
  assert.equal(key(100.01), 'over')
  assert.equal(key(137), 'over')
  assert.equal(key('88.55'), 'high', 'ต้นทางส่งตัวเลขเป็นสตริงได้')
  // ไม่มีค่า ต้องไม่เดาเป็น "น้ำน้อยวิกฤติ" — คนละความหมายกับอ่างแห้ง
  assert.equal(key(null), null)
  assert.equal(key(''), null)
  assert.equal(key(-1), null)
}

// สีต้องตรงต้นฉบับทุกระดับ — กันคน "แก้สีให้ดูเข้าใจง่าย" จนไม่ตรงเว็บของหน่วยงาน
assert.deepEqual(
  DAM_LEVELS.map(l => [l.label, l.color]),
  [
    ['น้ำน้อยวิกฤติ', '#FFC000'],
    ['น้ำน้อย', '#00B050'],
    ['น้ำปานกลาง', '#003CFA'],
    ['น้ำมาก', '#FF0000'],
    ['เกินความจุเก็บกัก', '#C70000'],
  ],
)

// ── ปริมาตรอ่าง + แนวโน้มเทียบเมื่อวาน ──
assert.equal(formatMcm(5.99), '5.99')
assert.equal(formatMcm(30.62), '30.62')
assert.equal(formatMcm(0.4), '0.4')
assert.equal(formatMcm(null), '–')
assert.deepEqual(damTrend(5.99, 5.87), { dir: 'up', diff: 0.12, label: 'เพิ่ม 0.12 ล้าน ลบ.ม.' })
assert.deepEqual(damTrend(15.88, 16.1), { dir: 'down', diff: -0.22, label: 'ลด 0.22 ล้าน ลบ.ม.' })
assert.equal(damTrend(5.99, 5.99).dir, 'flat')
assert.equal(damTrend(5.99, null), null, 'ยังไม่มีข้อมูลเมื่อวาน ต้องไม่เดาแนวโน้ม')

// ── ข้อมูลรายวัน: ไม่ขึ้นเตือนค้างทุกเช้า และไม่โชว์ "00:00 น." ──
{
  const today = '2026-09-18T17:00:00.000Z'      // เที่ยงคืนเวลาไทยของ 19 ก.ย.
  const yesterday = '2026-09-17T17:00:00.000Z'  // เที่ยงคืนเวลาไทยของ 18 ก.ย.
  const morning = new Date('2026-09-19T01:00:00Z') // 08:00 น. 19 ก.ย. ค่าของวันนี้ยังไม่ออก
  assert.equal(isStale(yesterday, morning, DAM_STALE_HOURS), false, 'ค่าของเมื่อวานตอนเช้าต้องไม่ถือว่าค้าง')
  assert.equal(isStale(yesterday, new Date('2026-09-19T17:01:00Z'), DAM_STALE_HOURS), true, 'หมดวันแล้วยังไม่มีค่าใหม่ = ค้าง')
  assert.equal(dataDayText(today, morning), 'วันนี้')
  assert.equal(dataDayText(yesterday, morning), '18 ก.ย.')
  assert.equal(dataDayText(null, morning), '')
}

// ── สถานะสถานีเตือนภัยน้ำหลาก-ดินถล่ม (กรมทรัพยากรน้ำ) ──
{
  const now = new Date('2026-09-19T07:00:00Z') // 14:00 น.
  const at = (hoursAgo) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString()
  const st = (level, hoursAgo = 1, extra = {}) => ({
    situation_level: level, situation_text: null, situation_color: '#f9a73e', recorded_at: at(hoursAgo), ...extra,
  })

  // แสดงเฉพาะ 1–3 — 0 / 9 / ติดลบ ต้นทางไม่มีเอกสารอธิบาย ต้องไม่ขึ้นป้ายใดๆ (รวมถึงคำว่า "ปกติ")
  for (const quiet of [0, 9, -999, null, '9', 4, 1.5]) {
    assert.equal(ewsAlert(st(quiet), now), null, `สถานะ ${quiet} ต้องไม่แสดง`)
  }
  assert.equal(ewsAlert(null, now), null, 'สถานีฝนที่ไม่มีสถานีเตือนภัยคู่กัน')
  assert.equal(ewsAlert(st(2, 1, { recorded_at: null }), now), null)

  assert.deepEqual(ewsAlert(st(2, 1, { situation_text: 'เตรียมพร้อม' }), now),
    { level: 2, text: 'เตรียมพร้อม', color: '#f9a73e', stale: false })
  assert.equal(ewsAlert(st('3'), now).level, 3, 'ต้นทางส่งสถานะเป็นข้อความได้')
  // ไม่มีข้อความจากแถว → ใช้ป้ายสำรองชุดเดียวกับหน้าเว็บกรมทรัพยากรน้ำ
  assert.equal(ewsAlert(st(1), now).text, 'เฝ้าระวัง')
  assert.equal(ewsAlert(st(3), now).text, 'วิกฤติ')
  assert.equal(ewsAlert(st(2, 1, { situation_color: 'red' }), now).color, '#9ca3af', 'สีผิดรูปต้องไม่หลุดเข้า style')

  assert.equal(EWS_FRESH_HOURS, 12)
  assert.equal(ewsAlert(st(3, 11.9), now).stale, false)
  assert.equal(ewsAlert(st(3, 12.1), now).stale, true, 'สถานะที่ค้างเกิน 12 ชม. ต้องถูกทำเป็นไม่เป็นปัจจุบัน')
}

// ── เกณฑ์ของแถบเตือนบนหน้า ต้องตรงกับ Telegram (water-alert-notify) ทุกค่า ──
// อ่านจากซอร์สของฟังก์ชันตรงๆ กันคนแก้ฝั่งเดียว แล้วเว็บขึ้นแถบแต่ Telegram เงียบ (หรือกลับกัน)
{
  const src = readFileSync(new URL('../supabase/functions/water-alert-notify/index.ts', import.meta.url), 'utf8')
  const constant = (name) => Number(src.match(new RegExp(`const ${name} = ([\\d.]+)`))?.[1])
  // ฝนหนักมากของกรมอุตุฯ = มากกว่าเพดาน "ฝนหนัก" (90.0) → Telegram ใช้ 90.1
  const heavyCeiling = RAIN_LEVELS.find(l => l.key === 'heavy').upTo
  assert.equal(constant('HEAVY_RAIN_MM'), Math.round((heavyCeiling + 0.1) * 10) / 10)
  assert.equal(constant('RAIN_FRESH_HOURS'), STATION_STALE_HOURS)
  assert.equal(constant('EWS_FRESH_HOURS'), EWS_FRESH_HOURS)
}

// ── ตัวตัดสินใจแถบเตือน ──
{
  const now = new Date('2026-09-19T07:00:00Z')
  const ago = (h) => new Date(now.getTime() - h * 3600_000).toISOString()
  const r = (code, mm, h = 1) => ({ station_code: code, station_name: code, rain_24h_mm: mm, recorded_at: ago(h), distance_km: 5 })

  const quiet = buildAlerts({ rain: [r('A', 90.0), r('B', 35)], ews: [], warnings: [], now })
  assert.equal(quiet.any, false, '90.0 มม. ยังเป็นฝนหนัก ไม่ใช่ฝนหนักมาก')

  const hit = buildAlerts({ rain: [r('A', 90.1), r('B', 132.5), r('C', 200, 4)], now })
  assert.deepEqual(hit.heavyRain.map(s => s.station_code), ['B', 'A'], 'เรียงมากไปน้อย และตัดค่าที่เก่ากว่า 3 ชม. ทิ้ง')
  assert.equal(hit.any, true)

  const official = buildAlerts({
    rain: [], now,
    warnings: [{ issued_at: ago(2), message: 'สถานีX ต.น้ำเลา อ.ร้องกวาง จ.แพร่ ล้นตลิ่งแล้ว 10 ซม.' }, { message: '  ' }, null],
  })
  assert.equal(official.warnings.length, 1, 'ข้อความว่าง/ผิดรูปต้องไม่ขึ้นแถบ')
  assert.equal(official.any, true)

  const ewsOnly = buildAlerts({
    now,
    ews: [
      { station_code: 'E1', situation_level: 1, recorded_at: ago(1) },
      { station_code: 'E2', situation_level: 3, recorded_at: ago(13) },
      { station_code: 'E3', situation_level: 2, recorded_at: ago(1), distance_km: 8 },
    ],
  })
  assert.deepEqual(ewsOnly.ews.map(x => x.station.station_code), ['E3'], 'เฝ้าระวังไม่ขึ้นแถบ · สถานะเก่ากว่า 12 ชม. ไม่ขึ้นแถบ')
  assert.equal(buildAlerts({ now }).any, false, 'ไม่มีข้อมูล = ไม่มีแถบ')
}

console.log('✅ water-situation: ผ่านทุกข้อ')

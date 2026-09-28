// เทสต์ตัวจัดรูปแบบหน้า "สถานการณ์น้ำ-ฝน" — เกณฑ์ฝนต้องตรงกรมอุตุฯ ทุกขอบช่วง และข้อความต้องไม่ทำให้
// ประชาชนเข้าใจผิดว่าสถานีนอกพื้นที่วัดในหมู่บ้าน
// รันด้วย: node tests/water-situation.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DAM_ALERT_RANK, DAM_LEVELS, DAM_PUBLIC_ALERT_RANK, DAM_STALE_HOURS, EWS_FRESH_HOURS, LEVEL_TIERS, LEVEL_WATCH_M, RAIN_LEVELS,
  RAIN_VERY_HEAVY_MM, STATION_STALE_HOURS,
  alertSummary, bankText, barPercent, buildAlerts, channelFill, damLevel, damRank, damTicks, damTrend, dataDayText, distanceText, ewsAlert,
  flowCompare, formatMcm, formatMm, isStale, levelRank, mapUrl, measuredAtText, rainBarMax, rainLevel, safeColor,
  stationPlace, summaryStats, waterTrend,
} from '../src/lib/waterSituation.js'

// ── เกณฑ์ระดับน้ำในแม่น้ำของกรมชลประทาน (มาตรฐานข้อมูลน้ำ ระยะที่ 3 ของ สสน. ตาราง 5.9) ──
// ปกติ = ต่ำกว่าตลิ่งมากกว่า 1 ม. · เฝ้าระวัง = ต่ำกว่าตลิ่งน้อยกว่า 1 ม. · แจ้งเตือนภัย = เสมอหรือล้นตลิ่ง
{
  const tier = (diff) => LEVEL_TIERS[levelRank(diff)]?.key ?? null
  assert.equal(LEVEL_WATCH_M, 1)
  assert.equal(tier(3.73), 'normal')
  assert.equal(tier(1.01), 'normal')
  assert.equal(tier(1), 'watch', '1.00 ม. พอดีตารางไม่ได้ระบุ เจ้าของระบบเลือกนับเป็นเฝ้าระวัง')
  assert.equal(tier(0.5), 'watch')
  assert.equal(tier(0.01), 'watch')
  assert.equal(tier(0), 'alert', 'เสมอตลิ่ง = แจ้งเตือนภัย')
  assert.equal(tier(-0.35), 'alert')
  assert.equal(tier('0.80'), 'watch', 'ค่าจาก RPC มาเป็นสตริงได้')
  for (const empty of [null, undefined, '', 'abc']) {
    assert.equal(levelRank(empty), null, `ค่าว่าง/ผิดรูปแบบต้องเป็น null ไม่ใช่ขั้นใดขั้นหนึ่ง: ${String(empty)}`)
  }
  // Telegram (water-alert-notify) ต้องตัดสินเหมือนหน้าเว็บทุกขอบ — อ่านซอร์สมาเทียบ
  const src = readFileSync(new URL('../supabase/functions/water-alert-notify/index.ts', import.meta.url), 'utf8')
  assert.equal(Number(src.match(/const LEVEL_WATCH_M = ([\d.]+)/)?.[1]), LEVEL_WATCH_M, 'LEVEL_WATCH_M สองฝั่งไม่ตรงกัน')
  assert.ok(/if \(n <= 0\) return LEVEL_RANK\.alert/.test(src), 'Telegram ต้องนับเสมอตลิ่งเป็นแจ้งเตือนภัยเหมือนหน้าเว็บ')
  assert.ok(/if \(n <= LEVEL_WATCH_M\) return LEVEL_RANK\.watch/.test(src), 'Telegram ต้องนับ 1.00 ม. พอดีเป็นเฝ้าระวังเหมือนหน้าเว็บ')
  assert.ok(/if \(diff === null \|\| diff === undefined \|\| diff === ''\) return null/.test(src),
    'Telegram ต้องกันค่าว่างก่อน Number() — Number(null) = 0 จะกลายเป็นเสมอตลิ่ง')
  const web = readFileSync(new URL('../src/lib/waterSituation.js', import.meta.url), 'utf8')
  assert.ok(!/bank_diff_m\) \?\? 0\)/.test(web), 'ห้ามแปลงค่าว่างเป็น 0 ก่อนเทียบตลิ่ง')
}

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
  assert.equal(constant('DAM_FRESH_HOURS'), DAM_STALE_HOURS, 'ความสดของข้อมูลอ่างต้องตรงกัน')
  assert.ok(/const LEVEL_FRESH_HOURS = RAIN_FRESH_HOURS/.test(src), 'สถานีระดับน้ำต้องใช้ความสดเดียวกับสถานีฝน')

  // เกณฑ์อ่างถูกเขียนไว้ 2 ที่ (หน้าเว็บ + Edge Function) — ขอบทุกช่วงและลำดับชั้นต้องตรงกันเป๊ะ
  const damBlock = src.match(/const DAM_LEVELS = \[([\s\S]*?)\n\]/)[1]
  const damRows = [...damBlock.matchAll(/key: '([a-z]+)'[^}]*?label: '([^']+)'[^}]*?upTo: (Infinity|[\d.]+)/g)]
    .map(m => ({ key: m[1], label: m[2], upTo: m[3] === 'Infinity' ? Infinity : Number(m[3]) }))
  assert.deepEqual(damRows, DAM_LEVELS.map(l => ({ key: l.key, label: l.label, upTo: l.upTo })),
    'DAM_LEVELS ใน water-alert-notify ไม่ตรงกับฝั่งหน้าเว็บ')
  assert.ok(/const DAM_ALERT_RANK = DAM_LEVELS\.findIndex\(l => l\.key === 'high'\)/.test(src))
  assert.equal(DAM_ALERT_RANK, DAM_LEVELS.findIndex(l => l.key === 'high'))
  // แถบฝั่งประชาชนตั้งใจใช้เกณฑ์สูงกว่า Telegram — ถ้าเผลอทำให้เท่ากัน แถบจะค้างทั้งฤดูฝน
  assert.ok(DAM_PUBLIC_ALERT_RANK > DAM_ALERT_RANK, 'เกณฑ์ฝั่งประชาชนต้องสูงกว่าฝั่งเจ้าหน้าที่')
  assert.equal(DAM_LEVELS[DAM_PUBLIC_ALERT_RANK].key, 'over')

  // หน้าต่างหาค่าก่อนหน้าต้องตรงกับ RPC ไม่งั้นเว็บกับ Telegram ตัดสินคนละฐาน
  const rpc = readFileSync(new URL('../supabase/migrations/20260919100300_water_warnings_rls_rpc.sql', import.meta.url), 'utf8')
  assert.ok(rpc.includes("interval '50 minutes'") && rpc.includes("interval '3 hours'"), 'RPC เปลี่ยนหน้าต่างระดับน้ำแล้ว')
  assert.ok(rpc.includes("interval '20 hours'") && rpc.includes("interval '3 days'"), 'RPC เปลี่ยนหน้าต่างอ่างแล้ว')
  assert.ok(/const LEVEL_PREV_MIN_MS = 50 \* 60 \* 1000/.test(src) && /const LEVEL_PREV_MAX_MS = 3 \* 60 \* 60 \* 1000/.test(src))
  assert.ok(/const DAM_PREV_MIN_MS = 20 \* 60 \* 60 \* 1000/.test(src) && /const DAM_PREV_MAX_MS = 3 \* 24 \* 60 \* 60 \* 1000/.test(src))

  // ⚠️ กันบั๊กที่ส่งคำเตือนผิดเข้ากลุ่มจริง 3 กลุ่มมาแล้ว (2569-09-28): ดึง water_readings ของทุกสถานี
  // ย้อน 3 วันในคำสั่งเดียว = 2,016 แถว แต่ PostgREST คืนแค่ 1,000 แถวแล้วตัดเงียบๆ แถวของเมื่อวาน
  // ของอ่างจึงหลุดหาย ระบบนึกว่าไม่มีค่าก่อนหน้า แล้วเดาว่า "เพิ่งข้ามชั้น"
  // แก้ถาวรด้วยการดึงทีละหน้าแล้วเทียบกับยอดนับจริง — ได้ไม่ครบต้องหยุดทั้งรอบ
  assert.ok(src.includes('const PAGE_SIZE = 1000'), 'หน้าละ 1,000 แถว = เพดานของ PostgREST')
  assert.ok(/\.range\(offset, offset \+ PAGE_SIZE - 1\)/.test(src), 'ต้องดึงทีละหน้าด้วย .range()')
  assert.ok(/count: 'exact'/.test(src), 'ต้องขอยอดนับจริงไว้เทียบว่าได้ครบไหม')
  assert.ok(/offset \+= batch\.length/.test(src),
    'เลื่อนหน้าตามจำนวนที่ได้จริง ไม่ใช่ PAGE_SIZE — เซิร์ฟเวอร์ตั้งเพดานต่ำกว่านี้จะได้ไม่ข้ามแถว')
  assert.ok(/rows\.length < total/.test(src), 'ได้ไม่ครบตามยอดนับต้องหยุดและแจ้ง error ไม่ใช่ส่งคำเตือนจากข้อมูลที่ขาด')
  assert.ok(/\.order\('station_config_id'/.test(src), 'ต้องเรียงด้วยคีย์ที่ไม่ซ้ำ หน้าต่อกันจึงไม่ข้ามหรือซ้ำแถว')
  assert.ok(!src.includes('ROW_CAP'), 'ห้ามกลับไปใช้วิธีหยุดเมื่อชนเพดาน — อปท. เพิ่มแล้วแจ้งเตือนจะหยุดทั้งระบบ')
  assert.ok(src.includes('const quickIds =') && src.includes('const historyIds ='),
    'ต้องแยกคำสั่งดึงข้อมูล: สถานีฝน/ews เอาแค่ค่าล่าสุด ส่วนระดับน้ำ/อ่างต้องมีประวัติ')
  assert.ok(/if \(prevRank === null\) continue/.test(src),
    'อ่างที่ไม่มีค่าก่อนหน้าให้เทียบ ต้องไม่ส่ง ห้ามเดาว่าเพิ่งข้ามชั้น')
}

// ── สมุดลงเวลา: แจ้งเตือนหยุดทำงานเมื่อไรต้องมีคนรู้ ──
// thaiwater-watchdog เดิมดูแค่ความสดของข้อมูล ถ้า water-alert-notify พังเอง ข้อมูลยังสดตามปกติ
// ตัวเฝ้าระวังจึงรายงานว่าปกติทั้งที่แจ้งเตือนหยุดส่งไปแล้ว
{
  const alertSrc = readFileSync(new URL('../supabase/functions/water-alert-notify/index.ts', import.meta.url), 'utf8')
  const dogSrc = readFileSync(new URL('../supabase/functions/thaiwater-watchdog/index.ts', import.meta.url), 'utf8')
  const jobName = alertSrc.match(/const JOB_NAME = '([a-z0-9-]+)'/)?.[1]
  assert.equal(jobName, 'water-alert-notify')
  assert.ok(dogSrc.includes(`name: '${jobName}'`), 'ชื่องานใน WATCHED_JOBS ต้องตรงกับ JOB_NAME ของ water-alert-notify')

  // หลังสร้าง client ทุกทางที่ตอบ error ต้องผ่าน fail() ซึ่งลงสมุด — เพิ่มทางใหม่แล้วลืม = ไม่มี error แนบให้คนแก้
  const afterClient = alertSrc.split('const admin = createClient(')[1]
  assert.equal((afterClient.match(/json\(\{ ok: false/g) ?? []).length, 1, 'ห้ามตอบ error ตรงๆ โดยไม่ผ่าน fail()')
  assert.ok((alertSrc.match(/if \(!isTest\) await recordHeartbeat\(admin, \{ ok: true \}\)/g) ?? []).length >= 2,
    'ทางที่จบสำเร็จ (รวมกรณีไม่มี อปท. ให้ส่ง) ต้องลงสมุดว่าสำเร็จ')

  // อ่านสมุดไม่ได้ต้องไม่ทำให้การตรวจข้อมูลค้างเดิมพังตาม (ตารางยังไม่ถูกสร้างก็ต้องทำงานต่อ)
  const beatsBlock = dogSrc.split("from('job_heartbeats')")[1]?.split('const staleJobs')[0] ?? ''
  assert.ok(beatsBlock.includes('if (beatsError)') && !beatsBlock.includes('return json('),
    'อ่านสมุดลงเวลาไม่ได้ ห้ามตอบ error ทั้งรอบ')

  const migration = readFileSync(new URL('../supabase/migrations/20260928140100_job_heartbeats_rls.sql', import.meta.url), 'utf8')
  assert.ok(migration.includes('REVOKE ALL ON public.job_heartbeats FROM anon, authenticated, PUBLIC'))
  assert.ok(migration.includes('ALTER TABLE public.job_heartbeats ENABLE ROW LEVEL SECURITY'))
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

// ── อินโฟกราฟิก: แท่ง/ภาพต้องตรงกับตัวเลขที่พิมพ์อยู่ข้างๆ เสมอ ──
{
  // ความกว้างแท่ง
  assert.equal(barPercent(50, 100), 50)
  assert.equal(barPercent(0, 100), 0)
  assert.equal(barPercent(-5, 100), 0, 'ค่าติดลบต้องไม่วาดแท่งกลับด้าน')
  assert.equal(barPercent(150, 100), 100, 'ค่าเกินสเกลต้องเต็มแท่ง ไม่ล้นกรอบ')
  assert.equal(barPercent(null, 100), 0)
  assert.equal(barPercent(10, 0), 0, 'สเกล 0 ต้องไม่หารศูนย์')

  // สเกลร่วมของแท่งฝน — หมุด "ฝนหนักมาก" ต้องอยู่ในแถบเสมอ
  const st = mm => ({ rain_24h_mm: mm })
  assert.equal(rainBarMax([]), 100)
  assert.equal(rainBarMax([st(2), st(45.2)]), 100, 'ฝนน้อยก็ยังใช้สเกล 100 เพื่อให้เทียบข้ามวันได้')
  assert.equal(rainBarMax([st(96)]), 100)
  assert.equal(rainBarMax([st(132.5)]), 140)
  assert.equal(rainBarMax([st(null), st('88')]), 100)
  assert.ok(barPercent(RAIN_VERY_HEAVY_MM, rainBarMax([st(132.5)])) < 100, 'หมุดต้องไม่ถูกดันไปติดขอบขวา')

  // หมุดเกณฑ์อ่าง — อ่านจาก DAM_LEVELS จุดเดียว ถ้าเกณฑ์เปลี่ยนต้องเปลี่ยนตาม
  assert.deepEqual(damTicks(), [30, 50, 80])
  assert.deepEqual(damTicks(), DAM_LEVELS.map(l => l.upTo).filter(v => Number.isFinite(v) && v < 100))

  // น้ำเข้า-ออกของอ่าง
  assert.equal(flowCompare(null, null), null, 'ไม่มีทั้งสองค่า = ไม่ต้องวาด')
  const flow = flowCompare(0.29, 0.37)
  assert.equal(Math.round(flow.inflowPct), 78, 'แท่งเล็กคิดเทียบแท่งใหญ่ในการ์ดเดียวกัน')
  assert.equal(flow.releasedPct, 100)
  assert.equal(flow.netLabel, 'ออกมากกว่าเข้า 0.08 ล้าน ลบ.ม.')
  assert.equal(flowCompare(0.5, 0.2).netLabel, 'เข้ามากกว่าออก 0.3 ล้าน ลบ.ม.')
  assert.equal(flowCompare(0.2, 0.2).netLabel, 'เข้า-ออกพอๆ กัน')
  const oneSide = flowCompare(null, 0.12)
  assert.equal(oneSide.inflowPct, 0)
  assert.equal(oneSide.releasedPct, 100)
  assert.equal(oneSide.netLabel, null, 'ขาดค่าฝั่งหนึ่งต้องไม่สรุปว่าเข้ามากหรือออกมาก')

  // สัดส่วนน้ำในภาพตัดขวาง
  assert.equal(channelFill(32), 0.32)
  assert.equal(channelFill(0), 0)
  assert.equal(channelFill(120), 1, 'เกินความจุลำน้ำให้เต็มภาพ ตัวเลขกับป้ายบอกส่วนที่เกินเอง')
  assert.equal(channelFill(null), null, 'ไม่มีค่า = ไม่วาดภาพ ห้ามเดาจากระดับตลิ่ง')
  assert.equal(channelFill(-1), null)
}

// ── 3 ตัวเลขสรุปบนสุด ──
{
  const now = Date.now()
  const ago = h => new Date(now - h * 3600_000).toISOString()
  const rain = [
    { station_code: 'R1', station_name: 'บ้านบุญแจ่ม', rain_24h_mm: 1, recorded_at: ago(1) },
    { station_code: 'R2', station_name: 'บ้านผาราง', rain_24h_mm: 96, recorded_at: ago(2) },
    { station_code: 'R3', station_name: 'สถานีเก่า', rain_24h_mm: 200, recorded_at: ago(5) },
  ]
  const dams = [
    { station_code: 'D1', dam_storage_mcm: 5.99, dam_capacity_mcm: 6.76, recorded_at: ago(10) },
    { station_code: 'D2', dam_storage_mcm: 15.88, dam_capacity_mcm: 30.62, recorded_at: ago(10) },
    { station_code: 'D3', dam_storage_mcm: 99, dam_capacity_mcm: 99, recorded_at: ago(60) },
  ]
  const levels = [
    { station_code: 'L1', station_name: 'บ้านแม่คำมีตำหนักธรรม', bank_diff_m: 3.28, recorded_at: ago(1) },
    { station_code: 'L2', station_name: 'หนองม่วงไข่', bank_diff_m: 3.65, recorded_at: ago(1) },
  ]

  const s = summaryStats({ rain, dams, levels, now })
  assert.equal(s.rain.station.station_code, 'R2', 'ค่าสูงสุดที่ยังเป็นปัจจุบัน — สถานีค้าง 5 ชม. ไม่นับ')
  assert.equal(s.rain.mm, 96)
  assert.equal(s.rain.level.key, 'veryHeavy')

  assert.equal(s.dam.count, 2, 'อ่างที่ข้อมูลค้างเกิน 48 ชม. ไม่เอามารวม')
  assert.equal(Number(s.dam.percent.toFixed(1)), 58.5, 'รวมปริมาตร ÷ รวมความจุ (21.87/37.38)')
  assert.notEqual(Number(s.dam.percent.toFixed(1)), 70.3, 'ห้ามเฉลี่ย % รายอ่าง อ่างเล็กจะมีน้ำหนักเท่าอ่างใหญ่')

  assert.equal(s.bank.station.station_code, 'L1', 'ใกล้ตลิ่งที่สุด = bank_diff_m น้อยที่สุด')
  assert.equal(s.bank.text, 'ต่ำกว่าตลิ่ง 3.28 ม.')
  assert.equal(s.any, true)

  // น้ำล้นตลิ่ง (ค่าติดลบ) ต้องมาก่อนสถานีที่ยังต่ำกว่าตลิ่งเสมอ
  const over = summaryStats({ levels: [...levels, { station_code: 'L3', station_name: 'ล้น', bank_diff_m: -0.2, recorded_at: ago(1) }], now })
  assert.equal(over.bank.station.station_code, 'L3')
  assert.equal(over.bank.text, 'สูงกว่าตลิ่ง 0.20 ม.')

  // ไม่มีข้อมูล / มีแต่ของค้าง = ไม่ขึ้นแถบสรุป
  assert.equal(summaryStats({ now }).any, false)
  assert.equal(summaryStats({ rain: [rain[2]], dams: [dams[2]], now }).any, false)
  // อ่างที่ต้นทางยังไม่ลงตัวเลขของวันใหม่ (ปริมาตร null) ต้องไม่ทำให้ % เพี้ยน
  assert.equal(summaryStats({ dams: [{ dam_storage_mcm: null, dam_capacity_mcm: 6.76, recorded_at: ago(1) }], now }).dam, null)
}

// ── แถบเตือนบนหน้าแรก: ย่อคำเตือนเหลือบรรทัดเดียว ──
{
  const now = Date.now()
  const ago = h => new Date(now - h * 3600_000).toISOString()
  const rainStation = (code, name, mm, h = 1) => ({
    station_code: code, station_name: name, rain_24h_mm: mm, recorded_at: ago(h),
    tambon_name: 'ทุ่งศรี', amphoe_name: 'ร้องกวาง', distance_km: 6.5,
  })
  const summaryOf = (input, opts) => alertSummary(buildAlerts({ ...input, now }), { now, ...opts })

  // วันปกติ = ไม่มีแถบ
  assert.equal(summaryOf({}), null, 'ไม่มีเรื่องเข้าเกณฑ์ต้องไม่ขึ้นแถบ')
  assert.equal(summaryOf({ rain: [rainStation('R1', 'บ้านผาราง', 45)] }), null, 'ฝนไม่ถึงเกณฑ์ไม่ขึ้นแถบ')
  assert.equal(summaryOf({ rain: [rainStation('R1', 'บ้านผาราง', 120, 5)] }), null, 'ค่าเก่ากว่า 3 ชม. ไม่ขึ้นแถบ')

  // ฝนหนักมาก — หยิบสถานีที่ค่าสูงสุดมาเป็นหัวเรื่อง และนับเรื่องที่เหลือ
  const rainOnly = summaryOf(
    { rain: [rainStation('R1', 'บ้านผาราง', 96), rainStation('R2', 'บ้านบุญแจ่ม', 132.5)] },
    { homeAmphoe: 'ร้องกวาง' },
  )
  assert.equal(rainOnly.label, 'ฝนหนักมาก')
  assert.equal(rainOnly.text, 'บ้านบุญแจ่ม 132.5 มม.', 'หัวเรื่องต้องเป็นสถานีที่ฝนแรงที่สุด')
  assert.equal(rainOnly.total, 2)
  assert.ok(rainOnly.meta.includes('ต.ทุ่งศรี') && rainOnly.meta.includes('ห่าง 6.5 กม.') && rainOnly.meta.includes('วัดเมื่อ'), rainOnly.meta)
  assert.ok(!rainOnly.meta.includes('อ.ร้องกวาง'), 'อำเภอเดียวกับ อปท. ไม่ต้องโชว์ซ้ำ')

  // สถานีนอกอำเภอต้องเห็นชัดว่าไม่ได้วัดในพื้นที่
  const outside = summaryOf({ rain: [rainStation('R1', 'บ้านผาราง', 96)] }, { homeAmphoe: 'หนองม่วงไข่' })
  assert.ok(outside.meta.includes('อ.ร้องกวาง'), outside.meta)

  // ข้อความ สสน. อย่างเดียว
  const warningOnly = summaryOf({ warnings: [{ issued_at: ago(2), message: 'น้ำล้นตลิ่งที่สถานีตัวอย่าง' }] })
  assert.equal(warningOnly.label, 'ข้อความเตือนจาก สสน.')
  assert.equal(warningOnly.text, 'น้ำล้นตลิ่งที่สถานีตัวอย่าง')
  assert.equal(warningOnly.total, 1)

  // ลำดับความสำคัญ: สถานีเตือนภัยมาก่อนฝน ฝนมาก่อนข้อความ สสน.
  const mixed = summaryOf({
    rain: [rainStation('R1', 'บ้านผาราง', 96)],
    warnings: [{ issued_at: ago(1), message: 'ข้อความของ สสน.' }],
    ews: [{ station_code: 'E1', station_name: 'สถานีตัวอย่าง', situation_level: 3, situation_text: 'วิกฤติ', recorded_at: ago(1), distance_km: 3 }],
  })
  assert.equal(mixed.label, 'สถานีเตือนภัยน้ำหลาก-ดินถล่ม')
  assert.equal(mixed.text, 'สถานีตัวอย่าง · วิกฤติ')
  assert.equal(mixed.total, 3, 'นับรวมทุกหมวด ไม่ใช่เฉพาะหมวดที่เป็นหัวเรื่อง')

  const rainOverWarning = summaryOf({
    rain: [rainStation('R1', 'บ้านผาราง', 96)],
    warnings: [{ issued_at: ago(1), message: 'ข้อความของ สสน.' }],
  })
  assert.equal(rainOverWarning.label, 'ฝนหนักมาก')
  assert.equal(rainOverWarning.total, 2)

  // แถบบนหน้าแรกต้องใช้ผลของ buildAlerts ตัวเดียวกับหน้า /water-situation ห้ามมีเกณฑ์ของตัวเอง
  const banner = readFileSync(new URL('../src/components/citizen/WaterAlertBanner.jsx', import.meta.url), 'utf8')
  assert.ok(banner.includes('buildAlerts(') && banner.includes('alertSummary('), 'แถบหน้าแรกต้องเรียก buildAlerts + alertSummary')
  assert.ok(!/\b90\.1\b/.test(banner), 'ห้ามเขียนเกณฑ์ตัวเลขซ้ำในคอมโพเนนต์')
  assert.ok(banner.includes("isModuleEnabled(MODULE_KEY)"), 'ต้องกันไม่ให้ อปท. ที่ปิดโมดูลยิง RPC')
  assert.ok(banner.includes('ไม่ใช่ประกาศของ'), 'ต้องคงคำกำกับว่าไม่ใช่ประกาศของ อปท.')

  // ทุกธีมต้องมีแถบ — ใส่ธีมเดียวเท่ากับ อปท. ที่ใช้ธีมอื่นไม่เห็นคำเตือนเลย
  for (const theme of ['EcoFriendly', 'ServiceHub', 'Kledkaew']) {
    const home = readFileSync(new URL(`../src/components/citizen/templates/${theme}/Home.jsx`, import.meta.url), 'utf8')
    assert.ok(home.includes('<WaterAlertBanner'), `ธีม ${theme} ยังไม่มีแถบเตือนบนหน้าแรก`)
  }
}

// ── เรื่องใหม่ในแถบเตือน: น้ำสูงกว่าตลิ่ง + อ่างเก็บน้ำถึงชั้นที่ต้องเตือน ──
{
  const now = Date.now()
  const ago = h => new Date(now - h * 3600_000).toISOString()
  const level = (code, diff, h = 1, extra = {}) => ({
    station_code: code, station_name: code, bank_diff_m: diff, recorded_at: ago(h),
    tambon_name: 'น้ำรัด', amphoe_name: 'หนองม่วงไข่', distance_km: 14.1, ...extra,
  })
  const dam = (code, percent, h = 5) => ({
    station_code: code, station_name: code, storage_percent: percent, recorded_at: ago(h),
    tambon_name: 'น้ำเลา', amphoe_name: 'ร้องกวาง', distance_km: 3.6,
  })

  // ชั้นเกณฑ์อ่าง
  assert.equal(damRank(29), DAM_LEVELS.findIndex(l => l.key === 'critical'))
  // ขอบช่วงเป็นแบบ "ไม่เกิน" ตามต้นฉบับ: 80% พอดียังเป็นน้ำปานกลาง ต้องเกิน 80 ถึงเป็นน้ำมาก
  assert.equal(damRank(80), DAM_LEVELS.findIndex(l => l.key === 'moderate'))
  assert.equal(damRank(80.1), DAM_LEVELS.findIndex(l => l.key === 'high'))
  assert.equal(damRank(100), DAM_LEVELS.findIndex(l => l.key === 'high'))
  assert.equal(damRank(100.1), DAM_LEVELS.findIndex(l => l.key === 'over'))
  assert.equal(damRank(null), null)
  assert.ok(damRank(80) < DAM_ALERT_RANK, '80% พอดียังไม่ถึงชั้นที่ต้องเตือน')
  assert.ok(damRank(80.1) >= DAM_ALERT_RANK)

  // ขอบ 0 พอดี = เสมอตลิ่ง ยังไม่ถือว่าสูงกว่าตลิ่ง
  // เกณฑ์กรมชลประทาน (ตาราง 5.9): "เสมอตลิ่ง" นับเป็นขั้นแจ้งเตือนภัยแล้ว ไม่ต้องรอให้ล้น
  assert.equal(buildAlerts({ levels: [level('L0', 0)], now }).any, true, 'เสมอตลิ่งพอดี = แจ้งเตือนภัย')
  // ขั้นเฝ้าระวังไม่ขึ้นแถบ (แถบนี้ไปขึ้นหน้าแรกของประชาชน) — แสดงบนการ์ดสถานีกับ Telegram แทน
  assert.equal(buildAlerts({ levels: [level('L1', 0.01)], now }).any, false, 'ขั้นเฝ้าระวังไม่ขึ้นแถบ')
  assert.equal(buildAlerts({ levels: [level('L2', null)], now }).any, false, 'ไม่มีค่าเทียบตลิ่ง = ไม่เตือน')
  assert.equal(buildAlerts({ levels: [level('L2b', '')], now }).any, false, 'ค่าว่างต้องไม่กลายเป็น 0 = เสมอตลิ่ง')
  assert.equal(buildAlerts({ levels: [level('L3', -0.35, 5)], now }).any, false, 'ค่าเก่ากว่า 3 ชม. ไม่เตือน')

  const over = buildAlerts({ levels: [level('L4', -0.2), level('L5', -0.85)], now })
  assert.deepEqual(over.overbank.map(s => s.station_code), ['L5', 'L4'], 'เรียงจากล้นมากไปน้อย')
  assert.equal(over.any, true)

  // แถบฝั่งประชาชนขึ้นเฉพาะ "เกินความจุเก็บกัก" (>100%) ไม่ใช่ตั้งแต่ "น้ำมาก" เหมือน Telegram
  assert.equal(buildAlerts({ dams: [dam('D1', 88.6)], now }).any, false, 'อ่างชั้นน้ำมากไม่ขึ้นแถบให้ประชาชน')
  assert.equal(buildAlerts({ dams: [dam('D1b', 100)], now }).any, false, '100% พอดียังไม่เกินความจุ')
  assert.equal(buildAlerts({ dams: [dam('D2', 100.1)], now }).any, true)
  assert.equal(buildAlerts({ dams: [dam('D3', 104, 60)], now }).any, false, 'ข้อมูลอ่างเก่ากว่า 48 ชม. ไม่เตือน')
  assert.equal(buildAlerts({ dams: [dam('D4', null)], now }).any, false, 'ต้นทางยังไม่ลงตัวเลขของวันใหม่ = ไม่เตือน')
  const damHit = buildAlerts({ dams: [dam('D5', 102), dam('D6', 118)], now })
  assert.deepEqual(damHit.damOver.map(s => s.station_code), ['D6', 'D5'], 'เรียงจาก % มากไปน้อย')

  // ลำดับหัวเรื่องบนแถบหน้าแรก: น้ำล้นตลิ่งมาก่อนฝน · อ่างน้ำมากอยู่ท้ายสุด
  const mixed = alertSummary(buildAlerts({
    levels: [level('L6', -0.35, 1, { river_name: 'แม่น้ำยม' })],
    rain: [{ station_code: 'R1', station_name: 'บ้านผาราง', rain_24h_mm: 96, recorded_at: ago(1), distance_km: 6.5 }],
    dams: [dam('D7', 104)],
    now,
  }), { now, homeAmphoe: 'ร้องกวาง' })
  assert.equal(mixed.label, 'ระดับน้ำเสมอหรือสูงกว่าตลิ่ง')
  assert.equal(mixed.text, 'สถานีL6 สูงกว่าตลิ่ง 0.35 ม.')
  const atBank = alertSummary(buildAlerts({ levels: [level('L6b', 0)], now }), { now })
  assert.equal(atBank.text, 'สถานีL6b ระดับน้ำเสมอตลิ่ง', 'เสมอตลิ่งต้องไม่เขียนว่า "สูงกว่าตลิ่ง 0.00 ม."')
  assert.equal(mixed.total, 3)
  assert.ok(mixed.meta.includes('อ.หนองม่วงไข่'), 'สถานีนอกอำเภอต้องบอกอำเภอเสมอ')

  const damOnly = alertSummary(buildAlerts({ dams: [dam('D8', 104)], now }), { now, homeAmphoe: 'ร้องกวาง' })
  assert.equal(damOnly.label, 'เกินความจุเก็บกัก')
  assert.equal(damOnly.total, 1)
  assert.ok(damOnly.text.includes('104%'), damOnly.text)

  const rainOverDam = alertSummary(buildAlerts({
    rain: [{ station_code: 'R2', station_name: 'บ้านผาราง', rain_24h_mm: 96, recorded_at: ago(1), distance_km: 6.5 }],
    dams: [dam('D9', 104)], now,
  }), { now })
  assert.equal(rainOverDam.label, 'ฝนหนักมาก', 'อ่างน้ำมากไม่แย่งหัวเรื่องจากฝนหนักมาก')
}

console.log('✅ water-situation: ผ่านทุกข้อ')

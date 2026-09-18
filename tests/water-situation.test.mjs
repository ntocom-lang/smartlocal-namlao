// เทสต์ตัวจัดรูปแบบหน้า "สถานการณ์น้ำ-ฝน" — เกณฑ์ฝนต้องตรงกรมอุตุฯ ทุกขอบช่วง และข้อความต้องไม่ทำให้
// ประชาชนเข้าใจผิดว่าสถานีนอกพื้นที่วัดในหมู่บ้าน
// รันด้วย: node tests/water-situation.test.mjs
import assert from 'node:assert/strict'
import {
  DAM_LEVELS, DAM_STALE_HOURS, bankText, damLevel, damTrend, dataDayText, distanceText, formatMcm,
  formatMm, isStale, mapUrl, measuredAtText, rainLevel, safeColor, stationPlace, waterTrend,
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

console.log('✅ water-situation: ผ่านทุกข้อ')

// เทสต์ตัวจัดรูปแบบหน้า "สถานการณ์น้ำ-ฝน" — เกณฑ์ฝนต้องตรงกรมอุตุฯ ทุกขอบช่วง และข้อความต้องไม่ทำให้
// ประชาชนเข้าใจผิดว่าสถานีนอกพื้นที่วัดในหมู่บ้าน
// รันด้วย: node tests/water-situation.test.mjs
import assert from 'node:assert/strict'
import {
  bankText, distanceText, formatMm, isStale, mapUrl, measuredAtText, rainLevel, safeColor,
  stationPlace, waterTrend,
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

console.log('✅ water-situation: ผ่านทุกข้อ')

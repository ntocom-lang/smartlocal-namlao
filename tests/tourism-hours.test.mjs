// เทสต์ตรรกะ "เปิดอยู่/ปิดแล้ว" และตัวช่วยค้นหา/พิกัดของโมดูลเที่ยว กิน พัก ชอป บริการ
// รันด้วย: node tests/tourism-hours.test.mjs
import assert from 'node:assert/strict'
import {
  getOpenState, weeklyHours, parseCoords, haversineKm,
  formatDistance, directionsUrl, matchesQuery, fmtMinutes,
} from '../src/lib/tourismPlaces.js'

// วันพุธ 2026-09-02 เวลา 10:00 (getDay() === 3)
const wed10 = new Date(2026, 8, 2, 10, 0)
assert.equal(wed10.getDay(), 3)

const office = {
  mon: ['08:30', '16:30'], tue: ['08:30', '16:30'], wed: ['08:30', '16:30'],
  thu: ['08:30', '16:30'], fri: ['08:30', '16:30'], sat: null, sun: null,
}

// ── เปิดอยู่ ──
assert.equal(getOpenState(office, wed10).state, 'open')
assert.match(getOpenState(office, wed10).label, /ถึง 16:30/)

// ── ใกล้ปิด (เหลือ <= 60 นาที) ──
assert.equal(getOpenState(office, new Date(2026, 8, 2, 15, 45)).state, 'closing_soon')
// 60 นาทีพอดีต้องนับเป็นใกล้ปิดแล้ว
assert.equal(getOpenState(office, new Date(2026, 8, 2, 15, 30)).state, 'closing_soon')
assert.equal(getOpenState(office, new Date(2026, 8, 2, 15, 29)).state, 'open')

// ── ยังไม่เปิดวันนี้ ──
const early = getOpenState(office, new Date(2026, 8, 2, 7, 0))
assert.equal(early.state, 'closed')
assert.match(early.label, /เปิด 08:30/)

// ── ปิดแล้ว ต้องบอกว่าเปิดพรุ่งนี้ ──
const evening = getOpenState(office, new Date(2026, 8, 2, 19, 0))
assert.equal(evening.state, 'closed')
assert.match(evening.label, /เปิดพรุ่งนี้ 08:30/)

// ── เสาร์ปิด ต้องข้ามไปบอกวันจันทร์ ──
const sat = new Date(2026, 8, 5, 12, 0)
assert.equal(sat.getDay(), 6)
const satState = getOpenState(office, sat)
assert.equal(satState.state, 'closed')
assert.match(satState.label, /เปิดวันจันทร์ 08:30/)

// ── ร้านคาบเที่ยงคืน 18:00-03:00 ──
const nightShop = { wed: ['18:00', '03:00'], thu: ['18:00', '03:00'] }
// พฤหัส 00:30 ต้องนับว่ายังเปิดจากรอบคืนวันพุธ ไม่ใช่ "ปิด" เพราะข้ามวันแล้ว
assert.equal(getOpenState(nightShop, new Date(2026, 8, 3, 0, 30)).state, 'open')
// 02:30 เหลือ 30 นาทีก่อนปิด
assert.equal(getOpenState(nightShop, new Date(2026, 8, 3, 2, 30)).state, 'closing_soon')
// พฤหัส 04:00 ปิดแล้ว (รอบใหม่เปิด 18:00)
const afterNight = getOpenState(nightShop, new Date(2026, 8, 3, 4, 0))
assert.equal(afterNight.state, 'closed')
assert.match(afterNight.label, /เปิด 18:00/)
// พุธ 20:00 เปิด
assert.equal(getOpenState(nightShop, new Date(2026, 8, 2, 20, 0)).state, 'open')

// ── ไม่ได้ระบุเวลา = unknown ไม่เดาแทนร้าน ──
assert.equal(getOpenState(null, wed10).state, 'unknown')
assert.equal(getOpenState({}, wed10).state, 'unknown')
assert.equal(getOpenState([], wed10).state, 'unknown')
assert.equal(getOpenState('08:00-16:00', wed10).state, 'unknown')
// ค่าเพี้ยน (เวลาไม่ถูกรูปแบบ) ต้องไม่ทำให้พัง และไม่โกหกว่าเปิด
assert.equal(getOpenState({ wed: ['ตลอด', 'เวลา'] }, wed10).state, 'closed')
assert.equal(getOpenState({ wed: ['25:00', '99:99'] }, wed10).state, 'closed')

// ── ระบุแค่บางวัน: วันที่ไม่ได้ระบุต้องไม่ขึ้นว่าเปิด ──
assert.equal(getOpenState({ mon: ['08:00', '17:00'] }, wed10).state, 'closed')

// ── weeklyHours ──
const wh = weeklyHours(office)
assert.equal(wh.length, 7)
assert.equal(wh[0].label, 'อาทิตย์')
assert.equal(wh[0].text, 'ปิด')
assert.equal(wh[1].text, '08:30 - 16:30')
assert.deepEqual(weeklyHours(null), [])

assert.equal(fmtMinutes(1470), '00:30')
assert.equal(fmtMinutes(510), '08:30')

// ── พิกัด ──
assert.deepEqual(parseCoords({ latitude: 18.1, longitude: 100.2 }), { lat: 18.1, lng: 100.2 })
// ยังไม่ได้รัน migration → ต้องแกะจาก maps_url ให้ได้
assert.deepEqual(
  parseCoords({ maps_url: 'https://maps.google.com/?q=18.12345,100.54321' }),
  { lat: 18.12345, lng: 100.54321 },
)
assert.equal(parseCoords({ maps_url: 'https://maps.app.goo.gl/abcd' }), null)
assert.equal(parseCoords({}), null)
// 0,0 คือค่าที่ยังไม่ได้กรอก ไม่ใช่พิกัดกลางมหาสมุทร
assert.equal(parseCoords({ latitude: 0, longitude: 0 }), null)

// ระยะทาง: 1 องศาละติจูด ~111 กม.
const d = haversineKm({ lat: 18.0, lng: 100.0 }, { lat: 19.0, lng: 100.0 })
assert.ok(d > 110 && d < 112, `ระยะทางเพี้ยน: ${d}`)
assert.equal(formatDistance(0.42), '420 ม.')
assert.equal(formatDistance(3.456), '3.5 กม.')
assert.equal(formatDistance(23.4), '23 กม.')
assert.equal(formatDistance(null), null)

assert.match(directionsUrl({ latitude: 18.1, longitude: 100.2 }), /destination=18\.1,100\.2/)
assert.match(directionsUrl({ address: 'หมู่ 5 ต.น้ำเลา' }), /maps\/search/)
assert.equal(directionsUrl({}), null)

// ── ค้นหา: เว้นวรรคต่างกันต้องเจอ ──
const noodle = { name: 'ก๋วยเตี๋ยว เจ๊แดง', category: 'food', address: 'หมู่ 3' }
assert.equal(matchesQuery(noodle, 'ก๋วยเตี๋ยวเจ๊แดง'), true)
assert.equal(matchesQuery(noodle, 'เจ๊แดง'), true)
assert.equal(matchesQuery(noodle, 'กิน'), true)       // ค้นจากชื่อหมวด
assert.equal(matchesQuery(noodle, ''), true)
assert.equal(matchesQuery(noodle, 'โฮมสเตย์'), false)
assert.equal(matchesQuery({ name: 'OTOP Shop' }, 'otop'), true)

console.log('✅ tourism-hours: ผ่านทั้งหมด')

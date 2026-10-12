// Pure-logic test สำหรับ src/lib/staffHomeFrequent.js — ทางลัด "ใช้บ่อย" บนหน้าแรกเจ้าหน้าที่
// ไม่ใช้ฐานข้อมูล ไม่ใช้เบราว์เซอร์ (จำลอง localStorage ด้วย Map)
import assert from 'node:assert/strict'
import {
  decayedScore, frequentStorageKey, pickShortcuts, readUsage, recordUsage,
} from '../src/lib/staffHomeFrequent.js'

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 9, 12)
const T = 'tenant-1'
const P = 'profile-1'

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    map,
  }
}

test('นับครั้งที่เปิด และไม่นับหน้า home/menu', () => {
  const st = fakeStorage()
  recordUsage(st, T, P, 'complaints', T0)
  recordUsage(st, T, P, 'complaints', T0)
  recordUsage(st, T, P, 'home', T0)
  recordUsage(st, T, P, 'menu', T0)
  const usage = readUsage(st, T, P)
  assert.deepEqual(Object.keys(usage), ['complaints'])
  assert.equal(usage.complaints.s, 2)
})

test('แยกเก็บตาม อปท. และตามบัญชี — เครื่องที่ใช้ร่วมกันไม่ปนกัน', () => {
  const st = fakeStorage()
  recordUsage(st, T, P, 'events', T0)
  assert.deepEqual(readUsage(st, 'tenant-2', P), {})
  assert.deepEqual(readUsage(st, T, 'profile-2'), {})
  assert.notEqual(frequentStorageKey(T, P), frequentStorageKey(T, 'profile-2'))
})

test('คะแนนลดครึ่งหนึ่งทุก 30 วัน — พฤติกรรมเก่าไม่ค้างอันดับ', () => {
  const entry = { s: 8, t: T0 }
  assert.equal(decayedScore(entry, T0), 8)
  assert.ok(Math.abs(decayedScore(entry, T0 + 30 * DAY) - 4) < 1e-9)
  assert.ok(Math.abs(decayedScore(entry, T0 + 60 * DAY) - 2) < 1e-9)
  // เวลาถอยหลัง (นาฬิกาเครื่องเพี้ยน) ต้องไม่ทำให้คะแนนพองเกินจริง
  assert.equal(decayedScore(entry, T0 - 10 * DAY), 8)
})

test('เรียงตามที่ใช้บ่อยก่อน และกรองเฉพาะโมดูลที่เห็นจริง', () => {
  const usage = {
    complaints: { s: 9, t: T0 }, events: { s: 5, t: T0 }, fleet: { s: 20, t: T0 }, report: { s: 3, t: T0 },
  }
  // fleet ใช้บ่อยสุดแต่บัญชีนี้ไม่เห็นเมนูนั้น (ไม่มีสิทธิ์/ปิดโมดูล) ห้ามโผล่เป็นทางลัดหลอก
  const keys = pickShortcuts(usage, { allowedKeys: ['complaints', 'events', 'report'], limit: 4, now: T0 })
  assert.deepEqual(keys, ['complaints', 'events', 'report'])
})

test('ไม่ซ้ำกับการ์ดงานค้างที่โชว์อยู่ และเติมค่าเริ่มต้นเมื่อประวัติน้อย', () => {
  const usage = { complaints: { s: 9, t: T0 } }
  const keys = pickShortcuts(usage, {
    allowedKeys: ['complaints', 'events', 'report', 'data-center'],
    exclude: ['complaints'],
    defaults: ['events', 'report', 'data-center'],
    limit: 4,
    now: T0,
  })
  assert.deepEqual(keys, ['events', 'report', 'data-center'])
})

test('เปิดครั้งเดียวไม่นับว่า "ใช้บ่อย" แต่ยังได้ที่ผ่านค่าเริ่มต้น', () => {
  const usage = { posts: { s: 1, t: T0 } }
  const keys = pickShortcuts(usage, { allowedKeys: ['posts', 'events'], defaults: ['events'], limit: 4, now: T0 })
  assert.deepEqual(keys, ['events'])
})

test('ประวัติเยอะกว่าช่อง — ตัดที่ limit และคะแนนเท่ากันให้ล่าสุดก่อน', () => {
  const usage = {
    a: { s: 5, t: T0 - 2 * DAY }, b: { s: 5, t: T0 }, c: { s: 5, t: T0 - 1 * DAY },
  }
  const keys = pickShortcuts(usage, { allowedKeys: ['a', 'b', 'c'], limit: 2, minScore: 0, now: T0 - 0 })
  // คะแนนที่ลดค่าแล้วของ b สูงสุด (ล่าสุด) จึงมาก่อน c แล้ว a
  assert.deepEqual(keys, ['b', 'c'])
})

test('storage เสีย/ถูกบล็อก/ข้อมูลผิดรูป — ไม่ throw และคืนค่าว่าง', () => {
  assert.deepEqual(readUsage(null, T, P), {})
  assert.deepEqual(readUsage(fakeStorage({ [frequentStorageKey(T, P)]: '{not json' }), T, P), {})
  assert.deepEqual(readUsage(fakeStorage({ [frequentStorageKey(T, P)]: '[1,2,3]' }), T, P), {})
  assert.deepEqual(
    readUsage(fakeStorage({ [frequentStorageKey(T, P)]: JSON.stringify({ ok: { s: 2, t: T0 }, bad: { s: 'x' }, neg: { s: -1, t: T0 } }) }), T, P),
    { ok: { s: 2, t: T0 } },
  )
  const throwing = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') } }
  assert.doesNotThrow(() => recordUsage(throwing, T, P, 'events', T0))
  assert.deepEqual(readUsage(throwing, T, P), {})
  assert.doesNotThrow(() => recordUsage(null, T, P, 'events', T0))
})

test('จำกัดจำนวนรายการที่เก็บ — ตัดตัวที่คะแนนต่ำสุดก่อน ไม่โตไม่สิ้นสุด', () => {
  const st = fakeStorage()
  for (let i = 0; i < 60; i++) recordUsage(st, T, P, `mod-${i}`, T0 + i)
  for (let i = 0; i < 5; i++) recordUsage(st, T, P, 'favorite', T0 + 100)
  const usage = readUsage(st, T, P)
  assert.ok(Object.keys(usage).length <= 40)
  assert.ok(usage.favorite, 'ตัวที่ใช้บ่อยต้องไม่ถูกตัดทิ้ง')
})

test('key แปลกปลอม (ยาวเกิน/ไม่ใช่สตริง) ไม่ถูกบันทึก', () => {
  const st = fakeStorage()
  recordUsage(st, T, P, 'x'.repeat(200), T0)
  recordUsage(st, T, P, 123, T0)
  recordUsage(st, T, P, '', T0)
  assert.deepEqual(readUsage(st, T, P), {})
})

console.log(`\n${cases} cases passed`)

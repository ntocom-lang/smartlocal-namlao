// กันไม่ให้หน้าแรกกลับไปโหลดแบนเนอร์ทุกใบพร้อมกัน (ต้นเหตุ Supabase ตัดบริการ 402 เมื่อ 2026-10-04)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { slideIndexesToLoad } from '../src/lib/bannerSlides.js'

const list = (...args) => [...slideIndexesToLoad(...args)].sort((a, b) => a - b)

test('เปิดหน้าแรก: โหลดแค่ใบที่แสดงกับใบถัดไป ไม่ใช่ทั้ง 11 ใบ', () => {
  assert.deepEqual(list(11, 0), [0, 1])
})

test('สไลด์ไปข้างหน้า: ใบที่เคยแสดงยังอยู่ ใบที่ยังไม่ถึงคิวยังไม่โหลด', () => {
  assert.deepEqual(list(11, 1, [0, 1]), [0, 1, 2])
  assert.deepEqual(list(11, 3, [0, 1, 2, 3]), [0, 1, 2, 3, 4])
})

test('ใบสุดท้ายวนกลับไปใบแรก', () => {
  assert.deepEqual(list(3, 2, [0, 1, 2]), [0, 1, 2])
  assert.deepEqual(list(11, 10, [10]), [0, 10])
})

test('ผู้ใช้กดย้อนหรือกดจุดข้ามใบ: โหลดเฉพาะใบนั้นกับใบถัดไป', () => {
  assert.deepEqual(list(11, 7, [0, 7]), [0, 7, 8])
})

test('ขอบเขต: ไม่มีแบนเนอร์ / ใบเดียว / ค่าผิดปกติ ไม่พัง', () => {
  assert.equal(slideIndexesToLoad(0, 0).size, 0)
  assert.equal(slideIndexesToLoad(undefined, 0).size, 0)
  assert.deepEqual(list(1, 0), [0])
  assert.deepEqual(list(5, -1), [0, 4])
  assert.deepEqual(list(5, 12), [2, 3])
  assert.deepEqual(list(5, 'x', [99, -3, 1.5, 2]), [0, 1, 2])
})

test('BannerSlider ต้องใช้ตัวคัดกรองนี้ ห้ามกลับไปใส่ <img> ทุกใบ', async () => {
  const src = await readFile(new URL('../src/components/home/BannerSlider.jsx', import.meta.url), 'utf8')
  assert.match(src, /slideIndexesToLoad\(/, 'ต้องเรียก slideIndexesToLoad')
  assert.match(src, /\{load && \(\s*<img /, '<img> ต้องอยู่ภายใต้เงื่อนไข load')
})

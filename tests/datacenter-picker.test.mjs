// ตรวจตัวช่วยเลือกกลุ่ม/ประเภท (src/lib/dataCenterPicker.js) — รันเร็ว ไม่ต้องต่อฐานข้อมูล
//
// ทำไมต้องมีเทสต์ตัวนี้: กฎพวกนี้ตัดสินว่าเจ้าหน้าที่จะ "เห็นปุ่มไหน" และ "จะสร้างหมวดซ้ำหรือไม่"
//  - ถ้าปุ่มที่เลือกอยู่ไม่ถูกโชว์ ผู้ใช้จะไม่รู้ว่าฟอร์มถือค่าอะไรอยู่
//  - ถ้าชื่อที่ต่างกันแค่ช่องว่างถูกมองเป็นคนละหมวด จะเกิดหมวดซ้ำที่ต้องไปรวมมือที่ "จัดการหมวดหมู่"
//  - ถ้า mergeOptions เอา tidyName ไปทับค่าจากฐานข้อมูล การเลือกหมวดเดิมจะกลายเป็นการสร้างหมวดใหม่เงียบๆ
//
//   node tests/datacenter-picker.test.mjs

import assert from 'node:assert/strict'
import {
  MAX_QUICK_CHIPS, normalizeName, tidyName, mergeOptions, findOption, filterOptions, pickVisible,
} from '../src/lib/dataCenterPicker.js'

const make = (n, prefix = 'ก') => Array.from({ length: n }, (_, i) => ({ value: `${prefix}${i + 1}`, count: n - i }))

// ── normalizeName / tidyName ────────────────────────────────────────────────
assert.equal(normalizeName('  ร้านอาหาร  '), 'ร้านอาหาร')
assert.equal(normalizeName('ร้าน   อาหาร'), 'ร้าน อาหาร', 'ช่องว่างซ้ำหดเหลือช่องเดียว')
assert.equal(normalizeName('CCTV'), normalizeName('cctv'), 'ไม่สนตัวพิมพ์')
assert.equal(normalizeName(null), '')
assert.equal(normalizeName(undefined), '')
assert.equal(tidyName('  ร้าน   อาหาร '), 'ร้าน อาหาร')
assert.equal(tidyName('CCTV'), 'CCTV', 'tidyName ต้องคงตัวพิมพ์ตามที่ผู้ใช้พิมพ์')

// ── mergeOptions: เรียงที่ใช้บ่อยสุดก่อน เท่ากันเรียงตามตัวอักษรไทย ───────────────
{
  const merged = mergeOptions(
    [{ value: 'ข', count: 5 }, { value: 'ก', count: 5 }, { value: 'ค', count: 9 }],
    [{ value: 'ง', count: 0 }],
  )
  assert.deepEqual(merged.map(o => o.value), ['ค', 'ก', 'ข', 'ง'])
}

// ตัวอย่างตั้งต้นที่ไม่มีรายการจริง ต้องไม่ถูกทิ้ง (จำนวน 0) แต่ต้องจมไปท้ายรายการ
{
  const merged = mergeOptions([{ value: 'สาธารณสุข', count: 12 }], [{ value: 'สถานที่หลบภัย', count: 0 }])
  assert.deepEqual(merged, [{ value: 'สาธารณสุข', count: 12 }, { value: 'สถานที่หลบภัย', count: 0 }])
}

// ชื่อซ้ำข้ามแหล่ง (ข้อมูลจริง + ตัวอย่างตั้งต้น) รวมเป็นตัวเดียว ใช้จำนวนจริง ไม่บวกซ้ำกับ 0
{
  const merged = mergeOptions([{ value: 'ร้านอาหาร', count: 7 }], [{ value: 'ร้านอาหาร', count: 0 }])
  assert.deepEqual(merged, [{ value: 'ร้านอาหาร', count: 7 }])
}

// ⚠️ ค่าดิบจากฐานข้อมูลต้องไม่ถูกแก้ — "ร้านอาหาร " (มีช่องว่างท้าย) ที่มีรายการเยอะกว่าต้องเป็นค่าที่ส่งกลับ
// ไม่ใช่ "ร้านอาหาร" ที่ตัดแล้ว ไม่งั้นเลือกหมวดเดิมแล้วเขียนกลับเป็นสตริงใหม่ = เกิดหมวดซ้ำเงียบๆ
{
  const merged = mergeOptions([{ value: 'ร้านอาหาร ', count: 6 }, { value: 'ร้านอาหาร', count: 2 }])
  assert.equal(merged.length, 1, 'ชื่อที่ต่างกันแค่ช่องว่างท้ายต้องรวมเป็นตัวเดียว')
  assert.equal(merged[0].value, 'ร้านอาหาร ', 'ต้องคืนค่าดิบของตัวที่มีรายการมากกว่า')
  assert.equal(merged[0].count, 8, 'จำนวนรวมกัน')
}

// ค่าว่าง/ช่องว่างล้วนต้องไม่กลายเป็นตัวเลือก
assert.deepEqual(mergeOptions([{ value: '   ', count: 3 }, { value: '', count: 1 }, { value: null }]), [])
assert.deepEqual(mergeOptions(), [])
assert.deepEqual(mergeOptions(undefined, null), [])

// ── findOption: จับคู่ชื่อที่พิมพ์กับของเดิม (กันสร้างซ้ำ) ───────────────────────
{
  const options = [{ value: 'สถานประกอบการ', count: 4 }, { value: 'CCTV', count: 2 }]
  assert.equal(findOption(options, ' สถานประกอบการ ')?.value, 'สถานประกอบการ')
  assert.equal(findOption(options, 'cctv')?.value, 'CCTV')
  assert.equal(findOption(options, 'สถานประกอบ'), null, 'คำที่พิมพ์ไม่ครบไม่ใช่ตัวเดียวกัน ห้ามเดา')
  assert.equal(findOption(options, ''), null)
  assert.equal(findOption(options, '   '), null)
}

// ── filterOptions ───────────────────────────────────────────────────────────
{
  const options = [{ value: 'ร้านอาหาร', count: 1 }, { value: 'ร้านค้าทั่วไป', count: 1 }, { value: 'คอนโด', count: 1 }]
  assert.deepEqual(filterOptions(options, 'ร้าน').map(o => o.value), ['ร้านอาหาร', 'ร้านค้าทั่วไป'])
  assert.deepEqual(filterOptions(options, 'อาหาร').map(o => o.value), ['ร้านอาหาร'], 'ค้นหาจากกลางคำได้')
  assert.equal(filterOptions(options, '').length, 3, 'ไม่พิมพ์อะไรต้องได้ครบ')
  assert.equal(filterOptions(options, 'ไม่มีคำนี้').length, 0)
}

// ── pickVisible: ความสูงต้องคงที่ไม่ว่าตัวเลือกจะมีกี่ตัว ──────────────────────
{
  const few = make(5)
  assert.equal(pickVisible(few, '').length, 5, 'ไม่เกินเพดานโชว์ครบ')
  assert.equal(pickVisible(make(MAX_QUICK_CHIPS), '').length, MAX_QUICK_CHIPS, 'เท่าเพดานพอดีโชว์ครบ')

  for (const n of [9, 50, 500]) {
    assert.equal(pickVisible(make(n), '').length, MAX_QUICK_CHIPS, `ตัวเลือก ${n} ตัวต้องโชว์แค่ ${MAX_QUICK_CHIPS}`)
  }
  assert.deepEqual(pickVisible(make(50), '').map(o => o.value), make(MAX_QUICK_CHIPS).map(o => o.value), 'ต้องเป็นตัวที่ใช้บ่อยสุดตามลำดับ')
}

// ตัวที่เลือกอยู่ในกลุ่มบนสุดอยู่แล้ว → ไม่เปลี่ยนอะไร
{
  const options = make(50)
  assert.deepEqual(pickVisible(options, 'ก3'), options.slice(0, MAX_QUICK_CHIPS))
  assert.deepEqual(pickVisible(options, ' ก3 '), options.slice(0, MAX_QUICK_CHIPS), 'เทียบแบบ normalize')
}

// ตัวที่เลือกอยู่หางแถว → ต้องโผล่ แทนปุ่มสุดท้าย ปุ่มอื่นไม่ขยับ จำนวนยังเท่าเพดาน
{
  const options = make(50)
  const chips = pickVisible(options, 'ก40')
  assert.equal(chips.length, MAX_QUICK_CHIPS)
  assert.equal(chips[MAX_QUICK_CHIPS - 1].value, 'ก40')
  assert.ok(!chips[MAX_QUICK_CHIPS - 1].isNew, 'ของเดิมในระบบห้ามติดป้ายใหม่')
  assert.deepEqual(chips.slice(0, MAX_QUICK_CHIPS - 1), options.slice(0, MAX_QUICK_CHIPS - 1))
}

// ชื่อที่ยังไม่มีในระบบ (กำลังจะสร้างใหม่) → โผล่พร้อมป้าย isNew
{
  const chipsMany = pickVisible(make(50), 'กลุ่มใหม่ของฉัน')
  assert.equal(chipsMany.length, MAX_QUICK_CHIPS)
  assert.deepEqual(chipsMany[MAX_QUICK_CHIPS - 1], { value: 'กลุ่มใหม่ของฉัน', count: 0, isNew: true })

  const chipsFew = pickVisible(make(3), 'กลุ่มใหม่ของฉัน')
  assert.equal(chipsFew.length, 4, 'ตัวเลือกน้อยกว่าเพดานก็แค่ต่อท้าย ไม่ต้องทิ้งตัวไหน')
  assert.equal(chipsFew[3].isNew, true)
}

// ไม่ mutate อาร์เรย์ต้นฉบับ (ฟอร์มส่งรายการเดียวกันเข้ามาทุกครั้งที่เรนเดอร์)
{
  const options = make(50)
  const snapshot = JSON.stringify(options)
  pickVisible(options, 'ก40')
  pickVisible(options, 'ใหม่')
  assert.equal(JSON.stringify(options), snapshot)
}

console.log('datacenter-picker: ผ่านทั้งหมด')

// หมวดคำร้องที่ผูกกับโมดูล — ตรวจตัวกรองกลางแบบไม่ต้องเปิดเบราว์เซอร์
//
// ทำไมต้องมี: ตัวกรองนี้ถูกเรียกจาก 5 จุดที่ประชาชนเลือกหมวดได้ (แถบคำร้องหน้าแรก, ปุ่มบริการ,
// หน้าแรกธีม Kledkaew, หน้าเลือกประเภทคำร้อง, ฟอร์มคำร้อง) ถ้าวันหนึ่งรหัสหมวดหรือคีย์โมดูล
// เพี้ยนไปจาก migration ปุ่ม "ซ่อมน้ำประปา" จะโผล่ใน อปท. ที่ปิดงานประปาเงียบๆ ทุกหน้าพร้อมกัน
//
// รันด้วย: node tests/complaint-category-modules.test.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CATEGORY_MODULES,
  moduleHiddenCategoryValues,
  withoutModuleHiddenCategories,
} from '../src/lib/complaintCategoryModules.js'
import { WATERWORKS_MODULE_KEY } from '../src/lib/documentTypes.js'
import { MANAGED_MODULE_KEYS } from '../src/lib/staffModules.js'

const CATEGORIES = [
  { value: 'light', label: 'ไฟฟ้าสาธารณะ' },
  { value: 'water_repair', label: 'ซ่อมน้ำประปา' },
  { value: 'water_supply', label: 'สนับสนุนน้ำอุปโภค' },
]

// ซ่อมน้ำประปาต้องผูกกับโมดูลงานประปา และคีย์นั้นต้องเป็นคีย์ที่แอดมินปิดได้จริง
// (คีย์ที่ไม่อยู่ใน MANAGED_MODULE_KEYS ถูกถือว่าเปิดเสมอ = ตัวกรองนี้ไม่มีวันทำงาน)
assert.equal(CATEGORY_MODULES.water_repair, WATERWORKS_MODULE_KEY)
for (const moduleKey of Object.values(CATEGORY_MODULES)) {
  assert.ok(MANAGED_MODULE_KEYS.includes(moduleKey), `คีย์โมดูล ${moduleKey} ไม่อยู่ในรายการที่ปิดได้`)
}

// เปิดโมดูล: ไม่ตัดอะไรเลย
const allOn = () => true
assert.deepEqual(moduleHiddenCategoryValues(allOn), [])
assert.deepEqual(withoutModuleHiddenCategories(CATEGORIES, moduleHiddenCategoryValues(allOn)), CATEGORIES)

// ปิดงานประปา: ตัดเฉพาะซ่อมน้ำประปา — "สนับสนุนน้ำอุปโภค" (รถส่งน้ำ) ไม่ใช่งานประปา ต้องอยู่ต่อ
const waterOff = key => key !== WATERWORKS_MODULE_KEY
assert.deepEqual(moduleHiddenCategoryValues(waterOff), ['water_repair'])
assert.deepEqual(
  withoutModuleHiddenCategories(CATEGORIES, moduleHiddenCategoryValues(waterOff)).map(c => c.value),
  ['light', 'water_supply'],
)

// ค่าแปลกๆ ต้องไม่ทำหน้าพัง (tenant ยังโหลดไม่เสร็จ / ลิสต์ยังไม่มา)
assert.deepEqual(moduleHiddenCategoryValues(undefined), [])
assert.equal(withoutModuleHiddenCategories(null, ['water_repair']), null)

// รหัสหมวดใน migration ต้องตรงกับตัวกรอง — ถ้าแก้ฝั่งใดฝั่งหนึ่ง เทสนี้ต้องตก
const migration = readFileSync(new URL('../supabase/migrations/20260914130000_waterworks_repair_category.sql', import.meta.url), 'utf8')
for (const value of Object.keys(CATEGORY_MODULES)) {
  assert.ok(migration.includes(`'${value}'`), `migration ไม่ได้สร้างหมวด ${value}`)
}

console.log('complaint-category-modules.test.mjs PASS')

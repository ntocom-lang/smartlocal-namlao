// หมวดคำร้องที่ผูกกับโมดูล — อปท. ปิดโมดูลแล้วหมวดนั้นต้องหายจากทุกจุดที่ประชาชนเลือกหมวดได้
//
// ทำไมต้องมี: หมวดคำร้องเป็นแถวในตาราง complaint_categories ที่แอดมินแต่ละ อปท. จัดการเอง
// ส่วนสวิตช์โมดูลอยู่ที่ municipalities.enabled_modules คนละที่กัน ถ้าไม่ผูกไว้ อปท. ที่ปิด
// "งานประปา" (อยู่ในเขต กปภ.) จะยังมีปุ่ม "ซ่อมน้ำประปา" ให้ประชาชนกด แล้วเรื่องไปค้างที่กองช่าง
// ทั้งที่ อปท. ไม่มีท่อประปาของตัวเองให้ซ่อม
//
// ผูกด้วย "รหัสหมวด" (value) จึงใช้ได้เฉพาะหมวดมาตรฐานที่รหัสเหมือนกันทุก อปท. เท่านั้น
// หมวดที่แอดมินสร้างเองได้รหัสสุ่ม (cat_xxxx) ผูกแบบนี้ไม่ได้ — ซ่อมน้ำประปาจึงถูกย้ายมาเป็น
// รหัสมาตรฐาน water_repair ที่ 20260914130000_waterworks_repair_category.sql
//
// กรองตอนแสดงผลเท่านั้น ไม่ได้กันที่ฐานข้อมูล (ต่างจากคำขอประปาใน document_requests) —
// คำร้องแจ้งซ่อมไม่ได้สร้างภาระผูกพันกับผู้ยื่นอย่างค่าประกันมาตร เรื่องที่หลุดเข้ามาทางลิงก์เก่า
// ยังมีกองช่างรับผิดชอบตามปกติ และฟอร์มคำร้องปฏิเสธหมวดที่ถูกซ่อนก่อนส่งอยู่แล้ว
import { WATERWORKS_MODULE_KEY } from './documentTypes.js'

export const CATEGORY_MODULES = {
  water_repair: WATERWORKS_MODULE_KEY,
}

/** รหัสหมวดที่ต้องซ่อนเพราะ อปท. ปิดโมดูลที่หมวดนั้นสังกัด */
export function moduleHiddenCategoryValues(isModuleEnabled) {
  if (typeof isModuleEnabled !== 'function') return []
  return Object.entries(CATEGORY_MODULES)
    .filter(([, moduleKey]) => !isModuleEnabled(moduleKey))
    .map(([value]) => value)
}

/** ตัดหมวดที่ถูกซ่อนออกจากลิสต์ — รับ array ของ object ที่มี .value */
export function withoutModuleHiddenCategories(categories, hiddenValues) {
  if (!Array.isArray(categories) || !hiddenValues?.length) return categories
  return categories.filter(category => !hiddenValues.includes(category?.value))
}

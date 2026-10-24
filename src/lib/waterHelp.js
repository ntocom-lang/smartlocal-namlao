// ทางลัด "แจ้งเหตุ/ขอความช่วยเหลือเรื่องน้ำ" ท้ายแท็บผังน้ำตำบลของ /water-situation — ตรรกะล้วน (ไม่มี React/supabase เทสต์รันด้วย node ตรงๆ)
//
// เจ้าของระบบสั่ง 2569-10-24 "จะได้ครบ จบ เรื่องน้ำ จะไม่มีคำถามตามมา" — ประชาชนดูผังน้ำแล้วต้องรู้ว่า "ถ้าเกิดเหตุทำอะไรต่อ"
// หลักออกแบบ "ตั้งค่าครั้งเดียว ที่เหลือรันเอง": ปุ่มหมวดคำร้องขึ้นเองเมื่อ อปท. นั้นเปิดหมวดนี้ให้คนคนนี้ยื่นได้จริง (อ่านจาก complaint_categories)
//   · ไม่ฝังว่าตำบลไหนมีอะไร — ตรวจ production 2569-10-24: ไม่มี อปท. ไหนมีหมวด "flood" (น้ำท่วม/ระบายน้ำ) เลย · water_supply เปิดให้ประชาชนที่ตำหนักธรรม/ทุ่งแค้ว
//     แต่ปิด/เฉพาะผู้มีตำแหน่งที่น้ำเลา → ที่น้ำเลาเหลือแค่ลิงก์สายด่วนฉุกเฉิน · ถ้ามีหมวดรหัส flood ในตารางของ อปท. ปุ่มขึ้นเอง ไม่ต้องแก้โค้ด (⚠️ แต่เมนูแอดมินสร้างหมวดใหม่ได้รหัสสุ่ม cat_xxxx และรายการหมวดมาตรฐานไม่มี flood — จะมีหมวดรหัส flood ได้ต้องเพิ่มเป็นหมวดมาตรฐาน/seed ในฐานข้อมูล ซึ่งเป็นงานแยกที่เจ้าของระบบต้องตัดสินว่าเรื่องนี้ตกกองไหน)
//   · ไม่ฝังเบอร์โทร (เบอร์ฉุกเฉินอยู่ในฐานข้อมูลของแต่ละ อปท. หน้า /emergency แสดงให้)
//   · ซ่อนอย่างเดียว ด่านบังคับจริงอยู่ที่ฐานข้อมูล (submit_citizen_complaint_v4) เหมือนปุ่มลัดอื่นของระบบ
import { canSubmitCategory } from './serviceAudience.js'
import { printableCategoryLabel } from './complaintCategoryLabels.js'

// รหัสหมวดมาตรฐานที่เกี่ยวกับเรื่องน้ำ (เรียงตามที่แสดง) — ซ่อมน้ำประปา/ท่อระบายน้ำเป็นงานคนละเรื่อง (ระบบประปา/ท่อ) ไม่ใส่บนหน้านี้
export const WATER_HELP_CATEGORIES = ['flood', 'water_supply']

// หน้าสายด่วนฉุกเฉินของ อปท. (เบอร์มาจากฐานข้อมูล ไม่ฝังเบอร์ในโค้ด)
export const WATER_HELP_EMERGENCY_PATH = '/emergency'

/** ลิงก์เข้าฟอร์มรับเรื่องพร้อมเลือกหมวดไว้ให้ (รูปแบบเดียวกับปุ่มหมวดในหน้าแรก) */
export function waterHelpCategoryPath(value) {
  return `/request?category=${encodeURIComponent(value)}`
}

/**
 * หมวดที่ต้องขึ้นเป็นปุ่ม — จากแถวของ complaint_categories ของ อปท. นี้
 * ขึ้นเมื่อ: เป็นหมวดในรายการ · เปิดใช้งานอยู่ (is_active === true) · role นี้ยื่นได้ · โมดูลของหมวดไม่ถูกปิด
 * ข้อมูลเสีย/ไม่ใช่ array = ไม่ขึ้นปุ่ม (ปล่อยแต่ลิงก์สายด่วน — ไม่เดาว่าหมวดเปิด)
 * @param {Array} rows แถว { value, label, emoji, is_active, submit_audience }
 * @param {{ role?: string, hiddenValues?: string[] }} options hiddenValues = moduleHiddenCategoryValues(isModuleEnabled)
 * @returns {Array<{ value: string, label: string, emoji: string, to: string }>}
 */
export function openWaterHelpCategories(rows, { role, hiddenValues = [] } = {}) {
  if (!Array.isArray(rows)) return []
  const byValue = new Map()
  for (const row of rows) {
    const value = row?.value
    if (!WATER_HELP_CATEGORIES.includes(value) || byValue.has(value)) continue
    if (row.is_active !== true) continue
    if (hiddenValues.includes(value)) continue
    if (!canSubmitCategory(row, role)) continue
    byValue.set(value, row)
  }
  return WATER_HELP_CATEGORIES.filter(value => byValue.has(value)).map(value => {
    const row = byValue.get(value)
    return {
      value,
      label: printableCategoryLabel(value, row.label),
      emoji: typeof row.emoji === 'string' ? row.emoji.slice(0, 8) : '',
      to: waterHelpCategoryPath(value),
    }
  })
}

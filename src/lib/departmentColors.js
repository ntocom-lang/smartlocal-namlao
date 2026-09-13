// สีประจำกอง — ค่าใน departments.color เป็น "คีย์" ส่วนตัวอีโมจิกับชื่อภาษาไทยอยู่ที่นี่
// ใช้ในหน้าจัดการกอง (DepartmentManager) และเป็นจุดสีหน้าเส้นคั่นบรรทัดแรกของข้อความแจ้งเตือน Telegram
//
// ⚠️ คีย์ต้องตรงกัน 3 ที่: ไฟล์นี้, CHECK departments_color_check ใน
// supabase/migrations/20260913100000_departments_color_column.sql และ DEPARTMENT_COLOR_EMOJI ใน
// supabase/functions/notify-telegram/index.ts (edge function import ไฟล์ฝั่ง client ไม่ได้)
// tests/telegram-notification-message.test.mjs ตรวจให้ว่าทั้ง 3 ที่ตรงกัน
//
// มีได้แค่ 9 สีนี้ เพราะเป็นอีโมจิวงกลมสีมาตรฐานที่มีอยู่ Telegram กำหนดสีตัวอักษร/พื้นหลังเองไม่ได้
// เป็นวงกลมไม่ใช่สี่เหลี่ยม: ใน Telegram สีกองเป็นจุดเล็กหน้าเส้นประ หน้าจัดการกองต้องเห็นแบบเดียวกัน
export const DEPARTMENT_COLORS = [
  { key: 'red',    emoji: '🔴', label: 'แดง' },
  { key: 'orange', emoji: '🟠', label: 'ส้ม' },
  { key: 'yellow', emoji: '🟡', label: 'เหลือง' },
  { key: 'green',  emoji: '🟢', label: 'เขียว' },
  { key: 'blue',   emoji: '🔵', label: 'น้ำเงิน' },
  { key: 'purple', emoji: '🟣', label: 'ม่วง' },
  { key: 'brown',  emoji: '🟤', label: 'น้ำตาล' },
  { key: 'black',  emoji: '⚫', label: 'ดำ' },
  { key: 'white',  emoji: '⚪', label: 'ขาว' },
]

const BY_KEY = Object.fromEntries(DEPARTMENT_COLORS.map((c) => [c.key, c]))

/** @param {string | null | undefined} key */
export function departmentColor(key) {
  return BY_KEY[key] ?? null
}

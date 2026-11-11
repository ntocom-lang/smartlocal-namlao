// สีประจำกอง — ค่าใน departments.color เป็น "คีย์" ส่วนตัวอีโมจิกับชื่อภาษาไทยอยู่ที่นี่
// ใช้ในหน้าต่างเพิ่ม/แก้กอง (DepartmentDialog) แถวกองในแท็บกองและตำแหน่ง และเป็นจุดสีหน้าเส้นคั่นบรรทัดสุดท้ายของข้อความแจ้งเตือน Telegram
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

// ชุดสีธีมของ "ภาพข่าวประชาสัมพันธ์" (complaintNewsImage.js) ตามสีกอง — แหล่งสีคือ departments.color ที่มีอยู่แล้ว
// (เจ้าของระบบตัดสิน: ห้ามทำชุดสีแยกตามชื่อกอง) · base = สีแถบหัว/แถบท้าย/ตัวอักษรเน้น, deep = ปลายเข้มของไล่สีและเงาป้าย,
// soft/ink = พื้น/ตัวอักษรของป้ายเม็ดยาระยะเวลา
// ⚠️ base ต้องคอนทราสต์กับตัวอักษรขาว ≥ 4.5:1 (เกณฑ์ WCAG ตัวอักษรทั่วไป — เทสต์คำนวณจริงทุกสี):
//    เหลืองสด (#eab308) อ่านตัวขาวไม่ออก จึงใช้ทองเข้ม · ดำใช้เทาน้ำเงินเข้ม (slate) ให้ลายวงจรสีขาวยังเห็น ·
//    ขาว = "ไม่มีสี" ใช้สีส้มเดิมของภาพ (ภาพข่าวรุ่นแรกเป็นส้ม) เช่นเดียวกับกองที่ยังไม่ตั้งสีหรือคีย์ที่ไม่รู้จัก
export const NEWS_THEMES = Object.freeze({
  red:    Object.freeze({ base: '#b91c1c', deep: '#7f1d1d', soft: '#fee2e2', ink: '#991b1b' }),
  orange: Object.freeze({ base: '#c2410c', deep: '#7c2d12', soft: '#ffedd5', ink: '#9a3412' }),
  yellow: Object.freeze({ base: '#a16207', deep: '#713f12', soft: '#fef9c3', ink: '#854d0e' }),
  green:  Object.freeze({ base: '#15803d', deep: '#14532d', soft: '#dcfce7', ink: '#166534' }),
  blue:   Object.freeze({ base: '#1d4ed8', deep: '#1e3a8a', soft: '#dbeafe', ink: '#1e40af' }),
  purple: Object.freeze({ base: '#7e22ce', deep: '#581c87', soft: '#f3e8ff', ink: '#6b21a8' }),
  brown:  Object.freeze({ base: '#92400e', deep: '#451a03', soft: '#fef3c7', ink: '#78350f' }),
  black:  Object.freeze({ base: '#334155', deep: '#0f172a', soft: '#e2e8f0', ink: '#1e293b' }),
})

/** @param {string | null | undefined} key คีย์ departments.color — ไม่รู้จัก/ขาว/ว่าง = ส้ม */
export function newsThemeFor(key) {
  return typeof key === 'string' && Object.hasOwn(NEWS_THEMES, key) ? NEWS_THEMES[key] : NEWS_THEMES.orange
}

/**
 * คีย์สีของกองที่ชื่อตรงกับ departmentName (ตัดช่องว่างหัวท้าย ตรงกับ name หรือ short_name) — ไม่เจอ/ไม่มีชื่อ = null
 * @param {{ name?: string | null, short_name?: string | null, color?: string | null }[] | null | undefined} rows
 * @param {string | null | undefined} departmentName
 */
export function departmentColorKeyByName(rows, departmentName) {
  const wanted = String(departmentName ?? '').trim()
  if (!wanted || !Array.isArray(rows)) return null
  const row = rows.find(item => String(item?.name ?? '').trim() === wanted || String(item?.short_name ?? '').trim() === wanted)
  return row?.color ?? null
}

// ตัวเชื่อมระหว่างตาราง public_holidays ใน Supabase กับตัวคำนวณวันทำการ
//
// แยกไฟล์จาก src/lib/workingDays.js โดยตั้งใจ — workingDays.js ต้องไม่ผูกกับ supabase
// เพื่อให้เป็น logic ล้วนที่รันทดสอบนอกเบราว์เซอร์ได้ และเพื่อให้การนับวันยังทำงานได้
// ตามตาราง static ต่อไปแม้โมดูลนี้จะโหลดข้อมูลไม่สำเร็จ
import { supabase } from './supabase'
import { setHolidayRows } from './workingDays'

const SELECT_COLS = 'id, municipality_id, holiday_date, name, is_working_day, note'

/**
 * ดึงวันหยุดที่เกี่ยวข้องกับ อปท. นี้ = แถวทั่วประเทศ (municipality_id IS NULL) + แถวของ อปท. เอง
 * @param {string|null} municipalityId — null/undefined จะได้เฉพาะแถวทั่วประเทศ
 */
export async function fetchHolidayRows(municipalityId) {
  let query = supabase.from('public_holidays').select(SELECT_COLS).order('holiday_date')
  query = municipalityId
    ? query.or(`municipality_id.is.null,municipality_id.eq.${municipalityId}`)
    : query.is('municipality_id', null)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

/**
 * โหลดวันหยุดเข้าตัวคำนวณ เรียกตอนบูตแอป (TenantContext) และหลังแอดมินบันทึกการแก้ไข
 * ห้าม throw — ถ้าล้มเหลวต้องปล่อยให้ระบบเดินต่อด้วยตาราง static ไม่ใช่ทำทั้งแอปพัง
 * @returns {Promise<boolean>} true เมื่อโหลดสำเร็จ
 */
export async function loadHolidays(municipalityId) {
  try {
    setHolidayRows(await fetchHolidayRows(municipalityId))
    return true
  } catch (err) {
    // ไม่เงียบสนิท — ถ้าตารางหาย/RLS ปฏิเสธ ระบบจะกลับไปนับตามตาราง static ซึ่งครอบคลุม
    // แค่ พ.ศ. 2568–2569 ต้องมีร่องรอยให้ไล่ได้ว่าทำไมตัวเลข SLA ของปีอื่นเพี้ยน
    console.warn('[holidays] โหลดวันหยุดราชการจากฐานข้อมูลไม่สำเร็จ ใช้ตารางในโค้ดแทน:', err?.message || err)
    return false
  }
}

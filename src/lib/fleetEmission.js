// ตรวจวัดมลพิษยานพาหนะ — ระเบียบ มท. ว่าด้วยการใช้และรักษายานพาหนะของ อปท. พ.ศ. ๒๕๖๙ ข้อ ๒๐
// ตรวจทุก 6 เดือน หรือทุก 15,000 กม. แล้วแต่อย่างใดถึงก่อน
//
// ข้อเท็จจริงรายคันมาจาก RPC fleet_emission_status (วันครบกำหนด/เลขไมล์ครบกำหนด/เลขไมล์ปัจจุบัน)
// ไฟล์นี้ตัดสินแค่ "ใกล้หรือเกินกำหนด" — เกณฑ์ต้องตรงกับ supabase/functions/fleet-doc-expiry-notify
// (edge function ไม่ได้ import โมดูลฝั่ง client จึงคัดตัวเลขไปไว้ที่นั่น แก้ที่หนึ่งต้องแก้อีกที่)

export const EMISSION_TYPE = 'emission'
export const EMISSION_LABEL = 'ตรวจวัดมลพิษ'
// เตือนล่วงหน้า: เหลือไม่เกิน 30 วัน หรือไม่เกิน 1,000 กม. (ความเห็นของ agent — ระเบียบไม่ได้กำหนด)
export const EMISSION_SOON_DAYS = 30
export const EMISSION_SOON_KM = 1000

function daysBetween(fromIso, toIso) {
  const from = Date.parse(`${fromIso}T00:00:00Z`)
  const to = Date.parse(`${String(toIso).slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return Math.round((to - from) / 86_400_000)
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

// today = 'YYYY-MM-DD' ตามเวลาไทย (ส่งเข้ามา ห้ามอ่านนาฬิกาในฟังก์ชันนี้ — เทสได้และไม่ผิดกฎ purity)
// state: never = ยังไม่เคยบันทึกการตรวจ · overdue = เกินกำหนดแล้ว · soon = ใกล้ครบ · ok = ยังไม่ถึง
export function classifyEmission(row, today) {
  if (!row?.last_check_date) return { state: 'never', daysLeft: null, kmLeft: null }
  const daysLeft = row.due_date ? daysBetween(today, row.due_date) : null
  const dueMeter = numberOrNull(row.due_meter)
  const currentMeter = numberOrNull(row.current_meter)
  const kmLeft = dueMeter !== null && currentMeter !== null ? Math.round(dueMeter - currentMeter) : null
  if ((daysLeft !== null && daysLeft < 0) || (kmLeft !== null && kmLeft < 0)) {
    return { state: 'overdue', daysLeft, kmLeft }
  }
  if ((daysLeft !== null && daysLeft <= EMISSION_SOON_DAYS) || (kmLeft !== null && kmLeft <= EMISSION_SOON_KM)) {
    return { state: 'soon', daysLeft, kmLeft }
  }
  return { state: 'ok', daysLeft, kmLeft }
}

// ข้อความสั้นบอกว่าใกล้/เกินด้วยเกณฑ์ไหน — "แล้วแต่อย่างใดถึงก่อน" จึงบอกตัวที่ถึงก่อน
export function emissionDueText({ state, daysLeft, kmLeft }) {
  if (state === 'never') return 'ยังไม่มีบันทึกการตรวจ'
  const parts = []
  if (daysLeft !== null) parts.push(daysLeft < 0 ? `เกิน ${Math.abs(daysLeft)} วัน` : `อีก ${daysLeft} วัน`)
  if (kmLeft !== null) parts.push(kmLeft < 0 ? `เกิน ${Math.abs(kmLeft).toLocaleString('th-TH')} กม.` : `อีก ${kmLeft.toLocaleString('th-TH')} กม.`)
  return parts.join(' / ')
}

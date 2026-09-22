// ตรวจความสมเหตุสมผลของเลขไมล์ 1 ทริป — จุดเดียวที่ตัดสินว่า "ระยะทางแบบนี้น่าจะพิมพ์ผิด"
// ใช้ร่วมกันทุกหน้า (บันทึกกลับ, บันทึกย้อนหลัง, ป้ายในประวัติ, หน้าผู้ดูแลแก้เลขไมล์)
// ถ้าแต่ละหน้าตั้งเกณฑ์เอง หน้าหนึ่งจะเตือนแต่อีกหน้าเงียบ แล้วเลขผิดก็หลุดเข้าทางที่เงียบ
//
// เคสจริง เทศบาลตำบลน้ำเลา 15 ก.ย. 2569 (รถตู้ 1 คัน)
//   เลขออก 278,706 · เลขกลับพิมพ์เป็น 287,715 (ที่ถูก 278,715 — สลับหลัก 7↔8)
//   หน้าจอขึ้น "ระยะทาง 9,009 กม." แต่ไม่มีอะไรเตือน แล้วระบบเติมเลขออกอัตโนมัติ (#170)
//   ก็พาทริปถัดไปอีก 3 รายการขึ้นต้น 287 ตาม เพราะด่าน "เลขกลับต้องไม่น้อยกว่าเลขออก"
//   บังคับให้คนขับพิมพ์ตามเลขผิดที่ระบบเติมมา
//
// ทำไมไม่ใช้เกณฑ์ความเร็ว (กม./ชม.): ข้อมูลจริงมีทริปที่กดออกกับกดกลับห่างกัน 1 นาที
// (ลืมกดตอนออก มากดทีเดียวตอนกลับ) ทั้งที่วิ่งจริง 8 กม. — เกณฑ์ความเร็วจะเตือนผิดทุกครั้ง

/**
 * ระยะทางต่อทริปที่ต้องให้ผู้บันทึกยืนยันก่อน (กม.)
 * สมมติฐาน 2026-09-22: ทริปของ อปท. ส่วนใหญ่อยู่ในท้องที่ (น้ำเลา p95 = 70 กม., demo ไกลสุด 128 กม.)
 * แพร่–กรุงเทพฯ เที่ยวเดียวราว 550 กม. ยังบันทึกได้ แค่ต้องกดยืนยัน — ปรับได้ที่ค่านี้ค่าเดียว
 */
export const FLEET_TRIP_KM_CONFIRM = 500

function finite(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function integerDigits(value) {
  return String(Math.trunc(Math.abs(value))).length
}

// เศษทศนิยมจาก % ของ float — ปัดให้เหลือ 2 ตำแหน่งตามคอลัมน์ numeric(10,2)
function round2(value) {
  return Math.round(value * 100) / 100
}

/**
 * เดาเลขที่ตั้งใจพิมพ์ จาก "เลขที่เชื่อได้" (anchor) กับ "เลขที่น่าจะพิมพ์ผิด" (typed)
 * คงหลักพันขึ้นไปของ anchor ไว้ แล้วต่อด้วย 3 หลักท้ายของ typed
 * ถ้าผลอยู่ผิดฝั่งของ anchor (= วิ่งข้ามหลักพัน) เลื่อนไป 1,000 ตามทิศ
 *   direction +1: เดาเลขกลับจากเลขออก (ผลต้อง ≥ anchor)  เช่น 278,706 / 287,715 → 278,715
 *   direction −1: เดาเลขออกจากเลขกลับ (ผลต้อง ≤ anchor)  เช่น 278,723 / 287,715 → 278,715
 * เดาเฉพาะเมื่อจำนวนหลักเท่ากัน — พิมพ์เกินหรือขาดหลักเดาไม่ได้ว่าหลักไหนเกินมา
 * และระยะของเลขที่เดาต้องไม่เกินเกณฑ์เอง ไม่งั้นไม่ได้ช่วยอะไร
 */
function guessIntended(anchor, typed, direction) {
  if (integerDigits(anchor) !== integerDigits(typed)) return null
  let candidate = round2(anchor - (anchor % 1000) + (typed % 1000))
  if (direction > 0 && candidate < anchor) candidate += 1000
  if (direction < 0 && candidate > anchor) candidate -= 1000
  if (candidate === typed || candidate < 0) return null
  if (Math.abs(anchor - candidate) > FLEET_TRIP_KM_CONFIRM) return null
  return candidate
}

/**
 * ตรวจเลขไมล์ของทริปเดียว
 * @returns {{ distance: number|null, backwards: boolean, implausible: boolean,
 *             suggestedEnd: number|null, suggestedStart: number|null }}
 *   backwards      — เลขกลับน้อยกว่าเลขออก (DB ไม่ยอมอยู่แล้ว หน้าจอต้องบอกทางแก้ ไม่ใช่แค่ห้าม)
 *   implausible    — ระยะทางเกิน FLEET_TRIP_KM_CONFIRM ต้องให้ผู้บันทึกยืนยัน
 *   suggestedEnd   — ตอน implausible: เลขกลับที่น่าจะตั้งใจพิมพ์ (ถือเลขออกเป็นหลัก)
 *   suggestedStart — ตอน backwards: เลขออกที่น่าจะถูก (ถือเลขกลับตามหน้าปัดเป็นหลัก)
 *                    เคสที่เลขออกผิดเพราะระบบเติมต่อจากทริปก่อนที่พิมพ์ผิด
 */
export function checkTripOdometer(startValue, endValue) {
  const start = finite(startValue)
  const end = finite(endValue)
  if (start === null || end === null) {
    return { distance: null, backwards: false, implausible: false, suggestedEnd: null, suggestedStart: null }
  }
  const distance = round2(end - start)
  const backwards = distance < 0
  const implausible = distance > FLEET_TRIP_KM_CONFIRM
  return {
    distance,
    backwards,
    implausible,
    suggestedEnd: implausible ? guessIntended(start, end, +1) : null,
    suggestedStart: backwards ? guessIntended(end, start, -1) : null,
  }
}

/** ทริปในประวัติที่ระยะทางเกินเกณฑ์ — ใช้ติดป้ายให้ผู้ดูแลเห็นเองโดยไม่ต้องไล่หา */
export function isImplausibleTripDistance(distanceKm) {
  const distance = finite(distanceKm)
  return distance !== null && distance > FLEET_TRIP_KM_CONFIRM
}

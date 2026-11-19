// ป้ายนับถอยหลังของกิจกรรม (หน้า /events และ /events/:id) — ฟังก์ชันล้วน ไม่ import React/supabase เทสต์ด้วย node ได้
// เทสต์: tests/event-countdown-lib.test.mjs (npm run test:event-countdown)
//
// นับเป็น "วัน" ตามปฏิทินไทย (Asia/Bangkok) เสมอ ไม่ขึ้นกับ timezone ของเครื่องผู้ใช้ —
// เครื่องตั้ง UTC เปิดเว็บตอน 01:00 น. ไทยของวันที่ 20 ต้องเห็น "วันที่ 20" ไม่ใช่ 19
// ไม่ดูเวลาเริ่ม (event_time) — กติกาเดียวกับฝั่งฐานข้อมูล event_review_submit ที่เทียบ event_date กับ "วันนี้ไทย" เท่านั้น
//
// ⚠️ canReview ต้องตรงกับ RPC: ให้ดาวได้เมื่อ event_date <= (now() AT TIME ZONE 'Asia/Bangkok')::date
//    (migration 20261220100100_event_reviews_rls_rpc.sql) — ฝั่งหน้าจอแค่ซ่อนปุ่มให้ ฐานข้อมูลเป็นตัวตัดสินจริง

const DATE_RE = /^\d{4}-\d{2}-\d{2}/
const DAY_MS = 86_400_000

const bangkokDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** วันที่ตามเวลาไทย รูป 'YYYY-MM-DD' */
export function todayInBangkok(now = new Date()) {
  return bangkokDay.format(now)
}

// 'YYYY-MM-DD' → จำนวนวันนับจาก epoch (UTC เที่ยงคืน ไม่มีเรื่อง DST/timezone เข้ามาเกี่ยว)
function dayNumber(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return null
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d)
  return Number.isFinite(ms) ? Math.round(ms / DAY_MS) : null
}

/**
 * @param {{ event_date?: string|null, end_date?: string|null }} event  ค่า date ของฐานข้อมูล ('YYYY-MM-DD')
 * @param {Date} [now]
 * @returns {{ kind: 'upcoming'|'today'|'ongoing'|'ended'|'unknown', days: number|null, label: string, canReview: boolean }}
 *   days — upcoming: วันที่เหลือก่อนเริ่ม · today: 0 · ongoing: วันที่เหลือจนจบ (วันสุดท้าย = 0) · ended: วันที่ผ่านมาหลังจบ
 *   unknown — ไม่มีวันที่/รูปแบบผิด (ไม่ขึ้นป้าย ไม่ให้ดาว)
 *   end_date ว่าง หรือน้อยกว่า event_date = กิจกรรมวันเดียว
 */
export function eventCountdown(event, now = new Date()) {
  const start = dayNumber(event?.event_date)
  if (start === null) return { kind: 'unknown', days: null, label: '', canReview: false }
  const endRaw = dayNumber(event?.end_date)
  const end = endRaw !== null && endRaw >= start ? endRaw : start
  const today = dayNumber(todayInBangkok(now))
  const canReview = start <= today

  if (today < start) {
    const days = start - today
    return { kind: 'upcoming', days, label: days === 1 ? 'พรุ่งนี้' : `อีก ${days} วัน`, canReview }
  }
  if (today > end) {
    return { kind: 'ended', days: today - end, label: 'จบแล้ว', canReview }
  }
  if (end === start) return { kind: 'today', days: 0, label: 'วันนี้', canReview }
  return {
    kind: 'ongoing', days: end - today,
    label: `กำลังจัด วันที่ ${today - start + 1}/${end - start + 1}`, canReview,
  }
}

// สีป้ายนับถอยหลัง (class ของ Tailwind) — โทนเดียวกับป้ายเดิมในการ์ดหน้า /events (วันนี้ แดง · ≤3 วัน ส้ม · อื่นๆ น้ำเงิน)
const BADGE_CLASS = {
  upcoming: 'bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400',
  today:    'bg-red-50 text-red-600 dark:bg-red-500/20 dark:text-red-400',
  ongoing:  'bg-green-50 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  ended:    'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400',
}
const BADGE_SOON = 'bg-orange-50 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400'

/** class สีของป้ายจากผล eventCountdown() */
export function countdownBadgeClass(countdown) {
  if (countdown?.kind === 'upcoming' && countdown.days <= 3) return BADGE_SOON
  return BADGE_CLASS[countdown?.kind] ?? BADGE_CLASS.ended
}

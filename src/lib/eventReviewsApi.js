// กิจกรรม: ให้ดาว + ความเห็น (ขั้น 1A) — ฟังก์ชันเรียก Supabase ทั้งหมดของฟีเจอร์
// สัญญาฐานข้อมูล: supabase/migrations/20261220100000_event_reviews_tables.sql + 20261220100100_event_reviews_rls_rpc.sql
//
// ทุกฟังก์ชันคืน { data, error } โดย error เป็น "ข้อความไทย" หรือ null (เหมือน localMarketApi.js)
// สิทธิ์จริงคุมที่ RLS/RPC — ที่นี่ไม่ตัดสินสิทธิ์เอง
//   ทุกคน (anon)     อ่านรีวิวที่ไม่ถูกซ่อนของกิจกรรมสาธารณะ + สรุปดาว (event_review_summary)
//   ผู้ล็อกอิน        ให้ดาว/แก้/ลบของตัวเองผ่าน RPC เท่านั้น (ไม่มี INSERT/UPDATE/DELETE ตรง)
//   เจ้าหน้าที่       เห็นรีวิวที่ถูกซ่อน + ซ่อน/เลิกซ่อนผ่าน event_set_review_hidden (บังคับเหตุผล ลงสมุดบันทึก)
//
// ⚠️ ห้าม select('*') · ห้ามขอ user_id (ไม่มีสิทธิ์คอลัมน์นี้ของทุก role → 42501 ทั้งคำสั่ง)
// ⚠️ ห้ามกรอง .eq('is_hidden', …) ฝั่งประชาชน — anon ไม่มีสิทธิ์คอลัมน์ is_hidden (RLS กรองให้แล้ว)
// ⚠️ ฐานข้อมูลอาจยังไม่ได้รัน migration (RPC/ตารางไม่มี) — ผู้เรียกต้องถือ error ของฟังก์ชันอ่าน (fetch*) เป็น "ซ่อนส่วนรีวิวเงียบๆ"
//    ไม่ใช่จอขาว (ดูวิธีใช้ใน src/pages/EventDetailPage.jsx / EventsPage.jsx)
import { supabase } from './supabase'

export const REVIEW_COMMENT_MAX = 300       // ตรงกับ CHECK comment / ตรวจใน event_review_submit
export const REVIEW_HIDE_REASON_MAX = 300   // ตรงกับ CHECK hidden_reason / ตรวจใน event_set_review_hidden
export const REVIEW_LIST_LIMIT = 50         // หน้าสาธารณะแสดงล่าสุดกี่รายการ
export const REVIEW_STAFF_LIST_LIMIT = 200  // หน้าเจ้าหน้าที่ (ต่อกิจกรรม)
export const REVIEW_SUMMARY_MAX_IDS = 500   // เพดานของ event_review_summary (เกินแล้ว RPC ปฏิเสธ)

// คอลัมน์ที่ anon + authenticated อ่านได้ (GRANT SELECT (...) ON event_reviews) — ไม่มี user_id
export const REVIEW_PUBLIC_COLS = 'id, event_id, municipality_id, rating, comment, reviewer_name, created_at, updated_at'
// authenticated อ่านเพิ่มได้ (เจ้าหน้าที่ใช้หน้าดูแล · RLS "moderator read" คืนแถวที่ถูกซ่อนให้เฉพาะผู้ดูแลกิจกรรมนั้น)
export const REVIEW_STAFF_COLS = `${REVIEW_PUBLIC_COLS}, is_hidden, hidden_reason`

const HAS_THAI = /[฀-๿]/

/** ข้อความ error → ข้อความไทยให้ผู้ใช้ (RPC ของเราตอบไทยอยู่แล้ว แสดงตรงได้) */
export function friendlyReviewError(error, fallback = 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง') {
  if (!error) return ''
  const code = String(error.code ?? '')
  const message = String(error.message ?? '')
  if (HAS_THAI.test(message)) return message
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'ไม่มีสิทธิ์ทำรายการนี้ — ตรวจว่าเข้าสู่ระบบแล้ว'
  }
  if (code === '22023') return 'ข้อมูลไม่ครบ ลองโหลดหน้าใหม่แล้วทำอีกครั้ง'
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'
  }
  return fallback
}

const ok = (data) => ({ data, error: null })
const fail = (error, fallback) => {
  // ข้อความดิบลง console ไว้ไล่ปัญหา (เช่น RPC ยังไม่ถูกสร้างบนฐานข้อมูล = PGRST202) หน้าจอได้ข้อความไทย
  console.error('[event-reviews]', error?.code ?? '', error?.message ?? error)
  return { data: null, error: friendlyReviewError(error, fallback) }
}
// supabase-js บางกรณีโยน exception (เครือข่ายล่ม) แทนคืน error — ห่อให้หน้าจอได้ข้อความไทยเสมอ
async function guard(run, fallback) {
  try { return await run() } catch (err) { return fail(err, fallback) }
}

// ── ฝั่งประชาชน ─────────────────────────────────────────────────────────────────

/**
 * รีวิวล่าสุดของกิจกรรม (RLS คืนเฉพาะที่ไม่ถูกซ่อน) — ไม่มี user_id
 * authed = true: ขอ is_hidden/hidden_reason เพิ่ม แล้วตัดแถวที่ซ่อนทิ้งฝั่งหน้าเว็บ
 *   เพราะผู้ล็อกอินที่เป็นผู้ดูแลกิจกรรมนั้น RLS จะคืนแถวที่ซ่อนด้วย และหน้านี้เป็นหน้าสาธารณะ (anon ขอ is_hidden ไม่ได้)
 */
export function fetchEventReviews(eventId, { authed = false, limit = REVIEW_LIST_LIMIT } = {}) {
  return guard(async () => {
    const { data, error } = await supabase.from('event_reviews')
      .select(authed ? REVIEW_STAFF_COLS : REVIEW_PUBLIC_COLS)
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return fail(error, 'โหลดความเห็นไม่สำเร็จ')
    return ok((data ?? []).filter(r => !r.is_hidden))
  }, 'โหลดความเห็นไม่สำเร็จ')
}

/** รีวิวของฉันในกิจกรรมนี้ (รวมสถานะถูกซ่อน + เหตุผล) — คืนแถวเดียวหรือ null · ต้องล็อกอิน */
export function fetchMyEventReview(eventId) {
  return guard(async () => {
    const { data, error } = await supabase.rpc('event_my_review', { p_event_id: eventId })
    if (error) return fail(error, 'โหลดความเห็นของคุณไม่สำเร็จ')
    return ok(Array.isArray(data) ? (data[0] ?? null) : (data ?? null))
  }, 'โหลดความเห็นของคุณไม่สำเร็จ')
}

/**
 * ผู้ใช้เป็นผู้ดูแลกิจกรรมนี้ไหม (ผู้สร้าง/หัวหน้ากองที่ถือ/แอดมิน อปท./superadmin) — ผู้ดูแลให้ดาวงานตัวเองไม่ได้
 * หน้าจอใช้ซ่อนฟอร์มล่วงหน้าเท่านั้น ฐานข้อมูลเป็นตัวตัดสินจริงใน event_review_submit · ต้องล็อกอิน
 */
export function fetchCanModerateEvent(eventId) {
  return guard(async () => {
    const { data, error } = await supabase.rpc('event_can_moderate', { p_event_id: eventId })
    return error ? fail(error, 'ตรวจสิทธิ์ไม่สำเร็จ') : ok(data === true)
  }, 'ตรวจสิทธิ์ไม่สำเร็จ')
}

/** ให้ดาว/แก้รีวิวของตัวเอง — คืน id รีวิว · ฐานข้อมูลตั้งชื่อที่แสดงเอง (ส่งชื่อไปไม่ได้) */
export function submitEventReview(eventId, rating, comment) {
  const text = typeof comment === 'string' ? comment.trim() : ''
  return guard(async () => {
    const { data, error } = await supabase.rpc('event_review_submit', {
      p_event_id: eventId, p_rating: rating, p_comment: text || null,
    })
    return error ? fail(error, 'ส่งความเห็นไม่สำเร็จ') : ok(data)
  }, 'ส่งความเห็นไม่สำเร็จ')
}

/** ลบรีวิวของตัวเอง */
export function deleteMyEventReview(eventId) {
  return guard(async () => {
    const { error } = await supabase.rpc('event_review_delete_mine', { p_event_id: eventId })
    return error ? fail(error, 'ลบความเห็นไม่สำเร็จ') : ok(true)
  }, 'ลบความเห็นไม่สำเร็จ')
}

/**
 * สรุปดาวรายกิจกรรม — anon เรียกได้ · คืน object { [event_id]: { count, avg } } (avg = null เมื่อผู้ให้ดาว < 3 คน)
 * กิจกรรมที่ไม่มีรีวิวไม่อยู่ใน object · ไม่มี id = ไม่ยิงฐานข้อมูล · เกิน 500 id ตัดที่ 500
 */
export function fetchEventReviewSummary(eventIds) {
  const ids = [...new Set((eventIds ?? []).filter(Boolean))].slice(0, REVIEW_SUMMARY_MAX_IDS)
  if (ids.length === 0) return Promise.resolve(ok({}))
  return guard(async () => {
    const { data, error } = await supabase.rpc('event_review_summary', { p_event_ids: ids })
    if (error) return fail(error, 'โหลดสรุปดาวไม่สำเร็จ')
    const map = {}
    for (const row of data ?? []) {
      map[row.event_id] = {
        count: Number(row.review_count) || 0,
        avg: row.avg_rating === null || row.avg_rating === undefined ? null : Number(row.avg_rating),
      }
    }
    return ok(map)
  }, 'โหลดสรุปดาวไม่สำเร็จ')
}

// ── ฝั่งเจ้าหน้าที่ ──────────────────────────────────────────────────────────────

/** รีวิวทุกใบของกิจกรรม รวมที่ซ่อน — RLS คืนเฉพาะกิจกรรมที่ผู้ใช้ดูแลได้ (ไม่มีสิทธิ์ = ว่าง ไม่ error) */
export function fetchEventReviewsForStaff(eventId) {
  return guard(async () => {
    const { data, error } = await supabase.from('event_reviews')
      .select(REVIEW_STAFF_COLS)
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(REVIEW_STAFF_LIST_LIMIT)
    return error ? fail(error, 'โหลดความเห็นประชาชนไม่สำเร็จ') : ok(data ?? [])
  }, 'โหลดความเห็นประชาชนไม่สำเร็จ')
}

/** ซ่อน/เลิกซ่อนรีวิว — ซ่อนต้องมีเหตุผล (ผู้เขียนเห็นเหตุผลนี้) · ฐานข้อมูลลงสมุดบันทึกให้ทุกครั้ง */
export function setEventReviewHidden(reviewId, hidden, reason) {
  const text = typeof reason === 'string' ? reason.trim() : ''
  if (hidden && !text) return Promise.resolve({ data: null, error: 'กรุณาระบุเหตุผลที่ซ่อน (ผู้เขียนจะเห็นเหตุผลนี้)' })
  if (text.length > REVIEW_HIDE_REASON_MAX) {
    return Promise.resolve({ data: null, error: `เหตุผลยาวเกิน ${REVIEW_HIDE_REASON_MAX} ตัวอักษร` })
  }
  return guard(async () => {
    const { error } = await supabase.rpc('event_set_review_hidden', {
      p_review_id: reviewId, p_hidden: !!hidden, p_reason: hidden ? text : null,
    })
    return error ? fail(error, hidden ? 'ซ่อนความเห็นไม่สำเร็จ' : 'เลิกซ่อนความเห็นไม่สำเร็จ') : ok(true)
  }, hidden ? 'ซ่อนความเห็นไม่สำเร็จ' : 'เลิกซ่อนความเห็นไม่สำเร็จ')
}

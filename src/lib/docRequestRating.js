// ประเมินความพึงพอใจรายเรื่องของคำขอ E-Service ("เอกสารของฉัน") — ตรรกะล้วน (ไม่มี React/supabase)
// ฝั่งฐานข้อมูล: supabase/migrations/20261204100100_doc_request_rating_functions.sql
//   rate_document_request(p_request_id, p_rating, p_comment)  ผู้ยื่นให้คะแนน → {ok:true} | {ok:false, code}
//   my_document_request_ratings(p_muni)                      คำขอที่ปิดแล้วของฉัน → {items:[{id, rating, can_rate, finished_at}], server_now}
//
// กติกา (เจ้าของระบบเลือก 2569-11-17): ใบกรอกแทนที่เคาน์เตอร์ไม่ชวนประเมิน · ใบไม่อนุมัติชวนด้วย (รายงานแยก)
// · ใบที่ผู้ยื่นถอนเองไม่ชวน · ช่วง 30 วันเป็นแค่ช่วง "เด้งชวน" ปุ่มที่การ์ดกดได้เสมอ (หลักเดียวกับคำร้อง)
//
// ⚠️ ไฟล์นี้ต้องไม่ import supabase / React / import.meta.env — เทสต์รันด้วย node ตรงๆ (tests/doc-request-rating.test.mjs)

const DAY_MS = 24 * 60 * 60 * 1000

// เด้งชวนเองเฉพาะคำขอที่ปิดภายใน 30 วันล่าสุด (นับจากเวลาเซิร์ฟเวอร์) — ไม่งั้นผู้ใช้โดนป็อปอัพย้อนหลังเรื่องที่จำไม่ได้แล้ว
export const DOC_RATE_PROMPT_WINDOW_DAYS = 30

export const DOC_RATE_FALLBACK_ERROR = 'ส่งคะแนนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'

// ข้อความตาม code ของ rate_document_request() — ไม่โชว์ code อังกฤษให้ผู้ใช้
// already_rated ไม่อยู่ในนี้โดยเจตนา: ให้คะแนนไปแล้ว = สำเร็จ ไม่บังคับกดซ้ำ (ดู isDocRateSuccess)
export const DOC_RATE_ERRORS = {
  not_logged_in: 'กรุณาเข้าสู่ระบบก่อนให้คะแนน',
  invalid_rating: 'คะแนนไม่ถูกต้อง กรุณาเลือกใหม่',
  not_found: 'ไม่พบคำขอนี้ในระบบแล้ว',
  not_owner: 'ให้คะแนนได้เฉพาะผู้ยื่นคำขอเท่านั้น',
  not_finished: 'ให้คะแนนได้หลังคำขอดำเนินการเสร็จสิ้นแล้ว',
  withdrawn: 'คำขอนี้ท่านยกเลิกเอง จึงไม่เปิดให้ประเมิน',
  no_requester: 'คำขอนี้ไม่มีบัญชีผู้ยื่น จึงไม่เปิดให้ประเมิน',
  counter: 'คำขอนี้เจ้าหน้าที่กรอกแทนที่เคาน์เตอร์ จึงไม่เปิดให้ประเมินออนไลน์',
  not_citizen: 'ให้คะแนนได้เฉพาะบัญชีประชาชนที่ยื่นคำขอเอง',
}

/** ข้อความไทยของ code ที่ไม่รู้จัก/ว่าง = ข้อความกลาง (ไม่ปล่อย code ดิบให้ผู้ใช้เห็น) */
export function docRateErrorMessage(code) {
  return (typeof code === 'string' && Object.hasOwn(DOC_RATE_ERRORS, code) ? DOC_RATE_ERRORS[code] : null) ?? DOC_RATE_FALLBACK_ERROR
}

/** บันทึกสำเร็จ (หรือเคยให้ไปแล้ว = งานสำเร็จอยู่แล้ว) */
export function isDocRateSuccess(data) {
  return data?.ok === true || data?.code === 'already_rated'
}

// ───── ผลของ my_document_request_ratings ─────
/**
 * ทำให้ผล RPC เป็นรูปแบบที่ใช้ต่อได้เสมอ (ข้อมูลเสีย/ว่าง = ไม่มีรายการ ไม่โยน error)
 * @returns {{ items: Array<{id:string, rating:number|null, can_rate:boolean, finished_at:string|null}>, serverNow: string|null }}
 */
export function parseDocRatingData(data) {
  const items = []
  for (const raw of Array.isArray(data?.items) ? data.items : []) {
    if (!raw || typeof raw.id !== 'string' || !raw.id) continue
    const rating = Number.isInteger(raw.rating) && raw.rating >= 1 && raw.rating <= 5 ? raw.rating : null
    items.push({
      id: raw.id,
      rating,
      // ให้คะแนนแล้วไม่ใช่ "ประเมินได้" ต่อให้ฐานส่ง can_rate มาผิด
      can_rate: raw.can_rate === true && rating === null,
      finished_at: typeof raw.finished_at === 'string' && raw.finished_at ? raw.finished_at : null,
    })
  }
  return { items, serverNow: typeof data?.server_now === 'string' ? data.server_now : null }
}

/** Map id → { rating, can_rate } (ใบที่ไม่อยู่ใน Map = ไม่แสดงส่วนประเมินเลย) */
export function ratingMapOf(items) {
  const map = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    if (item && typeof item.id === 'string' && item.id) {
      map.set(item.id, { rating: item.rating ?? null, can_rate: item.can_rate === true })
    }
  }
  return map
}

function toMs(value) {
  if (value == null || value === '') return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * เลือกคำขอใบแรกที่ควรเด้งชวนประเมิน
 *   can_rate && finished_at อยู่ภายใน 30 วันนับจาก server_now && ไม่อยู่ใน doneIds
 *   finished_at = null (คำขอเก่าก่อนเริ่มเก็บเวลาปิด) = ไม่เด้ง · server_now อ่านไม่ได้ = ไม่เด้ง (ไม่เดาด้วยนาฬิกาเครื่อง)
 *   finished_at ในอนาคตเลย server_now = ถือว่าเพิ่งปิด (นาฬิกาสองฝั่งคลาดกันเล็กน้อย) ยังเด้งได้
 * @param {Array} items  ผลของ parseDocRatingData().items (เรียงใหม่→เก่าตามฐาน — คืนใบแรกที่ผ่าน)
 * @param {string|number|Date|null} serverNow
 * @param {Set<string>|string[]} [doneIds] ใบที่ปิดหน้าต่าง/ประเมินแล้วในเครื่องนี้
 * @returns {object|null}
 */
export function findDocToPrompt(items, serverNow, doneIds = []) {
  const nowMs = toMs(serverNow)
  if (nowMs === null) return null
  const done = doneIds instanceof Set ? doneIds : new Set(doneIds ?? [])
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.can_rate !== true || done.has(item.id)) continue
    const finishedMs = toMs(item.finished_at)
    if (finishedMs === null) continue
    if (nowMs - finishedMs <= DOC_RATE_PROMPT_WINDOW_DAYS * DAY_MS) return item
  }
  return null
}

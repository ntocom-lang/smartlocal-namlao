// ตัวเรียก API ของ "เรื่องเลยกำหนด / ⭐ ติดตาม / ส่งให้กองเร่งรัด" (ห้องผู้บริหาร E3-2)
// ฟังก์ชัน pure (ป้ายผลส่ง/จัดกลุ่ม/สิทธิ์ปุ่ม) อยู่ที่ execFollowNudgeHelpers.js เพื่อให้เทสต์ใน node ได้
//
// RPC ทุกตัวตรวจสิทธิ์ที่ฝั่งฐานข้อมูลเอง — หน้านี้ไม่ใช่ด่านสิทธิ์ · ไม่อ่านตาราง complaints/document_requests ตรงๆ (RLS ไม่ให้อ่าน + PDPA)
import { supabase, supabaseUrl, supabaseAnonKey } from './supabase'
import {
  normalizeFollows, normalizeOverdue,
} from './execFollowNudgeHelpers'

// ⚠️ ห้ามใช้ supabase.functions.invoke กับ exec-nudge-notify — client ใน supabase.js ครอบ fetch ด้วย timeout 25 วิ
// ส่ง Telegram หลายคนอาจนานกว่านั้น จึง fetch เองพร้อม AbortController 45 วิ (แบบเดียวกับ advisorApi.js)
const NUDGE_TIMEOUT_MS = 45000
const GENERIC_RPC_ERROR = 'ดำเนินการไม่สำเร็จ ลองใหม่อีกครั้ง'

// ข้อความไทยจากฐานข้อมูลที่เขียนไว้ให้แสดงตรงๆ: 42501 = ไม่มีสิทธิ์ · 22023 = เงื่อนไขไม่ผ่าน · P0002 = ไม่พบเรื่อง
// error อื่น (เครือข่าย/ระบบ) ไม่ส่งข้อความดิบของ Postgres ให้ผู้บริหารเห็น
const SHOWABLE_CODES = new Set(['42501', '22023', 'P0002'])

function rpcError(error) {
  const showable = SHOWABLE_CODES.has(error?.code) && error?.message
  const err = new Error(showable ? error.message : GENERIC_RPC_ERROR, { cause: error })
  err.code = error?.code ?? null
  return err
}

async function callRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw rpcError(error)
  return data
}

/** รายการเรื่องเลยกำหนด (+ ยอดรวมหมวดคุ้มครองผู้ร้อง) — exec_overdue_items */
export async function loadOverdue(municipalityId) {
  return normalizeOverdue(await callRpc('exec_overdue_items', { _municipality_id: municipalityId }))
}

/** เรื่องที่ฉันติดตามอยู่ — exec_my_follows */
export async function loadMyFollows(municipalityId) {
  return normalizeFollows(await callRpc('exec_my_follows', { _municipality_id: municipalityId }))
}

export async function followItem(municipalityId, kind, id) {
  return callRpc('exec_follow', { _municipality_id: municipalityId, _kind: kind, _id: id })
}

export async function unfollowItem(municipalityId, kind, id) {
  return callRpc('exec_unfollow', { _municipality_id: municipalityId, _kind: kind, _id: id })
}

/**
 * เรียก Edge Function ส่ง Telegram ตาม nudge_id — ไม่โยน error (ทุกทางเสียแปลงเป็น outcome)
 * 200 → sent (delivery/note จากเซิร์ฟเวอร์) · 409 → in_progress / not_pending (อีกแท็บส่งอยู่/ส่งไปแล้ว)
 * หมดเวลา → timeout (ไม่รู้ผลจริง) · อื่นๆ (404 ยังไม่ deploy, 401/500, เน็ตหลุด) → edge_unreachable
 * ทุกกรณีที่ไม่ใช่ sent แถวเร่งถูกจดแล้วที่ฐาน — กดซ้ำได้ตามเงื่อนไข exec_nudge (failed หรือค้างเกิน 10 นาที)
 */
export async function callNudgeNotify(nudgeId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { outcome: 'edge_unreachable', nudge_id: nudgeId }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NUDGE_TIMEOUT_MS)
  let res
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/exec-nudge-notify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nudge_id: nudgeId }),
      signal: controller.signal,
    })
  } catch (e) {
    return { outcome: e?.name === 'AbortError' ? 'timeout' : 'edge_unreachable', nudge_id: nudgeId }
  } finally {
    clearTimeout(timer)
  }

  let body = null
  try { body = await res.json() } catch { /* ไม่ใช่ JSON — ใช้ผลตามรหัสสถานะ */ }
  if (res.ok && body?.ok === true) {
    return { outcome: 'sent', nudge_id: nudgeId, delivery: body.delivery, delivered_count: body.delivered_count ?? 0, note: body.note ?? null }
  }
  if (res.status === 409 && body) {
    return {
      outcome: body.reason === 'in_progress' ? 'in_progress' : 'not_pending',
      nudge_id: nudgeId, delivery: body.delivery, note: body.note ?? null,
    }
  }
  return { outcome: 'edge_unreachable', nudge_id: nudgeId }
}

/**
 * ส่งให้กองเร่งรัด: exec_nudge (จดคำสั่ง) → เรียก Edge Function ต่อทันที → คืนผลรวมให้แสดงบนแถว
 * - RPC ไม่ผ่าน (ไม่มีสิทธิ์ 42501 / เงื่อนไขไม่ผ่าน 22023 …) → โยน Error พร้อมข้อความไทยของเซิร์ฟเวอร์
 * - already_today → ไม่เรียก Edge Function · คืน existing = ผู้เร่งเดิม (ตำแหน่ง ไม่ใช่ชื่อ) + เวลา + ผลส่ง
 * @returns {Promise<{ outcome: string, nudge_id?: string, delivery?: string, note?: string|null, existing?: object }>}
 */
export async function nudgeItem(municipalityId, kind, id) {
  const data = await callRpc('exec_nudge', { _municipality_id: municipalityId, _kind: kind, _id: id })
  if (data?.ok === true && typeof data.nudge_id === 'string') return callNudgeNotify(data.nudge_id)
  if (data?.ok === false && data.reason === 'already_today') return { outcome: 'already_today', existing: data.nudge ?? null }
  throw new Error(GENERIC_RPC_ERROR)
}

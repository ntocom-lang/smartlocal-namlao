// ใครเห็น/เปิด "ห้องผู้บริหาร" (หน้าเดี่ยว /executive) — ฟังก์ชันบริสุทธิ์ (JS ล้วน เทสต์ด้วย node ได้)
//
// นายก/รองนายก = role 'viewer' · ปลัด/รองปลัด = ตำแหน่งอยู่หมวด 'top_admin' (positions.category) "ไม่ว่า role เป็น officer หรือ admin"
// (seed ตำแหน่งมาตรฐานตั้งปลัดเป็น role admin — เจ้าของระบบสั่ง 2026-11-10) · admin/superadmin ที่ไม่ใช่ปลัดเปิดดูได้
// แต่ไม่ถูกพาไปห้องนี้เองหลังล็อกอิน
// ⚠️ นี่เป็นแค่ "ใครเห็นทางเข้า/ถูกพาไปไหน" ไม่ใช่ด่านสิทธิ์ข้อมูล — สิทธิ์ข้อมูลตัดสินที่ RPC/RLS ฝั่งฐานข้อมูลเสมอ

import { STAFF_PORTAL_ROLES } from './portalAccess.js'

export const EXEC_HOME_ADMIN_ROLES = Object.freeze(['admin', 'superadmin'])

/** ตำแหน่งหมวดนี้ = ปลัด/รองปลัด (ค่า positions.category) */
export const EXEC_POSITION_CATEGORY = 'top_admin'

/**
 * true = เป็นผู้บริหารของห้องนี้: นายก/รองนายก (viewer) หรือ ปลัด/รองปลัด (ตำแหน่งหมวด top_admin ทุก role ในกลุ่มเจ้าหน้าที่)
 * ใช้ตัดสินว่า "หลังล็อกอินพาไปห้องผู้บริหาร" และ "มีทางเข้าห้องไหม"
 */
export function isExecutiveHomeDefault({ role, positionCategory } = {}) {
  return role === 'viewer'
    || (positionCategory === EXEC_POSITION_CATEGORY && STAFF_PORTAL_ROLES.includes(role))
}

/** true = เปิดหน้า /executive ได้ (ผู้บริหารตามข้างบน + admin/superadmin ที่เปิดดูได้) */
export function canOpenExecutiveHome({ role, positionCategory } = {}) {
  return isExecutiveHomeDefault({ role, positionCategory }) || EXEC_HOME_ADMIN_ROLES.includes(role)
}

/**
 * role ที่ต้องอ่านตำแหน่งก่อนรู้ว่าเป็นปลัดหรือไม่ = ทุก role ในกลุ่มเจ้าหน้าที่ ยกเว้น viewer (เป็นผู้บริหารอยู่แล้ว)
 * ต้องตรงกับ isExecutiveHomeDefault ข้างบน (top_admin ทุก role ใน STAFF_PORTAL_ROLES) ไม่งั้นปลัดที่แอดมินตั้ง role
 * เป็น staff/council/technician จะ "เป็นผู้บริหารตามกฎ" แต่ไม่มีใครอ่านตำแหน่งให้ = ไม่มีทางเข้าห้อง
 */
export const EXEC_POSITION_LOOKUP_ROLES = Object.freeze(STAFF_PORTAL_ROLES.filter((r) => r !== 'viewer'))

// ── หลังล็อกอินพาไปไหน ─────────────────────────────────────────────────────

/**
 * คีย์ sessionStorage "เพิ่งกดล็อกอิน Google/LINE จากหน้า /auth ที่จะกลับหน้าแรก" (ค่าเป็นเวลา ms ที่กด)
 * App.jsx อ่านตอน SIGNED_IN แล้วพาผู้บริหารไป /executive — แยกจาก 'oauth_from' โดยตั้งใจ:
 * auth-js ยิง SIGNED_IN ซ้ำทุกครั้งที่กลับมาที่แท็บ คีย์ที่ค้าง (กด LINE แล้วยกเลิก) จึงต้องหมดอายุเอง
 * และต้องไม่ไปเปลี่ยนความหมายของ oauth_from เดิม
 */
export const EXEC_OAUTH_CHECK_KEY = 'exec_landing_check'
export const EXEC_OAUTH_CHECK_TTL_MS = 10 * 60 * 1000

/** true = คีย์ยังไม่หมดอายุ (กดล็อกอิน OAuth ไม่เกิน TTL ที่แล้ว) — ค่าเสีย/อนาคต = false */
export function isFreshExecOauthCheck(value, now = Date.now()) {
  const at = Number(value)
  return Number.isFinite(at) && at > 0 && at <= now && now - at <= EXEC_OAUTH_CHECK_TTL_MS
}

/**
 * ปลายทางหลังล็อกอิน — ผู้บริหาร → '/executive' · อื่นๆ/ผิดพลาด/ช้า → fallback (ค่าเริ่มต้น '/admin')
 *
 * - เรียกเฉพาะตอนที่ผู้ใช้กำลังจะไป "ปลายทางเริ่มต้น" เท่านั้น — ผู้ใช้ที่ถูกเด้งมาจากหน้าเฉพาะ ผู้เรียกต้องพากลับหน้านั้นเอง
 * - อ่าน role + ตำแหน่งของตัวเองหลัง sign-in (session อยู่ในเครื่องแล้ว ไม่ยิงเครือข่ายเพื่อหา uid)
 * - ช้าเกิน timeoutMs = fallback ไม่รอ (ห้ามให้การล็อกอินค้างเพราะอ่านตำแหน่งช้า)
 * - ⚠️ ห้าม await ใน callback ของ onAuthStateChange (เรียก auth.getSession() = รอล็อกเดียวกัน ค้าง)
 * - client ส่งเข้ามาเอง (supabase) เพื่อให้ไฟล์นี้ไม่ import supabase — เทสต์ด้วย node ได้
 *
 * @param {{ client: object, timeoutMs?: number, fallback?: string }} opts
 * @returns {Promise<string>}
 */
export async function executiveLandingPath({ client, timeoutMs = 3000, fallback = '/admin' } = {}) {
  let timer
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) })
  try {
    const who = await Promise.race([readMyExecutiveAccess(client), timeout])
    return who && isExecutiveHomeDefault(who) ? '/executive' : fallback
  } catch {
    return fallback
  } finally {
    clearTimeout(timer)
  }
}

/** { role, positionCategory } ของผู้ล็อกอินอยู่ — null เมื่ออ่านไม่ได้ */
async function readMyExecutiveAccess(client) {
  const { data: sessionData } = await client.auth.getSession()
  const uid = sessionData?.session?.user?.id
  if (!uid) return null
  const { data: profile, error } = await client.from('profiles').select('role, position_id').eq('id', uid).maybeSingle()
  if (error || !profile) return null
  if (!EXEC_POSITION_LOOKUP_ROLES.includes(profile.role) || !profile.position_id) {
    return { role: profile.role, positionCategory: null }
  }
  const { data: position, error: positionError } = await client.from('positions').select('category').eq('id', profile.position_id).maybeSingle()
  return { role: profile.role, positionCategory: positionError ? null : (position?.category ?? null) }
}

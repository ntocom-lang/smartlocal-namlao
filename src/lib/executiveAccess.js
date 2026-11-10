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

/** role ที่ต้องอ่านตำแหน่งก่อนรู้ว่าเป็นปลัดหรือไม่ — viewer เป็นผู้บริหารอยู่แล้ว ส่วน role อื่นไม่มีผลกับห้องนี้ */
export const EXEC_POSITION_LOOKUP_ROLES = Object.freeze(['officer', 'admin'])

// ── หลังล็อกอินพาไปไหน ─────────────────────────────────────────────────────

/**
 * ปลายทางหลังล็อกอินฝั่งเจ้าหน้าที่ — ผู้บริหาร → '/executive' · อื่นๆ/ผิดพลาด/ช้า → '/admin' เหมือนเดิม
 *
 * - อ่าน role + ตำแหน่งของตัวเองหลัง sign-in (session อยู่ในเครื่องแล้ว ไม่ยิงเครือข่ายเพื่อหา uid)
 * - มี `from` ที่ไม่ใช่ปลายทางเริ่มต้น ('/admin') = ผู้ใช้ถูกเด้งมาจากหน้าเฉพาะ → คงพฤติกรรมเดิม ไม่แทรกแซง
 * - ช้าเกิน timeoutMs = ไป '/admin' ไม่รอ (ห้ามให้การล็อกอินค้างเพราะอ่านตำแหน่งช้า)
 * - client ส่งเข้ามาเอง (supabase) เพื่อให้ไฟล์นี้ไม่ import supabase — เทสต์ด้วย node ได้
 *
 * @param {{ client: object, from?: string|null, timeoutMs?: number, fallback?: string }} opts
 * @returns {Promise<string>}
 */
export async function executiveLandingPath({ client, from = null, timeoutMs = 3000, fallback = '/admin' } = {}) {
  if (from && from !== fallback) return fallback
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

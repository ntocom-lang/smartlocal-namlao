import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { EXEC_HOME_ADMIN_ROLES, EXEC_POSITION_LOOKUP_ROLES, canOpenExecutiveHome } from '../lib/executiveAccess'
import { useMyPositionCategory } from './useMyPositionCategory'

// "บัญชีที่ล็อกอินอยู่เปิดห้องผู้บริหารได้ไหม" — ใช้ตัดสินว่าจะแสดงทางเข้า (ชิปบนหัวจอ, เมนูซ้าย/ลิ้นชักของ /staff)
//
// role มาจาก AuthContext (มีอยู่แล้ว ไม่ยิงเพิ่ม) · admin/superadmin/viewer เปิดได้จาก role เลย ไม่ต้องอ่านตำแหน่ง
// role อื่นในกลุ่มเจ้าหน้าที่ (EXEC_POSITION_LOOKUP_ROLES) ต้องรู้ว่าตำแหน่งเป็นปลัด (top_admin) หรือไม่
// - ผู้เรียกที่มีโปรไฟล์เต็มในมือ (StaffDashboard) ส่ง profile มา = ใช้ position_id จากนั้น ไม่ query profiles
// - ไม่มี (แถบสลับมุมมองบนหัวจอ) = อ่าน position_id ของตัวเอง แคชต่อ uid + รวมคำขอที่กำลังวิ่ง (inflight)
//   หลายจุดเรียกพร้อมกันตอนเปิดหน้า = ยิงครั้งเดียว
// ⚠️ แคชอยู่จนรีเฟรชหน้า: แอดมินแต่งตั้ง/ถอดปลัดระหว่างที่หน้าเปิดค้าง ทางเข้าจะเปลี่ยนตอนรีเฟรช
//   (ด่านจริงอยู่ที่หน้า /executive ซึ่งอ่านโปรไฟล์ใหม่ทุกครั้ง และสิทธิ์ข้อมูลอยู่ที่ RPC/RLS)
// ผิดพลาด = ไม่แสดงทางเข้า (ไม่ใช่หน้า error) — ทางเข้าหลักของผู้บริหารคือหลังล็อกอิน ซึ่งมีทางลองใหม่ของมันเอง
const positionByUser = new Map() // uid → position_id|null
const inflight = new Map() // uid → Promise<position_id|null|undefined> (undefined = ถามไม่สำเร็จ)

function fetchMyPositionId(uid) {
  let request = inflight.get(uid)
  if (!request) {
    request = Promise.resolve()
      .then(() => supabase.from('profiles').select('position_id').eq('id', uid).maybeSingle())
      .then(({ data, error }) => {
        if (error) return undefined
        const positionId = data?.position_id ?? null
        positionByUser.set(uid, positionId)
        return positionId
      })
      .catch(() => undefined)
      .finally(() => { inflight.delete(uid) })
    inflight.set(uid, request)
  }
  return request
}

/**
 * @param {{ position_id?: string|null }|null} [profile]  โปรไฟล์ของตัวเองที่โหลดแล้ว (ถ้ามี) — ประหยัด query
 * @returns {{ ready: boolean, canOpen: boolean }}
 */
export function useExecutiveAccess(profile = null) {
  const { session, role } = useAuth()
  const uid = session?.user?.id ?? null
  const needsPosition = Boolean(uid) && EXEC_POSITION_LOOKUP_ROLES.includes(role) && !EXEC_HOME_ADMIN_ROLES.includes(role)
  const hasProfilePosition = Boolean(profile) && Object.prototype.hasOwnProperty.call(profile, 'position_id')
  const [fetched, setFetched] = useState({ uid: null, positionId: undefined })

  useEffect(() => {
    if (!needsPosition || hasProfilePosition || positionByUser.has(uid)) return undefined
    let cancelled = false
    fetchMyPositionId(uid).then((positionId) => {
      if (!cancelled) setFetched({ uid, positionId: positionId === undefined ? null : positionId })
    })
    return () => { cancelled = true }
  }, [needsPosition, hasProfilePosition, uid])

  // undefined = ยังไม่รู้ตำแหน่ง · null = รู้แล้วว่าไม่มี (หรือถามไม่สำเร็จ = ไม่แสดงทางเข้า)
  const positionId = !needsPosition ? null
    : hasProfilePosition ? (profile.position_id ?? null)
    : positionByUser.has(uid) ? positionByUser.get(uid)
    : fetched.uid === uid ? fetched.positionId
    : undefined
  const { category, ready: categoryReady } = useMyPositionCategory(
    positionId === undefined || !role ? null : { role, position_id: positionId },
  )
  const ready = Boolean(role) && (!needsPosition || (positionId !== undefined && categoryReady))
  return { ready, canOpen: ready && canOpenExecutiveHome({ role, positionCategory: category }) }
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { canOpenExecutiveHome, isExecutiveHomeDefault } from '../lib/executiveAccess'
import { useMyPositionCategory } from './useMyPositionCategory'

// "บัญชีที่ล็อกอินอยู่เปิดห้องผู้บริหารได้ไหม" สำหรับที่ที่ไม่มีโปรไฟล์เต็มในมือ (เช่น แถบสลับมุมมองบนหัวจอ)
//
// role มาจาก AuthContext (มีอยู่แล้ว ไม่ยิงเพิ่ม) · ต้องอ่านตำแหน่งเฉพาะ role 'officer' (ปลัดที่ไม่ได้เป็น admin)
// — viewer/admin/superadmin ตัดสินจาก role ได้เลย · role อื่นไม่มีผลกับห้องนี้
// position_id ของตัวเองแคชระดับโมดูลต่อ uid (แถบนี้ถูกวาดซ้ำทุกครั้งที่เปลี่ยนหน้า) ผิดพลาด = ไม่เปิดทางเข้า ไม่ใช่หน้า error
const positionByUser = new Map() // uid → position_id|null

export function useExecutiveAccess() {
  const { session, role } = useAuth()
  const uid = session?.user?.id ?? null
  const needsPosition = Boolean(uid) && role === 'officer'
  const [fetched, setFetched] = useState({ uid: null, positionId: null })

  useEffect(() => {
    if (!needsPosition || positionByUser.has(uid)) return undefined
    let cancelled = false
    Promise.resolve()
      .then(() => supabase.from('profiles').select('position_id').eq('id', uid).maybeSingle())
      .then(({ data, error }) => {
        const positionId = error ? null : (data?.position_id ?? null)
        if (!error) positionByUser.set(uid, positionId)
        if (!cancelled) setFetched({ uid, positionId })
      })
      .catch(() => { if (!cancelled) setFetched({ uid, positionId: null }) })
    return () => { cancelled = true }
  }, [needsPosition, uid])

  // undefined = ยังไม่รู้ตำแหน่ง · null = รู้แล้วว่าไม่มี
  const positionId = !needsPosition ? null
    : positionByUser.has(uid) ? positionByUser.get(uid)
    : fetched.uid === uid ? fetched.positionId
    : undefined
  const { category, ready: categoryReady } = useMyPositionCategory(
    positionId === undefined || !role ? null : { role, position_id: positionId },
  )
  const ready = Boolean(role) && (!needsPosition || (positionId !== undefined && categoryReady))
  const who = { role, positionCategory: category }
  return { ready, canOpen: ready && canOpenExecutiveHome(who), isExecutive: ready && isExecutiveHomeDefault(who) }
}

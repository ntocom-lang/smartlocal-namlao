import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * หมวดของตำแหน่งตัวเอง (positions.category เช่น 'top_admin' = ปลัด) — ใช้ตัดสินว่าหน้าแรกเป็นห้องผู้บริหารหรือไม่
 *
 * ถามเฉพาะ role 'officer' ที่มี position_id: นายก/รองนายก (viewer) เป็นห้องผู้บริหารอยู่แล้วโดยไม่ต้องดูตำแหน่ง
 * และบทบาทอื่นไม่ใช้ค่านี้ จึงไม่ยิง query เพิ่มให้เปล่าๆ
 * ผิดพลาด/ไม่มีตำแหน่ง = category เป็น null → ตกไปหน้าเจ้าหน้าที่ปกติ (ไม่ใช่หน้า error)
 *
 * @returns {{ category: string|null, ready: boolean }}
 *   ready = false ระหว่างรอผล (หน้าแรกต้องรอ ไม่งั้นปลัดเห็นหน้าเจ้าหน้าที่แวบหนึ่งแล้วสลับ)
 */
export function useMyPositionCategory(profile) {
  const role = profile?.role ?? null
  const positionId = role === 'officer' ? profile?.position_id ?? null : null
  const [state, setState] = useState({ positionId: null, category: null })

  useEffect(() => {
    if (!positionId) return undefined
    let cancelled = false
    Promise.resolve()
      .then(() => supabase.from('positions').select('category').eq('id', positionId).maybeSingle())
      .then(({ data, error }) => {
        if (cancelled) return
        setState({ positionId, category: error ? null : (data?.category ?? null) })
      })
      .catch(() => { if (!cancelled) setState({ positionId, category: null }) })
    return () => { cancelled = true }
  }, [positionId])

  if (!positionId) return { category: null, ready: Boolean(profile) }
  // ผลของตำแหน่งเก่า (เปลี่ยนบัญชีระหว่างหน้าเปิดอยู่) ห้ามใช้กับตำแหน่งใหม่
  if (state.positionId !== positionId) return { category: null, ready: false }
  return { category: state.category, ready: true }
}

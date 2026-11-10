import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { EXEC_POSITION_LOOKUP_ROLES } from '../lib/executiveAccess'

// แคชระดับโมดูลต่อ positionId — hook นี้ถูกเรียกจากหลายที่พร้อมกัน (หน้าห้องผู้บริหาร + แถบสลับมุมมองบนหัวจอ)
// ตำแหน่งเดียวกันถามฐานข้อมูลครั้งเดียว · เก็บเฉพาะผลที่ถามสำเร็จ (ผิดพลาดไม่แคช เปิดหน้าใหม่แล้วถามใหม่ได้)
// positions.category เปลี่ยนได้เฉพาะตอนแอดมินแก้แบบตำแหน่ง (หายาก) — แคชอยู่ในหน่วยความจำหน้าเว็บ รีเฟรชก็ล้าง
const categoryCache = new Map() // positionId → category|null
const inflight = new Map() // positionId → Promise<{ category: string|null }>

function fetchCategory(positionId) {
  let request = inflight.get(positionId)
  if (!request) {
    request = Promise.resolve()
      .then(() => supabase.from('positions').select('category').eq('id', positionId).maybeSingle())
      .then(({ data, error }) => {
        if (error) return { category: null }
        const category = data?.category ?? null
        categoryCache.set(positionId, category)
        return { category }
      })
      .catch(() => ({ category: null }))
      .finally(() => { inflight.delete(positionId) })
    inflight.set(positionId, request)
  }
  return request
}

/**
 * หมวดของตำแหน่งตัวเอง (positions.category เช่น 'top_admin' = ปลัด) — ใช้ตัดสินว่าเปิดห้องผู้บริหารได้ไหม
 *
 * ถามเฉพาะ role ใน EXEC_POSITION_LOOKUP_ROLES (officer/admin) ที่มี position_id: นายก/รองนายก (viewer) เป็นผู้บริหารอยู่แล้ว
 * โดยไม่ต้องดูตำแหน่ง และ role อื่นไม่ใช้ค่านี้ จึงไม่ยิง query เพิ่มให้เปล่าๆ
 * ผิดพลาด/ไม่มีตำแหน่ง = category เป็น null → ไม่ถือเป็นผู้บริหาร (ไม่ใช่หน้า error)
 *
 * @returns {{ category: string|null, ready: boolean }}
 *   ready = false ระหว่างรอผล (หน้าที่ตัดสินจากค่านี้ต้องรอ ไม่งั้นเด้งผิดหน้าก่อนรู้ผล)
 */
export function useMyPositionCategory(profile) {
  const role = profile?.role ?? null
  const positionId = EXEC_POSITION_LOOKUP_ROLES.includes(role) ? profile?.position_id ?? null : null
  const [fetched, setFetched] = useState({ positionId: null, category: null })

  useEffect(() => {
    if (!positionId || categoryCache.has(positionId)) return undefined
    let cancelled = false
    fetchCategory(positionId).then(({ category }) => {
      if (!cancelled) setFetched({ positionId, category })
    })
    return () => { cancelled = true }
  }, [positionId])

  if (!positionId) return { category: null, ready: Boolean(profile) }
  if (categoryCache.has(positionId)) return { category: categoryCache.get(positionId), ready: true }
  // ถามผิดพลาด (ไม่เข้าแคช) = รู้ผลแล้วว่า "ไม่รู้" → category null ไม่ถือเป็นผู้บริหาร
  // ผลของตำแหน่งเก่า (เปลี่ยนบัญชีระหว่างหน้าเปิดอยู่) ห้ามใช้กับตำแหน่งใหม่ — เทียบ positionId ก่อนเสมอ
  if (fetched.positionId === positionId) return { category: fetched.category, ready: true }
  return { category: null, ready: false }
}

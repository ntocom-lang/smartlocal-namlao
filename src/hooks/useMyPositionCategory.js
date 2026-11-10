import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { EXEC_POSITION_LOOKUP_ROLES } from '../lib/executiveAccess'

// แคชระดับโมดูลต่อ positionId — hook นี้ถูกเรียกจากหลายที่พร้อมกัน (หน้าห้องผู้บริหาร + แถบสลับมุมมองบนหัวจอ + เมนูซ้าย)
// ตำแหน่งเดียวกันถามฐานข้อมูลครั้งเดียว (รวมคำขอที่กำลังวิ่งด้วย inflight) · เก็บเฉพาะผลที่ถามสำเร็จ
// ผิดพลาดไม่แคช: ผู้เรียกได้ error=true + retry() ไปขึ้นปุ่ม "ลองใหม่" — ห้ามตีความว่า "ไม่ใช่ผู้บริหาร"
// (เน็ตสะดุดตอนเปิดห้อง = ปลัดถูกเด้งออกเงียบๆ เข้าใจว่าห้องหาย)
// positions.category เปลี่ยนได้เฉพาะตอนแอดมินแก้แบบตำแหน่ง (หายาก) — แคชอยู่ในหน่วยความจำหน้าเว็บ รีเฟรชก็ล้าง
const categoryCache = new Map() // positionId → category|null
const inflight = new Map() // positionId → Promise<{ category: string|null, error: boolean }>

function fetchCategory(positionId) {
  let request = inflight.get(positionId)
  if (!request) {
    request = Promise.resolve()
      .then(() => supabase.from('positions').select('category').eq('id', positionId).maybeSingle())
      .then(({ data, error }) => {
        if (error) return { category: null, error: true }
        const category = data?.category ?? null
        categoryCache.set(positionId, category)
        return { category, error: false }
      })
      .catch(() => ({ category: null, error: true }))
      .finally(() => { inflight.delete(positionId) })
    inflight.set(positionId, request)
  }
  return request
}

/**
 * หมวดของตำแหน่งตัวเอง (positions.category เช่น 'top_admin' = ปลัด) — ใช้ตัดสินว่าเปิดห้องผู้บริหารได้ไหม
 *
 * ถามเฉพาะ role ใน EXEC_POSITION_LOOKUP_ROLES (เจ้าหน้าที่ทุก role ยกเว้น viewer) ที่มี position_id
 * ไม่มีตำแหน่ง = category null (รู้ผลแล้ว ไม่ใช่ปลัด)
 *
 * @returns {{ category: string|null, ready: boolean, error: boolean, retry: () => void }}
 *   ready = false ระหว่างรอผล หรือถามไม่สำเร็จ (หน้าที่ตัดสินจากค่านี้ต้องรอ ไม่งั้นเด้งผิดหน้าก่อนรู้ผล)
 *   error = true ถามไม่สำเร็จ (ยังไม่รู้ผล) — ผู้เรียกขึ้นปุ่มลองใหม่ ห้ามตัดสินจาก category ตอนนี้
 */
export function useMyPositionCategory(profile) {
  const role = profile?.role ?? null
  const positionId = EXEC_POSITION_LOOKUP_ROLES.includes(role) ? profile?.position_id ?? null : null
  const [fetched, setFetched] = useState({ positionId: null, category: null, error: false })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!positionId || categoryCache.has(positionId)) return undefined
    let cancelled = false
    fetchCategory(positionId).then(({ category, error }) => {
      if (!cancelled) setFetched({ positionId, category, error })
    })
    return () => { cancelled = true }
  }, [positionId, tick])

  const retry = useCallback(() => {
    setFetched({ positionId: null, category: null, error: false })
    setTick((t) => t + 1)
  }, [])

  if (!positionId) return { category: null, ready: Boolean(profile), error: false, retry }
  if (categoryCache.has(positionId)) return { category: categoryCache.get(positionId), ready: true, error: false, retry }
  // ผลของตำแหน่งเก่า (เปลี่ยนบัญชีระหว่างหน้าเปิดอยู่) ห้ามใช้กับตำแหน่งใหม่ — เทียบ positionId ก่อนเสมอ
  if (fetched.positionId === positionId) return { category: fetched.category, ready: !fetched.error, error: fetched.error, retry }
  return { category: null, ready: false, error: false, retry }
}

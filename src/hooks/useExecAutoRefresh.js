import { useEffect, useRef } from 'react'
import { EXEC_SIMPLE_REFRESH_MS, canAutoRefresh, shouldRefreshOnReturn } from '../lib/execSimpleView'

// อัปเดตข้อมูลของห้องผู้บริหารแบบเรียบเองทุก 5 นาที (หน้าเปิดทิ้งไว้ทั้งวัน) — เฉพาะตอนที่
//   (ก) แท็บมองเห็นอยู่ (document.visibilityState === 'visible') และ
//   (ข) เวลาไทยอยู่ในช่วง 06:00–20:00 น.
// กลับมาที่แท็บแล้วข้อมูลเก่ากว่า 5 นาที = ดึงทันที (ไม่รอรอบ)
// ทำไมต้องคุม: Supabase แผนฟรีเคยเกินโควตา Egress (ต.ค. 2569) แท็บที่ซ่อน/จอดับ/นอกเวลาราชการต้องไม่ยิงอะไรเลย
// refresh เป็นฟังก์ชันดึงแบบ "เงียบ" ของแต่ละฮุก (ไม่ตั้ง status 'loading' จอไม่กระพริบ) — ผู้เรียกส่งตัวเดียวที่ดึงทุกคีย์ของหน้า
// now เป็นพารามิเตอร์เพื่อให้เทสต์/ผู้เรียกฉีดเวลาได้ (ค่าเริ่มต้น = เวลาเครื่อง ซึ่ง isRefreshWindow แปลงเป็นเวลาไทยเอง)

/**
 * @param {{ refresh: () => void, enabled?: boolean, intervalMs?: number }} opts
 */
export default function useExecAutoRefresh({ refresh, enabled = true, intervalMs = EXEC_SIMPLE_REFRESH_MS }) {
  // เก็บ refresh ล่าสุดไว้ใน ref (ผู้เรียกส่งฟังก์ชันใหม่ทุก render) — ไม่ให้ interval ถูกสร้างใหม่ทุกรอบ
  const refreshRef = useRef(refresh)
  const lastAtRef = useRef(0)
  useEffect(() => { refreshRef.current = refresh }, [refresh])

  useEffect(() => {
    if (!enabled) return undefined
    lastAtRef.current = Date.now() // ข้อมูลชุดแรกเพิ่งโหลดตอนเปิดหน้า
    const fire = () => {
      lastAtRef.current = Date.now()
      refreshRef.current?.()
    }
    const onTick = () => {
      if (canAutoRefresh({ now: new Date(), visible: document.visibilityState === 'visible' })) fire()
    }
    const onVisible = () => {
      if (shouldRefreshOnReturn({ now: new Date(), visible: document.visibilityState === 'visible', lastAt: lastAtRef.current, intervalMs })) fire()
    }
    const timer = window.setInterval(onTick, intervalMs)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, intervalMs])
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useVisibleRefresh } from '../../hooks/useVisibleRefresh'
import { PUBLIC_REFRESH_MS, clockOffsetMs, publicView } from '../../lib/waterAnnouncements'

/**
 * ประกาศน้ำ-ฝนของ อปท. ที่ผู้มีสิทธิ์ยืนยันแล้ว (ฝั่งประชาชน ไม่ต้องล็อกอิน)
 *
 * ถามฐานข้อมูลตอนเปิดหน้า + ทุก 5 นาทีตอนแท็บแสดงอยู่ (ค่าเท่ากับแถบแจ้งเตือนดิบเดิม) — ผลที่ไม่มีประกาศเป็น null ก้อนเล็กมาก
 * ครบอายุ = หายทันทีตามนาฬิกาเซิร์ฟเวอร์ (server_now) ไม่ต้องรอรอบถามถัดไป และไม่พึ่งนาฬิกาเครื่องผู้ใช้ที่อาจเพี้ยน
 * โหลดไม่สำเร็จ = คงค่าเดิมไว้ ไม่แสดง error (หน้าแรกไม่ควรมีข้อความผิดพลาดของส่วนเสริม)
 *
 * @returns {{ view: null | { id, issuer, lines, publishedText, expiresText, remaining } }}
 */
export function useWaterAnnouncement({ tenantId, enabled = true }) {
  const active = Boolean(tenantId) && enabled
  const [state, setState] = useState({ tenantId: null, data: null, offset: 0 })
  const [deviceNow, setDeviceNow] = useState(Date.now)

  // นาฬิกานับถอยหลังเดินต่อแม้ request ค้าง/ออฟไลน์ — ประกาศที่ครบอายุต้องหายเอง
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setDeviceNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [active])

  const load = useCallback(() => {
    if (!active) return
    supabase.rpc('get_public_water_announcement', { _municipality_id: tenantId })
      .then(({ data, error }) => {
        if (error) return
        setState({ tenantId, data: data ?? null, offset: clockOffsetMs(data?.server_now, Date.now()) })
        setDeviceNow(Date.now())
      })
      .catch(() => {})
  }, [active, tenantId])

  // รอบแรกครั้งเดียวต่อ อปท. (TenantContext เปลี่ยนสถานะหลายจังหวะ + StrictMode เรียก effect ซ้ำตอน dev)
  const loadedFor = useRef(null)
  useEffect(() => {
    if (!active || loadedFor.current === tenantId) return
    loadedFor.current = tenantId
    load()
  }, [active, tenantId, load])
  useVisibleRefresh(load, { intervalMs: PUBLIC_REFRESH_MS, enabled: active })

  if (!active || state.tenantId !== tenantId) return { view: null }
  return { view: publicView(state.data, deviceNow + state.offset) }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useVisibleRefresh } from '../../hooks/useVisibleRefresh'
import { fetchTmdForecast } from '../../lib/tmdForecast'

// พยากรณ์เปลี่ยนทุก 3 ชม. (tmd-sync) — ถามซ้ำถี่กว่านี้ไม่ได้ของใหม่
const REFRESH_MS = 15 * 60 * 1000

/**
 * โหลดพยากรณ์กรมอุตุนิยมวิทยาของ อปท. (RPC get_public_tmd_forecast) — หน้าเรียกครั้งเดียว แล้วส่งต่อให้ทั้ง
 * การ์ดพยากรณ์ 7 วันและป้ายสรุปใต้หัวหน้า (ไม่ยิง RPC ซ้ำสองที่)
 * คืน forecast ของ อปท. ปัจจุบันเท่านั้น (สลับ อปท. แล้วไม่ค้างของเดิม) · ไม่มีข้อมูล/ยังโหลดไม่เสร็จ = null
 */
export function useTmdForecast(tenantId) {
  const [state, setState] = useState({ tenantId: null, forecast: null })

  const load = useCallback(() => {
    if (!tenantId) return
    fetchTmdForecast(supabase, tenantId).then(({ forecast, error }) => {
      // โหลดพลาดรอบนี้แต่เคยได้ของ อปท. เดิมแล้ว = คงของเดิมไว้ (ป้ายเหลืองเตือนความเก่าเอง) · ไม่มีข้อมูลจริง = เคลียร์
      setState(prev => (error && prev.tenantId === tenantId ? prev : { tenantId, forecast }))
    })
  }, [tenantId])

  // รอบแรกครั้งเดียวต่อ อปท. (StrictMode เรียก effect ซ้ำตอน dev)
  const loadedFor = useRef(null)
  useEffect(() => {
    if (!tenantId || loadedFor.current === tenantId) return
    loadedFor.current = tenantId
    load()
  }, [tenantId, load])
  useVisibleRefresh(load, { intervalMs: REFRESH_MS, enabled: Boolean(tenantId) })

  return state.tenantId === tenantId ? state.forecast : null
}

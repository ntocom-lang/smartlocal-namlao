import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TREND_WINDOW_DAYS } from '../../lib/waterSystem/model'

// ประวัติค่าอ่าง 30 วันของ อปท. (get_public_dam_history · PR 5.1) — เรียกครั้งเดียวต่อการเปิดหน้า (อ่างส่งรายวัน ไม่ต้องถามถี่)
// โหลดไม่สำเร็จ = state 'error' → หน้าซ่อมเฉพาะกราฟ ส่วนอื่นอยู่ครบ ไม่แสดงข้อความ error ดิบ (ดีไซน์ D14)
export function useDamHistory(tenantId, enabled = true) {
  const [state, setState] = useState({ status: 'idle', dams: [] })

  useEffect(() => {
    if (!tenantId || !enabled) return undefined
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- เริ่มโหลดใหม่เมื่อเปลี่ยน อปท.
    setState({ status: 'loading', dams: [] })
    Promise.resolve(supabase.rpc('get_public_dam_history', { _municipality_id: tenantId, _days: TREND_WINDOW_DAYS }))
      .then(({ data, error }) => {
        if (!alive) return
        if (error || !data || !Array.isArray(data.dams)) setState({ status: 'error', dams: [] })
        else setState({ status: 'ok', dams: data.dams })
      })
      .catch(() => { if (alive) setState({ status: 'error', dams: [] }) })
    return () => { alive = false }
  }, [tenantId, enabled])

  return state
}

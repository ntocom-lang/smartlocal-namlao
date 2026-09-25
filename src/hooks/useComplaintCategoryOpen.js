import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { canSubmitCategory } from '../lib/serviceAudience'

/**
 * ผู้ใช้คนนี้ยื่นคำร้องหมวดนี้ได้ไหม — สำหรับปุ่มลัดที่ฝังรหัสหมวดไว้ในโค้ด
 * (ซ่อมน้ำประปาในกล่องบริการประปา, "รถไม่มาเก็บ" ในหน้าตารางเก็บขยะ)
 *
 * ปุ่มพวกนี้ไม่ได้ดึงรายการหมวดมาเองเหมือนหน้าเลือกหมวด จึงไม่รู้ว่าแอดมินตั้งหมวดนั้นเป็น
 * "เฉพาะผู้มีตำแหน่ง" ไว้ (complaint_categories.submit_audience) ถ้าไม่ถาม ประชาชนจะเห็นปุ่ม
 * กดแล้วเจอแถบ "ยังไม่เปิดให้ประชาชนแจ้ง" ในฟอร์ม — ไม่ใช่ทางตันแต่ขัดกับที่ตั้งไว้ว่าไม่ให้เห็น
 *
 * คืน true ระหว่างโหลดหรืออ่านไม่สำเร็จ — หมวดส่วนใหญ่เปิดให้ทุกคน ถ้าซ่อนไว้ก่อนปุ่มจะกะพริบขึ้นทีหลัง
 * ทุกครั้ง ส่วนหมวดที่จำกัดไว้ยังมีฟอร์มกับด่านฐานข้อมูล (submit_citizen_complaint_v4) กันซ้ำอยู่
 * @param {string} value รหัสหมวด เช่น 'trash', 'water_repair'
 */
export default function useComplaintCategoryOpen(value) {
  const { tenant } = useTenant()
  const { role } = useAuth()
  const [category, setCategory] = useState(null)

  useEffect(() => {
    if (!tenant?.id || !value) return undefined
    let cancelled = false
    // supabase builder มีแค่ .then() — ใช้ onRejected ตัวที่สองแทน .catch()
    supabase.from('complaint_categories').select('submit_audience')
      .eq('municipality_id', tenant.id).eq('value', value).maybeSingle()
      .then(({ data }) => { if (!cancelled) setCategory(data ?? null) }, () => {})
    return () => { cancelled = true }
  }, [tenant?.id, value])

  return canSubmitCategory(category, role)
}

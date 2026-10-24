import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LifeBuoy, Phone } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { useAuth } from '../../contexts/AuthContext'
import { moduleHiddenCategoryValues } from '../../lib/complaintCategoryModules'
import { WATER_HELP_CATEGORIES, WATER_HELP_EMERGENCY_PATH, openWaterHelpCategories } from '../../lib/waterHelp'

// แถว "แจ้งเหตุ/ขอความช่วยเหลือเรื่องน้ำ" ท้ายแท็บผังน้ำตำบล (เจ้าของระบบสั่ง 2569-10-24: จะได้ครบ จบ เรื่องน้ำ ไม่มีคำถามตามมา)
// อ่านอย่างเดียว ไม่มีช่องกรอก — แค่ลิงก์: สายด่วนฉุกเฉิน (ขึ้นเสมอ) + ปุ่มหมวดคำร้องที่ อปท. นี้เปิดให้ผู้ใช้คนนี้ยื่นได้จริง (ขึ้นเอง ไม่ต้องตั้งค่า)
// หมวดอ่านจาก complaint_categories ของ อปท. (select สาธารณะแบบเดียวกับปุ่มหมวดหน้าแรก) · โหลดไม่ได้/ไม่มีหมวด = เหลือแต่ลิงก์สายด่วน ไม่เดาว่าหมวดเปิด
// ตรรกะตัดสินว่าหมวดไหนขึ้น: src/lib/waterHelp.js (เทสต์: tests/water-help.test.mjs)
function useWaterHelpCategories() {
  const { tenant, isModuleEnabled } = useTenant()
  const { role } = useAuth()
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!tenant?.id) return undefined
    let cancelled = false
    // supabase builder มีแค่ .then() — ใช้ onRejected ตัวที่สองแทน .catch()
    supabase.from('complaint_categories').select('value, label, emoji, is_active, submit_audience')
      .eq('municipality_id', tenant.id).in('value', WATER_HELP_CATEGORIES)
      .then(({ data }) => { if (!cancelled) setRows(Array.isArray(data) ? data : []) }, () => {})
    return () => { cancelled = true }
  }, [tenant?.id])

  // คำนวณตอน render (สถานะโมดูลอาจมาทีหลังรายการหมวด) — เหมือนปุ่มหมวดหน้าแรก
  return openWaterHelpCategories(rows, { role, hiddenValues: moduleHiddenCategoryValues(isModuleEnabled) })
}

const BUTTON = 'inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-bold'

export default function WaterHelpRow() {
  const categories = useWaterHelpCategories()
  return (
    <section data-water-help aria-labelledby="water-help-title" className="space-y-2.5 rounded-2xl border border-sky-200 bg-white p-3.5">
      <div className="flex items-start gap-2.5">
        <LifeBuoy size={19} aria-hidden="true" className="mt-0.5 shrink-0 text-sky-700" />
        <div>
          <h2 id="water-help-title" className="text-sm font-bold text-gray-800">เกิดเหตุหรือต้องการความช่วยเหลือเรื่องน้ำ</h2>
          <p className="text-xs leading-relaxed text-gray-600">หากเกิดเหตุฉุกเฉิน ให้ติดต่อสายด่วนก่อน</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to={WATER_HELP_EMERGENCY_PATH} data-help-emergency className={`${BUTTON} border-red-300 bg-red-50 text-red-800`}>
          <Phone size={16} aria-hidden="true" /> สายด่วนฉุกเฉิน
        </Link>
        {categories.map(category => (
          <Link key={category.value} to={category.to} data-help-category={category.value} className={`${BUTTON} border-sky-300 bg-sky-50 text-sky-900`}>
            {category.emoji && <span aria-hidden="true">{category.emoji}</span>} {category.label}
          </Link>
        ))}
      </div>
    </section>
  )
}

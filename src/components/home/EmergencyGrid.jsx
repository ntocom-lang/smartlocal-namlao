import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

export default function EmergencyGrid() {
  const { tenant } = useTenant()
  const [contacts, setContacts] = useState([])

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('emergency_contacts')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('display_order')
      .then(({ data }) => setContacts(data || []))
  }, [tenant?.id])

  // เบอร์สายด่วนต่างกันทุก อปท. จึงไม่มีเบอร์กลางสำรอง — ยังไม่กรอกก็ไม่ต้องขึ้นหัวข้อว่างบนหน้าแรก
  if (contacts.length === 0) return null

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-6 rounded-full bg-red-500" />
        <h2 className="text-base font-bold text-gray-700 dark:text-slate-200">สายด่วนฉุกเฉิน 24 ชั่วโมง</h2>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {contacts.map(({ id, label, number, emoji, color, bg }) => (
          <a key={id} href={`tel:${number}`}
             className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-white border border-gray-100 shadow-sm
                        hover:shadow-md hover:-translate-y-1 transition-all duration-200 text-center group
                        dark:bg-white/10 dark:border-white/10 dark:shadow-none dark:hover:shadow-none">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg
                            group-hover:scale-110 transition-transform"
                 style={{ backgroundColor: bg }}>
              {emoji}
            </div>
            <div>
              <p className="text-sm font-extrabold leading-none" style={{ color }}>{number}</p>
              <p className="text-[13px] text-gray-500 mt-0.5 dark:text-slate-400">{label}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}

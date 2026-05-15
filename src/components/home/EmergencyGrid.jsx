import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

const FALLBACK = [
  { id: '1', label: 'ตำรวจ',          number: '191',  emoji: '👮', color: '#1d4ed8', bg: '#dbeafe' },
  { id: '2', label: 'กู้ชีพ / EMS',   number: '1669', emoji: '🚑', color: '#dc2626', bg: '#fee2e2' },
  { id: '3', label: 'การไฟฟ้า',       number: '1129', emoji: '⚡', color: '#d97706', bg: '#fef3c7' },
  { id: '4', label: 'ดับเพลิง',       number: '199',  emoji: '🚒', color: '#ea580c', bg: '#ffedd5' },
  { id: '5', label: 'ประปา',          number: '1662', emoji: '💧', color: '#0284c7', bg: '#e0f2fe' },
  { id: '6', label: 'สายด่วนรัฐบาล', number: '1111', emoji: '📞', color: '#7c3aed', bg: '#ede9fe' },
]

export default function EmergencyGrid() {
  const { tenant } = useTenant()
  const [contacts, setContacts] = useState(FALLBACK)

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('emergency_contacts')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('display_order')
      .then(({ data }) => {
        if (data && data.length > 0) setContacts(data)
      })
  }, [tenant?.id])

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
              <p className="text-[10px] text-gray-500 mt-0.5 dark:text-slate-400">{label}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}

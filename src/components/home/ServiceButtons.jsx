import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

const FALLBACK = [
  { value: 'light',            label: 'ไฟฟ้าสาธารณะ',              emoji: '💡', color: '#FEF3C7' },
  { value: 'road',             label: 'ซ่อมแซมถนน',               emoji: '🛣️', color: '#F3F4F6' },
  { value: 'mosquito',         label: 'พ่นยุง',                   emoji: '🦟', color: '#D1FAE5' },
  { value: 'tree',             label: 'ตัดต้นไม้',                emoji: '🌳', color: '#D1FAE5' },
  { value: 'trash',            label: 'ขยะ / ความสะอาด',         emoji: '🗑️', color: '#F3F4F6' },
  { value: 'water_supply',     label: 'สนับสนุนน้ำอุปโภค',        emoji: '🚿', color: '#DBEAFE' },
  { value: 'borrow_equipment', label: 'ยืมพัสดุ',                 emoji: '📦', color: '#E0E7FF' },
  { value: 'corruption',       label: 'แจ้งการทุจริต',            emoji: '⚖️', color: '#FEE2E2' },
]

export default function ServiceButtons() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [cats, setCats] = useState(FALLBACK)

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('complaint_categories')
      .select('value, label, emoji, color')
      .eq('municipality_id', tenant.id)
      .order('sort_order')
      .limit(8)
      .then(({ data }) => {
        if (data && data.length > 0) setCats(data)
      })
  }, [tenant?.id])

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-1 h-6 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />
        <h2 className="text-base font-bold text-gray-700 dark:text-slate-200">ยื่นคำร้องออนไลน์</h2>
      </div>

      <div className="bg-white dark:bg-white/10 rounded-2xl border border-gray-100 dark:border-white/10 p-4">
        <div className="grid grid-cols-4 gap-3">
          {cats.map((cat) => (
            <button
              key={cat.value}
              onClick={() => navigate(`/request?category=${cat.value}`)}
              className="flex flex-col items-center gap-2 active:scale-95 transition-transform"
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-2xl shadow-sm"
                style={{ backgroundColor: cat.color }}
              >
                {cat.emoji}
              </div>
              <span className="text-[10px] text-gray-600 dark:text-slate-300 font-medium text-center leading-tight">
                {cat.label}
              </span>
            </button>
          ))}
        </div>

        <div className="flex justify-end mt-3">
          <button
            onClick={() => navigate('/complaint')}
            className="text-xs font-semibold px-4 py-1.5 rounded-full border transition-colors"
            style={{ color: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}
          >
            ดูทั้งหมด →
          </button>
        </div>
      </div>
    </section>
  )
}

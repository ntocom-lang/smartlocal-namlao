import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const FALLBACK_EMOJI = {
  light: '💡', road: '🔧', mosquito: '🦟', tree: '✂️',
  trash: '🗑️', water_supply: '💧', drain: '🌀', flood: '🌊',
  borrow_equipment: '📦', corruption: '🛡️', grievance: '📢',
  noise: '🔊', building: '🏢', tax: '💳', canal: '⛏️',
  animals: '🐕', fire: '🔥', phone_complaint: '📞',
  waste_water: '💧', other: '❓',
}

const FALLBACK_COLOR = {
  light: '#f59e0b', road: '#3b82f6', mosquito: '#10b981', tree: '#22c55e',
  trash: '#6b7280', water_supply: '#06b6d4', drain: '#8b5cf6', flood: '#0ea5e9',
  borrow_equipment: '#f97316', corruption: '#ef4444', grievance: '#ec4899',
  noise: '#a855f7', building: '#64748b', tax: '#14b8a6', canal: '#78716c',
  animals: '#f97316', fire: '#ef4444', phone_complaint: '#3b82f6',
  waste_water: '#06b6d4', other: '#9ca3af',
}

const DEFAULT_CATEGORIES = [
  { value: 'light',            label: 'ไฟฟ้าสาธารณะ' },
  { value: 'drain',            label: 'ท่อระบายน้ำ' },
  { value: 'trash',            label: 'ขยะ / ความสะอาด' },
  { value: 'waste_water',      label: 'น้ำเสีย' },
  { value: 'canal',            label: 'ดูดสิ่งปฏิกูล' },
  { value: 'road',             label: 'ถนน / ทางเท้า' },
  { value: 'noise',            label: 'แจ้งเหตุรำคาญ' },
  { value: 'flood',            label: 'ฝาท่อระบายน้ำ' },
  { value: 'building',         label: 'ตรวจสอบอาคาร' },
  { value: 'mosquito',         label: 'พ่นยุง / โรคระบาด' },
  { value: 'grievance',        label: 'กลิ่น / ควัน / เสียง' },
  { value: 'corruption',       label: 'แจ้งการทุจริต' },
  { value: 'tax',              label: 'ภาษีและค่าธรรมเนียม' },
  { value: 'tree',             label: 'ตัดต้นไม้' },
  { value: 'water_supply',     label: 'ลอกคลอง' },
  { value: 'animals',          label: 'สุนัขจรจัด' },
  { value: 'phone_complaint',  label: 'ร้องเรียนเสียง' },
  { value: 'other',            label: 'อื่นๆ' },
]

export default function ComplaintCategory() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('complaint_categories')
      .select('value, label, emoji, color, text_color')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        setCategories(data && data.length > 0 ? data : DEFAULT_CATEGORIES)
      })
      .catch(() => setCategories(DEFAULT_CATEGORIES))
      .finally(() => setLoading(false))
  }, [tenant?.id])

  function handleSelect(value) {
    navigate(`/request?category=${value}`)
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>

      {/* PC header */}
      <div className="hidden md:flex items-center justify-between px-8 py-4 bg-white border-b border-gray-200 shadow-sm">
        <h1 className="text-lg font-bold text-gray-800">แจ้งเหตุ/แจ้งซ่อม</h1>
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
          <ArrowLeft size={15} />
          ย้อนกลับ
        </button>
      </div>

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-10 flex items-center gap-3 px-4 py-3 shadow-md"
        style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
        <button onClick={() => navigate(-1)}
          className="p-1.5 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
          <ArrowLeft size={20} className="text-white" />
        </button>
        <h1 className="font-bold text-white text-base flex-1 text-center pr-8">แจ้งเหตุ/แจ้งซ่อม</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-5 pb-28 md:pb-8">

        {/* Prompt button */}
        <button onClick={() => {}} disabled
          className="w-full py-3.5 rounded-full font-semibold text-white text-sm mb-5 shadow"
          style={{ backgroundColor: '#1e3a5f' }}>
          เลือกหมวดหมู่
        </button>

        {/* Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={28} className="animate-spin text-blue-300" />
          </div>
        ) : (
          <div className="grid grid-cols-4 md:grid-cols-5 gap-x-3 gap-y-5">
            {categories.map((cat) => {
              const emoji = cat.emoji || FALLBACK_EMOJI[cat.value] || '📋'
              const color = cat.color || FALLBACK_COLOR[cat.value] || '#6b7280'
              return (
                <button key={cat.value} onClick={() => handleSelect(cat.value)}
                  className="flex flex-col items-center gap-2 active:scale-95 transition-transform group">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm transition-shadow group-hover:shadow-md"
                    style={{
                      backgroundColor: color + '18',
                      border: `1.5px solid ${color}45`,
                      boxShadow: `0 2px 8px ${color}20`,
                    }}>
                    <span className="text-[2rem] leading-none select-none">{emoji}</span>
                  </div>
                  <span className="text-[11px] font-medium text-gray-600 text-center leading-tight w-full px-0.5 line-clamp-2">
                    {cat.label}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

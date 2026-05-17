import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const DEFAULT_CATEGORIES = [
  { value: 'light',            label: 'ไฟฟ้าสาธารณะ',              emoji: '💡', color: '#FEF3C7', text: '#D97706' },
  { value: 'road',             label: 'ซ่อมแซมถนน',               emoji: '🛣️', color: '#F3F4F6', text: '#374151' },
  { value: 'mosquito',         label: 'พ่นยุง',                   emoji: '🦟', color: '#D1FAE5', text: '#059669' },
  { value: 'tree',             label: 'ตัดต้นไม้',                emoji: '🌳', color: '#D1FAE5', text: '#059669' },
  { value: 'trash',            label: 'ขยะ / ความสะอาด',         emoji: '🗑️', color: '#F3F4F6', text: '#374151' },
  { value: 'water_supply',     label: 'สนับสนุนน้ำอุปโภค',        emoji: '🚿', color: '#DBEAFE', text: '#2563EB' },
  { value: 'borrow_equipment', label: 'ยืมพัสดุ',                 emoji: '📦', color: '#E0E7FF', text: '#4338CA' },
  { value: 'corruption',       label: 'แจ้งการทุจริต',            emoji: '⚖️', color: '#FEE2E2', text: '#DC2626' },
  { value: 'grievance',        label: 'แจ้งเรื่องร้องทุกข์ร้องเรียน', emoji: '📣', color: '#FEF3C7', text: '#D97706' },
  { value: 'other',            label: 'อื่นๆ',                    emoji: '📝', color: '#E0E7FF', text: '#4338CA' },
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
      .order('sort_order')
      .then(({ data }) => {
        if (data && data.length > 0) {
          setCategories(data.map((c) => ({ ...c, text: c.text_color })))
        } else {
          setCategories(DEFAULT_CATEGORIES)
        }
        setLoading(false)
      })
  }, [tenant?.id])

  function handleSelect(value) {
    navigate(`/request?category=${value}`)
  }

  return (
    <div className="max-w-lg mx-auto min-h-screen bg-gray-50">
      {/* Top bar */}
      <div
        className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 shadow-md"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
        }}
      >
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-xl bg-white/20 hover:bg-white/30 transition-colors"
        >
          <ArrowLeft size={20} className="text-white" />
        </button>
        <h1 className="font-bold text-white text-base">ยื่นคำร้องออนไลน์</h1>
      </div>

      {/* Prompt */}
      <div className="px-4 pt-5 pb-2">
        <div
          className="text-center py-3 px-4 rounded-2xl font-semibold text-white text-sm shadow"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          เลือกประเภทที่ต้องการยื่นคำร้อง
        </div>
      </div>

      {/* Category Grid */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={28} className="animate-spin text-gray-300" />
        </div>
      ) : (
        <div className="px-4 pb-28 pt-3 grid grid-cols-3 gap-3">
          {categories.map((cat) => (
            <button
              key={cat.value}
              onClick={() => handleSelect(cat.value)}
              className="flex flex-col items-center gap-2 py-4 px-2 rounded-2xl bg-white shadow-sm border border-gray-100 active:scale-95 transition-transform hover:shadow-md"
            >
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
                style={{ backgroundColor: cat.color }}
              >
                {cat.emoji}
              </div>
              <span
                className="text-[13px] font-medium text-center leading-tight"
                style={{ color: cat.text }}
              >
                {cat.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

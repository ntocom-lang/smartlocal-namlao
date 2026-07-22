import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Lightbulb, Hammer, Trees,
  Trash2, Droplets, Waves, CloudRain, Package, ShieldAlert,
  Megaphone, VolumeX, Building2, Receipt, Pickaxe, Dog,
  Flame, PhoneCall, HelpCircle, Truck, CircleDot, Wind, Stethoscope
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'


const FALLBACK_ICON = {
  light: Lightbulb, road: Hammer, tree: Trees,
  trash: Trash2, water_supply: Droplets, drain: Waves, flood: CloudRain,
  borrow_equipment: Package, corruption: ShieldAlert, grievance: Megaphone,
  noise: VolumeX, building: Building2, tax: Receipt, canal: Pickaxe,
  animals: Dog, fire: Flame, phone_complaint: PhoneCall,
  waste_water: Droplets, suction: Truck, manhole: CircleDot,
  pollution: Wind, disease: Stethoscope, other: HelpCircle,
}

const EMOJI_OVERRIDE = {
  light: '⚡', drain: '🚧', trash: '♻️', waste_water: '💧',
  canal: '🏞️', road: '🛤️', noise: '🔊', flood: '🌊',
  building: '🏢', mosquito: '🧴', grievance: '📣', corruption: '🚨',
  tax: '🧾', tree: '🌲', water_supply: '💧', animals: '🐾',
  phone_complaint: '☎️', borrow_equipment: '🔧', fire: '🔥',
  suction: '🚽', manhole: '⚙️', pollution: '🌫️', disease: '🏥', other: '❓',
}

const FALLBACK_COLOR = {
  light: '#f59e0b', road: '#64748b', mosquito: '#10b981', tree: '#22c55e',
  trash: '#94a3b8', water_supply: '#3b82f6', drain: '#8b5cf6', flood: '#0ea5e9',
  borrow_equipment: '#d97706', corruption: '#ef4444', grievance: '#f59e0b',
  noise: '#a855f7', building: '#475569', tax: '#14b8a6', canal: '#78716c',
  animals: '#f97316', fire: '#ef4444', phone_complaint: '#3b82f6',
  waste_water: '#06b6d4', suction: '#0891b2', manhole: '#71717a',
  pollution: '#6b7280', disease: '#ec4899', other: '#9ca3af',
}

const DEFAULT_CATEGORIES = [
  { value: 'light',            label: 'ไฟฟ้าสาธารณะ' },
  { value: 'drain',            label: 'ท่อระบายน้ำ' },
  { value: 'manhole',          label: 'ฝาท่อระบายน้ำ' },
  { value: 'trash',            label: 'ขยะ / ความสะอาด' },
  { value: 'waste_water',      label: 'น้ำเสีย' },
  { value: 'suction',          label: 'ดูดสิ่งปฏิกูล' },
  { value: 'canal',            label: 'ลอกคลอง' },
  { value: 'road',             label: 'ถนน / ทางเท้า' },
  { value: 'noise',            label: 'แจ้งเหตุรำคาญ' },
  { value: 'flood',            label: 'น้ำท่วม / ระบายน้ำ' },
  { value: 'building',         label: 'ตรวจสอบอาคาร' },
  { value: 'mosquito',         label: 'พ่นยุง' },
  { value: 'disease',          label: 'ควบคุมโรคติดต่อ' },
  { value: 'pollution',        label: 'กลิ่น / ควัน / มลพิษ' },
  { value: 'grievance',        label: 'แจ้งเรื่องร้องทุกข์ร้องเรียน' },
  { value: 'corruption',       label: 'แจ้งการทุจริต' },
  { value: 'tax',              label: 'ภาษีและค่าธรรมเนียม' },
  { value: 'tree',             label: 'ตัดต้นไม้' },
  { value: 'water_supply',     label: 'สนับสนุนน้ำอุปโภค' },
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
    <div className="min-h-screen" style={{ backgroundColor: '#f4f7f6' }}>

      {/* PC header */}
      <div className="hidden md:flex items-center justify-between px-8 py-4 bg-white border-b border-gray-200 shadow-sm">
        <h1 className="text-lg font-bold text-gray-800">แจ้งเรื่องร้องเรียน</h1>
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
        <h1 className="font-bold text-white text-base flex-1 text-center pr-8">แจ้งเรื่องร้องเรียน</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6 pb-28 md:pb-8">

        {/* Prompt text */}
        <h2 className="text-[#0f172a] text-[15px] font-bold mb-4 text-left">
          เลือกหมวดหมู่เพื่อแจ้งเรื่อง
        </h2>

        {/* Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={28} className="animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
            {categories.map((cat) => {
              const dbEmoji = cat.emoji || ''
              const isImageUrl = dbEmoji.startsWith('http') || dbEmoji.startsWith('/') || dbEmoji.startsWith('data:')
              const hasDbEmoji = !isImageUrl && dbEmoji.trim() !== ''
              const IconComponent = FALLBACK_ICON[cat.value] || HelpCircle
              const iconBg = FALLBACK_COLOR[cat.value] || '#475569'

              return (
                <button key={cat.value} onClick={() => handleSelect(cat.value)}
                  className="flex flex-col items-center justify-start pt-5 pb-4 px-3 gap-3 active:scale-95 transition-all group bg-white rounded-[14px] border border-gray-200 shadow-sm hover:shadow-md hover:border-blue-200">

                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110"
                    style={{ backgroundColor: iconBg }}>
                    {isImageUrl ? (
                      <img src={dbEmoji} alt={cat.label} className="w-9 h-9 object-contain" />
                    ) : hasDbEmoji ? (
                      <span className="text-[1.8rem] leading-none select-none">{dbEmoji}</span>
                    ) : EMOJI_OVERRIDE[cat.value] ? (
                      <span className="text-[1.8rem] leading-none select-none">{EMOJI_OVERRIDE[cat.value]}</span>
                    ) : (
                      <IconComponent size={32} color="white" strokeWidth={2} />
                    )}
                  </div>

                  <span className="text-[12px] font-bold text-[#1e3a8a] text-center leading-snug w-full px-0.5 line-clamp-3 mt-1 group-hover:text-blue-600 transition-colors">
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

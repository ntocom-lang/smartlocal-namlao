import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import {
  LightbulbFilamentIcon, RoadHorizonIcon, BugIcon, TreeIcon, TrashIcon,
  DropIcon, WavesIcon, CloudRainIcon, ToolboxIcon, ShieldWarningIcon,
  MegaphoneSimpleIcon, SpeakerHighIcon, BuildingsIcon, ReceiptIcon,
  ShovelIcon, PawPrintIcon, FireIcon, PhoneCallIcon, QuestionIcon,
} from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const FALLBACK_ICON = {
  light:            LightbulbFilamentIcon,
  road:             RoadHorizonIcon,
  mosquito:         BugIcon,
  tree:             TreeIcon,
  trash:            TrashIcon,
  water_supply:     DropIcon,
  drain:            WavesIcon,
  flood:            CloudRainIcon,
  borrow_equipment: ToolboxIcon,
  corruption:       ShieldWarningIcon,
  grievance:        MegaphoneSimpleIcon,
  noise:            SpeakerHighIcon,
  building:         BuildingsIcon,
  tax:              ReceiptIcon,
  canal:            ShovelIcon,
  animals:          PawPrintIcon,
  fire:             FireIcon,
  phone_complaint:  PhoneCallIcon,
  waste_water:      WavesIcon,
  other:            QuestionIcon,
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

      <div className="max-w-2xl mx-auto px-4 pt-5 pb-28 md:pb-8">

        {/* Prompt text */}
        <h2 className="text-gray-800 text-base font-bold mb-4 text-left">
          เลือกหมวดหมู่เพื่อแจ้งเรื่อง
        </h2>

        {/* Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={28} className="animate-spin text-blue-300" />
          </div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 gap-3 md:gap-4">
            {categories.map((cat) => {
              const emoji = cat.emoji || ''
              const baseColor = cat.color || FALLBACK_COLOR[cat.value] || '#6b7280'
              // Strip any alpha channel from color to ensure it's fully opaque for the icon
              const color = baseColor.length > 7 ? baseColor.substring(0, 7) : baseColor
              const isImageUrl = emoji.startsWith('http') || emoji.startsWith('/')
              const IconComponent = FALLBACK_ICON[cat.value] || QuestionIcon

              return (
                <button key={cat.value} onClick={() => handleSelect(cat.value)}
                  className="flex flex-col items-center gap-2.5 p-3 bg-white rounded-2xl active:scale-95 transition-all group hover:-translate-y-0.5"
                  style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: `1.5px solid ${color}25` }}>

                  {/* Icon box — solid background, white icon */}
                  <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105"
                    style={{ background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)` }}>
                    {isImageUrl ? (
                      <img src={emoji} alt={cat.label} className="w-8 h-8 object-contain" />
                    ) : emoji ? (
                      <span className="text-2xl">{emoji}</span>
                    ) : (
                      <IconComponent size={30} color="white" weight="fill" />
                    )}
                  </div>

                  <span className="text-[12px] font-bold text-gray-800 text-center leading-snug w-full line-clamp-2">
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

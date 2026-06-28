import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Loader2,
  Lightbulb, Trash2, TreePine, Droplets, Package, Megaphone, Bug,
  Waves, Wind, Building2, Volume2, AlertTriangle, HelpCircle,
  CreditCard, Scissors, PawPrint, Shield, FlameKindling, Phone,
  Axe, Wrench, Zap, Construction,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const CATEGORY_ICON = {
  light:            Lightbulb,
  road:             Wrench,
  mosquito:         Bug,
  tree:             Scissors,
  trash:            Trash2,
  water_supply:     Droplets,
  drain:            Wind,
  flood:            Waves,
  borrow_equipment: Package,
  corruption:       Shield,
  grievance:        Megaphone,
  noise:            Volume2,
  building:         Building2,
  tax:              CreditCard,
  canal:            Axe,
  animals:          PawPrint,
  fire:             FlameKindling,
  phone_complaint:  Phone,
  waste_water:      Droplets,
  other:            HelpCircle,
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
        <h1 className="text-lg font-bold text-gray-800">ร้องเรียน/ร้องทุกข์</h1>
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
        <h1 className="font-bold text-white text-base flex-1 text-center pr-8">ร้องเรียน/ร้องทุกข์</h1>
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
              const Icon = CATEGORY_ICON[cat.value] ?? HelpCircle
              return (
                <button key={cat.value} onClick={() => handleSelect(cat.value)}
                  className="flex flex-col items-center gap-2 active:scale-95 transition-transform">
                  <div className="w-16 h-16 rounded-full bg-white shadow-md flex items-center justify-center"
                    style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.10)' }}>
                    <Icon size={28} strokeWidth={1.5} style={{ color: 'var(--color-primary)' }} />
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

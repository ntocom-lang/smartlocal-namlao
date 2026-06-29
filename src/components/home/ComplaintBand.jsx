import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import {
  Lightbulb, Wrench, Bug, Scissors, Trash2, Droplets, Wind, Waves,
  Package, Shield, Megaphone, Volume2, Building2, CreditCard, Axe,
  PawPrint, FlameKindling, Phone, HelpCircle, ChevronRight,
} from 'lucide-react'

const CATEGORY_ICON = {
  light: Lightbulb, road: Wrench, mosquito: Bug, tree: Scissors,
  trash: Trash2, water_supply: Droplets, drain: Wind, flood: Waves,
  borrow_equipment: Package, corruption: Shield, grievance: Megaphone,
  noise: Volume2, building: Building2, tax: CreditCard, canal: Axe,
  animals: PawPrint, fire: FlameKindling, phone_complaint: Phone,
  waste_water: Droplets, other: HelpCircle,
}

const DEFAULT_CATEGORIES = [
  { value: 'light',       label: 'ไฟฟ้าสาธารณะ' },
  { value: 'road',        label: 'ถนน / ทางเท้า' },
  { value: 'trash',       label: 'ขยะ / ความสะอาด' },
  { value: 'drain',       label: 'ท่อระบายน้ำ' },
  { value: 'mosquito',    label: 'พ่นยุง' },
  { value: 'corruption',  label: 'แจ้งทุจริต' },
  { value: 'other',       label: 'อื่นๆ' },
]

export default function ComplaintBand() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [cats, setCats] = useState(DEFAULT_CATEGORIES)

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('complaint_categories')
      .select('value, label')
      .eq('municipality_id', tenant.id)
      .order('sort_order')
      .then(({ data }) => { if (data?.length) setCats(data) })
      .catch(() => {})
  }, [tenant?.id])

  return (
    <div className="rounded-2xl overflow-hidden shadow-xl relative"
      style={{ background: 'linear-gradient(135deg, #7f1d1d 0%, #dc2626 40%, #f97316 80%, #fbbf24 100%)' }}>
      {/* decorative glows */}
      <div className="absolute -top-6 -left-6 w-32 h-32 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(251,191,36,0.4) 0%, transparent 70%)' }} />
      <div className="absolute -bottom-8 -right-4 w-36 h-36 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(220,38,38,0.5) 0%, transparent 70%)' }} />

      <div className="relative z-10 px-4 pt-4 pb-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-white font-bold text-sm tracking-wide drop-shadow">🚨 ร้องเรียน / ร้องทุกข์</p>
          <button onClick={() => navigate('/complaint')}
            className="flex items-center gap-0.5 text-white/80 text-xs bg-white/15 px-2 py-1 rounded-full hover:bg-white/25 transition-colors">
            ทั้งหมด <ChevronRight size={13} />
          </button>
        </div>
        <div className="flex gap-5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {cats.map(cat => {
            const Icon = CATEGORY_ICON[cat.value] ?? HelpCircle
            return (
              <button key={cat.value}
                onClick={() => navigate(`/request?category=${cat.value}`)}
                className="flex flex-col items-center gap-2 shrink-0 active:scale-95 transition-transform">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
                  style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.08) 100%)', border: '1px solid rgba(255,255,255,0.25)' }}>
                  <Icon size={26} className="text-white drop-shadow" />
                </div>
                <p className="text-white text-[10px] font-semibold text-center w-14 leading-tight drop-shadow">{cat.label}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

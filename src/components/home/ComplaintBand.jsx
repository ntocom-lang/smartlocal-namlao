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
    <div className="rounded-2xl overflow-hidden shadow-md">
      <div className="px-4 pt-4 pb-5"
        style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 60%, #2563eb 100%)' }}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-white font-bold text-sm tracking-wide">ร้องเรียน / ร้องทุกข์</p>
          <button onClick={() => navigate('/complaint')}
            className="flex items-center gap-0.5 text-white/70 text-xs active:text-white transition-colors">
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
                <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center shadow-inner">
                  <Icon size={26} className="text-white" />
                </div>
                <p className="text-white text-[10px] font-semibold text-center w-14 leading-tight">{cat.label}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

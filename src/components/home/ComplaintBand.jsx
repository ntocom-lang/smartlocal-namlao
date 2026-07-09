import { useState, useEffect, useMemo } from 'react'
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
  const [catCounts, setCatCounts] = useState({})

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaint_categories').select('value, label')
      .eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order')
      .then(({ data }) => { if (data?.length) setCats(data) })
      .catch(() => {})
    supabase.from('complaints').select('category')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false }).limit(300)
      .then(({ data }) => {
        const c = {}
        ;(data ?? []).forEach(r => { c[r.category] = (c[r.category] ?? 0) + 1 })
        setCatCounts(c)
      })
  }, [tenant?.id])

  const topCats = useMemo(() =>
    [...cats].sort((a, b) => (catCounts[b.value] ?? 0) - (catCounts[a.value] ?? 0))
  , [cats, catCounts])

  return (
    <div className="rounded-2xl overflow-hidden shadow-xl relative"
      style={{ background: 'linear-gradient(135deg, #d97706 0%, #f59e0b 50%, #fde68a 100%)' }}>
      {/* decorative glows */}
      <div className="absolute -top-6 -left-6 w-32 h-32 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(253,230,138,0.5) 0%, transparent 70%)' }} />
      <div className="absolute -bottom-8 -right-4 w-36 h-36 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(217,119,6,0.35) 0%, transparent 70%)' }} />

      <div className="relative z-10 px-4 pt-3 pb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-amber-900 font-bold text-sm tracking-wide">🚨 แจ้งเหตุ / แจ้งซ่อม</p>
          <button onClick={() => navigate('/complaint')}
            className="flex items-center gap-0.5 text-amber-900/70 text-xs bg-white/30 px-2 py-1 rounded-full hover:bg-white/50 transition-colors">
            ทั้งหมด <ChevronRight size={13} />
          </button>
        </div>

        {/* Mobile: horizontal scroll */}
        <div className="flex gap-5 overflow-x-auto pb-1 md:hidden" style={{ scrollbarWidth: 'none' }}>
          {topCats.map(cat => {
            const Icon = CATEGORY_ICON[cat.value] ?? HelpCircle
            return (
              <button key={cat.value}
                onClick={() => navigate(`/request?category=${cat.value}`)}
                className="flex flex-col items-center gap-2 shrink-0 active:scale-95 transition-transform">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-md"
                  style={{ background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.6)' }}>
                  <Icon size={26} className="text-amber-700" />
                </div>
                <p className="text-amber-900 text-[10px] font-semibold text-center w-14 leading-tight">{cat.label}</p>
              </button>
            )
          })}
        </div>

        {/* Desktop: compact grid */}
        <div className="hidden md:grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(topCats.length, 7)}, minmax(0, 1fr))` }}>
          {topCats.map(cat => {
            const Icon = CATEGORY_ICON[cat.value] ?? HelpCircle
            return (
              <button key={cat.value}
                onClick={() => navigate(`/request?category=${cat.value}`)}
                className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-white/20 active:scale-95 transition-all">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm"
                  style={{ background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.6)' }}>
                  <Icon size={20} className="text-amber-700" />
                </div>
                <p className="text-amber-900 text-[10px] font-semibold text-center leading-tight">{cat.label}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

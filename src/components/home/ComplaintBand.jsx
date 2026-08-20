import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

const FALLBACK_EMOJI = {
  light: '💡', road: '🔧', mosquito: '🦟', tree: '✂️',
  trash: '🗑️', water_supply: '💧', drain: '🌀', flood: '🌊',
  borrow_equipment: '📦', corruption: '🛡️', grievance: '📢',
  noise: '🔊', building: '🏢', tax: '💳', canal: '⛏️',
  animals: '🐕', fire: '🔥', phone_complaint: '📞',
  waste_water: '💧', other: '❓',
}

const DEFAULT_CATEGORIES = [
  { value: 'light',      label: 'ไฟฟ้าสาธารณะ', emoji: '💡' },
  { value: 'disease',    label: 'ควบคุมโรคติดต่อ', emoji: '🏥' },
  { value: 'road',       label: 'ซ่อมแซมถนน', emoji: '🛣️' },
  { value: 'mosquito',   label: 'พ่นยุง', emoji: '🦟' },
  { value: 'tree',       label: 'ตัดต้นไม้', emoji: '🌳' },
  { value: 'trash',      label: 'ขยะ / ความสะอาด', emoji: '🗑️' },
  { value: 'water_supply',label: 'สนับสนุนน้ำอุปโภค', emoji: '🚿' },
  { value: 'borrow',     label: 'ยืมพัสดุ', emoji: '📦' },
  { value: 'corruption', label: 'แจ้งการทุจริต', emoji: '⚖️' },
  { value: 'grievance',  label: 'แจ้งเรื่องร้องทุกข์', emoji: '📢' },
  { value: 'other',      label: 'อื่นๆ', emoji: '📝' },
]

// variant="warm" (ค่าเริ่มต้น) = แถบไล่สีส้ม ใช้กับ 6 ธีมเดิมทั้งหมดไม่เปลี่ยนแปลง
// variant="clean" = พื้นขาว/เทาอ่อน ใช้เฉพาะ thungkaew-Theme (ServiceHub) ให้ตรงกับภาพอ้างอิงที่ขอเลียนแบบ
export default function ComplaintBand({ variant = 'warm' }) {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [cats, setCats] = useState(DEFAULT_CATEGORIES)
  const clean = variant === 'clean'

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaint_categories').select('value, label, emoji, color')
      .eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order')
      .then(({ data }) => { if (data?.length) setCats(data) })
      .catch(() => {})
  }, [tenant?.id])

  const topCats = cats
  const titleColor = clean ? 'text-gray-800' : 'text-amber-900'
  const chipCls = clean
    ? 'flex items-center gap-0.5 text-gray-500 text-xs bg-gray-100 px-2 py-1 rounded-full hover:bg-gray-200 transition-colors'
    : 'flex items-center gap-0.5 text-amber-900/70 text-xs bg-white/30 px-2 py-1 rounded-full hover:bg-white/50 transition-colors'

  return (
    <div className={`rounded-2xl overflow-hidden relative ${clean ? 'shadow-sm border border-gray-100' : 'shadow-xl'}`}
      style={clean ? { backgroundColor: '#ffffff' } : { background: 'linear-gradient(135deg, #d97706 0%, #f59e0b 50%, #fde68a 100%)' }}>
      {/* decorative glows — เฉพาะ variant สีส้มเดิม */}
      {!clean && (
        <>
          <div className="absolute -top-6 -left-6 w-32 h-32 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(253,230,138,0.5) 0%, transparent 70%)' }} />
          <div className="absolute -bottom-8 -right-4 w-36 h-36 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(217,119,6,0.35) 0%, transparent 70%)' }} />
        </>
      )}

      <div className="relative z-10 px-4 pt-3 pb-4">
        <div className="flex items-center justify-between mb-3">
          <p className={`${titleColor} font-extrabold text-[15px] md:text-base tracking-wide ${clean ? '' : 'drop-shadow-sm'}`}>🚨 แจ้งเหตุ / แจ้งซ่อม</p>
          <button onClick={() => navigate('/complaint')} className={chipCls}>
            ทั้งหมด <ChevronRight size={13} />
          </button>
        </div>

        {/* Mobile: 4 items grid — ที่เหลือกด "ทั้งหมด" แทน กันแออัดเกินไปบนจอเล็ก */}
        <div className="grid grid-cols-4 gap-1 lg:hidden pb-1">
          {topCats.slice(0, 4).map(cat => {
            const emoji = cat.emoji || FALLBACK_EMOJI[cat.value] || '📋'
            const color = cat.color || (clean ? 'var(--color-primary, #2563eb)' : '#ffffff')
            return (
              <button key={cat.value}
                onClick={() => navigate(`/request?category=${cat.value}`)}
                className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform">
                <div className="w-13 h-13 flex items-center justify-center shadow-md"
                  style={{
                    backgroundColor: color + '22',
                    borderRadius: 'var(--radius-btn, 1rem)',
                    border: `1.5px solid ${color}55`,
                    backdropFilter: 'blur(4px)',
                    boxShadow: clean ? `0 2px 6px ${color}20` : `0 3px 10px ${color}30, inset 0 1px 0 rgba(255,255,255,0.5)`,
                  }}>
                  <span className="text-[1.6rem] leading-none select-none">{emoji}</span>
                </div>
                <p className={`${titleColor} text-[11px] font-semibold text-center w-full leading-tight ${clean ? '' : 'drop-shadow-sm'} line-clamp-2`}>{cat.label}</p>
              </button>
            )
          })}
        </div>

        {/* Desktop: compact grid */}
        <div className="hidden lg:grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(topCats.length, 8)}, minmax(0, 1fr))` }}>
          {topCats.slice(0, 8).map(cat => {
            const emoji = cat.emoji || FALLBACK_EMOJI[cat.value] || '📋'
            const color = cat.color || (clean ? 'var(--color-primary, #2563eb)' : '#ffffff')
            return (
              <button key={cat.value}
                onClick={() => navigate(`/request?category=${cat.value}`)}
                className={`flex flex-col items-center gap-1.5 p-1.5 rounded-xl active:scale-95 transition-all ${clean ? 'hover:bg-gray-50' : 'hover:bg-white/15'}`}>
                <div className="w-11 h-11 flex items-center justify-center"
                  style={{
                    backgroundColor: color + '22',
                    borderRadius: 'var(--radius-btn, 1rem)',
                    border: `1.5px solid ${color}55`,
                    backdropFilter: 'blur(4px)',
                    boxShadow: clean ? `0 2px 6px ${color}20` : `0 2px 8px ${color}25, inset 0 1px 0 rgba(255,255,255,0.5)`,
                  }}>
                  <span className="text-[1.4rem] leading-none select-none">{emoji}</span>
                </div>
                <p className={`${titleColor} text-[12px] font-semibold text-center leading-tight`}>{cat.label}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

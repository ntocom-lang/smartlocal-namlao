import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { CategoryIcon } from '../../lib/categoryIcon'

// กล่อง "เฉพาะกิจ" แยกจาก ComplaintBand (คำร้องปกติ) — ดึงเฉพาะหมวดที่แอดมินตั้ง is_adhoc = true
// (เช่นกลิ่นเหม็นรบกวน ที่ส่งตรงผู้รับผิดชอบ ไม่ผ่านแอดมิน) ไม่ hardcode หมวดใดหมวดหนึ่งไว้ เผื่อมีหมวด
// เฉพาะกิจอื่นเพิ่มในอนาคต — ไม่มีหมวดเฉพาะกิจเลยก็คืน null ไปเลย ไม่โชว์กล่องเปล่า
export default function AdhocBand() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [cats, setCats] = useState([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaint_categories').select('value, label, emoji, color')
      .eq('municipality_id', tenant.id).eq('is_active', true).eq('is_adhoc', true).order('sort_order')
      .then(({ data }) => { setCats(data ?? []); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [tenant?.id])

  if (!loaded || cats.length === 0) return null

  return (
    <div className="rounded-2xl overflow-hidden relative shadow-xl"
      style={{ background: 'linear-gradient(135deg, #4d7c0f 0%, #65a30d 50%, #bef264 100%)' }}>
      <div className="absolute -top-6 -left-6 w-32 h-32 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(190,242,100,0.5) 0%, transparent 70%)' }} />
      <div className="absolute -bottom-8 -right-4 w-36 h-36 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(77,124,15,0.35) 0%, transparent 70%)' }} />

      <div className="relative z-10 px-4 pt-2.5 pb-2.5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-white font-extrabold text-[15px] md:text-base tracking-wide drop-shadow-sm flex items-center gap-1.5">
            💨 เฉพาะกิจ
          </p>
          <span className="text-white text-[11px] font-bold bg-white/20 px-2.5 py-0.5 rounded-full border border-white/20">
            ส่งตรงผู้รับผิดชอบ
          </span>
        </div>

        {/* flex-wrap + justify-center แทน grid คอลัมน์ตายตัว — หมวดเฉพาะกิจมักมีแค่ 1-2 หมวด
            ปรับความสูงและระยะห่างให้สมดุลเท่าๆ กับกล่องบริการอื่น ไม่สูงโดดเกินไป */}
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 lg:hidden">
          {cats.slice(0, 4).map(cat => {
            const emoji = cat.emoji || '💨'
            const color = cat.color || '#ffffff'
            // ถ้ามีหมวดเดียวให้กว้างพอดีบรรทัดเดียว ไม่บีบตัดคำ
            const itemWidth = cats.length === 1 ? 'max-w-[260px]' : cats.length === 2 ? 'w-28' : 'w-20'
            const labelClamp = cats.length <= 2 ? '' : 'line-clamp-2'
            return (
              <button key={cat.value}
                onClick={() => navigate(`/request?category=${cat.value}`)}
                className={`flex flex-col items-center gap-1 active:scale-95 transition-transform ${itemWidth}`}>
                <div className="w-12 h-12 flex items-center justify-center shadow-md"
                  style={{
                    backgroundColor: color + '22',
                    borderRadius: 'var(--radius-btn, 1rem)',
                    border: `1.5px solid ${color}55`,
                    backdropFilter: 'blur(4px)',
                    boxShadow: `0 3px 10px ${color}30, inset 0 1px 0 rgba(255,255,255,0.5)`,
                  }}>
                  <CategoryIcon emoji={emoji} size={30} style={tenant?.category_icon_style} />
                </div>
                <p className={`text-white text-[11px] font-semibold text-center w-full leading-tight drop-shadow-sm ${labelClamp}`}>{cat.label}</p>
              </button>
            )
          })}
        </div>

        {/* Desktop */}
        <div className="hidden lg:flex flex-wrap gap-2">
          {cats.slice(0, 8).map(cat => {
            const emoji = cat.emoji || '💨'
            const color = cat.color || '#ffffff'
            return (
              <button key={cat.value}
                onClick={() => navigate(`/request?category=${cat.value}`)}
                className="flex flex-col items-center gap-1.5 p-1.5 rounded-xl active:scale-95 transition-all hover:bg-white/15 min-w-[5.5rem] max-w-[8rem]">
                <div className="w-11 h-11 flex items-center justify-center"
                  style={{
                    backgroundColor: color + '22',
                    borderRadius: 'var(--radius-btn, 1rem)',
                    border: `1.5px solid ${color}55`,
                    backdropFilter: 'blur(4px)',
                    boxShadow: `0 2px 8px ${color}25, inset 0 1px 0 rgba(255,255,255,0.5)`,
                  }}>
                  <CategoryIcon emoji={emoji} size={24} style={tenant?.category_icon_style} />
                </div>
                <p className="text-white text-[12px] font-semibold text-center leading-tight drop-shadow-sm">{cat.label}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

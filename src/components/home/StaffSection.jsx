import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { UserCircle2 } from 'lucide-react'

// Premium Executive Card matching the mockup style (Vertical layout with interactive hover effects)
function ExecutivePremiumCard({ person }) {
  return (
    <div className="flex flex-col items-center text-center hover:-translate-y-1 transition-all duration-300 p-2.5 md:p-5 relative overflow-hidden animate-fade-in group"
         style={{ backgroundColor: 'var(--bg-card, rgba(255,255,255,0.75))', borderRadius: 'var(--radius-card, 1.5rem)', border: 'var(--border-card, 1px solid rgba(243,244,246,0.8))', boxShadow: 'var(--shadow-card, 0 1px 2px 0 rgba(0,0,0,0.05))', backdropFilter: 'var(--blur-card, blur(12px))' }}>
      {/* Premium diagonal shine/sweep effect on card hover */}
      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none z-20" />

      {/* Glow background behind image - shifts color and expands on hover */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 w-24 h-24 md:w-40 md:h-40 rounded-full pointer-events-none opacity-40 blur-lg md:blur-xl bg-gradient-to-tr from-lime-300/40 to-emerald-300/40 transition-all duration-700 group-hover:scale-125 group-hover:opacity-70 group-hover:from-cyan-300/50 group-hover:to-emerald-400/50" />

      {/* Top: Image (Enlarged and lifts up on card hover) */}
      <div className="relative shrink-0 z-10 w-full h-40 md:h-56 flex items-end justify-center mb-2">
        {person.photo_url ? (
          <img
            src={person.photo_url}
            alt={person.name}
            className="h-full object-contain drop-shadow-md transition-all duration-300 origin-bottom group-hover:scale-108 group-hover:-translate-y-1 group-hover:drop-shadow-2xl"
          />
        ) : (
          <div className="w-16 h-16 md:w-28 md:h-28 rounded-full flex items-center justify-center font-bold text-white text-xs md:text-2xl bg-gradient-to-tr from-lime-400 to-emerald-600 shadow-inner transition-transform duration-300 group-hover:scale-105">
            {person.name.trim().split(' ').map((w) => w[0]).join('').slice(0, 2)}
          </div>
        )}
      </div>

      {/* Bottom: Information (More compact box) */}
      <div className="relative z-10 w-full flex flex-col items-center min-w-0">
        {/* Name and Phone box - using primary theme color for dynamic matching, made more compact */}
        <div className="w-[92%] bg-[var(--color-primary)] text-white rounded-xl md:rounded-2xl py-1 md:py-2 px-1.5 md:px-3 shadow-sm border border-[var(--color-primary-dark)]/10 flex flex-col items-center justify-center space-y-0.5 transition-transform duration-300 group-hover:scale-[1.02]">
          {/* Line 1: Name */}
          <p className="font-bold text-[10px] md:text-base leading-snug">
            {person.name}
          </p>

          {/* Line 2: Position */}
          <p className="text-[9px] md:text-xs text-white/90 font-semibold leading-tight">
            {person.title}
          </p>

          {/* Line 3: Phone */}
          {person.phone && (
            <p className="text-[8px] md:text-[11px] text-white/80 font-medium">
              {person.phone.startsWith('โทร') ? person.phone : `โทร. ${person.phone}`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function StaffCard({ person }) {
  return (
    <div className="flex items-center gap-4 p-4 transition-shadow dark:bg-white/10 dark:border-white/10 dark:shadow-none dark:hover:shadow-none"
         style={{ backgroundColor: 'var(--bg-card, #ffffff)', borderRadius: 'var(--radius-card, 1rem)', border: 'var(--border-card, 1px solid #f3f4f6)', boxShadow: 'var(--shadow-card, 0 1px 2px 0 rgba(0,0,0,0.05))', backdropFilter: 'var(--blur-card, none)' }}>
      <div className="rounded-full overflow-hidden shrink-0 ring-2 ring-gray-100 dark:ring-white/10">
        {person.photo_url ? (
          <img src={person.photo_url} alt={person.name}
                 className="w-16 h-16 object-cover object-top" />
        ) : (
          <div className="w-16 h-16 rounded-full flex items-center justify-center font-bold text-white bg-gradient-to-tr from-lime-400 to-emerald-600 text-sm">
            {person.name.trim().split(' ').map((w) => w[0]).join('').slice(0, 2)}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="font-bold text-gray-800 text-sm leading-tight truncate dark:text-white">{person.name}</p>
        <span className="inline-block text-xs px-2 py-0.5 rounded-full mt-1 bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300">
          {person.title}
        </span>
        {person.phone && (
          <p className="text-[10px] text-gray-400 font-mono mt-0.5">{person.phone}</p>
        )}
      </div>
    </div>
  )
}

export default function StaffSection() {
  const { tenant } = useTenant()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('staff')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('display_order')
      .then(({ data }) => {
        setStaff(data ?? [])
        setLoading(false)
      })
  }, [tenant?.id])

  if (loading || staff.length === 0) return null

  // แยกตาม role
  const mayors = staff.filter((s) => s.role === 'mayor')
  const clerks = staff.filter((s) => s.role === 'clerk')
  const deputies = staff.filter((s) => s.role === 'deputy_mayor')
  const teamMembers = staff.filter((s) => s.role === 'staff')

  // รวมบอร์ดบริหารระดับสูง (นายก และ ปลัด)
  const topLeaders = [...mayors, ...clerks]

  return (
    <section className="space-y-6">

      {/* บอร์ดบริหารสูงสุด (นายก & ปลัด) แสดงคู่กันแบบ 2 คอลัมน์ทุกหน้าจอตาม mockup */}
      {topLeaders.length > 0 && (
        <div className="grid grid-cols-2 gap-2 md:gap-4">
          {topLeaders.map((p) => (
            <ExecutivePremiumCard key={p.id} person={p} />
          ))}
        </div>
      )}

      {/* ทีมรองนายก */}
      {deputies.length > 0 && (
        <div className="space-y-3 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">ทีมผู้บริหาร</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {deputies.map((p) => (
              <StaffCard key={p.id} person={p} />
            ))}
          </div>
        </div>
      )}

      {/* ทีมเจ้าหน้าที่ / ฝ่ายปฏิบัติการ */}
      {teamMembers.length > 0 && (
        <div className="space-y-3 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">หัวหน้าส่วนราชการ / ทีมเจ้าหน้าที่</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {teamMembers.map((p) => (
              <StaffCard key={p.id} person={p} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}


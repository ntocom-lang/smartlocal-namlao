import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { UserCircle2 } from 'lucide-react'

function ExecutivePremiumCard({ person, logoUrl }) {
  return (
    <div className="flex flex-row items-center gap-1 md:gap-4 bg-white/70 backdrop-blur-sm rounded-2xl md:rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all p-1.5 md:p-5 relative overflow-hidden dark:bg-slate-900/50 dark:border-slate-800/80">
      {/* Glow background behind image */}
      <div className="absolute top-1/2 left-2 -translate-y-1/2 w-24 h-24 md:w-40 md:h-40 rounded-full pointer-events-none opacity-40 blur-lg md:blur-xl bg-gradient-to-tr from-lime-300/40 to-emerald-300/40" />

      {/* Left side: Image */}
      <div className="relative shrink-0 z-10 w-20 h-28 md:w-36 md:h-48 flex items-end justify-center">
        {person.photo_url ? (
          <img
            src={person.photo_url}
            alt={person.name}
            className="h-full object-contain drop-shadow-md hover:scale-105 transition-transform duration-300 origin-bottom"
          />
        ) : (
          <div className="w-16 h-16 md:w-28 md:h-28 rounded-full flex items-center justify-center font-bold text-white text-xs md:text-2xl bg-gradient-to-tr from-lime-400 to-emerald-600 shadow-inner">
            {person.name.trim().split(' ').map((w) => w[0]).join('').slice(0, 2)}
          </div>
        )}
      </div>

      {/* Right side: Information */}
      <div className="flex-1 flex flex-col items-center text-center z-10 space-y-0.5 md:space-y-2.5 min-w-0 w-full">
        {/* Municipality Logo */}
        {logoUrl ? (
          <img src={logoUrl} alt="Municipality Logo" className="w-6 h-6 md:w-12 md:h-12 object-contain" />
        ) : (
          <div className="w-6 h-6 md:w-12 md:h-12 rounded-full bg-gray-100 flex items-center justify-center text-[8px] text-gray-400">🏢</div>
        )}

        {/* Position Title */}
        <p className="text-[9px] md:text-sm font-bold text-gray-800 dark:text-slate-100 leading-tight truncate w-full">
          {person.title}
        </p>

        {/* Name and Phone box - using primary theme color for dynamic matching */}
        <div className="w-full bg-[var(--color-primary)] text-white rounded-xl md:rounded-2xl py-1 md:py-2 px-1 md:px-3 shadow-sm border border-[var(--color-primary-dark)]/10">
          <p className="font-bold text-[9px] md:text-base leading-tight truncate">
            {person.name}
          </p>
          {person.phone && (
            <p className="text-[8px] md:text-xs text-white/90 font-medium mt-0.5 md:mt-1 truncate">
              {person.phone}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function StaffCard({ person }) {
  return (
    <div className="flex items-center gap-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow dark:bg-white/10 dark:border-white/10 dark:shadow-none dark:hover:shadow-none">
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
            <ExecutivePremiumCard key={p.id} person={p} logoUrl={tenant?.logo_url} />
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


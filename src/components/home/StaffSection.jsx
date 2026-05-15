import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { UserCircle2 } from 'lucide-react'

const ROLE_ORDER = ['mayor', 'deputy_mayor', 'clerk', 'staff']

const ROLE_STYLE = {
  mayor:        { badge: 'text-white',       badgeBg: 'var(--color-primary)',      ring: 'ring-4 ring-[var(--color-primary)] ring-offset-2' },
  deputy_mayor: { badge: 'text-white',       badgeBg: 'var(--color-primary-dark)', ring: 'ring-2 ring-[var(--color-primary)]/40' },
  clerk:        { badge: 'text-white',    badgeBg: 'var(--color-primary)',      ring: 'ring-2 ring-gray-200 dark:ring-white/20' },
  staff:        { badge: 'text-gray-600',    badgeBg: '#f1f5f9',                   ring: 'ring-2 ring-gray-100 dark:ring-white/10' },
}

function PhotoPlaceholder({ name, role }) {
  const initials = name.trim().split(' ').map((w) => w[0]).join('').slice(0, 2)
  const isMayor = role === 'mayor'
  return (
    <div className={`rounded-full flex items-center justify-center font-bold text-white ${
      isMayor ? 'w-28 h-28 text-3xl' : 'w-20 h-20 text-xl'
    }`}
    style={{ background: `linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)` }}>
      {initials || <UserCircle2 size={isMayor ? 48 : 32} />}
    </div>
  )
}

function MayorCard({ person }) {
  const style = ROLE_STYLE[person.role]
  return (
    <div className="flex flex-col items-center text-center bg-white rounded-2xl shadow-md border border-gray-100 p-6 relative overflow-hidden dark:bg-white/10 dark:border-white/10 dark:shadow-none">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 right-0 h-20 opacity-10"
           style={{ background: `linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)` }} />

      <div className={`relative z-10 rounded-full overflow-hidden ${style.ring} mb-4`}>
        {person.photo_url
          ? <img src={person.photo_url} alt={person.name}
                 className="w-28 h-28 object-cover object-top" />
          : <PhotoPlaceholder name={person.name} role={person.role} />}
      </div>

      <p className="font-bold text-gray-800 text-lg leading-tight dark:text-white mb-2">{person.name}</p>
      <span className="text-xs font-semibold px-3 py-1 rounded-full"
            style={{ backgroundColor: style.badgeBg, color: style.badge === 'text-white' ? '#fff' : '#1e293b' }}>
        {person.title}
      </span>
    </div>
  )
}

function StaffCard({ person }) {
  const style = ROLE_STYLE[person.role]
  return (
    <div className="flex items-center gap-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow dark:bg-white/10 dark:border-white/10 dark:shadow-none dark:hover:shadow-none">
      <div className={`rounded-full overflow-hidden shrink-0 ${style.ring}`}>
        {person.photo_url
          ? <img src={person.photo_url} alt={person.name}
                 className="w-20 h-20 object-cover object-top" />
          : <PhotoPlaceholder name={person.name} role={person.role} />}
      </div>
      <div className="min-w-0">
        <p className="font-bold text-gray-800 text-sm leading-tight truncate dark:text-white">{person.name}</p>
        <span className="inline-block text-xs px-2 py-0.5 rounded-full mt-1"
              style={{ backgroundColor: style.badgeBg,
                       color: style.badge === 'text-white' ? '#fff' : '#374151' }}>
          {person.title}
        </span>
      </div>
    </div>
  )
}

export default function StaffSection() {
  const { tenant } = useTenant()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState(0)

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

  // แยกตาม role
  const sorted = [...staff].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
  )
  const mayor       = sorted.filter((s) => s.role === 'mayor')
  const deputies    = sorted.filter((s) => s.role === 'deputy_mayor')
  const clerks      = sorted.filter((s) => s.role === 'clerk')
  const teamMembers = sorted.filter((s) => s.role === 'staff')

  const slides = [
    mayor.length > 0       && { label: 'นายกเทศมนตรี',   people: mayor,       isMayor: true },
    clerks.length > 0      && { label: 'ปลัดเทศบาล',      people: clerks,      isMayor: true },
    teamMembers.length > 0 && { label: 'ทีมบริการ',        people: teamMembers, isMayor: false },
    deputies.length > 0    && { label: 'ทีมผู้บริหาร',     people: deputies,    isMayor: true },
  ].filter(Boolean)

  // Auto-slide ทุก 3 วินาที — Hook ต้องอยู่ก่อน early return เสมอ
  useEffect(() => {
    if (slides.length <= 1) return
    const timer = setInterval(() => {
      setCurrent((c) => (c + 1) % slides.length)
    }, 3000)
    return () => clearInterval(timer)
  }, [slides.length])

  if (loading || staff.length === 0) return null

  const slide = slides[current] ?? slides[0]

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-6 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />
        <h2 className="text-base font-bold text-gray-700 dark:text-slate-200">ผู้บริหาร</h2>
      </div>

      {/* Carousel */}
      <div className="relative overflow-hidden">
        <div
          key={current}
          className="animate-fade-in"
          style={{ animation: 'fadeSlide 0.4s ease' }}
        >
          {slide.isMayor ? (
            <div className={`grid gap-4 ${
              slide.people.length === 1 ? 'grid-cols-1 max-w-xs mx-auto' :
              slide.people.length === 2 ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3'
            }`}>
              {slide.people.map((p) => <MayorCard key={p.id} person={p} />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {slide.people.map((p) => <StaffCard key={p.id} person={p} />)}
            </div>
          )}
        </div>
      </div>

      {/* Dots */}
      {slides.length > 1 && (
        <div className="flex justify-center items-center gap-2 mt-4">
          {slides.map((s, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className="transition-all duration-300 rounded-full"
              style={{
                width: i === current ? 24 : 8,
                height: 8,
                backgroundColor: i === current ? 'var(--color-primary)' : '#cbd5e1',
              }}
              aria-label={s.label}
            />
          ))}
        </div>
      )}
    </section>
  )
}

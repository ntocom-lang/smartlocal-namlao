import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import HeroBanner from '../components/home/HeroBanner'
import StaffSection from '../components/home/StaffSection'
import ServiceButtons from '../components/home/ServiceButtons'
import NewsSection from '../components/home/NewsSection'
import EmergencyGrid from '../components/home/EmergencyGrid'
import StatCards from '../components/home/StatCards'
import { Info, LayoutDashboard, ChevronRight } from 'lucide-react'

export default function HomePage() {
  const { tenant } = useTenant()
  const [session, setSession] = useState(undefined)
  const [role, setRole] = useState(null)
  const [stats, setStats] = useState({})

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) setRole(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => setRole(data?.role ?? 'citizen'))
  }, [session])

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaints')
      .select('status')
      .eq('municipality_id', tenant.id)
      .then(({ data }) => {
        if (!data) return
        const counts = { total: data.length, completed: 0, received: 0, inProgress: 0 }
        data.forEach(({ status }) => {
          if (status === 'completed') counts.completed++
          else if (status === 'received') counts.received++
          else if (status === 'in_progress') counts.inProgress++
        })
        setStats(counts)
      })
  }, [tenant?.id])

  const isAdmin = role === 'admin' || role === 'superadmin'
  const isViewer = role === 'viewer'

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

      {/* Admin / Viewer banner — full width */}
      {(isAdmin || isViewer) && (
        <a href="/admin"
          className="flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-md active:scale-98 transition-transform"
          style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}
        >
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <LayoutDashboard size={18} className="text-white" />
          </div>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">
              {isViewer ? 'ดูรายงานและคำร้อง' : 'เข้าสู่แผงควบคุม Admin'}
            </p>
            <p className="text-white/70 text-xs">
              {isViewer ? 'รายงานสรุป และรายการคำร้องของหน่วยงาน' : 'จัดการคำร้อง สถานที่ และผู้ใช้งาน'}
            </p>
          </div>
          <ChevronRight size={18} className="text-white/60" />
        </a>
      )}

      {/* 2-column layout on desktop */}
      <div className="flex flex-col md:flex-row md:items-start gap-6">

        {/* ── Main content ── */}
        <div className="flex-1 min-w-0 space-y-5">
          {!session && (
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 dark:bg-blue-900/30 dark:border-blue-700/50 dark:text-blue-200">
              <Info size={16} className="shrink-0 mt-0.5" />
              <p>สมัครสมาชิกเพื่อติดตามสถานะคำร้องของท่าน และรับการแจ้งเตือนทันที</p>
            </div>
          )}
          <HeroBanner />
          <ServiceButtons />
          <StaffSection />

          {/* Mobile-only: News + Emergency below main content */}
          <div className="md:hidden space-y-5">
            <NewsSection />
            <EmergencyGrid />
          </div>
        </div>

        {/* ── Desktop sidebar ── */}
        <aside className="hidden md:flex flex-col gap-5 w-80 lg:w-96 shrink-0">
          <StatCards stats={stats} />
          <NewsSection />
          <EmergencyGrid />
        </aside>

      </div>
    </div>
  )
}

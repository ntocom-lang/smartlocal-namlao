import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import HeroBanner from '../components/home/HeroBanner'
import StaffSection from '../components/home/StaffSection'
import NewsSection from '../components/home/NewsSection'
import TourismSection from '../components/home/TourismSection'
import { Info, LayoutDashboard, ChevronRight, Briefcase, FileText, ClipboardList } from 'lucide-react'
import WeatherWidget from '../components/home/WeatherWidget'

export default function HomePage() {
  const { tenant } = useTenant()
  const [session, setSession] = useState(undefined)
  const [role, setRole] = useState(null)

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

  const isAdmin = role === 'admin' || role === 'superadmin'
  const isViewer = role === 'viewer'
  const isCouncil = role === 'council'
  const isStaff = role === 'staff'

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">

      {/* กลุ่มบนสุด — ชิดกัน */}
      <div className="flex flex-col gap-2">
        <WeatherWidget />

        {(isAdmin || isViewer || isCouncil) && (
          <a href="/admin"
            className="flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-md active:scale-98 transition-transform"
            style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}
          >
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <LayoutDashboard size={18} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-sm">
                {isViewer ? 'ดูรายงานและคำร้อง' : isCouncil ? 'ปฏิทินกิจกรรม' : 'เข้าสู่แผงควบคุม Admin'}
              </p>
              <p className="text-white/70 text-xs">
                {isViewer ? 'รายงานสรุป และรายการคำร้องของหน่วยงาน' : isCouncil ? 'จัดการกิจกรรมของสภาเทศบาล' : 'จัดการคำร้อง สถานที่ และผู้ใช้งาน'}
              </p>
            </div>
            <ChevronRight size={18} className="text-white/60" />
          </a>
        )}

        {isStaff && (
          <a href="/staff"
            className="flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-md active:scale-98 transition-transform"
            style={{ background: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%)' }}
          >
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <Briefcase size={18} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-sm">ระบบเจ้าหน้าที่</p>
              <p className="text-white/70 text-xs">กล่องงาน เอกสาร อนุมัติ รายงาน</p>
            </div>
            <ChevronRight size={18} className="text-white/60" />
          </a>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-2">
          <a href="/doc-request"
            className="flex items-center gap-2.5 bg-white rounded-2xl px-3.5 py-3 shadow-sm border border-gray-100 hover:shadow-md active:scale-[0.98] transition-all">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <FileText size={18} className="text-blue-500" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-gray-800 leading-tight">ขอเอกสาร</p>
              <p className="text-[11px] text-gray-400 leading-tight">ราชการออนไลน์</p>
            </div>
          </a>
          <a href="/complaint"
            className="flex items-center gap-2.5 bg-white rounded-2xl px-3.5 py-3 shadow-sm border border-gray-100 hover:shadow-md active:scale-[0.98] transition-all">
            <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
              <ClipboardList size={18} className="text-red-500" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-gray-800 leading-tight">ยื่นคำร้อง</p>
              <p className="text-[11px] text-gray-400 leading-tight">แจ้งซ่อม / แจ้งเหตุ</p>
            </div>
          </a>
        </div>

        {!session && (
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 dark:bg-blue-900/30 dark:border-blue-700/50 dark:text-blue-200">
            <Info size={16} className="shrink-0 mt-0.5" />
            <p>สมัครสมาชิกเพื่อติดตามสถานะคำร้องของท่าน และรับการแจ้งเตือนทันที</p>
          </div>
        )}

        <HeroBanner />
      </div>
      <StaffSection />
      <NewsSection />
      <TourismSection />
    </div>
  )
}

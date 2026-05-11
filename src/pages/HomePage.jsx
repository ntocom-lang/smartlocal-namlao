import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import StatCards from '../components/home/StatCards'
import HeroBanner from '../components/home/HeroBanner'
import StaffSection from '../components/home/StaffSection'
import ServiceButtons from '../components/home/ServiceButtons'
import NewsSection from '../components/home/NewsSection'
import EmergencyGrid from '../components/home/EmergencyGrid'
import { Info } from 'lucide-react'

export default function HomePage() {
  const { tenant } = useTenant()
  const [stats, setStats] = useState({})
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!tenant?.id) return
    async function fetchStats() {
      const { data } = await supabase
        .from('complaints')
        .select('status')
        .eq('municipality_id', tenant.id)

      if (!data) return
      setStats({
        total:      data.length,
        completed:  data.filter((r) => r.status === 'completed').length,
        received:   data.filter((r) => r.status === 'received').length,
        inProgress: data.filter((r) => r.status === 'in_progress').length,
      })
    }
    fetchStats()
  }, [tenant?.id])

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Notice bar — แสดงเฉพาะคนที่ยังไม่ได้ login */}
      {!session && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 dark:bg-blue-900/30 dark:border-blue-700/50 dark:text-blue-200">
          <Info size={16} className="shrink-0 mt-0.5" />
          <p>สมัครสมาชิกเพื่อติดตามสถานะคำร้องของท่าน และรับการแจ้งเตือนทันที</p>
        </div>
      )}

      <StatCards stats={stats} />
      <HeroBanner />
      <StaffSection />
      <ServiceButtons />
      <NewsSection />
      <EmergencyGrid />
    </div>
  )
}

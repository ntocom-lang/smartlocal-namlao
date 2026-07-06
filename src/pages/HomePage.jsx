import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import PostsHighlight from '../components/home/PostsHighlight'
import TourismSection from '../components/home/TourismSection'
import ComplaintBand from '../components/home/ComplaintBand'
import ShortcutBand from '../components/home/ShortcutBand'
import BannerSlider from '../components/home/BannerSlider'
import { Info, ChevronRight, Briefcase, Megaphone } from 'lucide-react'
import WeatherWidget from '../components/home/WeatherWidget'

const MARQUEE_TEXT = 'บริการประชาชนออนไลน์ ตลอด 24 ชั่วโมง เพื่อใช้เป็นช่องทางในการติดตามข่าวสาร แจ้งเรื่องร้องเรียน และรับบริการต่างๆได้อย่างสะดวก รวดเร็ว และเข้าถึงได้ทุกที่ทุกเวลา'

const marqueeStyle = `
@keyframes marquee {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}`

const BASE_DOC_TYPES = [
  { value: 'residence_cert',  label: 'ใบรับรองการอยู่อาศัย',          emoji: '🏠' },
  { value: 'personal_cert',   label: 'หนังสือรับรองบุคคล',             emoji: '👤' },
  { value: 'conduct_cert',    label: 'หนังสือรับรองความประพฤติ',       emoji: '✅' },
  { value: 'tax_notice',      label: 'ชำระภาษีที่ดินและสิ่งปลูกสร้าง', emoji: '🏦' },
  { value: 'waste_collection', label: 'ชำระค่าธรรมเนียมขยะ',           emoji: '🗑️' },
  { value: 'other',           label: 'คำขออื่นๆ',                      emoji: '📝' },
]

export default function HomePage() {
  const { tenant } = useTenant()
  const { role } = useAuth()

  const isAdmin = role === 'admin' || role === 'superadmin' || role === 'officer'
  const isViewer = role === 'viewer'
  const isCouncil = role === 'council'
  const isStaff = role === 'staff' || role === 'technician'

  const docTypes = useMemo(() => {
    const extras = (tenant?.fee_schedule?._custom_types || []).map(t => ({
      value: t.value, label: t.label, emoji: t.emoji || '📋',
    }))
    return [...BASE_DOC_TYPES, ...extras]
  }, [tenant])

  const [docCounts, setDocCounts] = useState({})
  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('document_requests').select('document_type')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false }).limit(300)
      .then(({ data }) => {
        const c = {}
        ;(data ?? []).forEach(r => { c[r.document_type] = (c[r.document_type] ?? 0) + 1 })
        setDocCounts(c)
      })
  }, [tenant?.id])

  const topDocTypes = useMemo(() =>
    [...docTypes].sort((a, b) => (docCounts[b.value] ?? 0) - (docCounts[a.value] ?? 0))
  , [docTypes, docCounts])

  return (
    <div className="max-w-6xl mx-auto md:px-8 md:py-6 space-y-2 md:space-y-4">

      {/* Hero zone — ยืดขึ้นไปอยู่ใต้ sticky nav (margin-top: -68px) เพื่อให้รูปต่อเนื่อง */}
      <div className="relative overflow-hidden"
        style={tenant?.header_image_url
          ? { marginTop: -100, borderRadius: '0 0 28px 28px', position: 'relative', zIndex: 1 }
          : {}}>
        {tenant?.header_image_url && <>
          <img src={tenant.header_image_url} aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover object-top pointer-events-none" />
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 55%, white 100%)' }} />
        </>}
        <div className={`relative z-10 flex flex-col gap-2 md:gap-3 ${tenant?.header_image_url ? 'px-4 pt-28 pb-3' : 'px-4 py-4'}`}>
          <WeatherWidget transparent={!!tenant?.header_image_url} />
          <BannerSlider />
        </div>
      </div>

      <style>{marqueeStyle}</style>

      {/* ส่วนที่เหลือ — ปกติ */}
      <div className="flex flex-col gap-2 md:gap-3 px-4 md:px-0">

        {/* Staff shortcut — เฉพาะ staff/technician (admin ใช้ icon ใน Header แทน) */}
        {isStaff && (
          <Link to="/staff"
            className="flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-md active:scale-98 transition-transform"
            style={{ background: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%)' }}>
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <Briefcase size={18} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-sm">ระบบเจ้าหน้าที่</p>
              <p className="text-white/70 text-xs">กล่องงาน เอกสาร อนุมัติ รายงาน</p>
            </div>
            <ChevronRight size={18} className="text-white/60" />
          </Link>
        )}

        {!role && (
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
            <Info size={16} className="shrink-0 mt-0.5" />
            <p>สมัครสมาชิกเพื่อติดตามสถานะคำร้องของท่าน และรับการแจ้งเตือนทันที</p>
          </div>
        )}

        {/* E-Service + Marquee + Complaint — ชิดกัน */}
        <div className="flex flex-col gap-1">
          {/* Service Band */}
          <div className="rounded-2xl shadow-xl px-4 py-5 relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 50%, #7dd3fc 100%)' }}>
            <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(186,230,253,0.5) 0%, transparent 70%)' }} />
            <div className="absolute -bottom-8 -left-4 w-36 h-36 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.35) 0%, transparent 70%)' }} />
            <div className="absolute top-0 right-1/3 w-24 h-24 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%)' }} />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-4">
                <p className="text-white text-[11px] font-bold tracking-widest uppercase drop-shadow">✦ E-Service ✦ <span className="normal-case font-medium opacity-80">งานบริการประชาชน</span></p>
                <Link to="/doc-request" className="flex items-center gap-0.5 text-white/80 text-[11px] font-semibold hover:text-white transition-colors">
                  ทั้งหมด <ChevronRight size={13} />
                </Link>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-1 md:flex-wrap md:overflow-x-visible md:pb-0" style={{ scrollbarWidth: 'none' }}>
                {topDocTypes.map(({ value, label, emoji }) => (
                  <Link key={value} to={`/doc-request?type=${value}`}
                    className="flex flex-col items-center gap-2 shrink-0 active:scale-95 transition-transform">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg"
                      style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.08) 100%)', border: '1px solid rgba(255,255,255,0.2)', backdropFilter: 'blur(4px)' }}>
                      {emoji}
                    </div>
                    <p className="text-white text-[10px] font-semibold text-center leading-tight w-16">{label}</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Marquee Band */}
          <div className="flex items-center overflow-hidden rounded-xl shadow-md"
            style={{ background: 'linear-gradient(90deg, #0ea5e9 0%, #38bdf8 40%, #fbbf24 80%, #f59e0b 100%)', height: 36 }}>
            <div className="shrink-0 flex items-center justify-center px-3 h-full"
              style={{ background: 'rgba(255,255,255,0.25)' }}>
              <Megaphone size={16} className="text-white" />
            </div>
            <div className="flex-1 overflow-hidden">
              <span className="whitespace-nowrap text-white text-xs font-medium inline-block"
                style={{ animation: 'marquee 40s linear infinite' }}>
                {MARQUEE_TEXT}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{MARQUEE_TEXT}
              </span>
            </div>
          </div>

          <ComplaintBand />
          <ShortcutBand />
        </div>

        <PostsHighlight />
      </div>{/* end content section */}

      <div className="px-4 md:px-0">
        <TourismSection />
      </div>
    </div>
  )
}

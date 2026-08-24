import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, UserCircle2, Pencil, LogIn, LogOut,
  Bell, FileSearch, ClipboardList, ShieldCheck,
  Phone, Globe, Share2, MessageCircle,
  ChevronRight, ChevronDown, Star, Copy, Download, Check, Monitor, X,
  UploadIcon, PlusSquare, BookOpen, Store, FileText, Briefcase,
  CalendarDays, Luggage, AlertTriangle, Cloud, RefreshCw, Database,
} from 'lucide-react'
import qrCodeImage from '../assets/qr-code.png'
import { supabase } from '../lib/supabase'
import { clearCacheAndReload } from '../lib/clearCache'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { useNotifications } from '../contexts/NotificationsContext'
import SatisfactionModal from '../components/SatisfactionModal'
import KledkaewMore from '../components/citizen/templates/Kledkaew/More'

// ─── QR Share Card ────────────────────────────────────────────────────────

function IOSGuide({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-4"
         onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-gray-800 text-base">เพิ่มลงในหน้าจอหลัก</p>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="space-y-3.5">
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-blue-600">1</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">กดปุ่ม แชร์ ใน Safari</p>
              <p className="text-xs text-gray-400 mt-0.5">ปุ่มรูปกล่องมีลูกศรขึ้น ที่แถบด้านล่าง</p>
              <div className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-lg">
                <UploadIcon size={14} className="text-blue-500" />
                <span className="text-xs text-gray-600 font-medium">Share</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-blue-600">2</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">เลือก "เพิ่มที่หน้าจอโฮม"</p>
              <p className="text-xs text-gray-400 mt-0.5">เลื่อนลงในเมนูที่ปรากฏขึ้น</p>
              <div className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-lg">
                <PlusSquare size={14} className="text-gray-600" />
                <span className="text-xs text-gray-600 font-medium">Add to Home Screen</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-blue-600">3</span>
            </div>
            <p className="text-sm font-semibold text-gray-700 mt-0.5">กด "เพิ่ม" มุมขวาบน</p>
          </div>
        </div>
        <button onClick={onClose}
          className="mt-5 w-full py-3 rounded-2xl font-bold text-sm text-white"
          style={{ background: 'var(--color-primary)' }}>
          เข้าใจแล้ว
        </button>
      </div>
    </div>
  )
}

function QRShareCard({ tenant }) {
  const [copied, setCopied] = useState(false)
  const url = window.location.origin

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  const isAndroid = /Android/i.test(navigator.userAgent)
  const isMobile = isIOS || isAndroid

  async function handleCopy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleShare() {
    if (navigator.share) {
      await navigator.share({ title: tenant?.name || 'SmartLocal', text: 'ระบบศูนย์รวมข้อมูลดิจิทัลเพื่อการพัฒนาอย่างยั่งยืน', url })
    } else {
      handleCopy()
    }
  }

  function handleOpenChrome() {
    const href = window.location.href
    if (isAndroid) {
      const withoutScheme = href.replace(/^https?:\/\//, '')
      window.location.href = `intent://${withoutScheme}#Intent;scheme=https;package=com.android.chrome;end`
    } else if (isIOS) {
      window.location.href = href
        .replace(/^https:\/\//, 'googlechromes://')
        .replace(/^http:\/\//, 'googlechrome://')
    }
    // desktop: ไม่ทำอะไร — scheme นี้ใช้ได้บน mobile เท่านั้น
  }

  function handleDownload() {
    const a = document.createElement('a')
    a.download = `qr-${tenant?.slug ?? 'smartlocal'}.png`
    a.href = tenant?.qr_code_url || qrCodeImage
    a.click()
  }

  return (
    <>
    <div className="rounded-3xl overflow-hidden shadow-lg"
         style={{ background: 'linear-gradient(145deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
      <div className="px-5 pt-6 pb-5 flex flex-col items-center gap-4">
        <div className="flex items-center gap-2">
          <Share2 size={16} className="text-white/80" />
          <p className="text-white font-bold text-base">แชร์บริการออนไลน์</p>
        </div>
        <p className="text-white/70 text-xs text-center -mt-2">
          สแกน QR Code เพื่อเข้าใช้บริการ<br />แชร์ให้เพื่อนหรือครอบครัวได้ง่ายๆ
        </p>

        {/* QR Code */}
        <div className="bg-white rounded-2xl p-4 shadow-md flex flex-col items-center gap-2">
          <img src={tenant?.qr_code_url || qrCodeImage} alt="QR Code" className="w-40 h-40 object-contain" />
          {tenant?.qr_label && (
            <p className="text-xs font-semibold text-gray-600 text-center leading-snug px-1">{tenant.qr_label}</p>
          )}
        </div>

        {/* Buttons */}
        <div className={`grid gap-2.5 w-full ${isMobile ? 'grid-cols-2' : 'grid-cols-3'}`}>
          <button onClick={handleShare}
            className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-white/20 hover:bg-white/30 active:bg-white/40 transition-colors">
            <Share2 size={18} className="text-white" />
            <span className="text-[13px] text-white font-semibold">แชร์ลิงก์</span>
          </button>
          <button onClick={handleCopy}
            className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-white/20 hover:bg-white/30 active:bg-white/40 transition-colors">
            {copied ? <Check size={18} className="text-green-300" /> : <Copy size={18} className="text-white" />}
            <span className="text-[13px] text-white font-semibold">{copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}</span>
          </button>
          <button onClick={handleDownload}
            className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-white/20 hover:bg-white/30 active:bg-white/40 transition-colors">
            <Download size={18} className="text-white" />
            <span className="text-[13px] text-white font-semibold">บันทึก QR</span>
          </button>
          {isMobile && (
            <button onClick={handleOpenChrome}
              className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-white/20 hover:bg-white/30 active:bg-white/40 transition-colors">
              <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
                <path d="M47.5 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h13.2c-.6 3-2.3 5.6-4.9 7.3v6h7.9c4.6-4.3 7.3-10.6 7.3-17.5z" fill="#fff"/>
                <path d="M24 48c6.6 0 12.2-2.2 16.2-5.9l-7.9-6c-2.2 1.5-5 2.3-8.3 2.3-6.4 0-11.8-4.3-13.7-10.1H2.1v6.2C6.1 42.7 14.5 48 24 48z" fill="#ffffffcc"/>
                <path d="M10.3 28.3c-.5-1.5-.8-3-.8-4.3s.3-2.8.8-4.3v-6.2H2.1C.8 16.2 0 19.9 0 24s.8 7.8 2.1 10.5l8.2-6.2z" fill="#ffffffaa"/>
                <path d="M24 9.5c3.6 0 6.8 1.2 9.3 3.6l6.9-6.9C36.2 2.3 30.6 0 24 0 14.5 0 6.1 5.3 2.1 13.5l8.2 6.2C12.2 13.8 17.6 9.5 24 9.5z" fill="#ffffffdd"/>
              </svg>
              <span className="text-[13px] text-white font-semibold">เปิดใน Chrome</span>
            </button>
          )}
        </div>
      </div>
    </div>
    </>
  )
}

// ─── Section + Row helpers ─────────────────────────────────────────────────

// id/isOpen/onToggle ทำให้แต่ละหมวดยุบ/ขยายได้บนมือถือ (หน้ายาวมากตาลาย) — บน PC (md:) เปิดค้างไว้
// เสมอ เพราะจอกว้างพอ ไม่ต้องประหยัดพื้นที่แนวตั้งแบบมือถือ
function Section({ title, id, isOpen, onToggle, children }) {
  return (
    <div>
      {title && (
        <button type="button" onClick={() => onToggle?.(id)}
          className="w-full flex items-center justify-between gap-2 px-4 mb-2 md:pointer-events-none">
          <span className="text-[13px] font-bold text-gray-500 uppercase tracking-wider text-left">{title}</span>
          <ChevronDown size={16}
            className={`text-gray-400 shrink-0 transition-transform md:hidden ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
      <div className={`bg-white rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04)] border border-gray-100 divide-y divide-gray-100 ${isOpen ? 'block' : 'hidden'} md:block`}>
        {children}
      </div>
    </div>
  )
}

function MenuRow({ icon: Icon, iconBg, iconColor = 'text-gray-600', label, desc, badge, href, onClick, danger, external }) {
  const inner = (
    <div className={`flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-gray-50 active:bg-gray-100 ${danger ? 'bg-red-50/50 hover:bg-red-50 active:bg-red-100' : ''}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${iconBg ?? 'bg-gray-100'}`}>
        <Icon size={19} className={danger ? 'text-red-600' : iconColor} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold leading-tight ${danger ? 'text-red-600' : 'text-gray-800'}`}>{label}</p>
        {desc && <p className="text-xs text-gray-500 mt-0.5 leading-snug">{desc}</p>}
      </div>
      {badge != null && badge > 0 && (
        <span className="min-w-5 h-5 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1.5 shrink-0" style={{ backgroundColor: 'var(--color-primary)' }}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {!danger && <ChevronRight size={15} className="text-gray-300 shrink-0" />}
    </div>
  )

  if (href && (href.startsWith('tel:') || external)) {
    return <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>{inner}</a>
  }
  if (href) {
    return <Link to={href}>{inner}</Link>
  }
  return <button className="w-full text-left" onClick={onClick}>{inner}</button>
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function MorePage() {
  const { tenant } = useTenant()

  if (tenant?.ui_style === 'kledkaew') {
    return <KledkaewMore />
  }

  return <NamlaoMorePage />
}

function NamlaoMorePage() {
  const navigate = useNavigate()
  const { tenant } = useTenant()

  const { unreadCount } = useNotifications()
  const { session, role, displayName, avatarUrl } = useAuth()
  const [satComplaintId, setSatComplaintId] = useState(null)
  const [showSat, setShowSat] = useState(false)

  // PWA Install State
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installState, setInstallState] = useState(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    if (isStandalone) return 'installed'
    if (isIOS) return 'installable'
    return 'unknown'
  }) // 'unknown' | 'installable' | 'installed'
  const [showIOSGuide, setShowIOSGuide] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)

  // เปิดค้างไว้แค่หมวดที่ใช้บ่อยที่สุด ("บริการหลัก") ตอนโหลดหน้าครั้งแรก ที่เหลือยุบไว้ก่อน — กันหน้า
  // ยาวเกินจนตาลาย ผู้ใช้กดหัวข้อเพื่อขยายเองได้ (ไม่มีผลบน PC ซึ่งเปิดทุกหมวดค้างไว้เสมอ)
  const [openSections, setOpenSections] = useState(() => new Set(['onedata']))
  function toggleSection(id) {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleClearCache() {
    setClearingCache(true)
    clearCacheAndReload()
  }

  useEffect(() => {
    if (installState !== 'unknown') return

    const handler = (e) => {
      e.preventDefault()
      setInstallPrompt(e)
      setInstallState('installable')
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [installState])

  async function handleInstall() {
    if (isIOS) {
      setShowIOSGuide(true)
      return
    }
    if (!installPrompt) return
    await installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') {
      setInstallState('installed')
      setInstallPrompt(null)
    }
  }

  useEffect(() => {
    if (!session?.user?.id || !tenant?.id) return
    supabase
      .from('complaints')
      .select('id, rating')
      .eq('municipality_id', tenant.id)
      .eq('user_id', session.user.id)
      .in('status', ['completed', 'closed'])
      .limit(10)
      .then(({ data, error }) => {
        if (error || !data?.length) return
        const unrated = data.find(c => c.rating == null && !localStorage.getItem(`sat_done_${c.id}`))
        if (unrated) setSatComplaintId(unrated.id)
      })
  }, [session?.user?.id, tenant?.id])

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/')
  }

  const isAdmin   = role === 'admin' || role === 'superadmin'
  const isStaff   = role === 'staff' || role === 'officer'
  const isViewer  = role === 'viewer'
  const isInternal = ['superadmin', 'admin', 'viewer', 'council', 'officer', 'staff', 'technician', 'kamnan'].includes(role)
  const initials  = (displayName[0] || '?').toUpperCase()

  const hasSocial = tenant?.website_url || tenant?.facebook_url || tenant?.line_oa_url

  return (
    <div className="min-h-screen pb-28 md:pb-8" style={{ backgroundColor: '#eef2f7' }}>
    {showSat && (
      <SatisfactionModal
        complaintId={satComplaintId}
        onClose={() => {
          if (satComplaintId) localStorage.setItem(`sat_done_${satComplaintId}`, '1')
          setShowSat(false)
          setSatComplaintId(null)
        }}
      />
    )}
    {showIOSGuide && <IOSGuide onClose={() => setShowIOSGuide(false)} />}
    <div className="max-w-4xl mx-auto">

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-30 px-4 pt-3 pb-2 bg-gray-50/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">เมนูทั้งหมด</h1>
        </div>
      </div>

      {/* PC header */}
      <div className="hidden md:flex items-center gap-3 px-4 pt-8 pb-5 border-b border-gray-100 mb-2">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0"
             style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
          🗂️
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">เมนูทั้งหมด</h1>
          <p className="text-sm text-gray-500 mt-0.5">บริการและการตั้งค่าทั้งหมด</p>
        </div>
      </div>

      <div className="px-4 pt-2 md:pt-4 md:max-w-6xl md:mx-auto space-y-5">

        {/* ─── User card ─── */}
        {session ? (
          <div className="rounded-3xl overflow-hidden shadow-md"
               style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 60%, color-mix(in srgb, var(--color-primary) 70%, #7c3aed) 100%)' }}>
            <div className="px-5 py-5 flex items-center gap-4">
              {/* Avatar */}
              <div className="relative shrink-0">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="w-14 h-14 rounded-2xl object-cover border-2 border-white/40 shadow-lg" />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-white/20 border-2 border-white/30 flex items-center justify-center text-white text-xl font-bold shadow-lg">
                    {initials}
                  </div>
                )}
                {isAdmin && (
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-amber-400 rounded-full flex items-center justify-center border-2 border-white shadow">
                    <Star size={9} className="text-white" fill="white" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-base leading-tight truncate">{displayName}</p>
                <p className="text-white/70 text-xs mt-0.5 truncate">{session.user?.email}</p>
                {isAdmin && (
                  <span className="inline-flex items-center gap-1 mt-1.5 text-[13px] font-bold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-200 border border-amber-300/30">
                    <Star size={8} fill="currentColor" /> ผู้ดูแลระบบ
                  </span>
                )}
              </div>

              {/* Edit button */}
              <Link to="/profile"
                className="p-2.5 rounded-xl bg-white/15 hover:bg-white/25 transition-colors shrink-0">
                <Pencil size={16} className="text-white" />
              </Link>
            </div>
          </div>
        ) : (
          /* Login CTA */
          <div className="rounded-3xl overflow-hidden shadow-md"
               style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
            <div className="px-5 py-5 flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                <UserCircle2 size={28} className="text-white/80" />
              </div>
              <div className="flex-1">
                <p className="text-white font-bold text-sm">ยังไม่ได้เข้าสู่ระบบ</p>
                <p className="text-white/70 text-xs mt-0.5">เข้าสู่ระบบเพื่อใช้บริการทั้งหมด</p>
              </div>
              <Link to="/auth"
                className="px-4 py-2 rounded-xl bg-white text-xs font-bold transition-colors hover:bg-white/90 shrink-0"
                style={{ color: 'var(--color-primary)' }}>
                เข้าสู่ระบบ
              </Link>
            </div>
          </div>
        )}

        {/* เนื้อหาส่วนที่เหลือใช้ CSS multi-column (ไม่ใช่ grid) บน PC — แต่ละ Section สูงไม่เท่ากัน
            grid-cols-2 ปกติจะจัดแถวชนกันดูรก ส่วนนี้ปล่อยให้ไหลจากบนลงล่างทีละคอลัมน์แทน จบสวยเป็นระเบียบ
            ทุกความสูง ไม่ต้องคำนวณเอง */}
        <div className="space-y-5 md:space-y-0 md:columns-2 md:gap-5 md:*:mb-5 md:*:break-inside-avoid-column">

        {/* ─── ช่องทางออนไลน์ ─── */}
        {hasSocial && (
          <Section title="ช่องทางออนไลน์" id="social" isOpen={openSections.has('social')} onToggle={toggleSection}>
            <div className="px-4 py-4 grid grid-cols-3 gap-3">
              {tenant.website_url && (
                <a href={tenant.website_url} target="_blank" rel="noreferrer"
                   className="flex flex-col items-center gap-2 py-3 rounded-2xl hover:bg-gray-50 active:bg-gray-100 transition-colors">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center shadow-sm">
                    <Globe size={22} className="text-blue-600" />
                  </div>
                  <span className="text-[13px] font-semibold text-gray-600">เว็บไซต์</span>
                </a>
              )}
              {tenant.facebook_url && (
                <a href={tenant.facebook_url} target="_blank" rel="noreferrer"
                   className="flex flex-col items-center gap-2 py-3 rounded-2xl hover:bg-gray-50 active:bg-gray-100 transition-colors">
                  <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center shadow-sm">
                    <Share2 size={22} className="text-white" />
                  </div>
                  <span className="text-[13px] font-semibold text-gray-600">Facebook</span>
                </a>
              )}
              {tenant.line_oa_url && (
                <a href={tenant.line_oa_url} target="_blank" rel="noreferrer"
                   className="flex flex-col items-center gap-2 py-3 rounded-2xl hover:bg-gray-50 active:bg-gray-100 transition-colors">
                  <div className="w-12 h-12 rounded-2xl bg-green-500 flex items-center justify-center shadow-sm">
                    <MessageCircle size={22} className="text-white" />
                  </div>
                  <span className="text-[13px] font-semibold text-gray-600">Line OA</span>
                </a>
              )}
            </div>
          </Section>
        )}

        {/* ─── Admin section ─── */}
        {isAdmin && (
          <Section title="ผู้ดูแลระบบ" id="admin" isOpen={openSections.has('admin')} onToggle={toggleSection}>
            <MenuRow
              icon={ShieldCheck}
              iconBg="bg-amber-100"
              iconColor="text-amber-600"
              label="แผงควบคุม Admin"
              desc="จัดการคำร้อง เจ้าหน้าที่ และข้อมูลระบบ"
              href="/admin"
            />
            <MenuRow
              icon={Briefcase}
              iconBg="bg-sky-100"
              iconColor="text-sky-600"
              label="ระบบเจ้าหน้าที่"
              desc="กล่องงาน เอกสาร อนุมัติ รายงาน"
              href="/staff"
            />
          </Section>
        )}
        {isStaff && (
          <Section title="ระบบเจ้าหน้าที่" id="staff" isOpen={openSections.has('staff')} onToggle={toggleSection}>
            <MenuRow
              icon={Briefcase}
              iconBg="bg-sky-100"
              iconColor="text-sky-600"
              label="ระบบเจ้าหน้าที่"
              desc="กล่องงาน เอกสาร อนุมัติ รายงาน"
              href="/staff"
            />
          </Section>
        )}
        {isViewer && (
          <Section title="ผู้บริหาร" id="viewer" isOpen={openSections.has('viewer')} onToggle={toggleSection}>
            <MenuRow
              icon={ShieldCheck}
              iconBg="bg-emerald-100"
              iconColor="text-emerald-600"
              label="รายงานสรุป"
              desc="ดูรายงานและสถิติคำร้องของหน่วยงาน"
              href="/admin"
            />
          </Section>
        )}
        {isInternal && (
          <Section title="ปฏิทินสำหรับเจ้าหน้าที่" id="calendar" isOpen={openSections.has('calendar')} onToggle={toggleSection}>
            <MenuRow
              icon={CalendarDays}
              iconBg="bg-emerald-100"
              iconColor="text-emerald-600"
              label="จัดการปฏิทินกิจกรรม"
              desc="เพิ่มกำหนดการและแจ้งกลุ่มผู้เกี่ยวข้อง"
              href="/events/manage"
            />
          </Section>
        )}

        {/* ─── One Data ─── */}
        <Section title={tenant?.system_name || `${tenant?.name} One Data`} id="onedata" isOpen={openSections.has('onedata')} onToggle={toggleSection}>
          <MenuRow
            icon={AlertTriangle}
            iconBg="bg-red-100"
            iconColor="text-red-600"
            label="เหตุฉุกเฉิน"
            desc="เบอร์ฉุกเฉิน แจ้งเหตุด่วน ในพื้นที่"
            href="/emergency"
          />
          <MenuRow
            icon={ClipboardList}
            iconBg="bg-orange-100"
            iconColor="text-orange-600"
            label={tenant?.ui_style === 'service_hub' ? 'ร้องเรียน/ร้องทุกข์' : 'แจ้งเหตุ/แจ้งซ่อม'}
            desc="แจ้งซ่อม / ขอน้ำ / แจ้งเหตุสิ่งแวดล้อม"
            href="/complaint"
          />
          <MenuRow
            icon={FileText}
            iconBg="bg-blue-100"
            iconColor="text-blue-600"
            label="สอบถามยอดชำระเรื่องนั้นๆ"
            desc="สอบถามค่าธรรมเนียม / ภาษี / ค่าธรรมเนียมขยะ / ขออนุญาตก่อสร้างบ้าน"
            href="/doc-request"
          />
          <MenuRow
            icon={CalendarDays}
            iconBg="bg-green-100"
            iconColor="text-green-600"
            label="ปฏิทินกิจกรรม"
            desc="กิจกรรมและงานประเพณีของท้องถิ่น"
            href="/events"
          />
          <MenuRow
            icon={Luggage}
            iconBg="bg-orange-100"
            iconColor="text-orange-600"
            label="แหล่งท่องเที่ยว"
            desc="สถานที่ท่องเที่ยว ร้านอาหาร ที่พัก ในพื้นที่"
            href="/tourism"
          />
          <MenuRow
            icon={Store}
            iconBg="bg-amber-100"
            iconColor="text-amber-600"
            label="เที่ยว กิน พัก OTOP"
            desc="ร้านค้า OTOP ที่พัก สถานที่ท่องเที่ยวในชุมชน"
            href="/market"
          />
          <MenuRow
            icon={Store}
            iconBg="bg-orange-100"
            iconColor="text-orange-600"
            label="ลงทะเบียนร้านค้า / ท่องเที่ยว"
            desc="เที่ยว กิน พัก OTOP — ส่งข้อมูลให้เจ้าหน้าที่อนุมัติ"
            href="/business-register"
          />
          <MenuRow
            icon={Database}
            iconBg="bg-indigo-100"
            iconColor="text-indigo-600"
            label="ศูนย์ข้อมูลดิจิทัล"
            desc="แผนที่รวมพิกัด/สถานที่สำคัญทุกชนิดในเขตเทศบาล"
            href="/data-center"
          />
        </Section>

        {/* ─── บริการ ─── */}
        <Section title="บริการอื่นๆ" id="services" isOpen={openSections.has('services')} onToggle={toggleSection}>
          {installState === 'installed' ? (
            <MenuRow
              icon={Check}
              iconBg="bg-green-100"
              iconColor="text-green-600"
              label="ติดตั้งแอปพลิเคชันแล้ว"
              desc="คุณมีแอปพลิเคชันบนหน้าจอหลักของคุณแล้ว"
            />
          ) : installState === 'installable' ? (
            <MenuRow
              icon={isIOS ? UploadIcon : Monitor}
              iconBg="bg-blue-100"
              iconColor="text-blue-600"
              label={isIOS ? 'เพิ่มไปยังหน้าจอโฮม' : 'ติดตั้งแอปพลิเคชัน'}
              desc={isIOS ? 'เพิ่มหน้าเว็บนี้ไปยังหน้าจอโฮม' : 'ติดตั้งระบบลงในเครื่องเพื่อเข้าถึงอย่างรวดเร็ว'}
              onClick={handleInstall}
            />
          ) : null}
          <MenuRow
            icon={RefreshCw}
            iconBg="bg-teal-100"
            iconColor="text-teal-600"
            label={clearingCache ? 'กำลังล้างแคช...' : 'ล้างแคช / อัปเดตเวอร์ชั่นล่าสุด'}
            desc="กดถ้าแอปไม่อัปเดตข้อมูล/ฟีเจอร์ใหม่ ระบบจะโหลดเวอร์ชั่นล่าสุดให้ทันที"
            onClick={clearingCache ? undefined : handleClearCache}
          />
          <MenuRow
            icon={Star}
            iconBg="bg-yellow-100"
            iconColor="text-yellow-600"
            label="ประเมินความพึงพอใจ"
            desc={satComplaintId ? 'มีคำร้องที่ปิดแล้ว รอการประเมิน' : `ให้คะแนนการให้บริการของ${tenant?.name || 'หน่วยงาน'}`}
            onClick={() => satComplaintId ? setShowSat(true) : navigate('/satisfaction')}
          />
          <MenuRow
            icon={Bell}
            iconBg="bg-purple-100"
            iconColor="text-purple-600"
            label="การแจ้งเตือน"
            desc="อัปเดตสถานะคำร้องของคุณ"
            badge={unreadCount}
            onClick={() => navigate('/notifications')}
          />
          <MenuRow
            icon={FileSearch}
            iconBg="bg-blue-100"
            iconColor="text-blue-600"
            label="คำร้องของฉัน"
            desc="ติดตามและดูประวัติคำร้องที่ยื่น"
            href="/my-complaints"
          />
          <MenuRow
            icon={FileText}
            iconBg="bg-sky-100"
            iconColor="text-sky-600"
            label="เอกสารของฉัน"
            desc="ตรวจสอบสถานะใบรับรองและเอกสารราชการ"
            href="/my-docs"
          />
          <MenuRow
            icon={Cloud}
            iconBg="bg-sky-100"
            iconColor="text-sky-600"
            label="สภาพอากาศ"
            desc="ข้อมูลสภาพอากาศและการพยากรณ์ในพื้นที่"
            href="/weather"
          />
          <MenuRow
            icon={BookOpen}
            iconBg="bg-indigo-100"
            iconColor="text-indigo-600"
            label="คู่มือการใช้งาน"
            desc="วิธีการยื่นคำร้องสำหรับประชาชน"
            href="/manual-citizen.html"
            external
          />
        </Section>

        {/* ─── ความโปร่งใส ─── */}
        <Section title="ความโปร่งใส (LPA / ITA)" id="transparency" isOpen={openSections.has('transparency')} onToggle={toggleSection}>
          <MenuRow
            icon={ShieldCheck}
            iconBg="bg-emerald-100"
            iconColor="text-emerald-600"
            label="รายงานการออกเอกสารดิจิทัล"
            desc="สถิติคำขอ อัตราเสร็จสิ้น ระยะเวลาดำเนินการ — LPA ๑.๗"
            href="/doc-stats"
          />
          <MenuRow
            icon={ClipboardList}
            iconBg="bg-emerald-100"
            iconColor="text-emerald-600"
            label="รายงานการจัดการเรื่องร้องเรียน/ร้องทุกข์"
            desc="สถิติการรับเรื่องและระยะเวลาดำเนินการ"
            href="/reports/complaints"
          />
        </Section>

        {/* ─── ข้อมูลหน่วยงาน ─── */}
        <Section title="ติดต่อหน่วยงาน" id="contact" isOpen={openSections.has('contact')} onToggle={toggleSection}>
          <MenuRow
            icon={Phone}
            iconBg="bg-emerald-100"
            iconColor="text-emerald-600"
            label="ติดต่อเรา"
            desc="เบอร์โทรศัพท์ สถานที่ตั้ง และช่องทางโซเชียลมีเดีย"
            href="/contact"
          />
        </Section>

        {/* ─── บัญชีผู้ใช้ ─── */}
        <Section title="บัญชีของฉัน" id="account" isOpen={openSections.has('account')} onToggle={toggleSection}>
          {session ? (
            <>
              <MenuRow
                icon={UserCircle2}
                iconBg="bg-gray-100"
                iconColor="text-gray-600"
                label="โปรไฟล์"
                desc="ข้อมูลส่วนตัวและการตั้งค่า"
                href="/profile"
              />
              <MenuRow
                icon={LogOut}
                iconBg="bg-red-100"
                label="ออกจากระบบ"
                danger
                onClick={handleLogout}
              />
            </>
          ) : (
            <MenuRow
              icon={LogIn}
              iconBg="bg-blue-100"
              iconColor="text-blue-600"
              label="เข้าสู่ระบบ"
              desc="เข้าสู่ระบบเพื่อใช้งานได้เต็มที่"
              href="/auth"
            />
          )}
        </Section>

        </div>

        {/* ─── QR Share ─── */}
        <QRShareCard tenant={tenant} />

        {/* ─── Footer ─── */}
        <div className="text-center pb-2">
          <p className="text-xs text-gray-300 font-medium">{tenant?.name}</p>
          <p className="text-[13px] text-gray-300 mt-0.5">{tenant?.system_name || `${tenant?.name} One Data`} · ระบบข้อมูลเพื่อการพัฒนาที่ยั่งยืน</p>
        </div>
      </div>
    </div>
    </div>
  )
}

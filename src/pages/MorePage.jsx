import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, UserCircle2, Pencil, LogIn, LogOut,
  Bell, FileSearch, ClipboardList, ShieldCheck,
  Phone, MapPin, Globe, Share2, MessageCircle,
  ChevronRight, Star, Copy, Download, Check, Monitor, X,
  UploadIcon, PlusSquare, BookOpen,
} from 'lucide-react'
import { QRCode } from 'react-qr-code'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useNotifications } from '../contexts/NotificationsContext'

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
  const qrRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installState, setInstallState] = useState('unknown') // 'unknown' | 'installable' | 'installed'
  const [showIOSGuide, setShowIOSGuide] = useState(false)
  const url = window.location.origin

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  const isAndroid = /Android/i.test(navigator.userAgent)
  const isMobile = isIOS || isAndroid

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    if (isStandalone) {
      setInstallState('installed')
      return
    }

    // iOS Safari ไม่มี beforeinstallprompt — ต้องแนะนำ manual
    if (isIOS) {
      setInstallState('installable')
      return
    }

    const handler = (e) => {
      e.preventDefault()
      setInstallPrompt(e)
      setInstallState('installable')
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [isIOS])

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

  async function handleCopy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleShare() {
    if (navigator.share) {
      await navigator.share({ title: tenant?.name, text: 'ระบบยื่นคำร้องออนไลน์', url })
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
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return
    const svgData = new XMLSerializer().serializeToString(svg)
    const canvas = document.createElement('canvas')
    canvas.width = 300
    canvas.height = 300
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, 300, 300)
      ctx.drawImage(img, 0, 0, 300, 300)
      const a = document.createElement('a')
      a.download = `qr-${tenant?.slug ?? 'smartlocal'}.png`
      a.href = canvas.toDataURL('image/png')
      a.click()
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
  }

  return (
    <>
    {showIOSGuide && <IOSGuide onClose={() => setShowIOSGuide(false)} />}
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
        <div ref={qrRef} className="bg-white rounded-2xl p-4 shadow-md">
          <QRCode value={url} size={160} />
        </div>

        {/* Install button */}
        {installState === 'installed' ? (
          <div className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/10 border border-white/20">
            <Check size={16} className="text-green-300" />
            <span className="text-sm text-white/80 font-semibold">มีในหน้าจอหลักแล้ว</span>
          </div>
        ) : installState === 'installable' ? (
          <button onClick={handleInstall}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white font-bold text-sm transition-opacity hover:opacity-90 active:opacity-80"
            style={{ color: 'var(--color-primary)' }}>
            <Monitor size={18} />
            เพิ่มลงในหน้าจอหลัก
          </button>
        ) : null}

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

function Section({ title, children }) {
  return (
    <div>
      {title && (
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 mb-1.5">
          {title}
        </p>
      )}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100/80 divide-y divide-gray-100">
        {children}
      </div>
    </div>
  )
}

function MenuRow({ icon: Icon, iconBg, iconColor = 'text-gray-500', label, desc, badge, href, onClick, danger, external }) {
  const inner = (
    <div className={`flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-gray-50 active:bg-gray-100 ${danger ? 'bg-red-50/50 hover:bg-red-50 active:bg-red-100' : ''}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg ?? 'bg-gray-100'}`}>
        <Icon size={18} className={danger ? 'text-red-500' : iconColor} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold leading-tight ${danger ? 'text-red-500' : 'text-gray-800'}`}>{label}</p>
        {desc && <p className="text-xs text-gray-400 mt-0.5 leading-snug">{desc}</p>}
      </div>
      {badge != null && badge > 0 && (
        <span className="min-w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1.5 shrink-0">
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
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const { unreadCount } = useNotifications()
  const [session, setSession] = useState(null)
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
    supabase.from('profiles').select('role').eq('id', session.user.id).single()
      .then(({ data }) => setRole(data?.role ?? 'citizen'))
  }, [session])

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/')
  }

  const isAdmin = role === 'admin' || role === 'superadmin'
  const isViewer = role === 'viewer'
  const displayName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || ''
  const avatarUrl = session?.user?.user_metadata?.avatar_url
  const initials = (displayName[0] || '?').toUpperCase()

  const hasSocial = tenant?.website_url || tenant?.facebook_url || tenant?.line_oa_url

  return (
    <div className="max-w-lg mx-auto pb-28">

      {/* Page header */}
      <div className="sticky top-0 z-30 px-4 pt-3 pb-2 bg-gray-50/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">เมนูทั้งหมด</h1>
        </div>
      </div>

      <div className="px-4 pt-2 space-y-5">

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

        {/* ─── ช่องทางออนไลน์ ─── */}
        {hasSocial && (
          <Section title="ช่องทางออนไลน์">
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
          <Section title="ผู้ดูแลระบบ">
            <MenuRow
              icon={ShieldCheck}
              iconBg="bg-amber-50"
              iconColor="text-amber-500"
              label="แผงควบคุม Admin"
              desc="จัดการคำร้อง เจ้าหน้าที่ และข้อมูลระบบ"
              href="/admin"
            />
          </Section>
        )}
        {isViewer && (
          <Section title="ผู้บริหาร">
            <MenuRow
              icon={ShieldCheck}
              iconBg="bg-emerald-50"
              iconColor="text-emerald-500"
              label="รายงานสรุป"
              desc="ดูรายงานและสถิติคำร้องของหน่วยงาน"
              href="/admin"
            />
          </Section>
        )}

        {/* ─── บริการ ─── */}
        <Section title="บริการ">
          <MenuRow
            icon={Bell}
            iconBg="bg-purple-50"
            iconColor="text-purple-500"
            label="การแจ้งเตือน"
            desc="อัปเดตสถานะคำร้องของคุณ"
            badge={unreadCount}
            onClick={() => navigate('/notifications')}
          />
          <MenuRow
            icon={FileSearch}
            iconBg="bg-blue-50"
            iconColor="text-blue-500"
            label="คำร้องของฉัน"
            desc="ติดตามและดูประวัติคำร้องที่ยื่น"
            href="/my-complaints"
          />
          <MenuRow
            icon={ClipboardList}
            iconBg="bg-green-50"
            iconColor="text-green-600"
            label="ยื่นคำร้องใหม่"
            desc="แจ้งปัญหาหรือขอรับบริการจากเทศบาล"
            href="/complaint"
          />
          <MenuRow
            icon={BookOpen}
            iconBg="bg-indigo-50"
            iconColor="text-indigo-500"
            label="คู่มือการใช้งาน"
            desc="วิธีการยื่นคำร้องสำหรับประชาชน"
            href="/manual-citizen.html"
            external
          />
        </Section>

        {/* ─── ข้อมูลหน่วยงาน ─── */}
        {(tenant?.phone || tenant?.address) && (
          <Section title="ติดต่อหน่วยงาน">
            {tenant.phone && (
              <MenuRow
                icon={Phone}
                iconBg="bg-emerald-50"
                iconColor="text-emerald-500"
                label="โทรศัพท์"
                desc={tenant.phone}
                href={`tel:${tenant.phone}`}
              />
            )}
            {tenant.address && (
              <MenuRow
                icon={MapPin}
                iconBg="bg-orange-50"
                iconColor="text-orange-500"
                label="ที่อยู่"
                desc={tenant.address}
                onClick={() => {}}
              />
            )}
          </Section>
        )}

        {/* ─── บัญชีผู้ใช้ ─── */}
        <Section title="บัญชีของฉัน">
          {session ? (
            <>
              <MenuRow
                icon={UserCircle2}
                iconBg="bg-gray-100"
                iconColor="text-gray-500"
                label="โปรไฟล์"
                desc="ข้อมูลส่วนตัวและการตั้งค่า"
                href="/profile"
              />
              <MenuRow
                icon={LogOut}
                iconBg="bg-red-50"
                label="ออกจากระบบ"
                danger
                onClick={handleLogout}
              />
            </>
          ) : (
            <MenuRow
              icon={LogIn}
              iconBg="bg-blue-50"
              iconColor="text-blue-500"
              label="เข้าสู่ระบบ"
              desc="เข้าสู่ระบบเพื่อใช้งานได้เต็มที่"
              href="/auth"
            />
          )}
        </Section>

        {/* ─── QR Share ─── */}
        <QRShareCard tenant={tenant} />

        {/* ─── Footer ─── */}
        <div className="text-center pb-2">
          <p className="text-xs text-gray-300 font-medium">{tenant?.name}</p>
          <p className="text-[13px] text-gray-300 mt-0.5">SmartLocal E-Service v1.1</p>
        </div>
      </div>
    </div>
  )
}

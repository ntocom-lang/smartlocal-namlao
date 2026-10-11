import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, UserCircle2, Pencil, LogIn, LogOut,
  Bell, FileSearch, ClipboardList, ShieldCheck,
  Phone, Globe, Share2, MessageCircle,
  ChevronRight, Star, Copy, Download, Check, Monitor, X,
  UploadIcon, PlusSquare, BookOpen, Store, FileText, Briefcase,
  CalendarDays, Luggage, AlertTriangle, Cloud, CloudRain, Wind, RefreshCw, Database, Trash2, LayoutGrid,
} from 'lucide-react'
import qrCodeImage from '../assets/qr-code.png'
import { supabase, signOutSafely } from '../lib/supabase'
import { clearCacheAndReload } from '../lib/clearCache'
import { getRankedPaths } from '../lib/menuUsage'
import { moduleForPath } from '../lib/staffModules'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { useNotifications } from '../contexts/NotificationsContext'
import SatisfactionModal from '../components/SatisfactionModal'
import { MenuGroup } from '../components/common/MenuTileGrid'
import KledkaewMore from '../components/citizen/templates/Kledkaew/More'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { AndroidGuide } from '../components/InstallPrompt'

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
      await navigator.share({ title: tenant?.name || 'SmartLocal', text: '✦ E-Service ✦ งานบริการประชาชน', url })
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

// ─── Page ──────────────────────────────────────────────────────────────────

export default function MorePage() {
  const { tenant } = useTenant()

  if (tenant?.ui_style === 'kledkaew') {
    return <><div className="px-4 pt-4"><Link to="/pm25" className="flex min-h-[44px] items-center gap-2 rounded-xl bg-sky-50 px-4 py-3 font-semibold text-sky-800"><Wind size={20} />สถานการณ์ PM2.5<ChevronRight size={18} className="ml-auto" /></Link></div><KledkaewMore /></>
  }

  return <NamlaoMorePage />
}

function NamlaoMorePage() {
  const navigate = useNavigate()
  const { tenant, isModuleEnabled } = useTenant()

  const { unreadCount } = useNotifications()
  const { session, role, displayName, avatarUrl } = useAuth()
  const [satComplaintId, setSatComplaintId] = useState(null)
  const [showSat, setShowSat] = useState(false)

  // PWA Install State
  const { mode: installMode, install } = useInstallPrompt()
  const isIOS = installMode === 'manual-ios'
  const installState = installMode === 'installed' ? 'installed' : installMode === 'hidden' ? 'unknown' : 'installable'
  const [showIOSGuide, setShowIOSGuide] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)

  function handleClearCache() {
    setClearingCache(true)
    clearCacheAndReload()
  }

  async function handleInstall() {
    if (await install() === 'guide') setShowIOSGuide(true)
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
    await signOutSafely('/')
    navigate('/')
  }

  const isAdmin   = role === 'admin' || role === 'superadmin'
  // technician นับรวมด้วย — ช่างคือเจ้าหน้าที่กองช่าง เข้าระบบเจ้าหน้าที่ได้เหมือนกอง อื่น
  const isStaff   = role === 'staff' || role === 'officer' || role === 'technician'
  const isViewer  = role === 'viewer'
  const isInternal = ['superadmin', 'admin', 'viewer', 'council', 'officer', 'staff', 'technician'].includes(role)
  const initials  = (displayName[0] || '?').toUpperCase()

  // ─── เมนูที่ใช้บ่อย ─── ต้อง sync path กับ TRACKABLE_PATHS ใน src/lib/menuUsage.js (path ไหนไม่อยู่
  // ในนั้น จะไม่ถูกนับ ต่อให้ใส่ไว้ในนี้ก็ตาม) DEFAULT_QUICK_PATHS ใช้ตอนยังไม่มีประวัติการใช้งานเลย
  // (ผู้ใช้ใหม่/เพิ่งล้าง cache) เรียงตามที่คาดว่าจำเป็นที่สุดของงานบริการประชาชนทั่วไป
  // color = สีประจำเมนู (hex) — MenuTileGrid ไล่เฉดและปรับให้ไอคอนขาวอ่านออกเอง (src/lib/menuTileColor.js)
  const QUICK_MENU_CATALOG = [
    { path: '/emergency', icon: AlertTriangle, color: '#dc2626', label: 'สายด่วนฉุกเฉิน' },
    { path: '/complaint', icon: ClipboardList, color: '#ea580c', label: 'ร้องเรียน/ร้องทุกข์' },
    { path: '/doc-request', icon: FileText, color: '#2563eb', label: 'สอบถามยอดชำระ' },
    { path: '/my-complaints', icon: FileSearch, color: '#0284c7', label: 'คำร้องของฉัน' },
    { path: '/events', icon: CalendarDays, color: '#16a34a', label: 'ปฏิทินกิจกรรม' },
    { path: '/tourism', icon: Luggage, color: '#ea580c', label: 'เที่ยว กิน พัก ช้อป บริการ' },
    { path: '/data-center', icon: Database, color: '#4f46e5', label: 'ศูนย์ข้อมูลดิจิทัล' },
    { path: '/my-docs', icon: FileText, color: '#0284c7', label: 'เอกสารของฉัน' },
    { path: '/weather', icon: Cloud, color: '#0284c7', label: 'สภาพอากาศ' },
    { path: '/pm25', icon: Wind, color: '#0284c7', label: 'สถานการณ์ PM2.5' },
    { path: '/contact', icon: Phone, color: '#059669', label: 'ติดต่อเรา' },
    { path: '/notifications', icon: Bell, color: '#9333ea', label: 'แจ้งเตือน' },
    { path: '/waste', icon: Trash2, color: '#059669', label: 'ตารางวันเก็บขยะ' },
    { path: '/water-situation', icon: CloudRain, color: '#0284c7', label: 'สถานการณ์น้ำ-ฝน' },
  ]
  const DEFAULT_QUICK_PATHS = ['/complaint', '/emergency', '/doc-request', '/my-complaints']
  // อ่าน localStorage แบบ lazy initializer ของ useState (sync, ครั้งเดียวตอน mount) แทน useEffect+setState
  // เพราะไม่ใช่การ subscribe ค่าที่เปลี่ยนได้จากภายนอกระหว่างหน้านี้เปิดอยู่ — ตรง React's "คุณอาจไม่ต้อง
  // ใช้ Effect" และเลี่ยง react-hooks/set-state-in-effect
  const [quickPaths] = useState(() => {
    const ranked = getRankedPaths().filter(p => QUICK_MENU_CATALOG.some(c => c.path === p))
    return [...ranked, ...DEFAULT_QUICK_PATHS.filter(p => !ranked.includes(p))].slice(0, 4)
  })
  // กรองโมดูลที่ปิดออกหลังจัดอันดับแล้ว (ไม่ใช่ก่อน) เพราะประวัติการใช้งานใน localStorage เป็นของ
  // เครื่องผู้ใช้ อาจมี path ของโมดูลที่หน่วยงานเพิ่งปิดค้างอยู่ ต้องไม่โผล่มาเป็นเมนูใช้บ่อย
  const quickItems = quickPaths
    .map(p => QUICK_MENU_CATALOG.find(c => c.path === p))
    .filter(Boolean)
    .filter(item => {
      const key = moduleForPath(item.path)
      return !key || isModuleEnabled(key)
    })

  // ─── เมนูทั้งหมด (กริดไอคอน — MenuTileGrid.jsx) ───
  // กรองเมนูของโมดูลที่ อปท. นี้ไม่ได้เปิดใช้งาน "ก่อนวาด" (เดิม MenuRow ซ่อนตัวเองทีละแถว) เพื่อให้เลข
  // "N เมนู" ที่หัวกลุ่มตรงกับที่เห็นจริง และกลุ่มที่ไม่เหลือเมนูไม่ขึ้นหัวเปล่า · ลิงก์นอก (external) กับเมนูที่เป็น
  // ปุ่มกด (onClick) ไม่ผูกกับโมดูลจึงไม่ถูกกรอง เหมือนเดิม · desc = คำอธิบายเดิมใต้ชื่อเมนู ไม่โชว์บนจอแต่ให้
  // โปรแกรมอ่านหน้าจออ่าน (ดูเหตุผลใน MenuTileGrid.jsx) — ห้ามตัดทิ้ง เพราะชื่อบางเมนูสั้นจนไม่ชัดถ้าไม่มีคำอธิบาย
  const moduleOn = path => {
    const key = moduleForPath(path)
    return !key || isModuleEnabled(key)
  }
  const staffSystemItem = {
    key: 'staff-system', label: 'ระบบเจ้าหน้าที่', desc: 'กล่องงาน เอกสาร อนุมัติ รายงาน',
    Icon: Briefcase, color: '#0284c7', to: '/staff',
  }
  const menuGroups = [
    { id: 'social', title: 'ช่องทางออนไลน์', Icon: Globe, color: '#2563eb', items: [
      tenant?.website_url && { key: 'website', label: 'เว็บไซต์', Icon: Globe, color: '#2563eb', href: tenant.website_url, external: true },
      tenant?.facebook_url && { key: 'facebook', label: 'Facebook', Icon: Share2, color: '#1d4ed8', href: tenant.facebook_url, external: true },
      tenant?.line_oa_url && { key: 'line', label: 'Line OA', Icon: MessageCircle, color: '#16a34a', href: tenant.line_oa_url, external: true },
    ] },
    { id: 'admin', title: 'ผู้ดูแลระบบ', Icon: ShieldCheck, color: '#d97706', show: isAdmin, items: [
      { key: 'admin-panel', label: 'แผงควบคุม Admin', desc: 'จัดการคำร้อง เจ้าหน้าที่ และข้อมูลระบบ', Icon: ShieldCheck, color: '#d97706', to: '/admin' },
      staffSystemItem,
    ] },
    { id: 'staff', title: 'ระบบเจ้าหน้าที่', Icon: Briefcase, color: '#0284c7', show: isStaff, items: [staffSystemItem] },
    { id: 'viewer', title: 'ผู้บริหาร', Icon: ShieldCheck, color: '#059669', show: isViewer, items: [
      { key: 'viewer-report', label: 'รายงานสรุป', desc: 'ดูรายงานและสถิติคำร้องของหน่วยงาน', Icon: ShieldCheck, color: '#059669', to: '/admin' },
    ] },
    { id: 'calendar', title: 'ปฏิทินสำหรับเจ้าหน้าที่', Icon: CalendarDays, color: '#059669', show: isInternal, items: [
      { key: 'events-manage', label: 'จัดการปฏิทินกิจกรรม', desc: 'เพิ่มกำหนดการและแจ้งกลุ่มผู้เกี่ยวข้อง', Icon: CalendarDays, color: '#059669', to: '/events/manage' },
    ] },
    { id: 'onedata', title: tenant?.system_name || `${tenant?.name} One Data`, Icon: Database, color: '#4f46e5', items: [
      { key: 'emergency', label: 'สายด่วนฉุกเฉิน', desc: 'รวมเบอร์โทรฉุกเฉินในพื้นที่', Icon: AlertTriangle, color: '#dc2626', to: '/emergency' },
      { key: 'complaint', label: 'ร้องเรียน/ร้องทุกข์', desc: 'แจ้งซ่อม / ขอน้ำ / แจ้งเหตุสิ่งแวดล้อม', Icon: ClipboardList, color: '#ea580c', to: '/complaint' },
      { key: 'doc-request', label: 'สอบถามยอดชำระเรื่องนั้นๆ', desc: 'สอบถามค่าธรรมเนียม / ภาษี / ค่าธรรมเนียมขยะ / ขออนุญาตก่อสร้างบ้าน', Icon: FileText, color: '#2563eb', to: '/doc-request' },
      { key: 'events', label: 'ปฏิทินกิจกรรม', desc: 'กิจกรรมและงานประเพณีของท้องถิ่น', Icon: CalendarDays, color: '#16a34a', to: '/events' },
      { key: 'tourism', label: 'เที่ยว กิน พัก ช้อป บริการ', desc: 'ที่เที่ยว ร้านอาหาร ที่พัก OTOP ของฝาก และช่าง/บริการในพื้นที่', Icon: Luggage, color: '#ea580c', to: '/tourism' },
      { key: 'business-register', label: 'ลงทะเบียนร้านค้า / ท่องเที่ยว', desc: 'เที่ยว กิน พัก ช้อป บริการ — ส่งข้อมูลให้เจ้าหน้าที่อนุมัติ', Icon: Store, color: '#ea580c', to: '/business-register' },
      { key: 'data-center', label: 'ศูนย์ข้อมูลดิจิทัล', desc: 'แผนที่รวมพิกัด/สถานที่สำคัญทุกชนิดในเขตเทศบาล', Icon: Database, color: '#4f46e5', to: '/data-center' },
    ] },
    { id: 'services', title: 'บริการอื่นๆ', Icon: LayoutGrid, color: '#0284c7', items: [
      installState === 'installed' && {
        key: 'install-done', label: 'ติดตั้งแอปพลิเคชันแล้ว', desc: 'คุณมีแอปพลิเคชันบนหน้าจอหลักของคุณแล้ว', Icon: Check, color: '#16a34a',
      },
      installState === 'installable' && {
        key: 'install', label: isIOS ? 'เพิ่มไปยังหน้าจอโฮม' : 'ติดตั้งแอปพลิเคชัน',
        desc: isIOS ? 'เพิ่มหน้าเว็บนี้ไปยังหน้าจอโฮม' : 'ติดตั้งระบบลงในเครื่องเพื่อเข้าถึงอย่างรวดเร็ว',
        Icon: isIOS ? UploadIcon : Monitor, color: '#2563eb', onClick: handleInstall,
      },
      {
        key: 'clear-cache', label: clearingCache ? 'กำลังล้างแคช...' : 'ล้างแคช / อัปเดตเวอร์ชั่นล่าสุด',
        desc: 'กดถ้าแอปไม่อัปเดตข้อมูล/ฟีเจอร์ใหม่ ระบบจะโหลดเวอร์ชั่นล่าสุดให้ทันที',
        Icon: RefreshCw, color: '#0d9488', onClick: clearingCache ? undefined : handleClearCache,
      },
      {
        key: 'satisfaction', label: 'ประเมินความพึงพอใจ',
        desc: satComplaintId ? 'มีคำร้องที่ปิดแล้ว รอการประเมิน' : `ให้คะแนนการให้บริการของ${tenant?.name || 'หน่วยงาน'}`,
        Icon: Star, color: '#ca8a04', onClick: () => satComplaintId ? setShowSat(true) : navigate('/satisfaction'),
      },
      { key: 'notifications', label: 'การแจ้งเตือน', desc: 'อัปเดตสถานะคำร้องของคุณ', Icon: Bell, color: '#9333ea', badge: unreadCount, onClick: () => navigate('/notifications') },
      { key: 'my-complaints', label: 'คำร้องของฉัน', desc: 'ติดตามและดูประวัติคำร้องที่ยื่น', Icon: FileSearch, color: '#2563eb', to: '/my-complaints' },
      { key: 'my-docs', label: 'เอกสารของฉัน', desc: 'ตรวจสอบสถานะใบรับรองและเอกสารราชการ', Icon: FileText, color: '#0284c7', to: '/my-docs' },
      { key: 'weather', label: 'สภาพอากาศ', desc: 'ข้อมูลสภาพอากาศและการพยากรณ์ในพื้นที่', Icon: Cloud, color: '#0284c7', to: '/weather' },
      { key: 'pm25', label: 'สถานการณ์ PM2.5', desc: 'ค่าฝุ่นและคุณภาพอากาศจากสถานี Air4Thai', Icon: Wind, color: '#0284c7', to: '/pm25' },
      { key: 'water-situation', label: 'สถานการณ์น้ำ-ฝน', desc: 'ปริมาณฝนและระดับน้ำจากสถานีตรวจวัดใกล้พื้นที่', Icon: CloudRain, color: '#0284c7', to: '/water-situation' },
      { key: 'manual', label: 'คู่มือการใช้งาน', desc: 'วิธีการยื่นคำร้องสำหรับประชาชน', Icon: BookOpen, color: '#4f46e5', href: '/manual-citizen.html', external: true },
    ] },
    { id: 'transparency', title: 'ความโปร่งใส (LPA / ITA)', Icon: ShieldCheck, color: '#059669', items: [
      { key: 'doc-stats', label: 'รายงานการออกเอกสารดิจิทัล', desc: 'สถิติคำขอ อัตราเสร็จสิ้น ระยะเวลาดำเนินการ — LPA ๑.๗', Icon: ShieldCheck, color: '#059669', to: '/doc-stats' },
      { key: 'complaint-report', label: 'รายงานการจัดการเรื่องร้องเรียน/ร้องทุกข์', desc: 'สถิติการรับเรื่องและระยะเวลาดำเนินการ', Icon: ClipboardList, color: '#059669', to: '/reports/complaints' },
    ] },
    { id: 'contact', title: 'ติดต่อหน่วยงาน', Icon: Phone, color: '#059669', items: [
      { key: 'contact', label: 'ติดต่อเรา', desc: 'เบอร์โทรศัพท์ สถานที่ตั้ง และช่องทางโซเชียลมีเดีย', Icon: Phone, color: '#059669', to: '/contact' },
    ] },
    { id: 'account', title: 'บัญชีของฉัน', Icon: UserCircle2, color: '#475569', items: session ? [
      { key: 'profile', label: 'โปรไฟล์', desc: 'ข้อมูลส่วนตัวและการตั้งค่า', Icon: UserCircle2, color: '#475569', to: '/profile' },
      { key: 'logout', label: 'ออกจากระบบ', Icon: LogOut, danger: true, onClick: handleLogout },
    ] : [
      { key: 'login', label: 'เข้าสู่ระบบ', desc: 'เข้าสู่ระบบเพื่อใช้งานได้เต็มที่', Icon: LogIn, color: '#2563eb', to: '/auth' },
    ] },
  ]
    .filter(group => group.show !== false)
    .map(group => ({ ...group, items: group.items.filter(Boolean).filter(item => !item.to || moduleOn(item.to)) }))
    .filter(group => group.items.length > 0)

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
    {showIOSGuide && (isIOS ? <IOSGuide onClose={() => setShowIOSGuide(false)} /> : <AndroidGuide onClose={() => setShowIOSGuide(false)} />)}
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

        {/* ─── เมนูที่ใช้บ่อย ─── จัดอันดับจากพฤติกรรมจริงของแต่ละคน (ดู quickItems ด้านบน + src/lib/menuUsage.js)
            อยู่บนสุดเสมอ กดใช้ได้ทันที — 4 คอลัมน์เพราะเป็นแถวทางลัด (กลุ่มด้านล่างใช้ 3 คอลัมน์ ปุ่มใหญ่กว่า) */}
        <MenuGroup title="เมนูที่ใช้งานบ่อย" Icon={Star} color="#f59e0b" layout="quick"
          items={quickItems.map(item => ({ key: item.path, label: item.label, Icon: item.icon, color: item.color, to: item.path }))} />

        {/* เนื้อหาส่วนที่เหลือใช้ CSS multi-column (ไม่ใช่ grid) บน PC — แต่ละกลุ่มสูงไม่เท่ากัน
            grid-cols-2 ปกติจะจัดแถวชนกันดูรก ส่วนนี้ปล่อยให้ไหลจากบนลงล่างทีละคอลัมน์แทน จบสวยเป็นระเบียบ
            ทุกความสูง ไม่ต้องคำนวณเอง */}
        <div className="space-y-5 md:space-y-0 md:columns-2 md:gap-5 md:*:mb-5 md:*:break-inside-avoid-column">
          {menuGroups.map(group => (
            <MenuGroup key={group.id} title={group.title} Icon={group.Icon} color={group.color}
              layout="citizen" items={group.items} />
          ))}
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

import { lazy, Suspense, useCallback, useEffect, useRef, useState, Component } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { TenantProvider, useTenant } from './contexts/TenantContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import Header from './components/layout/Header'
import Footer from './components/layout/Footer'
import ModuleGuard from './components/common/ModuleGuard'
import BottomNav from './components/layout/BottomNav'
import CitizenSidebar from './components/layout/CitizenSidebar'
import InstallPrompt from './components/InstallPrompt'
import ScrollToTopButton from './components/ScrollToTopButton'
import InAppBrowserGate from './components/InAppBrowserGate'
import { supabase, initialAuthParams } from './lib/supabase'
import { fetchProfile } from './lib/profileFetch'
import { Phone, UserRound } from 'lucide-react'
import { NAME_TITLES, splitThaiFullName, joinThaiFullName } from './lib/thaiName'
import { recordVisit } from './lib/menuUsage'
import { BASENAME } from './lib/basename'

const HomePage = lazyWithRetry(() => import('./pages/HomePage'))
const CitizenForm = lazyWithRetry(() => import('./pages/CitizenForm'))
const ComplaintCategory = lazyWithRetry(() => import('./pages/ComplaintCategory'))
const OneDataLanding = lazyWithRetry(() => import('./pages/OneDataLanding'))
const BusinessRegisterPage = lazyWithRetry(() => import('./pages/BusinessRegisterPage'))
const MarketPage = lazyWithRetry(() => import('./pages/MarketPage'))
const AdminLogin = lazyWithRetry(() => import('./pages/AdminLogin'))
const DevJournal = lazyWithRetry(() => import('./pages/DevJournal'))
const MapEngineDemoPage = lazyWithRetry(() => import('./pages/MapEngineDemoPage'))
const AuthPage = lazyWithRetry(() => import('./pages/AuthPage'))
const ResetPasswordPage = lazyWithRetry(() => import('./pages/ResetPasswordPage'))
const DeviceLoginApprove = lazyWithRetry(() => import('./pages/DeviceLoginApprove'))

const SatisfactionPage = lazyWithRetry(() => import('./pages/SatisfactionPage'))
const TechnicianDashboard = lazyWithRetry(() => import('./pages/TechnicianDashboard'))
const ProfilePage = lazyWithRetry(() => import('./pages/ProfilePage'))
const MyComplaints = lazyWithRetry(() => import('./pages/MyComplaints'))
const MorePage = lazyWithRetry(() => import('./pages/MorePage'))
const NotificationsPage = lazyWithRetry(() => import('./pages/NotificationsPage'))
const WeatherPage = lazyWithRetry(() => import('./pages/WeatherPage'))
const EventsPage = lazyWithRetry(() => import('./pages/EventsPage'))
const EventsManager = lazyWithRetry(() => import('./components/admin/EventsManager'))
const EmergencyPage = lazyWithRetry(() => import('./pages/EmergencyPage'))
const TourismPage = lazyWithRetry(() => import('./pages/TourismPage'))
const TourismDetailPage = lazyWithRetry(() => import('./pages/TourismDetailPage'))
const ContactPage = lazyWithRetry(() => import('./pages/ContactPage'))
const CitizenDocRequest = lazyWithRetry(() => import('./pages/CitizenDocRequest'))
const MyDocRequests = lazyWithRetry(() => import('./pages/MyDocRequests'))
const LpaDocStats = lazyWithRetry(() => import('./pages/LpaDocStats'))
const ComplaintStats = lazyWithRetry(() => import('./pages/ComplaintStats'))
const ReportsHub = lazyWithRetry(() => import('./pages/ReportsHub'))
const PostsPage = lazyWithRetry(() => import('./pages/PostsPage'))
const FleetPage = lazyWithRetry(() => import('./pages/FleetPage'))
const ChatbotPage = lazyWithRetry(() => import('./pages/ChatbotPage'))

// required = บัญชีนี้ไม่มีอีเมลเลย เบอร์โทรจึงเป็นตัวระบุตัวตนชิ้นเดียวที่เหลือ ข้ามไม่ได้
// (เหตุผลเต็มอยู่ที่จุดเรียก setPhoneReminderRequired ใน checkAndFixProfile)
function PhoneReminderModal({ onClose, required = false }) {
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!/^0[0-9]{8,9}$/.test(phone.trim())) {
      setError('กรุณากรอกเบอร์มือถือให้ถูกต้อง เช่น 0812345678')
      return
    }
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setSaving(false); return }
    const { error: err } = await supabase
      .from('profiles')
      .upsert({ id: session.user.id, phone: phone.trim() }, { onConflict: 'id' })
    setSaving(false)
    if (err) { setError(`บันทึกไม่สำเร็จ: ${err.message}`); return }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-999 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-16 h-16 rounded-full flex items-center justify-center"
               style={{ backgroundColor: 'var(--color-primary)' }}>
            <Phone size={30} className="text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-800">เพิ่มเบอร์มือถือ</h2>
          {required ? (
            <p className="text-sm text-gray-500 leading-relaxed">
              บัญชีที่สมัครด้วย LINE ไม่มีอีเมลติดมาด้วย<br />
              กรอกเบอร์มือถือไว้ <strong className="text-gray-700">เพื่อให้กู้บัญชีคืนได้</strong>
              หากวันหนึ่งเข้าแอป LINE ไม่ได้<br />
              และเพื่อให้เจ้าหน้าที่ติดต่อกลับเรื่องคำร้องของท่าน
            </p>
          ) : (
            <p className="text-sm text-gray-500 leading-relaxed">
              กรอกเบอร์มือถือเพื่อให้เจ้าหน้าที่ติดต่อกลับ<br />
              และติดตามสถานะคำร้องของท่านได้สะดวกขึ้น
            </p>
          )}

          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError('') }}
            placeholder="เช่น 0812345678"
            maxLength={10}
            className="w-full mt-1 px-4 py-4 text-center text-2xl font-bold tracking-widest border-2 rounded-2xl focus:outline-none transition-colors"
            style={{ borderColor: error ? '#ef4444' : phone ? 'var(--color-primary)' : '#e5e7eb', color: '#000', backgroundColor: '#fff' }}
            autoFocus
          />
          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving || !phone}
            className="w-full py-4 rounded-2xl font-bold text-white text-base mt-1 disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? 'กำลังบันทึก...' : 'บันทึกเบอร์มือถือ'}
          </button>
          {!required && (
            <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600 py-1">
              ข้ามไปก่อน
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function NameReminderModal({ initialFullName, onClose }) {
  const initial = splitThaiFullName(initialFullName)
  const [title, setTitle] = useState(initial.title)
  const [first, setFirst] = useState(initial.first)
  const [last, setLast] = useState(initial.last)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!first.trim() || !last.trim()) {
      setError('กรุณากรอกทั้งชื่อและนามสกุล')
      return
    }
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setSaving(false); return }
    const { error: err } = await supabase
      .from('profiles')
      .upsert({ id: session.user.id, full_name: joinThaiFullName(title, first, last) }, { onConflict: 'id' })
    setSaving(false)
    if (err) { setError(`บันทึกไม่สำเร็จ: ${err.message}`); return }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-999 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-16 h-16 rounded-full flex items-center justify-center"
               style={{ backgroundColor: 'var(--color-primary)' }}>
            <UserRound size={30} className="text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-800">กรอกชื่อ-นามสกุลให้ครบ</h2>
          <p className="text-sm text-gray-500 leading-relaxed">
            เจ้าหน้าที่ต้องใช้ชื่อ-นามสกุลที่ครบถ้วน<br />
            เพื่อออกเอกสาร/ติดตามคำร้องของท่านให้ถูกต้อง
          </p>

          <div className="w-full flex gap-2">
            <select value={title} onChange={(e) => { setTitle(e.target.value); setError('') }}
              className="w-24 shrink-0 px-2 py-3 border-2 rounded-xl text-sm focus:outline-none transition-colors"
              style={{ borderColor: '#e5e7eb', color: '#000', backgroundColor: '#fff' }}>
              <option value="">คำนำหน้า</option>
              {NAME_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              type="text"
              value={first}
              onChange={(e) => { setFirst(e.target.value); setError('') }}
              placeholder="ชื่อ"
              className="flex-1 min-w-0 px-3 py-3 border-2 rounded-xl text-sm focus:outline-none transition-colors"
              style={{ borderColor: error && !first.trim() ? '#ef4444' : '#e5e7eb', color: '#000', backgroundColor: '#fff' }}
              autoFocus
            />
          </div>
          <input
            type="text"
            value={last}
            onChange={(e) => { setLast(e.target.value); setError('') }}
            placeholder="นามสกุล"
            className="w-full px-3 py-3 border-2 rounded-xl text-sm focus:outline-none transition-colors"
            style={{ borderColor: error && !last.trim() ? '#ef4444' : '#e5e7eb', color: '#000', backgroundColor: '#fff' }}
          />
          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving || !first.trim() || !last.trim()}
            className="w-full py-4 rounded-2xl font-bold text-white text-base mt-1 disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? 'กำลังบันทึก...' : 'บันทึกชื่อ-นามสกุล'}
          </button>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600 py-1">
            ข้ามไปก่อน
          </button>
        </div>
      </div>
    </div>
  )
}

// ── จำการกด "ข้ามไปก่อน" ของกล่องเตือนโปรไฟล์ ───────────────────────────────────
//
// ของเดิมไม่มีที่จำเลย พอผู้ใช้กดข้าม กล่องก็เด้งกลับมาใหม่ทุกครั้งที่ checkAndFixProfile() ถูก
// เรียก (ซึ่งเกิดขึ้นทุกครั้งที่เปลี่ยนหน้า — ดูเหตุผลที่ useEffect ของ auth ใน AppShell)
// เจ้าหน้าที่ที่ไม่มีเบอร์ในโปรไฟล์จึงถูก overlay ของ onboarding ประชาชนบังหน้าปฏิบัติงานทุกหน้า
//
// ผูก key กับ user id เพื่อไม่ให้การสลับบัญชีบนเครื่องเดียวกันสืบทอดการข้ามของคนก่อนหน้า
// และใช้ sessionStorage (ไม่ใช่ local) เพื่อให้ปิดแท็บ/ล็อกอินรอบใหม่แล้วเตือนอีกได้ตามนโยบาย
function reminderSkipKey(kind, uid) {
  return `sl-reminder-skipped-${kind}:${uid}`
}

function isReminderSkipped(kind, uid) {
  try {
    return sessionStorage.getItem(reminderSkipKey(kind, uid)) === '1'
  } catch {
    // เครื่องที่ปิด storage ไว้ ยอมให้เตือนซ้ำดีกว่าพังทั้งหน้า
    return false
  }
}

function markReminderSkipped(kind, uid) {
  if (!uid) return
  try {
    sessionStorage.setItem(reminderSkipKey(kind, uid), '1')
  } catch {
    // ไม่มีอะไรให้ทำต่อ
  }
}

function clearReminderSkips() {
  try {
    const keys = []
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i)
      if (key?.startsWith('sl-reminder-skipped-')) keys.push(key)
    }
    keys.forEach((key) => sessionStorage.removeItem(key))
  } catch {
    // ไม่มีอะไรให้ทำต่อ
  }
}

// retry once on ChunkLoadError (iOS network instability)
function lazyWithRetry(fn) {
  return lazy(() => fn().catch(() => new Promise(r => setTimeout(r, 800)).then(() => fn())))
}

const AdminDashboard = lazyWithRetry(() => import('./pages/AdminDashboard'))
const StaffDashboard  = lazyWithRetry(() => import('./pages/StaffDashboard'))
const DataCenterDashboard = lazyWithRetry(() => import('./pages/DataCenterDashboard'))
const DataCenterLanding = lazyWithRetry(() => import('./pages/DataCenterLanding'))
const DataCenterPublicMap = lazyWithRetry(() => import('./pages/DataCenterPublicMap'))

class SuspenseErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch() { this.setState({ error: true }) }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6 text-center">
          <span className="text-4xl">📶</span>
          <p className="text-gray-500 text-sm">โหลดหน้าไม่สำเร็จ<br/>อาจเกิดจากสัญญาณขาดช่วง</p>
          <button onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            กดเพื่อลองใหม่
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function HomeOrTechRedirect() {
  return <HomePage />
}


const INTERNAL_EVENT_ROLES = ['superadmin', 'admin', 'viewer', 'council', 'officer', 'staff', 'technician']

// อ่านสิทธิ์ไม่สำเร็จ (เน็ตหลุด/timeout/RLS ปฏิเสธชั่วคราว) — ต้องแยกจาก "ไม่มีสิทธิ์" ให้ชัด
// เพราะ role ที่ resolve ไม่ได้จะเป็น null แล้วตกไปเจอ `role === null → return null` ด้านล่าง
// ซึ่งเรนเดอร์จอขาวเปล่า ผู้ใช้เดาไม่ออกว่าต้องกดรีเฟรช (เจอจริงตอน fetch timeout 25s ใน supabase.js)
function ProfileLoadError() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6 text-center">
      <span className="text-4xl">🔐</span>
      <p className="text-gray-500 text-sm">
        ตรวจสอบสิทธิ์การเข้าใช้งานไม่สำเร็จ<br />อาจเกิดจากสัญญาณขาดช่วง
      </p>
      <button onClick={() => window.location.reload()}
        className="px-5 py-2.5 rounded-xl text-sm font-bold text-white"
        style={{ backgroundColor: 'var(--color-primary)' }}>
        กดเพื่อลองใหม่
      </button>
    </div>
  )
}

function RequireAuth({ children, adminOnly = false, techOnly = false, staffOnly = false, eventManagerOnly = false }) {
  const { session, role, profileLoading, profileError } = useAuth()
  const { loading: tenantLoading } = useTenant()
  const location = useLocation()

  // เช็คซ้ำอีกชั้นที่นี่ (นอกจาก AuthContext เอง) — ห้ามเชื่อ role ใดๆ ก่อน tenant resolve เสร็จ กัน
  // cross-tenant admin access ที่เคยเจอจริง (ดูคอมเมนต์ยาวใน AuthContext.jsx สำหรับรายละเอียด root cause)
  if (session === undefined || profileLoading || tenantLoading) return null
  if (!session) {
    const redirectTo = adminOnly ? '/admin/login' : '/auth'
    return <Navigate to={redirectTo} state={{ from: location.pathname + location.search }} replace />
  }
  // ต้องเช็คก่อนทุกด่านสิทธิ์ด้านล่าง — ครอบคลุมทั้ง adminOnly/techOnly/staffOnly/eventManagerOnly
  // ในที่เดียว และไม่กระทบตรรกะกัน cross-tenant เดิมเลย (error ไม่เคยทำให้ได้สิทธิ์เพิ่ม มีแต่ค้างที่ null)
  if (profileError) return <ProfileLoadError />
  if (adminOnly && role !== null && !['admin', 'superadmin', 'viewer'].includes(role)) {
    if (role === 'technician') return <Navigate to="/technician" replace />
    if (role === 'staff' || role === 'officer') return <Navigate to="/staff" replace />
    return <Navigate to="/" replace />
  }
  if (adminOnly && role === null) return null
  if (techOnly && role !== null && role !== 'technician') return <Navigate to="/" replace />
  if (techOnly && role === null) return null
  // technician อยู่ในลิสต์ด้วย — ช่างคือเจ้าหน้าที่กองช่าง ไม่ใช่คนนอก จึงเข้าหน้าเจ้าหน้าที่ได้
  // เหมือนกอง อื่นๆ ส่วนหน้า /technician ยังอยู่ครบ (ออกแบบมาสำหรับมือถือหน้างานโดยเฉพาะ)
  // เมนูที่ช่างเห็นในหน้าเจ้าหน้าที่ถูกจำกัดอีกชั้นที่ StaffDashboard — ดู TECHNICIAN_MODULE_KEYS
  if (staffOnly && role !== null && !['staff', 'officer', 'admin', 'superadmin', 'viewer', 'council', 'technician'].includes(role)) {
    return <Navigate to="/" replace />
  }
  if (staffOnly && role === null) return null
  if (eventManagerOnly && role !== null && !INTERNAL_EVENT_ROLES.includes(role)) {
    return <Navigate to="/events" replace />
  }
  if (eventManagerOnly && role === null) return null
  return children
}

function EventManagementPage() {
  const { tenant } = useTenant()
  const { role } = useAuth()

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 pb-24 sm:px-6 sm:py-6">
      <div className="mx-auto w-full max-w-7xl">
        <EventsManager tenant={tenant} currentUserRole={role} />
      </div>
    </main>
  )
}

function EventsEntryPage() {
  const { session, role, profileLoading } = useAuth()

  if (session && profileLoading) return null
  if (session && INTERNAL_EVENT_ROLES.includes(role)) return <EventManagementPage />
  return <EventsPage />
}

function AppShell() {
  const { loading, error, tenant } = useTenant()
  const tenantId = tenant?.id
  const [showPhoneReminder, setShowPhoneReminder] = useState(false)
  const [phoneReminderRequired, setPhoneReminderRequired] = useState(false)
  const [showNameReminder, setShowNameReminder] = useState(false)
  const [nameReminderInitial, setNameReminderInitial] = useState('')
  const [reminderUid, setReminderUid] = useState(null)
  const navigate = useNavigate()

  // useNavigate() ของ react-router v7 คืนฟังก์ชัน "ตัวใหม่ทุกครั้งที่ pathname เปลี่ยน"
  // (useNavigateUnstable ใส่ locationPathname ไว้ใน deps ของ useCallback ข้างใน) ถ้าเอา navigate
  // ไปใส่ dependency array ของ effect ตรงๆ effect นั้นจะรันใหม่ทุกการเปลี่ยนหน้า — ตัวแปรนี้ทำให้
  // effect อ้างถึง navigate ตัวล่าสุดได้โดยไม่ต้องประกาศเป็น dependency
  // ต้อง sync ใน effect ไม่ใช่ระหว่าง render (กติกา react-hooks/refs) — effect ตัวนี้ประกาศไว้
  // ก่อน effect ที่ใช้งาน จึงได้ค่าล่าสุดก่อนเสมอ ส่วนรอบแรกได้ค่าจาก useRef(navigate) อยู่แล้ว
  const navigateRef = useRef(navigate)
  useEffect(() => { navigateRef.current = navigate }, [navigate])
  const location = useLocation()
  const isBackOffice = ['/admin', '/staff', '/technician', '/dev-journal', '/data-center'].some(p => location.pathname.startsWith(p))
  // ช่างมีเมนูบนสุด/แถบข้างมาตรฐานอยู่แล้วในทุกธีม (NAV_TECH) แต่ต้องเปิดเฉพาะจอ PC
  // มือถือยังใช้หัวจอ/เมนูล่างของ TechnicianDashboard เองตามเดิม กันซ้อนกับของที่มีอยู่แล้ว
  const isTechnician = location.pathname.startsWith('/technician')

  // นับความถี่เข้าเมนู ไว้จัดอันดับ "เมนูที่ใช้บ่อย" ในหน้า More (ดู src/lib/menuUsage.js) — ต้องอยู่
  // ที่ AppShell ระดับนี้ ไม่ใช่แค่ในหน้า More เอง เพราะต้องนับทุกทางที่เข้าถึงเมนูนั้น (บอตทอมนาฟ,
  // ลิงก์ตรง ฯลฯ) ไม่ใช่แค่ตอนกดผ่านหน้า More
  useEffect(() => {
    recordVisit(location.pathname)
  }, [location.pathname])
  // ช่างยังใช้เมนูล่างของแอป (NAV_TECH) ได้ ต่างจาก /admin กับ /staff ที่ไม่มีเมนูล่างเลย
  const hideBottomNav = ['/admin', '/staff', '/dev-journal', '/data-center'].some(p => location.pathname.startsWith(p))

  // รับ user ทั้งก้อน ไม่ใช่แค่ uid + user_metadata เพราะต้องใช้ user.email ตัดสินว่าบัญชีนี้
  // มีตัวระบุตัวตนไว้กู้บัญชีอยู่แล้วหรือยัง (ดูเงื่อนไขเบอร์โทรท้ายฟังก์ชัน)
  const checkAndFixProfile = useCallback(async (user) => {
    const uid = user.id
    const userMeta = user.user_metadata ?? {}
    const { data: profile, error: profileError } = await fetchProfile(uid)

    if (profileError) {
      console.error('[profile] อ่านโปรไฟล์ไม่สำเร็จ:', profileError.message)
      return
    }

    // สมัคร/ล็อกอินด้วย Google หรือ LINE จะไม่มี municipality_id ติดมาใน raw_user_meta_data
    // (handle_new_user() เติมให้ได้เฉพาะการสมัครด้วยอีเมล) ถ้าตรงนี้ไม่สำเร็จ โปรไฟล์จะค้างเป็น
    // null ถาวรและหายไปจากหน้า "จัดการผู้ใช้และการแต่งตั้ง" ของ อปท. เพราะ get_users_with_email()
    // กรองด้วย municipality_id — admin จะมองไม่เห็นและแต่งตั้งตำแหน่งให้ไม่ได้เลย
    // จึงต้องไม่กลืน error เงียบๆ (ของเดิมกลืน ทำให้บั๊กนี้ซ่อนอยู่นานจนสะสมหลายบัญชี)
    if (tenantId && !profile?.municipality_id && profile?.role === 'citizen') {
      const { error } = await supabase
        .from('profiles')
        .update({ municipality_id: tenantId })
        .eq('id', uid)
      if (error) console.error('[profile] ผูก อปท. ให้บัญชีนี้ไม่สำเร็จ:', error.message)
    }

    const updates = {}

    // LINE/Google OAuth — ชื่ออยู่ใน 'name', รูปอยู่ใน 'picture'
    // แยกคำสั่งจากการผูก อปท. ข้างบน เพราะ trg_guard_profile_privileged_update ตรวจ
    // municipality_id ด้วยเงื่อนไขคนละชุด ถ้ารวมเป็นคำสั่งเดียวแล้วเงื่อนไขนั้นไม่ผ่าน
    // ชื่อกับรูปจะไม่ถูกเติมไปด้วยทั้งที่ไม่ใช่ฟิลด์ privileged
    if (!profile?.full_name?.trim()) {
      const name = userMeta?.full_name || userMeta?.name || ''
      if (name) updates.full_name = name
    }

    if (!profile?.avatar_url?.trim()) {
      const pic = userMeta?.avatar_url || userMeta?.picture || ''
      if (pic) updates.avatar_url = pic
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('profiles').upsert(
        { id: uid, ...updates },
        { onConflict: 'id' }
      )
      if (error) console.error('[profile] เติมชื่อ/รูปจาก OAuth ไม่สำเร็จ:', error.message)
    }

    // เช็คชื่อ-นามสกุลครบไม๊ (นับรวมค่าที่เพิ่งเติมจาก OAuth metadata ข้างบนด้วย) — ต้องมีทั้งชื่อและ
    // นามสกุลถึงจะถือว่าครบ เอกสารราชการ/แจ้งเตือนคำร้องต้องใช้ชื่อเต็ม
    const effectiveFullName = updates.full_name ?? profile?.full_name ?? ''
    const { first, last } = splitThaiFullName(effectiveFullName)
    setReminderUid(uid)
    if ((!first.trim() || !last.trim()) && !isReminderSkipped('name', uid)) {
      setNameReminderInitial(effectiveFullName)
      setShowNameReminder(true)
    }

    // บัญชีที่ไม่มีอีเมลใน auth.users เลย = สมัครด้วย LINE ในกรณีที่ channel ยังไม่ได้รับอนุมัติ
    // สิทธิ์ขอ email จาก LINE บัญชีแบบนี้ไม่มีทั้งอีเมลและรหัสผ่าน ถ้าวันหนึ่งเข้าแอป LINE ไม่ได้
    // (เปลี่ยนเครื่อง/ถอนแอป) จะล็อกอินไม่ได้อีกเลย และเจ้าหน้าที่ก็ค้นหาตัวเขาในระบบไม่เจอด้วย
    // เพราะไม่เหลืออะไรให้ค้นนอกจากชื่อ — เบอร์โทรจึงเป็นตัวระบุตัวตนชิ้นเดียวที่จะใช้กู้บัญชีได้
    // (เจ้าหน้าที่ยืนยันตัวตนที่สำนักงาน แล้วใช้ admin-update-login-email + ตั้งรหัสผ่านชั่วคราว)
    // กรณีนี้เท่านั้นที่ห้ามข้าม ผู้ใช้ที่มีอีเมลอยู่แล้วยังกด "ข้ามไปก่อน" ได้ตามเดิม
    // required = ห้ามข้าม จึงต้องเด้งซ้ำแม้เคยกดข้ามมาก่อน (บัญชี LINE ที่ไม่มีอีเมล ถ้าไม่มีเบอร์
    // = ไม่เหลืออะไรให้กู้บัญชีเลย) ส่วนบัญชีที่มีอีเมลอยู่แล้ว กดข้ามครั้งเดียวพอสำหรับ session นี้
    if (!profile?.phone?.trim()) {
      const required = !user.email
      setPhoneReminderRequired(required)
      if (required || !isReminderSkipped('phone', uid)) setShowPhoneReminder(true)
    }
  }, [tenantId])

  // iOS Safari ตัด WebSocket เมื่อแอปไป background — ต้องต่อกลับเมื่อผู้ใช้กลับมา
  //
  // ของเดิม disconnect() แล้ว connect() ใหม่ "ทุกครั้ง" ที่หน้ากลับมาแสดงผล โดยไม่ดูว่า socket
  // เดิมยังดีอยู่ไหม บนเดสก์ท็อปที่สลับหน้าต่างไปมาบ่อยๆ visibilitychange ยิงรัวมาก ผลคือทุกช่อง
  // realtime ที่เปิดอยู่ (หน้าเจ้าหน้าที่มีพร้อมกันได้ 5-7 ช่อง) ต้อง re-subscribe ใหม่ทั้งหมดทุกรอบ
  // ซึ่งการ join แต่ละช่องวิ่งผ่าน RLS ที่ Postgres — กลายเป็นภาระที่แอปสร้างใส่เซิร์ฟเวอร์ตัวเอง
  // ทั้งที่การเชื่อมต่อเดิมยังปกติดี
  //
  // เปลี่ยนเป็น: ต่อใหม่เฉพาะตอนหลุดจริง ถ้ายังต่ออยู่ให้ยิง heartbeat ตรวจสุขภาพแทน — realtime-js
  // จะรื้อและต่อใหม่ให้เองถ้า heartbeat ก่อนหน้าไม่มีคำตอบ (กันเคส socket ตายแบบ readyState ยัง
  // เป็น open ซึ่งเป็นอาการที่โค้ดเดิมตั้งใจกัน) ได้ผลเดิมโดยไม่ต้องรื้อของที่ยังใช้ได้ทิ้ง
  useEffect(() => {
    let reconnectTimer = null
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => {
        const rt = supabase.realtime
        if (rt.isConnected()) { rt.sendHeartbeat(); return }
        if (rt.isConnecting?.()) return
        rt.connect()
      }, 200)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      clearTimeout(reconnectTimer)
    }
  }, [])

  useEffect(() => {
    // ดัก OAuth error callback เช่น LINE/Google login ล้มเหลวฝั่ง provider
    //
    // อ่านจาก initialAuthParams (จับไว้ตั้งแต่ก่อนสร้าง supabase client) ไม่ใช่ window.location สดๆ
    // เพราะ detectSessionInUrl ของ supabase-js ล้าง hash/query ทิ้งแบบ async แข่งกับ effect นี้อยู่
    const oauthError = initialAuthParams.error
    const oauthErrorDesc = initialAuthParams.errorDescription
    if (!oauthError) return

    // ลิงก์รีเซ็ตรหัสผ่านที่หมดอายุ/ถูกใช้ไปแล้ว ก็ส่ง error กลับมาทางเดียวกันนี้ แต่ลงที่
    // /reset-password ปล่อยให้หน้านั้นอธิบายเอง — ของเดิมเหมารวมแล้วลากมาที่ /auth พร้อมข้อความ
    // "เข้าสู่ระบบด้วย LINE/Google ไม่สำเร็จ" ซึ่งคนละเรื่องกับสิ่งที่ผู้ใช้เพิ่งกดมา ผู้ใช้เลยไม่มี
    // ทางรู้ว่าต้องไปขอลิงก์ใหม่ (endsWith เพราะ deployment แบบ path-based มี slug นำหน้า)
    if (window.location.pathname.endsWith('/reset-password')) return

    window.history.replaceState({}, '', window.location.pathname)
    navigateRef.current('/auth', { replace: true, state: { oauthError: oauthErrorDesc || oauthError } })
  }, [])

  useEffect(() => {
    if (!tenantId) return
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) checkAndFixProfile(data.session.user)
    }).catch((err) => {
      // refresh token ที่ค้างอยู่ในเครื่องแต่ถูกเพิกถอน/หมดอายุแล้ว ทำให้ getSession() reject
      // (AuthApiError: Invalid Refresh Token) ของเดิมไม่มี .catch จึงกลายเป็น unhandled rejection
      // ขึ้น console error แดงตอนเปิดเว็บ ทั้งที่ผลลัพธ์ที่ถูกต้องคือ "ยังไม่ได้ล็อกอิน" เฉยๆ
      console.warn('[auth] อ่าน session เดิมไม่ได้ ถือว่ายังไม่ได้เข้าสู่ระบบ:', err?.message ?? err)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // ออกจากระบบแล้วต้องเตือนใหม่ได้ในรอบถัดไป การกด "ข้ามไปก่อน" มีผลแค่ภายใน session เดียว
      if (event === 'SIGNED_OUT') clearReminderSkips()
      if (event === 'SIGNED_IN' && session) {
        await checkAndFixProfile(session.user)

        // merge phone/id_card จาก account เดิม กรณี LINE OAuth เริ่มจากหน้า ProfilePage
        const mergeRaw = sessionStorage.getItem('merge_profile_on_oauth')
        if (mergeRaw) {
          sessionStorage.removeItem('merge_profile_on_oauth')
          try {
            const mergeData = JSON.parse(mergeRaw)
            const updates = {}
            if (mergeData.phone)   updates.phone   = mergeData.phone
            if (mergeData.id_card) updates.id_card = mergeData.id_card
            if (Object.keys(updates).length > 0) {
              await supabase.from('profiles').upsert(
                { id: session.user.id, ...updates },
                { onConflict: 'id' }
              )
            }
          } catch {
            // ข้อมูล merge เก่าที่เสียรูปต้องไม่ขัดขวางขั้นตอนเข้าสู่ระบบ
          }
        }

        const returnTo = sessionStorage.getItem('oauth_from')
        if (returnTo) {
          sessionStorage.removeItem('oauth_from')
          navigateRef.current(returnTo, { replace: true })
        }
      }
    })
    return () => subscription.unsubscribe()
    // ห้ามใส่ navigate ใน deps (ดูคอมเมนต์ที่ navigateRef) — ของเดิมใส่ไว้ ทำให้ effect นี้รันใหม่
    // ทุกครั้งที่เปลี่ยนหน้า: ยิง getSession() ใหม่ → checkAndFixProfile() ใหม่ → กล่องเตือน
    // เบอร์โทร/ชื่อเด้งซ้ำทุกหน้า และ subscribe onAuthStateChange ใหม่ทั้งที่ของเดิมยังดีอยู่
  }, [checkAndFixProfile, tenantId])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-gray-200 rounded-full animate-spin mx-auto mb-3"
               style={{ borderTopColor: 'var(--color-primary)' }} />
          <p className="text-gray-500 text-sm">กำลังโหลดข้อมูลหน่วยงาน...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center max-w-sm p-6">
          <div className="text-4xl mb-3">🏛️</div>
          <p className="text-red-500 font-medium">{error}</p>
          <p className="text-gray-400 text-sm mt-2">กรุณาติดต่อผู้ดูแลระบบ</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-dvh bg-gray-50 dark:bg-transparent flex flex-col">
      {showNameReminder ? (
        <NameReminderModal
          initialFullName={nameReminderInitial}
          onClose={() => { markReminderSkipped('name', reminderUid); setShowNameReminder(false) }} />
      ) : showPhoneReminder && (
        <PhoneReminderModal
          required={phoneReminderRequired}
          onClose={() => { markReminderSkipped('phone', reminderUid); setShowPhoneReminder(false) }} />
      )}
      <NotificationsProvider>
        {!isBackOffice && <Header />}
        {isTechnician && <div className="hidden md:block"><Header /></div>}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {(!isBackOffice || isTechnician) && <CitizenSidebar />}
          <main className={`flex-1 min-w-0 ${location.pathname === '/search' || location.pathname === '/chatbot' ? 'overflow-hidden flex flex-col h-full' : 'overflow-y-auto'}`}>
          <SuspenseErrorBoundary>
          <Suspense fallback={
            <div className="flex items-center justify-center min-h-[50vh]" role="status" aria-label="กำลังโหลดหน้า">
              <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                   style={{ borderTopColor: 'var(--color-primary)' }} />
            </div>
          }>
          {/* กันเข้าหน้าของโมดูลที่ อปท. นี้ไม่ได้เปิดใช้งาน — ครอบทั้งก้อนจุดเดียว
              route ที่เพิ่มทีหลังจึงถูกคุมอัตโนมัติจาก MODULE_ROUTES ใน src/lib/staffModules.js */}
          <ModuleGuard>
          <Routes>
          <Route path="/" element={<HomeOrTechRedirect />} />
          <Route path="/search" element={<ChatbotPage />} />
          <Route path="/chatbot" element={<ChatbotPage />} />
          <Route path="/complaint" element={<ComplaintCategory />} />
          <Route path="/complaint-legacy" element={<OneDataLanding />} />
          <Route path="/business-register" element={
            <RequireAuth>
              <BusinessRegisterPage />
            </RequireAuth>
          } />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* หน้ายืนยันการเข้าสู่ระบบบนคอมพิวเตอร์ — เจ้าหน้าที่กรอกรหัส 6 หลักจากจอ PC */}
          <Route path="/device-login" element={<DeviceLoginApprove />} />
          <Route path="/satisfaction" element={<SatisfactionPage />} />
          <Route path="/profile" element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          } />
          <Route path="/request" element={<CitizenForm />} />
          <Route path="/my-complaints" element={<MyComplaints />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/weather" element={<WeatherPage />} />
          <Route path="/events/manage" element={
            <RequireAuth eventManagerOnly>
              <EventManagementPage />
            </RequireAuth>
          } />
          <Route path="/events" element={<EventsEntryPage />} />
          <Route path="/emergency" element={<EmergencyPage />} />
          <Route path="/tourism" element={<TourismPage />} />
          <Route path="/tourism/:id" element={<TourismDetailPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/doc-request" element={<CitizenDocRequest />} />
          <Route path="/my-docs" element={<MyDocRequests />} />
          <Route path="/doc-stats" element={<LpaDocStats />} />
          <Route path="/reports/complaints" element={<ComplaintStats />} />
          <Route path="/reports" element={<ReportsHub />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/news" element={<PostsPage />} />
          <Route path="/map" element={<Navigate to="/data-center/public" replace />} />
          <Route path="/fleet" element={
            <RequireAuth staffOnly>
              <FleetPage />
            </RequireAuth>
          } />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/dev-journal" element={<DevJournal />} />
          <Route path="/map-demo" element={<MapEngineDemoPage />} />
          <Route path="/staff" element={
            <RequireAuth staffOnly>
              <SuspenseErrorBoundary>
                <Suspense fallback={
                  <div className="flex items-center justify-center min-h-full h-full">
                    <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                         style={{ borderTopColor: '#3b82f6' }} />
                  </div>
                }>
                  <StaffDashboard />
                </Suspense>
              </SuspenseErrorBoundary>
            </RequireAuth>
          } />
          <Route path="/technician" element={
            <RequireAuth techOnly>
              <TechnicianDashboard />
            </RequireAuth>
          } />
          <Route path="/data-center" element={
            <SuspenseErrorBoundary>
              <Suspense fallback={
                <div className="flex items-center justify-center min-h-full h-full">
                  <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                       style={{ borderTopColor: '#3b82f6' }} />
                </div>
              }>
                <DataCenterLanding />
              </Suspense>
            </SuspenseErrorBoundary>
          } />
          <Route path="/data-center/public" element={
            <SuspenseErrorBoundary>
              <Suspense fallback={
                <div className="flex items-center justify-center min-h-full h-full">
                  <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                       style={{ borderTopColor: '#3b82f6' }} />
                </div>
              }>
                <DataCenterPublicMap />
              </Suspense>
            </SuspenseErrorBoundary>
          } />
          <Route path="/data-center/staff" element={
            <RequireAuth staffOnly>
              <SuspenseErrorBoundary>
                <Suspense fallback={
                  <div className="flex items-center justify-center min-h-full h-full">
                    <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                         style={{ borderTopColor: '#3b82f6' }} />
                  </div>
                }>
                  <DataCenterDashboard />
                </Suspense>
              </SuspenseErrorBoundary>
            </RequireAuth>
          } />
          <Route path="/admin" element={
            <RequireAuth adminOnly>
              <SuspenseErrorBoundary>
                <Suspense fallback={
                  <div className="flex items-center justify-center py-20 text-gray-400">
                    <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                         style={{ borderTopColor: 'var(--color-primary)' }} />
                  </div>
                }>
                  <AdminDashboard />
                </Suspense>
              </SuspenseErrorBoundary>
            </RequireAuth>
          } />
          </Routes>
          </ModuleGuard>
          </Suspense>
          </SuspenseErrorBoundary>
          {location.pathname !== '/search' && location.pathname !== '/chatbot' && <Footer />}
          </main>
        </div>
        {!hideBottomNav && <BottomNav />}
        <InstallPrompt />
        <ScrollToTopButton />
      </NotificationsProvider>
    </div>
  )
}



export default function App() {
  return (
    <InAppBrowserGate>
      <BrowserRouter basename={BASENAME}>
        <TenantProvider>
          <AuthProvider>
            <AppShell />
          </AuthProvider>
        </TenantProvider>
      </BrowserRouter>
    </InAppBrowserGate>
  )
}

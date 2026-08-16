import { lazy, Suspense, useCallback, useEffect, useState, Component } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { TenantProvider, useTenant } from './contexts/TenantContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import Header from './components/layout/Header'
import Footer from './components/layout/Footer'
import BottomNav from './components/layout/BottomNav'
import CitizenSidebar from './components/layout/CitizenSidebar'
import InstallPrompt from './components/InstallPrompt'
import ScrollToTopButton from './components/ScrollToTopButton'
import InAppBrowserGate from './components/InAppBrowserGate'
import { supabase } from './lib/supabase'
import { Phone, UserRound } from 'lucide-react'
import { NAME_TITLES, splitThaiFullName, joinThaiFullName } from './lib/thaiName'

const HomePage = lazyWithRetry(() => import('./pages/HomePage'))
const CitizenForm = lazyWithRetry(() => import('./pages/CitizenForm'))
const ComplaintCategory = lazyWithRetry(() => import('./pages/ComplaintCategory'))
const OneDataLanding = lazyWithRetry(() => import('./pages/OneDataLanding'))
const BusinessRegisterPage = lazyWithRetry(() => import('./pages/BusinessRegisterPage'))
const MarketPage = lazyWithRetry(() => import('./pages/MarketPage'))
const AdminLogin = lazyWithRetry(() => import('./pages/AdminLogin'))
const DevJournal = lazyWithRetry(() => import('./pages/DevJournal'))
const AuthPage = lazyWithRetry(() => import('./pages/AuthPage'))
const ResetPasswordPage = lazyWithRetry(() => import('./pages/ResetPasswordPage'))
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

function PhoneReminderModal({ onClose }) {
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
          <p className="text-sm text-gray-500 leading-relaxed">
            กรอกเบอร์มือถือเพื่อให้เจ้าหน้าที่ติดต่อกลับ<br />
            และติดตามสถานะคำร้องของท่านได้สะดวกขึ้น
          </p>

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
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600 py-1">
            ข้ามไปก่อน
          </button>
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


const INTERNAL_EVENT_ROLES = ['superadmin', 'admin', 'viewer', 'council', 'officer', 'staff', 'technician', 'kamnan']

function RequireAuth({ children, adminOnly = false, techOnly = false, staffOnly = false, eventManagerOnly = false }) {
  const { session, role, profileLoading } = useAuth()
  const location = useLocation()

  if (session === undefined || profileLoading) return null
  if (!session) {
    const redirectTo = adminOnly ? '/admin/login' : '/auth'
    return <Navigate to={redirectTo} state={{ from: location.pathname + location.search }} replace />
  }
  if (adminOnly && role !== null && !['admin', 'superadmin', 'viewer'].includes(role)) {
    if (role === 'technician') return <Navigate to="/technician" replace />
    if (role === 'staff' || role === 'officer') return <Navigate to="/staff" replace />
    return <Navigate to="/" replace />
  }
  if (adminOnly && role === null) return null
  if (techOnly && role !== null && role !== 'technician') return <Navigate to="/" replace />
  if (techOnly && role === null) return null
  if (staffOnly && role !== null && !['staff', 'officer', 'admin', 'superadmin', 'viewer', 'council'].includes(role)) {
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
  const [showNameReminder, setShowNameReminder] = useState(false)
  const [nameReminderInitial, setNameReminderInitial] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const isBackOffice = ['/admin', '/staff', '/technician', '/dev-journal', '/data-center'].some(p => location.pathname.startsWith(p))
  // ช่างมีเมนูบนสุด/แถบข้างมาตรฐานอยู่แล้วในทุกธีม (NAV_TECH) แต่ต้องเปิดเฉพาะจอ PC
  // มือถือยังใช้หัวจอ/เมนูล่างของ TechnicianDashboard เองตามเดิม กันซ้อนกับของที่มีอยู่แล้ว
  const isTechnician = location.pathname.startsWith('/technician')
  // ช่างยังใช้เมนูล่างของแอป (NAV_TECH) ได้ ต่างจาก /admin กับ /staff ที่ไม่มีเมนูล่างเลย
  const hideBottomNav = ['/admin', '/staff', '/dev-journal', '/data-center'].some(p => location.pathname.startsWith(p))

  const checkAndFixProfile = useCallback(async (uid, userMeta = {}) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('phone, municipality_id, full_name, avatar_url, role')
      .eq('id', uid)
      .maybeSingle()

    const updates = {}

    if (tenantId && !profile?.municipality_id && profile?.role === 'citizen') {
      updates.municipality_id = tenantId
    }

    // LINE/Google OAuth — ชื่ออยู่ใน 'name', รูปอยู่ใน 'picture'
    if (!profile?.full_name?.trim()) {
      const name = userMeta?.full_name || userMeta?.name || ''
      if (name) updates.full_name = name
    }

    if (!profile?.avatar_url?.trim()) {
      const pic = userMeta?.avatar_url || userMeta?.picture || ''
      if (pic) updates.avatar_url = pic
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('profiles').upsert(
        { id: uid, ...updates },
        { onConflict: 'id' }
      )
    }

    // เช็คชื่อ-นามสกุลครบไม๊ (นับรวมค่าที่เพิ่งเติมจาก OAuth metadata ข้างบนด้วย) — ต้องมีทั้งชื่อและ
    // นามสกุลถึงจะถือว่าครบ เอกสารราชการ/แจ้งเตือนคำร้องต้องใช้ชื่อเต็ม
    const effectiveFullName = updates.full_name ?? profile?.full_name ?? ''
    const { first, last } = splitThaiFullName(effectiveFullName)
    if (!first.trim() || !last.trim()) {
      setNameReminderInitial(effectiveFullName)
      setShowNameReminder(true)
    }

    if (!profile?.phone?.trim()) setShowPhoneReminder(true)
  }, [tenantId])

  // iOS Safari ตัด WebSocket เมื่อแอปไป background — reconnect ทุกครั้งที่กลับมา
  useEffect(() => {
    let reconnectTimer = null
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(() => {
          supabase.realtime.disconnect()
          setTimeout(() => supabase.realtime.connect(), 300)
        }, 200)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      clearTimeout(reconnectTimer)
    }
  }, [navigate])

  useEffect(() => {
    // ดัก OAuth error callback เช่น LINE/Google login ล้มเหลวฝั่ง provider
    const params = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const oauthError = params.get('error') || hashParams.get('error')
    const oauthErrorDesc = params.get('error_description') || hashParams.get('error_description')
    if (oauthError) {
      window.history.replaceState({}, '', window.location.pathname)
      navigate('/auth', { replace: true, state: { oauthError: oauthErrorDesc || oauthError } })
    }
  }, [navigate])

  useEffect(() => {
    if (!tenantId) return
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) checkAndFixProfile(data.session.user.id, data.session.user.user_metadata)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        await checkAndFixProfile(session.user.id, session.user.user_metadata)

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
          navigate(returnTo, { replace: true })
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [checkAndFixProfile, navigate, tenantId])

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
        <NameReminderModal initialFullName={nameReminderInitial} onClose={() => setShowNameReminder(false)} />
      ) : showPhoneReminder && (
        <PhoneReminderModal onClose={() => setShowPhoneReminder(false)} />
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

function computeBasename() {
  if (import.meta.env.VITE_TENANT_SLUG) return ''

  const { hostname, pathname } = window.location

  if (!hostname.endsWith('.vercel.app') && hostname !== 'localhost' && !hostname.match(/^\d/)) {
    return ''
  }

  // Path mode: /namlao/... → basename = '/namlao'
  const segment = pathname.split('/').filter(Boolean)[0]
  return segment ? `/${segment}` : ''
}

// computed once at module load — must NOT be inside the component (re-render would shift basename)
const BASENAME = computeBasename()

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

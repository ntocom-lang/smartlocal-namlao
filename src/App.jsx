import { lazy, Suspense, useEffect, useState } from 'react'
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
import HomePage from './pages/HomePage'
import CitizenForm from './pages/CitizenForm'
import ComplaintCategory from './pages/ComplaintCategory'
import OneDataLanding from './pages/OneDataLanding'
import BusinessRegisterPage from './pages/BusinessRegisterPage'
import MarketPage from './pages/MarketPage'
import AdminLogin from './pages/AdminLogin'
import AuthPage from './pages/AuthPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import SatisfactionPage from './pages/SatisfactionPage'
import TechnicianDashboard from './pages/TechnicianDashboard'
import ProfilePage from './pages/ProfilePage'
import MyComplaints from './pages/MyComplaints'
import MorePage from './pages/MorePage'
import NotificationsPage from './pages/NotificationsPage'
import WeatherPage from './pages/WeatherPage'
import EventsPage from './pages/EventsPage'
import EmergencyPage from './pages/EmergencyPage'
import TourismPage from './pages/TourismPage'
import TourismDetailPage from './pages/TourismDetailPage'
import ContactPage from './pages/ContactPage'
import CitizenDocRequest from './pages/CitizenDocRequest'
import MyDocRequests from './pages/MyDocRequests'
import LpaDocStats from './pages/LpaDocStats'
import PostsPage from './pages/PostsPage'
import MapPage from './pages/MapPage'
import FleetPage from './pages/FleetPage'
import { supabase } from './lib/supabase'
import { Phone, X } from 'lucide-react'

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

const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const StaffDashboard  = lazy(() => import('./pages/StaffDashboard'))

function HomeOrTechRedirect() {
  return <HomePage />
}


function RequireAuth({ children, adminOnly = false, techOnly = false, staffOnly = false }) {
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
  return children
}

function AppShell() {
  const { loading, error, tenant } = useTenant()
  const [showPhoneReminder, setShowPhoneReminder] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const isBackOffice = ['/admin', '/staff', '/technician'].some(p => location.pathname.startsWith(p))

  async function checkAndFixProfile(uid, userMeta = {}) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('phone, municipality_id, full_name, avatar_url, role')
      .eq('id', uid)
      .maybeSingle()

    const updates = {}

    if (tenant?.id && !profile?.municipality_id && profile?.role === 'citizen') {
      updates.municipality_id = tenant.id
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

    if (!profile?.phone?.trim()) setShowPhoneReminder(true)
  }

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
  }, [])

  useEffect(() => {
    if (!tenant?.id) return
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
          } catch {}
        }

        const returnTo = sessionStorage.getItem('oauth_from')
        if (returnTo) {
          sessionStorage.removeItem('oauth_from')
          navigate(returnTo, { replace: true })
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [tenant?.id])

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
      {showPhoneReminder && (
        <PhoneReminderModal onClose={() => setShowPhoneReminder(false)} />
      )}
      <NotificationsProvider>
        <Header />
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <CitizenSidebar />
          <main className="flex-1 min-w-0 overflow-y-auto">
          <Routes>
          <Route path="/" element={<HomeOrTechRedirect />} />
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
          <Route path="/events" element={<EventsPage />} />
          <Route path="/emergency" element={<EmergencyPage />} />
          <Route path="/tourism" element={<TourismPage />} />
          <Route path="/tourism/:id" element={<TourismDetailPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/doc-request" element={<CitizenDocRequest />} />
          <Route path="/my-docs" element={<MyDocRequests />} />
          <Route path="/doc-stats" element={<LpaDocStats />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/news" element={<PostsPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/fleet" element={
            <RequireAuth staffOnly>
              <FleetPage />
            </RequireAuth>
          } />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/staff" element={
            <RequireAuth staffOnly>
              <Suspense fallback={
                <div className="flex items-center justify-center min-h-full h-full">
                  <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                       style={{ borderTopColor: '#3b82f6' }} />
                </div>
              }>
                <StaffDashboard />
              </Suspense>
            </RequireAuth>
          } />
          <Route path="/technician" element={
            <RequireAuth techOnly>
              <TechnicianDashboard />
            </RequireAuth>
          } />
          <Route path="/admin" element={
            <RequireAuth adminOnly>
              <Suspense fallback={
                <div className="flex items-center justify-center py-20 text-gray-400">
                  <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                       style={{ borderTopColor: 'var(--color-primary)' }} />
                </div>
              }>
                <AdminDashboard />
              </Suspense>
            </RequireAuth>
          } />
        </Routes>
          <Footer />
          </main>
        </div>
        {!isBackOffice && <BottomNav />}
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

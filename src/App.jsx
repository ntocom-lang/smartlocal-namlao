import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { TenantProvider, useTenant } from './contexts/TenantContext'
import { ThemeProvider } from './contexts/ThemeContext'
import Header from './components/layout/Header'
import Footer from './components/layout/Footer'
import BottomNav from './components/layout/BottomNav'
import HomePage from './pages/HomePage'
import CitizenForm from './pages/CitizenForm'
import AdminLogin from './pages/AdminLogin'
import AuthPage from './pages/AuthPage'
import ProfilePage from './pages/ProfilePage'
import { supabase } from './lib/supabase'

const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))

function RequireAuth({ children, adminOnly = false }) {
  const [session, setSession] = useState(undefined)
  const [role, setRole] = useState(null)
  const location = useLocation()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setRole(null); return }
    supabase.from('profiles').select('role').eq('id', session.user.id).single()
      .then(({ data, error }) => {
        if (error) { setRole('citizen'); return }
        setRole(data?.role ?? 'citizen')
      })
  }, [session])

  if (session === undefined) return null
  if (!session) {
    const redirectTo = adminOnly ? '/admin/login' : '/auth'
    return <Navigate to={redirectTo} state={{ from: location.pathname }} replace />
  }
  if (adminOnly && role !== null && role !== 'admin' && role !== 'superadmin') {
    return <Navigate to="/" replace />
  }
  if (adminOnly && role === null) return null // รอโหลด role
  return children
}

function AppShell() {
  const { loading, error } = useTenant()

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
    <div className="min-h-screen bg-gray-50 dark:bg-transparent flex flex-col">
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/profile" element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          } />
          <Route path="/request" element={
            <RequireAuth>
              <CitizenForm />
            </RequireAuth>
          } />
          <Route path="/admin/login" element={<AdminLogin />} />
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
      </main>
      <Footer />
      <BottomNav />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <TenantProvider>
          <AppShell />
        </TenantProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

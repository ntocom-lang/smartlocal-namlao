import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTenant } from './TenantContext'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const { tenant, loading: tenantLoading } = useTenant()
  const [session, setSession]       = useState(undefined) // undefined = loading
  const [role, setRole]             = useState(null)
  const [profileName, setProfileName] = useState(null)
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) { setRole(null); setProfileName(null); setProfileAvatarUrl(null) }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session === undefined) return
    if (!session) { setRole(null); setProfileName(null); setProfileAvatarUrl(null); return }

    // สำคัญ: ห้าม resolve role ใดๆ ก่อน tenant โหลดเสร็จ — เดิมเช็ค municipality mismatch แบบ
    // `if (tenant?.id && ...)` ซึ่งถ้า tenant ยังโหลดไม่เสร็จ (tenant?.id เป็น falsy ชั่วคราว) เงื่อนไข
    // ทั้งก้อนจะถูกข้าม แล้วปล่อย role จริงของ user (เช่น admin ของ อปท. อื่น) ออกมาใช้ได้ทันทีโดยไม่เช็ค
    // อปท. เลย — เป็นช่องโหว่ cross-tenant admin access จริงที่เจอจากการทดสอบ (อปท. ใหม่ tenant resolve
    // ช้ากว่า session ที่ค้างจาก อปท. เดิม) รอ tenantLoading ให้จบก่อนเสมอ ปลอดภัยกว่าเสี่ยง race condition
    if (tenantLoading) { setProfileLoading(true); return }

    setProfileLoading(true)
    supabase
      .from('profiles')
      .select('role, municipality_id, full_name, avatar_url')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        const profileRole   = data?.role ?? 'citizen'
        const profileMuniId = data?.municipality_id
        setProfileName(data?.full_name ?? null)
        setProfileAvatarUrl(data?.avatar_url ?? null)

        // superadmin เข้าได้ทุก municipality เสมอ
        if (profileRole === 'superadmin') {
          setRole('superadmin')
          return
        }

        // tenant โหลดไม่สำเร็จเลย (error) — ไม่มี tenant.id ให้เทียบ ปลอดภัยไว้ก่อนด้วยการไม่ให้สิทธิ์พิเศษ
        if (!tenant?.id) {
          setRole('citizen')
          return
        }

        // role อื่น — ถ้า municipality ไม่ตรง → ลดเหลือ citizen
        if (profileMuniId && profileMuniId !== tenant.id) {
          setRole('citizen')
          return
        }

        setRole(profileRole)
      })
      .finally(() => setProfileLoading(false))
  }, [session?.user?.id, tenant?.id, tenantLoading])

  const displayName = profileName
    || session?.user?.user_metadata?.full_name
    || session?.user?.email?.split('@')[0]
    || ''

  // profiles.avatar_url (รูปที่อัปโหลดเองในหน้าโปรไฟล์) มาก่อนรูปจาก OAuth provider เสมอ
  const avatarUrl = profileAvatarUrl
    || session?.user?.user_metadata?.avatar_url
    || session?.user?.user_metadata?.picture
    || null

  return (
    <AuthContext.Provider value={{ session, role, profileName, displayName, avatarUrl, profileLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องใช้ภายใน AuthProvider')
  return ctx
}

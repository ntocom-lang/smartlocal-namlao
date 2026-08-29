import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchProfile } from '../lib/profileFetch'
import { useTenant } from './TenantContext'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const { tenant, loading: tenantLoading } = useTenant()
  const [session, setSession]       = useState(undefined) // undefined = loading
  const [role, setRole]             = useState(null)
  const [profileName, setProfileName] = useState(null)
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  // true = อ่าน profiles ไม่สำเร็จ (คนละเรื่องกับ "ไม่มีสิทธิ์") ให้หน้าที่ป้องกันสิทธิ์แสดงข้อความ + ปุ่มลองใหม่
  const [profileError, setProfileError] = useState(false)

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
    if (!session) { setRole(null); setProfileName(null); setProfileAvatarUrl(null); setProfileError(false); return }

    // สำคัญ: ห้าม resolve role ใดๆ ก่อน tenant โหลดเสร็จ — เดิมเช็ค municipality mismatch แบบ
    // `if (tenant?.id && ...)` ซึ่งถ้า tenant ยังโหลดไม่เสร็จ (tenant?.id เป็น falsy ชั่วคราว) เงื่อนไข
    // ทั้งก้อนจะถูกข้าม แล้วปล่อย role จริงของ user (เช่น admin ของ อปท. อื่น) ออกมาใช้ได้ทันทีโดยไม่เช็ค
    // อปท. เลย — เป็นช่องโหว่ cross-tenant admin access จริงที่เจอจากการทดสอบ (อปท. ใหม่ tenant resolve
    // ช้ากว่า session ที่ค้างจาก อปท. เดิม) รอ tenantLoading ให้จบก่อนเสมอ ปลอดภัยกว่าเสี่ยง race condition
    if (tenantLoading) { setProfileLoading(true); return }

    setProfileLoading(true)
    setProfileError(false)
    // fetchProfile รวมคำสั่งอ่าน profiles ให้เป็นชุดเดียวกับที่ checkAndFixProfile ใน App.jsx ใช้
    // ตอนโหลดหน้าพร้อมกัน จึงยิงจริงแค่ครั้งเดียวแทนที่จะเป็นสองรอบของแถวเดียวกัน
    fetchProfile(session.user.id)
      .then(({ data, error }) => {
        // แยก "อ่านโปรไฟล์ไม่สำเร็จ" ออกจาก "ไม่มีแถวโปรไฟล์" ให้ชัด — maybeSingle() ที่ไม่เจอแถวจะคืน
        // data=null คู่กับ error=null ซึ่งแปลว่า citizen ได้จริง แต่ถ้า error มีค่า (RLS ปฏิเสธ, 500,
        // schema cache ยังไม่พร้อม) การเดาเป็น citizen เท่ากับถอดสิทธิ์แอดมินเงียบๆ จากความผิดพลาดชั่วคราว
        if (error) throw error

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
      .catch((err) => {
        // ต้องมี .catch เสมอ: client ตัวนี้ครอบ fetch ด้วย timeout 25s ไว้ใน supabase.js พอ abort
        // แล้วจะ reject จริง (ไม่ใช่คืน { data, error } ตามปกติของ PostgREST) ถ้าไม่ดักไว้ role จะค้าง
        // null ถาวร แล้ว RequireAuth ใน App.jsx จะ return null = จอขาวเปล่า ไม่มีข้อความ ไม่มีปุ่มลองใหม่
        // ตั้ง profileError แทนการเดา role — ห้ามเดาขึ้น (เสี่ยงให้สิทธิ์เกิน) และไม่ควรเดาลงเป็น citizen
        // เพราะแอดมินจะโดนเด้งกลับหน้าแรกเงียบๆ แล้วนึกว่าถูกถอดสิทธิ์จริง
        console.error('[auth] อ่านโปรไฟล์ไม่สำเร็จ:', err?.message ?? err)
        setRole(null)
        setProfileName(null)
        setProfileAvatarUrl(null)
        setProfileError(true)
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
    <AuthContext.Provider value={{ session, role, profileName, displayName, avatarUrl, profileLoading, profileError }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องใช้ภายใน AuthProvider')
  return ctx
}

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
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
    // ต้องมี .catch เสมอ: refresh token ที่ค้างในเครื่องแต่ถูกเพิกถอน/หมดอายุแล้วทำให้ getSession()
    // reject (AuthApiError: Invalid Refresh Token) ของเดิมไม่มี catch จึงเกิดสองอย่างพร้อมกัน —
    // unhandled rejection ขึ้น console error ตอนเปิดเว็บ และ session ค้างเป็น undefined ถาวร
    // ซึ่งทั้งแอปแปลว่า "กำลังโหลด" ผู้ใช้จึงติดหน้าโหลดโดยไม่มีทางไปต่อจนกว่าจะรีเฟรชเอง
    // ผลลัพธ์ที่ถูกต้องของ token เสียคือ "ยังไม่ได้เข้าสู่ระบบ" (null) แบบเงียบๆ
    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session))
      .catch((err) => {
        console.warn('[auth] อ่าน session เดิมไม่ได้ ถือว่ายังไม่ได้เข้าสู่ระบบ:', err?.message ?? err)
        setSession(null)
      })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) { setRole(null); setProfileName(null); setProfileAvatarUrl(null) }
    })
    return () => subscription.unsubscribe()
  }, [])

  // รับ "id ของ อปท." ไม่ใช่ tenant ทั้งก้อน — ตรรกะข้างในใช้แค่ id เทียบกับ profiles.municipality_id
  // และ deps ของ effect ที่เรียกฟังก์ชันนี้ต้องเป็นค่า primitive เท่านั้น (ดูเหตุผลยาวที่ effect ข้างล่าง)
  const loadUserProfile = useCallback(async (uid, tenantId) => {
    if (!uid) return
    setProfileLoading(true)
    setProfileError(false)
    try {
      const { data, error } = await fetchProfile(uid)
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
      if (!tenantId) {
        setRole('citizen')
        return
      }

      // role อื่น — ถ้า municipality ไม่ตรง → ลดเหลือ citizen
      if (profileMuniId && profileMuniId !== tenantId) {
        setRole('citizen')
        return
      }

      setRole(profileRole)
    } catch (err) {
      console.error('[auth] อ่านโปรไฟล์ไม่สำเร็จ:', err?.message ?? err)
      setRole(null)
      setProfileName(null)
      setProfileAvatarUrl(null)
      setProfileError(true)
    } finally {
      setProfileLoading(false)
    }
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

    loadUserProfile(session.user.id, tenant?.id)
    // ⚠️ deps ต้องเป็น tenant?.id เท่านั้น ห้ามใส่ tenant ทั้ง object เด็ดขาด
    //
    // patchTenant() ใน TenantContext สร้าง object ใหม่ทุกครั้ง ({ ...prev, ...fields }) ถ้า deps
    // เป็น object เต็ม ทุกการบันทึกในหลังบ้าน (โลโก้, ธีมสี, เปิด-ปิดโมดูล, ประเภทคำขอเอกสาร ฯลฯ)
    // จะทำให้ effect นี้รันใหม่ → setProfileLoading(true) ทันทีแบบ synchronous → RequireAuth ใน
    // src/App.jsx คืน null → หน้าทั้งหน้า unmount แล้ว mount ใหม่ = state หายหมด แอดมินถูกเด้ง
    // กลับหน้าแรกของหลังบ้านทุกครั้งที่กดบันทึก และไม่ทันเห็นข้อความ "บันทึกสำเร็จ"
    // (บั๊กจริงที่วัดได้ 2569-09-06 ทั้งการ์ดประเภทคำขอเอกสารและปุ่มสลับสไตล์ไอคอนหมวดคำร้อง)
    //
    // ตรรกะกัน cross-tenant ไม่เปลี่ยน: ยังรอ tenantLoading ก่อนเสมอ และยังโหลดโปรไฟล์ใหม่ทุกครั้ง
    // ที่ "อปท. เปลี่ยน" เพราะสิ่งที่ใช้ตัดสินสิทธิ์คือ id ตัวเดียว ฟิลด์อื่นของ tenant ไม่เกี่ยวเลย
  }, [session?.user?.id, tenant?.id, tenantLoading, loadUserProfile])

  const refreshProfile = useCallback(async () => {
    if (session?.user?.id) {
      await loadUserProfile(session.user.id, tenant?.id)
    }
  }, [session?.user?.id, tenant?.id, loadUserProfile])

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
    <AuthContext.Provider value={{ session, role, profileName, displayName, avatarUrl, profileLoading, profileError, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องใช้ภายใน AuthProvider')
  return ctx
}

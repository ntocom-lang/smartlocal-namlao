import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase, setRememberSession } from '../lib/supabase'
import { isNetworkAuthError } from '../lib/authErrors'
import { useTenant } from '../contexts/TenantContext'
import DeviceLoginPanel from '../components/auth/DeviceLoginPanel'
import { appUrl } from '../lib/basename'
import { Mail, Lock, Loader2, UserCircle2, Phone, Eye, EyeOff, ExternalLink, ArrowLeft, Smartphone } from 'lucide-react'
import { NAME_TITLES, joinThaiFullName } from '../lib/thaiName'
import { phoneToLoginEmail, normalizeThaiPhone } from '../lib/authProviders'
import { validateNewPassword, PASSWORD_HINT } from '../lib/passwordPolicy'

function detectInAppBrowser() {
  const ua = navigator.userAgent || ''
  return /FBAN|FBAV|Instagram|Line\/|Twitter\/|MicroMessenger|GSA\/|Musical_ly/.test(ua)
}

// พิมพ์อีเมลมาก็ใช้ตามนั้น พิมพ์เบอร์มาก็แปลงเป็นอีเมลปลอมรูปแบบเดียวของระบบ
//
// เคยมีตัวสำรองไว้ลองรูปแบบเลขดิบแบบเก่าด้วย (บัญชีที่สมัครก่อนมี normalizeThaiPhone เช่นคนที่
// พิมพ์ +66 81 234 5678 แล้วได้บัญชี 66812345678@...) ถอดออกแล้วเมื่อ 2026-08-29 หลังตรวจ
// auth.users ทั้งหมดพบว่าเหลือบัญชีรูปแบบเก่าใบเดียวและถูกลบไปแล้ว
// (ดู scripts/report-phone-login-emails.sql ถ้าต้องตรวจซ้ำในอนาคต)
function resolveLoginEmail(input) {
  const v = input.trim()
  return v.includes('@') ? v : phoneToLoginEmail(v)
}

export default function AuthPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tenant } = useTenant()
  const from = location.state?.from ?? '/'
  const inAppBrowser = detectInAppBrowser()

  const [mode, setMode] = useState('login') // 'login' | 'register' | 'forgot'
  const [form, setForm] = useState({ email: '', password: '', name_title: '', name_first: '', name_last: '', phone: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (location.state?.oauthError) {
      setError('เข้าสู่ระบบด้วย LINE/Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      // clear oauthError จาก history เพื่อไม่ให้แสดงซ้ำเมื่อกด Back กลับมา
      navigate(location.pathname, { replace: true, state: { from } })
    }
  }, [])
  const [success, setSuccess] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // ค่าเริ่มต้น = จำไว้ ให้ตรงกับพฤติกรรมเดิมของระบบ และกติกาที่ว่าผู้ใช้ต้องกดออกเอง
  // การ "ไม่ติ๊ก" คือผู้ใช้เลือกเองว่าไม่ให้ค้างบนเครื่องนี้ ไม่ใช่ระบบพาออกอัตโนมัติ
  const [remember, setRemember] = useState(true)
  const [loadingGoogle, setLoadingGoogle] = useState(false)
  const [loadingLine, setLoadingLine] = useState(false)
  const [loadingLineWeb, setLoadingLineWeb] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }))

  function storeOauthFrom() {
    if (from && from !== '/') sessionStorage.setItem('oauth_from', from)
  }

  // ปุ่ม OAuth ต้องปลดล็อกตัวเองได้เสมอเมื่อไปต่อไม่ได้
  //
  // เดิมเช็คแค่ `if (err)` ซึ่งครอบเฉพาะกรณี signInWithOAuth คืน error object กลับมา แต่ตัวมัน
  // "reject" ได้ด้วย (เน็ตหลุด หรือ timeout 25 วิของ fetchWithTimeout สั่ง abort) พอ await โยน
  // ออกไป บรรทัด setLoadingXxx(false) ไม่มีวันได้รัน ปุ่มเลยค้างเป็นสปินเนอร์ disabled ถาวร
  // ผู้ใช้กดอะไรไม่ได้อีกเลยจนกว่าจะรีเฟรชหน้าเอง
  //
  // หมายเหตุ: ถ้าสำเร็จจริง เบราว์เซอร์จะ redirect ออกไปหน้า provider ตั้งแต่ก่อนถึง finally
  // สปินเนอร์ที่ยังหมุนอยู่ระหว่างนั้นจึงถูกต้องแล้ว — finally มีผลเฉพาะตอนไปต่อไม่ได้
  async function startOAuth(provider, { setLoading: setProviderLoading, errorText, queryParams }) {
    storeOauthFrom()
    // OAuth ไม่มีช่องติ๊ก "จำการเข้าสู่ระบบ" และผู้ใช้กลุ่มนี้คือประชาชนบนมือถือตัวเอง
    // ตั้งเป็นจำไว้เสมอ ไม่งั้น session จะหายทุกครั้งที่ปิดแท็บ
    setRememberSession(true)
    setProviderLoading(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider,
        // ต้องเป็น appUrl() ไม่ใช่ origin เปล่าๆ — deployment แบบ path-based
        // (smartlocal.vercel.app/{slug}/...) จะถูกตัด slug ทิ้ง พอ provider ส่งกลับมาที่ origin
        // detectTenantSlug() หา slug ไม่เจอ แอปขึ้น "ไม่พบรหัสหน่วยงาน" และ checkAndFixProfile
        // ไม่ถูกเรียก บัญชีที่สมัครใหม่จึงค้างเป็น municipality_id = null ถาวร
        // queryParams ถูกต่อท้าย URL /authorize ของ GoTrue แล้วส่งต่อไปยัง provider ตัวจริง
        // (GoTrue ตัดทิ้งเฉพาะพารามิเตอร์ที่ตัวเองคุม เช่น redirect_uri/state/code_challenge
        // ที่เหลือ forward ให้หมด) ใช้สั่งพฤติกรรมฝั่ง LINE ได้โดยไม่ต้องประกอบ URL เอง
        options: { redirectTo: appUrl('/'), ...(queryParams ? { queryParams } : {}) },
      })
      if (err) setError(errorText)
      else return // สำเร็จ = กำลัง redirect ออกไป ปล่อยสปินเนอร์ค้างไว้ตามเดิม
    } catch (err) {
      console.error(`[auth] signInWithOAuth(${provider}) ล้มเหลว:`, err?.message ?? err)
      setError(`${errorText} — เซิร์ฟเวอร์ตอบช้าหรือสัญญาณขาดช่วง กรุณาลองใหม่`)
    }
    setProviderLoading(false)
  }

  async function handleGoogle() {
    if (inAppBrowser) {
      setError('ไม่สามารถเข้าสู่ระบบด้วย Google ในบราวเซอร์นี้ได้ กรุณาเปิดลิงก์ใน Safari ก่อน')
      return
    }
    await startOAuth('google', { setLoading: setLoadingGoogle, errorText: 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้' })
  }

  async function handleLine() {
    await startOAuth('custom:line', { setLoading: setLoadingLine, errorText: 'ไม่สามารถเข้าสู่ระบบด้วย LINE ได้' })
  }

  // ทางสำรองสำหรับเครื่องที่เปิดแอป LINE ไม่ขึ้น (แอปเวอร์ชันเก่า / ถอนแอปไปแล้ว / WebView บล็อก)
  //
  // ตามเอกสาร LINE Login v2.1 บนมือถือ "auto login" ผ่านแอปจะมาก่อนเสมอถ้าสภาพแวดล้อมรองรับ
  // พอแอปเปิดไม่ขึ้น ผู้ใช้จะค้างอยู่ที่หน้าของ LINE — และเบราว์เซอร์ออกจากหน้าเราไปแล้วตั้งแต่ตอน
  // redirect เราจึงดักจับหรือขึ้น error ให้ไม่ได้เลย ต้องให้ผู้ใช้เลือกเส้นทางเองตั้งแต่ต้น
  //
  // disable_auto_login=true สั่งให้ LINE ข้ามการเรียกแอปแล้วแสดงฟอร์มล็อกอินบนเว็บแทน
  // ⚠️ ข้อจำกัดที่เลี่ยงไม่ได้: ฟอร์มนั้นต้องใช้อีเมล+รหัสผ่านของบัญชี LINE ซึ่งคนที่สมัคร LINE
  // ด้วยเบอร์อย่างเดียวจะไม่มี — กลุ่มนั้นต้องใช้การสมัครด้วยเบอร์โทรของระบบเราแทน จึงเขียนกำกับ
  // ไว้ที่ปุ่มด้วย ไม่ปล่อยให้กดแล้วไปตันเอาข้างหน้า
  async function handleLineWebOnly() {
    await startOAuth('custom:line', {
      setLoading: setLoadingLineWeb,
      errorText: 'ไม่สามารถเข้าสู่ระบบด้วย LINE ได้',
      queryParams: { disable_auto_login: 'true' },
    })
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    const email = forgotEmail.trim()
    if (!email.includes('@')) {
      setError('บัญชีที่สมัครด้วยเบอร์โทรศัพท์ไม่สามารถรีเซ็ตรหัสผ่านทางอีเมลได้\nกรุณาติดต่อเจ้าหน้าที่')
      return
    }
    setError('')
    setLoading(true)
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: appUrl('/reset-password'),
      })
      if (err) {
        setError('ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      } else {
        setSuccess(`ส่งลิงก์รีเซ็ตรหัสผ่านไปที่ ${email} แล้ว\nกรุณาตรวจสอบกล่องขาเข้า (และโฟลเดอร์ Spam)`)
      }
    } catch (err) {
      console.error('[auth] resetPasswordForEmail ล้มเหลว:', err?.message ?? err)
      setError('ส่งอีเมลไม่สำเร็จ — เซิร์ฟเวอร์ตอบช้าหรือสัญญาณขาดช่วง กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    // ต้องมี try/finally: signInWithPassword reject ได้จริงเมื่อเน็ตหลุดหรือชน timeout 25 วิ
    // ของ fetchWithTimeout ถ้าปล่อยหลุด setLoading(false) ไม่ได้รัน ปุ่ม "เข้าสู่ระบบ" จะค้าง
    // เป็นสปินเนอร์ disabled ถาวร ผู้ใช้กดซ้ำไม่ได้และไม่มีข้อความบอกว่าเกิดอะไรขึ้น
    // ต้องตั้งก่อนยิง signIn — storage adapter ใน supabase.js อ่านค่านี้ตอนเขียน session ลงเครื่อง
    setRememberSession(remember)
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: resolveLoginEmail(form.email),
        password: form.password,
      })
      if (err) {
        setError(isNetworkAuthError(err)
          ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — สัญญาณขาดช่วงหรือเซิร์ฟเวอร์ตอบช้า กรุณาลองใหม่'
          : 'เบอร์โทร/อีเมล หรือรหัสผ่านไม่ถูกต้อง')
        return
      }
      navigate(from, { replace: true })
    } catch (err) {
      console.error('[auth] signInWithPassword ล้มเหลว:', err?.message ?? err)
      setError('เข้าสู่ระบบไม่สำเร็จ — เซิร์ฟเวอร์ตอบช้าหรือสัญญาณขาดช่วง กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    setError('')
    if (!form.name_first.trim() || !form.name_last.trim()) { setError('กรุณากรอกชื่อและนามสกุล'); return }
    const passwordError = validateNewPassword(form.password)
    if (passwordError) { setError(passwordError); return }

    const fullName = joinThaiFullName(form.name_title, form.name_first, form.name_last)
    const hasEmail = form.email.trim().length > 0
    // เบอร์โทรเป็นฟิลด์บังคับของฟอร์มสมัคร (และกลายเป็นชื่อบัญชีเมื่อไม่กรอกอีเมล) จึงต้องตรวจ
    // ทุกกรณี ไม่ใช่เฉพาะตอนไม่มีอีเมลอย่างของเดิม — ที่ผ่านมาคนที่กรอกอีเมลมาด้วยใส่เบอร์มั่วได้
    // แล้วเจ้าหน้าที่โทรกลับไม่ได้ตอนมีคำร้อง
    const normalizedPhone = normalizeThaiPhone(form.phone)
    if (normalizedPhone.length < 9 || normalizedPhone.length > 10) {
      setError('กรุณาใส่เบอร์โทรศัพท์ให้ถูกต้อง (9-10 หลัก)')
      return
    }

    const email = hasEmail ? form.email.trim() : phoneToLoginEmail(normalizedPhone)
    setLoading(true)
    // ขั้นตอนสมัครยิง network หลายรอบต่อกัน (signUp → upsert profile → auto sign-in) ถ้ารอบไหน
    // reject กลางทาง (เน็ตหลุด/timeout 25 วิ) โดยไม่มี finally ปุ่มสมัครจะค้างเป็นสปินเนอร์ถาวร
    // ปล่อย setLoading(false) ไว้ที่ finally จุดเดียว ครอบทุกเส้นทางออกรวมถึง auto sign-in ท้ายสุด
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: {
          data: {
            full_name: fullName,
            phone: normalizedPhone,
            municipality_id: tenant?.id ?? null,
          },
        },
      })
      if (err) {
        const msg = err.message?.toLowerCase() ?? ''
        if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('duplicate')) {
          const usingPhone = !form.email.trim()
          setError(usingPhone
            ? '⚠️ เบอร์มือถือนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบแทน'
            : '⚠️ อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบแทน หรือใช้อีเมลใหม่'
          )
        } else {
          setError(err.message)
        }
        return
      }

      const userId = data.user?.id
      if (userId && tenant?.id) {
        // handle_new_user() สร้างโปรไฟล์ให้ตั้งแต่ตอน INSERT auth.users แล้ว (SECURITY DEFINER
        // ไม่ติด RLS) รอบนี้เป็นแค่การเติมซ้ำให้ชัวร์ ถ้าล้มก็ไม่ควรขวางการสมัคร — แต่ต้องเห็นใน log
        // ไม่ใช่กลืนเงียบแบบเดิม เพราะถ้ามันล้มบ่อยแปลว่า trigger ฝั่ง DB มีปัญหาที่ต้องไล่จริง
        const { error: upsertErr } = await supabase.from('profiles').upsert({
          id: userId,
          full_name: fullName,
          phone: normalizedPhone || null,
          municipality_id: tenant.id,
          role: 'citizen',
        }, { onConflict: 'id' })
        if (upsertErr) console.error('[auth] เติมข้อมูลโปรไฟล์หลังสมัครไม่สำเร็จ:', upsertErr.message)
      }

      if (data.session) {
        navigate(from, { replace: true })
        return
      }
      // session อาจ null แม้ปิด confirm email — sign in อัตโนมัติด้วยข้อมูลเดิม
      const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password: form.password })
      if (!loginErr) {
        navigate(from, { replace: true })
      } else {
        setSuccess('สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบ')
        setMode('login')
      }
    } catch (err) {
      console.error('[auth] สมัครสมาชิกล้มเหลว:', err?.message ?? err)
      setError('สมัครสมาชิกไม่สำเร็จ — เซิร์ฟเวอร์ตอบช้าหรือสัญญาณขาดช่วง กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 pt-10 pb-28">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-gray-100 p-8">

        {/* In-app browser warning */}
        {inAppBrowser && (
          <div className="mb-5 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-sm font-semibold text-amber-800 mb-1">⚠️ เปิดในบราวเซอร์ในแอป</p>
            <p className="text-xs text-amber-700 mb-3">
              ไม่สามารถเข้าสู่ระบบด้วย Google ได้จากบราวเซอร์นี้
              กรุณาเปิดในบราวเซอร์จริงก่อน
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  const url = window.location.href
                  window.location.href = url.replace(/^https:\/\//, 'googlechromes://').replace(/^http:\/\//, 'googlechrome://')
                }}
                className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-white border border-amber-300 text-amber-900 text-xs font-semibold shadow-sm active:scale-95 transition-all"
              >
                <svg width="14" height="14" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M47.5 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h13.2c-.6 3-2.3 5.6-4.9 7.3v6h7.9c4.6-4.3 7.3-10.6 7.3-17.5z" fill="#4285F4"/>
                  <path d="M24 48c6.6 0 12.2-2.2 16.2-5.9l-7.9-6c-2.2 1.5-5 2.3-8.3 2.3-6.4 0-11.8-4.3-13.7-10.1H2.1v6.2C6.1 42.7 14.5 48 24 48z" fill="#34A853"/>
                  <path d="M10.3 28.3c-.5-1.5-.8-3-.8-4.3s.3-2.8.8-4.3v-6.2H2.1C.8 16.2 0 19.9 0 24s.8 7.8 2.1 10.5l8.2-6.2z" fill="#FBBC05"/>
                  <path d="M24 9.5c3.6 0 6.8 1.2 9.3 3.6l6.9-6.9C36.2 2.3 30.6 0 24 0 14.5 0 6.1 5.3 2.1 13.5l8.2 6.2C12.2 13.8 17.6 9.5 24 9.5z" fill="#EA4335"/>
                </svg>
                เปิดใน Google Chrome
              </button>
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white border border-amber-300 text-amber-900 text-xs font-semibold shadow-sm active:scale-95 transition-all"
              >
                <ExternalLink size={13} />
                เปิดใน Safari
              </a>
            </div>
          </div>
        )}


        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
               style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
            <UserCircle2 size={32} className="text-white" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-xl font-bold text-gray-800 text-center mb-1">
          {mode === 'forgot' ? 'รีเซ็ตรหัสผ่าน' : mode === 'qr' ? 'เข้าสู่ระบบด้วยรหัสจากมือถือ' : mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
        </h1>
        <p className="text-sm text-gray-400 text-center mb-6">
          {mode === 'forgot'
            ? 'ระบุอีเมลที่ลงทะเบียนไว้ เราจะส่งลิงก์ให้'
            : mode === 'qr'
            ? 'สำหรับเจ้าหน้าที่ที่ไปใช้คอมพิวเตอร์เครื่องอื่น'
            : mode === 'login'
            ? `เข้าสู่ระบบ${tenant?.system_name || `${tenant?.name} One Data`}`
            : 'สร้างบัญชีเพื่อใช้บริการ'}
        </p>

        {/* Tab — ซ่อนเมื่อ forgot */}
        {mode !== 'forgot' && mode !== 'qr' && (
          <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
            {['login', 'register'].map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(''); setSuccess('') }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === m ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
                }`}>
                {m === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
              </button>
            ))}
          </div>
        )}

        {/* Success msg (login/register only — forgot มี inline success ของตัวเอง) */}
        {success && mode !== 'forgot' && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3 mb-4">
            {success}
          </div>
        )}


        {/* Forgot password form */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            {success ? (
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-4 text-center leading-relaxed whitespace-pre-line">
                {success}
              </div>
            ) : (
              <>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={forgotEmail}
                    onChange={(e) => { setForgotEmail(e.target.value); setError('') }}
                    required type="email" placeholder="อีเมลที่ลงทะเบียนไว้"
                    autoComplete="email"
                    className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:border-transparent"
                    style={{ '--tw-ring-color': 'var(--color-primary)' }}
                  />
                </div>
                {error && <p className="text-sm text-red-500 text-center whitespace-pre-line">{error}</p>}
                <button type="submit" disabled={loading}
                  className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all disabled:opacity-60 active:scale-95"
                  style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
                  {loading
                    ? <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> กำลังส่ง...</span>
                    : 'ส่งลิงก์รีเซ็ตรหัสผ่าน'
                  }
                </button>
              </>
            )}
            <button type="button" onClick={() => { setMode('login'); setError(''); setSuccess(''); setForgotEmail('') }}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors py-1">
              <ArrowLeft size={14} /> กลับไปเข้าสู่ระบบ
            </button>
          </form>
        )}

        {/* Form */}
        {mode !== 'forgot' && mode !== 'qr' && (
        <>
        <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-3" autoComplete="on">
          {mode === 'register' && (
            <div className="flex gap-2">
              <select value={form.name_title} onChange={set('name_title')}
                className="w-24 shrink-0 px-2 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': 'var(--color-primary)' }}>
                <option value="">คำนำหน้า</option>
                {NAME_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input value={form.name_first} onChange={set('name_first')} required
                type="text" placeholder="ชื่อ" autoComplete="given-name"
                className="flex-1 min-w-0 px-3 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
              <input value={form.name_last} onChange={set('name_last')} required
                type="text" placeholder="นามสกุล" autoComplete="family-name"
                className="flex-1 min-w-0 px-3 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            </div>
          )}

          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={form.email} onChange={set('email')}
              required={mode === 'login'}
              type={mode === 'login' ? 'text' : 'email'}
              placeholder={mode === 'login' ? 'อีเมลหรือเบอร์โทรศัพท์' : 'อีเมล (ไม่บังคับ)'}
              autoComplete="email"
              className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': 'var(--color-primary)' }} />
          </div>

          {mode === 'register' && (
            <div className="relative">
              <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={form.phone} onChange={set('phone')}
                required type="tel" placeholder="เบอร์โทรศัพท์ *"
                autoComplete="tel"
                className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            </div>
          )}

          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={form.password} onChange={set('password')} required
              type={showPassword ? 'text' : 'password'}
              placeholder={mode === 'register' ? `รหัสผ่าน (${PASSWORD_HINT})` : 'รหัสผ่าน'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              className="w-full pl-9 pr-10 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            <button type="button" onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {mode === 'login' && (
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                  className="w-4 h-4 rounded accent-(--color-primary)" />
                <span className="text-sm text-gray-500">จำการเข้าสู่ระบบไว้บนเครื่องนี้</span>
              </label>
              <button type="button" onClick={() => { setMode('forgot'); setError(''); setSuccess('') }}
                className="text-sm text-blue-500 hover:text-blue-700 transition-colors">
                ลืมรหัสผ่าน?
              </button>
            </div>
          )}

          {error && <p className="text-sm text-red-500 text-center">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all disabled:opacity-60 active:scale-95 mt-2"
            style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
            {loading
              ? <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> กำลังดำเนินการ...</span>
              : mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'
            }
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">หรือ</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* LINE OAuth */}
        <button onClick={handleLine} disabled={loadingLine}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-xl text-white text-sm font-medium active:scale-95 transition-all disabled:opacity-60 shadow-sm"
          style={{ backgroundColor: '#06C755' }}>
          {loadingLine ? (
            <Loader2 size={18} className="animate-spin text-white/80" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.477 2 2 6.065 2 11.108c0 4.535 4.02 8.33 9.452 8.997.368.08.869.243.996.558.114.287.075.736.037 1.025l-.161.965c-.05.287-.226 1.122.984.612 1.21-.51 6.523-3.84 8.9-6.578C23.48 14.96 22 13.155 22 11.108 22 6.065 17.523 2 12 2z" fill="white"/>
              <path d="M9.807 9.2H8.8a.2.2 0 0 0-.2.2v3.2c0 .11.09.2.2.2h1.007a.2.2 0 0 0 .2-.2V9.4a.2.2 0 0 0-.2-.2zm5.593 0h-1.007a.2.2 0 0 0-.2.2v1.9l-1.463-2.007A.2.2 0 0 0 12.567 9.2h-1.007a.2.2 0 0 0-.2.2v3.2c0 .11.09.2.2.2H12.567a.2.2 0 0 0 .2-.2v-1.9l1.465 2.008a.2.2 0 0 0 .168.092H15.4a.2.2 0 0 0 .2-.2V9.4a.2.2 0 0 0-.2-.2zm-7.2 0H7a.2.2 0 0 0-.2.2v3.2c0 .11.09.2.2.2h2.2a.2.2 0 0 0 .2-.2v-.8a.2.2 0 0 0-.2-.2H7.8v-2.2a.2.2 0 0 0-.2-.2H7.2zm10 2.4h-1.4v-2.2a.2.2 0 0 0-.2-.2h-.8a.2.2 0 0 0-.2.2v3.2c0 .11.09.2.2.2H17.4a.2.2 0 0 0 .2-.2v-.8a.2.2 0 0 0-.2-.2z" fill="#06C755"/>
            </svg>
          )}
          {mode === 'login' ? 'เข้าสู่ระบบด้วย LINE' : 'สมัครด้วย LINE'}
        </button>

        {/* ทางสำรองเมื่อกดปุ่มบนแล้วเครื่องเรียกแอป LINE ไม่ขึ้น — ดูเหตุผลที่ handleLineWebOnly() */}
        <button onClick={handleLineWebOnly} disabled={loadingLineWeb}
          className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-2 disabled:opacity-60">
          {loadingLineWeb ? 'กำลังเปิดหน้า LINE...' : 'กดแล้วแอป LINE ไม่เปิด? เข้าผ่านหน้าเว็บ LINE แทน'}
        </button>

        {/* Google OAuth */}
        <button onClick={handleGoogle} disabled={loadingGoogle}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-60 shadow-sm mt-3">
          {loadingGoogle ? (
            <Loader2 size={18} className="animate-spin text-gray-400" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M47.5 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h13.2c-.6 3-2.3 5.6-4.9 7.3v6h7.9c4.6-4.3 7.3-10.6 7.3-17.5z" fill="#4285F4"/>
              <path d="M24 48c6.6 0 12.2-2.2 16.2-5.9l-7.9-6c-2.2 1.5-5 2.3-8.3 2.3-6.4 0-11.8-4.3-13.7-10.1H2.1v6.2C6.1 42.7 14.5 48 24 48z" fill="#34A853"/>
              <path d="M10.3 28.3c-.5-1.5-.8-3-.8-4.3s.3-2.8.8-4.3v-6.2H2.1C.8 16.2 0 19.9 0 24s.8 7.8 2.1 10.5l8.2-6.2z" fill="#FBBC05"/>
              <path d="M24 9.5c3.6 0 6.8 1.2 9.3 3.6l6.9-6.9C36.2 2.3 30.6 0 24 0 14.5 0 6.1 5.3 2.1 13.5l8.2 6.2C12.2 13.8 17.6 9.5 24 9.5z" fill="#EA4335"/>
            </svg>
          )}
          {mode === 'login' ? 'เข้าสู่ระบบด้วย Google' : 'สมัครด้วย Google'}
        </button>

        {/* ทางเข้าสำหรับเจ้าหน้าที่ที่ไปใช้ PC เครื่องอื่น — กดปุ่ม Google/LINE บนเครื่องคนอื่นจะเข้าเป็น
            บัญชีเจ้าของเครื่อง ทำให้ audit log บันทึกผู้กระทำผิดตัว โชว์เฉพาะตอนเข้าสู่ระบบ
            (ไม่โชว์ตอนสมัครสมาชิก) ประชาชนที่กดเข้ามาจะถูกปฏิเสธที่ฝั่งเซิร์ฟเวอร์อยู่แล้ว */}
        {mode === 'login' && (
          <button onClick={() => { setMode('qr'); setError(''); setSuccess('') }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm font-medium hover:bg-gray-50 active:scale-95 transition-all shadow-sm mt-3">
            <Smartphone size={17} className="text-gray-400" />
            เข้าสู่ระบบด้วยรหัสจากมือถือ (สำหรับเจ้าหน้าที่)
          </button>
        )}
        </>
        )}

        {mode === 'qr' && (
          <>
            <DeviceLoginPanel />
            <button type="button" onClick={() => { setMode('login'); setError('') }}
              className="w-full mt-5 flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
              <ArrowLeft size={15} /> กลับไปหน้าเข้าสู่ระบบ
            </button>
          </>
        )}
      </div>
    </div>
  )
}

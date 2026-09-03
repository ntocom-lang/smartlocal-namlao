import { useState } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { supabase, setRememberSession } from '../lib/supabase'
import { isNetworkAuthError } from '../lib/authErrors'
import { appUrl } from '../lib/basename'
import { Lock, Mail, Loader2, ShieldCheck, Eye, EyeOff, KeyRound, Smartphone } from 'lucide-react'
import DeviceLoginPanel from '../components/auth/DeviceLoginPanel'

export default function AdminLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  // RequireAuth ส่ง path เดิมมาให้ตอนเด้งคนที่ยังไม่ล็อกอินออกจากหน้าแอดมิน — พากลับที่เดิมหลัง
  // ล็อกอินเสร็จ ไม่มีก็ลง /admin (ไม่ใช่ '/' เพราะนี่คือประตูฝั่งเจ้าหน้าที่)
  const from = location.state?.from ?? '/admin'
  // ถอดการออกจากระบบอัตโนมัติเมื่อไม่ได้ใช้งานออกไปแล้ว (2026-08-29 ดู docs/device-login-design.md ข้อ 7)
  // ไม่มีโค้ดจุดไหนพามาที่ ?reason=idle อีก แต่คงข้อความนี้ไว้เพราะแอปเป็น PWA — เครื่องที่ยัง
  // ค้าง bundle เก่าจาก service worker ยังเด้งมาที่ URL นี้ได้อยู่ ลบทิ้งตอนนี้จะกลายเป็นถูก
  // เด้งออกโดยไม่มีคำอธิบาย ซึ่งเจ้าหน้าที่จะนึกว่าระบบล่ม
  const loggedOutForIdle = searchParams.get('reason') === 'idle'
  // ทางเดียวที่เหลือที่ระบบพาผู้ใช้ออกเอง: refresh token ถูกเซิร์ฟเวอร์ปฏิเสธสองรอบติด
  // (ดู recoverExpiredSession ใน src/lib/supabase.js) เน็ตหลุดไม่เข้าเงื่อนไขนี้
  const loggedOutForExpired = searchParams.get('reason') === 'expired'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // ค่าเริ่มต้น = จำไว้ ให้ตรงกับพฤติกรรมเดิม การไม่ติ๊กคือเจ้าหน้าที่เลือกเองว่าไม่ให้ค้าง
  // บนเครื่องนี้ (session จะอยู่แค่จนปิดแท็บ) ไม่ใช่ระบบพาออกอัตโนมัติ
  const [remember, setRemember] = useState(true)
  // เจ้าหน้าที่ที่ไปใช้ PC เครื่องคนอื่นไม่ควรต้องพิมพ์รหัสผ่านทิ้งไว้บนเครื่องนั้น
  const [tab, setTab] = useState('password')
  const [loadingGoogle, setLoadingGoogle] = useState(false)
  const [loadingLine, setLoadingLine] = useState(false)
  const [loadingLineWeb, setLoadingLineWeb] = useState(false)
  // แยกจาก error ของฟอร์มรหัสผ่าน ไม่ให้ข้อความของคนละวิธีเข้าระบบทับกัน
  const [oauthError, setOauthError] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    // ต้องมี try/finally: signInWithPassword reject ได้จริง (เน็ตหลุด หรือชน timeout 25 วิ ของ
    // fetchWithTimeout ใน supabase.js) ไม่ใช่แค่คืน error object พอ await โยนออกไป setLoading(false)
    // ไม่ได้รัน ปุ่มจะค้างเป็น "กำลังเข้าสู่ระบบ..." แบบ disabled ถาวร เจ้าหน้าที่กดซ้ำไม่ได้
    // และไม่มีข้อความบอกว่าเกิดอะไรขึ้น ต้องเดาเองว่าต้องรีเฟรชหน้า
    // ต้องตั้งก่อนยิง signIn — storage adapter ใน supabase.js อ่านค่านี้ตอนเขียน session ลงเครื่อง
    // ของเดิมส่ง options.persistSession ซึ่ง auth-js ไม่เคยอ่าน ติ๊กหรือไม่ก็ค้างบนเครื่องเหมือนกันหมด
    setRememberSession(remember)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (authError) {
        setError(isNetworkAuthError(authError)
          ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — สัญญาณขาดช่วงหรือเซิร์ฟเวอร์ตอบช้า กรุณาลองใหม่'
          : 'อีเมลหรือรหัสผ่านไม่ถูกต้อง')
        return
      }
      navigate('/admin')
    } catch (err) {
      console.error('[admin-login] เข้าสู่ระบบล้มเหลว:', err?.message ?? err)
      setError('เข้าสู่ระบบไม่สำเร็จ — เซิร์ฟเวอร์ตอบช้าหรือสัญญาณขาดช่วง กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  // ปุ่ม OAuth ฝั่งเจ้าหน้าที่ — ต่างจากของ AuthPage 2 จุดที่จงใจ ไม่ควร merge เป็นตัวเดียวกัน
  //   1. เคารพช่องติ๊ก "จำการเข้าสู่ระบบไว้บนเครื่องนี้" (AuthPage บังคับ true เพราะเป็นมือถือ
  //      ส่วนตัวของประชาชน) เครื่องกลางในสำนักงานต้องเลือกได้ว่าไม่ให้ session ค้าง
  //   2. กลับมาลง /admin ไม่ใช่หน้าแรกประชาชน
  //
  // ที่ต้องเขียน try/catch: signInWithOAuth "reject" ได้จริง (เน็ตหลุด หรือชน timeout 25 วิของ
  // fetchWithTimeout) ถ้าไม่ดัก setLoading(false) ไม่ได้รัน ปุ่มจะค้างเป็นสปินเนอร์ disabled ถาวร
  // ถ้าสำเร็จ เบราว์เซอร์ redirect ออกไปหน้า provider ก่อนถึงบรรทัดปิดสปินเนอร์ — ถูกต้องแล้ว
  async function startOAuth(provider, { setLoading: setProviderLoading, errorText, queryParams }) {
    // App.jsx อ่านคีย์นี้ตอน SIGNED_IN แล้ว navigate ต่อให้ (ดู src/App.jsx บรรทัด oauth_from)
    sessionStorage.setItem('oauth_from', from)
    setRememberSession(remember)
    setProviderLoading(true)
    setOauthError('')
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider,
        // ต้องเป็น appUrl() ไม่ใช่ origin เปล่าๆ — deployment แบบ path-based จะถูกตัด slug ทิ้ง
        // แล้วแอปหาหน่วยงานไม่เจอตอน provider ส่งกลับมา
        options: { redirectTo: appUrl('/'), ...(queryParams ? { queryParams } : {}) },
      })
      if (err) setOauthError(errorText)
      else return
    } catch (err) {
      console.error(`[admin-login] signInWithOAuth(${provider}) ล้มเหลว:`, err?.message ?? err)
      setOauthError(`${errorText} — เซิร์ฟเวอร์ตอบช้าหรือสัญญาณขาดช่วง กรุณาลองใหม่`)
    }
    setProviderLoading(false)
  }

  // prompt=select_account สำคัญกว่าปกติที่หน้านี้ เพราะ PC ในสำนักงานมักใช้ร่วมกันหลายคนและ
  // เบราว์เซอร์จำบัญชีเจ้าของเครื่องไว้ ถ้าไม่บังคับถาม จะเข้าเป็นบัญชีคนอื่นเงียบๆ แล้ว audit log
  // บันทึกผู้กระทำผิดตัว ซึ่งเป็นหลักฐานที่ สตง./ป.ป.ช. ใช้ตรวจย้อนหลัง
  async function handleGoogle() {
    await startOAuth('google', {
      setLoading: setLoadingGoogle,
      errorText: 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้',
      queryParams: { prompt: 'select_account' },
    })
  }

  async function handleLine() {
    await startOAuth('custom:line', { setLoading: setLoadingLine, errorText: 'ไม่สามารถเข้าสู่ระบบด้วย LINE ได้' })
  }

  // ทางสำรองเมื่อเครื่องเรียกแอป LINE ไม่ขึ้น (แอปเก่า/ถอนแอปไปแล้ว/WebView บล็อก) — พอ redirect
  // ออกไปแล้วเราดักหรือขึ้น error ให้ไม่ได้เลย ต้องให้ผู้ใช้เลือกเส้นทางเองตั้งแต่ต้น
  // ⚠️ ฟอร์มเว็บของ LINE ต้องใช้อีเมล+รหัสผ่านของบัญชี LINE ซึ่งคนที่สมัคร LINE ด้วยเบอร์อย่างเดียว
  // จะไม่มี กลุ่มนั้นต้องใช้รหัสผ่านของระบบเราหรือแท็บ "รหัสจากมือถือ" แทน
  async function handleLineWebOnly() {
    await startOAuth('custom:line', {
      setLoading: setLoadingLineWeb,
      errorText: 'ไม่สามารถเข้าสู่ระบบด้วย LINE ได้',
      queryParams: { disable_auto_login: 'true' },
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
               style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
            <ShieldCheck size={32} className="text-white" />
          </div>
        </div>

        <h1 className="text-xl font-bold text-gray-800 text-center mb-1">เข้าสู่ระบบเจ้าหน้าที่</h1>
        <p className="text-sm text-gray-400 text-center mb-5">แผงควบคุมสำหรับผู้ดูแลระบบ</p>

        {loggedOutForExpired && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 text-center leading-relaxed">
            สิทธิ์การเข้าใช้งานของอุปกรณ์นี้หมดอายุแล้ว กรุณาเข้าสู่ระบบอีกครั้ง<br />
            <span className="text-xs">ไม่ได้เกิดจากสัญญาณอินเทอร์เน็ตขาดช่วง</span>
          </p>
        )}

        {loggedOutForIdle && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 text-center leading-relaxed">
            ออกจากระบบให้อัตโนมัติแล้ว เพราะไม่ได้ใช้งานนานเกิน 1 ชั่วโมง<br />
            <span className="text-xs">เพื่อไม่ให้บัญชีของคุณค้างอยู่บนเครื่องนี้</span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-1 p-1 bg-gray-50 rounded-xl mb-5">
          {[
            { key: "password", label: "รหัสผ่าน", Icon: KeyRound },
            { key: "qr", label: "รหัสจากมือถือ", Icon: Smartphone },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${tab === key ? "bg-white shadow-sm text-gray-800" : "text-gray-400"}`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {tab === "password" ? (
        <>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="อีเมล"
              required
              className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}
            />
          </div>

          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="รหัสผ่าน"
              required
              className="w-full pl-9 pr-10 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-4 h-4 rounded accent-(--color-primary)"
            />
            <span className="text-sm text-gray-500">จำการเข้าสู่ระบบไว้บนเครื่องนี้</span>
          </label>

          {error && (
            <p className="text-sm text-red-500 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all disabled:opacity-60 active:scale-95"
            style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" /> กำลังเข้าสู่ระบบ...
              </span>
            ) : 'เข้าสู่ระบบ'}
          </button>
        </form>

        {/* ทางเข้าสำหรับเจ้าหน้าที่ที่สมัครบัญชีไว้ด้วย Google/LINE — ไม่มีรหัสผ่านให้กรอกในฟอร์มบน
            การกดปุ่มนี้ไม่ได้ให้สิทธิ์แอดมิน สิทธิ์ยังตัดสินที่ role ใน profiles ผ่าน RequireAuth
            adminOnly เหมือนเดิม คนที่ไม่มีสิทธิ์จะถูกเด้งกลับหน้าของตัวเอง */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">หรือ</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        <button type="button" onClick={handleGoogle} disabled={loadingGoogle}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-60 shadow-sm">
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
          เข้าสู่ระบบด้วย Google
        </button>

        <button type="button" onClick={handleLine} disabled={loadingLine}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-xl text-white text-sm font-medium active:scale-95 transition-all disabled:opacity-60 shadow-sm mt-3"
          style={{ backgroundColor: '#06C755' }}>
          {loadingLine ? (
            <Loader2 size={18} className="animate-spin text-white/80" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.477 2 2 6.065 2 11.108c0 4.535 4.02 8.33 9.452 8.997.368.08.869.243.996.558.114.287.075.736.037 1.025l-.161.965c-.05.287-.226 1.122.984.612 1.21-.51 6.523-3.84 8.9-6.578C23.48 14.96 22 13.155 22 11.108 22 6.065 17.523 2 12 2z" fill="white"/>
              <path d="M9.807 9.2H8.8a.2.2 0 0 0-.2.2v3.2c0 .11.09.2.2.2h1.007a.2.2 0 0 0 .2-.2V9.4a.2.2 0 0 0-.2-.2zm5.593 0h-1.007a.2.2 0 0 0-.2.2v1.9l-1.463-2.007A.2.2 0 0 0 12.567 9.2h-1.007a.2.2 0 0 0-.2.2v3.2c0 .11.09.2.2.2H12.567a.2.2 0 0 0 .2-.2v-1.9l1.465 2.008a.2.2 0 0 0 .168.092H15.4a.2.2 0 0 0 .2-.2V9.4a.2.2 0 0 0-.2-.2zm-7.2 0H7a.2.2 0 0 0-.2.2v3.2c0 .11.09.2.2.2h2.2a.2.2 0 0 0 .2-.2v-.8a.2.2 0 0 0-.2-.2H7.8v-2.2a.2.2 0 0 0-.2-.2H7.2zm10 2.4h-1.4v-2.2a.2.2 0 0 0-.2-.2h-.8a.2.2 0 0 0-.2.2v3.2c0 .11.09.2.2.2H17.4a.2.2 0 0 0 .2-.2v-.8a.2.2 0 0 0-.2-.2z" fill="#06C755"/>
            </svg>
          )}
          เข้าสู่ระบบด้วย LINE
        </button>

        <button type="button" onClick={handleLineWebOnly} disabled={loadingLineWeb}
          className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-2 disabled:opacity-60">
          {loadingLineWeb ? 'กำลังเปิดหน้า LINE...' : 'กดแล้วแอป LINE ไม่เปิด? เข้าผ่านหน้าเว็บ LINE แทน'}
        </button>

        {oauthError && (
          <p className="text-sm text-red-500 text-center mt-2">{oauthError}</p>
        )}
        </>
        ) : <DeviceLoginPanel />}
      </div>
    </div>
  )
}

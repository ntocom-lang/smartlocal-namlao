import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isNetworkAuthError } from '../lib/authErrors'
import { Lock, Mail, Loader2, ShieldCheck, Eye, EyeOff, KeyRound, Smartphone } from 'lucide-react'
import DeviceLoginPanel from '../components/auth/DeviceLoginPanel'

export default function AdminLogin() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // ถอดการออกจากระบบอัตโนมัติเมื่อไม่ได้ใช้งานออกไปแล้ว (2026-08-29 ดู StaffSessionBar.jsx)
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
  const [remember, setRemember] = useState(false)
  // เจ้าหน้าที่ที่ไปใช้ PC เครื่องคนอื่นไม่ควรต้องพิมพ์รหัสผ่านทิ้งไว้บนเครื่องนั้น
  // (และกดปุ่ม Google/LINE ไม่ได้ เพราะเบราว์เซอร์เครื่องนั้นจำบัญชีเจ้าของเครื่องไว้)
  const [tab, setTab] = useState('password')

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    // ต้องมี try/finally: signInWithPassword reject ได้จริง (เน็ตหลุด หรือชน timeout 25 วิ ของ
    // fetchWithTimeout ใน supabase.js) ไม่ใช่แค่คืน error object พอ await โยนออกไป setLoading(false)
    // ไม่ได้รัน ปุ่มจะค้างเป็น "กำลังเข้าสู่ระบบ..." แบบ disabled ถาวร เจ้าหน้าที่กดซ้ำไม่ได้
    // และไม่มีข้อความบอกว่าเกิดอะไรขึ้น ต้องเดาเองว่าต้องรีเฟรชหน้า
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { persistSession: remember },
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
            <span className="text-sm text-gray-500">จดจำรหัสผ่าน</span>
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
        ) : <DeviceLoginPanel />}
      </div>
    </div>
  )
}

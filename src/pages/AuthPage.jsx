import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { Mail, Lock, User, Loader2, UserCircle2, Phone, Eye, EyeOff, ExternalLink } from 'lucide-react'

const PHONE_EMAIL_DOMAIN = 'phone.smartlocal.app'

function detectInAppBrowser() {
  const ua = navigator.userAgent || ''
  return /FBAN|FBAV|Instagram|Line\/|Twitter\/|MicroMessenger|GSA\/|Musical_ly/.test(ua)
}

function phoneToEmail(phone) {
  return `${phone.replace(/\D/g, '')}@${PHONE_EMAIL_DOMAIN}`
}

function resolveLoginEmail(input) {
  const v = input.trim()
  return v.includes('@') ? v : phoneToEmail(v)
}

export default function AuthPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tenant } = useTenant()
  const from = location.state?.from ?? '/'
  const inAppBrowser = detectInAppBrowser()

  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [form, setForm] = useState({ email: '', password: '', name: '', phone: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(false)
  const [loadingGoogle, setLoadingGoogle] = useState(false)
  const [loadingLine, setLoadingLine] = useState(false)

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }))

  function handleLine() {
    setLoadingLine(true)
    const state = crypto.randomUUID()
    // Callback URL อยู่ที่ root เสมอ → ลงทะเบียนแค่ URL เดียวใน LINE Developers
    const redirectUri = `${window.location.origin}/auth/line/callback`
    // เก็บ full path (รวม slug เช่น /namlao) เพื่อกลับมาหน่วยงานที่ถูกต้องหลัง auth
    const basePath = window.location.pathname.replace(/\/auth.*$/, '')
    const routerFrom = from === '/' ? '' : from
    const returnTo = (basePath + routerFrom) || '/'
    sessionStorage.setItem('line_oauth_state', state)
    sessionStorage.setItem('line_oauth_redirect_uri', redirectUri)
    sessionStorage.setItem('line_oauth_from', returnTo)
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: import.meta.env.VITE_LINE_CHANNEL_ID,
      redirect_uri: redirectUri,
      state,
      scope: 'profile openid',
    })
    window.location.href = `https://access.line.me/oauth2/v2.1/authorize?${params}`
  }

  async function handleGoogle() {
    if (inAppBrowser) {
      setError('ไม่สามารถเข้าสู่ระบบด้วย Google ในบราวเซอร์นี้ได้ กรุณาเปิดลิงก์ใน Safari ก่อน')
      return
    }
    setLoadingGoogle(true)
    setError('')
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (err) { setError('ไม่สามารถเข้าสู่ระบบด้วย Google ได้'); setLoadingGoogle(false) }
  }

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({
      email: resolveLoginEmail(form.email),
      password: form.password,
      options: { persistSession: remember },
    })
    setLoading(false)
    if (err) { setError('เบอร์โทร/อีเมล หรือรหัสผ่านไม่ถูกต้อง'); return }
    navigate(from, { replace: true })
  }

  async function handleRegister(e) {
    e.preventDefault()
    setError('')
    if (form.password.length < 6) { setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return }

    const hasEmail = form.email.trim().length > 0
    const phoneDigits = form.phone.replace(/\D/g, '')
    if (!hasEmail && phoneDigits.length < 9) {
      setError('กรุณาใส่เบอร์โทรศัพท์ให้ถูกต้อง (อย่างน้อย 9 หลัก)')
      return
    }

    const email = hasEmail ? form.email.trim() : phoneToEmail(form.phone)
    setLoading(true)
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password: form.password,
      options: {
        data: {
          full_name: form.name.trim(),
          phone: form.phone.trim(),
          municipality_id: tenant?.id ?? null,
        },
      },
    })
    if (err) {
      setLoading(false)
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
      await supabase.from('profiles').upsert({
        id: userId,
        full_name: form.name.trim(),
        phone: form.phone.trim() || null,
        municipality_id: tenant.id,
        role: 'citizen',
      }, { onConflict: 'id' })
    }

    setLoading(false)
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
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
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
          {mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
        </h1>
        <p className="text-sm text-gray-400 text-center mb-6">
          {mode === 'login' ? 'เข้าสู่ระบบเพื่อยื่นคำร้องออนไลน์' : 'สร้างบัญชีเพื่อใช้บริการ E-Service'}
        </p>

        {/* Tab */}
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

        {/* Success msg */}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3 mb-4">
            {success}
          </div>
        )}


        {/* Form */}
        <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-3" autoComplete="on">
          {mode === 'register' && (
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={form.name} onChange={set('name')} required
                type="text" placeholder="ชื่อ-นามสกุล"
                autoComplete="name"
                className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
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
              placeholder={mode === 'register' ? 'รหัสผ่าน (อย่างน้อย 6 ตัว)' : 'รหัสผ่าน'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              className="w-full pl-9 pr-10 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            <button type="button" onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {mode === 'login' && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                className="w-4 h-4 rounded accent-(--color-primary)" />
              <span className="text-sm text-gray-500">จดจำรหัสผ่าน</span>
            </label>
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
            <svg className="animate-spin w-4.5 h-4.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="white" strokeWidth="4"/>
              <path className="opacity-75" fill="white" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="w-4.5 h-4.5" fill="white">
              <path d="M12 2C6.48 2 2 5.92 2 10.76c0 3.23 2.06 6.07 5.18 7.72-.18.65-.67 2.38-.77 2.75-.12.44.16.43.34.31.14-.09 2.22-1.47 3.12-2.07.69.1 1.4.15 2.13.15 5.52 0 10-3.92 10-8.76S17.52 2 12 2z"/>
            </svg>
          )}
          {mode === 'login' ? 'เข้าสู่ระบบด้วย LINE' : 'สมัครด้วย LINE'}
        </button>

        {/* Google OAuth */}
        <button onClick={handleGoogle} disabled={loadingGoogle}
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
          {mode === 'login' ? 'เข้าสู่ระบบด้วย Google' : 'สมัครด้วย Google'}
        </button>
      </div>
    </div>
  )
}

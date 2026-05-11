import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Mail, Lock, User, Loader2, UserCircle2, Phone, Eye, EyeOff } from 'lucide-react'

export default function AuthPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from ?? '/'

  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [form, setForm] = useState({ email: '', password: '', name: '', phone: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(false)

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }))

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({
      email: form.email,
      password: form.password,
      options: { persistSession: remember },
    })
    setLoading(false)
    if (err) { setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง'); return }
    navigate(from, { replace: true })
  }

  async function handleRegister(e) {
    e.preventDefault()
    setError('')
    if (form.password.length < 6) { setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return }
    setLoading(true)
    const { error: err } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: { full_name: form.name.trim(), phone: form.phone.trim() },
      },
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setSuccess('สมัครสมาชิกสำเร็จ! กรุณาตรวจสอบอีเมลเพื่อยืนยันตัวตน แล้วเข้าสู่ระบบ')
    setMode('login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
        {/* Icon */}
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
        <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-3">
          {mode === 'register' && (
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={form.name} onChange={set('name')} required
                type="text" placeholder="ชื่อ-นามสกุล"
                className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            </div>
          )}

          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={form.email} onChange={set('email')} required
              type="email" placeholder="อีเมล"
              className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': 'var(--color-primary)' }} />
          </div>

          {mode === 'register' && (
            <div className="relative">
              <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={form.phone} onChange={set('phone')}
                type="tel" placeholder="เบอร์โทรศัพท์ (ไม่บังคับ)"
                className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            </div>
          )}

          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={form.password} onChange={set('password')} required
              type={showPassword ? 'text' : 'password'}
              placeholder={mode === 'register' ? 'รหัสผ่าน (อย่างน้อย 6 ตัว)' : 'รหัสผ่าน'}
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
                className="w-4 h-4 rounded accent-[var(--color-primary)]" />
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
      </div>
    </div>
  )
}

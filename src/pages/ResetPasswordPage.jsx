import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Lock, Eye, EyeOff, Loader2, CheckCircle2, ShieldCheck } from 'lucide-react'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Supabase v2 fires PASSWORD_RECOVERY when redirect token is valid
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    // กรณี token อยู่ใน hash แล้ว Supabase process ก่อน component mount
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (password.length < 6) { setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return }
    if (password !== confirm) { setError('รหัสผ่านไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง'); return }
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) {
      setError(`ตั้งรหัสผ่านไม่สำเร็จ: ${err.message}`)
    } else {
      setDone(true)
      setTimeout(() => navigate('/', { replace: true }), 3000)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
               style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
            <ShieldCheck size={32} className="text-white" />
          </div>
        </div>

        <h1 className="text-xl font-bold text-gray-800 text-center mb-1">ตั้งรหัสผ่านใหม่</h1>
        <p className="text-sm text-gray-400 text-center mb-6">กรอกรหัสผ่านใหม่ที่ต้องการใช้งาน</p>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 size={48} className="text-green-500" />
            <p className="text-green-700 font-semibold text-center">ตั้งรหัสผ่านใหม่สำเร็จ!</p>
            <p className="text-sm text-gray-400 text-center">กำลังพาไปหน้าหลัก...</p>
          </div>
        ) : !ready ? (
          <div className="flex flex-col items-center gap-3 py-6 text-gray-400">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-sm">กำลังยืนยันลิงก์...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                required
                type={showPassword ? 'text' : 'password'}
                placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)"
                autoComplete="new-password"
                className="w-full pl-9 pr-10 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': 'var(--color-primary)' }}
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setError('') }}
                required
                type={showPassword ? 'text' : 'password'}
                placeholder="ยืนยันรหัสผ่านใหม่"
                autoComplete="new-password"
                className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': 'var(--color-primary)' }}
              />
            </div>

            {error && <p className="text-sm text-red-500 text-center">{error}</p>}

            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all disabled:opacity-60 active:scale-95"
              style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
              {loading
                ? <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> กำลังบันทึก...</span>
                : 'บันทึกรหัสผ่านใหม่'
              }
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

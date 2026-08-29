import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, initialAuthParams } from '../lib/supabase'
import { Lock, Eye, EyeOff, Loader2, CheckCircle2, ShieldCheck, AlertTriangle } from 'lucide-react'
import { validateNewPassword, PASSWORD_HINT } from '../lib/passwordPolicy'

// ตัดสินตั้งแต่ตอนโหลดโมดูลว่า URL นี้เป็นลิงก์รีเซ็ตรหัสผ่านที่ใช้ได้ไหม
//
// initialAuthParams เป็นค่าคงที่ระดับโมดูล (จับไว้ตั้งแต่ก่อนสร้าง supabase client) ไม่ใช่ state
// ที่เปลี่ยนได้ จึงคำนวณนอก component แล้วใช้เป็นค่าตั้งต้นของ useState ตรงๆ ไม่ต้องยัดใส่ effect
function describeRecoveryLink() {
  if (initialAuthParams.error) {
    const code = initialAuthParams.errorCode ?? ''
    const expired = code === 'otp_expired' || /expired/i.test(initialAuthParams.errorDescription ?? '')
    return {
      watch: false,
      error: expired
        ? 'ลิงก์รีเซ็ตรหัสผ่านนี้หมดอายุแล้ว\nกรุณาขอลิงก์ใหม่ที่หน้าเข้าสู่ระบบ'
        : 'ลิงก์รีเซ็ตรหัสผ่านนี้ใช้ไม่ได้หรือถูกใช้ไปแล้ว\nกรุณาขอลิงก์ใหม่ที่หน้าเข้าสู่ระบบ',
    }
  }

  // type=recovery = flow แบบ implicit, hasCode = flow แบบ PKCE (ค่า default ของ supabase-js)
  if (initialAuthParams.type !== 'recovery' && !initialAuthParams.hasCode) {
    return {
      watch: false,
      error: 'เข้าหน้านี้ได้จากลิงก์ในอีเมลรีเซ็ตรหัสผ่านเท่านั้น\nหากต้องการเปลี่ยนรหัสผ่าน กรุณากด "ลืมรหัสผ่าน?" ที่หน้าเข้าสู่ระบบ',
    }
  }

  return { watch: true, error: '' }
}

const RECOVERY_LINK = describeRecoveryLink()

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)
  // ปลดล็อกฟอร์มได้ทางเดียวคือ "URL นี้เป็นลิงก์รีเซ็ตรหัสผ่านที่ใช้ได้จริง"
  //
  // ของเดิมปลดล็อกทันทีที่ getSession() มี session ซึ่งเป็นจริงกับ "ใครก็ตามที่ล็อกอินค้างอยู่บน
  // เครื่องนี้" ด้วย — เดินไปที่ PC ที่เจ้าหน้าที่เปิดค้างไว้ พิมพ์ /reset-password เอง แล้วตั้ง
  // รหัสผ่านใหม่ยึดบัญชีได้เลยโดยไม่ต้องรู้รหัสเดิม (secure_password_change ปิดอยู่ ไม่มีด่านถามซ้ำ)
  const [linkError, setLinkError] = useState(RECOVERY_LINK.error)

  useEffect(() => {
    if (!RECOVERY_LINK.watch) return undefined

    let verified = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { verified = true; setReady(true) }
    })

    // เผื่อ PASSWORD_RECOVERY ยิงไปก่อนหน้านี้จะ mount (หน้านี้ถูก lazy-load, _initialize ยิง event
    // ใน setTimeout 0) — ปลอดภัยเพราะยังต้องผ่านด่าน isRecoveryUrl ข้างบนมาก่อนเสมอ
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) { verified = true; setReady(true) }
    }).catch(() => {})

    // PKCE เก็บ code_verifier ไว้ในเครื่องที่ "กดขอลิงก์" ถ้าผู้ใช้เปิดอีเมลบนเครื่อง/เบราว์เซอร์
    // คนละตัว การแลก code จะล้มเงียบๆ ไม่มี event ตามมา ของเดิมจะหมุนสปินเนอร์ค้างตลอดกาล
    const timer = setTimeout(() => {
      if (verified) return
      setLinkError('ยืนยันลิงก์ไม่สำเร็จ\nกรุณาเปิดลิงก์จากอีเมลบนเบราว์เซอร์เครื่องเดียวกับที่กดขอรีเซ็ตรหัสผ่าน หรือขอลิงก์ใหม่อีกครั้ง')
    }, 15000)

    return () => { clearTimeout(timer); subscription.unsubscribe() }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    const passwordError = validateNewPassword(password)
    if (passwordError) { setError(passwordError); return }
    if (password !== confirm) { setError('รหัสผ่านไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง'); return }
    setError('')
    setLoading(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) {
        setError(`ตั้งรหัสผ่านไม่สำเร็จ: ${err.message}`)
        return
      }
      setDone(true)
      setTimeout(() => navigate('/', { replace: true }), 3000)
    } catch (err) {
      console.error('[reset-password] ตั้งรหัสผ่านใหม่ไม่สำเร็จ:', err?.message ?? err)
      setError('ตั้งรหัสผ่านไม่สำเร็จ — เซิร์ฟเวอร์ตอบช้าหรือสัญญาณขาดช่วง กรุณาลองใหม่')
    } finally {
      setLoading(false)
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
        ) : linkError ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <AlertTriangle size={44} className="text-amber-500" />
            <p className="text-sm text-gray-600 text-center leading-relaxed whitespace-pre-line">{linkError}</p>
            <button
              type="button"
              onClick={() => navigate('/auth', { replace: true })}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}
            >
              ไปหน้าเข้าสู่ระบบ
            </button>
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
                placeholder={`รหัสผ่านใหม่ (${PASSWORD_HINT})`}
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

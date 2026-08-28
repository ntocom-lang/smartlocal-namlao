import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { invokeDeviceLogin } from '../../lib/deviceLogin'
import { Loader2, RefreshCw, Smartphone } from 'lucide-react'

// แผง "เข้าสู่ระบบด้วยรหัสจากมือถือ" บนจอ PC — สำหรับเจ้าหน้าที่ที่ต้องไปใช้เครื่องคนอื่น
// แล้วไม่อยากพิมพ์รหัสผ่านทิ้งไว้บนเครื่องนั้น (และกดปุ่ม Google/LINE ไม่ได้เพราะจะเข้าเป็น
// บัญชีเจ้าของเครื่อง) — ดู docs/device-login-design.md
//
// เดิมหน้านี้แสดง QR ให้สแกน แต่ถอดออกแล้ว: การสแกนต้องพึ่งกล้อง สิทธิ์กล้อง และเบราว์เซอร์
// ที่เปิดลิงก์ให้ ซึ่งบน iOS ที่ล็อกอินไว้ใน PWA จะเปิด Safari ที่แยก storage กันคนละส่วน
// กลายเป็นยังไม่ได้ล็อกอิน ส่วนรหัส 6 หลักใช้ได้ทุกเครื่องและเจ้าหน้าที่คุ้นอยู่แล้วจาก OTP ธนาคาร
//
// verifier ถูกเก็บใน ref เท่านั้น ไม่ลง state/localStorage/URL โดยตั้งใจ: มันคือหลักฐานว่า
// "เครื่องนี้คือเครื่องที่ขอ" ถ้ามันรั่วไปพร้อมรหัสที่โชว์บนจอ คนอื่นจะแลก session ไปได้ทันที

const POLL_INTERVAL_MS = 3000
// ต่ออายุให้เองได้ไม่เกิน 3 รอบ (~15 นาที) แล้วต้องกดเอง — หน้านี้ยิง edge function ทุก 3 วิ
// ถ้าปล่อยให้ต่ออายุไม่รู้จบ เครื่องที่เปิดหน้าทิ้งไว้ทั้งวันเครื่องเดียวก็กินเกือบหมื่น
// invocation ต่อวัน ไม่กี่เครื่องก็ทะลุโควตาฟรีของโปรเจกต์แล้ว
const MAX_AUTO_REFRESH = 3

export default function DeviceLoginPanel() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState('idle') // idle | starting | waiting | signingIn | error
  const [matchNumber, setMatchNumber] = useState(null)
  const [shortCode, setShortCode] = useState('')
  const [expiresAt, setExpiresAt] = useState(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [error, setError] = useState('')
  const requestRef = useRef(null)
  const autoRefreshCount = useRef(0)

  // auto = true คือระบบต่ออายุให้เอง (นับโควตา), ไม่ใส่ = ผู้ใช้กดขอเอง (รีเซ็ตโควตา)
  const start = useCallback(async ({ auto = false } = {}) => {
    if (!auto) autoRefreshCount.current = 0
    setPhase('starting')
    setError('')
    requestRef.current = null

    const { data, offline } = await invokeDeviceLogin({ action: 'start' })
    if (offline || !data?.ok) {
      setError(offline ? 'เชื่อมต่อไม่ได้ กรุณาลองใหม่' : (data?.error ?? 'ขอรหัสไม่สำเร็จ กรุณาลองใหม่'))
      setPhase('error')
      return
    }

    requestRef.current = { code: data.code, verifier: data.verifier }
    setMatchNumber(data.match_number)
    setShortCode(data.short_code ?? '')
    setExpiresAt(data.expires_at)
    setPhase('waiting')
  }, [])

  // นับถอยหลังให้เห็นว่าเหลือเวลาเท่าไร
  useEffect(() => {
    if (phase !== 'waiting' || !expiresAt) return
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000))
      setSecondsLeft(remaining)
      if (remaining !== 0) return
      // แท็บถูกซ่อน/ย่อ = ไม่มีใครมองจออยู่ อย่าเพิ่งสร้างคำขอใหม่ทิ้งไว้ รอจนกลับมาดูจริงๆ
      if (document.hidden) return
      if (autoRefreshCount.current >= MAX_AUTO_REFRESH) {
        setError('หยุดต่ออายุอัตโนมัติแล้ว กดขอรหัสใหม่เมื่อพร้อมใช้งาน')
        setPhase('error')
        return
      }
      autoRefreshCount.current += 1
      start({ auto: true })
    }
    tick()
    const timerId = setInterval(tick, 1000)
    return () => clearInterval(timerId)
  }, [phase, expiresAt, start])

  // ถามสถานะเป็นระยะ — ฝั่งเซิร์ฟเวอร์จะคืน token ก็ต่อเมื่อมือถืออนุมัติแล้ว และเครื่องนี้
  // พิสูจน์ verifier ได้เท่านั้น
  useEffect(() => {
    if (phase !== 'waiting') return
    let cancelled = false

    async function poll() {
      const request = requestRef.current
      if (!request || cancelled) return
      // ไม่ยิงถามสถานะตอนที่ไม่มีใครดูจอ — ผู้ใช้กลับมาเมื่อไรค่อยถามต่อ
      if (document.hidden) return

      const { data, offline } = await invokeDeviceLogin({
        action: 'claim', code: request.code, verifier: request.verifier,
      })
      if (cancelled) return
      if (offline) return // เน็ตสะดุดชั่วคราว รอบหน้าค่อยลองใหม่

      if (data?.ok && data.status === 'pending') return

      if (data?.ok && data.token_hash) {
        setPhase('signingIn')
        requestRef.current = null
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: data.token_hash,
          type: 'magiclink',
        })
        if (otpError) {
          console.error('[device-login] แลก session ไม่สำเร็จ:', otpError.message)
          setError('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่')
          setPhase('error')
          return
        }
        navigate('/admin')
        return
      }

      // ที่เหลือคือคำขอถูกปิดไปแล้ว ต้องเริ่มใหม่เท่านั้น
      const reasons = {
        denied: 'คำขอถูกยกเลิกเพื่อความปลอดภัย (เลือกตัวเลขไม่ตรง) กรุณาขอรหัสใหม่',
        expired: 'รหัสหมดอายุแล้ว กดขอรหัสใหม่ได้เลย',
        claimed: 'รหัสนี้ถูกใช้ไปแล้ว กรุณาขอรหัสใหม่',
        no_email: data?.error ?? 'บัญชีนี้ใช้การเข้าสู่ระบบด้วยรหัสไม่ได้',
      }
      setError(reasons[data?.status] ?? data?.error ?? 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่')
      setPhase('error')
    }

    const timerId = setInterval(poll, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(timerId) }
  }, [phase, navigate])

  if (phase === 'idle' || phase === 'error') {
    return (
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center">
            <Smartphone size={26} className="text-gray-400" />
          </div>
        </div>
        <p className="text-sm text-gray-500 leading-relaxed">
          ใช้มือถือของคุณยืนยันการเข้าสู่ระบบบนเครื่องนี้<br />
          ไม่ต้องพิมพ์รหัสผ่านบนคอมพิวเตอร์เครื่องนี้เลย
        </p>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="button"
          onClick={() => start()}
          className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all active:scale-95"
          style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}
        >
          {phase === 'error' ? 'ขอรหัสใหม่' : 'ขอรหัสเข้าสู่ระบบ'}
        </button>
      </div>
    )
  }

  if (phase === 'starting' || phase === 'signingIn') {
    return (
      <div className="py-10 flex flex-col items-center gap-3 text-gray-400">
        <Loader2 size={24} className="animate-spin" />
        <span className="text-sm">{phase === 'starting' ? 'กำลังขอรหัส...' : 'กำลังเข้าสู่ระบบ...'}</span>
      </div>
    )
  }

  return (
    <div className="text-center space-y-5">
      <ol className="text-sm text-gray-600 text-left space-y-1.5 bg-gray-50 rounded-xl p-4 leading-relaxed">
        <li><span className="font-semibold">1.</span> เปิดแอปในมือถือของคุณ (ที่เข้าสู่ระบบไว้แล้ว)</li>
        <li><span className="font-semibold">2.</span> ไปที่ <span className="font-semibold">โปรไฟล์ → เข้าสู่ระบบบนคอมพิวเตอร์</span></li>
        <li><span className="font-semibold">3.</span> กรอกรหัส 6 หลักข้างล่างนี้</li>
        <li><span className="font-semibold">4.</span> แตะตัวเลขที่ตรงกับเลขสีน้ำเงิน</li>
      </ol>

      <div className="bg-gray-50 rounded-2xl py-5">
        <p className="text-xs text-gray-400 mb-1">รหัสสำหรับกรอกในมือถือ</p>
        <p className="text-4xl font-bold tracking-[0.25em] text-gray-800">{shortCode}</p>
      </div>

      <div>
        <p className="text-xs text-gray-400 mb-1">แล้วแตะตัวเลขนี้ในมือถือ</p>
        <p className="text-5xl font-bold tracking-widest" style={{ color: 'var(--color-primary)' }}>
          {matchNumber}
        </p>
      </div>

      <p className="text-xs text-gray-400">
        รอการยืนยันจากมือถือ · หมดอายุใน {secondsLeft} วินาที
      </p>

      <button
        type="button"
        onClick={() => start()}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <RefreshCw size={14} /> ขอรหัสใหม่
      </button>
    </div>
  )
}

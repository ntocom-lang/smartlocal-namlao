import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { CameraOff, KeyRound, Loader2, ScanLine, ShieldAlert } from 'lucide-react'

// สแกน QR เข้าสู่ระบบ "จากในแอปเอง" — จุดสำคัญคือผู้ใช้ไม่เคยออกจาก context ที่ล็อกอินอยู่
//
// ถ้าให้สแกนด้วยแอปกล้องของเครื่อง ลิงก์จะถูกเปิดในเบราว์เซอร์เริ่มต้นแทน ซึ่งบน iOS นั้น
// PWA (ไอคอนหน้าจอโฮม) กับ Safari แยก storage กันคนละส่วน เจ้าหน้าที่ที่ล็อกอินไว้ใน PWA
// จะกลายเป็นยังไม่ได้ล็อกอินทันทีที่กล้องเปิด Safari ให้ — ต้องพิมพ์รหัสผ่านอยู่ดี
// ซึ่งย้อนแย้งกับเหตุผลทั้งหมดของการมี QR login
//
// ถอดรหัสด้วย BarcodeDetector ของเบราว์เซอร์ถ้ามี (Chrome/Android) ถ้าไม่มีค่อยโหลด jsQR
// มาใช้แทนแบบ dynamic import เพื่อไม่ให้เครื่องที่ไม่ต้องใช้ต้องแบกน้ำหนักไปด้วย

const STAFF_ROLES = ['superadmin', 'admin', 'officer', 'technician', 'staff', 'viewer', 'council']
const SCAN_INTERVAL_MS = 200

// รับได้ทั้ง URL เต็มจาก QR ของเรา และรหัสดิบ — แต่ยอมรับเฉพาะรูปแบบ code ที่ระบบออกเท่านั้น
// (32 hex) จึงพาไปหน้าอื่นตาม URL ที่ใครก็ยัดใส่ QR มาไม่ได้
function extractCode(raw) {
  if (!raw) return null
  const direct = raw.trim().toLowerCase()
  if (/^[0-9a-f]{32}$/.test(direct)) return direct
  try {
    const fromQuery = new URL(raw).searchParams.get('code')?.trim().toLowerCase()
    if (fromQuery && /^[0-9a-f]{32}$/.test(fromQuery)) return fromQuery
  } catch {
    // ไม่ใช่ URL ก็ไม่เป็นไร ถือว่าอ่านไม่ได้
  }
  return null
}

export default function QrScanLogin() {
  const navigate = useNavigate()
  const { session, role, profileLoading } = useAuth()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [status, setStatus] = useState('starting') // starting | scanning | error
  const [error, setError] = useState('')

  const isStaff = STAFF_ROLES.includes(role)

  useEffect(() => {
    if (profileLoading || !session || !isStaff) return
    let cancelled = false
    let timerId = null

    async function makeDecoder() {
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats?.()
          if (!supported || supported.includes('qr_code')) {
            const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
            return async (video) => {
              const found = await detector.detect(video)
              return found?.[0]?.rawValue ?? null
            }
          }
        } catch {
          // ตกไปใช้ jsQR แทน
        }
      }
      const { default: jsQR } = await import('jsqr')
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      return async (video) => {
        if (!video.videoWidth) return null
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
        return jsQR(image.data, image.width, image.height)?.data ?? null
      }
    }

    ;(async () => {
      let decode
      try {
        // กล้องหลังเสมอ — กล้องหน้าเล็งจอคอมพิวเตอร์ไม่ได้
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        decode = await makeDecoder()
        if (cancelled) return
        setStatus('scanning')
      } catch (err) {
        if (cancelled) return
        console.error('[qr-scan] เปิดกล้องไม่สำเร็จ:', err?.name ?? err)
        setError(err?.name === 'NotAllowedError'
          ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตการเข้าถึงกล้องในตั้งค่าเบราว์เซอร์ แล้วเปิดหน้านี้ใหม่'
          : 'เปิดกล้องไม่ได้ อาจมีแอปอื่นใช้กล้องอยู่ หรือเครื่องนี้ไม่มีกล้อง')
        setStatus('error')
        return
      }

      const tick = async () => {
        if (cancelled || !videoRef.current) return
        try {
          const raw = await decode(videoRef.current)
          const code = extractCode(raw)
          if (code && !cancelled) {
            streamRef.current?.getTracks().forEach((t) => t.stop())
            navigate(`/device-login?code=${code}`, { replace: true })
            return
          }
        } catch {
          // เฟรมนี้อ่านไม่ได้ก็ข้ามไป เฟรมถัดไปค่อยลองใหม่
        }
        timerId = setTimeout(tick, SCAN_INTERVAL_MS)
      }
      timerId = setTimeout(tick, SCAN_INTERVAL_MS)
    })()

    return () => {
      cancelled = true
      clearTimeout(timerId)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [session, isStaff, profileLoading, navigate])

  const card = 'w-full max-w-sm bg-white rounded-3xl shadow-xl border border-gray-100 p-7'

  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        <Loader2 size={24} className="animate-spin" />
      </div>
    )
  }

  if (!session || !isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className={`${card} text-center space-y-4`}>
          <div className="flex justify-center">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
              <ShieldAlert size={26} className="text-amber-500" />
            </div>
          </div>
          <h1 className="text-lg font-bold text-gray-800">ใช้ได้เฉพาะเจ้าหน้าที่</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            {session
              ? 'การเข้าสู่ระบบด้วย QR สงวนไว้สำหรับบัญชีเจ้าหน้าที่เท่านั้น'
              : 'กรุณาเข้าสู่ระบบในมือถือเครื่องนี้ก่อน แล้วจึงสแกน QR'}
          </p>
          <button
            type="button"
            onClick={() => navigate(session ? '/' : '/auth')}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}
          >
            {session ? 'กลับหน้าแรก' : 'เข้าสู่ระบบ'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center text-white space-y-1">
          <h1 className="text-lg font-bold">สแกน QR จากหน้าจอคอมพิวเตอร์</h1>
          <p className="text-sm text-white/60">เล็งกล้องไปที่ QR บนหน้าจอ ระบบจะอ่านให้เอง</p>
        </div>

        <div className="relative rounded-3xl overflow-hidden bg-black aspect-square">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="w-full h-full object-cover"
          />
          {status === 'scanning' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-3/5 aspect-square border-2 border-white/70 rounded-2xl" />
            </div>
          )}
          {status === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70">
              <Loader2 size={24} className="animate-spin" />
              <span className="text-sm">กำลังเปิดกล้อง...</span>
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80 px-6 text-center">
              <CameraOff size={28} />
              <span className="text-sm leading-relaxed">{error}</span>
            </div>
          )}
        </div>

        {status === 'scanning' && (
          <p className="flex items-center justify-center gap-2 text-sm text-white/60">
            <ScanLine size={16} /> กำลังค้นหา QR...
          </p>
        )}

        {/* ทางออกเมื่อสแกนไม่ได้ — ต้องเด่นพอที่เจ้าหน้าที่จะเห็นเอง โดยเฉพาะตอนกล้องเปิดไม่ขึ้น
            ไม่งั้นจะไม่มีทางรู้เลยว่ามีวิธีกรอกรหัสมือ (เจอจริงตอนทดสอบ: รหัส 6 หลักโชว์บนจอ PC
            แต่ในมือถือหาที่กรอกไม่เจอ) */}
        <button
          type="button"
          onClick={() => navigate('/device-login')}
          className="w-full py-3 rounded-xl bg-white/10 border border-white/20 text-white text-sm font-semibold active:scale-95 transition-all"
        >
          <span className="inline-flex items-center gap-2">
            <KeyRound size={16} /> สแกนไม่ได้? กรอกรหัส 6 หลักแทน
          </span>
        </button>

        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-full py-3 rounded-xl border border-white/20 text-white/80 text-sm font-medium active:scale-95 transition-all"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  )
}

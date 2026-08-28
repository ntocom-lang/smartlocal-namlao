import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { CheckCircle2, KeyRound, Loader2, Monitor, ScanLine, ShieldAlert, ShieldCheck } from 'lucide-react'

// หน้าอนุมัติบนมือถือ — เข้าได้ 2 ทาง (ดู docs/device-qr-login-design.md)
//   1. สแกน QR (จากในแอปที่ /scan-login หรือจากแอปกล้องของเครื่อง) → มี ?code= มาให้เลย
//   2. กรอกรหัส 6 หลักที่โชว์คู่กับ QR บนจอ PC — ทางนี้จำเป็นเพราะการสแกนด้วยแอปกล้องจะเปิด
//      ลิงก์ในเบราว์เซอร์เริ่มต้น ซึ่งบน iOS นั้น PWA กับ Safari แยก storage กัน เจ้าหน้าที่ที่
//      ล็อกอินไว้ใน PWA จะกลายเป็นยังไม่ได้ล็อกอินทันที
//
// หัวใจของหน้านี้คือ "แตะเลขที่ตรงกับจอ PC": เลขจริงถูกส่งไปแสดงบนจอ PC เท่านั้น ไม่เคยส่งมา
// ที่มือถือว่าตัวไหนถูก คนร้ายที่ส่ง QR ของเครื่องตัวเองมาทางไลน์/กระดาษ (QRLJacking —
// วิธีที่ใช้โจมตี LINE/WhatsApp Web ได้จริง) จึงบอกเจ้าหน้าที่ไม่ได้ว่าต้องแตะเลขอะไร
// แตะผิดครั้งเดียวคำขอถูกยกเลิกทันที

export default function DeviceLoginApprove() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { session, profileLoading } = useAuth()
  const codeFromUrl = searchParams.get('code') ?? ''

  // ตัวระบุคำขอที่กำลังอนุมัติ: มาจาก QR (code) หรือจากรหัสสั้นที่กรอกเอง (short_code)
  const [identifier, setIdentifier] = useState(codeFromUrl ? { code: codeFromUrl } : null)
  const [shortInput, setShortInput] = useState('')
  const [loading, setLoading] = useState(Boolean(codeFromUrl))
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)

  // setState ทั้งหมดอยู่หลัง await โดยตั้งใจ — ไม่ให้ effect ยิง setState แบบ sync (cascading render)
  useEffect(() => {
    if (!identifier || !session || profileLoading) return
    let cancelled = false
    ;(async () => {
      const { data, error: fnError } = await supabase.functions.invoke('device-login', {
        body: { action: 'info', ...identifier },
      })
      if (cancelled) return
      setLoading(false)
      if (fnError && !data) {
        setError('เชื่อมต่อไม่ได้ กรุณาลองใหม่อีกครั้ง')
        return
      }
      if (!data?.ok) {
        setIdentifier(null)
        setError(data?.error ?? 'คำขอนี้ใช้ไม่ได้แล้ว กรุณาขอรหัสใหม่ที่หน้าจอคอมพิวเตอร์')
        return
      }
      setInfo(data)
    })()
    return () => { cancelled = true }
  }, [identifier, session, profileLoading])

  function submitShortCode(e) {
    e.preventDefault()
    const value = shortInput.trim()
    if (!/^[0-9]{6}$/.test(value)) {
      setError('กรุณากรอกรหัส 6 หลักที่แสดงบนหน้าจอคอมพิวเตอร์')
      return
    }
    setError('')
    setInfo(null)
    setLoading(true)
    setIdentifier({ short_code: value })
  }

  async function approve(pick) {
    setApproving(true)
    setError('')
    const { data, error: fnError } = await supabase.functions.invoke('device-login', {
      body: { action: 'approve', ...identifier, pick },
    })
    setApproving(false)
    if (fnError && !data) {
      setError('เชื่อมต่อไม่ได้ กรุณาลองใหม่')
      return
    }
    if (!data?.ok) {
      setInfo(null)
      setIdentifier(null)
      setShortInput('')
      setError(data?.error ?? 'ยืนยันไม่สำเร็จ กรุณาขอรหัสใหม่ที่หน้าจอคอมพิวเตอร์')
      return
    }
    setApproved(true)
  }

  const card = 'w-full max-w-sm bg-white rounded-3xl shadow-xl border border-gray-100 p-7'

  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        <Loader2 size={24} className="animate-spin" />
      </div>
    )
  }

  // สแกน QR จากแอปกล้องหรือ LINE อาจเปิดในเบราว์เซอร์ที่ยังไม่ได้เข้าสู่ระบบ — บอกให้ชัดว่า
  // ต้องทำอะไรต่อ แล้วพากลับมาที่หน้านี้เองหลังเข้าสู่ระบบเสร็จ
  if (!session) {
    const backTo = codeFromUrl ? `/device-login?code=${codeFromUrl}` : '/device-login'
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className={`${card} text-center space-y-4`}>
          <div className="flex justify-center">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
              <ShieldAlert size={26} className="text-amber-500" />
            </div>
          </div>
          <h1 className="text-lg font-bold text-gray-800">ต้องเข้าสู่ระบบในมือถือก่อน</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            หน้านี้ใช้ยืนยันตัวตนของคุณ จึงต้องเข้าสู่ระบบในมือถือเครื่องนี้ก่อน
            แล้วระบบจะพากลับมาที่หน้านี้เอง
          </p>
          <button
            type="button"
            onClick={() => navigate('/auth', { state: { from: backTo } })}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}
          >
            เข้าสู่ระบบ
          </button>
        </div>
      </div>
    )
  }

  if (approved) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className={`${card} text-center space-y-4`}>
          <div className="flex justify-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 size={26} className="text-emerald-500" />
            </div>
          </div>
          <h1 className="text-lg font-bold text-gray-800">ยืนยันเรียบร้อยแล้ว</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            คอมพิวเตอร์เครื่องนั้นกำลังเข้าสู่ระบบในชื่อคุณ ปิดหน้านี้ได้เลย<br />
            <span className="text-amber-600">อย่าลืมกดออกจากระบบเมื่อใช้งานเสร็จ</span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className={`${card} space-y-5`}>
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
               style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
            <ShieldCheck size={26} className="text-white" />
          </div>
        </div>

        <h1 className="text-lg font-bold text-gray-800 text-center">ยืนยันการเข้าสู่ระบบ</h1>

        {loading && (
          <div className="py-6 flex justify-center text-gray-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        )}

        {error && !loading && (
          <p className="text-sm text-red-500 text-center leading-relaxed">{error}</p>
        )}

        {/* ยังไม่ได้ระบุคำขอ = เข้าหน้านี้ตรงๆ หรือคำขอก่อนหน้าใช้ไม่ได้แล้ว → ให้กรอกรหัสสั้น */}
        {!identifier && !loading && (
          <form onSubmit={submitShortCode} className="space-y-4">
            <p className="text-sm text-gray-600 text-center leading-relaxed">
              กรอกรหัส 6 หลักที่แสดงบนหน้าจอคอมพิวเตอร์
            </p>
            <div className="relative">
              <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={shortInput}
                onChange={(e) => setShortInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-center text-xl font-bold tracking-[0.3em] text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': 'var(--color-primary)' }}
              />
            </div>
            <button
              type="submit"
              disabled={shortInput.length !== 6}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm active:scale-95 transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}
            >
              ถัดไป
            </button>

            <button
              type="button"
              onClick={() => navigate('/scan-login')}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ScanLine size={15} /> สแกน QR แทนการกรอกรหัส
            </button>
          </form>
        )}

        {info && !loading && (
          <>
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 space-y-1">
              <div className="flex items-center gap-2 font-medium text-gray-700">
                <Monitor size={16} className="text-gray-400" />
                {info.device.os} · {info.device.browser}
              </div>
              {info.device.ip && <p className="text-xs text-gray-400">IP {info.device.ip}</p>}
              <p className="text-xs text-gray-500 pt-1">
                เครื่องนี้ขอเข้าใช้งานในชื่อ {info.approver_name ?? 'บัญชีของคุณ'}
              </p>
            </div>

            <p className="text-sm text-gray-600 text-center leading-relaxed">
              แตะตัวเลขที่ <span className="font-semibold">ตรงกับหน้าจอคอมพิวเตอร์ตรงหน้าคุณ</span><br />
              <span className="text-xs text-gray-400">
                ถ้าคุณไม่ได้เป็นคนขอเข้าสู่ระบบ หรือมีคนโทรมาบอกให้กรอกรหัส/แตะเลข
                ให้ปิดหน้านี้ทิ้งทันที
              </span>
            </p>

            <div className="grid grid-cols-3 gap-3">
              {info.numbers.map((number) => (
                <button
                  key={number}
                  type="button"
                  disabled={approving}
                  onClick={() => approve(number)}
                  className="py-5 rounded-2xl border-2 border-gray-200 text-2xl font-bold text-gray-700 transition-all active:scale-95 disabled:opacity-50"
                >
                  {number}
                </button>
              ))}
            </div>

            {approving && (
              <div className="flex justify-center text-gray-400">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

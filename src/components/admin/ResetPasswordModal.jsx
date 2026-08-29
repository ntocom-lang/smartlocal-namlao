import { useState } from 'react'
import { KeyRound, Loader2, Copy, Check, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ตั้งรหัสผ่านชั่วคราวให้ผู้ใช้ที่ลืมรหัส — สำหรับเคสประชาชนเดินมาที่สำนักงาน
//
// ทำไมต้องมี: ระบบไม่มีทางกู้บัญชีอื่นเลย บัญชีเบอร์โทรรีเซ็ตทางอีเมลไม่ได้อยู่แล้ว ส่วนบัญชี
// อีเมลก็ส่งลิงก์ไปไม่ถึงถ้ายังไม่ได้ตั้ง custom SMTP (built-in ของ Supabase ปฏิเสธการส่งไปยัง
// อีเมลนอกทีมโปรเจกต์) และสมัครใหม่ก็ไม่ได้เพราะเบอร์/อีเมลเดิมถูกใช้ไปแล้ว
//
// รหัสถูกสุ่มฝั่งเซิร์ฟเวอร์ (edge function admin-reset-user-password) ไม่ให้เจ้าหน้าที่ตั้งเอง
// กันการใช้รหัสง่ายๆ ซ้ำกันทุกคน — ที่นี่มีหน้าที่แค่แสดงผลและย้ำขั้นตอนต่อไปให้เจ้าหน้าที่
export default function ResetPasswordModal({ user, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState(false)

  if (!user) return null

  async function handleReset() {
    setBusy(true)
    setError('')
    try {
      const { data, error: err } = await supabase.functions.invoke('admin-reset-user-password', {
        body: { user_id: user.id },
      })
      if (err || !data?.ok || !data?.password) {
        setError(data?.error || err?.message || 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ')
        return
      }
      setPassword(data.password)
    } catch (err) {
      // functions.invoke reject ได้จริงเมื่อเน็ตหลุดหรือชน timeout 25 วิของ fetchWithTimeout
      console.error('[admin] ตั้งรหัสผ่านใหม่ล้มเหลว:', err?.message ?? err)
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // เบราว์เซอร์ที่ไม่ให้สิทธิ์คลิปบอร์ด — ผู้ใช้ยังอ่านจากจอแล้วพิมพ์เองได้อยู่แล้ว
    }
  }

  const name = user.full_name || user.email || 'ผู้ใช้นี้'

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        {password ? (
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <KeyRound size={24} className="text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800">ตั้งรหัสผ่านใหม่แล้ว</h3>
            <p className="text-sm text-gray-500">
              รหัสผ่านชั่วคราวของ <strong className="text-gray-800">{name}</strong>
            </p>

            <div className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <code className="text-xl font-bold tracking-widest text-gray-800 select-all">{password}</code>
              <button
                onClick={copyPassword}
                className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="คัดลอก"
              >
                {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
              </button>
            </div>

            <div className="w-full text-left text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 leading-relaxed">
              <p className="font-semibold mb-1 flex items-center gap-1.5">
                <AlertTriangle size={13} /> หน้าจอนี้แสดงรหัสครั้งเดียว
              </p>
              ปิดแล้วดูย้อนหลังไม่ได้ ต้องตั้งใหม่อย่างเดียว<br />
              แจ้งรหัสให้เจ้าตัว แล้ว<strong>บอกให้ไปเปลี่ยนรหัสเองที่หน้าโปรไฟล์ทันที</strong> —
              ตราบใดที่ยังไม่เปลี่ยน รหัสนี้ยังใช้เข้าบัญชีได้อยู่<br />
              หากสงสัยว่ามีคนอื่นเข้าถึงบัญชีนี้อยู่ ให้เจ้าตัวเตะอุปกรณ์ออกเองที่
              หน้าโปรไฟล์ &rarr; &ldquo;อุปกรณ์ที่ล็อกอินอยู่&rdquo;
            </div>

            <button
              onClick={onClose}
              className="w-full mt-1 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium transition-colors"
            >
              เสร็จสิ้น
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
              <KeyRound size={24} className="text-amber-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800">ตั้งรหัสผ่านใหม่ให้ผู้ใช้</h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              ระบบจะสุ่มรหัสผ่านชั่วคราวให้ <strong className="text-gray-800">{name}</strong><br />
              <strong className="text-red-600">รหัสเดิมจะใช้ไม่ได้ทันที</strong>
            </p>
            <p className="w-full text-left text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 leading-relaxed">
              ใช้เมื่อเจ้าตัวมาติดต่อที่สำนักงานและยืนยันตัวตนแล้วเท่านั้น —
              การกระทำนี้ถูกบันทึกลงประวัติการใช้งานพร้อมชื่อผู้ทำ
            </p>

            {error && (
              <p className="w-full text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-left">{error}</p>
            )}

            <div className="flex gap-3 w-full mt-1">
              <button
                onClick={onClose}
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleReset}
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                {busy ? 'กำลังตั้ง...' : 'ยืนยันตั้งรหัสใหม่'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

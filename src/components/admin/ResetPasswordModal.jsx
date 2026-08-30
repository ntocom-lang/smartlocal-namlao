import { useState } from 'react'
import { KeyRound, Loader2, Copy, Check, AlertTriangle, Printer } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { loginIdentifier } from '../../lib/authProviders'
import { buildAccountCardHtml } from '../../lib/accountCardPrint'
import { appUrl } from '../../lib/basename'

// ตั้งรหัสผ่านชั่วคราวให้ผู้ใช้ที่ลืมรหัส — สำหรับเคสประชาชนเดินมาที่สำนักงาน
//
// ทำไมต้องมี: ระบบไม่มีทางกู้บัญชีอื่นเลย บัญชีเบอร์โทรรีเซ็ตทางอีเมลไม่ได้อยู่แล้ว ส่วนบัญชี
// อีเมลก็ส่งลิงก์ไปไม่ถึงถ้ายังไม่ได้ตั้ง custom SMTP (built-in ของ Supabase ปฏิเสธการส่งไปยัง
// อีเมลนอกทีมโปรเจกต์) และสมัครใหม่ก็ไม่ได้เพราะเบอร์/อีเมลเดิมถูกใช้ไปแล้ว
//
// รหัสถูกสุ่มฝั่งเซิร์ฟเวอร์ (edge function admin-reset-user-password) ไม่ให้เจ้าหน้าที่ตั้งเอง
// กันการใช้รหัสง่ายๆ ซ้ำกันทุกคน — ที่นี่มีหน้าที่แค่แสดงผลและย้ำขั้นตอนต่อไปให้เจ้าหน้าที่
export default function ResetPasswordModal({ user, onClose }) {
  const { tenant } = useTenant()
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

  // พิมพ์บัตรให้ประชาชนถือกลับบ้าน — เหตุผลเต็มอยู่ที่ src/lib/accountCardPrint.js
  //
  // ต้องเปิดหน้าต่างแบบ sync ในจังหวะคลิก ก่อน await ใดๆ ไม่งั้น popup blocker บล็อกเงียบๆ
  // (รูปแบบเดียวกับ handlePrintComplaint ใน ComplaintsManager.jsx) ที่นี่ไม่มี await อยู่แล้ว
  // เพราะรหัสผ่านอยู่ใน state ตั้งแต่ตอนตั้งสำเร็จ แต่คงลำดับไว้ให้เหมือนกันกันคนแก้ทีหลังเผลอ
  function printCard() {
    const w = window.open('', '_blank', 'width=800,height=900')
    if (!w) {
      setError('เบราว์เซอร์บล็อกป๊อปอัพ กรุณาอนุญาตป๊อปอัพสำหรับเว็บไซต์นี้แล้วกดพิมพ์ใหม่')
      return
    }
    const login = loginIdentifier(user.email)
    w.document.write(buildAccountCardHtml({
      fullName: user.full_name,
      loginValue: login.value,
      loginKind: login.kind,
      password,
      tenant,
      // ต้องผ่าน appUrl() ไม่ใช่ location.host เปล่าๆ — deployment แบบ path-based
      // (host/{slug}/...) จะได้ที่อยู่ที่ตัด slug ทิ้ง ประชาชนพิมพ์ตามแล้วเข้าผิด อปท.
      // ตัด https:// กับ / ท้ายออกให้สั้นพอที่ผู้สูงอายุจะพิมพ์ตามจากกระดาษได้
      appOrigin: appUrl('/').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    }))
    w.document.close()
    setTimeout(() => w.print(), 400)
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

            {/* พิมพ์กระดาษเป็นทางหลัก ไม่ใช่ทางเลือกเสริม — ผู้ใช้ที่มาถึงจุดนี้คือคนที่จำรหัสของ
                ตัวเองไม่ได้ตั้งแต่แรก การบอกรหัส 10 ตัวปากเปล่าแล้วให้กลับบ้านไปพิมพ์เองไม่จบงาน */}
            <button
              onClick={printCard}
              className="w-full py-2.5 rounded-xl text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              <Printer size={16} /> พิมพ์บัตรเข้าใช้งานให้ประชาชน
            </button>

            {loginIdentifier(user.email).kind === 'none' && (
              <p className="w-full text-left text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 leading-relaxed">
                <strong>บัญชีนี้ยังล็อกอินด้วยรหัสผ่านไม่ได้</strong><br />
                เป็นบัญชีที่ผูกกับ LINE อย่างเดียว ไม่มีชื่อผู้ใช้ให้พิมพ์คู่กับรหัสผ่าน
                ต้องตั้ง &ldquo;อีเมลสำหรับเข้าสู่ระบบ&rdquo; ให้บัญชีนี้ก่อนที่หน้าจัดการผู้ใช้
              </p>
            )}

            {error && (
              <p className="w-full text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-left">{error}</p>
            )}

            <div className="w-full text-left text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 leading-relaxed">
              <p className="font-semibold mb-1 flex items-center gap-1.5">
                <AlertTriangle size={13} /> หน้าจอนี้แสดงรหัสครั้งเดียว
              </p>
              ปิดแล้วดูย้อนหลังไม่ได้ ต้องตั้งใหม่อย่างเดียว — <strong>พิมพ์บัตรก่อนปิด</strong><br />
              มอบบัตรให้เจ้าตัวเท่านั้น <strong>ห้ามเก็บสำเนาไว้ที่สำนักงาน</strong> และบอกให้ไป
              เปลี่ยนรหัสเองที่หน้าโปรไฟล์ทันที — ตราบใดที่ยังไม่เปลี่ยน รหัสนี้ยังใช้เข้าบัญชีได้อยู่<br />
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

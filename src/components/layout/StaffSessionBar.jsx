import { useAuth } from '../../contexts/AuthContext'
import { useIdleLogout } from '../../hooks/useIdleLogout'
import { signOutSafely } from '../../lib/supabase'
import { Clock, LogOut, UserRound } from 'lucide-react'

// แถบบอกว่า "ตอนนี้กำลังใช้งานในชื่อใคร" สำหรับบัญชีเจ้าหน้าที่ พร้อมตัวจับเวลาออกจากระบบ
// อัตโนมัติเมื่อไม่มีการใช้งาน
//
// ทำไมต้องบอกชื่อให้เห็นตลอด: หัวข้อของ back office เดิมแสดงแค่ตำแหน่ง ("ผู้ดูแลระบบ") กับ
// ตัวอักษรย่อ เจ้าหน้าที่ที่ไปใช้ PC เครื่องอื่นจึงไม่มีทางรู้ว่ากำลังทำงานในชื่อของใครอยู่
// ซึ่งเป็นต้นตอของ audit_logs ที่บันทึกผู้กระทำผิดตัว — ปัญหาเดียวกับที่ระบบเข้าสู่ระบบด้วย
// รหัสจากมือถือตั้งใจแก้ (ดู docs/device-login-design.md)
//
// ประชาชนไม่เห็นแถบนี้ ใช้แอปบนมือถือตัวเองอยู่แล้ว ไม่ได้แก้ปัญหาอะไร มีแต่เกะกะ

// mm:ss — เจ้าหน้าที่อ่านนาที:วินาทีคุ้นกว่าตัวเลขวินาทีดิบ
function formatCountdown(totalSeconds) {
  if (totalSeconds === null) return ''
  const safe = Math.max(0, totalSeconds)
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const ROLE_LABEL = {
  superadmin: 'ผู้ดูแลระบบส่วนกลาง',
  admin: 'แอดมินระบบ',
  officer: 'หัวหน้ากอง',
  technician: 'เจ้าหน้าที่ปฏิบัติงาน',
  staff: 'เจ้าหน้าที่',
  viewer: 'ผู้บริหาร',
  council: 'สมาชิกสภา',
}

export default function StaffSessionBar() {
  const { session, role, displayName } = useAuth()
  const isStaff = Boolean(session) && Boolean(ROLE_LABEL[role])
  const { secondsLeft, isWarning, stayActive } = useIdleLogout(isStaff)

  if (!isStaff) return null

  return (
    <>
      <div className="bg-slate-800 text-white text-xs px-3 py-1.5 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 min-w-0">
          <UserRound size={13} className="shrink-0 text-white/60" />
          <span className="truncate">
            กำลังใช้งานในชื่อ <span className="font-semibold">{displayName || 'ไม่ทราบชื่อ'}</span>
            <span className="text-white/60"> · {ROLE_LABEL[role]}</span>
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {/* นับถอยหลังให้เห็นตลอด ไม่ใช่โผล่ตอนใกล้หมด — เจ้าหน้าที่จะได้รู้ตัวว่าเหลือเวลาเท่าไร
              ก่อนระบบจะออกให้เอง แทนที่จะถูกเด้งออกกลางคันโดยไม่รู้ล่วงหน้า */}
          <span className={`flex items-center gap-1 tabular-nums ${isWarning ? 'text-amber-300 font-semibold' : 'text-white/60'}`}>
            <Clock size={12} /> {formatCountdown(secondsLeft)}
          </span>
          <button
            type="button"
            onClick={() => signOutSafely('/')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors font-semibold"
          >
            <LogOut size={12} /> ออกจากระบบ
          </button>
        </span>
      </div>

      {isWarning && (
        <div className="fixed inset-0 z-9999 bg-black/50 flex items-center justify-center px-4">
          <div className="w-full max-w-xs bg-white rounded-2xl p-6 text-center space-y-4 shadow-xl">
            <h2 className="text-base font-bold text-gray-800">ไม่ได้ใช้งานมาสักพัก</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              ระบบจะออกจากระบบให้อัตโนมัติใน <span className="font-bold text-gray-800">{secondsLeft}</span> วินาที
              เพื่อไม่ให้บัญชีของคุณค้างอยู่บนเครื่องนี้
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => signOutSafely('/')}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 active:scale-95 transition-all"
              >
                ออกเลย
              </button>
              <button
                type="button"
                onClick={stayActive}
                className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}
              >
                ใช้งานต่อ
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

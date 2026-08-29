import { useAuth } from '../../contexts/AuthContext'
import { signOutSafely } from '../../lib/supabase'
import { LogOut, UserRound } from 'lucide-react'

// แถบบอกว่า "ตอนนี้กำลังใช้งานในชื่อใคร" สำหรับบัญชีเจ้าหน้าที่
//
// ทำไมต้องบอกชื่อให้เห็นตลอด: หัวข้อของ back office เดิมแสดงแค่ตำแหน่ง ("ผู้ดูแลระบบ") กับ
// ตัวอักษรย่อ เจ้าหน้าที่ที่ไปใช้ PC เครื่องอื่นจึงไม่มีทางรู้ว่ากำลังทำงานในชื่อของใครอยู่
// ซึ่งเป็นต้นตอของ audit_logs ที่บันทึกผู้กระทำผิดตัว — ปัญหาเดียวกับที่ระบบเข้าสู่ระบบด้วย
// รหัสจากมือถือตั้งใจแก้ (ดู docs/device-login-design.md)
//
// ประชาชนไม่เห็นแถบนี้ ใช้แอปบนมือถือตัวเองอยู่แล้ว ไม่ได้แก้ปัญหาอะไร มีแต่เกะกะ
//
// ⚠️ ถอดตัวจับเวลาออกจากระบบอัตโนมัติออกทั้งหมดแล้ว (2026-08-29) อย่าเอากลับมาโดยไม่อ่านนี่ก่อน:
// เจ้าหน้าที่ใช้งานจากมือถือส่วนตัวเป็นหลัก ซึ่งล็อกอินครั้งเดียวแล้วใช้ยาว การถูกเด้งออกเมื่อ
// ไม่ได้แตะจอ 60 นาทีแปลว่าต้องพิมพ์รหัสผ่านใหม่แทบทุกวัน — และที่หนักกว่านั้นคือมันขัดกับ
// device-login เอง เพราะ session บนมือถือคือตัวอนุมัติการล็อกอินบน PC (docs/device-login-design.md
// ข้อ 7 "มือถือต้องล็อกอินค้างไว้") มือถือหลุด = อนุมัติ PC ไม่ได้
//
// ความเสี่ยงที่ยอมรับแทน: session ค้างบนเครื่องที่ยืมใช้ กันด้วยแถบนี้ (เห็นชื่อตัวเองตลอด)
// + ปุ่มออกจากระบบที่อยู่ในสายตา ไม่ใช่การเด้งออกอัตโนมัติ

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

  if (!isStaff) return null

  return (
    <div className="bg-slate-800 text-white text-xs px-3 py-1.5 flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 min-w-0">
        <UserRound size={13} className="shrink-0 text-white/60" />
        <span className="truncate">
          กำลังใช้งานในชื่อ <span className="font-semibold">{displayName || 'ไม่ทราบชื่อ'}</span>
          <span className="text-white/60"> · {ROLE_LABEL[role]}</span>
        </span>
      </span>
      <button
        type="button"
        onClick={() => signOutSafely('/')}
        className="flex items-center gap-1 shrink-0 px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors font-semibold"
      >
        <LogOut size={12} /> ออกจากระบบ
      </button>
    </div>
  )
}

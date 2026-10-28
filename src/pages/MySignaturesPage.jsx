import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, FileSignature, UserRound } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import MyEsignSection from '../components/profile/MyEsignSection'
import PortalSwitcher from '../components/layout/PortalSwitcher'
import UserProfileBadge from '../components/layout/UserProfileBadge'

// อยู่ใต้ /staff เพื่อใช้กรอบพอร์ทัลและนโยบายหน้าหลังบ้านเดิม Route ครอบ RequireAuth staffOnly
// คลัง/รหัส/ประวัติใช้ RPC ของผู้เรียกเดิม ไม่รับ user id จาก URL และไม่ย้ายข้อมูลลายเซ็น
export default function MySignaturesPage() {
  const { displayName } = useAuth()
  const { tenant } = useTenant()
  const { state } = useLocation()
  // เก็บเฉพาะหน้าหลักภายในที่รู้จัก ไม่รับปลายทางอิสระจาก URL และไม่ย้อนเข้า #signature วนซ้ำ
  const returnTo = ['/', '/staff', '/admin', '/technician', '/profile', '/data-center/staff'].includes(state?.returnTo) ? state.returnTo : '/staff'

  return (
    <div className="min-h-full bg-slate-50" data-my-signatures-page>
      <header className="text-white shadow-sm" style={{ background: 'linear-gradient(125deg, var(--color-primary-dark), var(--color-primary))' }}>
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-3 sm:px-6">
          <Link to={returnTo} aria-label="กลับหน้าก่อนหน้า" title="กลับหน้าก่อนหน้า"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <ArrowLeft size={22} aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold leading-snug sm:text-lg">ลายเซ็นของฉัน</h1>
            <p className="mt-1 truncate text-[11px] text-white/75">{tenant?.name || 'ระบบเจ้าหน้าที่'}</p>
          </div>
          <PortalSwitcher className="hidden lg:flex" />
          <UserProfileBadge compact className="md:hidden" />
          <UserProfileBadge className="hidden md:block" />
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-4 px-3 py-5 sm:px-6 sm:py-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"><FileSignature size={22} aria-hidden="true" /></span>
            <div className="min-w-0"><p className="break-words text-sm font-bold text-slate-800">{displayName || 'บัญชีของฉัน'}</p><p className="mt-1 text-xs leading-5 text-slate-500">ดูและจัดการข้อมูลการลงนามของคุณ</p></div>
          </div>
          <Link to="/profile" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"><UserRound size={16} aria-hidden="true" />โปรไฟล์ของฉัน</Link>
        </div>
        <MyEsignSection />
      </div>
    </div>
  )
}

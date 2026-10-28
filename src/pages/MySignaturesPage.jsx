import { useCallback, useRef } from 'react'
import { FileSignature } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import MyEsignSection from '../components/profile/MyEsignSection'
import AccountPageLayout from '../components/profile/AccountPageLayout'

// อยู่ใต้ /staff เพื่อใช้กรอบพอร์ทัลและนโยบายหน้าหลังบ้านเดิม Route ครอบ RequireAuth staffOnly
// คลัง/รหัส/ประวัติใช้ RPC ของผู้เรียกเดิม ไม่รับ user id จาก URL และไม่ย้ายข้อมูลลายเซ็น
export default function MySignaturesPage() {
  const { displayName } = useAuth()
  const contentRef = useRef(null)
  // ตรวจเฉพาะว่ามีข้อความค้างในฟอร์มหรือไม่ ไม่คัดลอก PIN/ภาพไปเก็บใน state หรือ storage อีกชุด
  const hasUnsavedChanges = useCallback(() => [...(contentRef.current?.querySelectorAll('input:not([type="checkbox"]):not([type="file"]):not([type="hidden"])') ?? [])].some(input => Boolean(input.value)), [])

  return (
    <AccountPageLayout active="signatures" title="ลายเซ็นของฉัน" hasUnsavedChanges={hasUnsavedChanges}>
      <div ref={contentRef} className="space-y-4" data-my-signatures-page>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"><FileSignature size={22} aria-hidden="true" /></span>
            <div className="min-w-0"><p className="break-words text-sm font-bold text-slate-800">{displayName || 'บัญชีของฉัน'}</p><p className="mt-1 text-xs leading-5 text-slate-500">ดูและจัดการข้อมูลการลงนามของคุณ</p></div>
          </div>
        </div>
        <MyEsignSection />
      </div>
    </AccountPageLayout>
  )
}

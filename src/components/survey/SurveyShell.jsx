import { useTenant } from '../../contexts/TenantContext'

// โครงหน้าสาธารณะของแบบสำรวจ (หัวสีหน่วยงาน + เนื้อหากว้างพอดีมือถือ) — หน้าลิงก์ /survey/:id และหน้ารายการ /surveys ใช้ร่วมกัน
// หน้าหน่วยงานตั้งชื่อ/สีผ่าน CSS variable ของ tenant เหมือน TrackComplaint
export default function SurveyShell({ title, children }) {
  const { tenant } = useTenant()
  return (
    <div className="min-h-screen pb-28 md:pb-12" style={{ backgroundColor: '#eef2f7' }}>
      <header style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
        <div className="max-w-lg mx-auto px-4 py-5 text-white">
          <p className="text-xs text-white/75">{tenant?.name || 'หน่วยงาน'}</p>
          <h1 className="text-lg font-bold leading-tight">{title}</h1>
        </div>
      </header>
      <main data-survey-page className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {children}
      </main>
    </div>
  )
}

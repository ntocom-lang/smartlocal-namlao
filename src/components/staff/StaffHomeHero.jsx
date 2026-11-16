import { CheckCircle2, CircleAlert, Info, Sparkles } from 'lucide-react'
import { STAFF_BRIEFING_RULE } from '../../lib/staffHomeBriefing'

// แถบหัวหน้าแรกเจ้าหน้าที่ — ชื่อหน้า + บทบาท + ทักทาย + วันที่/ไตรมาสปีงบ + "สรุปวันนี้" (ไม่เกิน 2 บรรทัด)
// ตัวเลขทั้งหมดมาจากหน้าแม่ (StaffOperationalDashboard) ไม่ดึงข้อมูลเอง · h1 "แดชบอร์ดสำหรับเจ้าหน้าที่" เทสต์ใช้เป็นตัวชี้ว่าหน้าพร้อม ห้ามเปลี่ยนคำ
// ไม่มีงานค้าง (briefing.tone === 'clear') → พื้นเขียวเข้ม · สีไม่ใช่สัญญาณเดียว: ข้อความ + ไอคอนกำกับทุกสถานะ
const TONE_BG = {
  clear: 'linear-gradient(135deg, #065f46 0%, #047857 100%)',
  normal: 'linear-gradient(135deg, #1a3a5c 0%, #24507a 100%)',
  urgent: 'linear-gradient(135deg, #1a3a5c 0%, #24507a 100%)',
}
const TONE_ICON = { clear: CheckCircle2, normal: Info, urgent: CircleAlert }

export default function StaffHomeHero({ roleLabel, fullName, dateText, fiscalText, briefing }) {
  const tone = briefing?.tone ?? 'normal'
  const ToneIcon = TONE_ICON[tone] ?? Info
  const name = typeof fullName === 'string' ? fullName.trim() : ''
  return (
    <header data-home-hero className="min-w-0 rounded-2xl px-4 py-3 text-white shadow-sm" style={{ background: TONE_BG[tone] ?? TONE_BG.normal }}>
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="min-w-0 truncate text-lg font-black">แดชบอร์ดสำหรับเจ้าหน้าที่</h1>
        {roleLabel && <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold">{roleLabel}</span>}
      </div>
      <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-white/85">
        {name && <span className="max-w-full truncate font-semibold">สวัสดี คุณ{name}</span>}
        <span className="truncate">{dateText}</span>
        {fiscalText && <span className="truncate">{fiscalText}</span>}
      </p>

      {briefing && (
        <div className="mt-2 border-t border-white/20 pt-2">
          <div data-home-briefing data-home-briefing-tone={tone} className="flex min-w-0 items-start gap-2">
            <ToneIcon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-0.5 text-sm font-semibold leading-snug">
              {briefing.lines.map((line, index) => <p key={index} className="break-words">{line}</p>)}
            </div>
          </div>
          <details data-home-briefing-rule className="group -mb-1">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg pr-2 text-xs font-semibold text-white/85 hover:text-white [&::-webkit-details-marker]:hidden">
              <Sparkles size={13} aria-hidden="true" /> วิธีคิด
            </summary>
            <p className="pb-1 text-xs leading-relaxed text-white/85">{STAFF_BRIEFING_RULE}</p>
          </details>
        </div>
      )}
    </header>
  )
}

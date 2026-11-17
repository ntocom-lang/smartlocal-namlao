import { licenceBadge } from '../../../lib/licenceRegistry'

/** ป้ายสถานะของใบ (คำนวณจากวันนี้ ไม่ใช่ค่าในฐาน) */
export default function LicenceBadge({ licence, docKind, today, soonDays }) {
  const b = licenceBadge(licence, docKind, today, soonDays)
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${b.tone}`}>{b.label}</span>
}

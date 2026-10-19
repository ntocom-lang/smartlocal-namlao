import { Link } from 'react-router-dom'
import { ChevronRight, Megaphone } from 'lucide-react'

/**
 * ประกาศสถานการณ์น้ำ-ฝนของหน่วยงาน — ขึ้นเฉพาะฉบับที่เจ้าหน้าที่ผู้มีสิทธิ์กดยืนยันแล้วและยังไม่หมดอายุ
 * (ระบบร่างข้อความจากค่าที่วัดได้ คนกดยืนยัน ไม่มีคนกด = ไม่มีอะไรขึ้นหน้านี้)
 *
 * ข้อความแสดงตามที่ผู้มีสิทธิ์ยืนยันทุกตัวอักษร (แก้ไม่ได้) · ไม่บอกเวลาน้ำถึง ไม่สั่งอพยพ ไม่รับรองว่าปลอดภัย
 * ครบอายุหรือยกเลิกแล้วหายเอง · view มาจาก publicView() ใน src/lib/waterAnnouncements.js (null = ไม่แสดงอะไร)
 *
 * linkTo = ลิงก์ไปหน้า /water-situation (ใช้บนหน้าแรก) — บนหน้านั้นเองไม่ต้องส่ง
 */
export default function WaterAnnouncementCard({ view, linkTo = null, className = '' }) {
  if (!view) return null
  return (
    <section data-water-announcement role="alert" aria-label="ประกาศสถานการณ์น้ำ-ฝนจากหน่วยงาน"
      className={`rounded-2xl border-2 border-amber-400 bg-amber-50 p-3 sm:p-4 ${className}`}>
      <div className="flex items-start gap-2.5">
        <Megaphone size={22} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800">ประกาศสถานการณ์น้ำ-ฝน</p>
          <div data-wa-body className="mt-1.5 space-y-0.5 text-sm leading-relaxed text-gray-900">
            {view.lines.map((line, i) => (line === ''
              ? <div key={i} className="h-2" aria-hidden="true" />
              : <p key={i} className={i === 0 ? 'font-bold' : ''}>{line}</p>))}
          </div>
          <p data-wa-time className="mt-2 text-xs leading-relaxed text-gray-700">
            เผยแพร่ {view.publishedText} · ใช้ได้ถึง {view.expiresText}{view.remaining ? ` (${view.remaining})` : ''}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
            ประกาศนี้ผ่านการยืนยันจากเจ้าหน้าที่ที่{view.issuer || 'หน่วยงาน'}กำหนดแล้ว
          </p>
          {linkTo && (
            <Link to={linkTo} data-wa-link
              className="mt-1 inline-flex min-h-[44px] items-center gap-0.5 text-xs font-bold text-amber-900 underline">
              ดูสถานการณ์น้ำ-ฝนในพื้นที่ <ChevronRight size={14} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}

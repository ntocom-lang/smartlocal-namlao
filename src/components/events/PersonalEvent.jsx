// ชิ้นส่วนหน้าจอของรายการส่วนตัวในปฏิทิน ("🔒 เฉพาะฉัน") — ใช้ร่วมกันทั้งหน้าจัดการ (EventsManager)
// และหน้า /events ไฟล์นี้ export เฉพาะคอมโพเนนต์ (lint react-refresh) ตรรกะอยู่ที่ src/lib/personalEvents.js
import { PERSONAL_COLOR, PERSONAL_LIMIT } from '../../lib/personalEvents'

// ป้ายของรายการที่ตั้งให้ขึ้นทุกปี (เช่น วันเกิด) — วางต่อจากป้ายกลุ่มเป้าหมาย
// ใช้ลูกศร ↻ ที่เป็นตัวอักษร ไม่ใช้อีโมจิ 🔁 (Windows/Android วาดเป็นกล่องสีฟ้า ไม่เข้ากับสีของป้าย)
export function YearlyBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${className}`}
      style={{ color: PERSONAL_COLOR, borderColor: PERSONAL_COLOR, backgroundColor: PERSONAL_COLOR + '18' }}>
      ↻ ทุกปี
    </span>
  )
}

const fmtDate = (dateStr) => {
  const [y, m, d] = String(dateStr ?? '').split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

// ข้อความใต้ปุ่ม "เฉพาะฉัน" ในฟอร์ม: บอกว่าใครเห็น เก็บได้เท่าไร และไม่ควรจดอะไร (PDPA)
// quota มาจาก personalQuota() — เมื่อครบ 100 บอกล่วงหน้าว่ารายการไหนจะถูกทับ เจ้าของจะได้เห็นก่อนกดบันทึก
// (ระบบทับให้เองตามที่เจ้าของระบบสั่ง แต่ไม่ควรมีอะไรหายโดยที่เจ้าของรายการไม่รู้)
export function PersonalFormHint({ quota, editing = false }) {
  const full = !editing && quota?.full
  return (
    <div className="mt-2 rounded-xl border px-3 py-2.5 space-y-1.5"
      style={{ borderColor: PERSONAL_COLOR + '55', backgroundColor: PERSONAL_COLOR + '0d' }}>
      <p className="text-[11px] leading-relaxed text-gray-600">
        🔒 เห็นเฉพาะคุณ คนอื่นและผู้ดูแลระบบไม่เห็นในหน้าจอ ไม่ส่งแจ้งเตือนเข้ากลุ่ม
        · เก็บได้ {PERSONAL_LIMIT} รายการ เต็มแล้วระบบทับรายการเก่าที่สุด
        · ข้อมูลเก็บในระบบของหน่วยงาน จึงไม่ควรบันทึกเรื่องอ่อนไหว เช่น สุขภาพ
      </p>
      {full && quota.victim && (
        <p className="text-[11px] leading-relaxed font-semibold text-amber-700" data-personal-overwrite="will-replace">
          ครบ {PERSONAL_LIMIT} รายการแล้ว เมื่อบันทึก ระบบจะลบรายการเก่าที่สุดออก: «{quota.victim.title}»
          {' '}({fmtDate(quota.victim.end_date || quota.victim.base_date || quota.victim.event_date)})
        </p>
      )}
      {full && !quota.victim && (
        <p className="text-[11px] leading-relaxed font-semibold text-red-600" data-personal-overwrite="blocked">
          ครบ {PERSONAL_LIMIT} รายการแล้ว และเป็นรายการล่วงหน้าหรือรายการ &ldquo;ทุกปี&rdquo; ทั้งหมด
          ต้องลบรายการที่ไม่ใช้ก่อนจึงจะเพิ่มได้
        </p>
      )}
    </div>
  )
}

import { MapPin, Wind, Phone } from 'lucide-react'

// แสดงฟิลด์เฉพาะหมวด "กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)" — ใช้ซ้ำทั้งในแท็ปแอดมิน (เฉพาะกิจ) และแผงรับทราบ
// ของผู้รับผิดชอบ (OdorAcknowledgePanel) พิกัด GPS แยกเป็นหัวข้อของตัวเอง ไม่ปนกับสถานที่/เบอร์ติดต่อ
// เหมือนใน ComplaintDetailModal ทั่วไป (ตามที่ตกลงกัน)
export default function OdorFieldsDisplay({ complaint: c }) {
  const extra = c.extra_data ?? {}
  const submittedAt = c.created_at
    ? new Date(c.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
    : '-'

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-1.5 text-sm text-gray-700">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">รายละเอียด (กลิ่นเหม็น)</p>
        <p className="flex flex-wrap items-center gap-x-1">
          ผู้แจ้ง: {c.reporter_name || 'ไม่ระบุชื่อผู้แจ้ง'}
          {c.phone && (
            <>
              {' · '}
              <a href={`tel:${c.phone}`}
                className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline">
                <Phone size={12} /> {c.phone}
              </a>
            </>
          )}
        </p>
        <p>วันเวลาที่แจ้ง: {submittedAt}</p>
        <p>ระดับความรุนแรง: {extra.odor_intensity ?? '-'} / 5</p>
        <p>อาการทางสุขภาพ: {extra.health_effect ?? 'ไม่มี'}</p>
        <p>ทิศทางลม: {extra.wind_direction ?? '-'}</p>
        {c.detail && <p>รายละเอียดเพิ่มเติม: {c.detail}</p>}
      </div>

      {/* พิกัดที่ปักหมุด — หัวข้อแยกต่างหาก ไม่รวมกับสถานที่/เบอร์ติดต่อ */}
      <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <MapPin size={13} /> พิกัดที่ปักหมุด
        </p>
        {c.latitude && c.longitude ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-800">{c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}</span>
            <a href={`https://maps.google.com/?q=${c.latitude},${c.longitude}`}
              target="_blank" rel="noreferrer"
              className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded-lg">เปิดแผนที่</a>
          </div>
        ) : (
          <p className="text-sm text-gray-400">ไม่มีพิกัด GPS</p>
        )}
      </div>
    </div>
  )
}

// Badge สั้นๆ บอกสถานะรับทราบ — ใช้ในแท็ปแอดมินและหัวการ์ดของแผงรับทราบ
// compact = ตัดวันเวลาออก เหลือแค่คำสั้นๆ — ใช้ในตารางเดสก์ท็อป (คอลัมน์แคบ, table-fixed) กัน
// ข้อความ "รับทราบแล้ว · 25/8/69 17:18" ดันคอลัมน์ขยายจนตารางล้นต้องเลื่อนซ้ายขวา
// (flex item ไม่ยอมหดต่ำกว่า min-content โดยดีฟอลต์) วันเวลาเต็มยังดูได้ตอนกางรายละเอียด
export function OdorAckBadge({ complaint: c, compact = false }) {
  const ackAt = c.extra_data?.acknowledged_at
  if (!ackAt) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 whitespace-nowrap">
        <Wind size={11} /> รอรับทราบ
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700 whitespace-nowrap">
      รับทราบแล้ว{!compact && ` · ${new Date(ackAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}`}
    </span>
  )
}

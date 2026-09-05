import { useCallback, useEffect, useState } from 'react'
import { Wind, Search, BarChart3, List } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import OdorFieldsDisplay from '../complaints/OdorFieldsDisplay'
import OdorComplaintTable, { OdorDetailModal } from '../complaints/OdorComplaintTable'
import OdorReportSummary from '../complaints/OdorReportSummary'
import { fetchComplaintPrivateDetail } from '../../lib/complaintPrivacy'

const VIEWS = [
  { key: 'report', label: 'รายงานสรุป', icon: BarChart3 },
  { key: 'list',   label: 'รายการคำร้อง', icon: List },
]

// สายงานเฉพาะกิจ "กลิ่นเหม็นรบกวน" — ส่งตรงถึงผู้รับผิดชอบ (assigned_to) โดยไม่รอแอดมินกด "รับเรื่อง" ก่อน
// ต่างจาก query ปกติของ TechnicianDashboard/StaffDashboard ตรงที่ "ไม่กรองด้วย status เลย" (ของเดิมกรอง
// .neq('status','pending') ทิ้ง ทำให้ผู้รับผิดชอบมองไม่เห็นคำร้องที่ยังไม่ผ่านแอดมิน)
// แยกขาดจาก status pipeline เดิมของทุกหมวด
//
// v3: ตาราง/ตัวกรอง/การเรียงลำดับย้ายไปใช้ OdorComplaintTable ร่วมกับแท็ปเฉพาะกิจของหน้าแอดมินแล้ว
// (เดิมเขียนแยกกันคนละชุด คอลัมน์ไม่ตรงกัน ไม่มีตัวกรอง และเพิ่มคอลัมน์ทีต้องแก้ 2 รอบ)
//
// v4 (ไฟล์นี้เดิมชื่อ OdorAcknowledgePanel): ตัดปุ่ม "รับทราบ" กับแท็ปรอ/รับแล้วออกทั้งชุด
// ระบบรับเรื่องให้อัตโนมัติตั้งแต่ประชาชนกดส่ง (trigger route_adhoc_complaint) ผู้รับผิดชอบจึงไม่มี
// อะไรต้องกดอีก บทบาทเปลี่ยนเป็น "อ่านรายงาน" — ดีฟอลต์จึงเปิดที่หน้าสรุปวิเคราะห์ ไม่ใช่รายการดิบ
//
// ⚠️ ยังไม่มีจุดบันทึกผลการตรวจสอบในสายงานนี้ รายงานจึงตอบได้แค่ "มีคนแจ้งอะไร ที่ไหน เมื่อไหร่"
// ตอบไม่ได้ว่าจัดการไปแล้วแค่ไหน — ข้อจำกัดนี้ถูกพิมพ์กำกับไว้ในตัวรายงานเองด้วย ไม่ได้ซ่อนไว้
//
// คืน null ถ้าไม่มีคำร้อง odor ที่ assign ให้ staffId คนนี้เลย — ผู้ใช้อื่นไม่เห็นอะไรเปลี่ยนแปลง
export default function OdorReportPanel({ tenantId, staffId }) {
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('report')
  const [search, setSearch] = useState('')
  // บ็อปอัพรายละเอียด — โหลดฉบับเต็ม (เบอร์โทรไม่ mask) ผ่าน get_complaint_private_detail ตอนกดเปิด
  // เท่านั้น ทางนี้บันทึก audit log ว่าใครเปิดดูข้อมูลติดต่อของผู้แจ้งคนไหน ตรงกับที่หน้าแอดมินทำอยู่
  const [expandedId, setExpandedId] = useState(null)
  const [detailById, setDetailById] = useState({})
  const [detailLoadingId, setDetailLoadingId] = useState(null)

  const fetchOdorComplaints = useCallback(async () => {
    if (!tenantId || !staffId) return
    const { data, error } = await supabase
      .from('complaints')
      .select('*')
      .eq('municipality_id', tenantId)
      .eq('category', 'odor')
      .eq('assigned_to', staffId)
      .order('created_at', { ascending: false })
    if (!error) setComplaints(data ?? [])
    setLoading(false)
  }, [tenantId, staffId])

  useEffect(() => { queueMicrotask(fetchOdorComplaints) }, [fetchOdorComplaints])

  useEffect(() => {
    if (!tenantId || !staffId) return
    const ch = supabase.channel(`odor-ack-${tenantId}-${staffId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'complaints' },
        ({ new: row }) => {
          if (row.municipality_id !== tenantId || row.assigned_to !== staffId || row.category !== 'odor') return
          fetchOdorComplaints()
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'complaints' },
        ({ new: row }) => {
          if (row.municipality_id !== tenantId || row.assigned_to !== staffId || row.category !== 'odor') return
          fetchOdorComplaints()
        })
      // DELETE (แอดมินลบคำร้องทิ้ง) — ถ้าไม่ดักไว้ เจ้าหน้าที่จะยังเห็นเรื่องที่ถูกลบไปแล้วจนกว่าจะ refresh
      // payload ของ DELETE มีแค่ primary key เท่านั้น (replica identity ของตารางเป็นค่า default ซึ่งจงใจ
      // ไม่เปลี่ยนเป็น full เพราะจะทำให้ข้อมูลเต็มแถวหลุดไปหา subscriber ทุกคนโดยไม่ผ่าน RLS)
      // จึงกรองด้วย "id นี้อยู่ในรายการของฉันหรือเปล่า" แทนการเช็ค municipality_id/assigned_to แบบด้านบน
      // และคืน prev เดิมถ้าไม่ใช่ของเรา เพื่อไม่ให้ re-render โดยไม่จำเป็น
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'complaints' },
        ({ old }) => {
          const deletedId = old?.id
          if (!deletedId) return
          setComplaints((prev) => prev.some((c) => c.id === deletedId)
            ? prev.filter((c) => c.id !== deletedId)
            : prev)
          setExpandedId((cur) => cur === deletedId ? null : cur)
        })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [tenantId, staffId, fetchOdorComplaints])

  async function openDetail(c) {
    setExpandedId(c.id)
    if (detailById[c.id]) return
    setDetailLoadingId(c.id)
    const { data } = await fetchComplaintPrivateDetail(
      c.id, 'เปิดรายละเอียดคำร้องกลิ่นเหม็นรบกวนเพื่อติดต่อผู้แจ้ง')
    if (data) setDetailById((prev) => ({ ...prev, [c.id]: data }))
    setDetailLoadingId(null)
  }

  if (loading || complaints.length === 0) return null

  // ค้นหาทำงานก่อนส่งเข้าตาราง — ตัวกรองที่เหลือ (สถานที่/ความรุนแรง/อาการ/ช่วงเวลา) อยู่ในตารางร่วมแล้ว
  // ไม่ต้องทำซ้ำที่นี่ และไม่มีแท็ปสถานะให้กรองอีกต่อไปเพราะทุกเรื่องมีสถานะเดียวกันหมด
  const visible = complaints.filter((c) => {
    const q = search.trim()
    if (q && !`${c.reporter_name ?? ''} ${c.location_name ?? ''} ${c.village ?? ''}`.includes(q)) return false
    return true
  })

  const openComplaint = expandedId ? complaints.find((c) => c.id === expandedId) : null

  return (
    <div className="rounded-2xl border-2 border-lime-200 bg-lime-50/60 overflow-hidden">
      <div className="p-4 space-y-3">
        <h2 className="text-sm font-bold text-lime-800 flex items-center gap-2">
          <Wind size={16} /> เฉพาะกิจ: กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)
        </h2>
        <p className="text-xs text-lime-700/80 -mt-1">
          ส่งตรงถึงท่านโดยไม่ผ่านแอดมิน ระบบรับเรื่องให้อัตโนมัติทุกใบตั้งแต่ประชาชนกดส่ง
          ไม่ต้องกดรับทราบอีก — ใช้รายงานสรุปวางแผนลงพื้นที่ และเปิดรายการคำร้องเมื่อต้องการติดต่อผู้แจ้ง
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5">
            {VIEWS.map((v) => {
              const active = view === v.key
              return (
                <button key={v.key} type="button" onClick={() => setView(v.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                    active ? 'text-white border-transparent bg-lime-600' : 'text-lime-700 bg-white border-lime-200 hover:bg-lime-100'
                  }`}>
                  <v.icon size={13} /> {v.label}
                  {v.key === 'list' && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${active ? 'bg-white/25' : 'bg-lime-100'}`}>
                      {complaints.length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {/* ช่องค้นหามีความหมายเฉพาะมุมมองรายการ — รายงานสรุปเป็นสถิติรวม ไม่ได้ไล่ทีละเรื่อง */}
          {view === 'list' && (
            <div className="relative flex-1 min-w-40">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-lime-400 pointer-events-none" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อผู้แจ้ง/สถานที่"
                className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-lime-200 bg-white text-xs text-gray-700 focus:outline-none focus:border-lime-400" />
            </div>
          )}
        </div>
      </div>

      {view === 'report' ? (
        // รายงานใช้คำร้องทั้งหมดที่ผู้รับผิดชอบคนนี้ถืออยู่ ไม่ผูกกับช่องค้นหา — สถิติที่ขยับตาม
        // คำค้นจะอ่านผิดง่ายมาก (พิมพ์ชื่อหมู่บ้านแล้วเห็น "100% ของเรื่องอยู่หมู่นี้")
        <div className="bg-white border-t border-lime-200 p-4">
          <OdorReportSummary complaints={complaints} />
        </div>
      ) : (
        <div className="bg-white border-t border-lime-200">
          <OdorComplaintTable
            complaints={visible}
            mode="staff"
            detailLoadingId={detailLoadingId}
            onRowClick={openDetail}
            emptyText="ไม่พบรายการที่ตรงกับคำค้นหา"
          />
        </div>
      )}

      {openComplaint && (
        <OdorDetailModal loading={detailLoadingId === openComplaint.id} onClose={() => setExpandedId(null)}>
          {/* ไม่มีปุ่มใดๆ ในบ็อปอัพนี้แล้ว — ผู้รับผิดชอบไม่ต้องกดอะไรทั้งสิ้น เปิดดูเพื่อเอาเบอร์ติดต่อ
              ผู้แจ้งกับพิกัดไปลงพื้นที่เท่านั้น (การเปิดยังถูกบันทึก audit log ว่าใครดูข้อมูลใคร) */}
          <OdorFieldsDisplay complaint={detailById[openComplaint.id] ?? openComplaint} />
        </OdorDetailModal>
      )}
    </div>
  )
}

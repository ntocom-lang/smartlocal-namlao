import { useCallback, useEffect, useState } from 'react'
import { Wind, Loader2, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import OdorFieldsDisplay from '../complaints/OdorFieldsDisplay'
import OdorComplaintTable, { OdorDetailModal } from '../complaints/OdorComplaintTable'
import { fetchComplaintPrivateDetail } from '../../lib/complaintPrivacy'

const TABS = [
  { key: 'pending', label: 'รอรับทราบ' },
  { key: 'acked',   label: 'รับทราบแล้ว' },
  { key: 'all',     label: 'ทั้งหมด' },
]

// สายงานเฉพาะกิจ "กลิ่นเหม็นรบกวน" — ส่งตรงถึงผู้รับผิดชอบ (assigned_to) โดยไม่รอแอดมินกด "รับเรื่อง" ก่อน
// ต่างจาก query ปกติของ TechnicianDashboard/StaffDashboard ตรงที่ "ไม่กรองด้วย status เลย" (ของเดิมกรอง
// .neq('status','pending') ทิ้ง ทำให้ผู้รับผิดชอบมองไม่เห็นคำร้องที่ยังไม่ผ่านแอดมิน) — ที่นี่ผู้รับผิดชอบ
// มีหน้าที่แค่กด "รับทราบ" ครั้งเดียวจบ ไม่ต้องไล่สถานะ ใช้ complaints.extra_data.acknowledged_at/by
// แยกขาดจาก status pipeline เดิมของทุกหมวด
//
// v3: ตาราง/ตัวกรอง/การเรียงลำดับย้ายไปใช้ OdorComplaintTable ร่วมกับแท็ปเฉพาะกิจของหน้าแอดมินแล้ว
// (เดิมเขียนแยกกันคนละชุด คอลัมน์ไม่ตรงกัน ไม่มีตัวกรอง และเพิ่มคอลัมน์ทีต้องแก้ 2 รอบ)
// เหลือไว้ที่นี่เฉพาะสิ่งที่เป็นของฝั่งผู้รับผิดชอบจริงๆ: แท็ปสถานะ, ค้นหา, และปุ่ม "รับทราบ"
//
// คืน null ถ้าไม่มีคำร้อง odor ที่ assign ให้ staffId คนนี้เลย — ผู้ใช้อื่นไม่เห็นอะไรเปลี่ยนแปลง
export default function OdorAcknowledgePanel({ tenantId, staffId }) {
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [acking, setAcking] = useState(null)
  const [filterTab, setFilterTab] = useState('pending')
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

  async function acknowledge(c) {
    setAcking(c.id)
    const nextExtra = {
      ...(c.extra_data ?? {}),
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: staffId,
    }
    const { error } = await supabase.from('complaints').update({ extra_data: nextExtra }).eq('id', c.id)
    if (!error) {
      setComplaints((prev) => prev.map((x) => x.id === c.id ? { ...x, extra_data: nextExtra } : x))
      setExpandedId(null)
    } else {
      alert('รับทราบไม่สำเร็จ: ' + error.message)
    }
    setAcking(null)
  }

  if (loading || complaints.length === 0) return null

  const pendingCount = complaints.filter((c) => !c.extra_data?.acknowledged_at).length
  const ackedCount   = complaints.length - pendingCount

  // แท็ปสถานะ + ค้นหา ทำงานก่อนส่งเข้าตาราง — ตัวกรองที่เหลือ (สถานที่/ความรุนแรง/อาการ/ช่วงเวลา)
  // อยู่ในตารางร่วมแล้ว ไม่ต้องทำซ้ำที่นี่
  const visible = complaints.filter((c) => {
    if (filterTab === 'pending' && c.extra_data?.acknowledged_at) return false
    if (filterTab === 'acked' && !c.extra_data?.acknowledged_at) return false
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
          ส่งตรงถึงท่านโดยไม่ผ่านแอดมิน — กดที่แถวเพื่อดูรายละเอียด แล้วกด "รับทราบ" เพื่อยืนยันว่าได้รับเรื่องแล้ว
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5">
            {TABS.map((t) => {
              const count = t.key === 'pending' ? pendingCount : t.key === 'acked' ? ackedCount : complaints.length
              const active = filterTab === t.key
              return (
                <button key={t.key} type="button" onClick={() => setFilterTab(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                    active ? 'text-white border-transparent bg-lime-600' : 'text-lime-700 bg-white border-lime-200 hover:bg-lime-100'
                  }`}>
                  {t.label}
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${active ? 'bg-white/25' : 'bg-lime-100'}`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="relative flex-1 min-w-40">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-lime-400 pointer-events-none" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อผู้แจ้ง/สถานที่"
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-lime-200 bg-white text-xs text-gray-700 focus:outline-none focus:border-lime-400" />
          </div>
        </div>
      </div>

      <div className="bg-white border-t border-lime-200">
        <OdorComplaintTable
          complaints={visible}
          mode="staff"
          detailLoadingId={detailLoadingId}
          onRowClick={openDetail}
          emptyText="ไม่พบรายการในแท็ปนี้"
        />
      </div>

      {openComplaint && (
        <OdorDetailModal loading={detailLoadingId === openComplaint.id} onClose={() => setExpandedId(null)}>
          <OdorFieldsDisplay complaint={detailById[openComplaint.id] ?? openComplaint} />
          {!openComplaint.extra_data?.acknowledged_at ? (
            <button type="button" onClick={() => acknowledge(openComplaint)} disabled={acking === openComplaint.id}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-lime-600 hover:bg-lime-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {acking === openComplaint.id ? <Loader2 size={16} className="animate-spin" /> : null}
              รับทราบ
            </button>
          ) : (
            <p className="text-xs text-gray-400 italic text-center">
              รับทราบแล้วเมื่อ {new Date(openComplaint.extra_data.acknowledged_at).toLocaleString('th-TH', {
                day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          )}
        </OdorDetailModal>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Wind, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import OdorFieldsDisplay, { OdorAckBadge } from '../complaints/OdorFieldsDisplay'

// สายงานเฉพาะกิจ "กลิ่นเหม็นรบกวน" — ส่งตรงถึงผู้รับผิดชอบ (assigned_to) โดยไม่รอแอดมินกด "รับเรื่อง" ก่อน
// ต่างจาก query ปกติของ TechnicianDashboard/StaffDashboard ตรงที่ "ไม่กรองด้วย status เลย" (ของเดิมกรอง
// .neq('status','pending') ทิ้ง ทำให้ผู้รับผิดชอบมองไม่เห็นคำร้องที่ยังไม่ผ่านแอดมิน) — ที่นี่ผู้รับผิดชอบ
// มีหน้าที่แค่กด "รับทราบ" ครั้งเดียวจบ ไม่ต้องไล่สถานะ ใช้ complaints.extra_data.acknowledged_at/by
// แยกขาดจาก status pipeline เดิมของทุกหมวด (ดู docs/แผนงาน odor เฉพาะกิจ)
// คืน null ถ้าไม่มีคำร้อง odor ที่ assign ให้ staffId คนนี้เลย — ผู้ใช้อื่นไม่เห็นอะไรเปลี่ยนแปลง
export default function OdorAcknowledgePanel({ tenantId, staffId }) {
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [acking, setAcking] = useState(null)

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
    const ch = supabase.channel(`odor-ack-${tenantId}-${staffId}`)
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
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [tenantId, staffId, fetchOdorComplaints])

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
    } else {
      alert('รับทราบไม่สำเร็จ: ' + error.message)
    }
    setAcking(null)
  }

  if (loading || complaints.length === 0) return null

  const pending    = complaints.filter((c) => !c.extra_data?.acknowledged_at)
  const acked      = complaints.filter((c) => c.extra_data?.acknowledged_at)

  return (
    <div className="rounded-2xl border-2 border-lime-200 bg-lime-50/60 p-4 space-y-3">
      <h2 className="text-sm font-bold text-lime-800 flex items-center gap-2">
        <Wind size={16} /> เฉพาะกิจ: กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)
      </h2>
      <p className="text-xs text-lime-700/80 -mt-1">
        ส่งตรงถึงท่านโดยไม่ผ่านแอดมิน — กด "รับทราบ" เพื่อยืนยันว่าได้รับเรื่องแล้ว
      </p>

      <div className="space-y-2">
        {[...pending, ...acked].map((c) => {
          const isOpen = expandedId === c.id
          return (
            <div key={c.id} className="bg-white rounded-xl border border-lime-100 overflow-hidden">
              <button type="button" onClick={() => setExpandedId(isOpen ? null : c.id)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{c.reporter_name || 'ไม่ระบุชื่อผู้แจ้ง'}</p>
                  <p className="text-xs text-gray-400">{new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <OdorAckBadge complaint={c} />
                  {isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-lime-100 pt-3">
                  <OdorFieldsDisplay complaint={c} />
                  {!c.extra_data?.acknowledged_at && (
                    <button type="button" onClick={() => acknowledge(c)} disabled={acking === c.id}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-lime-600 hover:bg-lime-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                      {acking === c.id ? <Loader2 size={16} className="animate-spin" /> : null}
                      รับทราบ
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

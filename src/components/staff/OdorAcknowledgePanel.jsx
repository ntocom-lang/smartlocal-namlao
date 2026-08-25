import { Fragment, useCallback, useEffect, useState } from 'react'
import { Wind, ChevronDown, ChevronUp, Loader2, Search, ChevronLeft, ChevronRight, MapPin, Camera } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import OdorFieldsDisplay, { OdorAckBadge } from '../complaints/OdorFieldsDisplay'

const PER_PAGE = 10
const TABS = [
  { key: 'pending', label: 'รอรับทราบ' },
  { key: 'acked',   label: 'รับทราบแล้ว' },
  { key: 'all',     label: 'ทั้งหมด' },
]

// สายงานเฉพาะกิจ "กลิ่นเหม็นรบกวน" — ส่งตรงถึงผู้รับผิดชอบ (assigned_to) โดยไม่รอแอดมินกด "รับเรื่อง" ก่อน
// ต่างจาก query ปกติของ TechnicianDashboard/StaffDashboard ตรงที่ "ไม่กรองด้วย status เลย" (ของเดิมกรอง
// .neq('status','pending') ทิ้ง ทำให้ผู้รับผิดชอบมองไม่เห็นคำร้องที่ยังไม่ผ่านแอดมิน) — ที่นี่ผู้รับผิดชอบ
// มีหน้าที่แค่กด "รับทราบ" ครั้งเดียวจบ ไม่ต้องไล่สถานะ ใช้ complaints.extra_data.acknowledged_at/by
// แยกขาดจาก status pipeline เดิมของทุกหมวด (ดู docs/แผนงาน odor เฉพาะกิจ)
//
// v2: เดิม render เป็น card list แบนเดียวไม่มี search/filter/pagination — ใช้ได้ตอนมีไม่กี่รายการ แต่ถ้า
// เทศบาลใหญ่มีคนแจ้งเป็นร้อยจะไล่หายากมาก จึงเพิ่มแท็บ รอรับทราบ/รับทราบแล้ว/ทั้งหมด + ค้นหาชื่อผู้แจ้ง +
// แบ่งหน้า 10 รายการ และ desktop ใช้ตารางแบบเดียวกับ ComplaintsManager.jsx แทน card ให้สแกนดูได้เร็วขึ้น
//
// คืน null ถ้าไม่มีคำร้อง odor ที่ assign ให้ staffId คนนี้เลย — ผู้ใช้อื่นไม่เห็นอะไรเปลี่ยนแปลง
export default function OdorAcknowledgePanel({ tenantId, staffId }) {
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [acking, setAcking] = useState(null)
  const [filterTab, setFilterTab] = useState('pending')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

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

  const pendingCount = complaints.filter((c) => !c.extra_data?.acknowledged_at).length
  const ackedCount   = complaints.length - pendingCount

  const filtered = complaints.filter((c) => {
    if (filterTab === 'pending' && c.extra_data?.acknowledged_at) return false
    if (filterTab === 'acked' && !c.extra_data?.acknowledged_at) return false
    const q = search.trim()
    if (q) {
      const haystack = `${c.reporter_name ?? ''} ${c.location_name ?? ''} ${c.village ?? ''}`
      if (!haystack.includes(q)) return false
    }
    return true
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const pageItems = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  return (
    <div className="rounded-2xl border-2 border-lime-200 bg-lime-50/60 p-4 space-y-3">
      <h2 className="text-sm font-bold text-lime-800 flex items-center gap-2">
        <Wind size={16} /> เฉพาะกิจ: กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)
      </h2>
      <p className="text-xs text-lime-700/80 -mt-1">
        ส่งตรงถึงท่านโดยไม่ผ่านแอดมิน — กด "รับทราบ" เพื่อยืนยันว่าได้รับเรื่องแล้ว
      </p>

      {/* แท็บสถานะ + ค้นหา */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {TABS.map((t) => {
            const count = t.key === 'pending' ? pendingCount : t.key === 'acked' ? ackedCount : complaints.length
            const active = filterTab === t.key
            return (
              <button key={t.key} type="button" onClick={() => { setFilterTab(t.key); setPage(1) }}
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
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="ค้นหาชื่อผู้แจ้ง/สถานที่"
            className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-lime-200 bg-white text-xs text-gray-700 focus:outline-none focus:border-lime-400" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-lime-700/70 text-center py-6">ไม่พบรายการ</p>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="md:hidden space-y-2">
            {pageItems.map((c) => (
              <OdorRowCard key={c.id} complaint={c} isOpen={expandedId === c.id}
                onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                onAcknowledge={() => acknowledge(c)} acking={acking === c.id} />
            ))}
          </div>

          {/* Desktop: table แบบเดียวกับตารางคำร้องของแอดมิน สแกนดูได้เร็วตอนรายการเยอะ */}
          <div className="hidden md:block border border-lime-200 rounded-xl overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-lime-50 border-b border-lime-200">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-lime-700 w-12">ที่</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-lime-700">สถานที่</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-lime-700 w-32">วันที่แจ้ง</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-lime-700 w-24">ความรุนแรง</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-lime-700 w-36">สถานะ</th>
                  <th className="px-4 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-lime-100">
                {pageItems.map((c, i) => {
                  const isOpen = expandedId === c.id
                  const location = c.location_name || c.village || 'ไม่ระบุสถานที่'
                  return (
                    <Fragment key={c.id}>
                      <tr onClick={() => setExpandedId(isOpen ? null : c.id)}
                        className="cursor-pointer hover:bg-lime-50/60 transition-colors">
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{(page - 1) * PER_PAGE + i + 1}</td>
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-gray-800 flex items-center gap-1.5 flex-wrap">
                            {location}
                            {c.latitude && (
                              <span className="text-orange-500 shrink-0" title="มีพิกัด GPS"><MapPin size={12} /></span>
                            )}
                            {c.attachments && c.attachments.length > 0 && (
                              <span className="text-blue-500 shrink-0" title="มีภาพประกอบ"><Camera size={12} /></span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">
                          {new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
                        </td>
                        <td className="px-4 py-2.5 text-center text-gray-600">{c.extra_data?.odor_intensity ?? '-'} / 5</td>
                        <td className="px-4 py-2.5 text-center"><OdorAckBadge complaint={c} /></td>
                        <td className="px-4 py-2.5 text-center text-lime-400">
                          {isOpen ? <ChevronUp size={15} className="inline" /> : <ChevronDown size={15} className="inline" />}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} className="px-4 pb-4 pt-1 bg-lime-50/40">
                            <div className="space-y-3">
                              <OdorFieldsDisplay complaint={c} />
                              {!c.extra_data?.acknowledged_at && (
                                <button type="button" onClick={() => acknowledge(c)} disabled={acking === c.id}
                                  className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-lime-600 hover:bg-lime-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                  {acking === c.id ? <Loader2 size={16} className="animate-spin" /> : null}
                                  รับทราบ
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded-lg border border-lime-200 text-lime-700 hover:bg-lime-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <ChevronLeft size={15} />
              </button>
              <span className="text-xs font-semibold text-lime-700">หน้า {page} / {totalPages}</span>
              <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="p-1.5 rounded-lg border border-lime-200 text-lime-700 hover:bg-lime-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function OdorRowCard({ complaint: c, isOpen, onToggle, onAcknowledge, acking }) {
  const location = c.location_name || c.village || 'ไม่ระบุสถานที่'
  return (
    <div className="bg-white rounded-xl border border-lime-100 overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate flex items-center gap-1.5">
            {location}
            {c.latitude && (
              <span className="text-orange-500 shrink-0" title="มีพิกัด GPS"><MapPin size={12} /></span>
            )}
            {c.attachments && c.attachments.length > 0 && (
              <span className="text-blue-500 shrink-0" title="มีภาพประกอบ"><Camera size={12} /></span>
            )}
          </p>
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
            <button type="button" onClick={onAcknowledge} disabled={acking}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-lime-600 hover:bg-lime-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {acking ? <Loader2 size={16} className="animate-spin" /> : null}
              รับทราบ
            </button>
          )}
        </div>
      )}
    </div>
  )
}

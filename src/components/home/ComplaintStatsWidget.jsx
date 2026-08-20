import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTenant } from '../../contexts/TenantContext'
import { supabase } from '../../lib/supabase'

// วงแหวนความคืบหน้าแบบเบาๆ ไม่พึ่ง library ภายนอก (conic-gradient ธรรมดา) — ต้นทุน $0
// ใช้ RPC complaint_stats() ที่มีอยู่แล้ว (public, ไม่มี PII, ใช้ในหน้า ComplaintStats.jsx ของแอดมินด้วย)
export default function ComplaintStatsWidget() {
  const { tenant } = useTenant()
  const [stats, setStats] = useState(null)

  useEffect(() => {
    if (!tenant?.id) return
    supabase.rpc('complaint_stats', { _municipality_id: tenant.id })
      .then(({ data }) => setStats(data ?? null))
      .catch(() => {})
  }, [tenant?.id])

  if (!stats || !stats.total) return null

  const resolvedPct = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0

  const BOXES = [
    { label: 'รอรับเรื่อง',     value: stats.open,        color: '#2563eb' },
    { label: 'กำลังดำเนินการ',  value: stats.in_progress, color: '#ea580c' },
    { label: 'เสร็จสิ้น',       value: stats.resolved,    color: '#65a30d' },
  ]

  return (
    <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-4 sm:p-5">
      <p className="text-base font-bold text-gray-800 mb-4">สถิติเรื่องร้องเรียนร้องทุกข์</p>
      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
        <div className="relative w-32 h-32 sm:w-36 sm:h-36 shrink-0 rounded-full flex items-center justify-center"
          style={{ background: `conic-gradient(var(--color-primary) ${resolvedPct}%, #e5e7eb 0)` }}>
          <div className="absolute inset-2 rounded-full bg-white flex flex-col items-center justify-center text-center px-2">
            <span className="text-[11px] text-gray-400 leading-tight">จำนวนเรื่อง<br />ร้องเรียน</span>
            <span className="text-3xl font-black text-gray-800 leading-none mt-1">{stats.total}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2.5 flex-1 w-full">
          {BOXES.map(b => (
            <div key={b.label} className="rounded-xl px-2 py-3 text-center text-white" style={{ backgroundColor: b.color }}>
              <p className="text-2xl font-black leading-tight">{b.value}</p>
              <p className="text-[10px] font-semibold leading-tight opacity-90 mt-0.5">{b.label}</p>
            </div>
          ))}
        </div>
      </div>
      <Link to="/reports" className="mt-4 flex items-center justify-center gap-2 text-sm font-bold py-3 rounded-xl text-white transition-opacity hover:opacity-90"
        style={{ backgroundColor: 'var(--color-primary)' }}>
        ทั้งหมด {stats.total} เรื่อง — ดูรายละเอียด
      </Link>
    </div>
  )
}

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
    { label: 'รอรับเรื่อง',     value: stats.open,        gradient: 'linear-gradient(135deg, #1e4f8c 0%, #3d9bc4 100%)' },
    { label: 'กำลังดำเนินการ',  value: stats.in_progress, gradient: 'linear-gradient(135deg, #d9481f 0%, #f0913f 100%)' },
    { label: 'เสร็จสิ้น',       value: stats.resolved,    gradient: 'linear-gradient(135deg, #4c8c1f 0%, #8dc63f 100%)' },
  ]

  return (
    <Link to="/reports/complaints" aria-label="ดูสถิติเรื่องร้องเรียนร้องทุกข์"
      className="block rounded-2xl bg-white shadow-sm border border-gray-100 p-4 sm:p-5 hover:shadow-md active:scale-[0.99] transition-all">
      <p className="text-base font-bold text-gray-800 mb-4">สถิติเรื่องร้องเรียนร้องทุกข์</p>
      {/* ring ซ้าย เป็นคอลัมน์แยกจากกล่อง 3 สี+แถบรวม (ขวา) — ให้แถบ "ทั้งหมด" กว้างเท่าคอลัมน์กล่องเท่านั้น
          ไม่ยื่นไปทับใต้ ring แบบภาพอ้างอิงเป๊ะๆ — ตั้งใจไม่ใช้ flex-col บนมือถือ (เดิมทำให้ ring ตกลงมา
          กองอยู่บนสุดแทนที่จะอยู่ข้างกล่อง ไม่ตรงภาพอ้างอิงที่วางเคียงกันเสมอไม่ว่าจอเล็กแค่ไหน) */}
      <div className="flex items-start gap-3 sm:gap-6">
        <div className="shrink-0 flex flex-col items-center gap-1.5">
          <div className="relative w-24 h-24 sm:w-36 sm:h-36 rounded-full flex items-center justify-center"
            style={{ background: `conic-gradient(#1c5c96 ${resolvedPct}%, #6fb3d9 0)` }}>
            <div className="absolute inset-2 sm:inset-2.5 rounded-full bg-white flex flex-col items-center justify-center text-center px-1">
              <span className="text-[9px] sm:text-[11px] text-gray-400 leading-tight">จำนวนเรื่อง<br />ร้องเรียน</span>
              <span className="text-xl sm:text-3xl font-black text-gray-800 leading-none mt-1">{stats.total}</span>
            </div>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5">
            {BOXES.map(b => (
              <div key={b.label} className="rounded-xl px-1 sm:px-2 py-2 sm:py-3 text-center text-white shadow-sm" style={{ background: b.gradient }}>
                <p className="text-lg sm:text-2xl font-black leading-tight">{b.value}</p>
                <p className="text-[9px] sm:text-[10px] font-semibold leading-tight opacity-90 mt-0.5">{b.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-center text-xs sm:text-sm font-bold py-2.5 sm:py-3 rounded-xl text-white"
            style={{ background: 'linear-gradient(135deg, #1e4f8c 0%, #2f9bb8 100%)' }}>
            ทั้งหมด {stats.total} เรื่อง
          </div>
        </div>
      </div>
    </Link>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Home, Database, Layers, CalendarClock } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { supabase } from '../lib/supabase'
import DataCenterMapView from '../components/datacenter/DataCenterMapView'
import OpenDataDownload from '../components/datacenter/OpenDataDownload'
import { formatThaiDate } from '../lib/dataCenterHealth'

// สถิติรวมสาธารณะ — นับที่ฐานข้อมูลด้วย RPC data_center_public_stats (เฉพาะรายการ active ตามนโยบาย RLS
// "dce public read active") เดิมดึง group_name/latitude/route_points "ทุกแถว" มานับในเบราว์เซอร์ ซึ่งชนเพดาน
// 1,000 แถวของ PostgREST แล้วตัวเลขต่ำกว่าจริงเงียบๆ และลากข้อมูลเส้นทาง (jsonb หนัก) มาทุกครั้งที่เปิดหน้า
// ถ้าฟังก์ชันยังไม่พร้อม (error) จะไม่แสดงชิปสถิติเลย ไม่แสดงตัวเลขปลอม
function useDataCenterPublicStats(tenantId) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    if (!tenantId) return
    let alive = true
    supabase.rpc('data_center_public_stats', { _municipality_id: tenantId })
      .then(({ data, error }) => {
        if (!alive || error || !data) return
        setStats({ total: data.total ?? 0, groups: data.groups ?? 0, latestUpdate: data.latest_update ?? null })
      })
    return () => { alive = false }
  }, [tenantId])

  return stats
}

function StatChip({ Icon, value, label }) {
  return (
    <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
      <Icon size={15} className="text-white/80 shrink-0" />
      <div className="leading-tight">
        <p className="text-sm font-black text-white">{value}</p>
        <p className="text-[10px] text-white/60">{label}</p>
      </div>
    </div>
  )
}

export default function DataCenterPublicMap() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const stats = useDataCenterPublicStats(tenant?.id)

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#eef2f7' }}>
      <header className="text-white px-4 py-3 shrink-0"
        style={{ background: 'linear-gradient(135deg, #1e88c7 0%, #2196d8 100%)' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/data-center')} className="p-1.5 -ml-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm leading-tight">แผนที่ข้อมูล{tenant?.name ? ` — ${tenant.name}` : ''}</p>
            <p className="text-white/70 text-[11px]">สำหรับประชาชน — ดูข้อมูลสถานที่ในเขตเทศบาล</p>
          </div>
          <button onClick={() => navigate('/')} aria-label="กลับหน้าหลัก"
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors border border-white/20 shrink-0">
            <Home size={15} />
          </button>
        </div>
        {stats && (
          <div className="flex items-center gap-2 mt-3">
            <StatChip Icon={Database} value={stats.total} label="ข้อมูลทั้งหมด" />
            <StatChip Icon={Layers} value={stats.groups} label="หมวดหมู่" />
            {stats.latestUpdate && <StatChip Icon={CalendarClock} value={formatThaiDate(stats.latestUpdate)} label="ปรับปรุงล่าสุด" />}
          </div>
        )}
        {/* ข้อมูลเปิด: ชุดเดียวกับที่แสดงบนแผนที่นี้อยู่แล้ว (รายการที่เปิดใช้งาน) ให้นำไปใช้ต่อใน GIS/Excel ได้เอง */}
        {tenant?.id && (
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            <span className="text-[10px] font-bold text-white/70">ข้อมูลเปิด ดาวน์โหลดได้:</span>
            <OpenDataDownload tenant={tenant} variant="hero" />
          </div>
        )}
      </header>

      <DataCenterMapView tenant={tenant} />
    </div>
  )
}

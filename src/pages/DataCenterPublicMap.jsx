import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Home, Database, Layers, MapPin } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { supabase } from '../lib/supabase'
import DataCenterMapView from '../components/datacenter/DataCenterMapView'

// สถิติรวมสาธารณะ — เอาแค่คอลัมน์เบาที่จำเป็นต่อการนับ (group_name/latitude/route_points)
// RLS "dce public read active" (152_data_center_public_read.sql) เปิดให้ anon อ่านแถว status='active'
// ของเทศบาลตัวเองอยู่แล้ว จึงกรอง .eq('status','active') ซ้ำที่ client เพื่อความชัดเจน ไม่ใช่รูรั่วใหม่
function useDataCenterPublicStats(tenantId) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    if (!tenantId) return
    supabase.from('data_center_entries')
      .select('group_name, latitude, route_points')
      .eq('municipality_id', tenantId)
      .eq('status', 'active')
      .then(({ data, error }) => {
        if (error || !data) return
        const groups = new Set(data.map(e => e.group_name))
        const mapped = data.filter(e => e.latitude != null || (e.route_points?.length ?? 0) > 0).length
        setStats({ total: data.length, categories: groups.size, mapped })
      })
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
            <StatChip Icon={Layers} value={stats.categories} label="หมวดหมู่" />
            <StatChip Icon={MapPin} value={stats.mapped} label="มีพิกัด/เส้นทาง" />
          </div>
        )}
      </header>

      <DataCenterMapView tenant={tenant} />
    </div>
  )
}

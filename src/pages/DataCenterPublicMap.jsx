import { useNavigate } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import DataCenterMapView from '../components/datacenter/DataCenterMapView'

export default function DataCenterPublicMap() {
  const navigate = useNavigate()
  const { tenant } = useTenant()

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#eef2f7' }}>
      <header className="text-white px-4 py-3 flex items-center gap-3 shrink-0"
        style={{ background: 'linear-gradient(135deg, #1e88c7 0%, #2196d8 100%)' }}>
        <button onClick={() => navigate('/data-center')} className="p-1.5 -ml-1.5 rounded-lg hover:bg-white/10 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm leading-tight">แผนที่ข้อมูล{tenant?.name ? ` — ${tenant.name}` : ''}</p>
          <p className="text-white/70 text-[11px]">สำหรับประชาชน — ดูข้อมูลสถานที่ในเขตเทศบาล</p>
        </div>
        <button onClick={() => window.close()} aria-label="ปิดหน้าต่าง"
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors border border-white/20 shrink-0">
          <X size={15} />
        </button>
      </header>

      <DataCenterMapView tenant={tenant} />
    </div>
  )
}

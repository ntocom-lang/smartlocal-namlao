import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import MapDashboardAdmin from '../components/admin/MapDashboardAdmin'

export default function MapPage() {
  const navigate = useNavigate()
  const { tenant } = useTenant()

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 bg-white border-b border-gray-100 shrink-0">
        <button onClick={() => navigate(-1)}
                className="p-2 -ml-1 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-bold text-gray-800">แผนที่</h1>
      </div>
      <div className="flex-1 overflow-hidden">
        <MapDashboardAdmin
          tenant={tenant}
          currentUserRole="citizen"
          onNavigate={() => {}}
          onEditComplaint={null}
          onEditProject={null}
        />
      </div>
    </div>
  )
}

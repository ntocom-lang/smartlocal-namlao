import { useTenant } from '../contexts/TenantContext'
import MapDashboardAdmin from '../components/admin/MapDashboardAdmin'

export default function MapPage() {
  const { tenant } = useTenant()

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        <MapDashboardAdmin
          tenant={tenant}
          currentUserRole="citizen"
          onNavigate={() => {}}
          onEditComplaint={null}
          onEditProject={null}
          fitViewport
        />
      </div>
    </div>
  )
}

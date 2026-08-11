import DataCenterMapView from './DataCenterMapView'

export default function DataCenterMap({ tenant, currentUserRole, initialGroup, initialCategory, focusLat, focusLng }) {
  return <DataCenterMapView tenant={tenant} allowStatusFilter currentUserRole={currentUserRole}
    initialGroup={initialGroup} initialCategory={initialCategory} focusLat={focusLat} focusLng={focusLng} />
}

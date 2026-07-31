import DataCenterMapView from '../datacenter/DataCenterMapView'

/**
 * Compatibility facade for the former standalone admin map.
 * All map surfaces now share the Native Google Maps implementation in DataCenterMapView.
 */
export default function MapDashboardAdmin({ tenant, currentUserRole }) {
  return (
    <DataCenterMapView
      tenant={tenant}
      currentUserRole={currentUserRole}
      allowStatusFilter={currentUserRole !== 'citizen'}
    />
  )
}

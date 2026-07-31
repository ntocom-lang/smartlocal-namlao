import DataCenterMapView from './DataCenterMapView'

export default function DataCenterMap({ tenant, currentUserRole }) {
  return <DataCenterMapView tenant={tenant} allowStatusFilter currentUserRole={currentUserRole} />
}

import DataCenterMapView from './DataCenterMapView'

export default function DataCenterMap({ tenant }) {
  return <DataCenterMapView tenant={tenant} allowStatusFilter />
}

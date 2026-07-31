import { useTenant } from '../contexts/TenantContext'
import DataCenterMapView from '../components/datacenter/DataCenterMapView'

// รวมกับศูนย์ข้อมูลดิจิทัลแล้ว — ใช้แผนที่เดียวกัน (DataCenterMapView) ทั้งเมนู "แผนที่" เดิม
// และ "ศูนย์ข้อมูลดิจิทัล" กันมีแผนที่ 2 ชุดที่ทั้งข้อมูลและ UI ไม่ตรงกัน
export default function MapPage() {
  const { tenant } = useTenant()

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        <DataCenterMapView tenant={tenant} allowStatusFilter={false} />
      </div>
    </div>
  )
}

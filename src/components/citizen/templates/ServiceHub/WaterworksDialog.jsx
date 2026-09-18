import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Droplets, Gauge, CircleSlash, Wrench, ChevronRight, X } from 'lucide-react'
import { useTenant } from '../../../../contexts/TenantContext'
import { removedDocumentTypes } from '../../../../lib/documentTypes'

const SERVICES = [
  { type: 'water_supply_request', label: 'ขออนุญาตใช้น้ำประปา', description: 'ติดตั้งมาตรและเปิดใช้น้ำประปา', icon: Droplets },
  { type: 'water_meter_change', label: 'ขออนุญาตเปลี่ยนมาตรน้ำประปา', description: 'ยื่นคำขอเปลี่ยนมาตรวัดน้ำ', icon: Gauge },
  { type: 'water_supply_cancel', label: 'ขอยกเลิกใช้น้ำประปา', description: 'ยื่นคำขอยกเลิกการใช้น้ำ', icon: CircleSlash },
  { type: 'water_repair', label: 'ซ่อมน้ำประปา', description: 'แจ้งท่อแตก น้ำรั่ว หรือประปาชำรุด', icon: Wrench, repair: true },
]

// หน้ารวมเฉพาะ ServiceHub: เชื่อมฟอร์มเดิม ไม่สร้างประเภทคำขอหรือขั้นตอนเจ้าหน้าที่เพิ่ม
export default function WaterworksDialog({ onClose }) {
  const dialogRef = useRef(null)
  const { tenant, isModuleEnabled } = useTenant()
  const removed = removedDocumentTypes(tenant)

  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])

  return (
    <dialog ref={dialogRef} aria-labelledby="waterworks-title" aria-describedby="waterworks-description"
      onCancel={onClose} onClose={() => { if (!dialogRef.current?.open) onClose() }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-24px)] max-w-lg overflow-y-auto rounded-3xl border-0 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm">
      <div className="flex items-start gap-3 bg-gradient-to-br from-sky-700 to-cyan-600 p-5 text-white">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20"><Droplets size={26} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="waterworks-title" className="text-xl font-bold">บริการประปา</h2>
          <p id="waterworks-description" className="mt-1 text-sm text-sky-50">เลือกเรื่องที่ต้องการรับบริการ</p>
        </div>
        <button type="button" onClick={onClose} aria-label="ปิดบริการประปา"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <X size={22} aria-hidden="true" />
        </button>
      </div>
      <div className="space-y-2.5 p-4">
        {SERVICES.map(({ type, label, description, icon: Icon, repair }) => {
          const enabled = (!isModuleEnabled || isModuleEnabled(repair ? 'complaints' : 'inbox'))
            && (repair || !removed.includes(type))
          const content = <>
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${enabled ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-400'}`}><Icon size={23} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold leading-relaxed">{label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{enabled ? description : 'ยังไม่เปิดรับบริการนี้'}</span>
            </span>
            {enabled && <ChevronRight size={18} className="shrink-0 text-sky-600" aria-hidden="true" />}
          </>
          const className = 'flex min-h-20 items-center gap-3 rounded-2xl border p-3 '
          return enabled ? (
            <Link key={type} to={repair ? '/request?category=water_repair' : `/doc-request?type=${type}`}
              onClick={onClose} className={`${className}border-sky-100 bg-sky-50/50 transition-colors hover:border-sky-300 hover:bg-sky-100/60 focus-visible:outline-2 focus-visible:outline-sky-600`}>
              {content}
            </Link>
          ) : <div key={type} aria-disabled="true" className={`${className}border-gray-100 text-gray-400`}>{content}</div>
        })}
      </div>
    </dialog>
  )
}

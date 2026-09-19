import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ambulance } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { removedDocumentTypes } from '../../lib/documentTypes'
import { PATIENT_TRANSPORT_TYPE, PATIENT_TRANSPORT_MODULE_KEY } from '../../lib/patientTransport'
import { orgAbbr } from '../../lib/patientBooking'

export default function BookingHighlight() {
  const { tenant, isModuleEnabled } = useTenant()
  const [activeTenant, setActiveTenant] = useState(null)
  const enabled = isModuleEnabled(PATIENT_TRANSPORT_MODULE_KEY) && !removedDocumentTypes(tenant).includes(PATIENT_TRANSPORT_TYPE)
  useEffect(() => {
    if (!tenant?.id || !enabled) return undefined
    let alive = true
    supabase.rpc('patient_booking_info', { p_muni: tenant.id }).then(({ data, error }) => {
      if (alive) setActiveTenant(!error && data?.enabled ? tenant.id : null)
    }).catch(() => { if (alive) setActiveTenant(null) })
    return () => { alive = false }
  }, [tenant?.id, enabled])
  if (!enabled || !tenant?.id || activeTenant !== tenant.id) return null
  return <section className="my-4 rounded-2xl bg-sky-800 p-5 text-white shadow-sm" aria-label="บริการเด่น รถรับส่งผู้ป่วย">
    <div className="flex items-start gap-3"><Ambulance size={30} className="shrink-0" /><div><p className="text-sm text-sky-100">รถรับส่งผู้ป่วย · บริการสำหรับคนในพื้นที่</p><h2 className="mt-1 text-xl font-bold">ถึงวันนัด ให้เราช่วยพาไป</h2><p className="mt-2 text-sm">ญาติจองแทนได้ เจ้าหน้าที่ {orgAbbr()} ช่วยจัดคิวและแจ้งเวลารับ</p></div></div>
    <div className="mt-4 flex flex-wrap gap-3"><Link to="/patient-transport" className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 py-2 font-bold text-sky-900">จองรถ / ติดตามคิว</Link><a href="tel:1669" className="inline-flex min-h-11 items-center rounded-xl border border-sky-200 px-4 py-2 text-sm">เหตุฉุกเฉิน โทร 1669</a></div>
  </section>
}

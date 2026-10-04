import { useId, useState } from 'react'
import BookingSettings from './BookingSettings'
import CommunitySettings from './CommunitySettings'

const services = [
  { id: 'patient', label: 'รถรับส่งผู้ป่วย' },
  { id: 'community', label: 'รถรับ–ส่งชุมชน' },
]

export default function TransportSettings({ workspace, busy, onSavePatient, onSaveCommunity }) {
  const [service, setService] = useState('patient')
  const id = useId()
  function moveTab(event, index) {
    const next = { ArrowRight: (index + 1) % services.length, ArrowLeft: (index + services.length - 1) % services.length,
      Home: 0, End: services.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    setService(services[next].id)
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus()
  }
  return <>
    <div role="tablist" aria-label="ตั้งค่าบริการรถรับส่ง" className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5">
      {services.map(({ id: key, label }, index) => <button key={key} type="button" role="tab"
        id={`${id}-${key}-tab`} aria-controls={`${id}-${key}-panel`} aria-selected={service === key}
        tabIndex={service === key ? 0 : -1} disabled={busy} onClick={() => setService(key)} onKeyDown={event => moveTab(event, index)}
        className={`min-h-11 min-w-0 rounded-xl px-2 py-3 text-sm font-semibold leading-snug text-balance transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${service === key ? 'bg-white text-sky-900 shadow-sm' : 'text-slate-600 hover:bg-white/60'}`}>
        {label}
      </button>)}
    </div>
    {/* Keep both drafts mounted so changing service does not discard unsaved input. */}
    <div role="tabpanel" id={`${id}-patient-panel`} aria-labelledby={`${id}-patient-tab`} hidden={service !== 'patient'}>
      <BookingSettings key={workspace.settings?.revision || 'new'} workspace={workspace} busy={busy} onSave={onSavePatient} />
    </div>
    <div role="tabpanel" id={`${id}-community-panel`} aria-labelledby={`${id}-community-tab`} hidden={service !== 'community'} className="[&>form]:mt-0">
      <CommunitySettings rules={workspace.community_rules} busy={busy} onSave={onSaveCommunity} />
    </div>
  </>
}

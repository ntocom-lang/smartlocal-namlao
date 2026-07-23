import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'

const CATEGORY_COLOR = {
  'ประชาสัมพันธ์': '#10b981', 'ประชุม': '#3b82f6', 'กำหนดการ': '#f97316',
  'อบรม': '#8b5cf6', 'อื่นๆ': '#6b7280',
}

const AUDIENCE_LABEL = {
  public:     'ประชาชน',
  staff:      'เจ้าหน้าที่',
  management: 'ผู้บริหาร',
  council:    'สภาเทศบาล',
}

const AUDIENCE_COLOR = {
  public:     '#10b981',
  staff:      '#3b82f6',
  management: '#8b5cf6',
  council:    '#f59e0b',
}

function eventAttachments(ev) {
  if (ev.attachment_urls?.length > 0) return ev.attachment_urls
  return ev.attachment_url ? [ev.attachment_url] : []
}

function daysUntil(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00')
  const diff = Math.round((d - today) / 86400000)
  if (diff === 0) return 'วันนี้'
  if (diff === 1) return 'พรุ่งนี้'
  if (diff < 0) return `${Math.abs(diff)} วันที่แล้ว`
  return `อีก ${diff} วัน`
}

export default function EventDetailModal({ ev, onClose, canEdit }) {
  const navigate = useNavigate()
  const color = CATEGORY_COLOR[ev.category] ?? '#6b7280'
  const aud = AUDIENCE_LABEL[ev.audience] ? { label: AUDIENCE_LABEL[ev.audience], color: AUDIENCE_COLOR[ev.audience] } : null
  const days = ev.event_date ? daysUntil(ev.event_date) : null
  const daysColor = days === 'วันนี้' ? '#ef4444' : days?.includes('ที่แล้ว') ? '#9ca3af' : days === 'พรุ่งนี้' ? '#f97316' : '#3b82f6'
  const d = ev.event_date ? new Date(ev.event_date + 'T00:00:00') : null
  const dEnd = ev.end_date && ev.end_date !== ev.event_date ? new Date(ev.end_date + 'T00:00:00') : null
  const fmtDate = (dt) => dt.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const attachments = eventAttachments(ev)

  function goEdit() {
    onClose()
    navigate('/staff', { state: { module: 'events', editEventId: ev.id } })
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* Header bar */}
        <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
        <div className="px-6 pt-5 pb-4 max-h-[85vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: color }}>{ev.category}</span>
                {aud && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border"
                    style={{ color: aud.color, borderColor: aud.color, backgroundColor: aud.color + '18' }}>
                    {ev.audience !== 'public' ? '🔒 ' : '👥 '}{aud.label}
                  </span>
                )}
                {days && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: daysColor }}>
                    {days}
                  </span>
                )}
              </div>
              <h3 className="text-base font-bold text-gray-900 leading-snug">{ev.title}</h3>
            </div>
            <button onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-gray-100 shrink-0 mt-0.5">
              <X size={17} className="text-gray-400" />
            </button>
          </div>

          <div className="mt-4 space-y-2.5">
            {/* Date */}
            <div className="flex items-start gap-2.5 text-sm text-gray-700">
              <span className="text-base shrink-0">📅</span>
              <div>
                <p>{d ? fmtDate(d) : 'ยังไม่ระบุวันที่'}</p>
                {dEnd && <p className="text-gray-500 text-xs mt-0.5">ถึง {fmtDate(dEnd)}</p>}
              </div>
            </div>
            {/* Time */}
            {!ev.is_all_day && ev.event_time && (
              <div className="flex items-center gap-2.5 text-sm text-gray-700">
                <span className="text-base shrink-0">⏰</span>
                <span>{ev.event_time.slice(0, 5)}{ev.end_time ? ` – ${ev.end_time.slice(0, 5)}` : ''} น.</span>
              </div>
            )}
            {/* Location */}
            {ev.location && (
              <div className="flex items-start gap-2.5 text-sm text-gray-700">
                <span className="text-base shrink-0">📍</span>
                <span>{ev.location}</span>
              </div>
            )}
            {/* Description */}
            {ev.description && (
              <div className="flex items-start gap-2.5 text-sm text-gray-700">
                <span className="text-base shrink-0">📝</span>
                <p className="leading-relaxed whitespace-pre-wrap">{ev.description}</p>
              </div>
            )}
            {/* Attachment */}
            {attachments.length > 0 && (
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-base shrink-0">📎</span>
                {attachments.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline font-medium">
                    ดูไฟล์แนบ{attachments.length > 1 ? ` ${i + 1}` : ''}
                  </a>
                ))}
              </div>
            )}
            {/* Creator */}
            {ev.creator?.full_name && (
              <div className="flex items-center gap-2.5 text-sm text-gray-500">
                <span className="text-base shrink-0">✍️</span>
                <span>{ev.creator.full_name}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          {canEdit && (
            <div className="flex gap-2 mt-5 pt-4 border-t border-gray-100">
              <button onClick={goEdit}
                className="flex-1 py-2.5 rounded-xl border border-blue-300 text-blue-600 text-sm font-bold hover:bg-blue-50 transition-colors">
                แก้ไข
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

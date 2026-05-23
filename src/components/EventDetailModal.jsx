import { X, Clock, CalendarDays, MapPin } from 'lucide-react'

const CATEGORY_COLOR = {
  'ประชุม': '#3b82f6', 'งานบุญ': '#f59e0b', 'ตลาดนัด': '#10b981',
  'กีฬา': '#ef4444', 'ฝึกอบรม': '#8b5cf6', 'อื่นๆ': '#6b7280',
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

export default function EventDetailModal({ ev, onClose }) {
  const color = CATEGORY_COLOR[ev.category] ?? '#6b7280'
  const d = new Date(ev.event_date + 'T00:00:00')
  const dateStr = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
  const days = daysUntil(ev.event_date)
  const isToday = days === 'วันนี้'
  const isPast = days.includes('ที่แล้ว')
  const activeColor = isPast ? '#9ca3af' : isToday ? '#ef4444' : color

  let dateRange = dateStr
  if (ev.end_date && ev.end_date !== ev.event_date) {
    const d2 = new Date(ev.end_date + 'T00:00:00')
    dateRange += ' – ' + d2.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-t-3xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '92vh', minHeight: '60vh' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Color banner */}
        <div className="px-6 pt-4 pb-6" style={{ background: `linear-gradient(135deg, ${activeColor}22, ${activeColor}08)` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-4">
              <div
                className="shrink-0 w-16 h-16 rounded-2xl flex flex-col items-center justify-center text-white shadow-md"
                style={{ backgroundColor: activeColor }}
              >
                <span className="text-xs font-bold leading-none">
                  {d.toLocaleDateString('th-TH', { month: 'short' })}
                </span>
                <span className="text-3xl font-black leading-tight">{d.getDate()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold text-white mb-2"
                  style={{ backgroundColor: activeColor }}
                >
                  {ev.category}
                </span>
                <p className="text-lg font-bold text-gray-900 leading-snug">{ev.title}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 p-2 rounded-xl hover:bg-black/10 text-gray-500 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Days badge */}
          <div className="mt-4">
            <span
              className="inline-flex px-4 py-1.5 rounded-full text-sm font-bold"
              style={{ backgroundColor: activeColor, color: 'white' }}
            >
              {days}
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {/* Date */}
          <div className="flex items-start gap-4">
            <div
              className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: `${activeColor}18` }}
            >
              <CalendarDays size={18} style={{ color: activeColor }} />
            </div>
            <div className="pt-1">
              <p className="text-xs font-semibold text-gray-400 mb-0.5">วันที่</p>
              <p className="text-sm font-semibold text-gray-800">{dateRange}</p>
              {!ev.is_all_day && ev.event_time && (
                <p className="text-sm text-gray-600 flex items-center gap-1.5 mt-0.5">
                  <Clock size={13} /> {ev.event_time.slice(0, 5)} น.
                </p>
              )}
            </div>
          </div>

          {/* Location */}
          {ev.location && (
            <div className="flex items-start gap-4">
              <div
                className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${activeColor}18` }}
              >
                <MapPin size={18} style={{ color: activeColor }} />
              </div>
              <div className="pt-1">
                <p className="text-xs font-semibold text-gray-400 mb-0.5">สถานที่</p>
                <p className="text-sm font-semibold text-gray-800">{ev.location}</p>
              </div>
            </div>
          )}

          {/* Description */}
          {ev.description && (
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 mb-2">รายละเอียด</p>
              <p className="text-sm text-gray-700 leading-relaxed">{ev.description}</p>
            </div>
          )}
        </div>

        {/* Safe area spacer */}
        <div style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)' }} />
      </div>
    </div>
  )
}

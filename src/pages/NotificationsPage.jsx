import { useNavigate } from 'react-router-dom'
import {
  Bell, ChevronLeft, CheckCircle2, XCircle, Loader2,
  Clock, RefreshCw, ChevronRight,
} from 'lucide-react'
import { useNotifications } from '../contexts/NotificationsContext'

// ─── constants ────────────────────────────────────────────────────────────────

const STATUS_INFO = {
  received:    { label: 'รับเรื่องแล้ว',   bg: '#dbeafe', color: '#1e40af', Icon: Clock },
  in_progress: { label: 'กำลังดำเนินการ', bg: '#ede9fe', color: '#5b21b6', Icon: RefreshCw },
  completed:   { label: 'เสร็จสิ้น',      bg: '#d1fae5', color: '#065f46', Icon: CheckCircle2 },
  rejected:    { label: 'ปฏิเสธ',         bg: '#fee2e2', color: '#991b1b', Icon: XCircle },
}

const STATUS_MSG = {
  received:    'เจ้าหน้าที่รับเรื่องของคุณแล้ว',
  in_progress: 'เจ้าหน้าที่อยู่ระหว่างดำเนินการ',
  completed:   'ดำเนินการเสร็จสิ้นแล้ว 🎉',
  rejected:    'ขออภัย คำร้องของคุณถูกปฏิเสธ',
}

const CATEGORY_LABEL = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าส่องสว่าง',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ตัดต้นไม้',
  noise: 'แจ้งเหตุรำคาญ', drain: 'ท่อระบายน้ำ',
  waste_water: 'น้ำเสีย', suction: 'ดูดสิ่งปฏิกูล',
  manhole: 'ฝาท่อระบายน้ำ', vendor: 'ขายของบนทางสาธารณะ',
  building: 'ตรวจสอบอาคาร', mosquito: 'พ่นยุง',
  pollution: 'กลิ่นควัน/มลพิษ', corruption: 'แจ้งการทุจริต',
  tax: 'ภาษีและค่าธรรมเนียม', canal: 'ลอกคลอง',
  animals: 'สุนัขและแมวจรจัด', other: 'อื่นๆ',
}

const CATEGORY_EMOJI = {
  road: '🛣️', light: '💡', trash: '🗑️', water: '🚰',
  flood: '🌊', tree: '🌳', noise: '📢', drain: '🕳️',
  waste_water: '💧', suction: '🚛', manhole: '⚙️', vendor: '🏪',
  building: '🏗️', mosquito: '🦟', pollution: '🌫️', corruption: '⚖️',
  tax: '📋', canal: '🏞️', animals: '🐕', other: '📝',
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'เมื่อสักครู่'
  if (mins < 60) return `${mins} นาทีที่แล้ว`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} ชั่วโมงที่แล้ว`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days} วันที่แล้ว`
  return new Date(dateStr).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const navigate = useNavigate()
  const { items, loading, markRead, markAllRead } = useNotifications()

  const hasUnread = items.some(n => n._unread)
  const unreadItems = items.filter(n => n._unread)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Top header ── */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
            <ChevronLeft size={20} />
          </button>

          <div className="flex-1">
            <h1 className="font-bold text-gray-800 text-base leading-tight">การแจ้งเตือน</h1>
            {!loading && items.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-0.5">
                {hasUnread ? `${unreadItems.length} รายการยังไม่อ่าน` : 'อ่านทั้งหมดแล้ว'}
              </p>
            )}
          </div>

          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
               style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 70%, #7c3aed) 100%)' }}>
            <Bell size={16} className="text-white" />
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 max-w-2xl mx-auto w-full">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 size={28} className="animate-spin text-gray-300" />
            <p className="text-sm text-gray-400">กำลังโหลด...</p>
          </div>

        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400 px-6">
            <div className="w-20 h-20 rounded-3xl bg-gray-100 flex items-center justify-center mb-5">
              <Bell size={36} className="text-gray-300" />
            </div>
            <p className="font-bold text-gray-500 text-base">ยังไม่มีการแจ้งเตือน</p>
            <p className="text-sm text-gray-400 mt-2 text-center leading-relaxed">
              เมื่อเจ้าหน้าที่อัปเดตสถานะคำร้อง<br />จะแสดงที่นี่โดยอัตโนมัติ
            </p>
          </div>

        ) : (
          <div className="bg-white mt-3 rounded-2xl mx-3 overflow-hidden shadow-sm">
            <div className="divide-y divide-gray-50">
              {items.map((n) => {
                const s = STATUS_INFO[n.status]
                if (!s) return null
                const Icon = s.Icon
                const catLabel = CATEGORY_LABEL[n.category] ?? n.category
                const catEmoji = CATEGORY_EMOJI[n.category] ?? '📄'
                const cno = n.complaint_number
                  ? (() => {
                      const d = new Date(n.created_at)
                      const yy = String(d.getFullYear() + 543).slice(-2)
                      const mm = String(d.getMonth() + 1).padStart(2, '0')
                      return `${yy}${mm}${String(n.complaint_number).padStart(3, '0')}`
                    })()
                  : null

                return (
                  <button
                    key={n.id}
                    onClick={() => { markRead(n.id); navigate(`/my-complaints?id=${n.id}`) }}
                    className={`w-full flex items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 ${
                      n._unread ? 'bg-blue-50/40' : ''
                    }`}
                  >
                    {/* Category icon */}
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 mt-0.5 text-2xl"
                         style={{ backgroundColor: s.bg }}>
                      {catEmoji}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-bold text-gray-800 leading-tight">{catLabel}</p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {n._unread && (
                            <span className="w-2 h-2 rounded-full shrink-0 mt-1 bg-red-500" />
                          )}
                          <ChevronRight size={14} className="text-gray-300 mt-0.5" />
                        </div>
                      </div>

                      {cno && (
                        <p className="text-[11px] text-gray-400 font-mono mt-0.5">{cno}</p>
                      )}

                      <p className="text-xs text-gray-500 mt-1 leading-snug">
                        {STATUS_MSG[n.status] ?? s.label}
                      </p>

                      <div className="flex items-center gap-2 mt-2">
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: s.bg, color: s.color }}>
                          <Icon size={10} />
                          {s.label}
                        </span>
                        <span className="text-[11px] text-gray-400">{timeAgo(n.updated_at)}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer CTA */}
        {!loading && items.length > 0 && (
          <div className="px-3 py-4 pb-28">
            <button
              onClick={() => navigate('/my-complaints')}
              className="w-full py-3 rounded-2xl text-sm font-semibold transition-colors"
              style={{
                color: 'var(--color-primary)',
                backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
              }}>
              ดูคำร้องทั้งหมด
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

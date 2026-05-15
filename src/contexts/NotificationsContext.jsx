import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, X, CheckCircle2, XCircle, Loader2,
  ChevronRight, Clock, RefreshCw,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from './TenantContext'

// ─── constants ────────────────────────────────────────────────────────────────

const SEEN_KEY = 'smartlocal_notif_read_ids'

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

// ─── Notification Panel UI ────────────────────────────────────────────────────

function NotificationPanel({ items, loading, onClose, onMarkAll, onItemTap }) {
  const hasUnread = items.some(n => n._unread)

  return (
    <div className="fixed inset-0 z-70 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[82dvh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0"
             style={{ borderBottom: '1px solid #f3f4f6' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 70%, #7c3aed) 100%)' }}>
              <Bell size={15} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-gray-800 text-sm leading-tight">การแจ้งเตือน</h2>
              {!loading && items.length > 0 && (
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {hasUnread ? `${items.filter(n => n._unread).length} รายการยังไม่อ่าน` : 'อ่านทั้งหมดแล้ว'}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {hasUnread && (
              <button
                onClick={onMarkAll}
                className="text-xs font-semibold px-3 py-1.5 rounded-xl hover:bg-gray-100 transition-colors"
                style={{ color: 'var(--color-primary)' }}>
                อ่านทั้งหมด
              </button>
            )}
            <button onClick={onClose}
              className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 size={24} className="animate-spin text-gray-300" />
              <p className="text-xs text-gray-400">กำลังโหลด...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                <Bell size={28} className="text-gray-300" />
              </div>
              <p className="font-semibold text-gray-500 text-sm">ยังไม่มีการแจ้งเตือน</p>
              <p className="text-xs text-gray-400 mt-1.5 text-center px-8">
                เมื่อเจ้าหน้าที่อัปเดตสถานะคำร้อง<br />จะแสดงที่นี่โดยอัตโนมัติ
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {items.map((n) => {
                const s = STATUS_INFO[n.status]
                if (!s) return null
                const Icon = s.Icon
                const catLabel = CATEGORY_LABEL[n.category] ?? n.category
                const catEmoji = CATEGORY_EMOJI[n.category] ?? '📄'
                return (
                  <button
                    key={n.id}
                    onClick={() => onItemTap(n.id)}
                    className={`w-full flex items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 ${
                      n._unread ? 'bg-blue-50/50' : ''
                    }`}
                  >
                    {/* Icon */}
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 mt-0.5 text-xl"
                         style={{ backgroundColor: s.bg }}>
                      {catEmoji}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-bold text-gray-800 leading-tight">{catLabel}</p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {n._unread && (
                            <span className="w-2 h-2 rounded-full mt-0.5 shrink-0"
                                  style={{ backgroundColor: 'var(--color-primary)' }} />
                          )}
                          <ChevronRight size={14} className="text-gray-300" />
                        </div>
                      </div>

                      {n.complaint_number && (
                        <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                          {(() => { const d = new Date(n.created_at); const yy = String(d.getFullYear()+543).slice(-2); const mm = String(d.getMonth()+1).padStart(2,'0'); return `${yy}${mm}${String(n.complaint_number).padStart(3,'0')}` })()}
                        </p>
                      )}

                      <p className="text-xs text-gray-500 mt-1 leading-snug">
                        {STATUS_MSG[n.status] ?? s.label}
                      </p>

                      <div className="flex items-center gap-2 mt-2">
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: s.bg, color: s.color }}>
                          <Icon size={10} />
                          {s.label}
                        </span>
                        <span className="text-[10px] text-gray-400">{timeAgo(n.updated_at)}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        {!loading && items.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 shrink-0">
            <button
              onClick={() => onItemTap(null)}
              className="w-full py-2.5 rounded-xl text-xs font-semibold transition-colors"
              style={{ color: 'var(--color-primary)', backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}>
              ดูคำร้องทั้งหมด
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Context ──────────────────────────────────────────────────────────────────

const NotificationsCtx = createContext({
  unreadCount: 0,
  items: [],
  loading: false,
  markRead: () => {},
  markAllRead: () => {},
  openPanel: () => {},
})

export function useNotifications() {
  return useContext(NotificationsCtx)
}

export function NotificationsProvider({ children }) {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [session, setSession] = useState(null)
  const [readIds, setReadIds] = useState(
    () => new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'))
  )

  // Track auth session
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) setItems([])
    })
    return () => subscription.unsubscribe()
  }, [])

  const fetchItems = useCallback(async () => {
    if (!session?.user?.id || !tenant?.id) { setItems([]); return }
    setLoading(true)
    const { data } = await supabase
      .from('complaints')
      .select('id, complaint_number, category, status, updated_at, created_at')
      .eq('municipality_id', tenant.id)
      .eq('user_id', session.user.id)
      .neq('status', 'pending')
      .order('updated_at', { ascending: false })
      .limit(50)
    setItems(data ?? [])
    setLoading(false)
  }, [session?.user?.id, tenant?.id])

  // Initial fetch
  useEffect(() => { fetchItems() }, [fetchItems])

  // Realtime subscription for instant updates
  useEffect(() => {
    if (!session?.user?.id || !tenant?.id) return
    const channel = supabase
      .channel('notif-complaints')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'complaints',
        filter: `user_id=eq.${session.user.id}`,
      }, () => fetchItems())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [session?.user?.id, tenant?.id, fetchItems])

  const tagged = items.map(n => ({ ...n, _unread: !readIds.has(n.id) }))
  const unreadCount = tagged.filter(n => n._unread).length

  function markRead(id) {
    setReadIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      localStorage.setItem(SEEN_KEY, JSON.stringify([...next]))
      return next
    })
  }

  function markAllRead() {
    const allIds = items.map(n => n.id)
    const next = new Set(allIds)
    localStorage.setItem(SEEN_KEY, JSON.stringify(allIds))
    setReadIds(next)
  }

  function openPanel() {
    navigate('/notifications')
  }

  function closePanel() {
    setOpen(false)
  }

  function handleItemTap(id) {
    closePanel()
    if (id) { markRead(id); navigate(`/my-complaints?id=${id}`) }
    else navigate('/my-complaints')
  }

  return (
    <NotificationsCtx.Provider value={{ unreadCount, items: tagged, loading, markRead, markAllRead, openPanel }}>
      {children}
      {open && (
        <NotificationPanel
          items={tagged}
          loading={loading}
          onClose={closePanel}
          onMarkAll={markAllRead}
          onItemTap={handleItemTap}
        />
      )}
    </NotificationsCtx.Provider>
  )
}

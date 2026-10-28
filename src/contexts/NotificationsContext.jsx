import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTenant } from './TenantContext'
import { useAuth } from './AuthContext'
import { fetchRoleScopedComplaints } from '../lib/complaintPrivacy'
import { MAX_ALERTS_AT_ONCE, alertText, freshUnreadItems, notificationKey as notifKey } from '../lib/notificationAlerts'
import { deviceCanVibrate, syncAppBadge, vibrateForNotification } from '../lib/notificationPrefs'
import { playNotificationSound } from '../lib/notificationSound'
import { useNotificationDevicePrefs } from '../hooks/useNotificationDevicePrefs'
import NotificationToasts from '../components/notifications/NotificationToasts'

const LEGACY_SEEN_KEY = 'smartlocal_notif_read_ids'
const LEGACY_CLEARED_KEY = 'smartlocal_notif_cleared_at'
const CITIZEN_HIDDEN = new Set(['pending', 'new'])
const STAFF_ROLES = new Set(['superadmin', 'admin', 'officer', 'staff', 'technician', 'viewer', 'council', 'kamnan'])

const NotificationsCtx = createContext({
  unreadCount: 0,
  items: [],
  loading: false,
  audience: 'citizen',
  markRead: () => {},
  markAllRead: () => {},
  openPanel: () => {},
  previewAlert: () => {},
})

export function useNotifications() {
  return useContext(NotificationsCtx)
}

function seenKey(uid) { return `${LEGACY_SEEN_KEY}_${uid}` }
function clearedKey(uid) { return `${LEGACY_CLEARED_KEY}_${uid}` }

function isStaffRole(role) {
  return STAFF_ROLES.has(role)
}

function staffQueueStatuses(role) {
  if (role === 'technician') return new Set(['received', 'in_progress'])
  if (role === 'admin' || role === 'superadmin') return new Set(['new', 'pending', 'done'])
  return new Set(['new', 'pending'])
}

function staffTarget(role) {
  if (role === 'technician') return { href: '/technician', state: null }
  return { href: '/staff', state: { module: 'complaints' } }
}

function isMissingRelation(error) {
  const code = error?.code
  const msg = String(error?.message ?? '')
  return code === '42P01' || code === 'PGRST205' || /notification_reads|notification_cleared|schema cache/i.test(msg)
}

function readLocalKeys(uid) {
  try {
    const raw = localStorage.getItem(seenKey(uid)) ?? localStorage.getItem(LEGACY_SEEN_KEY) ?? '[]'
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

function readLocalCleared(uid) {
  const raw = localStorage.getItem(clearedKey(uid)) ?? localStorage.getItem(LEGACY_CLEARED_KEY) ?? '0'
  const value = parseInt(raw, 10)
  return Number.isFinite(value) ? value : 0
}

function writeLocalState(uid, keys, clearedAt) {
  if (!uid) return
  try {
    localStorage.setItem(seenKey(uid), JSON.stringify([...keys].slice(-200)))
    if (clearedAt != null) localStorage.setItem(clearedKey(uid), String(clearedAt))
  } catch {
    // private mode / quota — ไม่บล็อก UI
  }
}

function mapComplaint(row, audience, role) {
  const target = audience === 'staff' ? staffTarget(role) : { href: `/my-complaints?id=${row.id}`, state: null }
  return {
    id: row.id,
    complaint_number: row.complaint_number,
    category: row.category,
    status: row.status,
    updated_at: row.updated_at,
    created_at: row.created_at,
    _audience: audience,
    _href: target.href,
    _hrefState: target.state,
  }
}

export function NotificationsProvider({ children }) {
  const { tenant } = useTenant()
  const { session, role, profileLoading } = useAuth()
  const navigate = useNavigate()
  const uid = session?.user?.id ?? null
  const tenantId = tenant?.id
  const audience = isStaffRole(role) ? 'staff' : 'citizen'

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [clearedAt, setClearedAt] = useState(0)
  const [readIds, setReadIds] = useState(() => new Set())

  // ── ป๊อปอัป/เสียง/สั่น เมื่อมีรายการใหม่เข้ากระดิ่งระหว่างเปิดระบบอยู่ (ตั้งรายเครื่องในหน้า /profile/notifications) ──
  const [devicePrefs] = useNotificationDevicePrefs(uid)
  const [toasts, setToasts] = useState([])
  const prefsRef = useRef(devicePrefs)
  const readStateRef = useRef({ readIds, clearedAt })
  // รอบดึงก่อนหน้าของบัญชี/หน่วยงาน/มุมมองเดียวกัน — เปลี่ยนบัญชีแล้วรอบแรกต้องไม่เด้งของค้างเดิม
  const alertRoundRef = useRef({ scope: null, previous: null })
  useEffect(() => { prefsRef.current = devicePrefs }, [devicePrefs])
  useEffect(() => { readStateRef.current = { readIds, clearedAt } }, [readIds, clearedAt])

  const dismissToast = useCallback((id) => {
    setToasts((list) => list.filter((toast) => toast.id !== id))
  }, [])

  const showToasts = useCallback((entries) => {
    setToasts((list) => [...entries, ...list.filter((toast) => !entries.some((entry) => entry.id === toast.id))]
      .slice(0, MAX_ALERTS_AT_ONCE))
  }, [])

  const announce = useCallback((fresh, view) => {
    const list = fresh.slice(0, MAX_ALERTS_AT_ONCE)
    if (list.length === 0) return
    const prefs = prefsRef.current
    if (prefs.popup) {
      showToasts(list.map((item) => ({
        id: notifKey(item),
        itemId: item.id,
        href: item._href,
        hrefState: item._hrefState,
        ...alertText(item, view),
      })))
    }
    if (prefs.sound) playNotificationSound()
    if (prefs.vibrate && deviceCanVibrate()) vibrateForNotification()
  }, [showToasts])

  // ปุ่ม "ทดลองป๊อปอัป" ในหน้าตั้งค่า — โชว์หน้าตากล่องโดยไม่ต้องรอรายการจริง
  const previewAlert = useCallback(() => {
    showToasts([{ id: `preview-${Date.now()}`, title: 'ตัวอย่างการแจ้งเตือน', body: 'กล่องแบบนี้จะขึ้นเมื่อมีรายการใหม่เข้ากระดิ่ง', href: null }])
  }, [showToasts])

  useEffect(() => {
    if (!uid) {
      setItems([])
      setReadIds(new Set())
      setClearedAt(0)
      return
    }

    let cancelled = false
    const localKeys = readLocalKeys(uid)
    const localCleared = readLocalCleared(uid)
    setReadIds(localKeys)
    setClearedAt(localCleared)

    ;(async () => {
      const [{ data: clearedRow, error: clearedError }, { data: readRows, error: readError }] = await Promise.all([
        supabase.from('notification_cleared').select('cleared_at').eq('user_id', uid).maybeSingle(),
        supabase.from('notification_reads').select('item_key').eq('user_id', uid),
      ])
      if (cancelled) return
      if (clearedError && !isMissingRelation(clearedError)) {
        console.error('[notifications] โหลดสถานะอ่านไม่สำเร็จ:', clearedError.message)
      }
      if (readError && !isMissingRelation(readError)) {
        console.error('[notifications] โหลดรายการที่อ่านแล้วไม่สำเร็จ:', readError.message)
      }

      const mergedKeys = new Set(localKeys)
      for (const row of readRows ?? []) {
        if (row?.item_key) mergedKeys.add(row.item_key)
      }
      const remoteCleared = clearedRow?.cleared_at ? new Date(clearedRow.cleared_at).getTime() : 0
      const mergedCleared = Math.max(localCleared, Number.isFinite(remoteCleared) ? remoteCleared : 0)
      setReadIds(mergedKeys)
      setClearedAt(mergedCleared)
      writeLocalState(uid, mergedKeys, mergedCleared)
    })()

    return () => { cancelled = true }
  }, [uid])

  const fetchItems = useCallback(async () => {
    if (!uid || !tenantId || !role || profileLoading) {
      if (!uid) setItems([])
      return
    }
    setLoading(true)
    try {
      let rows
      if (audience === 'staff') {
        const { data, error } = await fetchRoleScopedComplaints(tenantId)
        if (error) throw error
        const allowed = staffQueueStatuses(role)
        rows = (data ?? [])
          .filter((row) => allowed.has(row.status))
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          .slice(0, 50)
          .map((row) => mapComplaint(row, 'staff', role))
      } else {
        const { data, error } = await supabase
          .from('complaints')
          .select('id, complaint_number, category, status, updated_at, created_at')
          .eq('municipality_id', tenantId)
          .eq('user_id', uid)
          .order('updated_at', { ascending: false })
          .limit(50)
        if (error) throw error
        rows = (data ?? [])
          .filter((row) => !CITIZEN_HIDDEN.has(row.status))
          .map((row) => mapComplaint(row, 'citizen', role))
      }
      setItems(rows)

      // เทียบกับรอบดึงก่อนหน้า (ยิงจาก realtime ทุกครั้งที่คำร้องเปลี่ยน) — รายการที่เพิ่งเข้ามาใหม่จึงเด้งเตือน
      const scope = `${uid}|${tenantId}|${audience}`
      const round = alertRoundRef.current
      const previous = round.scope === scope ? round.previous : null
      alertRoundRef.current = { scope, previous: { keys: new Set(rows.map(notifKey)), at: Date.now() } }
      const { readIds: readKeys, clearedAt: cleared } = readStateRef.current
      announce(freshUnreadItems(previous, rows, { readKeys, clearedAt: cleared }), audience)
    } catch (err) {
      console.error('[notifications] โหลดการแจ้งเตือนไม่สำเร็จ:', err?.message ?? err)
    } finally {
      setLoading(false)
    }
  }, [uid, tenantId, role, profileLoading, audience, announce])

  useEffect(() => { fetchItems() }, [fetchItems])

  useEffect(() => {
    if (!uid || !tenantId || !role || profileLoading) return
    const filter = audience === 'staff'
      ? `municipality_id=eq.${tenantId}`
      : `user_id=eq.${uid}`
    const channel = supabase
      .channel(`notif-complaints-${uid}-${crypto.randomUUID()}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'complaints',
        filter,
      }, () => fetchItems())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [uid, tenantId, role, profileLoading, audience, fetchItems])

  const tagged = items.map((n) => ({
    ...n,
    _unread: new Date(n.updated_at).getTime() > clearedAt && !readIds.has(notifKey(n)),
  }))
  const unreadCount = tagged.filter((n) => n._unread).length

  // ตัวเลขบนไอคอนแอป = จำนวนเดียวกับกระดิ่ง (เครื่องที่ไม่รองรับข้ามเงียบ) · ออกจากระบบแล้วล้าง
  useEffect(() => { syncAppBadge(uid ? unreadCount : 0) }, [uid, unreadCount])

  function persistRead(nextKeys, nextClearedAt) {
    writeLocalState(uid, nextKeys, nextClearedAt)
    if (!uid) return
    const writes = []
    const keys = [...nextKeys].slice(-200)
    if (keys.length > 0) {
      writes.push(supabase.from('notification_reads').upsert(
        keys.map((item_key) => ({ user_id: uid, item_key })),
        { onConflict: 'user_id,item_key' },
      ))
    }
    if (nextClearedAt != null) {
      writes.push(supabase.from('notification_cleared').upsert(
        { user_id: uid, cleared_at: new Date(nextClearedAt).toISOString() },
        { onConflict: 'user_id' },
      ))
    }
    if (writes.length === 0) return
    Promise.all(writes).then((results) => {
      for (const result of results) {
        if (result?.error && !isMissingRelation(result.error)) {
          console.error('[notifications] บันทึกสถานะอ่านไม่สำเร็จ:', result.error.message)
        }
      }
    })
  }

  function markRead(id) {
    const item = items.find((n) => n.id === id)
    if (!item) return
    const key = notifKey(item)
    setReadIds((prev) => {
      const next = new Set(prev)
      next.add(key)
      persistRead(next, null)
      return next
    })
  }

  function markAllRead() {
    const now = Date.now()
    const allKeys = items.map(notifKey)
    setClearedAt(now)
    setReadIds((prev) => {
      const next = new Set(prev)
      for (const key of allKeys) next.add(key)
      persistRead(next, now)
      return next
    })
  }

  function openPanel() {
    navigate('/notifications')
  }

  function openToast(toast) {
    dismissToast(toast.id)
    if (toast.itemId) markRead(toast.itemId)
    if (toast.href) navigate(toast.href, toast.hrefState ? { state: toast.hrefState } : undefined)
  }

  return (
    <NotificationsCtx.Provider value={{ unreadCount, items: tagged, loading, audience, markRead, markAllRead, openPanel, previewAlert }}>
      {children}
      <NotificationToasts toasts={toasts} onOpen={openToast} onDismiss={dismissToast} />
    </NotificationsCtx.Provider>
  )
}

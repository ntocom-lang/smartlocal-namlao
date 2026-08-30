import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTenant } from './TenantContext'
import { useAuth } from './AuthContext'
import { fetchRoleScopedComplaints } from '../lib/complaintPrivacy'

const LEGACY_SEEN_KEY = 'smartlocal_notif_read_ids'
const LEGACY_CLEARED_KEY = 'smartlocal_notif_cleared_at'
const CITIZEN_HIDDEN = new Set(['pending', 'new'])
const STAFF_ROLES = new Set(['superadmin', 'admin', 'officer', 'staff', 'technician', 'viewer', 'council', 'kamnan'])

const notifKey = (item) => `${item.id}_${item.status}`

const NotificationsCtx = createContext({
  unreadCount: 0,
  items: [],
  loading: false,
  audience: 'citizen',
  markRead: () => {},
  markAllRead: () => {},
  openPanel: () => {},
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
      if (audience === 'staff') {
        const { data, error } = await fetchRoleScopedComplaints(tenantId)
        if (error) throw error
        const allowed = staffQueueStatuses(role)
        const rows = (data ?? [])
          .filter((row) => allowed.has(row.status))
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          .slice(0, 50)
          .map((row) => mapComplaint(row, 'staff', role))
        setItems(rows)
      } else {
        const { data, error } = await supabase
          .from('complaints')
          .select('id, complaint_number, category, status, updated_at, created_at')
          .eq('municipality_id', tenantId)
          .eq('user_id', uid)
          .order('updated_at', { ascending: false })
          .limit(50)
        if (error) throw error
        setItems((data ?? [])
          .filter((row) => !CITIZEN_HIDDEN.has(row.status))
          .map((row) => mapComplaint(row, 'citizen', role)))
      }
    } catch (err) {
      console.error('[notifications] โหลดการแจ้งเตือนไม่สำเร็จ:', err?.message ?? err)
    } finally {
      setLoading(false)
    }
  }, [uid, tenantId, role, profileLoading, audience])

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

  return (
    <NotificationsCtx.Provider value={{ unreadCount, items: tagged, loading, audience, markRead, markAllRead, openPanel }}>
      {children}
    </NotificationsCtx.Provider>
  )
}

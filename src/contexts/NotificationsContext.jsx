import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTenant } from './TenantContext'

const SEEN_KEY    = 'smartlocal_notif_read_ids'
const CLEARED_KEY = 'smartlocal_notif_cleared_at'

// track by `${id}_${status}` — each status change = new notification
const notifKey = (item) => `${item.id}_${item.status}`
const AUTO_READ = new Set(['closed', 'rejected'])

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
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [session, setSession] = useState(null)
  const [clearedAt, setClearedAt] = useState(
    () => parseInt(localStorage.getItem(CLEARED_KEY) ?? '0')
  )
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

  const tagged = items.map(n => ({
    ...n,
    _unread: !AUTO_READ.has(n.status)
      && new Date(n.updated_at).getTime() > clearedAt
      && !readIds.has(notifKey(n)),
  }))
  const unreadCount = tagged.filter(n => n._unread).length

  function markRead(id) {
    const item = items.find(n => n.id === id)
    if (!item) return
    const key = notifKey(item)
    setReadIds((prev) => {
      const next = new Set(prev)
      next.add(key)
      localStorage.setItem(SEEN_KEY, JSON.stringify([...next]))
      return next
    })
  }

  function markAllRead() {
    const now = Date.now()
    localStorage.setItem(CLEARED_KEY, String(now))
    setClearedAt(now)
    const allKeys = items.map(notifKey)
    localStorage.setItem(SEEN_KEY, JSON.stringify(allKeys))
    setReadIds(new Set(allKeys))
  }

  function openPanel() {
    navigate('/notifications')
  }

  return (
    <NotificationsCtx.Provider value={{ unreadCount, items: tagged, loading, markRead, markAllRead, openPanel }}>
      {children}
    </NotificationsCtx.Provider>
  )
}

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTenant } from './TenantContext'

const SEEN_KEY = 'smartlocal_notif_read_ids'

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
      .select('id, ref_no, category, status, updated_at, created_at')
      .eq('municipality_id', tenant.id)
      .eq('user_id', session.user.id)
      .not('status', 'in', '("new","pending")')
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
    setReadIds((prev) => {
      const next = new Set(prev)
      items.forEach(n => next.add(n.id))
      localStorage.setItem(SEEN_KEY, JSON.stringify([...next]))
      return next
    })
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

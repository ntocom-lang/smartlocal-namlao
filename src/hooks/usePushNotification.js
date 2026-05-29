import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

export function usePushNotification({ userId, municipalityId } = {}) {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  )
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    setSupported(
      'serviceWorker' in navigator &&
        'PushManager' in window &&
        Boolean(VAPID_PUBLIC_KEY),
    )
  }, [])

  // ตรวจว่า user นี้มี subscription อยู่แล้วหรือไม่
  useEffect(() => {
    if (!userId || !supported) return
    ;(async () => {
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (!existing) { setSubscribed(false); return }

      const { data } = await supabase
        .from('push_subscriptions')
        .select('id')
        .eq('user_id', userId)
        .eq('endpoint', existing.endpoint)
        .maybeSingle()

      setSubscribed(Boolean(data))
    })()
  }, [userId, supported])

  const subscribe = useCallback(async () => {
    if (!supported || !userId || !municipalityId) return
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })
      }

      const key = sub.getKey('p256dh')
      const auth = sub.getKey('auth')

      await supabase.from('push_subscriptions').upsert(
        {
          user_id: userId,
          municipality_id: municipalityId,
          endpoint: sub.endpoint,
          p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
          auth_key: btoa(String.fromCharCode(...new Uint8Array(auth))),
        },
        { onConflict: 'user_id,endpoint' },
      )

      setPermission(Notification.permission)
      setSubscribed(true)
    } catch (err) {
      console.error('push subscribe error', err)
    } finally {
      setLoading(false)
    }
  }, [supported, userId, municipalityId])

  const unsubscribe = useCallback(async () => {
    if (!supported || !userId) return
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('user_id', userId)
          .eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } catch (err) {
      console.error('push unsubscribe error', err)
    } finally {
      setLoading(false)
    }
  }, [supported, userId])

  const requestAndSubscribe = useCallback(async () => {
    if (!supported) return
    const perm = await Notification.requestPermission()
    setPermission(perm)
    if (perm === 'granted') await subscribe()
  }, [supported, subscribe])

  return { supported, permission, subscribed, loading, requestAndSubscribe, unsubscribe }
}

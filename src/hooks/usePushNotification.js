import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { describeDevice } from '../lib/pushDevices'

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
  // endpoint ของเครื่องนี้ที่ผูกกับบัญชีนี้แล้ว — ใช้กับปุ่มส่งทดสอบและป้าย "เครื่องนี้" ในรายการเครื่อง
  const [endpoint, setEndpoint] = useState(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const operation = useRef({ version: 0, busy: false })
  const configured = Boolean(VAPID_PUBLIC_KEY)
  const deviceSupported = typeof window !== 'undefined' && window.isSecureContext &&
    'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
  const supported = configured && deviceSupported

  useEffect(() => {
    const refresh = () => {
      if (operation.current.busy) return
      if ('Notification' in window) setPermission(Notification.permission)
      setReloadKey(key => key + 1)
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  // อ่านอย่างเดียวตอนเปิดหน้า ไม่ขอ permission/สมัครแทนผู้ใช้ และไม่รอ serviceWorker.ready ค้างไม่สิ้นสุด
  useEffect(() => {
    let cancelled = false
    if (operation.current.busy) return
    const version = operation.current.version
    const current = () => !cancelled && operation.current.version === version && !operation.current.busy
    ;(async () => {
      try {
        if (current()) { setChecking(true); setError(''); setSubscribed(false); setEndpoint(null) }
        if (current() && 'Notification' in window) setPermission(Notification.permission)
        if (!userId || !supported) return
        const reg = await navigator.serviceWorker.getRegistration()
        const existing = reg?.active && await reg.pushManager.getSubscription()
        if (!existing) return
        const { data, error: readError } = await supabase.from('push_subscriptions').select('id')
          .eq('user_id', userId).eq('municipality_id', municipalityId).eq('endpoint', existing.endpoint).maybeSingle()
        if (readError) throw readError
        if (current()) { setSubscribed(Boolean(data)); setEndpoint(data ? existing.endpoint : null) }
      } catch {
        if (current()) setError('ตรวจสอบการแจ้งเตือนของเครื่องนี้ไม่สำเร็จ กรุณาลองใหม่')
      } finally {
        if (current()) setChecking(false)
      }
    })()
    return () => { cancelled = true }
  }, [userId, municipalityId, supported, reloadKey])

  const subscribe = useCallback(async () => {
    if (!supported || !userId || !municipalityId) return
    let created = null
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg?.active) throw new Error('service_worker_not_ready')
      let sub = await reg.pushManager.getSubscription()

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })
        created = sub
      }

      const key = sub.getKey('p256dh')
      const auth = sub.getKey('auth')

      const row = {
        user_id: userId,
        municipality_id: municipalityId,
        endpoint: sub.endpoint,
        p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
        auth_key: btoa(String.fromCharCode(...new Uint8Array(auth))),
      }
      const save = (values) => supabase.from('push_subscriptions').upsert(values, { onConflict: 'user_id,endpoint' })
      let { error: saveError } = await save({ ...row, device_label: describeDevice() })
      // ฐานข้อมูลยังไม่มีคอลัมน์ชื่อเครื่อง (ยังไม่ได้ apply 20261029100000) — เปิดรับต้องไม่พังเพราะเรื่องชื่อ
      if (saveError?.code === 'PGRST204') ({ error: saveError } = await save(row))
      if (saveError) throw saveError
      setPermission(Notification.permission)
      setSubscribed(true)
      setEndpoint(sub.endpoint)
    } catch {
      if (created) await created.unsubscribe().catch(() => {})
      setError('เปิดการแจ้งเตือนไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่ หากเพิ่งติดตั้งแอปให้เปิดหน้านี้ใหม่')
    }
  }, [supported, userId, municipalityId])

  const unsubscribe = useCallback(async () => {
    if (!supported || !userId || operation.current.busy) return
    operation.current = { version: operation.current.version + 1, busy: true }
    setChecking(false)
    setLoading(true)
    setError('')
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        const { error: deleteError } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('user_id', userId)
          .eq('municipality_id', municipalityId)
          .eq('endpoint', sub.endpoint)
        if (deleteError) throw deleteError
        // ปิดเฉพาะบัญชีนี้ในฐาน ไม่ unsubscribe เบราว์เซอร์ทั้งเครื่อง เพราะ endpoint เดียวกัน
        // อาจมีอีกบัญชีที่เจ้าตัวเปิดรับไว้ การปิดของบัญชีนี้ต้องไม่ทำให้บัญชีอื่นรับไม่ได้
        setSubscribed(false)
      }
      setSubscribed(false)
      setEndpoint(null)
    } catch {
      setError('ปิดการแจ้งเตือนไม่สำเร็จครบทุกขั้นตอน กรุณาตรวจสอบสถานะอีกครั้ง')
    } finally {
      operation.current.busy = false
      setLoading(false)
    }
  }, [supported, userId, municipalityId])

  const requestAndSubscribe = useCallback(async () => {
    if (!supported || !userId || !municipalityId || operation.current.busy) return
    operation.current = { version: operation.current.version + 1, busy: true }
    setChecking(false)
    setLoading(true)
    setError('')
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm === 'granted') await subscribe()
      else setError(perm === 'denied' ? 'เบราว์เซอร์บล็อกการแจ้งเตือน กรุณาแก้สิทธิ์ของเว็บไซต์ในการตั้งค่าเบราว์เซอร์' : 'ยังไม่ได้อนุญาตการแจ้งเตือน สามารถกดเปิดใหม่ได้เมื่อพร้อม')
    } catch {
      setError('ขออนุญาตการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      operation.current.busy = false
      setLoading(false)
    }
  }, [supported, userId, municipalityId, subscribe])

  const refresh = useCallback(() => setReloadKey(key => key + 1), [])
  return { configured, deviceSupported, supported, permission, subscribed, endpoint, checking, loading, error, refresh, requestAndSubscribe, unsubscribe }
}

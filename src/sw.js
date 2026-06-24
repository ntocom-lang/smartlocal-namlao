import { precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'

// ทันที activate SW ใหม่ ไม่ต้องรอปิดแอป
self.skipWaiting()
clientsClaim()

// workbox precache — Vite injects the manifest here at build time
precacheAndRoute(self.__WB_MANIFEST)

// ============================================================
// Push event: แสดง notification เมื่อได้รับ push จาก server
// ============================================================
self.addEventListener('push', (event) => {
  if (!event.data) return

  let data = {}
  try {
    data = event.data.json()
  } catch {
    data = { title: 'SmartLocal', body: event.data.text() }
  }

  const title = data.title ?? 'SmartLocal'
  const options = {
    body: data.body ?? '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    data: { url: data.url ?? '/' },
    vibrate: [200, 100, 200],
    requireInteraction: false,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ============================================================
// Notification click: เปิด URL ที่ส่งมากับ notification
// ============================================================
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url ?? '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.navigate(targetUrl)
          return
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    }),
  )
})

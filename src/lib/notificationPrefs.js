// ค่าการแจ้งเตือน "ขณะเปิดระบบอยู่" แยกรายเครื่อง + รายบัญชี — เก็บใน localStorage ไม่ขึ้นเซิร์ฟเวอร์
//
// แยกรายเครื่อง: คอมที่ทำงานอยากได้ยินเสียง มือถือส่วนตัวอยากเงียบ (ระบบอ้างอิงใช้ค่าเดียวทุกเครื่อง)
// แยกรายบัญชี: คอมในสำนักงานหลายคนใช้ร่วมกัน
// ค่าเริ่มต้น: ป๊อปอัปเปิด · เสียงปิด · สั่นปิด — ไม่ให้ดังทั้งห้องโดยไม่มีใครเลือก (เจ้าของระบบอนุมัติ 2569-10-28)
// muted = หมวดที่ไม่เด้ง/ไม่มีเสียง/ไม่สั่น แต่ยังอยู่ในกระดิ่ง (ข้อ 3 อนุมัติ 2569-10-29)

import { NOTIFICATION_CATEGORY_KEYS } from './notificationFeed.js'

export const NOTIFICATION_PREFS_EVENT = 'smartlocal:notification-prefs'
export const DEFAULT_NOTIFICATION_PREFS = Object.freeze({ popup: true, sound: false, vibrate: false, muted: Object.freeze([]) })
const BOOLEAN_PREFS = ['popup', 'sound', 'vibrate']
const KEY_PREFIX = 'smartlocal_notif_device_prefs_v1'

export const notificationPrefsKey = (uid) => `${KEY_PREFIX}_${uid || 'guest'}`

export function sanitizeNotificationPrefs(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const prefs = Object.fromEntries(BOOLEAN_PREFS
    .map((key) => [key, typeof value[key] === 'boolean' ? value[key] : DEFAULT_NOTIFICATION_PREFS[key]]))
  // เก็บเฉพาะรหัสหมวดที่รู้จัก ไม่ซ้ำ — ค่าพัง/หมวดที่เลิกใช้หายไปเอง
  prefs.muted = Array.isArray(value.muted)
    ? [...new Set(value.muted.filter((key) => NOTIFICATION_CATEGORY_KEYS.includes(key)))]
    : []
  return prefs
}

/** ข้อความดิบใน localStorage (สตริงคงที่ — ใช้เป็น snapshot ของ useSyncExternalStore ได้) */
export function readNotificationPrefsRaw(uid, storage = globalThis.localStorage) {
  try {
    return storage?.getItem(notificationPrefsKey(uid)) ?? null
  } catch {
    // private mode / ถูกบล็อก — ถือว่ายังไม่เคยตั้ง
    return null
  }
}

export function parseNotificationPrefs(raw) {
  try {
    return sanitizeNotificationPrefs(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS }
  }
}

export const readNotificationPrefs = (uid, storage) => parseNotificationPrefs(readNotificationPrefsRaw(uid, storage))

/** บันทึกแล้วแจ้งหน้าที่เปิดอยู่ในแท็บเดียวกัน (แท็บอื่นได้ผ่าน storage event ของเบราว์เซอร์เอง) */
export function writeNotificationPrefs(uid, prefs, storage = globalThis.localStorage) {
  const next = sanitizeNotificationPrefs(prefs)
  let saved = true
  try {
    storage?.setItem(notificationPrefsKey(uid), JSON.stringify(next))
  } catch {
    saved = false
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(NOTIFICATION_PREFS_EVENT, { detail: { key: notificationPrefsKey(uid), prefs: next } }))
  } catch {
    // ไม่มี window (เทสต์ node) — ข้าม
  }
  return { prefs: next, saved }
}

export function subscribeNotificationPrefs(callback) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(NOTIFICATION_PREFS_EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(NOTIFICATION_PREFS_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

// สั่นได้เฉพาะเครื่องจอสัมผัสที่มี navigator.vibrate (Android) — iPhone/iPad ไม่รองรับการสั่นจากเว็บ จึงไม่โชว์สวิตช์
export function deviceCanVibrate(nav = globalThis.navigator, win = globalThis.window) {
  try {
    return typeof nav?.vibrate === 'function' && Boolean(win?.matchMedia?.('(pointer: coarse)').matches)
  } catch {
    return false
  }
}

export function vibrateForNotification(nav = globalThis.navigator) {
  try {
    return Boolean(nav?.vibrate?.([30, 60, 30]))
  } catch {
    return false
  }
}

// ตัวเลขบนไอคอนแอป (Badging API) — Chrome/Edge บนคอมที่ติดตั้งแอป และ iPhone ที่เพิ่มเว็บไว้หน้าจอโฮม
export const appBadgeSupported = (nav = globalThis.navigator) => typeof nav?.setAppBadge === 'function'

export function syncAppBadge(count, nav = globalThis.navigator) {
  if (!appBadgeSupported(nav)) return false
  try {
    const job = count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.()
    Promise.resolve(job).catch(() => {})
    return true
  } catch {
    return false
  }
}

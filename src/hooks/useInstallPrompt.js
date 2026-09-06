import { useSyncExternalStore } from 'react'

// สถานะการติดตั้ง PWA ที่เดียวสำหรับทั้งแอป
//
// ของเดิมตรรกะชุดนี้ถูกก๊อปไว้ 3 ที่ (InstallPrompt, MorePage, templates/Kledkaew/More)
// ซึ่งค่อยๆ เพี้ยนออกจากกัน และทุกตัวมีจุดบอดเดียวกัน: ซ่อนปุ่มทิ้งเมื่อไม่มี
// beforeinstallprompt ซึ่งไม่รองรับทุกเบราว์เซอร์และไม่มีเวลาที่รับประกันว่าจะเกิด
// จึงให้มือถือเปิดคู่มือได้เมื่อยังไม่มี prompt โดยไม่รับประกันว่าแต่ละเบราว์เซอร์ติดตั้งได้
//
// โหมดที่คืนออกไป
//   installed       ติดตั้งแล้ว (เปิดอยู่ในโหมดแอป)
//   ready           เบราว์เซอร์ให้ prompt ติดตั้งของจริงมาแล้ว กดแล้วติดตั้งได้เลย
//   manual-ios      iOS ไม่มี prompt ให้ ต้องสอนกด "แชร์ → เพิ่มที่หน้าจอโฮม"
//   manual-android  Android ที่ยังไม่ให้ prompt มา ต้องสอนกดจากเมนูเบราว์เซอร์
//   hidden          เดสก์ท็อปที่เบราว์เซอร์ไม่รองรับ — ไม่ต้องรบกวนผู้ใช้

const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
const isAndroid = () => /Android/i.test(navigator.userAgent)

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
}

// ทุกปุ่มต้องใช้ event เดียวร่วมกัน เพราะ prompt ใช้ได้ครั้งเดียว
let prompt = null
let installed = false
let busy = false
const listeners = new Set()
const emit = () => listeners.forEach(listener => listener())
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
const getMode = () => installed || isStandalone() ? 'installed'
  : prompt ? 'ready' : isIOS() ? 'manual-ios' : isAndroid() ? 'manual-android' : 'hidden'

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    prompt = event
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    prompt = null
    emit()
  })
  window.matchMedia('(display-mode: standalone)').addEventListener('change', emit)
}

async function install() {
  if (busy) return 'dismissed'
  if (!prompt) return 'guide'
  const event = prompt
  prompt = null
  busy = true
  emit()
  try {
    await event.prompt()
    return (await event.userChoice).outcome
  } catch {
    return 'guide'
  } finally {
    busy = false
    emit()
  }
}

export function useInstallPrompt() {
  const mode = useSyncExternalStore(subscribe, getMode, () => 'hidden')
  return { mode, install }
}

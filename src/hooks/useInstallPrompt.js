import { useSyncExternalStore } from 'react'

// สถานะการติดตั้ง PWA ที่เดียวสำหรับทั้งแอป
//
// ของเดิมตรรกะชุดนี้ถูกก๊อปไว้ 3 ที่ (InstallPrompt, MorePage, templates/Kledkaew/More)
// ปุ่ม Android ต้องแสดงเมื่อมี beforeinstallprompt จริงเท่านั้น ไม่แสดงปุ่มติดตั้ง
// ที่กดแล้วกลายเป็นคู่มือ ระบบติดตาม event ต่อแม้ยังไม่มีปุ่มบนจอ
// การไม่มี event ยังบอกไม่ได้ว่าไม่รองรับ หรือติดตั้งไว้แล้ว จึงไม่เดาสถานะ
//
// โหมดที่คืนออกไป
//   installed       ติดตั้งแล้ว (เปิดอยู่ในโหมดแอป)
//   ready           เบราว์เซอร์ให้ prompt ติดตั้งของจริงมาแล้ว กดแล้วติดตั้งได้เลย
//   installing      กำลังเรียก prompt / รอผู้ใช้ยืนยัน ป้องกันการใช้ event ซ้ำ
//   manual-ios      iOS ไม่มี prompt ให้ ต้องสอนกด "แชร์ → เพิ่มที่หน้าจอโฮม"
//   manual-android  เรียกหน้าติดตั้งแล้วผิดพลาด จึงแสดงทางช่วยเหลือ
//   hidden          ยังไม่มี event ให้เรียกติดตั้ง (ติดตามความพร้อมต่อ)

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
let failed = false
const listeners = new Set()
const emit = () => listeners.forEach(listener => listener())
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
const getMode = () => installed || isStandalone() ? 'installed'
  : busy ? 'installing' : prompt ? 'ready' : isIOS() ? 'manual-ios' : failed && isAndroid() ? 'manual-android' : 'hidden'

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    prompt = event
    failed = false
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    prompt = null
    emit()
  })
  const displayMode = window.matchMedia('(display-mode: standalone)')
  if (displayMode.addEventListener) displayMode.addEventListener('change', emit)
  else displayMode.addListener(emit) // เบราว์เซอร์มือถือรุ่นเก่า
}

async function install() {
  if (busy) return 'unavailable'
  // callback จากปุ่มเก่าหรือปุ่มอีกตำแหน่งต้องไม่เปิดคู่มือเมื่อ event ถูกใช้ไปแล้ว
  if (!prompt) return isIOS() || failed ? 'guide' : 'unavailable'
  const event = prompt
  prompt = null
  busy = true
  failed = false
  emit()
  try {
    await event.prompt()
    return (await event.userChoice).outcome
  } catch {
    failed = true
    return 'guide'
  } finally {
    busy = false
    emit()
  }
}

export function useInstallPrompt() {
  const mode = useSyncExternalStore(subscribe, getMode, () => 'hidden')
  const promptFailed = useSyncExternalStore(subscribe, () => failed, () => false)
  return { mode, install, promptFailed }
}

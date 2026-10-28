import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import {
  addSeenPageKey, autoReloadMark, bangkokDay, isCountableEnvironment, isCountablePath, isFirstPageToday,
  isFirstTodayVisitor, pageKeyForPath, shouldSkipCountAfterAutoReload,
} from './siteOpenStats.js'

// ─── ตัวนับการเข้าชมเว็บไซต์: ยิง RPC + ถือยอดล่าสุดไว้ให้ท้ายเว็บ/หน้ารายงาน ───
//
// นิยามการนับและสิ่งที่ตัดออกอยู่ที่ siteOpenStats.js · ฝั่ง DB อยู่ที่
// supabase/migrations/20260930100100_site_open_daily_rpc.sql
//
// ยิงทันทีทุกหน้า ไม่รวบไว้ส่งทีเดียวตอนปิดหน้า — มือถือปิดแท็บ/ฆ่าแอปโดยไม่ยิง pagehide
// บ่อยมาก ยอดที่ค้างในหน่วยความจำจะหายเงียบๆ = นับขาด ซึ่งตรงข้ามกับที่เจ้าของระบบขอ
// ถ้าวันหนึ่งยอดถึงหลักแสนครั้ง/วันจนต้องประหยัด RPC ค่อยเปลี่ยนเป็นรวบส่ง

const VISITOR_DAY_KEY = 'sl_site_visitor_day'
// ชื่อกลุ่มหน้าที่เครื่องนี้เปิดแล้วของวัน เก็บเป็น JSON {day, keys} — ไว้ตอบ "เครื่องนี้เพิ่งเปิดหน้านี้ครั้งแรกของวันไหม"
// ไม่เคยถูกส่งขึ้น server (server รู้แค่ true/false ของหน้าที่เปิดอยู่ตอนนั้น ไม่มีประวัติรายเครื่อง)
const PAGE_KEYS_KEY = 'sl_site_page_keys'
// ธง "หน้านี้กำลังจะถูกระบบโหลดซ้ำ" ใน sessionStorage (อยู่รอดการ reload ของแท็บเดียวกัน หายเมื่อปิดแท็บ) — ดู autoReloadMark
const AUTO_RELOAD_KEY = 'sl_site_auto_reload'

// รอให้หน้าอยู่นิ่งก่อนนับ — route ที่ redirect ต่อทันที (เช่น /map → /data-center/public)
// เปลี่ยน pathname 2 รอบติดกัน ถ้านับทันทีจะได้ 2 ครั้งจากการเปิดหน้าเดียว
export const SITE_OPEN_SETTLE_MS = 1000

// store ระดับโมดูล: ยอดที่ record_site_open คืนมาแต่ละครั้งถูกส่งต่อให้ท้ายเว็บทันที
// ไม่ต้องยิง get_site_open_summary ซ้ำทุกหน้า
let snapshot = { tenantId: null, summary: null }
const listeners = new Set()
// วันที่แท็บนี้จองการนับ "เครื่องไม่ซ้ำ" ไว้แล้วระหว่างรอ RPC ตอบ (ดู isFirstTodayVisitor)
let claimedVisitorDay = null
// เช่นเดียวกันของรายหน้า: ชื่อหน้าที่แท็บนี้จองไว้แล้วระหว่างรอ RPC ตอบ
let claimedPages = { day: null, keys: [] }
let inflight = 0
// หน้าปัจจุบัน (pathname ที่ scheduleSiteOpen เรียกล่าสุด) เริ่มนับแล้วหรือยัง — ไว้ตัดสินว่าหน้าที่ระบบโหลดซ้ำให้ต้องนับอีกไหม
let currentPageCounted = false

function writeAutoReloadMark() {
  try {
    window.sessionStorage.setItem(AUTO_RELOAD_KEY, autoReloadMark(currentPageCounted))
  } catch {
    // เขียนไม่ได้ (โหมดส่วนตัวบางตัว/storage ถูกบล็อก) = หน้าที่โหลดซ้ำนับอีกครั้งเหมือนก่อนแก้ — นับเกิน 1 ไม่ใช่นับขาด
  }
}

// ฟังเหตุการณ์เดียวกับที่ src/main.jsx ใช้สั่งโหลดซ้ำ (controllerchange) แล้วจดธงก่อนหน้าจะถูกโหลดใหม่ —
// ตัวฟังทุกตัวรันในรอบเดียวกันก่อนหน้าถูกแทนที่ ลำดับที่ลงทะเบียนจึงไม่สำคัญ · ไม่ต้องแก้ main.jsx
// ทำตอนโหลดโมดูล (ไม่ผูกกับ React) ให้ครอบทุกหน้า รวมหน้าที่ยังไม่ได้ render AppShell
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', writeAutoReloadMark)
}

// อ่านธงแล้วลบทิ้งทันที (ใช้ครั้งเดียว) — true = หน้านี้เพิ่งถูกระบบโหลดซ้ำและหน้าก่อนหน้านับไปแล้ว ให้ข้าม
function consumeAutoReloadSkip() {
  try {
    const raw = window.sessionStorage.getItem(AUTO_RELOAD_KEY)
    if (raw === null) return false
    window.sessionStorage.removeItem(AUTO_RELOAD_KEY)
    return shouldSkipCountAfterAutoReload(raw)
  } catch {
    return false
  }
}

function publish(tenantId, summary) {
  const prev = snapshot.tenantId === tenantId ? snapshot.summary : null
  // คำตอบที่มาถึงทีหลังอาจเป็นยอดที่อ่านไว้ก่อน (คำขอสองตัววิ่งสวนกัน) — ยอดสะสมไม่มีวันลดลง
  // จึงเก็บตัวที่มากกว่าไว้ ท้ายเว็บจะได้ไม่เห็นตัวเลขถอยหลัง
  if (prev && Number(summary?.opens?.total ?? 0) < Number(prev?.opens?.total ?? 0)) return
  snapshot = { tenantId, summary }
  listeners.forEach(fn => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function getSnapshot() {
  return snapshot
}

function currentEnvironment() {
  const nav = typeof navigator === 'undefined' ? {} : navigator
  return {
    isDev: import.meta.env.DEV,
    hostname: typeof window === 'undefined' ? '' : window.location.hostname,
    userAgent: nav.userAgent ?? '',
    webdriver: nav.webdriver === true,
  }
}

function readVisitorDay() {
  try {
    return { storageOk: true, storedDay: window.localStorage.getItem(VISITOR_DAY_KEY) }
  } catch {
    return { storageOk: false, storedDay: null }
  }
}

function writeVisitorDay(day) {
  try {
    window.localStorage.setItem(VISITOR_DAY_KEY, day)
  } catch {
    // เขียนไม่ได้ = หน้าถัดไปอ่านไม่ได้เหมือนกัน isFirstTodayVisitor จะตอบ false เอง ไม่นับซ้ำ
  }
}

function readPageKeys() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PAGE_KEYS_KEY) || 'null')
    return {
      storageOk: true,
      storedDay: typeof parsed?.day === 'string' ? parsed.day : null,
      storedKeys: Array.isArray(parsed?.keys) ? parsed.keys : [],
    }
  } catch {
    // อ่านไม่ได้ หรือค่าในเครื่องเสีย — ตอบเหมือน storage ใช้ไม่ได้ ตัวรองของหน้านี้ขาด ยอดหลักไม่กระทบ
    return { storageOk: false, storedDay: null, storedKeys: [] }
  }
}

function writePageKey(today, pageKey) {
  try {
    const { storedDay, storedKeys } = readPageKeys()
    window.localStorage.setItem(PAGE_KEYS_KEY, JSON.stringify({
      day: today,
      keys: addSeenPageKey(storedDay, storedKeys, today, pageKey),
    }))
  } catch {
    // เขียนไม่ได้ = หน้าถัดไปอ่านไม่ได้เหมือนกัน isFirstPageToday จะตอบ false เอง ไม่นับซ้ำ
  }
}

async function countNow(tenantId, pathname) {
  const today = bangkokDay()
  // ส่งเฉพาะชื่อกลุ่มของหน้า ไม่ส่ง pathname — ดูเหตุผลที่ PAGE_CATALOG (โทเคน/รหัสตรวจสอบอยู่ใน URL)
  const pageKey = pageKeyForPath(pathname)
  const firstToday = isFirstTodayVisitor({ ...readVisitorDay(), claimedDay: claimedVisitorDay, today })
  const firstPageToday = isFirstPageToday({
    ...readPageKeys(), claimedDay: claimedPages.day, claimedKeys: claimedPages.keys, today, pageKey,
  })
  if (firstToday) claimedVisitorDay = today
  if (firstPageToday) claimedPages = { day: today, keys: addSeenPageKey(claimedPages.day, claimedPages.keys, today, pageKey) }
  inflight++
  try {
    const { data, error } = await supabase.rpc('record_site_open', {
      _municipality_id: tenantId,
      _first_today: firstToday,
      _page_key: pageKey,
      _first_page_today: firstPageToday,
    })
    if (error) throw error
    if (firstToday) writeVisitorDay(today)
    if (firstPageToday) writePageKey(today, pageKey)
    if (data) publish(tenantId, data)
  } catch {
    // เน็ตหลุด/DB ล่ม — การเข้าชมครั้งนี้หายไป 1 ครั้ง ไม่ลองซ้ำ เพราะคำขอแรกอาจถึง DB แล้ว
    // แต่คำตอบหายระหว่างทาง ลองซ้ำจะกลายเป็นนับเบิ้ล (นับขาด 1 ดีกว่านับเกินที่ตรวจย้อนไม่ได้)
    if (firstToday) claimedVisitorDay = null
    if (firstPageToday) {
      claimedPages = { day: claimedPages.day, keys: claimedPages.keys.filter(k => k !== pageKey) }
    }
  } finally {
    inflight--
  }
}

// เรียกจาก AppShell (src/App.jsx) ทุกครั้งที่ pathname เปลี่ยน — คืน cleanup ให้ useEffect
// ถ้าเปลี่ยนหน้าอีกก่อนครบ SITE_OPEN_SETTLE_MS ตัวจับเวลาเดิมถูกยกเลิก นับเฉพาะหน้าที่อยู่จริง
// หน้าหลังบ้าน (isCountablePath) ไม่ตั้งตัวจับเวลาเลย แต่ยังยกเลิกตัวของหน้าก่อนหน้าผ่าน cleanup ตามปกติ
export function scheduleSiteOpen(tenantId, pathname) {
  currentPageCounted = false
  // effect นี้รันรอบแรกตอน tenant ยังโหลดไม่เสร็จ (tenantId ว่าง) — อย่าอ่านธงรอบนั้น ไม่งั้นทิ้งธงก่อนหน้าแรกจะได้ใช้
  if (!tenantId) return undefined
  // อ่านแล้วลบธงทันทีทุกครั้งที่รู้ tenant ไม่ว่าหน้านี้จะนับหรือไม่ — ไม่งั้นหน้าที่ไม่นับ (หลังบ้าน/localhost) ทำให้ธงค้างอยู่
  // แล้วไปทำให้หน้าสาธารณะหน้าถัดไปที่ผู้ใช้เปิดภายใน AUTO_RELOAD_WINDOW_MS ถูกข้ามผิดๆ
  const skipAfterAutoReload = consumeAutoReloadSkip()
  if (!isCountablePath(pathname) || !isCountableEnvironment(currentEnvironment())) return undefined
  // หน้านี้ถูกระบบโหลดซ้ำเอง (service worker ใหม่รับช่วง) และหน้าก่อนโหลดซ้ำนับไปแล้ว → ไม่นับซ้ำ
  if (skipAfterAutoReload) {
    currentPageCounted = true
    return undefined
  }
  const timer = setTimeout(() => {
    currentPageCounted = true
    // ถ้าระบบเพิ่งสั่งโหลดซ้ำช่วงที่ตัวจับเวลาเดินพอดี ธงที่จดไว้ยังเป็น "ยังไม่นับ" ทั้งที่กำลังนับอยู่ — ปรับให้ตรง
    // ไม่งั้นหน้าที่โหลดซ้ำจะนับอีกครั้ง (เกิดในช่วงไม่กี่มิลลิวินาที แต่แก้ได้ถูก)
    try {
      if (window.sessionStorage.getItem(AUTO_RELOAD_KEY) !== null) writeAutoReloadMark()
    } catch { /* ไม่มี storage = ไม่มีธงให้ปรับ */ }
    countNow(tenantId, pathname)
  }, SITE_OPEN_SETTLE_MS)
  return () => clearTimeout(timer)
}

async function loadSiteOpenSummary(tenantId) {
  try {
    const { data, error } = await supabase.rpc('get_site_open_summary', { _municipality_id: tenantId })
    if (error) throw error
    if (data) publish(tenantId, data)
  } catch {
    // อ่านไม่ได้ = ท้ายเว็บไม่แสดงบรรทัดตัวนับ ไม่ต้องบอกผู้ใช้ ไม่ใช่งานที่เขากำลังทำ
  }
}

// ยอดสรุปล่าสุดของ อปท. นี้ (null = ยังไม่มี) — ใช้ร่วมกันระหว่างท้ายเว็บกับหน้า /reports/visitors
export function useSiteOpenSummary(tenantId) {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    if (!tenantId) return undefined
    // เครื่องที่ไม่นับ (localhost/E2E/บอต) ไม่มีผลของการนับส่งมา ต้องอ่านเอง
    if (!isCountableEnvironment(currentEnvironment())) {
      loadSiteOpenSummary(tenantId)
      return undefined
    }
    // ปกติยอดมากับคำตอบของการนับหน้าแรก (หลังหน่วง SITE_OPEN_SETTLE_MS) — รอเผื่อแล้วยังไม่มี
    // และไม่มีคำขอค้าง แปลว่าการนับล้มเหลว ให้อ่านเองแทน ท้ายเว็บจะได้ไม่หายไปทั้งบรรทัด
    const timer = setTimeout(() => {
      if (snapshot.tenantId !== tenantId && inflight === 0) loadSiteOpenSummary(tenantId)
    }, SITE_OPEN_SETTLE_MS + 1500)
    return () => clearTimeout(timer)
  }, [tenantId])

  return current.tenantId === tenantId ? current.summary : null
}

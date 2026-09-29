import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { bangkokDay, isCountableEnvironment, isFirstTodayVisitor } from './siteOpenStats.js'

// ─── ตัวนับการเข้าชมเว็บไซต์: ยิง RPC + ถือยอดล่าสุดไว้ให้ท้ายเว็บ/หน้ารายงาน ───
//
// นิยามการนับและสิ่งที่ตัดออกอยู่ที่ siteOpenStats.js · ฝั่ง DB อยู่ที่
// supabase/migrations/20260930100100_site_open_daily_rpc.sql
//
// ยิงทันทีทุกหน้า ไม่รวบไว้ส่งทีเดียวตอนปิดหน้า — มือถือปิดแท็บ/ฆ่าแอปโดยไม่ยิง pagehide
// บ่อยมาก ยอดที่ค้างในหน่วยความจำจะหายเงียบๆ = นับขาด ซึ่งตรงข้ามกับที่เจ้าของระบบขอ
// ถ้าวันหนึ่งยอดถึงหลักแสนครั้ง/วันจนต้องประหยัด RPC ค่อยเปลี่ยนเป็นรวบส่ง

const VISITOR_DAY_KEY = 'sl_site_visitor_day'

// รอให้หน้าอยู่นิ่งก่อนนับ — route ที่ redirect ต่อทันที (เช่น /map → /data-center/public)
// เปลี่ยน pathname 2 รอบติดกัน ถ้านับทันทีจะได้ 2 ครั้งจากการเปิดหน้าเดียว
export const SITE_OPEN_SETTLE_MS = 1000

// store ระดับโมดูล: ยอดที่ record_site_open คืนมาแต่ละครั้งถูกส่งต่อให้ท้ายเว็บทันที
// ไม่ต้องยิง get_site_open_summary ซ้ำทุกหน้า
let snapshot = { tenantId: null, summary: null }
const listeners = new Set()
// วันที่แท็บนี้จองการนับ "เครื่องไม่ซ้ำ" ไว้แล้วระหว่างรอ RPC ตอบ (ดู isFirstTodayVisitor)
let claimedVisitorDay = null
let inflight = 0

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

async function countNow(tenantId) {
  const today = bangkokDay()
  const firstToday = isFirstTodayVisitor({ ...readVisitorDay(), claimedDay: claimedVisitorDay, today })
  if (firstToday) claimedVisitorDay = today
  inflight++
  try {
    const { data, error } = await supabase.rpc('record_site_open', {
      _municipality_id: tenantId,
      _first_today: firstToday,
    })
    if (error) throw error
    if (firstToday) writeVisitorDay(today)
    if (data) publish(tenantId, data)
  } catch {
    // เน็ตหลุด/DB ล่ม — การเข้าชมครั้งนี้หายไป 1 ครั้ง ไม่ลองซ้ำ เพราะคำขอแรกอาจถึง DB แล้ว
    // แต่คำตอบหายระหว่างทาง ลองซ้ำจะกลายเป็นนับเบิ้ล (นับขาด 1 ดีกว่านับเกินที่ตรวจย้อนไม่ได้)
    if (firstToday) claimedVisitorDay = null
  } finally {
    inflight--
  }
}

// เรียกจาก AppShell (src/App.jsx) ทุกครั้งที่ pathname เปลี่ยน — คืน cleanup ให้ useEffect
// ถ้าเปลี่ยนหน้าอีกก่อนครบ SITE_OPEN_SETTLE_MS ตัวจับเวลาเดิมถูกยกเลิก นับเฉพาะหน้าที่อยู่จริง
export function scheduleSiteOpen(tenantId) {
  if (!tenantId || !isCountableEnvironment(currentEnvironment())) return undefined
  const timer = setTimeout(() => { countNow(tenantId) }, SITE_OPEN_SETTLE_MS)
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { signOutSafely } from '../lib/supabase'

// ออกจากระบบอัตโนมัติเมื่อไม่มีการใช้งาน — สำหรับบัญชีเจ้าหน้าที่เท่านั้น
//
// ทำไมต้องมี: ตั้งแต่มีการเข้าสู่ระบบด้วยรหัสจากมือถือ เจ้าหน้าที่เข้าใช้งานบน PC เครื่องอื่น
// ได้ง่ายขึ้นมาก ซึ่งแปลว่าจะทิ้ง session ไว้บนเครื่องคนอื่นบ่อยขึ้นตามไปด้วย ปัญหาเดิมที่
// audit_logs บันทึกผู้กระทำผิดตัวจึงแค่ย้ายรูปแบบ ไม่ได้หายไป — จากเดิม "เข้าเป็นบัญชีคนอื่น"
// กลายเป็น "ทิ้งบัญชีตัวเองไว้ให้คนอื่นใช้ต่อ" ซึ่งในแง่การตรวจสอบก็ผิดตัวเหมือนกัน
//
// ประชาชนไม่โดน: ใช้แอปบนมือถือตัวเอง การถูกเด้งออกเองมีแต่สร้างความรำคาญโดยไม่ได้
// ลดความเสี่ยงอะไร

const IDLE_LIMIT_MS = 60 * 60 * 1000  // 60 นาที — เจ้าหน้าที่เปิดหน้าจอค้างระหว่างทำงานเอกสารได้นาน
const WARN_BEFORE_MS = 2 * 60 * 1000  // เตือนล่วงหน้า 2 นาที ให้กด "ใช้งานต่อ" ได้ทัน
// เดินทุกวินาทีเพราะแถบบอกตัวตนโชว์เวลานับถอยหลังให้เห็นตลอด — ถ้าเช็คห่างกว่านี้
// ตัวเลขจะกระโดดข้ามวินาที ดูเหมือนนาฬิกาเสีย (re-render แค่ StaffSessionBar ตัวเดียว
// ที่ถือ state นี้ ไม่ได้ลามไปทั้งแอป)
const CHECK_INTERVAL_MS = 1000
const ACTIVITY_THROTTLE_MS = 5000
// เก็บใน localStorage ด้วย ไม่ใช่แค่ในหน่วยความจำ — ปิดแท็บแล้วเปิดใหม่ต้องนับต่อจากเดิม
// ไม่ใช่เริ่มนับหนึ่งใหม่ ไม่งั้นแค่ปิด-เปิดแท็บก็รีเซ็ตตัวจับเวลาได้ฟรี
//
// ⚠️ ค่าที่เก็บต้องผูกกับ session ด้วย ไม่ใช่ timestamp ลอยๆ — ของเดิมเก็บแค่ตัวเลข
// แล้วเกิดลูปเด้งออกไม่รู้จบ (เจอจริง 2026-08-28): hook ตัวนี้เขียนค่าเฉพาะตอน enabled
// ซึ่งเป็นจริงเฉพาะตอนล็อกอินเป็นเจ้าหน้าที่แล้ว พอออกจากระบบไปเกิน 60 นาทีแล้วกลับมา
// ล็อกอินใหม่ ค่าที่ค้างอยู่คือของ session ที่แล้ว → tick แรกตัดสินว่าหมดเวลาทันที →
// เด้งไปหน้า login ซึ่ง hook ปิด ไม่มีใครเขียนค่าใหม่ → ล็อกอินอีกกี่ครั้งก็วนที่เดิม
// การคลิกปุ่มล็อกอินก็ไม่ช่วย เพราะ listener ผูกเฉพาะตอน hook เปิด
const STORAGE_KEY = 'sl_last_activity'

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'focus']

// session_id เป็น required claim ของ access token ที่ GoTrue ออกให้ (ดู @supabase/auth-js
// lib/types.d.ts) และ "คงเดิมตลอดอายุการล็อกอินครั้งนั้น" แม้ access token จะถูกต่ออายุใหม่
// ทุกชั่วโมง จึงเป็นตัวแยก "reload/เปิดแท็บใหม่" (sid เดิม = นับต่อ) ออกจาก "ล็อกอินใหม่"
// (sid ใหม่ = เริ่มนับใหม่) ได้ตรงตามเจตนาเดิมทั้งสองข้อ
//
// ไม่ใช้วิธีดักอีเวนต์ SIGNED_IN แทน เพราะ auth-js ยิงอีเวนต์นี้จากหลายจุดรวมถึงตอน sync
// session ข้ามแท็บและตอนกู้ session คืน จะรีเซ็ตตัวจับเวลาให้ฟรีโดยไม่ได้ตั้งใจ
function decodeSessionId(accessToken) {
  if (!accessToken) return null
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return null
    // base64url → base64 แล้วเติม padding เอง (atob โยน error ถ้าความยาวไม่ลงตัว 4)
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(padded))?.session_id ?? null
  } catch {
    return null
  }
}

// คืน { sid, ts } — รูปแบบเดิมที่เป็นตัวเลขล้วนถือว่าใช้ไม่ได้ (ไม่รู้ว่าของ session ไหน)
// เครื่องที่ค้างค่ารูปแบบเดิมไว้จะได้เริ่มนับใหม่เองรอบแรก ไม่ต้องให้ผู้ใช้ไปล้าง localStorage
function readActivity() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.sid !== 'string' || !Number.isFinite(parsed?.ts)) return null
    return parsed
  } catch {
    return null
  }
}

function writeActivity(sid, timestamp) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sid, ts: timestamp }))
  } catch {
    // โหมดส่วนตัว/พื้นที่เต็ม — ยังทำงานต่อได้ด้วยค่าที่อยู่ในหน่วยความจำ
  }
}

/**
 * @param {boolean} enabled เปิดตัวจับเวลาไหม (เฉพาะบัญชีเจ้าหน้าที่)
 * @param {string} [accessToken] access token ปัจจุบัน ใช้ดึง session_id ออกมาผูกกับตัวจับเวลา
 */
export function useIdleLogout(enabled, accessToken) {
  // วินาทีที่เหลือก่อนถูกออกจากระบบ — โชว์บนแถบตลอดเวลา ไม่ใช่เฉพาะตอนใกล้หมด
  const [secondsLeft, setSecondsLeft] = useState(Math.round(IDLE_LIMIT_MS / 1000))
  const lastActivityRef = useRef(0)
  const loggingOutRef = useRef(false)

  // token เปลี่ยนทุกครั้งที่ต่ออายุ แต่ sid ไม่เปลี่ยน — useMemo กันไม่ให้ effect ข้างล่าง
  // รีสตาร์ท (แล้วอ่านค่าเริ่มต้นใหม่) ทุกชั่วโมงตอน token refresh
  const sid = useMemo(() => decodeSessionId(accessToken), [accessToken])

  // ผูกกับ sid ตรงๆ ไม่ผ่าน ref — sid เปลี่ยนเฉพาะตอนล็อกอินใหม่ (ไม่เปลี่ยนตอน token
  // refresh เพราะ useMemo ข้างบนกันไว้แล้ว) การสร้างฟังก์ชันใหม่ตอนนั้นไม่มีผลอะไร
  // เพราะมันถูกใช้เป็น onClick ของปุ่ม "ใช้งานต่อ" อย่างเดียว
  const markActive = useCallback(() => {
    const now = Date.now()
    lastActivityRef.current = now
    if (sid) writeActivity(sid, now)
    setSecondsLeft(Math.round(IDLE_LIMIT_MS / 1000))
  }, [sid])

  useEffect(() => {
    if (!enabled) return

    // ถอด session_id ไม่ได้ (token รูปแบบไม่คาดคิด / atob ใช้ไม่ได้) — ไม่นับเวลาเลย
    // ดีกว่านับจากฐานที่เชื่อไม่ได้ เพราะโหมดพังของการเดาผิดฝั่งนั้นคือลูปเด้งออกที่
    // ผู้ใช้แก้เองไม่ได้ = ใช้ระบบไม่ได้ทั้งระบบ ส่วนโหมดพังทางนี้คือ session อยู่ยาว
    // ซึ่งเป็นสภาพเดียวกับก่อนมีฟีเจอร์นี้ และยังมีการออกจากระบบด้วยมือเป็นด่านรอง
    if (!sid) {
      console.warn('[idle] ถอด session_id จาก access token ไม่ได้ — ปิดตัวจับเวลาไว้ก่อน')
      return
    }

    // เริ่มจากค่าที่ค้างไว้ก่อนหน้า "เฉพาะเมื่อเป็นการล็อกอินครั้งเดียวกัน" เพื่อไม่ให้
    // การเปิดแท็บใหม่รีเซ็ตตัวจับเวลา ส่วน sid ที่ไม่ตรง = คนละการล็อกอิน ต้องเริ่มนับใหม่
    const stored = readActivity()
    const resume = stored?.sid === sid
    lastActivityRef.current = resume ? stored.ts : Date.now()
    if (!resume) writeActivity(sid, lastActivityRef.current)

    let throttleUntil = 0
    const onActivity = () => {
      const now = Date.now()
      if (now < throttleUntil) return
      throttleUntil = now + ACTIVITY_THROTTLE_MS
      lastActivityRef.current = now
      writeActivity(sid, now)
    }

    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, onActivity, { passive: true })
    })

    const timerId = setInterval(() => {
      if (loggingOutRef.current) return
      // อ่านจาก localStorage ทุกครั้ง เผื่อผู้ใช้กำลังทำงานอยู่ในแท็บอื่นของแอปเดียวกัน
      // แท็บที่ล็อกอินคนละ session (sid ไม่ตรง) ไม่ให้มายืดเวลาให้กัน
      const stored = readActivity()
      const lastActivity = stored?.sid === sid ? stored.ts : lastActivityRef.current
      lastActivityRef.current = lastActivity
      const idleMs = Date.now() - lastActivity

      if (idleMs >= IDLE_LIMIT_MS) {
        loggingOutRef.current = true
        setSecondsLeft(0)
        signOutSafely('/admin/login?reason=idle')
        return
      }

      setSecondsLeft(Math.ceil((IDLE_LIMIT_MS - idleMs) / 1000))
    }, CHECK_INTERVAL_MS)

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onActivity))
      clearInterval(timerId)
    }
  }, [enabled, sid])

  // ปิดการใช้งานอยู่ = ไม่ต้องนับอะไรทั้งนั้น ตัดสินตรงนี้แทนการ setState ใน effect
  const active = enabled && sid ? secondsLeft : null
  return {
    secondsLeft: active,
    // ใกล้หมดเวลาแล้ว = ถึงคิวเด้ง modal ถามว่าจะใช้งานต่อไหม
    isWarning: active !== null && active <= WARN_BEFORE_MS / 1000,
    stayActive: markActive,
  }
}

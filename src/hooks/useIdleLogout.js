import { useCallback, useEffect, useRef, useState } from 'react'
import { signOutSafely } from '../lib/supabase'

// ออกจากระบบอัตโนมัติเมื่อไม่มีการใช้งาน — สำหรับบัญชีเจ้าหน้าที่เท่านั้น
//
// ทำไมต้องมี: ตั้งแต่มีการเข้าสู่ระบบด้วยรหัสจากมือถือ เจ้าหน้าที่เข้าใช้งานบน PC เครื่องอื่น
// ได้ง่ายขึ้นมาก ซึ่งแปลว่าจะทิ้ง session ไว้บนเครื่องคนอื่นบ่อยขึ้นตามไปด้วย ปัญหาเดิมที่
// audit_logs บันทึกผู้กระทำผิดตัวจึงแค่ย้ายรูปแบบ ไม่ได้หายไป — จากเดิม "เข้าเป็นบัญชีคนอื่น"
// กลายเป็น "ทิ้งบัญชีตัวเองไว้ให้คนอื่นใช้ต่อ" ซึ่งในแง่การตรวจสอบก็ผิดตัวเหมือนกัน
//
// ประชาชนไม่โดน: ใช้แอปบนมือถือตัวเอง การเด้งออกทุก 30 นาทีมีแต่สร้างความรำคาญโดยไม่ได้
// ลดความเสี่ยงอะไร

const IDLE_LIMIT_MS = 30 * 60 * 1000  // 30 นาที — ยาวพอสำหรับงานเอกสารที่ต้องคิดนาน
const WARN_BEFORE_MS = 2 * 60 * 1000  // เตือนล่วงหน้า 2 นาที ให้กด "ใช้งานต่อ" ได้ทัน
const CHECK_INTERVAL_MS = 5000
const ACTIVITY_THROTTLE_MS = 5000
// เก็บใน localStorage ด้วย ไม่ใช่แค่ในหน่วยความจำ — ปิดแท็บแล้วเปิดใหม่ต้องนับต่อจากเดิม
// ไม่ใช่เริ่มนับหนึ่งใหม่ ไม่งั้นแค่ปิด-เปิดแท็บก็รีเซ็ตตัวจับเวลาได้ฟรี
const STORAGE_KEY = 'sl_last_activity'

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'focus']

function readLastActivity() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const value = raw ? Number(raw) : NaN
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeLastActivity(timestamp) {
  try {
    localStorage.setItem(STORAGE_KEY, String(timestamp))
  } catch {
    // โหมดส่วนตัว/พื้นที่เต็ม — ยังทำงานต่อได้ด้วยค่าที่อยู่ในหน่วยความจำ
  }
}

export function useIdleLogout(enabled) {
  // จำนวนวินาทีที่เหลือก่อนถูกออกจากระบบ (null = ยังไม่ถึงช่วงเตือน)
  const [warningSecondsLeft, setWarningSecondsLeft] = useState(null)
  const lastActivityRef = useRef(0)
  const loggingOutRef = useRef(false)

  const markActive = useCallback(() => {
    const now = Date.now()
    lastActivityRef.current = now
    writeLastActivity(now)
    setWarningSecondsLeft(null)
  }, [])

  useEffect(() => {
    if (!enabled) return

    // เริ่มจากค่าที่ค้างไว้ก่อนหน้า (ถ้ามี) เพื่อไม่ให้การเปิดแท็บใหม่รีเซ็ตตัวจับเวลา
    const stored = readLastActivity()
    lastActivityRef.current = stored ?? Date.now()
    if (stored === null) writeLastActivity(lastActivityRef.current)

    let throttleUntil = 0
    const onActivity = () => {
      const now = Date.now()
      if (now < throttleUntil) return
      throttleUntil = now + ACTIVITY_THROTTLE_MS
      lastActivityRef.current = now
      writeLastActivity(now)
      setWarningSecondsLeft((prev) => (prev === null ? prev : null))
    }

    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, onActivity, { passive: true })
    })

    const timerId = setInterval(() => {
      if (loggingOutRef.current) return
      // อ่านจาก localStorage ทุกครั้ง เผื่อผู้ใช้กำลังทำงานอยู่ในแท็บอื่นของแอปเดียวกัน
      const lastActivity = readLastActivity() ?? lastActivityRef.current
      lastActivityRef.current = lastActivity
      const idleMs = Date.now() - lastActivity

      if (idleMs >= IDLE_LIMIT_MS) {
        loggingOutRef.current = true
        setWarningSecondsLeft(null)
        signOutSafely('/admin/login?reason=idle')
        return
      }

      if (idleMs >= IDLE_LIMIT_MS - WARN_BEFORE_MS) {
        setWarningSecondsLeft(Math.ceil((IDLE_LIMIT_MS - idleMs) / 1000))
      } else {
        setWarningSecondsLeft((prev) => (prev === null ? prev : null))
      }
    }, CHECK_INTERVAL_MS)

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onActivity))
      clearInterval(timerId)
    }
  }, [enabled])

  // ปิดการใช้งานอยู่ = ไม่ต้องเตือนอะไรทั้งนั้น ตัดสินตรงนี้แทนการ setState ใน effect
  return { warningSecondsLeft: enabled ? warningSecondsLeft : null, stayActive: markActive }
}

import { useEffect, useRef } from 'react'

/**
 * เรียก callback ซ้ำเมื่อแท็บกลับมาแสดงผล และทุก intervalMs ขณะแท็บ active
 *
 * ใช้กับตัวเลขสาธารณะบนหน้าประชาชน (สถิติเรื่องร้องเรียน) ที่ดึงผ่าน RPC ซึ่ง anon เรียกได้
 * แต่ subscribe realtime ไม่ได้ — RLS ของตาราง complaints เป็น TO authenticated และ anon มี
 * เฉพาะ policy INSERT ดังนั้น postgres_changes จะไม่ส่ง event ให้ผู้เข้าชมที่ไม่ล็อกอินเลย
 * ส่วนคนที่ล็อกอินก็ได้เฉพาะแถว user_id = auth.uid() ของตัวเอง ซึ่งขยับตัวเลขรวมไม่ได้อยู่ดี
 * (จะทำ realtime จริงต้องใช้ Broadcast from Database — ประเมินแล้วว่าไม่คุ้ม trigger + topic
 * สาธารณะ ที่ปริมาณ ~1 คำร้อง/วัน)
 *
 * ไม่ยิงรอบแรกให้ ผู้เรียกต้อง fetch ครั้งแรกเองตาม effect ที่ผูกกับ tenant อยู่แล้ว
 * ไม่ตั้ง timer ตอนแท็บถูกซ่อน กัน background tab กิน quota ฟรีทิ้งเปล่า
 */
export function useVisibleRefresh(callback, { intervalMs = 60_000, enabled = true } = {}) {
  const callbackRef = useRef(callback)
  useEffect(() => { callbackRef.current = callback })

  useEffect(() => {
    if (!enabled) return
    const run = () => {
      if (document.visibilityState === 'visible') callbackRef.current()
    }
    document.addEventListener('visibilitychange', run)
    const timer = setInterval(run, intervalMs)
    return () => {
      document.removeEventListener('visibilitychange', run)
      clearInterval(timer)
    }
  }, [intervalMs, enabled])
}

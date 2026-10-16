import { useEffect, useState } from 'react'
import { isReservoirReport } from '../../lib/smallReservoirs'

// ข้อมูลเปลี่ยนสัปดาห์ละครั้ง — ถามซ้ำถี่กว่านี้ไม่ได้ของใหม่ (Worker จำคำตอบไว้ 6 ชม. อยู่แล้ว)
const REFRESH_MS = 30 * 60 * 1000
const RELOAD_ON_VISIBLE_MS = 10 * 60 * 1000

// แยกออกจาก SmallReservoirSection.jsx เพื่อให้ผังน้ำ (WaterDiagram) ใช้ร่วมได้ — กติกา eslint react-refresh ห้ามไฟล์คอมโพเนนต์
// export ฟังก์ชันอื่น · โค้ดด้านล่างคัดลอกตรงตัวจากของเดิม ไม่เปลี่ยนพฤติกรรม
// ดึงจาก Worker ของเราเอง (/api/small-reservoir) ไม่ผ่าน Supabase — ผูก visibilitychange ได้โดยไม่เกี่ยวกับกับดัก
// "มือถือค้างเพราะ token refresh" ใน NOTES §7 (ตัวนั้นเกิดกับคำสั่ง Supabase ที่ต้องยืนยันตัวตนเท่านั้น)
export function useReservoirReport(id) {
  const [state, setState] = useState({ id, report: null, failed: false, done: false })
  useEffect(() => {
    let alive = true
    let lastLoad = 0
    const controller = new AbortController()
    async function load() {
      if (document.hidden) return
      lastLoad = Date.now()
      try {
        const response = await fetch(`/api/small-reservoir?id=${encodeURIComponent(id)}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Unavailable')
        const report = await response.json()
        // ไม่เชื่อ JSON ตรงๆ — ชนิดข้อมูลผิดหรือผิดอ่างให้ถือว่าดึงไม่สำเร็จ
        if (!isReservoirReport(report, id)) throw new Error('Invalid report')
        if (alive) setState({ id, report, failed: Boolean(report.refreshFailed), done: true })
      } catch {
        // ล้มครั้งนี้แต่เคยมีของเดิม → แสดงของเดิมต่อพร้อมป้าย ไม่ล้างทิ้ง
        if (alive && !controller.signal.aborted) setState(prev => ({ id, report: prev.id === id ? prev.report : null, failed: true, done: true }))
      }
    }
    const onVisible = () => { if (!document.hidden && Date.now() - lastLoad > RELOAD_ON_VISIBLE_MS) load() }
    load()
    const timer = setInterval(load, REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [id])
  return state
}

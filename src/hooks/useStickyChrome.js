import { useLayoutEffect, useState } from 'react'

// หาตัวเลื่อนจริงที่ครอบหัวจอ — หน้าเจ้าหน้าที่ไม่ได้เลื่อนที่ window แต่เลื่อนใน <main overflow-y-auto> ของ App.jsx
// (เดิมหัวจอ + เมนูซ้ายจึงเลื่อนหายไปพร้อมเนื้อหา)
function scrollParentOf(el) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return p
  }
  return null
}

// วัดความสูงจริงของหัวจอที่ปักไว้ (headerRef) กับความสูงที่เหลือใต้หัวจอในตัวเลื่อน เพื่อให้เมนูซ้ายปักใต้หัวพอดี
// ไม่ hardcode 64px / 100dvh เพราะ
//   - แถวขวาของหัวจอ flex-wrap ได้ที่จอ 768–900px แล้วสูงขึ้น
//   - ช่าง (technician) มี Header ของ App ครอบอยู่เหนือตัวเลื่อน ตัวเลื่อนจึงเตี้ยกว่า 100dvh —
//     ถ้าใช้ 100dvh เมนูซ้ายจะยาวเกินจอและรายการท้ายสุดกดไม่ถึง
// คืน { top, height } เป็น px · ก่อนวัดเสร็จเป็น null (ผู้เรียกไม่ต้องใส่ style)
export default function useStickyChrome(headerRef) {
  const [box, setBox] = useState({ top: null, height: null })

  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return undefined
    const scroller = scrollParentOf(header)
    const measure = () => {
      const top = header.getBoundingClientRect().height
      const viewport = scroller ? scroller.clientHeight : window.innerHeight
      const height = Math.max(viewport - top, 0)
      setBox(prev => (prev.top === top && prev.height === height ? prev : { top, height }))
    }
    measure()
    // header ถูก display:none บนมือถือ (ขนาดเป็น 0) พอจอกว้างขึ้นถึง md ขนาดเปลี่ยน → วัดใหม่เอง
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    if (scroller) observer.observe(scroller)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [headerRef])

  return box
}

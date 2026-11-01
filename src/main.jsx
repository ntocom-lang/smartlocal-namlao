import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installEdgeImageFallback } from './lib/edgeImage'
import { captureViaApp } from './lib/platform'

// รูปที่วิ่งผ่านแคช edge (/_img/) ถ้าโหลดไม่ขึ้นให้กลับไปขอ URL เดิมของ Supabase — ต้องติดก่อน render ครั้งแรก
installEdgeImageFallback()

// เปิดมาจากแอปบนสโตร์ (โดเมนกลางพามาพร้อม ?via=app) — จำไว้ให้เมนู "เปลี่ยนหน่วยงาน" แล้วลบพารามิเตอร์ออก
// ต้องทำก่อน render ครั้งแรก router จะได้เห็น URL ที่สะอาดแล้ว (เหตุผลเต็มที่ src/lib/platform.js)
captureViaApp()

// เมื่อ SW ใหม่ activate แล้ว reload ทันทีเพื่อโหลด JS/CSS ใหม่จาก cache ล่าสุด
// skipWaiting() อยู่ใน sw.js — ทำให้ SW ใหม่ activate ทันที แต่ยังต้อง reload เอง
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload())
  navigator.serviceWorker.ready.then(reg => reg.update().catch(() => {}))
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

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

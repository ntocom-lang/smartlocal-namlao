import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { checkBehind, formatWarning } from './scripts/check-behind.mjs'

// เตือนเมื่อ master ขยับระหว่างที่ dev server เปิดค้างอยู่
//
// predev ตรวจให้แค่ตอนสตาร์ท ซึ่งไม่พอ เพราะ dev server ที่เปิดทิ้งไว้ข้ามวัน
// ผ่านด่านนั้นไปตั้งแต่ตอนที่โค้ดยังใหม่อยู่ (เกิดจริง 2026-09-07)
// ตัวนี้ไม่หยุด server และไม่แตะเบราว์เซอร์ — แค่พิมพ์เตือนใน terminal ที่รัน vite
const syncWatcher = () => ({
  name: 'smartlocal-sync-watcher',
  apply: 'serve',
  configureServer(server) {
    if (process.env.SKIP_SYNC_CHECK === '1') return

    // 3 นาที: ถี่พอที่จะรู้ตัวก่อนไล่หาสาเหตุผิดทาง แต่ไม่ยิง git fetch ถี่จนรบกวน
    const INTERVAL_MS = 3 * 60 * 1000
    let lastReportedHead = null

    const tick = () => {
      let result
      try {
        result = checkBehind()
      } catch {
        return // ตรวจไม่ได้ก็ปล่อยไป ห้ามทำให้ dev server ล้ม
      }
      if (result.ok) return

      // เตือนซ้ำเฉพาะตอนที่ upstream ขยับใหม่ ไม่ใช่ทุก 3 นาทีจนกลายเป็นเสียงรบกวน
      const head = result.commits[0]
      if (head === lastReportedHead) return
      lastReportedHead = head
      server.config.logger.warn(formatWarning(result))
    }

    const timer = setInterval(tick, INTERVAL_MS)
    timer.unref?.() // ห้ามกัน process ไม่ให้ปิดตอน Ctrl+C
    server.httpServer?.on('close', () => clearInterval(timer))
  },
})

export default defineConfig({
  base: '/',

  build: {
    // ห้ามล้าง dist ก่อน build — asset ของรุ่นก่อนต้องอยู่ต่ออีกพักหนึ่ง
    //
    // HTML ที่ค้างอยู่ในเบราว์เซอร์ ใน service worker หรือในแท็บที่ผู้ใช้เปิดทิ้งไว้
    // ยังชี้ไปที่ชื่อไฟล์ของรุ่นก่อน ถ้าล้างทิ้งทุกรอบ คนกลุ่มนั้นจะได้ 404 = หน้าขาว
    // scripts/postbuild.js เป็นตัวเก็บกวาด เก็บไว้ 2 รุ่นแล้วลบที่เก่ากว่านั้น
    emptyOutDir: false,

    // ให้ postbuild รู้ว่าไฟล์ไหนเป็นของรุ่นปัจจุบันจริงๆ — readdir ใช้ไม่ได้แล้ว
    // เพราะ dist ไม่ถูกล้าง จะปนกับของรุ่นก่อน (postbuild ลบ .vite/ ทิ้งหลังอ่านเสร็จ)
    manifest: true,
  },

  server: {
    watch: {
      ignored: ['**/dist/**', '**/dev-dist/**', '**/.chrome-test-profiles/**']
    }
  },
  plugins: [
    syncWatcher(),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: {
        // index.html ไม่มีอยู่ใน dist ตอน deploy แล้ว — scripts/postbuild.js เปลี่ยนชื่อ
        // เป็น _template.html ให้ worker ฉีด og:tag แต่ manifest ถูกสร้างตอน vite build
        // ซึ่งยังเห็นไฟล์นั้นอยู่ จึงติดเข้ามาใน precache list
        //
        // ผลคือทุกครั้งที่ SW ติดตั้ง จะยิง GET /index.html ซึ่งไม่ตรงไฟล์ไหนใน dist
        // เลยตกไปเรียก worker (เผาโควตา) แล้วได้ HTML ของ อปท. นั้นมาเก็บไว้ใน
        // precache โดยไม่มีโค้ดตรงไหนเรียกใช้เลย เพราะ sw.js ไม่ได้ลงทะเบียน
        // NavigationRoute ไว้ — navigation ทุกครั้งวิ่งเน็ตเสมอ
        //
        // ต้องใส่ node_modules กลับมาเองด้วย เพราะค่านี้ทับ default ทั้งก้อน
        globIgnores: ['**/node_modules/**/*', 'index.html'],
      },
      manifest: false, // manifest inject dynamically per-tenant in TenantContext
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
})

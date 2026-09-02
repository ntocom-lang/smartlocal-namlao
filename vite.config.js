import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

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

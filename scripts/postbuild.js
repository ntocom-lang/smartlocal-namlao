import { renameSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
// เอา index.html ออกจากผลลัพธ์ที่ host จะ serve เป็นไฟล์ตรงๆ เหตุผลเดียวกันทั้งสอง host:
// ถ้ามี index.html อยู่ request "/" จะถูกตอบด้วยไฟล์นั้นทันทีโดยไม่ผ่านโค้ดฝั่งเซิร์ฟเวอร์
// แล้ว og:tag ตาม อปท. จะไม่ถูกฉีด (แชร์ลิงก์ลงไลน์แล้วขึ้นชื่อผิด)
// พอไม่มีไฟล์ไหน match ทุก route ของ SPA จึงตกไปที่ตัวสร้าง HTML เสมอ
renameSync(join(root, 'dist/index.html'), join(root, 'dist/_template.html'))

// Cloudflare Workers อ่านไฟล์นี้จาก dist ผ่าน ASSETS binding ได้เลย ไม่ต้อง copy
// ที่ยัง copy ไป api/ เพราะ Vercel ยังถูกเก็บไว้เป็นทางถอยระหว่างย้าย host
// (Vercel bundle เฉพาะไฟล์ที่อยู่ directory เดียวกับ function) — ลบบรรทัดนี้พร้อม
// vercel.json กับ api/ ตอนปลด Vercel ดู docs/hosting-and-domains.md
copyFileSync(join(root, 'dist/_template.html'), join(root, 'api/_template.html'))

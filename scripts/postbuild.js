import { renameSync, copyFileSync, readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
// ตรวจว่า config ของ Supabase ถูกฝังลงบันเดิลจริง ก่อนปล่อยให้ deploy ต่อ
//
// predeploy-check.js ตรวจ "ไฟล์ env มีคีย์ครบไหม" ไปแล้ว แต่นั่นเป็นการตรวจต้นทาง
// ตรงนี้ตรวจของจริงคือ artifact ที่ vite เพิ่งเขียนออกมา ถ้า import.meta.env ว่าง
// ตอน build vite จะแทนที่ด้วย undefined แล้ว URL ของ Supabase จะไม่ปรากฏใน
// dist/assets/ เลยสักไฟล์ ซึ่งแปลว่าแอปจะตายตอนโหลดด้วย
// "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local"
//
// เช็คนี้อยู่ใน postbuild ไม่ใช่ predeploy เพราะ postbuild ทำงานทุกครั้งที่
// npm run build ไม่ว่าจะ deploy หรือไม่ จึงคุ้มกัน test:local-build ด้วย
// ทำก่อน rename เพื่อให้ตอนล้ม dist ยังอยู่ในสภาพเดิมให้ไล่ดูได้
const assetsDir = join(root, 'dist/assets')
const bundleHasSupabase = readdirSync(assetsDir)
  .filter((f) => f.endsWith('.js'))
  .some((f) => readFileSync(join(assetsDir, f), 'utf8').includes('.supabase.co'))

if (!bundleHasSupabase) {
  console.error('\n\u274c บันเดิลที่ build ออกมาไม่มี config ของ Supabase ฝังอยู่\n')
  console.error('   แอปจะขึ้นหน้าขาวทันทีที่เปิด (supabase.js โยน Error ตอน import)')
  console.error('   สาเหตุที่พบบ่อย: build จาก directory ที่ไม่มี .env.local (ไฟล์นี้ถูก git ignore)')
  console.error('   ตรวจ VITE_SUPABASE_URL กับ VITE_SUPABASE_ANON_KEY แล้ว build ใหม่\n')
  process.exit(1)
}

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

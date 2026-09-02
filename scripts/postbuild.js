import { renameSync, copyFileSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'fs'
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

// ─── เก็บ asset ไว้ 2 รุ่น แล้วลบที่เก่ากว่านั้น ────────────────────────────────
//
// ทำไมต้องเก็บของรุ่นก่อน: vite.config.js ตั้ง emptyOutDir: false ไว้ เพราะ HTML ที่ค้าง
// ในเบราว์เซอร์/service worker/แท็บที่เปิดทิ้งไว้ ยังชี้ไปที่ชื่อไฟล์ของรุ่นก่อน
// ถ้าไฟล์หายทันทีที่ deploy คนกลุ่มนั้นจะได้ 404 แล้วเห็นหน้าขาว
//
// ทำไมไม่เก็บทุกรุ่น: dist จะบวมไม่รู้จบ และ wrangler อัปทุกไฟล์ในนั้นขึ้น Cloudflare
// 2 รุ่นพอสำหรับช่วงเปลี่ยนผ่าน — คนที่ค้างเกินหนึ่งรอบ deploy ควรได้ของใหม่อยู่แล้ว
//
// รู้ได้ยังไงว่าไฟล์ไหนเป็นของรุ่นปัจจุบัน: อ่านจาก manifest ที่ vite เขียน ไม่ใช่ readdir
// (readdir จะเห็นของรุ่นก่อนที่ยังไม่ถูกลบปนมาด้วย)
const KEEP_GENERATIONS = 2
const manifestPath = join(root, 'dist/.vite/manifest.json')
const historyPath = join(root, 'dist/.asset-generations.json')

if (!existsSync(manifestPath)) {
  console.error('❌ ไม่พบ dist/.vite/manifest.json — build.manifest ใน vite.config.js ถูกปิดไปหรือเปล่า')
  console.error('   ถ้าไม่มีไฟล์นี้ ตัวเก็บกวาดแยกไม่ออกว่า asset ไหนเป็นของรุ่นปัจจุบัน')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const currentFiles = new Set()
for (const entry of Object.values(manifest)) {
  for (const f of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
    if (typeof f === 'string' && f.startsWith('assets/')) currentFiles.add(f.slice('assets/'.length))
  }
}

// manifest ไม่ครอบไฟล์ที่ปลั๊กอินอื่นเขียนเองลง assets/ (ถ้ามีในอนาคต)
// จึงกันไว้: ไฟล์ที่ mtime ใหม่กว่าตอนเริ่มสคริปต์นี้ ถือเป็นของรุ่นปัจจุบันด้วย
if (currentFiles.size === 0) {
  console.error('❌ manifest ไม่มีไฟล์ใน assets/ เลย — ผิดปกติ ไม่กล้าลบอะไรทั้งนั้น')
  process.exit(1)
}

let history = []
try {
  history = JSON.parse(readFileSync(historyPath, 'utf8')).generations ?? []
} catch {
  // ไม่มีไฟล์ประวัติ = build แรกหลังเปลี่ยนวิธีนี้ ถือว่าไม่มีรุ่นก่อนให้เก็บ
}

const generations = [
  { builtAt: new Date().toISOString(), files: [...currentFiles] },
  ...history,
].slice(0, KEEP_GENERATIONS)

const keep = new Set(generations.flatMap((g) => g.files))
const removed = []
for (const file of readdirSync(assetsDir)) {
  if (keep.has(file)) continue
  rmSync(join(assetsDir, file))
  removed.push(file)
}

writeFileSync(historyPath, JSON.stringify({ generations }, null, 2))

// manifest เป็นข้อมูลภายในของ build ไม่ควรถูก serve ออกไปพร้อม dist
rmSync(join(root, 'dist/.vite'), { recursive: true, force: true })

const kept = keep.size - currentFiles.size
console.log(`✅ asset รุ่นปัจจุบัน ${currentFiles.size} ไฟล์ + รุ่นก่อนที่เก็บไว้ ${kept} ไฟล์` +
  (removed.length ? ` — ลบของเก่า ${removed.length} ไฟล์` : ' — ไม่มีของเก่าให้ลบ'))

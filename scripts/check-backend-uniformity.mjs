// ด่านกันหลังบ้านของแต่ละ อปท. หลุดจากกัน
//
// กติกาที่ผู้ใช้กำหนดไว้: "ระบบหลังบ้านแก้ที่ อปท. ไหน อปท. อื่นต้องได้ตามด้วย ต่างกันได้แค่หน้าตา
// หน้าแรกเท่านั้น" — ระบบนี้เป็นโค้ดชุดเดียว deploy ครั้งเดียวอยู่แล้ว สิ่งที่ทำให้หลุดกติกาได้จริง
// มี 2 ทาง สคริปต์นี้ปิดทั้งสองทาง:
//
//   A. โค้ดหลังบ้านแตกพฤติกรรมตาม อปท. — if (slug === 'namlao') / ui_style === ... ในหน้า staff/admin
//   B. เพิ่มโมดูลใหม่เข้า MANAGED_MODULE_KEYS แล้วลืมเติมคีย์ลง municipalities.enabled_modules
//      ผลคือ อปท. ที่ตกหล่นจะไม่เห็นเมนูนั้นเลย ทั้งที่ควรได้เหมือนกันทุกที่ (เมนูหายเงียบ ไม่มี error)
//
// รันเองในเครื่อง: npm run check:uniform
// ใน CI รันก่อน build (ดู .github/workflows/deploy.yml)
// ข้ามชั่วคราวเมื่อจำเป็นจริง: ALLOW_MODULE_DRIFT=1
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
let failed = false
const fail = (msg) => { console.error(`\n❌ ${msg}`); failed = true }
const ok = (msg) => console.log(`✅ ${msg}`)

// ── A. โค้ดหลังบ้านต้องไม่แตกตาม อปท. ────────────────────────────────────────
const BACKEND_PATHS = [
  'src/pages/StaffDashboard.jsx',
  'src/pages/AdminDashboard.jsx',
  'src/components/admin',
  'src/components/staff',
]
// หน้าที่ "ตั้งค่าหน้าบ้าน" โดยตรง จำเป็นต้องอ่าน ui_style เพื่อโชว์ว่าตอนนี้เลือกธีมไหนอยู่
const THEME_SETTING_FILES = [
  'src/components/admin/ThemeSettingsAdmin.jsx',
  'src/components/admin/SystemSettingsAdmin.jsx',
]
// จับเฉพาะการ "เทียบค่า" ที่ทำให้พฤติกรรมแตกกัน ไม่จับการส่ง slug เป็นข้อมูล (municipality: tenant?.slug)
const FORBIDDEN = [
  { re: /\bslug\s*===/, label: "เทียบ slug ตรงๆ (slug === '...')" },
  { re: /ui_style\s*===/, label: "เทียบ ui_style ตรงๆ (ui_style === '...')" },
]

function walk(target) {
  const abs = path.join(ROOT, target)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [target]
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(d =>
    walk(path.join(target, d.name)))
}

const backendFiles = BACKEND_PATHS.flatMap(walk)
  .filter(f => /\.jsx?$/.test(f))
  .filter(f => !THEME_SETTING_FILES.includes(f.split(path.sep).join('/')))

const violations = []
for (const file of backendFiles) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('//')) return // คอมเมนต์อธิบายกติกาไม่นับ
    for (const { re, label } of FORBIDDEN) {
      if (re.test(line)) violations.push(`${file.split(path.sep).join('/')}:${i + 1} — ${label}`)
    }
  })
}

if (violations.length) {
  fail('หน้าหลังบ้านมีเงื่อนไขแยกราย อปท. ซึ่งผิดกติกา "หลังบ้านต้องเหมือนกันทุกแห่ง"')
  violations.forEach(v => console.error(`   ${v}`))
  console.error('   ถ้าต้องการให้บางหน่วยงานไม่มีฟีเจอร์นี้ ให้ทำเป็นโมดูลใน src/lib/staffModules.js แทน')
} else {
  ok(`หลังบ้าน ${backendFiles.length} ไฟล์ ไม่มีเงื่อนไขแยกราย อปท.`)
}

// ── B. ทุก อปท. ต้องมีคีย์โมดูลครบเท่ากัน ─────────────────────────────────────
const { MANAGED_MODULE_KEYS } = await import(
  pathToFileURL(path.join(ROOT, 'src/lib/staffModules.js')).href
)

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.log('⏭️  ข้ามการตรวจ enabled_modules — ไม่มี VITE_SUPABASE_URL/ANON_KEY ใน env')
} else {
  const res = await fetch(`${url}/rest/v1/municipalities?select=slug,enabled_modules`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    console.log(`⏭️  ข้ามการตรวจ enabled_modules — อ่านตาราง municipalities ไม่ได้ (HTTP ${res.status})`)
  } else {
    const rows = await res.json()
    const missing = []
    for (const row of rows) {
      // enabled_modules = null แปลว่า "เปิดทุกโมดูล" ตามพฤติกรรมใน isModuleEnabled() ไม่ถือว่าขาด
      if (!Array.isArray(row.enabled_modules)) continue
      const lack = MANAGED_MODULE_KEYS.filter(k => !row.enabled_modules.includes(k))
      if (lack.length) missing.push({ slug: row.slug, lack })
    }
    if (missing.length) {
      // ปิดโมดูลไว้ตั้งใจ (ลูกค้าไม่ได้ซื้อ) กับลืมเติมคีย์ตอนเพิ่มโมดูลใหม่ หน้าตาเหมือนกันใน DB
      // จึงเตือนพร้อมบอกวิธีแก้ แต่ให้ผ่านได้ถ้าตั้งใจ — บล็อก deploy เฉพาะตอนที่ทุกแห่งขาดคีย์
      // เดียวกันหมด ซึ่งแปลว่าเป็นโมดูลใหม่ที่ยังไม่เคยเติมลง DB เลย ไม่ใช่การตั้งใจปิดรายเจ้า
      const everywhere = MANAGED_MODULE_KEYS.filter(k =>
        missing.length === rows.filter(r => Array.isArray(r.enabled_modules)).length
        && missing.every(m => m.lack.includes(k)))
      console.log('\n⚠️  อปท. ที่ไม่มีคีย์โมดูลครบ (ถ้าเป็นการตั้งใจปิดตามแพ็กเกจที่ขาย ถือว่าปกติ):')
      missing.forEach(m => console.log(`   ${m.slug}: ขาด ${m.lack.join(', ')}`))
      if (everywhere.length) {
        fail(`โมดูล ${everywhere.join(', ')} ไม่มีอยู่ในแถวไหนเลย — น่าจะเพิ่มเข้า staffModules.js แล้วลืมเติมลง DB`)
        console.error('   เมนูจะหายจากทุก อปท. ทันทีที่ deploy รันคำสั่งนี้ก่อน:')
        console.error(`   update public.municipalities set enabled_modules = enabled_modules || array['${everywhere.join("','")}'];`)
      }
    } else {
      ok(`ทุก อปท. (${rows.length} แห่ง) มีคีย์โมดูลครบ ${MANAGED_MODULE_KEYS.length} ตัว`)
    }
  }
}

if (failed && process.env.ALLOW_MODULE_DRIFT !== '1') {
  console.error('\n   ตั้งใจปล่อยผ่านจริงๆ: ALLOW_MODULE_DRIFT=1 npm run check:uniform\n')
  process.exit(1)
}
if (failed) console.log('\n⚠️  ALLOW_MODULE_DRIFT=1 — ข้ามด่านนี้ตามที่สั่ง')

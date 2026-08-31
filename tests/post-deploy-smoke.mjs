// ตรวจหน้าเว็บจริงหลัง deploy — ด่านสุดท้ายที่ build/lint แทนกันไม่ได้
//
// ที่ต้องมี: 2026-08-31 production ขาวทั้งหน้าเพราะ ReferenceError ตอน runtime
// (import ไอคอนหาย แต่ JSX ยังเรียกใช้) ทั้ง vite build และ wrangler deploy
// รายงานว่าสำเร็จทุกขั้น เพราะไม่มีใครในสายนั้นเปิดหน้าเว็บดูสักครั้ง
// รอบเดียวกันนั้นยังมี deploy ที่ bundle ไม่มี env ติดไปด้วย ซึ่งก็ผ่านทุกด่านเหมือนกัน
//
// กติกาที่ห้ามแก้:
//
// 1. ต้องเปิดแบบ "ยังไม่ล็อกอิน" เท่านั้น — ห้ามใช้ .chrome-test-profiles
//    บั๊ก 2026-08-31 อยู่ในกิ่ง `session ? <อวาตาร์> : <User />` ฝั่งที่ยังไม่ล็อกอิน
//    ใครที่มี session ค้างจะไม่เห็นหน้าขาวเลย ทั้งที่ประชาชนที่เปิดครั้งแรกเห็น 100%
//    ด่านที่รันด้วย session ค้างจะเขียวสวยตลอดในขณะที่เว็บพังอยู่
//
// 2. ต้องบล็อก service worker — PWA ที่ติดตั้งไว้เสิร์ฟ bundle เก่าจาก precache ได้
//    ซึ่งจะกลบความจริงว่า deploy รอบนี้พัง
//
// ตรวจ 4 อย่างต่อ 1 โดเมน:
//   - #root มี child จริง (React mount สำเร็จ ไม่ใช่แค่ HTML 200)
//   - <title> ถูกฉีดชื่อ อปท. โดย worker และชื่อนั้นโผล่ในเนื้อหน้าด้วย
//     (จับทั้ง og:tag พังและ TenantContext โหลดข้อมูลไม่ได้)
//   - console ไม่มี error และไม่มี pageerror
//   - ทุก <script src> / <link rel=stylesheet> ตอบด้วย content-type ที่ถูกต้อง
//     ไม่ใช่ HTML — กันเคสไฟล์ hash เก่าหายแล้วเซิร์ฟเวอร์ตอบ SPA shell กลับมา
//     ซึ่งเบราว์เซอร์จะรัน HTML เป็น JS แล้วตายด้วย "Unexpected token '<'"
//
// ตัวอย่าง
//   node tests/post-deploy-smoke.mjs
//   node tests/post-deploy-smoke.mjs --host namlao.rk-networks.com --host demo.rk-networks.com
//   node tests/post-deploy-smoke.mjs --headed

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const DEFAULT_HOSTS = ['namlao.rk-networks.com', 'demo.rk-networks.com']

// ชื่อใน <title> ของ shell ก่อนถูก worker ฉีดทับ ถ้ายังเห็นค่านี้แปลว่า worker
// หา อปท. จาก hostname ไม่เจอ หรือ Supabase ตอบไม่ทันใน 5 วินาที
const UNINJECTED_TITLE = 'SmartLocal'

function parseArgs(argv) {
  const args = { hosts: [], headed: false, timeout: 30000, expectLocalBuild: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--host') args.hosts.push(argv[++i])
    else if (flag === '--headed') args.headed = true
    else if (flag === '--timeout') args.timeout = Number(argv[++i])
    else if (flag === '--expect-local-build') args.expectLocalBuild = true
    else throw new Error(`Unknown argument: ${flag}`)
  }
  if (!args.hosts.length) args.hosts = DEFAULT_HOSTS
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error('--timeout ต้องเป็นตัวเลขมิลลิวินาที')
  return args
}

// ชื่อไฟล์ bundle หลักของ build ที่เพิ่งทำเสร็จในเครื่อง
//
// ใช้ยืนยันว่า HTML ที่ production เสิร์ฟอยู่ชี้ไปที่ของที่เพิ่ง deploy จริง ไม่ใช่ของรอบก่อน
// ที่ยังค้างอยู่ใน cache ชั้นใดชั้นหนึ่ง — ไฟล์ hash เก่าถูกลบไปแล้วทุกรอบที่ build
// (vite ล้าง dist ก่อนเขียนใหม่) HTML ที่ค้างจึงชี้ไปหาไฟล์ที่ไม่มีอยู่จริง
function localBuildBundle() {
  const shell = path.join(process.cwd(), 'dist/_template.html')
  const html = readFileSync(shell, 'utf8')
  // มองหา src ของ <script> ตัวแรกที่ชี้เข้า /assets/ แล้วตัดเอาเฉพาะชื่อไฟล์
  // ไม่ใช้ regex เพราะอ่านยากกว่าและพังง่ายเวลา vite เปลี่ยนลำดับ attribute
  for (const chunk of html.split('<script').slice(1)) {
    const srcAt = chunk.indexOf('src="')
    if (srcAt < 0) continue
    const from = srcAt + 5
    const src = chunk.slice(from, chunk.indexOf('"', from))
    if (!src.includes('/assets/') || !src.endsWith('.js')) continue
    return src.slice(src.lastIndexOf('/') + 1)
  }
  throw new Error('อ่านชื่อ bundle จาก dist/_template.html ไม่ได้ — build เสร็จแล้วหรือยัง')
}

// ไฟล์ที่เบราว์เซอร์จะ "รัน" หรือ "ตีความ" ไม่ใช่แค่แสดง ถ้าได้ HTML มาแทนจะพังเงียบ
const EXPECTED_TYPE = {
  script: /javascript|ecmascript/i,
  stylesheet: /text\/css/i,
}

async function checkHost(browser, host, timeout, expectBundle) {
  const origin = `https://${host}`
  const problems = []

  // context ใหม่ทุกรอบ = ไม่มี cookie ไม่มี storage ไม่มี session — เหมือนประชาชนเปิดครั้งแรก
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`)
  })
  page.on('pageerror', (err) => {
    problems.push(`uncaught exception: ${err.message}`)
  })

  try {
    const response = await page.goto(origin, { waitUntil: 'networkidle', timeout })
    if (!response || !response.ok()) {
      problems.push(`GET / ตอบ ${response ? response.status() : 'ไม่มี response'}`)
    }

    // React ต้อง mount จริง ไม่ใช่แค่ HTML มาถึง — เคสหน้าขาวคือ #root ว่างเปล่า
    const rootChildren = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? -1)
    if (rootChildren < 0) problems.push('ไม่พบ #root ในหน้า')
    else if (rootChildren === 0) problems.push('#root ว่างเปล่า — React ไม่ได้ render (หน้าขาว)')

    const title = (await page.title()).trim()
    if (!title || title === UNINJECTED_TITLE) {
      problems.push(`worker ไม่ได้ฉีดชื่อ อปท. ลง <title> (ได้ "${title}")`)
    } else {
      // ชื่อที่ worker ฉีดมาจาก DB ส่วนเนื้อหน้ามาจาก TenantContext ที่ client ยิงเอง
      // ถ้าสองทางนี้ไม่ตรงกันแปลว่าฝั่ง client โหลดข้อมูลหน่วยงานไม่สำเร็จ
      const body = await page.evaluate(() => document.body.innerText)
      if (!body.includes(title)) problems.push(`ไม่พบชื่อ "${title}" ในเนื้อหน้า — TenantContext อาจโหลดไม่สำเร็จ`)
    }

    // ตรวจ asset ที่หน้าอ้างถึงทีละไฟล์ ด้วย request แยกจากหน้า (ไม่พึ่ง cache ของหน้า)
    const assets = await page.evaluate(() => [
      ...[...document.querySelectorAll('script[src]')].map((el) => ({ kind: 'script', url: el.src })),
      ...[...document.querySelectorAll('link[rel="stylesheet"][href]')].map((el) => ({ kind: 'stylesheet', url: el.href })),
    ])
    if (expectBundle) {
      const served = assets.some((a) => a.kind === 'script' && a.url.endsWith(`/${expectBundle}`))
      if (!served) {
        problems.push(`HTML ที่เสิร์ฟอยู่ไม่ได้ชี้ไปที่ ${expectBundle} ของ build ล่าสุด — ของเก่ายังค้างอยู่`)
      }
    }

    for (const asset of assets) {
      if (!asset.url.startsWith(origin)) continue   // ฟอนต์/CDN ภายนอกไม่ใช่ของที่เรา deploy
      const res = await context.request.get(asset.url, { timeout })
      const type = res.headers()['content-type'] ?? ''
      if (!res.ok()) {
        problems.push(`${asset.kind} ${asset.url} ตอบ ${res.status()}`)
      } else if (!EXPECTED_TYPE[asset.kind].test(type)) {
        problems.push(`${asset.kind} ${asset.url} ได้ content-type "${type}" — เซิร์ฟเวอร์น่าจะตอบ HTML shell แทนไฟล์จริง`)
      }
    }
  } catch (err) {
    problems.push(`เปิดหน้าไม่สำเร็จ: ${err.message}`)
  } finally {
    await context.close()
  }

  return problems
}

const args = parseArgs(process.argv.slice(2))
const expectBundle = args.expectLocalBuild ? localBuildBundle() : null
if (expectBundle) console.log(`เทียบกับ bundle ของ build ล่าสุด: ${expectBundle}`)

const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed })

let failed = 0
try {
  for (const host of args.hosts) {
    const problems = await checkHost(browser, host, args.timeout, expectBundle)
    if (problems.length) {
      failed += 1
      console.error(`\n\u274c ${host}`)
      for (const p of problems) console.error(`   ${p}`)
    } else {
      console.log(`\u2705 ${host}`)
    }
  }
} finally {
  await browser.close()
}

if (failed) {
  console.error(`\n${failed}/${args.hosts.length} โดเมนมีปัญหา — อย่าเพิ่งปิดงาน deploy รอบนี้\n`)
  process.exit(1)
}
console.log(`\nผ่านครบ ${args.hosts.length} โดเมน`)

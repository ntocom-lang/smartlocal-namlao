// ทำภาพสำหรับหน้าแอปบน Google Play จากหน้าจอจริงของระบบ — รัน: npm run store:assets
//
// ภาพหน้าจอ 8 ภาพมาจากโดเมนกลาง (หน้าเลือกหน่วยงาน) และ อปท. สาธิต (demo) บน production แบบอ่านอย่างเดียว
// ไม่ล็อกอิน ไม่กรอกอะไร และไม่มีข้อมูลส่วนบุคคลของประชาชน — ห้ามเปลี่ยนไปใช้ อปท. จริงเพราะหน้าแรกอาจมีข้อมูลของประชาชน
// ผลลัพธ์อยู่นอก repo (ค่าเริ่ม D:\tmp\store-assets) — ภาพทำซ้ำได้เสมอ จึงไม่เก็บไฟล์ภาพไว้ใน git
//
// ขนาดตามกติกา Google Play (support.google.com/googleplay/android-developer/answer/9866151 ตรวจ 2569-11-03):
//   ภาพหน้าจอ: JPEG หรือ PNG 24 บิตไม่มีอัลฟา · ด้านสั้น ≥ 320 ด้านยาว ≤ 3840 · ด้านยาวไม่เกิน 2 เท่าของด้านสั้น
//              ขั้นต่ำ 2 ภาพ สูงสุด 8 ภาพ · เข้าโปรโมชันหน้าจอใหญ่ได้ถ้ามี ≥ 4 ภาพ ขนาด ≥ 1080x1920 แนวตั้ง 9:16
//   ภาพ feature graphic: 1024x500 JPEG หรือ PNG 24 บิตไม่มีอัลฟา
//   ไอคอน 512x512 PNG 32 บิตมีอัลฟา ≤ 1024KB → ใช้ public/icons/icon-512x512.png (ตรวจในเทสต์)
// ห้ามมีในภาพ: ภาพเครื่อง/ขอบมือถือ ป้ายสโตร์ ข้อความโปรโมชัน ("ฟรี" "อันดับ 1" ...) ปุ่มชวนติดตั้ง — จึงไม่ใส่คำบรรยายทับภาพหน้าจอ
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { PLATFORM_APP_NAME, PLATFORM_DOMAIN } from '../src/lib/platform.js'

export const SCREEN = Object.freeze({ width: 360, height: 640, scale: 3 }) // 1080x1920 = 9:16
export const FEATURE_GRAPHIC = Object.freeze({ width: 1024, height: 500 })
const DEMO = `https://demo.${PLATFORM_DOMAIN}`

// อ่านขนาดและชนิดสีจากหัวไฟล์ PNG (ตรวจว่าไม่มีช่องอัลฟา: colorType 2 = RGB, 6 = RGBA)
export function pngInfo(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('ไม่ใช่ไฟล์ PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25] }
}

// ตรวจภาพหนึ่งภาพตามกติกาของ Google (คืนข้อความผิดพลาด ว่าง = ผ่าน)
export function checkScreenshot({ width, height, colorType }) {
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  if (colorType !== 2) return 'ต้องเป็น PNG 24 บิตไม่มีช่องอัลฟา'
  if (short < 320 || long > 3840) return `ขนาด ${width}x${height} ต้องอยู่ระหว่าง 320 ถึง 3840 ต่อด้าน`
  if (long > short * 2) return `ด้านยาวเกิน 2 เท่าของด้านสั้น (${width}x${height})`
  return ''
}

// ลำดับภาพ = ลำดับที่แสดงบนหน้าสโตร์ ภาพแรกคือหน้าแรกที่ผู้ใช้เห็นหลังติดตั้ง
export const SHOTS = [
  { id: '01-เลือกหน่วยงาน', url: `https://app.${PLATFORM_DOMAIN}/`, ready: 'เลือกหน่วยงานของท่าน' },
  { id: '02-หน้าแรก', url: `${DEMO}/`, ready: 'ร้องเรียน/ร้องทุกข์' },
  { id: '03-ร้องเรียน', url: `${DEMO}/complaint`, ready: 'เลือกหมวดหมู่เพื่อแจ้งเรื่อง' },
  { id: '04-บริการประชาชน', url: `${DEMO}/doc-request`, ready: 'เลือกบริการที่ต้องการ' },
  { id: '05-ตารางขยะ', url: `${DEMO}/waste`, ready: 'ขยะอันตรายคืออะไร' },
  { id: '06-น้ำ-ฝน', url: `${DEMO}/water-situation`, ready: 'อัปเดตล่าสุด' },
  { id: '07-สภาพอากาศ', url: `${DEMO}/weather`, ready: 'สูงสุด:' },
  { id: '08-ปฏิทินกิจกรรม', url: `${DEMO}/events`, ready: 'ปฏิทินกิจกรรม' },
]

function featureGraphicHtml() {
  const icon = readFileSync(new URL('../public/icons/app-icon.svg', import.meta.url), 'utf8')
    .replace(/width="512" height="512"/, 'width="230" height="230"')
  const chips = ['ร้องเรียน/ร้องทุกข์', 'ตารางวันเก็บขยะ', 'สถานการณ์น้ำ-ฝน', 'จองรถรับ-ส่งผู้ป่วย']
  return `<!doctype html><html lang="th"><body style="margin:0;width:${FEATURE_GRAPHIC.width}px;height:${FEATURE_GRAPHIC.height}px;overflow:hidden;
    background:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 55%,#2563eb 100%);color:#fff;
    font-family:'Noto Sans Thai','Leelawadee UI','Tahoma',sans-serif;display:flex;align-items:center;gap:44px;padding:0 64px;box-sizing:border-box">
    <div style="flex:none;border-radius:52px;box-shadow:0 0 0 6px rgba(255,255,255,.9),0 14px 28px rgba(0,0,0,.3)">${icon}</div>
    <div>
      <div style="font-size:92px;font-weight:700;line-height:1.15">${PLATFORM_APP_NAME}</div>
      <div style="font-size:36px;margin-top:6px;opacity:.95">บริการประชาชนออนไลน์ของ อปท.</div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:28px;max-width:640px">
        ${chips.map((c) => `<span style="background:rgba(255,255,255,.16);border:1.5px solid rgba(255,255,255,.4);border-radius:999px;padding:6px 20px;font-size:26px">${c}</span>`).join('')}
      </div>
    </div>
  </body></html>`
}

async function main() {
  const outDir = process.env.STORE_ASSETS_DIR || 'D:\\tmp\\store-assets'
  mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  let failed = 0
  try {
    for (const shot of SHOTS) {
      // บริบทใหม่ทุกภาพ — หน้าเลือกหน่วยงานต้องไม่มีหน่วยงานที่จำไว้จากภาพก่อน
      const ctx = await browser.newContext({
        viewport: { width: SCREEN.width, height: SCREEN.height }, deviceScaleFactor: SCREEN.scale,
        isMobile: true, hasTouch: true, locale: 'th-TH', timezoneId: 'Asia/Bangkok',
      })
      const page = await ctx.newPage()
      try {
        await page.goto(shot.url, { waitUntil: 'networkidle', timeout: 60000 })
        // attached ไม่ใช่ visible — ข้อความเดียวกันบางหน้ามีซ้ำสำหรับจอกว้างที่ซ่อนอยู่ ตัวแรกที่เจออาจมองไม่เห็นจนหมดเวลา
        await page.getByText(shot.ready).first().waitFor({ state: 'attached', timeout: 30000 })
        await page.waitForTimeout(2500) // ให้ตัวเลข/ภาพที่ค่อยๆ ขึ้นนิ่งก่อนถ่าย
        const file = join(outDir, `${shot.id}.png`)
        await page.screenshot({ path: file })
        const problem = checkScreenshot(pngInfo(readFileSync(file)))
        if (problem) { failed++; console.log(`  ✗ ${shot.id}: ${problem}`) } else console.log(`  ✓ ${file}`)
      } catch (error) {
        failed++
        console.log(`  ✗ ${shot.id}: ${error.message.split('\n')[0]}`)
      }
      await ctx.close()
    }

    const page = await browser.newPage({ viewport: { ...FEATURE_GRAPHIC }, deviceScaleFactor: 1 })
    await page.setContent(featureGraphicHtml())
    const file = join(outDir, '00-feature-graphic-1024x500.png')
    await page.screenshot({ path: file, clip: { x: 0, y: 0, ...FEATURE_GRAPHIC } })
    const info = pngInfo(readFileSync(file))
    const ok = info.width === 1024 && info.height === 500 && info.colorType === 2
    if (!ok) failed++
    console.log(`  ${ok ? '✓' : '✗'} ${file}`)
    await page.close()
  } finally {
    await browser.close()
  }
  writeFileSync(join(outDir, 'README.txt'), [
    `ภาพสำหรับหน้าแอป Google Play "${PLATFORM_APP_NAME}" — สร้างด้วย npm run store:assets`,
    'อัปโหลดใน Play Console > หน้าข้อมูลแอปในสโตร์ (Main store listing)',
    '  ภาพหน้าจอโทรศัพท์: 01–08 ตามลำดับ · ภาพกราฟิกเด่น: 00-feature-graphic-1024x500.png',
    '  ไอคอนแอป 512x512: public/icons/icon-512x512.png ใน repo',
    '',
  ].join('\n'))
  if (failed) { console.error(`\n${failed} รายการไม่ผ่าน`); process.exitCode = 1 }
}

// รันเฉพาะเมื่อเรียกตรง (เทสต์ import ฟังก์ชันตรวจขนาดโดยไม่เปิดเบราว์เซอร์)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()

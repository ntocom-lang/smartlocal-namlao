// ไม่แสดงชื่อหมวดในภาพสรุป/ใบ A4 (เจ้าของระบบสั่ง 2569-10-29) — src/components/reports/ComplaintMonthlyInfographic.jsx · ComplaintStats.jsx
//   ชั้นแรก: โค้ดหน้าต่อสายถูก (ภาพ/ใบ A4 ใช้ฉบับที่ซ่อน หน้าเว็บใช้ฉบับเต็ม เฉพาะเจ้าหน้าที่ เก็บในเครื่องแบบไม่พัง)
//   ชั้นสอง: เรนเดอร์การ์ดจริงใน Chrome แล้วกดปุ่มจริง — ชื่อหมวดหายจากภาพ ยอดรวมไม่เปลี่ยน กดกลับมาแสดงได้
// ตรรกะการพับหมวดเทสต์อยู่ที่ tests/complaint-monthly-summary.test.mjs (หัวข้อ "ไม่แสดงชื่อหมวด")
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { bundleEntry, YALA_APRIL } from './lib/infographicBrowser.mjs'

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const page = readFileSync(new URL('../src/pages/ComplaintStats.jsx', import.meta.url), 'utf8')

await test('หน้า: ภาพและใบ A4 ใช้ฉบับที่ซ่อน (exportSummary) · ข้อความสรุปบนหน้าเว็บใช้ฉบับเต็ม · รายการปุ่มมาจากฉบับเต็ม', () => {
  assert.ok(page.includes('summary={exportSummary}'))
  assert.ok(page.includes("buildComplaintMonthlyHtml({ tenant, summary: exportSummary, reportUrl: appUrl('/complaint') })"))
  assert.ok(page.includes('categoryOptions={canHideCategories ? monthlySummary.allCategories : null}'))
  assert.ok(page.includes('monthlySummary.sentences.map(sentence =>'), 'ข้อความบนหน้าเว็บต้องเป็นฉบับเต็ม')
  assert.ok(page.includes('summarizeMonth({ ...summaryArgs, hiddenCategories })'))
})

await test('หน้า: ปุ่มเห็นเฉพาะบทบาทที่ล็อกตัวเลขได้ (เจ้าหน้าที่/แอดมิน) · ประชาชนได้รายการว่าง = ภาพเต็มเสมอ', () => {
  assert.ok(page.includes('const canHideCategories = canLockMonth(role)'))
  assert.ok(page.includes('(canHideCategories && tenantId ? (hiddenByTenant[tenantId] ?? readHiddenCategories(tenantId)) : [])'))
})

await test('หน้า: เก็บค่าในเครื่องแยกตาม อปท. ทุกการอ่าน/เขียนครอบ try/catch · ค่าเสียกลายเป็นรายการว่าง', () => {
  const read = /function readHiddenCategories\(tenantId\) \{[\s\S]*?\n\}/.exec(page)?.[0] ?? ''
  const write = /function writeHiddenCategories\(tenantId, codes\) \{[\s\S]*?\n\}/.exec(page)?.[0] ?? ''
  assert.ok(read.includes('try {') && read.includes('catch') && read.includes('Array.isArray(value)'))
  assert.ok(write.includes('try {') && write.includes('catch'))
  assert.ok(page.includes('`smartlocal:complaint-image-hidden-categories:${tenantId}`'))
})

const bundle = await bundleEntry(fileURLToPath(new URL('./lib/hideCategoriesEntry.js', import.meta.url)), 'HideBundle')
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const tab = await browser.newPage()
  await tab.route('**/*', route => route.abort())
  await tab.setContent('<!doctype html><body></body>')
  await tab.addScriptTag({ content: bundle })
  const mount = props => tab.evaluate(p => { window.HideBundle.unmountAll(); window.HideBundle.mount(p) }, props)
  const chip = name => tab.getByRole('button', { name: new RegExp(`^${name} `) })
  // ข้อความทั้งภาพจาก <img> (data URL ของ SVG) ต่อกันไม่มีช่องว่าง — ประโยคยาวถูกตัดเป็นหลาย <text>
  const imageText = () => tab.evaluate(() => {
    const src = document.querySelector('section img').getAttribute('src')
    const svg = decodeURIComponent(src.slice(src.indexOf(',') + 1))
    return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]).join('').replace(/\s+/g, '')
  })

  await test('Chrome (ประชาชน): ไม่มีปุ่มเลือกหมวด ภาพมีทุกหมวด', async () => {
    await mount({ sample: YALA_APRIL, staff: false })
    assert.equal(await tab.getByText('ชื่อหมวดในภาพและใบ A4').count(), 0)
    assert.ok((await imageText()).includes('ไฟฟ้าสาธารณะ'))
  })

  await test('Chrome (เจ้าหน้าที่): ทุกหมวดมีปุ่ม เริ่มที่ "แสดง" ทั้งหมด · ปุ่มสูง 44px (min-h-11)', async () => {
    await mount({ sample: YALA_APRIL, staff: true })
    const buttons = tab.locator('button[aria-pressed]')
    assert.equal(await buttons.count(), Object.keys(YALA_APRIL.categories).length)
    assert.deepEqual([...new Set(await buttons.evaluateAll(list => list.map(b => b.getAttribute('aria-pressed'))))], ['true'])
    // หน้าเทสต์ไม่ได้โหลด Tailwind วัดความสูงจริงไม่ได้ — ตรวจคลาสแทน (ความสูงจริงตรวจบนหน้าเว็บ)
    const classes = await buttons.evaluateAll(list => list.map(b => b.className))
    assert.ok(classes.every(c => c.split(/\s+/).includes('min-h-11')), 'ปุ่มต้องสูงพอกดบนมือถือ')
  })

  await test('Chrome (เจ้าหน้าที่): กดซ่อนไฟฟ้า → ชื่อหายจากภาพ มี "หมวดที่เหลือ" + หมายเหตุ ยอดรวม 39 เท่าเดิม · กดอีกครั้งกลับมาแสดง', async () => {
    await mount({ sample: YALA_APRIL, staff: true })
    const before = await imageText()
    assert.ok(before.includes('ไฟฟ้าสาธารณะ') && !before.includes('หมวดที่เหลือ'))
    await chip('ไฟฟ้าสาธารณะ').click()
    assert.equal(await chip('ไฟฟ้าสาธารณะ').getAttribute('aria-pressed'), 'false')
    const after = await imageText()
    assert.ok(!after.includes('ไฟฟ้าสาธารณะ'), 'ชื่อหมวดที่ซ่อนยังอยู่ในภาพ')
    assert.ok(after.includes('หมวดที่เหลือ(1หมวด)'))
    assert.ok(after.includes('มี1หมวดที่ไม่แสดงชื่อ'))
    assert.ok(after.includes('39'), 'ยอดรวมต้องยังอยู่')
    assert.ok(!(await tab.locator('section img').getAttribute('alt')).includes('ไฟฟ้าสาธารณะ'), 'ข้อความแทนภาพ (ใช้ตอนแชร์) ต้องไม่มีชื่อที่ซ่อน')
    await chip('ไฟฟ้าสาธารณะ').click()
    assert.ok((await imageText()).includes('ไฟฟ้าสาธารณะ'))
  })
} finally {
  await browser.close()
}

console.log(`\n${cases} cases passed`)

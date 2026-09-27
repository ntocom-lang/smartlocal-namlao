// ใบ "รายการคำร้อง" (src/lib/complaintListPrint.js) — ข้อความที่ประชาชนพิมพ์ต้องออกเป็นตัวอักษรเสมอ
// ชั้นแรกตรวจข้อความ HTML · ชั้นสองโหลดใบจริงใน Chrome แล้วดูว่าโค้ดที่ฝังมาไม่ได้ทำงาน
// ไม่ต่อฐานข้อมูล ไม่ใช้เน็ต (บล็อกทุก request ในเบราว์เซอร์)
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

process.env.TZ = 'America/Los_Angeles'
const { buildComplaintListHtml } = await import('../src/lib/complaintListPrint.js')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

// โค้ดที่ฝังมาทุกตัวพยายามตั้ง window.__pwned — ใบที่ถูกต้องต้องไม่มีทางตั้งค่านี้ได้
const PAYLOADS = [
  `<img src=x onerror="window.__pwned='img'">`,
  `<script>window.__pwned='script'</script>`,
  `<svg onload="window.__pwned='svg'"></svg>`,
  `</td></tr></tbody></table><h1 id=injected>x</h1>`,
  `<iframe srcdoc="<script>parent.__pwned='iframe'</script>"></iframe>`,
]

const complaint = (n, fields = {}) => ({
  ref_no: `ES-69-${String(n).padStart(4, '0')}`,
  created_at: '2026-09-01T02:00:00Z',
  category: 'light',
  status: 'received',
  reporter_name: '[TEST] นายทดสอบ ระบบ',
  detail: '[TEST] ไฟฟ้าสาธารณะดับ หน้าบ้านเลขที่ 12',
  profiles: null,
  ...fields,
})

const build = (complaints, extra = {}) => buildComplaintListHtml({
  tenant: { name: 'เทศบาลตำบลสาธิต', org_type: 'เทศบาลตำบล', slug: 'demo' },
  filterLabel: 'ทั้งหมด',
  complaints,
  categoryLabels: { light: 'ไฟฟ้าสาธารณะ' },
  statusLabels: { received: 'รับเรื่องแล้ว' },
  printedAt: new Date('2026-09-27T05:00:00Z'),
  ...extra,
})

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const count = (html, needle) => html.split(needle).length - 1

// โครงของใบเองไม่มีแท็กพวกนี้เลย — เจอเมื่อไรแปลว่ามาจากข้อมูล
const assertNoInjectedMarkup = (html) => {
  for (const tag of ['<img', '<script', '<svg', '<iframe', '<h1', '<b>']) {
    assert.equal(count(html, tag), 0, `พบ ${tag} ในใบ`)
  }
  assert.equal(count(html, '<table>'), 1)
  assert.equal(count(html, '</table>'), 1)
  assert.equal(count(html, '</tbody>'), 1)
}

await test('ข้อความปกติออกมาตรงตามที่พิมพ์', () => {
  const html = build([complaint(1), complaint(2, { reporter_name: '', profiles: { full_name: 'นางสาวผ่าน โปรไฟล์' } })])
  assert.ok(html.includes('<td>[TEST] นายทดสอบ ระบบ</td>'))
  assert.ok(html.includes('<td>นางสาวผ่าน โปรไฟล์</td>'), 'ผู้แจ้งว่างต้องใช้ชื่อจากบัญชี')
  assert.ok(html.includes('<td>[TEST] ไฟฟ้าสาธารณะดับ หน้าบ้านเลขที่ 12</td>'))
  assert.ok(html.includes('<td>ไฟฟ้าสาธารณะ</td>'))
  assert.ok(html.includes('<td style="text-align:center">รับเรื่องแล้ว</td>'))
  assert.ok(html.includes('<td style="text-align:center">ES-69-0002</td>'))
  assert.ok(html.includes('ทั้งหมด 2 รายการ'))
  assert.equal(count(html, '<tr>'), 3, 'หัวตาราง 1 + ข้อมูล 2 แถว')
})

await test('แท็กในชื่อผู้แจ้งออกมาเป็นตัวอักษร', () => {
  const html = build(PAYLOADS.map((p, i) => complaint(i + 1, { reporter_name: p })))
  for (const p of PAYLOADS) assert.ok(html.includes(`<td>${esc(p)}</td>`), p)
  assertNoInjectedMarkup(html)
})

await test('แท็กในรายละเอียดออกมาเป็นตัวอักษร (ข้อความไม่เกิน 60 ตัวอักษรไม่ถูกตัด)', () => {
  const short = PAYLOADS.filter(p => p.length <= 60)
  assert.ok(short.length >= 4, 'ต้องมีตัวอย่างสั้นพอให้ไม่ถูกตัดอย่างน้อย 4 แบบ')
  const html = build(short.map((p, i) => complaint(i + 1, { detail: p })))
  for (const p of short) assert.ok(html.includes(`<td>${esc(p)}</td>`), p)
  assertNoInjectedMarkup(html)
})

await test('ผู้แจ้งเว้นว่างแล้วใช้ชื่อจากบัญชี — ชื่อจากบัญชีก็ต้อง escape', () => {
  const html = build([complaint(1, { reporter_name: '', profiles: { full_name: PAYLOADS[0] } })])
  assert.ok(html.includes(`<td>${esc(PAYLOADS[0])}</td>`))
  assertNoInjectedMarkup(html)
})

await test('ชื่อ อปท. ตัวกรอง หมวด สถานะ และเลขที่ escape ครบ', () => {
  const html = build([
    complaint(1, { ref_no: '<b>ref</b>', category: 'custom', status: 'weird' }),
    complaint(2, { category: '<b>raw-key</b>', status: '<b>raw-status</b>' }),
  ], {
    tenant: { name: '<b>อปท</b> "ก" & \'ข\'' },
    filterLabel: '<b>filter</b>',
    categoryLabels: { custom: '<b>หมวดที่ อปท. ตั้งเอง</b>' },
    statusLabels: { weird: '<b>สถานะ</b>' },
  })
  assert.ok(html.includes('<h2>&lt;b&gt;อปท&lt;/b&gt; &quot;ก&quot; &amp; &#39;ข&#39; — รายการคำร้อง</h2>'))
  assert.ok(html.includes('ตัวกรอง: &lt;b&gt;filter&lt;/b&gt;'))
  assert.ok(html.includes('<td>&lt;b&gt;หมวดที่ อปท. ตั้งเอง&lt;/b&gt;</td>'))
  assert.ok(html.includes('<td>&lt;b&gt;raw-key&lt;/b&gt;</td>'), 'หมวดที่ไม่รู้จักแสดงรหัสดิบ ต้อง escape ด้วย')
  assert.ok(html.includes('&lt;b&gt;raw-status&lt;/b&gt;'))
  assert.ok(html.includes('&lt;b&gt;ref&lt;/b&gt;'))
  assertNoInjectedMarkup(html)
})

await test('ตัดรายละเอียด 60 ตัวอักษรก่อนแล้วค่อย escape — รหัส &amp; ไม่ขาดครึ่ง', () => {
  const html = build([
    complaint(1, { detail: 'ก'.repeat(59) + '&' + 'ข'.repeat(5) }),
    complaint(2, { detail: 'ก'.repeat(58) + '<b>x' }),
  ])
  assert.ok(html.includes(`<td>${'ก'.repeat(59)}&amp;...</td>`))
  assert.ok(html.includes(`<td>${'ก'.repeat(58)}&lt;b...</td>`))
  assertNoInjectedMarkup(html)
})

// ── ชั้นสอง: โหลดใบจริงใน Chrome ──
// channel: 'chrome' ใช้ Chrome ที่ลงในเครื่องอยู่แล้ว ไม่ต้อง playwright install เพิ่ม
const browser = await chromium.launch({ channel: 'chrome' })
try {
  await test('โหลดใบใน Chrome จริง — โค้ดที่ฝังมาไม่ทำงาน ข้อความขึ้นตรงตามที่พิมพ์', async () => {
    const complaints = PAYLOADS.map((p, i) => complaint(i + 1, { reporter_name: p, detail: p.length <= 60 ? p : 'ปกติ' }))
    const page = await browser.newPage()
    try {
      await page.route('**/*', route => route.abort())
      await page.setContent(build(complaints, { tenant: { name: PAYLOADS[0] }, filterLabel: PAYLOADS[1] }), { waitUntil: 'load' })
      // onerror ของรูปที่โหลดไม่ขึ้นอาจทำงานหลัง load — รอให้คิวเหตุการณ์ว่างก่อน ไม่งั้นตรวจเร็วเกินจนผ่านลวง
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 200)))
      const seen = await page.evaluate(() => ({
        pwned: window.__pwned ?? null,
        scripts: document.scripts.length,
        injected: document.querySelectorAll('img, svg, iframe, h1, #injected').length,
        rows: document.querySelectorAll('tbody tr').length,
        reporters: [...document.querySelectorAll('tbody tr')].map(tr => tr.children[4]?.textContent),
        heading: document.querySelector('h2')?.textContent,
      }))
      assert.equal(seen.pwned, null, `โค้ดที่ฝังมาทำงาน: ${seen.pwned}`)
      assert.equal(seen.scripts, 0)
      assert.equal(seen.injected, 0)
      assert.equal(seen.rows, complaints.length, 'ตารางต้องไม่ถูกปิดกลางทาง')
      assert.deepEqual(seen.reporters, PAYLOADS, 'ชื่อผู้แจ้งต้องขึ้นเป็นตัวอักษรตรงตามที่พิมพ์')
      assert.equal(seen.heading, `${PAYLOADS[0]} — รายการคำร้อง`)
    } finally { await page.close() }
  })
} finally {
  await browser.close()
}

console.log(`\n${cases} cases passed`)

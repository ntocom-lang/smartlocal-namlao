// รูปบนหน้าแรกที่ซ่อนอยู่หรืออยู่ไกลจากจอต้องไม่ถูกโหลด (ต้นเหตุหนึ่งที่ Supabase ตัดบริการ 402 เมื่อ 2026-10-04)
//
// หน้าแรกน้ำเลาวัดจริง: ราวครึ่งหนึ่งของรูปมีขนาด 0x0 (เลย์เอาต์มือถือกับเดสก์ท็อปซ้อนกันแล้วซ่อนอันหนึ่งด้วย CSS)
// หรืออยู่ใต้จอ แต่เบราว์เซอร์โหลดครบเพราะ <img> ไม่มี loading="lazy"
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const read = rel => readFile(new URL(rel, import.meta.url), 'utf8')

// ไฟล์ที่วาดรูปข้อมูล (ข่าว/ท่องเที่ยว/บุคลากร) ต้อง lazy ทุก <img> — ค่าในวงเล็บคือจำนวน <img> ที่ต้องเจอ
// กันกรณี regex อ่านพลาดแล้วเทสต์ผ่านเพราะไม่เจออะไรเลย
const LAZY_FILES = {
  '../src/components/home/PostsHighlight.jsx': 3,
  '../src/components/home/TourismSection.jsx': 4,
  '../src/components/home/StaffSection.jsx': 2,
  '../src/components/citizen/templates/EcoFriendly/Home.jsx': 1,
}

// รูปที่อยู่บนจอแรกเสมอ (LCP) ต้องโหลดทันที ห้ามใส่ lazy ไม่งั้นหน้าแรกขึ้นช้าลง
const EAGER_FILES = [
  '../src/components/home/HeroBanner.jsx',
  '../src/components/home/SmartCityBanner.jsx',
  '../src/components/citizen/templates/EcoFriendly/Header.jsx',
]

const imgTags = src => [...src.matchAll(/<img\b[^>]*?>/gs)].map(m => m[0])

for (const [rel, expected] of Object.entries(LAZY_FILES)) {
  test(`${rel.split('/').pop()}: <img> ข้อมูลทุกใบต้อง lazy (${expected} จุด)`, async () => {
    const tags = imgTags(await read(rel))
    assert.equal(tags.length, expected, `จำนวน <img> เปลี่ยนไป (เจอ ${tags.length}) — ถ้าเพิ่ม/ลดรูปจริง ให้แก้ตัวเลขใน LAZY_FILES`)
    for (const t of tags) {
      assert.match(t, /loading="lazy"/, `ไม่ได้ตั้ง loading="lazy": ${t.replace(/\s+/g, ' ').slice(0, 90)}`)
      assert.match(t, /decoding="async"/, 'ควรมี decoding="async" คู่กัน')
    }
  })
}

test('รูปบนจอแรก (โลโก้/ฮีโร่/Smart City) ต้องไม่ lazy', async () => {
  for (const rel of EAGER_FILES) {
    const tags = imgTags(await read(rel))
    assert.ok(tags.length > 0, `${rel} ไม่มี <img> แล้วหรือ — แก้รายการ EAGER_FILES`)
    for (const t of tags) assert.doesNotMatch(t, /loading="lazy"/, `${rel} มี lazy บนรูปจอแรก`)
  }
})

// ── พฤติกรรมจริงของ Chrome — สมมติฐานที่การแก้นี้ตั้งอยู่ ───────────────────────────────────
let browser
before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }) })
after(async () => { await browser?.close() })

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function requestedImages(html, viewport = { width: 390, height: 844 }) {
  const page = await browser.newPage({ viewport })
  const hits = []
  await page.route('https://lazy.test/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
    hits.push(url.pathname.slice(1))
    return route.fulfill({ contentType: 'image/png', body: PNG })
  })
  await page.goto('https://lazy.test/', { waitUntil: 'load' })
  await page.waitForTimeout(800)
  await page.close()
  return hits.sort()
}

test('Chrome: lazy ไม่โหลดรูปที่ซ่อน (display:none) หรืออยู่ไกลใต้จอ แต่โหลดรูปที่เห็นอยู่', async () => {
  const img = (name, attrs = '') => `<img src="/${name}" ${attrs} width="200" height="100">`
  const html = `<!doctype html><body style="margin:0">
    ${img('visible-lazy', 'loading="lazy" decoding="async"')}
    <div style="display:none">${img('hidden-lazy', 'loading="lazy" decoding="async"')}</div>
    <div style="display:none">${img('hidden-eager')}</div>
    <div style="height:6000px"></div>
    ${img('far-lazy', 'loading="lazy" decoding="async"')}
    ${img('far-eager')}</body>`
  const hits = await requestedImages(html)
  assert.ok(hits.includes('visible-lazy'), 'รูปที่เห็นอยู่ต้องโหลด')
  assert.ok(hits.includes('hidden-eager'), 'พิสูจน์ปัญหาเดิม: รูปซ่อนที่ไม่ lazy ถูกโหลด')
  assert.ok(hits.includes('far-eager'), 'พิสูจน์ปัญหาเดิม: รูปไกลจอที่ไม่ lazy ถูกโหลด')
  assert.ok(!hits.includes('hidden-lazy'), 'รูปซ่อน + lazy ต้องไม่ถูกโหลด')
  assert.ok(!hits.includes('far-lazy'), 'รูปไกลจอ + lazy ต้องไม่ถูกโหลด')
})

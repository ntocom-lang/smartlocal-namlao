// ภาพข่าวประชาสัมพันธ์ของคำร้องที่ดำเนินการแล้ว (src/lib/complaintNewsImage.js + ComplaintNewsDialog + ปุ่มใน ComplaintsManager)
// node ล้วน: ตัววัดข้อความจำลอง ไม่ต่อฐานข้อมูล ไม่ใช้เน็ต
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

process.env.TZ = 'Asia/Bangkok'
const News = await import('../src/lib/complaintNewsImage.js')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const measure = (value, size, bold) => value.length * size * (bold ? 0.62 : 0.55)
// ข้อความทั้งภาพต่อกันไม่มีช่องว่าง — ประโยคยาวถูกตัดเป็นหลาย <text> จึงตรวจทีละ <text> ไม่ได้
const plain = svg => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(match => match[1]).join('').replace(/\s+/g, '')
const has = (svg, phrase) => plain(svg).includes(phrase.replace(/\s+/g, ''))
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

// ยื่นอังคาร 3 พ.ย. 2569 → ปิดอังคาร 10 พ.ย. 2569 = 5 วันทำการ (4,5,6,9,10 ไม่มีวันหยุดราชการ)
const CREATED = '2026-11-03T03:00:00Z'
const CLOSED = '2026-11-10T03:00:00Z'
const base = (over = {}) => News.buildNewsModel({
  tenantName: 'เทศบาลตำบลสาธิต', departmentName: 'กองช่าง', categoryLabel: 'ไฟฟ้าสาธารณะ',
  createdAt: CREATED, closedAt: CLOSED, dueDate: '2026-11-12', headline: 'ซ่อมไฟเรียบร้อย', detail: '', ...over,
})
const draw = (model, assets) => News.buildNewsSvg(model, measure, assets)

await test('วันที่ไทยตามเวลา กทม. + วันทำการ 5 วัน', () => {
  assert.equal(News.thaiLongDate(CLOSED), '10 พฤศจิกายน 2569')
  assert.equal(News.thaiLongDate('2026-11-09T18:00:00Z'), '10 พฤศจิกายน 2569') // 01:00 น. ของวันที่ 10 ตามเวลาไทย
  assert.equal(News.thaiLongDate('ไม่ใช่วันที่'), '')
  const model = base()
  assert.equal(model.durationLabel, 'ใช้เวลา 5 วันทำการ')
  assert.equal(model.dateText, '10 พฤศจิกายน 2569')
})

await test('ป้ายเม็ดยาเปิด/ปิดแยกกัน ครบ 4 แบบ', () => {
  for (const [status, duration] of [[true, true], [true, false], [false, true], [false, false]]) {
    const { svg } = draw(base({ showStatus: status, showDuration: duration }))
    assert.equal(has(svg, 'ดำเนินการแล้ว'), status, `status=${status}`)
    assert.equal(has(svg, 'ใช้เวลา 5 วันทำการ'), duration, `duration=${duration}`)
  }
  // ไม่รู้ระยะเวลา (ไม่มีวันยื่น) = ไม่แสดงป้ายระยะเวลา ไม่เดาตัวเลข
  assert.equal(base({ createdAt: undefined, showDuration: true }).showDuration, false)
  // ปิดทั้งคู่ = ไม่มีแถวป้าย (ไม่มีสี่เหลี่ยมมนสีเขียว/ส้มอ่อน)
  const none = draw(base({ showStatus: false, showDuration: false })).svg
  assert.ok(!none.includes('#15803d') && !none.includes('#ffedd5'))
})

await test('defaultShowDuration: ทัน / เกิน / ไม่มีกำหนด', () => {
  assert.equal(News.defaultShowDuration({ closedAt: CLOSED, dueDate: '2026-11-12' }), true)
  assert.equal(News.defaultShowDuration({ closedAt: CLOSED, dueDate: '2026-11-10' }), true) // วันครบกำหนดพอดี = ทัน
  assert.equal(News.defaultShowDuration({ closedAt: CLOSED, dueDate: '2026-11-09' }), false)
  assert.equal(News.defaultShowDuration({ closedAt: CLOSED }), true)
  assert.equal(News.defaultShowDuration({ closedAt: CLOSED, dueDate: null }), true)
  // ไม่ส่ง showDuration = ระบบติ๊กตามกฎ
  assert.equal(base({ showDuration: undefined, dueDate: '2026-11-09' }).showDuration, false)
  assert.equal(base({ showDuration: undefined, dueDate: '2026-11-12' }).showDuration, true)
})

await test('ข้อความที่มี <script> และ & ถูก escape ทุกจุด', () => {
  const evil = '<script>alert(1)</script> & "x"'
  const model = base({ tenantName: evil, headline: evil, detail: evil, reportUrl: 'https://example.test/a?b=1&c=<2>' })
  const { svg } = draw(model, { logoDataUrl: 'data:image/png;base64,AAAA" onload="x', photoDataUrls: ['data:image/png;base64,AAAA"onload="x', PHOTO] })
  assert.ok(!svg.includes('<script'), 'มีแท็ก script หลุดลงภาพ')
  assert.ok(svg.includes('&lt;script&gt;'))
  assert.ok(svg.includes('&amp;'))
  assert.ok(!svg.includes('"onload'))
})

await test('รูปเกิน 4 ถูกตัด · URL ที่ไม่ใช่ data:image ถูกทิ้ง · ตารางรูป 1/2/3/4', () => {
  const six = Array.from({ length: 6 }, (_, i) => `${PHOTO.slice(0, -2)}${i}=`)
  const result = draw(base(), { photoDataUrls: six })
  assert.equal(result.photoCount, 4)
  assert.equal((result.svg.match(/<image /g) ?? []).length, 4)
  const mixed = draw(base(), { photoDataUrls: ['javascript:alert(1)', null, 'https://evil.test/x.png', PHOTO] })
  assert.equal(mixed.photoCount, 1)
  assert.ok(!mixed.svg.includes('evil.test') && !mixed.svg.includes('javascript:'))
  assert.equal(draw(base(), { photoDataUrls: [] }).photoCount, 0)
  const sizes = n => News.photoCells(n).cells.length
  assert.deepEqual([1, 2, 3, 4].map(sizes), [1, 2, 3, 4])
  assert.equal(News.photoCells(1).cells[0].w, 1080 - 64 * 2) // 1 รูปเต็มกว้าง
  const two = News.photoCells(2).cells
  assert.ok(two[0].w === two[1].w && two[1].x > two[0].x) // 2 รูปแบ่งครึ่ง
  const three = News.photoCells(3).cells
  assert.ok(three[2].w === 1080 - 64 * 2 && three[2].x === 0) // 3 รูป: รูปที่ 3 เต็มกว้าง ไม่เหลือมุมว่าง
  const four = News.photoCells(4).cells
  assert.ok(four[2].y > four[0].y && four[3].x === four[1].x) // 2×2
  assert.match(result.svg, /preserveAspectRatio="xMidYMid slice"/)
  assert.equal((result.svg.match(/<clipPath id="news-photo-/g) ?? []).length, 4)
})

await test('PDPA: ข้อมูลผู้แจ้งไม่โผล่ในโมเดลและภาพ', () => {
  const complaint = {
    reporter_name: 'สมชาย ใจดีมาก', phone: '0812345678', description: 'บ้านเลขที่ 99/9 ซอยลับ มีสุนัขดุ',
    location_name: 'หน้าบ้านนายสมชาย', latitude: 18.12345, longitude: 100.45678, address: '99/9 หมู่ 3',
    village: 'หมู่ 3', created_at: CREATED, closed_at: CLOSED, due_date: '2026-11-12',
    profiles: { full_name: 'สมหญิง รักดี', phone: '0899999999' },
  }
  const model = News.buildNewsModel({ complaint, tenantName: 'เทศบาลตำบลสาธิต', departmentName: 'กองช่าง', categoryLabel: 'ไฟฟ้าสาธารณะ' })
  const dump = JSON.stringify(model) + draw(model).svg
  for (const secret of ['สมชาย', 'ใจดี', '0812345678', 'บ้านเลขที่', '99/9', 'สุนัขดุ', '18.123', '100.456', 'สมหญิง', '0899999999', 'หน้าบ้าน']) {
    assert.ok(!dump.includes(secret), `ข้อมูลผู้แจ้งหลุด: ${secret}`)
  }
  assert.deepEqual(Object.keys(model).sort(),
    ['dateText', 'detail', 'durationLabel', 'headline', 'reportUrl', 'showDuration', 'showStatus', 'tenantName'])
  assert.ok(model.headline.includes('หมู่ 3')) // หมู่ระดับเดียวที่ใช้ได้
  // ช่องหมู่บ้านที่มีข้อความอื่นปน ไม่ดึงมา
  assert.equal(News.villageLevel('บ้านนายสมชาย เลขที่ 12'), '')
  assert.equal(News.villageLevel('5'), 'หมู่ 5')
  assert.equal(News.villageLevel('หมู่ที่ 7 บ้านดอน'), 'หมู่ 7')
})

await test('ร่างข้อความ: มี/ไม่มีกอง · ไม่มี "นายกฯ มอบหมาย" · detail = บันทึกผล', () => {
  assert.equal(News.draftHeadline({ departmentName: 'กองช่าง', tenantName: 'เทศบาลตำบลสาธิต', categoryLabel: 'ไฟฟ้าสาธารณะ', village: 'หมู่ 3' }),
    'กองช่าง เทศบาลตำบลสาธิต ลงพื้นที่ดำเนินการเรื่องไฟฟ้าสาธารณะ หมู่ 3 ตามที่ประชาชนแจ้งผ่านระบบ E-Service')
  assert.equal(News.draftHeadline({ tenantName: 'เทศบาลตำบลสาธิต', categoryLabel: 'ถนน' }),
    'เทศบาลตำบลสาธิต ลงพื้นที่ดำเนินการเรื่องถนน ตามที่ประชาชนแจ้งผ่านระบบ E-Service')
  const model = News.buildNewsModel({ tenantName: 'เทศบาลตำบลสาธิต', departmentName: 'กองช่าง', categoryLabel: 'ไฟฟ้าสาธารณะ', finishNote: ' เปลี่ยนหลอด LED 2 ดวง ', createdAt: CREATED, closedAt: CLOSED })
  assert.equal(model.detail, 'เปลี่ยนหลอด LED 2 ดวง')
  assert.ok(!/มอบหมาย|นายก/.test(model.headline + model.detail))
  // ผู้เรียกลบข้อความเป็นว่างเอง = ว่างตามนั้น ไม่เด้งกลับเป็นร่าง
  assert.equal(News.buildNewsModel({ tenantName: 'ท', headline: '', createdAt: CREATED, closedAt: CLOSED }).headline, '')
})

await test('ข้อความตายตัวในภาพ · แถบท้าย (QR/โดเมน) · ไม่มี "จัดทำโดย" และเบอร์โทร', () => {
  const withUrl = draw(base({ reportUrl: 'https://namlao.example.test/complaint' })).svg
  for (const phrase of ['ผลการดำเนินงานผ่านระบบ E-Service', 'ข่าวประชาสัมพันธ์', 'วันที่ 10 พฤศจิกายน 2569', 'เทศบาลตำบลสาธิต',
    'พบปัญหาในชุมชน แจ้งเราได้ตลอด 24 ชม.', 'namlao.example.test/complaint', 'สแกน QR']) {
    assert.ok(has(withUrl, phrase), `ไม่พบในภาพ: ${phrase}`)
  }
  assert.ok(withUrl.includes('fill="#000000" shape-rendering="crispEdges"'), 'ไม่มี QR')
  assert.ok(!has(withUrl, 'จัดทำโดย') && !has(withUrl, 'กองช่าง'), 'ชื่อกองไม่ต้องขึ้นในภาพ')
  assert.ok(!/โทร|Tel/.test(plain(withUrl)))
  const noUrl = draw(base()).svg
  assert.ok(!noUrl.includes('crispEdges') && !has(noUrl, 'สแกน'))
  assert.ok(has(noUrl, 'พบปัญหาในชุมชน แจ้งเราได้ตลอด 24 ชม.'))
  assert.match(withUrl, /<rect width="1080" height="\d+" fill="#ffffff"\/>/) // พื้นขาวเต็มภาพ
  assert.ok(withUrl.includes('#c2410c'))
})

await test('ความสูงขั้นต่ำ 1350 · ข้อความยาวทำให้ภาพสูงขึ้นแทนการตัด', () => {
  const short = draw(base())
  assert.equal(short.width, 1080)
  assert.equal(short.height, 1350)
  assert.match(short.svg, /height="1350"/)
  const long = 'ซ่อมแซมไฟฟ้าสาธารณะและตรวจสอบระบบ '.repeat(40)
  const tall = draw(base({ headline: long, detail: long }), { photoDataUrls: [PHOTO, PHOTO, PHOTO, PHOTO] })
  assert.ok(tall.height > 1350)
  assert.match(tall.svg, new RegExp(`height="${tall.height}"`))
  assert.ok(has(tall.svg, 'ตรวจสอบระบบ'))
  // ไม่มีโลโก้ = วงกลมขาวเปล่า ไม่มี <image> ของโลโก้
  assert.ok(!short.svg.includes('news-logo-clip'))
  assert.ok(draw(base(), { logoDataUrl: PHOTO }).svg.includes('news-logo-clip'))
})

await test('static: ปุ่ม "ภาพข่าว" ผูกกับสถานะ closed ใน ComplaintsManager', async () => {
  const manager = await readFile(new URL('../src/components/admin/ComplaintsManager.jsx', import.meta.url), 'utf8')
  assert.match(manager, /import ComplaintNewsDialog from '\.\.\/complaints\/ComplaintNewsDialog'/)
  assert.match(manager, /Megaphone/)
  // 2 จุด: ปุ่มในตาราง (เดสก์ท็อป) + ปุ่มบนการ์ดมือถือ — ต้องมีเงื่อนไขสิทธิ์/ปิดปุ่มเมื่อไม่มีรูป/สี เหมือนกันทั้งคู่
  const marker = "normalizeActionStatus(c.status) === 'closed' && c.category !== 'odor'"
  const parts = manager.split(marker).slice(1)
  assert.equal(parts.length, 2, 'ต้องมีปุ่มภาพข่าว 2 จุด (ตาราง + การ์ดมือถือ)')
  for (const part of parts) {
    const area = part.slice(0, 2400)
    assert.match(area, /isAdmin \|\| \(c\.assigned_to && c\.assigned_to === currentUserId\)/)
    assert.match(area, /disabled=\{(!hasPhotos|\(c\.work_photos \?\? \[\]\)\.length === 0)\}/)
    assert.match(area, /ยังไม่มีรูปหลังดำเนินการ — เพิ่มรูปในรายละเอียดเรื่องก่อน/)
    assert.match(area, /#c2410c/)
  }
  assert.match(manager, /<ComplaintNewsDialog[\s\S]{0,400}closedAt=\{finishedAtOf\(newsComplaint\)\}/)
  const dialog = await readFile(new URL('../src/components/complaints/ComplaintNewsDialog.jsx', import.meta.url), 'utf8')
  assert.match(dialog, /fetchImageAsDataUrl/)
  assert.match(dialog, /\.eq\('status', 'closed'\)/)
  assert.match(dialog, /ตรวจก่อนว่าไม่มีหน้าคน ป้ายทะเบียน หรือเลขที่บ้าน รูปนี้ผู้แจ้งส่งมาเพื่อแจ้งเรื่อง ไม่ได้ส่งมาเพื่อลงเพจ/)
  assert.match(dialog, /ระบบติ๊กให้เองเมื่อเสร็จทันกำหนด · เกินกำหนดจะไม่ติ๊กไว้ก่อน/)
})

console.log(`\n${cases} cases passed`)

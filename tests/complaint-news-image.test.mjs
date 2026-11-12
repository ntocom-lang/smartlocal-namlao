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

await test('การ์ดตัวเลข (สถานะ/ระยะเวลา) เปิด/ปิดแยกกัน ครบ 4 แบบ', () => {
  for (const [status, duration] of [[true, true], [true, false], [false, true], [false, false]]) {
    const { svg } = draw(base({ showStatus: status, showDuration: duration }))
    assert.equal(has(svg, 'ดำเนินการแล้ว'), status, `status=${status}`)
    assert.equal(has(svg, 'ใช้เวลา 5 วันทำการ'), duration, `duration=${duration}`)
    assert.equal(svg.includes('data-stat="status"'), status)
    assert.equal(svg.includes('data-stat="duration"'), duration)
  }
  // ไม่รู้ระยะเวลา (ไม่มีวันยื่น) = ไม่แสดงการ์ดระยะเวลา ไม่เดาตัวเลข
  assert.equal(base({ createdAt: undefined, showDuration: true }).showDuration, false)
  // ปิดทั้งคู่ = ไม่มีแถวการ์ดตัวเลขเลย
  const none = draw(base({ showStatus: false, showDuration: false })).svg
  assert.ok(!none.includes('data-stat=') && !none.includes('id="news-stat-'))
  // "ใช้เวลา 5 วันทำการ" แยกเป็นข้อความเล็ก "ใช้เวลา" + ตัวเลขใหญ่ "5 วันทำการ" (ตัวใหญ่กว่า)
  const both = draw(base()).svg
  const sizeOf = phrase => Number([...both.matchAll(/<text[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)].find(match => match[2] === phrase)?.[1])
  assert.ok(sizeOf('5 วันทำการ') > sizeOf('ใช้เวลา'))
  // เสร็จในวันที่ยื่น = ไม่มีคำว่า "ใช้เวลา" ให้แยก → ข้อความเล็ก "ระยะเวลา" + ข้อความเต็ม
  const sameDay = draw(base({ createdAt: CLOSED })).svg
  assert.ok(has(sameDay, 'ระยะเวลาเสร็จในวันที่ยื่น'))
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
    ['categoryCode', 'dateText', 'detail', 'durationLabel', 'executive', 'headline', 'reportUrl', 'showDuration', 'showStatus', 'steps', 'tenantName', 'theme'])
  // ฟิลด์ที่เพิ่ม (สีธีม/รหัสหมวด/ขั้นตอน) ไม่ใช่ข้อมูลผู้แจ้ง: theme = hex 4 สี · steps = ป้ายตายตัว + วันที่ของเรื่อง
  assert.deepEqual(Object.keys(model.theme).sort(), ['base', 'deep', 'ink', 'soft'])
  assert.deepEqual(model.steps.map(step => Object.keys(step).sort()), Array.from({ length: 4 }, () => ['date', 'label']))
  assert.equal(model.executive, null) // ไม่ส่ง executive = ไม่มีบล็อกผู้บริหาร
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
  // ปิด QR/ลิงก์ = ข้อความขอบคุณ + "มุ่งสู่" เมืองอัจฉริยะ — ไม่ชวนแจ้งโดยไม่บอกช่องทาง ไม่มีโดเมนหลุด
  assert.ok(!has(noUrl, 'พบปัญหาในชุมชน แจ้งเราได้ตลอด 24 ชม.') && !has(noUrl, 'เข้าที่') && !noUrl.includes('/complaint'))
  assert.ok(has(noUrl, 'ขอบคุณทุกการแจ้งปัญหาจากประชาชน'))
  assert.ok(has(noUrl, 'ร่วมกันดูแลชุมชน มุ่งสู่เมืองอัจฉริยะ (Smart City)'))
  assert.ok(!has(withUrl, 'ขอบคุณทุกการแจ้งปัญหา'), 'มีลิงก์แล้วไม่ต้องมีข้อความขอบคุณ')
  // บรรทัดมุ่งสู่เมืองอัจฉริยะขึ้นทั้งแบบมี QR และไม่มี QR (เจ้าของระบบสั่ง 2569-11-11)
  assert.ok(has(withUrl, 'ร่วมกันดูแลชุมชน มุ่งสู่เมืองอัจฉริยะ (Smart City)'))
  assert.ok(!/(?<!มุ่งสู่)เมืองอัจฉริยะ/.test(plain(withUrl)))
  // ห้ามอ้างว่าเป็นเมืองอัจฉริยะแล้ว (ยังไม่ได้รับรอง) — ต้องเป็น "มุ่งสู่" เสมอ
  assert.ok(!/(?<!มุ่งสู่)เมืองอัจฉริยะ/.test(plain(noUrl)))
  assert.equal(News.newsShareText(base()).includes('แจ้งเรื่อง/ติดตามเรื่อง'), false)
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

// ── บล็อกผู้บริหารมุมขวาแถบหัว (รูป + ป้ายชื่อ/ตำแหน่ง) ──
const MAYOR = { name: 'นายสมศักดิ์ ใจดี', title: 'นายกเทศมนตรีตำบลสาธิต' }
// ข้อความหัว: ขาว (หัวข้อ) · ทอง (ชื่อ อปท.) · สีเข้มของธีมบนป้ายทอง (บรรทัดนำ) — อ่านทุกสี แล้วให้เทสต์กรองตามตำแหน่ง x เอง
const headerTexts = svg => [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-size="(\d+)" font-weight="(\d+)" fill="(#[0-9a-f]{6})"[^>]*>([^<]*)<\/text>/g)]
  .map(m => ({ x: Number(m[1]), size: Number(m[2]), bold: m[3] === '700', fill: m[4], text: m[5] }))
const headerBottomOf = svg => Number(/<rect width="1080" height="([\d.]+)" fill="url\(#news-head-grad\)" data-header="1"\/>/.exec(svg)[1])
const PLATE_LEFT = 1080 - 64 - 320

await test('บล็อกผู้บริหาร: เปิด = มีรูป(cover+clipPath) + ป้ายชื่อ/ตำแหน่ง · ปิด = เหมือนเดิมทุกพิกเซล', () => {
  const on = draw(base({ executive: MAYOR }), { executivePhotoDataUrl: PHOTO })
  assert.ok(on.svg.includes('news-exec-clip'))
  assert.match(on.svg, /<image href="data:image\/jpeg[^"]*" x="[\d.]+" y="26" width="300" height="300" preserveAspectRatio="xMidYMax meet" clip-path="url\(#news-exec-clip\)"\/>/)
  assert.ok(has(on.svg, MAYOR.name) && has(on.svg, MAYOR.title))
  // ป้ายขาวขอบส้มทับช่วงล่างของรูป (ก้นรูป 26+300 อยู่ในป้าย) และไม่ล้นกรอบเนื้อหาด้านขวา
  const plate = /<rect x="([\d.]+)" y="([\d.]+)" width="320" height="([\d.]+)" rx="26" fill="#ffffff"/.exec(on.svg)
  assert.ok(plate, 'ไม่พบป้ายชื่อ')
  assert.ok(Number(plate[2]) > 200 && Number(plate[2]) < 326 && Number(plate[2]) + Number(plate[3]) > 326)
  assert.ok(Number(plate[1]) + 320 <= 1080 - 64 + 0.01)
  // ปิด: ไม่ส่ง executive หรือส่ง null ได้ภาพเดียวกันทุกตัวอักษร และไม่มีร่องรอยของบล็อก
  const off = draw(base())
  const offNull = draw(base({ executive: null }), { executivePhotoDataUrl: PHOTO })
  assert.equal(offNull.svg, off.svg)
  assert.ok(!off.svg.includes('news-exec-clip') && !has(off.svg, MAYOR.name))
  // ว่างทั้งชื่อและตำแหน่ง = ไม่มีบล็อก (ผู้เรียกควรใส่ตำแหน่งสำรองมาเอง)
  assert.equal(base({ executive: { name: ' ', title: '' } }).executive, null)
})

await test('บล็อกผู้บริหาร: ไม่มีรูปแต่มีชื่อ = ป้ายชื่ออย่างเดียว · URL ที่ไม่ใช่ data:image ถูกทิ้ง', () => {
  const nameOnly = draw(base({ executive: MAYOR })).svg
  assert.ok(!nameOnly.includes('news-exec-clip') && has(nameOnly, MAYOR.name) && has(nameOnly, MAYOR.title))
  for (const bad of ['https://evil.test/x.png', 'javascript:alert(1)', '', null, 'data:text/html;base64,AAAA']) {
    const svg = draw(base({ executive: MAYOR }), { executivePhotoDataUrl: bad }).svg
    assert.ok(!svg.includes('news-exec-clip') && !svg.includes('evil.test') && !svg.includes('javascript:'), `รับ URL ที่ไม่ใช่ data:image — ${bad}`)
  }
  // มีแต่ตำแหน่ง (ไม่มีชื่อ) ก็ยังได้ป้าย
  const titleOnly = draw(base({ executive: { name: '', title: 'นายกเทศมนตรีตำบลสาธิต' } })).svg
  assert.ok(has(titleOnly, 'นายกเทศมนตรีตำบลสาธิต'))
})

await test('บล็อกผู้บริหาร: ทุกข้อความ esc() · ชื่อ/ตำแหน่งยาวตัดบรรทัดและป้ายสูงขึ้น', () => {
  const evil = '<script>alert(1)</script> & "x"'
  const svg = draw(base({ executive: { name: evil, title: evil } }), { executivePhotoDataUrl: 'data:image/png;base64,AAAA"onload="x' }).svg
  assert.ok(!svg.includes('<script') && svg.includes('&lt;script&gt;') && svg.includes('&amp;'))
  assert.ok(!svg.includes('"onload'))
  const longTitle = 'นายกองค์การบริหารส่วนตำบลที่มีชื่อยาวมากเป็นพิเศษเกินหนึ่งบรรทัดแน่นอน'
  const short = /<rect [^>]*width="320" height="([\d.]+)" rx="26" fill="#ffffff"/.exec(draw(base({ executive: MAYOR }), { executivePhotoDataUrl: PHOTO }).svg)
  const tall = /<rect [^>]*width="320" height="([\d.]+)" rx="26" fill="#ffffff"/.exec(draw(base({ executive: { name: MAYOR.name, title: longTitle } }), { executivePhotoDataUrl: PHOTO }).svg)
  assert.ok(Number(tall[1]) > Number(short[1]), 'ตำแหน่งยาวต้องตัดบรรทัดทำให้ป้ายสูงขึ้น')
})

await test('บล็อกผู้บริหาร: ข้อความหัวแคบลงไม่ทับบล็อก · แถบหัวสูงพอครอบทั้งบล็อก', () => {
  const longName = 'เทศบาลตำบลสาธิตพัฒนาเมืองน่าอยู่ชุมชนเข้มแข็งยั่งยืนมั่นคง'
  for (const executive of [MAYOR, { name: MAYOR.name, title: 'นายกองค์การบริหารส่วนตำบลที่มีชื่อยาวมากเป็นพิเศษเกินหนึ่งบรรทัดแน่นอน' }]) {
    const { svg } = draw(base({ tenantName: longName, executive }), { executivePhotoDataUrl: PHOTO })
    const texts = headerTexts(svg).filter(t => t.x === 240)
    assert.ok(texts.length >= 2, 'ไม่พบข้อความหัวครบ (หัวข้อ + ชื่อ อปท.)')
    for (const t of texts) {
      assert.ok(t.x + measure(t.text, t.size, t.bold) <= PLATE_LEFT + 0.01, `ข้อความหัวทับบล็อกผู้บริหาร: ${t.text} (${t.x + measure(t.text, t.size, t.bold)} > ${PLATE_LEFT})`)
    }
    // ป้ายทองบรรทัดนำต้องไม่ยื่นไปทับบล็อกผู้บริหาร
    const pill = /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" rx="[\d.]+" fill="#f5c242" data-lead-pill="1"\/>/.exec(svg)
    assert.ok(Number(pill[1]) + Number(pill[2]) <= PLATE_LEFT + 0.01, 'ป้ายทองบรรทัดนำทับบล็อกผู้บริหาร')
    const headerBottom = headerBottomOf(svg)
    const plate = /<rect [^>]*width="320" height="([\d.]+)" rx="26" fill="#ffffff"/.exec(svg)
    const plateY = Number(/<rect x="[\d.]+" y="([\d.]+)" width="320" height="[\d.]+" rx="26" fill="#ffffff"/.exec(svg)[1])
    assert.ok(plateY + Number(plate[1]) < headerBottom, 'แถบหัวต้องสูงกว่าก้นป้าย')
  }
  // ปิดบล็อก: ข้อความหัวไม่ถูกย่อ (หัวข้อ 68 ขาว · บรรทัดนำบนป้ายทอง 26 ตัวหนา · ชื่อ อปท. สีทอง)
  const off = headerTexts(draw(base()).svg)
  assert.ok(off.some(t => t.size === 68 && t.fill === '#ffffff' && t.text === 'ข่าวประชาสัมพันธ์'))
  assert.ok(off.some(t => t.size === 26 && t.bold && t.text === 'ผลการดำเนินงานผ่านระบบ E-Service'))
  assert.ok(off.some(t => t.fill === '#fde68a' && t.text === 'เทศบาลตำบลสาธิต'), 'ชื่อ อปท. ต้องเป็นสีทอง (หัวข้อสองสี)')
})

await test('ป้ายชื่อนายก: ย่อขนาดให้จบบรรทัดเดียวก่อน ไม่ปล่อยคำท้ายตกบรรทัด · ยาวมากตัดที่ช่องว่างแบบสมดุล', () => {
  // เคสจริง: "นาย ประยูร ท้าวใจแปง" ที่ 28pt ในป้าย 280 → "แปง" ตกไปยืนบรรทัดสองคนเดียว
  // ตัววัดที่ไม่นับสระบน/ล่าง/วรรณยุกต์ (กินที่แนวนอนเป็นศูนย์ในฟอนต์จริง) — ตัววัดหลักนับทุกอักขระ ชื่อไทยจึงยาวเกินจริง
  const thaiMeasure = (value, size, bold) => measure(value.replace(/[ัิ-ฺ็-๎]/g, ''), size, bold)
  const name = 'นาย ประยูร ท้าวใจแปง'
  const fit = News.fitPlateText(name, 276, 32, 24, true, thaiMeasure)
  assert.deepEqual(fit.lines, [name])
  assert.ok(fit.size >= 24 && fit.size < 32 && thaiMeasure(name, fit.size, true) <= 276)
  // สั้นพอ = ขนาดเต็ม
  assert.equal(News.fitPlateText('นายก', 276, 32, 24, true, measure).size, 32)
  // ยาวเกินแม้ขนาดเล็กสุด + มีช่องว่าง = 2 บรรทัด ตัดที่ช่องว่างที่ทำให้สองบรรทัดใกล้กันที่สุด ทุกบรรทัดไม่ล้น
  const long = News.fitPlateText('นายกองค์การบริหาร ส่วนตำบลคลองเกตุ', 276, 26, 20, false, measure)
  assert.equal(long.size, 20)
  assert.deepEqual(long.lines, ['นายกองค์การบริหาร', 'ส่วนตำบลคลองเกตุ'])
  // ไม่มีช่องว่างที่ตัดแล้วพอดี 2 บรรทัด = ตัดตามคำ (wrapLines) ทุกบรรทัดยังไม่ล้น
  const veryLong = News.fitPlateText('นายกองค์การบริหาร ส่วนตำบลคลองเกตุ อำเภอโคกสำโรง', 276, 26, 20, false, measure)
  assert.ok(veryLong.lines.length >= 2)
  for (const line of veryLong.lines) assert.ok(measure(line, 20, false) <= 276, line)
  for (const line of long.lines) assert.ok(measure(line, 20, false) <= 276, line)
  // ป้ายในภาพ: ชื่อ+ตำแหน่งปกติได้ 1 บรรทัดต่อค่า (กึ่งกลางป้าย x = 1080-64-160)
  const svg = News.buildNewsSvg(base({ executive: { name, title: 'นายกเทศมนตรีตำบลน้ำเลา' } }), thaiMeasure, { executivePhotoDataUrl: PHOTO }).svg
  const plateTexts = [...svg.matchAll(/<text x="856" [^>]*text-anchor="middle">([^<]*)<\/text>/g)].map(m => m[1])
  assert.deepEqual(plateTexts, [name, 'นายกเทศมนตรีตำบลน้ำเลา'])
})

// รูปจำลอง: ฉากสีเดียว + "คน" (หัววงกลม + ลำตัวสี่เหลี่ยมจรดขอบล่าง)
function portrait({ w = 80, h = 100, bg = [250, 250, 250], shirt = [30, 40, 90], noise = 0 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const head = (x - w / 2) ** 2 + (y - h * 0.35) ** 2 <= (w * 0.18) ** 2
      const body = y >= h * 0.55 && x >= w * 0.2 && x < w * 0.8
      const color = head ? [200, 150, 120] : body ? shirt : bg
      const jitter = noise ? ((x * 7 + y * 13) % (noise * 2 + 1)) - noise : 0
      const p = (y * w + x) * 4
      data[p] = color[0] + jitter; data[p + 1] = color[1] + jitter; data[p + 2] = color[2] + jitter; data[p + 3] = 255
    }
  }
  return { data, w, h }
}
const alphaAt = (img, x, y) => img.data[(y * img.w + x) * 4 + 3]

await test('ตัดพื้นหลังรูปนายก: ฉากเรียบ = พื้นโปร่งใส ตัวคนทึบ + กรอบชิดตัวคน', () => {
  const img = portrait({ noise: 4 })
  const box = News.cutoutPlainBackground(img.data, img.w, img.h)
  assert.ok(box, 'ฉากขาวเรียบต้องตัดได้')
  assert.equal(alphaAt(img, 2, 2), 0)
  assert.equal(alphaAt(img, 2, 98), 0) // มุมล่างซ้ายข้างลำตัว
  assert.equal(alphaAt(img, 40, 35), 255) // หน้า
  assert.equal(alphaAt(img, 40, 90), 255) // ลำตัว
  // กรอบเริ่มที่ยอดหัว (ไม่มีที่ว่างเหนือหัว) และจรดขอบล่าง
  assert.ok(box.y >= 18 && box.y <= 22, `ยอดหัว ${box.y}`)
  assert.equal(box.y + box.h, 100)
  // ฉากสีเดียวที่ไม่ใช่ขาว (ฟ้าแบบรูปติดบัตร) + เสื้อขาว ก็ตัดได้
  const blue = portrait({ bg: [70, 130, 200], shirt: [240, 240, 240] })
  assert.ok(News.cutoutPlainBackground(blue.data, blue.w, blue.h))
})

await test('ตัดพื้นหลังรูปนายก: ไม่แน่ใจ = ไม่ตัด (null) และไม่แตะพิกเซล', () => {
  // เสื้อขาวบนฉากขาว — ลำตัวกลืนเป็นพื้นหลัง ห้ามตัดจนเสื้อหาย
  const white = portrait({ shirt: [245, 245, 245] })
  const before = Uint8ClampedArray.from(white.data)
  assert.equal(News.cutoutPlainBackground(white.data, white.w, white.h), null)
  assert.deepEqual(white.data, before)
  // ฉากมีลาย (ถ่ายนอกสถานที่) — ขอบไม่ใช่สีเดียว
  const busy = portrait()
  for (let p = 0; p < busy.w * busy.h; p += 1) {
    const x = p % busy.w
    const y = (p - x) / busy.w
    if (busy.data[p * 4 + 2] === 250) { busy.data[p * 4] = (x * 37 + y * 91) % 200; busy.data[p * 4 + 1] = (x * 53 + y * 17) % 220 }
  }
  assert.equal(News.cutoutPlainBackground(busy.data, busy.w, busy.h), null)
  // ค่าผิดรูป
  assert.equal(News.cutoutPlainBackground(null, 10, 10), null)
  assert.equal(News.cutoutPlainBackground(new Uint8ClampedArray(16), 100, 100), null)
})

await test('รูปนายก PNG พื้นโปร่งใสมาเอง: คืนกรอบส่วนที่มองเห็น ไม่แตะพิกเซล · รูปทึบคืน null', () => {
  // รูปที่ตัดพื้นหลังมาแล้ว: นอกตัวคนโปร่งใส 100% + จุดเงาฟุ้งจาง (alpha 8)
  const cut = portrait()
  for (let p = 0; p < cut.w * cut.h; p += 1) if (cut.data[p * 4 + 2] === 250) cut.data[p * 4 + 3] = 0
  cut.data[(5 * cut.w + 5) * 4 + 3] = 8 // จุดเงาจางมุมบนซ้าย ห้ามดันกรอบให้กว้าง
  const before = Uint8ClampedArray.from(cut.data)
  const box = News.transparentPhotoBox(cut.data, cut.w, cut.h)
  assert.ok(box, 'PNG โปร่งใสต้องได้กรอบ')
  assert.deepEqual(cut.data, before, 'ห้ามแก้พิกเซลของรูปที่ผู้ใช้ตัดมาเอง')
  assert.ok(box.y >= 18 && box.y <= 22, `ยอดหัว ${box.y}`)
  assert.equal(box.y + box.h, 100)
  assert.equal(box.x, 16) // ไหล่ซ้าย (ลำตัวเริ่ม 20% ของ 80 px) ไม่ใช่จุดเงาที่ x=5
  // รูปทึบทั้งรูป (JPEG/PNG ธรรมดา) → null ให้ไปตัดฉากเรียบตามเดิม
  const solid = portrait()
  assert.equal(News.transparentPhotoBox(solid.data, solid.w, solid.h), null)
  // โปร่งใสแค่ไม่กี่จุด (< 1%) ไม่นับว่าตัดมาแล้ว
  for (let x = 0; x < 40; x += 1) solid.data[x * 4 + 3] = 0
  assert.equal(News.transparentPhotoBox(solid.data, solid.w, solid.h), null)
  // โปร่งใสทั้งรูป (ไฟล์ว่าง) → null ไม่มีอะไรให้วาด · ค่าผิดรูป → null
  assert.equal(News.transparentPhotoBox(new Uint8ClampedArray(20 * 20 * 4), 20, 20), null)
  assert.equal(News.transparentPhotoBox(null, 10, 10), null)
  assert.equal(News.transparentPhotoBox(new Uint8ClampedArray(16), 100, 100), null)
  assert.equal(News.NEWS_EXEC_PHOTO_SIDE, 720)
})

await test('static: รูปนายกผ่าน prepareExecutivePhoto (ตัดพื้นหลัง/กรอบสำรอง) ก่อนเข้าภาพข่าว · ไม่ส่งรูปออกนอกเครื่อง', async () => {
  const shared = await readFile(new URL('../src/components/complaints/newsDialogData.js', import.meta.url), 'utf8')
  assert.match(shared, /loadImage\(branding\.photo_url\)\s*\.then\(result => \(result\.dataUrl \? prepareExecutivePhoto\(result\.dataUrl\) : null\)\)/)
  const fn = shared.slice(shared.indexOf('export async function prepareExecutivePhoto'), shared.indexOf('export async function loadImage'))
  // PNG ที่โปร่งใสมาเองต้องตรวจก่อนตัดฉาก (cutoutPlainBackground แก้ pixels ในที่ ตรวจทีหลังจะเห็นแต่ผลตัดของเรา)
  assert.match(fn, /transparentPhotoBox\(pixels\.data, w, h\) \|\| cutoutPlainBackground\(pixels\.data, w, h\)/)
  assert.match(fn, /toDataURL\('image\/png'\)/) // PNG เท่านั้น — JPEG ไม่มีความโปร่งใส
  // ตัวย่อรูปก่อนวาด (shrinkDataUrl) ห้ามเทพื้นขาวทับ PNG/WebP โปร่งใส — เส้นทางที่รูปนายกผ่านก่อนถึง prepareExecutivePhoto
  const shrink = shared.slice(shared.indexOf('async function shrinkDataUrl'), shared.indexOf('const EXEC_SIDE'))
  const keep = shrink.indexOf("return canvas.toDataURL('image/png')")
  assert.ok(keep > 0 && keep < shrink.indexOf("fillStyle = '#ffffff'"), 'ต้องคืน PNG ก่อนถึงขั้นเทพื้นขาว')
  assert.match(shrink, /HAS_ALPHA_MIME\.test\(dataUrl\)[\s\S]{0,40}transparentPhotoBox\(/)
  assert.match(shared, /const EXEC_SIDE = NEWS_EXEC_PHOTO_SIDE/)
  assert.ok(!/fetch\(|supabase|https?:\/\//.test(fn), 'ตัดพื้นหลังต้องทำในเครื่องล้วน')
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
    // หมวดต้องผ่าน newsCategoryAllowed (ปิดตายเมื่อไม่แน่ใจ) — อยู่ในเงื่อนไขของปุ่มก่อนถึงเงื่อนไขสิทธิ์
    assert.match(part.slice(0, 200), /newsCategoryAllowed\(c\.category, categoryMeta\)/)
  }
  assert.match(manager, /<ComplaintNewsDialog[\s\S]{0,400}closedAt=\{finishedAtOf\(newsComplaint\)\}/)
  const dialog = await readFile(new URL('../src/components/complaints/ComplaintNewsDialog.jsx', import.meta.url), 'utf8')
  // ตัวโหลดรูป (fetchImageAsDataUrl) ย้ายไปไฟล์ร่วมของกล่องรายเรื่อง/ภาพรวม — กล่องต้องเรียกใช้ loadImage จากไฟล์นั้น
  const shared = await readFile(new URL('../src/components/complaints/newsDialogData.js', import.meta.url), 'utf8')
  assert.match(shared, /fetchImageAsDataUrl/)
  assert.match(dialog, /from '\.\/newsDialogData'/)
  assert.match(dialog, /loadImage\(ref\)/)
  assert.match(dialog, /\.eq\('status', 'closed'\)/)
  assert.match(dialog, /ตรวจก่อนว่าไม่มีหน้าคน ป้ายทะเบียน หรือเลขที่บ้าน รูปนี้ผู้แจ้งส่งมาเพื่อแจ้งเรื่อง ไม่ได้ส่งมาเพื่อลงเพจ/)
  assert.match(dialog, /ระบบติ๊กให้เองเมื่อเสร็จทันกำหนด · เกินกำหนดจะไม่ติ๊กไว้ก่อน/)
})

// ───────── ลูกเล่นแนว "เมืองอัจฉริยะ": สีธีมตามกอง · ลายวงจร · ไอคอนหมวด · แถบขั้นตอน · ป้ายมุมรูป ─────────
const Colors = await import('../src/lib/departmentColors.js')
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

await test('สีธีม: ครบ 9 คีย์ของกอง · ขาว/ว่าง/ไม่รู้จัก = ส้มเดิม · base คอนทราสต์กับตัวอักษรขาว ≥ 4.5:1 (คำนวณ WCAG จริง)', () => {
  const keys = Colors.DEPARTMENT_COLORS.map(color => color.key)
  assert.equal(keys.length, 9)
  for (const key of keys.filter(key => key !== 'white')) {
    const theme = Colors.newsThemeFor(key)
    assert.deepEqual(Object.keys(theme).sort(), ['base', 'deep', 'ink', 'soft'], key)
    assert.ok(Object.values(theme).every(value => /^#[0-9a-f]{6}$/.test(value)), key)
    assert.ok(contrast(theme.base, '#ffffff') >= 4.5, `${key}: base ${theme.base} คอนทราสต์ ${contrast(theme.base, '#ffffff').toFixed(2)}`)
    assert.ok(contrast(theme.deep, '#ffffff') >= contrast(theme.base, '#ffffff'), `${key}: deep ต้องเข้มกว่า base`)
    assert.ok(contrast(theme.ink, theme.soft) >= 4.5, `${key}: ตัวอักษรป้ายระยะเวลาอ่านได้`)
  }
  assert.deepEqual(Colors.newsThemeFor('orange'), { base: '#c2410c', deep: '#7c2d12', soft: '#ffedd5', ink: '#9a3412' })
  for (const key of ['white', null, undefined, '', 'pink', 'constructor', '__proto__']) assert.deepEqual(Colors.newsThemeFor(key), Colors.newsThemeFor('orange'), String(key))
  assert.equal(Colors.newsThemeFor('blue').base, '#1d4ed8')
  // จับคู่ชื่อกอง: ตรง name หรือ short_name (ตัดช่องว่าง) · ไม่เจอ/ไม่มีชื่อ = null → ส้ม
  const rows = [{ name: 'กองช่าง', short_name: 'ช่าง', color: 'blue' }, { name: 'กองคลัง', short_name: null, color: null }]
  assert.equal(Colors.departmentColorKeyByName(rows, ' กองช่าง '), 'blue')
  assert.equal(Colors.departmentColorKeyByName(rows, 'ช่าง'), 'blue')
  assert.equal(Colors.departmentColorKeyByName(rows, 'กองคลัง'), null)
  assert.equal(Colors.departmentColorKeyByName(rows, 'กองอื่น'), null)
  assert.equal(Colors.departmentColorKeyByName(rows, ''), null)
  assert.equal(Colors.departmentColorKeyByName(null, 'กองช่าง'), null)
})

await test('สีธีมถูกใช้ที่แถบหัว/แถบท้าย/ป้ายระยะเวลา/วันที่/ขอบป้ายนายก · ไม่ส่งธีม = ส้มเดิม · ป้ายสถานะคงเขียว', () => {
  const blue = Colors.newsThemeFor('blue')
  const svg = draw(base({ theme: blue, executive: { name: 'นายสมมติ ตัวอย่าง', title: 'นายกเทศมนตรี' } })).svg
  assert.match(svg, new RegExp(`<linearGradient id="news-head-grad"[^>]*><stop offset="0" stop-color="${blue.deep}"/><stop offset="1" stop-color="${blue.base}"/>`))
  assert.match(svg, new RegExp(`<linearGradient id="news-foot-grad"[^>]*><stop offset="0" stop-color="${blue.deep}"/><stop offset="1" stop-color="${blue.base}"/>`))
  assert.match(svg, /fill="url\(#news-head-grad\)"/)
  assert.match(svg, /fill="url\(#news-foot-grad\)"/)
  assert.ok(svg.includes(`fill="${blue.soft}"`) && svg.includes(`fill="${blue.ink}"`), 'ป้ายวันที่ใช้ soft/ink')
  assert.ok(svg.includes(`fill="${blue.base}"`), 'ไอคอนหมวด/วงเรืองแสงขั้นตอนใช้ base')
  assert.ok(svg.includes(`fill="${blue.deep}" fill-opacity="0.28"`), 'เงาป้ายนายกใช้ deep')
  // การ์ดระยะเวลาไล่สีจากสีกอง → deep · การ์ดสถานะคงเขียว (สถานะ ไม่ใช่สีกอง)
  assert.match(svg, new RegExp(`<linearGradient id="news-stat-1"[^>]*><stop offset="0" stop-color="#[0-9a-f]{6}"/><stop offset="1" stop-color="${blue.deep}"/>`))
  assert.match(svg, /<linearGradient id="news-stat-0"[^>]*><stop offset="0" stop-color="#22c55e"\/><stop offset="1" stop-color="#166534"\/>/)
  assert.ok(has(svg, 'ดำเนินการแล้ว'), 'การ์ดดำเนินการแล้วคงเขียว')
  assert.ok(!svg.includes('#c2410c') && !svg.includes('#fdba74'), 'สีส้ม/ส้มอ่อนเดิมต้องไม่หลงเหลือในธีมน้ำเงิน')
  // ไม่ส่งธีม (หรือส่งค่าผิดรูป) = ส้มชุดเดิม
  for (const bad of [undefined, null, {}, { base: 'red', deep: '#000000', soft: '#ffffff', ink: '#000000' }]) {
    const model = base({ theme: bad })
    assert.deepEqual(model.theme, Colors.newsThemeFor('orange'))
    assert.ok(draw(model).svg.includes('stop-color="#c2410c"'))
  }
  assert.deepEqual(News.buildNewsModel({ tenantName: 'ท' }).theme, Colors.newsThemeFor('orange'))
})

await test('แถบหัว/ท้ายแบบอินโฟกราฟิก: แถบทอง 3 เส้น · วงกลมจางตายตัว clip ในแถบ วางก่อน QR · QR ในการ์ดขาว · ไม่ใช้ filter/Math.random', async () => {
  const model = base({ reportUrl: 'https://namlao.example.test/complaint' })
  const first = draw(model, { photoDataUrls: [PHOTO] }).svg
  assert.equal(draw(model, { photoDataUrls: [PHOTO] }).svg, first, 'ภาพเดิมต้องได้ SVG เดิมทุกครั้ง')
  // แถบทองบนสุด + ใต้แถบหัว + เหนือแถบท้าย (หนา 10 สีทอง)
  for (const where of ['top', 'header', 'footer']) assert.match(first, new RegExp(`height="10" fill="#f5c242" data-gold-band="${where}"`), `แถบทอง ${where}`)
  // วงกลมจาง 2 ชุด (หัว/ท้าย) clip ด้วยกรอบแถบ ความทึบ ≤ 0.1
  assert.match(first, /<g clip-path="url\(#news-head-clip\)" data-bokeh="1">/)
  assert.match(first, /<g clip-path="url\(#news-foot-clip\)" data-bokeh="1">/)
  for (const group of first.matchAll(/data-bokeh="1">(.*?)<\/g>/gs)) {
    const opacities = [...group[1].matchAll(/fill-opacity="([\d.]+)"/g)].map(match => Number(match[1]))
    assert.equal(opacities.length, 3)
    assert.ok(opacities.every(value => value > 0 && value <= 0.1), `วงกลมจางเข้มเกิน: ${opacities}`)
  }
  // วงกลมจางท้ายอยู่ก่อน QR + QR อยู่ในการ์ดขาวพร้อมคำใต้ QR
  assert.ok(first.indexOf('data-bokeh="1"', first.indexOf('data-footer="1"')) < first.indexOf('shape-rendering="crispEdges"'))
  assert.match(first, /fill="#ffffff" data-qr-card="1"\/>/)
  assert.ok(has(first, 'แจ้งเรื่องออนไลน์'))
  assert.ok(!/<filter|filter=/.test(first), 'ห้ามใช้ SVG filter (บางเบราว์เซอร์ไม่วาดตอนแปลงเป็น PNG)')
  const source = await readFile(new URL('../src/lib/complaintNewsImage.js', import.meta.url), 'utf8')
  assert.ok(!/Math\.random/.test(source), 'ห้ามใช้ Math.random (ภาพเดิมต้องได้ SVG เดิมทุกครั้ง)')
  // บรรทัดแรกแถบท้ายสีทอง (หัวข้อสองสี) · ไม่มี QR = ข้อความขอบคุณก็ยังบรรทัดแรกสีทอง
  assert.match(first, /fill="#fde68a" fill-opacity="1">พบปัญหาในชุมชน/)
  assert.match(draw(base(), {}).svg, /fill="#fde68a" fill-opacity="1">ขอบคุณ/)
})

await test('ขอบป้ายนายกเป็นทอง (ไม่ใช่ส้มอ่อนเดิม)', () => {
  const svg = draw(base({ executive: { name: 'นายสมมติ ตัวอย่าง', title: 'นายกเทศมนตรี' } })).svg
  assert.match(svg, /fill="#ffffff" stroke="#f5c242" stroke-width="4"/)
})

await test('ไอคอนหมวด: มีรหัสหมวด = วงกลมสีธีม + ไอคอนขาวหน้าวันที่ · ไม่มีรหัส = ไม่วาด · หมวดสร้างเอง = ไอคอนกลาง', () => {
  const blue = Colors.newsThemeFor('blue')
  const light = draw(base({ categoryCode: 'light', theme: blue })).svg
  // วงไอคอนอยู่ในป้ายวันที่ (แท็กสีอ่อนของธีม) ชิดซ้าย: 64 + 5 + รัศมี 21 = 90
  assert.match(light, new RegExp(`<circle cx="90" cy="[\\d.]+" r="21" fill="${blue.base}" data-category-icon="light"/>`))
  assert.match(light, new RegExp(`fill="${blue.soft}" data-date-tag="1"/>`))
  assert.equal(base({ categoryCode: ' light ' }).categoryCode, 'light')
  // วันที่ขยับไปทางขวาของวงกลม (64 + 5 + 42 + 12 = 123) · ตัวอักษรสี ink ของธีมบนแท็กสีอ่อน
  assert.match(light, /<text x="123" y="[\d.]+" font-size="28" font-weight="700" fill="#1e40af"[^>]*>วันที่ 10 พฤศจิกายน 2569<\/text>/)
  const none = draw(base()).svg
  assert.ok(!none.includes('data-category-icon'))
  assert.match(none, /<text x="86" y="[\d.]+" font-size="28" font-weight="700" fill="#9a3412"[^>]*>วันที่ /)
  assert.equal(base({ categoryCode: '' }).categoryCode, '')
  assert.equal(base({ categoryCode: null }).categoryCode, '')
  assert.ok(draw(base({ categoryCode: 'cat_x1y2' })).svg.includes('data-category-icon="cat_x1y2"'))
  // รหัสหมวดถูก escape (ค่าจากฐานข้อมูล แอดมินตั้งเองได้)
  assert.ok(!draw(base({ categoryCode: 'a"><script>' })).svg.includes('<script>'))
})

await test('แถบขั้นตอน 4 จุด: รายเรื่องมีวันที่เฉพาะหัว-ท้าย สองจุดกลางว่าง · ไม่มีวัน = ไม่ใส่ · ภาพรวมไม่มีวันที่', () => {
  const model = base()
  assert.deepEqual(model.steps, [
    { label: 'แจ้งเรื่อง', date: '3 พ.ย. 2569' }, { label: 'รับเรื่อง', date: '' },
    { label: 'ดำเนินการ', date: '' }, { label: 'เสร็จสิ้น', date: '10 พ.ย. 2569' },
  ])
  assert.equal(News.thaiShortDate('2026-12-31T20:00:00Z'), '1 ม.ค. 2570') // 03:00 ของวันที่ 1 ตามเวลาไทย
  assert.equal(News.thaiShortDate('ไม่ใช่วัน'), '')
  const svg = draw(model).svg
  for (const label of ['แจ้งเรื่อง', 'รับเรื่อง', 'ดำเนินการ', 'เสร็จสิ้น']) assert.ok(has(svg, label), label)
  assert.ok(has(svg, '3 พ.ย. 2569') && has(svg, '10 พ.ย. 2569'))
  assert.ok(!has(svg, 'ลงพื้นที่</text>'), 'ป้ายขั้นตอนใช้ "ดำเนินการ" ไม่ใช่ "ลงพื้นที่"')
  assert.equal((svg.match(/r="20" fill="url\(#news-step-ball\)" data-step-ball="1"/g) ?? []).length, 4, 'วงกลมขั้นตอน 4 วง')
  // มิติ 3D (เจ้าของสั่ง 2569-11-12 คงแบบวงกลม+เส้นเดิม แค่เพิ่มมิติ): ลูกบอลไล่สีจากสว่างซ้ายบน → สีธีม → deep
  // + เงาวงรีใต้ทุกวง + เส้นเชื่อมไล่สีมีเงา · อยู่ในการ์ดขาว · ไม่ใช่ชิป (ห้ามเปลี่ยนเป็นชิป)
  assert.match(svg, /<radialGradient id="news-step-ball" cx="0\.35" cy="0\.3" r="0\.75"><stop offset="0" stop-color="#[0-9a-f]{6}"\/><stop offset="0\.55" stop-color="#c2410c"\/><stop offset="1" stop-color="#7c2d12"\/>/)
  assert.equal((svg.match(/data-step-shadow="1"/g) ?? []).length, 4, 'เงาใต้วงครบ 4')
  assert.equal((svg.match(/stroke="url\(#news-step-line\)"[^>]*data-step-line="1"/g) ?? []).length, 3, 'เส้นเชื่อม 3 ช่วง')
  assert.match(svg, /data-steps-card="1"/)
  // ไม่มีวันยื่น/วันปิด = ไม่ใส่วันที่จุดนั้น (ไม่เดา) แต่ขั้นตอนยังครบ 4
  const noDates = News.buildNewsModel({ tenantName: 'ท', headline: 'x' })
  assert.deepEqual(noDates.steps.map(step => step.date), ['', '', '', ''])
  assert.equal(noDates.steps.length, 4)
  assert.deepEqual(News.buildNewsModel({ tenantName: 'ท', createdAt: CREATED }).steps.map(step => step.date), ['3 พ.ย. 2569', '', '', ''])
  // ภาพรวม: ครบ 4 จุด ไม่มีวันที่ แม้วันปิดงานรู้
  const batch = News.buildBatchNewsModel({
    items: [{ village: '3', createdAt: CREATED, closedAt: CLOSED, dueDate: '2026-11-12' }, { village: '5', createdAt: CREATED, closedAt: CLOSED, dueDate: '2026-11-12' }],
    tenantName: 'ท', departmentName: 'กองช่าง', categoryLabel: 'ไฟฟ้า', categoryCode: 'light',
  })
  assert.deepEqual(batch.steps.map(step => step.label), ['แจ้งเรื่อง', 'รับเรื่อง', 'ดำเนินการ', 'เสร็จสิ้น'])
  assert.deepEqual(batch.steps.map(step => step.date), ['', '', '', ''])
  assert.equal(batch.categoryCode, 'light')
  assert.ok(!/\d+ (ม\.ค\.|พ\.ย\.)/.test(plain(draw(batch).svg).replace(/วันที่\d+พฤศจิกายน\d+/, '')), 'ภาพรวมไม่ควรมีวันที่แบบย่อ')
})

await test('ป้ายมุมรูป: ก่อน/หลังดำเนินการตาม photoKinds · รูปที่ถูกกรองไม่ทำให้ป้ายเลื่อน · ไม่ส่ง kind = ไม่มีป้าย · ไม่ล้นช่อง', () => {
  const a = `${PHOTO.slice(0, -2)}A=`
  const b = `${PHOTO.slice(0, -2)}B=`
  const c = `${PHOTO.slice(0, -2)}C=`
  const kinds = svg => [...svg.matchAll(/data-photo-kind="(\w+)"/g)].map(match => match[1])
  // รูปที่ 2 ใช้ไม่ได้ (ไม่ใช่ data:image) ถูกตัดพร้อมป้ายของมัน — ป้ายของรูปที่ 3 ไม่เลื่อนมาติดรูปที่ 2
  const filtered = draw(base(), { photoDataUrls: [a, 'https://evil.test/x.png', b], photoKinds: ['before', 'before', 'after'] }).svg
  assert.deepEqual(kinds(filtered), ['before', 'after'])
  assert.ok(has(filtered, 'ก่อนดำเนินการ') && has(filtered, 'หลังดำเนินการ'))
  assert.ok(!filtered.includes('evil.test'))
  const mixed = draw(base(), { photoDataUrls: [a, b, c], photoKinds: ['after', 'before', 'after'] }).svg
  assert.deepEqual(kinds(mixed), ['after', 'before', 'after'])
  // ไม่ส่ง photoKinds / ค่าผิด = ไม่มีป้าย
  assert.deepEqual(kinds(draw(base(), { photoDataUrls: [a, b] }).svg), [])
  assert.deepEqual(kinds(draw(base(), { photoDataUrls: [a, b], photoKinds: ['x', null] }).svg), [])
  assert.deepEqual(kinds(draw(base(), { photoDataUrls: [a, b], photoKinds: ['constructor', 'toString'] }).svg), [])
  assert.ok(!has(draw(base(), { photoDataUrls: [a] }).svg, 'ก่อนดำเนินการ'))
  // แท็กสีเม็ดยา (แบบ "วันที่ 0" ในภาพอ้างอิง): หลัง = เขียวสถานะ · ก่อน = ส้มอำพัน + กล้อง (lucide) + ข้อความขาว 24 + เงา
  const one = draw(base(), { photoDataUrls: [a], photoKinds: ['after'] }).svg
  assert.match(one, /<rect [^>]*rx="22" fill="#15803d" data-photo-kind="after"\/>/)
  assert.match(one, /font-size="24" font-weight="700" fill="#ffffff"[^>]*>หลังดำเนินการ<\/text>/)
  assert.match(draw(base(), { photoDataUrls: [a], photoKinds: ['before'] }).svg, /<rect [^>]*rx="22" fill="#d97706" data-photo-kind="before"\/>/)
  // รูปอยู่ในการ์ดขาวขอบหนามีเงา
  assert.match(one, /fill="#ffffff" data-photo-card="1"\/>/)
  // ช่องแคบ · ตัววัดกว้างผิดปกติ = เหลือแค่ไอคอน ป้ายไม่ล้นขอบช่อง
  const wide = News.buildNewsSvg(base(), (value, size, bold) => value.length * size * (bold ? 0.62 : 0.55) * (size === 24 ? 6 : 1), { photoDataUrls: [a, b, c, a], photoKinds: ['after', 'after', 'after', 'after'] })
  const cellWidths = [...wide.svg.matchAll(/<clipPath id="news-photo-\d"><rect x="[\d.]+" y="[\d.]+" width="([\d.]+)"/g)].map(match => Number(match[1]))
  const badgeWidths = [...wide.svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="(\d+)" height="44" rx="22" fill="#15803d"/g)].map(match => Number(match[1]))
  assert.equal(badgeWidths.length, 4)
  assert.ok(badgeWidths.every((width, i) => width <= cellWidths[i] - 28), `ป้ายล้นช่อง: ${badgeWidths} / ${cellWidths}`)
  assert.ok(!has(wide.svg, 'หลังดำเนินการ'), 'ช่องแคบเกินไป = ไม่ใส่ข้อความ เหลือแต่ไอคอน')
})

await test('static: กล่องทั้งสองใช้ useDepartmentTheme · ส่ง categoryCode/photoKinds/theme เข้าภาพ · รูปผู้แจ้ง = ก่อน รูปผลงาน = หลัง', async () => {
  const dialog = await readFile(new URL('../src/components/complaints/ComplaintNewsDialog.jsx', import.meta.url), 'utf8')
  const batch = await readFile(new URL('../src/components/complaints/ComplaintNewsBatchDialog.jsx', import.meta.url), 'utf8')
  const shared = await readFile(new URL('../src/components/complaints/newsDialogData.js', import.meta.url), 'utf8')
  assert.match(shared, /export function useDepartmentTheme\(tenantId, departmentName\)/)
  assert.match(shared, /supabase\.from\('departments'\)\.select\('name, short_name, color'\)\.eq\('municipality_id', tenantId\)/)
  assert.match(shared, /newsThemeFor\(departmentColorKeyByName\(rows, departmentName\)\)/)
  for (const source of [dialog, batch]) {
    assert.match(source, /useDepartmentTheme\(tenant\?\.id, departmentName\)/)
    assert.match(source, /theme/)
  }
  // staff: รหัสหมวดจาก c.category · รูปคีย์ w: = after, a: = before
  assert.match(dialog, /categoryCode: c\.category \?\? ''/)
  assert.match(dialog, /key\.startsWith\('w:'\) \? 'after' : 'before'/)
  assert.match(dialog, /photoKinds/)
  // exec: รหัสหมวดมาจาก RPC exec_complaint_news_detail (คืน category อยู่แล้ว — ไม่แก้ SQL)
  assert.match(dialog, /category: d\.category/)
  assert.match(batch, /photoKinds: photoDataUrls\.map\(\(\) => 'after'\)/)
  assert.match(batch, /category: data\.category/)
  assert.match(batch, /isExec \? \(pickedItems\.map\(item => detailOf\(item\)\?\.category\)\.find\(Boolean\) \?\? ''\) : \(group\?\.categoryKey \?\? ''\)/)
  const migration = await readFile(new URL('../supabase/migrations/20261119100100_complaint_news_functions.sql', import.meta.url), 'utf8')
  assert.match(migration, /'category', c\.category,/)
})

await test('จบ A4 แผ่นเดียว: เพดาน 1527 px · photoCells ย่อช่องรูปตามที่ว่างแต่ไม่ต่ำกว่า 300 · ไม่ส่งเพดาน = ผลเดิม', () => {
  assert.equal(News.NEWS_MAX_HEIGHT, 1527) // 1080 × 297 / 210 ปัดลง
  for (const count of [1, 2, 3, 4]) {
    assert.deepEqual(News.photoCells(count, 52, Infinity), News.photoCells(count, 52))
    const squeezed = News.photoCells(count, 52, 500)
    const floor = count <= 2 ? News.NEWS_PHOTO_MIN_H : News.NEWS_GRID_MIN_H // 1–2 รูป ≥300 · 3–4 รูป (2 แถว) ≥200
    assert.ok(squeezed.cells.every(cell => cell.h >= floor), `${count} รูป ช่องต้องไม่เตี้ยกว่าขั้นต่ำ`)
  }
  // ที่ว่างพอดีกลางทาง: 2 รูป ที่ว่าง 400 (ไม่มีป้าย) → ช่องสูง 400 ตารางสูง 400
  const two = News.photoCells(2, 0, 400)
  assert.equal(two.cells[0].h, 400)
  assert.equal(two.height, 400)
  // 4 รูปมีป้าย 52: ที่ว่าง 800 → (800 − 52×2 − 16)/2 = 340 ต่อช่อง · ตารางสูงตรงที่ว่าง
  const four = News.photoCells(4, 52, 800)
  assert.equal(four.cells[0].h, 340)
  assert.equal(four.height, 800)
  assert.equal(four.cells[2].y, 340 + 16 + 52)
  // ที่ว่างเหลือเฟือ = ไม่ขยายเกินขนาดเดิม
  assert.equal(News.photoCells(2, 0, 5000).cells[0].h, 520)
})

await test('จบ A4 แผ่นเดียว: 3–4 รูปที่ 2×2 ไม่พอที่ → แถวเดียวเรียงข้างกัน (ไม่ทับ ไม่ล้นความกว้าง ไม่เตี้ยกว่า 200)', () => {
  for (const count of [3, 4]) {
    const row = News.photoCells(count, 52, 450) // 2×2 ได้ช่องละ (450−104−16)/2=165 < 200 → แถวเดียว
    assert.equal(row.cells.length, count)
    assert.ok(row.cells.every(cell => cell.y === 0 && cell.h >= 200 && cell.h <= 320), JSON.stringify(row.cells))
    const right = row.cells.at(-1)
    assert.ok(Math.abs(right.x + right.w - (1080 - 64 * 2)) < 0.01, 'ช่องสุดท้ายชิดขอบขวาของพื้นที่เนื้อหา')
    for (let i = 1; i < row.cells.length; i += 1) assert.ok(row.cells[i].x >= row.cells[i - 1].x + row.cells[i - 1].w, 'ช่องต้องไม่ทับกัน')
    assert.ok(row.height <= 450, `แถวเดียวต้องไม่เกินที่ว่าง ${row.height}`)
  }
  // ที่ว่างพอสำหรับ 2×2 (ช่อง ≥ 200) = ยังเป็น 2×2 เหมือนเดิม
  assert.equal(News.photoCells(4, 0, 800).cells[2].y > 0, true)
  assert.equal(News.photoCells(4).cells[2].y > 0, true)
})

await test('จบ A4 แผ่นเดียว: นายก+QR+ป้ายก่อน/หลัง ทุกจำนวนรูป 0–4 จบ ≤ 1527 · ทั้งมีรูปนายกและป้ายอย่างเดียว', () => {
  const model = base({
    headline: 'กองช่าง เทศบาลตำบลสาธิต ลงพื้นที่ดำเนินการเรื่องไฟฟ้าสาธารณะ หมู่ 3 ตามที่ประชาชนแจ้งผ่านระบบ E-Service',
    detail: 'เปลี่ยนหลอดไฟและตรวจสอบสายไฟแล้ว ใช้งานได้ปกติ',
    executive: { name: 'นายสมมติ ตัวอย่างดี', title: 'นายกเทศมนตรีตำบลสาธิต' },
    reportUrl: 'https://namlao.example.test/complaint',
  })
  const run = (count, assets = {}) => {
    const photos = Array.from({ length: count }, () => PHOTO)
    return draw(model, { photoDataUrls: photos, photoKinds: photos.map((_, i) => (i === 0 ? 'before' : 'after')), ...assets })
  }
  for (const count of [0, 1, 2, 3, 4]) {
    const out = run(count, { executivePhotoDataUrl: PHOTO })
    assert.ok(out.fitsA4, `${count} รูป+รูปนายก ต้อง fitsA4 (สูง ${out.height})`)
    assert.ok(out.height <= News.NEWS_MAX_HEIGHT && out.height >= News.NEWS_MIN_HEIGHT, `${count} รูป สูง ${out.height}`)
    assert.match(out.svg, new RegExp(`height="${out.height}"`))
  }
  for (const count of [0, 1, 2, 3, 4]) {
    const out = run(count) // ไม่มีรูปนายก = ป้ายชื่ออย่างเดียว หัวเตี้ยกว่า
    assert.ok(out.fitsA4, `${count} รูป (ป้ายนายกอย่างเดียว) ต้อง fitsA4 (สูง ${out.height})`)
  }
  // ภาพรวม: ป้ายหมู่ใต้รูป + "และอีก N จุด" ก็ต้องจบ A4 ทั้งมี/ไม่มีรูปนายก
  for (const assets of [{}, { executivePhotoDataUrl: PHOTO }]) {
    const batch = run(4, { photoCaptions: ['หมู่ 1', 'หมู่ 2', 'หมู่ 3', 'หมู่ 4'], moreText: 'และอีก 6 จุด', ...assets })
    assert.ok(batch.fitsA4, `ภาพรวม สูง ${batch.height}`)
  }
})

await test('จบ A4 แผ่นเดียว: แถบขั้นตอน (พร้อมวันที่) อยู่ครบทุกกรณี · บีบด้วยการย่อรูป/กรอบ/ตัวหนังสือ · ข้อความล้นมาก = fitsA4 false ไม่ตัดข้อความ', () => {
  const exec = { name: 'นายสมมติ ตัวอย่างดี', title: 'นายกเทศมนตรีตำบลสาธิต' }
  const heading = 'กองช่าง เทศบาลตำบลสาธิต ลงพื้นที่ดำเนินการเรื่องไฟฟ้าสาธารณะ หมู่ 3 ตามที่ประชาชนแจ้งผ่านระบบ E-Service'
  // ขนาดฟอนต์ของ <text> แรกที่มีข้อความนั้น (หัวข้อข่าวถูกตัดเป็นหลายบรรทัด ใช้คำขึ้นต้นระบุ)
  const fontSizeOf = (svg, phrase) => {
    for (const match of svg.matchAll(/<text[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)) if (match[2].includes(phrase)) return Number(match[1])
    return NaN
  }
  // ไม่ต้องบีบ (ไม่มีรูป) = ขนาดเต็ม · หัวข้อข่าว 40
  const short = draw(base({ headline: heading }), {})
  assert.ok(has(short.svg, 'แจ้งเรื่อง') && has(short.svg, '3 พ.ย. 2569') && has(short.svg, '10 พ.ย. 2569'))
  assert.equal(fontSizeOf(short.svg, 'กองช่าง'), 40)
  // ต้องบีบ (นายก + 2 รูป): แถบขั้นตอนยังอยู่ครบพร้อมวันที่ · หัวข้อข่าวย่อลงแต่ไม่ต่ำกว่า 32 · ภาพจบ A4
  const squeezed = draw(base({ headline: heading, executive: exec, reportUrl: 'https://namlao.example.test/complaint' }), { photoDataUrls: [PHOTO, PHOTO], executivePhotoDataUrl: PHOTO })
  assert.ok(squeezed.fitsA4)
  for (const phrase of ['แจ้งเรื่อง', 'รับเรื่อง', 'ดำเนินการ', 'เสร็จสิ้น', '3 พ.ย. 2569', '10 พ.ย. 2569']) assert.ok(has(squeezed.svg, phrase), `ต้องมี ${phrase}`)
  const headlineSize = fontSizeOf(squeezed.svg, 'กองช่าง')
  assert.ok(headlineSize >= 32 && headlineSize < 40, `หัวข้อข่าวต้องย่อลงแต่ไม่ต่ำกว่า 32: ${headlineSize}`)
  // ข้อความข่าวยาวเกินกว่าจะพอดีแม้บีบสุดทาง → ล้น fitsA4 false แต่ข้อความครบ ไม่ถูกตัด และยังมีแถบขั้นตอน
  const longText = 'ซ่อมแซมไฟฟ้าสาธารณะ '.repeat(40).trim()
  const over = draw(base({ headline: longText }), { photoDataUrls: [PHOTO, PHOTO] })
  assert.equal(over.fitsA4, false)
  assert.ok(has(over.svg, longText.slice(0, 30)))
  assert.ok(has(over.svg, 'แจ้งเรื่อง'), 'ล้นก็ยังต้องมีแถบขั้นตอน (ไม่ตัดทิ้ง)')
  // วาดซ้ำหลายรอบภายใน buildNewsSvg แต่ SVG ที่ส่งออกต้องมี id ละชุดเดียว
  for (const id of ['news-head-grad', 'news-head-clip', 'news-foot-grad', 'news-foot-clip', 'news-bg-grad', 'news-step-ball', 'news-step-line']) assert.equal((over.svg.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1, id)
})

await test('พื้นหลังแบบอินโฟกราฟิก: ไล่สีเทาอมสีกองอ่อน → ขาว ไม่มีลาย · การ์ดขาวเงานุ่ม (สถานะ/ขั้นตอน/รายละเอียด/รูป/QR) · ไม่มี filter · ตายตัว', () => {
  for (const color of ['blue', 'green', 'orange']) {
    const theme = Colors.newsThemeFor(color)
    const svg = draw(base({ theme, detail: 'เปลี่ยนหลอดไฟแล้ว', reportUrl: 'https://namlao.example.test/complaint' }), { photoDataUrls: [PHOTO] }).svg
    // พื้นหลังเริ่มจากสีอ่อน (ผสม soft ของธีมกับเทาอ่อน) → ขาว
    const stops = svg.match(/<linearGradient id="news-bg-grad"[^>]*><stop offset="0" stop-color="(#[0-9a-f]{6})"\/><stop offset="1" stop-color="(#[0-9a-f]{6})"/)
    assert.notEqual(stops[1], '#ffffff')
    assert.equal(stops[2], '#ffffff')
    assert.ok([1, 3, 5].every(i => parseInt(stops[1].slice(i, i + 2), 16) >= 0xd8), `${color} พื้นต้องอ่อน ${stops[1]}`)
    // พื้นหลังมาก่อนแถบหัว · ไม่มีลายจุด/ลายเครือข่ายแบบเดิมแล้ว (สะอาดแบบภาพอ้างอิง)
    assert.ok(svg.indexOf('data-backdrop="1"') < svg.indexOf('data-header="1"'))
    assert.ok(!svg.includes('data-network') && !svg.includes('news-dots') && !svg.includes('data-circuit'))
    // การ์ดขาวเงานุ่มทุกกลุ่มเนื้อหา + กล่อง callout เหลืองอ่อน
    for (const marker of ['data-stat="status"', 'data-steps-card="1"', 'data-callout="1"', 'data-photo-card="1"', 'data-qr-card="1"']) assert.ok(svg.includes(marker), marker)
    assert.match(svg, /fill="#fefce8" stroke="#fde68a" stroke-width="2" data-callout="1"/)
    assert.ok(has(svg, 'เปลี่ยนหลอดไฟแล้ว'))
    // แถบทองนำหน้าหัวข้อข่าว
    assert.match(svg, /fill="#f5c242" data-headline-bar="1"/)
    // เงาเป็นสี่เหลี่ยมความทึบต่ำ ≤ 0.25 (ไม่ใช้ filter)
    for (const value of svg.match(/fill="#0f172a" fill-opacity="0\.\d+"/g)) assert.ok(Number(value.match(/0\.\d+/)[0]) <= 0.25, value)
    assert.ok(!/<filter|filter=/.test(svg))
    assert.equal(draw(base({ theme }), { photoDataUrls: [PHOTO] }).svg, draw(base({ theme }), { photoDataUrls: [PHOTO] }).svg)
  }
  // ไม่มีรายละเอียด = ไม่มีกล่อง callout
  assert.ok(!draw(base({ detail: '' })).svg.includes('data-callout'))
})

await test('static: ภาพข่าวจบ A4 — ไล่ NEWS_FIT_LEVELS (ย่อตัวหนังสือ/รูปนายก/แถบท้าย/รูปงาน) ไม่ตัดแถบขั้นตอน · แถบท้ายคำนวณก่อนส่วนรูป · หน้าจอเตือนเมื่อล้น', async () => {
  const src = await readFile(new URL('../src/lib/complaintNewsImage.js', import.meta.url), 'utf8')
  assert.match(src, /for \(const fit of NEWS_FIT_LEVELS\)/)
  const levels = src.slice(src.indexOf('const NEWS_FIT_LEVELS'), src.indexOf('function drawNewsSvg'))
  const rows = [...levels.matchAll(/\{ t: ([\d.]+), exec: ([\d.]+), foot: ([\d.]+), min: (\d+) \}/g)].map(match => match.slice(1).map(Number))
  assert.ok(rows.length >= 4)
  assert.deepEqual(rows[0], [1, 1, 1, 300], 'ขั้นแรก = ขนาดเต็ม')
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i].every((value, k) => value <= rows[i - 1][k]), 'แต่ละขั้นต้องเล็กลงหรือเท่าเดิมทุกค่า')
  const last = rows.at(-1)
  assert.ok(40 * last[0] >= 32 && 200 * last[2] >= 160 && last[3] >= 220 && 300 * last[1] >= 135, 'ขั้นต่ำสุด: หัวข้อ ≥32 · QR ≥160 · ช่องรูป ≥220 · รูปนายก ≥135')
  assert.match(src, /qrLayout\(model\.reportUrl, fs\(200\)\)/)
  assert.ok(!/stepsMode|'compact'|'none'/.test(src), 'ห้ามกลับไปซ่อน/ตัดแถบขั้นตอน (เจ้าของสั่ง 2569-11-12)')
  assert.ok(src.indexOf('const footH = ') < src.indexOf('photoCells(photos.length, captionH, '), 'ต้องรู้ footH ก่อนคำนวณที่ว่างของรูป')
  assert.match(src, /fitsA4: height <= NEWS_MAX_HEIGHT/)
  const parts = await readFile(new URL('../src/components/complaints/newsDialogParts.jsx', import.meta.url), 'utf8')
  assert.match(parts, /image\.fitsA4 === false/)
  assert.match(parts, /ภาพนี้ยาวเกิน 1 แผ่น A4/)
})

console.log(`\n${cases} cases passed`)

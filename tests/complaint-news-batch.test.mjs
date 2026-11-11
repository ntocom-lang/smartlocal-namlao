// ภาพข่าวรวม (หลายเรื่องหมวดเดียวกัน เสร็จวันเดียวกัน → ภาพเดียว)
// src/lib/complaintNewsImage.js (ส่วนภาพรวม) + ComplaintNewsBatchDialog + ปุ่มใน ComplaintsManager / ExecNewsList
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
const plain = svg => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(match => match[1]).join('').replace(/\s+/g, '')
const has = (svg, phrase) => plain(svg).includes(phrase.replace(/\s+/g, ''))
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

// ยื่นอังคาร 3 พ.ย. 2569 → ปิดอังคาร 10 พ.ย. 2569 = 5 วันทำการ · กำหนด 12 พ.ย. (ทัน)
const row = (over = {}) => ({ village: 'หมู่ 3', createdAt: '2026-11-03T03:00:00Z', closedAt: '2026-11-10T03:00:00Z', dueDate: '2026-11-12', ...over })
const batch = (items, over = {}) => News.buildBatchNewsModel({
  items, tenantName: 'เทศบาลตำบลสาธิต', departmentName: 'กองช่าง', categoryLabel: 'ไฟฟ้าสาธารณะ', ...over,
})

await test('จัดกลุ่ม: วันปิดงานตามเวลาไทย + หมวดเดียวกัน · ข้อมูลไม่ครบถูกข้าม', () => {
  // 00:30 น. ไทยของวันที่ 11 (= 17:30Z ของวันที่ 10) ต้องตกวันที่ 11 ไม่ใช่วันที่ 10
  assert.equal(News.bangkokDayKey('2026-11-10T17:30:00Z'), '2026-11-11')
  assert.equal(News.bangkokDayKey('2026-11-10T16:59:00Z'), '2026-11-10')
  assert.equal(News.bangkokDayKey('ไม่ใช่วันที่'), '')
  const groups = News.groupNewsCandidates([
    { id: 'a', day: '2026-11-10', categoryKey: 'light' },
    { id: 'b', day: '2026-11-10', categoryKey: 'light' },
    { id: 'c', day: '2026-11-10', categoryKey: 'road' },
    { id: 'd', day: '2026-11-11', categoryKey: 'light' },
    { id: 'e', day: '2026-11-11', categoryKey: 'light' },
    { id: 'f', day: '2026-11-11', categoryKey: 'light' },
    { id: '', day: '2026-11-10', categoryKey: 'light' }, // ไม่มี id
    { id: 'g', day: '10/11/2569', categoryKey: 'light' }, // วันผิดรูปแบบ
    { id: 'h', day: '2026-11-10', categoryKey: '' }, // ไม่มีหมวด
    null,
  ])
  assert.deepEqual(groups.map(group => [group.key, group.items.map(item => item.id)]), [
    ['2026-11-11|light', ['d', 'e', 'f']], // ≥2 เรื่อง: วันล่าสุดก่อน
    ['2026-11-10|light', ['a', 'b']],
    ['2026-11-10|road', ['c']], // เรื่องเดี่ยวไปท้ายสุด
  ])
  assert.deepEqual(News.groupNewsCandidates(undefined), [])
  assert.deepEqual(News.groupNewsCandidates('x'), [])
})

await test('เรื่องเดี่ยวไม่ขึ้นก่อนกลุ่มที่รวมได้ แม้วันใหม่กว่า', () => {
  const groups = News.groupNewsCandidates([
    { id: 'a', day: '2026-11-12', categoryKey: 'road' },
    { id: 'b', day: '2026-11-10', categoryKey: 'light' },
    { id: 'c', day: '2026-11-10', categoryKey: 'light' },
  ])
  assert.deepEqual(groups.map(group => group.key), ['2026-11-10|light', '2026-11-12|road'])
})

await test('รายชื่อหมู่: ไม่ซ้ำ เรียงตามเลข ข้ามค่าที่ไม่ใช่ระดับหมู่', () => {
  assert.deepEqual(News.villageList(['หมู่ 10', '3', 'หมู่ที่ 3', 'หมู่ 5', '', null, 'ซอยสุขใจ']), ['หมู่ 3', 'หมู่ 5', 'หมู่ 10'])
  assert.deepEqual(News.villageList(undefined), [])
})

await test('ร่างข้อความข่าว: นับจุด + รายชื่อหมู่ (ไม่มีหมู่ = ไม่มีวงเล็บ)', () => {
  const model = batch([row({ village: 'หมู่ 5' }), row({ village: 'หมู่ 3' }), row({ village: 'หมู่ 5' })])
  assert.equal(model.headline, 'กองช่าง เทศบาลตำบลสาธิต ลงพื้นที่ดำเนินการเรื่องไฟฟ้าสาธารณะ จำนวน 3 จุด (หมู่ 3, หมู่ 5) ตามที่ประชาชนแจ้งผ่านระบบ E-Service')
  assert.equal(model.count, 3)
  assert.deepEqual(model.villages, ['หมู่ 3', 'หมู่ 5'])
  assert.ok(!batch([row({ village: '' }), row({ village: '' })]).headline.includes('('))
  // แก้ข้อความเองได้ — ค่าที่ส่งมาชนะร่าง (ว่างก็คือว่าง)
  assert.equal(batch([row(), row()], { headline: 'ซ่อมไฟ 2 จุด' }).headline, 'ซ่อมไฟ 2 จุด')
  assert.equal(batch([row(), row()], { headline: '' }).headline, '')
})

await test('ป้ายเวลา: ทันกำหนดทุกเรื่อง = "ไม่เกิน N วันทำการ" (N = สูงสุดของกลุ่ม) · เกินกำหนดแม้เรื่องเดียว = ซ่อน', () => {
  const ok = batch([row(), row({ createdAt: '2026-11-09T03:00:00Z' })]) // 5 วัน กับ 1 วันทำการ
  assert.equal(ok.durationLabel, 'ใช้เวลาไม่เกิน 5 วันทำการ')
  assert.equal(ok.showDuration, true)
  assert.equal(batch([row(), row()], { showDuration: false }).showDuration, false) // ผู้ใช้ปิดเอง
  const sameDay = batch([row({ createdAt: '2026-11-10T01:00:00Z' }), row({ createdAt: '2026-11-10T02:00:00Z' })])
  assert.equal(sameDay.durationLabel, 'เสร็จในวันที่ยื่นทุกเรื่อง')
  // เรื่องที่สองปิด 13 พ.ย. เกินกำหนด 12 พ.ย.
  const late = batch([row(), row({ closedAt: '2026-11-13T03:00:00Z' })])
  assert.equal(late.durationLabel, '')
  assert.equal(late.showDuration, false)
  // แม้ผู้เรียกบังคับ showDuration: true ก็ไม่ขึ้นเมื่อมีเรื่องเกินกำหนด
  assert.equal(batch([row(), row({ closedAt: '2026-11-13T03:00:00Z' })], { showDuration: true }).showDuration, false)
  // ไม่รู้วันยื่นของเรื่องใดเรื่องหนึ่ง = ไม่เดาตัวเลข
  const unknown = batch([row(), row({ createdAt: undefined })])
  assert.equal(unknown.durationLabel, '')
  assert.equal(unknown.showDuration, false)
  assert.equal(batch([]).durationLabel, '')
  // ไม่มีกำหนด (due ว่าง) นับว่าทัน
  assert.equal(batch([row({ dueDate: '' }), row({ dueDate: null })]).durationLabel, 'ใช้เวลาไม่เกิน 5 วันทำการ')
})

await test('วันที่ในภาพ = วันปิดงานล่าสุดของเรื่องที่เลือก', () => {
  const model = batch([row(), row({ closedAt: '2026-11-10T09:00:00Z' })])
  assert.equal(model.dateText, '10 พฤศจิกายน 2569')
})

await test('"และอีก N จุด" ต่อท้ายด้วยหมู่ของจุดที่ไม่ขึ้นรูป · ไม่เกิน = ว่าง', () => {
  assert.equal(News.batchMoreText(0), '')
  assert.equal(News.batchMoreText(-2), '')
  assert.equal(News.batchMoreText(Number.NaN), '')
  assert.equal(News.batchMoreText(3), 'และอีก 3 จุด')
  assert.equal(News.batchMoreText(2, ['หมู่ 7', 'หมู่ 9']), 'และอีก 2 จุด (หมู่ 7, หมู่ 9)')
})

await test('ตารางรูป: ไม่มีป้ายใต้รูป = เหมือนเดิมทุกพิกเซล · มีป้าย = เพิ่มความสูงแถวละ captionH', () => {
  for (const count of [0, 1, 2, 3, 4]) assert.deepEqual(News.photoCells(count), News.photoCells(count, 0))
  assert.equal(News.photoCells(1, 52).height, 652)
  assert.equal(News.photoCells(2, 52).height, 572)
  assert.equal(News.photoCells(4, 52).height, 360 * 2 + 16 + 52 * 2)
  const four = News.photoCells(4, 52).cells
  assert.equal(four[2].y, 360 + 16 + 52) // แถวล่างเลื่อนลงตามแถวป้าย
  assert.equal(News.photoCells(3, 52).cells[2].y, 360 + 16 + 52)
  // ป้ายแถวบนไม่ทับรูปแถวล่าง
  assert.ok(four[2].y >= four[0].y + four[0].h + 52)
})

await test('ภาพรวม: ป้ายหมู่ใต้รูปครบ 4 ช่อง + "และอีก N จุด" · ภาพไม่ใส่ป้ายเหมือนภาพรายเรื่องเดิม', () => {
  const model = batch([row({ village: 'หมู่ 3' }), row({ village: 'หมู่ 5' }), row({ village: 'หมู่ 7' }), row({ village: 'หมู่ 9' }), row({ village: 'หมู่ 11' })])
  const photos = [PHOTO, PHOTO, PHOTO, PHOTO]
  const withCaps = News.buildNewsSvg(model, measure, { photoDataUrls: photos, photoCaptions: ['หมู่ 3', 'หมู่ 5', 'หมู่ 7', 'หมู่ 9'], moreText: 'และอีก 1 จุด (หมู่ 11)' })
  for (const phrase of ['หมู่ 3', 'หมู่ 5', 'หมู่ 7', 'หมู่ 9', 'และอีก 1 จุด (หมู่ 11)']) assert.ok(has(withCaps.svg, phrase), phrase)
  assert.equal(withCaps.photoCount, 4)
  const without = News.buildNewsSvg(model, measure, { photoDataUrls: photos })
  assert.ok(withCaps.height > without.height, 'ป้ายใต้รูปต้องเพิ่มความสูง')
  // ส่ง captions ว่าง/moreText ว่าง = ไม่ต่างจากไม่ส่ง
  const emptyOpts = News.buildNewsSvg(model, measure, { photoDataUrls: photos, photoCaptions: ['', '', '', ''], moreText: '' })
  assert.equal(emptyOpts.svg, without.svg)
})

await test('รูปที่ใช้ไม่ได้ถูกตัดพร้อมป้ายของมันเอง — ป้ายไม่เลื่อนไปติดรูปอื่น · เกิน 4 รูปตัดทิ้ง', () => {
  const model = batch([row(), row(), row()])
  const result = News.buildNewsSvg(model, measure, {
    photoDataUrls: [PHOTO, 'https://evil.example/a.jpg', PHOTO], photoCaptions: ['หมู่ 1', 'หมู่ 2', 'หมู่ 3'],
  })
  assert.equal(result.photoCount, 2)
  assert.ok(has(result.svg, 'หมู่ 1') && has(result.svg, 'หมู่ 3'))
  assert.ok(!has(result.svg, 'หมู่ 2'), 'ป้ายของรูปที่ใช้ไม่ได้ต้องหายไปด้วย')
  assert.ok(!result.svg.includes('evil.example'))
  const five = News.buildNewsSvg(model, measure, { photoDataUrls: Array(5).fill(PHOTO), photoCaptions: ['หมู่ 31', 'หมู่ 32', 'หมู่ 33', 'หมู่ 34', 'หมู่ 35'] })
  assert.equal(five.photoCount, 4)
  assert.ok(has(five.svg, 'หมู่ 34'))
  assert.ok(!has(five.svg, 'หมู่ 35'))
})

await test('ป้ายยาวเกินช่องไม่ล้นไปทับรูปข้างเคียง · ข้อความถูก escape', () => {
  const model = batch([row(), row()])
  const long = 'หมู่ 3 '.repeat(40)
  const result = News.buildNewsSvg(model, measure, { photoDataUrls: [PHOTO, PHOTO], photoCaptions: [long, '<script>x</script>'] })
  assert.ok(!result.svg.includes('<script>'))
  assert.ok(result.svg.includes('&lt;script&gt;'))
  // ป้ายแรกถูกตัดเหลือบรรทัดเดียวที่พอดีช่อง (ช่องกว้าง (952-16)/2 = 468px ที่ 30px ตัวหนา ≈ 25 ตัวอักษร) ไม่ใช่ข้อความทั้ง 40 รอบ
  const fitted = [...result.svg.matchAll(/<text[^>]*text-anchor="middle"[^>]*>([^<]*)<\/text>/g)].map(match => match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim())
  assert.ok(fitted.length >= 1 && fitted.every(item => measure(item, 30, true) <= 468), 'ป้ายต้องไม่กว้างเกินช่อง')
  assert.ok(!has(result.svg, long))
})

await test('PDPA: ข้อมูลผู้แจ้งปลอมที่ปนมากับรายการไม่หลุดเข้าภาพ · ป้ายเป็นระดับหมู่เท่านั้น', () => {
  const dirty = row({
    village: 'บ้านนายสมชาย ใจดี 081-234-5678 เลขที่ 99/1 หมู่ 4', reporterName: 'สมชาย ใจดี', reporter_phone: '0812345678',
    description: 'ไฟดับหน้าบ้านนายสมชาย', latitude: 18.123456, longitude: 100.654321, address: '99/1 ซอยสุขใจ',
  })
  const model = batch([dirty, row({ village: 'หมู่ 6' })])
  assert.deepEqual(model.villages, ['หมู่ 4', 'หมู่ 6'])
  const caption = News.villageLevel(dirty.village)
  assert.equal(caption, 'หมู่ 4')
  const image = News.buildNewsSvg(model, measure, { photoDataUrls: [PHOTO, PHOTO], photoCaptions: [caption, 'หมู่ 6'] })
  const everything = JSON.stringify(model) + image.svg
  for (const secret of ['สมชาย', '081-234-5678', '0812345678', '99/1', 'สุขใจ', '18.123456', '100.654321', 'ไฟดับหน้าบ้าน']) {
    assert.ok(!everything.includes(secret), `หลุด: ${secret}`)
  }
})

await test('ภาพรวมปิด QR/ลิงก์: แถบท้ายเป็นข้อความขอบคุณ + มุ่งสู่เมืองอัจฉริยะ · เปิด = QR + โดเมน', () => {
  const off = News.buildNewsSvg(batch([row(), row()]), measure, { photoDataUrls: [PHOTO, PHOTO] }).svg
  assert.ok(!off.includes('crispEdges'))
  assert.ok(has(off, News.NEWS_FOOTER_THANKS[0]) && has(off, News.NEWS_FOOTER_THANKS[1]))
  assert.ok(!has(off, News.NEWS_FOOTER_INVITE))
  const on = News.buildNewsSvg(batch([row(), row()], { reportUrl: 'https://namlao.example.test/complaint' }), measure, { photoDataUrls: [PHOTO, PHOTO] }).svg
  assert.ok(on.includes('crispEdges') && has(on, 'namlao.example.test/complaint') && has(on, News.NEWS_FOOTER_INVITE))
  assert.ok(!has(on, News.NEWS_FOOTER_THANKS[0]))
  // มุ่งสู่เมืองอัจฉริยะขึ้นทั้งสองแบบ
  assert.ok(has(on, News.NEWS_FOOTER_SMART_CITY) && has(off, News.NEWS_FOOTER_SMART_CITY))
})

await test('static: กล่องทั้งสองมี checkbox "แสดง QR และลิงก์แจ้งเรื่อง" ติ๊กไว้ก่อน · ปิดแล้วส่ง reportUrl ว่าง', async () => {
  for (const path of ['src/components/complaints/ComplaintNewsDialog.jsx', 'src/components/complaints/ComplaintNewsBatchDialog.jsx']) {
    const source = await read(path)
    assert.match(source, /const \[linkOn, setLinkOn\] = useState\(true\)/, path)
    assert.match(source, /reportUrl: linkOn \? reportUrl : ''/, path)
    assert.match(source, /แสดง QR และลิงก์แจ้งเรื่อง/, path)
  }
})

await test('ขีดจำกัด: เลือกได้ไม่เกิน 12 เรื่อง · รูปไม่เกิน 4 ช่อง', () => {
  assert.equal(News.MAX_BATCH_ITEMS, 12)
  assert.equal(News.MAX_NEWS_PHOTOS, 4)
})

await test('static: กล่องภาพรวมไม่อ่านตาราง · โหมด exec ผ่าน RPC เท่านั้น · ไม่มีรูปผู้แจ้ง', async () => {
  const dialog = await read('src/components/complaints/ComplaintNewsBatchDialog.jsx')
  assert.ok(!/\.from\(\s*['"`][a-z_]+['"`]\s*\)/.test(dialog), 'กล่องภาพรวมอ่านตารางตรง')
  assert.match(dialog, /rpc\('exec_complaint_news_detail'/)
  assert.ok(!/attachments/.test(dialog), 'ภาพรวมต้องไม่แตะรูปจากผู้แจ้ง')
  assert.match(dialog, /MAX_BATCH_ITEMS/)
  assert.match(dialog, /ติ๊กเรื่องของกลุ่มอื่น = ย้ายไปกลุ่มนั้น/)
  assert.match(dialog, /ป้ายเวลาแสดงได้เมื่อทุกเรื่องในภาพเสร็จทันกำหนด/)
})

await test('static: ปุ่ม "ภาพข่าวรวม" หน้าคำร้องใช้เงื่อนไขเดียวกับปุ่มรายเรื่อง · ห้องผู้บริหารใช้กล่อง exec', async () => {
  const manager = await read('src/components/admin/ComplaintsManager.jsx')
  assert.match(manager, /import ComplaintNewsBatchDialog from '\.\.\/complaints\/ComplaintNewsBatchDialog'/)
  const start = manager.indexOf('const newsBatchCandidates')
  assert.ok(start > 0)
  const area = manager.slice(start, start + 1400)
  assert.match(area, /normalizeActionStatus\(c\.status\) !== 'closed' \|\| !newsCategoryAllowed\(c\.category, categoryMeta\)/)
  assert.match(area, /isAdmin \|\| \(c\.assigned_to && c\.assigned_to === currentUserId\)/)
  assert.match(area, /\(c\.work_photos \?\? \[\]\)\.length === 0/)
  assert.match(area, /finishedAtOf\(c\)/)
  assert.match(manager, /<ComplaintNewsBatchDialog[\s\S]{0,200}source="staff"/)
  // ปุ่มไม่ขึ้นในแท็บเฉพาะกิจ (กลิ่น) และขึ้นต่อเมื่อมีกลุ่มที่รวมได้
  assert.match(manager, /!odorTabActive && newsBatchGroups\.length > 0/)

  const list = await read('src/components/staff/executive/ExecNewsList.jsx')
  assert.match(list, /<ComplaintNewsBatchDialog source="exec"/)
  assert.ok(!/\.from\(\s*['"`](complaints|complaint_timeline)['"`]\s*\)/.test(list))
  const dialog = await read('src/components/complaints/ComplaintNewsBatchDialog.jsx')
  assert.ok(dialog.includes('exec_complaint_news_detail'))
})

console.log(`\n${cases} cases passed`)

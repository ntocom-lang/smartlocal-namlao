// ใบสรุปค่าที่วัดได้ช่วงเหตุการณ์น้ำ-ฝน (เฟส 3 · PR 3.3) — ตรรกะของ src/lib/waterEventPrint.js (ไม่ใช้ฐานข้อมูล/เบราว์เซอร์)
// node tests/water-event-print.test.mjs   (เลย์เอาต์จริงอยู่ที่ tests/water-event-print-layout.test.mjs)
//
// เรื่องที่ต้องไม่พลาด: (1) ทุกค่าจากภายนอก (ชื่อสถานี ข้อความ สสน. ชื่อคน) ผ่าน esc — ใบเขียนผ่าน document.write
// (2) ใบเป็น "สรุปค่าที่วัดได้" ไม่ประเมินความเสียหาย/ประกาศภัย/ตัดสินสิทธิ์ และไม่ใช้คำว่า "รับรอง"
// (3) ค่าว่างเป็น "ไม่มีค่า" ไม่ใช่ 0 · สถานีที่ไม่มีค่าไม่ได้แถวของตัวเอง (4) ช่องลงนามตามมาตรฐานกลาง ปากกาล้วน
// (5) เหตุการณ์ที่ยังเปิดอยู่บอกบนใบว่าค่าอาจเปลี่ยน (6) มาตรฐานเอกสารราชการ (ฟอนต์/@page) ยึด govDocStyle.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  WATER_EVENT_PRINT_CRITERIA_COUNT, buildWaterEventHtml, pickAcknowledger,
} from '../src/lib/waterEventPrint.js'
import { WATER_EVENT_CRITERIA, WATER_EVENTS_DISCLAIMER } from '../src/lib/waterEvents.js'
import { GOV_FONT_SIZE, GOV_FONT_SIZE_ADJUST, GOV_PAGE_MARGIN } from '../src/lib/govDocStyle.js'
import { ACKNOWLEDGER, PREPARER, PRINTED_AT, TENANT, eventDetail } from './lib/waterEventFixtures.mjs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const build = (detailOptions = {}, extra = {}) => buildWaterEventHtml({
  tenant: TENANT, detail: eventDetail(detailOptions), preparer: PREPARER, acknowledger: ACKNOWLEDGER, printedAt: PRINTED_AT, ...extra,
})
const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

// ── 1) escape ทุกค่าจากภายนอก ──
{
  const evil = (tag) => `<${tag} src=x onerror=alert(1)>`
  const detail = eventDetail({ stations: 5, blank: 1, warnings: 1 })
  detail.stations[4].station_name = evil('details') // สถานีที่ไม่มีค่า — แสดงในบรรทัด "ไม่มีค่า" ต้อง escape เหมือนกัน
  detail.stations[0].station_name = evil('img')
  detail.stations[1].station_name = `"><script>alert(2)</script>`
  detail.warnings[0].message = `${evil('svg')}\n<b>ตัวหนา</b> & "คำพูด" 'เดี่ยว'`
  detail.warnings[0].station_name = evil('iframe')
  detail.warnings[0].tambon_name = '<u>ต.</u>'
  detail.event.open_reason.triggers[0].station_name = evil('video')
  const html = buildWaterEventHtml({
    tenant: { name: '<script>alert(3)</script>อบต.' }, detail,
    preparer: { name: evil('img'), title: '<b>ตำแหน่ง</b>' },
    acknowledger: { name: `"><a href=x>ปลัด</a>`, title: '<i>ปลัด</i>' },
    printedAt: PRINTED_AT,
  })
  for (const raw of ['<img src=x', '<details src=x', '<script>alert', '<svg src=x', '<iframe', '<video', '<b>ตัวหนา', '<u>ต.', '<a href=x', '<i>ปลัด', '<b>ตำแหน่ง']) {
    assert.ok(!html.includes(raw), `ค่าจากภายนอกหลุดเป็น HTML ดิบ: ${raw}`)
  }
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'ชื่อสถานีต้องแสดงเป็นตัวอักษร (escape)')
  assert.ok(html.includes('&lt;b&gt;ตัวหนา&lt;/b&gt; &amp; &quot;คำพูด&quot; &#39;เดี่ยว&#39;'), 'ข้อความ สสน. ตามต้นฉบับ แต่ escape')
  assert.equal((html.match(/<script/g) || []).length, 0, 'ใบต้องไม่มี <script> เลย')
  for (const tag of ['<input', '<textarea', '<select', '<form', '<iframe', '<object', '<embed']) assert.ok(!html.includes(tag), `ใบต้องไม่มี ${tag}`)
  // svg ที่เรามีเองต้องมีแต่ตัวเลข ไม่มีข้อความภายนอกใน path
  for (const d of html.matchAll(/<path d="([^"]*)"/g)) assert.match(d[1], /^[ML0-9. -]+$/, `path มีอักขระที่ไม่ใช่ตัวเลข: ${d[1]}`)
  console.log('✓ escape: ชื่อสถานี/ข้อความ สสน./ชื่อคน/ชื่อ อปท. ไม่หลุดเป็น HTML ดิบ · ไม่มี script/ช่องกรอก · path ของกราฟเป็นตัวเลขล้วน')
}

// ── 2) เนื้อหา: สรุปที่วัดได้ ไม่ประเมินความเสียหาย ไม่ใช้คำที่เป็นของผู้มีอำนาจ ──
{
  const html = build({ stations: 5, warnings: 2 })
  const body = text(html)
  for (const word of ['รับรอง', 'ประกาศเขต', 'ภัยพิบัติ', 'พื้นที่ประสบภัย', 'ผู้ประสบภัย', 'ช่วยเหลือ', 'อนุมัติ', 'สั่งการ', 'ตามระเบียบ', 'มาตรา', 'พ.ร.บ.', 'ความเสียหายรวม', 'มูลค่า']) {
    assert.ok(!body.includes(word), `ใบสรุปห้ามมีคำว่า "${word}"`)
  }
  // "ความเสียหาย" มีได้ที่เดียว: ในคำกำกับว่า "ไม่ใช่การประเมินความเสียหาย"
  for (const m of body.matchAll(/ความเสียหาย/g)) {
    assert.ok(body.slice(0, m.index + m[0].length).endsWith('ไม่ใช่การประเมินความเสียหาย'), 'คำว่า ความเสียหาย ต้องอยู่ในประโยค "ไม่ใช่การประเมิน…" เท่านั้น')
  }
  assert.ok(body.includes(WATER_EVENTS_DISCLAIMER.replace(/\s+/g, ' ')), 'คำกำกับท้ายใบต้องครบตามต้นฉบับ (ห้ามตัด)')
  assert.match(body, /ไม่ได้ตรวจสอบกับหน้างาน/); assert.match(body, /ThaiWater/)
  assert.match(body, /สรุปค่าที่วัดได้ช่วงเหตุการณ์น้ำ-ฝน/); assert.ok(body.includes(TENANT.name))
  assert.equal(WATER_EVENT_PRINT_CRITERIA_COUNT, WATER_EVENT_CRITERIA.length, 'เกณฑ์ย่อท้ายใบต้องมีจำนวนข้อเท่าเกณฑ์เต็มบนหน้าจอ (ถ้าเพิ่ม/ลบข้อ ต้องแก้ทั้งสองที่)')
  assert.match(body, /90\.1 มม\./); assert.match(body, /ไม่เกิน 1 ม\./); assert.match(body, /ระดับ 2–3/); assert.match(body, /อำเภอและจังหวัดเดียวกัน/)
  assert.match(body, /อ่างเก็บน้ำไม่ใช้เปิดเหตุการณ์/); assert.match(body, /ไม่มีใครต้องกดปิดหรือกรอกอะไร/)
  assert.match(body, /\(ชุดที่ 1\)/, 'บอกชุดเกณฑ์ (rule_version) ให้ตรวจย้อนได้')
  console.log('✓ เนื้อหา: ไม่มีคำของผู้มีอำนาจ/ประเมินความเสียหาย/อ้างระเบียบ · คำกำกับครบ · เกณฑ์ตรงหน้าจอ · บอกชุดเกณฑ์')
}

// ── 3) สถานะเหตุการณ์ ──
{
  const closed = text(build({ open: false }))
  assert.ok(!closed.includes('ยังไม่สิ้นสุด')); assert.match(closed, /20 ต\.ค\. 69 09:00 น\. – 21 ต\.ค\. 69 09:00 น\. \(นาน 1 วัน\)/)
  assert.match(closed, /ระบบปิดเอง: ค่าไม่เข้าเกณฑ์ต่อเนื่อง 24 ชม\./)
  assert.ok(!build({ open: false }).includes('data-open-note'))
  const open = build({ open: true })
  assert.ok(open.includes('data-open-note')); assert.match(text(open), /เหตุการณ์ยังไม่สิ้นสุด ณ เวลาที่พิมพ์ — ค่าที่วัดได้อาจเปลี่ยนหลังจากนี้/)
  assert.match(text(open), /เป็นต้นมา \(นาน 1 วัน 4 ชม\.\)/, 'เหตุการณ์ที่เปิดอยู่นับถึงเวลาที่พิมพ์ (เปิด 02:00Z พิมพ์ 06:00Z+1วัน = 28 ชม.)')
  assert.ok(!text(open).includes('การปิดเหตุการณ์'))
  const lost = text(build({}, { detail: { ...eventDetail(), event: { ...eventDetail().event, close_reason: 'data_lost' } } }))
  assert.match(lost, /ไม่ได้แปลว่าเหตุการณ์จบจริง/)
  console.log('✓ สถานะ: ปิดแล้ว (ช่วง+เหตุผลที่ระบบปิด) · เปิดอยู่ (แถบเตือนว่าค่าอาจเปลี่ยน นับถึงเวลาพิมพ์) · ปิดเพราะข้อมูลขาดไม่บอกว่าจบจริง')
}

// ── 4) ค่าว่าง ไม่เป็น 0 · สถานีที่ไม่มีค่าไม่ได้แถว ──
{
  const html = build({ stations: 6, blank: 2, warnings: 0 })
  const rows = [...html.matchAll(/<tr>\s*<td class="num">(\d+)<\/td>/g)]
  assert.equal(rows.length, 4, 'แถวตารางมีเฉพาะสถานีที่มีค่า (6 สถานี − 2 ที่ไม่มีค่า)')
  const body = text(html)
  assert.match(body, /สถานีที่ไม่มีค่าที่วัดได้ในช่วงนี้ 2 แห่ง \(แสดงว่า "ไม่มีค่า" ไม่ใช่ 0\): สถานี5, สถานี6/)
  assert.match(body, /ระบบจดไว้ \d+ ค่า จาก 6 สถานี/)
  const none = text(build({ stations: 2, blank: 2, warnings: 0 }))
  assert.match(none, /ไม่มีสถานีใดมีค่าที่วัดได้ในช่วงที่ระบบจดเหตุการณ์นี้/); assert.ok(!none.includes('<table class="stations"'))
  // สถานีฝนที่ฝนเป็น 0 จริง (วัดได้) ยังแสดง 0 — ต่างจากไม่มีค่า
  const zero = eventDetail({ stations: 1, dam: false, warnings: 0 })
  zero.stations[0].readings = [{ t: '2026-10-20T01:00:00Z', rain_24h: 0 }, { t: '2026-10-20T02:00:00Z', rain_24h: 0 }]
  assert.match(text(buildWaterEventHtml({ tenant: TENANT, detail: zero, printedAt: PRINTED_AT })), /0 มม\./)
  // ข้อมูลเสีย/โครงว่างไม่พัง
  assert.doesNotThrow(() => buildWaterEventHtml({ tenant: null, detail: null, printedAt: PRINTED_AT }))
  assert.doesNotThrow(() => buildWaterEventHtml({ tenant: TENANT, detail: { event: {}, stations: null, warnings: undefined }, printedAt: PRINTED_AT }))
  console.log('✓ ค่าว่าง: สถานีที่ไม่มีค่ารวมเป็นบรรทัดเดียว "ไม่มีค่า ไม่ใช่ 0" · ฝน 0 มม. ที่วัดได้ยังเป็น 0 · ข้อมูลเสียไม่พัง')
}

// ── 4.1) แถวอ่าง: ไม่มี "ค่าล่าสุด" = ขีด ไม่ใช่ 0 · หมายเหตุสั้นของอ่างอยู่ในใบ ──
{
  const html = build({ stations: 3, warnings: 0 }) // ฝน ระดับน้ำ อ่าง
  const damRow = html.match(/<tr>\s*<td class="num">3<\/td>[\s\S]*?<\/tr>/)[0]
  assert.match(damRow, /<td>–<\/td>/, 'อ่างไม่มีค่าล่าสุดแยก → ขีด ไม่ใช่ตัวเลข')
  assert.ok(!/<td>0/.test(damRow), 'ห้ามเติม 0 ในช่องค่าล่าสุด')
  const body = text(damRow)
  assert.match(body, />100% = เกินความจุที่ระดับเก็บกักปกติ/, 'อ่างเกิน 100% มีคำอธิบายสั้นในใบ')
  assert.match(body, /ตัวเลขซ้ำเดิม 3 รายงาน/, 'ตัวเลขอ่างซ้ำเดิมมีหมายเหตุในใบ')
  console.log('✓ แถวอ่าง: ไม่มีค่าล่าสุด = ขีด ไม่ใช่ 0 · เกิน 100% และตัวเลขซ้ำเดิมมีหมายเหตุสั้นในใบ')
}

// ── 5) ข้อความ สสน. ตามต้นฉบับ ──
{
  const html = build({ stations: 3, warnings: 3 })
  assert.equal((html.match(/class="warn"/g) || []).length, 3)
  assert.match(text(html), /เตือนภัยน้ำท่วมฉับพลัน บรรทัดสอง \(1\)/)
  assert.match(html, /\.warn-msg \{[^}]*white-space: pre-wrap/, 'ขึ้นบรรทัดตามต้นฉบับ')
  assert.match(html, /\.warn \{[^}]*break-inside: avoid/, 'ข้อความเตือนฉบับเดียวไม่ขาดกลางหน้า')
  const none = text(build({ stations: 3, warnings: 0 }))
  assert.match(none, /ไม่มีข้อความเตือนของ สสน\. ในช่วงเหตุการณ์นี้/)
  console.log('✓ ข้อความ สสน.: ครบทุกฉบับตามต้นฉบับ ขึ้นบรรทัดตามเดิม ไม่ขาดกลางหน้า · ไม่มี = บอกตรงๆ')
}

// ── 6) ช่องลงนาม: มาตรฐานกลาง ปากกาล้วน ──
{
  const html = build()
  assert.equal((html.match(/class="sign-row"/g) || []).length, 2, 'ช่องลงนาม 2 ช่อง')
  assert.match(html, /<span class="sign-role">ผู้จัดทำ<\/span>/); assert.match(html, /<span class="sign-role">ผู้รับทราบ<\/span>/)
  assert.ok(!html.includes('<span class="sign-signed">'), 'ไม่มีลายมือชื่ออิเล็กทรอนิกส์ — เส้นให้เซ็นปากกา')
  assert.equal((html.match(/class="sign-line"/g) || []).length, 2)
  assert.ok(html.includes('(นางสาวประกายมาศ ศรีวิชัยเลิศสกุลวงศ์)')); assert.ok(html.includes('(นายสมศักดิ์ ตั้งใจพัฒนาชุมชน)'))
  // ตำแหน่ง "รักษาราชการแทน" ตัดเป็น 2 บรรทัดตามกติกากลาง
  assert.ok(html.includes('ตำแหน่ง ผู้อำนวยการกองช่าง รักษาราชการแทน</span>') && html.includes('>ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว</span>'))
  assert.equal((html.match(/วันที่ \.{20}/g) || []).length, 2, 'วันที่เว้นให้เขียนมือ')
  assert.match(html, /\.report-sign \{[^}]*break-inside: avoid/, 'ช่องลงนามห้ามขาดกลางหน้า')
  assert.match(html, /\.sign-axis \{/, 'ใช้ CSS ช่องลงนามจาก govSignBlock.js'); assert.match(html, /\.center-row \.sign-row/)
  // ยังไม่ตั้งผู้ลงนาม = เส้นประ + ตำแหน่งสำรอง ไม่ใช่ช่องหาย
  const blank = buildWaterEventHtml({ tenant: TENANT, detail: eventDetail(), preparer: null, acknowledger: null, printedAt: PRINTED_AT })
  assert.equal((blank.match(/class="sign-row"/g) || []).length, 2)
  assert.equal((blank.match(/\(\.{20,}\)/g) || []).length, 2, 'วงเล็บเว้นชื่อ 2 ช่อง')
  assert.ok(blank.includes('ตำแหน่ง ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว'), 'ผู้รับทราบที่ยังไม่ตั้งค่า ได้ตำแหน่งสำรองของปลัด')
  assert.ok(blank.includes('ตำแหน่ง ....................'))
  // ใบต้องไม่เขียนเลย์เอาต์ช่องลงนามเอง
  const lib = read('src/lib/waterEventPrint.js')
  assert.match(lib, /govSignRow\(/); assert.match(lib, /govNameBlank\(/); assert.match(lib, /govSignBlockCss\(/); assert.match(lib, /govSplitActingTitle\(/)
  assert.ok(!/\.sign-(row|axis|line|below)\s*\{/.test(lib.split('${govSignBlockCss()}')[0]), 'ห้ามเขียนกฎ .sign-* ซ้ำในไฟล์ใบ')
  console.log('✓ ช่องลงนาม: ผู้จัดทำ/ผู้รับทราบ มาตรฐานกลาง ปากกาล้วน ไม่ขาดกลางหน้า · ไม่ตั้งผู้ลงนาม = เส้นประ + ตำแหน่งสำรอง · ตัดตำแหน่งรักษาราชการแทน 2 บรรทัด')
}

// ── 7) pickAcknowledger: ปลัดจากทะเบียนกลาง ──
{
  const row = (over = {}) => ({ signatory_role: 'clerk', department_id: null, custom_label: null, is_active: true, manual_name: 'นายปลัด ทดสอบ', title_override: 'ปลัดทดสอบ', ...over })
  assert.deepEqual(pickAcknowledger([row()]), { name: 'นายปลัด ทดสอบ', title: 'ปลัดทดสอบ' })
  assert.equal(pickAcknowledger([]), null); assert.equal(pickAcknowledger(null), null); assert.equal(pickAcknowledger(undefined), null)
  assert.equal(pickAcknowledger([row({ signatory_role: 'mayor' })]), null, 'ไม่เอานายก')
  assert.equal(pickAcknowledger([row({ signatory_role: 'department_head', department_id: 'd1' })]), null, 'ไม่เอาหัวหน้ากอง')
  assert.equal(pickAcknowledger([row({ department_id: 'd1' })]), null, 'ต้องเป็นปลัดระดับหน่วยงาน ไม่ผูกกอง')
  assert.equal(pickAcknowledger([row({ is_active: false })]), null, 'แถวที่ปิดแล้วไม่เอา')
  assert.equal(pickAcknowledger([row({ manual_name: '  ', profile: null })]), null, 'ไม่มีชื่อ = null (ใบพิมพ์เส้นประ)')
  assert.deepEqual(pickAcknowledger([row({ manual_name: null, profile: { full_name: 'นางสาวจากโปรไฟล์', job_title: 'ปลัดจากโปรไฟล์' }, title_override: null })]), { name: 'นางสาวจากโปรไฟล์', title: 'ปลัดจากโปรไฟล์' })
  console.log('✓ pickAcknowledger: เฉพาะปลัดระดับหน่วยงานที่ยังใช้อยู่ · ไม่มีชื่อ = null')
}

// ── 8) มาตรฐานเอกสารราชการ ──
{
  const html = build()
  assert.ok(html.includes(`@page { size: A4 portrait; margin: ${GOV_PAGE_MARGIN}; }`), 'ขอบกระดาษแนวตั้งตาม govDocStyle.js (หลายหน้าได้ ใช้ขอบ @page จริง)')
  assert.equal((html.match(/font-family:/g) || []).length, 1, 'ฟอนต์มาจาก govDocFontCss ที่เดียว ไม่เขียนซ้ำ')
  assert.match(html, /font-family: "THSarabunPSK"/); assert.ok(html.includes(`font-size: ${GOV_FONT_SIZE};`)); assert.ok(html.includes(`font-size-adjust: ${GOV_FONT_SIZE_ADJUST};`))
  assert.match(html, /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Sarabun/, 'โหลด Sarabun สำรองเสมอ')
  assert.equal((html.match(/font-size:\s*[\d.]+pt/g) || []).filter(v => !v.includes(GOV_FONT_SIZE)).length, 3, 'ขนาดอื่นมีเฉพาะ 12pt ของตาราง/ข้อความท้ายตาราง + 11pt บรรทัดที่มา (3 จุด)')
  assert.ok(!/hideBrowserHeader|margin: 0;\s*}/.test(html.match(/@page[^}]*}/)[0]), 'ไม่ซ่อนหัวท้ายด้วย margin 0 (ใบหลายหน้าต้องมีขอบจริงทุกหน้า)')
  assert.match(html, /ผ่านระบบ E-Service องค์การบริหารส่วนตำบลทุ่งแค้ว/); assert.match(html, /ข้อมูล ณ 21 ต\.ค\. 69 13:00 น\./)
  assert.match(html, /thead \{ display: table-header-group; \}/); assert.match(html, /tr \{ break-inside: avoid/)
  const lib = read('src/lib/waterEventPrint.js')
  assert.match(lib, /ข้อยกเว้น "ขนาดตัวอักษร"/, 'ข้อยกเว้นขนาดตัวอักษรต้องเขียนเหตุผลกำกับที่จุดใช้')
  console.log('✓ มาตรฐาน: ฟอนต์/ขนาด/font-size-adjust/@page ตาม govDocStyle.js · ข้อยกเว้น 12pt ของตารางมีเหตุผลกำกับ · หัวตารางซ้ำ แถวไม่ขาด · บรรทัดที่มา')
}

// ── 9) กราฟแนวโน้ม: ตัดเส้นตรงช่วงขาด ──
{
  const html = build({ stations: 1, dam: false, warnings: 0 })
  assert.equal((html.match(/<svg /g) || []).length, 1)
  assert.equal((html.match(/<path /g) || []).length, 2, 'สถานีฝนมีช่วงไม่ส่งค่า 6 ชม. → เส้น 2 ท่อน ไม่ลากข้าม')
  assert.ok(!/NaN|Infinity|undefined/.test(html), 'ใบต้องไม่มี NaN/Infinity/undefined')
  const noGap = build({ stations: 1, dam: false, warnings: 0, gaps: false })
  assert.equal((noGap.match(/<path /g) || []).length, 1)
  assert.match(text(html), /ไม่ส่งค่า 1 ช่วง \(ไม่ใช่ 0\)/)
  assert.ok(!/stroke="(?!#000|#999)/.test(html.match(/<svg[\s\S]*?<\/svg>/)[0]), 'กราฟขาวดำ (พิมพ์ขาวดำได้)')
  console.log('✓ กราฟ: เส้นขาดตรงช่วงที่สถานีไม่ส่งค่า · ขาวดำ · ไม่มี NaN')
}

// ── 10) ไลบรารีเป็นฟังก์ชันล้วน + หน้าจอผูกถูก ──
{
  const lib = read('src/lib/waterEventPrint.js')
  assert.ok(!/supabase|fetch\(|localStorage|document\.|window\./.test(lib.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')), 'ตัวสร้างใบต้องเป็นฟังก์ชันล้วน')
  const panel = read('src/components/staff/WaterEventsPanel.jsx')
  assert.equal((panel.match(/data-we-nav="print"/g) || []).length, 1, 'ปุ่มพิมพ์มีที่เดียว')
  const detailStart = panel.indexOf('function EventDetail')
  assert.ok(panel.indexOf('data-we-nav="print"') > detailStart && panel.indexOf('data-we-nav="print"') < panel.indexOf('export default function WaterEventsPanel'), 'ปุ่มพิมพ์อยู่ในหน้ารายละเอียดเท่านั้น (ไม่ใช่รายการ/หน้าผิดพลาด)')
  assert.match(panel, /buildWaterEventHtml\(\{ tenant, detail: detail\.data, \.\.\.signers \}\)/)
  assert.match(panel, /loadPersonCard\(profileId\)/); assert.match(panel, /pickAcknowledger\(rows\)/)
  assert.match(panel, /if \(!detail\.data\) return/, 'ไม่มีข้อมูลไม่พิมพ์ใบเปล่า')
  assert.match(read('src/pages/StaffDashboard.jsx'), /<WaterEventsPanel tenant=\{tenant\} profile=\{profile\} \/>/)
  // ไม่เพิ่ม migration/Edge Function ใน PR นี้ (ใช้ข้อมูลที่โหลดอยู่แล้ว)
  console.log('✓ ผูกหน้าจอ: ปุ่มพิมพ์อยู่หน้ารายละเอียดที่เดียว · ผู้จัดทำจากบัญชีที่ล็อกอิน ผู้รับทราบจากทะเบียนผู้ลงนาม · ตัวสร้างใบเป็นฟังก์ชันล้วน')
}

console.log('\n✅ water-event-print: ผ่านทุกข้อ')

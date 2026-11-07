// ใบรายงานผลการก่อสร้างประจำสัปดาห์ (src/lib/constructionReportPrint.js) — โครงเอกสาร มาตรฐานกลาง และ escape
//   คำนวณล้วน ไม่ต้องมีเบราว์เซอร์/ฐานข้อมูล · เลย์เอาต์จริงอยู่ที่ tests/construction-report-layout.test.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildConstructionReportHtml, CONSTRUCTION_REPORT_DISCLAIMER } from '../src/lib/constructionReportPrint.js'
import { GOV_PAGE_MARGIN } from '../src/lib/govDocStyle.js'
import { fixture } from './lib/constructionReportFixtures.mjs'

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}
const html = (options) => buildConstructionReportHtml(fixture(options))
const textOf = content => content.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

test('โครง 6 ส่วนตามต้นฉบับ + ตัวเลขทองคำ 8.40% / 10.25% / ช้า -1.9% จากข้อมูลที่แช่แข็ง', () => {
  const out = html()
  assert.equal((out.match(/<section class="pg">/g) ?? []).length, 6)
  for (const heading of ['บันทึกข้อความ', 'ข้อมูลโครงการ', 'ผลการดำเนินงานก่อสร้าง', 'บุคลากร เครื่องจักร และสภาพอากาศ', 'บันทึกการปฏิบัติงานของผู้รับจ้าง', 'กราฟแสดงความก้าวหน้าของงานก่อสร้าง']) {
    assert.ok(out.includes(heading), heading)
  }
  const text = textOf(out)
  for (const needle of ['8.40%', '10.25%', 'ช้า -1.9%', 'สัปดาห์ที่ 1', 'ระหว่างวันที่ 1 – 7 ส.ค. 2569', 'ถนน คสล. สายบ้านหนองทดสอบ', '1,250,000.00 บาท']) {
    assert.ok(text.includes(needle), needle)
  }
  assert.ok(text.includes('รายงานครั้งที่ 1 สัปดาห์ที่ 1'), 'รายงานครั้งที่ว่าง = เท่าเลขสัปดาห์')
})

test('มาตรฐานเอกสารราชการ: THSarabunPSK 14pt + font-size-adjust 0.45 + ขอบ @page จริง + ไม่ justify + ตารางคุมเฉพาะขนาด', () => {
  const out = html()
  assert.ok(out.includes('font-family: "THSarabunPSK"'), 'ชื่อ family ติดกัน')
  assert.ok(out.includes('font-size: 14pt;'))
  assert.ok(out.includes('font-size-adjust: 0.45;'))
  assert.ok(out.includes(`@page { size: A4 portrait; margin: ${GOV_PAGE_MARGIN}; }`), 'ใช้ขอบ @page จริง ไม่ใช่ padding')
  assert.ok(!/text-align:\s*justify/.test(out), 'ภาษาไทยห้าม justify')
  assert.ok(!out.includes('"TH SarabunPSK"'), 'ห้ามเขียนชื่อ family แบบมีเว้นวรรค')
  assert.match(out, /table\.grid \{ table-layout: fixed; font-size: 12pt;/, 'ข้อยกเว้นขนาดตัวอักษรของตาราง = 12pt เท่านั้น ฟอนต์/adjust มาจาก body')
  assert.ok(!/\bfont-family:[^;]*Tahoma|Arial/.test(out.replace(/"THSarabunPSK"[^;]*;/, '')))
})

test('ช่องลงนามใช้มาตรฐานกลาง (govSignRow) ครบ 5 จุด: หัวหน้า 1 + ผู้ควบคุมงาน 3 + ผู้แทนผู้รับจ้าง 1', () => {
  const out = html()
  assert.equal((out.match(/class="sign-row"/g) ?? []).length, 5)
  assert.equal((out.match(/class="sign-role">หัวหน้าผู้ควบคุมงาน</g) ?? []).length, 1)
  // ตำแหน่งในสัญญาของช่องหน้า 5 อยู่เป็นบรรทัดใต้เส้น (ยาวเกินจะต่อท้ายเส้นในคอลัมน์ครึ่งหน้า)
  assert.equal((out.match(/class="sign-below">ผู้ควบคุมงานของผู้ว่าจ้าง</g) ?? []).length, 3)
  assert.equal((out.match(/class="sign-below">ผู้แทนผู้รับจ้าง</g) ?? []).length, 1)
  assert.ok(out.includes('(นายหัวหน้า ควบคุมงาน)'))
  assert.ok(out.includes('(นายผู้แทน ผู้รับจ้าง)'))
  assert.ok(!out.includes('class="sign-signed"'), 'ใบนี้เซ็นมือ ไม่มีลายมือชื่ออิเล็กทรอนิกส์')
})

test('ยังไม่ได้ตั้งรายชื่อบุคคล = ได้เส้นให้เขียนมือ ไม่ใช่ช่องหาย', () => {
  const out = html({ withPeople: false })
  assert.equal((out.match(/class="sign-row"/g) ?? []).length, 5)
  assert.ok((out.match(/\(\.{5,}\)/g) ?? []).length >= 5, 'วงเล็บเว้นชื่อให้เขียนมือทุกช่อง')
})

test('ทุกค่าที่มาจากฐานข้อมูลผ่าน esc() — ชื่อที่มี < > & " \' ไม่ทำให้ใบพัง', () => {
  const evil = '<script>alert(1)</script>"&\''
  const out = html({ evil })
  assert.ok(!out.includes('<script>alert(1)'), 'พบ script ดิบในใบพิมพ์')
  assert.ok(!/onerror="[^"]*alert/.test(out))
  assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;&#39;'))
  // ครอบคลุมทุกจุดที่ผู้ใช้กรอก: ชื่อโครงการ สถานที่ ผู้รับจ้าง รายชื่อบุคคล เรียน เลขที่หนังสือ บันทึกรายวัน ปัญหา กำลังคน/เครื่องจักร
  assert.ok((out.match(/&lt;script&gt;/g) ?? []).length >= 20, 'ควรพบค่าที่ escape แล้วหลายจุด')
})

test('ฉบับร่างมีแถบ "ยังไม่ล็อก" · ฉบับที่ล็อกไม่มี', () => {
  assert.ok(html({ final: false }).includes('ฉบับร่าง — ยังไม่ล็อกรายงาน'))
  assert.ok(!html({ final: true }).includes('ฉบับร่าง — ยังไม่ล็อกรายงาน'))
})

test('คำกำกับท้ายใบ: ไม่ใช่แบบตามกฎหมาย · เทียบแผนที่ตั้งในระบบ · ไม่คำนวณค่าปรับ/ขยายเวลา/งวดเงิน · ที่มาระบบ E-Service', () => {
  const out = html()
  assert.ok(textOf(out).includes(textOf(CONSTRUCTION_REPORT_DISCLAIMER)))
  for (const needle of ['ไม่ใช่แบบที่กฎหมายหรือระเบียบกำหนด', 'ไม่ใช่แผนตามสัญญา', 'ไม่คำนวณค่าปรับ การขยายเวลา หรืองวดเงิน', 'ผ่านระบบ E-Service องค์การบริหารส่วนตำบลทดสอบ']) {
    assert.ok(textOf(out).includes(needle), needle)
  }
  assert.ok(!/ค่าปรับวันละ\s*[\d,]+/.test(textOf(out)), 'ไม่พิมพ์ค่าปรับต่อวันตามสัญญา')
  assert.ok(!out.includes('1,250.00'), 'ค่าปรับ 1,250 บาท/วัน ต้องไม่หลุดลงใบ')
})

test('วันคงเหลือ ณ วันสิ้นสุดช่วง · เกินกำหนดเขียนเป็น "เกินกำหนด N วัน" · ไม่มีวันสัญญา = –', () => {
  const normal = textOf(html())
  assert.ok(normal.includes('ระยะเวลาก่อสร้างคงเหลือ 113 วัน (94.2%)'), normal.match(/ระยะเวลาก่อสร้างคงเหลือ[^แ]{0,30}/)?.[0])
  const late = fixture({ final: false })
  late.sheet = { ...late.sheet, timing: { ...late.sheet.timing, remainingDays: -3, overdueDays: 3, remainingPct: 0 } }
  assert.ok(textOf(buildConstructionReportHtml(late)).includes('เกินกำหนด 3 วัน'))
  const none = fixture({ final: false })
  none.sheet = { ...none.sheet, timing: null }
  assert.ok(textOf(buildConstructionReportHtml(none)).includes('ระยะเวลาก่อสร้างคงเหลือ –'))
})

test('ตารางรายวัน: จำนวนคอลัมน์ = จำนวนวันของช่วง (สัปดาห์สั้น 3 วันก็ได้) · อากาศติ๊กตรงข้อมูล', () => {
  const week = html()
  assert.equal((week.match(/<th>\d+ ส\.ค\.<\/th>/g) ?? []).length, 7 * 3, 'ตารางกำลังคน เครื่องจักร อากาศ อย่างละ 7 วัน')
  assert.equal((week.match(/✓/g) ?? []).length, 7 + 2, 'แจ่มใส 7 วัน + ฝนเล็กน้อย 2 วัน (ตามข้อมูล)')
  const short = html({ dayCount: 3 })
  assert.equal((short.match(/<th>\d+ ส\.ค\.<\/th>/g) ?? []).length, 3 * 3)
})

test('ครุฑ: ส่งเป็น URL เต็ม ซ่อนเมื่อโหลดไม่ขึ้น · ไม่ส่ง = ช่องว่างเปล่า ไม่ใช่รูปแตก', () => {
  assert.match(html(), /<img src="https:\/\/example\.test\/images\/garuda\.svg" alt="" onerror="this\.style\.display='none'">/)
  const none = buildConstructionReportHtml({ ...fixture(), emblemUrl: '' })
  assert.ok(!none.includes('<img'))
  assert.ok(!html().includes('data:image'), 'ไม่ฝังภาพ base64 ในใบ')
})

test('หน้าต่างพิมพ์: เปิดผ่าน addMobileCloseButton และเรียกจากหน้าจอรายงาน/รายการรายงาน', async () => {
  const lib = await readFile(new URL('../src/lib/constructionReportPrint.js', import.meta.url), 'utf8')
  assert.ok(lib.includes('addMobileCloseButton(html)'), 'มือถือเปิดแท็บใหม่แล้วไม่มีปุ่มปิด')
  assert.ok(lib.includes('/images/garuda.svg'))
  for (const file of ['ConstructionProjectsModule', 'WeeklyReportSheet']) {
    const source = await readFile(new URL(`../src/components/staff/construction/${file}.jsx`, import.meta.url), 'utf8')
    assert.ok(source.includes('printConstructionReport('), `${file} ต้องเรียกพิมพ์`)
  }
})

console.log(`\n${cases} cases passed`)

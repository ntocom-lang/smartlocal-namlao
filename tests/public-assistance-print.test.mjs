// แบบคำร้องขอรับการช่วยเหลือประชาชน — ตรวจเนื้อหา HTML ของใบพิมพ์ แบบไม่ต้องเปิดเบราว์เซอร์
//
// ล้อโครงจาก water-supply-print.test.mjs — ใบที่ประชาชนยื่นออนไลน์ทุกใบต้องตัดสินโหมดลงนาม
// เหมือนกันเป๊ะ ถ้าวันหนึ่งกติกาเปลี่ยน ต้องเห็น FAIL ทุกไฟล์พร้อมกัน ไม่ใช่ใบใดใบหนึ่งเงียบไป
//
// ใบนี้มีของที่ใบอื่นไม่มีและต้องเฝ้าเป็นพิเศษ 3 อย่าง:
//   1. บัญชีแนบท้าย — ข้อมูลบุคคลที่สาม ต้องไม่มีเลขบัตร/เบอร์โทรของคนในบัญชีหลุดลงใบ
//   2. จำนวนผู้เดือดร้อน — ต้องเว้นเส้นประเมื่อไม่มีรายชื่อในระบบ (ผู้ใช้จะเขียนเพิ่มเองด้วยปากกา)
//   3. ช่องติ๊กส่วนงาน — ต้องเป็นกองจริงของ อปท. นั้น ไม่ใช่ 4 กองฝังตายของต้นฉบับ
//
// รันด้วย: node tests/public-assistance-print.test.mjs

import assert from 'node:assert/strict'
import {
  ATTACHMENT_ROWS_PER_PAGE,
  attachmentPageCount,
  buildPublicAssistanceRequestHtml,
  thaiDateParts,
} from '../src/lib/publicAssistancePrint.js'

const TENANT = {
  name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว',
  org_type: 'อบต.',
  address: '100 หมู่ที่ 1 ตำบลทุ่งแค้ว\nอำเภอหนองม่วงไข่ จังหวัดแพร่',
}

const MUNICIPALITY = { name: 'เทศบาลตำบลน้ำเลา', org_type: 'เทศบาลตำบล' }

const APPLICANT = {
  title: 'นาย', first: 'สมชาย', last: 'ใจดี', phone: '081-234-5678', id_card: '1234567890123',
  addr_no: '99/1', addr_moo: '4',
  addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
}

const DEPARTMENTS = [
  { name: 'สำนักปลัด' }, { name: 'กองคลัง' }, { name: 'กองช่าง' },
  { name: 'กองการศึกษา' }, { name: 'กองสวัสดิการสังคม' },
]

function baseForm(overrides = {}) {
  return {
    form_type: 'public_assistance_request',
    form_version: 1,
    subject: 'ขอรับการช่วยเหลือกรณีน้ำท่วม',
    applicant: APPLICANT,
    problem: 'น้ำท่วมบ้านเรือนราษฎร หมู่ที่ 5 จำนวน 12 หลังคาเรือน',
    need: 'ขอถุงยังชีพและซ่อมถนนที่ถูกน้ำกัดเซาะ',
    affected: [],
    signed_at: '2026-09-08T10:32:00',
    signed_by: { channel: 'online', name: 'นายสมชาย ใจดี' },
    ...overrides,
  }
}

function render(form, extra = {}) {
  return buildPublicAssistanceRequestHtml({
    form,
    tenant: TENANT,
    docDate: '2026-09-08T10:32:00',
    referenceNo: 'A1B2C3D4',
    signedAt: form?.signed_at ?? null,
    ...extra,
  })
}

// ตารางท้ายใบถูกถอดออกชั่วคราว (ดู includeOfficerBlock ใน publicAssistancePrint.js)
// เทสต์ของตารางยังต้องอยู่ครบ ไม่งั้นเปิดกลับมาแล้วไม่มีอะไรกันของพัง — ใช้ helper นี้แทน
function renderWithOfficer(form, extra = {}) {
  return render(form, { ...extra, includeOfficerBlock: true })
}

function people(count, prefix = 'ผู้เดือดร้อน') {
  return Array.from({ length: count }, (unused, index) => ({
    name: `${prefix}ที่ ${index + 1}`,
    addr_no: String(10 + index),
    addr_moo: '5',
    note: '',
  }))
}

// ── หัวใบต้องตรงกับต้นฉบับ และมาจากหน่วยงานที่ล็อกอินอยู่ ─────────────────────
const online = render(baseForm())
assert.match(online, /<div class="title">แบบคำร้องขอรับการช่วยเหลือประชาชน<\/div>/)
assert.match(online, /เขียนที่ ที่ทำการองค์การบริหารส่วนตำบลทุ่งแค้ว/,
  '"เขียนที่" ต้องเป็นชื่อสถานที่ราชการเต็ม ไม่ใช่ชื่อหน่วยงานเปล่าๆ')
assert.match(online, /เรียน<\/strong><span>นายกองค์การบริหารส่วนตำบลทุ่งแค้ว<\/span>/)
assert.match(renderWithOfficer(baseForm()), /ความคิดเห็นปลัด อบต\./)
assert.match(online, /๑\. ปัญหาความเดือดร้อน/)
assert.match(online, /๒\. ความต้องการรับการช่วยเหลือ/)
assert.match(online, /จึงเรียนมาเพื่อโปรดพิจารณาให้ความช่วยเหลือ/)
assert.match(online, /ผู้ขอความช่วยเหลือ/)
// ต้นฉบับใบนี้ไม่มีที่อยู่สำนักงานใต้ "เขียนที่" (ต่างจากใบขออนุญาตใช้น้ำประปา)
assert.doesNotMatch(online, /อำเภอหนองม่วงไข่ จังหวัดแพร่<\/p>/,
  'ใบนี้ต้องไม่พิมพ์ที่อยู่สำนักงานใต้บรรทัดเขียนที่')

// เทศบาลต้องได้คำเรียกของเทศบาลทั้งบรรทัดเรียนและช่องความเห็น ไม่ใช่ค่าฝังของ อบต.
const municipal = render(baseForm(), { tenant: MUNICIPALITY })
assert.match(municipal, /เรียน<\/strong><span>นายกเทศมนตรีตำบลน้ำเลา<\/span>/)
assert.match(renderWithOfficer(baseForm(), { tenant: MUNICIPALITY }), /ความคิดเห็นปลัดเทศบาล/)
// ที่ต้องไม่หลุดคือ "ชื่อหน่วยงาน" กับ "คำเรียกตำแหน่ง" ของ อบต. — ส่วนคำว่าทุ่งแค้วเฉยๆ
// ยังมีได้ เพราะเป็นที่อยู่ที่ผู้ยื่นกรอกเอง คนละเรื่องกับหน่วยงานที่ออกใบ
assert.doesNotMatch(municipal, /องค์การบริหารส่วนตำบลทุ่งแค้ว|ปลัด อบต\.|นายก อบต\./,
  'ใบของเทศบาลต้องไม่มีชื่อ/คำเรียกของ อบต. ต้นฉบับหลงเหลืออยู่')

// ── PDPA: เลขบัตรประชาชนเก็บใน document_requests แต่ห้ามพิมพ์ลงใบ ────────────
// ต้นฉบับไม่มีช่องนี้ และใบนี้ถูกพิมพ์ไปเดินเก็บลายมือชื่อเพื่อนบ้าน จึงผ่านตาคนนอกจำนวนมาก
assert.doesNotMatch(online, /1234567890123/, 'เลขบัตรประชาชนต้องไม่ปรากฏบนใบพิมพ์')
assert.doesNotMatch(online, /081-234-5678/, 'เบอร์โทรไม่ใช่ช่องในต้นฉบับ ต้องไม่ปรากฏบนใบพิมพ์')

// ── จำนวนผู้เดือดร้อน ─────────────────────────────────────────────────────────
// ไม่มีรายชื่อในระบบ = เว้นเส้นประ ห้ามพิมพ์ "0" หรือ "1" ไว้ล่วงหน้า เพราะผู้ยื่นจะพิมพ์ใบ
// ไปเดินเก็บรายชื่อเพิ่มเอง เลขที่พิมพ์ไว้จะขัดกับบัญชีแนบท้ายทันทีที่มีคนเซ็นเพิ่ม
assert.match(online, /จำนวน&nbsp;<span class="fill-blank"/,
  'ไม่มีรายชื่อในระบบ ช่องจำนวนคนต้องเป็นเส้นประ')
const withPeople = render(baseForm({ affected: people(3) }))
assert.match(withPeople, /จำนวน <span class="fill-value">3<\/span> คน/)

// ── บัญชีแนบท้าย ─────────────────────────────────────────────────────────────
assert.equal(attachmentPageCount([]), 1, 'ยื่นคนเดียวก็ต้องได้หน้าบัญชีแนบท้ายไปด้วย 1 หน้า')
assert.equal(attachmentPageCount(null), 1)
assert.equal(attachmentPageCount(people(ATTACHMENT_ROWS_PER_PAGE)), 1)
assert.equal(attachmentPageCount(people(ATTACHMENT_ROWS_PER_PAGE + 1)), 2)
assert.equal(attachmentPageCount(people(ATTACHMENT_ROWS_PER_PAGE * 2 + 1)), 3)

const emptyRoster = render(baseForm())
assert.equal((emptyRoster.match(/class="sheet sheet--attachment"/g) || []).length, 1)
assert.equal((emptyRoster.match(/<td class="col-no">/g) || []).length, ATTACHMENT_ROWS_PER_PAGE,
  `หน้าบัญชีแนบท้ายต้องมี ${ATTACHMENT_ROWS_PER_PAGE} แถวเสมอ แม้ไม่มีรายชื่อ`)

const twoPages = render(baseForm({ affected: people(ATTACHMENT_ROWS_PER_PAGE + 5) }))
assert.equal((twoPages.match(/class="sheet sheet--attachment"/g) || []).length, 2)
// ลำดับต้องไล่ต่อเนื่องข้ามหน้า ไม่ใช่เริ่ม 1 ใหม่ทุกหน้า
assert.match(twoPages, new RegExp(`<td class="col-no"><div class="cell-clip">${ATTACHMENT_ROWS_PER_PAGE + 1}</div>`))
assert.match(twoPages, new RegExp(`<td class="col-no"><div class="cell-clip">${ATTACHMENT_ROWS_PER_PAGE * 2}</div>`))
// ช่องลายมือชื่อต้องว่างทุกแถวเสมอ — ระบบลงลายมือชื่อแทนคนในบัญชีไม่ได้ เขาไม่ได้ยืนยันตัวตน
assert.doesNotMatch(twoPages, /<td class="col-sign">(?!<\/td>)/,
  'ช่องลายมือชื่อในบัญชีแนบท้ายต้องเว้นว่างให้เซ็นด้วยปากกาเสมอ')

// ── ช่องติ๊กส่วนงานที่รับผิดชอบ ────────────────────────────────────────────────
const withDepts = renderWithOfficer(baseForm(), { departments: DEPARTMENTS })
for (const dept of DEPARTMENTS) {
  assert.match(withDepts, new RegExp(`<span class="checkbox"></span>${dept.name}`),
    `ต้องมีช่องติ๊กของ ${dept.name}`)
}
assert.doesNotMatch(withDepts, /อื่น ๆ/, 'กอง 5 กองยังไม่เกินเพดาน ไม่ควรมีช่อง "อื่น ๆ"')

// อปท. ที่มีกองเยอะกว่าเพดาน: ตัดเหลือ 6 แล้วต้องมีช่อง "อื่น ๆ" ให้เขียนเอง ห้ามตัดหายเงียบๆ
const manyDepts = renderWithOfficer(baseForm(), {
  departments: [...DEPARTMENTS, { name: 'กองสาธารณสุข' }, { name: 'กองการประปา' }, { name: 'หน่วยตรวจสอบภายใน' }],
})
assert.equal((manyDepts.match(/class="checkbox"/g) || []).length, 7, 'ต้องเป็น 6 กอง + อื่น ๆ')
assert.match(manyDepts, /<span class="checkbox"><\/span>อื่น ๆ/)

// ไม่ส่งข้อมูลกองมาเลย (ใบเปล่าที่พิมพ์ไว้แจกหน้าเคาน์เตอร์) ใช้ 4 ช่องตามต้นฉบับ
const noDepts = renderWithOfficer(baseForm())
assert.match(noDepts, /<span class="checkbox"><\/span>สำนักงานปลัด/)
assert.equal((noDepts.match(/class="checkbox"/g) || []).length, 4)

// ── โหมดลงนาม 2 แบบ ─────────────────────────────────────────────────────────
assert.match(online, /<span class="sign-signed">นายสมชาย ใจดี<\/span>/)
assert.match(online, /ลงชื่อโดยการยืนยันตัวตนผ่านระบบ E-Service องค์การบริหารส่วนตำบลทุ่งแค้ว/)
assert.match(online, /เลขอ้างอิง A1B2C3D4/)

const counter = render(baseForm({ signed_by: { channel: 'counter', name: 'นายสมชาย ใจดี' } }))
assert.doesNotMatch(counter, /class="sign-signed"/,
  'เจ้าหน้าที่กรอกแทน: ห้ามพิมพ์ชื่อประชาชนเป็นลายมือชื่อ ต้องเว้นให้เซ็นด้วยปากกา')
assert.doesNotMatch(counter, /ลงชื่อโดยการยืนยันตัวตน/,
  'ผู้ยื่นไม่ได้ยืนยันตัวตนในระบบ ห้ามเขียนว่าลงชื่อทางอิเล็กทรอนิกส์')
assert.match(counter, /ยื่นคำร้องผ่านระบบ E-Service องค์การบริหารส่วนตำบลทุ่งแค้ว/,
  'ใบที่ออกจากระบบต้องมีบรรทัดกำกับที่มาทุกโหมด')

// คำร้องเก่าที่ไม่มี signed_by เลย ต้องตกมาที่โหมดเซ็นปากกา ไม่ใช่ถือว่าลงชื่อแล้ว
const legacy = render(baseForm({ signed_by: undefined }))
assert.doesNotMatch(legacy, /class="sign-signed"/)

// ── ผู้ลงนามฝั่งเจ้าหน้าที่ ────────────────────────────────────────────────────
const signed = renderWithOfficer(baseForm(), {
  signatories: {
    clerk: { name: 'นายวิเชียร ทองสุขใส', title: 'ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว' },
    mayor: { name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล', title: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว' },
  },
})
assert.match(signed, /นายวิเชียร/)
assert.match(signed, /ประกายมาศ/)
// ต้นฉบับมีแค่ชื่อในวงเล็บ ไม่มีบรรทัดตำแหน่ง (และตำแหน่งยาวจนดันบล็อกสูงขึ้น 17 มม.)
assert.doesNotMatch(signed, /class="cell-title"/)
// ช่องความเห็น/คำสั่งต้องเว้นว่างเสมอ ระบบไม่เขียนความเห็นแทนปลัด/นายก
assert.match(signed, /ความคิดเห็นปลัด อบต\.<\/div>\s*<div class="fill-lines"/)

// ไม่มีทะเบียนผู้ลงนาม (อปท. ที่ยังไม่ได้ตั้ง) ต้องได้เส้นประ ไม่ใช่ "undefined"
assert.doesNotMatch(online, /undefined/)

// ── escape ทุกค่าที่คนกรอกเอง ────────────────────────────────────────────────
const xss = render(baseForm({
  applicant: { ...APPLICANT, first: '<script>alert(1)</script>' },
  subject: '<img src=x onerror=alert(1)>',
  problem: '<b>ตัวหนา</b>',
  need: '"ต้องการ"',
  affected: [{ name: '<script>evil()</script>', addr_no: '1', addr_moo: '2', note: '<i>x</i>' }],
}), {
  departments: [{ name: '<script>dept()</script>' }],
  signatories: { clerk: { name: '<script>clerk()</script>' } },
})
assert.doesNotMatch(xss, /<script>/, 'ค่าที่คนกรอกเองต้องถูก escape ทุกจุด รวมชื่อกองและผู้ลงนาม')
assert.doesNotMatch(xss, /<img src=x/)
assert.doesNotMatch(xss, /<b>ตัวหนา<\/b>/)
assert.match(xss, /&lt;script&gt;/)

// ── วันที่ ───────────────────────────────────────────────────────────────────
assert.deepEqual(thaiDateParts(''), { day: '', month: '', year: '' })
assert.deepEqual(thaiDateParts(null), { day: '', month: '', year: '' })
assert.deepEqual(thaiDateParts('ไม่ใช่วันที่'), { day: '', month: '', year: '' })
assert.deepEqual(thaiDateParts('2026-09-08T10:32:00'), { day: '8', month: 'กันยายน', year: '2569' })

const badDate = render(baseForm(), { docDate: 'ไม่ใช่วันที่' })
assert.doesNotMatch(badDate, /NaN|Invalid Date|undefined/,
  'วันที่เสียต้องได้เส้นประ ไม่ใช่ NaN บนเอกสารราชการ')

// ใบเปล่าทั้งใบ (ทุกช่องเป็นเส้นประ) ต้องเรนเดอร์ได้โดยไม่มีค่าหลุด
const blank = buildPublicAssistanceRequestHtml({
  form: { form_type: 'public_assistance_request', form_version: 1, applicant: {}, affected: [] },
  tenant: TENANT,
  docDate: null,
})
assert.doesNotMatch(blank, /NaN|Invalid Date|undefined|null/)
assert.match(blank, /class="sheet sheet--attachment"/)

// คำนำหน้าในวงเล็บเป็นคำใบ้ให้คนกรอกด้วยปากกา ใบที่มีชื่อมาแล้วต้องไม่พิมพ์ซ้ำ
// (ผู้ใช้ระบบสั่งแก้ 2569-09-09 หลังเห็น "ข้าพเจ้า (นาย/นาง/นางสาว) นายทดสอบ" บนใบจริง)
assert.match(blank, /ข้าพเจ้า \(นาย\/นาง\/นางสาว\)/,
  'ใบเปล่าต้องคงคำใบ้คำนำหน้าไว้ให้คนเขียนมือ')
assert.doesNotMatch(render(baseForm()), /นาย\/นาง\/นางสาว/,
  'ใบที่มีชื่อผู้ยื่นแล้วต้องไม่พิมพ์ (นาย/นาง/นางสาว) ซ้ำหน้าชื่อ')

// ช่องที่มีข้อความแล้วต้องไม่เหลือเส้นประ ส่วนใบเปล่าต้องมีครบตามที่ไล่ความสูงไว้
assert.match(render(baseForm()), /<div class="written">/,
  'ข้อความที่กรอกมาต้องพิมพ์เป็นข้อความธรรมดา ไม่ใช่ทับบนกล่องเส้นประ')
assert.equal((blank.match(/<div class="fill-lines"/g) ?? []).length, 2,
  'ใบเปล่าต้องมีกล่องเส้นประ 2 ก้อน: ปัญหา + ความต้องการ')

// ── ตารางท้ายใบถอดออกชั่วคราวตามคำสั่งผู้ใช้ระบบ 2569-09-09 ───────────────────
// ค่าปริยายต้องไม่มีตาราง ทุกจุดเรียกใช้จึงได้ใบแบบเดียวกันโดยไม่ต้องส่งอะไรเพิ่ม
const defaultSheet = render(baseForm(), { departments: DEPARTMENTS })
assert.doesNotMatch(defaultSheet, /class="officer"/,
  'ค่าปริยายต้องไม่พิมพ์ตารางท้ายใบ — ถ้าจะเปิดกลับต้องแก้ที่ includeOfficerBlock ไม่ใช่ที่นี่')
assert.doesNotMatch(defaultSheet, /ผลการดำเนินการ|ส่วนงานที่รับผิดชอบ|คำอนุมัติ\/คำสั่ง/)
assert.doesNotMatch(defaultSheet, /class="checkbox"/,
  'ช่องติ๊กส่วนงานอยู่ในตารางท้ายใบ ต้องหายไปพร้อมกัน')
// เปิด flag แล้วต้องได้ตารางครบเหมือนเดิม
assert.match(renderWithOfficer(baseForm()), /class="officer"/)
assert.match(renderWithOfficer(baseForm()), /ผลการดำเนินการ/)

console.log('public-assistance-print.test.mjs PASS')

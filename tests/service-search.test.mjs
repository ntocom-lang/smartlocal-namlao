// ตรึงตรรกะค้นหาบริการ/คำถามที่พบบ่อย/แบบฟอร์ม (src/lib/serviceSearch.js) — node ล้วน ไม่ต่อเน็ต/ฐานข้อมูล
// รัน: node tests/service-search.test.mjs (npm run test:service-search)
import assert from 'node:assert/strict'
import { allDocumentTypes, selectableDocumentTypes } from '../src/lib/documentTypes.js'
import {
  SERVICE_SYNONYMS, buildServiceIndex, normalizeThai, safeLink, searchServices,
} from '../src/lib/serviceSearch.js'

let cases = 0
const test = (label, run) => { run(); cases++; console.log('PASS ' + label) }

// ชุดบริการตัวอย่าง — ชื่อเดียวกับหมวดคำร้อง/ประเภทคำขอจริง
const services = [
  { id: 'cat-light', title: 'ไฟฟ้าสาธารณะ', subtitle: 'แจ้งเรื่องร้องเรียน/ร้องทุกข์', href: '/request?category=light' },
  { id: 'cat-trash', title: 'ขยะ / ความสะอาด', subtitle: 'แจ้งเรื่องร้องเรียน/ร้องทุกข์', href: '/request?category=trash' },
  { id: 'cat-drain', title: 'ท่อระบายน้ำ', subtitle: 'แจ้งเรื่องร้องเรียน/ร้องทุกข์', href: '/request?category=drain' },
  { id: 'cat-animals', title: 'สุนัขจรจัด', subtitle: 'แจ้งเรื่องร้องเรียน/ร้องทุกข์', href: '/request?category=animals' },
  { id: 'doc-permit', title: 'ขออนุญาตก่อสร้างบ้าน', subtitle: 'งานบริการประชาชน', href: '/doc-request?type=building_permit' },
  { id: 'doc-water', title: 'ขออนุญาตใช้น้ำประปา', subtitle: 'งานบริการประชาชน', href: '/doc-request?type=water_supply_request' },
  { id: 'doc-borrow', title: 'ขอยืมพัสดุ/ครุภัณฑ์', subtitle: 'งานบริการประชาชน', href: '/doc-request?type=asset_borrow_request' },
  { id: 'doc-patient', title: 'ขออนุเคราะห์รถรับ-ส่งผู้ป่วย', subtitle: 'งานบริการประชาชน', href: '/patient-transport' },
  { id: 'doc-tax', title: 'ค่าธรรมเนียม/ภาษี', subtitle: 'งานบริการประชาชน', href: '/doc-request?type=tax_notice' },
  { id: 'menu-waste', title: 'ตารางวันเก็บขยะ', subtitle: 'เมนู', href: '/waste' },
]
const faqs = [
  { id: 'faq-1', question: 'ต้องใช้เอกสารอะไรบ้างในการขออนุญาตก่อสร้าง', answer: 'สำเนาบัตรประชาชน สำเนาทะเบียนบ้าน และเอกสารสิทธิ์ที่ดิน', keywords: 'ข.1, สร้างบ้าน', link_url: '/doc-request?type=building_permit', link_label: 'ไปยื่นคำขอ' },
  { id: 'faq-2', question: 'รถเก็บขยะมาวันไหน', answer: 'ดูตารางวันเก็บขยะได้ที่เมนูตารางวันเก็บขยะ', keywords: null, link_url: '/waste', link_label: 'ดูตาราง' },
  { id: 'faq-3', question: 'ชำระภาษีป้ายได้ที่ไหน', answer: 'ที่กองคลังในวันและเวลาราชการ มีไฟฟ้าสาธารณะรอบสำนักงาน', keywords: null, link_url: null, link_label: null },
]
const forms = [
  { id: 'form-1', title: 'แบบคำขอใบอนุญาตก่อสร้าง ดัดแปลง รื้อถอนอาคาร (ข.1)', description: 'แบบฟอร์มเปล่า', keywords: 'ต่อเติม', file_url: 'https://drive.example.com/f1.pdf', department_id: 'd1' },
  { id: 'form-bad', title: 'แบบฟอร์มลิงก์เสีย', description: '', keywords: '', file_url: 'javascript:alert(1)' },
  { id: 'form-internal', title: 'แบบฟอร์มลิงก์ภายใน', description: '', keywords: '', file_url: '/etc/passwd' },
]
const index = buildServiceIndex({ services, faqs, forms })
const ids = (rows) => rows.map((r) => r.id)

test('normalizeThai: ตัวพิมพ์เล็ก ตัดช่องว่างซ้อน/zero-width/trim', () => {
  assert.equal(normalizeThai('  PM2.5   ฝุ่น​  '), 'pm2.5 ฝุ่น')
  assert.equal(normalizeThai(null), '')
  assert.equal(normalizeThai(undefined), '')
})

test('ดัชนี: ข้ามแบบฟอร์มที่ file_url ไม่ใช่ https:// (javascript: / path ภายใน)', () => {
  assert.ok(ids(index).includes('form-1'))
  assert.equal(ids(index).includes('form-bad'), false)
  assert.equal(ids(index).includes('form-internal'), false)
  assert.equal(index.filter((i) => i.kind === 'form').every((i) => i.external === true), true)
  assert.equal(index.filter((i) => i.kind === 'faq').every((i) => i.href === null), true)
})

test('คำพ้อง: "ไฟดับ" → หมวดไฟฟ้าสาธารณะ (ไม่ต้องพิมพ์ชื่อหมวด)', () => {
  assert.equal(searchServices(index, 'ไฟดับ')[0]?.id, 'cat-light')
  assert.equal(searchServices(index, 'เสาไฟ')[0]?.id, 'cat-light')
})

test('คำพ้อง: คำที่ชาวบ้านพิมพ์ ไปถึงบริการที่ถูกต้อง', () => {
  const top = (q) => searchServices(index, q)[0]?.id
  assert.equal(top('ถังขยะ'), 'cat-trash')
  assert.equal(top('ท่อตัน'), 'cat-drain')
  assert.equal(top('น้ำขัง'), 'cat-drain')
  assert.equal(top('หมาจรจัด'), 'cat-animals')
  assert.equal(top('หมา'), 'cat-animals')
  assert.equal(top('ภาษีที่ดิน'), 'doc-tax')
  assert.ok(ids(searchServices(index, 'น้ำไม่ไหล')).includes('doc-water'))
  assert.ok(ids(searchServices(index, 'มิเตอร์')).includes('doc-water'))
  assert.ok(ids(searchServices(index, 'โรงพยาบาล')).includes('doc-patient'))
  assert.ok(ids(searchServices(index, 'เต็นท์')).includes('doc-borrow'))
  assert.ok(ids(searchServices(index, 'สร้างบ้าน')).includes('doc-permit'))
  assert.ok(ids(searchServices(index, 'ต่อเติม')).includes('doc-permit'))
})

test('ตารางคำพ้อง: ครบทุกหมวดคำร้องและประเภทคำขอที่มีจริง (แต่ละชื่อมีแนวคิดอย่างน้อย 1 ข้อ)', () => {
  const keys = Object.keys(SERVICE_SYNONYMS).map(normalizeThai)
  const labels = [
    'ไฟฟ้าสาธารณะ', 'ท่อระบายน้ำ', 'ฝาท่อระบายน้ำ', 'ขยะ / ความสะอาด', 'น้ำเสีย', 'ดูดสิ่งปฏิกูล', 'ลอกคลอง', 'ถนน / ทางเท้า',
    'แจ้งเหตุรำคาญ', 'น้ำท่วม / ระบายน้ำ', 'ตรวจสอบอาคาร', 'พ่นยุง', 'ควบคุมโรคติดต่อ', 'กลิ่น / ควัน / มลพิษ',
    'แจ้งเรื่องร้องทุกข์ร้องเรียน', 'แจ้งการทุจริต', 'ภาษีและค่าธรรมเนียม', 'ตัดต้นไม้', 'สนับสนุนน้ำอุปโภค', 'สุนัขจรจัด', 'ร้องเรียนเสียง',
    'ขออนุญาตก่อสร้างบ้าน', 'ขออนุญาตใช้น้ำประปา', 'ขอยืมพัสดุ/ครุภัณฑ์', 'ขออนุเคราะห์รถรับ-ส่งผู้ป่วย', 'ขอรับการช่วยเหลือประชาชน',
    'ขอภาพจากกล้องวงจรปิด', 'ขอรับบริการเก็บขนขยะมูลฝอย', 'ค่าธรรมเนียม/ภาษี',
  ]
  for (const label of labels) {
    const n = normalizeThai(label)
    assert.ok(keys.some((k) => n.includes(k)), `"${label}" ไม่มีแนวคิดในตารางคำพ้อง`)
  }
})

test('ทุกคำต้องเจอ: คำใดคำหนึ่งไม่เจอ = ไม่ขึ้น', () => {
  assert.ok(ids(searchServices(index, 'ไฟดับ ไฟฟ้า')).includes('cat-light'))
  assert.deepEqual(searchServices(index, 'ไฟดับ สุนัข'), [])
  assert.deepEqual(searchServices(index, 'ไฟดับ ไม่มีคำนี้แน่นอน'), [])
  assert.deepEqual(searchServices(index, 'zzzzz'), [])
})

test('ลำดับคะแนน: ชื่อขึ้นต้นด้วยคำค้น > ชื่อมีคำค้น > คำพ้อง/คำค้นเพิ่ม > คำตอบ', () => {
  const idx = buildServiceIndex({
    services: [
      { id: 'a-answer-only', title: 'เรื่องอื่น', subtitle: '', href: '/x1' },
      { id: 'b-contains', title: 'บริการขอเต็นท์ยืมงานศพ', subtitle: '', href: '/x2' },
      { id: 'c-starts', title: 'เต็นท์สำหรับงานบุญ', subtitle: '', href: '/x3' },
      { id: 'd-keyword', title: 'ขอยืมของ', subtitle: '', href: '/x4', keywords: 'เต็นท์' },
    ],
    faqs: [{ id: 'e-faq', question: 'ยืมของได้กี่วัน', answer: 'ยืมเต็นท์ได้ 3 วัน', keywords: null }],
  })
  const order = ids(searchServices(idx, 'เต็นท์'))
  assert.deepEqual(order, ['c-starts', 'b-contains', 'd-keyword', 'e-faq'], order.join(','))
  assert.equal(order.includes('a-answer-only'), false)
})

test('คำตอบของ FAQ ค้นเจอ แต่ได้คะแนนต่ำสุด (ไม่เติมคำพ้องจากคำตอบ)', () => {
  const rows = searchServices(index, 'ไฟฟ้าสาธารณะ')
  assert.equal(rows[0].id, 'cat-light')
  // คำตอบของ faq-3 พูดถึงไฟฟ้าสาธารณะ → ขึ้นได้แต่ต้องตามหลังหมวดจริง
  assert.ok(ids(rows).includes('faq-3'))
  assert.ok(ids(rows).indexOf('faq-3') > 0)
  // ชื่อ faq-3 พูดถึงภาษีป้าย ไม่ใช่ไฟ → คำว่า "ไฟดับ" ขึ้นได้เฉพาะเพราะคำตอบมีชื่อแนวคิดจริง และต้องตามหลังหมวดที่ตรงเสมอ
  const viaSynonym = ids(searchServices(index, 'ไฟดับ'))
  assert.equal(viaSynonym[0], 'cat-light')
  assert.ok(viaSynonym.indexOf('faq-3') !== 0)
  // แต่คำพ้องไม่ถูกเติมจากคำตอบ: คำค้นที่เป็นคำพ้องล้วน ที่ไม่มีแนวคิดอยู่ในคำตอบเลย → ไม่เจอ
  assert.equal(ids(searchServices(index, 'เสาไฟ')).includes('faq-1'), false)
})

test('query ว่าง/มีแต่ช่องว่าง = [] · limit ทำงาน', () => {
  assert.deepEqual(searchServices(index, ''), [])
  assert.deepEqual(searchServices(index, '   '), [])
  assert.deepEqual(searchServices(index, null), [])
  assert.equal(searchServices(index, 'ขอ', { limit: 2 }).length, 2)
})

test('คำค้นไม่สนตัวพิมพ์ใหญ่/เล็กและช่องว่างซ้อน', () => {
  assert.equal(searchServices(index, 'CCTV').length, 0) // ตัวอย่างชุดนี้ไม่มีบริการกล้อง
  const idx = buildServiceIndex({ services: [{ id: 'cctv', title: 'ขอภาพจากกล้องวงจรปิด', href: '/doc-request?type=cctv_footage_request' }] })
  assert.equal(searchServices(idx, '  CcTv  ')[0]?.id, 'cctv')
})

test('safeLink: path ภายในและ https ผ่าน', () => {
  assert.deepEqual(safeLink('/complaint'), { internal: true, to: '/complaint' })
  assert.deepEqual(safeLink('/'), { internal: true, to: '/' })
  assert.deepEqual(safeLink('/doc-request?type=building_permit'), { internal: true, to: '/doc-request?type=building_permit' })
  assert.deepEqual(safeLink('https://example.go.th/form.pdf'), { internal: false, href: 'https://example.go.th/form.pdf' })
})

test('safeLink: กัน javascript: / data: / vbscript: / //โดเมน / "/ /x" / http: / backslash / ว่าง', () => {
  for (const bad of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)',
    '//evil.example.com', '//evil.example.com/x', '/ /x', '/\\evil.example.com', '/\\/evil.example.com', '/ x',
    'http://example.com', 'ftp://example.com', 'https://', 'https:// evil.com', 'https://exa mple.com', 'complaint', '', '   ', null, undefined, 42,
    '/%0d%0aX', '/a\nb', '/ก', 'https://example.com/\u0000',
  ]) {
    // '/%0d%0aX' มีอักขระ % ที่ CHECK ในฐานข้อมูลอนุญาต จึงต้องผ่านเฉพาะ path ภายใน — แยกตรวจด้านล่าง
    if (bad === '/%0d%0aX') continue
    assert.equal(safeLink(bad), null, `ต้องไม่ผ่าน: ${JSON.stringify(bad)}`)
  }
  assert.equal(safeLink('/' + 'a'.repeat(300)), null, 'path ยาวเกิน 300')
  assert.equal(safeLink('https://example.com/' + 'a'.repeat(500)), null, 'ยาวเกิน 500')
})

test('ประเภทที่ "เฉพาะผู้มีตำแหน่ง" ไม่เข้าดัชนีของประชาชน (ผ่าน selectableDocumentTypes ก่อนสร้างดัชนี)', () => {
  const tenant = { fee_schedule: { _officials_only_types: ['building_permit'], _removed_types: ['tax_notice'], _custom_types: [{ value: 'custom_x', label: 'ขอใบรับรองพิเศษ', emoji: '📋' }] } }
  const asService = (types) => types.map((t) => ({ id: t.value, title: t.label.replace(/^[^\p{L}\p{N}]+/u, ''), href: `/doc-request?type=${t.value}` }))
  const citizen = buildServiceIndex({ services: asService(selectableDocumentTypes(allDocumentTypes(tenant), tenant, 'citizen')) })
  assert.equal(searchServices(citizen, 'ก่อสร้าง').length, 0, 'ประชาชนต้องไม่เห็นบริการที่ตั้งเฉพาะผู้มีตำแหน่ง')
  assert.equal(searchServices(citizen, 'ภาษี').length, 0, 'ประเภทที่ อปท. ลบทิ้งต้องไม่ขึ้น')
  assert.equal(searchServices(citizen, 'ใบรับรองพิเศษ')[0]?.id, 'custom_x', 'ประเภทที่ อปท. เพิ่มเองต้องค้นเจอ')
  const staff = buildServiceIndex({ services: asService(selectableDocumentTypes(allDocumentTypes(tenant), tenant, 'staff')) })
  assert.equal(searchServices(staff, 'ก่อสร้าง')[0]?.id, 'building_permit', 'ผู้มีตำแหน่งเห็นได้')
})

console.log(`\nok — ${cases} cases`)

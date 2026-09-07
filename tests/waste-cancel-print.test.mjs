// ใบแจ้งขอยกเลิกการเก็บขนขยะมูลฝอย — ตรวจ "เนื้อหา HTML" แบบไม่ต้องเปิดเบราว์เซอร์
//
// คู่กับ waste-cancel-layout.test.mjs ที่วัดเลย์เอาต์จริงด้วย Playwright (ช้ากว่ามาก)
// ไฟล์นี้ตรวจสิ่งที่อ่านจากสตริงได้: ถ้อยคำตามต้นฉบับ, โหมดลงนาม 2 แบบ, การ escape
//
// รันด้วย: npm run test:waste-cancel

import assert from 'node:assert/strict'
import {
  buildWasteCollectionCancelHtml,
  cancelReasonText,
  signedAtText,
} from '../src/lib/wasteCollectionCancelPrint.js'

const TENANT = { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', org_type: 'อบต.' }

const APPLICANT = {
  title: 'นาย', first: 'สมชาย', last: 'ใจดี', age: 45, phone: '081-234-5678',
  addr_no: '99/1', addr_moo: '4',
  addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
}

function baseForm(overrides = {}) {
  return {
    form_type: 'waste_collection_cancel',
    form_version: 1,
    applicant: APPLICANT,
    same_as_applicant: true,
    subscriber: {},
    cancel_reason: 'ไม่มีคนอยู่บ้าน',
    cancel_reason_other: '',
    cancel_date: '2026-10-01',
    outstanding_ack: true,
    signed_at: '2026-09-07T10:32:00',
    signed_by: { channel: 'online', name: 'นายสมชาย ใจดี' },
    ...overrides,
  }
}

function render(form, extra = {}) {
  return buildWasteCollectionCancelHtml({
    form,
    tenant: TENANT,
    thDate: '7 กันยายน พ.ศ. 2569',
    referenceNo: 'A1B2C3D4',
    ...extra,
  })
}

// ── ถ้อยคำตามที่ตกลงไว้ ─────────────────────────────────────────────────────
// ผู้ใช้สั่งเปลี่ยนจากต้นฉบับ "ขออนุญาตยกเลิก" เป็น "ขอยกเลิก" เพราะการเลิกใช้บริการเป็นการ
// แสดงเจตนา ไม่ใช่เรื่องที่ต้องขออนุญาต — ถ้าใครแก้กลับ เทสนี้ต้องแตก
{
  const html = render(baseForm())
  assert.match(html, /ใบแจ้งขอยกเลิกการเก็บขนขยะมูลฝอย/)
  assert.match(html, /<span>ขอยกเลิกการเก็บขนขยะมูลฝอย<\/span>/)
  assert.match(html, /ผู้ยื่นคำร้อง/)
  assert.doesNotMatch(html, /ขออนุญาต/)
  assert.doesNotMatch(html, /ผู้ขออนุญาต/)

  // คำขึ้นต้นต้องมีชื่อหน่วยงานเต็ม ไม่ใช่ "นายก อบต." แบบย่อที่ใช้ในหน้าจอระบบ
  assert.match(html, /เรียน<\/strong><span>นายกองค์การบริหารส่วนตำบลทุ่งแค้ว<\/span>/)

  // ข้อมูลที่กรอกต้องขึ้นเป็นข้อความ ไม่ใช่เส้นประ
  assert.match(html, /นายสมชาย ใจดี/)
  assert.match(html, /081-234-5678/)
  assert.match(html, /1 ตุลาคม พ.ศ. 2569/)
  assert.match(html, /ไม่มีคนอยู่บ้าน/)

  // ชื่อหน่วยงานกลางประโยคต้องถูกครอบไว้ไม่ให้ตัดกลางคำ (ดู .org-name ในไฟล์ใบพิมพ์)
  assert.equal((html.match(/<span class="org-name">/g) || []).length, 2)

  // ย่อหน้าค่าธรรมเนียมค้างชำระ — กันประเด็น สตง. ห้ามหายไปจากใบ
  assert.match(html, /ค้างชำระจนถึงวันที่การยกเลิกมีผลให้ครบถ้วน/)
  assert.match(html, /การยกเลิกจะมีผลเมื่อ.*ตรวจสอบและแจ้งผลแล้ว/)
}

// ── โหมดลงนาม: ยื่นออนไลน์เอง → พิมพ์ชื่อเป็นลายมือชื่อ + บรรทัดกำกับ ─────────
{
  const html = render(baseForm())
  assert.match(html, /<p class="signed-name">นายสมชาย ใจดี<\/p>/)
  assert.match(html, /ลงชื่อโดยการยืนยันตัวตนผ่านระบบ E-Service/)
  assert.match(html, /7 กันยายน พ.ศ. 2569 เวลา 10\.32 น\./)
  assert.match(html, /เลขอ้างอิง A1B2C3D4/)
  // ต้องไม่เหลือช่องว่างเซ็นมือคู่กับชื่อที่พิมพ์ไว้แล้ว จะกลายเป็นใบที่มีสองที่ให้ลงชื่อ
  assert.doesNotMatch(html, /<div class="signature-space">/)
}

// ── โหมดลงนาม: เจ้าหน้าที่กรอกแทนที่เคาน์เตอร์ → ต้องเว้นให้เซ็นด้วยปากกา ────
// ⚠️ ข้อนี้เป็นเรื่องความถูกต้องของหลักฐาน ไม่ใช่เรื่องหน้าตา — ประชาชนไม่ได้ยืนยันตัวตน
// ในระบบ ระบบจะพิมพ์ชื่อเขาเป็นลายมือชื่อแทนไม่ได้
{
  const html = render(baseForm({ signed_by: { channel: 'counter', name: 'นายสมชาย ใจดี' } }))
  assert.match(html, /<div class="signature-space">/)
  assert.doesNotMatch(html, /<p class="signed-name">/)
  assert.doesNotMatch(html, /ลงชื่อโดยการยืนยันตัวตนผ่านระบบ/)
}

// ── ผู้ใช้บริการเป็นคนละคนกับผู้ยื่น (ยื่นแทน) ──────────────────────────────
{
  const html = render(baseForm({
    same_as_applicant: false,
    subscriber: {
      title: 'นาง', first: 'สมหญิง', last: 'ใจงาม', age: 78,
      addr_no: '12', addr_moo: '7',
      addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
    },
  }))
  assert.match(html, /นางสมหญิง ใจงาม/)
  assert.match(html, /นายสมชาย ใจดี/)
  // ชื่อในช่องลงนามต้องเป็นผู้ยื่น ไม่ใช่ผู้ใช้บริการ — คนลงชื่อคือคนที่ยื่นเรื่อง
  assert.match(html, /<p class="signed-name">นายสมชาย ใจดี<\/p>/)
}

// ── เหตุผล "อื่นๆ" ต้องพิมพ์ข้อความที่กรอก ไม่ใช่คำว่าอื่นๆ ─────────────────
{
  const form = baseForm({ cancel_reason: 'อื่นๆ', cancel_reason_other: 'เปลี่ยนไปใช้บริการเอกชน' })
  assert.equal(cancelReasonText(form), 'เปลี่ยนไปใช้บริการเอกชน')
  const html = render(form)
  assert.match(html, /เปลี่ยนไปใช้บริการเอกชน/)
  assert.doesNotMatch(html, /เนื่องจาก <span class="fill-value">อื่นๆ<\/span>/)
}

// ── ช่องที่ไม่มีค่าต้องเป็นเส้นประให้เขียนด้วยปากกาได้ ไม่ใช่ช่องว่างเปล่า ───
{
  const html = render(baseForm({
    applicant: { ...APPLICANT, phone: '', age: '' },
    cancel_date: '',
  }))
  assert.match(html, /class="fill-blank"/)
  // วันที่รูปแบบไม่ถูกต้องต้องกลายเป็นเส้นประ ไม่ใช่ "Invalid Date"
  assert.doesNotMatch(html, /Invalid Date/)
  assert.doesNotMatch(html, /NaN/)
}

// ── escape: ชื่อ อปท. มาจาก DB ที่แอดมินแก้ได้ ห้ามหลุดเป็น HTML ────────────
{
  const html = buildWasteCollectionCancelHtml({
    form: baseForm({ applicant: { ...APPLICANT, first: '<script>alert(1)</script>' } }),
    tenant: { name: 'อบต.<img src=x onerror=alert(1)>', org_type: 'อบต.' },
    thDate: '7 กันยายน พ.ศ. 2569',
    referenceNo: 'A1B2C3D4',
  })
  assert.doesNotMatch(html, /<script>alert/)
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /&lt;script&gt;/)
}

// ── signedAtText: ค่าเสียต้องคืนค่าว่าง ให้ผู้เรียกตัดบรรทัดกำกับทิ้ง ────────
assert.equal(signedAtText(''), '')
assert.equal(signedAtText('ไม่ใช่วันที่'), '')
assert.match(signedAtText('2026-09-07T10:32:00'), /^7 กันยายน พ\.ศ\. 2569 เวลา 10\.32 น\.$/)

console.log('✓ waste-cancel-print: ผ่านทุกข้อ')

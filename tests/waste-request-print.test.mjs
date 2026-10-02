// ใบแจ้งขออนุญาตเก็บขนขยะมูลฝอย — ตรวจโหมดลงนาม 2 แบบ แบบไม่ต้องเปิดเบราว์เซอร์
//
// ล้อโครงจาก waste-cancel-print.test.mjs ที่ทำไว้ก่อน — สองใบนี้ต้องตัดสินโหมดลงนาม
// เหมือนกันเป๊ะ ถ้าวันหนึ่งกติกาเปลี่ยน ต้องเห็น FAIL ทั้งสองไฟล์พร้อมกัน
//
// รันด้วย: node tests/waste-request-print.test.mjs

import assert from 'node:assert/strict'
import { buildWasteCollectionRequestHtml } from '../src/lib/wasteCollectionRequestPrint.js'
import { thaiDateTimeText } from '../src/lib/thaiDate.js'

const TENANT = { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', org_type: 'อบต.' }

const APPLICANT = {
  title: 'นาย', first: 'สมชาย', last: 'ใจดี', age: 45, phone: '081-234-5678',
  addr_no: '99/1', addr_moo: '4',
  addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
}

function baseForm(overrides = {}) {
  return {
    form_type: 'waste_collection_request',
    form_version: 1,
    applicant: APPLICANT,
    place_type: 'บ้านพักอาศัย',
    bin_count: 1,
    collection_point: { lat: 18.258742, lng: 100.308329, address: 'บ้านทุ่งแค้ว' },
    service_start_date: '2026-10-01',
    signed_at: '2026-09-07T10:32:00',
    signed_by: { channel: 'online', name: 'นายสมชาย ใจดี' },
    ...overrides,
  }
}

function render(form, extra = {}) {
  return buildWasteCollectionRequestHtml({
    form,
    tenant: TENANT,
    thDate: '7 กันยายน พ.ศ. 2569',
    referenceNo: 'A1B2C3D4',
    signedAt: form?.signed_at ?? null,
    ...extra,
  })
}

// ── โหมดออนไลน์: พิมพ์ชื่อเป็นลายมือชื่อ ไม่เว้นช่องให้เซ็น ──────────────────
const online = render(baseForm())
assert.match(online, /<p class="signed-name">นายสมชาย ใจดี<\/p>/)
assert.match(online, /<div class="signature-typed"><\/div>/)
assert.doesNotMatch(online, /<div class="signature-space">/,
  'โหมดออนไลน์ต้องไม่เว้นช่องเซ็นปากกา ไม่งั้นได้ทั้งชื่อพิมพ์และช่องว่างซ้อนกัน')
// เจ้าของระบบสั่งตัดบรรทัด "ลงชื่อโดยการยืนยันตัวตน…เมื่อ…" ใต้ชื่อออก 2569-10-02 — ท้ายใบเหลือบรรทัดเดียว
// "ผ่านระบบ E-Service <อปท.> | เลขอ้างอิงระบบ: …" วันเวลาที่ลงชื่อไม่พิมพ์แล้ว
assert.doesNotMatch(online, /ลงชื่อโดยการยืนยันตัวตน/, 'บรรทัดลงชื่อที่สั่งตัดกลับมาแล้ว')
assert.doesNotMatch(online, /class="signed-note"/, 'บรรทัดลงชื่อที่สั่งตัดกลับมาแล้ว')
assert.match(online, /ผ่านระบบ E-Service .+ &nbsp;\|&nbsp; เลขอ้างอิงระบบ: A1B2C3D4/,
  'ท้ายใบต้องมีบรรทัดกำกับที่มาพร้อมเลขอ้างอิง')
assert.doesNotMatch(online, /7 กันยายน พ\.ศ\. 2569 เวลา 10\.32 น\./, 'วันเวลาที่ลงชื่อกลับมาแล้ว (สั่งตัด 2569-10-02)')
assert.match(online, /ผู้ขออนุญาต/)

// ── โหมดเคาน์เตอร์: เจ้าหน้าที่กรอกแทน ต้องเว้นช่องให้เซ็นด้วยปากกา ──────────
// สำคัญเชิงกฎหมาย: ประชาชนไม่ได้ยืนยันตัวตนกับระบบด้วยตัวเอง ระบบจึงอ้างว่าเขาลงชื่อไม่ได้
const counter = render(baseForm({ signed_by: { channel: 'counter', name: 'นายสมชาย ใจดี' } }))
assert.match(counter, /<div class="signature-space"><\/div>/)
assert.doesNotMatch(counter, /<p class="signed-name">/)
assert.doesNotMatch(counter, /ลงชื่อโดยการยืนยันตัวตนผ่านระบบ/)

// ── คำขอเก่าที่ยื่นก่อนมีฟีเจอร์นี้: ไม่มี signed_by ต้องตกมาที่โหมดเว้นช่องเซ็น ──
// ห้ามเดาว่า "มี user_id = ลงชื่อออนไลน์" — ระบบย้อนหลังไปอ้างการลงชื่อของคนอื่นไม่ได้
const legacy = render(baseForm({ signed_at: undefined, signed_by: undefined }))
assert.match(legacy, /<div class="signature-space"><\/div>/)
assert.doesNotMatch(legacy, /ลงชื่อโดยการยืนยันตัวตนผ่านระบบ/)

// ── ไม่มีเวลาลงชื่อ แต่ channel เป็น online: ยังพิมพ์ชื่อ แต่ตัดบรรทัดวันเวลาทิ้ง ──
const noStamp = render(baseForm({ signed_at: undefined }))
assert.match(noStamp, /<p class="signed-name">นายสมชาย ใจดี<\/p>/)
assert.match(noStamp, /ผ่านระบบ E-Service/)
assert.doesNotMatch(noStamp, /เวลา \d{2}\.\d{2} น\./,
  'ค่าเวลาเสีย/ไม่มี ต้องไม่พิมพ์ Invalid Date ลงใบราชการ')

// ── ชื่อผู้ลงนามต้องถูก escape เสมอ (ชื่อมาจากที่ประชาชนพิมพ์เอง) ─────────────
const xss = render(baseForm({
  applicant: { ...APPLICANT, first: '<script>alert(1)</script>', last: '"ใจดี"' },
  signed_by: { channel: 'online', name: 'x' },
}))
assert.doesNotMatch(xss, /<script>alert\(1\)<\/script>/)
assert.match(xss, /&lt;script&gt;/)

// ── thaiDateTimeText: ค่าเสียต้องคืนค่าว่าง ให้ผู้เรียกตัดบรรทัดกำกับทิ้ง ──────
assert.equal(thaiDateTimeText(''), '')
assert.equal(thaiDateTimeText(null), '')
assert.equal(thaiDateTimeText('ไม่ใช่วันที่'), '')
assert.match(thaiDateTimeText('2026-09-07T10:32:00'), /^7 กันยายน พ\.ศ\. 2569 เวลา 10\.32 น\.$/)

console.log('waste-request-print.test.mjs PASS')

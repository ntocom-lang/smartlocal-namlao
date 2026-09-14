// แบบคำขออนุญาตใช้น้ำประปา — ตรวจโหมดลงนาม 2 แบบ + ส่วนที่ต้องตรงกับต้นฉบับ
// แบบไม่ต้องเปิดเบราว์เซอร์
//
// ล้อโครงจาก waste-request-print.test.mjs — สามใบนี้ (ขอเก็บขนขยะ / ยกเลิกเก็บขนขยะ /
// ขอใช้น้ำประปา) ต้องตัดสินโหมดลงนามเหมือนกันเป๊ะ ถ้าวันหนึ่งกติกาเปลี่ยน ต้องเห็น FAIL
// ทั้งสามไฟล์พร้อมกัน ไม่ใช่ใบใดใบหนึ่งเงียบไป
//
// รันด้วย: node tests/water-supply-print.test.mjs

import assert from 'node:assert/strict'
import {
  buildWaterMeterChangeHtml,
  buildWaterServiceFormHtml,
  buildWaterSupplyCancelHtml,
  buildWaterSupplyRequestHtml,
  thaiDateParts,
} from '../src/lib/waterSupplyRequestPrint.js'
import { WATERWORKS_DOCUMENT_TYPES } from '../src/lib/documentTypes.js'
import { orgOfficeName } from '../src/lib/orgTerms.js'

const TENANT = {
  name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว',
  org_type: 'อบต.',
  address: '100 หมู่ที่ 1 ตำบลทุ่งแค้ว\nอำเภอหนองม่วงไข่ จังหวัดแพร่',
}

const APPLICANT = {
  title: 'นาย', first: 'สมชาย', last: 'ใจดี', age: 45, phone: '081-234-5678',
  addr_no: '99/1', addr_moo: '4',
  addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
}

function baseForm(overrides = {}) {
  return {
    form_type: 'water_supply_request',
    form_version: 1,
    applicant: APPLICANT,
    same_as_applicant: true,
    site: {
      addr_no: '99/1', addr_moo: '4',
      addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
    },
    service_start_date: '2026-10-01',
    meter_point: { lat: 18.258742, lng: 100.308329, address: 'บ้านทุ่งแค้ว' },
    meter_ack: true,
    signed_at: '2026-09-07T10:32:00',
    signed_by: { channel: 'online', name: 'นายสมชาย ใจดี' },
    ...overrides,
  }
}

function render(form, extra = {}) {
  return buildWaterSupplyRequestHtml({
    form,
    tenant: TENANT,
    docDate: '2026-09-07T10:32:00',
    referenceNo: 'A1B2C3D4',
    signedAt: form?.signed_at ?? null,
    ...extra,
  })
}

// ── หัวใบต้องตรงกับต้นฉบับ ─────────────────────────────────────────────────
const online = render(baseForm())
assert.match(online, /<div class="title">แบบคำขออนุญาตใช้น้ำประปา<\/div>/)
assert.match(online, /เขียนที่ ที่ทำการองค์การบริหารส่วนตำบลทุ่งแค้ว/,
  '"เขียนที่" ต้องเป็นชื่อสถานที่ราชการเต็ม ไม่ใช่ชื่อหน่วยงานเปล่าๆ')
assert.match(online, /100 หมู่ที่ 1 ตำบลทุ่งแค้ว/)
assert.match(online, /อำเภอหนองม่วงไข่ จังหวัดแพร่/)
assert.match(online, /เรียน<\/strong><span>นายกองค์การบริหารส่วนตำบลทุ่งแค้ว<\/span>/)

// วันที่ต้องแยกเป็น 3 ช่องตามต้นฉบับ ไม่ใช่วันที่ไทยก้อนเดียวแบบใบเก็บขนขยะ
assert.match(online, /วันที่ <span class="fill-value">7<\/span> เดือน <span class="fill-value">กันยายน<\/span> พ\.ศ\. <span class="fill-value">2569<\/span>/)

// สิ่งที่ส่งมาด้วย 3 รายการ — ต้องอยู่ครบแม้ระบบยังไม่มีช่องแนบไฟล์
assert.match(online, /สำเนาบัตรประจำตัวประชาชน/)
assert.match(online, /สำเนาทะเบียนบ้าน/)
assert.match(online, /แผนผังที่ตั้ง/)

// ประโยคที่ต้นฉบับขีดเส้นใต้ไว้ — เป็นข้อผูกพันเรื่องมาตรวัดน้ำ ห้ามหลุดการเน้น
assert.match(online, /<span class="meter-clause">ขอใช้มาตรวัดน้ำที่ทาง/)
assert.doesNotMatch(online, /ขอใช้มาตรฐานทาง/,
  'ผู้ใช้ยืนยันถ้อยคำ "มาตรวัดน้ำ" แล้ว ห้ามเพี้ยนกลับไปเป็น "มาตรฐาน"')
assert.match(online, /งานกิจการประปา/)
assert.match(online, /ยินยอมชำระเงินค่าน้ำประปาและปฏิบัติตามระเบียบข้อบังคับ/)
assert.equal((online.match(/<p class="body-copy">/g) || []).length, 3,
  'เนื้อหาหลักต้องแบ่งเป็น 3 ย่อหน้า: ข้อมูลผู้ยื่น / รายละเอียดคำขอ / ข้อตกลง')

// พิกัดจุดติดตั้งมาตร — พิมพ์เฉพาะเมื่อผู้ยื่นปักหมุดมา
assert.match(online, /จุดติดตั้งมาตรวัดน้ำตามพิกัดแผนที่/)
assert.match(online, /18\.258742, 100\.308329/)

// ── โหมดออนไลน์: พิมพ์ชื่อเป็นลายมือชื่อ ไม่เว้นช่องให้เซ็น ──────────────────
assert.match(online, /<span class="sign-signed">นายสมชาย ใจดี<\/span>/)
assert.doesNotMatch(online, /<span class="sign-line">/,
  'โหมดออนไลน์ต้องไม่เว้นช่องเซ็นปากกา ไม่งั้นได้ทั้งชื่อพิมพ์และเส้นประซ้อนกัน')
assert.match(online, /ลงชื่อโดยการยืนยันตัวตนผ่านระบบ E-Service/)
assert.equal((online.match(/E-Service/g) || []).length, 1,
  'คำว่า E-Service ต้องมีเพียงจุดเดียวใต้ช่องลงชื่อ ไม่พิมพ์ซ้ำที่ท้ายเอกสาร')
assert.match(online, /7 กันยายน พ\.ศ\. 2569 เวลา 10\.32 น\./,
  'ต้องมีวันเวลาที่ลงชื่อ ไม่งั้นบรรทัดกำกับใช้อ้างอิงย้อนหลังไม่ได้')
assert.match(online, /เลขอ้างอิง A1B2C3D4/)
assert.match(online, /ผู้ขออนุญาต/)

// ── โหมดเคาน์เตอร์: เจ้าหน้าที่กรอกแทน ต้องเว้นช่องให้เซ็นด้วยปากกา ──────────
// สำคัญเชิงกฎหมาย: ประชาชนไม่ได้ยืนยันตัวตนกับระบบด้วยตัวเอง ระบบจึงอ้างว่าเขาลงชื่อไม่ได้
const counter = render(baseForm({ signed_by: { channel: 'counter', name: 'นายสมชาย ใจดี' } }))
assert.match(counter, /<span class="sign-line">/)
assert.doesNotMatch(counter, /<span class="sign-signed">/)
assert.doesNotMatch(counter, /ลงชื่อโดยการยืนยันตัวตนผ่านระบบ/)
assert.doesNotMatch(counter, /E-Service/)

// ── คำขอเก่าที่ยื่นก่อนมีฟีเจอร์นี้: ไม่มี signed_by ต้องตกมาที่โหมดเว้นช่องเซ็น ──
const legacy = render(baseForm({ signed_at: undefined, signed_by: undefined }))
assert.match(legacy, /<span class="sign-line">/)
assert.doesNotMatch(legacy, /ลงชื่อโดยการยืนยันตัวตนผ่านระบบ/)

// ── ไม่มีเวลาลงชื่อ แต่ channel เป็น online: ยังพิมพ์ชื่อ แต่ตัดบรรทัดวันเวลาทิ้ง ──
const noStamp = render(baseForm({ signed_at: undefined }))
assert.match(noStamp, /<span class="sign-signed">นายสมชาย ใจดี<\/span>/)
assert.match(noStamp, /ลงชื่อโดยการยืนยันตัวตนผ่านระบบ E-Service/)
assert.doesNotMatch(noStamp, /เวลา \d{2}\.\d{2} น\./,
  'ค่าเวลาเสีย/ไม่มี ต้องไม่พิมพ์ Invalid Date ลงใบราชการ')

// ── ไม่ปักหมุด: ต้องไม่มีย่อหน้าพิกัดเลย ไม่ใช่พิมพ์เส้นประเปล่าทิ้งไว้ ────────
const noPin = render(baseForm({ meter_point: null }))
assert.doesNotMatch(noPin, /จุดติดตั้งมาตรวัดน้ำตามพิกัดแผนที่/)

// ── สถานที่ติดตั้งคนละที่กับที่อยู่ผู้ยื่น: ต้องพิมพ์ที่อยู่ติดตั้ง ไม่ใช่ที่อยู่ผู้ยื่นซ้ำ ──
// เคสจริงที่ต้นฉบับออกแบบมารองรับ (ขอมิเตอร์ให้บ้านที่กำลังสร้าง / แปลงเกษตร / บ้านเช่า)
const otherSite = render(baseForm({
  same_as_applicant: false,
  site: {
    addr_no: '77', addr_moo: '9',
    addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
  },
}))
assert.match(otherSite, /บริเวณที่ตั้งบ้านเลขที่ <span class="fill-value">77<\/span>/)
assert.match(otherSite, /อยู่บ้านเลขที่ <span class="fill-value">99\/1<\/span>/)

// ── ชื่อผู้ลงนามต้องถูก escape เสมอ (ชื่อมาจากที่ประชาชนพิมพ์เอง) ─────────────
const xss = render(baseForm({
  applicant: { ...APPLICANT, first: '<script>alert(1)</script>', last: '"ใจดี"' },
  signed_by: { channel: 'online', name: 'x' },
}))
assert.doesNotMatch(xss, /<script>alert\(1\)<\/script>/)
assert.match(xss, /&lt;script&gt;/)

// ที่อยู่สำนักงานก็มาจากที่แอดมินพิมพ์เอง ต้อง escape ด้วย
const xssOrg = render(baseForm(), { tenant: { ...TENANT, address: '<img src=x onerror=alert(1)>' } })
assert.doesNotMatch(xssOrg, /<img src=x/)
assert.match(xssOrg, /&lt;img src=x/)

// ── thaiDateParts: ค่าเสียต้องคืนค่าว่างทั้งสามช่อง ให้ใบพิมพ์เป็นเส้นประแทน ──
assert.deepEqual(thaiDateParts(''), { day: '', month: '', year: '' })
assert.deepEqual(thaiDateParts(null), { day: '', month: '', year: '' })
assert.deepEqual(thaiDateParts('ไม่ใช่วันที่'), { day: '', month: '', year: '' })
assert.deepEqual(thaiDateParts('2026-09-07T10:32:00'), { day: '7', month: 'กันยายน', year: '2569' })

// วันที่เสียแล้วต้องได้เส้นประ ไม่ใช่ NaN บนใบราชการ
const badDate = render(baseForm(), { docDate: 'ไม่ใช่วันที่' })
assert.doesNotMatch(badDate, /NaN|Invalid Date|undefined/)

// ── orgOfficeName: เทศบาลใช้ "สำนักงาน" ส่วน อบต./อบจ. ใช้ "ที่ทำการ" ────────
assert.equal(orgOfficeName({ name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', org_type: 'อบต.' }),
  'ที่ทำการองค์การบริหารส่วนตำบลทุ่งแค้ว')
assert.equal(orgOfficeName({ name: 'เทศบาลตำบลน้ำเลา', org_type: 'เทศบาลตำบล' }),
  'สำนักงานเทศบาลตำบลน้ำเลา')
// org_type ว่าง (ข้อมูลเก่า) ต้องตัดสินจากชื่อหน่วยงานได้เอง
assert.equal(orgOfficeName({ name: 'เทศบาลตำบลน้ำเลา' }), 'สำนักงานเทศบาลตำบลน้ำเลา')

// อปท. ที่ยังไม่ได้กรอกที่อยู่: ต้องไม่พิมพ์บรรทัดว่างหรือ "undefined" ใต้ "เขียนที่"
const noAddress = render(baseForm(), { tenant: { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', org_type: 'อบต.' } })
assert.doesNotMatch(noAddress, /undefined/)
assert.match(noAddress, /เขียนที่ ที่ทำการองค์การบริหารส่วนตำบลทุ่งแค้ว/)

// ═══ ใบ ③ เปลี่ยนมาตร / ใบ ② ยกเลิกใช้น้ำ (ต้นฉบับที่ผู้ใช้ส่งมา 2569-09-14) ═══════════════
function renderWith(build, form, extra = {}) {
  return build({
    form,
    tenant: TENANT,
    docDate: '2026-09-14T09:05:00',
    referenceNo: 'E5F6A7B8',
    signedAt: form?.signed_at ?? null,
    ...extra,
  })
}

function variantForm(formType, overrides = {}) {
  const { service_start_date: _unused, ...rest } = baseForm()
  return {
    ...rest,
    form_type: formType,
    effective_date: '2026-10-01',
    account_no: '01-0456',
    ...overrides,
  }
}

// ── ③ เปลี่ยนมาตร ─────────────────────────────────────────────────────────
const change = renderWith(buildWaterMeterChangeHtml, variantForm('water_meter_change', { reason: 'มาตรไม่หมุน' }))
assert.match(change, /<div class="title">แบบคำขอเปลี่ยนมาตรน้ำประปา<\/div>/)
assert.match(change, /เรื่อง<\/strong><span>ขออนุญาตเปลี่ยนมาตรน้ำประปา<\/span>/)
assert.match(change, /มีความประสงค์ขออนุญาตเปลี่ยนมาตรน้ำประปาของงานกิจการประปา/)
assert.match(change, /เนื่องจาก <span class="fill-value"><span class="nb">มาตรไม่หมุน<\/span><\/span>/)
assert.match(change, /ตั้งแต่วันที่ <span class="fill-value">.*1.*ตุลาคม.*2569.*<\/span> เป็นต้นไป/)
// ต้นฉบับ ③ เขียน "มาตร" เฉยๆ ต่างจากใบ ① ที่เป็น "มาตรวัดน้ำ" — ผู้ใช้สั่งให้แต่ละใบตามต้นฉบับของมัน
assert.match(change, /<span class="meter-clause">ขอใช้มาตรที่ทาง/)
assert.doesNotMatch(change, /ขอใช้มาตรวัดน้ำที่ทาง/,
  'ใบเปลี่ยนมาตรต้องใช้ถ้อยคำ "ขอใช้มาตรที่ทาง" ตามต้นฉบับ ③ ไม่ใช่ถ้อยคำของใบขอใช้น้ำ')
assert.doesNotMatch(change, /<div class="enclosure">/, 'ต้นฉบับ ③ ไม่มีรายการสิ่งที่ส่งมาด้วย ห้ามคิดขึ้นเอง')
assert.match(change, /เลขผู้ใช้น้ำ <span class="fill-value fill-value--nowrap">01-0456<\/span>/)
assert.match(change, /จุดที่ตั้งมาตรตามพิกัดแผนที่/)
assert.match(change, /<span class="sign-role">ผู้ขออนุญาต<\/span>/)
assert.equal((change.match(/<p class="body-copy">/g) || []).length, 3)

// ใบเปล่า/ไม่กรอกสาเหตุ: ต้องได้เส้นประให้เขียน ไม่ใช่ข้อความหาย
const changeBlank = renderWith(buildWaterMeterChangeHtml, variantForm('water_meter_change', { reason: '', account_no: '' }))
assert.match(changeBlank, /<span class="field-blank">เนื่องจาก&nbsp;<span class="fill-blank"/)
assert.doesNotMatch(changeBlank, /เลขผู้ใช้น้ำ/, 'ไม่กรอกเลขผู้ใช้น้ำ ต้องไม่พิมพ์บรรทัดนี้ (ต้นฉบับไม่มีช่องนี้)')

// ── ② ยกเลิกใช้น้ำ ────────────────────────────────────────────────────────
const cancel = renderWith(buildWaterSupplyCancelHtml, variantForm('water_supply_cancel'))
assert.match(cancel, /<div class="title">แบบคำขอยกเลิกใช้น้ำประปา<\/div>/)
assert.match(cancel, /เรื่อง<\/strong><span>ขอยกเลิกใช้น้ำประปา<\/span>/)
assert.match(cancel, /มีความประสงค์ขอยกเลิกการใช้น้ำประปาของงานกิจการประปา/)
assert.match(cancel, /โดยข้าพเจ้ายินยอมชำระเงินค่าน้ำประปาในรอบบิลที่ผ่านมาและปฏิบัติตามระเบียบข้อบังคับของ/)
assert.doesNotMatch(cancel, /class="meter-clause"/, 'ต้นฉบับ ② ไม่มีประโยคขีดเส้นใต้เรื่องมาตร')
assert.doesNotMatch(cancel, />เนื่องจาก|เนื่องจาก <|เนื่องจาก&nbsp;/, 'ต้นฉบับ ② ไม่มีช่อง "เนื่องจาก"')
assert.doesNotMatch(cancel, /<div class="enclosure">/)
assert.match(cancel, /<span class="sign-role">ผู้แจ้ง<\/span>/, 'ต้นฉบับ ② ลงนามเป็น "ผู้แจ้ง" ไม่ใช่ผู้ขออนุญาต')
assert.match(cancel, /เลขผู้ใช้น้ำ/)
// ย่อหน้ามีช่องว่างจากการขึ้นบรรทัดใน template ไม่ได้ — ประโยคไทยต้องต่อกันเป็นเนื้อเดียว
assert.doesNotMatch(cancel, /ยินยอม\s+ชำระ/)

// โหมดลงนามต้องตัดสินแบบเดียวกับใบ ① (ใช้ builder เดียวกัน แต่กันไว้เผื่อวันหนึ่งแยกไฟล์)
const cancelCounter = renderWith(buildWaterSupplyCancelHtml, variantForm('water_supply_cancel', {
  signed_by: { channel: 'counter', name: 'นายสมชาย ใจดี' },
}))
assert.match(cancelCounter, /<span class="sign-line">/)
assert.doesNotMatch(cancelCounter, /E-Service/)

// เลขผู้ใช้น้ำมาจากที่ประชาชนพิมพ์เอง ต้อง escape
const xssAccount = renderWith(buildWaterMeterChangeHtml, variantForm('water_meter_change', {
  reason: '<b>x</b>', account_no: '<img src=x>',
}))
assert.doesNotMatch(xssAccount, /<img src=x>|<b>x<\/b>/)

// ── ตัวเลือกใบตาม document_type ──────────────────────────────────────────────
for (const type of WATERWORKS_DOCUMENT_TYPES) {
  assert.ok(buildWaterServiceFormHtml(type, { form: variantForm(type), tenant: TENANT }).length > 0,
    `ประเภท ${type} อยู่ในลิสต์โมดูลงานประปาแต่ไม่มีใบพิมพ์`)
}
assert.equal(buildWaterServiceFormHtml('waste_collection_request', { form: {}, tenant: TENANT }), '',
  'ประเภทที่ไม่ใช่งานประปาต้องคืนค่าว่าง ห้ามตกไปพิมพ์ใบขอใช้น้ำแทน')
// ใบ ① ผ่านตัวเลือกต้องได้ผลเดียวกับเรียกตรง (หน้าเอกสารของฉันเรียกผ่านตัวเลือกแล้ว)
assert.equal(
  buildWaterServiceFormHtml('water_supply_request', { form: baseForm(), tenant: TENANT, docDate: '2026-09-07T10:32:00' }),
  buildWaterSupplyRequestHtml({ form: baseForm(), tenant: TENANT, docDate: '2026-09-07T10:32:00' }),
)

// คำนำหน้าในวงเล็บเป็นคำใบ้ให้คนกรอกด้วยปากกา ใบที่มีชื่อมาแล้วต้องไม่พิมพ์ซ้ำหน้าชื่อ
// (ผู้ใช้ระบบสั่งแก้ 2569-09-14 หลังเห็น "ข้าพเจ้า (นาย/นาง/นางสาว) นายยุทธศักดิ์" บนใบจริง
//  — กติกาเดียวกับใบขอรับการช่วยเหลือประชาชน ทั้ง 3 ใบใช้ builder เดียวจึงตรวจครบทุกใบ)
// ตัด <style> ทิ้งก่อน: คอมเมนต์ CSS อธิบายความกว้างของคำใบ้นี้ไว้ ถ้าไม่ตัดจะจับได้ลวง
const bodyOf = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '')
for (const [label, full] of [['ขอใช้น้ำ', online], ['เปลี่ยนมาตร', change], ['ยกเลิก', cancel]]) {
  const html = bodyOf(full)
  assert.doesNotMatch(html, /นาย\/นาง\/นางสาว/, `ใบ${label}ที่มีชื่อผู้ยื่นแล้วต้องไม่พิมพ์ (นาย/นาง/นางสาว)`)
  assert.match(html, /<span class="field-blank">ข้าพเจ้า&nbsp;|ข้าพเจ้า <span class="fill-value">/, `ใบ${label}ต้องยังขึ้นต้นด้วย "ข้าพเจ้า"`)
}
const noName = bodyOf(render(baseForm({ applicant: { age: 45 } })))
assert.match(noName, /ข้าพเจ้า \(นาย\/นาง\/นางสาว\)/, 'ใบที่ไม่มีชื่อต้องคงคำใบ้คำนำหน้าไว้ให้คนเขียนมือ')

console.log('water-supply-print.test.mjs PASS')

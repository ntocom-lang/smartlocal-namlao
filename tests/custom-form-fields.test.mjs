// ตัวสร้างแบบฟอร์มออนไลน์ของประเภทคำขอที่ อปท. เพิ่มเอง — ตรวจตรรกะล้วน + ใบพิมพ์ (ไม่เปิดเบราว์เซอร์)
//
// ล็อก 5 เรื่อง:
//   1. sanitizeFieldDefs ตัด/trim/ทิ้งช่องไม่ถูกต้อง และรหัสช่องไม่เปลี่ยนเมื่อแก้ชื่อ
//   2. validateCustomAnswers ครบทุกชนิดช่อง ข้อความผิดเป็นภาษาไทย
//   3. snapshot: แก้/ลบนิยามช่องทีหลัง คำขอเก่ายังอ่านถูก (customFormRows อ่านจากแถวคำขอเอง)
//   4. customFormRows ไม่ throw กับ permit_form_data รูปผิด (ผู้ยื่น guest ยิง insert ตรงใส่อะไรก็ได้)
//   5. ใบพิมพ์ escape HTML ทุกค่าจากผู้ใช้ + มี/ไม่มีช่องลงนามเจ้าหน้าที่ตามที่ส่ง signatories
// ส่วนที่ใบต้องจบ 1 แผ่นวัดด้วยเบราว์เซอร์ที่ tests/staff-sign-block.test.mjs (npm run test:staff-sign)
//
// รันด้วย: npm run test:custom-form

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CUSTOM_FIELDS_MAX, CUSTOM_HELP_MAX, CUSTOM_LABEL_MAX, CUSTOM_OPTIONS_MAX, CUSTOM_OPTION_MAX,
  CUSTOM_TEXTAREA_MAX, CUSTOM_TEXT_MAX,
  buildCustomFormData, customFormRows, customTypeFields, customTypeLabel,
  sanitizeFieldDefs, validateCustomAnswers,
} from '../src/lib/customFormFields.js'
import { buildCustomRequestHtml } from '../src/lib/customRequestPrint.js'

const TENANT = {
  name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว',
  org_type: 'อบต.',
  fee_schedule: { _custom_types: [{ value: 'custom_1', label: 'ขอใช้สถานที่', emoji: '🏛️' }] },
}
const SIGNATORIES = {
  department_head: { name: 'นายเอกชัย รินทร์ นาเหล็ง', title: 'ผู้อำนวยการกองช่าง' },
  clerk: { name: 'นายปริญญา เทียบแสน', title: 'ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว' },
  mayor: { name: 'นายกันตพงษ์ คำปลูก', title: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว' },
}

const DEFS = sanitizeFieldDefs([
  { label: 'ชื่อกิจกรรม', type: 'text', required: true },
  { label: 'รายละเอียดเพิ่มเติม', type: 'textarea', required: false, help: 'เล่าสั้นๆ' },
  { label: 'จำนวนผู้เข้าร่วม', type: 'number', required: true },
  { label: 'วันที่ใช้งาน', type: 'date', required: true },
  { label: 'ประเภทสถานที่', type: 'choice', required: true, options: ['ในอาคาร', 'นอกอาคาร'] },
  { label: 'ยอมรับเงื่อนไขการใช้สถานที่', type: 'checkbox', required: true },
])
const [fText, fArea, fNum, fDate, fChoice, fCheck] = DEFS
const GOOD = {
  [fText.id]: 'งานบุญประจำปี',
  [fNum.id]: '120.5',
  [fDate.id]: '2026-12-05',
  [fChoice.id]: 'นอกอาคาร',
  [fCheck.id]: true,
}

test('sanitizeFieldDefs: trim ตัดความยาว ทิ้งช่องที่ไม่ถูกต้อง และไม่เกิน 12 ช่อง', () => {
  assert.equal(DEFS.length, 6)
  assert.ok(DEFS.every(f => /^f_[a-z0-9]{6}$/.test(f.id)), 'รหัสช่องรูป f_xxxxxx')
  assert.equal(new Set(DEFS.map(f => f.id)).size, DEFS.length, 'รหัสไม่ซ้ำ')

  const messy = sanitizeFieldDefs([
    null, 'x', 42,
    { label: '   ', type: 'text' },                                    // ไม่มีชื่อ
    { label: 'ชนิดแปลก', type: 'file' },                              // ชนิดไม่รู้จัก
    { label: 'เลือกข้อเดียวไม่พอ', type: 'choice', options: ['ก', 'ก', ' '] }, // เหลือ 1 ข้อหลังตัดซ้ำ/ว่าง
    { label: `  ${'ก'.repeat(150)}  `, type: 'text', required: 'yes', help: ` ${'ข'.repeat(300)} ` },
    { label: 'ตัวเลือกเยอะ', type: 'choice', options: Array.from({ length: 30 }, (_, i) => ` ข้อ ${i} ${'ค'.repeat(200)}`) },
    { label: 'ไม่ใช่ choice', type: 'text', options: ['ก', 'ข'] },
  ])
  assert.equal(messy.length, 3)
  assert.equal(messy[0].label.length, CUSTOM_LABEL_MAX)
  assert.equal(messy[0].required, false, 'required ต้องเป็น true เท่านั้นถึงบังคับ')
  assert.equal(messy[0].help.length, CUSTOM_HELP_MAX)
  assert.equal(messy[1].options.length, CUSTOM_OPTIONS_MAX)
  assert.ok(messy[1].options.every(o => o.length <= CUSTOM_OPTION_MAX))
  assert.equal(messy[2].options, undefined, 'ช่องที่ไม่ใช่ choice ไม่มี options')

  const many = sanitizeFieldDefs(Array.from({ length: 20 }, (_, i) => ({ label: `ช่อง ${i}`, type: 'text' })))
  assert.equal(many.length, CUSTOM_FIELDS_MAX)
  assert.deepEqual(sanitizeFieldDefs(undefined), [])
  assert.deepEqual(sanitizeFieldDefs('abc'), [])
})

test('sanitizeFieldDefs: รหัสช่องคงเดิมเมื่อแก้ชื่อ · รหัสซ้ำ/รูปผิดถูกสุ่มใหม่', () => {
  const renamed = sanitizeFieldDefs(DEFS.map(f => ({ ...f, label: `${f.label} (แก้ชื่อ)` })))
  assert.deepEqual(renamed.map(f => f.id), DEFS.map(f => f.id))
  const dup = sanitizeFieldDefs([
    { id: 'f_abc123', label: 'ก', type: 'text' },
    { id: 'f_abc123', label: 'ข', type: 'text' },
    { id: '<script>', label: 'ค', type: 'text' },
  ])
  assert.equal(dup[0].id, 'f_abc123')
  assert.equal(new Set(dup.map(f => f.id)).size, 3)
  assert.ok(dup.every(f => /^f_[a-z0-9]{4,12}$/.test(f.id)))
})

test('customTypeFields / customTypeLabel อ่านจาก _custom_types ของ tenant', () => {
  const tenant = { fee_schedule: { _custom_types: [
    { value: 'custom_1', label: 'ขอใช้สถานที่', fields: DEFS },
    { value: 'custom_2', label: 'ไม่มีช่อง' },
  ] } }
  assert.equal(customTypeFields(tenant, 'custom_1').length, 6)
  assert.deepEqual(customTypeFields(tenant, 'custom_2'), [])
  assert.deepEqual(customTypeFields(tenant, 'custom_x'), [])
  assert.deepEqual(customTypeFields(null, 'custom_1'), [])
  assert.equal(customTypeLabel(tenant, 'custom_1'), 'ขอใช้สถานที่')
  assert.equal(customTypeLabel(tenant, 'custom_ถูกลบแล้ว'), 'บริการเพิ่มเติม', 'ประเภทถูกลบแล้วไม่โชว์รหัสดิบ')
})

test('validateCustomAnswers: คำตอบถูกต้องผ่าน', () => {
  const result = validateCustomAnswers(DEFS, GOOD)
  assert.deepEqual(result, { ok: true, errors: {} })
})

test('validateCustomAnswers: ช่องบังคับ ความยาว ตัวเลข วันที่ ตัวเลือก ติ๊กยืนยัน', () => {
  const empty = validateCustomAnswers(DEFS, {})
  assert.equal(empty.ok, false)
  assert.deepEqual(Object.keys(empty.errors).sort(), [fText.id, fNum.id, fDate.id, fChoice.id, fCheck.id].sort(),
    'ช่องบังคับครบทุกชนิด · ช่อง textarea ไม่บังคับต้องไม่ error')
  assert.ok(Object.values(empty.errors).every(m => /[ก-๙]/.test(m)), 'ข้อความผิดเป็นภาษาไทย')

  const spaces = validateCustomAnswers(DEFS, { ...GOOD, [fText.id]: '    ' })
  assert.ok(spaces.errors[fText.id], 'ช่องว่างล้วนถือว่าไม่ได้กรอก')

  assert.ok(validateCustomAnswers(DEFS, { ...GOOD, [fText.id]: 'ก'.repeat(CUSTOM_TEXT_MAX + 1) }).errors[fText.id])
  assert.equal(validateCustomAnswers(DEFS, { ...GOOD, [fText.id]: 'ก'.repeat(CUSTOM_TEXT_MAX) }).ok, true)
  assert.ok(validateCustomAnswers(DEFS, { ...GOOD, [fArea.id]: 'ก'.repeat(CUSTOM_TEXTAREA_MAX + 1) }).errors[fArea.id])
  assert.equal(validateCustomAnswers(DEFS, { ...GOOD, [fArea.id]: 'ก'.repeat(CUSTOM_TEXTAREA_MAX) }).ok, true)

  for (const bad of ['abc', '12abc', '1,000', '1e5', '--1', '.5', '5.', '١٢٣', 'Infinity', '9'.repeat(25)]) {
    assert.ok(validateCustomAnswers(DEFS, { ...GOOD, [fNum.id]: bad }).errors[fNum.id], `ตัวเลขผิดต้องไม่ผ่าน: ${bad}`)
  }
  for (const good of ['0', '12', '-3', '3.5', '007', 42]) {
    assert.equal(validateCustomAnswers(DEFS, { ...GOOD, [fNum.id]: good }).ok, true, `ตัวเลขต้องผ่าน: ${good}`)
  }

  for (const bad of ['2026-13-01', '2026-02-30', '05/12/2026', '2026-1-5', 'พรุ่งนี้']) {
    assert.ok(validateCustomAnswers(DEFS, { ...GOOD, [fDate.id]: bad }).errors[fDate.id], `วันที่ผิดต้องไม่ผ่าน: ${bad}`)
  }
  assert.equal(validateCustomAnswers(DEFS, { ...GOOD, [fDate.id]: '2028-02-29' }).ok, true, 'ปีอธิกสุรทินผ่าน')

  assert.ok(validateCustomAnswers(DEFS, { ...GOOD, [fChoice.id]: 'ใต้ดิน' }).errors[fChoice.id], 'ค่านอกตัวเลือกต้องไม่ผ่าน')
  assert.ok(validateCustomAnswers(DEFS, { ...GOOD, [fCheck.id]: false }).errors[fCheck.id])
  assert.ok(validateCustomAnswers(DEFS, { ...GOOD, [fCheck.id]: 'true' }).errors[fCheck.id], 'ต้องเป็น boolean จริง')
  assert.equal(validateCustomAnswers([], { x: 1 }).ok, true)
  assert.equal(validateCustomAnswers(DEFS, null).ok, false, 'answers เป็น null ต้องไม่ throw')
})

test('buildCustomFormData + customFormRows: ไปกลับครบ วันที่ไทย ติ๊ก/ว่าง', () => {
  const data = buildCustomFormData(DEFS, GOOD)
  assert.equal(data.custom_form.v, 1)
  assert.equal(data.custom_form.fields.length, 6)
  assert.deepEqual(data.custom_form.fields[4].options, ['ในอาคาร', 'นอกอาคาร'], 'snapshot เก็บตัวเลือกด้วย')
  assert.equal(data.custom_form.answers[fArea.id], undefined, 'ช่องไม่บังคับที่ไม่ได้กรอกไม่ลงคำตอบ')
  assert.deepEqual(Object.keys(data), ['custom_form'])

  const rows = customFormRows(data)
  assert.deepEqual(rows, [
    { label: 'ชื่อกิจกรรม', value: 'งานบุญประจำปี' },
    { label: 'รายละเอียดเพิ่มเติม', value: '—' },
    { label: 'จำนวนผู้เข้าร่วม', value: '120.5' },
    { label: 'วันที่ใช้งาน', value: '5 ธันวาคม พ.ศ. 2569' },
    { label: 'ประเภทสถานที่', value: 'นอกอาคาร' },
    { label: 'ยอมรับเงื่อนไขการใช้สถานที่', value: 'ยืนยัน' },
  ])
  const unticked = customFormRows(buildCustomFormData(DEFS, { ...GOOD, [fCheck.id]: false }))
  assert.equal(unticked[5].value, 'ไม่ได้ติ๊ก')
})

test('buildCustomFormData: เก็บเฉพาะรหัสช่องจริง บังคับชนิด/ความยาวซ้ำอีกชั้น', () => {
  const data = buildCustomFormData(DEFS, {
    ...GOOD,
    f_ghost: 'ช่องที่ไม่มีในนิยาม',
    [fArea.id]: 'ก'.repeat(5000),
    [fCheck.id]: 'true',
  })
  assert.equal(data.custom_form.answers.f_ghost, undefined)
  assert.equal(data.custom_form.answers[fArea.id].length, CUSTOM_TEXTAREA_MAX)
  assert.equal(data.custom_form.answers[fCheck.id], false, 'checkbox ที่ไม่ใช่ true จริงเก็บเป็น false')
})

test('snapshot: แก้ชื่อ/ลบช่องในนิยามทีหลัง คำขอเก่ายังอ่านตามวันที่ยื่น', () => {
  const stored = buildCustomFormData(DEFS, GOOD)
  // แอดมินแก้ชื่อช่อง ลบช่อง และเพิ่มช่องใหม่ — คำขอที่ยื่นไปแล้วไม่ได้อ้างนิยามเหล่านั้น
  const edited = sanitizeFieldDefs([
    { ...DEFS[0], label: 'ชื่องาน (ชื่อใหม่)' },
    { label: 'ช่องใหม่', type: 'text' },
  ])
  assert.equal(edited[0].id, DEFS[0].id)
  const rows = customFormRows(stored)
  assert.equal(rows[0].label, 'ชื่อกิจกรรม')
  assert.equal(rows.length, 6)
})

test('customFormRows: permit_form_data รูปผิดทุกแบบต้องไม่ throw', () => {
  const junk = [
    undefined, null, 0, 'text', [], {}, { custom_form: null }, { custom_form: 'x' }, { custom_form: {} },
    { custom_form: { fields: 'x' } }, { custom_form: { fields: [null, 5, 'a', {}, { label: 'ไม่มีชนิด' }, { label: 'ก', type: 'hack' }] } },
    { custom_form: { fields: [{ id: 'f_a', label: 'ก', type: 'text' }], answers: null } },
    { custom_form: { fields: [{ id: 'f_a', label: 'ก', type: 'text' }], answers: { f_a: { evil: 1 } } } },
    { custom_form: { fields: [{ id: '__proto__', label: 'ก', type: 'text' }], answers: {} } },
    { custom_form: { fields: [{ id: 'f_a', label: 'ก', type: 'date' }], answers: { f_a: 'ไม่ใช่วันที่' } } },
    { form_type: 'waste_collection_request', applicant: { first: 'ก' } },
  ]
  for (const item of junk) assert.doesNotThrow(() => customFormRows(item), JSON.stringify(item))
  assert.deepEqual(customFormRows({ form_type: 'waste_collection_request' }), [], 'ประเภทอื่นไม่ได้แถวเพิ่ม')
  assert.deepEqual(customFormRows({ custom_form: { fields: [{ id: 'f_a', label: 'ก', type: 'text' }], answers: { f_a: { evil: 1 } } } }),
    [{ label: 'ก', value: '—' }], 'ค่าที่ไม่ใช่สตริง/ตัวเลขแสดงเป็น —')
  const huge = { custom_form: { fields: Array.from({ length: 500 }, (_, i) => ({ id: `f_${i}`, label: 'ก', type: 'text' })), answers: {} } }
  assert.equal(customFormRows(huge).length, CUSTOM_FIELDS_MAX, 'แถวเกินเพดานถูกตัด')
})

const REQ = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  document_type: 'custom_1',
  requester_name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล',
  requester_id_card: '1234567890123',
  requester_phone: '081-234-5678',
  requester_address: '199/128 หมู่ 12 ตำบลทุ่งแค้ว',
  purpose: 'เพื่อจัดงานบุญ',
  permit_form_data: buildCustomFormData(DEFS, GOOD),
  user_id: 'u-1',
}

test('buildCustomRequestHtml: escape ทุกค่าจากผู้ใช้ ไม่มี <script> หลุด', () => {
  const evilFields = sanitizeFieldDefs([
    { label: '<script>alert("label")</script>', type: 'text', required: true },
    { label: 'เลือก', type: 'choice', options: ['<img src=x onerror=alert(1)>', 'ปกติ'] },
  ])
  const evilReq = {
    ...REQ,
    requester_name: '<script>alert("name")</script>',
    requester_address: '"><script>alert(1)</script>',
    purpose: "'; </style><script>alert(2)</script>",
    permit_form_data: buildCustomFormData(evilFields, {
      [evilFields[0].id]: '<script>alert("answer")</script> & "quote"',
      [evilFields[1].id]: '<img src=x onerror=alert(1)>',
    }),
  }
  const html = buildCustomRequestHtml({
    req: evilReq, tenant: { ...TENANT, name: '<b>อบต.ปลอม</b>' }, typeLabel: '<script>type</script>',
    thDate: '<script>date</script>', referenceNo: '<script>ref</script>',
    signatories: { ...SIGNATORIES, mayor: { name: '<script>mayor</script>', title: 'นายก' } },
    departmentName: '<script>dept</script>',
  })
  assert.equal((html.match(/<script/gi) || []).length, 0, 'ต้องไม่มีแท็ก <script> ในใบเลย')
  assert.ok(!/<img\s/i.test(html), 'ต้องไม่มี <img> จากข้อมูลผู้ใช้')
  assert.ok(!html.includes('<b>อบต.ปลอม</b>'))
  assert.ok(html.includes('&lt;script&gt;alert(&quot;answer&quot;)&lt;/script&gt; &amp; &quot;quote&quot;'))
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
})

test('buildCustomRequestHtml: ช่องลงนามเจ้าหน้าที่มีเมื่อส่ง signatories เท่านั้น · ใช้ชุดกลาง', () => {
  const staff = buildCustomRequestHtml({ req: REQ, tenant: TENANT, signatories: SIGNATORIES, departmentName: 'กองช่าง' })
  assert.match(staff, /class="staff-sign"/)
  assert.equal((staff.match(/staff-sign-cell"/g) || []).length, 3, 'ต้องมี 3 ช่อง (ผอ./ปลัด/นายก)')
  assert.ok(staff.includes('(นายเอกชัย รินทร์ นาเหล็ง)') && staff.includes('(นายกันตพงษ์ คำปลูก)'))
  assert.match(staff, /sheet--staff/)

  const citizen = buildCustomRequestHtml({ req: REQ, tenant: TENANT })
  assert.doesNotMatch(citizen, /class="staff-sign"/)

  const unset = buildCustomRequestHtml({
    req: REQ, tenant: TENANT, signatories: { department_head: null, clerk: null, mayor: null }, departmentName: 'กองช่าง',
  })
  assert.match(unset, /class="staff-sign"/, 'ยังไม่ตั้งผู้ลงนามต้องยังมีช่องเปล่าให้เวียนเซ็น')
  assert.ok(unset.includes('ผู้อำนวยการกองช่าง'))
})

test('buildCustomRequestHtml: หัวใบ ชื่อประเภท ตารางคำตอบ และไม่เขียนฟอนต์/@page เอง', () => {
  const html = buildCustomRequestHtml({ req: REQ, tenant: TENANT, thDate: '14 กันยายน 2569', referenceNo: 'A1B2C3D4', signatories: SIGNATORIES })
  assert.ok(html.includes('คำขอขอใช้สถานที่'), 'ชื่อประเภทหาจาก _custom_types ของ tenant (ไม่รวม emoji)')
  assert.ok(!html.includes('🏛️'))
  for (const text of ['ชื่อกิจกรรม', 'งานบุญประจำปี', '5 ธันวาคม พ.ศ. 2569', 'ยืนยัน', 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล', '1234567890123', 'A1B2C3D4']) {
    assert.ok(html.includes(text), `ใบต้องมี ${text}`)
  }
  // ฟอนต์/ขนาด/@page มาจาก govDocStyle เท่านั้น — ไฟล์ปลายทางต้องไม่ประกาศซ้ำ (ยกเว้นขนาด 11pt ของเลขอ้างอิง)
  assert.equal((html.match(/@page/g) || []).length, 1, '@page มีจาก govPageCss ชุดเดียว')
  assert.equal((html.match(/font-family/g) || []).length, 1, 'font-family มีจาก govDocFontCss ชุดเดียว')
  assert.equal((html.match(/font-size:\s*(?!11pt)[\d.]+pt/g) || []).length, 1, 'font-size หลักมีชุดเดียวจาก govDocFontCss (14pt)')

  const deleted = buildCustomRequestHtml({ req: { ...REQ, document_type: 'custom_ถูกลบแล้ว' }, tenant: TENANT })
  assert.ok(deleted.includes('คำขอบริการเพิ่มเติม'), 'ประเภทถูกลบแล้วใช้ "บริการเพิ่มเติม"')
})

test('buildCustomRequestHtml: ลงชื่อผู้ยื่น — ออนไลน์พิมพ์ชื่อในวงเล็บ / กรอกแทนที่เคาน์เตอร์เว้นว่าง', () => {
  const online = buildCustomRequestHtml({ req: REQ, tenant: TENANT })
  assert.ok(online.includes('(นางสาวประกายมาศ ศรีวิชัยเลิศสกุล)'))
  const counter = buildCustomRequestHtml({
    req: { ...REQ, user_id: null, created_by_uid: 'staff-1' }, tenant: TENANT,
  })
  assert.ok(!counter.includes('(นางสาวประกายมาศ ศรีวิชัยเลิศสกุล)'), 'เคาน์เตอร์ต้องเว้นวงเล็บให้เขียนมือ')
  assert.match(counter, /\(\.{4,}\)/)
})

test('customFormRows: ไม่แสดง custom_form ที่ถูกยัดใส่คำขอประเภทมาตรฐาน (กรองด้วย document_type)', () => {
  const data = { custom_form: { v: 1, fields: [{ id: 'f_aaaa11', label: 'ช่องปลอม', type: 'text' }], answers: { f_aaaa11: 'x' } } }
  assert.deepEqual(customFormRows(data, 'building_permit'), [])
  assert.deepEqual(customFormRows(data, null), [])
  assert.equal(customFormRows(data, 'custom_1731990000000').length, 1)
})

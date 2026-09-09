// ใบยืมพัสดุ/ครุภัณฑ์ (บย.) — ตรวจ "เนื้อหา HTML" แบบไม่ต้องเปิดเบราว์เซอร์
//
// คู่กับ asset-borrow-layout.test.mjs ที่วัดเลย์เอาต์จริงด้วย Playwright (ช้ากว่ามาก)
// ไฟล์นี้ตรวจสิ่งที่อ่านจากสตริงได้: ถ้อยคำตามต้นฉบับ, การเติมแถวว่างให้ครบ 7,
// การ escape, ผู้ลงนามที่ต้องมาจากทะเบียนกลางไม่ใช่ค่าตายตัวจาก PDF ต้นฉบับ
//
// รันด้วย: npm run test:asset-borrow

import assert from 'node:assert/strict'
import process from 'node:process'
import { buildAssetBorrowHtml } from '../src/lib/assetBorrowPrint.js'

const TENANT = { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', org_type: 'อบต.' }
const MUNICIPAL_TENANT = { name: 'เทศบาลตำบลน้ำเลา', org_type: 'เทศบาลตำบล' }

const FORM = {
  applicant: {
    title: 'นาย', first: 'สมชาย', last: 'ใจดี', position: 'ผู้ใหญ่บ้าน หมู่ 4',
    addr_no: '99/1', addr_moo: '4',
    addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
  },
}

function header(overrides = {}) {
  return {
    request_id: '11111111-2222-3333-4444-555555555555',
    borrower_position: 'ผู้ใหญ่บ้าน หมู่ 4',
    purpose: 'ใช้ในงานบุญประจำปีของหมู่บ้าน',
    borrow_start_date: '2026-09-09',
    return_due_date: '2026-09-11',
    form_no: '12/2569',
    ...overrides,
  }
}

function item(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    asset_code_snapshot: 'TENT-001',
    asset_name_snapshot: 'เต็นท์ผ้าใบ 4x8 เมตร',
    unit_snapshot: 'หลัง',
    requested_qty: 2, approved_qty: 2, issued_qty: 0,
    returned_qty: 0, damaged_qty: 0, lost_qty: 0,
    item_note: '',
    ...overrides,
  }
}

function render(extra = {}) {
  return buildAssetBorrowHtml({
    header: header(), items: [item()], form: FORM, tenant: TENANT,
    departmentName: 'สำนักปลัด', referenceNo: 'TESTREF1', ...extra,
  })
}

const checks = []
const check = (name, fn) => checks.push({ name, fn })

// ── ถ้อยคำตามแบบพิมพ์ต้นฉบับ ────────────────────────────────────────────────
check('หัวเรื่องและถ้อยคำความรับผิดตรงกับต้นฉบับ', () => {
  const html = render()
  assert.match(html, /ใบยืมพัสดุ\/ครุภัณฑ์/)
  assert.match(html, /ข้าพเจ้า\(ชื่อผู้ยืม\)/)
  assert.match(html, /สิ่งของตามบัญชีรายการสิ่งของที่ยืมข้างล่างนี้ไปจากส่วนราชการ/)
  assert.match(html, /ตามหลักเกณฑ์ที่กระทรวงการคลังกำหนด/)
  assert.match(html, /ได้รับสิ่งของตามรายการข้างต้นคืนในสภาพที่ใช้การได้เรียบร้อยและครบถ้วน/)
  // หัวตาราง 5 คอลัมน์ตามต้นฉบับ
  for (const col of ['ลำดับที่', 'เลขที่หรือรหัส', 'รายการ', 'จำนวน', 'หมายเหตุ']) {
    assert.match(html, new RegExp(`<th>${col}</th>`), `ไม่พบคอลัมน์ "${col}"`)
  }
})

check('ชื่อผู้ยืมในวงเล็บดึงจากคำขอ ไม่ปล่อยเป็นเส้นจุดทั้งที่รู้ชื่ออยู่แล้ว', () => {
  // ผู้ใช้ระบบถามตรงๆ 2569-09-09 ว่าทำไมช่องผู้ยืมไม่ใส่ชื่อจากระบบออนไลน์ ทั้งที่ชื่อเดียวกัน
  // ถูกพิมพ์ในย่อหน้าหัวใบอยู่แล้ว — เส้นลงนามยังต้องว่าง แต่วงเล็บใต้เส้นคือ "ชื่อผู้ที่จะมาลงนาม"
  const html = render()
  assert.match(html, /\(นาย สมชาย ใจดี\)/, 'ไม่พบชื่อผู้ยืมในวงเล็บใต้เส้นลงนาม')

  // คำขอที่ไม่มีชื่อผู้ยื่นต้องตกกลับไปเป็นเส้นจุดให้เขียนมือ ห้ามได้วงเล็บว่าง "()"
  // ⚠️ ต้องผูกกับ <span class="sign-below"> ไม่ใช่ค้น "()" ทั้งไฟล์ — คอมเมนต์ใน <style>
  // มีคำว่า signRow() อยู่ ทำให้เจอวงเล็บว่างเป็นผลบวกลวง
  const blank = render({ form: {} })
  assert.doesNotMatch(blank, /<span class="sign-below">\(\s*\)<\/span>/,
    'ไม่มีชื่อผู้ยืมแล้วได้วงเล็บว่าง แทนที่จะเป็นเส้นจุด')
  assert.match(blank, /<span class="sign-below">\(\.{10,}\)<\/span>/,
    'ไม่มีชื่อผู้ยืมแล้วต้องพิมพ์เส้นจุดไว้เขียนมือ')
})

check('ยื่นออนไลน์เองพิมพ์ชื่อบนเส้นเป็นลายมือชื่ออิเล็กทรอนิกส์ พร้อมบรรทัดกำกับ', () => {
  // กติกาเดียวกับใบน้ำประปา/ใบเก็บขนขยะ/ใบขอรับการช่วยเหลือ — ผู้ยื่นล็อกอินยืนยันตัวตนเอง
  const online = render({
    form: {
      ...FORM,
      signed_at: '2026-09-09T14:32:00+07:00',
      signed_by: { channel: 'online', name: 'นาย สมชาย ใจดี', user_id: 'u-1' },
    },
  })
  assert.match(online, /<span class="sign-signed"[^>]*>นาย สมชาย ใจดี<\/span>/,
    'ยื่นออนไลน์แล้วไม่พิมพ์ชื่อบนเส้นลงนาม')
  assert.match(online, /ลงชื่อโดยการยืนยันตัวตน/, 'ไม่มีบรรทัดกำกับการลงชื่อ')
  assert.match(online, /เลขอ้างอิง TESTREF/, 'บรรทัดกำกับไม่มีเลขอ้างอิงให้ตรวจย้อนกลับ')
  assert.match(online, /9 กันยายน พ\.ศ\. 2569 เวลา 14\.32 น\./, 'บรรทัดกำกับไม่มีวันเวลาที่ลงชื่อ')
})

check('เจ้าหน้าที่คีย์แทนต้องเว้นเส้นให้เซ็นปากกา ห้ามอ้างว่าลงชื่ออิเล็กทรอนิกส์', () => {
  // ⚠️ เคสนี้สำคัญกว่าเคส online — พิมพ์ชื่อคนที่ไม่ได้ยืนยันตัวตนลงบนเส้นลงนาม
  // คือการทำเอกสารราชการที่ระบุข้อความอันเป็นเท็จ
  for (const form of [
    { ...FORM, signed_at: '2026-09-09T14:32:00+07:00', signed_by: { channel: 'counter', name: 'นาย สมชาย ใจดี' } },
    FORM, // คำขอเก่าที่ยังไม่มี signed_by เลย
  ]) {
    const html = render({ form })
    // ⚠️ ต้องผูกกับ <span class="sign-signed" ไม่ใช่ค้นคำว่า sign-signed เฉยๆ —
    // ชื่อคลาสเดียวกันอยู่ในกฎ CSS ในบล็อก <style> เสมอ จะเป็นผลบวกลวงทุกครั้ง
    assert.doesNotMatch(html, /<span class="sign-signed"/,
      'คำขอที่ไม่ได้ยื่นออนไลน์กลับพิมพ์ชื่อบนเส้นลงนาม')
    assert.doesNotMatch(html, /ลงชื่อโดยการยืนยันตัวตน/,
      'คำขอที่ไม่ได้ยื่นออนไลน์กลับมีบรรทัดกำกับการลงชื่ออิเล็กทรอนิกส์')
  }
})

check('ช่องลงนาม 7 จุดครบ และไม่มีการพิมพ์ชื่อลงบนเส้นลงนาม', () => {
  const html = render()
  for (const role of ['ผู้ยืม', 'ผู้รับของ', 'ผู้จ่ายของ', 'ผู้ให้ยืม', 'ผู้ส่งคืน', 'ผู้รับคืน']) {
    assert.match(html, new RegExp(role), `ไม่พบช่องลงนาม "${role}"`)
  }
  // เส้นลงนามต้องว่างเสมอ — ระบบยังไม่รองรับลายมือชื่ออิเล็กทรอนิกส์ตามกฎหมาย
  // ⚠️ ต้องระบุ <span class="sign-line" ให้ครบ ไม่ใช่แค่คำว่า sign-line — กฎ CSS ชื่อเดียวกัน
  // อยู่ในบล็อก <style> ด้วย แล้ว [^>]*> จะไหลข้ามไปจับตัวอักษรไทยใน HTML ถัดไปเป็นผลบวกลวง
  assert.doesNotMatch(html, /<span class="sign-line"[^>]*>[^<]*[ก-๙]/, 'มีตัวอักษรไทยอยู่บนเส้นลงนาม')
})

// ── มาตรฐานการพิมพ์เอกสารราชการ ─────────────────────────────────────────────
check('ใช้ค่าจาก govDocStyle เท่านั้น ไม่กำหนดฟอนต์/ขอบกระดาษซ้ำ', () => {
  const html = render()
  assert.match(html, /THSarabunPSK/, 'ไม่พบฟอนต์ราชการ')
  assert.match(html, /font-size-adjust: 0\.45/, 'ไม่ได้บังคับ font-size-adjust')
  assert.match(html, /@page \{ size: A4 portrait; margin: 1\.2cm 2cm 0\.9cm 3cm; \}/,
    'ขอบกระดาษไม่ตรงมาตรฐาน A4 แนวตั้ง')
  // ต้องมี @page เดียว และ font-family เดียว (ของ govDocStyle) ไม่เขียนทับซ้ำในไฟล์ปลายทาง
  assert.equal((html.match(/@page/g) || []).length, 1, 'มี @page มากกว่าหนึ่งชุด')
  assert.equal((html.match(/font-family:/g) || []).length, 1, 'มี font-family มากกว่าหนึ่งชุด')
})

// ── ตารางต้องเติมแถวว่างให้หน้าตาเหมือนต้นฉบับ ────────────────────────────
check('ของ 1 รายการยังได้ตาราง 7 แถวเหมือนต้นฉบับ', () => {
  const html = render()
  const bodyRows = html.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g) ?? []
  assert.equal(bodyRows.length, 7, `ได้ ${bodyRows.length} แถว ต้องเป็น 7 แถวเต็มเหมือนต้นฉบับ`)
})

check('ของ 8 รายการปัดขึ้นเป็น 14 แถว หน้าสุดท้ายไม่กุด', () => {
  const items = Array.from({ length: 8 }, (_, i) => item({ asset_name_snapshot: `ของชิ้นที่ ${i + 1}` }))
  const html = render({ items })
  const bodyRows = html.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g) ?? []
  assert.equal(bodyRows.length, 14, `ได้ ${bodyRows.length} แถว ต้องปัดขึ้นเป็นเท่าของ 7`)
  // หัวตารางต้องซ้ำทุกหน้าเมื่อไหลข้ามหน้า
  assert.match(html, /thead \{ display: table-header-group; \}/)
})

check('20 รายการ (เพดานของระบบ) ได้ 21 แถว', () => {
  const items = Array.from({ length: 20 }, (_, i) => item({ asset_name_snapshot: `ของ ${i + 1}` }))
  const html = render({ items })
  const bodyRows = html.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g) ?? []
  assert.equal(bodyRows.length, 21)
})

// ── จำนวนที่พิมพ์ต้องเป็นจำนวนที่อนุมัติ ────────────────────────────────────
check('พิมพ์จำนวนที่อนุมัติ ไม่ใช่จำนวนที่ขอ', () => {
  const html = render({ items: [item({ requested_qty: 5, approved_qty: 2 })] })
  assert.match(html, /<td class="c qty">2 หลัง<\/td>/, 'ต้องพิมพ์จำนวนที่อนุมัติ (2) ไม่ใช่ที่ขอ (5)')
  assert.doesNotMatch(html, /<td class="c qty">5 หลัง<\/td>/)
})

check('ยังไม่พิจารณา (approved_qty = null) ให้พิมพ์จำนวนที่ขอไปก่อน', () => {
  const html = render({ items: [item({ requested_qty: 5, approved_qty: null })] })
  assert.match(html, /<td class="c qty">5 หลัง<\/td>/)
})

// ── ผู้ลงนามต้องมาจากทะเบียนกลาง ────────────────────────────────────────────
check('ไม่มีชื่อผู้ลงนามจาก PDF ต้นฉบับหลุดมาใน HTML', () => {
  const html = render()
  assert.doesNotMatch(html, /ภัทราพร/, 'ชื่อปลัดจาก PDF ต้นฉบับถูก hardcode ไว้')
  assert.doesNotMatch(html, /ทองหล่อ/, 'ชื่อนายกจาก PDF ต้นฉบับถูก hardcode ไว้')
  assert.doesNotMatch(html, /โป่งตาลอง/, 'ชื่อ อบต. จาก PDF ต้นฉบับถูก hardcode ไว้')
})

check('ทะเบียนผู้ลงนามว่าง ให้พิมพ์เส้นจุดไว้เขียนมือ และใช้ชื่อตำแหน่งตามประเภทหน่วยงาน', () => {
  const html = render()
  assert.match(html, /\(\.{10,}\)/, 'ไม่มีวงเล็บเส้นจุดสำหรับเขียนชื่อด้วยมือ')
  assert.match(html, /ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว/)
  assert.match(html, /นายกองค์การบริหารส่วนตำบลทุ่งแค้ว/)
})

check('เทศบาลได้ชื่อตำแหน่งของเทศบาล ไม่ใช่ อบต.', () => {
  const html = render({ tenant: MUNICIPAL_TENANT })
  assert.match(html, /ปลัดเทศบาลตำบลน้ำเลา/)
  assert.match(html, /นายกเทศมนตรีตำบลน้ำเลา/)
})

check('มีผู้ลงนามในทะเบียนแล้วพิมพ์ชื่อในวงเล็บ', () => {
  const html = render({
    clerk: { name: 'นางสมหญิง รักงาน', title: 'ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว' },
    mayor: { name: 'นายสมศักดิ์ ตั้งใจ', title: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว' },
  })
  assert.match(html, /\(นางสมหญิง รักงาน\)/)
  assert.match(html, /\(นายสมศักดิ์ ตั้งใจ\)/)
})

// ── เลข บย. ─────────────────────────────────────────────────────────────────
check('ยังไม่มีเลข บย. ให้คงเส้นจุดไว้', () => {
  const html = render({ header: header({ form_no: null }) })
  assert.match(html, /บย\.<span class="fill-blank"/, 'ต้องเป็นเส้นจุดเมื่อยังไม่มีเลข')
})

check('มีเลข บย. แล้วแยกเป็นสองช่องตามต้นฉบับ', () => {
  const html = render({ header: header({ form_no: '12/2569' }) })
  assert.match(html, /บย\.<span class="fill-value">12<\/span>\/<span class="fill-value">2569<\/span>/)
})

// ── หมายเหตุของชำรุด/สูญหาย ─────────────────────────────────────────────────
check('ของครบดีไม่มีกล่องหมายเหตุ (ใบเหมือนต้นฉบับเป๊ะ)', () => {
  const html = render({ items: [item({ issued_qty: 2, returned_qty: 2 })] })
  // ต้องเช็คที่ตัว <div> ไม่ใช่ชื่อคลาส — กฎ .note-damage อยู่ในบล็อก CSS ของทุกใบเสมอ
  assert.doesNotMatch(html, /<div class="note-damage">/)
  assert.doesNotMatch(html, /ของที่ส่งคืนไม่ครบถ้วน/)
})

check('มีของหายจึงขึ้นกล่องหมายเหตุ เพราะข้อความต้นฉบับใช้ไม่ได้แล้ว', () => {
  const html = render({
    items: [item({
      issued_qty: 2, returned_qty: 1, lost_qty: 1,
      settlement_note: 'ชดใช้เป็นเงิน 1,200 บาท',
    })],
  })
  assert.match(html, /ของที่ส่งคืนไม่ครบถ้วนตามข้อความข้างต้น/)
  assert.match(html, /สูญหาย 1 หลัง/)
  assert.match(html, /ชดใช้เป็นเงิน 1,200 บาท/)
})

// ── ความปลอดภัย ─────────────────────────────────────────────────────────────
check('escape ข้อมูลผู้ใช้และชื่อ tenant ทุกช่อง', () => {
  const html = render({
    tenant: { name: '<script>alert(1)</script>', org_type: 'อบต.' },
    departmentName: '<img src=x onerror=alert(2)>',
    header: header({ purpose: '"><b>ปลอม</b>' }),
    items: [item({ asset_name_snapshot: '<script>x</script>', item_note: '<b>y</b>' })],
    clerk: { name: '<i>ชื่อ</i>', title: '<u>ตำแหน่ง</u>' },
  })
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  assert.doesNotMatch(html, /<img src=x onerror/)
  assert.doesNotMatch(html, /<b>ปลอม<\/b>/)
  assert.doesNotMatch(html, /<script>x<\/script>/)
  assert.doesNotMatch(html, /<i>ชื่อ<\/i>/)
  assert.match(html, /&lt;script&gt;/)
})

check('ชื่อไทยยาวและชื่อหน่วยงานกลางย่อหน้าไม่ถูกตัดกลางคำ', () => {
  const html = render()
  // ชื่อหน่วยงานกลางย่อหน้าต้องถูกครอบ nb ทีละส่วน (คำนำหน้า + ชื่อท้องถิ่น)
  assert.match(html, /<span class="nb">องค์การบริหารส่วนตำบล<\/span><span class="nb">ทุ่งแค้ว<\/span>/)
})

check('ไม่มี undefined หรือ null หลุดลงใบ', () => {
  const html = render({
    header: header({ borrower_position: null, form_no: null }),
    form: { applicant: {} },
    items: [item({ asset_code_snapshot: null, item_note: null })],
    departmentName: '',
  })
  assert.doesNotMatch(html, /undefined/)
  assert.doesNotMatch(html, />null</)
})

let failed = 0
for (const { name, fn } of checks) {
  try { fn(); console.log(`  ✓ ${name}`) } catch (error) {
    failed += 1
    console.log(`  ✗ ${name}\n    ${error.message}`)
  }
}
console.log(failed === 0 ? `\n✅ ผ่านทั้ง ${checks.length} ข้อ` : `\n❌ ไม่ผ่าน ${failed}/${checks.length} ข้อ`)
process.exit(failed === 0 ? 0 : 1)

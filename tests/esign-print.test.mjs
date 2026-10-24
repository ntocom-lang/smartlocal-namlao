// ใบพิมพ์ที่ลงนามออนไลน์ (ชุด S4): แบบ ๓ ใบขออนุญาตใช้รถ + แบบ สก. ๑ — ตรวจเนื้อหา HTML แบบไม่เปิดเบราว์เซอร์
//   node tests/esign-print.test.mjs   (เลย์เอาต์/จบ 1 หน้าดู tests/fleet-form3-layout.test.mjs และ tests/fleet-sk1-print.test.mjs)
//
// กติกาที่เทสต์นี้คุม:
//   1. ใบที่ "ไม่ใช่โหมดออนไลน์" ต้องได้ HTML เหมือนเดิมทุกไบต์ (เทียบ sha256 ของค่าที่เก็บก่อนแก้) — อปท. ที่ไม่เปิดใช้ต้องไม่เห็นอะไรเปลี่ยน
//   2. ช่องที่ลงนามออนไลน์แล้วได้ภาพ/ข้อความบนเส้น + ชื่อจากลายเซ็นจริง + วันที่จริง · ช่องเซ็นสดคงเส้นว่าง
//   3. ✓ อนุมัติ ของช่องผู้มีอำนาจออนไลน์ตัดสินจากลายเซ็น "อนุมัติ" เท่านั้น (ไม่ใช่ approved_by)
//   4. เนื้อหาไม่ตรงกับที่ลงนาม = ไม่แสดงภาพ ไม่ติ๊กอนุมัติ และมีคำเตือน · ข้อมูลจากฐานข้อมูลถูก escape/กรองก่อนฝังใน HTML
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { buildFleetSk1Html, buildFleetTripRequestHtml } from '../src/lib/fleetTripPrint.js'
import { esignApprovedMark, esignEvidenceHtml, esignPrintData, esignSignatureImg, esignValidSlot, esignVerifyUrl } from '../src/lib/esignPrint.js'
import { goldenInputs } from './lib/esignPrintGolden.mjs'
import { PNG, VERIFY_CODE, deptHead, fullStatus, onlineTrip, orderAuthority, signature, slotStatus, stampsFor, tenant, trip } from './lib/esignPrintFixtures.mjs'

const sha = text => crypto.createHash('sha256').update(text).digest('hex')
let cases = 0
const test = (label, run) => { run(); cases++; console.log('PASS ' + label) }

// ค่าที่เก็บไว้ก่อนแก้ตัวสร้างใบ (node tests/lib/esignPrintGolden.mjs บนโค้ดก่อน S4)
const GOLDEN = {
  form3Full: '02f0099b49988bc043d29c3e6c6a17854790182b32a80d9ee80ceb95a3962f9f',
  form3Blank: '7f187d187a2ef2d177468aba37fae88c8115adf1a0c540c283a8a82dbcb4b087',
  form3Rejected: '57fb69870aacb06fecbd31c76e58c4874a739702377688b9bde69f90eac881c3',
  sk1: '9965afa8516b2c8d0e033e92907ce09635b9d5261d72f80d504f85198f4c3661',
}

const build = (status, stamps, extra = {}) => esignPrintData({ status, stamps, verifyCode: VERIFY_CODE, origin: 'https://demo.example.go.th', ...extra })
const form3 = esign => buildFleetTripRequestHtml({ trip: onlineTrip, tenant, orderAuthority, deptHead, esign })
const body = html => html.slice(html.indexOf('<body>'))

test('ใบที่ไม่ใช่โหมดออนไลน์ (ไม่ส่ง esign) ได้ HTML เหมือนเดิมทุกไบต์ — แบบ ๓ ทั้งสามสถานะ + สก.๑', () => {
  for (const [name, build] of Object.entries(goldenInputs)) assert.equal(sha(build()), GOLDEN[name], `${name}: HTML เปลี่ยนไปจากเดิม — ใบที่ไม่ใช่โหมดออนไลน์ต้องไม่เปลี่ยน`)
  // ส่ง esign เป็น null/undefined ชัดๆ ก็ต้องเหมือนกัน
  assert.equal(sha(buildFleetTripRequestHtml({ trip, tenant, orderAuthority, deptHead, esign: null })), GOLDEN.form3Full)
  // ส่งข้อมูลออนไลน์ที่ไม่มีช่อง sk1 ให้ใบ สก.๑ → ใบเดิม (sk1 เซ็นสด ใบนี้ไม่เกี่ยว)
  const sk1Trip = { ...trip, returned_at: '2026-09-01T09:30:00.000Z' }
  assert.equal(sha(buildFleetSk1Html({ trip: sk1Trip, tenant, esign: build(fullStatus(), stampsFor(['requester'])) })), GOLDEN.sk1)
})

test('esignPrintData: ไม่ใช่โหมดออนไลน์/อ่านสถานะไม่ได้ = null · เก็บเฉพาะช่องออนไลน์ที่เข้าเงื่อนไข · ภาพเฉพาะช่องที่ลงนามและเนื้อหาตรง', () => {
  assert.equal(esignPrintData({ status: null, stamps: null }), null)
  assert.equal(esignPrintData({ status: { found: false } }), null)
  assert.equal(esignPrintData({ status: { found: true, mode: 'wet', slots: [] } }), null)
  const data = build(fullStatus(), stampsFor(['requester', 'authority']))
  assert.deepEqual(Object.keys(data.slots), ['requester', 'dept_head', 'authority'], 'ช่องเซ็นสด (sk1) ไม่อยู่ในข้อมูล')
  assert.equal(data.url, `https://demo.example.go.th/v/${VERIFY_CODE}`)
  assert.equal(data.complete, true)
  assert.equal(data.modified, false)
  assert.ok(data.slots.requester.image?.png === PNG)
  assert.equal(data.slots.dept_head.image, null, 'ช่องที่ไม่ได้แนบภาพไม่มีภาพ')
  assert.equal(data.slots.authority.signerName, 'นายนายก ทดสอบ')
  // ช่องที่ยังไม่ลงนาม: มีในข้อมูล (signed false) แต่ไม่มีชื่อ/ภาพ
  const partial = build(fullStatus({ complete: false, slots: [slotStatus('requester', { signed: true, signature: signature('ผู้ขอ') }), slotStatus('dept_head'), slotStatus('authority')] }), stampsFor(['requester', 'dept_head']))
  assert.equal(partial.slots.dept_head.signed, false)
  assert.equal(partial.slots.dept_head.image, null)
  // ภาพที่ base64 ผิดรูป (อาจพา HTML แปลกปลอมเข้า src) ถูกทิ้ง
  const evil = build(fullStatus(), { ok: true, items: [{ slot: 'requester', png_base64: '"><script>alert(1)</script>', width: 1, height: 1 }] })
  assert.equal(evil.slots.requester.image, null)
  // ดึงภาพไม่สำเร็จ (ok:false) = ไม่มีภาพ แต่ใบยังพิมพ์ได้ด้วยข้อความ "ลงนามออนไลน์"
  assert.equal(build(fullStatus(), { ok: false, code: 'error' }).slots.requester.image, null)
  assert.equal(esignVerifyUrl('https://x.go.th/', VERIFY_CODE), `https://x.go.th/v/${VERIFY_CODE}`)
  assert.equal(esignVerifyUrl('https://x.go.th', 'not-a-code'), '')
})

test('แบบ ๓ ลงนามครบ: ภาพบนเส้นช่องที่แนบ · ข้อความ "ลงนามออนไลน์" ช่องที่ไม่แนบ · ชื่อ/ตำแหน่ง/วันที่จากลายเซ็น · ช่องผู้ขับรถคงเส้นว่าง', () => {
  const html = form3(build(fullStatus(), stampsFor(['requester', 'authority'])))
  const page = body(html)
  assert.equal((page.match(/<img class="esign-img"/g) ?? []).length, 2, 'ภาพ 2 ช่อง (ผู้ขอ + ผู้มีอำนาจ)')
  assert.ok(page.includes(`src="data:image/png;base64,${PNG}"`))
  assert.equal((page.match(/class="esign-typed">ลงนามออนไลน์</g) ?? []).length, 1, 'ผอ.กองไม่ได้แนบภาพ → ข้อความแทน')
  for (const expected of ['(นางสาวผู้ขอ ทดสอบ)', '(นางผอ. กองทดสอบ)', '(นายนายก ทดสอบ)']) assert.ok(page.includes(expected), `ไม่มีชื่อ ${expected}`)
  // ป้ายบทบาท/ตำแหน่งใช้ "ตำแหน่งที่ลงนาม" จากลายเซ็นจริง ไม่ใช่ป้ายกลาง/ทะเบียนที่อาจเปลี่ยนไปแล้ว
  assert.ok(page.includes('ผู้อำนวยการกองช่าง') && !page.includes('ผู้อำนวยการกองสาธารณสุขและสิ่งแวดล้อม'), 'ป้ายผอ.กองต้องมาจากลายเซ็น')
  assert.ok(page.includes('นายกเทศมนตรีตำบลสาธิต'))
  // วันที่ใต้ลายเซ็น (เวลาไทย ๒๓ ต.ค. ๒๕๖๙) แทนเส้นประของ ผอ.กอง/ผู้มีอำนาจ
  assert.equal((page.match(/signature-line is-filled">23 ตุลาคม 2569</g) ?? []).length, 2, 'วันที่ ผอ.กอง + ผู้มีอำนาจ')
  // ช่องผู้ขับรถเซ็นสดเสมอ: ชื่อพิมพ์ + เส้นว่าง ไม่มีภาพ
  // slice(1): ก่อนบล็อกแรกคือส่วนหัวใบ (ในคอมเมนต์ HTML ก็มีคำว่า "ผู้ขับรถ")
  const driver = page.split(/<div class="signature(?: signature--acting)?">/).slice(1).find(block => block.includes('ผู้ขับรถ'))
  assert.ok(driver, 'ไม่พบบล็อกผู้ขับรถ')
  assert.ok(driver.includes('(นายสมศักดิ์ ขับเคลื่อนยานยนต์)') && !driver.includes('esign-img') && !driver.includes('esign-typed'))
  // เส้นหลักฐานท้ายใบ: เวลาลงนามรายช่อง + ลิงก์ตรวจสอบ + QR
  assert.ok(page.includes('ลงนามออนไลน์ผ่านระบบ: ผู้ขออนุญาต 23 ต.ค. 2569 11:00 น. · ผอ.กอง 23 ต.ค. 2569 12:30 น. · ผู้มีอำนาจ 23 ต.ค. 2569 13:45 น.'))
  assert.ok(page.includes(`demo.example.go.th/v/${VERIFY_CODE}`) && page.includes('class="esign-evidence__qr"') && page.includes('<path'))
  assert.ok(!page.includes('ยังไม่ลงนามออนไลน์'), 'ลงนามครบแล้วไม่ต้องบอกว่ายังขาด')
  assert.ok(!page.includes('เนื้อหาของใบนี้ไม่ตรง'))
})

test('✓ อนุมัติ ของแบบ ๓ ออนไลน์ตัดสินจากลายเซ็น "อนุมัติ" — ไม่ใช้ approved_by · ยังไม่ลงนาม/ถอน/ไม่ตรง = ไม่ติ๊ก · ปฏิเสธไม่ติ๊กซ้อน', () => {
  const mark = esign => /\((✓|&nbsp;)\) อนุมัติ/.exec(form3(esign))?.[1]
  // ทริปออนไลน์ถูกอนุมัติคิวอัตโนมัติ (approved_by ว่าง) แต่ผู้มีอำนาจลงนามอนุมัติแล้ว → ติ๊ก
  assert.equal(onlineTrip.approved_by, null)
  assert.equal(mark(build(fullStatus(), stampsFor([]))), '✓')
  // ผู้มีอำนาจยังไม่ลงนาม → ไม่ติ๊ก แม้ทริปมี approved_by (เกณฑ์เดิมจะติ๊ก)
  const unsigned = fullStatus({ complete: false, slots: [slotStatus('requester', { signed: true, signature: signature('ผู้ขอ') }), slotStatus('dept_head'), slotStatus('authority')] })
  const withApprover = buildFleetTripRequestHtml({ trip: { ...onlineTrip, approved_by: 'x', approver: { full_name: 'ผู้ดูแลรถ' } }, tenant, orderAuthority, deptHead, esign: build(unsigned, stampsFor([])) })
  assert.ok(/\(&nbsp;\) อนุมัติ/.test(withApprover) && !/\(✓\) อนุมัติ/.test(withApprover), 'ช่องผู้มีอำนาจออนไลน์ยังไม่ลงนาม ต้องไม่ติ๊กจาก approved_by')
  // ลงนามด้วยการ "ลงนาม" ธรรมดา (ไม่ใช่ approve) → ไม่ติ๊ก
  const plainSign = fullStatus({ slots: fullStatus().slots.map(slot => (slot.slot === 'authority' ? { ...slot, signature: signature('นายก', { decision: 'sign' }) } : slot)) })
  assert.equal(mark(build(plainSign, stampsFor([]))), '&nbsp;')
  // ทริปถูกปฏิเสธภายหลัง: ✓ ไม่ซ้อนกับ ไม่อนุมัติ
  const rejected = buildFleetTripRequestHtml({ trip: { ...onlineTrip, status: 'rejected', reject_reason: 'ไม่มีรถ' }, tenant, orderAuthority, deptHead, esign: build(fullStatus(), stampsFor([])) })
  assert.ok(/\(&nbsp;\) อนุมัติ/.test(rejected) && /\(✓\) ไม่อนุมัติ/.test(rejected))
  // ช่องผู้มีอำนาจเป็นเซ็นสด (ไม่มีในข้อมูลออนไลน์) → ใช้เกณฑ์เดิมเหมือนทริปทั่วไป
  const wetAuthority = fullStatus({ slots: fullStatus().slots.filter(slot => slot.slot !== 'authority') })
  const legacy = buildFleetTripRequestHtml({ trip: { ...onlineTrip, approved_by: 'x', approver: { full_name: 'ผู้ดูแลรถ' } }, tenant, orderAuthority, deptHead, esign: build(wetAuthority, stampsFor([])) })
  assert.ok(/\(✓\) อนุมัติ/.test(legacy), 'ผู้มีอำนาจเซ็นสด ใช้เกณฑ์เดิม (approved_by + สถานะ)')
  assert.equal(esignApprovedMark(null), null)
})

test('ลงนามไม่ครบ: ช่องที่ยังไม่ลงนามคงเส้นว่าง + บอกท้ายใบว่ายังขาดช่องไหน (เซ็นสดต่อได้)', () => {
  const partial = fullStatus({ complete: false, slots: [slotStatus('requester', { signed: true, signature: signature('นางสาวผู้ขอ ทดสอบ') }), slotStatus('dept_head'), slotStatus('authority')] })
  const page = body(form3(build(partial, stampsFor(['requester']))))
  assert.equal((page.match(/<img class="esign-img"/g) ?? []).length, 1)
  assert.ok(page.includes('ยังไม่ลงนามออนไลน์: ผอ.กอง · ผู้มีอำนาจ (เซ็นสดต่อบนใบนี้ได้)'))
  // ช่องผู้มีอำนาจที่ยังไม่ลงนาม: ชื่อ/ตำแหน่งจากทะเบียนเหมือนเดิม ไม่มีวันที่
  assert.ok(page.includes('(นายสมนึก ธนเดชากุล)') && page.includes('นายกเทศมนตรีตำบลสาธิต'))
  assert.equal((page.match(/signature-line is-filled/g) ?? []).length, 0)
})

test('เนื้อหาไม่ตรงกับที่ลงนาม: ไม่แสดงภาพ ไม่ติ๊กอนุมัติ มีคำเตือนท้ายใบ', () => {
  const tampered = fullStatus({ slots: fullStatus().slots.map(slot => (slot.slot === 'authority' ? { ...slot, signature: signature('นายก', { decision: 'approve', content_matches: false }) } : slot)) })
  const data = build(tampered, stampsFor(['requester', 'authority']))
  assert.equal(data.modified, true)
  assert.equal(data.slots.authority.image, null)
  assert.equal(esignValidSlot(data, 'authority'), null)
  const html = form3(data)
  assert.ok(html.includes('เนื้อหาของใบนี้ไม่ตรงกับที่ลงนามไว้ — ห้ามใช้ใบนี้'))
  assert.ok(/\(&nbsp;\) อนุมัติ/.test(html), 'ลายเซ็นที่เนื้อหาไม่ตรงห้ามนับเป็นอนุมัติ')
  assert.equal((body(html).match(/<img class="esign-img"/g) ?? []).length, 1, 'เหลือเฉพาะช่องผู้ขอที่ยังตรง')
})

test('ข้อมูลจากฐานข้อมูลถูก escape: ชื่อ/ตำแหน่งที่มี HTML ไม่หลุดเป็นแท็ก', () => {
  const hostile = fullStatus({ slots: fullStatus().slots.map(slot => (slot.slot === 'requester' ? { ...slot, signature: signature('<b>x</b>"&', { signed_as: '<i>y</i>' }) } : slot)) })
  const html = form3(build(hostile, stampsFor(['requester'])))
  assert.ok(!html.includes('<b>x</b>') && html.includes('&lt;b&gt;x&lt;/b&gt;&quot;&amp;'))
  assert.ok(html.includes('alt="ลายมือชื่อของ &lt;b&gt;x&lt;/b&gt;&quot;&amp;"'))
  assert.equal(esignSignatureImg({ image: null, signerName: 'x' }), '')
})

test('แบบ สก. ๑ ช่อง sk1 ออนไลน์: ภาพบนเส้น · ชื่อ/ตำแหน่ง/วันที่จากลายเซ็น · หลักฐานท้ายใบเฉพาะช่อง sk1 · ไม่ติดช่องของแบบ ๓', () => {
  const status = fullStatus({ slots: [slotStatus('requester', { signed: true, signature: signature('นายก ผู้ขอ') }), slotStatus('sk1', { signed: true, signature: signature('นายกเทศมนตรีทดสอบ', { signed_as: 'นายกเทศมนตรีตำบลสาธิต', signed_at: '2026-10-24T03:00:00Z' }) })] })
  const esign = build(status, stampsFor(['sk1', 'requester']))
  const html = buildFleetSk1Html({ trip: { ...trip, returned_at: '2026-10-24T02:00:00.000Z' }, tenant, esign })
  const page = body(html)
  assert.equal((page.match(/<img class="esign-img"/g) ?? []).length, 1, 'ภาพช่อง sk1 ภาพเดียว (ภาพช่องผู้ขอของแบบ ๓ ไม่มาปน)')
  assert.ok(page.includes('class="sign-line">&nbsp;<img class="esign-img"'), 'ภาพอยู่ในเส้นลงนามของ govSignRow')
  assert.ok(page.includes('(นายกเทศมนตรีทดสอบ)') && page.includes('นายกเทศมนตรีตำบลสาธิต'))
  assert.ok(page.includes('วันที่ 24 เดือน ตุลาคม ปี 2569'))
  assert.ok(page.includes('ลงนามออนไลน์ผ่านระบบ: ผู้บริหารท้องถิ่น 24 ต.ค. 2569 10:00 น.') && !page.includes('ผู้ขออนุญาต 2'))
  assert.ok(page.includes(`v/${VERIFY_CODE}`) && page.includes('esign-evidence__qr'))
  // ไม่แนบภาพ → ข้อความแทน
  const noImage = buildFleetSk1Html({ trip, tenant, esign: build(status, stampsFor([])) })
  assert.ok(noImage.includes('class="esign-typed">ลงนามออนไลน์<'))
})

test('esignEvidenceHtml: ไม่มีข้อมูล/ไม่มีช่องที่เกี่ยวข้อง = ว่าง · ไม่มีลิงก์ (ไม่มีรหัส) = ไม่มี QR', () => {
  const fmt = iso => iso
  assert.equal(esignEvidenceHtml(null, fmt), '')
  assert.equal(esignEvidenceHtml(build(fullStatus(), stampsFor([])), fmt, { only: ['sk1'] }), '')
  const noCode = build(fullStatus({ verify_code: '' }), stampsFor([]), { verifyCode: '' })
  assert.equal(noCode.url, '')
  const html = esignEvidenceHtml(noCode, fmt)
  assert.ok(!html.includes('<svg') && !html.includes('ตรวจสอบความถูกต้อง'))
})

console.log(`\nผ่านทั้งหมด ${cases} กรณี`)

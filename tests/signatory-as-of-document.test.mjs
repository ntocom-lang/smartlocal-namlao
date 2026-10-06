// ผู้ลงนามบนเอกสารที่พิมพ์ซ้ำ — เรื่องที่เสร็จแล้วล็อกชื่อคนที่ดำรงตำแหน่งตอนเสร็จ เรื่องที่ค้างใช้คนปัจจุบัน
//
// เจ้าของระบบแจ้ง 2569-10-06: เปลี่ยนปลัดวันนี้ แต่คำร้องเก่าที่พิมพ์ซ้ำเปลี่ยนเป็นชื่อปลัดคนใหม่ทุกใบ
// คำสั่ง: "เปลี่ยนตอนไหนก็ใช้ตั้งแต่ตอนนั้น อย่ายุ่งของเก่า ชื่อใครชื่อมัน"
//   และ "เรื่องที่ยังไม่เสร็จวันนี้ใช้ชื่อคนใหม่ เพราะคนเก่าออกไปแล้ว กลับมาลงชื่อไม่ได้"
//
// กติกาอยู่ 2 ที่ที่ต้องตรงกัน: pickSignatory(..., { at }) ใน src/lib/documentSignatories.js (ใบที่หน้าเว็บประกอบเอง)
// และ prepare_complaint_print ฝั่งฐานข้อมูล (ใบคำร้อง) — เทสต์นี้ล็อกฝั่ง JS + ตรวจว่าทุกจุดพิมพ์ส่งเวลาที่ถูกต้อง
// ส่วนความตรงกันกับ SQL ตรวจกับข้อมูลจริงแบบอ่านอย่างเดียวตอนทำงานนี้ (120/120 เคสตรงกัน)
//
// รันด้วย: npm run test:signatory-as-of

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  defaultVehicleAuthority, isSignatoryActiveToday, organizationSignatories, pickSignatory,
  signatoryMoment, signatoryName,
} from '../src/lib/documentSignatories.js'
import { bookingLetterMoment } from '../src/lib/patientBooking.js'
import { resolvePatientRequestSignatories } from '../src/lib/patientRequestSignatories.js'

const results = []
function check(name, run) {
  try {
    run()
    results.push(`PASS ${name}`)
  } catch (error) {
    results.push(`FAIL ${name}: ${error?.message ?? error}`)
  }
}

// แถวรูปแบบเดียวกับที่ SIGNATORY_REGISTRY_SELECT คืนมา (เวลาเป็น ISO แบบ PostgREST)
const row = (name, role, createdAt, extra = {}) => ({
  signatory_role: role, department_id: null, custom_label: null, is_vehicle_order_default: false,
  is_active: true, created_at: createdAt, updated_at: createdAt,
  manual_name: name, title_override: null, effective_from: createdAt.slice(0, 10), effective_to: null, profile: null,
  ...extra,
})

// เหตุการณ์จริงที่น้ำเลา: ปลัดคนเดิมตั้งไว้ 2569-08-30 เปลี่ยนเป็นคนใหม่ 2569-10-06 08:54 น. (01:54 UTC)
const CHANGE = '2026-10-06T01:54:00.123456+00:00'
const OLD_CLERK = row('ปลัดคนเดิม', 'clerk', '2026-08-30T13:39:00.288266+00:00', { is_active: false, updated_at: CHANGE })
const NEW_CLERK = row('ปลัดคนใหม่', 'clerk', CHANGE)
const MAYOR = row('นายกฯ', 'mayor', '2026-08-30T13:39:00+00:00')
const REGISTRY = [NEW_CLERK, MAYOR, OLD_CLERK]
const nameAt = (rows, at, options = { role: 'clerk' }) => signatoryName(pickSignatory(rows, { ...options, at }))
// ชื่อปลัดบนใบที่พิมพ์วันนี้ ของเรื่องที่ "เสร็จเมื่อ finishedAt" (null = ยังไม่เสร็จ)
const clerkOnPrint = finishedAt => nameAt(REGISTRY, signatoryMoment({ finishedAt }))

check('เคสที่เจ้าของระบบแจ้ง: เรื่องที่ยื่นก่อนเปลี่ยนแต่ยังไม่เสร็จ พิมพ์วันนี้ต้องได้ปลัดคนใหม่', () => {
  assert.equal(clerkOnPrint(null), 'ปลัดคนใหม่', 'คนเก่าออกไปแล้ว กลับมาลงชื่อไม่ได้')
})

check('เรื่องที่เสร็จก่อนเปลี่ยนคงชื่อเดิม เสร็จหลังเปลี่ยนได้คนใหม่ (ละเอียดถึงวินาที ไม่ใช่รายวัน)', () => {
  assert.equal(clerkOnPrint('2026-10-05T03:00:00Z'), 'ปลัดคนเดิม', 'ปิดเมื่อวาน')
  assert.equal(clerkOnPrint('2026-10-06T01:53:59Z'), 'ปลัดคนเดิม', 'ปิดเช้าวันเดียวกันก่อน 08:54')
  assert.equal(clerkOnPrint('2026-10-06T01:54:01Z'), 'ปลัดคนใหม่', 'ปิดหลัง 08:54')
  assert.equal(nameAt(REGISTRY, '2026-09-15T03:00:00Z', { role: 'mayor' }), 'นายกฯ', 'ช่องที่ไม่ได้เปลี่ยนต้องไม่กระทบ')
})

check('ไม่ส่ง at = ผู้ลงนามวันนี้ (ตัวเลือกฟอร์มใหม่ / รายงานที่ออกตอนพิมพ์) และไม่หยิบแถวที่ปิดแล้ว', () => {
  // แถวเก่าอยู่ก่อนในอาร์เรย์โดยตั้งใจ — .find แบบเดิมจะหยิบคนเก่าถ้าไม่ตัด is_active
  assert.equal(signatoryName(pickSignatory([OLD_CLERK, NEW_CLERK], { role: 'clerk' })), 'ปลัดคนใหม่')
  assert.equal(isSignatoryActiveToday(OLD_CLERK), false)
  assert.equal(isSignatoryActiveToday(NEW_CLERK), true)
  assert.equal(isSignatoryActiveToday({ ...NEW_CLERK, is_active: undefined }), true, 'select ที่ไม่ได้ดึง is_active ถือว่ายังใช้อยู่')
})

check('เรื่องที่เสร็จก่อนเริ่มตั้งทะเบียน = ผู้ลงนามคนแรกของช่องนั้น', () => {
  assert.equal(clerkOnPrint('2026-07-15T03:00:00Z'), 'ปลัดคนเดิม')
})

check('updated_at ของแถวที่ปิดแล้วถูกแตะทีหลัง ต้องยังหมดผลตอนมีคนใหม่มาแทน', () => {
  const bumped = { ...OLD_CLERK, updated_at: '2026-11-01T00:00:00+00:00' }
  assert.equal(nameAt([bumped, NEW_CLERK], '2026-10-10T03:00:00Z'), 'ปลัดคนใหม่')
  assert.equal(nameAt([bumped, NEW_CLERK], '2026-10-01T03:00:00Z'), 'ปลัดคนเดิม')
  // คนใหม่ถูกลบออกทีหลัง — ช่วงหลังลบต้องว่าง ห้ามคนเดิม (ที่ updated_at ถูกแตะ) กลับมาโผล่แทน
  const newCleared = { ...NEW_CLERK, is_active: false, updated_at: '2026-10-20T00:00:00+00:00' }
  assert.equal(pickSignatory([bumped, newCleared], { role: 'clerk', at: '2026-10-25T03:00:00Z' }), null)
})

check('ลบผู้ลงนามออกแล้วยังไม่ตั้งคนใหม่ = ช่วงนั้นไม่มีผู้ลงนาม (เว้นเส้นให้เขียนมือ) ไม่เอาคนอื่นมาแทน', () => {
  const cleared = row('ปลัดที่ถูกลบออก', 'clerk', '2026-09-01T00:00:00+00:00', { is_active: false, updated_at: '2026-09-10T00:00:00+00:00' })
  const later = row('ปลัดที่ตั้งทีหลัง', 'clerk', '2026-09-20T00:00:00+00:00')
  assert.equal(nameAt([cleared, later], '2026-09-05T00:00:00Z'), 'ปลัดที่ถูกลบออก')
  assert.equal(pickSignatory([cleared, later], { role: 'clerk', at: '2026-09-15T00:00:00Z' }), null)
  assert.equal(nameAt([cleared, later], '2026-09-25T00:00:00Z'), 'ปลัดที่ตั้งทีหลัง')
})

check('แยกช่องตามกองและชื่อแถวที่แอดมินตั้งเอง — คนของกองอื่นต้องไม่หลุดมา', () => {
  const DEPT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
  const DEPT_B = 'bbbbbbbb-0000-4000-8000-000000000002'
  const rows = [
    row('ผอ.กองเอ คนเดิม', 'department_head', '2026-08-30T00:00:00+00:00', { department_id: DEPT_A, is_active: false, updated_at: '2026-09-22T06:38:00+00:00' }),
    row('ผอ.กองเอ คนใหม่', 'department_head', '2026-09-22T06:38:00+00:00', { department_id: DEPT_A }),
    row('ผอ.กองบี', 'department_head', '2026-08-30T00:00:00+00:00', { department_id: DEPT_B }),
    row('รองนายก (สั่งใช้รถ)', 'custom', '2026-09-02T16:00:00+00:00', { custom_label: 'รองนายก' }),
  ]
  assert.equal(nameAt(rows, '2026-09-01T00:00:00Z', { role: 'department_head', departmentId: DEPT_A }), 'ผอ.กองเอ คนเดิม')
  assert.equal(nameAt(rows, '2026-09-23T00:00:00Z', { role: 'department_head', departmentId: DEPT_A }), 'ผอ.กองเอ คนใหม่')
  assert.equal(nameAt(rows, '2026-09-23T00:00:00Z', { role: 'department_head', departmentId: DEPT_B }), 'ผอ.กองบี')
  assert.equal(nameAt(rows, '2026-09-23T00:00:00Z', { role: 'custom', customLabel: 'รองนายก' }), 'รองนายก (สั่งใช้รถ)')
  assert.equal(pickSignatory(rows, { role: 'custom', at: '2026-09-23T00:00:00Z' }), null, 'แถวที่แอดมินตั้งเองต้องระบุชื่อแถว')
})

check('วันสิ้นสุดที่ตั้งไว้ (effective_to) ยังมีผล', () => {
  const acting = row('ผู้รักษาราชการแทน', 'clerk', '2026-09-01T00:00:00+00:00', { effective_to: '2026-09-10' })
  assert.equal(nameAt([acting], '2026-09-10T15:00:00Z'), 'ผู้รักษาราชการแทน', '22:00 น. วันที่ 10 ยังอยู่ในวันสิ้นสุด (เวลาไทย)')
  assert.equal(pickSignatory([acting], { role: 'clerk', at: '2026-09-10T18:00:00Z' }), null, '01:00 น. วันที่ 11 เวลาไทย พ้นวันสิ้นสุดแล้ว')
})

check('ทะเบียนที่ไม่ได้ดึงเวลาบันทึกมา (select แบบเก่า) ถอยไปใช้ผู้ลงนามวันนี้ ไม่เดา', () => {
  const legacy = [{ ...NEW_CLERK, created_at: undefined }]
  assert.equal(nameAt(legacy, '2026-01-01T00:00:00Z'), 'ปลัดคนใหม่')
})

check('ตัวเลือกบนฟอร์มสร้างเอกสารใหม่ไม่เห็นแถวที่ปิดแล้ว', () => {
  const oldDefault = row('รองนายกคนเดิม', 'custom', '2026-09-02T00:00:00+00:00', {
    custom_label: 'รองนายก', is_vehicle_order_default: true, is_active: false, updated_at: '2026-09-05T00:00:00+00:00',
  })
  assert.equal(defaultVehicleAuthority([oldDefault]), null)
  assert.deepEqual(organizationSignatories([oldDefault, OLD_CLERK, NEW_CLERK]).map(signatoryName), ['ปลัดคนใหม่'])
})

check('signatoryMoment: เสร็จแล้ว = เวลาที่เสร็จ (ลงวันที่ย้อนหลังใช้สิ้นวันนั้น) · ยังไม่เสร็จ = ตอนนี้', () => {
  const finished = '2026-10-06T03:00:00.000Z'
  assert.equal(signatoryMoment({ finishedAt: finished }), finished)
  assert.equal(signatoryMoment({ finishedAt: finished, documentDate: '2026-10-01' }), '2026-10-01T16:59:59.999Z',
    'บันทึกย้อนหลัง = สิ้นวันที่ 1 ต.ค. เวลาไทย')
  assert.equal(signatoryMoment({ finishedAt: finished, documentDate: '2026-10-06' }), finished, 'วันเดียวกัน = เวลาที่เสร็จจริง')
  assert.equal(signatoryMoment({ finishedAt: finished, documentDate: 'ไม่ใช่วันที่' }), finished)
  const pending = Date.parse(signatoryMoment({ documentDate: '2026-09-01' }))
  assert.ok(Math.abs(pending - Date.now()) < 5000, 'ยังไม่เสร็จ = ตอนนี้ แม้ร่างจะลงวันที่เก่าไว้ (คนเก่ากลับมาเซ็นไม่ได้)')
})

check('ชุดเอกสารรถรับ-ส่ง (ระบบจองคิว): ลงนามตอนบันทึกเลขหนังสือ — ของคำขอเองก่อน แล้วของเที่ยว · ยังไม่บันทึก = ตอนนี้', () => {
  const trip = { id: 't1', state: 'completed', created_at: '2026-09-20T02:00:00Z', forward_letter_no: 'ที่ 9/2569', forward_letter_date: '2026-09-21', forward_recorded_at: '2026-09-21T04:00:00Z' }
  const own = { status: 'completed', forward_letter_no: 'ที่ 10/2569', forward_letter_date: '2026-09-25', forward_recorded_at: '2026-09-25T05:00:00Z' }
  assert.equal(bookingLetterMoment(own, trip), '2026-09-25T05:00:00.000Z')
  assert.equal(bookingLetterMoment({ status: 'completed' }, trip), '2026-09-21T04:00:00.000Z')
  const pending = Date.parse(bookingLetterMoment({ status: 'confirmed' }, { ...trip, forward_letter_no: null }))
  assert.ok(Math.abs(pending - Date.now()) < 5000, 'ยังไม่บันทึกเลขหนังสือ = เรื่องยังไม่เสร็จ ใช้คนปัจจุบัน')
})

check('ใบคำขอรถรับ-ส่ง: ผู้ลงนามทั้ง 3 ช่องตามเวลาที่ส่งเข้า', () => {
  const departments = [{ id: 'd-welfare', code: 'welfare', name: 'กองสวัสดิการสังคม' }]
  const registry = [...REGISTRY, row('ผอ.กองสวัสดิการ', 'department_head', '2026-08-30T00:00:00+00:00', { department_id: 'd-welfare' })]
  const done = resolvePatientRequestSignatories({ departments, registry, at: '2026-10-01T03:00:00Z' })
  const now = resolvePatientRequestSignatories({ departments, registry, at: signatoryMoment({}) })
  assert.equal(done.signatories.clerk.name, 'ปลัดคนเดิม')
  assert.equal(now.signatories.clerk.name, 'ปลัดคนใหม่')
  assert.equal(done.signatories.department_head.name, 'ผอ.กองสวัสดิการ')
  assert.equal(resolvePatientRequestSignatories({ departments, registry }).signatories.clerk.name, 'ปลัดคนใหม่', 'ไม่ส่ง at = วันนี้')
})

// ── ทุกจุดที่พิมพ์เอกสารต้องโหลดทะเบียนรวมแถวที่ปิดแล้ว และส่งเวลาที่ถูกต้องเข้า pickSignatory ────────
const source = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// คำสั่งโหลดทะเบียนแต่ละจุด = ข้อความหลัง from('document_signatories') จนถึงคำสั่งถัดไป (supabase. / ]) / บรรทัดว่าง)
const registryLoads = text => text.split("from('document_signatories')").slice(1).map(part => {
  const stops = [part.indexOf('supabase.'), part.indexOf('])'), part.indexOf('\n\n'), 300].filter(at => at >= 0)
  return part.slice(0, Math.min(...stops))
})

check('จุดพิมพ์เอกสาร: ไม่กรอง is_active ตอนโหลดทะเบียน และส่งเวลาที่เรื่องเสร็จ (ค้าง = ตอนนี้) ทุกช่อง', () => {
  const PRINTS = {
    'pages/StaffDashboard.jsx': [
      "{ role: 'clerk', at }", "{ role: 'mayor', at }", 'departmentId: req.department_id ?? null, at',
      'FINISHED_REQUEST_STATUSES.includes(req.status) ? (req.issued_at ?? req.updated_at) : null',
    ],
    'components/staff/AssetBorrowRequestPanel.jsx': ["{ role: 'clerk', at }", "{ role: 'mayor', at }", 'finishedAt: headRes.data?.approved_at'],
    'components/staff/PatientTransportPanel.jsx': ["{ role: 'mayor', at }", 'finishedAt: canEditLetter ? null : header?.forwarded_at'],
    'pages/PatientTransportStaff.jsx': ["{ role: 'mayor', at }", 'fundContext(bookingLetterMoment(', 'requestSignContext(bookingLetterMoment('],
    'components/fleet/FleetTrips.jsx': [
      'customLabel: authorityLabel, at }', 'departmentId: deptHeadDeptId, at }',
      'finishedAt: approved ? (t.approved_at ?? t.created_at) : null, documentDate: t.document_date',
    ],
    'lib/patientRequestSignatories.js': ["{ role: 'clerk', at }", "{ role: 'mayor', at }"],
  }
  for (const [file, needles] of Object.entries(PRINTS)) {
    const text = source(file)
    for (const load of registryLoads(text)) {
      assert.ok(!load.includes("'is_active'"), `${file} ยังกรอง is_active ตอนโหลดทะเบียน — หาผู้ลงนามคนเก่าไม่เจอ ใบที่เสร็จแล้วจะเปลี่ยนชื่อตาม`)
    }
    for (const needle of needles) assert.ok(text.includes(needle), `${file} ไม่ได้ส่งเวลาที่ถูกต้อง: ${needle}`)
  }
})

check('รายงานที่ออกตอนกดพิมพ์ใช้ผู้ลงนามวันนี้ตามเดิม (ไม่ใช่เอกสารเก่า)', () => {
  // สรุปผลการปฏิบัติงาน / รายงานยานพาหนะ ออกใหม่ทุกครั้งที่กดพิมพ์ ผู้ลงนามคือคนที่ดำรงตำแหน่งตอนพิมพ์
  for (const file of ['lib/staffPerformanceData.js', 'components/fleet/FleetReport.jsx']) {
    assert.ok(registryLoads(source(file)).every(load => load.includes("'is_active'")), `${file} ควรโหลดเฉพาะผู้ลงนามปัจจุบัน`)
  }
})

check('ใบคำร้อง (SQL): ปิดแล้ว = ตอนปิด · ยังไม่ปิด = ตอนนี้', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261006120000_complaint_print_signatory_as_of.sql', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
  assert.match(sql, /WHEN v_complaint\.status IN \('closed', 'completed', 'done', 'rejected'\)\n\s+THEN coalesce\(v_complaint\.closed_at, v_complaint\.updated_at, now\(\)\)\n\s+ELSE now\(\)/)
  assert.doesNotMatch(sql, /v_today/, 'ยังเหลือการเลือกตามวันนี้')
  assert.doesNotMatch(sql, /v_as_of := coalesce\(v_complaint\.created_at/, 'ห้ามใช้เวลายื่น — เรื่องที่ค้างต้องได้คนปัจจุบัน')
  assert.doesNotMatch(sql, /AND signatory\.is_active\n/, 'ยังกรองเฉพาะแถวที่ใช้อยู่ — หาคนเก่าไม่เจอ')
  assert.match(sql, /later\.created_at > signatory\.created_at/, 'ต้องจบผลของแถวเก่าตอนมีแถวใหม่มาแทน')
  assert.match(sql, /'signatories_as_of', v_as_of/, 'audit ต้องบันทึกเวลาที่ใช้เลือกผู้ลงนาม ตรวจย้อนได้')
})

const failed = results.filter(line => line.startsWith('FAIL')).length
process.stdout.write(`ผู้ลงนามบนเอกสารที่พิมพ์ซ้ำ\n${results.join('\n')}\nSUMMARY PASS=${results.length - failed} FAIL=${failed}\n`)
if (failed) process.exitCode = 1

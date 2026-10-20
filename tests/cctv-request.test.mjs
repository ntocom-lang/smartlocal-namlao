// ขอภาพจากกล้องวงจรปิด — ตรรกะหน้าเว็บ + ตรวจให้หน้าเว็บกับด่านฐานข้อมูลใช้ตัวเลข/รายการค่าเดียวกัน
//   node tests/cctv-request.test.mjs        (npm run test:cctv-request)
// ฝั่งฐานข้อมูลตรวจแยกที่ tests/cctv-request-db.test.mjs (ต้องใช้ PGlite)
//
// สิ่งที่ต้องไม่พัง: (1) ตรวจฟอร์มก่อนส่งตรงกับที่ฐานข้อมูลตรวจ (เพดาน รายการค่า คีย์ที่ยอมรับ) (2) ป้ายเร่งคำนวณจากรอบเก็บภาพ
// ที่แอดมินตั้งเท่านั้น ไม่มีค่าเดา (3) บันทึกส่งมอบที่ยังไม่เติมชื่อไม่ถูกบันทึกลงประวัติและกดเสร็จสิ้นไม่ได้
// (4) คำขอประเภทนี้ไม่สร้างหนังสือรับรอง/ไม่มีช่องแนบไฟล์/ไม่โผล่ในเมนูสร้างแทนที่เคาน์เตอร์
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CCTV_DAILY_LIMIT, CCTV_FORM_TYPE, CCTV_HANDOVER_BLANK, CCTV_INCIDENT_TYPES, CCTV_MAX_DESCRIPTION, CCTV_MAX_INCIDENT_AGE_DAYS,
  CCTV_MAX_LABEL, CCTV_MAX_POLICE_REF, CCTV_MAX_WINDOW_MINUTES, CCTV_REQUESTER_ROLES, CCTV_RETENTION_KEY, CCTV_RETENTION_MAX,
  CCTV_SOON_DAYS, CCTV_TYPE, buildCctvFormData, cctvCitizenRetentionNotice, cctvHandoverDraft, cctvNoteForSave, cctvOverwriteInfo,
  cctvPurposeText, cctvRetentionDays, cctvSubmitErrorText, cctvTimeToMinutes, isCctvHandoverFilled, validateCctvDraft,
} from '../src/lib/cctvRequest.js'
import { BASE_DOCUMENT_TYPES, DEFAULT_SLA_DAYS, allDocumentTypes, withoutRemovedTypes } from '../src/lib/documentTypes.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = async rel => (await readFile(path.join(root, rel), 'utf8')).replace(/\r\n/g, '\n')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const sql = await read('supabase/migrations/20261021100000_cctv_footage_request_guard.sql')
const src = {
  lib: await read('src/lib/cctvRequest.js'),
  wizard: await read('src/pages/CctvRequestWizard.jsx'),
  info: await read('src/components/staff/CctvRequestInfo.jsx'),
  citizen: await read('src/pages/CitizenDocRequest.jsx'),
  staff: await read('src/pages/StaffDashboard.jsx'),
  admin: await read('src/components/admin/DocumentTypeAssignments.jsx'),
  telegram: await read('supabase/functions/notify-telegram/index.ts'),
  myDocs: await read('src/pages/MyDocRequests.jsx'),
  lpa: await read('src/pages/LpaDocStats.jsx'),
}

// ตัดคอมเมนต์ออกก่อนตรวจข้อความที่ผู้ใช้เห็น — คอมเมนต์อธิบายว่า "ห้ามเขียนว่า..." ย่อมมีวลีนั้นอยู่
const stripComments = text => text.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const TODAY = '2026-11-08'
const valid = (over = {}) => ({
  incident_type: 'property_lost', incident_date: '2026-11-05', time_from: '18:30', time_to: '19:30',
  camera_id: null, camera_label: 'CCTV สี่แยกตลาด', description: 'รถจักรยานยนต์หาย', requester_role: 'victim', police_ref: '', ...over,
})
const check = (draft, today = TODAY) => validateCctvDraft(draft, { today })

// ── SQL ↔ JS ───────────────────────────────────────────────────────────────────────────────────────
await test('รายการค่าในด่านฐานข้อมูลตรงกับหน้าเว็บ (ประเภทเหตุ ฐานะผู้ขอ คีย์ของฟอร์ม)', () => {
  const list = pattern => [...sql.match(pattern)[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(list(/incident_type'\) NOT IN \(([^)]*)\)/), CCTV_INCIDENT_TYPES.map(t => t.value).sort())
  assert.deepEqual(list(/requester_role'\) NOT IN \(([^)]*)\)/), CCTV_REQUESTER_ROLES.map(t => t.value).sort())
  assert.deepEqual(list(/key <> ALL \(ARRAY\[([^\]]*)\]/), Object.keys(buildCctvFormData(valid())).sort())
  assert.match(sql, new RegExp(`'form_type' IS DISTINCT FROM '${CCTV_FORM_TYPE}'`))
  assert.equal(CCTV_TYPE, 'cctv_footage_request')
})

await test('เพดานตัวเลขในด่านฐานข้อมูลตรงกับหน้าเว็บ', () => {
  assert.match(sql, new RegExp(`v_minutes > ${CCTV_MAX_WINDOW_MINUTES}\\b`))
  assert.match(sql, new RegExp(`char_length\\(v_label\\) > ${CCTV_MAX_LABEL}\\b`))
  assert.match(sql, new RegExp(`char_length\\(v_desc\\) > ${CCTV_MAX_DESCRIPTION}\\b`))
  assert.match(sql, new RegExp(`'police_ref', ''\\)\\) > ${CCTV_MAX_POLICE_REF}\\b`))
  assert.match(sql, new RegExp(`v_today - v_date > ${CCTV_MAX_INCIDENT_AGE_DAYS}\\b`))
  assert.match(sql, new RegExp(`rpc_rate_limit_hit\\('cctv_footage_request', ${CCTV_DAILY_LIMIT}, interval '1 day'\\)`))
  assert.equal(CCTV_MAX_WINDOW_MINUTES % 60, 0, 'ข้อความ "ไม่เกิน N ชั่วโมง" หารด้วย 60 ลงตัว')
  assert.match(sql, new RegExp(`ไม่เกิน ${CCTV_MAX_WINDOW_MINUTES / 60} ชั่วโมง`))
})

await test('รอบเก็บภาพ: คีย์ที่แอดมินตั้งกับช่วงที่ยอมรับ', () => {
  assert.equal(CCTV_RETENTION_KEY, '_cctv_retention_days')
  assert.match(src.admin, /CCTV_RETENTION_KEY/)
  assert.equal(CCTV_RETENTION_MAX, 365)
})

await test('ปิดเป็นค่าเริ่มต้น: migration เติมค่านี้ให้ อปท. ที่มีอยู่และตั้ง trigger ให้ อปท. ใหม่ · ไม่ทับฟังก์ชัน route เดิม', () => {
  assert.match(sql, /UPDATE public\.municipalities/)
  assert.match(sql, /BEFORE INSERT ON public\.municipalities/)
  assert.match(sql, /WHEN \(NEW\.document_type = 'cctv_footage_request'\)/)
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.route_document_request_department/i)
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.protect_document_request_scope/i)
})

// ── ประเภทคำขอ ───────────────────────────────────────────────────────────────────────────────────────
await test('ประเภทใหม่อยู่ในรายการกลาง + มีค่าเริ่มต้นกำหนดเสร็จ + ชื่อตรงกันทุกจุดที่แปลชื่อ', () => {
  const entry = BASE_DOCUMENT_TYPES.find(t => t.value === CCTV_TYPE)
  assert.ok(entry)
  assert.equal(entry.label, '🎥 ขอภาพจากกล้องวงจรปิด')
  assert.equal(DEFAULT_SLA_DAYS[CCTV_TYPE], 2)
  for (const [name, text] of Object.entries({ myDocs: src.myDocs, lpa: src.lpa })) {
    assert.match(text, /cctv_footage_request: 'ขอภาพจากกล้องวงจรปิด'/, `${name} ไม่มีชื่อประเภท`)
  }
  assert.match(src.telegram, /cctv_footage_request: \{ emoji: '🎥', label: 'ขอภาพจากกล้องวงจรปิด' \}/)
})

await test('อปท. ที่ปิดบริการ (อยู่ใน _removed_types) ไม่เห็นประเภทนี้ในตัวเลือกยื่น · เปิดแล้วเห็น', () => {
  const off = { fee_schedule: { _removed_types: [CCTV_TYPE] } }
  const on = { fee_schedule: { _removed_types: [] } }
  assert.equal(allDocumentTypes(off).some(t => t.value === CCTV_TYPE), false)
  assert.equal(allDocumentTypes(on).some(t => t.value === CCTV_TYPE), true)
  assert.equal(withoutRemovedTypes([{ value: CCTV_TYPE }], off).length, 0)
})

// ── ตรวจฟอร์ม ───────────────────────────────────────────────────────────────────────────────────────
await test('ข้อมูลถูกต้องผ่าน · ช่องไม่บังคับว่างได้', () => {
  assert.deepEqual(check(valid()), { ok: true, errors: {} })
  assert.equal(check(valid({ description: '', police_ref: '' })).ok, true)
})

await test('แต่ละช่องที่ผิดต้องฟ้องช่องนั้น (ข้อความไทย) ไม่ฟ้องช่องอื่น', () => {
  const cases = [
    ['incident_type', valid({ incident_type: '' })],
    ['incident_type', valid({ incident_type: 'robbery' })],
    ['incident_date', valid({ incident_date: '' })],
    ['incident_date', valid({ incident_date: '2026-02-31' })],
    ['incident_date', valid({ incident_date: '2026-11-09' })],
    ['incident_date', valid({ incident_date: '2025-11-07' })],
    ['time_from', valid({ time_from: '' })],
    ['time_to', valid({ time_to: '24:00' })],
    ['time_to', valid({ time_from: '19:30', time_to: '19:30' })],
    ['time_to', valid({ time_from: '23:30', time_to: '00:30' })],
    ['time_to', valid({ time_from: '10:00', time_to: '13:01' })],
    ['camera_label', valid({ camera_label: '  ' })],
    ['camera_label', valid({ camera_label: 'ก'.repeat(CCTV_MAX_LABEL + 1) })],
    ['description', valid({ description: 'ก'.repeat(CCTV_MAX_DESCRIPTION + 1) })],
    ['description', valid({ incident_type: 'other', description: '  ' })],
    ['requester_role', valid({ requester_role: '' })],
    ['police_ref', valid({ police_ref: '1'.repeat(CCTV_MAX_POLICE_REF + 1) })],
  ]
  for (const [field, draft] of cases) {
    const result = check(draft)
    assert.equal(result.ok, false, JSON.stringify(draft))
    assert.deepEqual(Object.keys(result.errors), [field], `${field}: ${JSON.stringify(result.errors)}`)
    assert.match(result.errors[field], /[ก-๙]/)
  }
})

await test('ขอบเขต: 180 นาทีพอดีผ่าน · 365 วันก่อนผ่าน · วันนี้ผ่าน', () => {
  assert.equal(check(valid({ time_from: '10:00', time_to: '13:00' })).ok, true)
  assert.equal(check(valid({ incident_date: '2025-11-08' })).ok, true)
  assert.equal(check(valid({ incident_date: TODAY })).ok, true)
  assert.equal(cctvTimeToMinutes('07:05'), 425)
  assert.equal(cctvTimeToMinutes('7:05'), null)
})

await test('buildCctvFormData ตัดช่องว่างและเพดานตัวอักษร · ไม่มีคีย์เกินที่ฐานข้อมูลยอมรับ', () => {
  const data = buildCctvFormData(valid({ camera_label: '  จุด A  ', description: ' ข้อความ ', camera_id: 'uuid-1', police_ref: ' 123 ' }))
  assert.equal(data.form_type, CCTV_FORM_TYPE)
  assert.equal(data.camera_label, 'จุด A')
  assert.equal(data.description, 'ข้อความ')
  assert.equal(data.police_ref, '123')
  assert.equal(data.camera_id, 'uuid-1')
  assert.equal(buildCctvFormData(valid()).camera_id, null)
  assert.equal(buildCctvFormData(valid({ description: 'ก'.repeat(999) })).description.length, CCTV_MAX_DESCRIPTION)
  assert.match(cctvPurposeText(valid()), /^ขอภาพกล้องวงจรปิด · ทรัพย์สินสูญหาย/)
})

// ── รอบเก็บภาพ / ป้ายเร่ง ────────────────────────────────────────────────────────────────────────────
await test('cctvRetentionDays: ยอมรับจำนวนเต็ม 1–365 (รวมข้อความตัวเลข) ที่เหลือคือไม่ได้ตั้ง', () => {
  const of = value => cctvRetentionDays({ fee_schedule: { [CCTV_RETENTION_KEY]: value } })
  assert.equal(of(30), 30)
  assert.equal(of('45'), 45)
  assert.equal(of(1), 1)
  assert.equal(of(365), 365)
  for (const bad of [0, -3, 366, 12.5, 'abc', '', ' ', null, undefined, true, [], {}]) assert.equal(of(bad), null, String(bad))
  assert.equal(cctvRetentionDays(null), null)
  assert.equal(cctvRetentionDays({}), null)
})

await test('cctvOverwriteInfo: ok / soon / overwritten / unknown', () => {
  const at = (today, over = {}) => cctvOverwriteInfo({ incidentDate: '2026-10-12', retentionDays: 30, today, ...over })
  assert.deepEqual(at('2026-10-20'), { status: 'ok', overwriteDate: '2026-11-11', daysLeft: 22 })
  assert.deepEqual(at('2026-11-08'), { status: 'soon', overwriteDate: '2026-11-11', daysLeft: 3 })
  assert.equal(at('2026-11-11').status, 'soon')
  assert.equal(at('2026-11-11').daysLeft, 0)
  assert.equal(at('2026-11-12').status, 'overwritten')
  assert.equal(at('2026-11-04').daysLeft, CCTV_SOON_DAYS)
  assert.equal(at('2026-11-04').status, 'soon')
  assert.equal(at('2026-11-03').status, 'ok')
  for (const over of [{ retentionDays: null }, { retentionDays: 0 }, { retentionDays: 2.5 }, { incidentDate: '' }, { incidentDate: '2026-02-31' }]) {
    assert.deepEqual(at('2026-11-08', over), { status: 'unknown', overwriteDate: null, daysLeft: null })
  }
})

await test('คำเตือนบนฟอร์มประชาชน: ไม่ตั้งรอบ = คำเตือนทั่วไปไม่มีตัวเลข · ตั้งรอบ = บอกตัวเลข · ใกล้/เลย = แดง', () => {
  const notice = (retentionDays, incidentDate) => cctvCitizenRetentionNotice({ retentionDays, incidentDate, today: TODAY })
  const generic = notice(null, '2026-11-01')
  assert.equal(generic.tone, 'amber')
  assert.doesNotMatch(generic.text, /\d/)
  const ok = notice(30, '2026-11-01')
  assert.equal(ok.tone, 'amber')
  assert.match(ok.text, /ประมาณ 30 วัน/)
  const soon = notice(30, '2026-10-12')
  assert.equal(soon.tone, 'red')
  assert.match(soon.text, /ภายใน 3 วัน/)
  const gone = notice(30, '2026-09-01')
  assert.equal(gone.tone, 'red')
  assert.match(gone.text, /ภาพอาจถูกบันทึกทับไปแล้ว/)
  assert.match(gone.text, /ไม่รับประกัน/)
  for (const n of [generic, ok, soon, gone]) assert.doesNotMatch(n.text, /จะได้ภาพ|ได้รับภาพแน่/)
})

// ── บันทึกส่งมอบ ────────────────────────────────────────────────────────────────────────────────────
await test('ร่างบันทึกส่งมอบ: เติมชื่อแล้วถึงนับว่าครบ · ร่างที่ยังว่างไม่ถูกบันทึกลงประวัติ', () => {
  const draft = cctvHandoverDraft('8 พฤศจิกายน พ.ศ. 2569')
  assert.ok(draft.includes(CCTV_HANDOVER_BLANK))
  assert.match(draft, /^ส่งมอบภาพให้ ________ เมื่อ 8 พฤศจิกายน พ.ศ. 2569$/)
  assert.equal(isCctvHandoverFilled(draft), false)
  assert.equal(isCctvHandoverFilled(''), false)
  assert.equal(isCctvHandoverFilled('   '), false)
  assert.equal(isCctvHandoverFilled(draft.replace(CCTV_HANDOVER_BLANK, 'นายสมชาย ใจดี')), true)
  assert.equal(cctvNoteForSave(draft), '')
  assert.equal(cctvNoteForSave(`ติดต่อผู้ขอแล้ว\n${draft}`), 'ติดต่อผู้ขอแล้ว')
  const filled = draft.replace(CCTV_HANDOVER_BLANK, 'นายสมชาย ใจดี')
  assert.equal(cctvNoteForSave(filled), filled)
  assert.equal(cctvNoteForSave(null), '')
})

await test('ข้อความผิดพลาดตอนยื่นอ่านรู้เรื่อง ไม่ทิ้งรหัสดิบ', () => {
  assert.match(cctvSubmitErrorText({ code: 'PT429', message: 'ยื่นคำขอภาพกล้องวงจรปิดครบจำนวนต่อวันแล้ว กรุณาลองใหม่พรุ่งนี้' }), /ครบจำนวนต่อวัน/)
  assert.match(cctvSubmitErrorText({ code: '42501', message: 'หน่วยงานนี้ยังไม่เปิดบริการขอภาพจากกล้องวงจรปิด' }), /ยังไม่เปิดบริการ/)
  assert.match(cctvSubmitErrorText({ code: '22023', message: 'ประเภทเหตุไม่ถูกต้อง' }), /^ส่งคำขอไม่สำเร็จ: ประเภทเหตุไม่ถูกต้อง$/)
  assert.match(cctvSubmitErrorText(null), /ส่งคำขอไม่สำเร็จ/)
})

// ── โค้ดหน้าจอ ──────────────────────────────────────────────────────────────────────────────────────
await test('ฟอร์มประชาชน: ไม่มีช่องแนบไฟล์ · ไม่แตะตารางอื่นนอกจาก document_requests/profiles/data_center_entries · ไม่เขียน fee_schedule', () => {
  assert.doesNotMatch(src.wizard, /type="file"|createObjectURL|uploadFile|driveStorage/)
  const tables = [...src.wizard.matchAll(/\.from\('([a-z_]+)'\)/g)].map(m => m[1])
  assert.deepEqual([...new Set(tables)].sort(), ['data_center_entries', 'document_requests', 'profiles'])
  assert.doesNotMatch(src.wizard, /fee_schedule/)
  assert.match(src.wizard, /document_type: CCTV_TYPE/)
  assert.match(src.wizard, /permit_form_data: buildCctvFormData\(draft\)/)
  assert.match(src.wizard, /user_id: session\?\.user\?\.id \?\? null/)
  assert.match(src.wizard, /if \(!session\)/)
  assert.doesNotMatch(stripComments(src.wizard), /จะได้รับภาพ|ได้รับภาพแน่/)
})

await test('หน้าเลือกบริการ: การ์ดบังคับล็อกอิน + เปิดฟอร์มเฉพาะแทนฟอร์มทั่วไป', () => {
  assert.match(src.citizen, /import CctvRequestWizard from '\.\/CctvRequestWizard'/)
  assert.match(src.citizen, /value:   CCTV_TYPE,[\s\S]*?requiresAuth: true/)
  assert.match(src.citizen, /if \(isCctvRequest\) \{\s*return <CctvRequestWizard tenant=\{tenant\} session=\{session\}/)
})

await test('หน้าเจ้าหน้าที่: ข้ามหนังสือรับรองทั้งตอนเสร็จงานและปุ่มพิมพ์ · ซ่อนจากเมนู walk-in · เสร็จสิ้นต้องเติมชื่อผู้รับ · ไม่บันทึกร่างที่ว่าง', () => {
  assert.match(src.staff, /const NO_CERTIFICATE_DOC_TYPES = \[CCTV_TYPE\]/)
  assert.match(src.staff, /newStatus === 'completed' && req && !NO_CERTIFICATE_DOC_TYPES\.includes\(req\.document_type\)/)
  assert.match(src.staff, /req\.status === 'completed' && !PANEL_DOC_TYPES\.includes\(req\.document_type\) && !NO_CERTIFICATE_DOC_TYPES\.includes\(req\.document_type\)/)
  assert.match(src.staff, /\.filter\(d => d\.value !== CCTV_TYPE\)/)
  assert.match(src.staff, /onUpdate\(req\.id, 'completed', noteOut, ''\)\} disabled=\{acting \|\| \(isCctv && !isCctvHandoverFilled\(staffNote\)\)\}/)
  for (const status of ['processing', 'rejected']) assert.match(src.staff, new RegExp(`onUpdate\\(req\\.id, '${status}', noteOut,`))
  assert.doesNotMatch(src.staff, /onUpdate\(req\.id, '(processing|completed|rejected)', staffNote,/)
  assert.match(src.staff, /\{isCctv && <CctvRequestInfo req=\{req\} tenant=\{tenant\} \/>\}/)
  // ปุ่มเสร็จสิ้นจางตอนกดไม่ได้ ต้องมีข้อความเหตุผลติดอยู่กับปุ่มด้วย (ช่องบันทึกอยู่ในส่วนที่เลื่อนอ่าน)
  assert.match(src.staff, /data-cctv-handover-footer/)
})

await test('หน้าเจ้าหน้าที่: ป้ายเร่งขึ้นเฉพาะคำขอที่ยังเปิดอยู่และเฉพาะเมื่อแอดมินตั้งรอบเก็บภาพ · ไม่มีลิงก์/ไฟล์ภาพ', () => {
  assert.match(src.info, /const active = req\.status === 'pending' \|\| req\.status === 'processing'/)
  assert.match(src.info, /active && info\.status === 'soon'/)
  assert.match(src.info, /active && info\.status === 'overwritten'/)
  assert.match(src.info, /cctvRetentionDays\(tenant\)/)
  assert.doesNotMatch(src.info, /<video|<img|<a href|document_url/)
  assert.match(src.info, /อาจ/)
})

await test('หน้าแอดมิน: ช่องรอบเก็บภาพอยู่เฉพาะแถวของประเภทนี้ · ลง audit log เมื่อเปิด/ปิดบริการและเปลี่ยนรอบ', () => {
  assert.match(src.admin, /value === CCTV_TYPE &&/)
  assert.match(src.admin, /action: cctvNowOn \? 'enable_service' : 'disable_service'/)
  assert.match(src.admin, /action: 'update_cctv_retention'/)
  assert.match(src.admin, /delete fee_schedule\[CCTV_RETENTION_KEY\]/)
})

console.log(`\nผ่านทั้งหมด ${cases} กลุ่ม`)

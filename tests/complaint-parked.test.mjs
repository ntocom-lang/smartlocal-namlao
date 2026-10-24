// สถานะ "ขึ้นทะเบียนรอดำเนินการ" (parked) — กติกาฝั่งหน้าเว็บ + ผูกกับ migration + กันหน้าจอที่ลืมรู้จักสถานะนี้
// รันด้วย: node tests/complaint-parked.test.mjs   (ไม่ต้องใช้ฐานข้อมูล · ส่วนฐานข้อมูลจำลองอยู่ tests/complaint-parked-db.test.mjs)
//
// ทำไมต้องมี: เพิ่มสถานะใหม่ = ทุกที่ที่ไล่สถานะ (ป้าย สี ตัวนับ เกินกำหนด) ต้องรู้จัก ไม่งั้นเรื่องที่พักไว้โผล่เป็น
// "คำร้องใหม่" หรือขึ้นเกินกำหนดย้อนหลัง · และรหัสเหตุผล/ป้ายต้องตรงกันระหว่างหน้าเว็บกับ park_complaints() ใน DB

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PARK_BULK_MAX, PARK_NOTE_MAX, PARK_REASONS, PARK_ROLES, PARKABLE_STATUSES, PARKED_LABEL, PARKED_PUBLIC_NOTE, PARKED_STATUS,
  FINISHABLE_STATUSES, canFinishWork, canParkWork, canUnparkWork, isParked, parkReasonLabel, summarizeParkResult, validateParkInput,
} from '../src/lib/complaintWorkflow.js'
import { buildTrackSteps, isTrackFinished } from '../src/lib/complaintTrack.js'
import { summarizeMonth } from '../src/lib/complaintMonthlySummary.js'
import { STAT_FIELDS, statsDifferences } from '../src/lib/complaintMonthlyLock.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// git บน Windows (core.autocrlf=true) checkout เป็น CRLF — แปลงเป็น LF ก่อนตรวจเสมอ
const readText = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')
const noComments = (sql) => sql.replace(/^\s*--.*$/gm, '')

// ── 1) กติกาสิทธิ์/ปุ่ม ───────────────────────────────────────────────────────
const base = { id: 'c1', status: 'received', category: 'farm_road', assigned_to: 'u-staff', department: 'กองช่าง' }
const META = { farm_road: { allow_parking: true }, light: {}, odor: { is_adhoc: true, allow_parking: true } }

assert.equal(PARKED_STATUS, 'parked')
assert.equal(isParked('parked'), true)
for (const status of ['received', 'closed', 'rejected', undefined]) assert.equal(isParked(status), false)

assert.deepEqual(PARK_ROLES, ['admin', 'superadmin', 'officer'], 'พักเรื่องได้เฉพาะแอดมิน/หัวหน้ากอง — ผู้ลงมือ (staff/technician) ไม่มีสิทธิ์')
for (const role of ['staff', 'technician', 'citizen', 'viewer', 'council']) {
  assert.equal(canParkWork(base, 'u-staff', role, META), false, `${role} ต้องพักเรื่องไม่ได้ แม้เป็นผู้รับผิดชอบ`)
}
assert.equal(canParkWork(base, 'u-admin', 'admin', META), true)
assert.equal(canParkWork(base, 'u-admin', 'superadmin', META), true)
assert.equal(canParkWork(base, 'u-off', 'officer', META), false, 'หัวหน้ากองต้องยืนยันว่ารายการกรองเฉพาะกองแล้ว')
assert.equal(canParkWork(base, 'u-off', 'officer', META, { departmentScoped: true }), true)
assert.equal(canParkWork({ ...base, assigned_to: 'u-off' }, 'u-off', 'officer', META), true, 'หัวหน้ากองที่เป็นผู้รับผิดชอบเอง')
for (const status of PARKABLE_STATUSES) assert.equal(canParkWork({ ...base, status }, 'u-admin', 'admin', META), true, `พักได้จาก ${status}`)
for (const status of ['new', 'pending', 'closed', 'done', 'completed', 'rejected', 'parked']) {
  assert.equal(canParkWork({ ...base, status }, 'u-admin', 'admin', META), false, `พักจาก ${status} ไม่ได้`)
}
assert.equal(canParkWork({ ...base, category: 'light' }, 'u-admin', 'admin', META), false, 'หมวดที่ไม่เปิดธงต้องไม่เห็นปุ่ม')
assert.equal(canParkWork({ ...base, category: 'unknown' }, 'u-admin', 'admin', META), false, 'ไม่รู้ธงของหมวด = ไม่แสดงปุ่ม (พักผิดเสียหายกว่าซ่อนปุ่ม)')
assert.equal(canParkWork(base, 'u-admin', 'admin', {}), false, 'ธงยังโหลดไม่เสร็จ = ไม่แสดงปุ่ม')
assert.equal(canParkWork({ ...base, category: 'odor' }, 'u-admin', 'admin', META), false, 'หมวดเฉพาะกิจไม่ใช้ขั้นตอนนี้')
assert.equal(canParkWork(null, 'u-admin', 'admin', META), false)

const parked = { ...base, status: 'parked' }
assert.equal(canUnparkWork(parked, 'u-admin', 'admin'), true)
assert.equal(canUnparkWork(parked, 'u-off', 'officer', { departmentScoped: true }), true)
assert.equal(canUnparkWork(parked, 'u-off', 'officer'), false)
assert.equal(canUnparkWork(parked, 'u-staff', 'staff'), false)
assert.equal(canUnparkWork(base, 'u-admin', 'admin'), false, 'ไม่ใช่ parked = ไม่มีปุ่มนำกลับ')
assert.equal(canUnparkWork(parked, 'u-admin', 'admin'), true, 'ปิดธงหมวดทีหลังก็ต้องดึงเรื่องกลับได้ (ไม่ดูธง)')

assert.equal(FINISHABLE_STATUSES.includes('parked'), false)
assert.equal(canFinishWork(parked, 'u-staff', 'staff', META), false, 'ปิดงานจาก parked ตรงไม่ได้ ต้องนำกลับเข้าคิวก่อน (กำหนดเสร็จนับใหม่)')
assert.equal(isTrackFinished('parked'), false)

// ── 2) อินพุต/ผลลัพธ์ ──────────────────────────────────────────────────────────
assert.equal(validateParkInput({ reason: 'plan', note: '' }), '')
assert.equal(validateParkInput({ reason: 'budget' }), '')
assert.notEqual(validateParkInput({ reason: '' }), '')
assert.notEqual(validateParkInput({ reason: 'bogus' }), '')
assert.notEqual(validateParkInput({ reason: 'other', note: '   ' }), '', 'เหตุผลอื่นต้องมีรายละเอียด')
assert.equal(validateParkInput({ reason: 'other', note: 'รอสำรวจ' }), '')
assert.notEqual(validateParkInput({ reason: 'plan', note: 'x'.repeat(PARK_NOTE_MAX + 1) }), '')
assert.equal(validateParkInput({ reason: 'plan', note: 'x'.repeat(PARK_NOTE_MAX) }), '')
assert.equal(PARK_NOTE_MAX, 500); assert.equal(PARK_BULK_MAX, 200)

assert.equal(parkReasonLabel('budget'), 'รองบประมาณ')
assert.equal(parkReasonLabel('nope'), '')
assert.deepEqual(summarizeParkResult({ parked: 3, skipped: [] }), { parked: 3, skippedCount: 0, lines: [] })
const mixed = summarizeParkResult({ parked: 1, skipped: [{ id: 'a', code: 'forbidden' }, { id: 'b', code: 'forbidden' }, { id: 'c', code: 'bad_status' }, { id: 'd', code: 'zzz' }] })
assert.equal(mixed.parked, 1); assert.equal(mixed.skippedCount, 4)
assert(mixed.lines.some((line) => line.includes('ไม่มีสิทธิ์') && line.includes('2 เรื่อง')))
assert(mixed.lines.some((line) => line.includes('ข้ามเรื่องที่ทำรายการไม่ได้')), 'รหัสที่ไม่รู้จักต้องมีข้อความสำรอง ไม่โชว์รหัสดิบ')
assert.deepEqual(summarizeParkResult(null), { parked: 0, skippedCount: 0, lines: [] })

// ข้อความที่ผู้ร้องเห็น: ไม่สัญญากำหนดเวลา ไม่ใช่การปฏิเสธ ไม่เปิดเผยเหตุผลภายใน
assert(PARKED_PUBLIC_NOTE.includes('ยังไม่มีกำหนด'))
assert(!/ปฏิเสธ|ภายใน\s*\d|วันทำการ|งบประมาณ|แผนพัฒนา/.test(PARKED_PUBLIC_NOTE), 'ข้อความถึงผู้ร้องต้องไม่ผูกพันเวลา/ไม่เปิดเหตุผลภายใน')
assert.equal(PARKED_LABEL, 'ขึ้นทะเบียนรอดำเนินการ')

// ── 3) รหัส/ป้ายเหตุผลตรงกับ DB ───────────────────────────────────────────────
const m1 = readText('supabase/migrations/20261025100000_complaint_parked_columns.sql')
const m2 = readText('supabase/migrations/20261025100100_complaint_parked_functions.sql')
const m3 = readText('supabase/migrations/20261025100200_complaint_stats_parked.sql')
const m2code = noComments(m2)

const checkList = /parked_reason IN \(([^)]*)\)/.exec(m2code)?.[1] ?? ''
const sqlCodes = [...checkList.matchAll(/'([a-z]+)'/g)].map((m) => m[1])
assert.deepEqual(sqlCodes, PARK_REASONS.map((r) => r.code), 'CHECK complaints_parked_reason_check ต้องตรง PARK_REASONS ตามลำดับ')
const caseBlock = /v_label := CASE p_reason([\s\S]*?)END;/.exec(m2code)?.[1] ?? ''
const sqlLabels = Object.fromEntries([...caseBlock.matchAll(/WHEN '([a-z]+)'\s+THEN '([^']+)'/g)].map((m) => [m[1], m[2]]))
assert.deepEqual(sqlLabels, Object.fromEntries(PARK_REASONS.map((r) => [r.code, r.label])), 'ป้ายเหตุผลใน park_complaints() ต้องตรง PARK_REASONS')
assert(m2code.includes("cardinality(v_ids) > 200"), 'เพดานต่อครั้งใน DB ต้องเท่า PARK_BULK_MAX')
assert(m2code.includes('char_length(v_note) > 500'), 'เพดานหมายเหตุใน DB ต้องเท่า PARK_NOTE_MAX')
assert(m2code.includes("IN ('received', 'in_progress')") && PARKABLE_STATUSES.join() === 'received,in_progress', 'สถานะที่พักได้ต้องตรงกัน')
assert(m2code.includes("IN ('admin', 'superadmin', 'officer')"), 'บทบาทที่พักได้ต้องตรง PARK_ROLES')
assert.equal((m2code.match(/IN \('admin', 'superadmin', 'officer'\)/g) ?? []).length, 2, 'ทั้ง park และ unpark ต้องจำกัดบทบาทเดียวกัน')

// ── 4) ความปลอดภัยของ SQL ─────────────────────────────────────────────────────
// ฟังก์ชันตรวจสิทธิ์คืน NULL (ไม่ใช่ false) ได้ — ทุกจุดที่ใช้ใน IF ต้องห่อ coalesce ไม่งั้น NOT NULL = NULL แล้วปล่อยผ่าน
const rawCalls = (m2code.match(/NOT public\.complaint_worker_can_act\(/g) ?? []).length
assert.equal(rawCalls, 0, 'ห้ามใช้ NOT complaint_worker_can_act(...) ตรงๆ — ต้อง NOT coalesce(..., false)')
assert.equal((m2code.match(/NOT coalesce\(public\.complaint_worker_can_act\(v_c\), false\)/g) ?? []).length, 2)
// trigger function ต้อง RETURN ทุกเส้นทาง (NOTES ข้อ 5: เคยพังเงียบด้วย 2F005 มาแล้ว)
const guardFn = /CREATE OR REPLACE FUNCTION public\.guard_complaint_parked\(\)[\s\S]*?\n\$\$;/.exec(m2code)?.[0] ?? ''
assert(guardFn.length > 200, 'ไม่พบ guard_complaint_parked')
assert((guardFn.match(/RETURN NEW;/g) ?? []).length >= 3, 'trigger ต้อง RETURN NEW ทุกทาง (INSERT / ออกจาก parked / ปกติ)')
assert(/BEFORE INSERT OR UPDATE OF status, parked_at, parked_by, parked_reason ON public\.complaints/.test(m2code))
for (const sig of ['park_complaints(uuid[], text, text)', 'unpark_complaint(uuid)']) {
  assert(m2code.includes(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon;`), `${sig} ต้องไม่ให้ anon เรียก`)
  assert(m2code.includes(`GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated;`))
}
assert(m2code.includes('REVOKE EXECUTE ON FUNCTION public.guard_complaint_parked() FROM PUBLIC, anon, authenticated;'))
assert(/SET search_path = pg_catalog, public/.test(m2code), 'SECURITY DEFINER ต้องตั้ง search_path')
// เฟสต้องมี guard กันรันผิดลำดับ (NOTES ข้อ 3) และ DDL ที่เพิ่มคอลัมน์ต้องไม่อยู่ไฟล์เดียวกับ CHECK ที่อ้างคอลัมน์นั้น
assert(m2.includes('ต้องรัน 20261025100000') && m3.includes('ต้องรัน 20261025100000'))
assert(!/parked_at\s*IS NOT NULL/.test(noComments(m1)), 'CHECK ที่อ้าง parked_at ต้องอยู่ไฟล์เฟสถัดไป ไม่ใช่ไฟล์ที่ ADD COLUMN')
assert(/ADD COLUMN IF NOT EXISTS allow_parking boolean NOT NULL DEFAULT false/.test(m1), 'ธงรายหมวดต้องปิดเป็นค่าตั้งต้น')
// CHECK สถานะ: ค่าเดิมจาก production ครบทั้ง 8 + parked (CREATE ทับทั้งก้อน ห้ามทำของเดิมหาย)
const statusList = /complaints_status_check\s+CHECK \(status IN \(([^)]*)\)\)/.exec(noComments(m1))?.[1] ?? ''
const statuses = [...statusList.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
assert.deepEqual(statuses, ['closed', 'completed', 'done', 'in_progress', 'new', 'parked', 'pending', 'received', 'rejected'])
// สถิติ: คีย์เดิมครบ + parked เฉพาะเมื่อ > 0 + ไม่แตะ GRANT
for (const key of ['total', 'open', 'in_progress', 'resolved', 'rejected', 'avg_days', 'this_month']) {
  assert.equal((noComments(m3).match(new RegExp(`'${key}',\\s+(?:count|round)`, 'g')) ?? []).length, 2, `${key} ต้องอยู่ครบทั้ง complaint_stats และ complaint_stats_fy`)
}
assert.equal((noComments(m3).match(/CASE WHEN count\(\*\) FILTER \(WHERE status = 'parked'\) > 0/g) ?? []).length, 2, 'คีย์ parked เฉพาะเมื่อ > 0 (ชุดสรุปรายเดือนที่ล็อกเทียบทั้งก้อน)')
assert(!/\b(GRANT|REVOKE)\b/.test(noComments(m3)), 'migration สถิติต้องไม่แตะสิทธิ์ EXECUTE เดิม')

// ── 5) ข้อมูลติดต่อ: ไม่มีกำหนดระหว่างรอดำเนินการ (เจ้าของระบบสั่ง 2569-10-24) ───────────────────────────
const migrationsDir = path.join(root, 'supabase/migrations')
for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))) {
  const sql = noComments(readText(`supabase/migrations/${file}`))
  const anchorDef = /FUNCTION public\.complaint_contact_retention_anchor[\s\S]*?\$\$;/.exec(sql)?.[0]
  if (anchorDef) assert(!anchorDef.includes('parked'), `${file}: 'parked' ห้ามอยู่ในหมุดเวลานับ 5 ปี — ต้องถามเจ้าของระบบ/DPO ก่อน`)
}

// ── 6) หน้าติดตามเรื่องของผู้ร้อง ────────────────────────────────────────────────
const steps = buildTrackSteps({
  status: 'parked', created_at: '2026-10-20T03:00:00Z', due_date: '2026-10-23', closed_at: null,
  timeline: [{ status: 'received', at: '2026-10-20T03:01:00Z' }, { status: 'parked', at: '2026-10-25T02:00:00Z' }],
})
assert.deepEqual(steps.map((s) => [s.key, s.state]), [['received', 'done'], ['parked', 'hold']])
assert.equal(steps[1].label, PARKED_LABEL); assert.equal(steps[1].at, '2026-10-25T02:00:00Z')
assert(!steps.some((s) => s.key === 'done'), 'ต้องไม่โชว์ขั้น "ดำเนินการแล้ว"/วันกำหนดเสร็จเดิมให้ผู้ร้อง')
assert(!JSON.stringify(steps).includes('2026-10-23') && !steps.some((s) => s.state === 'stop'), 'ไม่แสดงวันกำหนดเดิม และไม่ใช่ stop (ไม่ใช่การปฏิเสธ)')
// สถานะอื่นต้องไม่เปลี่ยน
assert.deepEqual(buildTrackSteps({ status: 'received', created_at: '2026-10-20T03:00:00Z', due_date: '2026-10-23', timeline: [] }).map((s) => s.key), ['received', 'in_progress', 'done'])

// ── 7) สรุปรายเดือน/ล็อกตัวเลข ───────────────────────────────────────────────────
const period = { key: '2569-10', label: 'ตุลาคม 2569', start: new Date('2026-10-01T00:00:00+07:00'), end: new Date('2026-10-31T00:00:00+07:00') }
const sumArgs = (stats) => ({ stats, rows: [], labelOf: (c) => c, tenantName: 'ทต.ทดสอบ', period, now: new Date('2026-11-05T10:00:00+07:00'), categoryCounts: [] })
try {
  const withParked = summarizeMonth(sumArgs({ total: 30, open: 2, in_progress: 3, resolved: 2, rejected: 0, parked: 23 }))
  assert.equal(withParked.parked, 23); assert.equal(withParked.ongoing, 5, 'ไม่นับเรื่องที่พักเป็น "อยู่ระหว่างดำเนินการ"')
  assert(withParked.narrative.includes('ขึ้นทะเบียนรอดำเนินการ 23 เรื่อง'))
  assert.equal(withParked.resolved + withParked.ongoing + withParked.rejected + withParked.parked, withParked.total)
  const none = summarizeMonth(sumArgs({ total: 30, open: 25, in_progress: 3, resolved: 2, rejected: 0 }))
  assert.equal(none.parked, 0); assert(!none.narrative.includes('ขึ้นทะเบียน'), 'ไม่มีเรื่องพัก = ข้อความรายงานเดิมไม่เปลี่ยน')
} catch (error) {
  if (error?.code === 'ERR_ASSERTION') throw error
  throw new Error(`summarizeMonth เรียกไม่ได้ในเทสต์นี้ — ตรวจพารามิเตอร์ใน tests/complaint-monthly-summary.test.mjs: ${error.message}`)
}
assert(STAT_FIELDS.some((f) => f.key === 'parked'))
assert.deepEqual(statsDifferences({ total: 5, open: 1 }, { total: 5, open: 1 }), [], 'ชุดที่ล็อกเก่าไม่มีคีย์ parked + สดไม่มีคีย์ = ไม่ต่าง')
assert.deepEqual(statsDifferences({ total: 5 }, { total: 5, parked: 2 }).map((d) => d.key), ['parked'])

// ── 8) หน้าจอทุกจุดที่ไล่สถานะต้องรู้จัก parked ───────────────────────────────────
const src = (file) => readText(file)
for (const [file, pattern] of [
  ['src/components/admin/ComplaintsManager.jsx', /parked:\s+\{ label: PARKED_LABEL/],
  ['src/pages/StaffDashboard.jsx', /parked:\s+\{ label: PARKED_LABEL/],
  ['src/pages/MyComplaints.jsx', /parked:\s+\{ label: PARKED_LABEL/],
  ['src/components/admin/ReportManager.jsx', /parked:\s+\{ label: 'ขึ้นทะเบียนรอดำเนินการ'/],
  ['src/components/datacenter/DataCenterMapView.jsx', /parked: 'ขึ้นทะเบียนรอดำเนินการ'/],
  ['src/pages/ComplaintStats.jsx', /key: 'parked'/],
]) assert(pattern.test(src(file)), `${file} ต้องรู้จักสถานะ parked (ไม่งั้นป้ายหายหรือเป็นรหัสดิบ)`)

const manager = src('src/components/admin/ComplaintsManager.jsx')
assert(/const STATUS_MAIN = \[[^\]]*'parked'\]/.test(manager), 'แท็บกรองสถานะต้องมี parked')
assert(/isParked\(status\)\) return null/.test(manager), 'SlaBadge ต้องซ่อนเมื่อ parked (ไม่ขึ้นเกินกำหนด)')
assert(/key !== 'closed' && \(key !== 'parked' \|\| isParked\(c\.status\)\)/.test(manager), 'ช่องเปลี่ยนสถานะตรงของแอดมินต้องไม่ให้เลือก parked (ต้องผ่านปุ่มพักเรื่อง)')
assert(/if \(val === 'parked'\) return/.test(manager))
assert(/ROW_GROUP_RANK = \{ open: 0, parked: 1, settled: 2 \}/.test(manager), 'เรื่องที่พักเป็นกลุ่มคั่นกลาง ไม่ปนงานค้างหรืองานที่จบแล้ว')
assert(/canParkWork\(c, currentUserId/.test(manager) && /<ParkComplaintDialog/.test(manager))
assert(/fetchParkingCategories/.test(manager) && !/select\('value, label, emoji, is_adhoc, requires_manual_intake, allow_parking/.test(manager),
  'ธง allow_parking ต้องดึงแยก — deploy ก่อน apply migration ต้องไม่ทำให้คิวรีหมวดหลักพัง (ชื่อหมวดหาย)')
const staff = src('src/pages/StaffDashboard.jsx')
assert(/departmentScoped=\{seesWholeDepartment\}/.test(staff) && /onParkChanged/.test(staff), 'หัวหน้ากองต้องส่งสิทธิ์ระดับกองเข้าโมดัล')
assert(/'rejected', 'parked'\]/.test(staff))
assert(/\.neq\('status', 'parked'\)/.test(src('src/pages/TechnicianDashboard.jsx')), 'งานของช่างต้องไม่รวมเรื่องที่พักไว้')
assert(/\['completed', 'closed', 'done', 'rejected', 'parked'\]/.test(src('src/components/admin/ReportManager.jsx')), 'รายงานค้างนานต้องไม่รวมเรื่องที่พัก')
assert(/\['completed','rejected','parked'\]/.test(src('src/pages/AdminDashboard.jsx')))
assert(/function ParkingChip/.test(src('src/pages/AdminDashboard.jsx')) && /async function toggleParking/.test(src('src/pages/AdminDashboard.jsx')))
const dialog = src('src/components/complaints/ParkComplaintDialog.jsx')
assert(/PARK_REASONS\.map/.test(dialog) && /validateParkInput/.test(dialog) && /parkComplaints/.test(dialog))
assert(/ไม่แสดงให้ผู้ร้อง/.test(dialog), 'กล่องต้องบอกว่าเหตุผลไม่แสดงให้ผู้ร้อง')
// ไม่ยิง Telegram ตอนพัก (ชุดหลายสิบเรื่องท่วมกลุ่ม) — แต่นำกลับเข้าคิวแจ้งตามปกติ
const finishLib = src('src/lib/complaintFinish.js')
const parkFn = /export async function parkComplaints[\s\S]*?\n}\n/.exec(finishLib)?.[0] ?? ''
assert(parkFn.includes("rpc('park_complaints'") && !parkFn.includes('notifyTelegram'))
assert(/export async function unparkComplaint[\s\S]*?notifyTelegram/.test(finishLib))

console.log('ALL PASS complaint-parked')

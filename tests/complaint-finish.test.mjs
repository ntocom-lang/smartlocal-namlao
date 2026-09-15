// ผู้รับผิดชอบปิดงานเอง + ปักหมุด + เปิดเรื่องกลับ 7 วัน + แก้ข้อความพร้อมประวัติ
// รันด้วย: node tests/complaint-finish.test.mjs
//
// ทำไมต้องมี: ปุ่มฝั่งหน้าเว็บตัดสินจาก src/lib/complaintWorkflow.js ส่วน DB ตัดสินจาก RPC ใน migration
// ถ้าสองฝั่งไม่ตรงกัน ปุ่มจะโผล่แล้วกดไม่ผ่าน (ผู้ใช้โทรหาแอดมิน) หรือกลับกันคือกดได้แต่ไม่เห็นปุ่ม
// เทสต์นี้ผูกตัวเลข/สถานะ/ชื่อธงของทั้งสองฝั่งไว้ด้วยกัน

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FINISHABLE_STATUSES,
  REOPEN_LIMIT,
  REOPEN_REASON_MAX,
  REOPEN_REASON_MIN,
  REOPEN_WINDOW_DAYS,
  canFinishWork,
  canStartWork,
  isComplaintWorker,
  isFinishedLike,
  reopenState,
  requiresResolvedPin,
  validateReopenReason,
} from '../src/lib/complaintWorkflow.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// git บน Windows (core.autocrlf=true) checkout ไฟล์ .sql เป็น CRLF — regex ที่มี \n ข้ามบรรทัดจะไม่ match
// ทั้งที่โค้ดถูก (เคยล้มบนเครื่องจริงหลัง merge #195) ต้องแปลงเป็น LF ก่อนตรวจเสมอ
const readText = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')
const fn = readText('supabase/migrations/20260915110100_complaint_finish_by_assignee.sql')
const ddl = readText('supabase/migrations/20260915110000_complaint_finish_columns.sql')
const sqlCode = fn.replace(/^\s*--.*$/gm, '')

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-15T10:00:00Z')
const base = { id: 'c1', status: 'received', category: 'light', assigned_to: 'u1', user_id: 'citizen', extra_data: {} }
const META = { light: { requires_resolved_location: true }, grievance: { requires_resolved_location: false }, odor: { is_adhoc: true } }

// ── ผู้ทำงาน ─────────────────────────────────────────────────────────────────
assert.equal(isComplaintWorker(base, 'u1', 'staff'), true, 'ผู้รับผิดชอบ role staff ต้องทำงานได้')
assert.equal(isComplaintWorker(base, 'u2', 'technician'), false)
assert.equal(isComplaintWorker(base, 'u2', 'admin'), true)
assert.equal(isComplaintWorker(base, 'u2', 'officer'), false, 'officer ต้องยืนยันว่ารายการกรองเฉพาะกองแล้วเท่านั้น')
assert.equal(isComplaintWorker(base, 'u2', 'officer', { departmentScoped: true }), true)
assert.equal(isComplaintWorker(base, null, 'admin'), false)

assert.equal(canStartWork(base, 'u1', 'staff', META), true)
assert.equal(canStartWork({ ...base, status: 'in_progress' }, 'u1', 'staff', META), false)
assert.equal(canStartWork({ ...base, category: 'odor' }, 'u1', 'staff', META), false, 'หมวดเฉพาะกิจไม่ใช้ขั้นตอนนี้')

for (const status of ['received', 'in_progress', 'done']) {
  assert.equal(canFinishWork({ ...base, status }, 'u1', 'staff', META), true, `ต้องกด "ดำเนินการแล้ว" ได้จาก ${status}`)
}
for (const status of ['pending', 'new', 'closed', 'completed', 'rejected']) {
  assert.equal(canFinishWork({ ...base, status }, 'u1', 'staff', META), false, `ต้องกด "ดำเนินการแล้ว" ไม่ได้จาก ${status}`)
}
assert.equal(isFinishedLike('done'), true)
assert.equal(isFinishedLike('closed'), true)
assert.equal(isFinishedLike('in_progress'), false)

// ── หมุด ─────────────────────────────────────────────────────────────────────
assert.equal(requiresResolvedPin(META, 'light'), true)
assert.equal(requiresResolvedPin(META, 'grievance'), false)
assert.equal(requiresResolvedPin(META, 'unknown'), true, 'ไม่รู้ธง = ขอหมุดไว้ก่อน')
assert.equal(requiresResolvedPin({}, 'light'), true)

// ── เปิดเรื่องกลับ ───────────────────────────────────────────────────────────
const finished = { ...base, status: 'closed', closed_at: new Date(NOW - 2 * DAY).toISOString() }
assert.deepEqual(reopenState(finished, 'citizen', NOW), { allowed: true, reason: '', daysLeft: 5 })
assert.equal(reopenState(finished, 'someone-else', NOW).reason, 'not_owner')
assert.equal(reopenState({ ...finished, closed_at: new Date(NOW - 7 * DAY - 1000).toISOString() }, 'citizen', NOW).reason, 'expired')
assert.equal(reopenState({ ...finished, closed_at: new Date(NOW - 7 * DAY + 60_000).toISOString() }, 'citizen', NOW).allowed, true,
  'ยังไม่ครบ 7 วันเต็มต้องยังเปิดกลับได้')
assert.equal(reopenState({ ...finished, extra_data: { reopen_count: 1 } }, 'citizen', NOW).reason, 'limit')
assert.equal(reopenState({ ...finished, status: 'in_progress' }, 'citizen', NOW).reason, 'not_finished')
assert.equal(reopenState({ ...finished, closed_at: null }, 'citizen', NOW).reason, 'not_finished', 'ใบเก่าไม่มี closed_at เปิดกลับไม่ได้')
assert.equal(reopenState({ ...finished, status: 'done' }, 'citizen', NOW).reason, 'not_finished', "'done' ขั้นเก่ายังไม่ถือว่าจบ")
assert.match(validateReopenReason('สั้น'), /อย่างน้อย 5/)
assert.equal(validateReopenReason('ไฟยังดับอยู่'), '')

// ── ต้องตรงกับ DB ─────────────────────────────────────────────────────────────
assert.match(sqlCode, new RegExp(`v_c.closed_at < now\\(\\) - interval '${REOPEN_WINDOW_DAYS} days'`))
assert.match(sqlCode, new RegExp(`IF v_count >= ${REOPEN_LIMIT} THEN`))
assert.match(sqlCode, new RegExp(`char_length\\(v_reason\\) < ${REOPEN_REASON_MIN} OR char_length\\(v_reason\\) > ${REOPEN_REASON_MAX}`))
assert.match(sqlCode, new RegExp(`v_c.status NOT IN \\(${FINISHABLE_STATUSES.map((st) => `'${st}'`).join(', ')}\\)`))
assert.match(sqlCode, /IF v_c.status <> 'received' THEN/, 'start_complaint_work เริ่มได้จาก received เท่านั้น')
// เปิดกลับไปผู้รับผิดชอบเดิมทันที (เจ้าของระบบกำหนด) — ไม่ใช่คิวแอดมิน ถ้าผู้รับผิดชอบยังอยู่
assert.match(sqlCode, /v_status := CASE WHEN v_keep THEN 'received' ELSE 'pending' END;/)
// ทุก RPC ต้องปลดธงด่าน staff ด้วยชื่อเดียวกับที่ด่านอ่าน
const setFlags = sqlCode.match(/set_config\('app\.complaint_workflow', '1', true\)/g) ?? []
assert.equal(setFlags.length, 4, 'start/finish/reopen/edit ต้องตั้งธง app.complaint_workflow ครบ 4 ตัว')
assert.match(sqlCode, /current_setting\('app\.complaint_workflow', true\), ''\) = '1' then/i)
// ด่านหมุดต้องทำงานก่อนด่านธง — ไม่งั้น RPC จะลอดการบังคับหมุด
const pinIdx = sqlCode.indexOf("RAISE EXCEPTION 'ต้องปักหมุดจุดที่ดำเนินการก่อน")
const flagIdx = sqlCode.indexOf("IF coalesce(current_setting('app.complaint_workflow', true), '') = '1' THEN\n    RETURN NEW;")
assert.ok(pinIdx > 0 && flagIdx > pinIdx, 'guard_complaint_final_close_role ต้องตรวจหมุดก่อนปล่อยผ่านด้วยธง')
// หมวดยกเว้นหมุดตั้งต้น
assert.match(ddl, /WHERE value IN \('corruption', 'grievance', 'tax', 'borrow_equipment', 'other'\)/)
// ประวัติข้อความแก้/ลบผ่าน API ไม่ได้
assert.match(ddl, /REVOKE ALL ON TABLE public\.complaint_text_revisions FROM PUBLIC, anon, authenticated;\s*GRANT SELECT ON TABLE public\.complaint_text_revisions TO authenticated;/)

console.log('✓ complaint-finish: ผ่านทุกข้อ')

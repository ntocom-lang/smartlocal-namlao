// ระบบรับเรื่องคำร้องเอง — ตรวจตัวช่วยฝั่งหน้าเว็บ + ตรวจว่ากติกาใน migration ยังตรงกัน
// รันด้วย: node tests/complaint-intake.test.mjs
//
// ทำไมต้องมี: คิวแอดมินเหลือเฉพาะใบที่ระบบรับเองไม่ได้ ถ้าเหตุผลที่แสดงผิด แอดมินจะแก้ผิดจุด
// (เช่น ไปตั้งผู้รับผิดชอบทั้งที่จริงหมวดตั้งธงให้แอดมินรับเอง) และถ้าเงื่อนไขส่งคืนฝั่งหน้าเว็บ
// ไม่ตรงกับ DB ปุ่มจะโผล่แล้วกดไม่ผ่าน

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RETURNABLE_STATUSES,
  RETURN_REASON_MAX,
  RETURN_REASON_MIN,
  canReturnComplaint,
  complaintIntakeReason,
  validateReturnReason,
} from '../src/lib/complaintIntake.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migration = readFileSync(
  path.join(root, 'supabase/migrations/20260915100100_complaint_auto_receive.sql'), 'utf8')
const ddl = readFileSync(
  path.join(root, 'supabase/migrations/20260915100000_complaint_auto_receive_columns.sql'), 'utf8')

const META = {
  light: { is_adhoc: false, requires_manual_intake: false },
  corruption: { is_adhoc: false, requires_manual_intake: true },
  odor: { is_adhoc: true, requires_manual_intake: false },
}
const base = {
  status: 'pending', category: 'light', department_id: 'd1', assigned_to: 'u1', extra_data: {},
}

// ── เหตุผลที่ค้างคิวแอดมิน ─────────────────────────────────────────────────────
assert.equal(complaintIntakeReason({ ...base, status: 'received' }, META), null, 'ใบที่รับแล้วไม่ใช่งานของคิวแอดมิน')
assert.equal(complaintIntakeReason({ ...base, category: 'odor' }, META), null, 'หมวดเฉพาะกิจไม่ใช้ขั้นตอนรับเรื่อง')
assert.equal(complaintIntakeReason(base, META), null, 'ใบเก่าก่อนเปิดระบบ (ข้อมูลครบแต่ยัง pending) ไม่ต้องเดาเหตุผล')
assert.equal(complaintIntakeReason(null, META), null)

assert.deepEqual(
  complaintIntakeReason({ ...base, category: 'corruption' }, META),
  { kind: 'manual', text: 'หมวดนี้ต้องให้แอดมินรับเรื่องเอง' },
)
assert.equal(complaintIntakeReason({ ...base, department_id: null }, META).kind, 'no_department')
assert.equal(complaintIntakeReason({ ...base, assigned_to: null }, META).kind, 'unassigned')
assert.equal(complaintIntakeReason({ ...base, status: 'new', assigned_to: null }, META).kind, 'unassigned',
  'สถานะ new (ค่าใหม่ของ pending) ต้องนับเป็นรอรับเรื่องด้วย')

// ส่งคืนมาก่อนทุกเหตุผล — assigned_to ถูกล้างเป็น NULL ตอนส่งคืน ถ้าเช็ค unassigned ก่อน เหตุผลจริงจะหาย
const returned = {
  ...base, assigned_to: null,
  extra_data: { returned_at: '2026-09-15T03:00:00Z', returned_reason: '  เป็นงานของกองช่าง  ' },
}
assert.deepEqual(complaintIntakeReason(returned, META), { kind: 'returned', text: 'ผู้รับผิดชอบส่งคืน: เป็นงานของกองช่าง' })
assert.equal(
  complaintIntakeReason({ ...returned, extra_data: { returned_at: 'x' } }, META).text, 'ผู้รับผิดชอบส่งคืน')
// หมวดที่ไม่มีในแมป (แอดมินลบหมวดไปแล้ว) ต้องไม่พัง
assert.equal(complaintIntakeReason({ ...base, category: 'cat_gone', assigned_to: null }, META).kind, 'unassigned')
assert.equal(complaintIntakeReason({ ...base, assigned_to: null }).kind, 'unassigned')

// ── ส่งคืน ───────────────────────────────────────────────────────────────────
assert.equal(canReturnComplaint({ ...base, status: 'received' }, 'u1', META), true)
assert.equal(canReturnComplaint({ ...base, status: 'in_progress' }, 'u1', META), true)
assert.equal(canReturnComplaint({ ...base, status: 'received' }, 'u2', META), false, 'คนอื่นส่งคืนแทนไม่ได้')
assert.equal(canReturnComplaint({ ...base, status: 'done' }, 'u1', META), false)
assert.equal(canReturnComplaint({ ...base, status: 'pending' }, 'u1', META), false)
assert.equal(canReturnComplaint({ ...base, status: 'received', category: 'odor' }, 'u1', META), false)
assert.equal(canReturnComplaint({ ...base, status: 'received' }, null, META), false)

assert.match(validateReturnReason('สั้น'), /อย่างน้อย 5/)
assert.match(validateReturnReason('   ab   '), /อย่างน้อย/)
assert.equal(validateReturnReason('เป็นงานของกองช่าง'), '')
assert.match(validateReturnReason('ก'.repeat(RETURN_REASON_MAX + 1)), /ไม่เกิน 500/)

// ── ต้องตรงกับ DB ─────────────────────────────────────────────────────────────
assert.match(migration, new RegExp(`char_length\\(v_reason\\) < ${RETURN_REASON_MIN} OR char_length\\(v_reason\\) > ${RETURN_REASON_MAX}`))
assert.match(migration, new RegExp(`status NOT IN \\(${RETURNABLE_STATUSES.map((s) => `'${s}'`).join(', ')}\\)`))
// คีย์ต้องไม่ใช่ routed_at — MyComplaints.jsx ใช้คีย์นั้นแยกหมวดเฉพาะกิจ
assert.match(migration, /'auto_received_at', to_jsonb\(now\(\)\)/)
assert.doesNotMatch(migration.replace(/^\s*--.*$/gm, ''), /'routed_at'/)
// ชื่อ trigger ต้องเรียงหลังตัวที่เติม assigned_to / department_id (BEFORE trigger ยิงตามลำดับชื่อ)
const triggerName = 'trg_route_complaint_auto_receive'
for (const before of ['complaints_auto_assign', 'trg_resolve_complaint_routing', 'trg_route_adhoc_complaint']) {
  assert.ok(before < triggerName, `${triggerName} ต้องเรียงหลัง ${before}`)
}
assert.match(migration, new RegExp(`CREATE TRIGGER ${triggerName}\\s+BEFORE INSERT ON public\\.complaints`))
// ค่าตั้งต้น: แจ้งการทุจริตต้องให้แอดมินรับเรื่องเอง
assert.match(ddl, /SET requires_manual_intake = true\s+WHERE value = 'corruption'/)

console.log('✓ complaint-intake: ผ่านทุกข้อ')

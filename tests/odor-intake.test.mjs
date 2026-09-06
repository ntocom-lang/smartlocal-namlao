// ตรวจตัวแยกหมวดเฉพาะกิจ (src/lib/odorIntake.js) — รันเร็ว ไม่ต้องต่อฐานข้อมูล
//
// ทำไมต้องมีเทสต์ตัวนี้: isAdhocComplaint() เป็นตัวตัดสินว่าประชาชนจะเห็นอะไรในหน้าติดตามคำร้อง
// ถ้ามันตอบ true ให้คำร้องหมวดปกติ ผู้แจ้งจะไม่เห็นแถบความคืบหน้ากับกำหนดเวลาของเรื่องตัวเองเลย
// ถ้าตอบ false ให้หมวดเฉพาะกิจ ผู้แจ้งจะเห็น "เกินกำหนด N วันทำการ" นับขึ้นไม่มีวันหยุด
// ทั้งสองทางคือการให้ข้อมูลผิดกับประชาชน จึงล็อกพฤติกรรมไว้ด้วยเทสต์
//
//   node tests/odor-intake.test.mjs

import assert from 'node:assert/strict'
import { odorRoutedAt, isAdhocComplaint, odorIntakeText, ODOR_INTAKE_LABEL } from '../src/lib/odorIntake.js'

// ── หมวดปกติ: ไม่มีคีย์ทั้งสองตัว ต้องไม่ถูกมองว่าเป็นเฉพาะกิจเด็ดขาด ────────────
{
  const normal = { created_at: '2026-09-01T03:00:00Z', status: 'pending', extra_data: null }
  assert.equal(isAdhocComplaint(normal), false, 'คำร้องหมวดปกติต้องไม่ถูกมองว่าเป็นเฉพาะกิจ')
  assert.equal(odorRoutedAt(normal), null, 'ห้าม fallback ไป created_at เมื่อไม่ได้สั่ง')
  // มี extra_data แต่เป็นคีย์ของหมวดอื่น ก็ยังต้องไม่ใช่เฉพาะกิจ
  assert.equal(isAdhocComplaint({ created_at: '2026-09-01T03:00:00Z', extra_data: { issue_type: 'ไฟดับ' } }), false)
}

// ── หมวดเฉพาะกิจ: มี routed_at ที่ระบบประทับให้ ─────────────────────────────────
{
  const routed = { created_at: '2026-09-05T17:00:00Z', extra_data: { routed_at: '2026-09-05T17:00:00Z' } }
  assert.equal(isAdhocComplaint(routed), true)
  assert.equal(odorRoutedAt(routed).toISOString(), '2026-09-05T17:00:00.000Z')
  assert.ok(odorIntakeText(routed).startsWith(ODOR_INTAKE_LABEL))
}

// ── คำร้องเก่าที่เคยมีเจ้าหน้าที่กด "รับทราบ" จริงในสายงานก่อนหน้า ────────────────
// ต้องยังถูกมองว่าเป็นเฉพาะกิจ ไม่งั้นเรื่องเก่าจะกลับไปโชว์ stepper กับตัวนับ SLA อีก
{
  const legacy = { created_at: '2026-08-26T03:00:00Z', extra_data: { acknowledged_at: '2026-08-26T04:00:00Z' } }
  assert.equal(isAdhocComplaint(legacy), true)
  assert.equal(odorRoutedAt(legacy).toISOString(), '2026-08-26T04:00:00.000Z')
}

// ── routed_at ต้องชนะ acknowledged_at เสมอเมื่อมีทั้งคู่ ────────────────────────
{
  const both = {
    created_at: '2026-08-26T03:00:00Z',
    extra_data: { routed_at: '2026-08-26T03:00:00Z', acknowledged_at: '2026-08-27T09:00:00Z' },
  }
  assert.equal(odorRoutedAt(both).toISOString(), '2026-08-26T03:00:00.000Z')
}

// ── fallbackToCreated ใช้ได้เฉพาะที่รู้แน่ว่าเป็น odor และต้องไม่กระทบ isAdhocComplaint ──
{
  const noKeys = { created_at: '2026-09-01T03:00:00Z', extra_data: {} }
  assert.equal(odorRoutedAt(noKeys), null)
  assert.equal(odorRoutedAt(noKeys, { fallbackToCreated: true }).toISOString(), '2026-09-01T03:00:00.000Z')
  assert.equal(isAdhocComplaint(noKeys), false, 'isAdhocComplaint ต้องไม่เปิด fallback เอง')
  assert.equal(odorIntakeText(noKeys, { withTime: false }), ODOR_INTAKE_LABEL)
}

// ── ข้อมูลเพี้ยน/ไม่ครบ ต้องไม่พังและต้องไม่เดา ───────────────────────────────────
{
  assert.equal(odorRoutedAt(null), null)
  assert.equal(odorRoutedAt(undefined), null)
  assert.equal(isAdhocComplaint(null), false)
  assert.equal(odorRoutedAt({ extra_data: { routed_at: 'ไม่ใช่วันที่' } }), null, 'วันที่ผิดรูปแบบต้องคืน null')
  assert.equal(isAdhocComplaint({ extra_data: { routed_at: 'ไม่ใช่วันที่' } }), false)
}

console.log('✅ odor-intake: ผ่านทุกเคส')

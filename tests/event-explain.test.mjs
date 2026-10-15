// คำอธิบาย "ใครเห็น / ใครแก้ได้" ในปฏิทินกิจกรรม — node --test tests/event-explain.test.mjs
// ไม่ใช้เน็ต ไม่แตะฐานข้อมูล · ด่านจริงอยู่ที่ RLS (events) กับ RPC list_events_for_staff
// เทสต์ชุดนี้กันไม่ให้ "ถ้อยคำในหน้าจอ" กับ "กติกาจริงในฐานข้อมูล" หลุดกัน
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import {
  canEditEvent, audienceHint, lockedDetailNote, EDIT_RULE_NOTE, EDIT_BLOCKED_NOTE,
} from '../src/lib/eventExplain.js'

const read = async (rel) => (await readFile(new URL(rel, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const squash = (s) => s.replace(/\s+/g, ' ')

const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const DEPT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DEPT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ev = (o = {}) => ({ id: 'e1', created_by: OTHER, department_id: DEPT_B, audiences: ['staff'], ...o })

test('canEditEvent: ผู้ดูแลระบบแก้ได้ทุกรายการ', () => {
  assert.equal(canEditEvent(ev(), 'admin', ME, null), true)
  assert.equal(canEditEvent(ev(), 'superadmin', ME, null), true)
})

test('canEditEvent: ผู้ลงเองแก้ได้ ไม่ว่าบทบาทไหน', () => {
  for (const role of ['staff', 'officer', 'viewer', 'council', 'technician']) {
    assert.equal(canEditEvent(ev({ created_by: ME }), role, ME, null), true, role)
  }
})

test('canEditEvent: หัวหน้ากองแก้ได้เฉพาะกิจกรรมของกองตน', () => {
  const head = { is_dept_head: true, department_id: DEPT_A }
  assert.equal(canEditEvent(ev({ department_id: DEPT_A }), 'officer', ME, head), true)
  assert.equal(canEditEvent(ev({ department_id: DEPT_B }), 'officer', ME, head), false)
  // ไม่ใช่หัวหน้ากอง อยู่กองเดียวกันก็แก้ของคนอื่นไม่ได้
  assert.equal(canEditEvent(ev({ department_id: DEPT_A }), 'officer', ME, { is_dept_head: false, department_id: DEPT_A }), false)
  // กิจกรรมไม่มีกอง + หัวหน้าไม่มีกอง ต้องไม่จับคู่กันด้วย undefined === undefined
  assert.equal(canEditEvent(ev({ department_id: undefined }), 'officer', ME, { is_dept_head: true }), false)
})

test('canEditEvent: เจ้าหน้าที่ทั่วไปแก้ของคนอื่นไม่ได้ + ข้อมูลว่างไม่พัง', () => {
  assert.equal(canEditEvent(ev(), 'staff', ME, null), false)
  assert.equal(canEditEvent(ev({ created_by: null }), 'staff', ME, null), false)
  assert.equal(canEditEvent(ev({ created_by: null }), 'staff', null, null), false)
  assert.equal(canEditEvent(null, 'admin', ME, null), false)
})

test('canEditEvent: รายการส่วนตัวเป็นของเจ้าของคนเดียว (หัวหน้ากองก็ไม่เกี่ยว)', () => {
  const mine = ev({ is_personal: true, created_by: ME, department_id: undefined })
  assert.equal(canEditEvent(mine, 'staff', ME, null), true)
  const theirs = ev({ is_personal: true, created_by: OTHER, department_id: DEPT_A })
  assert.equal(canEditEvent(theirs, 'officer', ME, { is_dept_head: true, department_id: DEPT_A }), false)
})

test('กติกาแก้/ลบในหน้าจอตรงกับ policy ล่าสุดในฐานข้อมูล', async () => {
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  let latest = null
  for (const f of files) {
    const sql = await read(`../supabase/migrations/${f}`)
    if (sql.includes('CREATE POLICY "staff update events"')) latest = { f, sql }
  }
  assert.ok(latest, 'ไม่พบ policy "staff update events" ใน migration')
  for (const name of ['staff update events', 'staff delete events']) {
    const i = latest.sql.indexOf(`CREATE POLICY "${name}"`)
    assert.ok(i >= 0, `${latest.f} ไม่มี ${name}`)
    const body = squash(latest.sql.slice(i, i + 900))
    assert.match(body, /get_my_role\(\) = 'superadmin'/, `${name}: superadmin`)
    assert.match(body, /get_my_role\(\) = 'admin' AND municipality_id = get_my_municipality_id\(\)/, `${name}: admin`)
    assert.match(body, /created_by = auth\.uid\(\)/, `${name}: ผู้ลง`)
    assert.match(body, /can_manage_event_department\(municipality_id, department_id\)/, `${name}: หัวหน้ากอง`)
  }
})

test('กติกา "เปิดรายละเอียดได้" ใน RPC ตรงกับที่ข้อความในหน้าจออ้าง', async () => {
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  let latest = null
  for (const f of files) {
    const sql = await read(`../supabase/migrations/${f}`)
    if (/CREATE OR REPLACE FUNCTION public\.list_events_for_staff/.test(sql)) latest = sql
  }
  assert.ok(latest, 'ไม่พบ list_events_for_staff')
  const sql = squash(latest)
  assert.match(sql, /'public' = ANY\(COALESCE\(e\.audiences, ARRAY\[\]::text\[\]\)\)/, 'สาธารณะเห็นหมด')
  assert.match(sql, /a\.role IN \('admin', 'superadmin'\)/, 'ผู้ดูแลระบบ')
  assert.match(sql, /e\.created_by = a\.id/, 'ผู้ลง')
  assert.match(sql, /a\.is_dept_head AND a\.department_id IS NOT NULL AND e\.department_id = a\.department_id/, 'หัวหน้ากอง')
  assert.match(sql, /a\.role = 'viewer' AND 'management' = ANY/, 'ผู้บริหาร → management')
  assert.match(sql, /a\.role = 'council' AND 'council' = ANY/, 'สภา → council')
  assert.match(sql, /a\.role IN \('officer', 'staff', 'technician'\) AND 'staff' = ANY/, 'เจ้าหน้าที่/ช่าง → staff')
  // คนที่เปิดไม่ได้ยังเห็นแถว แต่ถูกตัดรายละเอียด/ไฟล์แนบ — ข้อความ "เห็นแค่ชื่อ วัน เวลา สถานที่" อิงข้อนี้
  assert.match(sql, /ARRAY\['description', 'attachment_url', 'attachment_urls'\]/)
})

test('audienceHint: ยังไม่เลือก / เลือกประชาชน / เลือกเฉพาะภายใน', () => {
  assert.equal(audienceHint([]).tone, 'none')
  assert.equal(audienceHint(undefined).tone, 'none')
  assert.match(audienceHint([]).text, /อย่างน้อย 1 กลุ่ม/)

  const pub = audienceHint(['public'])
  assert.equal(pub.tone, 'public')
  assert.match(pub.text, /ประชาชนทุกคน/)
  assert.match(pub.text, /ยังไม่ล็อกอิน/)
  assert.match(pub.text, /ข้อมูลส่วนบุคคล/)
  // ติ๊กประชาชนร่วมกับกลุ่มอื่น ผลคือสาธารณะ ต้องเตือนแบบสาธารณะ
  assert.equal(audienceHint(['staff', 'public']).tone, 'public')

  const staff = audienceHint(['staff'])
  assert.equal(staff.tone, 'internal')
  assert.match(staff.text, /เจ้าหน้าที่และช่าง/)
  assert.match(staff.text, /ประชาชนไม่เห็น/)
  assert.doesNotMatch(staff.text, /ประชาชนทุกคน/)
  assert.match(staff.text, /ผู้ดูแลระบบ/)
  assert.match(staff.text, /ชื่อ วัน เวลา สถานที่/)

  const multi = audienceHint(['management', 'council'])
  assert.match(multi.text, /ผู้บริหาร \/ /)
  assert.match(multi.text, /ผู้ลงกิจกรรม/)
})

test('lockedDetailNote: บอกกลุ่มที่เปิดได้ ข้ามค่าที่ไม่รู้จัก', () => {
  assert.equal(lockedDetailNote({ audiences: ['management'] }), 'เปิดดูรายละเอียดได้เฉพาะ: ผู้บริหาร')
  assert.equal(lockedDetailNote({ audiences: ['staff', 'management'] }), 'เปิดดูรายละเอียดได้เฉพาะ: เจ้าหน้าที่ / ผู้บริหาร')
  assert.equal(lockedDetailNote({ audiences: ['ไม่รู้จัก'] }), 'เปิดดูรายละเอียดไม่ได้')
  assert.equal(lockedDetailNote({}), 'เปิดดูรายละเอียดไม่ได้')
  assert.equal(lockedDetailNote(null), 'เปิดดูรายละเอียดไม่ได้')
})

test('ถ้อยคำเรื่องสิทธิ์แก้ไขบอกครบ 3 กลุ่มที่แก้ได้', () => {
  for (const text of [EDIT_RULE_NOTE, EDIT_BLOCKED_NOTE]) {
    assert.match(text, /ผู้ลง|ลงเอง/)
    assert.match(text, /หัวหน้ากอง/)
    assert.match(text, /ผู้ดูแลระบบ/)
  }
})

test('EventsManager: ไม่เขียนกติกาแก้/ลบซ้ำในไฟล์ และลบแล้วตรวจว่าลบได้จริงก่อนบันทึกประวัติ', async () => {
  const src = await read('../src/components/admin/EventsManager.jsx')
  assert.doesNotMatch(src, /isDepartmentHeadForEvent/, 'ใช้ canEditEvent จุดเดียว ห้ามเขียนกติกาซ้ำ')
  assert.doesNotMatch(src, /\['admin', 'superadmin'\]\.includes\(currentUserRole\) \|\| ev\.created_by/)
  const fn = src.slice(src.indexOf('async function handleDelete'), src.indexOf('// ตัวกรองกลุ่มเป้าหมาย'))
  assert.match(fn, /\.delete\(\)\.eq\('id', id\)\.select\('id'\)/, 'ต้องขอแถวที่ถูกลบกลับมาเพื่อรู้ว่าลบได้จริง')
  assert.ok(fn.indexOf(".delete().eq('id', id)") < fn.indexOf("action: 'delete'"), 'บันทึกประวัติหลังลบสำเร็จเท่านั้น')
  assert.match(fn, /setActionError/)
})

// ขั้นย่อย + วันหมดอายุใบอนุญาตก่อสร้าง (20261217100000/100100) — รันบน PostgreSQL จำลอง (PGlite) ไม่ต่อ Supabase จริง
//   ในเครื่อง: node tests/building-permit-status-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   หรือ env PATIENT_PGLITE_MODULE
//
// ตรวจ: สิทธิ์รายบทบาท (ตาม policy staff update document_requests), ด่านกันแก้ตรง/ยัดค่าตอนยื่น,
// กติกาเลขที่/วันที่, ย้อนขั้นล้างค่า, ไม่เปลี่ยน = ไม่ลง audit, audit ไม่มีข้อมูลผู้ยื่น

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const argIndex = process.argv.indexOf('--pglite')
const modulePath = (argIndex >= 0 ? process.argv[argIndex + 1] : null) || process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'ต้องระบุ --pglite <path ของ pglite/dist/index.js> หรือ env PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const read = async (file) => (await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')

// ฟังก์ชัน is_my_department ตัวจริงจาก migration
const scope = await read('20260802060000_scope_department_clerk_permissions.sql')
const at = scope.indexOf('CREATE OR REPLACE FUNCTION public.is_my_department')
assert.ok(at >= 0, 'หา is_my_department ไม่เจอ')
const isMyDeptFn = scope.slice(at, scope.indexOf('\n$$;', at) + 4)

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const T1 = id(1), T2 = id(2)
const D_ENG = id(31), D_CLERK = id(32)
const U = {
  admin: id(10), adminB: id(11), officerEng: id(12), officerClerk: id(13), staff: id(14), staffOther: id(15),
  citizen: id(16), super: id(17), officerNoDept: id(18), adminNoMuni: id(19), ghost: id(20),
}

const db = new PGlite()
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, municipality_id uuid, role text, full_name text, department_id uuid);
CREATE TABLE public.document_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL, user_id uuid, document_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending', department_id uuid, assigned_to uuid, requester_name text, permit_form_data jsonb);
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, actor_id uuid, actor_name text, actor_role text,
  action text NOT NULL, resource_type text NOT NULL, resource_id text, resource_label text, metadata jsonb,
  created_at timestamptz DEFAULT now());
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_department_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT department_id FROM public.profiles WHERE id = auth.uid() $$;
INSERT INTO public.municipalities VALUES ('${T1}'), ('${T2}');
INSERT INTO public.profiles VALUES
 ('${U.admin}', '${T1}', 'admin', 'Admin TEST', NULL), ('${U.adminB}', '${T2}', 'admin', 'AdminB TEST', NULL),
 ('${U.officerEng}', '${T1}', 'officer', 'Officer Eng TEST', '${D_ENG}'),
 ('${U.officerClerk}', '${T1}', 'officer', 'Officer Clerk TEST', '${D_CLERK}'),
 ('${U.staff}', '${T1}', 'staff', 'Staff TEST', '${D_ENG}'), ('${U.staffOther}', '${T1}', 'staff', 'Staff2 TEST', '${D_ENG}'),
 ('${U.citizen}', '${T1}', 'citizen', 'Citizen TEST', NULL), ('${U.super}', NULL, 'superadmin', 'Super TEST', NULL),
 ('${U.officerNoDept}', '${T1}', 'officer', 'Officer NoDept TEST', NULL), ('${U.adminNoMuni}', NULL, 'admin', 'Admin NoMuni TEST', NULL);
`)
await db.exec(isMyDeptFn)
await db.exec(await read('20261217100000_building_permit_status_columns.sql'))
await db.exec(await read('20261217100100_building_permit_status_rpc.sql'))
console.log('PASS migration 2 ไฟล์รันผ่านบนสคีมาจำลอง (รวม DO block ตรวจท้ายไฟล์)')

// ── helper ──────────────────────────────────────────────────────────────────
const actor = async (user) => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user || ''])
  await db.exec(`SET ROLE ${user ? 'authenticated' : 'anon'}`)
}
const internal = async () => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)")
}
const newReq = async ({ type = 'building_permit', status = 'processing', tenant = T1, dept = D_ENG, assigned = U.staff } = {}) => {
  await internal()
  const { rows } = await db.query(
    `INSERT INTO public.document_requests (municipality_id, user_id, document_type, status, department_id, assigned_to, requester_name)
     VALUES ($1, $2, $3, $4, $5, $6, 'ผู้ยื่น ทดสอบ') RETURNING id`, [tenant, U.citizen, type, status, dept, assigned])
  return rows[0].id
}
const row = async (rid) => { await internal(); return (await db.query('SELECT * FROM public.document_requests WHERE id = $1', [rid])).rows[0] }
const setStage = async (user, rid, stage, no = null, issued = null, exp = null) => {
  await actor(user)
  return (await db.query('SELECT public.set_building_permit_stage($1, $2, $3, $4::date, $5::date) AS v', [rid, stage, no, issued, exp])).rows[0].v
}
const audits = async (rid) => {
  await internal()
  return (await db.query("SELECT * FROM public.audit_logs WHERE resource_id = $1 ORDER BY created_at, id", [rid])).rows
}
const rejects = async (fn, pattern, label) => {
  await assert.rejects(fn, (e) => { assert.match(e.message, pattern, `${label}: ${e.message}`); return true })
  console.log(`PASS ${label}`)
}
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

// 1) เลื่อนขั้นตามลำดับ โดย staff ที่ถูกมอบหมาย
const r1 = await newReq()
let v = await setStage(U.staff, r1, 'doc_check')
assert.equal(v.changed, true)
assert.equal((await row(r1)).permit_stage, 'doc_check')
assert.equal((await row(r1)).permit_stage_by, U.staff)
console.log('PASS staff ที่ถูกมอบหมายเลื่อนขั้นได้ + บันทึกผู้เปลี่ยน')

// 2) ออกใบแล้ว พร้อมเลขที่/วันที่
v = await setStage(U.officerEng, r1, 'issued', '  12/2569 ', '2026-11-01', '2027-11-01')
const r1row = await row(r1)
assert.equal(r1row.permit_no, '12/2569')
assert.equal(String(r1row.permit_expires_on instanceof Date ? r1row.permit_expires_on.toISOString().slice(0, 10) : r1row.permit_expires_on), '2027-11-01')
console.log('PASS หัวหน้ากองที่ถือเรื่องตั้ง "ออกใบแล้ว" + เลขที่ (ตัดช่องว่าง) + วันหมดอายุ')

// 3) ไม่เปลี่ยน = ไม่ลง audit
const before = (await audits(r1)).length
v = await setStage(U.admin, r1, 'issued', '12/2569', '2026-11-01', '2027-11-01')
assert.equal(v.changed, false)
assert.equal((await audits(r1)).length, before)
console.log('PASS ส่งค่าเดิม = ไม่เขียน ไม่ลง audit')

// 4) audit มีค่าก่อน/หลัง ไม่มีชื่อผู้ยื่น
const logs = await audits(r1)
assert.equal(logs.length, 2)
assert.equal(logs[1].action, 'building_permit_stage')
assert.equal(logs[1].metadata.from.stage, 'doc_check')
assert.equal(logs[1].metadata.to.permit_no, '12/2569')
assert.ok(!JSON.stringify(logs).includes('ผู้ยื่น ทดสอบ'), 'audit ต้องไม่มีชื่อผู้ยื่น')
console.log('PASS audit มีค่าก่อน/หลัง และไม่มีชื่อผู้ยื่น')

// 5) ย้อนขั้นไปก่อนออกใบ = ล้างเลขที่/วันที่
await setStage(U.admin, r1, 'review')
const back = await row(r1)
assert.equal(back.permit_no, null); assert.equal(back.permit_expires_on, null)
console.log('PASS ย้อนขั้นก่อนออกใบ ล้างเลขที่/วันที่ (ค่าเดิมอยู่ใน audit)')
await setStage(U.admin, r1, null)
assert.equal((await row(r1)).permit_stage, null)
console.log('PASS ย้อนกลับไป "รับคำขอ" (NULL) ได้')

// 6) สิทธิ์
const r2 = await newReq()
await rejects(() => setStage(U.staffOther, r2, 'doc_check'), /ไม่มีสิทธิ์/, 'staff ที่ไม่ได้ถูกมอบหมาย แก้ไม่ได้')
await rejects(() => setStage(U.officerClerk, r2, 'doc_check'), /ไม่มีสิทธิ์/, 'หัวหน้ากองอื่น แก้ไม่ได้')
await rejects(() => setStage(U.adminB, r2, 'doc_check'), /ไม่มีสิทธิ์/, 'แอดมิน อปท. อื่น แก้ไม่ได้')
await rejects(() => setStage(U.citizen, r2, 'doc_check'), /ไม่มีสิทธิ์/, 'ประชาชนเจ้าของคำขอ แก้ไม่ได้')
await rejects(() => setStage(null, r2, 'doc_check'), /permission denied|ต้องเข้าสู่ระบบ/, 'ผู้ไม่ล็อกอิน (anon) เรียกไม่ได้')
// ผลตรวจรอบ 1 ข้อ 1: ค่า NULL ต้อง = ปฏิเสธ (plpgsql IF NOT (NULL) เคยปล่อยผ่าน)
const rUnassigned = await newReq({ assigned: null })
await rejects(() => setStage(U.staffOther, rUnassigned, 'issued', 'ปลอม'), /ไม่มีสิทธิ์/, 'staff กับคำขอที่ยังไม่มอบหมาย (assigned_to NULL) แก้ไม่ได้')
await rejects(() => setStage(U.ghost, rUnassigned, 'doc_check'), /ไม่มีสิทธิ์/, 'ผู้ล็อกอินที่ไม่มีแถว profiles แก้ไม่ได้')
await rejects(() => setStage(U.officerNoDept, rUnassigned, 'doc_check'), /ไม่มีสิทธิ์/, 'หัวหน้ากองที่ไม่มีกอง แก้ไม่ได้')
await rejects(() => setStage(U.adminNoMuni, rUnassigned, 'doc_check'), /ไม่มีสิทธิ์/, 'แอดมินที่ไม่มี อปท. แก้ไม่ได้')
const rNoDept = await newReq({ dept: null, assigned: null })
await rejects(() => setStage(U.officerNoDept, rNoDept, 'doc_check'), /ไม่มีสิทธิ์/, 'หัวหน้ากองไม่มีกอง กับคำขอไม่มีกอง แก้ไม่ได้')
assert.equal((await row(rUnassigned)).permit_stage, null)
v = await setStage(U.admin, rUnassigned, 'doc_check')
assert.equal(v.changed, true)
console.log('PASS แอดมิน อปท. เดียวกันแก้คำขอที่ยังไม่มอบหมายได้')
v = await setStage(U.super, r2, 'site_inspection')
assert.equal(v.changed, true)
console.log('PASS superadmin แก้ได้ทุก อปท.')

// 7) กติกาข้อมูล
await rejects(() => setStage(U.admin, r2, 'bogus'), /ขั้นไม่ถูกต้อง/, 'ขั้นนอกรายการ ถูกปฏิเสธ')
await rejects(() => setStage(U.admin, r2, 'review', '1/2569'), /กรอกเลขที่\/วันที่ใบอนุญาตได้เมื่อ/, 'ส่งเลขที่ตอนยังไม่ออกใบ ถูกปฏิเสธ')
await rejects(() => setStage(U.admin, r2, 'issued', '1/2569', '2569-11-01', '2570-11-01'), /ปี ค\.ศ\./, 'กรอกปี พ.ศ. ลงช่องวันที่ ถูกปฏิเสธ')
await rejects(() => setStage(U.admin, r2, 'issued', '1/2569', '2026-11-10', '2026-11-01'), /หลังวันออก/, 'วันหมดอายุก่อนวันออก ถูกปฏิเสธ')
await rejects(() => setStage(U.admin, r2, 'issued', '1/2569', '2099-01-01', '2099-12-01'), /อนาคต/, 'วันออกเป็นวันในอนาคต ถูกปฏิเสธ')
await rejects(() => setStage(U.admin, r2, 'issued', 'x'.repeat(61)), /60 ตัวอักษร/, 'เลขที่ยาวเกิน 60 ถูกปฏิเสธ')
v = await setStage(U.admin, r2, 'issued', null, today, null)
assert.equal(v.changed, true)
console.log('PASS ออกใบโดยยังไม่กรอกเลขที่/วันหมดอายุได้ (ไม่บังคับ) · วันออก = วันนี้ได้')

const rRejected = await newReq({ status: 'rejected' })
await rejects(() => setStage(U.admin, rRejected, 'issued'), /ปฏิเสธ\/ยกเลิก/, 'คำขอที่ถูกปฏิเสธ ตั้ง "ออกใบแล้ว" ไม่ได้')
const rOther = await newReq({ type: 'waste_collection_request' })
await rejects(() => setStage(U.admin, rOther, 'doc_check'), /เฉพาะคำขออนุญาตก่อสร้าง/, 'คำขอประเภทอื่น ใช้ไม่ได้')
await rejects(() => setStage(U.admin, id(999), 'doc_check'), /ไม่พบคำขอนี้ หรือไม่มีสิทธิ์/, 'id ที่ไม่มีอยู่ ตอบข้อความเดียวกับไม่มีสิทธิ์ (ไม่เปิดให้ไล่เดา id)')
// เลขที่/วันที่ส่งเป็นชุดใหม่เสมอ: collected ส่งค่าเดิมกลับ = คงไว้ · ส่ง NULL = ล้างช่องนั้น
const rKeep = await newReq()
await setStage(U.admin, rKeep, 'issued', '7/2569', '2026-11-01', '2027-11-01')
await setStage(U.admin, rKeep, 'collected', '7/2569', '2026-11-01', '2027-11-01')
assert.equal((await row(rKeep)).permit_no, '7/2569')
await setStage(U.admin, rKeep, 'collected', '7/2569', '2026-11-01', null)
assert.equal((await row(rKeep)).permit_expires_on, null)
console.log('PASS issued → collected ส่งค่าเดิมกลับ = คงไว้ · ส่ง NULL = ล้างช่องนั้น')

// 8) ด่านกันแก้ตรงจาก API
const r3 = await newReq()
await actor(U.admin)
await rejects(() => db.query(`UPDATE public.document_requests SET permit_expires_on = '2099-01-01' WHERE id = $1`, [r3]),
  /ผ่านปุ่มในหน้าเจ้าหน้าที่เท่านั้น|violates check/, 'แอดมินแก้คอลัมน์ใหม่ตรงๆ ไม่ได้')
await actor(U.admin)
await rejects(() => db.query(`UPDATE public.document_requests SET permit_stage = 'issued' WHERE id = $1`, [r3]),
  /ผ่านปุ่มในหน้าเจ้าหน้าที่เท่านั้น/, 'แอดมินตั้งขั้นตรงๆ ไม่ได้')
await actor(U.admin)
await db.query(`UPDATE public.document_requests SET status = 'completed', permit_stage = NULL WHERE id = $1`, [r3])
console.log('PASS แก้คอลัมน์อื่น (status) ตามเดิมได้ แม้ SET ค่าเดิมของคอลัมน์ใหม่ติดมาด้วย')
await actor(U.citizen)
await rejects(() => db.query(
  `INSERT INTO public.document_requests (municipality_id, user_id, document_type, permit_stage, permit_no) VALUES ($1, $2, 'building_permit', 'issued', 'ปลอม')`,
  [T1, U.citizen]), /ตอนยื่นคำขอไม่ได้/, 'ประชาชนยัดสถานะ "ออกใบแล้ว" ตอนยื่น ไม่ได้')
await actor(null)
await rejects(() => db.query(
  `INSERT INTO public.document_requests (municipality_id, document_type, permit_expires_on) VALUES ($1, 'building_permit', '2099-01-01')`,
  [T1]), /ตอนยื่นคำขอไม่ได้|violates check/, 'ผู้ไม่ล็อกอินยัดวันหมดอายุตอนยื่น ไม่ได้')
await actor(U.citizen)
await db.query(`INSERT INTO public.document_requests (municipality_id, user_id, document_type) VALUES ($1, $2, 'building_permit')`, [T1, U.citizen])
console.log('PASS ยื่นคำขอตามปกติ (ไม่มีคอลัมน์ใหม่) ยังได้')

// 9) SQL Editor / postgres แก้ด้วยมือได้
await internal()
await db.query(`UPDATE public.document_requests SET permit_stage = 'collected', permit_no = 'แก้มือ' WHERE id = $1`, [r3])
assert.equal((await row(r3)).permit_no, 'แก้มือ')
console.log('PASS postgres (SQL Editor) แก้ด้วยมือได้')

// 10) CHECK ระดับตาราง: ขั้นในคำขอประเภทอื่น
await internal()
await rejects(() => db.query(`UPDATE public.document_requests SET permit_stage = 'review' WHERE id = $1`, [rOther]),
  /permit_stage_check/, 'CHECK: ประเภทอื่นมีขั้นย่อยไม่ได้ แม้แก้ด้วยมือ')

// ผลตรวจรอบ 1 ข้อ 2: ขั้น NULL + มีเลขที่ ต้องถูก CHECK กัน (NULL IN (…) เคยได้ NULL = ผ่าน)
const rNull = await newReq()
await internal()
await rejects(() => db.query(`UPDATE public.document_requests SET permit_no = 'X' WHERE id = $1`, [rNull]),
  /permit_fields_check/, 'CHECK: ขั้น NULL + มีเลขที่ ถูกปฏิเสธ แม้แก้ด้วยมือ (postgres)')

console.log('\nทั้งหมดผ่าน')

// แก้ประเภทคำร้อง / ย้ายเรื่องค้างตามกองของประเภท (20261211100000) — รันบน PostgreSQL จำลอง (PGlite) ไม่ต่อ Supabase จริง
//   ในเครื่อง: node tests/complaint-change-category-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   หรือ env PATIENT_PGLITE_MODULE
//
// ทำไมต้องมี: กองของคำร้องถูก trigger guard_complaint_routing_scope() บังคับตามประเภททุกครั้งที่ UPDATE
// (ต้นเหตุเคส ES-69-0034 ใบพิมพ์ติดชื่อกองช่าง) — เทสต์นี้ดึง trigger ตัวจริงจากไฟล์ migration มาใช้
// แล้วตรวจว่า RPC ใหม่ได้กองตรงประเภท, สิทธิ์รายบทบาท, ไม่แตะเรื่องที่จบแล้ว, จัดผู้รับผิดชอบ/สถานะถูก, มีบันทึกย้อนตรวจ

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const argIndex = process.argv.indexOf('--pglite')
const modulePath = (argIndex >= 0 ? process.argv[argIndex + 1] : null) || process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'ต้องระบุ --pglite <path ของ pglite/dist/index.js> หรือ env PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const read = async (file) => (await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const M = '20261211100000_complaint_change_category.sql'

// ฟังก์ชันจริงจาก migration — เทสต์ตามการเปลี่ยนแปลงของมัน
const cut = (text, start) => {
  const at = text.indexOf(start)
  assert.ok(at >= 0, `หา ${start} ไม่เจอ`)
  return text.slice(at, text.indexOf('\n$$;', at) + 4)
}
const finish = await read('20260915110100_complaint_finish_by_assignee.sql')
const workerFn = cut(finish, 'CREATE OR REPLACE FUNCTION public.complaint_worker_can_act')
const routing = await read('20260901160000_complaint_routing_and_signatories.sql')
const routingFn = cut(routing, 'CREATE OR REPLACE FUNCTION public.guard_complaint_routing_scope')
assert.ok(routingFn.includes('NEW.department_id := v_category.department_id'), 'trigger กองตามประเภทเปลี่ยนไปแล้ว — ตรวจ RPC ใหม่')

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const T1 = id(1), T2 = id(2)
const D_ENG = id(31), D_CLERK = id(32), D_T2 = id(33)
const U = {
  admin: id(10), adminB: id(11), officerEng: id(12), officerClerk: id(13), staff: id(14),
  techEng: id(15), clerkDefault: id(16), super: id(17), techEng2: id(18),
}

async function baseSchema(db) {
  await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, slug text);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid, name text, short_name text, code text,
  sort_order int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, municipality_id uuid, role text, full_name text, department_id uuid);
CREATE TABLE public.complaint_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, value text, label text, department_id uuid,
  is_active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0, is_adhoc boolean NOT NULL DEFAULT false,
  requires_manual_intake boolean NOT NULL DEFAULT false);
CREATE TABLE public.category_assignments (municipality_id uuid, category text, technician_id uuid, sla_days int);
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL, category text NOT NULL, category_id uuid,
  department text, department_id uuid, assigned_to uuid, user_id uuid, status text NOT NULL DEFAULT 'pending',
  ref_no text, due_date date, extra_data jsonb, closed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT complaints_status_check CHECK (status IN ('new','in_progress','done','closed','rejected','pending','received','completed','parked')));
CREATE TABLE public.complaint_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), complaint_id uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  status text NOT NULL, note text, actor_name text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, actor_id uuid, actor_name text, actor_role text,
  action text NOT NULL, resource_type text NOT NULL, resource_id text, resource_label text, metadata jsonb,
  created_at timestamptz DEFAULT now());
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.complaint_category_is_adhoc(p_municipality_id uuid, p_category text) RETURNS boolean LANGUAGE sql STABLE
  SET search_path TO 'public', 'pg_temp'
  AS $$ SELECT COALESCE((SELECT cc.is_adhoc FROM public.complaint_categories cc WHERE cc.municipality_id = p_municipality_id AND cc.value = p_category), false) $$;
CREATE FUNCTION public.complaint_matches_my_department(p_department text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ select exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id
        where p.id = auth.uid() and p.municipality_id = d.municipality_id and p_department is not null
          and lower(btrim(p_department)) in (lower(btrim(d.name)), lower(btrim(coalesce(d.short_name, ''))), lower(btrim(coalesce(d.code, ''))))) $$;
`)
  await db.exec(workerFn)
  await db.exec(routingFn)
  await db.exec(`
CREATE TRIGGER trg_resolve_complaint_routing
BEFORE INSERT OR UPDATE OF municipality_id, category, category_id, department, department_id
ON public.complaints FOR EACH ROW EXECUTE FUNCTION public.guard_complaint_routing_scope();
INSERT INTO public.municipalities VALUES ('${T1}', 'one'), ('${T2}', 'two');
INSERT INTO public.departments (id, municipality_id, name, short_name, code) VALUES
 ('${D_ENG}', '${T1}', 'กองช่าง', 'ช่าง', 'ENG'), ('${D_CLERK}', '${T1}', 'สำนักปลัด', 'ปลัด', 'CLK'),
 ('${D_T2}', '${T2}', 'สำนักปลัด', 'ปลัด', 'CLK');
INSERT INTO public.profiles VALUES
 ('${U.admin}', '${T1}', 'admin', 'Admin TEST', NULL), ('${U.adminB}', '${T2}', 'admin', 'AdminB TEST', NULL),
 ('${U.officerEng}', '${T1}', 'officer', 'Officer Eng TEST', '${D_ENG}'), ('${U.officerClerk}', '${T1}', 'officer', 'Officer Clerk TEST', '${D_CLERK}'),
 ('${U.staff}', '${T1}', 'staff', 'Staff TEST', '${D_ENG}'), ('${U.techEng}', '${T1}', 'technician', 'Tech Eng TEST', '${D_ENG}'),
 ('${U.techEng2}', '${T1}', 'technician', 'Tech Eng2 TEST', '${D_ENG}'),
 ('${U.clerkDefault}', '${T1}', 'staff', 'Clerk Default TEST', '${D_CLERK}'), ('${U.super}', NULL, 'superadmin', 'Super TEST', NULL);
INSERT INTO public.complaint_categories (municipality_id, value, label, department_id, is_active, is_adhoc, requires_manual_intake) VALUES
 ('${T1}', 'water_supply', 'สนับสนุนน้ำอุปโภค', '${D_ENG}', true, false, false),
 ('${T1}', 'road', 'ถนนชำรุด', '${D_ENG}', true, false, false),
 ('${T1}', 'tree', 'ต้นไม้', '${D_CLERK}', true, false, false),
 ('${T1}', 'old_cat', 'หมวดเลิกใช้', '${D_CLERK}', false, false, false),
 ('${T1}', 'nodept', 'ไม่มีกอง', NULL, true, false, false),
 ('${T1}', 'odor', 'กลิ่นเหม็น', '${D_CLERK}', true, true, false),
 ('${T1}', 'corruption', 'แจ้งการทุจริต', '${D_CLERK}', true, false, true),
 ('${T2}', 'water_supply', 'สนับสนุนน้ำอุปโภค', '${D_T2}', true, false, false);
INSERT INTO public.category_assignments VALUES
 ('${T1}', 'water_supply', '${U.techEng}', 3), ('${T1}', 'tree', '${U.clerkDefault}', 3);
`)
}

const db = new PGlite()
await baseSchema(db)
await db.exec(await read(M))
console.log('PASS migration รันผ่านบนสคีมาจำลอง')

// ── helper ──────────────────────────────────────────────────────────────────
const actor = async (user) => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [user || '', user ? 'authenticated' : 'anon'])
  await db.exec(`SET ROLE ${user ? 'authenticated' : 'anon'}`)
}
const internal = async () => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false)")
}
let seq = 0
const newComplaint = async ({ tenant = T1, category = 'water_supply', status = 'received', assigned = U.techEng, closedAt = null } = {}) => {
  await internal()
  seq += 1
  const { rows } = await db.query(
    `INSERT INTO public.complaints (municipality_id, category, status, assigned_to, ref_no, closed_at, extra_data)
     VALUES ($1, $2, $3, $4, $5, $6, '{"auto_received_at":"2026-11-01"}'::jsonb) RETURNING id`,
    [tenant, category, status, assigned, `ES-69-${String(seq).padStart(4, '0')}`, closedAt])
  return rows[0].id
}
const row = async (cid) => { await internal(); return (await db.query('SELECT * FROM public.complaints WHERE id = $1', [cid])).rows[0] }
const change = async (user, cid, category, reason = 'ประชาชนเลือกประเภทผิด') => {
  await actor(user)
  return (await db.query('SELECT public.change_complaint_category($1, $2, $3) AS v', [cid, category, reason])).rows[0].v
}
const reroute = async (user, tenant, category, apply) => {
  await actor(user)
  return (await db.query('SELECT public.reroute_category_open_complaints($1, $2, $3) AS v', [tenant, category, apply])).rows[0].v
}
const rejects = async (fn, re) => { await assert.rejects(fn, re) }

// ── 0) ฟังก์ชันภายในเรียกจาก API ไม่ได้ ─────────────────────────────────────────
{
  const cid = await newComplaint()
  await actor(U.admin)
  await rejects(() => db.query("SELECT public.complaint_reroute_apply($1, 'tree', 'x', 'y')", [cid]), /permission denied/)
  await internal()
  console.log('PASS complaint_reroute_apply เรียกตรงจาก authenticated ไม่ได้')
}

// ── 1) เคสต้นเรื่อง: แอดมินแก้กองของประเภท → เรื่องค้างย้ายตาม ─────────────────────
{
  const open1 = await newComplaint({ status: 'received' })
  const open2 = await newComplaint({ status: 'pending', assigned: null })
  const done = await newComplaint({ status: 'completed', closedAt: '2026-11-10T03:00:00Z' })
  const otherTenant = await newComplaint({ tenant: T2, assigned: null })
  assert.equal((await row(open1)).department, 'กองช่าง', 'ตั้งต้นต้องเป็นกองช่างจาก trigger')

  await internal()
  await db.query(`UPDATE public.complaint_categories SET department_id = $1 WHERE municipality_id = $2 AND value = 'water_supply'`, [D_CLERK, T1])
  assert.equal((await row(open1)).department, 'กองช่าง', 'แก้กองของประเภทแล้ว เรื่องเดิมยังไม่ย้าย (ต้นเหตุ)')

  // นับก่อน (ไม่แตะข้อมูล)
  const dry = await reroute(U.admin, T1, 'water_supply', false)
  assert.equal(dry.count, 3, "รวมเรื่องจากเคส 0 ที่ยังค้าง")
  assert.equal(dry.moved, 0)
  assert.equal(dry.department, 'สำนักปลัด')
  assert.equal((await row(open1)).department_id, D_ENG, 'dry run ห้ามแตะข้อมูล')

  // สิทธิ์
  await rejects(() => reroute(U.officerClerk, T1, 'water_supply', true), /เฉพาะแอดมิน/)
  await rejects(() => reroute(U.adminB, T1, 'water_supply', true), /เฉพาะแอดมิน/)
  await rejects(() => reroute(null, T1, 'water_supply', true), /permission denied|เข้าสู่ระบบ/)

  const res = await reroute(U.admin, T1, 'water_supply', true)
  assert.equal(res.moved, 3)

  const r1 = await row(open1)
  assert.equal(r1.department_id, D_CLERK)
  assert.equal(r1.department, 'สำนักปลัด')
  // ช่างกองช่างไม่ใช่คนของกองใหม่ และผู้รับผิดชอบเริ่มต้นของประเภทยังเป็นช่างคนเดิม → ไม่มีใคร → กลับคิวแอดมิน
  assert.equal(r1.assigned_to, null)
  assert.equal(r1.status, 'pending')
  assert.equal(r1.extra_data.auto_received_at, undefined, 'กลับคิวแอดมินต้องลบป้ายระบบรับเรื่องเอง')
  const r2 = await row(open2)
  assert.equal(r2.department, 'สำนักปลัด')
  assert.equal(r2.status, 'pending')

  const rd = await row(done)
  assert.equal(rd.department_id, D_ENG, 'เรื่องที่จบแล้วห้ามแตะ — เอกสารที่ออกไปแล้วต้องคงเดิม')
  assert.equal((await row(otherTenant)).department_id, D_T2, 'ห้ามแตะหน่วยงานอื่น')

  await internal()
  const tl = (await db.query('SELECT note, actor_name, status FROM public.complaint_timeline WHERE complaint_id = $1', [open1])).rows
  assert.equal(tl.length, 1)
  assert.match(tl[0].note, /ย้ายจากกองช่างไปสำนักปลัด/)
  assert.match(tl[0].note, /รอแอดมินรับเรื่อง/)
  assert.equal(tl[0].actor_name, 'Admin TEST')
  const au = (await db.query("SELECT * FROM public.audit_logs WHERE resource_id = $1", [open1])).rows
  assert.equal(au.length, 1)
  assert.equal(au[0].action, 'reroute_department')
  assert.equal(au[0].actor_id, U.admin)
  assert.equal(au[0].metadata.from_department, 'กองช่าง')
  assert.equal(au[0].metadata.to_department, 'สำนักปลัด')

  // รันซ้ำ = ไม่มีอะไรให้ย้าย
  assert.equal((await reroute(U.admin, T1, 'water_supply', true)).count, 0)
  // superadmin ข้ามหน่วยงานได้ · ประเภทที่ไม่มีกอง/เฉพาะกิจ = 0 ไม่ raise
  assert.equal((await reroute(U.super, T2, 'water_supply', false)).count, 0)
  assert.equal((await reroute(U.admin, T1, 'nodept', false)).count, 0)
  assert.equal((await reroute(U.admin, T1, 'odor', false)).count, 0)
  // คืนค่าประเภทให้เคสถัดไป
  await internal()
  await db.query(`UPDATE public.complaint_categories SET department_id = $1 WHERE municipality_id = $2 AND value = 'water_supply'`, [D_ENG, T1])
  console.log('PASS แอดมินแก้กองของประเภท → เรื่องค้างย้ายตาม · เรื่องจบแล้ว/หน่วยงานอื่นไม่แตะ · มี timeline+audit')
}

// ── 2) แก้ประเภทรายเรื่อง ─────────────────────────────────────────────────────
{
  // หัวหน้ากองช่างแก้เรื่องของกองตัวเองไปประเภทของสำนักปลัด → ได้ผู้รับผิดชอบเริ่มต้นของประเภทใหม่
  // in_progress + เปลี่ยนคน → received (คนใหม่ยังไม่ได้เริ่มงาน)
  const cid = await newComplaint({ status: 'in_progress' })
  const res = await change(U.officerEng, cid, 'tree')
  assert.equal(res.department, 'สำนักปลัด')
  assert.equal(res.assigned_to, U.clerkDefault)
  assert.equal(res.assignee_changed, true)
  const r = await row(cid)
  assert.equal(r.category, 'tree')
  assert.equal(r.department_id, D_CLERK)
  assert.equal(r.department, 'สำนักปลัด')
  assert.equal(r.assigned_to, U.clerkDefault)
  assert.equal(r.status, 'received')
  await internal()
  const tl = (await db.query('SELECT note FROM public.complaint_timeline WHERE complaint_id = $1', [cid])).rows
  assert.match(tl[0].note, /แก้ประเภทจาก "สนับสนุนน้ำอุปโภค" เป็น "ต้นไม้"/)
  assert.match(tl[0].note, /ประชาชนเลือกประเภทผิด/)
  const au = (await db.query("SELECT action, actor_role FROM public.audit_logs WHERE resource_id = $1", [cid])).rows
  assert.equal(au[0].action, 'change_category')
  assert.equal(au[0].actor_role, 'officer')

  // หลังย้ายแล้ว หัวหน้ากองช่างแก้ต่อไม่ได้ (ไม่ใช่เรื่องของกองแล้ว) · หัวหน้าสำนักปลัดแก้ได้
  await rejects(() => change(U.officerEng, cid, 'road'), /เฉพาะผู้ทำงาน/)
  const back = await change(U.officerClerk, cid, 'road')
  assert.equal(back.department, 'กองช่าง')
  // ผู้รับผิดชอบเริ่มต้นของ road ไม่ได้ตั้ง → ไม่มีใคร → กลับคิวแอดมิน
  assert.equal((await row(cid)).status, 'pending')
  console.log('PASS หัวหน้ากองแก้ประเภท → กองตามประเภท + ผู้รับผิดชอบเริ่มต้น · กองเดิมแก้ต่อไม่ได้')
}
{
  // ผู้รับผิดชอบเดิมอยู่กองใหม่อยู่แล้ว = คงไว้
  const cid = await newComplaint({ category: 'tree', assigned: U.clerkDefault })
  await internal()
  await db.query("INSERT INTO public.category_assignments VALUES ($1, 'old_cat', $2, 3)", [T1, U.admin])
  await rejects(() => change(U.admin, cid, 'old_cat'), /ปิดใช้งาน/)
  const cid2 = await newComplaint({ category: 'road', assigned: U.techEng2 })
  const res = await change(U.admin, cid2, 'water_supply')
  assert.equal(res.assigned_to, U.techEng2, 'คนของกองเดียวกันคงไว้ ไม่สลับเป็นผู้รับผิดชอบเริ่มต้น')
  assert.equal(res.assignee_changed, false)
  console.log('PASS ผู้รับผิดชอบที่อยู่กองใหม่คงไว้ · ประเภทที่ปิดใช้งานเลือกไม่ได้')
}

// ── 3) ด่านสิทธิ์และเงื่อนไข ────────────────────────────────────────────────────
{
  const cid = await newComplaint()
  await rejects(() => change(U.staff, cid, 'tree'), /เฉพาะหัวหน้ากองหรือแอดมิน/)
  await rejects(() => change(U.techEng, cid, 'tree'), /เฉพาะหัวหน้ากองหรือแอดมิน/)
  await rejects(() => change(U.officerClerk, cid, 'tree'), /เฉพาะผู้ทำงาน/)
  await rejects(() => change(U.adminB, cid, 'tree'), /เฉพาะผู้ทำงาน/)
  await rejects(() => change(null, cid, 'tree'), /permission denied|เข้าสู่ระบบ/)
  await rejects(() => change(U.admin, cid, 'tree', 'สั้น'), /5-500/)
  await rejects(() => change(U.admin, cid, 'water_supply'), /อยู่แล้ว/)
  await rejects(() => change(U.admin, cid, 'nodept'), /ยังไม่ได้ตั้งกอง/)
  // ประเภทเดิมที่ยังไม่ได้ตั้งกอง → บอกตรงๆ ไม่ใช่ "อยู่กองนี้อยู่แล้ว"
  const nodeptComplaint = await newComplaint({ category: 'nodept', assigned: null, status: 'pending' })
  await rejects(() => change(U.admin, nodeptComplaint, 'nodept'), /ยังไม่ได้ตั้งกองรับผิดชอบ/)
  await rejects(() => change(U.admin, cid, 'odor'), /เฉพาะกิจ/)
  await rejects(() => change(U.admin, cid, 'no_such'), /ไม่พบประเภท/)
  await rejects(() => change(U.officerEng, cid, 'corruption'), /แจ้งการทุจริต/)

  // เรื่องที่จบแล้ว: หัวหน้ากองแก้ไม่ได้ · ไม่มี closed_at แก้ไม่ได้ (ผู้ลงนามจะเลื่อนตาม updated_at)
  const doneByEng = await newComplaint({ status: 'closed', closedAt: '2026-11-10T03:00:00Z' })
  await rejects(() => change(U.officerEng, doneByEng, 'tree'), /เฉพาะแอดมิน/)
  const rejected = await newComplaint({ status: 'rejected' })
  await rejects(() => change(U.admin, rejected, 'tree'), /ไม่มีเวลาปิดเรื่อง/)
  const adhoc = await newComplaint({ category: 'odor', assigned: null })
  await rejects(() => change(U.admin, adhoc, 'tree'), /เฉพาะกิจ/)

  const r = await row(cid)
  assert.equal(r.category, 'water_supply', 'เคสที่ถูกปฏิเสธต้องไม่แตะข้อมูล')
  assert.equal(r.department_id, D_ENG)
  assert.equal((await row(doneByEng)).department_id, D_ENG)
  console.log('PASS ด่านสิทธิ์ครบ: staff/ช่าง/กองอื่น/หน่วยงานอื่น/ไม่ล็อกอินถูกกัน · เรื่องจบ(หัวหน้ากอง/ไม่มี closed_at)/เฉพาะกิจ/ทุจริตถูกกัน')
}
{
  // เคสจริง ES-69-0034 (ทุ่งแค้ว): เรื่องปิดแล้ว ประเภทถูก แต่กองค้างกองเดิมเพราะแอดมินแก้กองของประเภททีหลัง
  const closed = await newComplaint({ status: 'closed', closedAt: '2026-11-17T08:00:00Z' })
  const before = await row(closed)
  await internal()
  await db.query(`UPDATE public.complaint_categories SET department_id = $1 WHERE municipality_id = $2 AND value = 'water_supply'`, [D_CLERK, T1])
  assert.equal((await reroute(U.admin, T1, 'water_supply', false)).count >= 0, true)
  // ย้ายทั้งชุดไม่แตะเรื่องที่จบแล้ว
  await reroute(U.admin, T1, 'water_supply', true)
  assert.equal((await row(closed)).department_id, D_ENG, 'ย้ายทั้งชุดต้องไม่แตะเรื่องที่ปิดแล้ว')

  // แอดมินแก้เป็น "ประเภทเดิม" → ย้ายตามกองปัจจุบันของประเภท · ผู้รับผิดชอบ/สถานะ/closed_at คงเดิม
  const res = await change(U.admin, closed, 'water_supply', 'ใบพิมพ์ติดชื่อกองช่าง ใช้งานไม่ได้')
  assert.equal(res.department, 'สำนักปลัด')
  const after = await row(closed)
  assert.equal(after.department_id, D_CLERK)
  assert.equal(after.department, 'สำนักปลัด')
  assert.equal(after.status, 'closed')
  assert.equal(after.assigned_to, before.assigned_to, 'คนที่ทำงานจริงต้องคงเดิม')
  assert.equal(after.closed_at.toISOString(), before.closed_at.toISOString(), 'closed_at ต้องคงเดิม (ผู้ลงนาม ณ วันปิดเรื่อง)')
  await internal()
  // ไม่ลง timeline: ข่าวผลงานดึงแถว closed ล่าสุดไปเผยแพร่ → เหตุผลภายในจะหลุด · audit มีครบ
  const tl = (await db.query('SELECT 1 FROM public.complaint_timeline WHERE complaint_id = $1', [closed])).rows
  assert.equal(tl.length, 0, 'เรื่องที่ปิดแล้วต้องไม่มีแถว timeline ใหม่')
  const au = (await db.query('SELECT action, metadata FROM public.audit_logs WHERE resource_id = $1', [closed])).rows
  assert.equal(au.length, 1)
  assert.equal(au[0].action, 'reroute_department')
  assert.equal(au[0].metadata.reason, 'ใบพิมพ์ติดชื่อกองช่าง ใช้งานไม่ได้')
  assert.equal(au[0].metadata.to_status, 'closed')
  // แก้ซ้ำ = กองตรงแล้ว ไม่มีอะไรให้แก้
  await rejects(() => change(U.admin, closed, 'water_supply', 'ลองแก้ซ้ำอีกครั้ง'), /อยู่กองของประเภทนี้อยู่แล้ว/)
  // แอดมินแก้เรื่องที่ปิดแล้วไปประเภทอื่นก็ได้
  const done2 = await newComplaint({ status: 'completed', closedAt: '2026-11-12T03:00:00Z' })
  assert.equal((await change(U.admin, done2, 'tree')).status, 'completed')
  await internal()
  await db.query(`UPDATE public.complaint_categories SET department_id = $1 WHERE municipality_id = $2 AND value = 'water_supply'`, [D_ENG, T1])
  console.log('PASS เรื่องปิดแล้ว (เคส ES-69-0034): แอดมินย้ายตามกองของประเภทได้ · สถานะ/ผู้รับผิดชอบ/closed_at คงเดิม · ย้ายทั้งชุดไม่แตะ')
}
{
  // เรื่องที่ยังเปิด ประเภทเดิมแต่กองค้าง → หัวหน้ากองที่ถือเรื่องก็ย้ายได้
  const open = await newComplaint({ category: 'road', status: 'received', assigned: U.techEng2 })
  await internal()
  await db.query(`UPDATE public.complaint_categories SET department_id = $1 WHERE municipality_id = $2 AND value = 'road'`, [D_CLERK, T1])
  const res = await change(U.officerEng, open, 'road', 'ประเภทถูกแต่กองค้าง')
  assert.equal(res.department, 'สำนักปลัด')
  assert.equal((await row(open)).status, 'pending', 'ช่างกองช่างไม่ใช่คนของกองใหม่ → กลับคิวแอดมิน')
  await internal()
  await db.query(`UPDATE public.complaint_categories SET department_id = $1 WHERE municipality_id = $2 AND value = 'road'`, [D_ENG, T1])
  console.log('PASS ประเภทเดิมแต่กองค้าง (เรื่องเปิด) ย้ายได้')
}
{
  // แอดมินย้ายเข้าประเภทแจ้งการทุจริตได้ → ไม่ตั้งผู้รับผิดชอบ ให้แอดมินรับเรื่องเสมอ
  const cid = await newComplaint({ status: 'received' })
  const res = await change(U.admin, cid, 'corruption')
  assert.equal(res.assigned_to, null)
  assert.equal(res.status, 'pending')
  // timeline ของเรื่องทุจริตต้องไม่มีชื่อหมวด/เหตุผล (viewer/council อ่าน timeline ได้) — audit เก็บครบ
  await internal()
  const tl = (await db.query('SELECT note FROM public.complaint_timeline WHERE complaint_id = $1', [cid])).rows
  assert.equal(tl[0].note, 'แอดมินปรับประเภท/กองรับผิดชอบ')
  const au = (await db.query('SELECT metadata FROM public.audit_logs WHERE resource_id = $1', [cid])).rows
  assert.equal(au[0].metadata.to_category, 'corruption')
  assert.equal(au[0].metadata.reason, 'ประชาชนเลือกประเภทผิด')

  // parked + ได้ผู้รับผิดชอบในกองใหม่ → คงสถานะพัก
  const parked = await newComplaint({ status: 'parked' })
  const p = await change(U.admin, parked, 'tree')
  assert.equal(p.status, 'parked')
  // parked + ไม่มีผู้รับผิดชอบในกองใหม่ → กลับคิวแอดมิน (ไม่งั้นนำกลับเข้าคิวแล้วไม่มีเจ้าของเรื่อง)
  const parked2 = await newComplaint({ category: 'tree', status: 'parked', assigned: U.clerkDefault })
  const p2 = await change(U.admin, parked2, 'road')
  assert.equal(p2.assigned_to, null)
  assert.equal(p2.status, 'pending')
  console.log('PASS ประเภทที่ต้องให้แอดมินรับเรื่อง → ไม่ตั้งผู้รับผิดชอบ · timeline เรื่องทุจริตไม่เปิดหมวด · parked ไม่มีเจ้าของ → คิวแอดมิน')
}
{
  // ย้ายทั้งชุด: เรื่องที่ตรงกองอยู่แล้วตอนย้าย (ระหว่างนับกับย้าย) ถูกข้าม ไม่ล้มทั้งชุด — จำลองด้วยการนับแล้วแก้ตรงก่อนย้าย
  await internal()
  await db.query(`UPDATE public.complaint_categories SET department_id = $1 WHERE municipality_id = $2 AND value = 'road'`, [D_CLERK, T1])
  const pre = await reroute(U.admin, T1, 'road', false)
  assert.ok(pre.count >= 1)
  const res = await reroute(U.admin, T1, 'road', true)
  assert.equal(res.moved + res.skipped, res.count)
  assert.equal((await reroute(U.admin, T1, 'road', false)).count, 0)
  console.log('PASS ย้ายทั้งชุดคืนยอด moved/skipped ครบ')
}

await db.close()
console.log('ALL PASS complaint-change-category-db')

// มอบหมายผู้ไปแทนในกิจกรรมปฏิทิน — รัน migration จริง 2 ไฟล์ใน PostgreSQL จำลอง (PGlite 0.5.8)
// node tests/event-assignments-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง
//
// ตรวจ 4 เรื่อง: ใครบันทึกได้/ไม่ได้ · ข้อมูลที่ส่งมาถูกตรวจและแทนด้วยค่าจากฐานข้อมูล · ประวัติลง audit_logs
// · ใครเห็นการมอบหมายใน list_events_for_staff และอ่านตารางตรงได้แค่ไหน
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const sqlFile = (relative) => readFile(new URL(relative, import.meta.url), 'utf8')
const tableMigration = await sqlFile('../supabase/migrations/20261001120000_event_assignments_table.sql')
const rpcMigration = await sqlFile('../supabase/migrations/20261001120100_event_assignments_rpc.sql')

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)   // เทศบาลตำบล (อปท. ที่ทดสอบ)
const MB = id(2)   // อบต. อีกแห่ง
const D1 = id(11)  // กองที่สร้างกิจกรรมผู้บริหาร
const D2 = id(12)
const POS_MAYOR = id(21), POS_DEPUTY = id(22), POS_CHAIR = id(23), POS_DIRECTOR = id(24)

const U = {
  admin: id(101), creator: id(102), otherStaff: id(103), head: id(104), mayor: id(105),
  deputy: id(106), secretary: id(107), council: id(108), tech: id(109), citizen: id(110),
  noname: id(111), bStaff: id(112), bViewer: id(113), superadmin: id(114),
}
const E = { mgmt: id(201), staffOnly: id(202), council: id(203), publicMgmt: id(204), otherMuni: id(205), cascade: id(206) }

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE TABLE public.municipalities (id uuid PRIMARY KEY, org_type text);
CREATE TABLE public.positions (id uuid PRIMARY KEY, name text NOT NULL, category text, sort_order int, municipality_id uuid);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, full_name text, role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid REFERENCES public.municipalities(id), department_id uuid,
  is_dept_head boolean DEFAULT false, job_title text, position_id uuid REFERENCES public.positions(id)
);
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL REFERENCES public.municipalities(id),
  title text NOT NULL, description text, event_date date NOT NULL, event_time time, end_date date, location text,
  category text, is_all_day boolean, created_at timestamptz DEFAULT now(), updated_at timestamptz,
  attachment_url text, end_time time, created_by uuid, attachment_urls text[] NOT NULL DEFAULT '{}',
  audiences text[] NOT NULL DEFAULT '{}', department_id uuid
);
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, actor_id uuid, actor_name text,
  actor_role text, action text NOT NULL, resource_type text NOT NULL, resource_id text, resource_label text,
  metadata jsonb, created_at timestamptz DEFAULT now()
);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id() TO anon, authenticated;

INSERT INTO public.municipalities VALUES ('${MA}', 'เทศบาลตำบล'), ('${MB}', 'อบต.');
INSERT INTO public.positions VALUES
  ('${POS_MAYOR}',    'นายกเทศมนตรี / นายกองค์การบริหารส่วนตำบล',         'political_exec', 10,  '${MA}'),
  ('${POS_DEPUTY}',   'รองนายกเทศมนตรี / รองนายกองค์การบริหารส่วนตำบล',   'political_exec', 20,  '${MA}'),
  ('${POS_CHAIR}',    'ประธานสภา',                                         'council',        110, '${MA}'),
  ('${POS_DIRECTOR}', 'ผู้อำนวยการกองช่าง',                                'dept_head',      330, '${MA}');
INSERT INTO public.profiles (id, full_name, role, municipality_id, department_id, is_dept_head, job_title, position_id) VALUES
  ('${U.admin}',      'TEST แอดมิน',          'admin',      '${MA}', NULL,    false, NULL, NULL),
  ('${U.creator}',    'TEST ธุรการ',          'staff',      '${MA}', '${D1}', false, NULL, NULL),
  ('${U.otherStaff}', 'TEST เจ้าหน้าที่กองอื่น', 'staff',      '${MA}', '${D2}', false, NULL, NULL),
  ('${U.head}',       'TEST หัวหน้ากอง D1',   'staff',      '${MA}', '${D1}', true,  NULL, NULL),
  ('${U.mayor}',      'TEST นายก',            'viewer',     '${MA}', NULL,    false, NULL, '${POS_MAYOR}'),
  ('${U.deputy}',     'TEST รองนายก',         'viewer',     '${MA}', NULL,    false, NULL, '${POS_DEPUTY}'),
  ('${U.secretary}',  'TEST เลขาฯ',           'viewer',     '${MA}', NULL,    false, '  เลขานุการนายกเทศมนตรี  ', NULL),
  ('${U.council}',    'TEST ประธานสภา',       'council',    '${MA}', NULL,    false, NULL, '${POS_CHAIR}'),
  ('${U.tech}',       'TEST ผอ.กองช่าง',      'technician', '${MA}', '${D2}', false, NULL, '${POS_DIRECTOR}'),
  ('${U.citizen}',    'TEST ประชาชน',         'citizen',    '${MA}', NULL,    false, NULL, NULL),
  ('${U.noname}',     '   ',                  'staff',      '${MA}', NULL,    false, NULL, NULL),
  ('${U.bStaff}',     'TEST เจ้าหน้าที่ อปท.อื่น', 'staff',      '${MB}', NULL,    false, NULL, NULL),
  ('${U.bViewer}',    'TEST นายก อปท.อื่น',   'viewer',     '${MB}', NULL,    false, NULL, NULL),
  ('${U.superadmin}', 'TEST superadmin',      'superadmin', NULL,    NULL,    false, NULL, NULL);
INSERT INTO public.events (id, municipality_id, title, description, event_date, created_by, audiences, department_id, category) VALUES
  ('${E.mgmt}',       '${MA}', 'TEST ประชุมอำเภอ',       'วาระผู้บริหาร',  '2026-10-20', '${U.creator}', '{management}',        '${D1}', 'ประชุม'),
  ('${E.staffOnly}',  '${MA}', 'TEST ประชุมพนักงาน',     'วาระพนักงาน',   '2026-10-21', '${U.admin}',   '{staff}',             '${D2}', 'ประชุม'),
  ('${E.council}',    '${MA}', 'TEST ประชุมสภา',         'วาระสภา',       '2026-10-22', '${U.council}', '{council}',           NULL,    'ประชุม'),
  ('${E.publicMgmt}', '${MA}', 'TEST งานบุญประจำปี',     'เชิญร่วมงาน',    '2026-10-23', '${U.admin}',   '{public,management}', NULL,    'ประชาสัมพันธ์'),
  ('${E.otherMuni}',  '${MB}', 'TEST กิจกรรม อปท.อื่น',  'ของ อปท. อื่น',  '2026-10-24', '${U.bStaff}',  '{management}',        NULL,    'ประชุม'),
  ('${E.cascade}',    '${MA}', 'TEST จะถูกลบ',           NULL,            '2026-10-25', '${U.admin}',   '{management}',        NULL,    'ประชุม');
`)

// migration จริง — ไฟล์ตารางก่อน แล้วไฟล์ฟังก์ชัน (ไฟล์ 2 มีด่านตรวจว่าไฟล์ 1 รันแล้ว)
await db.exec(tableMigration)
await db.exec(rpcMigration)

const actor = async (user) => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user || ''])
  await db.exec(`SET ROLE ${user ? 'authenticated' : 'anon'}`)
}
const asRoot = async () => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', '', false)") }
const assign = async (user, eventId, task, behalf, people) => {
  await actor(user)
  return (await db.query('SELECT public.set_event_assignments($1::uuid, $2::text, $3::text, $4::jsonb) AS v',
    [eventId, task, behalf, JSON.stringify(people)])).rows[0].v
}
const listAs = async (user, muni = MA) => {
  await actor(user)
  return (await db.query('SELECT v FROM public.list_events_for_staff($1::uuid) AS v', [muni])).rows.map((r) => r.v)
}
const candidatesAs = async (user, muni = MA) => {
  await actor(user)
  return (await db.query('SELECT * FROM public.list_event_assignee_candidates($1::uuid)', [muni])).rows
}
const rowsOf = async (eventId) => {
  await asRoot()
  return (await db.query('SELECT profile_id, assignee_name, assignee_title, task, on_behalf_of, assigned_by FROM public.event_assignments WHERE event_id = $1 ORDER BY sort_order', [eventId])).rows
}
const auditCount = async (eventId) => {
  await asRoot()
  return Number((await db.query("SELECT count(*)::int AS n FROM public.audit_logs WHERE resource_id = $1 AND action = 'assign'", [eventId])).rows[0].n)
}
const rejects = async (promise, pattern, label) => {
  await assert.rejects(promise, pattern, label)
  await asRoot()
}

// ── ตัดชื่อตำแหน่งตามประเภท อปท. ───────────────────────────────────────────────────────────
await asRoot()
const title = async (job, pos, org) => (await db.query('SELECT public.event_assignee_title($1, $2, $3) AS t', [job, pos, org])).rows[0].t
assert.equal(await title(null, 'รองนายกเทศมนตรี / รองนายกองค์การบริหารส่วนตำบล', 'เทศบาลตำบล'), 'รองนายกเทศมนตรี')
assert.equal(await title(null, 'รองนายกเทศมนตรี / รองนายกองค์การบริหารส่วนตำบล', 'อบต.'), 'รองนายกองค์การบริหารส่วนตำบล')
assert.equal(await title(null, 'รองนายกเทศมนตรี / รองนายกองค์การบริหารส่วนตำบล', null), 'รองนายกองค์การบริหารส่วนตำบล', 'org_type ว่างตกฝั่ง อบต. ตาม DEFAULT_ORG_TYPE')
assert.equal(await title('  เลขานุการนายก ', 'อะไรก็ได้', 'เทศบาลตำบล'), 'เลขานุการนายก', 'job_title มาก่อนเสมอ')
assert.equal(await title('   ', 'ประธานสภา', 'เทศบาลตำบล'), 'ประธานสภา', 'job_title ช่องว่างล้วนต้องไม่บังทะเบียนตำแหน่ง')
assert.equal(await title(null, null, 'เทศบาลตำบล'), null)
await actor(U.admin)
await rejects(db.query("SELECT public.event_assignee_title('a', 'b', 'c')"), /permission denied/, 'ตัวช่วยตำแหน่งต้องไม่เปิดให้หน้าเว็บเรียกตรง')

// ── สิทธิ์บันทึก: คนสร้างกิจกรรม ────────────────────────────────────────────────────────────
// ส่งชื่อปลอมมากับ profile_id — ต้องถูกแทนด้วยชื่อ/ตำแหน่งจากฐานข้อมูล
let out = await assign(U.creator, E.mgmt, 'attend', 'นายกเทศมนตรี', [
  { profile_id: U.deputy, name: 'ชื่อปลอม', title: 'ตำแหน่งปลอม' },
  { name: '  นายสมมุติ ทดสอบ  ', title: ' รองนายกเทศมนตรี ' },
])
assert.equal(out.length, 2)
assert.equal(out[0].name, 'TEST รองนายก', 'ชื่อของผู้มีบัญชีต้องมาจากฐานข้อมูล ไม่ใช่ค่าที่หน้าจอส่ง')
assert.equal(out[0].title, 'รองนายกเทศมนตรี', 'ตำแหน่งตัดเหลือฝั่งเทศบาล')
assert.equal(out[0].profile_id, U.deputy)
assert.equal(out[0].assigned_by_name, 'TEST ธุรการ')
assert.ok(out[0].assigned_at, 'ต้องมีเวลาที่บันทึก')
assert.deepEqual([out[1].name, out[1].title, out[1].profile_id], ['นายสมมุติ ทดสอบ', 'รองนายกเทศมนตรี', null], 'ชื่อที่พิมพ์เองตัดช่องว่างหัวท้าย')
assert.ok(out.every((a) => a.task === 'attend' && a.on_behalf_of === 'นายกเทศมนตรี'))
assert.ok((await rowsOf(E.mgmt)).every((r) => r.assigned_by === U.creator), 'ผู้บันทึกประทับจากเซิร์ฟเวอร์')
assert.equal(await auditCount(E.mgmt), 1)
await asRoot()
const audit = (await db.query("SELECT actor_id, actor_role, resource_label, metadata FROM public.audit_logs WHERE resource_id = $1 ORDER BY created_at", [E.mgmt])).rows[0]
assert.equal(audit.actor_id, U.creator)
assert.equal(audit.resource_label, 'TEST ประชุมอำเภอ')
assert.deepEqual(audit.metadata.before, [])
assert.equal(audit.metadata.after.length, 2)

// บันทึกซ้ำค่าเดิม → ไม่เขียน audit เพิ่ม
await assign(U.creator, E.mgmt, 'attend', 'นายกเทศมนตรี', [{ profile_id: U.deputy }, { name: 'นายสมมุติ ทดสอบ', title: 'รองนายกเทศมนตรี' }])
assert.equal(await auditCount(E.mgmt), 1, 'ค่าไม่เปลี่ยนต้องไม่เพิ่มประวัติ')

// ── ผู้บริหาร (viewer) บนกิจกรรมกลุ่ม "ผู้บริหาร" ที่ไม่ได้สร้างเอง → ได้ ───────────────────────
out = await assign(U.mayor, E.mgmt, 'preside', 'นายกเทศมนตรี', [{ profile_id: U.tech }])
assert.equal(out.length, 1)
assert.deepEqual([out[0].name, out[0].title, out[0].task], ['TEST ผอ.กองช่าง', 'ผู้อำนวยการกองช่าง', 'preside'])
assert.equal(await auditCount(E.mgmt), 2)
out = await assign(U.secretary, E.publicMgmt, 'join', 'นายกเทศมนตรี', [{ profile_id: U.deputy }])
assert.equal(out.length, 1, 'เลขาฯ (viewer) บันทึกบนกิจกรรมที่มีกลุ่มผู้บริหารปนกลุ่มอื่นได้')

// ── ปฏิเสธ ───────────────────────────────────────────────────────────────────────────────
const one = [{ profile_id: U.deputy }]
await rejects(assign(U.mayor, E.staffOnly, 'attend', null, one), /ไม่มีสิทธิ์/, 'viewer บนกิจกรรมที่ไม่มีกลุ่มผู้บริหาร')
await rejects(assign(U.otherStaff, E.mgmt, 'attend', null, one), /ไม่มีสิทธิ์/, 'staff ที่ไม่ได้สร้างและไม่ใช่หัวหน้ากองนั้น')
await rejects(assign(U.council, E.mgmt, 'attend', null, one), /ไม่มีสิทธิ์/, 'สภาบนกิจกรรมผู้บริหาร')
await rejects(assign(U.bViewer, E.mgmt, 'attend', null, one), /ไม่มีสิทธิ์/, 'ผู้บริหารต่าง อปท.')
await rejects(assign(U.bStaff, E.mgmt, 'attend', null, one), /ไม่มีสิทธิ์/, 'เจ้าหน้าที่ต่าง อปท.')
await rejects(assign(U.citizen, E.mgmt, 'attend', null, one), /ไม่มีสิทธิ์/, 'ประชาชน')
await rejects(assign(null, E.mgmt, 'attend', null, one), /permission denied/, 'ผู้ไม่ล็อกอินเรียกฟังก์ชันไม่ได้เลย')
await rejects(assign(U.admin, id(999), 'attend', null, one), /ไม่พบกิจกรรม/)
assert.deepEqual((await rowsOf(E.mgmt)).map((r) => r.profile_id), [U.tech], 'ทุกครั้งที่ถูกปฏิเสธต้องไม่แตะของเดิม')

// ── ได้ตามกติกาเดียวกับสิทธิ์แก้ไขกิจกรรม ────────────────────────────────────────────────────
assert.equal((await assign(U.head, E.mgmt, 'attend', null, one)).length, 1, 'หัวหน้ากองของกิจกรรม')
assert.equal((await assign(U.council, E.council, 'attend', 'ประธานสภาเทศบาล', [{ profile_id: U.deputy }])).length, 1, 'สภาเป็นคนสร้างกิจกรรมเอง')
assert.equal((await assign(U.admin, E.staffOnly, 'join', null, [{ profile_id: U.tech }])).length, 1, 'แอดมินของ อปท.')
assert.equal((await assign(U.superadmin, E.otherMuni, 'attend', null, [{ profile_id: U.bStaff }])).length, 1, 'superadmin ข้าม อปท.')

// ── ตรวจข้อมูล — ผิดแล้วต้องไม่ลบของเดิม (ทั้งฟังก์ชันย้อนกลับ) ───────────────────────────────
const before = await rowsOf(E.mgmt)
await rejects(assign(U.admin, E.mgmt, 'attend', null, [{ profile_id: U.bStaff }]), /บุคลากรของหน่วยงานนี้/, 'คนต่าง อปท.')
await rejects(assign(U.admin, E.mgmt, 'attend', null, [{ profile_id: U.citizen }]), /บุคลากรของหน่วยงานนี้/, 'ประชาชนรับมอบหมายไม่ได้')
await rejects(assign(U.admin, E.mgmt, 'attend', null, [{ profile_id: U.noname }]), /ยังไม่มีชื่อ/)
await rejects(assign(U.admin, E.mgmt, 'attend', null, [{ profile_id: 'ไม่ใช่-uuid' }]), /รหัสบุคลากรไม่ถูกต้อง/)
await rejects(assign(U.admin, E.mgmt, 'attend', null, [{ profile_id: U.deputy }, { profile_id: U.deputy }]), /ซ้ำ/)
await rejects(assign(U.admin, E.mgmt, 'attend', null, Array.from({ length: 6 }, (_, i) => ({ name: `คนที่ ${i + 1}` }))), /สูงสุด 5 คน/)
await rejects(assign(U.admin, E.mgmt, 'bogus', null, one), /เลือกภารกิจ/)
await rejects(assign(U.admin, E.mgmt, null, null, one), /เลือกภารกิจ/)
await rejects(assign(U.admin, E.mgmt, 'attend', null, [{ name: '   ' }]), /พิมพ์ชื่อ/)
await rejects(assign(U.admin, E.mgmt, 'attend', null, [{ name: 'ก'.repeat(121) }]), /พิมพ์ชื่อ/)
await rejects(assign(U.admin, E.mgmt, 'attend', null, [{ name: 'นายเอ', title: 'ต'.repeat(121) }]), /ตำแหน่งยาวเกิน/)
await rejects(assign(U.admin, E.mgmt, 'attend', 'น'.repeat(121), one), /แทน.*ยาวเกิน/)
await rejects(assign(U.admin, E.mgmt, 'attend', null, ['ไม่ใช่ object']), /รูปแบบ/)
await actor(U.admin)
await rejects(db.query("SELECT public.set_event_assignments($1::uuid, 'attend', NULL, '{}'::jsonb)", [E.mgmt]), /รูปแบบ/, 'ต้องเป็น array')
assert.deepEqual(await rowsOf(E.mgmt), before, 'ค่าที่ถูกปฏิเสธต้องไม่ลบการมอบหมายเดิม')

// ── ล้างการมอบหมาย ──────────────────────────────────────────────────────────────────────
const auditBeforeClear = await auditCount(E.publicMgmt)
assert.deepEqual(await assign(U.mayor, E.publicMgmt, null, null, []), [], 'array ว่าง = ล้าง ไม่ต้องเลือกภารกิจ')
assert.equal((await rowsOf(E.publicMgmt)).length, 0)
assert.equal(await auditCount(E.publicMgmt), auditBeforeClear + 1, 'การล้างต้องมีประวัติ')

// ── ใครเห็นการมอบหมายใน list_events_for_staff ──────────────────────────────────────────────
await assign(U.creator, E.mgmt, 'attend', 'นายกเทศมนตรี', [{ profile_id: U.tech }, { name: 'นายสมมุติ ทดสอบ', title: 'รองนายกเทศมนตรี' }])
const pick = (rows, eventId) => rows.find((r) => r.id === eventId)

const techRows = await listAs(U.tech)
let ev = pick(techRows, E.mgmt)
assert.equal(ev.can_view_detail, true, 'ผู้รับมอบหมายเปิดอ่านกิจกรรมกลุ่มผู้บริหารได้ แม้ตัวเองเป็นช่าง')
assert.equal(ev.description, 'วาระผู้บริหาร')
assert.equal(ev.assignments.length, 2)
assert.deepEqual(Object.keys(ev.assignments[0]).sort(), ['assigned_at', 'assigned_by_name', 'name', 'on_behalf_of', 'profile_id', 'task', 'title'])
assert.equal(ev.assignments[0].assigned_by_name, 'TEST ธุรการ')
assert.equal(pick(techRows, E.council).can_view_detail, false, 'ไม่ได้รับมอบหมายเรื่องอื่น ยังเปิดของสภาไม่ได้เหมือนเดิม')

ev = pick(await listAs(U.otherStaff), E.mgmt)
assert.equal(ev.can_view_detail, false)
assert.equal(ev.description, null)
assert.deepEqual(ev.assignments, [], 'คนไม่มีสิทธิ์ไม่เห็นว่ามอบหมายให้ใคร')
assert.equal(ev.title, 'TEST ประชุมอำเภอ', 'ชื่อกิจกรรมยังเห็นเพื่อเช็กวันว่างเหมือนเดิม')

ev = pick(await listAs(U.council), E.mgmt)
assert.deepEqual([ev.can_view_detail, ev.assignments], [false, []])
ev = pick(await listAs(U.mayor), E.mgmt)
assert.deepEqual([ev.can_view_detail, ev.assignments.length], [true, 2])

// คีย์เดิมยังอยู่ครบ — หน้าเว็บรุ่นก่อนต้องไม่พัง
const staffRows = await listAs(U.otherStaff)
assert.equal(staffRows.length, 5, 'ยังคืนทุกกิจกรรมของ อปท. นี้ (5 รายการ) ไม่ตัดแถวทิ้ง')
for (const row of staffRows) {
  for (const key of ['id', 'title', 'can_view_detail', 'has_attachment', 'creator', 'assignments', 'audiences']) {
    assert.ok(Object.hasOwn(row, key), `ขาดคีย์ ${key}`)
  }
}
assert.equal(pick(staffRows, E.staffOnly).can_view_detail, true, 'กติกาเดิมไม่เปลี่ยน: staff เปิดกิจกรรมกลุ่มเจ้าหน้าที่ได้')
assert.equal(pick(staffRows, E.council).can_view_detail, false, 'กติกาเดิมไม่เปลี่ยน: staff เปิดวาระสภาไม่ได้')
assert.equal((await listAs(U.bStaff)).length, 0, 'คนต่าง อปท. ไม่ได้รายการของ อปท. นี้เลย')

// ── รายชื่อผู้ที่มอบหมายได้ ─────────────────────────────────────────────────────────────────
const cands = await candidatesAs(U.otherStaff)
const byId = Object.fromEntries(cands.map((c) => [c.profile_id, c]))
assert.ok(!byId[U.citizen] && !byId[U.noname] && !byId[U.bStaff] && !byId[U.superadmin], 'ไม่มีประชาชน คนไม่มีชื่อ คนต่าง อปท. และ superadmin')
assert.deepEqual([byId[U.mayor].group_key, byId[U.mayor].title], ['executive', 'นายกเทศมนตรี'])
assert.deepEqual([byId[U.secretary].group_key, byId[U.secretary].title], ['executive', 'เลขานุการนายกเทศมนตรี'], 'viewer ไม่มีตำแหน่งในทะเบียนใช้ job_title และเดากลุ่มจาก role')
assert.equal(byId[U.tech].group_key, 'admin', 'ผอ.กอง (dept_head) อยู่กลุ่มปลัด/หัวหน้าส่วน')
assert.equal(byId[U.admin].group_key, 'admin')
assert.equal(byId[U.council].group_key, 'council')
assert.equal(byId[U.creator].group_key, 'staff')
const order = cands.map((c) => c.group_key)
assert.deepEqual(order, [...order].sort((a, b) => ['executive', 'admin', 'council', 'staff'].indexOf(a) - ['executive', 'admin', 'council', 'staff'].indexOf(b)), 'เรียงผู้บริหาร → ปลัด/หัวหน้าส่วน → สภา → เจ้าหน้าที่')
assert.equal(cands[0].profile_id, U.mayor, 'นายกขึ้นก่อน (ลำดับในทะเบียนตำแหน่ง)')
await rejects(candidatesAs(U.citizen), /เฉพาะบุคลากร/)
await rejects(candidatesAs(U.bStaff), /เฉพาะบุคลากร/, 'ขอรายชื่อของ อปท. อื่นไม่ได้')
await rejects(candidatesAs(null), /permission denied/)

// ── อ่าน/เขียนตารางตรง (RLS) ───────────────────────────────────────────────────────────────
const countAs = async (user, muni = null) => {
  await actor(user)
  const sql = muni
    ? 'SELECT count(*)::int AS n FROM public.event_assignments WHERE municipality_id = $1'
    : 'SELECT count(*)::int AS n FROM public.event_assignments'
  return Number((await db.query(sql, muni ? [muni] : [])).rows[0].n)
}
assert.equal(await countAs(U.citizen), 0, 'ประชาชนที่ล็อกอินอ่านตารางตรงไม่ได้สักแถว')
assert.equal(await countAs(U.bStaff, MA), 0, 'คนต่าง อปท. ไม่เห็นแถวของ อปท. นี้')
assert.equal(await countAs(U.bStaff), 1, 'แต่เห็นแถวของ อปท. ตัวเอง (ที่ superadmin มอบหมายไว้ข้างบน)')
assert.ok(await countAs(U.otherStaff) > 0, 'บุคลากรภายใน อปท. เดียวกันอ่านได้ (กว้างเท่าตาราง events)')
assert.equal(await countAs(U.otherStaff, MB), 0)
await rejects(countAs(null), /permission denied/, 'anon ไม่มีสิทธิ์อ่านตาราง')
await actor(U.creator)
await rejects(db.query("INSERT INTO public.event_assignments (event_id, municipality_id, assignee_name, task) VALUES ($1, $2, 'แอบใส่', 'attend')", [E.mgmt, MA]), /permission denied/, 'เขียนตรงไม่ได้ ต้องผ่าน RPC')
await actor(U.admin)
await rejects(db.query('DELETE FROM public.event_assignments'), /permission denied/)
await actor(U.admin) // rejects() คืนเป็น superuser หลังตรวจทุกครั้ง ต้องตั้งผู้ใช้ใหม่ก่อนข้อถัดไป
await rejects(db.query('TRUNCATE public.event_assignments'), /permission denied/, 'TRUNCATE ไม่ผ่าน RLS ต้องถูกถอนสิทธิ์')
assert.ok((await rowsOf(E.mgmt)).length > 0, 'TRUNCATE ที่ถูกปฏิเสธต้องไม่ลบข้อมูล')

// ── ลบกิจกรรมแล้วการมอบหมายหายตาม ──────────────────────────────────────────────────────────
await assign(U.admin, E.cascade, 'attend', null, [{ profile_id: U.deputy }])
await asRoot()
await db.query('DELETE FROM public.events WHERE id = $1', [E.cascade])
assert.equal((await rowsOf(E.cascade)).length, 0)

console.log('event-assignments-db: ผ่านทุกข้อ')

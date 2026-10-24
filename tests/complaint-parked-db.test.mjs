// สถานะ "ขึ้นทะเบียนรอดำเนินการ" (parked) ฝั่งฐานข้อมูล — รันบน PostgreSQL จำลอง (PGlite) ไม่ต่อ Supabase จริง
// รันด้วย: PATIENT_PGLITE_MODULE=<path>/@electric-sql/pglite/dist/index.js node tests/complaint-parked-db.test.mjs
//   (PowerShell: $env:PATIENT_PGLITE_MODULE='D:/tmp/patient-booking-dbtest-20260918/node_modules/@electric-sql/pglite/dist/index.js')
//
// ทำไมต้องมี: migration 3 ไฟล์ (20261025100000/100100/100200) ยังไม่เคยรันบนฐานจริงตอนเขียน — เทสต์นี้รันไฟล์จริงทุกไฟล์
// กับสคีมาจำลองที่มี CHECK/ฟังก์ชันช่วย "ตรงกับ production" (get_my_role, complaint_category_is_adhoc, add_working_days,
// complaint_worker_can_act ดึงจากไฟล์ migration จริง) แล้วตรวจกติกา: เข้า parked ได้ทาง RPC เท่านั้น, สิทธิ์รายบทบาท,
// ธงรายหมวด, ล้างข้อมูลเมื่อออกจาก parked, กำหนดเสร็จนับใหม่ตอนนำกลับ, สถิติบวกกันเท่ายอดรวม
// PGlite เป็น single connection — ไม่ใช่หลักฐานของ race ระหว่างสองคนกดพักชุดซ้อนกัน (แก้ด้วยการเรียงรหัสก่อนล็อกแถว)

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

if (!process.env.PATIENT_PGLITE_MODULE) {
  console.error('ต้องตั้ง PATIENT_PGLITE_MODULE ชี้ไปที่ @electric-sql/pglite/dist/index.js (ดู docs/ai/PATIENT_BOOKING_HANDOFF.md)')
  process.exit(1)
}
const { PGlite } = await import(pathToFileURL(process.env.PATIENT_PGLITE_MODULE).href)

const read = async (file) => (await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const M1 = '20261025100000_complaint_parked_columns.sql'
const M2 = '20261025100100_complaint_parked_functions.sql'
const M3 = '20261025100200_complaint_stats_parked.sql'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const T1 = id(1), T2 = id(2)
const D_ENG = id(31), D_CLERK = id(32)
const U = { admin: id(10), adminB: id(11), officerEng: id(12), officerClerk: id(13), staff: id(14), tech: id(15), citizen: id(16), super: id(17) }

// ฟังก์ชันตรวจสิทธิ์ผู้ทำงาน ดึงจากไฟล์จริงเพื่อให้เทสต์ตามการเปลี่ยนแปลงของมัน
const finish = await read('20260915110100_complaint_finish_by_assignee.sql')
const workerFnStart = finish.indexOf('CREATE OR REPLACE FUNCTION public.complaint_worker_can_act')
const workerFn = finish.slice(workerFnStart, finish.indexOf('\n$$;', workerFnStart) + 4)
assert(workerFn.includes('complaint_matches_my_department'), 'ดึง complaint_worker_can_act ไม่ได้')
const wdaysFile = await read('20260927220000_add_working_days_fn.sql')
const wdaysStart = wdaysFile.indexOf('CREATE OR REPLACE FUNCTION public.add_working_days')
const wdays = wdaysFile.slice(wdaysStart, wdaysFile.indexOf('\n$$;', wdaysStart) + 4)
assert(wdays.includes('public_holidays'), 'ดึง add_working_days ไม่ได้')

async function baseSchema(db) {
  await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, slug text);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid, name text, short_name text, code text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, municipality_id uuid, role text, full_name text, department_id uuid);
CREATE TABLE public.public_holidays (holiday_date date, municipality_id uuid, is_working_day boolean);
CREATE TABLE public.complaint_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, value text, label text,
  is_active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0, is_adhoc boolean NOT NULL DEFAULT false);
CREATE TABLE public.category_assignments (municipality_id uuid, category text, technician_id uuid, sla_days int);
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL, category text NOT NULL, department text,
  assigned_to uuid, user_id uuid, status text NOT NULL DEFAULT 'pending', due_date date,
  created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
  CONSTRAINT complaints_status_check CHECK (status IN ('new','in_progress','done','closed','rejected','pending','received','completed')));
CREATE TABLE public.complaint_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), complaint_id uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  status text NOT NULL, note text, actor_name text, created_at timestamptz NOT NULL DEFAULT now());
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
  await db.exec(wdays)
  await db.exec(workerFn)
  await db.exec(`
INSERT INTO public.municipalities VALUES ('${T1}', 'one'), ('${T2}', 'two');
INSERT INTO public.departments VALUES ('${D_ENG}', '${T1}', 'กองช่าง', 'ช่าง', 'ENG'), ('${D_CLERK}', '${T1}', 'สำนักปลัด', 'ปลัด', 'CLK');
INSERT INTO public.profiles VALUES
 ('${U.admin}', '${T1}', 'admin', 'Admin TEST', NULL), ('${U.adminB}', '${T2}', 'admin', 'AdminB TEST', NULL),
 ('${U.officerEng}', '${T1}', 'officer', 'Officer Eng TEST', '${D_ENG}'), ('${U.officerClerk}', '${T1}', 'officer', 'Officer Clerk TEST', '${D_CLERK}'),
 ('${U.staff}', '${T1}', 'staff', 'Staff TEST', '${D_ENG}'), ('${U.tech}', '${T1}', 'technician', 'Tech TEST', '${D_ENG}'),
 ('${U.citizen}', '${T1}', 'citizen', 'Citizen TEST', NULL), ('${U.super}', NULL, 'superadmin', 'Super TEST', NULL);
INSERT INTO public.complaint_categories (municipality_id, value, label, is_active, is_adhoc) VALUES
 ('${T1}', 'farm_road', 'ซ่อมแซมถนนทางการเกษตร', false, false),
 ('${T1}', 'light', 'ไฟฟ้าสาธารณะ', true, false),
 ('${T1}', 'odor', 'กลิ่นเหม็น', true, true);
INSERT INTO public.category_assignments VALUES ('${T1}', 'farm_road', '${U.staff}', 3);
`)
}

// ── 0) รันผิดลำดับต้องถูกกัน ─────────────────────────────────────────────────
{
  const fresh = new PGlite()
  await baseSchema(fresh)
  const m2 = await read(M2)
  const m3 = await read(M3)
  await assert.rejects(() => fresh.exec(m2), /ต้องรัน 20261025100000/)
  await assert.rejects(() => fresh.exec(m3), /ต้องรัน 20261025100000/)
  await fresh.close()
  console.log('PASS ไฟล์เฟสหลังรันก่อนเฟส DDL ไม่ได้')
}

const db = new PGlite()
await baseSchema(db)

// เก็บตัวเลขสถิติก่อน migration — ใช้เทียบว่าคีย์เดิมไม่หาย
await db.exec(await read(M1))
await db.exec(await read(M2))
const stats = async (tenant) => (await db.query('SELECT public.complaint_stats($1) AS v', [tenant])).rows[0]?.v
// สคีมาจำลองยังไม่มี complaint_stats/_fy — สร้างเวอร์ชันเดิมจาก production (คัดจาก pg_get_functiondef 2026-10-24) แล้วรัน 100200 ทับ
await db.exec(`
CREATE FUNCTION public.complaint_stats(_municipality_id uuid) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  RETURN (SELECT json_build_object(
      'total', count(*),
      'open', count(*) FILTER (WHERE status IN ('new', 'pending', 'received')),
      'in_progress', count(*) FILTER (WHERE status = 'in_progress'),
      'resolved', count(*) FILTER (WHERE status IN ('done', 'closed', 'completed')),
      'rejected', count(*) FILTER (WHERE status = 'rejected'),
      'avg_days', round(avg(extract(epoch FROM (closed_at - created_at)) / 86400.0) FILTER (WHERE status IN ('done', 'closed', 'completed') AND closed_at IS NOT NULL), 1),
      'this_month', count(*) FILTER (WHERE date_trunc('month', created_at AT TIME ZONE 'Asia/Bangkok') = date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok'))
    ) FROM complaints WHERE municipality_id = _municipality_id);
END; $f$;
CREATE FUNCTION public.complaint_stats_fy(_municipality_id uuid, _from date, _to date) RETURNS json LANGUAGE sql AS $f$ SELECT '{}'::json $f$;
`)
const before = await stats(T1)
await db.exec(await read(M3))
console.log('PASS migration ทั้ง 3 ไฟล์รันผ่านบนสคีมาจำลอง')

// ── helper ──────────────────────────────────────────────────────────────────
const actor = async (user, role = 'authenticated') => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [user || '', user ? role : 'anon'])
  await db.exec(`SET ROLE ${user ? 'authenticated' : 'anon'}`)
}
const internal = async () => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false)")
}
const rpc = async (name, args) => (await db.query(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS value`, args)).rows[0].value
const row = async (cid) => (await db.query('SELECT * FROM public.complaints WHERE id = $1', [cid])).rows[0]
const timeline = async (cid) => (await db.query('SELECT status, note, actor_name FROM public.complaint_timeline WHERE complaint_id = $1 ORDER BY created_at, id', [cid])).rows
const failsCode = async (fn, code, pattern) => {
  await assert.rejects(fn, (err) => { if (code) assert.equal(err.code, code, `code ${err.code}: ${err.message}`); if (pattern) assert.match(err.message, pattern); return true })
}
let seq = 100
const make = async ({ category = 'farm_road', status = 'received', department = 'กองช่าง', assigned = U.staff, tenant = T1, due = '2026-08-01' } = {}) => {
  const cid = id(seq++)
  await internal()
  await db.query('INSERT INTO public.complaints (id, municipality_id, category, department, assigned_to, status, due_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [cid, tenant, category, department, assigned, status, due])
  return cid
}

// ── 1) ค่าตั้งต้นและ CHECK ──────────────────────────────────────────────────
await internal()
assert.equal((await db.query("SELECT allow_parking FROM public.complaint_categories WHERE value='farm_road'")).rows[0].allow_parking, false, 'ธงรายหมวดต้องปิดเป็นค่าตั้งต้น')
const def = (await db.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='complaints_status_check'")).rows[0].d
for (const status of ['new', 'in_progress', 'done', 'closed', 'rejected', 'pending', 'received', 'completed', 'parked']) {
  assert(def.includes(`'${status}'`), `CHECK ต้องมี ${status}`)
}
await db.exec("UPDATE public.complaint_categories SET allow_parking = true WHERE value IN ('farm_road', 'odor')")

// CHECK คู่: status parked ต้องมี parked_at และกลับกัน (ทางลัดของ SQL ภายในก็ข้ามไม่ได้)
{
  const c = await make()
  await internal()
  await failsCode(() => db.query("UPDATE public.complaints SET status='parked' WHERE id=$1", [c]), '23514', /complaints_parked_consistency/)
  await failsCode(() => db.query("UPDATE public.complaints SET parked_at=now() WHERE id=$1", [c]), '23514', /complaints_parked_consistency/)
  await failsCode(() => db.query("UPDATE public.complaints SET status='parked', parked_at=now(), parked_reason='bogus' WHERE id=$1", [c]), '23514', /complaints_parked_reason_check/)
  console.log('PASS CHECK: parked ⇔ parked_at, รหัสเหตุผลต้องอยู่ในรายการ')
}

// ── 2) เข้า parked ทางตรงไม่ได้ (ทุกบทบาทที่ผ่าน API) ─────────────────────────
{
  const c = await make()
  for (const user of [U.admin, U.super, U.officerEng, U.staff]) {
    await actor(user)
    await failsCode(() => db.query("UPDATE public.complaints SET status='parked' WHERE id=$1", [c]), '42501', /park_complaints/)
    await failsCode(() => db.query("UPDATE public.complaints SET parked_reason='plan' WHERE id=$1", [c]), '42501', /park_complaints/)
  }
  await actor(null)
  await failsCode(() => db.query("INSERT INTO public.complaints (municipality_id, category, status) VALUES ($1,'farm_road','parked')", [T1]), '42501', /ตั้งตอนยื่น/)
  await actor(U.citizen)
  await failsCode(() => db.query("INSERT INTO public.complaints (municipality_id, category, status, parked_reason) VALUES ($1,'farm_road','pending','plan')", [T1]), '42501', /ตั้งตอนยื่น/)
  await db.query("INSERT INTO public.complaints (municipality_id, category, status) VALUES ($1,'farm_road','pending')", [T1])
  console.log('PASS UPDATE/INSERT ตรงเข้า parked ไม่ได้ ยื่นคำร้องปกติยังได้')
}

// ── 3) park_complaints: ทางที่ถูก ──────────────────────────────────────────
const c1 = await make()
await actor(U.admin)
let res = await rpc('park_complaints', [[c1], 'budget', 'รองบปี 70'])
assert.deepEqual(res, { parked: 1, skipped: [] })
let r = await row(c1)
assert.equal(r.status, 'parked'); assert.equal(r.parked_reason, 'budget'); assert.equal(r.parked_by, U.admin); assert(r.parked_at)
let tl = await timeline(c1)
assert.equal(tl.length, 1); assert.equal(tl[0].status, 'parked'); assert.equal(tl[0].note, 'รองบประมาณ — รองบปี 70'); assert.equal(tl[0].actor_name, 'Admin TEST')
// ธงของ RPC ต้องถูกล้างหลังจบ — ไม่รั่วไปถึงคำสั่งถัดไปในทรานแซกชันเดียวกัน
assert.equal((await db.query("SELECT current_setting('app.complaint_workflow', true) AS v")).rows[0].v, '')
console.log('PASS แอดมินขึ้นทะเบียนได้ มี parked_at/by/reason และบันทึกใน timeline')

// ── 4) สิทธิ์รายบทบาท / ข้ามรายการอย่างปลอดภัย ─────────────────────────────
{
  const cEng = await make({ department: 'กองช่าง' })
  const cClerk = await make({ department: 'สำนักปลัด', assigned: null })
  const cOtherTenant = await make({ tenant: T2, category: 'farm_road' })

  // staff / technician / citizen: ไม่มีสิทธิ์ทั้ง RPC
  for (const user of [U.staff, U.tech, U.citizen]) {
    await actor(user)
    await failsCode(() => rpc('park_complaints', [[cEng], 'plan', null]), '42501')
  }
  await actor(null)
  await failsCode(() => rpc('park_complaints', [[cEng], 'plan', null]), '42501')

  // officer: เฉพาะกองตัวเอง · เรื่องกองอื่นถูกข้ามด้วย forbidden ไม่ทำให้ทั้งชุดล้ม
  await actor(U.officerEng)
  res = await rpc('park_complaints', [[cEng, cClerk], 'plan', null])
  assert.equal(res.parked, 1, JSON.stringify({ res, cEng, cClerk }))
  assert.deepEqual(res.skipped, [{ id: cClerk, code: 'forbidden' }])
  assert.equal((await row(cClerk)).status, 'received')

  // แอดมินอีก อปท. พักเรื่องของ อปท. อื่นไม่ได้ (และไม่รู้ว่ามีเรื่องนั้นหรือไม่) · เรื่องของ อปท. ตัวเองแต่หมวดไม่มีธง = ไม่อนุญาต
  await actor(U.adminB)
  res = await rpc('park_complaints', [[cClerk, cEng], 'plan', null])
  assert.equal(res.parked, 0)
  assert.deepEqual(res.skipped.map((s) => s.code), ['forbidden', 'forbidden'])
  res = await rpc('park_complaints', [[cOtherTenant], 'plan', null])
  assert.deepEqual(res.skipped.map((s) => s.code), ['category_not_allowed'], 'T2 ไม่มีหมวดนี้/ไม่เปิดธง')

  // superadmin เป็นผู้ทำงานของทุก อปท. (เหมือนสิทธิ์ผู้ทำงานอื่นๆ) แต่ยังต้องผ่านธงรายหมวดของ อปท. นั้นเสมอ
  await actor(U.super)
  res = await rpc('park_complaints', [[cOtherTenant], 'plan', null])
  assert.deepEqual(res.skipped.map((s) => s.code), ['category_not_allowed'])
  console.log('PASS สิทธิ์: staff/technician/citizen/anon ถูกปฏิเสธ · officer เฉพาะกองตัวเอง · ข้าม อปท. ไม่ได้')
}

// ── 5) เงื่อนไขรายเรื่อง ────────────────────────────────────────────────────
{
  await actor(U.admin)
  const cLight = await make({ category: 'light' })
  const cOdor = await make({ category: 'odor' })
  const cNew = await make({ status: 'new' })
  const cPending = await make({ status: 'pending' })
  const cClosed = await make({ status: 'closed' })
  const cRejected = await make({ status: 'rejected' })
  const cIn = await make({ status: 'in_progress' })
  await actor(U.admin)
  res = await rpc('park_complaints', [[cLight, cOdor, cNew, cPending, cClosed, cRejected, cIn, c1], 'season', null])
  const codeOf = Object.fromEntries(res.skipped.map((s) => [s.id, s.code]))
  assert.equal(res.parked, 1, 'พักได้เฉพาะ in_progress')
  assert.equal((await row(cIn)).status, 'parked')
  assert.equal(codeOf[cLight], 'category_not_allowed')
  assert.equal(codeOf[cOdor], 'adhoc')
  for (const cid of [cNew, cPending, cClosed, cRejected]) assert.equal(codeOf[cid], 'bad_status')
  assert.equal(codeOf[c1], 'already_parked')
  for (const cid of [cLight, cNew, cClosed]) assert.notEqual((await row(cid)).status, 'parked')

  // รหัสซ้ำในชุดเดียวกันนับครั้งเดียว · อินพุตผิดต้องถูกปฏิเสธก่อนแตะข้อมูล
  const cDup = await make()
  await actor(U.admin)
  res = await rpc('park_complaints', [[cDup, cDup, cDup], 'plan', null])
  assert.equal(res.parked, 1); assert.equal((await timeline(cDup)).length, 1)
  const cBad = await make()
  await actor(U.admin)
  await failsCode(() => rpc('park_complaints', [[cBad], 'nonsense', null]), '22023', /เหตุผลไม่ถูกต้อง/)
  await failsCode(() => rpc('park_complaints', [[cBad], 'other', '   ']), '22023', /ต้องระบุรายละเอียด/)
  await failsCode(() => rpc('park_complaints', [[cBad], 'plan', 'x'.repeat(501)]), '22023', /500/)
  await failsCode(() => rpc('park_complaints', [[], 'plan', null]), '22023', /ยังไม่ได้เลือก/)
  await failsCode(() => rpc('park_complaints', [null, 'plan', null]), '22023', /ยังไม่ได้เลือก/)
  await failsCode(() => rpc('park_complaints', [Array.from({ length: 201 }, (_, i) => id(5000 + i)), 'plan', null]), '22023', /200/)
  assert.equal((await row(cBad)).status, 'received')
  res = await rpc('park_complaints', [[cBad], 'other', 'รอสำรวจร่วมกับกองช่าง'])
  assert.equal(res.parked, 1)
  assert.equal((await timeline(cBad))[0].note, 'เหตุผลอื่น — รอสำรวจร่วมกับกองช่าง')
  console.log('PASS เงื่อนไขรายเรื่อง: หมวด/เฉพาะกิจ/สถานะ/ซ้ำ และการตรวจอินพุต')
}

// ── 6) นำกลับเข้าคิว ───────────────────────────────────────────────────────
{
  const cp = await make({ due: '2026-01-05' })
  await actor(U.admin)
  await rpc('park_complaints', [[cp], 'plan', null])
  // สิทธิ์
  await actor(U.staff); await failsCode(() => rpc('unpark_complaint', [cp]), '42501')
  await actor(U.officerClerk); await failsCode(() => rpc('unpark_complaint', [cp]), '42501', /ผู้ทำงานของคำร้องนี้/)
  await actor(U.adminB); await failsCode(() => rpc('unpark_complaint', [cp]), '42501')
  await actor(null); await failsCode(() => rpc('unpark_complaint', [cp]), '42501')
  assert.equal((await row(cp)).status, 'parked')

  await actor(U.officerEng)
  await rpc('unpark_complaint', [cp])
  r = await row(cp)
  assert.equal(r.status, 'received'); assert.equal(r.parked_at, null); assert.equal(r.parked_by, null); assert.equal(r.parked_reason, null)
  assert.equal(r.assigned_to, U.staff, 'ผู้รับผิดชอบเดิมต้องคงอยู่')
  // กำหนดเสร็จนับใหม่: sla_days ของหมวด = 3 วันทำการจากวันนี้ (เวลาไทย) ไม่ใช่วันที่เก่าเมื่อเดือนมกราคม
  await internal()
  const dueOk = (await db.query("SELECT due_date = public.add_working_days((now() AT TIME ZONE 'Asia/Bangkok')::date, 3, municipality_id) AS ok, due_date > '2026-06-01'::date AS fresh FROM public.complaints WHERE id = $1", [cp])).rows[0]
  assert.equal(dueOk.ok, true, 'กำหนดเสร็จต้องเป็น 3 วันทำการจากวันนี้ (sla_days ของหมวด)')
  assert.equal(dueOk.fresh, true, 'ต้องไม่ใช่วันที่เก่าก่อนพัก')
  tl = await timeline(cp)
  assert.deepEqual(tl.map((t) => t.status), ['parked', 'received'])
  assert.equal(tl[1].note, 'นำกลับเข้าคิวงาน เริ่มนับกำหนดเสร็จใหม่'); assert.equal(tl[1].actor_name, 'Officer Eng TEST')
  await actor(U.officerEng)
  await failsCode(() => rpc('unpark_complaint', [cp]), '22023', /ไม่ได้อยู่ในสถานะ/)
  console.log('PASS นำกลับเข้าคิว: received + ล้าง parked_* + กำหนดเสร็จนับใหม่ + timeline')

  // แอดมินเปลี่ยนสถานะตรงจาก parked (ช่อง "เปลี่ยนสถานะ (Admin)") ต้องล้างข้อมูลพักให้เองด้วย
  const cq = await make()
  await actor(U.admin)
  await rpc('park_complaints', [[cq], 'plan', null])
  await db.query("UPDATE public.complaints SET status='rejected' WHERE id=$1", [cq])
  r = await row(cq)
  assert.equal(r.status, 'rejected'); assert.equal(r.parked_at, null); assert.equal(r.parked_reason, null)
  console.log('PASS ออกจาก parked ทางไหนก็ล้างข้อมูลพักเอง (ไม่ค้าง parked_at ทำให้ CHECK พัง)')
}

// ── 7) สถิติสาธารณะ ─────────────────────────────────────────────────────────
{
  await internal()
  await db.exec(`TRUNCATE public.complaints CASCADE`)
  const a = await make({ status: 'received' }); await make({ status: 'in_progress' }); await make({ status: 'closed' }); await make({ status: 'rejected' }); await make({ status: 'new' })
  await internal()
  const noParked = await stats(T1)
  assert.equal(Object.hasOwn(noParked, 'parked'), false, 'ไม่มีเรื่องพัก = ไม่ใส่คีย์ (ชุดสรุปรายเดือนที่ล็อกไว้เทียบทั้งก้อน)')
  assert.deepEqual(Object.keys(noParked).sort(), Object.keys(before).sort(), 'คีย์เดิมต้องครบเท่าเดิม')
  await actor(U.admin)
  await rpc('park_complaints', [[a], 'plan', null])
  await actor(null)
  const withParked = await stats(T1)
  assert.equal(withParked.parked, 1)
  assert.equal(withParked.total, 5)
  assert.equal(withParked.open + withParked.in_progress + withParked.resolved + withParked.rejected + withParked.parked, withParked.total,
    'ทุกช่องบวกกันต้องเท่ายอดรวม')
  console.log('PASS complaint_stats: คีย์ parked เฉพาะเมื่อ > 0 และทุกช่องบวกกันเท่ายอดรวม')
}

console.log('ALL PASS complaint-parked-db')
await db.close()

// ปิดช่องเดิม business_registrations + ซ่อน uuid ผู้ใช้จาก anon 11 ตาราง — รัน migration จริงใน PGlite ไม่ใช้เน็ต
//   node tests/business-registrations-rls-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน: 20261218100000 (policy INSERT/อ่าน) → 20261219100000 (ถอน SELECT ทั้งตาราง + ให้รายคอลัมน์ 11 ตาราง)
//   ตารางอื่นนอกจาก tourism_places สร้างจากรายชื่อใน src/lib/anonColumns.js (ชนิด text — migration แตะแค่สิทธิ์ ไม่สนชนิด)
//   โครงตาราง/policy ตั้งต้น = ของฐานจริงที่อ่านมา 2026-11-19 (pg_policies + relacl) ไม่ใช่ของ 043 ตามไฟล์
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { TOURISM_PLACE_PUBLIC_COLUMN_LIST, TOURISM_PLACE_PUBLIC_COLUMNS } from '../src/lib/tourismPlaceColumns.js'
import { ANON_COLUMN_LIST, ANON_HIDDEN_COLUMNS, anonColumns } from '../src/lib/anonColumns.js'

const modulePath = process.argv.includes('--pglite') ? process.argv[process.argv.indexOf('--pglite') + 1] : process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'Supply --pglite <local module path> หรือตั้ง PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const insertSql = await readMigration('20261218100000_business_registrations_insert_read.sql')
const grantSql = await readMigration('20261219100000_anon_hide_user_uuid_columns.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = id(1), B = id(2), DA = id(11), DB = id(12)
const U = { citizen: id(101), citizenB: id(102), officer: id(103), admin: id(104), adminB: id(105), staff: id(106) }
const P = {
  citizen: ['citizen', A, null], citizenB: ['citizen', B, null], officer: ['officer', A, DA],
  admin: ['admin', A, null], adminB: ['admin', B, null], staff: ['staff', A, DA],
}
const RA = id(201), RB = id(202), RAP = id(203)
const SA = id(301), SB = id(302)

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, slug text UNIQUE);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid REFERENCES public.municipalities(id));
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid, department_id uuid);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_department_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT department_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.is_my_department(p_municipality_id uuid, p_department_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT p_department_id IS NOT NULL AND p_municipality_id = public.get_my_municipality_id() AND p_department_id = public.get_my_department_id() $$;
CREATE FUNCTION public.department_belongs_to_municipality(p_department_id uuid, p_municipality_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT p_department_id IS NULL OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = p_department_id AND d.municipality_id = p_municipality_id) $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id(), public.get_my_department_id(),
  public.is_my_department(uuid, uuid), public.department_belongs_to_municipality(uuid, uuid) TO anon, authenticated;

CREATE TABLE public.business_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  business_name text NOT NULL, business_type text NOT NULL DEFAULT 'shop', phone text, address text,
  latitude numeric NOT NULL DEFAULT 18, longitude numeric NOT NULL DEFAULT 100,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note text, approved_by uuid REFERENCES auth.users(id), approved_at timestamptz,
  department_id uuid REFERENCES public.departments(id), created_at timestamptz DEFAULT now());
ALTER TABLE public.business_registrations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.business_registrations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_registrations TO authenticated;
-- policy ชุดเดียวกับฐานจริง 2026-11-19
CREATE POLICY "public_read_approved_businesses" ON public.business_registrations FOR SELECT USING (status = 'approved');
CREATE POLICY "owner_read_own_registrations" ON public.business_registrations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "authenticated_insert_registration" ON public.business_registrations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "internal read business registrations" ON public.business_registrations FOR SELECT TO authenticated
  USING (get_my_role() = 'superadmin' OR (get_my_role() IN ('admin', 'officer', 'staff', 'viewer', 'technician') AND municipality_id = get_my_municipality_id()));
CREATE POLICY "department scoped update business registrations" ON public.business_registrations FOR UPDATE TO authenticated
  USING (get_my_role() = 'superadmin' OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND municipality_id = get_my_municipality_id() AND get_my_department_id() IS NOT NULL
        AND (department_id = get_my_department_id() OR department_id IS NULL)))
  WITH CHECK (department_belongs_to_municipality(department_id, municipality_id) AND (get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND is_my_department(municipality_id, department_id))));

CREATE TABLE public.tourism_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid REFERENCES public.municipalities(id), name text NOT NULL,
  category text, image_url text, description text, is_active boolean DEFAULT true, display_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(), address text, maps_url text, gallery text[], phone text, service_type text,
  online_service text, online_url text, has_delivery boolean, department_id uuid, created_by uuid, latitude numeric,
  longitude numeric, opening_hours jsonb, hours_note text, facebook_url text, line_id text, is_featured boolean,
  village_no text, price_range text, updated_at timestamptz);
ALTER TABLE public.tourism_places ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.tourism_places TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tourism_places TO authenticated;
CREATE POLICY "public read" ON public.tourism_places FOR SELECT USING (true);
CREATE POLICY "department manage tourism_places" ON public.tourism_places FOR ALL TO authenticated
  USING (get_my_role() = 'superadmin' OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND is_my_department(municipality_id, department_id))
    OR (get_my_role() = 'staff' AND created_by = auth.uid()))
  WITH CHECK (get_my_role() = 'superadmin' OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND is_my_department(municipality_id, department_id))
    OR (get_my_role() = 'staff' AND created_by = auth.uid() AND is_my_department(municipality_id, department_id)));

INSERT INTO public.municipalities VALUES ('${A}', 'a'), ('${B}', 'b');
INSERT INTO public.departments VALUES ('${DA}', '${A}'), ('${DB}', '${B}');
`)
// อีก 10 ตารางของงานกวาด uuid — คอลัมน์ตาม anonColumns.js · สิทธิ์ตั้งต้นเหมือนฐานจริง (anon/authenticated SELECT ทั้งตาราง)
for (const tbl of Object.keys(ANON_COLUMN_LIST).filter(t => t !== 'tourism_places')) {
  const cols = [...ANON_COLUMN_LIST[tbl], ...ANON_HIDDEN_COLUMNS[tbl]].map(c => `"${c}" text`).join(', ')
  await db.exec(`CREATE TABLE public."${tbl}" (${cols}); GRANT SELECT ON public."${tbl}" TO anon, authenticated;`)
  await db.query(`INSERT INTO public."${tbl}" ("id", "${ANON_HIDDEN_COLUMNS[tbl][0]}") VALUES ($1, $2)`, [tbl, U.staff])
}
for (const [alias, [role, muni, dept]] of Object.entries(P)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [U[alias]])
  await db.query('INSERT INTO public.profiles VALUES ($1,$2,$3,$4)', [U[alias], role, muni, dept])
}
await db.exec(`
INSERT INTO public.business_registrations (id, municipality_id, user_id, business_name, phone, status, approved_by, approved_at) VALUES
  ('${RA}', '${A}', '${U.citizen}', 'ร้าน A', '0800000001', 'approved', '${U.admin}', now()),
  ('${RB}', '${B}', '${U.citizenB}', 'ร้าน B', '0800000002', 'approved', '${U.adminB}', now()),
  ('${RAP}', '${A}', '${U.citizen}', 'ร้าน A รอตรวจ', '0800000003', 'pending', null, null);
INSERT INTO public.tourism_places (id, municipality_id, name, department_id, created_by) VALUES
  ('${SA}', '${A}', 'ร้าน A', '${DA}', '${U.staff}'), ('${SB}', '${B}', 'ร้าน B', '${DB}', null);
`)

const actor = async alias => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [alias && alias !== 'anon' ? U[alias] : ''])
  await db.exec(`SET ROLE ${alias && alias !== 'anon' ? 'authenticated' : 'anon'}`)
}
const asRoot = async () => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', '', false)") }
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const rejects = (promise, expect = {}) => assert.rejects(promise, error => {
  if (expect.code) assert.equal(error.code, expect.code, `รหัสผิด: ${error.code} / ${error.message}`)
  if (expect.message) assert.match(error.message, expect.message)
  return true
})
const DENIED = { code: '42501' }
let cases = 0
const test = async (label, run) => { await asRoot(); await run(); await asRoot(); cases++; console.log('PASS ' + label) }
const register = (extra = {}) => db.query(
  `INSERT INTO public.business_registrations (municipality_id, user_id, business_name, status, approved_by, approved_at, department_id, admin_note)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [extra.muni ?? A, extra.user ?? U.citizen, extra.name ?? 'ร้านใหม่', extra.status === undefined ? 'pending' : extra.status,
    extra.approved_by ?? null, extra.approved_at ?? null, extra.department_id ?? null, extra.admin_note ?? null])

// ── ก่อน migration: ยืนยันว่าช่องเดิมเปิดอยู่จริง (เทสต์นี้จับได้ ไม่ใช่ผ่านลวง) ────────────────────────
await test('ก่อนแก้: ประชาชนตั้งใบตัวเองเป็นอนุมัติแล้วได้ + อ่านใบ อปท. อื่นได้ + anon อ่าน created_by ได้', async () => {
  await actor('citizen')
  await register({ name: 'ก่อนแก้', status: 'approved', approved_by: U.admin, approved_at: new Date().toISOString() })
  assert.equal((await rows('SELECT id FROM public.business_registrations WHERE id = $1', [RB])).length, 1)
  await actor('anon')
  assert.equal((await rows('SELECT created_by FROM public.tourism_places WHERE id = $1', [SA]))[0].created_by, U.staff)
  await asRoot()
  await db.exec("DELETE FROM public.business_registrations WHERE business_name = 'ก่อนแก้'")
})

// ── migration ───────────────────────────────────────────────────────────────────────
await db.exec(insertSql)
await db.exec(grantSql)
await test('รันทั้ง 2 ไฟล์ซ้ำได้ + ด่านท้ายไฟล์ผ่าน', async () => {
  await db.exec(insertSql)
  await db.exec(grantSql)
})

// ── (1) INSERT ต้องเป็นใบรอตรวจที่สะอาด ─────────────────────────────────────────────────────
await test('ประชาชนยื่นใบรอตรวจได้ (แบบที่ BusinessRegisterPage ส่ง) + ไม่ส่ง status = DEFAULT pending ผ่าน', async () => {
  await actor('citizen')
  await register({ name: 'ยื่นปกติ' })
  await db.query('INSERT INTO public.business_registrations (municipality_id, user_id, business_name) VALUES ($1, $2, $3)', [A, U.citizen, 'ไม่ส่ง status'])
  const r = await rows("SELECT status FROM public.business_registrations WHERE business_name IN ('ยื่นปกติ', 'ไม่ส่ง status')")
  assert.deepEqual(r.map(x => x.status), ['pending', 'pending'])
})
for (const [label, extra] of [
  ['status=approved', { status: 'approved' }],
  ['status=rejected', { status: 'rejected' }],
  ['status=NULL', { status: null }],
  ['approved_by = แอดมินตัวจริง', { approved_by: U.admin }],
  ['approved_at', { approved_at: new Date().toISOString() }],
  ['department_id ของ อปท. อื่น', { department_id: DB }],
  ['department_id ของ อปท. ตัวเอง', { department_id: DA }],
  ['admin_note ปลอม', { admin_note: 'เจ้าหน้าที่ตรวจแล้ว' }],
  ['user_id ของคนอื่น', { user: U.citizenB }],
]) {
  await test(`ประชาชนยื่นใบที่มี ${label} ไม่ได้`, async () => {
    await actor('citizen')
    await rejects(register(extra), DENIED)
  })
}
await test('anon ยื่นคำขอไม่ได้', async () => {
  await actor('anon')
  await rejects(register({ user: null }), DENIED)
})
await test('เจ้าหน้าที่ยังอนุมัติใบรอตรวจได้ตามเดิม (policy UPDATE ไม่ถูกแตะ)', async () => {
  await actor('admin')
  const r = await rows(`UPDATE public.business_registrations SET status = 'approved', approved_by = $1, approved_at = now()
                        WHERE id = $2 RETURNING status`, [U.admin, RAP])
  assert.deepEqual(r, [{ status: 'approved' }])
})

// ── (2) อ่านข้าม อปท. ไม่ได้ ───────────────────────────────────────────────────────────────
await test('anon อ่าน business_registrations ไม่ได้เลย (ถอนสิทธิ์ตาราง)', async () => {
  await actor('anon')
  await rejects(rows('SELECT id FROM public.business_registrations'), DENIED)
})
await test('ประชาชนเห็นเฉพาะใบตัวเอง ไม่เห็นใบอนุมัติของ อปท. อื่น/คนอื่น', async () => {
  await actor('citizenB')
  const r = await rows('SELECT id FROM public.business_registrations ORDER BY id')
  assert.deepEqual(r.map(x => x.id), [RB])
  await actor('citizen')
  assert.ok((await rows('SELECT id FROM public.business_registrations')).every(x => x.id !== RB))
})
await test('เจ้าหน้าที่เห็นเฉพาะ อปท. ตัวเอง (หน้า TourismManager/ผูกเจ้าของร้านใช้งานได้)', async () => {
  await actor('officer')
  const r = await rows("SELECT municipality_id FROM public.business_registrations WHERE status = 'approved'")
  assert.ok(r.length >= 2 && r.every(x => x.municipality_id === A))
})

// ── (3) tourism_places.created_by ──────────────────────────────────────────────────────────
await test('anon select * ล้ม 42501 (เหตุที่ต้อง deploy หน้าเว็บก่อนรันไฟล์ 2)', async () => {
  await actor('anon')
  await rejects(rows('SELECT * FROM public.tourism_places'), DENIED)
  await rejects(rows('SELECT created_by FROM public.tourism_places'), DENIED)
})
await test('anon อ่านด้วยชุดคอลัมน์ของหน้าเว็บได้ครบทุกร้าน', async () => {
  await actor('anon')
  const r = await rows(`SELECT ${TOURISM_PLACE_PUBLIC_COLUMNS} FROM public.tourism_places ORDER BY id`)
  assert.deepEqual(r.map(x => x.id), [SA, SB])
  assert.ok(!('created_by' in r[0]))
})
await test('ผู้ล็อกอินยัง select * ได้ (หน้าจัดการเจ้าหน้าที่) + staff แก้ร้านที่ตัวเองสร้างได้ตามเดิม', async () => {
  await actor('citizen')
  assert.equal((await rows('SELECT * FROM public.tourism_places')).length, 2)
  await actor('staff')
  assert.equal((await rows("UPDATE public.tourism_places SET description = 'x' WHERE id = $1 RETURNING id", [SA])).length, 1)
})
await test('ชุดคอลัมน์ในโค้ด = สิทธิ์ anon หลังรัน = คอลัมน์ทั้งตารางลบ created_by', async () => {
  const granted = (await rows(`SELECT attname FROM pg_attribute WHERE attrelid = 'public.tourism_places'::regclass AND attnum > 0
    AND NOT attisdropped AND has_column_privilege('anon', attrelid, attname, 'SELECT')`)).map(x => x.attname).sort()
  assert.deepEqual([...TOURISM_PLACE_PUBLIC_COLUMN_LIST].sort(), granted)
  const all = (await rows(`SELECT attname FROM pg_attribute WHERE attrelid = 'public.tourism_places'::regclass AND attnum > 0 AND NOT attisdropped`))
    .map(x => x.attname).filter(c => c !== 'created_by').sort()
  assert.deepEqual(granted, all)
})

// ── (4) อีก 10 ตารางของงานกวาด uuid ────────────────────────────────────────────────────────
await test('ทุกตาราง: anon select * / คอลัมน์ที่ซ่อนล้ม 42501 · ชุดคอลัมน์ของหน้าเว็บอ่านได้ · ผู้ล็อกอินยัง select * ได้', async () => {
  for (const tbl of Object.keys(ANON_COLUMN_LIST)) {
    await actor('anon')
    await rejects(rows(`SELECT * FROM public."${tbl}"`), DENIED)
    for (const c of ANON_HIDDEN_COLUMNS[tbl]) await rejects(rows(`SELECT "${c}" FROM public."${tbl}"`), DENIED)
    assert.ok((await rows(`SELECT ${anonColumns(tbl)} FROM public."${tbl}"`)).length >= 1, tbl)
    assert.ok((await rows(`SELECT count(*)::int AS n FROM public."${tbl}"`))[0].n >= 1, tbl + ' count(*)')
    await actor('citizen')
    const all = await rows(`SELECT * FROM public."${tbl}"`)
    assert.ok(all.length >= 1 && ANON_HIDDEN_COLUMNS[tbl].every(c => c in all[0]), tbl + ' authenticated')
  }
})
await test('ไฟล์ 2 ไม่แตะสิทธิ์ใดเลยถ้าตารางใดตารางหนึ่งไม่ผ่านด่านก่อนรัน (ด่านตรวจครบก่อนถอน)', async () => {
  await db.exec('GRANT SELECT ON public.events, public.tourism_reviews TO anon')
  await db.exec('ALTER TABLE public.tourism_reviews ADD COLUMN extra_note text')
  await rejects(db.exec(grantSql), { message: /extra_note/ })
  await db.exec('ROLLBACK')
  assert.equal((await rows("SELECT has_table_privilege('anon', 'public.events', 'SELECT') AS ok"))[0].ok, true)
  await db.exec('ALTER TABLE public.tourism_reviews DROP COLUMN extra_note')
  await db.exec(grantSql)
  assert.equal((await rows("SELECT has_table_privilege('anon', 'public.events', 'SELECT') AS ok"))[0].ok, false)
})
await test('ไฟล์ 2 หยุดเองเมื่อ tourism_places มีคอลัมน์ใหม่ที่ไม่รู้จัก', async () => {
  await db.exec('ALTER TABLE public.tourism_places ADD COLUMN secret_note text')
  await rejects(db.exec(grantSql), { message: /secret_note/ })
  await db.exec('ROLLBACK')
  await db.exec('ALTER TABLE public.tourism_places DROP COLUMN secret_note')
})
await test('ไฟล์ 1 หยุดเองถ้ามี policy อ่านแบบ public ค้างอยู่', async () => {
  await db.exec(`CREATE POLICY "leftover_public" ON public.business_registrations FOR SELECT USING (true)`)
  // ไฟล์ 1 DROP เฉพาะชื่อที่รู้จัก ⇒ policy อื่นที่เปิด public ต้องทำให้ด่านท้ายไฟล์ล้ม
  await rejects(db.exec(insertSql), { message: /public\/anon/ })
  await db.exec('ROLLBACK')
  await db.exec('DROP POLICY "leftover_public" ON public.business_registrations')
})

await test('ไฟล์ 1 หยุดเองถ้ามี policy INSERT permissive ตัวอื่นค้าง (OR กันแล้วช่องกลับมา)', async () => {
  await db.exec(`CREATE POLICY "leftover_insert" ON public.business_registrations FOR INSERT TO authenticated WITH CHECK (true)`)
  await rejects(db.exec(insertSql), { message: /INSERT\/ALL ตัวอื่น/ })
  await db.exec('ROLLBACK')
  await db.exec('DROP POLICY "leftover_insert" ON public.business_registrations')
})
await test('ด่านท้ายไฟล์ 1 ผ่านเมื่อ search_path มี auth (deparse เป็น uid() เฉยๆ)', async () => {
  await db.exec('SET search_path = public, auth')
  try { await db.exec(insertSql) } finally { await db.exec('RESET search_path') }
})

console.log(`\nผ่าน ${cases} กรณี`)

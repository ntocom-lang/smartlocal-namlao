// ค้นหาบริการ + คำถามที่พบบ่อย + คลังแบบฟอร์ม — supabase/migrations/20261203100000..100200
//   node tests/service-help-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// รัน migration จริงใน PostgreSQL จำลอง (PGlite 0.5.8) ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//
// สิ่งที่ต้องไม่พัง:
//  (1) ไม่ล็อกอิน/ประชาชน อ่านได้เฉพาะแถวเผยแพร่ และเขียนไม่ได้เลย
//  (2) เจ้าหน้าที่ อปท. อื่นแก้/ลบ/อ่านร่างของ อปท. นี้ไม่ได้
//  (3) staff เพิ่มได้เฉพาะกองตัวเอง แก้/ลบได้เฉพาะแถวที่ตัวเองสร้าง · officer ทั้งกอง · admin ทั้ง อปท.
//  (4) ลิงก์ที่ไม่ใช่ https:// (javascript:/data:) ถูกปฏิเสธที่ฐานข้อมูล
//  (5) ย้ายแถวข้าม อปท./กอง หรือเปลี่ยนผู้สร้างไม่ได้ ถ้าไม่ใช่ admin · updated_by ตั้งจากเซิร์ฟเวอร์
//  (6) ไม่มีใครได้ TRUNCATE · เติมคีย์โมดูลครบทุกแถวและรันซ้ำได้
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const tablesSql = await readMigration('20261203100000_service_help_tables.sql')
const rlsSql = await readMigration('20261203100100_service_help_rls.sql')
const keySql = await readMigration('20261203100200_service_help_module_key.sql')

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const D1 = '00000000-0000-4000-8000-0000000000d1' // กองช่าง อปท. A
const D2 = '00000000-0000-4000-8000-0000000000d2' // กองคลัง อปท. A
const DB_ = '00000000-0000-4000-8000-0000000000db' // กองของ อปท. B
const U = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const people = {
  admin: [U(1), 'admin', A, null],
  officer1: [U(2), 'officer', A, D1],
  staff1: [U(3), 'staff', A, D1],
  staff1b: [U(4), 'staff', A, D1],
  staff2: [U(5), 'staff', A, D2],
  citizen: [U(6), 'citizen', A, null],
  adminB: [U(7), 'admin', B, null],
  superadmin: [U(8), 'superadmin', null, null],
  viewer: [U(9), 'viewer', A, null],
}

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text, enabled_modules text[]);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid REFERENCES public.municipalities(id));
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, municipality_id uuid, department_id uuid);
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

-- ตัวแทนฟังก์ชันจริงของระบบ (เนื้อเดียวกับฐานจริง: อ่าน profile ของผู้ล็อกอิน)
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_department_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT department_id FROM public.profiles WHERE id = auth.uid() $$;
-- 3 ตัวนี้คัดเนื้อจาก 20260802060000 ตรงตัว
CREATE FUNCTION public.department_belongs_to_municipality(p_department_id uuid, p_municipality_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_department_id IS NULL OR EXISTS (
    SELECT 1 FROM public.departments AS department
    WHERE department.id = p_department_id AND department.municipality_id = p_municipality_id);
$$;
CREATE FUNCTION public.is_my_department(p_municipality_id uuid, p_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_department_id IS NOT NULL
    AND p_municipality_id = public.get_my_municipality_id()
    AND p_department_id = public.get_my_department_id();
$$;
CREATE FUNCTION public.protect_department_record_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND public.get_my_role() NOT IN ('admin', 'superadmin')
     AND (NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
       OR NEW.department_id IS DISTINCT FROM OLD.department_id)
  THEN RAISE EXCEPTION 'Record owner, municipality and department cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

INSERT INTO public.municipalities VALUES
  ('${A}', 'อปท. เอ', ARRAY['complaints','inbox']),
  ('${B}', 'อปท. บี', ARRAY['complaints', NULL]::text[]),
  ('${C}', 'อปท. ซี', NULL);
INSERT INTO public.departments VALUES ('${D1}', '${A}'), ('${D2}', '${A}'), ('${DB_}', '${B}');
`)
for (const [id, role, muni, dept] of Object.values(people)) {
  await db.query('INSERT INTO public.profiles VALUES ($1,$2,$3,$4)', [id, role, muni, dept])
}

await db.exec(tablesSql)
await db.exec(rlsSql)
await db.exec(keySql)

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

// สลับผู้ใช้: anon = ไม่ล็อกอิน · ชื่ออื่น = authenticated + uid
const as = async alias => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('test.uid', $1, false)", [alias === 'anon' ? '' : people[alias][0]])
  await db.exec(`SET ROLE ${alias === 'anon' ? 'anon' : 'authenticated'}`)
}
const asOwner = async () => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('test.uid', '', false)") }
const rejects = async (promise, re) => {
  let err = null
  try { await promise } catch (e) { err = e }
  assert.ok(err, 'ควรถูกปฏิเสธแต่ผ่าน')
  if (re) assert.match(String(err.message), re)
}
const URL_OK = 'https://drive.google.com/uc?id=abcdefghij12345'
const addForm = (alias, { muni = A, dept = D1, title = 'แบบคำขออนุญาตก่อสร้าง', url = URL_OK, published = true } = {}) =>
  as(alias).then(() => db.query(
    'INSERT INTO public.service_forms (municipality_id, department_id, title, file_url, is_published, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [muni, dept, title, url, published, alias === 'anon' ? null : people[alias][0]]))
const countForms = async alias => { await as(alias); return (await db.query('SELECT count(*)::int AS n FROM public.service_forms')).rows[0].n }

await test('admin เพิ่มแบบฟอร์มได้ + updated_by ตั้งจากเซิร์ฟเวอร์', async () => {
  const { rows } = await addForm('admin', { dept: null })
  await asOwner()
  const r = (await db.query('SELECT updated_by, created_by FROM public.service_forms WHERE id = $1', [rows[0].id])).rows[0]
  assert.equal(r.updated_by, people.admin[0])
  assert.equal(r.created_by, people.admin[0])
})

await test('staff เพิ่มได้เฉพาะกองตัวเอง', async () => {
  await addForm('staff1', { dept: D1 })
  await rejects(addForm('staff1', { dept: D2 }), /row-level security/)
  await rejects(addForm('staff1', { dept: null }), /row-level security/)
})

await test('officer เพิ่มได้เฉพาะกองตัวเอง', async () => {
  await addForm('officer1', { dept: D1, published: false, title: 'ร่างแบบฟอร์มกองช่าง' })
  await rejects(addForm('officer1', { dept: D2 }), /row-level security/)
})

await test('ประชาชน/ไม่ล็อกอิน/viewer/อปท. อื่น เพิ่มไม่ได้', async () => {
  await rejects(addForm('anon', { dept: null }))
  await rejects(addForm('citizen', { dept: null }), /row-level security/)
  await rejects(addForm('viewer', { dept: null }), /row-level security/)
  await rejects(addForm('adminB', { muni: A, dept: null }), /row-level security/)
  await rejects(addForm('adminB', { muni: B, dept: D1 }), /row-level security/) // กองของ อปท. อื่น
})

await test('ปลอม created_by เป็นคนอื่นไม่ได้', async () => {
  await as('staff1')
  await rejects(db.query(
    'INSERT INTO public.service_forms (municipality_id, department_id, title, file_url, created_by) VALUES ($1,$2,$3,$4,$5)',
    [A, D1, 'สวมรอย', URL_OK, people.staff1b[0]]), /row-level security/)
})

await test('ลิงก์ไฟล์ต้องเป็น https:// เท่านั้น', async () => {
  await rejects(addForm('admin', { dept: null, url: 'javascript:alert(1)' }), /check constraint/)
  await rejects(addForm('admin', { dept: null, url: 'data:text/html,x' }), /check constraint/)
  await rejects(addForm('admin', { dept: null, url: 'http://example.com/a.pdf' }), /check constraint/)
})

await test('ไม่ล็อกอิน/ประชาชน เห็นเฉพาะแถวเผยแพร่ · ภายในเห็นร่างของ อปท. ตัวเอง', async () => {
  // มี 3 แถว: admin(เผยแพร่) staff1(เผยแพร่) officer1(ร่าง)
  assert.equal(await countForms('anon'), 2)
  assert.equal(await countForms('citizen'), 2)
  assert.equal(await countForms('viewer'), 3)
  assert.equal(await countForms('adminB'), 2) // อปท. อื่นเห็นแค่ของที่เผยแพร่ (เป็นของสาธารณะ)
  assert.equal(await countForms('superadmin'), 3)
})

await test('staff แก้/ลบได้เฉพาะแถวที่ตัวเองสร้าง · officer ทั้งกอง', async () => {
  await as('staff1b')
  const upd = await db.query("UPDATE public.service_forms SET title = 'แก้โดยคนอื่น' WHERE created_by = $1", [people.staff1[0]])
  assert.equal(upd.affectedRows, 0)
  const del = await db.query('DELETE FROM public.service_forms WHERE created_by = $1', [people.staff1[0]])
  assert.equal(del.affectedRows, 0)
  await as('staff1')
  assert.equal((await db.query("UPDATE public.service_forms SET title = 'แก้เอง' WHERE created_by = $1", [people.staff1[0]])).affectedRows, 1)
  await as('officer1')
  assert.equal((await db.query("UPDATE public.service_forms SET sort_order = 5 WHERE department_id = $1", [D1])).affectedRows, 2)
  await as('staff2')
  assert.equal((await db.query("UPDATE public.service_forms SET sort_order = 9 WHERE department_id = $1", [D1])).affectedRows, 0)
})

await test('อปท. อื่นแก้/ลบไม่ได้แม้เป็น admin', async () => {
  await as('adminB')
  assert.equal((await db.query("UPDATE public.service_forms SET title = 'ข้าม อปท.'")).affectedRows, 0)
  assert.equal((await db.query('DELETE FROM public.service_forms')).affectedRows, 0)
})

await test('ย้ายกอง/เปลี่ยนผู้สร้างไม่ได้ถ้าไม่ใช่ admin · admin ย้ายกองได้', async () => {
  await as('officer1')
  await rejects(db.query('UPDATE public.service_forms SET department_id = $1 WHERE created_by = $2', [D2, people.officer1[0]]))
  await as('staff1')
  await rejects(db.query('UPDATE public.service_forms SET created_by = $1 WHERE created_by = $2', [people.staff1b[0], people.staff1[0]]))
  await as('admin')
  assert.equal((await db.query('UPDATE public.service_forms SET department_id = $1 WHERE created_by = $2', [D2, people.staff1[0]])).affectedRows, 1)
})

await test('ประชาชนแก้/ลบไม่ได้', async () => {
  // ประชาชนล็อกอินมีสิทธิ์ระดับตาราง (บทบาท authenticated) แต่ RLS ไม่ให้แตะแถวไหนเลย
  await as('citizen')
  assert.equal((await db.query("UPDATE public.service_forms SET title = 'x'")).affectedRows, 0)
  assert.equal((await db.query('DELETE FROM public.service_forms')).affectedRows, 0)
  await as('anon')
  await rejects(db.query('DELETE FROM public.service_forms'), /permission denied/)
})

await test('คำถามที่พบบ่อย: สิทธิ์ชุดเดียวกัน + ลิงก์ต้องเป็น path ภายในหรือ https://', async () => {
  const addFaq = (alias, link, { dept = D1, published = true } = {}) => as(alias).then(() => db.query(
    'INSERT INTO public.service_faqs (municipality_id, department_id, question, answer, link_url, is_published, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [A, dept, 'ไฟดับแจ้งที่ไหน', 'แจ้งผ่านเมนูคำร้อง หมวดไฟฟ้าสาธารณะ', link, published, people[alias][0]]))
  await addFaq('staff1', '/complaint?category=lighting')
  await addFaq('admin', 'https://www.dla.go.th', { dept: null, published: false })
  await rejects(addFaq('admin', 'javascript:alert(1)', { dept: null }), /check constraint/)
  await rejects(addFaq('admin', '//evil.example', { dept: null }), /check constraint/)
  await rejects(addFaq('admin', '/ /x', { dept: null }), /check constraint/)
  await addFaq('admin', '/', { dept: null, published: false }) // หน้าแรกได้
  await rejects(addFaq('staff1', null, { dept: D2 }), /row-level security/)
  await rejects(as('citizen').then(() => db.query(
    'INSERT INTO public.service_faqs (municipality_id, question, answer, created_by) VALUES ($1,$2,$3,$4)',
    [A, 'คำถามสวมรอย', 'ตอบ', people.citizen[0]])), /row-level security/)
  await as('anon')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.service_faqs')).rows[0].n, 1)
  await as('viewer')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.service_faqs')).rows[0].n, 3)
})

await test('ไม่มีใครได้ TRUNCATE/INSERT ของ anon', async () => {
  await asOwner()
  for (const t of ['public.service_forms', 'public.service_faqs']) {
    for (const r of ['anon', 'authenticated']) {
      assert.equal((await db.query('SELECT has_table_privilege($1, $2, $3) AS ok', [r, t, 'TRUNCATE'])).rows[0].ok, false, `${r} TRUNCATE ${t}`)
    }
    assert.equal((await db.query('SELECT has_table_privilege($1, $2, $3) AS ok', ['anon', t, 'INSERT'])).rows[0].ok, false)
    assert.equal((await db.query('SELECT has_table_privilege($1, $2, $3) AS ok', ['anon', t, 'SELECT'])).rows[0].ok, true)
  }
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE tablename IN ('service_forms','service_faqs')")).rows[0].n, 10)
})

await test('คีย์โมดูล service-help ครบทุกแถว · NULL ไม่แตะ · รันซ้ำไม่ซ้ำคีย์', async () => {
  await asOwner()
  await db.exec(keySql)
  const rows = (await db.query('SELECT id, enabled_modules FROM public.municipalities ORDER BY id')).rows
  const byId = Object.fromEntries(rows.map(r => [r.id, r.enabled_modules]))
  assert.deepEqual(byId[A], ['complaints', 'inbox', 'service-help'])
  assert.deepEqual(byId[B], ['complaints', null, 'service-help'])
  assert.equal(byId[C], null)
})

// ── กรณีที่ migration-reviewer ชี้ว่ายังไม่ครอบ (2569-11-17) ─────────────────────────────────
await test('created_at ย้อนหลังจาก client ไม่ถูกรับ (L1)', async () => {
  await as('admin')
  const { rows } = await db.query(
    "INSERT INTO public.service_forms (municipality_id, title, file_url, created_by, created_at) VALUES ($1,'ย้อนเวลา',$2,$3,'2000-01-01') RETURNING created_at",
    [A, URL_OK, people.admin[0]])
  assert.ok(new Date(rows[0].created_at).getFullYear() > 2020)
})

await test('ช่องว่างนำ/ท้ายไม่จำกัดใส่ไม่ได้ · ชื่อสั้นเกินหลังตัดช่องว่างไม่ได้ (L2)', async () => {
  await rejects(addForm('admin', { dept: null, title: 'ก' + ' '.repeat(300) + 'ข' }), /check constraint/)
  await rejects(addForm('admin', { dept: null, title: '   ก   ' }), /check constraint/)
})

await test('ลิงก์ /\\โดเมน ใส่ไม่ได้', async () => {
  await as('admin')
  await rejects(db.query('INSERT INTO public.service_faqs (municipality_id, question, answer, link_url, created_by) VALUES ($1,$2,$3,$4,$5)',
    [A, 'คำถามทดสอบลิงก์', 'ตอบ', '/\\evil.com', people.admin[0]]), /check constraint/)
})

await test('ลบ: officer ลบได้ทั้งกอง · staff ลบได้เฉพาะของตัวเอง · คำถามแก้/ลบตามกติกาเดียวกัน', async () => {
  await addForm('staff1b', { dept: D1, title: 'ของ staff1b' })
  await as('staff1')
  assert.equal((await db.query("DELETE FROM public.service_forms WHERE title = 'ของ staff1b'")).affectedRows, 0)
  await as('staff1b')
  assert.equal((await db.query("DELETE FROM public.service_forms WHERE title = 'ของ staff1b'")).affectedRows, 1)
  await addForm('staff1b', { dept: D1, title: 'ของ staff1b รอบสอง' })
  await as('officer1')
  assert.equal((await db.query("DELETE FROM public.service_forms WHERE title = 'ของ staff1b รอบสอง'")).affectedRows, 1)
  // faqs: staff1 สร้างไว้ 1 แถว (กอง D1)
  await as('staff2')
  assert.equal((await db.query("UPDATE public.service_faqs SET answer = 'แก้ข้ามกอง'")).affectedRows, 0)
  assert.equal((await db.query('DELETE FROM public.service_faqs')).affectedRows, 0)
  await as('officer1')
  assert.equal((await db.query("UPDATE public.service_faqs SET answer = 'ธุรการกองแก้' WHERE department_id = $1", [D1])).affectedRows, 1)
  await as('staff1')
  assert.equal((await db.query('DELETE FROM public.service_faqs WHERE created_by = $1', [people.staff1[0]])).affectedRows, 1)
})

await test('technician/council อ่านร่างของ อปท. ตัวเองได้ แต่เขียนไม่ได้', async () => {
  await asOwner()
  await db.query("INSERT INTO public.profiles VALUES ($1,'technician',$2,$3), ($4,'council',$2,NULL)", [U(20), A, D1, U(21)])
  people.tech = [U(20), 'technician', A, D1]
  people.council = [U(21), 'council', A, null]
  const all = (await db.query('SELECT count(*)::int AS n FROM public.service_forms WHERE municipality_id = $1', [A])).rows[0].n
  assert.equal(await countForms('tech'), all)
  assert.equal(await countForms('council'), all)
  await rejects(addForm('tech', { dept: D1 }), /row-level security/)
  await rejects(addForm('council', { dept: null }), /row-level security/)
})

await test('รันไฟล์ 1 ซ้ำแล้วรันไฟล์ 2 ซ้ำ สิทธิ์กลับมาครบ (ด่านท้ายไฟล์ 2 ผ่าน)', async () => {
  await asOwner()
  await db.exec(tablesSql)
  assert.equal((await db.query("SELECT has_table_privilege('anon','public.service_forms','SELECT') AS ok")).rows[0].ok, false)
  await db.exec(rlsSql)
  assert.equal((await db.query("SELECT has_table_privilege('anon','public.service_forms','SELECT') AS ok")).rows[0].ok, true)
})

await test('ไฟล์ 3 ล้มทั้งไฟล์ถ้ายังไม่ได้รันไฟล์ 1–2 (L3)', async () => {
  const fresh = new PGlite()
  await fresh.exec(`CREATE TABLE public.municipalities (id uuid PRIMARY KEY, enabled_modules text[]);
    INSERT INTO public.municipalities VALUES ('${A}', ARRAY['complaints'])`)
  await rejects(fresh.exec(keySql), /ต้องรัน 20261203100000/)
  assert.deepEqual((await fresh.query('SELECT enabled_modules FROM public.municipalities')).rows[0].enabled_modules, ['complaints'])
  await fresh.close()
})

await asOwner()
console.log(`\nservice-help-db: ${cases} cases passed`)

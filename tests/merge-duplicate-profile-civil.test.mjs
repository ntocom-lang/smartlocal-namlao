// รวมบัญชีซ้ำ (merge_duplicate_profile) ต้องย้าย civil_project_people.profile_id ไปบัญชีที่เก็บไว้
// รันฟังก์ชันจริงจาก migration ใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง
//   node tests/merge-duplicate-profile-civil.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ใส่ --without-fix เพื่อรันเฉพาะรุ่นเดิม 20260830230000 → ต้องล้ม (พิสูจน์ว่าเทสต์จับบั๊กได้จริง)
//
// ตรวจ: (1) dry run นับแถวที่จะย้าย (2) หลังรวม ผู้ควบคุมงานยังเขียนรายงานรายสัปดาห์ได้ กรรมการยังอ่านได้
// (3) แถวของคนอื่น/ตัวแทนผู้รับจ้างไม่ถูกแตะ (4) ด่านตรวจหัวไฟล์ปฏิเสธเมื่อฟังก์ชันบนฐานไม่ใช่รุ่นในรีโป
// (5) รันไฟล์ซ้ำได้ และไม่ขึ้นกับ CRLF/LF ของไฟล์รุ่นเดิม
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)
const withFix = !process.argv.includes('--without-fix')

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const tablesSql = await readMigration('20261106100000_civil_reports_tables.sql')
const rlsSql = await readMigration('20261106100100_civil_reports_rls_triggers.sql')
const fkFixSql = await readMigration('20261108120100_civil_weekly_reports_created_by_drop_fk.sql')
const baseMergeSql = await readMigration('20260830230000_merge_duplicate_profile_admin_and_missing_columns.sql')
const fixMergeSql = await readMigration('20261108140000_merge_duplicate_profile_civil_project_people.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)
const D1 = id(11) // กองช่าง (เจ้าของโครงการ)
const D2 = id(12) // กองอื่น — ช่างที่ถูกระบุชื่อไม่ได้สิทธิ์จากกอง ต้องได้จาก civil_project_people เท่านั้น
const P1 = id(21)
const U = { adminA: id(101), creator: id(102), keep: id(103), merge: id(104), other: id(105) }
const PROFILE = {
  adminA: ['admin', null], creator: ['technician', D1], keep: ['technician', D2], merge: ['technician', D2], other: ['technician', D2],
}

// ตารางทุกตัวที่ฟังก์ชันแตะ — ดึงชื่อตาราง/คอลัมน์จากเนื้อ migration เอง จะได้ไม่ต้องไล่แก้เทสต์ทุกครั้งที่ฟังก์ชันเพิ่มคอลัมน์
const stubColumns = sql => {
  const map = new Map()
  for (const m of sql.matchAll(/UPDATE public\.(\w+) SET (\w+) = p_keep_id|FROM public\.(\w+) WHERE (\w+) = p_merge_id/g)) {
    const table = m[1] ?? m[3]
    const col = m[2] ?? m[4]
    if (['civil_project_people', 'civil_projects', 'profiles'].includes(table)) continue
    if (!map.has(table)) map.set(table, new Set())
    map.get(table).add(col)
  }
  map.get('push_subscriptions')?.add('endpoint')
  return map
}

const authSql = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE auth.identities (user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, provider text NOT NULL, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`

const newDb = async () => {
  const db = new PGlite()
  await db.exec(authSql)
  await db.exec(`
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid REFERENCES public.municipalities(id), name text);
-- ของจริง 005_create_profiles: ลบ auth.users แล้ว profiles หายตาม (CASCADE) → FK ของ civil_project_people ทำงาน (SET NULL)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, full_name text, role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid REFERENCES public.municipalities(id), department_id uuid REFERENCES public.departments(id)
);
CREATE TABLE public.civil_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, department_id uuid REFERENCES public.departments(id),
  title text NOT NULL, start_date date, end_date date
);
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, actor_id uuid, actor_name text, actor_role text,
  action text NOT NULL, resource_type text NOT NULL, resource_id text, resource_label text, metadata jsonb, created_at timestamptz DEFAULT now()
);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_department_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT department_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.is_my_department(p_municipality_id uuid, p_department_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT p_department_id IS NOT NULL AND p_municipality_id = public.get_my_municipality_id() AND p_department_id = public.get_my_department_id(); $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id(), public.get_my_department_id(),
  public.is_my_department(uuid, uuid) TO anon, authenticated;
INSERT INTO public.municipalities VALUES ('${MA}', 'อปท. เอ');
INSERT INTO public.departments VALUES ('${D1}', '${MA}', 'กองช่าง'), ('${D2}', '${MA}', 'กองคลัง');
`)
  for (const [table, cols] of stubColumns(baseMergeSql + fixMergeSql)) {
    await db.exec(`CREATE TABLE public.${table} (row_id serial PRIMARY KEY, ${[...cols].map(c => `${c} ${c === 'endpoint' ? 'text' : 'uuid'}`).join(', ')})`)
  }
  for (const [alias, uid] of Object.entries(U)) {
    const [role, dept] = PROFILE[alias]
    await db.query('INSERT INTO auth.users VALUES ($1)', [uid])
    await db.query('INSERT INTO public.profiles VALUES ($1,$2,$3,$4,$5)', [uid, alias, role, MA, dept])
  }
  await db.query(`INSERT INTO auth.identities VALUES ($1,'email','keep@example.invalid'), ($2,'line',NULL)`, [U.keep, U.merge])
  await db.query('INSERT INTO public.civil_projects (id, municipality_id, created_by, department_id, title, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [P1, MA, U.creator, D1, 'ถนน คสล. สายทดสอบ', '2026-10-01', '2026-12-29'])
  await db.exec(tablesSql)
  await db.exec(rlsSql)
  await db.exec(fkFixSql)
  return db
}

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }
const fnFingerprint = async db => (await db.query(`SELECT md5(regexp_replace(regexp_replace(prosrc, chr(45)||chr(45)||'[^'||chr(10)||']*', '', 'g'),
  '['||chr(32)||chr(9)||chr(10)||chr(13)||']+', '', 'g')) AS fp FROM pg_proc WHERE oid = 'public.merge_duplicate_profile(uuid,uuid,boolean)'::regprocedure`)).rows[0].fp

// ── ฐานหลัก: รุ่นเดิม แล้ว (ถ้าไม่ใส่ --without-fix) รุ่นใหม่ทับ ───────────────────────
const db = await newDb()
await db.exec(baseMergeSql)
if (withFix) {
  await db.exec(fixMergeSql)
  await db.exec(fixMergeSql) // รันซ้ำต้องผ่านด่านตรวจหัวไฟล์ (ลายนิ้วมือรุ่นใหม่อยู่ในรายการที่ยอมรับ)
}

const actor = async alias => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [U[alias]])
  await db.exec('SET ROLE authenticated')
}
const asRoot = async () => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', '', false)") }
const can = async (alias, fn) => { await actor(alias); return (await db.query(`SELECT public.${fn}($1) AS ok`, [P1])).rows[0].ok }

await asRoot()
await db.query(`INSERT INTO public.civil_project_people (project_id, grp, sort_order, name, position_title, duty, profile_id) VALUES
  ($1,'supervisor',1,'ช่างซ้ำ','วิศวกรโยธา','หัวหน้าผู้ควบคุมงาน',$2),
  ($1,'committee',1,'ช่างซ้ำ','วิศวกรโยธา','กรรมการ',$2),
  ($1,'supervisor',2,'ช่างอื่น','นายช่างโยธา','ผู้ควบคุมงาน',$3),
  ($1,'contractor_rep',1,'ตัวแทนหนึ่ง','วิศวกรโยธา','ผู้จัดการโครงการ',NULL)`, [P1, U.merge, U.other])

await test('ก่อนรวม: บัญชีที่จะถูกยุบเป็นผู้ควบคุมงาน เขียนรายงานได้ · บัญชีที่เก็บไว้ (กองอื่น) ยังไม่มีสิทธิ์', async () => {
  assert.equal(await can('merge', 'civil_can_write_project'), true)
  assert.equal(await can('keep', 'civil_can_read_project'), false)
  assert.equal(await can('keep', 'civil_can_write_project'), false)
})

await test('dry run: นับแถวผู้ควบคุมงาน/กรรมการที่จะย้าย และยังไม่แตะข้อมูล', async () => {
  await actor('adminA')
  const preview = (await db.query('SELECT public.merge_duplicate_profile($1,$2,true) AS r', [U.keep, U.merge])).rows[0].r
  assert.equal(preview.dry_run, true)
  if (withFix) assert.equal(preview.rows_to_move.civil_project_people_profile_id, 2)
  await asRoot()
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.civil_project_people WHERE profile_id = $1', [U.merge])).rows[0].n, 2)
})

await test('รวมบัญชีแล้ว: แถวของบัญชีที่ถูกยุบย้ายมาบัญชีที่เก็บไว้ ไม่กลายเป็นค่าว่าง · แถวคนอื่นไม่ถูกแตะ', async () => {
  await actor('adminA')
  const result = (await db.query('SELECT public.merge_duplicate_profile($1,$2,false) AS r', [U.keep, U.merge])).rows[0].r
  assert.deepEqual(result, { dry_run: false, merged_into: U.keep, deleted: U.merge })
  await asRoot()
  assert.equal((await db.query('SELECT 1 FROM auth.users WHERE id = $1', [U.merge])).rows.length, 0, 'บัญชีซ้ำต้องถูกลบ')
  const people = (await db.query(`SELECT grp, sort_order, name, profile_id FROM public.civil_project_people ORDER BY grp, sort_order`)).rows
  assert.deepEqual(people.map(r => [r.grp, r.sort_order, r.name, r.profile_id]), [
    ['committee', 1, 'ช่างซ้ำ', U.keep],
    ['contractor_rep', 1, 'ตัวแทนหนึ่ง', null],
    ['supervisor', 1, 'ช่างซ้ำ', U.keep],
    ['supervisor', 2, 'ช่างอื่น', U.other],
  ])
  const audit = (await db.query(`SELECT metadata FROM public.audit_logs WHERE action = 'merge_duplicate_profile'`)).rows
  assert.equal(audit.length, 1)
  assert.equal(audit[0].metadata.merged_id, U.merge)
})

await test('หลังรวม: บัญชีที่เก็บไว้อ่านโครงการได้ และเขียนรายงานรายสัปดาห์ได้จริงผ่าน RLS (ผู้สร้างประทับเป็นบัญชีนี้)', async () => {
  assert.equal(await can('keep', 'civil_can_read_project'), true)
  assert.equal(await can('keep', 'civil_can_write_project'), true)
  await actor('keep')
  const { rows: [r] } = await db.query(`INSERT INTO public.civil_weekly_reports (project_id, week_no, period_start, period_end)
    VALUES ($1, 1, '2026-10-01', '2026-10-07') RETURNING created_by`, [P1])
  assert.equal(r.created_by, U.keep)
  await asRoot()
})

if (withFix) {
  await test('ด่านตรวจหัวไฟล์: ฟังก์ชันบนฐานไม่ใช่รุ่นในรีโป / ไม่มีฟังก์ชัน = ปฏิเสธทั้งไฟล์ ไม่เขียนทับ', async () => {
    const drift = await newDb()
    await drift.exec(`CREATE FUNCTION public.merge_duplicate_profile(p_keep_id uuid, p_merge_id uuid, p_dry_run boolean DEFAULT true)
      RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RETURN '{}'::jsonb; END; $$;`)
    const before = await fnFingerprint(drift)
    await assert.rejects(drift.exec(fixMergeSql), /ไม่ตรงกับรุ่นในรีโป/)
    await drift.exec('ROLLBACK') // ไฟล์มี BEGIN เอง: RAISE แล้ว transaction ค้างสถานะ aborted ทุกคำสั่งหลัง RAISE ต้องไม่ถูกรัน
    assert.equal(await fnFingerprint(drift), before, 'ฟังก์ชันเดิมต้องไม่ถูกเขียนทับ')
    await drift.close()
    const missing = await newDb()
    await assert.rejects(missing.exec(fixMergeSql), /ไม่พบฟังก์ชัน/)
    await missing.exec('ROLLBACK')
    assert.equal((await missing.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'merge_duplicate_profile'`)).rows[0].n, 0, 'ด่านล้มแล้วต้องไม่สร้างฟังก์ชัน')
    await missing.close()
  })

  await test('ด่านตรวจหัวไฟล์ไม่ขึ้นกับ CRLF/LF และคอมเมนต์ที่ถูกตัด ของรุ่นเดิมบนฐาน', async () => {
    for (const variant of [
      baseMergeSql.replace(/\r?\n/g, '\r\n'),
      baseMergeSql.replace(/\r\n/g, '\n'),
      baseMergeSql.replace(/^\s*--.*$/gm, ''), // SQL Editor บางรุ่นตัดบรรทัดคอมเมนต์ทิ้งก่อนส่ง
    ]) {
      const other = await newDb()
      await other.exec(variant)
      await other.exec(fixMergeSql)
      assert.match((await other.query(`SELECT prosrc FROM pg_proc WHERE proname = 'merge_duplicate_profile'`)).rows[0].prosrc, /civil_project_people SET profile_id = p_keep_id/)
      await other.close()
    }
  })

  await test('สิทธิ์ฟังก์ชันคงเดิม: SECURITY DEFINER · anon เรียกไม่ได้ · authenticated เรียกได้ · ช่างเรียกแล้วโดนปฏิเสธ', async () => {
    const { rows: [r] } = await db.query(`SELECT p.prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x FROM pg_proc p WHERE proname = 'merge_duplicate_profile'`)
    assert.deepEqual(r, { prosecdef: true, anon_x: false, auth_x: true })
    await actor('other')
    await assert.rejects(db.query('SELECT public.merge_duplicate_profile($1,$2,true)', [U.other, U.creator]), /admin or superadmin only/)
    await asRoot()
  })
}

console.log(`\n${cases} cases passed${withFix ? '' : ' (--without-fix)'}`)

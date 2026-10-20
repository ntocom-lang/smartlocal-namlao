// แบบสำรวจความเห็นประชาชน — supabase/migrations/20261020170000_community_survey_tables.sql + 20261020170100_..._functions.sql
//   node tests/community-survey-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง (ติดตั้ง PGlite: npm install --prefix <temp> @electric-sql/pglite@0.5.8)
//
// สิ่งที่ต้องไม่พัง: (1) หีบบัตรไม่มีทางโยงกลับไปหาตัวผู้ตอบ — ไม่มีคอลัมน์ผู้ใช้/เวลา และทะเบียนผู้ใช้สิทธิ์ไม่มีตัวเลือก
// (2) 1 บัญชี 1 เสียง ข้าม อปท. ไม่ได้ ปิดแล้วตอบไม่ได้ (3) ผลรายตัวเลือกไม่โผล่ก่อนตอบ (4) ความเห็นเห็นเฉพาะเจ้าหน้าที่ ซ่อนเบอร์/เลขบัตร/อีเมล
// และถูกลบหลัง 90 วัน (5) เฉพาะ admin/officer/staff ของ อปท. นั้น (กับ superadmin) สร้าง/ปิด/ลบความเห็นได้ (6) สิทธิ์เรียกฟังก์ชันตรงแบบ
// (7) ลบทั้งแบบสำรวจ (20261021110000_survey_delete.sql): เฉพาะ admin ของ อปท. นั้น + superadmin · ลูกทุกตารางหายตาม · ลงประวัติก่อนลบในธุรกรรมเดียวกัน
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const rateLimitSql = await readMigration('20260905170000_rpc_rate_limit.sql')
const tablesSql = await readMigration('20261020170000_community_survey_tables.sql')
const functionsSql = await readMigration('20261020170100_community_survey_functions.sql')
const deleteSql = await readMigration('20261021110000_survey_delete.sql')

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const U = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text, email text, role text, municipality_id uuid);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.role', true), '') $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.muni', true), '')::uuid $$;
CREATE TABLE public.audit_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, municipality_id uuid, actor_id uuid, actor_name text, actor_role text,
  action text NOT NULL, resource_type text NOT NULL, resource_id text, resource_label text, metadata jsonb, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.job_heartbeats (job_name text PRIMARY KEY, last_ok_at timestamptz, last_error_at timestamptz, last_error text, updated_at timestamptz NOT NULL DEFAULT now());
-- pg_cron จำลอง: ไฟล์ migration ตรวจว่ามี cron.schedule และเรียกมันตอนท้าย
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job VALUES ($1, $2, $3) RETURNING 1::bigint $$;
CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = $1 RETURNING true $$;
INSERT INTO public.municipalities VALUES ('${A}', 'อปท. เอ'), ('${B}', 'อปท. บี');
`)
await db.exec(rateLimitSql)
await db.exec(tablesSql)
await db.exec(functionsSql)
await db.exec(deleteSql)

const users = {
  admin: U(1), officer: U(2), staff: U(3), viewer: U(4), council: U(5), technician: U(6),
  citizen: U(7), citizen2: U(8), citizen3: U(9), citizen4: U(10), adminB: U(11), citizenB: U(12), superadmin: U(13), staffB: U(14),
}
const roleOf = alias => ({ adminB: 'admin', staffB: 'staff', citizen2: 'citizen', citizen3: 'citizen', citizen4: 'citizen', citizenB: 'citizen' }[alias] ?? alias)
const muniOf = alias => (['adminB', 'staffB', 'citizenB'].includes(alias) ? B : alias === 'superadmin' ? null : A)
for (const [alias, id] of Object.entries(users)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [id])
  await db.query('INSERT INTO public.profiles VALUES ($1, $2, $3, $4, $5)', [id, `ผู้ใช้ ${alias}`, `${alias}@example.test`, roleOf(alias), muniOf(alias)])
}
const as = async alias => {
  const anon = alias === 'anon'
  await db.query("SELECT set_config('test.uid', $1, false), set_config('test.role', $2, false), set_config('test.muni', $3, false), set_config('request.headers', '', false)",
    [anon ? '' : users[alias], anon ? '' : roleOf(alias), anon ? '' : (muniOf(alias) ?? '')])
}

let cases = 0
const test = async (label, run) => {
  await reset()
  await run()
  cases++
  console.log('PASS ' + label)
}
const reset = async () => {
  await db.exec('DELETE FROM public.surveys; DELETE FROM public.audit_logs; DELETE FROM public.rpc_rate_limit; DELETE FROM public.job_heartbeats;')
}
const expectError = async (promise, code) => {
  await assert.rejects(promise, error => { assert.equal(error.code, code, `รหัสผิด: ${error.code} / ${error.message}`); return true })
}

const days = n => new Date(Date.now() + n * 86400e3).toISOString()
const create = (muni, question, options, allow = true, closes = null) =>
  db.query(`SELECT public.create_survey($1, $2, ARRAY(SELECT jsonb_array_elements_text($3::jsonb)), $4, $5::timestamptz) AS r`, [muni, question, JSON.stringify(options), allow, closes]).then(r => r.rows[0].r)
const mk = async ({ muni = A, q = 'ปีงบประมาณหน้า ควรทำเรื่องใดก่อน?', opts = ['ซ่อมถนน', 'เพิ่มไฟส่องสว่าง', 'ระบบประปา'], allow = true, by = 'admin' } = {}) => {
  await as(by)
  const r = await create(muni, q, opts, allow)
  assert.equal(r.ok, true, JSON.stringify(r))
  return r.id
}
const optionIds = async id => (await db.query('SELECT id FROM public.survey_options WHERE survey_id = $1 ORDER BY position', [id])).rows.map(r => r.id)
const vote = async (who, sid, oid, comment = null, muni = A) => {
  await as(who)
  return db.query('SELECT public.cast_survey_vote($1, $2, $3, $4) AS r', [sid, muni, oid, comment]).then(r => r.rows[0].r)
}
const view = async (who, sid, muni = A) => { await as(who); return db.query('SELECT public.get_survey($1, $2) AS r', [sid, muni]).then(r => r.rows[0].r) }
const list = async (who, muni = A) => { await as(who); return db.query('SELECT public.list_surveys($1) AS r', [muni]).then(r => r.rows[0].r) }
const staffView = async (who, sid) => { await as(who); return db.query('SELECT public.get_survey_staff($1) AS r', [sid]).then(r => r.rows[0].r) }
const manageList = async (who, muni = A) => { await as(who); return db.query('SELECT public.list_surveys_manage($1) AS r', [muni]).then(r => r.rows[0].r) }
const closeEarly = async (who, sid) => { await as(who); return db.query('SELECT public.close_survey_early($1) AS r', [sid]).then(r => r.rows[0].r) }
const toggleComment = async (who, sid, on) => { await as(who); return db.query('SELECT public.set_survey_comment_enabled($1, $2) AS r', [sid, on]).then(r => r.rows[0].r) }
const deleteSurvey = async (who, sid) => { await as(who); return db.query('SELECT public.delete_survey($1) AS r', [sid]).then(r => r.rows[0].r) }
const countRows = async sid => (await db.query(`SELECT
  (SELECT count(*)::int FROM public.surveys WHERE id = $1) AS surveys,
  (SELECT count(*)::int FROM public.survey_options WHERE survey_id = $1) AS options,
  (SELECT count(*)::int FROM public.survey_voters WHERE survey_id = $1) AS voters,
  (SELECT count(*)::int FROM public.survey_ballots WHERE survey_id = $1) AS ballots`, [sid])).rows[0]
const deleteComment = async (who, bid) => { await as(who); return db.query('SELECT public.delete_survey_comment($1) AS r', [bid]).then(r => r.rows[0].r) }
const forceClosed = (sid, agoDays) =>
  db.query(`UPDATE public.surveys SET opens_at = now() - interval '${agoDays + 5} days', closes_at = now() - interval '${agoDays} days' WHERE id = $1`, [sid])
const columns = async table => (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table])).rows.map(r => r.column_name)

await test('ใช้ migration ซ้ำได้ (IF NOT EXISTS / CREATE OR REPLACE) ไม่พัง และงาน cron ถูกตั้งครั้งเดียว', async () => {
  await db.exec(tablesSql)
  await db.exec(functionsSql)
  await db.exec(deleteSql)
  const { rows } = await db.query(`SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'survey-comment-purge-daily'`)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].schedule, '15 20 * * *')
  assert.match(rows[0].command, /survey_comment_purge_tick/)
})

await test('หีบบัตรไม่มีตัวระบุผู้ตอบ/เวลา · ทะเบียนผู้ใช้สิทธิ์ไม่มีตัวเลือก (โยงกันไม่ได้ในระดับโครงสร้าง)', async () => {
  assert.deepEqual(await columns('survey_ballots'), ['id', 'survey_id', 'option_id', 'voter_group', 'comment'])
  assert.deepEqual(await columns('survey_voters'), ['survey_id', 'user_id'])
  // หีบบัตรกับทะเบียนไม่มี foreign key ถึงกัน
  const { rows } = await db.query(`
    SELECT conrelid::regclass::text AS t, confrelid::regclass::text AS ref FROM pg_constraint
     WHERE contype = 'f' AND ((conrelid = 'public.survey_ballots'::regclass AND confrelid = 'public.survey_voters'::regclass)
                           OR (conrelid = 'public.survey_voters'::regclass AND confrelid = 'public.survey_ballots'::regclass))`)
  assert.equal(rows.length, 0)
})

await test('ตารางทั้ง 4 ปิดสนิท: เปิด RLS ไม่มี policy และ anon/authenticated ไม่มีสิทธิ์ตรง', async () => {
  for (const table of ['surveys', 'survey_options', 'survey_voters', 'survey_ballots']) {
    const { rows } = await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || $1)::regclass`, [table])
    assert.equal(rows[0].relrowsecurity, true, `${table} ไม่ได้เปิด RLS`)
    const policies = await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`, [table])
    assert.equal(policies.rows[0].n, 0, `${table} มี policy`)
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const ok = await db.query(`SELECT has_table_privilege($1, ('public.' || $2)::regclass, $3) AS ok`, [role, table, priv])
        assert.equal(ok.rows[0].ok, false, `${role} มี ${priv} บน ${table}`)
      }
    }
  }
  assert.match(tablesSql, /REVOKE ALL ON public\.surveys, public\.survey_options, public\.survey_voters, public\.survey_ballots FROM anon, authenticated, PUBLIC/)
})

await test('สิทธิ์เรียกฟังก์ชัน: ผู้ไม่ล็อกอินเรียกได้แค่ list_surveys/get_survey · ตัวช่วยภายในและงาน cron เรียกจาก API ไม่ได้', async () => {
  const can = async (role, sig) => (await db.query('SELECT has_function_privilege($1, $2, $3) AS ok', [role, sig, 'EXECUTE'])).rows[0].ok
  const publicFns = ['public.list_surveys(uuid)', 'public.get_survey(uuid, uuid)']
  const memberFns = ['public.cast_survey_vote(uuid, uuid, uuid, text)']
  const staffFns = ['public.create_survey(uuid, text, text[], boolean, timestamptz)', 'public.close_survey_early(uuid)',
    'public.set_survey_comment_enabled(uuid, boolean)', 'public.list_surveys_manage(uuid)', 'public.get_survey_staff(uuid)', 'public.delete_survey_comment(uuid)', 'public.delete_survey(uuid)']
  const internalFns = ['public.survey_voter_group()', 'public.survey_can_manage(uuid)', 'public.survey_comment_keep_days()',
    'public.survey_mask_text(text)', 'public.survey_audit(uuid, text, uuid, text, jsonb)', 'public.survey_comment_purge_tick(timestamptz)',
    'public.survey_can_delete(uuid)']
  for (const f of publicFns) { assert.equal(await can('anon', f), true, f); assert.equal(await can('authenticated', f), true, f) }
  for (const f of [...memberFns, ...staffFns]) { assert.equal(await can('anon', f), false, `anon เรียก ${f} ได้`); assert.equal(await can('authenticated', f), true, f) }
  for (const f of internalFns) { assert.equal(await can('anon', f), false, `anon เรียก ${f} ได้`); assert.equal(await can('authenticated', f), false, `authenticated เรียก ${f} ได้`) }
})

await test('สร้างแบบสำรวจ: admin/officer/staff ของ อปท. นั้นและ superadmin ได้ · viewer/council/technician/ประชาชน/ผู้ไม่ล็อกอิน/อปท. อื่น ไม่ได้', async () => {
  for (const who of ['admin', 'officer', 'staff', 'superadmin']) {
    await reset()
    await as(who)
    const r = await create(A, 'ควรทำเรื่องใดก่อน?', ['ถนน', 'ไฟ'])
    assert.equal(r.ok, true, `${who}: ${JSON.stringify(r)}`)
  }
  for (const who of ['viewer', 'council', 'technician', 'citizen', 'adminB', 'staffB', 'anon']) {
    await reset()
    await as(who)
    const r = await create(A, 'ควรทำเรื่องใดก่อน?', ['ถนน', 'ไฟ'])
    assert.deepEqual(r, { ok: false, code: 'forbidden' }, `${who} ไม่ควรสร้างได้`)
  }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.surveys')).rows[0].n, 0)
})

await test('สร้างแบบสำรวจ: ตัวเลือกเรียงตามที่ส่ง · ปิดรับตั้งไว้ 14 วันเมื่อไม่ระบุ · ลงประวัติโดยไม่เก็บตัวเลือก', async () => {
  const id = await mk({ opts: ['  ซ่อมถนน  ', 'เพิ่มไฟ', 'ประปา', 'ระบายน้ำ'] })
  const { rows } = await db.query('SELECT position, label FROM public.survey_options WHERE survey_id = $1 ORDER BY position', [id])
  assert.deepEqual(rows.map(r => [Number(r.position), r.label]), [[1, 'ซ่อมถนน'], [2, 'เพิ่มไฟ'], [3, 'ประปา'], [4, 'ระบายน้ำ']])
  const span = (await db.query(`SELECT extract(epoch FROM closes_at - opens_at) / 86400 AS d, allow_comment FROM public.surveys WHERE id = $1`, [id])).rows[0]
  assert.ok(Math.abs(Number(span.d) - 14) < 0.01, `ปิดรับต้อง ~14 วัน ได้ ${span.d}`)
  assert.equal(span.allow_comment, true)
  const audit = (await db.query(`SELECT action, actor_role, actor_name, resource_type, resource_id, municipality_id, metadata FROM public.audit_logs`)).rows
  assert.equal(audit.length, 1)
  assert.equal(audit[0].action, 'create')
  assert.equal(audit[0].actor_role, 'admin')
  assert.equal(audit[0].resource_type, 'survey')
  assert.equal(audit[0].resource_id, id)
  assert.equal(audit[0].municipality_id, A)
  assert.ok(!JSON.stringify(audit[0].metadata).includes('ซ่อมถนน'), 'ประวัติไม่ควรเก็บเนื้อหาตัวเลือก')
})

await test('สร้างแบบสำรวจ: ตรวจคำถาม ตัวเลือก และวันปิดรับ', async () => {
  await as('admin')
  const bad = async (q, opts, closes, code) => {
    const r = await create(A, q, opts, true, closes)
    assert.deepEqual(r, { ok: false, code }, `${q} / ${JSON.stringify(opts)} / ${closes}`)
  }
  await bad('สั้น', ['ก', 'ข'], null, 'invalid_question')
  await bad('   ', ['ก', 'ข'], null, 'invalid_question')
  await bad('ก'.repeat(201), ['ก', 'ข'], null, 'invalid_question')
  await bad('คำถามปกติข้อหนึ่ง', ['ก'], null, 'invalid_options')
  await bad('คำถามปกติข้อหนึ่ง', ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ'], null, 'invalid_options')
  await bad('คำถามปกติข้อหนึ่ง', ['ก', ' '], null, 'invalid_options')
  await bad('คำถามปกติข้อหนึ่ง', ['ก', 'ก'], null, 'invalid_options')
  await bad('คำถามปกติข้อหนึ่ง', ['Yes', 'yes'], null, 'invalid_options')
  await bad('คำถามปกติข้อหนึ่ง', ['ก', 'ข'.repeat(101)], null, 'invalid_options')
  await bad('คำถามปกติข้อหนึ่ง', ['ก', 'ข'], days(0.01), 'invalid_closes_at')
  await bad('คำถามปกติข้อหนึ่ง', ['ก', 'ข'], days(91), 'invalid_closes_at')
  assert.equal((await create(A, 'ก'.repeat(200), ['ก', 'ข'.repeat(100), 'ค', 'ง', 'จ'], true, days(90.5))).code, 'invalid_closes_at')
  assert.equal((await create(A, 'ก'.repeat(200), ['ก', 'ข'.repeat(100), 'ค', 'ง', 'จ'], true, days(89))).ok, true)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.surveys')).rows[0].n, 1)
})

await test('สร้างแบบสำรวจ: เปิดพร้อมกันไม่เกิน 3 เรื่อง · คำถามซ้ำที่ยังเปิดอยู่ถูกปฏิเสธ · ปิดแล้วซ้ำได้', async () => {
  await mk({ q: 'คำถามที่หนึ่ง ทดสอบ' })
  await mk({ q: 'คำถามที่สอง ทดสอบ' })
  const third = await mk({ q: 'คำถามที่สาม ทดสอบ' })
  await as('admin')
  assert.deepEqual(await create(A, 'คำถามที่สี่ ทดสอบ', ['ก', 'ข']), { ok: false, code: 'too_many_open' })
  assert.equal((await closeEarly('admin', third)).ok, true)
  assert.deepEqual(await create(A, '  คำถามที่หนึ่ง ทดสอบ ', ['ก', 'ข']), { ok: false, code: 'duplicate' })
  assert.equal((await create(A, 'คำถามที่สามใหม่ ทดสอบ', ['ก', 'ข'])).ok, true)
  // อปท. อื่นนับแยก
  await as('adminB')
  assert.equal((await create(B, 'คำถามที่หนึ่ง ทดสอบ', ['ก', 'ข'])).ok, true)
})

await test('ผู้เข้าชม (ไม่ล็อกอิน) เห็นคำถามและตัวเลือก แต่ไม่เห็นผลรายตัวเลือก/กลุ่ม · ตอบไม่ได้ ต้องล็อกอิน', async () => {
  const id = await mk()
  const [o1] = await optionIds(id)
  await vote('citizen', id, o1)
  const r = await view('anon', id)
  assert.equal(r.found, true)
  assert.equal(r.question, 'ปีงบประมาณหน้า ควรทำเรื่องใดก่อน?')
  assert.equal(r.status, 'open')
  assert.equal(r.total, 1, 'ยอดรวมโชว์ได้ (การ์ดหน้าแรก)')
  assert.equal(r.results_visible, false)
  assert.equal(r.split, null)
  assert.ok(r.options.every(o => o.count === null), 'ยอดรายตัวเลือกต้องซ่อนก่อนตอบ')
  assert.equal(r.can_vote, false)
  assert.equal(r.vote_block, 'login_required')
  assert.equal(r.has_voted, false)
})

await test('get_survey: ไม่พบเมื่อ id ผิด / อปท. ผิด · ไม่ใบ้ว่ามีอยู่', async () => {
  const id = await mk()
  assert.deepEqual(await view('anon', id, B), { found: false })
  assert.deepEqual(await view('citizen', '00000000-0000-4000-8000-0000000fffff'), { found: false })
})

await test('ตอบ: 1 บัญชี 1 เสียง · เห็นผลหลังตอบ · คนอื่นที่ยังไม่ตอบยังไม่เห็น · แยกกลุ่มประชาชน/ผู้มีตำแหน่ง', async () => {
  const id = await mk()
  const [o1, o2, o3] = await optionIds(id)
  assert.deepEqual(await vote('citizen', id, o1), { ok: true, comment_saved: false, comment_masked: false })
  assert.deepEqual((await vote('citizen', id, o2)), { ok: false, code: 'already_voted' })
  assert.equal((await vote('citizen2', id, o1)).ok, true)
  assert.equal((await vote('officer', id, o2)).ok, true)
  assert.equal((await vote('admin', id, o3)).ok, true)
  const mine = await view('citizen', id)
  assert.equal(mine.has_voted, true)
  assert.equal(mine.can_vote, false)
  assert.equal(mine.vote_block, 'already_voted')
  assert.equal(mine.results_visible, true)
  assert.deepEqual(mine.options.map(o => o.count), [2, 1, 1])
  assert.deepEqual(mine.split, { citizen: 2, official: 2 })
  assert.equal(mine.total, 4)
  const other = await view('citizen3', id)
  assert.equal(other.results_visible, false)
  assert.ok(other.options.every(o => o.count === null))
  assert.equal(other.can_vote, true)
  assert.equal(other.vote_block, null)
  // ทะเบียนกับหีบบัตรจำนวนเท่ากัน (ลงทะเบียนและหย่อนบัตรเป็นคู่เสมอ)
  const n = (await db.query('SELECT (SELECT count(*) FROM public.survey_voters)::int AS v, (SELECT count(*) FROM public.survey_ballots)::int AS b')).rows[0]
  assert.deepEqual(n, { v: 4, b: 4 })
})

await test('กลุ่มผู้ตอบ: ทุกบทบาทที่มีตำแหน่งนับเป็น official · ประชาชนนับเป็น citizen', async () => {
  const id = await mk()
  const [o1] = await optionIds(id)
  for (const who of ['admin', 'officer', 'staff', 'viewer', 'council', 'technician']) assert.equal((await vote(who, id, o1)).ok, true, who)
  assert.equal((await vote('citizen', id, o1)).ok, true)
  const r = await view('citizen', id)
  assert.deepEqual(r.split, { citizen: 1, official: 6 })
})

await test('ตอบข้าม อปท. ไม่ได้ · superadmin (ไม่สังกัด) ตอบไม่ได้ · ผู้ไม่ล็อกอินตอบไม่ได้ · อปท. ที่ส่งมาไม่ตรงกับแบบสำรวจ = ไม่พบ', async () => {
  const id = await mk()
  const [o1] = await optionIds(id)
  assert.deepEqual(await vote('citizenB', id, o1, null, A), { ok: false, code: 'other_municipality' })
  assert.deepEqual(await vote('superadmin', id, o1), { ok: false, code: 'other_municipality' })
  assert.deepEqual(await vote('anon', id, o1), { ok: false, code: 'login_required' })
  assert.deepEqual(await vote('citizenB', id, o1, null, B), { ok: false, code: 'not_found' })
  const v = await view('citizenB', id, A)
  assert.equal(v.can_vote, false)
  assert.equal(v.vote_block, 'other_municipality')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.survey_ballots')).rows[0].n, 0)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.survey_voters')).rows[0].n, 0)
})

await test('ตอบ: ตัวเลือกของแบบสำรวจอื่นถูกปฏิเสธ · ตอบไม่ผ่านต้องไม่เหลือแถวในทะเบียน', async () => {
  const s1 = await mk({ q: 'แบบสำรวจที่หนึ่ง ทดสอบ' })
  const s2 = await mk({ q: 'แบบสำรวจที่สอง ทดสอบ' })
  const [foreign] = await optionIds(s2)
  assert.deepEqual(await vote('citizen', s1, foreign), { ok: false, code: 'invalid_option' })
  assert.deepEqual(await vote('citizen', s1, '00000000-0000-4000-8000-0000000fffff'), { ok: false, code: 'invalid_option' })
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.survey_voters')).rows[0].n, 0)
  // หีบบัตรกันที่ระดับฐานข้อมูลด้วย: ใส่บัตรที่ชี้ตัวเลือกของแบบสำรวจอื่นตรงๆ ไม่ได้
  await assert.rejects(db.query(`INSERT INTO public.survey_ballots (survey_id, option_id, voter_group) VALUES ($1, $2, 'citizen')`, [s1, foreign]),
    error => error.code === '23503')
})

await test('ปิดก่อนกำหนด: เฉพาะผู้จัดการของ อปท. นั้น · ปิดแล้วตอบไม่ได้ ผลเปิดให้ทุกคนเห็น (รวมผู้ไม่ล็อกอิน) · ปิดซ้ำไม่ได้', async () => {
  const id = await mk()
  const [o1, o2] = await optionIds(id)
  await vote('citizen', id, o1)
  await vote('citizen2', id, o2)
  for (const who of ['citizen', 'viewer', 'adminB', 'anon']) assert.deepEqual(await closeEarly(who, id), { ok: false, code: 'forbidden' }, who)
  assert.deepEqual(await closeEarly('staff', id), { ok: true })
  assert.deepEqual(await closeEarly('admin', id), { ok: false, code: 'not_open' })
  assert.deepEqual(await vote('citizen3', id, o1), { ok: false, code: 'not_open' })
  const r = await view('anon', id)
  assert.equal(r.status, 'closed')
  assert.equal(r.results_visible, true)
  assert.deepEqual(r.options.map(o => o.count), [1, 1, 0])
  assert.equal(r.vote_block, 'closed')
  assert.deepEqual(await closeEarly('admin', '00000000-0000-4000-8000-0000000fffff'), { ok: false, code: 'not_found' })
  const audit = (await db.query(`SELECT action, actor_role FROM public.audit_logs WHERE action = 'close'`)).rows
  assert.deepEqual(audit, [{ action: 'close', actor_role: 'staff' }])
})

await test('รายการ: เปิดอยู่ขึ้นก่อน · ปิดแล้วที่มีคนตอบแสดงถาวร · ปิดแล้วไม่มีคนตอบซ่อน · เห็นเฉพาะ อปท. ตัวเอง · has_voted เฉพาะผู้ล็อกอิน', async () => {
  const open = await mk({ q: 'เรื่องที่ยังเปิดอยู่ ทดสอบ' })
  const done = await mk({ q: 'เรื่องที่ปิดแล้วมีคนตอบ ทดสอบ' })
  const empty = await mk({ q: 'เรื่องที่ปิดแล้วไม่มีคนตอบ ทดสอบ' })
  await mk({ muni: B, q: 'เรื่องของ อปท. บี ทดสอบ', by: 'adminB' })
  const [d1] = await optionIds(done)
  await vote('citizen', done, d1)
  await closeEarly('admin', done)
  await closeEarly('admin', empty)
  const [o1] = await optionIds(open)
  await vote('citizen', open, o1)

  const anon = await list('anon')
  assert.deepEqual(anon.map(s => [s.id, s.status]), [[open, 'open'], [done, 'closed']])
  assert.ok(anon.every(s => s.has_voted === false))
  assert.equal(anon[0].total, 1)
  const mine = await list('citizen')
  assert.deepEqual(mine.map(s => [s.id, s.has_voted]), [[open, true], [done, true]])
  const other = await list('citizen2')
  assert.deepEqual(other.map(s => [s.id, s.has_voted]), [[open, false], [done, false]])
  assert.equal((await list('adminB', B)).length, 1)
  assert.deepEqual(await list('anon', '00000000-0000-4000-8000-0000000fffff'), [])
})

await test('ความเห็น: เก็บได้ไม่เกิน 300 ตัวอักษร · ว่าง/ช่องว่างล้วน = ไม่เก็บ · ตัดช่องว่างหัวท้าย', async () => {
  const id = await mk()
  const [o1] = await optionIds(id)
  assert.deepEqual(await vote('citizen', id, o1, 'ก'.repeat(301)), { ok: false, code: 'comment_too_long' })
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.survey_voters')).rows[0].n, 0, 'ความเห็นยาวเกินต้องไม่ลงทะเบียนผู้ใช้สิทธิ์')
  assert.deepEqual(await vote('citizen', id, o1, '   '), { ok: true, comment_saved: false, comment_masked: false })
  assert.deepEqual(await vote('citizen2', id, o1, '  ถนนหน้าตลาดเป็นหลุม  '), { ok: true, comment_saved: true, comment_masked: false })
  assert.deepEqual(await vote('citizen3', id, o1, 'ข'.repeat(300)), { ok: true, comment_saved: true, comment_masked: false })
  const saved = (await db.query('SELECT comment FROM public.survey_ballots WHERE comment IS NOT NULL ORDER BY char_length(comment)')).rows.map(r => r.comment)
  assert.deepEqual(saved, ['ถนนหน้าตลาดเป็นหลุม', 'ข'.repeat(300)])
})

await test('ความเห็น: ซ่อนเบอร์โทร เลขบัตร 13 หลัก อีเมล (รวมเลขไทย/ตัวคั่น) แต่ไม่แตะตัวเลขทั่วไป', async () => {
  const id = await mk()
  const [o1] = await optionIds(id)
  const cases = [
    ['โทร 081-234-5678 ด้วย', 'โทร [ซ่อนเบอร์โทร] ด้วย'],
    ['โทร 0812345678', 'โทร [ซ่อนเบอร์โทร]'],
    ['เบอร์ ๐๘๑๒๓๔๕๖๗๘ ครับ', 'เบอร์ [ซ่อนเบอร์โทร] ครับ'],
    ['+66 81 234 5678 ได้เลย', '[ซ่อนเบอร์โทร] ได้เลย'],
    ['บ้านโทร 02-123-4567', 'บ้านโทร [ซ่อนเบอร์โทร]'],
    ['บัตร 1-2345-67890-12-3 นะ', 'บัตร [ซ่อนเลขบัตร] นะ'],
    ['บัตร 1234567890123', 'บัตร [ซ่อนเลขบัตร]'],
    ['บัตร ๑๒๓๔๕๖๗๘๙๐๑๒๓', 'บัตร [ซ่อนเลขบัตร]'],
    ['ส่งมาที่ somchai.k@example.co.th ได้', 'ส่งมาที่ [ซ่อนอีเมล] ได้'],
    ['โทร 0812345678 หรืออีเมล a@b.co', 'โทร [ซ่อนเบอร์โทร] หรืออีเมล [ซ่อนอีเมล]'],
  ]
  const untouched = ['งบ 1,500,000 บาท', 'ปี 2569 หมู่ 3 ซอย 5', 'ราคา 0.5 ล้าน ยาว 100 เมตร', 'วันที่ 01/10/2569 เวลา 08:30-16:30', 'เลข 12345678 และ 250000000', 'ที่ 20-10-2569']
  const users4 = ['citizen', 'citizen2', 'citizen3', 'citizen4', 'officer', 'staff', 'viewer', 'council', 'technician', 'admin']
  // ผู้ตอบ 10 คนต่อรอบ → แบ่งเป็นหลายแบบสำรวจ
  let idx = 0
  const surveys = [id]
  for (const text of [...cases.map(c => c[0]), ...untouched]) {
    if (idx % users4.length === 0 && idx > 0) { await closeEarly('admin', surveys.at(-1)); surveys.push(await mk({ q: `แบบสำรวจรอบที่ ${idx} ทดสอบ` })) }
    const sid = surveys.at(-1)
    const [opt] = await optionIds(sid)
    const r = await vote(users4[idx % users4.length], sid, opt, text)
    assert.equal(r.ok, true, text)
    const expectedMasked = cases.find(c => c[0] === text)
    assert.equal(r.comment_masked, !!expectedMasked, `${text}: flag`)
    idx++
  }
  const stored = (await db.query('SELECT comment FROM public.survey_ballots WHERE comment IS NOT NULL')).rows.map(r => r.comment)
  for (const [input, output] of cases) assert.ok(stored.includes(output), `ต้องเป็น "${output}" จาก "${input}" ได้ ${JSON.stringify(stored)}`)
  for (const text of untouched) assert.ok(stored.includes(text), `ต้องไม่แตะ "${text}"`)
  assert.ok(!stored.some(t => /0812345678|081-234-5678|1234567890123|somchai/.test(t)), 'ต้องไม่เหลือข้อมูลส่วนบุคคลในความเห็นที่เก็บ')
})

await test('ความเห็น: ผู้เข้าชมทั่วไปไม่เห็นเนื้อความเห็นเลย · เจ้าหน้าที่ของ อปท. นั้นเห็นได้โดยไม่มีตัวระบุผู้ตอบ', async () => {
  const id = await mk()
  const [o1, o2] = await optionIds(id)
  const MARK = 'ลับ-ความเห็น-77'
  await vote('citizen', id, o1, `${MARK} ไฟมืดมาก`)
  await vote('citizen2', id, o2, null)
  await vote('officer', id, o2, `${MARK} ถนนเป็นหลุม`)
  for (const who of ['anon', 'citizen', 'citizen3', 'citizenB']) {
    const json = JSON.stringify(await view(who, id))
    assert.ok(!json.includes(MARK), `${who} เห็นความเห็น`)
    assert.ok(!('comments' in JSON.parse(json)))
  }
  assert.ok(!JSON.stringify(await list('anon')).includes(MARK))
  for (const who of ['admin', 'officer', 'staff', 'superadmin']) {
    const r = await staffView(who, id)
    assert.equal(r.found, true, who)
    assert.equal(r.comments.length, 2, who)
    assert.deepEqual(r.comments.map(c => Object.keys(c).sort()), [['id', 'option_id', 'text'], ['id', 'option_id', 'text']])
    const json = JSON.stringify(r)
    for (const uid of Object.values(users)) assert.ok(!json.includes(uid), `${who}: ผลของเจ้าหน้าที่มี id ผู้ใช้ ${uid}`)
    assert.deepEqual(r.split, { total: 3, citizen: 2, official: 1 })
  }
  for (const who of ['viewer', 'council', 'technician', 'citizen', 'adminB', 'anon']) assert.deepEqual(await staffView(who, id), { found: false }, who)
  const m = await manageList('admin')
  assert.deepEqual(m.map(s => [s.total, s.comment_count]), [[3, 2]])
  assert.deepEqual(await manageList('viewer'), [])
  assert.deepEqual(await manageList('adminB', A), [])
})

await test('เปิด-ปิดช่องความเห็น: ปิดแล้วนับโหวตต่อ ทิ้งความเห็นใหม่ ความเห็นเดิมอยู่ · เปิดคืนได้ · ปิดแบบสำรวจแล้วสลับไม่ได้', async () => {
  const id = await mk({ allow: true })
  const [o1] = await optionIds(id)
  assert.equal((await vote('citizen', id, o1, 'ความเห็นก่อนปิดช่อง')).comment_saved, true)
  for (const who of ['citizen', 'viewer', 'adminB', 'anon']) assert.deepEqual(await toggleComment(who, id, false), { ok: false, code: 'forbidden' }, who)
  assert.deepEqual(await toggleComment('staff', id, false), { ok: true, allow_comment: false })
  assert.equal((await view('citizen2', id)).allow_comment, false)
  assert.deepEqual(await vote('citizen2', id, o1, 'ความเห็นหลังปิดช่อง'), { ok: true, comment_saved: false, comment_masked: false })
  assert.equal((await staffView('admin', id)).comments.length, 1)
  assert.equal((await view('citizen2', id)).total, 2)
  assert.deepEqual(await toggleComment('admin', id, true), { ok: true, allow_comment: true })
  assert.equal((await vote('citizen3', id, o1, 'ความเห็นหลังเปิดคืน')).comment_saved, true)
  await closeEarly('admin', id)
  assert.deepEqual(await toggleComment('admin', id, false), { ok: false, code: 'not_open' })
  assert.deepEqual((await db.query(`SELECT action FROM public.audit_logs WHERE action LIKE 'comment_%' ORDER BY created_at, action`)).rows.map(r => r.action).sort(), ['comment_off', 'comment_on'])
})

await test('ลบความเห็น: ลบเฉพาะข้อความ ยอดโหวตไม่เปลี่ยน · เฉพาะผู้จัดการของ อปท. นั้น · ประวัติไม่เก็บเนื้อความเห็น', async () => {
  const id = await mk()
  const [o1] = await optionIds(id)
  await vote('citizen', id, o1, 'ข้อความที่ไม่เหมาะสม-99')
  await vote('citizen2', id, o1, 'ข้อความปกติ')
  const before = await staffView('admin', id)
  const target = before.comments.find(c => c.text === 'ข้อความที่ไม่เหมาะสม-99')
  for (const who of ['citizen', 'viewer', 'adminB', 'anon']) assert.deepEqual(await deleteComment(who, target.id), { ok: false, code: 'forbidden' }, who)
  assert.deepEqual(await deleteComment('officer', '00000000-0000-4000-8000-0000000fffff'), { ok: false, code: 'not_found' })
  assert.deepEqual(await deleteComment('officer', target.id), { ok: true })
  const after = await staffView('admin', id)
  assert.deepEqual(after.comments.map(c => c.text), ['ข้อความปกติ'])
  assert.equal(after.options[0].count, 2, 'ยอดโหวตต้องไม่เปลี่ยน')
  assert.ok(!JSON.stringify((await db.query('SELECT * FROM public.audit_logs')).rows).includes('ข้อความที่ไม่เหมาะสม-99'))
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.audit_logs WHERE action = 'delete_comment'`)).rows[0].n, 1)
})

await test('เก็บความเห็น 90 วันหลังปิด: งานลบเคลียร์ความเห็นที่ครบกำหนด (ยอดโหวตอยู่) · ก่อนงานรัน เจ้าหน้าที่ก็ไม่เห็นแล้ว · ที่ยังไม่ครบไม่ถูกแตะ', async () => {
  const old = await mk({ q: 'แบบสำรวจเก่า ทดสอบ' })
  const fresh = await mk({ q: 'แบบสำรวจใหม่ ทดสอบ' })
  const edge = await mk({ q: 'แบบสำรวจเพิ่งปิด 89 วัน ทดสอบ' })
  for (const sid of [old, fresh, edge]) {
    const [o] = await optionIds(sid)
    await vote('citizen', sid, o, 'ความเห็นทดสอบการลบ')
    await vote('citizen2', sid, o, null)
  }
  await forceClosed(old, 100)
  await forceClosed(edge, 89)
  assert.deepEqual((await staffView('admin', old)).comments, [], 'ครบ 90 วันแล้วต้องไม่คืนความเห็น แม้งานลบยังไม่รัน')
  assert.equal((await staffView('admin', edge)).comments.length, 1)
  assert.equal((await db.query('SELECT comment FROM public.survey_ballots b WHERE b.survey_id = $1 AND comment IS NOT NULL', [old])).rows.length, 1, 'ก่อนงานรัน ข้อมูลยังอยู่ในตาราง')
  const tick = (await db.query('SELECT public.survey_comment_purge_tick() AS r')).rows[0].r
  assert.deepEqual(tick, { ok: true, purged: 1 })
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.survey_ballots WHERE survey_id = $1 AND comment IS NOT NULL', [old])).rows[0].n, 0)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.survey_ballots WHERE survey_id = $1', [old])).rows[0].n, 2, 'ยอดโหวตต้องอยู่ครบ')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.survey_ballots WHERE comment IS NOT NULL')).rows[0].n, 2)
  assert.equal((await view('anon', old)).total, 2)
  assert.deepEqual((await db.query('SELECT public.survey_comment_purge_tick() AS r')).rows[0].r, { ok: true, purged: 0 }, 'รันซ้ำไม่ทำอะไรเพิ่ม')
  const beat = (await db.query(`SELECT last_ok_at FROM public.job_heartbeats WHERE job_name = 'survey-comment-purge'`)).rows
  assert.equal(beat.length, 1)
  assert.equal((await db.query('SELECT public.survey_comment_keep_days() AS d')).rows[0].d, 90)
})

await test('ลบบัญชีผู้ตอบ: ทะเบียนหายแต่บัตรอยู่ ยอดไม่เปลี่ยน · ลบแบบสำรวจ: ตัวเลือก ทะเบียน และบัตรหายตาม', async () => {
  const id = await mk()
  const [o1] = await optionIds(id)
  await vote('citizen4', id, o1, 'ความเห็น')
  await db.query('DELETE FROM auth.users WHERE id = $1', [users.citizen4])
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.survey_voters')).rows[0].n, 0)
  assert.equal((await view('anon', id)).total, 1)
  await db.query('DELETE FROM public.surveys WHERE id = $1', [id])
  for (const table of ['survey_options', 'survey_voters', 'survey_ballots']) {
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n, 0, table)
  }
  await db.query('INSERT INTO auth.users VALUES ($1)', [users.citizen4]) // คืนบัญชีให้เทสต์ถัดไป
})

await test('ตอบถี่เกิน 20 ครั้ง/5 นาที → PT429 · สร้างถี่เกินก็ PT429', async () => {
  const id = await mk()
  const [o1] = await optionIds(id)
  await db.query('DELETE FROM public.rpc_rate_limit')
  assert.equal((await vote('citizen3', id, o1)).ok, true)
  for (let i = 0; i < 19; i++) assert.equal((await vote('citizen3', id, o1)).code, 'already_voted')
  await expectError(vote('citizen3', id, o1), 'PT429')
  // ผู้ล็อกอินคนอื่นไม่โดนลูกหลง
  assert.equal((await vote('citizen2', id, o1)).ok, true)
  await db.query('DELETE FROM public.rpc_rate_limit')
  await as('staff')
  for (let i = 0; i < 20; i++) await create(A, 'ก', ['ก', 'ข'])
  await expectError(create(A, 'ก', ['ก', 'ข']), 'PT429')
})

await test('ลบแบบสำรวจ: เฉพาะ admin ของ อปท. นั้นกับ superadmin · officer/staff ที่สร้าง/ปิดได้ก็ลบไม่ได้ · ที่ลบไม่ได้ข้อมูลไม่หาย', async () => {
  for (const who of ['admin', 'superadmin']) {
    const id = await mk()
    assert.deepEqual(await deleteSurvey(who, id), { ok: true }, who)
    assert.equal((await countRows(id)).surveys, 0, who)
  }
  const id = await mk()
  const [o1] = await optionIds(id)
  await vote('citizen2', id, o1, 'ความเห็นต้องไม่หาย')
  for (const who of ['officer', 'staff', 'viewer', 'council', 'technician', 'citizen', 'adminB', 'staffB', 'citizenB', 'anon']) {
    assert.deepEqual(await deleteSurvey(who, id), { ok: false, code: 'forbidden' }, who)
  }
  assert.deepEqual(await countRows(id), { surveys: 1, options: 3, voters: 1, ballots: 1 }, 'ที่ลบไม่ได้ ข้อมูลต้องยังอยู่ครบ')
  assert.deepEqual(await deleteSurvey('admin', '00000000-0000-4000-8000-0000000fffff'), { ok: false, code: 'not_found' })
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.audit_logs WHERE action = 'delete'`)).rows[0].n, 2, 'ลงประวัติเฉพาะที่ลบสำเร็จ')
})

await test('ลบแบบสำรวจ: ตัวเลือก ทะเบียนผู้ใช้สิทธิ์ ยอดโหวต ความเห็น หายครบ · เรื่องอื่นไม่ถูกแตะ · ผู้เข้าชมไม่เห็นและตอบเรื่องที่ลบแล้วไม่ได้', async () => {
  const gone = await mk({ q: 'เรื่องที่จะถูกลบ ทดสอบ' })
  const keep = await mk({ q: 'เรื่องที่ต้องอยู่ ทดสอบ' })
  const goneOptions = await optionIds(gone)
  for (const sid of [gone, keep]) {
    const [o1, o2] = await optionIds(sid)
    await vote('citizen', sid, o1, 'ความเห็นของเรื่อง')
    await vote('citizen2', sid, o2, null)
  }
  const keepBefore = await countRows(keep)
  assert.deepEqual(await countRows(gone), { surveys: 1, options: 3, voters: 2, ballots: 2 })
  assert.deepEqual(await deleteSurvey('admin', gone), { ok: true })
  assert.deepEqual(await countRows(gone), { surveys: 0, options: 0, voters: 0, ballots: 0 })
  assert.deepEqual(await countRows(keep), keepBefore, 'เรื่องอื่นต้องไม่ถูกแตะ')
  assert.deepEqual((await list('citizen')).map(s => s.id), [keep])
  assert.equal((await view('citizen', gone)).found, false)
  assert.equal((await staffView('admin', gone)).found, false)
  assert.deepEqual((await manageList('admin')).map(s => s.id), [keep])
  assert.equal((await vote('citizen3', gone, goneOptions[0])).ok, false, 'ตอบเรื่องที่ลบแล้วต้องไม่ได้')
  assert.deepEqual(await deleteSurvey('admin', gone), { ok: false, code: 'not_found' }, 'ลบซ้ำ')
})

await test('ลบแบบสำรวจ: ลงประวัติ (ใคร เรื่องอะไร สถานะ ผู้ตอบ ความเห็น) ไม่เก็บเนื้อความเห็น · ประวัติอยู่ต่อหลังลบ', async () => {
  const open = await mk({ q: 'เรื่องที่ยังเปิดอยู่ ทดสอบ' })
  const closed = await mk({ q: 'เรื่องที่ปิดไปแล้ว ทดสอบ' })
  const early = await mk({ q: 'เรื่องที่ปิดก่อนกำหนด ทดสอบ' })
  for (const sid of [open, closed, early]) {
    const [o1, o2] = await optionIds(sid)
    await vote('citizen', sid, o1, 'ความเห็นลับ-77')
    await vote('citizen2', sid, o2, null)
    await vote('citizen3', sid, o1, 'อีกความเห็นหนึ่ง')
  }
  await forceClosed(closed, 1)
  assert.deepEqual(await closeEarly('admin', early), { ok: true })
  const expected = { [open]: 'open', [closed]: 'closed', [early]: 'closed' }
  for (const sid of [open, closed, early]) assert.deepEqual(await deleteSurvey('admin', sid), { ok: true })
  const { rows } = await db.query(`SELECT * FROM public.audit_logs WHERE action = 'delete' ORDER BY resource_label`)
  assert.equal(rows.length, 3)
  for (const row of rows) {
    assert.equal(row.resource_type, 'survey')
    assert.equal(row.actor_id, users.admin)
    assert.equal(row.actor_role, 'admin')
    assert.equal(row.municipality_id, A)
    assert.deepEqual(row.metadata, { status: expected[row.resource_id], answers: 3, comments: 2 }, row.resource_label)
    assert.match(row.resource_label, /ทดสอบ$/)
  }
  assert.deepEqual(rows.map(r => r.resource_id).sort(), [open, closed, early].sort())
  assert.ok(!JSON.stringify(rows).includes('ความเห็นลับ-77') && !JSON.stringify(rows).includes('อีกความเห็นหนึ่ง'), 'ประวัติต้องไม่มีเนื้อความเห็น')
  // ประวัติของ superadmin: ใช้ชื่อ/บทบาทของผู้กดจริง
  const sid = await mk({ q: 'เรื่องที่ superadmin ลบ ทดสอบ' })
  await deleteSurvey('superadmin', sid)
  const last = (await db.query(`SELECT actor_id, actor_role, metadata FROM public.audit_logs WHERE resource_id = $1 AND action = 'delete'`, [sid])).rows[0]
  assert.equal(last.actor_id, users.superadmin)
  assert.equal(last.actor_role, 'superadmin')
  assert.deepEqual(last.metadata, { status: 'open', answers: 0, comments: 0 })
})

await test('ลบแบบสำรวจ: ลงประวัติไม่สำเร็จ = ไม่ลบ (ประวัติกับการลบอยู่ธุรกรรมเดียวกัน)', async () => {
  const id = await mk()
  const [o1] = await optionIds(id)
  await vote('citizen', id, o1, 'ต้องไม่หายถ้าลงประวัติไม่ได้')
  await db.exec(`ALTER TABLE public.audit_logs ADD CONSTRAINT test_reject_delete CHECK (action <> 'delete')`)
  try {
    await as('admin')
    await assert.rejects(db.query('SELECT public.delete_survey($1)', [id]))
  } finally {
    await db.exec('ALTER TABLE public.audit_logs DROP CONSTRAINT test_reject_delete')
  }
  assert.deepEqual(await countRows(id), { surveys: 1, options: 3, voters: 1, ballots: 1 })
})

await test('ลบแล้วได้ช่องคืน: เปิดครบ 3 เรื่อง → ลบ 1 → สร้างใหม่ได้ · ตั้งคำถามเดิมซ้ำได้', async () => {
  const q = 'คำถามที่เคยถูกลบ ทดสอบ'
  const first = await mk({ q })
  await mk({ q: 'เรื่องที่สอง ทดสอบ' })
  await mk({ q: 'เรื่องที่สาม ทดสอบ' })
  await as('admin')
  assert.equal((await create(A, 'เรื่องที่สี่ ทดสอบ', ['ก', 'ข'])).code, 'too_many_open')
  assert.equal((await create(A, q, ['ก', 'ข'])).code, 'too_many_open')
  assert.deepEqual(await deleteSurvey('admin', first), { ok: true })
  await as('admin')
  assert.equal((await create(A, q, ['ก', 'ข'])).ok, true, 'ลบแล้วถามคำถามเดิมได้อีก')
})

await test('ตั้งใจซ่อน: ทุกฟังก์ชันของผู้ถือสิทธิ์ตอบ "ผู้ตอบ" ให้เห็นแค่ตัวเองว่าตอบแล้ว ไม่ได้ว่าเลือกอะไร (ฝั่งเซิร์ฟเวอร์ไม่รู้)', async () => {
  const id = await mk()
  const [o1] = await optionIds(id)
  await vote('citizen', id, o1)
  const r = await view('citizen', id)
  const keys = Object.keys(r)
  assert.ok(!keys.some(k => /my_option|chosen|choice|selected/i.test(k)), `ไม่ควรมีคำตอบของฉันในผลลัพธ์: ${keys}`)
  assert.ok(!r.options.some(o => 'mine' in o))
})

console.log(`\nครบ ${cases} กลุ่ม`)
await db.close()

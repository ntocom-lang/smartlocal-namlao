// Isolated PGlite 0.5.8 only; no project, .env, network or real citizen data.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
process.env.PATIENT_UI_QA = '1'
const { db, actor, rpc, tenant, admin, coordinator, driver, citizen, id } = await import('./patient-booking-db.test.mjs')
const readMigration = file => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
const migration = await readMigration('20261003120000_patient_booking_community_rules_rpc.sql')
const existing = [
 '20260927190000_patient_booking_move_into_trip.sql',
 '20260928120000_patient_booking_multiwave.sql',
 '20260929100000_patient_booking_update_pickup.sql',
 '20260929110000_patient_booking_change_hospital.sql',
 '20260926125325_patient_booking_staff_work_badge.sql',
 '20260929130000_patient_booking_driver_cover.sql',
 '20260930110000_patient_booking_duplicate_shared_trip.sql',
 '20261001100000_patient_booking_history.sql',
 '20261002090000_patient_booking_period_report.sql',
 '20261002130000_patient_booking_letter_per_booking_columns.sql',
 '20261002130100_patient_booking_letter_per_booking_rpc.sql',
]
let checks = 0
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++ }
const fails = async (job, pattern) => { await assert.rejects(job, pattern); checks++ }
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const clone = value => structuredClone(value)
const empty = { enabled: false, window_start: null, window_end: null, places: [], activities: [], rules_reference: '' }
const policy = { enabled: true, window_start: 360, window_end: 1200,
 places: [{ id: 'test-temple', label: '  TEST วัด  ', minutes: 30 }],
 activities: [{ code: 'test-activity', label: '  TEST กิจกรรมชุมชน  ' }], rules_reference: '  TEST ข้อบังคับสำหรับข้อมูลจำลองเท่านั้น  ' }
const save = (revision, data, muni = tenant) => rpc('patient_booking_save_community_rules', [muni, revision, data])
const current = async () => (await rpc('patient_booking_workspace', [tenant])).community_rules
try {
 await db.exec('RESET ROLE')
 for (const file of existing) await db.exec(await readMigration(file))
 const oldFunctions = (await db.query("SELECT oid::regprocedure::text AS identity,prosrc,proacl::text AS acl,prosecdef,proconfig,provolatile FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY 1")).rows
 await actor(admin)
 const oldInfo = await rpc('patient_booking_info', [tenant])
 const oldWorkspace = await rpc('patient_booking_workspace', [tenant])
 await db.exec('RESET ROLE')
 // Failed dependencies/drift must roll back before either existing RPC changes.
 await db.exec('ALTER TABLE public.patient_booking_community_rules RENAME TO test_hidden_rules')
 await fails(() => db.exec(migration), /foundation migrations first/)
 await db.exec('ROLLBACK')
 await db.exec('ALTER TABLE public.test_hidden_rules RENAME TO patient_booking_community_rules')
 const oldWorkspaceBody = oldFunctions.find(f => f.identity === 'patient_booking_workspace(uuid)').prosrc.replace(/\r/g, '')
 await db.exec("CREATE OR REPLACE FUNCTION public.patient_booking_workspace(p_muni uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN '{}'::jsonb; END $$;")
 await fails(() => db.exec(migration), /Function drift: patient_booking_workspace/)
 await db.exec('ROLLBACK')
 await db.exec(await readMigration('20260929130000_patient_booking_driver_cover.sql').then(text => text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.patient_booking_workspace'), text.indexOf('CREATE OR REPLACE FUNCTION public.patient_booking_action'))))
 await db.exec(migration)
 await fails(() => db.exec(migration), /RPC already exists/)
 await db.exec('ROLLBACK')
 const newFunctions = (await db.query("SELECT oid::regprocedure::text AS identity,prosrc,proacl::text AS acl,prosecdef,proconfig,provolatile FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY 1")).rows
 for (const fn of oldFunctions) {
  const next = newFunctions.find(f => f.identity === fn.identity)
  assert.ok(next)
  check({ ...next, prosrc: undefined }, { ...fn, prosrc: undefined })
  if (!['patient_booking_info(uuid)', 'patient_booking_workspace(uuid)'].includes(fn.identity)) check(next.prosrc, fn.prosrc)
 }
 // Verify the complete workspace body survived; remove only approved additions.
 const nextWorkspaceBody = newFunctions.find(f => f.identity === 'patient_booking_workspace(uuid)').prosrc.replace(/\r/g, '')
 check(nextWorkspaceBody
  .replace(' c public.patient_booking_community_rules; b jsonb;', ' b jsonb;')
  .replace('\n  SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni;', '')
  .replace(/\n  'community_rules',[\s\S]*?(?=\n  'bookings',b,)/, ''), oldWorkspaceBody)
 const meta = await row("SELECT prosecdef,proconfig,provolatile,has_function_privilege('anon',oid,'EXECUTE') AS anon,has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated FROM pg_proc WHERE oid='public.patient_booking_save_community_rules(uuid,integer,jsonb)'::regprocedure")
 check(meta, { prosecdef: true, proconfig: ['search_path=""'], provolatile: 'v', anon: false, authenticated: true })
 await actor(admin)
 const info = await rpc('patient_booking_info', [tenant])
 const { community, ...legacyInfo } = info
 check(legacyInfo, oldInfo)
 check(community.enabled, false)
 check([community.window_start, community.window_end, community.places, community.activities], [null, null, [], []])
 check(community.consent_version, 'community-booking-v1')
 check(Object.keys(community).sort(), ['activities','consent_version','enabled','places','privacy_notice','rules_version','window_end','window_start'].sort())
 check(/ข้อมูลการใช้รถเข็น|ข้อมูลสุขภาพ/.test(community.privacy_notice), false)
 const { community_rules: initialRules, ...legacyWorkspace } = await rpc('patient_booking_workspace', [tenant])
 check(legacyWorkspace, oldWorkspace)
 check(initialRules, { municipality_id: tenant, ...empty, rules_version: 1, revision: 1 })
 await db.exec('RESET ROLE')
 check((await row('SELECT count(*)::int AS n FROM public.patient_booking_community_rules')).n, 0)
 console.log('PASS migration dependencies/drift/retry guards, complete old-function preservation, disabled defaults and additive patient projections')

 // Authorization precedes payload validation; failing writes never seed rules.
 for (const who of [null, coordinator, driver, citizen, id(15)]) {
  await actor(who)
  await fails(() => save(1, policy), /permission denied|เฉพาะผู้ดูแลระบบ/)
  if (who && who !== id(15)) check((await rpc('patient_booking_workspace', [tenant])).community_rules,
   who === coordinator ? initialRules : null)
 }
 await actor(admin)
 await fails(() => save(1, policy, id(2)), /เฉพาะผู้ดูแลระบบ/)
 await fails(() => save(null, empty), /กฎชุมชนเปลี่ยนแล้ว/)
 const invalid = [
  [null, /ข้อมูลตั้งค่าชุมชน/], [[], /ข้อมูลตั้งค่าชุมชน/], [5, /ข้อมูลตั้งค่าชุมชน/],
  [{ ...empty, rules_version: 42 }, /ข้อมูลตั้งค่าชุมชน/], [{ ...empty, revision: 42 }, /ข้อมูลตั้งค่าชุมชน/],
  [{ ...empty, enabled: 'true' }, /สถานะเปิดบริการ/], [{ ...empty, enabled: null }, /สถานะเปิดบริการ/],
  [{ ...empty, window_start: 600 }, /ช่วงเวลาชุมชนไม่ถูกต้อง/],
  [{ ...empty, window_start: 0, window_end: 0 }, /ช่วงเวลาชุมชนไม่ถูกต้อง/],
  [{ ...empty, window_start: 1440, window_end: 1440 }, /ช่วงเวลาชุมชนไม่ถูกต้อง/],
  [{ ...empty, window_start: 600, window_end: 500 }, /ช่วงเวลาชุมชนไม่ถูกต้อง/],
  [{ ...empty, window_start: '600', window_end: 900 }, /นาทีเต็ม/],
  [{ ...empty, window_start: 600.5, window_end: 900 }, /นาทีเต็ม/],
  [{ ...empty, window_start: 1e20, window_end: 900 }, /นาทีเต็ม/],
  [{ ...empty, places: {} }, /ต้องเป็นรายการ/], [{ ...empty, activities: null }, /ต้องเป็นรายการ/],
  [{ ...empty, places: Array.from({length:101}, (_, i) => ({id:`p${i}`,label:'TEST',minutes:5})) }, /เกินจำนวน/],
  [{ ...empty, activities: Array.from({length:101}, (_, i) => ({code:`a${i}`,label:'TEST'})) }, /เกินจำนวน/],
  [{ ...empty, rules_reference: null }, /อ้างอิงข้อบังคับ/], [{ ...empty, rules_reference: 'x'.repeat(2001) }, /ยาวเกิน/],
  [{ ...empty, rules_reference: 'x'.repeat(40000) }, /ข้อมูลตั้งค่าชุมชน/],
 ]
 for (const [data, error] of invalid) await fails(() => save(1, data), error)
 for (const place of [null, 5, {}, {id:'__other__',label:'TEST',minutes:30},
  {id:'bad space',label:'TEST',minutes:30}, {id:5,label:'TEST',minutes:30},
  {id:'p',label:' '.repeat(5),minutes:30}, {id:'p',label:'\n',minutes:30},
  {id:'p',label:'x'.repeat(201),minutes:30}, {id:'p',label:5,minutes:30},
  {id:'p',label:'TEST'}, {id:'p',label:'TEST',minutes:'30'}, {id:'p',label:'TEST',minutes:30.5},
  {id:'p',label:'TEST',minutes:-5}, {id:'p',label:'TEST',minutes:1e20},
  {id:'p',label:'TEST',minutes:4}, {id:'p',label:'TEST',minutes:241}, {id:'p',label:'TEST',minutes:30,kind:'hospital'}]) {
  await fails(() => save(1, { ...empty, places: [place] }), /สถานที่ชุมชน|เวลาเดินทาง/)
 }
 for (const activity of [null, 5, {}, {code:'bad space',label:'TEST'}, {code:5,label:'TEST'},
  {code:'a',label:'\n'}, {code:'a',label:'x'.repeat(201)}, {code:'a',label:5}, {code:'a',label:'TEST',extra:true}]) {
  await fails(() => save(1, { ...empty, activities: [activity] }), /กิจกรรมชุมชน/)
 }
 await fails(() => save(1, { ...empty, places: [policy.places[0], policy.places[0]] }), /สถานที่ชุมชนซ้ำ/)
 await fails(() => save(1, { ...empty, activities: [policy.activities[0], policy.activities[0]] }), /กิจกรรมชุมชนซ้ำ/)
 for (const patch of [{window_start:null,window_end:null},{places:[]},{activities:[]},{rules_reference:''},{rules_reference:'\n'}]) {
  await fails(() => save(1, { ...policy, ...patch }), /ก่อนเปิดบริการชุมชน/)
 }
 await db.exec('RESET ROLE')
 check((await row('SELECT count(*)::int AS n FROM public.patient_booking_community_rules')).n, 0)
 check((await row("SELECT count(*)::int AS n FROM public.patient_booking_events WHERE action='community_rules_changed'")).n, 0)
 console.log('PASS admin/tenant authorization, JSON and bounds validation, enable prerequisites and rollback without seeding')

 await actor(admin)
 check(await save(1, empty), 2)
 let rules = await current()
 check([rules.enabled,rules.window_start,rules.window_end,rules.rules_version,rules.revision], [false,null,null,1,2])
 const savedSettings = (await rpc('patient_booking_workspace', [tenant])).settings
 check(await save(2, policy), 3)
 rules = await current()
 check([rules.enabled,rules.window_start,rules.window_end,rules.rules_version,rules.revision], [true,360,1200,2,3])
 check(rules.places, [{id:'test-temple',label:'TEST วัด',minutes:30}])
 check(rules.activities, [{code:'test-activity',label:'TEST กิจกรรมชุมชน'}])
 check(rules.rules_reference, 'TEST ข้อบังคับสำหรับข้อมูลจำลองเท่านั้น')
 check((await rpc('patient_booking_workspace', [tenant])).settings, savedSettings)
 const stableRules = clone(rules)
 await fails(() => save(2, empty), /กฎชุมชนเปลี่ยนแล้ว/)
 check(await current(), stableRules)
 await actor(coordinator)
 check((await current()).rules_reference, stableRules.rules_reference)
 await fails(() => save(3, empty), /เฉพาะผู้ดูแลระบบ/)
 for (const who of [driver,citizen]) {
  await actor(who)
  check((await rpc('patient_booking_workspace', [tenant])).community_rules, null)
 }
 await actor(null)
 const publicInfo = await rpc('patient_booking_info', [tenant])
 check(publicInfo.community.enabled, true)
 check(publicInfo.routes, oldInfo.routes)
 check(['rules_reference','revision','municipality_id','updated_at'].some(k => k in publicInfo.community), false)
 await actor(admin)
 const legacySettings = (await rpc('patient_booking_workspace', [tenant])).settings
 await rpc('patient_booking_save_settings', [tenant, legacySettings.revision, { ...legacySettings, contact_phone: '0800000999' }])
 check(await current(), stableRules)
 // A flag-only change does not rewrite policy version or pending journey data.
 check(await save(3, { ...policy, enabled: false }), 4)
 rules = await current()
 check([rules.enabled,rules.rules_version,rules.revision], [false,2,4])
 check((await rpc('patient_booking_info', [tenant])).community.enabled, false)
 check(await save(4, { ...policy, enabled: false, window_start: 0, window_end: 1440,
  places:[{id:'early',label:'TEST 5',minutes:5},{id:'late',label:'TEST 240',minutes:240}] }), 5)
 check((await current()).rules_version, 3)
 const maxPolicy = { ...empty, places:Array.from({length:100}, (_,i)=>({id:`p${i}`,label:`TEST ${i}`,minutes:5})),
  activities:Array.from({length:100}, (_,i)=>({code:`a${i}`,label:`TEST ${i}`})) }
 check(await save(5, maxPolicy), 6)
 rules = await current()
 check([rules.places.length,rules.activities.length,rules.window_start,rules.window_end], [100,100,null,null])
 check(await save(6, maxPolicy), 7)
 check((await current()).rules_version, rules.rules_version)
 await fails(() => save(6, empty), /กฎชุมชนเปลี่ยนแล้ว/)
 await db.exec('RESET ROLE')
 const audit = (await db.query("SELECT detail FROM public.patient_booking_events WHERE action='community_rules_changed' ORDER BY created_at,id")).rows
 check(audit.length, 6)
 check(audit.map(e => e.detail.revision), [2,3,4,5,6,7])
 check(Object.keys(audit[0].detail).sort(), ['activity_count','enabled','place_count','revision','rules_version'].sort())
 for (const role of ['anon','authenticated']) for (const privilege of ['SELECT','INSERT','UPDATE','DELETE']) {
  check((await row('SELECT has_table_privilege($1,$2,$3) AS ok', [role,'public.patient_booking_community_rules',privilege])).ok, false)
 }
 console.log('PASS normalized policy, compare-and-swap, stable policy version on flag/no-op changes, isolated patient settings, restricted projections and audit')
 console.log(`All ${checks} community rules checks passed.`)
} finally { await db.close() }

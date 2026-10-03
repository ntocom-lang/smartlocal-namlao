// Local PGlite 0.5.8 only: no .env, project connection, or production data.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const { PGlite } = await import(pathToFileURL(process.env.PATIENT_PGLITE_MODULE).href)
const migrationNames = [
 '20261003110000_patient_booking_community_columns.sql',
 '20261003110100_patient_booking_community_rules_table.sql',
 '20261003110200_patient_booking_community_security_helpers.sql',
]
const migrations = await Promise.all(migrationNames.map(file => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')))
const originalTables = await readFile(new URL('../supabase/migrations/20260918110000_patient_booking_tables.sql', import.meta.url), 'utf8')
const tenant = '00000000-0000-4000-8000-000000000001'
const creator = '00000000-0000-4000-8000-000000000002'
const bookingId = '00000000-0000-4000-8000-000000000003'
const db = new PGlite()
let checks = 0
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++ }
const rejected = async (job, code) => { await assert.rejects(job, error => error.code === code); checks++ }
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const failedMigration = async (sql, message) => {
 await assert.rejects(() => db.exec(sql), message)
 await db.exec('ROLLBACK')
 checks++
}
const deniedPrivileges = async () => {
 for (const role of ['anon', 'authenticated']) {
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
   check((await row('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, 'public.patient_booking_community_rules', privilege])).allowed, false)
  }
 }
 check((await row("SELECT relrowsecurity AS enabled FROM pg_class WHERE oid='public.patient_booking_community_rules'::regclass")).enabled, true)
}

try {
 await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  -- Reproduce inherited default grants: the table must be private immediately,
  -- not only after the final security/helper migration has run.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
  CREATE TABLE public.municipalities(id uuid PRIMARY KEY);
  CREATE TABLE public.profiles(id uuid PRIMARY KEY);
  CREATE TABLE public.referral_partners(id uuid PRIMARY KEY);
 `)
 await failedMigration(migrations[0], /patient_bookings is missing/)
 await failedMigration(migrations[2], /community_rules_table first/)
 await db.exec(originalTables)
 await db.query('INSERT INTO public.municipalities VALUES($1)', [tenant])
 await db.query('INSERT INTO public.profiles VALUES($1)', [creator])
 await db.query(`INSERT INTO public.patient_bookings(
  id,municipality_id,created_by,requester_name,phone,patient_name,relation,pickup,
  in_area,route_id,route_label,appointment_at,mobility,companions,return_mode,consent_text
 ) VALUES($1,$2,$3,'TEST requester','0800000000','TEST patient','self','TEST pickup',
  true,'hospital-test','TEST hospital','2026-10-15T10:00:00+07:00','walk',0,'one_way','TEST consent')`, [bookingId, tenant, creator])
 const before = (await row('SELECT to_jsonb(b) AS value FROM public.patient_bookings b WHERE id=$1', [bookingId])).value
 await failedMigration(migrations[1], /community_columns first/)
 check((await row("SELECT to_regclass('public.patient_booking_community_rules') AS value")).value, null)
 await db.exec(migrations[0])
 await failedMigration(migrations[2], /community_rules_table first/)
 await db.exec(migrations[1])
 await deniedPrivileges()
 await db.exec(migrations[2])
 await deniedPrivileges()
 check((await row('SELECT count(*)::int AS n FROM public.patient_booking_community_rules')).n, 0)
 const after = (await row('SELECT to_jsonb(b) AS value FROM public.patient_bookings b WHERE id=$1', [bookingId])).value
 check(after.service_type, 'patient')
 for (const name of ['party_size', 'group_label', 'purpose_code', 'rules_version']) check(after[name], null)
 const originalFields = { ...after }
 for (const name of ['service_type', 'party_size', 'group_label', 'purpose_code', 'rules_version']) delete originalFields[name]
 check(originalFields, before)
 check((await db.query("SELECT attname FROM pg_attribute WHERE attrelid='public.patient_bookings'::regclass AND attname IN ('patient_name','relation') AND attnotnull ORDER BY attname")).rows.map(r => r.attname), ['patient_name', 'relation'])
 await failedMigration(migrations[0], /already exist/)
 await failedMigration(migrations[1], /already exists/)
 console.log('PASS ordered migrations, atomic default-deny bootstrap, existing-row preservation and original NOT NULL guards')

 for (const [sql, args, code] of [
  ['UPDATE public.patient_bookings SET service_type=$1 WHERE id=$2', ['unknown', bookingId], '23514'],
  ['UPDATE public.patient_bookings SET party_size=$1 WHERE id=$2', [0, bookingId], '23514'],
  ['UPDATE public.patient_bookings SET party_size=$1 WHERE id=$2', [16, bookingId], '23514'],
  ['UPDATE public.patient_bookings SET group_label=$1 WHERE id=$2', ['ก'.repeat(201), bookingId], '23514'],
  ['UPDATE public.patient_bookings SET rules_version=$1 WHERE id=$2', [0, bookingId], '23514'],
  ['UPDATE public.patient_bookings SET patient_name=NULL WHERE id=$1', [bookingId], '23502'],
  ['UPDATE public.patient_bookings SET relation=NULL WHERE id=$1', [bookingId], '23502'],
 ]) await rejected(() => db.query(sql, args), code)
 await db.query('UPDATE public.patient_bookings SET party_size=15,group_label=$1,rules_version=1 WHERE id=$2', ['ก'.repeat(200), bookingId])
 check((await row('SELECT char_length(group_label) AS n FROM public.patient_bookings WHERE id=$1', [bookingId])).n, 200)
 // Leave the old patient fixture in its default shape for later checks.
 await db.query('UPDATE public.patient_bookings SET party_size=NULL,group_label=NULL,rules_version=NULL WHERE id=$1', [bookingId])
 await db.query('INSERT INTO public.patient_booking_community_rules(municipality_id) VALUES($1)', [tenant])
 const defaults = await row('SELECT enabled,window_start,window_end,places,activities,rules_reference,rules_version,revision FROM public.patient_booking_community_rules WHERE municipality_id=$1', [tenant])
 check(defaults, { enabled: false, window_start: null, window_end: null, places: [], activities: [], rules_reference: '', rules_version: 1, revision: 1 })
 for (const sql of [
  'UPDATE public.patient_booking_community_rules SET enabled=true',
  'UPDATE public.patient_booking_community_rules SET window_start=510',
  'UPDATE public.patient_booking_community_rules SET window_start=-1,window_end=600',
  'UPDATE public.patient_booking_community_rules SET window_start=600,window_end=600',
  'UPDATE public.patient_booking_community_rules SET window_start=600,window_end=1441',
  "UPDATE public.patient_booking_community_rules SET places='{}'::jsonb",
  "UPDATE public.patient_booking_community_rules SET activities='null'::jsonb",
  'UPDATE public.patient_booking_community_rules SET rules_version=0',
  'UPDATE public.patient_booking_community_rules SET revision=0',
 ]) await rejected(() => db.query(sql), '23514')
 await rejected(() => db.query('INSERT INTO public.patient_booking_community_rules(municipality_id) VALUES($1)', [tenant]), '23505')
 await rejected(() => db.query('INSERT INTO public.patient_booking_community_rules(municipality_id) VALUES($1)', ['00000000-0000-4000-8000-000000000099']), '23503')
 // Missing each prerequisite still fails even when all the other fields exist.
 await db.query(`UPDATE public.patient_booking_community_rules SET window_start=0,window_end=1440,
  places=$1::jsonb,activities=$2::jsonb,rules_reference='TEST reviewed rules'`, [
  JSON.stringify([{ id: 'place-test', label: 'TEST community center', minutes: 30 }]),
  JSON.stringify([{ code: 'activity-test', label: 'TEST activity' }]),
 ])
 for (const sql of [
  "UPDATE public.patient_booking_community_rules SET enabled=true,rules_reference='   '",
  "UPDATE public.patient_booking_community_rules SET enabled=true,places='[]'::jsonb",
  "UPDATE public.patient_booking_community_rules SET enabled=true,activities='[]'::jsonb",
  'UPDATE public.patient_booking_community_rules SET enabled=true,window_start=NULL,window_end=NULL',
 ]) await rejected(() => db.query(sql), '23514')
 await db.query('UPDATE public.patient_booking_community_rules SET enabled=true')
 check((await row('SELECT enabled FROM public.patient_booking_community_rules')).enabled, true)
 await db.query('UPDATE public.patient_booking_community_rules SET enabled=false')
 console.log('PASS booking bounds, disabled rules with no guessed window, tenant key and enablement prerequisites')

 const seats = async value => (await row('SELECT public.ptb_seats(jsonb_populate_record(NULL::public.patient_bookings,$1::jsonb)) AS n', [JSON.stringify(value)])).n
 for (const [input, expected] of [
  [{ service_type: 'patient', mobility: 'walk', companions: 0 }, 1],
  [{ service_type: 'patient', mobility: 'walk', companions: 5 }, 6],
  [{ service_type: 'patient', mobility: 'wheelchair', companions: 2 }, 2],
  [{ service_type: 'patient', mobility: 'stretcher', companions: 0 }, 0],
  [{ service_type: 'community', party_size: 1 }, 1],
  [{ service_type: 'community', party_size: 15 }, 15],
  [{ service_type: 'community' }, null],
  [{ service_type: 'unknown', party_size: 5 }, null],
  [{ party_size: 5 }, null],
 ]) check(await seats(input), expected)
 check((await row('SELECT public.ptb_seats(NULL::public.patient_bookings) AS n')).n, null)
 check(await row("SELECT provolatile,proisstrict,prosecdef,proconfig FROM pg_proc WHERE oid='public.ptb_seats(public.patient_bookings)'::regprocedure"), {
  provolatile: 'i', proisstrict: true, prosecdef: false, proconfig: ['search_path=""'],
 })
 for (const role of ['anon', 'authenticated']) {
  await db.exec(`SET ROLE ${role}`)
  await rejected(() => db.query('SELECT * FROM public.patient_booking_community_rules'), '42501')
  await rejected(() => db.query('INSERT INTO public.patient_booking_community_rules(municipality_id) VALUES($1)', [tenant]), '42501')
  await rejected(() => db.query('UPDATE public.patient_booking_community_rules SET enabled=true'), '42501')
  // Use a non-NULL row to exercise helper execution, then verify the catalog
  // privilege as well as the actual permission-denied response.
  await rejected(() => db.query('SELECT public.ptb_seats(jsonb_populate_record(NULL::public.patient_bookings,$1::jsonb))', [JSON.stringify({ service_type: 'patient', mobility: 'walk', companions: 0 })]), '42501')
  await db.exec('RESET ROLE')
  check((await row('SELECT has_function_privilege($1,$2,$3) AS allowed', [role, 'public.ptb_seats(public.patient_bookings)', 'EXECUTE'])).allowed, false)
 }
 check((await row("SELECT count(*)::int AS n FROM pg_policy WHERE polrelid='public.patient_booking_community_rules'::regclass")).n, 0)
 console.log('PASS shared seat formula, NULL-safe missing input and direct table/helper denial for every client role')
 console.log(`All ${checks} community foundation checks passed (local PGlite only).`)
} finally {
 await db.close()
}

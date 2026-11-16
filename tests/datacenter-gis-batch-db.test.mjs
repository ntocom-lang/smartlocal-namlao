// ศูนย์รวมข้อมูลดิจิทัล — นำเข้า GIS เฟส 2: shape + ชุดการนำเข้า · รัน migration จริงใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   ในเครื่อง: node tests/datacenter-gis-batch-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   CI: อ่าน path จาก env PATIENT_PGLITE_MODULE
// นโยบาย RLS ของ data_center_entries ตัดมาจาก migration ที่ production รันจริง (20260802071000 + 20260729183852)
// ฟังก์ชันหมุดแผนที่รุ่นก่อนหน้าตัดมาจาก 20260908140000 (ตัวที่ด่าน md5 ของ migration ใหม่ต้องรับ)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const argIndex = process.argv.indexOf('--pglite')
const modulePath = (argIndex >= 0 ? process.argv[argIndex + 1] : null) || process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'ต้องระบุ --pglite <path ของ pglite/dist/index.js> หรือ env PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)

// ไม่แปลง CRLF ของไฟล์ migration ที่รันจริง (ด่าน md5 ตัดช่องว่างทิ้งเองอยู่แล้ว) — แปลงเฉพาะไฟล์ที่ตัดชิ้นมาใช้
const sqlFile = (relative) => readFile(new URL(relative, import.meta.url), 'utf8')
const sqlSource = async (relative) => (await sqlFile(relative)).replace(/\r\n/g, '\n')
const columnsMigration = await sqlFile('../supabase/migrations/20261130100000_data_center_shape_batch_columns.sql')
const rpcMigration = await sqlFile('../supabase/migrations/20261130100100_data_center_shape_batch_rpc.sql')

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `missing ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  assert.ok(end > start, `missing ${endMarker}`)
  return source.slice(start, end)
}
function sliceFunction(source, startMarker) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `missing ${startMarker}`)
  const bodyEnd = source.indexOf('$$;', source.indexOf('$$', start) + 2)
  return source.slice(start, bodyEnd + 3)
}
const prevPins = sliceFunction(
  await sqlFile('../supabase/migrations/20260908140000_adhoc_analyst_grid.sql'),
  'CREATE OR REPLACE FUNCTION public.data_center_unified_pins',
)
const olderPins = sliceFunction( // รุ่นก่อน 20260908140000 — ใช้ทดสอบว่าด่าน md5 "ไม่รับ" body ที่ไม่รู้จัก
  await sqlFile('../supabase/migrations/20260908120000_datacenter_pins_photo_urls.sql'),
  'CREATE FUNCTION public.data_center_unified_pins',
)
const dcePolicies = sliceBetween(
  await sqlSource('../supabase/migrations/20260802071000_scope_department_operational_records.sql'),
  '-- data_center_entries\nDROP POLICY', '-- org_projects / org_project_updates',
)
const publicReadPolicy = await sqlFile('../supabase/migrations/20260729183852_data_center_public_read.sql')

const schema = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, municipality_id uuid, department_id uuid);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_department_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT department_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.is_my_department(p_municipality_id uuid, p_department_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT p_department_id IS NOT NULL AND p_municipality_id = public.get_my_municipality_id() AND p_department_id = public.get_my_department_id(); $$;
CREATE FUNCTION public.department_belongs_to_municipality(p_department_id uuid, p_municipality_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT p_department_id IS NULL OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = p_department_id AND d.municipality_id = p_municipality_id) $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id(), public.get_my_department_id(),
  public.is_my_department(uuid, uuid), public.department_belongs_to_municipality(uuid, uuid) TO anon, authenticated;

CREATE TABLE public.data_center_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL,
  group_name text NOT NULL, category text NOT NULL, name text NOT NULL, description text,
  latitude numeric NOT NULL, longitude numeric NOT NULL, photo_urls text[] DEFAULT '{}',
  route_points jsonb, route_color text, status text NOT NULL DEFAULT 'active',
  created_by uuid, department_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.data_center_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_center_entries TO anon, authenticated;

-- ตารางที่ฟังก์ชันหมุดแผนที่ union อยู่ (เฉพาะคอลัมน์ที่อ้าง)
CREATE TABLE public.complaint_categories (municipality_id uuid, value text, label text);
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY, municipality_id uuid, category text, subject text, detail text, status text,
  latitude numeric, longitude numeric, created_at timestamptz DEFAULT now(), assigned_to uuid, extra_data jsonb
);
CREATE TABLE public.business_registrations (id uuid PRIMARY KEY, municipality_id uuid, business_type text, business_name text,
  status text, latitude numeric, longitude numeric, created_at timestamptz DEFAULT now(), description text);
CREATE TABLE public.infrastructure_works (id uuid PRIMARY KEY, municipality_id uuid, category text, title text,
  status text, latitude numeric, longitude numeric, created_at timestamptz DEFAULT now(), description text);
CREATE TABLE public.civil_projects (id uuid PRIMARY KEY, municipality_id uuid, project_type text, title text,
  status text, latitude numeric, longitude numeric, created_at timestamptz DEFAULT now(), description text);
CREATE FUNCTION public.complaint_category_is_adhoc(_m uuid, _c text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.adhoc_pin_answers(_x jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT _x $$;

-- ค่าเริ่มต้นของ Supabase: ฟังก์ชันใหม่ใน public ได้ EXECUTE ให้ anon/authenticated อัตโนมัติ
-- ไม่ใส่บรรทัดนี้ เทสต์ "anon เรียกไม่ได้" จะผ่านลวง แม้ migration ลืม REVOKE จาก anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
`

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const T1 = id(1), T2 = id(2)
const WORKS = id(3), OFFICE = id(4), WORKS2 = id(5)
const U = {
  admin: id(10), adminOther: id(11), superadmin: id(12), headWorks: id(13), headOffice: id(14),
  staff: id(15), tech: id(16), viewer: id(17), citizen: id(18), staffOther: id(19),
}
const B = { mine: id(50), adminNoDept: id(51), mixed: id(52), other: id(53), staffOwn: id(54) }

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

async function freshDb({ pins = prevPins, withColumns = true } = {}) {
  const db = new PGlite()
  await db.exec(schema)
  await db.exec(dcePolicies)
  await db.exec(publicReadPolicy)
  await db.exec(pins)
  if (withColumns) await db.exec(columnsMigration)
  return db
}

// ── ด่านตรวจหัวไฟล์ ──
await test('ด่าน: ยังไม่รันไฟล์คอลัมน์ → หยุดทั้งก้อน ไม่แตะฟังก์ชันเดิม', async () => {
  const db = await freshDb({ withColumns: false })
  await assert.rejects(() => db.exec(rpcMigration), /ต้องรัน 20261130100000/)
  await db.exec('ROLLBACK') // ไฟล์ห่อ BEGIN/COMMIT — ล้มกลางทางแล้วธุรกรรมค้าง (เหมือน SQL Editor ที่ต้องกดเริ่มใหม่)
  const { rows } = await db.query(`SELECT pg_get_function_result('public.data_center_unified_pins(uuid)'::regprocedure) AS r`)
  assert.ok(!/shape/.test(rows[0].r), 'ฟังก์ชันเดิมต้องไม่ถูกเปลี่ยน')
  await db.close()
})
await test('ด่าน: body บนฐานไม่ใช่รุ่น 20260908140000 → หยุด (กันเขียนทับรุ่นที่ไม่รู้จัก)', async () => {
  const db = await freshDb({ pins: olderPins })
  await assert.rejects(() => db.exec(rpcMigration), /ไม่ตรงกับ 20260908140000/)
  await db.exec('ROLLBACK')
  await db.close()
})
await test('ไฟล์คอลัมน์รันซ้ำได้ (IF NOT EXISTS ข้าม CHECK ที่ติดมากับคอลัมน์ด้วย)', async () => {
  const db = await freshDb()
  await db.exec(columnsMigration)
  await db.close()
})

// ร่างรอบแรกที่เคยถูกรันบนฐานจริงไปก่อน (2026-11-16): คัดจาก pg_get_functiondef ที่เจ้าของส่งกลับมา
// ไม่ตรวจ อปท. · ไม่มีพารามิเตอร์ · ชื่อพารามิเตอร์ p_batch_id ⇒ CREATE OR REPLACE ชน 42P13
const draftFunctions = `
CREATE OR REPLACE FUNCTION public.data_center_cancel_import_batch(p_batch_id uuid)
 RETURNS integer LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v_total int; v_deleted int;
BEGIN
  IF p_batch_id IS NULL THEN RAISE EXCEPTION 'ต้องระบุเลขชุดนำเข้า'; END IF;
  SELECT count(*) INTO v_total FROM public.data_center_entries WHERE import_batch_id = p_batch_id;
  IF v_total = 0 THEN RAISE EXCEPTION 'ไม่พบชุดนำเข้านี้'; END IF;
  DELETE FROM public.data_center_entries WHERE import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> v_total THEN
    RAISE EXCEPTION 'สิทธิ์ลบได้ % จาก % รายการ — ยกเลิกทั้งหมด ไม่ลบบางส่วน', v_deleted, v_total;
  END IF;
  RETURN v_deleted;
END $function$;
CREATE OR REPLACE FUNCTION public.data_center_import_batches()
 RETURNS TABLE(batch_id uuid, item_count integer, point_count integer, line_count integer, polygon_count integer, created_by uuid, imported_at timestamp with time zone)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT d.import_batch_id, count(*)::int,
         count(*) FILTER (WHERE d.shape = 'point')::int,
         count(*) FILTER (WHERE d.shape = 'line')::int,
         count(*) FILTER (WHERE d.shape = 'polygon')::int,
         (array_agg(d.created_by ORDER BY d.created_at))[1], min(d.created_at)
  FROM public.data_center_entries d
  WHERE d.import_batch_id IS NOT NULL
  GROUP BY d.import_batch_id ORDER BY min(d.created_at) DESC LIMIT 50;
$function$;
GRANT EXECUTE ON FUNCTION public.data_center_cancel_import_batch(uuid), public.data_center_import_batches() TO authenticated;
`
await test('ฐานมีร่างเดิมค้างอยู่ (เหตุการณ์จริง): ไฟล์ถอนร่าง + แทนด้วยรุ่นที่ตรวจ อปท. · ไม่เหลือ overload ที่รั่ว', async () => {
  const db = await freshDb()
  await db.exec(draftFunctions)
  await assert.rejects(() => db.exec(`CREATE OR REPLACE FUNCTION public.data_center_cancel_import_batch(_batch_id uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$`), /cannot change name of input parameter/)
  await db.exec(rpcMigration)
  const { rows } = await db.query(`SELECT
      to_regprocedure('public.data_center_import_batches()') IS NULL AS old_list_gone,
      to_regprocedure('public.data_center_import_batches(uuid)') IS NOT NULL AS new_list,
      (SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE oid = 'public.data_center_cancel_import_batch(uuid)'::regprocedure) AS cancel_args,
      pg_get_function_result('public.data_center_unified_pins(uuid)'::regprocedure) LIKE '%shape text%' AS pins_has_shape,
      (SELECT count(*)::int FROM pg_proc WHERE proname IN ('data_center_import_batches', 'data_center_cancel_import_batch')) AS fn_count,
      has_function_privilege('anon', 'public.data_center_import_batches(uuid)', 'EXECUTE') AS list_anon`)
  assert.deepEqual(rows[0], { old_list_gone: true, new_list: true, cancel_args: '_batch_id uuid', pins_has_shape: true, fn_count: 2, list_anon: false })
  await db.close()
})
await test('ฐานมีฟังก์ชันชื่อซ้ำที่ไม่รู้จัก (คนอื่นแก้เอง): หยุดทั้งก้อน ไม่ลบอะไร ไม่แตะฟังก์ชันหมุด', async () => {
  const db = await freshDb()
  await db.exec(draftFunctions.replace("RAISE EXCEPTION 'ไม่พบชุดนำเข้านี้'", "RAISE EXCEPTION 'ข้อความที่คนอื่นแก้'"))
  await assert.rejects(() => db.exec(rpcMigration), /data_center_cancel_import_batch\(uuid\) บนฐานมีเนื้อหาที่ไม่รู้จัก/)
  await db.exec('ROLLBACK')
  const { rows } = await db.query(`SELECT
      to_regprocedure('public.data_center_import_batches()') IS NOT NULL AS old_list_kept,
      (SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE oid = 'public.data_center_cancel_import_batch(uuid)'::regprocedure) AS cancel_args,
      pg_get_function_result('public.data_center_unified_pins(uuid)'::regprocedure) NOT LIKE '%shape%' AS pins_untouched`)
  assert.deepEqual(rows[0], { old_list_kept: true, cancel_args: 'p_batch_id uuid', pins_untouched: true })
  await db.close()
})

const db = await freshDb()
await db.exec(rpcMigration)
await test('รันซ้ำได้ (md5 ของ body ใหม่อยู่ในรายการที่ด่านรับ)', async () => {
  await db.exec(rpcMigration)
})

await test('สิทธิ์: anon เรียกหมุดได้แต่เรียกชุดนำเข้า/ยกเลิกไม่ได้ · 2 ตัวใหม่เป็น INVOKER', async () => {
  const { rows } = await db.query(`SELECT
      has_function_privilege('anon', 'public.data_center_unified_pins(uuid)', 'EXECUTE') AS pins_anon,
      has_function_privilege('authenticated', 'public.data_center_unified_pins(uuid)', 'EXECUTE') AS pins_auth,
      has_function_privilege('anon', 'public.data_center_import_batches(uuid)', 'EXECUTE') AS list_anon,
      has_function_privilege('authenticated', 'public.data_center_import_batches(uuid)', 'EXECUTE') AS list_auth,
      has_function_privilege('anon', 'public.data_center_cancel_import_batch(uuid)', 'EXECUTE') AS cancel_anon,
      has_function_privilege('authenticated', 'public.data_center_cancel_import_batch(uuid)', 'EXECUTE') AS cancel_auth,
      (SELECT prosecdef FROM pg_proc WHERE oid = 'public.data_center_unified_pins(uuid)'::regprocedure) AS pins_definer,
      (SELECT prosecdef FROM pg_proc WHERE oid = 'public.data_center_import_batches(uuid)'::regprocedure) AS list_definer,
      (SELECT prosecdef FROM pg_proc WHERE oid = 'public.data_center_cancel_import_batch(uuid)'::regprocedure) AS cancel_definer`)
  assert.deepEqual(rows[0], {
    pins_anon: true, pins_auth: true, list_anon: false, list_auth: true, cancel_anon: false, cancel_auth: true,
    pins_definer: true, list_definer: false, cancel_definer: false,
  })
})

await test('CHECK: shape รับแค่ point/line/polygon/NULL', async () => {
  await assert.rejects(
    () => db.query(`INSERT INTO public.data_center_entries (municipality_id, group_name, category, name, latitude, longitude, shape)
                    VALUES ($1, 'g', 'c', 'x', 18, 100, 'circle')`, [T1]),
    /data_center_entries_shape_check/)
})

// ── ข้อมูล ──
await db.query(`INSERT INTO public.departments VALUES ($1, $4), ($2, $4), ($3, $5)`, [WORKS, OFFICE, WORKS2, T1, T2])
await db.query(`INSERT INTO public.profiles VALUES
  ($1, 'admin', $11, NULL), ($2, 'admin', $12, NULL), ($3, 'superadmin', NULL, NULL),
  ($4, 'officer', $11, $13), ($5, 'officer', $11, $14), ($6, 'staff', $11, $13), ($7, 'technician', $11, $13),
  ($8, 'viewer', $11, NULL), ($9, 'citizen', $11, NULL), ($10, 'staff', $12, $15)`,
[U.admin, U.adminOther, U.superadmin, U.headWorks, U.headOffice, U.staff, U.tech, U.viewer, U.citizen, U.staffOther,
  T1, T2, WORKS, OFFICE, WORKS2])

const ring = JSON.stringify([{ lat: 18, lng: 100 }, { lat: 18.01, lng: 100 }, { lat: 18.01, lng: 100.01 }, { lat: 18, lng: 100 }])
const line = JSON.stringify([{ lat: 18, lng: 100 }, { lat: 18.02, lng: 100.02 }])
let seq = 100
const entry = async ({ muni = T1, name, shape = null, route = null, batch = null, by = U.staff, dept = WORKS, status = 'active', minute = 0 }) => {
  const eid = id(seq++)
  await db.query(
    `INSERT INTO public.data_center_entries (id, municipality_id, group_name, category, name, latitude, longitude,
       route_points, shape, import_batch_id, created_by, department_id, status, created_at)
     VALUES ($1, $2, 'กลุ่ม', 'ประเภท', $3, 18.005, 100.005, $4::jsonb, $5, $6, $7, $8, $9, '2026-11-16 10:00+07'::timestamptz + make_interval(mins => $10::int))`,
    [eid, muni, name, route, shape, batch, by, dept, status, minute])
  return eid
}
// รายการเดิมก่อนเฟส 2 (shape NULL)
await entry({ name: 'จุดเดิม' })
await entry({ name: 'ถนนเดิม', route: line })
await entry({ name: 'เส้นวงเดิม', route: ring }) // ปิดวงแต่ไม่มี shape = ถือเป็นเส้น ไม่เดาเป็นพื้นที่
await entry({ name: 'route ผิดชนิด', route: '{"lat":1}' })
await entry({ name: 'เก็บแล้ว', status: 'archived' })
// ชุดที่หัวหน้ากองช่างนำเข้า (กองช่าง) 3 ชนิด
await entry({ name: 'ชุด-จุด', shape: 'point', batch: B.mine, by: U.headWorks, minute: 1 })
await entry({ name: 'ชุด-เส้น', shape: 'line', route: line, batch: B.mine, by: U.headWorks, minute: 2 })
await entry({ name: 'ชุด-พื้นที่', shape: 'polygon', route: ring, batch: B.mine, by: U.headWorks, minute: 3 })
await entry({ name: 'ชุด-จุด 4', shape: 'point', batch: B.mine, by: U.headWorks, minute: 4 })
// แอดมินนำเข้าโดยไม่มีกอง
await entry({ name: 'แอดมิน 1', shape: 'point', batch: B.adminNoDept, by: U.admin, dept: null, minute: 10 })
await entry({ name: 'แอดมิน 2', shape: 'polygon', route: ring, batch: B.adminNoDept, by: U.admin, dept: null, minute: 11 })
// ชุดปนสองกอง (ไม่ควรเกิดจากหน้าเว็บ แต่ต้องไม่ลบครึ่งชุด)
await entry({ name: 'ปน-ช่าง', shape: 'point', batch: B.mixed, by: U.admin, dept: WORKS, minute: 20 })
await entry({ name: 'ปน-ปลัด', shape: 'point', batch: B.mixed, by: U.admin, dept: OFFICE, minute: 21 })
// เจ้าหน้าที่นำเข้าเอง
await entry({ name: 'เจ้าหน้าที่ 1', shape: 'point', batch: B.staffOwn, by: U.staff, minute: 30 })
// อปท. อื่น
await entry({ muni: T2, name: 'อื่น 1', shape: 'polygon', route: ring, batch: B.other, by: U.staffOther, dept: WORKS2, minute: 40 })

const as = async (alias) => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [alias && alias !== 'anon' ? U[alias] : ''])
  await db.exec(`SET ROLE ${alias && alias !== 'anon' ? 'authenticated' : 'anon'}`)
}
const asRoot = async () => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', '', false)") }
const countBatch = async (batch) => {
  await asRoot()
  return (await db.query('SELECT count(*)::int AS n FROM public.data_center_entries WHERE import_batch_id = $1', [batch])).rows[0].n
}

// ── 1) หมุดแผนที่ + shape ──
await test('หมุด (anon): shape จริง / อนุมาน / ไม่เดาเส้นปิดวงเป็นพื้นที่ / route ผิดชนิดไม่ error / ไม่มีเลขชุด', async () => {
  await as('anon')
  const { rows, fields } = await db.query('SELECT * FROM public.data_center_unified_pins($1)', [T1])
  const byName = Object.fromEntries(rows.map(r => [r.title, r.shape]))
  assert.equal(byName['จุดเดิม'], 'point')
  assert.equal(byName['ถนนเดิม'], 'line')
  assert.equal(byName['เส้นวงเดิม'], 'line')
  assert.equal(byName['route ผิดชนิด'], 'point')
  assert.equal(byName['ชุด-พื้นที่'], 'polygon')
  assert.equal(byName['ชุด-เส้น'], 'line')
  assert.ok(!('เก็บแล้ว' in byName), 'archived ไม่ออกสาธารณะ')
  assert.ok(!('อื่น 1' in byName), 'ไม่ข้าม อปท.')
  assert.ok(!fields.some(f => /batch/.test(f.name)), 'ไม่มีคอลัมน์เลขชุดในผล')
})
await test('หมุด (เจ้าหน้าที่): สาขาคำร้องได้ shape = null', async () => {
  await asRoot()
  await db.query(`INSERT INTO public.complaints (id, municipality_id, category, subject, status, latitude, longitude) VALUES ($1, $2, 'road', 'ถนนพัง', 'received', 18, 100)`, [id(900), T1])
  await as('staff')
  const { rows } = await db.query('SELECT source_table, shape FROM public.data_center_unified_pins(NULL)')
  const complaint = rows.find(r => r.source_table === 'complaints')
  assert.ok(complaint, 'ต้องเห็นคำร้อง')
  assert.equal(complaint.shape, null)
  assert.equal(rows.filter(r => r.source_table === 'data_center_entries' && r.shape == null).length, 0)
})

// ── 2) รายการชุด ──
await test('รายการชุด: นับแยกชนิด · ชื่อตัวอย่าง 3 รายการตามลำดับนำเข้า · ใหม่ก่อน · เฉพาะ อปท. ตัวเอง', async () => {
  await as('staff')
  const { rows } = await db.query('SELECT * FROM public.data_center_import_batches($1)', [T1])
  assert.deepEqual(rows.map(r => r.batch_id), [B.staffOwn, B.mixed, B.adminNoDept, B.mine])
  const mine = rows.find(r => r.batch_id === B.mine)
  assert.equal(mine.item_count, 4)
  assert.deepEqual([mine.point_count, mine.line_count, mine.polygon_count], [2, 1, 1])
  assert.deepEqual(mine.sample_names, ['ชุด-จุด', 'ชุด-เส้น', 'ชุด-พื้นที่'])
  assert.equal(mine.created_by, U.headWorks)
})
// RLS "dce public read active" ให้ authenticated ทุกคนอ่านแถว active ข้าม อปท. ได้ ⇒ ฟังก์ชันต้องกันเอง
await test('รายการชุด: ขอของ อปท. อื่น → ปฏิเสธ (ไม่พึ่ง RLS ที่เปิดอ่าน active ให้ทุกคน) · superadmin เห็น', async () => {
  await as('staffOther')
  await assert.rejects(() => db.query('SELECT * FROM public.data_center_import_batches($1)', [T1]), /เฉพาะชุดการนำเข้าของหน่วยงานตัวเอง/)
  await as('superadmin')
  assert.equal((await db.query('SELECT * FROM public.data_center_import_batches($1)', [T2])).rows.length, 1)
})
await test('รายการชุด: ประชาชน/ผู้บริหารถูกปฏิเสธ · anon ไม่มีสิทธิ์เรียก · ไม่ระบุ อปท. ถูกปฏิเสธ', async () => {
  await as('citizen')
  await assert.rejects(() => db.query('SELECT * FROM public.data_center_import_batches($1)', [T1]), /ไม่มีสิทธิ์ดูชุดการนำเข้า/)
  await as('viewer')
  await assert.rejects(() => db.query('SELECT * FROM public.data_center_import_batches($1)', [T1]), /ไม่มีสิทธิ์ดูชุดการนำเข้า/)
  await as('anon')
  await assert.rejects(() => db.query('SELECT * FROM public.data_center_import_batches($1)', [T1]), /permission denied/)
  await as('staff')
  await assert.rejects(() => db.query('SELECT * FROM public.data_center_import_batches(NULL)'), /ต้องระบุ municipality_id/)
})

// ── 3) ยกเลิกทั้งชุด ──
const cancel = (batch) => db.query('SELECT public.data_center_cancel_import_batch($1) AS n', [batch])
await test('ยกเลิก: staff/technician ทำไม่ได้แม้เป็นชุดของตัวเอง (ตามนโยบาย DELETE เดิม) · ข้อมูลอยู่ครบ', async () => {
  await as('staff')
  await assert.rejects(() => cancel(B.staffOwn), /เฉพาะผู้ดูแลระบบ หรือหัวหน้ากอง/)
  await as('tech')
  await assert.rejects(() => cancel(B.staffOwn), /เฉพาะผู้ดูแลระบบ หรือหัวหน้ากอง/)
  assert.equal(await countBatch(B.staffOwn), 1)
})
await test('ยกเลิก: anon ไม่มีสิทธิ์เรียก', async () => {
  await as('anon')
  await assert.rejects(() => cancel(B.mine), /permission denied/)
  assert.equal(await countBatch(B.mine), 4)
})
await test('ยกเลิก: viewer/citizen ถูกปฏิเสธ · หัวหน้ากองที่ไม่มีสังกัดกองลบชุดกองช่างไม่ได้', async () => {
  await asRoot()
  await db.query(`INSERT INTO public.profiles VALUES ($1, 'officer', $2, NULL)`, [id(21), T1])
  U.headNoDept = id(21)
  await as('viewer')
  await assert.rejects(() => cancel(B.mine), /เฉพาะผู้ดูแลระบบ หรือหัวหน้ากอง/)
  await as('citizen')
  await assert.rejects(() => cancel(B.mine), /เฉพาะผู้ดูแลระบบ หรือหัวหน้ากอง/)
  await as('headNoDept')
  await assert.rejects(() => cancel(B.mine), /สิทธิ์ลบได้ 0 จาก 4 รายการ/)
  assert.equal(await countBatch(B.mine), 4)
})
await test('ยกเลิก: หัวหน้ากองอื่นลบชุดกองช่างไม่ได้ → ย้อนทั้งหมด', async () => {
  await as('headOffice')
  await assert.rejects(() => cancel(B.mine), /สิทธิ์ลบได้ 0 จาก 4 รายการ/)
  assert.equal(await countBatch(B.mine), 4)
})
await test('ยกเลิก: ชุดปนสองกอง หัวหน้ากองช่างลบได้แค่ครึ่ง → ไม่ลบเลย (ทั้งชุดหรือไม่ลบ)', async () => {
  await as('headWorks')
  await assert.rejects(() => cancel(B.mixed), /สิทธิ์ลบได้ 1 จาก 2 รายการ/)
  assert.equal(await countBatch(B.mixed), 2)
})
await test('ยกเลิก: หัวหน้ากองกับชุดที่แอดมินนำเข้าโดยไม่มีกอง → ไม่ลบ ให้แอดมินทำ', async () => {
  await as('headWorks')
  await assert.rejects(() => cancel(B.adminNoDept), /สิทธิ์ลบได้ 0 จาก 2 รายการ/)
  assert.equal(await countBatch(B.adminNoDept), 2)
})
await test('ยกเลิก: แอดมิน อปท. อื่น → ไม่พบชุด (จำกัด อปท. ตัวเองในฟังก์ชัน) ข้อมูลอยู่ครบ', async () => {
  await as('adminOther')
  await assert.rejects(() => cancel(B.mine), /ไม่พบชุดการนำเข้านี้/)
  assert.equal(await countBatch(B.mine), 4)
})
await test('ยกเลิก: หัวหน้ากองช่างลบชุดของกองตัวเองได้ครบ คืน 4 · รายการอื่นไม่หาย', async () => {
  await asRoot()
  const before = (await db.query('SELECT count(*)::int AS n FROM public.data_center_entries')).rows[0].n
  await as('headWorks')
  assert.equal((await cancel(B.mine)).rows[0].n, 4)
  assert.equal(await countBatch(B.mine), 0)
  await asRoot()
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.data_center_entries')).rows[0].n, before - 4)
})
await test('ยกเลิก: ชุดเดิมซ้ำ → ไม่พบชุด · NULL ถูกปฏิเสธ', async () => {
  await as('headWorks')
  await assert.rejects(() => cancel(B.mine), /ไม่พบชุดการนำเข้านี้/)
  await assert.rejects(() => cancel(null), /ต้องระบุเลขชุดการนำเข้า/)
})
await test('ยกเลิก: แอดมินลบชุดปนกองและชุดไม่มีกองได้ · superadmin ลบข้าม อปท. ได้', async () => {
  await as('admin')
  assert.equal((await cancel(B.mixed)).rows[0].n, 2)
  assert.equal((await cancel(B.adminNoDept)).rows[0].n, 2)
  await as('superadmin')
  assert.equal((await cancel(B.other)).rows[0].n, 1)
  assert.equal(await countBatch(B.other), 0)
})

await db.close()
console.log(`\n${cases} cases passed`)

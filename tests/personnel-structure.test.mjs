import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  EXECUTIVE_POSITION_LABEL,
  SHARED_POSITION_LABEL,
  UNIT_HEAD_POSITION_PATTERN,
  departmentFilterParams,
  groupPositionsByDepartment,
  isUnitHeadPositionName,
  leastPrivilegeRole,
  normalizePositionName,
  positionMatchesDepartment,
  resolvedDepartmentId,
  shouldKeepDepartmentHead,
  suggestedDepartmentId,
} from '../src/lib/personnelStructure.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8')

assert.deepEqual(departmentFilterParams('dept-1'), {
  p_department_id: 'dept-1',
  p_without_department: false,
})
assert.deepEqual(departmentFilterParams('none'), {
  p_department_id: null,
  p_without_department: true,
})
assert.deepEqual(departmentFilterParams(''), {
  p_department_id: null,
  p_without_department: false,
})

assert.equal(leastPrivilegeRole('citizen'), 'staff', 'ประชาชนต้องเริ่มด้วยสิทธิ์เจ้าหน้าที่ต่ำสุด')
assert.equal(leastPrivilegeRole(null), 'staff', 'บัญชีเก่าที่ไม่มี role ต้องเริ่มด้วยสิทธิ์เจ้าหน้าที่ต่ำสุด')
assert.equal(leastPrivilegeRole('technician'), 'technician', 'บุคลากรเดิมต้องไม่ถูกเปลี่ยน role เงียบ ๆ')
assert.equal(leastPrivilegeRole('viewer'), 'viewer')

const departments = [
  { id: 'general', name: 'สำนักปลัด' },
  { id: 'works', name: 'กองช่าง' },
]
const positions = [
  { id: 'p1', name: 'นักจัดการงานทั่วไป', department_id: 'general' },
  { id: 'p2', name: 'นายช่างโยธา', department_id: 'works' },
  { id: 'p3', name: 'ปลัดเทศบาล', department_id: null },
]
const groups = groupPositionsByDepartment(positions, departments)
assert.deepEqual(groups.map((group) => [group.key, group.items.map((item) => item.id)]), [
  ['general', ['p1']],
  ['works', ['p2']],
  ['none', ['p3']],
])
assert.equal(positionMatchesDepartment(positions[0], 'general'), true)
assert.equal(positionMatchesDepartment(positions[0], 'works'), false)
assert.equal(positionMatchesDepartment(positions[2], 'works'), true, 'ตำแหน่งส่วนกลางเลือกกองตอนแต่งตั้งได้')
assert.equal(resolvedDepartmentId(positions[0], 'works'), 'general', 'FK ของตำแหน่งต้องชนะค่าที่ client ส่ง')
assert.equal(resolvedDepartmentId(positions[2], 'works'), 'works')
assert.equal(shouldKeepDepartmentHead({ department_id: 'general', is_dept_head: true }, 'works'), false)
assert.equal(shouldKeepDepartmentHead({ department_id: 'general', is_dept_head: true }, 'general'), true)
assert.equal(normalizePositionName('  นักจัดการ   งานทั่วไป '), 'นักจัดการ งานทั่วไป')

// ตำแหน่งใช้ได้ทุกกองเป็นค่าตั้งต้น ล็อกเฉพาะหัวหน้าหน่วยงานระดับกอง (ทุกประเภท อปท.)
for (const head of ['ผู้อำนวยการกองคลัง', 'ผู้อำนวยการ กองช่าง', 'รองผู้อำนวยการสำนักการช่าง',
  'ผู้อำนวยการสำนักการคลัง', 'หัวหน้าสำนักปลัด', 'หัวหน้าสำนักปลัดองค์การบริหารส่วนจังหวัด',
  'หัวหน้าหน่วยตรวจสอบภายใน']) {
  assert.equal(isUnitHeadPositionName(head), true, `${head} ต้องล็อกกองได้`)
}
for (const shared of ['เจ้าหน้าที่ธุรการชำนาญงาน', 'เจ้าพนักงานจ้างเหมาปฏิบัติหน้าที่ธุรการ', 'นายช่างโยธา',
  'หัวหน้าฝ่ายบริหารงานทั่วไป', 'ผู้อำนวยการโรงเรียน', 'ปลัดเทศบาล', 'ผู้ช่วยผู้อำนวยการกองคลัง', '', null]) {
  assert.equal(isUnitHeadPositionName(shared), false, `${shared} ต้องใช้ได้ทุกกอง`)
}
const hintDepartments = [
  { id: 'general', name: 'สำนักปลัด', short_name: 'ปลัด' },
  { id: 'works', name: 'กองช่าง', short_name: 'ช่าง' },
  { id: 'dup-1', name: 'กองหนึ่ง', short_name: 'ซ้ำ' },
  { id: 'dup-2', name: 'กองสอง', short_name: 'ซ้ำ' },
]
assert.equal(suggestedDepartmentId({ department_id: 'works', department_hint: 'สำนักปลัด' }, hintDepartments), 'works',
  'ตำแหน่งล็อกกองต้องใช้กองที่ล็อก')
assert.equal(suggestedDepartmentId({ department_id: null, department_hint: ' กองช่าง ' }, hintDepartments), 'works')
assert.equal(suggestedDepartmentId({ department_id: null, department_hint: 'ปลัด' }, hintDepartments), 'general')
assert.equal(suggestedDepartmentId({ department_id: null, department_hint: 'ซ้ำ' }, hintDepartments), null, 'ชื่อกำกวมห้ามเดา')
assert.equal(suggestedDepartmentId({ department_id: null, department_hint: 'สำนักการช่าง' }, hintDepartments), null,
  'ชื่อกองไม่ตรง (เช่น ทม./อบจ.) ต้องไม่เดา')
assert.equal(suggestedDepartmentId(null, hintDepartments), null)
assert.equal(groupPositionsByDepartment([], []).at(-1).label, SHARED_POSITION_LABEL)

// จัดกลุ่มตาม "กองหลัก" (ล็อก หรือกองที่มักสังกัดที่ตรงกองเดียว) — ไม่ใช่ตามการล็อกอย่างเดียว
// เดิมตำแหน่งใช้ได้ทุกกองกองรวมก้อนเดียว แอดมินทุ่งแค้วเลยล็อกกองทีละตัวเพื่อจัดกลุ่ม (2569-10-30)
const homeDepartments = [
  { id: 'general', name: 'สำนักปลัด', short_name: 'สป.' },
  { id: 'finance', name: 'กองคลัง' },
]
const homePositions = [
  { id: 'mayor', name: 'นายก', category: 'political_exec', department_id: null, department_hint: null },
  { id: 'clerk', name: 'ปลัด', category: 'top_admin', department_id: null, department_hint: null },
  { id: 'council', name: 'สมาชิกสภา', category: 'council', department_id: null, department_hint: null },
  { id: 'fin-head', name: 'ผู้อำนวยการกองคลัง', category: 'dept_head', department_id: 'finance', department_hint: 'กองคลัง' },
  { id: 'accountant', name: 'นักวิชาการเงินและบัญชี', category: 'operating_staff', department_id: null, department_hint: 'กองคลัง' },
  { id: 'clerical', name: 'เจ้าพนักงานธุรการ', category: 'operating_staff', department_id: null, department_hint: 'สป.' },
  { id: 'generic', name: 'เจ้าพนักงาน', category: 'operating_staff', department_id: null, department_hint: null },
  { id: 'unmatched', name: 'นักวิชาการตรวจสอบภายใน', category: 'operating_staff', department_id: null, department_hint: 'ตรวจสอบภายใน' },
  { id: 'secretary', name: 'เลขานุการนายก', category: 'political_exec', department_id: null, department_hint: 'สำนักปลัด' },
]
const homeGroups = groupPositionsByDepartment(homePositions, homeDepartments)
assert.deepEqual(homeGroups.map((group) => [group.key, group.items.map((item) => item.id)]), [
  ['executive', ['mayor', 'clerk', 'council']],
  ['general', ['clerical', 'secretary']],
  ['finance', ['fin-head', 'accountant']],
  ['none', ['generic', 'unmatched']],
], 'ใช้ได้ทุกกองที่มีกองหลักต้องอยู่ใต้กองนั้น · ผู้บริหารไม่มีกองหลักอยู่บนสุด · ชื่อกองไม่ตรงห้ามเดา')
assert.equal(homeGroups[0].label, EXECUTIVE_POSITION_LABEL)
assert.equal(homeGroups.find((group) => group.key === 'finance').items.find((item) => item.id === 'accountant').department_id, null,
  'จัดกลุ่มแล้วต้องไม่เปลี่ยนสถานะล็อก')
assert.ok(!groups.some((group) => group.key === 'executive'), 'ไม่มีตำแหน่งผู้บริหารไร้กอง = ไม่มีกลุ่มผู้บริหาร')
assert.equal(homeGroups.flatMap((group) => group.items).length, homePositions.length,
  'ทุกตำแหน่งต้องอยู่ในกลุ่มใดกลุ่มหนึ่งพอดี')

const sharedMigration = await read('supabase/migrations/20261030110000_position_shared_by_default.sql')
const homeMigration = await read('supabase/migrations/20261030140000_position_home_department.sql')
const homeBackfill = await read('supabase/migrations/20261030140100_position_home_department_backfill.sql')
assert.doesNotMatch(homeBackfill, /UPDATE public\.profiles/, 'ปลดล็อกรอบ 2 ห้ามย้ายบุคลากร')
assert.match(homeBackfill, /Personnel departments changed during backfill/)
assert.match(homeMigration, /'department_hint','sort_order'\]::text\[\]/, 'RPC ต้องรับกองหลักเพิ่ม')
const sharedBackfill = await read('supabase/migrations/20261030110100_position_shared_backfill.sql')
assert.ok(sharedMigration.includes(`'${UNIT_HEAD_POSITION_PATTERN}'`), 'รูปแบบชื่อหัวหน้าหน่วยงานฝั่ง DB ต้องตรงกับฝั่งหน้าจอ')
assert.doesNotMatch(sharedBackfill, /UPDATE public\.profiles/, 'ปรับตำแหน่งเป็นใช้ได้ทุกกองห้ามย้ายบุคลากร')
assert.match(sharedBackfill, /Personnel departments changed during backfill/)

const migration = await read('supabase/migrations/20261024200000_personnel_structure_departments.sql')
const columnMigration = await read('supabase/migrations/20261024195900_positions_department_column.sql')
assert.match(columnMigration, /ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public\.departments/)
assert.match(migration, /lower\(btrim\(d\.name\)\) = lower\(btrim\(p\.department_hint\)\)/, 'backfill ต้องจับคู่ชื่อแบบ exact')
assert.match(migration, /CREATE TRIGGER trg_profile_position_department_sync/)
assert.doesNotMatch(migration, /UPDATE public\.profiles\s+(?:profile|SET)/, 'migration ห้ามย้ายบุคลากรเดิมตามข้อความ hint')
assert.match(migration, /matched\.match_count = 1/)
assert.match(migration, /holder\.department_id IS DISTINCT FROM matched\.department_id/)
assert.match(migration, /p_department_id IS NULL OR p\.department_id = p_department_id/, 'ต้องกรองกองก่อน LIMIT')
assert.match(migration, /LIMIT v_limit OFFSET v_offset/)
assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_users_with_email_sorted_filtered[\s\S]*FROM PUBLIC/)
assert.match(migration, /search_users_for_staff_assignment/)
assert.match(migration, /Search requires at least 2 characters/)
assert.match(migration, /REVOKE ALL ON FUNCTION public\.search_users_for_staff_assignment/)

const managedProfileAudit = await read('supabase/migrations/20260730180100_158_harden_user_role_management.sql')
assert.match(managedProfileAudit, /CREATE TRIGGER trg_audit_managed_profile_update/)
assert.match(managedProfileAudit, /CASE WHEN NEW\.department_id IS DISTINCT FROM OLD\.department_id THEN 'department_id'/)
assert.match(managedProfileAudit, /CASE WHEN NEW\.position_id IS DISTINCT FROM OLD\.position_id THEN 'position_id'/)

const dashboard = await read('src/pages/AdminDashboard.jsx')
assert.match(dashboard, /get_users_with_email_sorted_filtered/)
assert.match(dashboard, /departmentFilterParams\(filterDept\)/)
assert.match(dashboard, /get_staff_department_counts/)
assert.match(dashboard, /เพิ่มบุคลากรใน\{selectedDepartment\.name\}/)
assert.doesNotMatch(
  dashboard,
  /count:\s*users\.filter\(u => u\.department_id/,
  'จำนวนรายกองห้ามนับจากรายการเฉพาะหน้าที่โหลดมา',
)

// คอลัมน์ "ลงทะเบียน" + "ใช้งานล่าสุด": ทั้งแท็บเจ้าหน้าที่และแท็บประชาชนใช้คนละ RPC ต้องได้เหมือนกัน
const activityMigration = (await read('supabase/migrations/20261030150000_user_list_activity_columns.sql')).replace(/\r\n/g, '\n')
const activityCode = activityMigration.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n')
for (const name of ['get_users_with_email_sorted', 'get_users_with_email_sorted_filtered']) {
  const from = activityCode.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  assert.ok(from > 0, `${name}: ต้องสร้างใหม่ในไฟล์นี้`)
  const body = activityCode.slice(from, activityCode.indexOf('$function$;', from))
  assert.match(body, /position_name text, last_active_at timestamp with time zone\)/, `${name}: ต้องคืน last_active_at`)
  assert.match(body, /v_sort_key NOT IN \('created_at', 'last_active_at',/, `${name}: คีย์เรียงต้องผ่านด่าน`)
  assert.match(body, /GREATEST\(u\.last_sign_in_at, session_data\.last_session_at\) AS last_active_at/)
  assert.match(body, /COALESCE\(u\.created_at, p\.created_at\) AS created_at/, `${name}: วันสมัครจริงอยู่ที่ auth.users`)
  assert.match(body, /r\.position_name, r\.last_active_at\n/, `${name}: SELECT ท้ายคำสั่งต้องคืนคอลัมน์ใหม่`)
  assert.match(body, /v_sort_key = 'last_active_at' AND v_sort_direction = 'asc' THEN r\.last_active_at END ASC NULLS FIRST/)
  assert.match(body, /v_sort_key = 'last_active_at' AND v_sort_direction = 'desc' THEN r\.last_active_at END DESC NULLS LAST/)
  // PDPA: เปิดให้แอดมินเห็นแค่เวลา ห้ามคืนหรือเรียงด้วย ip / อุปกรณ์
  assert.doesNotMatch(body, /\b(?:user_agent|sess\.ip)\b/, `${name}: ห้ามแตะ ip / user_agent`)
  assert.match(body, /p_municipality_id IS DISTINCT FROM/, `${name}: ด่าน อปท. ต้องยังอยู่`)
  // สร้างฟังก์ชันใหม่แล้ว default privileges ของ Supabase จะเปิดให้ anon ถ้าไม่ถอนเอง
  assert.match(activityCode, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon;`), `${name}: ต้องถอนสิทธิ์ anon`)
  assert.match(activityCode, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO authenticated, service_role;`))
}
assert.match(activityCode, /NOTIFY pgrst, 'reload schema'/)
assert.match(dashboard, /USER_SORT_KEYS = new Set\(\['created_at', 'last_active_at',/)
assert.match(dashboard, /label="ลงทะเบียน" sortKey="created_at"/)
assert.match(dashboard, /label="ใช้งานล่าสุด" sortKey="last_active_at"/)
assert.match(dashboard, /user\.last_active_at \?\? user\.last_sign_in_at/, 'RPC รุ่นเก่าที่ยังไม่มีคอลัมน์ใหม่ต้องใช้เวลาล็อกอินแทน')
assert.match(dashboard, /ไม่ใช่เครื่องวัดการทำงาน/, 'ต้องบอกขอบเขตการใช้บนหน้าจอ')

const quickAssign = await read('src/components/admin/PersonnelQuickAssignDialog.jsx')
assert.match(quickAssign, /leastPrivilegeRole\(selectedUser\?\.role\)/)
assert.match(quickAssign, /search_users_for_staff_assignment/)
assert.doesNotMatch(quickAssign, /get_users_with_email_sorted/)
assert.match(quickAssign, /lockedElsewhere/)
assert.match(quickAssign, /makePositionShared\(supabase, tenant\.id, position\)/, 'ตำแหน่งที่ล็อกกองอื่นต้องปลดได้จากหน้าต่างนี้')
assert.match(quickAssign, /department_id: lockNewPosition \? department\.id : null/, 'ตำแหน่งใหม่ต้องใช้ได้ทุกกองเป็นค่าตั้งต้น')
assert.match(dashboard, /makePositionShared\(supabase, tenant\.id, selectedPosition\)/, 'หน้าแต่งตั้งต้องปลดล็อกกองได้')
assert.match(dashboard, /suggestedDepartmentId\(position, depts\)/)
assert.match(dashboard, /groupPositionsByDepartment\(positions, depts\)/, 'ช่องเลือกตำแหน่งตอนแต่งตั้งต้องแยกตามกองหลัก')
assert.match(dashboard, /<optgroup key=\{group\.key\} label=\{group\.label\}>\s*\{group\.items\.map\(position => \(\s*<option key=\{position\.id\} value=\{position\.id\}>/)
assert.doesNotMatch(dashboard, /\{positions\.map\(position => <option key=\{position\.id\}/, 'ห้ามกลับไปเป็นลิสต์แบนราบ')
assert.match(quickAssign, /ระบบไม่ยกระดับให้อัตโนมัติ/)
assert.match(quickAssign, /ยืนยันการย้ายและแต่งตั้ง/, 'การย้ายข้ามกองต้องบอกผลก่อนบันทึก')
assert.match(quickAssign, /min-h-11/, 'ปุ่มและช่องกรอกบนมือถือควรสูงอย่างน้อย 44px')
assert.match(quickAssign, /accountQuery\.trim\(\)\.length >= 2/, 'ห้ามดึงรายชื่อบุคลากรทั้งหมดก่อนมีคำค้น')
assert.doesNotMatch(quickAssign, /id_card/, 'หน้าค้นหาเร็วไม่ควรแสดงเลขบัตรประชาชน')

const catalog = await read('src/components/admin/PositionCatalogAdmin.jsx')
assert.match(catalog, /groupPositionsByDepartment/)
assert.match(catalog, /data-position-scope="locked"/, 'หน้าแบบตำแหน่งต้องบอกว่าตำแหน่งไหนล็อกกอง')
assert.match(catalog, /data-position-scope="shared"/, 'ตำแหน่งใช้ได้ทุกกองที่อยู่ใต้กองต้องบอกว่ายังใช้ได้ทุกกอง')
assert.match(catalog, /admin_save_position/)
assert.match(catalog, /get_position_holder_counts/)
assert.doesNotMatch(catalog, /disabled=\{Boolean\(editing\?\.id/)
assert.match(catalog, /ตัวเลือกขั้นสูง: ระดับ สิทธิ์แนะนำ และลำดับ/)
assert.doesNotMatch(catalog, /value=\{form\.department_hint\}/, 'ห้ามให้กรอกกองเป็นข้อความอิสระอีก')

// Optional PostgreSQL runtime test: use the existing local PGlite 0.5.8 installation.
// node tests/personnel-structure.test.mjs --pglite <path>/node_modules/@electric-sql/pglite/dist/index.js
if (process.argv.includes('--pglite')) {
  const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
  assert.ok(modulePath, 'Supply --pglite <local module path>')
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
  const M1 = id(1), M2 = id(2), D1 = id(11), D2 = id(12), D3 = id(13)
  const ADMIN = id(101), OTHER_ADMIN = id(102), STAFF = id(103), CITIZEN = id(104), SUPER = id(105)
  const P1 = id(201), CONFLICT = id(202), CENTRAL = id(203), AMBIGUOUS = id(204)
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
        $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;
      GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
      CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text);
      CREATE TABLE public.departments (
        id uuid PRIMARY KEY, municipality_id uuid NOT NULL, name text, short_name text,
        sort_order int DEFAULT 0, is_active boolean DEFAULT true
      );
      CREATE TABLE public.positions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL,
        name text NOT NULL, department_hint text, sort_order int DEFAULT 0, role text DEFAULT 'staff', category text
      );
      CREATE TABLE public.staff (id uuid PRIMARY KEY, name text, title text);
      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY, email text, full_name text, role text NOT NULL DEFAULT 'citizen',
        municipality_id uuid, phone text, id_card text, job_title text, address text,
        address_province text, address_district text, address_subdistrict text, address_moo text,
        address_detail text, avatar_url text, created_at timestamptz DEFAULT now(), staff_id uuid,
        department_id uuid, position_id uuid, is_dept_head boolean DEFAULT false, fleet_role text, asset_role text
      );
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, last_sign_in_at timestamptz);
      CREATE TABLE auth.identities (user_id uuid, provider text);
      CREATE TABLE public.test_links (profile_id uuid, municipality_id uuid);
      CREATE FUNCTION public.profile_linked_to_municipality(p_id uuid, p_muni uuid)
        RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT EXISTS(SELECT 1 FROM public.test_links WHERE profile_id=p_id AND municipality_id=p_muni) $$;
      CREATE TABLE public.audit_logs (
        id uuid DEFAULT gen_random_uuid(), municipality_id uuid, actor_id uuid, actor_name text,
        actor_role text, action text, resource_type text, resource_id text, resource_label text,
        metadata jsonb, created_at timestamptz DEFAULT now()
      );
      GRANT SELECT ON public.profiles, public.positions, public.audit_logs TO authenticated;
      INSERT INTO public.municipalities VALUES ('${M1}','[TEST] A'), ('${M2}','[TEST] B');
      INSERT INTO public.departments (id, municipality_id, name, short_name) VALUES
        ('${D1}','${M1}','สำนักปลัด','ปลัด'), ('${D2}','${M1}','กองช่าง','ช่าง'),
        ('${D3}','${M2}','สำนักปลัด','ปลัด'),
        ('${id(14)}','${M1}','กองหนึ่ง','ซ้ำ'), ('${id(15)}','${M1}','กองสอง','ซ้ำ');
      INSERT INTO public.positions (id,municipality_id,name,department_hint) VALUES
        ('${P1}','${M1}','นักจัดการงานทั่วไป','ปลัด'),
        ('${CONFLICT}','${M1}','[TEST] ข้อมูลเดิมขัดกัน','สำนักปลัด'),
        ('${CENTRAL}','${M1}','[TEST] ส่วนกลาง',NULL),
        ('${AMBIGUOUS}','${M1}','[TEST] ชื่อย่อซ้ำ','ซ้ำ');
      INSERT INTO public.profiles (id, full_name, role, municipality_id, department_id, position_id, is_dept_head) VALUES
        ('${ADMIN}','[TEST] admin','admin','${M1}',NULL,NULL,false),
        ('${OTHER_ADMIN}','[TEST] admin B','admin','${M2}',NULL,NULL,false),
        ('${STAFF}','[TEST] บุคลากรเดิม','staff','${M1}','${D2}','${CONFLICT}',true),
        ('${CITIZEN}','[TEST] ประชาชน','citizen','${M1}',NULL,NULL,false),
        ('${SUPER}','[TEST] superadmin','superadmin',NULL,NULL,NULL,false);
      INSERT INTO public.profiles (id,full_name,role,municipality_id,department_id)
        SELECT ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
          '[TEST] บุคลากร ' || n, 'staff', '${M1}', CASE WHEN n<1040 THEN '${D2}'::uuid ELSE '${D1}'::uuid END
        FROM generate_series(1000,1064) n;
      INSERT INTO auth.users (id,email) SELECT id, 'test-' || id || '@example.invalid' FROM public.profiles;
      INSERT INTO auth.identities SELECT id,'email' FROM public.profiles;
    `)
    // Install the real existing guard/audit and latest controlled update RPC.
    await db.exec(managedProfileAudit.slice(0, managedProfileAudit.indexOf('-- One controlled write path')))
    await db.exec(await read('supabase/migrations/20261001120000_restore_keep_citizen_municipality.sql'))
    const before = (await db.query('SELECT id, department_id, role, is_dept_head FROM public.profiles ORDER BY id')).rows
    await db.exec(columnMigration)
    await db.exec(migration)
    assert.deepEqual((await db.query('SELECT id, department_id, role, is_dept_head FROM public.profiles ORDER BY id')).rows, before,
      'migration ต้องไม่ย้ายกองหรือเปลี่ยนสิทธิ์บุคลากรเดิม')
    assert.deepEqual((await db.query('SELECT id, department_id FROM public.positions ORDER BY id')).rows, [
      { id: P1, department_id: D1 }, { id: CONFLICT, department_id: null },
      { id: CENTRAL, department_id: null }, { id: AMBIGUOUS, department_id: null },
    ])
    const asUser = async (userId, sql, parameters = []) => {
      await db.exec('BEGIN')
      try {
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','authenticated',true)", [userId || ''])
        await db.exec('SET LOCAL ROLE authenticated')
        return typeof sql === 'function' ? await sql() : await db.query(sql, parameters)
      } finally { await db.exec('ROLLBACK') }
    }
    const filterSql = 'SELECT * FROM public.get_users_with_email_sorted_filtered($1,$2,$3,$4,$5,$6,$7,$8,$9)'
    const filterParams = [M1, ['staff'], null, D1, false, 10, 0, 'assignment', 'asc']
    const first = await asUser(ADMIN, filterSql, filterParams)
    const second = await asUser(ADMIN, filterSql, [...filterParams.slice(0,6), 10, ...filterParams.slice(7)])
    assert.equal(first.rows.length, 10, 'ต้องกรองก่อน LIMIT แม้บุคลากรในกองจะอยู่ลำดับหลัง 40 คน')
    assert.ok(first.rows.every((row) => row.department_id === D1))
    assert.ok(second.rows.every((row) => row.department_id === D1))
    assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.id)).size, 20, 'pagination ห้ามซ้ำ')
    const counts = await asUser(ADMIN, 'SELECT * FROM public.get_staff_department_counts($1)', [M1])
    assert.equal(Number(counts.rows.find((row) => row.department_id === D1).staff_count), 25)
    assert.equal(Number(counts.rows.find((row) => row.department_id === D2).staff_count), 41)
    for (const caller of [STAFF, CITIZEN, OTHER_ADMIN, null]) {
      await assert.rejects(asUser(caller, filterSql, filterParams), /Permission denied|Authentication required/)
      await assert.rejects(asUser(caller, 'SELECT * FROM public.get_staff_department_counts($1)', [M1]), /Permission denied|Authentication required/)
      await assert.rejects(asUser(caller, 'SELECT * FROM public.search_users_for_staff_assignment($1,$2,10)', [M1,'[TEST]']), /Permission denied|Authentication required/)
    }
    await assert.rejects(asUser(ADMIN, filterSql, [M1,['staff'],null,D3,false,10,0,'full_name','asc']), /Department does not belong/)
    await assert.rejects(asUser(ADMIN, filterSql, [M1,['staff'],null,D1,true,10,0,'full_name','asc']), /mutually exclusive/)
    await assert.rejects(asUser(ADMIN, 'SELECT * FROM public.search_users_for_staff_assignment($1,$2,10)', [M1,'x']), /at least 2/)
    const search = await asUser(ADMIN, 'SELECT * FROM public.search_users_for_staff_assignment($1,$2,10)', [M1,'[TEST]'])
    assert.ok(search.rows.length > 0 && search.rows.length <= 10)
    assert.ok(search.rows.every((row) => row.id !== ADMIN && row.role !== 'superadmin' && row.role !== 'admin'))
    assert.ok(search.rows.every((row) => !('id_card' in row) && !('address' in row)))
    for (const rpc of ['get_staff_department_counts(uuid)', 'search_users_for_staff_assignment(uuid,text,integer)',
      'get_users_with_email_sorted_filtered(uuid,text[],text,uuid,boolean,integer,integer,text,text)']) {
      assert.equal((await db.query('SELECT has_function_privilege($1,$2,$3) allowed', ['anon',`public.${rpc}`,'EXECUTE'])).rows[0].allowed, false)
    }
    const applyAssignment = async (targetId, changes) => {
      await db.exec('BEGIN')
      try {
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','authenticated',true)", [ADMIN])
        await db.query('SELECT public.admin_update_user($1,$2::jsonb)', [targetId, JSON.stringify(changes)])
        const profile = (await db.query('SELECT role,department_id,position_id,is_dept_head FROM public.profiles WHERE id=$1', [targetId])).rows[0]
        const audit = (await db.query('SELECT metadata FROM public.audit_logs WHERE resource_id=$1 ORDER BY created_at DESC LIMIT 1', [targetId])).rows[0]
        return { profile, audit }
      } finally { await db.exec('ROLLBACK') }
    }
    const assignment = await applyAssignment(CITIZEN, {role:'staff', department_id:D2, position_id:P1})
    assert.equal(assignment.profile.department_id, D1, 'ฐานข้อมูลต้องใส่กองจากตำแหน่ง แม้ client ส่งกองผิด')
    assert.equal(assignment.profile.role, 'staff')
    assert.ok(assignment.audit.metadata.changed_fields.includes('position_id'))
    const moved = await applyAssignment(STAFF, {department_id:D1, position_id:P1, is_dept_head:true})
    assert.equal(moved.profile.department_id, D1)
    assert.equal(moved.profile.is_dept_head, false, 'ย้ายกองต้องไม่พกอำนาจหัวหน้ากองเดิมไปด้วย')
    // adminAppointUser: รอบแรกย้ายกอง (trigger ล้างติ๊กเสมอ) รอบสองติ๊กหัวหน้าในกองใหม่ ต้องติดจริงกับ trigger ตัวจริง
    await db.exec('BEGIN')
    try {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','authenticated',true)", [ADMIN])
      await db.query('SELECT public.admin_update_user($1,$2::jsonb)', [STAFF, JSON.stringify({department_id:D1, position_id:P1, is_dept_head:true})])
      assert.equal((await db.query('SELECT is_dept_head FROM public.profiles WHERE id=$1', [STAFF])).rows[0].is_dept_head, false,
        'รอบแรกติ๊กต้องหาย — ถ้า trigger เลิกล้างแล้ว ตัวบันทึก 2 รอบหมดความจำเป็น ต้องกลับมาทบทวน')
      await db.query('SELECT public.admin_update_user($1,$2::jsonb)', [STAFF, JSON.stringify({is_dept_head:true})])
      const appointed = (await db.query('SELECT department_id,is_dept_head FROM public.profiles WHERE id=$1', [STAFF])).rows[0]
      assert.deepEqual(appointed, {department_id:D1, is_dept_head:true}, 'รอบสองต้องติ๊กติดในกองใหม่')
    } finally { await db.exec('ROLLBACK') }
    await assert.rejects(db.query('UPDATE public.positions SET department_id=$1 WHERE id=$2', [D1,CONFLICT]), /personnel hold/)
    await assert.rejects(db.query('DELETE FROM public.positions WHERE id=$1', [CONFLICT]), /personnel hold/)
    await assert.rejects(db.query('INSERT INTO public.positions (municipality_id,name,department_id) VALUES ($1,$2,$3)', [M1,'[TEST] ข้าม อปท.',D3]), /does not belong/)
    await db.query('INSERT INTO public.positions (municipality_id,name,department_hint) VALUES ($1,$2,$3)', [M1,'[TEST] import','ปลัด'])
    assert.equal((await db.query('SELECT department_id FROM public.positions WHERE name=$1', ['[TEST] import'])).rows[0].department_id,D1)
    console.log('personnel-structure PostgreSQL: migration preserves personnel; tenant/role guards, filter/count, assignment/audit passed')

    const moveMigration = await read('supabase/migrations/20261024210000_position_department_move.sql')
    const profilesBeforeMoveMigration = (await db.query('SELECT id,department_id,role,is_dept_head FROM public.profiles ORDER BY id')).rows
    await db.exec(moveMigration)
    assert.deepEqual((await db.query('SELECT id,department_id,role,is_dept_head FROM public.profiles ORDER BY id')).rows,profilesBeforeMoveMigration,
      'การติดตั้ง RPC ย้ายกองต้องไม่ย้ายข้อมูลเอง')
    const moveSql = 'SELECT public.admin_save_position($1,$2::jsonb,$3,$4,$5) AS result'
    const moveChanges = {name:'[TEST] ข้อมูลเดิมขัดกัน',category:'operating_staff',role:'viewer',department_id:D1,sort_order:0}
    const moveParams = [CONFLICT,JSON.stringify(moveChanges),null,true,1]
    for (const caller of [STAFF,CITIZEN,OTHER_ADMIN,null]) {
      await assert.rejects(asUser(caller,moveSql,moveParams),/Permission denied|Authentication required/)
      await assert.rejects(asUser(caller,'SELECT * FROM public.get_position_holder_counts($1)',[M1]),/Permission denied|Authentication required/)
    }
    for(const signature of ['admin_save_position(uuid,jsonb,uuid,boolean,integer)','get_position_holder_counts(uuid)']) {
      assert.equal((await db.query('SELECT has_function_privilege($1,$2,$3) allowed',['anon',`public.${signature}`,'execute'])).rows[0].allowed,false)
    }
    await assert.rejects(asUser(ADMIN,moveSql,[...moveParams.slice(0,3),false,1]),/Confirm moving/)
    await assert.rejects(asUser(ADMIN,moveSql,[...moveParams.slice(0,4),0]),/Personnel changed/)
    await assert.rejects(asUser(ADMIN,moveSql,[CONFLICT,JSON.stringify(moveChanges),D2,true,1]),/Position changed/)
    await assert.rejects(asUser(ADMIN,moveSql,[CONFLICT,JSON.stringify({...moveChanges,department_id:D3}),null,true,1]),/active department in this municipality/)
    await assert.rejects(asUser(ADMIN,moveSql,[CONFLICT,JSON.stringify({...moveChanges,municipality_id:M2}),null,true,1]),/Invalid position changes/)
    await db.exec(`UPDATE public.departments SET is_active=false WHERE id='${id(14)}'`)
    await assert.rejects(asUser(ADMIN,moveSql,[CONFLICT,JSON.stringify({...moveChanges,department_id:id(14)}),null,true,1]),/active department/)
    await asUser(ADMIN,async()=>{
      const movedPosition=(await db.query(moveSql,moveParams)).rows[0].result
      assert.equal(movedPosition.moved_count,1)
      const holder=(await db.query('SELECT role,department_id,is_dept_head FROM public.profiles WHERE id=$1',[STAFF])).rows[0]
      assert.deepEqual(holder,{role:'staff',department_id:D1,is_dept_head:false},'ย้ายคนตามกองโดยไม่เพิ่มสิทธิ์ตาม position.role=viewer')
      const profileAudit=(await db.query("SELECT metadata FROM public.audit_logs WHERE resource_type='profile' AND resource_id=$1 ORDER BY created_at DESC LIMIT 1",[STAFF])).rows[0]
      assert.equal(profileAudit.metadata.authorization_before.department_id,D2)
      assert.equal(profileAudit.metadata.authorization_after.department_id,D1)
      const positionAudit=(await db.query("SELECT metadata FROM public.audit_logs WHERE resource_type='position' AND resource_id=$1",[CONFLICT])).rows[0]
      assert.equal(positionAudit.metadata.moved_count,1)
      const updateCounts=(await db.query('SELECT * FROM public.get_staff_department_counts($1)',[M1])).rows
      assert.equal(Number(updateCounts.find(row=>row.department_id===D1).staff_count),26)
      assert.equal((await db.query("SELECT current_setting('app.position_department_move',true) flag")).rows[0].flag,'')
      assert.equal((await db.query("SELECT current_setting('app.user_management_rpc',true) flag")).rows[0].flag,'')
      // กลับเป็นส่วนกลางต้องคงสังกัดและสถานะหัวหน้าของคนไว้
      await db.query('SELECT public.admin_update_user($1,$2::jsonb)',[STAFF,JSON.stringify({is_dept_head:true})])
      const centralized=(await db.query(moveSql,[CONFLICT,JSON.stringify({...moveChanges,department_id:null}),D1,true,1])).rows[0].result
      assert.equal(centralized.moved_count,0)
      assert.deepEqual((await db.query('SELECT role,department_id,is_dept_head FROM public.profiles WHERE id=$1',[STAFF])).rows[0],
        {role:'staff',department_id:D1,is_dept_head:true})
    })
    await assert.rejects(db.query('UPDATE public.positions SET department_id=$1 WHERE id=$2',[D1,CONFLICT]),/admin_save_position/)
    await assert.rejects(db.query('UPDATE public.positions SET department_id=$1 WHERE id=$2',[D2,P1]),/admin_save_position/,
      'ตำแหน่งไม่มีผู้ถือก็ต้องใช้ RPC เพื่อปิด race กับการแต่งตั้งใหม่')
    await db.exec(`
      INSERT INTO public.profiles (id,full_name,role,municipality_id,department_id,position_id)
      VALUES ('${id(106)}','[TEST] admin holder','admin','${M1}','${D2}','${CONFLICT}');
      INSERT INTO public.profiles (id,full_name,role,municipality_id,department_id,position_id)
      SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'[TEST] ผู้ถือจำนวนมาก','staff','${M1}','${D2}','${CENTRAL}'
      FROM generate_series(2000,3004) n;
    `)
    const exactHolderCounts=await asUser(ADMIN,'SELECT * FROM public.get_position_holder_counts($1)',[M1])
    assert.equal(Number(exactHolderCounts.rows.find(row=>row.position_id===CENTRAL).holder_count),1005,'จำนวนผู้ถือต้องไม่ถูกตัดที่ 1000 แถว')
    await assert.rejects(asUser(ADMIN,moveSql,[...moveParams.slice(0,4),2]),/Only superadmin/)
    assert.equal((await db.query('SELECT department_id FROM public.positions WHERE id=$1',[CONFLICT])).rows[0].department_id,null)
    assert.equal((await db.query('SELECT department_id FROM public.profiles WHERE id=$1',[STAFF])).rows[0].department_id,D2)
    await asUser(SUPER,async()=>{
      const result=(await db.query(moveSql,[...moveParams.slice(0,4),2])).rows[0].result
      assert.equal(result.moved_count,2,'Super Admin ย้ายบัญชี admin ได้ตามขอบเขตเดิม')
    })
    console.log('position-department-move PostgreSQL: confirmation/stale guards, exact counts, atomic move, unchanged roles, audit and return-to-central passed')

    // ── ตำแหน่งใช้ได้ทุกกองเป็นค่าตั้งต้น (20261030110000 + 20261030110100) ──
    const HEAD = id(205), CLERK = id(206), CLERK_HOLDER = id(107), HEAD_HOLDER = id(108)
    await db.exec(`
      CREATE OR REPLACE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE AS
        $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
      CREATE OR REPLACE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
      -- production มีตัวจริงจาก 20260831142000 อยู่แล้ว migration ใหม่ตรวจว่ามีก่อนแทนที่
      CREATE FUNCTION public.import_default_positions(uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
      CREATE TABLE public.position_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, category text NOT NULL,
        role text NOT NULL, department_hint text, sort_order int NOT NULL DEFAULT 0
      );
      INSERT INTO public.position_templates (name,category,role,department_hint,sort_order) VALUES
        ('ผู้อำนวยการกองช่าง','dept_head','officer','กองช่าง',10),
        ('นายช่างโยธา','field_technician','technician','กองช่าง',20),
        ('ผู้อำนวยการกองไม่มีจริง','dept_head','officer','กองไม่มีจริง',30),
        ('หัวหน้าหน่วยกำกวม','dept_head','officer','ซ้ำ',40);
      INSERT INTO public.positions (id,municipality_id,name,department_id,category,role) VALUES
        ('${HEAD}','${M1}','หัวหน้าสำนักปลัด','${D1}','dept_head','officer'),
        ('${CLERK}','${M1}','เจ้าหน้าที่ธุรการชำนาญงาน','${D1}','operating_staff','staff');
      INSERT INTO public.profiles (id,full_name,role,municipality_id,department_id,position_id) VALUES
        ('${CLERK_HOLDER}','[TEST] ธุรการ','staff','${M1}','${D1}','${CLERK}'),
        ('${HEAD_HOLDER}','[TEST] หัวหน้าสำนัก','officer','${M1}','${D1}','${HEAD}');
      SELECT set_config('app.position_department_move','','false');
    `)
    // ก่อนแก้: ธุรการล็อกไว้สำนักปลัด แต่งตั้งคนกองช่างแล้วฐานข้อมูลดึงกลับสำนักปลัดเงียบๆ
    assert.equal((await applyAssignment(CITIZEN,{role:'staff',department_id:D2,position_id:CLERK})).profile.department_id,D1)

    const profilesBeforeShared = (await db.query('SELECT id,department_id,role,is_dept_head FROM public.profiles ORDER BY id')).rows
    await db.exec(sharedMigration)
    await db.query('INSERT INTO public.positions (municipality_id,name,department_hint,category) VALUES ($1,$2,$3,$4)',
      [M1,'[TEST] ช่างไฟฟ้า','ช่าง','field_technician'])
    assert.deepEqual((await db.query('SELECT department_id,department_hint FROM public.positions WHERE name=$1',['[TEST] ช่างไฟฟ้า'])).rows[0],
      {department_id:null,department_hint:'ช่าง'},'guard ต้องเลิกเดาผูกกองจากกองแนะนำ')

    await db.exec(sharedBackfill)
    assert.deepEqual((await db.query('SELECT id,department_id,role,is_dept_head FROM public.profiles ORDER BY id')).rows,profilesBeforeShared,
      'ปรับตำแหน่งเป็นใช้ได้ทุกกองห้ามย้ายกองหรือเปลี่ยนสิทธิ์ของใคร')
    assert.deepEqual((await db.query('SELECT department_id,department_hint FROM public.positions WHERE id=$1',[CLERK])).rows[0],
      {department_id:null,department_hint:'สำนักปลัด'},'ธุรการต้องใช้ได้ทุกกองโดยจำกองเดิมเป็นกองแนะนำ')
    assert.equal((await db.query('SELECT department_id FROM public.positions WHERE id=$1',[HEAD])).rows[0].department_id,D1,
      'หัวหน้าหน่วยงานต้องล็อกกองเหมือนเดิม')
    const backfillAudit = (await db.query("SELECT actor_id,metadata FROM public.audit_logs WHERE resource_id=$1 AND metadata->>'reason'='position_shared_by_default_backfill'",[CLERK])).rows
    assert.equal(backfillAudit.length,1)
    assert.equal(backfillAudit[0].actor_id,null)
    assert.equal(backfillAudit[0].metadata.department_before,D1)
    assert.equal((await db.query("SELECT current_setting('app.position_department_move',true) flag")).rows[0].flag,'')

    // หลังแก้: แต่งตั้งธุรการเข้ากองช่างได้ และแก้กองที่ใส่ผิดได้
    assert.equal((await applyAssignment(CITIZEN,{role:'staff',department_id:D2,position_id:CLERK})).profile.department_id,D2)
    assert.equal((await applyAssignment(CLERK_HOLDER,{department_id:D2})).profile.department_id,D2)
    assert.equal((await applyAssignment(HEAD_HOLDER,{department_id:D2})).profile.department_id,D1,'ตำแหน่งที่ล็อกกองยังบังคับกองเดิม')

    await asUser(ADMIN,async()=>{
      // ล็อกแล้วปลดกลับ: กองแนะนำต้องเป็นกองล่าสุด ไม่ถูกล้างเป็นค่าว่าง
      const lockChanges = {name:'เจ้าหน้าที่ธุรการชำนาญงาน',category:'operating_staff',role:'staff',department_id:D2,sort_order:0}
      await db.query(moveSql,[CLERK,JSON.stringify(lockChanges),null,true,1])
      await db.query(moveSql,[CLERK,JSON.stringify({department_id:null}),D2,true,1])
      assert.deepEqual((await db.query('SELECT department_id,department_hint FROM public.positions WHERE id=$1',[CLERK])).rows[0],
        {department_id:null,department_hint:'กองช่าง'})

      assert.equal((await db.query('SELECT public.import_default_positions($1) n',[M1])).rows[0].n,4)
      const imported = Object.fromEntries((await db.query(`SELECT name,department_id,department_hint FROM public.positions
        WHERE name IN ('ผู้อำนวยการกองช่าง','นายช่างโยธา','ผู้อำนวยการกองไม่มีจริง','หัวหน้าหน่วยกำกวม')`)).rows
        .map(row=>[row.name,[row.department_id,row.department_hint]]))
      assert.deepEqual(imported['ผู้อำนวยการกองช่าง'],[D2,'กองช่าง'],'หัวหน้าหน่วยงานที่ชื่อกองตรงต้องล็อกกอง')
      assert.deepEqual(imported['นายช่างโยธา'],[null,'กองช่าง'],'ตำแหน่งสายงานต้องใช้ได้ทุกกองพร้อมกองแนะนำ')
      assert.deepEqual(imported['ผู้อำนวยการกองไม่มีจริง'],[null,'กองไม่มีจริง'],'ชื่อกองไม่ตรงต้องไม่ผูก')
      assert.deepEqual(imported['หัวหน้าหน่วยกำกวม'],[null,'ซ้ำ'])
      assert.equal((await db.query('SELECT public.import_default_positions($1) n',[M1])).rows[0].n,0,'กดซ้ำต้องไม่สร้างของซ้ำ')
    })
    await assert.rejects(asUser(OTHER_ADMIN,'SELECT public.import_default_positions($1)',[M1]),/ไม่มีสิทธิ์/)
    console.log('position-shared-by-default PostgreSQL: shared default, backfill keeps personnel/heads, hint kept, audited, import binds heads only')

    // ── กองหลักแยกจากการล็อก (20261030140000 + 20261030140100) ──
    await db.exec(homeMigration)
    const hintOf = async (positionId) => (await db.query('SELECT department_id,department_hint FROM public.positions WHERE id=$1',[positionId])).rows[0]
    const profilesBeforeHome = (await db.query('SELECT id,department_id,role,is_dept_head FROM public.profiles ORDER BY id')).rows
    await asUser(ADMIN,async()=>{
      // ตั้งกองหลักของตำแหน่งใช้ได้ทุกกอง: ไม่ล็อก ไม่ต้องยืนยันจำนวนผู้ถือ ไม่ย้ายใคร
      await db.query(moveSql,[CLERK,JSON.stringify({department_hint:'กองช่าง'}),null,false,null])
      assert.deepEqual(await hintOf(CLERK),{department_id:null,department_hint:'กองช่าง'})
      assert.deepEqual((await db.query('SELECT id,department_id,role,is_dept_head FROM public.profiles ORDER BY id')).rows,profilesBeforeHome,
        'เปลี่ยนกองหลักห้ามย้ายใคร')
      const audit=(await db.query("SELECT metadata FROM public.audit_logs WHERE resource_id=$1 AND metadata ? 'hint_after' ORDER BY created_at DESC LIMIT 1",[CLERK])).rows[0]
      assert.equal(audit.metadata.hint_before,'สำนักปลัด')
      assert.equal(audit.metadata.hint_after,'กองช่าง')
      await assert.rejects(db.query(moveSql,[CLERK,JSON.stringify({department_hint:'กองไม่มีจริง'}),null,false,null]),/active department/,
        'กองหลักต้องเป็นชื่อกองจริง ไม่รับข้อความอิสระ')
    })
    await asUser(ADMIN,async()=>{
      await assert.rejects(db.query(moveSql,[CLERK,JSON.stringify({department_hint:'กองหนึ่ง'}),null,false,null]),/active department/,
        'กองที่ปิดใช้งานเป็นกองหลักไม่ได้')
    })
    await asUser(ADMIN,async()=>{
      await db.query(moveSql,[CLERK,JSON.stringify({department_hint:''}),null,false,null])
      assert.deepEqual(await hintOf(CLERK),{department_id:null,department_hint:null},'ค่าว่าง = ไม่ระบุกองหลัก')
      // ตำแหน่งล็อกกอง: กองหลัก = กองที่ล็อกเสมอ ค่าที่ส่งมาถูกเมิน
      await db.query(moveSql,[HEAD,JSON.stringify({department_hint:'กองช่าง'}),D1,false,null])
      assert.deepEqual(await hintOf(HEAD),{department_id:D1,department_hint:'สำนักปลัด'})
      // client รุ่นเก่าที่ไม่ส่ง department_hint ได้พฤติกรรมเดิม
      await db.query(moveSql,[CLERK,JSON.stringify({sort_order:5}),null,false,null])
      assert.deepEqual(await hintOf(CLERK),{department_id:null,department_hint:null})
    })

    // ปลดล็อกรอบ 2: จำลองแอดมินล็อกตำแหน่งที่ไม่ใช่หัวหน้าเพื่อจัดกลุ่ม (ทุ่งแค้ว 2569-10-30)
    await db.exec(`SELECT set_config('app.position_department_move','${CLERK}',false);
      UPDATE public.positions SET department_id='${D2}' WHERE id='${CLERK}';
      SELECT set_config('app.position_department_move','',false);`)
    assert.deepEqual(await hintOf(CLERK),{department_id:D2,department_hint:'กองช่าง'})
    const profilesBeforeHomeBackfill = (await db.query('SELECT id,department_id,role,is_dept_head FROM public.profiles ORDER BY id')).rows
    await db.exec(homeBackfill)
    assert.deepEqual(await hintOf(CLERK),{department_id:null,department_hint:'กองช่าง'},'ปลดล็อกแล้วตำแหน่งยังอยู่ใต้กองเดิม')
    assert.equal((await hintOf(HEAD)).department_id,D1,'หัวหน้าหน่วยงานต้องล็อกกองเหมือนเดิม')
    assert.deepEqual((await db.query('SELECT id,department_id,role,is_dept_head FROM public.profiles ORDER BY id')).rows,profilesBeforeHomeBackfill,
      'ปลดล็อกรอบ 2 ห้ามย้ายกองหรือเปลี่ยนสิทธิ์ของใคร')
    const homeAudit=(await db.query("SELECT actor_id,metadata FROM public.audit_logs WHERE resource_id=$1 AND metadata->>'reason'='position_home_department_backfill'",[CLERK])).rows
    assert.equal(homeAudit.length,1)
    assert.equal(homeAudit[0].metadata.department_before,D2)
    assert.equal((await db.query("SELECT current_setting('app.position_department_move',true) flag")).rows[0].flag,'')
    await db.exec(homeBackfill)
    assert.equal((await db.query("SELECT count(*)::int n FROM public.audit_logs WHERE metadata->>'reason'='position_home_department_backfill'")).rows[0].n,1,
      'รันซ้ำต้องไม่มีอะไรเปลี่ยน')
    console.log('position-home-department PostgreSQL: home department without lock, validated, audited, locked ignores hint, backfill round 2 keeps personnel/heads')
  } finally { await db.close() }
}

if (process.env.PERSONNEL_VISUAL === '1') {
  const React = (await import('react')).default
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createServer } = await import('vite')
  const { chromium } = await import('playwright')

  const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true } })
  const module = await vite.ssrLoadModule('/src/components/admin/PersonnelQuickAssignDialog.jsx')
  const markup = renderToStaticMarkup(React.createElement(module.default, {
    tenant: { id: '00000000-0000-0000-0000-000000000001', name: 'เทศบาลทดสอบ' },
    department: { id: '00000000-0000-0000-0000-000000000002', name: 'สำนักปลัด' },
    positions,
    currentUserRole: 'admin',
    currentUserId: '00000000-0000-0000-0000-000000000003',
    onClose: () => {},
    onSaved: () => {},
  }))
  await vite.close()

  const cssFile = (await readdir(path.join(root, 'dist/assets'))).find((name) => /^index-.*\.css$/.test(name))
  assert.ok(cssFile, 'ไม่พบ CSS จาก production build สำหรับ visual test')
  const css = await readFile(path.join(root, 'dist/assets', cssFile), 'utf8')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  await page.setContent(`<style>${css}</style>${markup}`)

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    dialogWidth: Math.ceil(document.querySelector('[role="dialog"] > div').getBoundingClientRect().width),
    titleVisible: Boolean(document.querySelector('#quick-assign-title')?.getBoundingClientRect().height),
    shortControls: [...document.querySelectorAll('button, input')]
      .filter((element) => element.getBoundingClientRect().height < 44)
      .map((element) => element.textContent?.trim() || element.getAttribute('aria-label') || element.id),
  }))
  assert.equal(layout.documentWidth, layout.viewportWidth, 'หน้าต่างเพิ่มบุคลากรห้ามล้นแนวนอนที่ 390px')
  assert.ok(layout.dialogWidth <= layout.viewportWidth)
  assert.equal(layout.titleVisible, true)
  assert.deepEqual(layout.shortControls, [], `พบ touch target ต่ำกว่า 44px: ${layout.shortControls.join(', ')}`)

  const screenshotPath = path.join(process.env.TEMP || process.cwd(), 'personnel-quick-assign-mobile.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  console.log(`personnel-structure visual: ${screenshotPath}`)

  const fixtureVite = await createServer({ root, appType: 'custom', server: { host: '127.0.0.1', port: 0 } })
  const fixturePositions = [{ id: 'p1', name: 'นักจัดการงานทั่วไป', department_id: 'general', role: 'viewer' }]
  fixtureVite.middlewares.use(async (request, response, next) => {
    if (request.url?.startsWith('/__catalog-fixture')) {
      const html = await fixtureVite.transformIndexHtml('/__catalog-fixture', `
        <!doctype html><html><head></head><body><div id="root"></div><script type="module">
          import React from 'react'; import {createRoot} from 'react-dom/client';
          import Catalog from '/src/components/admin/PositionCatalogAdmin.jsx'; import '/src/index.css';
          createRoot(document.getElementById('root')).render(React.createElement(Catalog, {
            tenant:{id:'municipality-test'},currentUserRole:'admin'
          }));
        </script></body></html>`)
      response.setHeader('Content-Type','text/html')
      response.end(html)
      return
    }
    if (!request.url?.startsWith('/__personnel-fixture')) return next()
    const html = await fixtureVite.transformIndexHtml('/__personnel-fixture', `
      <!doctype html><html><head></head><body><div id="root"></div><script type="module">
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import Dialog from '/src/components/admin/PersonnelQuickAssignDialog.jsx';
        import '/src/index.css';
        createRoot(document.getElementById('root')).render(React.createElement(Dialog, {
          tenant:{id:'municipality-test'}, department:{id:'general',name:'สำนักปลัด'},
          currentUserId:'admin-test', positions:${JSON.stringify(fixturePositions)},
          onClose:()=>{}, onSaved:()=>{document.body.dataset.saved='yes';}
        }));
      </script></body></html>`)
    response.setHeader('Content-Type', 'text/html')
    response.end(html)
  })
  const writes = []
  const positionWrites = []
  const positionInserts = []
  let catalogPosition = {id:'p1',name:'[TEST] ตำแหน่งใช้ร่วม',department_id:null,role:'viewer',category:'operating_staff',sort_order:0}
  let candidate = { id: 'citizen-test', full_name: '[TEST] สมชาย', role: 'citizen', municipality_id: 'municipality-test' }
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1') return route.continue()
    // ทุก endpoint ภายนอกถูก mock จึงไม่มีเส้นทางออกไปอ่าน/เขียน DB จริง
    if (url.pathname.endsWith('/rpc/search_users_for_staff_assignment')) {
      return route.fulfill({ json: [candidate] })
    }
    if (url.pathname.endsWith('/rpc/admin_update_user')) {
      writes.push(route.request().postDataJSON())
      return route.fulfill({ json: null })
    }
    if (url.pathname.endsWith('/rpc/get_position_holder_counts')) {
      return route.fulfill({ json:[{position_id:'p1',holder_count:9}] })
    }
    if (url.pathname.endsWith('/rpc/admin_save_position')) {
      const payload=route.request().postDataJSON()
      positionWrites.push(payload)
      catalogPosition={...catalogPosition,...payload.p_changes}
      return route.fulfill({json:{position_id:'p1',holder_count:9,moved_count:9}})
    }
    if (url.pathname.endsWith('/positions') && route.request().method()==='GET') {
      return route.fulfill({json:[catalogPosition]})
    }
    if (url.pathname.endsWith('/departments')) {
      return route.fulfill({json:[{id:'general',name:'สำนักปลัด',is_active:true},{id:'works',name:'กองช่าง',is_active:true}]})
    }
    if (url.pathname.endsWith('/positions') && route.request().method() === 'POST') {
      const payload = route.request().postDataJSON()
      positionInserts.push(payload)
      return route.fulfill({ json: { ...payload, id: 'new-position-test' } })
    }
    return route.abort()
  })
  try {
    await fixtureVite.listen()
    const fixtureUrl = `${fixtureVite.resolvedUrls.local[0]}__personnel-fixture`
    await page.goto(fixtureUrl)
    await page.locator('#quick-account-search').fill('สมชาย')
    await page.getByRole('button', { name: /\[TEST\] สมชาย/ }).click()
    await page.locator('#quick-position-search').fill('นักจัดการ')
    await page.getByRole('button', { name: /นักจัดการงานทั่วไป/ }).click()
    await page.getByRole('button', { name: 'ยืนยันการแต่งตั้ง', exact: true }).click()
    await page.waitForFunction(() => document.body.dataset.saved === 'yes')
    assert.equal(writes[0].p_changes.role, 'staff', 'คำแนะนำ viewer ต้องไม่ยกระดับสิทธิ์อัตโนมัติ')
    assert.equal(writes[0].p_changes.department_id, 'general')
    candidate = { ...candidate, id:'staff-test', role:'officer', department_id:'works', department_name:'กองช่าง', is_dept_head:true }
    await page.goto(fixtureUrl)
    await page.locator('#quick-account-search').fill('สมชาย')
    await page.getByRole('button', { name: /\[TEST\] สมชาย/ }).click()
    await page.locator('#quick-position-search').fill('[TEST] ธุรการใหม่')
    await page.getByRole('button', { name: /สร้างตำแหน่ง/ }).click()
    await page.getByRole('button', { name:'ยืนยันการย้ายและแต่งตั้ง', exact:true }).click()
    await page.waitForFunction(() => document.body.dataset.saved === 'yes')
    assert.equal(writes[1].p_changes.role, 'officer')
    assert.equal(writes[1].p_changes.is_dept_head, false)
    assert.equal(writes[1].p_changes.position_id, 'new-position-test')
    assert.equal(writes[1].p_changes.department_id, 'general', 'คนต้องได้กองที่กำลังเพิ่ม แม้ตำแหน่งใช้ได้ทุกกอง')
    assert.equal(positionInserts[0].department_id, null, 'ตำแหน่งธุรการที่สร้างใหม่ต้องใช้ได้ทุกกอง')
    assert.equal(positionInserts[0].department_hint, 'สำนักปลัด', 'จำกองนี้ไว้เป็นกองแนะนำ')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    console.log('personnel-structure browser: citizen assignment, inline position creation and department transfer passed (mocked DB)')
    await page.goto(`${fixtureVite.resolvedUrls.local[0]}__catalog-fixture`)
    await page.locator('summary').filter({hasText:SHARED_POSITION_LABEL}).click()
    await page.getByRole('button',{name:'แก้ไขตำแหน่ง [TEST] ตำแหน่งใช้ร่วม',exact:true}).click()
    const catalogDialog=page.getByRole('dialog')
    // 1) ตั้งกองหลักอย่างเดียว = ย้ายไปอยู่ใต้กองในหน้าจอ แต่ไม่ล็อก ไม่ย้ายใคร ไม่ต้องยืนยันจำนวนคน
    const departmentSelect=catalogDialog.getByLabel('กองหลัก')
    const lockSwitch=catalogDialog.getByRole('switch')
    assert.equal(await lockSwitch.isDisabled(),true,'ยังไม่มีกองหลัก = ล็อกไม่ได้')
    await departmentSelect.selectOption('general')
    assert.equal(await lockSwitch.getAttribute('aria-checked'),'false','เลือกกองหลักต้องไม่ล็อกเอง')
    assert.equal(await catalogDialog.getByRole('status').count(),0,'กองหลักไม่ย้ายใคร จึงไม่มีกล่องผลกระทบ')
    await catalogDialog.getByRole('button',{name:'บันทึกการแก้ไข',exact:true}).click()
    await catalogDialog.waitFor({state:'hidden'})
    assert.equal(positionWrites.length,1)
    assert.equal(positionWrites[0].p_changes.department_id,null,'ตั้งกองหลักต้องไม่ล็อก')
    assert.equal(positionWrites[0].p_changes.department_hint,'สำนักปลัด')
    assert.equal(positionWrites[0].p_confirm_move,false)
    const homeGroup=page.locator('details').filter({has:page.locator('summary',{hasText:'สำนักปลัด'})})
    await homeGroup.getByRole('button',{name:'แก้ไขตำแหน่ง [TEST] ตำแหน่งใช้ร่วม',exact:true}).waitFor({state:'visible'})
    assert.equal(await homeGroup.locator('[data-position-scope="shared"]').count(),1,'อยู่ใต้กองแล้วต้องยังบอกว่าใช้ได้ทุกกอง')
    // 2) ล็อกกอง = ย้ายผู้ถือ 9 คน ต้องเห็นผลกระทบและยืนยันครั้งเดียว
    await homeGroup.getByRole('button',{name:'แก้ไขตำแหน่ง [TEST] ตำแหน่งใช้ร่วม',exact:true}).click()
    assert.equal(await departmentSelect.inputValue(),'general','เปิดแก้ไขต้องเห็นกองหลักเดิม')
    await lockSwitch.click()
    assert.equal(await lockSwitch.getAttribute('aria-checked'),'true')
    assert.match(await catalogDialog.getByRole('status').textContent(),/ผู้ถือตำแหน่ง 9 คน/)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    const shortControls=await catalogDialog.locator('button:visible, input:visible, select:visible').evaluateAll(elements=>
      elements.filter(element=>element.getBoundingClientRect().height<44).map(element=>element.id||element.textContent))
    assert.deepEqual(shortControls,[])
    await page.screenshot({path:path.join(process.env.TEMP||root,'position-department-move-mobile.png'),fullPage:true})
    await catalogDialog.getByRole('button',{name:'ยืนยันย้ายตำแหน่งและบุคลากร',exact:true}).click()
    await catalogDialog.waitFor({state:'hidden'})
    assert.equal(positionWrites.length,2)
    assert.equal(positionWrites[1].p_changes.department_id,'general')
    assert.equal('department_hint' in positionWrites[1].p_changes,false,'ล็อกกองแล้ว DB ใส่กองหลักให้เอง ไม่ต้องส่ง')
    assert.equal(positionWrites[1].p_expected_department_id,null)
    assert.equal(positionWrites[1].p_expected_holder_count,9)
    assert.equal(positionWrites[1].p_confirm_move,true)
    await page.getByRole('button',{name:'แก้ไขตำแหน่ง [TEST] ตำแหน่งใช้ร่วม',exact:true}).waitFor({state:'visible'})
    console.log('position-department-move browser: home department set without lock, then lock with visible 9-person impact and one explicit confirmation')
  } finally {
    await fixtureVite.close()
    await browser.close()
  }
}

console.log('personnel-structure: ผ่านทุกข้อ')

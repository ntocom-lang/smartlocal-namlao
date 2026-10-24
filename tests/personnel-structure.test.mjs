import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  departmentFilterParams,
  groupPositionsByDepartment,
  leastPrivilegeRole,
  normalizePositionName,
  positionMatchesDepartment,
  resolvedDepartmentId,
  shouldKeepDepartmentHead,
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

const quickAssign = await read('src/components/admin/PersonnelQuickAssignDialog.jsx')
assert.match(quickAssign, /leastPrivilegeRole\(selectedUser\?\.role\)/)
assert.match(quickAssign, /search_users_for_staff_assignment/)
assert.doesNotMatch(quickAssign, /get_users_with_email_sorted/)
assert.match(quickAssign, /exactPositionElsewhere/)
assert.match(quickAssign, /ระบบไม่ยกระดับให้อัตโนมัติ/)
assert.match(quickAssign, /ยืนยันการย้ายและแต่งตั้ง/, 'การย้ายข้ามกองต้องบอกผลก่อนบันทึก')
assert.match(quickAssign, /min-h-11/, 'ปุ่มและช่องกรอกบนมือถือควรสูงอย่างน้อย 44px')
assert.match(quickAssign, /accountQuery\.trim\(\)\.length >= 2/, 'ห้ามดึงรายชื่อบุคลากรทั้งหมดก่อนมีคำค้น')
assert.doesNotMatch(quickAssign, /id_card/, 'หน้าค้นหาเร็วไม่ควรแสดงเลขบัตรประชาชน')

const catalog = await read('src/components/admin/PositionCatalogAdmin.jsx')
assert.match(catalog, /groupPositionsByDepartment/)
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
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    console.log('personnel-structure browser: citizen assignment, inline position creation and department transfer passed (mocked DB)')
    await page.goto(`${fixtureVite.resolvedUrls.local[0]}__catalog-fixture`)
    await page.locator('summary').filter({hasText:'ส่วนกลาง / ยังไม่ผูกกอง'}).click()
    await page.getByRole('button',{name:'แก้ไขตำแหน่ง [TEST] ตำแหน่งใช้ร่วม',exact:true}).click()
    const catalogDialog=page.getByRole('dialog')
    const departmentSelect=catalogDialog.getByLabel('กอง / หน่วยงาน')
    assert.equal(await departmentSelect.isEnabled(),true,'ตำแหน่งที่มีผู้ถือ 9 คนต้องเลือกย้ายกองได้')
    await departmentSelect.selectOption('general')
    assert.match(await catalogDialog.getByRole('status').textContent(),/ผู้ถือตำแหน่ง 9 คน/)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    const shortControls=await catalogDialog.locator('button:visible, input:visible, select:visible').evaluateAll(elements=>
      elements.filter(element=>element.getBoundingClientRect().height<44).map(element=>element.id||element.textContent))
    assert.deepEqual(shortControls,[])
    await page.screenshot({path:path.join(process.env.TEMP||root,'position-department-move-mobile.png'),fullPage:true})
    await catalogDialog.getByRole('button',{name:'ยืนยันย้ายตำแหน่งและบุคลากร',exact:true}).click()
    await catalogDialog.waitFor({state:'hidden'})
    assert.equal(positionWrites.length,1)
    assert.equal(positionWrites[0].p_changes.department_id,'general')
    assert.equal(positionWrites[0].p_expected_department_id,null)
    assert.equal(positionWrites[0].p_expected_holder_count,9)
    assert.equal(positionWrites[0].p_confirm_move,true)
    await page.getByRole('button',{name:'แก้ไขตำแหน่ง [TEST] ตำแหน่งใช้ร่วม',exact:true}).waitFor({state:'visible'})
    console.log('position-department-move browser: occupied position moved from central with visible 9-person impact and one explicit confirmation')
  } finally {
    await fixtureVite.close()
    await browser.close()
  }
}

console.log('personnel-structure: ผ่านทุกข้อ')

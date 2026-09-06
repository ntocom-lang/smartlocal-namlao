// Execute the actual migration in local PostgreSQL (PGlite 0.5.8).
// Install PGlite in a temporary folder, then:
// node tests/odor-grid-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// No network calls, login sessions, or production data are used by this test.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { buildOdorPoints } from '../src/lib/odorAnalytics.js'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)
const db = new PGlite()
const sqlFile = (relative) => readFile(new URL(relative, import.meta.url), 'utf8')
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const muni = id(1)
const otherMuni = id(2)
const assignee = id(10)
let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }
const pins = async (role, { user = assignee, tenant = muni, requested = muni } = {}) => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('test.role', $1, false), set_config('test.uid', $2, false), set_config('test.muni', $3, false)", [role ?? '', user ?? '', tenant ?? ''])
  await db.exec(role == null ? 'SET ROLE anon' : 'SET ROLE authenticated')
  const { rows } = await db.query('SELECT * FROM public.data_center_unified_pins($1)', [requested])
  await db.exec('RESET ROLE')
  return rows
}
const getComplaint = (rows, n) => rows.find((r) => r.source_table === 'complaints' && r.source_id === id(n))
const insertComplaint = async (n, lat, lng, category = 'odor', tenant = muni, assigned = assignee) => {
  await db.query(`
    INSERT INTO public.complaints (id, municipality_id, category, subject, status,
      latitude, longitude, detail, extra_data, assigned_to)
    VALUES ($1, $2, $3, '[TEST] private subject', 'pending', $4, $5,
      '[TEST] private detail', '{"odor_intensity":4,"routed_at":"2026-01-01T00:00:00Z","phone":"[TEST] private phone"}', $6)
  `, [id(n), tenant, category, lat, lng, assigned])
}
try {
  await db.exec(await sqlFile('./fixtures/odor-map.sql'))
  await db.exec(await sqlFile('../supabase/migrations/20260908100200_adhoc_pin_routed_flag.sql'))
  await db.exec(await sqlFile('../supabase/migrations/20260908120000_datacenter_pins_photo_urls.sql'))
  const migration = await sqlFile('../supabase/migrations/20260908140000_adhoc_analyst_grid.sql')
  await db.exec(migration)
  await test('migration is repeatable', () => db.exec(migration))
  await db.query('INSERT INTO auth.users VALUES ($1)', [assignee])
  await db.query("INSERT INTO public.profiles (id, role, municipality_id) VALUES ($1, 'staff', $2)", [assignee, muni])
  for (const tenant of [muni, otherMuni]) {
    await db.query("INSERT INTO public.complaint_categories VALUES ($1, 'odor', 'Odor category', true), ($1, 'road', 'Road category', false), ($1, 'other_adhoc', 'Other adhoc', true)", [tenant])
  }
  await insertComplaint(100, 18.123456, 100.123456)
  await insertComplaint(101, 18.123456, 100.123456, 'road')
  await insertComplaint(102, 18.123456, 100.123456, 'odor', otherMuni)
  await insertComplaint(103, 18.123456, 100.123456, 'other_adhoc')
  await insertComplaint(104, 18.123456, 100.123456, 'odor', muni, null)
  await db.query(`
    INSERT INTO public.data_center_entries (id,municipality_id,group_name,category,name,status,latitude,longitude,photo_urls)
    VALUES ($1,$2,'Public places','park','[TEST] park','active',18.123456,100.123456,ARRAY['https://example.invalid/park.jpg']),
      ($3,$4,'Public places','park','[TEST] other park','active',18.1,100.1,ARRAY['https://example.invalid/other.jpg']),
      ($5,$2,'Public places','park','[TEST] inactive','inactive',18.1,100.1,NULL)
  `, [id(200), muni, id(201), otherMuni, id(202)])

  const expected = buildOdorPoints([{ latitude: 18.123456, longitude: 100.123456 }]).points[0]
  for (const role of ['viewer', 'council']) {
    await test(role + ' gets grid and minimized complaint data, including when assigned', async () => {
      const rows = await pins(role)
      for (const n of [100, 103, 104]) {
        const row = getComplaint(rows, n)
        assert.ok(Math.abs(row.latitude - expected.lat) < 1e-10)
        assert.ok(Math.abs(row.longitude - expected.lng) < 1e-10)
        assert.notEqual(row.latitude, 18.123456)
        assert.equal(row.description, null)
        assert.equal(row.photo_urls, null)
        assert.ok(!JSON.stringify(row).includes('[TEST] private'))
        assert.equal(row.extra_data.odor_intensity, 4)
        assert.equal(row.extra_data.routed_at, '2026-01-01T00:00:00Z')
      }
      assert.equal(getComplaint(rows, 100).title, 'Odor category')
      assert.equal(getComplaint(rows, 101).latitude, 18.123456)
      assert.equal(getComplaint(rows, 102), undefined)
    })
  }
  for (const role of ['admin', 'superadmin', 'officer', 'staff', 'technician']) {
    await test(role + ' keeps exact assigned coordinates', async () => {
      const row = getComplaint(await pins(role), 100)
      assert.equal(row.latitude, 18.123456)
      assert.equal(row.longitude, 100.123456)
      assert.equal(row.description, '[TEST] private detail')
    })
  }
  for (const role of ['officer', 'staff', 'technician']) {
    await test(role + ' cannot see unassigned adhoc complaints', async () => {
      const rows = await pins(role, { user: id(11) })
      assert.equal(getComplaint(rows, 100), undefined)
      assert.equal(getComplaint(rows, 104), undefined)
      assert.ok(getComplaint(rows, 101))
    })
  }
  for (const role of [null, 'citizen', 'unknown']) {
    await test(String(role) + ' sees only active public entries with photos', async () => {
      const rows = await pins(role)
      assert.equal(rows.length, 1)
      assert.equal(rows[0].source_id, id(200))
      assert.deepEqual(rows[0].photo_urls, ['https://example.invalid/park.jpg'])
      await assert.rejects(pins(role, { requested: null }), /municipality_id is required/)
    })
  }
  await test('tenant argument cannot override viewer membership; missing membership rejects', async () => {
    const rows = await pins('viewer', { requested: otherMuni })
    assert.ok(getComplaint(rows, 100))
    assert.equal(getComplaint(rows, 102), undefined)
    await assert.rejects(pins('viewer', { tenant: null }), /ไม่พบสังกัด/)
  })
  await test('superadmin can query across tenants; ordinary roles remain scoped', async () => {
    assert.ok(getComplaint(await pins('superadmin', { requested: null }), 102))
    assert.equal(getComplaint(await pins('admin', { requested: otherMuni }), 102), undefined)
  })
  await test('public place photos and raw coordinates survive for analysts', async () => {
    const row = (await pins('viewer')).find((r) => r.source_id === id(200))
    assert.deepEqual(row.photo_urls, ['https://example.invalid/park.jpg'])
    assert.equal(row.latitude, 18.123456)
  })
  await test('invalid coordinates are null for analysts without breaking the RPC', async () => {
    const invalid = [[null, null], [18, null], [0, 0], [91, 100], [18, 181], ['NaN', 100], ['Infinity', 100], [18, 'Infinity'], [18, 'NaN']]
    for (let i = 0; i < invalid.length; i++) await insertComplaint(300 + i, ...invalid[i])
    const rows = await pins('viewer')
    assert.equal(getComplaint(rows, 300), undefined)
    for (let i = 1; i < invalid.length; i++) {
      const row = getComplaint(rows, 300 + i)
      assert.equal(row.latitude, null)
      assert.equal(row.longitude, null)
    }
  })
  await test('SQL grid matches report for 400 synthetic points including boundaries', async () => {
    const points = [[5, 96], [21, 106]]
    const step = 100 / 111320
    for (let i = 0; i < 398; i++) {
      const lat = i % 2 ? (6000 + i * 35) * step + 1e-9 : 5.1 + ((i * 37) % 1500) / 100
      points.push([lat, 96.1 + ((i * 13) % 900) / 100])
    }
    for (let i = 0; i < points.length; i++) await insertComplaint(1000 + i, ...points[i])
    const rows = await pins('viewer')
    for (let i = 0; i < points.length; i++) {
      const [latitude, longitude] = points[i]
      const point = buildOdorPoints([{ latitude, longitude }]).points[0]
      const row = getComplaint(rows, 1000 + i)
      assert.ok(Math.abs(row.latitude - point.lat) < 1e-10)
      assert.ok(Math.abs(row.longitude - point.lng) < 1e-10)
    }
  })
  await test('retains return shape and execute grants', async () => {
    const { rows } = await db.query(`SELECT
      has_function_privilege('anon', 'public.data_center_unified_pins(uuid)', 'EXECUTE') a,
      has_function_privilege('authenticated', 'public.data_center_unified_pins(uuid)', 'EXECUTE') b,
      pg_get_function_result('public.data_center_unified_pins(uuid)'::regprocedure) result`)
    assert.equal(rows[0].a, true)
    assert.equal(rows[0].b, true)
    assert.match(rows[0].result, /photo_urls text\[\]/)
  })
  console.log('PASS ' + cases + ' local PostgreSQL cases')
} finally {
  await db.close()
}

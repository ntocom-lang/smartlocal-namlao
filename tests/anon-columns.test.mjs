// เทสต์ "คอลัมน์ที่ผู้ไม่ล็อกอิน (anon) อ่านได้" — กันหน้าสาธารณะกลับไปใช้ select('*') กับตารางที่มี uuid ผู้ใช้
// รันด้วย: node tests/anon-columns.test.mjs  (หรือ npm run test:anon-columns)
//
// เหตุผล: เฟส 2 ของงานซ่อน uuid ผู้ใช้จะถอน SELECT ทั้งตารางจาก anon แล้ว GRANT รายคอลัมน์ ⇒ คำสั่งของ anon ที่ select('*')
//   หรืออ้างคอลัมน์ที่ซ่อนจะได้ 42501 ทั้งคำสั่ง หน้าสาธารณะว่าง
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ANON_COLUMN_LIST, ANON_HIDDEN_COLUMNS, anonColumns } from '../src/lib/anonColumns.js'
import { TOURISM_PLACE_PUBLIC_COLUMN_LIST, TOURISM_PLACE_PUBLIC_COLUMNS } from '../src/lib/tourismPlaceColumns.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// ── snapshot คอลัมน์ฐานจริงที่ตรวจ 2026-11-19 (ทั้งตาราง = ที่ anon อ่านได้ + ที่ซ่อน) ──
const DB_COLUMNS = {
  data_center_entries: ['id', 'municipality_id', 'group_name', 'category', 'name', 'description', 'latitude', 'longitude', 'photo_urls', 'external_url', 'status', 'created_by', 'created_at', 'updated_at', 'location', 'route_points', 'route_color', 'department_id', 'verified_at', 'verified_by', 'shape', 'import_batch_id'],
  events: ['id', 'municipality_id', 'title', 'description', 'event_date', 'event_time', 'end_date', 'location', 'category', 'is_all_day', 'created_at', 'updated_at', 'attachment_url', 'end_time', 'created_by', 'attachment_urls', 'audiences', 'department_id'],
  infrastructure_works: ['id', 'municipality_id', 'created_by', 'title', 'category', 'description', 'budget', 'work_year', 'work_date', 'latitude', 'longitude', 'location_name', 'photos', 'status', 'complaint_id', 'created_at', 'work_type', 'contractor', 'contract_no', 'location', 'department_id'],
  org_project_updates: ['id', 'project_id', 'municipality_id', 'update_type', 'title', 'body', 'update_date', 'photos', 'created_by', 'created_at', 'links', 'note'],
  org_projects: ['id', 'municipality_id', 'created_by', 'title', 'subtitle', 'category', 'description', 'status', 'start_date', 'end_date', 'cover_image_url', 'is_public', 'tags', 'sort_order', 'created_at', 'updated_at', 'department_id'],
  posts: ['id', 'municipality_id', 'type', 'title', 'excerpt', 'image_url', 'event_date', 'is_published', 'created_by', 'created_at', 'updated_at', 'image_position', 'department_id'],
  public_holidays: ['id', 'municipality_id', 'holiday_date', 'name', 'is_working_day', 'note', 'updated_by', 'updated_at', 'created_at'],
  service_faqs: ['id', 'municipality_id', 'department_id', 'question', 'answer', 'keywords', 'link_url', 'link_label', 'is_published', 'sort_order', 'created_by', 'created_at', 'updated_by', 'updated_at'],
  service_forms: ['id', 'municipality_id', 'department_id', 'title', 'description', 'file_url', 'drive_file_id', 'file_name', 'content_type', 'keywords', 'is_published', 'sort_order', 'created_by', 'created_at', 'updated_by', 'updated_at'],
  tourism_places: ['id', 'municipality_id', 'name', 'category', 'image_url', 'description', 'is_active', 'display_order', 'created_at', 'address', 'maps_url', 'gallery', 'phone', 'service_type', 'online_service', 'online_url', 'has_delivery', 'department_id', 'created_by', 'latitude', 'longitude', 'opening_hours', 'hours_note', 'facebook_url', 'line_id', 'is_featured', 'village_no', 'price_range', 'updated_at'],
  tourism_reviews: ['id', 'place_id', 'municipality_id', 'user_id', 'rating', 'comment', 'created_at', 'reviewer_name'],
}
const TABLES = Object.keys(DB_COLUMNS)
const USER_UUID_COLUMNS = ['created_by', 'updated_by', 'verified_by', 'user_id']

// ── 1) รายชื่อครบและไม่ซ้อน ──
assert.deepEqual(Object.keys(ANON_COLUMN_LIST).sort(), [...TABLES].sort(), 'ANON_COLUMN_LIST ต้องมีครบ 11 ตาราง')
assert.deepEqual(Object.keys(ANON_HIDDEN_COLUMNS).sort(), [...TABLES].sort(), 'ANON_HIDDEN_COLUMNS ต้องมีครบ 11 ตาราง')
for (const t of TABLES) {
  const open = ANON_COLUMN_LIST[t]
  const hidden = ANON_HIDDEN_COLUMNS[t]
  assert.equal(new Set(open).size, open.length, `${t}: ANON_COLUMN_LIST มีชื่อซ้ำ`)
  assert.equal(new Set(hidden).size, hidden.length, `${t}: ANON_HIDDEN_COLUMNS มีชื่อซ้ำ`)
  const overlap = open.filter(c => hidden.includes(c))
  assert.deepEqual(overlap, [], `${t}: คอลัมน์อยู่ทั้งฝั่งเปิดและฝั่งซ่อน`)
  assert.deepEqual([...open, ...hidden].sort(), [...DB_COLUMNS[t]].sort(), `${t}: เปิด + ซ่อน ต้องเท่ากับคอลัมน์ฐานจริงทุกตัว`)
  assert.ok(hidden.length > 0, `${t}: ต้องมีคอลัมน์ uuid ที่ซ่อนอย่างน้อย 1 ตัว`)
  assert.ok(Object.isFrozen(open) && Object.isFrozen(hidden), `${t}: ต้อง freeze`)
}
assert.ok(Object.isFrozen(ANON_COLUMN_LIST) && Object.isFrozen(ANON_HIDDEN_COLUMNS))

// ── 2) uuid ผู้ใช้ห้ามหลุดเข้าฝั่งเปิด + ซ่อนครบทุกตัวที่มีจริง ──
for (const t of TABLES) {
  for (const c of USER_UUID_COLUMNS) {
    assert.ok(!ANON_COLUMN_LIST[t].includes(c), `${t}.${c} หลุดเข้า ANON_COLUMN_LIST`)
    if (DB_COLUMNS[t].includes(c)) assert.ok(ANON_HIDDEN_COLUMNS[t].includes(c), `${t}.${c} ต้องอยู่ใน ANON_HIDDEN_COLUMNS`)
  }
}

// ── 3) anonColumns() ──
for (const t of TABLES) assert.equal(anonColumns(t), ANON_COLUMN_LIST[t].join(', '))
assert.throws(() => anonColumns('profiles'), /ไม่รู้จักตาราง/)
assert.throws(() => anonColumns('constructor'), /ไม่รู้จักตาราง/)
assert.throws(() => anonColumns(undefined), /ไม่รู้จักตาราง/)

// ── 4) tourismPlaceColumns.js ต้องมาจากแหล่งเดียวกัน ──
assert.deepEqual([...TOURISM_PLACE_PUBLIC_COLUMN_LIST], [...ANON_COLUMN_LIST.tourism_places])
assert.equal(TOURISM_PLACE_PUBLIC_COLUMNS, anonColumns('tourism_places'))

// ── 5) static guard: หน้าสาธารณะห้าม select('*') / select() กับ 11 ตารางนี้ ──
// เจอได้เฉพาะไฟล์ที่ต้องล็อกอิน (ผู้ล็อกอิน = authenticated อ่านได้ทุกคอลัมน์ ไม่กระทบ) — ทุกรายการต้องมีเหตุผลกำกับ
const AUTH_ONLY_ALLOWLIST = {
  'src/components/admin/EventsManager.jsx': 'หน้าแอดมิน/เจ้าหน้าที่จัดการกิจกรรม (เมนูหลังบ้านอยู่ใต้ RequireAuth)',
  'src/components/admin/InfraWorkAdmin.jsx': 'หน้าแอดมินจัดการงานโครงสร้างพื้นฐาน (หลังบ้านอยู่ใต้ RequireAuth)',
  'src/components/admin/TourismManager.jsx': 'หน้าแอดมินจัดการร้านท่องเที่ยว/รีวิว (หลังบ้านอยู่ใต้ RequireAuth)',
  'src/pages/DataCenterDashboard.jsx': 'route /data-center/staff อยู่ใต้ RequireAuth staffOnly ใน src/App.jsx',
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

// .from('<ตาราง>') ตามด้วย .select('*...') / .select("*...") / .select(`*...`) / .select() ว่าง — ติดกันโดยไม่มีอะไรคั่น
// (insert/update/upsert(...).select() ไม่ติด .from() โดยตรง จึงไม่นับ)
const SELECT_ALL_RE = new RegExp(
  String.raw`\.from\(\s*['"\x60](` + TABLES.join('|') + String.raw`)['"\x60]\s*\)\s*\.select\(\s*(?:\)|['"\x60]\s*\*)`,
  'g',
)

// ตัวอย่างที่ต้องจับให้ได้/ต้องไม่จับ (กัน regex หย่อน)
for (const bad of [
  `supabase.from('events').select('*')`,
  `supabase\n  .from("posts")\n  .select("*, creator:profiles(full_name)")`,
  'supabase.from(`org_projects`).select(`*`)',
  `supabase.from('tourism_reviews').select()`,
]) assert.ok(new RegExp(SELECT_ALL_RE.source).test(bad), `ต้องจับได้: ${bad}`)
for (const ok of [
  `supabase.from('events').select(anonColumns('events'))`,
  `supabase.from('events').insert(row).select()`,
  `supabase.from('events').upsert(row).select('*')`,
  `supabase.from('profiles').select('*')`,
  `supabase.from('events').select('id, title')`,
]) assert.ok(!new RegExp(SELECT_ALL_RE.source).test(ok), `ต้องไม่จับ: ${ok}`)

const found = new Map() // ไฟล์ → [{ table, line }]
for (const file of walk(join(ROOT, 'src'))) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(SELECT_ALL_RE)) {
    const rel = relative(ROOT, file).split(sep).join('/')
    const line = text.slice(0, m.index).split('\n').length
    if (!found.has(rel)) found.set(rel, [])
    found.get(rel).push({ table: m[1], line })
  }
}

const violations = [...found].filter(([f]) => !AUTH_ONLY_ALLOWLIST[f])
assert.deepEqual(
  violations.map(([f, hits]) => `${f}: ${hits.map(h => `${h.table}@${h.line}`).join(', ')}`),
  [],
  'หน้าที่ผู้ไม่ล็อกอินเปิดได้ห้าม select(\'*\') กับตาราง anon-hidden — ใช้ anonColumns(<ตาราง>) (src/lib/anonColumns.js) '
  + 'หรือถ้าเป็นหน้าที่ต้องล็อกอินจริงให้เพิ่มเข้า AUTH_ONLY_ALLOWLIST พร้อมเหตุผล',
)
// allowlist ต้องไม่ค้างของที่เลิกใช้แล้ว (ไฟล์เลิก select('*') แล้วต้องเอาออกจากรายการ)
for (const f of Object.keys(AUTH_ONLY_ALLOWLIST)) {
  assert.ok(found.has(f), `${f} อยู่ใน AUTH_ONLY_ALLOWLIST แต่ไม่พบ select('*') แล้ว — เอาออกจากรายการ`)
}

// ── รายชื่อใน migration (JSON ระหว่าง ANON_SPEC_BEGIN/END) ต้องตรงกับโค้ดทุกตาราง ──
const migSql = readFileSync(join(ROOT, 'supabase', 'migrations', '20261219100000_anon_hide_user_uuid_columns.sql'), 'utf8')
const specText = migSql.split('ANON_SPEC_BEGIN')[1]?.split('ANON_SPEC_END')[0]?.match(/\$spec\$([\s\S]*)\$spec\$/)?.[1]
assert.ok(specText, 'หา JSON รายชื่อคอลัมน์ใน migration ไม่เจอ')
const spec = JSON.parse(specText)
assert.deepEqual(Object.keys(spec).sort(), [...TABLES].sort(), 'ตารางใน migration ไม่ตรงกับ anonColumns.js')
for (const t of TABLES) {
  assert.deepEqual(spec[t].visible, [...ANON_COLUMN_LIST[t]], `${t}: visible ใน migration ≠ ANON_COLUMN_LIST`)
  assert.deepEqual(spec[t].hidden, [...ANON_HIDDEN_COLUMNS[t]], `${t}: hidden ใน migration ≠ ANON_HIDDEN_COLUMNS`)
}

console.log(`anon-columns.test: ผ่าน (${TABLES.length} ตาราง, พบ select('*') ในไฟล์ต้องล็อกอิน ${found.size} ไฟล์)`)

// ศูนย์รวมข้อมูลดิจิทัล: ทะเบียนชุดข้อมูล + สุขภาพข้อมูล + ข้อมูลเปิด — node --test tests/data-center-hub.test.mjs
// ไม่ใช้เน็ต ไม่แตะฐานข้อมูล · ตรรกะฝั่งฐานข้อมูลตรวจโดยเทียบไฟล์ migration กับค่าฝั่งหน้าเว็บ
// (ตัวเลขจริงของฟังก์ชัน SQL ทดสอบแยกด้วยการรันกับข้อมูลจริงตอน apply — ดูรายงานใน PR)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DATASETS, DATASET_KEYS, SENSITIVITY, RELEASE, SOURCES,
  buildCatalogRows, catalogSummary, groupBySensitivity,
} from '../src/lib/dataCatalog.js'
import {
  DEFAULT_STALE_DAYS, STALE_OPTIONS, ISSUE_ORDER, MUST_FIX_ISSUES, ISSUES,
  scoreTone, percent, formatAgo, staleLabel,
} from '../src/lib/dataCenterHealth.js'
import {
  fetchOpenEntries, entriesToGeoJSON, entriesToCsv, entriesToCsvRows, csvCell, toCsv, safeHttpUrl, datedFilename, isRouteRow,
  OPEN_DATA_FIELDS, OPEN_DATA_EXCLUDED,
} from '../src/lib/dataCenterExport.js'

const read = async (rel) => (await readFile(new URL(rel, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const COLUMNS_SQL = await read('../supabase/migrations/20261003200000_data_center_verified_columns.sql')
const FN_SQL = await read('../supabase/migrations/20261003200100_data_center_health_and_catalog.sql')
// เทียบเฉพาะโค้ด ไม่เทียบคอมเมนต์ (คอมเมนต์อธิบายเหตุผลมักเอ่ยชื่อสิ่งที่ "ห้ามใช้")
const FN_CODE = FN_SQL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

// ───────────────────────── ฐานข้อมูล ↔ หน้าเว็บ ต้องตรงกัน ─────────────────────────

test('ทะเบียนชุดข้อมูล: key ใน SQL ตรงกับ DATASETS ทุกตัว ไม่ขาดไม่เกิน', () => {
  const body = FN_CODE.slice(FN_CODE.indexOf('FUNCTION public.data_center_catalog('), FN_CODE.indexOf('FUNCTION public.data_center_public_stats('))
  const sqlKeys = [...body.matchAll(/SELECT\s+'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual([...sqlKeys].sort(), [...DATASET_KEYS].sort(), 'เพิ่มชุดข้อมูลต้องเพิ่มทั้ง SQL และ DATASETS')
  assert.equal(new Set(DATASET_KEYS).size, DATASET_KEYS.length, 'key ซ้ำ')
})

test('ชุดข้อมูลที่ role ทั่วไปไม่มีสิทธิ์ SELECT: SQL คืน NULL โดยไม่แตะตาราง และตรงกับ restricted ในทะเบียน', () => {
  const restricted = DATASETS.filter((d) => d.restricted).map((d) => d.key).sort()
  const nullKeys = [...FN_CODE.matchAll(/SELECT\s+'([a-z_]+)',\s*NULL::int,\s*NULL::int,\s*NULL::timestamptz/g)].map((m) => m[1]).sort()
  assert.deepEqual(nullKeys, restricted)
  // และต้องไม่มี FROM ตารางเหล่านี้อยู่ในฟังก์ชัน (ไม่งั้นล้มทั้งตัวด้วย 42501 ตอน role ไม่มีสิทธิ์)
  for (const key of restricted) assert.doesNotMatch(FN_CODE, new RegExp(`FROM\\s+public\\.${key}\\b`), `${key} ห้ามถูก SELECT ตรงๆ`)
})

test('สุขภาพข้อมูล: รหัสปัญหาใน SQL = ISSUE_ORDER · ค่าเริ่มต้นตรงกัน', () => {
  const sqlCodes = [...FN_CODE.matchAll(/THEN '([a-z_]+)'\s+END/g)].map((m) => m[1])
  assert.deepEqual(sqlCodes, ISSUE_ORDER, 'ลำดับ/ชื่อรหัสปัญหาต้องตรงกับ ISSUE_ORDER')
  for (const code of ISSUE_ORDER) assert.ok(ISSUES[code], `ขาดป้ายของ ${code}`)
  assert.equal(DEFAULT_STALE_DAYS, 365)
  assert.match(FN_CODE, /_stale_days int DEFAULT 365/)
  assert.match(FN_CODE, /coalesce\(_stale_days, 365\)/)
  assert.ok(STALE_OPTIONS.some((o) => o.days === DEFAULT_STALE_DAYS), 'ค่าเริ่มต้นต้องอยู่ในตัวเลือก')
  // "ต้องแก้" ตรงกับนิพจน์ must_fix ใน SQL
  const must = FN_CODE.match(/\(f\.is_stale OR f\.is_duplicate OR f\.no_owner OR f\.is_pii_id\) AS must_fix/)
  assert.ok(must, 'นิยาม must_fix ใน SQL เปลี่ยนแล้ว')
  assert.deepEqual(MUST_FIX_ISSUES, ['stale', 'duplicate', 'no_owner', 'pii_id'])
  for (const code of ISSUE_ORDER) {
    assert.equal(ISSUES[code].severity, MUST_FIX_ISSUES.includes(code) ? 'must' : 'nice', code)
  }
})

test('กฎเลขบัตร (pii_id): pattern ใน SQL จับเลข 13 หลักทุกรูปแบบ แต่ไม่จับเบอร์โทร/พิกัด/เลขยาวกว่า', () => {
  const m = FN_CODE.match(/b\.pii_text ~ '([^']+)'/)
  assert.ok(m, 'ไม่พบ pattern ใน SQL')
  const re = new RegExp(m[1]) // ARE ของ PostgreSQL กับ JS ให้ผลเหมือนกันสำหรับ pattern ง่ายๆ นี้ (ไม่มี backslash/lookaround)
  for (const hit of ['เลขบัตร 1-5099-01234-56-7 โทร 081-234-5678', 'บัตร 1509901234567', 'เลขที่ 1 5099 01234 56 7 ท้ายข้อความ', '1509901234567']) {
    assert.ok(re.test(hit), `ต้องจับให้ได้: ${hit}`)
  }
  for (const miss of ['โทร 054-123456 หรือ 0812345678', 'พิกัด 18.123456, 100.654321', 'เลขทะเบียน 12345678901234567 (17 หลัก)', 'รหัสไปรษณีย์ 54140 ซอย 3', 'ถนนสาย 1342 ช่วง 12', 'ติดต่อ 0-5459-1234 ต่อ 12', '']) {
    assert.ok(!re.test(miss), `ต้องไม่จับ: ${miss}`)
  }
  // กดยืนยันหลังแก้ไขล่าสุดแล้วป้ายหายได้ (เผื่อเป็นเลขอื่นเช่นเลขผู้เสียภาษีนิติบุคคล) และตัวตรวจอ่านทั้งชื่อและรายละเอียด
  assert.match(FN_CODE, /AND NOT \(b\.verified_at IS NOT NULL AND b\.verified_at >= b\.updated_at\)\)\s+AS is_pii_id/)
  assert.match(FN_CODE, /concat_ws\(' ', d\.name, d\.description\)\s+AS pii_text/)
  assert.ok(!m[1].includes(String.fromCharCode(92)), 'pattern ห้ามมี backslash (เชลล์/heredoc ยุบ backslash คู่เงียบๆ จนแก้ไขแล้วพังโดยไม่รู้ตัว)')
})

test('trigger updated_at: ขยับเฉพาะ "เนื้อหา" ไม่ขยับเมื่อรวมหมวด/เปลี่ยนสถานะ/ย้ายกอง/กดยืนยัน', () => {
  const fn = FN_CODE.slice(FN_CODE.indexOf('FUNCTION public.data_center_touch_updated_at'), FN_CODE.indexOf('DROP TRIGGER'))
  const newCols = [...fn.matchAll(/NEW\.([a-z_]+)/g)].map((m) => m[1])
  const oldCols = [...fn.matchAll(/OLD\.([a-z_]+)/g)].map((m) => m[1])
  const content = ['name', 'description', 'latitude', 'longitude', 'photo_urls', 'external_url', 'route_points', 'route_color']
  assert.deepEqual([...new Set(newCols.filter((c) => c !== 'updated_at'))].sort(), [...content].sort())
  assert.deepEqual([...new Set(oldCols)].sort(), [...content].sort())
  for (const banned of ['status', 'group_name', 'category', 'department_id', 'verified_at', 'verified_by']) {
    assert.ok(!newCols.includes(banned), `${banned} ต้องไม่ทำให้ updated_at ขยับ`)
  }
  assert.match(fn, /RETURN NEW;\s*\nEND;/, 'trigger function ต้อง RETURN NEW ทุกเส้นทาง (NOTES ข้อ 5)')
  assert.doesNotMatch(fn, /SECURITY DEFINER/)
})

test('ความปลอดภัยของฟังก์ชัน: ไม่มี SECURITY DEFINER · ไม่มี DEFAULT ให้ _municipality_id · สิทธิ์ถูกต้อง', () => {
  assert.doesNotMatch(FN_CODE, /SECURITY DEFINER/i, 'ทุกฟังก์ชันต้อง INVOKER ให้ RLS คุมเอง')
  assert.equal((FN_CODE.match(/SECURITY INVOKER/g) ?? []).length, 3)
  for (const sig of ['data_center_health(_municipality_id uuid, _stale_days int DEFAULT 365)', 'data_center_catalog(_municipality_id uuid)', 'data_center_public_stats(_municipality_id uuid)']) {
    assert.ok(FN_CODE.includes(`FUNCTION public.${sig}`), sig)
  }
  assert.doesNotMatch(FN_CODE, /_municipality_id uuid\s+DEFAULT/i, 'บังคับระบุ อปท. เสมอ ห้ามส่ง NULL แล้วได้ทุกแห่ง')
  // REVOKE ต้องระบุ anon ตรงๆ (Supabase ตั้ง default grant ให้ anon ทุกฟังก์ชันใหม่)
  assert.match(FN_CODE, /REVOKE ALL ON FUNCTION public\.data_center_health\(uuid, int\)\s+FROM PUBLIC, anon;/)
  assert.match(FN_CODE, /REVOKE ALL ON FUNCTION public\.data_center_catalog\(uuid\)\s+FROM PUBLIC, anon;/)
  assert.match(FN_CODE, /GRANT EXECUTE ON FUNCTION public\.data_center_health\(uuid, int\)\s+TO authenticated;/)
  assert.match(FN_CODE, /GRANT EXECUTE ON FUNCTION public\.data_center_catalog\(uuid\)\s+TO authenticated;/)
  assert.match(FN_CODE, /GRANT EXECUTE ON FUNCTION public\.data_center_public_stats\(uuid\)\s+TO anon, authenticated;/)
  // สถิติสาธารณะนับเฉพาะรายการที่เปิดใช้งาน (ตรงกับนโยบาย "dce public read active")
  const stats = FN_CODE.slice(FN_CODE.indexOf('FUNCTION public.data_center_public_stats('), FN_CODE.indexOf('REVOKE ALL'))
  assert.match(stats, /d\.status = 'active'/)
})

test('การแยก migration ตามเฟส (NOTES ข้อ 3): ไฟล์ DDL ไม่มีฟังก์ชัน · ไฟล์ฟังก์ชันมี guard เช็กคอลัมน์ก่อน', () => {
  assert.match(COLUMNS_SQL, /ADD COLUMN IF NOT EXISTS verified_at timestamptz/)
  assert.match(COLUMNS_SQL, /ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth\.users\(id\) ON DELETE SET NULL/)
  assert.doesNotMatch(COLUMNS_SQL.replace(/--.*$/gm, ''), /CREATE (OR REPLACE )?(FUNCTION|TRIGGER)/)
  assert.match(FN_SQL, /RAISE EXCEPTION 'ต้องรัน 20261003200000_data_center_verified_columns\.sql ก่อน/)
  assert.match(FN_SQL, /d\.latitude, d\.longitude/, 'รายการปัญหาต้องมีพิกัดไว้โฟกัสแผนที่')
})

// ───────────────────────── ทะเบียนชุดข้อมูล (หน้าเว็บ) ─────────────────────────

test('ทะเบียน: ข้อมูลกำกับครบและใช้ค่าที่ประกาศไว้เท่านั้น', () => {
  for (const d of DATASETS) {
    assert.ok(d.label && d.module, d.key)
    assert.ok(SENSITIVITY[d.sensitivity], `${d.key}: sensitivity ไม่รู้จัก`)
    assert.ok(RELEASE[d.release], `${d.key}: release ไม่รู้จัก`)
    assert.ok(SOURCES[d.source], `${d.key}: source ไม่รู้จัก`)
  }
})

test('ทะเบียน: ข้อมูลส่วนบุคคล/อ่อนไหวห้ามถูกระบุว่าเผยแพร่ · ไฟล์ข้อมูลเปิดมีชุดเดียว', () => {
  for (const d of DATASETS.filter((x) => x.sensitivity === 'personal' || x.sensitivity === 'sensitive')) {
    assert.equal(d.release, 'none', `${d.key} เป็นข้อมูลบุคคล ห้ามเผยแพร่`)
  }
  const files = DATASETS.filter((d) => d.release === 'file').map((d) => d.key)
  assert.deepEqual(files, ['data_center_entries'], 'มีตัวส่งออกจริงเฉพาะ data_center_entries ห้ามติดป้ายไฟล์ข้อมูลเปิดให้ชุดอื่นก่อนทำจริง')
  assert.equal(DATASETS.find((d) => d.key === 'patient_bookings').sensitivity, 'sensitive')
  assert.equal(DATASETS.find((d) => d.key === 'complaints').sensitivity, 'personal')
})

test('buildCatalogRows: รวมตัวเลขจาก RPC กับข้อมูลกำกับ · key แปลกจาก RPC ถูกข้าม · ชุดที่ขาดไม่ล้ม', () => {
  const rows = buildCatalogRows([
    { key: 'complaints', total: 64, recent_30d: 37, last_activity: '2026-10-02T12:31:18Z' },
    { key: 'patient_bookings', total: null, recent_30d: null, last_activity: null },
    { key: 'ไม่มีในทะเบียน', total: 9, recent_30d: 9, last_activity: null },
  ])
  assert.equal(rows.length, DATASETS.length)
  const c = rows.find((r) => r.key === 'complaints')
  assert.deepEqual([c.total, c.recent30d, c.hasCount], [64, 37, true])
  const p = rows.find((r) => r.key === 'patient_bookings')
  assert.deepEqual([p.total, p.hasCount, p.restricted], [null, false, true])
  assert.equal(rows.find((r) => r.key === 'posts').hasCount, false, 'ชุดที่ RPC ไม่ส่งมาต้องไม่ล้ม')
  assert.equal(buildCatalogRows(null).length, DATASETS.length)
  assert.equal(buildCatalogRows(undefined).every((r) => r.total === null), true)
})

test('catalogSummary: นับเฉพาะแถวที่มีตัวเลขจริง ไม่เอา null มาบวกเป็น 0 หลอก', () => {
  const rows = buildCatalogRows([
    { key: 'complaints', total: 10 }, { key: 'events', total: 5 }, { key: 'patient_bookings', total: null },
  ])
  const s = catalogSummary(rows)
  assert.equal(s.totalRows, 15)
  assert.equal(s.datasets, DATASETS.length)
  assert.equal(s.protectedCount, DATASETS.filter((d) => ['personal', 'sensitive'].includes(d.sensitivity)).length)
  assert.equal(s.released, DATASETS.filter((d) => d.release === 'file' || d.release === 'web').length)
  const groups = groupBySensitivity(rows)
  assert.deepEqual(groups.map((g) => g.key), ['public', 'internal', 'personal', 'sensitive'])
  assert.equal(groups.reduce((n, g) => n + g.rows.length, 0), DATASETS.length)
})

// ───────────────────────── สุขภาพข้อมูล (หน้าเว็บ) ─────────────────────────

test('formatAgo / staleLabel / scoreTone / percent', () => {
  const now = Date.parse('2026-10-03T12:00:00Z')
  const d = (n) => new Date(now - n * 86400000).toISOString()
  assert.equal(formatAgo(null, now), 'ไม่เคย')
  assert.equal(formatAgo('ไม่ใช่วันที่', now), '—')
  assert.equal(formatAgo(d(0), now), 'วันนี้')
  assert.equal(formatAgo(d(1), now), 'เมื่อวาน')
  assert.equal(formatAgo(d(12), now), '12 วันที่แล้ว')
  assert.equal(formatAgo(d(65), now), '2 เดือนที่แล้ว')
  assert.equal(formatAgo(d(800), now), '2 ปีที่แล้ว')
  assert.equal(formatAgo(new Date(now + 3600e3).toISOString(), now), 'วันนี้', 'เวลาในอนาคตเล็กน้อยไม่ควรขึ้นเลขลบ')
  assert.equal(staleLabel(365), '1 ปี')
  assert.equal(staleLabel(730), '2 ปี')
  assert.equal(staleLabel(90), '3 เดือน')
  assert.deepEqual([null, 100, 80, 79, 50, 49, 0].map(scoreTone), ['none', 'good', 'good', 'warn', 'warn', 'bad', 'bad'])
  assert.equal(percent(1, 3), 33)
  assert.equal(percent(0, 0), null)
})

test('ISSUES: ทุกข้อมีกฎที่อ่านรู้เรื่องและวิธีแก้ · กฎ stale อ้างช่วงเวลาที่เลือกจริง', () => {
  for (const code of ISSUE_ORDER) {
    const i = ISSUES[code]
    assert.ok(i.label && i.short && i.fix, code)
    assert.equal(typeof i.rule(365), 'string')
    assert.ok(i.rule(365).length > 10, code)
  }
  assert.match(ISSUES.stale.rule(180), /6 เดือน/)
  assert.match(ISSUES.stale.rule(730), /2 ปี/)
  assert.match(ISSUES.duplicate.rule(), /ไม่ตรวจเส้นทาง/)
})

// ───────────────────────── ข้อมูลเปิด / ส่งออก ─────────────────────────

const ROW = {
  id: 'a1', name: 'โรงเรียนบ้านตัวอย่าง', group_name: 'สถานศึกษา', category: 'โรงเรียน', description: 'รายละเอียด',
  latitude: 18.123456, longitude: 100.654321, route_points: null, route_color: null,
  photo_urls: ['https://example.org/a.jpg', 'javascript:alert(1)'], external_url: 'https://example.org',
  created_at: '2026-07-30T12:00:00Z', updated_at: '2026-09-10T05:56:58Z', verified_at: null,
  created_by: 'USER-SECRET', department_id: 'DEPT-SECRET', verified_by: 'USER-SECRET-2', status: 'active',
}

test('GeoJSON: Point เรียง [ลองจิจูด, ละติจูด] · เส้นทางเป็น LineString · พิกัดเพี้ยนถูกข้ามและนับ', () => {
  const road = { ...ROW, id: 'r1', name: 'ถนนสาย 1', category: 'ถนนสายหลัก', route_color: '#3b82f6',
    route_points: [{ lat: 18.1, lng: 100.1 }, { lat: 18.2, lng: 100.2 }, { lat: 'x', lng: 100.3 }] }
  const shortRoute = { ...ROW, id: 'r2', route_points: [{ lat: 18.1, lng: 100.1 }] } // < 2 จุด ใช้พิกัดกึ่งกลางเป็น Point
  const bad = { ...ROW, id: 'bad', latitude: 999, longitude: 100 }
  const nul = { ...ROW, id: 'nul', latitude: null, longitude: null }
  const g = entriesToGeoJSON([ROW, road, shortRoute, bad, nul], { publisher: 'เทศบาลทดสอบ', slug: 'demo', now: new Date('2026-10-03T00:00:00Z') })
  assert.equal(g.type, 'FeatureCollection')
  assert.equal(g.name, 'demo-data-center')
  assert.equal(g.features.length, 3)
  assert.deepEqual(g.features[0].geometry, { type: 'Point', coordinates: [100.654321, 18.123456] })
  assert.deepEqual(g.features[1].geometry, { type: 'LineString', coordinates: [[100.1, 18.1], [100.2, 18.2]] }, 'จุดที่พิกัดเสียถูกตัดออกจากเส้น')
  assert.equal(g.features[2].geometry.type, 'Point')
  assert.equal(g.metadata.record_count, 3)
  assert.equal(g.metadata.skipped_invalid_coordinates, 2)
  assert.equal(g.metadata.publisher, 'เทศบาลทดสอบ')
  assert.equal(g.metadata.generated_at, '2026-10-03T00:00:00.000Z')
  assert.equal(g.features[1].properties.route_color, '#3b82f6')
  assert.equal(g.features[0].properties.route_color, null)
})

test('GeoJSON: ไม่หลุดรหัสภายใน (created_by/department_id/verified_by) · ลิงก์ที่ไม่ใช่ http(s) ถูกตัด', () => {
  const g = entriesToGeoJSON([ROW])
  const props = g.features[0].properties
  assert.deepEqual(Object.keys(props).sort(), ['category', 'created_at', 'description', 'external_url', 'group', 'id', 'last_verified_at', 'name', 'photo_urls', 'route_color', 'updated_at'])
  const text = JSON.stringify(g)
  for (const secret of ['USER-SECRET', 'DEPT-SECRET', 'USER-SECRET-2']) assert.ok(!text.includes(secret), secret)
  assert.deepEqual(props.photo_urls, ['https://example.org/a.jpg'])
  assert.equal(entriesToGeoJSON([{ ...ROW, external_url: 'javascript:alert(1)' }]).features[0].properties.external_url, '')
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(g)))
})

test('รายการฟิลด์ที่แผง "ข้อมูลเปิด" แสดง ตรงกับ properties ของ GeoJSON จริง', () => {
  const props = Object.keys(entriesToGeoJSON([ROW]).features[0].properties).sort()
  const listed = OPEN_DATA_FIELDS.flatMap((f) => f.keys).sort()
  assert.deepEqual(listed, props, 'เพิ่ม/ลบฟิลด์ใน GeoJSON ต้องแก้ OPEN_DATA_FIELDS ด้วย ไม่งั้นหน้าจอบอกเจ้าหน้าที่ผิดว่าอะไรถูกเผยแพร่')
  assert.ok(OPEN_DATA_EXCLUDED.length >= 3)
})

test('CSV: กัน formula injection · เลขจริงไม่ถูกแตะ · เครื่องหมายคำพูดถูก escape', () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`)
  assert.equal(csvCell('+66'), `"'+66"`)
  assert.equal(csvCell('-1'), `"'-1"`)
  assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`)
  assert.equal(csvCell('\tabc'), `"'\tabc"`)
  assert.equal(csvCell(-5.25), '"-5.25"', 'ตัวเลขติดลบ (เช่นพิกัด) ต้องไม่ถูกใส่ \' นำหน้า')
  assert.equal(csvCell(null), '""')
  assert.equal(csvCell('ปกติ'), '"ปกติ"')
  assert.equal(csvCell('มี "คำพูด" ในนี้'), '"มี ""คำพูด"" ในนี้"')
  const out = toCsv([['a'], ['b']])
  assert.equal(out.charCodeAt(0), 0xFEFF, 'ต้องมี BOM นำหน้า')
  assert.ok(out.includes('\r\n'))
})

test('CSV: พิกัดแยกคอลัมน์ตัวเลข · เส้นทางนับจุด · วันที่ ISO หรือไทยตามที่เลือก · ลิงก์อันตรายถูกตัด', () => {
  const rows = entriesToCsvRows([ROW, { ...ROW, id: 'r1', route_points: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], status: 'archived', external_url: 'ftp://x' }])
  const [head, p, r] = rows
  assert.equal(head.length, p.length)
  const col = (name) => head.indexOf(name)
  assert.equal(p[col('ชนิดพิกัด')], 'จุด')
  assert.equal(p[col('ละติจูด')], 18.123456)
  assert.equal(typeof p[col('ละติจูด')], 'number')
  assert.equal(p[col('ลองจิจูด')], 100.654321)
  assert.equal(p[col('จำนวนรูป')], 2)
  assert.equal(p[col('บันทึกเมื่อ')], '2026-07-30T12:00:00.000Z')
  assert.equal(p[col('ตรวจทานล่าสุด')], '')
  assert.equal(r[col('ชนิดพิกัด')], 'เส้นทาง')
  assert.equal(r[col('จำนวนจุดของเส้นทาง')], 2)
  assert.equal(r[col('สถานะ')], 'ไม่ใช้งาน')
  assert.equal(r[col('ลิงก์ภายนอก')], '')
  const thai = entriesToCsvRows([ROW], { dateStyle: 'thai' })[1]
  assert.match(thai[col('บันทึกเมื่อ')], /^\d{2}\/\d{2}\/2569$/)
  assert.ok(entriesToCsv([ROW]).startsWith('﻿"ชื่อ"'))
  assert.equal(isRouteRow(ROW), false)
})

test('safeHttpUrl / datedFilename', () => {
  assert.equal(safeHttpUrl('https://example.org/x?y=1'), 'https://example.org/x?y=1')
  assert.equal(safeHttpUrl('  http://example.org  '), 'http://example.org/')
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x', 'ไม่ใช่ลิงก์', '', null, undefined, 42]) assert.equal(safeHttpUrl(bad), null, String(bad))
  assert.equal(datedFilename('ศูนย์ ข้อมูล/ดิจิทัล', 'csv', new Date('2026-10-03T00:00:00Z')), 'ศูนย์_ข้อมูล_ดิจิทัล_2026-10-03.csv')
  assert.equal(datedFilename('', 'geojson', new Date('2026-10-03T00:00:00Z')), 'data-center_2026-10-03.geojson')
})

// ตัวจำลอง Supabase ที่ "จำลองเพดาน max_rows ด้วย" (NOTES.md ข้อ 14: mock ที่ไม่มีเพดานทำให้เทสต์ผ่านแต่ของจริงพัง)
function mockSupabase(allRows, { cap = 1000, countOverride, failOnCall, dropAfter } = {}) {
  const log = []
  return {
    log,
    from(table) {
      const state = { table, filters: {}, head: false, range: null }
      const b = {
        select(cols, opts) { state.cols = cols; state.head = !!opts?.head; return b },
        eq(k, v) { state.filters[k] = v; return b },
        order() { return b },
        range(a, z) { state.range = [a, z]; return b },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
      }
      function run() {
        log.push({ ...state })
        let rows = allRows.filter((r) => Object.entries(state.filters).every(([k, v]) => r[k] === v))
        if (state.head) return { count: countOverride ?? rows.length, data: null, error: null }
        if (failOnCall != null && log.length === failOnCall) return { data: null, error: { message: 'boom' } }
        rows = [...rows].sort((a, c) => (a.id < c.id ? -1 : 1))
        const [a, z] = state.range ?? [0, rows.length - 1]
        const limit = Math.min(z - a + 1, cap)
        let data = rows.slice(a, a + limit)
        if (dropAfter != null && a >= dropAfter) data = []
        return { data, count: rows.length, error: null }
      }
      return b
    },
  }
}
const manyRows = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(6, '0')}`, municipality_id: 'M1', status: 'active', ...extra }))

test('fetchOpenEntries: ดึงครบทุกหน้าแม้เกินเพดาน 1,000 แถว · ไม่มีแถวซ้ำ · เฉพาะ active ของ อปท. นั้น', async () => {
  const rows = [...manyRows(2500), ...manyRows(40, { municipality_id: 'M2' }).map((r) => ({ ...r, id: 'z' + r.id })),
    ...manyRows(30, { status: 'archived' }).map((r) => ({ ...r, id: 'y' + r.id }))]
  const sb = mockSupabase(rows)
  const got = await fetchOpenEntries(sb, 'M1')
  assert.equal(got.length, 2500)
  assert.equal(new Set(got.map((r) => r.id)).size, 2500)
  assert.ok(got.every((r) => r.municipality_id === 'M1' && r.status === 'active'))
})

test('fetchOpenEntries: ขอหน้าใหญ่กว่าเพดาน server ก็ยังครบ (เลื่อนตามจำนวนแถวที่ได้จริง ไม่ใช่ขนาดที่ขอ)', async () => {
  const got = await fetchOpenEntries(mockSupabase(manyRows(2300), { cap: 1000 }), 'M1', { pageSize: 5000 })
  assert.equal(got.length, 2300)
  assert.equal(new Set(got.map((r) => r.id)).size, 2300)
})

test('fetchOpenEntries: ได้ไม่ครบต้อง throw ไม่ส่งไฟล์ที่ตกหล่นเงียบๆ · error ของฐานข้อมูลต้องโผล่', async () => {
  await assert.rejects(fetchOpenEntries(mockSupabase(manyRows(1500), { dropAfter: 1000 }), 'M1'), /ดึงข้อมูลได้ 1000 จาก 1500/)
  await assert.rejects(fetchOpenEntries(mockSupabase(manyRows(10), { failOnCall: 2 }), 'M1'), /boom/)
  await assert.rejects(fetchOpenEntries(mockSupabase([]), ''), /ไม่ทราบหน่วยงาน/)
  assert.deepEqual(await fetchOpenEntries(mockSupabase([]), 'M1'), [])
})

test('fetchOpenEntries: ดึงเฉพาะคอลัมน์ที่เผยแพร่ ไม่ขอรหัสภายใน', async () => {
  const sb = mockSupabase(manyRows(3))
  await fetchOpenEntries(sb, 'M1')
  const dataCall = sb.log.find((c) => !c.head)
  for (const secret of ['created_by', 'department_id', 'verified_by']) assert.ok(!dataCall.cols.includes(secret), secret)
  assert.ok(dataCall.cols.includes('verified_at'))
  assert.equal(dataCall.filters.status, 'active')
  assert.equal(dataCall.filters.municipality_id, 'M1')
})

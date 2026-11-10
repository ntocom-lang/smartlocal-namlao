// ด่านกันของหลุดจากทะเบียน "ห้องผู้บริหาร" — โมดูล/ประเภทคำขอใหม่ต้องลงทะเบียนที่ src/lib/executiveRegistry.js ใน PR เดียวกัน
//
// รันเป็น prebuild ด้วย (package.json) ⇒ CI build ล้มทันทีเมื่อเพิ่มโมดูล/ประเภทคำขอแล้วลืมลงทะเบียน
// ไม่ต่อเน็ต ไม่ต่อฐานข้อมูล · ผ่าน = exit 0 · ไม่ผ่าน = พิมพ์ข้อความไทยบอกวิธีแก้ แล้ว exit 1
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANAGED_MODULE_KEYS } from '../src/lib/staffModules.js'
import { BASE_DOCUMENT_TYPES } from '../src/lib/documentTypes.js'
import {
  EXECUTIVE_REGISTRY, EXEC_ZONES, executiveCoverageErrors, isPhaseLive,
} from '../src/lib/executiveRegistry.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const migrationsSql = fs.readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n')

// ฟังก์ชัน exec_summary_<x> มีอยู่ใน migrations หรือไม่ (ชื่อต้องตรง public.exec_summary_<x>( ) — ใช้ตรวจเมื่อเฟส E2 ขึ้นจอ)
const sqlFunctionExists = (name) => new RegExp(`FUNCTION\\s+public\\.${name}\\s*\\(`, 'i').test(migrationsSql)

const docTypes = BASE_DOCUMENT_TYPES.map((t) => t.value)
const fixtures = { moduleKeys: MANAGED_MODULE_KEYS, docTypes }

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}
const entry = (overrides) => ({
  key: 'complaints', kind: 'module', label: 'ทดสอบ', icon: 'Inbox', dept: null, zones: ['service'],
  isCitizenService: true, docTypes: [], summaryKey: null, phase: 'E1', link: { module: 'complaints' },
  kpis: [], alerts: [], reports: [], ...overrides,
})
const mustFail = (label, errors, needle) => {
  assert.ok(errors.length > 0, `${label}: ควรมี error แต่ได้ []`)
  assert.ok(errors.some((e) => e.includes(needle)), `${label}: ไม่พบข้อความ "${needle}" ใน\n${errors.join('\n')}`)
}

// ── ของจริงต้องผ่าน ──────────────────────────────────────────────────────────

const real = executiveCoverageErrors({ ...fixtures, sqlFunctionExists })
if (real.length > 0) {
  console.error('\n❌ ทะเบียนห้องผู้บริหารไม่ครบ — แก้ที่ src/lib/executiveRegistry.js แล้วรันใหม่ (npm run test:exec-coverage)\n')
  real.forEach((message) => console.error(`  • ${message}`))
  console.error('\nวิธีแก้โดยย่อ: โมดูลใหม่ → เพิ่มรายการใน EXECUTIVE_REGISTRY (หรือใส่ EXEC_EXCLUDED พร้อมเหตุผล) · ประเภทคำขอใหม่ → ใส่ใน docTypes ของรายการที่ถือเรื่อง')
  process.exit(1)
}

test('ทะเบียนจริงครบ: ทุกคีย์ใน MODULE_GROUPS + ทุก BASE_DOCUMENT_TYPES มีเจ้าของ (executiveCoverageErrors = [])', () => {
  assert.deepEqual(real, [])
  assert.ok(MANAGED_MODULE_KEYS.length > 10, 'อ่านคีย์โมดูลจริงไม่ได้')
  assert.ok(docTypes.length >= 11, 'อ่านประเภทคำขอจริงไม่ได้')
})

test('ทุกโซนที่ใช้ในทะเบียนมีใน EXEC_ZONES และ E1 มีโซนบริการประชาชน', () => {
  const zones = new Set(EXECUTIVE_REGISTRY.flatMap((e) => e.zones))
  for (const z of zones) assert.ok(z in EXEC_ZONES, `โซน ${z} ไม่มีใน EXEC_ZONES`)
  assert.ok(EXECUTIVE_REGISTRY.some((e) => isPhaseLive(e.phase) && e.zones.includes('service')))
})

// ── พิสูจน์ว่าด่านล้มจริง ────────────────────────────────────────────────────

test('คีย์โมดูลใหม่ที่ไม่ได้ลงทะเบียน → ล้ม พร้อมบอกวิธีแก้', () => {
  const errors = executiveCoverageErrors({ ...fixtures, moduleKeys: [...MANAGED_MODULE_KEYS, 'ghost-module-xyz'] })
  mustFail('โมดูลปลอม', errors, 'ghost-module-xyz')
  mustFail('โมดูลปลอม', errors, 'EXECUTIVE_REGISTRY')
})

test('รายการในทะเบียนที่ชี้ไปคีย์ซึ่งไม่มีใน MODULE_GROUPS → ล้ม', () => {
  const errors = executiveCoverageErrors({ ...fixtures, registry: [...EXECUTIVE_REGISTRY, entry({ key: 'ghost-module-xyz', link: { module: 'ghost-module-xyz' } })] })
  mustFail('คีย์ค้าง', errors, 'ghost-module-xyz')
})

test('document_type ใหม่ที่ไม่มีเจ้าของ → ล้ม', () => {
  const errors = executiveCoverageErrors({ ...fixtures, docTypes: [...docTypes, 'ghost_request_type'] })
  mustFail('ประเภทปลอม', errors, 'ghost_request_type')
  mustFail('ประเภทปลอม', errors, 'docTypes')
})

test('document_type ที่มีเจ้าของสองรายการ → ล้ม', () => {
  const dup = entry({ key: 'waterworks', docTypes: ['tax_notice'], zones: ['service'] })
  const errors = executiveCoverageErrors({ ...fixtures, registry: [...EXECUTIVE_REGISTRY.filter((e) => e.key !== 'waterworks'), dup] })
  mustFail('เจ้าของซ้ำ', errors, 'เจ้าของมากกว่า 1')
})

test('รายการ isCitizenService ที่ไม่อยู่โซน service → ล้ม', () => {
  const bad = entry({ key: 'complaints', zones: ['report'], isCitizenService: true })
  const errors = executiveCoverageErrors({ ...fixtures, registry: [...EXECUTIVE_REGISTRY.filter((e) => e.key !== 'complaints'), bad] })
  mustFail('ไม่มีโซน service', errors, 'isCitizenService')
})

test('kpi ที่ไม่มีสูตร (formula) → ล้ม · alert ที่ไม่มีกฎ (rule) → ล้ม', () => {
  const noFormula = entry({ kpis: [{ id: 'x', label: 'ตัวเลข', unit: 'เรื่อง', formula: '', phase: 'E1' }] })
  mustFail('kpi ไม่มีสูตร', executiveCoverageErrors({ ...fixtures, registry: [...EXECUTIVE_REGISTRY.filter((e) => e.key !== 'complaints'), noFormula] }), 'formula')
  const noRule = entry({ alerts: [{ id: 'a', label: 'เตือน', severity: 'warn', rule: '', phase: 'E2' }] })
  mustFail('alert ไม่มีกฎ', executiveCoverageErrors({ ...fixtures, registry: [...EXECUTIVE_REGISTRY.filter((e) => e.key !== 'complaints'), noRule] }), 'rule')
})

test('เฟส E2 ขึ้นจอแล้วแต่ยังไม่มีฟังก์ชัน exec_summary_<x> ใน migrations → ล้ม (ไม่มี SQL ใน E1 จึงไม่ถูกตรวจตอนนี้)', () => {
  const errors = executiveCoverageErrors({ ...fixtures, sqlFunctionExists, current: 'E2' })
  mustFail('ไม่มีฟังก์ชัน SQL', errors, 'exec_summary_')
  // ใส่ฟังก์ชันให้ครบแล้วต้องหาย
  assert.deepEqual(executiveCoverageErrors({ ...fixtures, sqlFunctionExists: () => true, current: 'E2' }), [])
})

test('ตัวตรวจ sqlFunctionExists จับชื่อฟังก์ชันจริงได้ (ไม่ใช่ตอบ false ตลอด)', () => {
  assert.equal(sqlFunctionExists('complaint_stats_fy'), true)
  assert.equal(sqlFunctionExists('exec_summary_ghost_zzz'), false)
})

console.log(`\nok — ${cases} cases`)

// ตรึงตรรกะ "บัญชีนี้เห็นเมนูโมดูลไหน" (src/lib/staffMenuAccess.js) ให้ได้ผลเท่าตรรกะเดิมที่เคยอยู่ใน StaffDashboard.jsx ทุกคีย์
// — ย้ายตรรกะออกมาให้ห้องผู้บริหาร (/executive) ใช้ร่วม ห้ามทำให้เมนูหน้าเจ้าหน้าที่เปลี่ยนแม้คีย์เดียว
// ไม่ต่อเน็ต/ฐานข้อมูล · รันด้วย node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANAGED_MODULE_KEYS } from '../src/lib/staffModules.js'
import { PATIENT_TRANSPORT_MODULE_KEY } from '../src/lib/patientTransport.js'
import {
  PERFORMANCE_ROLES, STAFF_MENU_MODULE_KEYS, STAFF_MENU_TARGETS, TECHNICIAN_MODULE_KEYS,
  isStaffModuleEnabled, staffMenuAccess, staffVisibleModuleKeys,
} from '../src/lib/staffMenuAccess.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dashboardSource = fs.readFileSync(path.join(root, 'src', 'pages', 'StaffDashboard.jsx'), 'utf8')
// รายการเมนูย้ายไป src/lib/staffNavGroups.js (ใช้ร่วมกับห้องผู้บริหาร) — ลิสต์คีย์/เป้าหมายตรวจกับไฟล์นั้น
const navGroupsSource = fs.readFileSync(path.join(root, 'src', 'lib', 'staffNavGroups.js'), 'utf8')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

// ── ตรรกะเดิม (คัดลอกจาก StaffDashboard.jsx ก่อนแยกออก — origin/master) ─────────────────
function legacy({ role, profile, tenant, allModuleKeys }) {
  const managedKeys = MANAGED_MODULE_KEYS
  const baseEnabledKeys = tenant?.enabled_modules
    ? [...tenant.enabled_modules, ...allModuleKeys.filter(k => !managedKeys.includes(k))]
    : allModuleKeys
  const councilExtraKeys = role === 'council'
    ? ['data-center', 'report'].filter(k => baseEnabledKeys.includes(k))
    : []
  const enabledKeys = Array.from(new Set([...baseEnabledKeys, ...councilExtraKeys]))
  const hasFleetAccess = Boolean(profile?.fleet_role) || role === 'admin' || role === 'superadmin'
  const hasAssetAccess = Boolean(profile?.asset_role) || role === 'admin' || role === 'superadmin'
  const hasPerformanceAccess = ['technician', 'staff', 'officer', 'admin', 'superadmin', 'viewer'].includes(role) && enabledKeys.includes('complaints')
  const hasWaterEventsAccess = ['superadmin', 'admin', 'officer', 'staff'].includes(role)
    && (!Array.isArray(tenant?.enabled_modules) || tenant.enabled_modules.includes('water-situation'))
  const hasLocalPlanAccess = ['superadmin', 'admin', 'officer', 'staff', 'viewer'].includes(role)
  const technicianKeys = ['complaints', 'infra', 'projects', 'events', 'data-center', 'fleet', 'manual-staff', 'performance']
  const roleScopedKeys = role === 'technician'
    ? enabledKeys.filter(k => technicianKeys.includes(k))
    : enabledKeys
  const scopedKeys = [
    ...(hasFleetAccess ? [] : ['fleet']),
    ...(hasAssetAccess ? [] : ['borrowable-assets']),
    ...(hasPerformanceAccess ? [] : ['performance']),
    ...(hasWaterEventsAccess ? [] : ['water-events']),
    ...(hasLocalPlanAccess ? [] : ['local-plan']),
  ].reduce((keys, hidden) => keys.filter(k => k !== hidden), roleScopedKeys)
  return { enabledKeys, scopedKeys, hasLocalPlanAccess }
}

// ── ชุดทดสอบ: บทบาท × สิทธิ์รายบุคคล × การตั้งค่า อปท. ──────────────────────────────────
const ROLES = [undefined, null, 'citizen', 'staff', 'officer', 'admin', 'superadmin', 'viewer', 'council', 'technician']
const PROFILES = [null, {}, { fleet_role: 'fleet_viewer' }, { asset_role: 'asset_staff' }, { fleet_role: 'fleet_admin', asset_role: 'asset_admin' }, { fleet_role: '', asset_role: null }]

// เลขสุ่มคงที่ (LCG) ให้ชุดเทสต์ซ้ำได้ทุกรอบ
let seed = 20261110
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const randomSubset = (keys) => keys.filter(() => rand() < 0.6)
const TENANTS = [
  null,
  {},
  { enabled_modules: null },
  { enabled_modules: [] },
  { enabled_modules: [...MANAGED_MODULE_KEYS] },
  { enabled_modules: [...MANAGED_MODULE_KEYS, 'unknown-extra'] },
  ...MANAGED_MODULE_KEYS.map((k) => ({ enabled_modules: MANAGED_MODULE_KEYS.filter((x) => x !== k) })), // ปิดทีละคีย์
  ...MANAGED_MODULE_KEYS.map((k) => ({ enabled_modules: [k] })), // เปิดทีละคีย์
  ...Array.from({ length: 40 }, () => ({ enabled_modules: randomSubset(MANAGED_MODULE_KEYS) })),
]

test('ผลเท่าตรรกะเดิมของ StaffDashboard ทุกคีย์: ทุกบทบาท × สิทธิ์รายบุคคล × การตั้งค่า อปท. (enabledKeys, scopedKeys, hasLocalPlanAccess)', () => {
  let combos = 0
  for (const role of ROLES) {
    for (const profile of PROFILES) {
      for (const tenant of TENANTS) {
        const expected = legacy({ role, profile, tenant, allModuleKeys: STAFF_MENU_MODULE_KEYS })
        const actual = staffMenuAccess({ role, profile, tenant })
        assert.deepEqual(actual, expected, `role=${role} profile=${JSON.stringify(profile)} tenant=${JSON.stringify(tenant)?.slice(0, 80)}`)
        assert.deepEqual(staffVisibleModuleKeys({ role, profile, tenant }), expected.scopedKeys)
        combos++
      }
    }
  }
  assert.ok(combos > 3000, `ชุดเทสต์เล็กเกินไป ${combos}`)
})

test('ส่ง allModuleKeys เองได้ (StaffDashboard ส่งของตัวเอง) — ผลเท่าตรรกะเดิมกับลิสต์ที่มีคีย์นอกทะเบียน', () => {
  const extra = [...STAFF_MENU_MODULE_KEYS, 'not-managed-menu']
  for (const role of ROLES) {
    const tenant = { enabled_modules: ['complaints', 'fleet'] }
    assert.deepEqual(staffMenuAccess({ role, profile: {}, tenant, allModuleKeys: extra }), legacy({ role, profile: {}, tenant, allModuleKeys: extra }), String(role))
  }
})

test('กติกาหลักที่ต้องไม่เปลี่ยน: ช่างเห็นเฉพาะเมนูช่าง · fleet/พัสดุตามสิทธิ์รายคน · สภาไม่ทะลุการตั้งค่า อปท. · ผลงานต้องเปิดคำร้อง', () => {
  const all = { enabled_modules: [...MANAGED_MODULE_KEYS] }
  const tech = staffVisibleModuleKeys({ role: 'technician', profile: { fleet_role: 'x' }, tenant: all })
  assert.ok(tech.every((k) => TECHNICIAN_MODULE_KEYS.includes(k)), tech.join(','))
  assert.equal(tech.includes('inbox'), false)
  assert.equal(staffVisibleModuleKeys({ role: 'officer', profile: {}, tenant: all }).includes('fleet'), false)
  assert.equal(staffVisibleModuleKeys({ role: 'officer', profile: { fleet_role: 'x' }, tenant: all }).includes('fleet'), true)
  assert.equal(staffVisibleModuleKeys({ role: 'admin', profile: {}, tenant: all }).includes('borrowable-assets'), true)
  assert.equal(staffVisibleModuleKeys({ role: 'officer', profile: {}, tenant: all }).includes('borrowable-assets'), false)
  const councilOff = staffVisibleModuleKeys({ role: 'council', profile: {}, tenant: { enabled_modules: ['complaints'] } })
  assert.equal(councilOff.includes('data-center') || councilOff.includes('report'), false, 'อปท. ปิดไว้ สภาต้องไม่เห็น')
  const noComplaints = { enabled_modules: MANAGED_MODULE_KEYS.filter((k) => k !== 'complaints') }
  assert.equal(staffVisibleModuleKeys({ role: 'admin', profile: {}, tenant: noComplaints }).includes('performance'), false)
  assert.equal(staffVisibleModuleKeys({ role: 'council', profile: {}, tenant: all }).includes('performance'), false)
})

test('isStaffModuleEnabled: โมดูลที่เป็นเมนูใช้ scopedKeys · คีย์ที่ไม่ใช่เมนู (งานประปา/น้ำ-ฝน) ใช้กติกา tenant', () => {
  const scopedKeys = ['complaints', 'events']
  const tenantModuleEnabled = (key) => key !== 'waterworks'
  assert.equal(isStaffModuleEnabled('complaints', { scopedKeys, tenantModuleEnabled }), true)
  assert.equal(isStaffModuleEnabled('fleet', { scopedKeys, tenantModuleEnabled }), false, 'เป็นเมนูแต่ไม่อยู่ใน scopedKeys')
  assert.equal(isStaffModuleEnabled('waterworks', { scopedKeys, tenantModuleEnabled }), false, 'ไม่ใช่เมนู → tenant ปิด')
  assert.equal(isStaffModuleEnabled('water-situation', { scopedKeys, tenantModuleEnabled }), true, 'ไม่ใช่เมนู → tenant เปิด')
})

test('PERFORMANCE_ROLES ยังส่งออกจาก staffPerformanceData.js ชื่อเดิม (ผู้เรียกเดิมไม่พัง)', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'lib', 'staffPerformanceData.js'), 'utf8')
  assert.match(source, /export \{ PERFORMANCE_ROLES \} from '\.\/staffMenuAccess\.js'/)
  assert.deepEqual([...PERFORMANCE_ROLES].sort(), ['admin', 'officer', 'staff', 'superadmin', 'technician', 'viewer'])
})

// ── กันลิสต์ในไฟล์นี้หลุดจากซอร์สจริงของ StaffDashboard ─────────────────────────────────
function menuDefinitionBlock() {
  const from = navGroupsSource.indexOf('export const STANDALONE_GROUPS = [')
  const to = navGroupsSource.indexOf('export const MODULES = [')
  assert.ok(from > 0 && to > from, 'หา STANDALONE_GROUPS/MODULE_GROUPS ใน staffNavGroups.js ไม่เจอ — โครงไฟล์เปลี่ยน ต้องแก้เทสต์นี้')
  return navGroupsSource.slice(from, to).split(/\r?\n/).filter((line) => !line.trim().startsWith('//')).join('\n')
}

test('STAFF_MENU_MODULE_KEYS ตรงกับเมนูจริงใน staffNavGroups.js (ไม่หลุดเมื่อเพิ่ม/ลบเมนู)', () => {
  const keys = [...menuDefinitionBlock().matchAll(/\{\s*key:\s*(?:'([^']+)'|(PATIENT_TRANSPORT_MODULE_KEY))/g)]
    .map((m) => m[1] ?? PATIENT_TRANSPORT_MODULE_KEY)
  assert.ok(keys.length >= 15, `อ่านเมนูจากซอร์สได้ ${keys.length} รายการ`)
  assert.deepEqual([...keys].sort(), [...STAFF_MENU_MODULE_KEYS].sort())
})

test('STAFF_MENU_TARGETS ตรงกับ externalUrl/newTab ของเมนูจริงใน staffNavGroups.js ทุกรายการ', () => {
  const found = {}
  for (const m of menuDefinitionBlock().matchAll(/\{\s*key:\s*'([^']+)'[^\n]*?(externalUrl|newTab):\s*'([^']+)'/g)) found[m[1]] = { [m[2]]: m[3] }
  assert.deepEqual(found, JSON.parse(JSON.stringify(STAFF_MENU_TARGETS)))
})

test('StaffDashboard.jsx เรียกตัวเดียวกับห้องผู้บริหาร และไม่มีของห้องผู้บริหารค้างในหน้าแรก', () => {
  assert.match(dashboardSource, /staffMenuAccess\(\{ role, profile, tenant, allModuleKeys \}\)/)
  for (const gone of ['ExecutiveHome', 'HomeViewSwitch', 'useMyPositionCategory', 'isExecModuleEnabled', 'resolveHomeView', 'executiveAccess']) {
    assert.equal(dashboardSource.includes(gone), false, `หน้าแรก /staff ต้องไม่มี ${gone} แล้ว (ห้องผู้บริหารเป็นหน้าเดี่ยว /executive)`)
  }
})

console.log(`\nok — ${cases} cases`)

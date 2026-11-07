// หน้าจอโมดูลโครงการก่อสร้าง — เรนเดอร์ด้วย Vite SSR (ไม่ใช้เบราว์เซอร์ ไม่ต่อฐานข้อมูล ไม่ใช้เน็ต)
//   node tests/construction-report-ui.test.mjs
// จับ error ตอน runtime ที่ build/lint ไม่เห็น (อ้าง undefined, props ผิด) และตรวจว่าปุ่มตามสิทธิ์โผล่/ไม่โผล่ถูก
// ⚠️ ไม่ได้แทนการลองกดจริงกับฐานข้อมูล (ตาราง civil_* ต้องถูก apply ก่อน)
import assert from 'node:assert/strict'
import process from 'node:process'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { bundleOf, fixture, TENANT } from './lib/constructionReportFixtures.mjs'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}
try {
  const { default: WeeklyReportSheet } = await vite.ssrLoadModule('/src/components/staff/construction/WeeklyReportSheet.jsx')
  const { default: ProjectSheet } = await vite.ssrLoadModule('/src/components/staff/construction/ProjectSheet.jsx')
  const { default: ProgressChart } = await vite.ssrLoadModule('/src/components/staff/construction/ProgressChart.jsx')
  const { default: Module } = await vite.ssrLoadModule('/src/components/staff/construction/ConstructionProjectsModule.jsx')
  const { progressSeries } = await vite.ssrLoadModule('/src/lib/constructionReport.js')

  const noop = () => {}
  const WRITE = { read: true, write: true, manage: false, editBase: false }
  const MANAGE = { read: true, write: true, manage: true, editBase: true }
  const READ = { read: true, write: false, manage: false, editBase: false }
  const tenant = { ...TENANT, id: 't1' }
  const sheet = (f, access, extra = {}) => renderToStaticMarkup(h(WeeklyReportSheet, {
    tenant, project: f.project, bundle: bundleOf(f), report: f.report, access,
    isLatest: true, isAdmin: false, onClose: noop, onChanged: noop, onDeleted: noop, ...extra,
  }))

  test('แผ่นรายงาน (ร่าง, ผู้ควบคุมงาน): ตัวเลขทองคำ · ปุ่มบันทึกร่าง/ล็อก/พิมพ์ · ไม่มีปุ่มปลดล็อก/ลบ', () => {
    const out = sheet(fixture({ final: false }), WRITE)
    for (const needle of ['รายงานสัปดาห์ที่ 1', '8.40%', '10.25%', 'ช้า -1.9%', 'บันทึกร่าง', 'ล็อกรายงาน', 'พิมพ์', 'ฉบับร่าง']) assert.ok(out.includes(needle), needle)
    assert.ok(!out.includes('ปลดล็อก'))
    assert.ok(!out.includes('ลบ</button>'))
    assert.ok(out.includes('ผลการดำเนินงานก่อสร้าง') && out.includes('สภาพอากาศ') && out.includes('บันทึกการปฏิบัติงานรายวัน'))
  })

  test('แผ่นรายงาน (ล็อกแล้ว): ใช้ตัวเลขแช่แข็ง · หัวหน้ากองเห็นปุ่มปลดล็อก เฉพาะฉบับล่าสุด · ผู้ควบคุมงานปลดเองไม่ได้', () => {
    const f = fixture({ final: true })
    const manager = sheet(f, MANAGE)
    assert.ok(manager.includes('ล็อกแล้ว') && manager.includes('ปลดล็อก'))
    assert.ok(!manager.includes('บันทึกร่าง') && !manager.includes('ล็อกรายงาน'))
    assert.ok(!sheet(f, MANAGE, { isLatest: false }).includes('ปลดล็อก'), 'ปลดได้เฉพาะฉบับล่าสุด')
    assert.ok(!sheet(f, WRITE).includes('ปลดล็อก'))
    assert.ok(sheet(f, MANAGE, { isAdmin: true }).includes('ลบ</button>'), 'แอดมินลบรายงานที่สร้างผิดได้')
    assert.ok(manager.includes('8.40%') && manager.includes('10.25%'))
  })

  test('แผ่นรายงาน (อ่านอย่างเดียว): ไม่มีปุ่มบันทึก/ล็อก และช่องกรอกถูกปิดหมด', () => {
    const out = sheet(fixture({ final: false }), READ)
    assert.ok(!out.includes('บันทึกร่าง') && !out.includes('ล็อกรายงาน') && !out.includes('ปลดล็อก'))
    const inputs = out.match(/<(?:input|textarea|select)[^>]*>/g) ?? []
    assert.ok(inputs.length > 10)
    const open = inputs.filter(i => !/disabled/.test(i))
    assert.deepEqual(open.map(i => i.slice(0, 90)), [])
  })

  test('แผ่นรายงาน: ข้อมูลที่เสียหาย (progress/crew/weather/finance เป็น null, ช่วงวันผิด) ไม่ทำให้หน้าพัง และล็อกไม่ได้', () => {
    const f = fixture({ final: false })
    const broken = { ...f.report, progress: null, crew: null, machinery: null, weather: null, daily_log: null, issues: null, finance: null, period_end: '2026-08-20' }
    const out = sheet({ ...f, report: broken }, WRITE)
    assert.ok(out.includes('รายงานสัปดาห์ที่ 1'))
    assert.ok(out.includes('ช่วงรายงานยาว'))
    assert.match(out, /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*ล็อกรายงาน/)
  })

  test('แผ่นรายงาน: ชื่อที่มี < > & " \' ถูก escape ในหน้าจอ ไม่มี script ดิบ', () => {
    const evil = '<script>alert(1)</script>"&\''
    const out = sheet(fixture({ final: false, evil }), WRITE)
    assert.ok(!out.includes('<script>alert(1)'))
    assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  })

  test('แผ่นตั้งค่าโครงการ (สร้างใหม่): แถวบุคคลตั้งต้นตามต้นฉบับ · ปุ่มรายการงานแนะนำของถนน · เฉพาะแอดมินเลือกกอง', () => {
    const out = renderToStaticMarkup(h(ProjectSheet, {
      tenant, profile: { id: 'u1', role: 'technician', department_id: 'd1' }, mode: 'create', project: null, bundle: null,
      access: { editBase: true, write: true, manage: true }, departments: [], staffChoices: [{ id: 's1', full_name: 'นายช่าง ทดสอบ' }],
      onClose: noop, onSaved: noop,
    }))
    for (const needle of ['เพิ่มโครงการก่อสร้าง', 'รายนามคณะกรรมการตรวจการจ้าง', 'รายชื่อผู้ควบคุมงานของผู้ว่าจ้าง', 'รายชื่อตัวแทนผู้รับจ้าง', 'ประธานกรรมการ', 'หัวหน้าผู้ควบคุมงาน', 'ผู้จัดการโครงการ', '+ งานชั้นพื้นทาง (Base Course)', 'ปีงบประมาณ']) {
      assert.ok(out.includes(needle), needle)
    }
    assert.ok(!out.includes('กองที่รับผิดชอบ'))
    assert.ok(out.includes('นายช่าง ทดสอบ'))
  })

  test('แผ่นตั้งค่าโครงการ (แก้ไข): ข้อมูลเดิมครบ · ผู้แก้ทะเบียนไม่ได้เห็นคำอธิบายและช่องทะเบียนถูกปิด · แอดมินเห็นช่องเลือกกอง', () => {
    const f = fixture()
    const base = { tenant, mode: 'edit', project: f.project, bundle: bundleOf(f), departments: [{ id: 'd1', name: 'กองช่าง' }], staffChoices: [], onClose: noop, onSaved: noop }
    const supervisor = renderToStaticMarkup(h(ProjectSheet, { ...base, profile: { id: 'u2', role: 'technician', department_id: 'd1' }, access: { ...WRITE, editBase: false } }))
    assert.ok(supervisor.includes('ข้อมูลทะเบียนโครงการแก้ได้เฉพาะผู้สร้างโครงการ'))
    assert.ok(supervisor.includes('งานเตรียมพื้นที่และงานดินตัด/ถม') && supervisor.includes('นายหัวหน้า ควบคุมงาน'))
    assert.match(supervisor, /<input[^>]*disabled=""[^>]*value="ถนน คสล\. สายบ้านหนองทดสอบ/)
    const admin = renderToStaticMarkup(h(ProjectSheet, { ...base, profile: { id: 'u3', role: 'admin', department_id: null }, access: MANAGE }))
    assert.ok(admin.includes('กองที่รับผิดชอบ'))
    assert.ok(!admin.includes('ข้อมูลทะเบียนโครงการแก้ได้เฉพาะ'))
  })

  test('กราฟ: ไม่มีข้อมูล = ข้อความแนะนำ · มีข้อมูล = SVG พร้อมคำอธิบายสำหรับโปรแกรมอ่านจอ', () => {
    assert.ok(renderToStaticMarkup(h(ProgressChart, { series: [] })).includes('ยังไม่มีรายงาน'))
    const f = fixture()
    const series = progressSeries({ items: f.items, reports: [f.report], contract: { start_date: '2026-08-01', end_date: '2026-11-28' } })
    const out = renderToStaticMarkup(h(ProgressChart, { series }))
    assert.ok(out.includes('<svg') && out.includes('role="img"') && out.includes('ผลงานจริงสะสม') && out.includes('แผนที่ตั้งในระบบ'))
    assert.ok(out.includes('ล่าสุดผลงานจริง 8.40 เปอร์เซ็นต์'))
  })

  test('โมดูลหลัก: เรนเดอร์สถานะกำลังโหลดครั้งแรกได้ (ไม่แตะฐานข้อมูลตอน SSR)', () => {
    const out = renderToStaticMarkup(h(Module, { tenant, profile: { id: 'u1', role: 'staff', department_id: 'd1' } }))
    assert.ok(out.includes('กำลังโหลดโครงการ'))
  })
} finally {
  await vite.close()
}
console.log(`\n${cases} cases passed`)
process.exit(0)

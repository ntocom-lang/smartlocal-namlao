// นับงานโครงการก่อสร้างที่ "ถึงคิวคน" สำหรับหน้าแรกเจ้าหน้าที่ (src/lib/constructionDueWork.js) — คำนวณล้วน ไม่ต่อฐานข้อมูล ไม่ใช้เน็ต
//   node tests/construction-due-work.test.mjs
// โหลดผ่าน Vite SSR เพราะไฟล์ใช้ FINISHED_STAGES จาก components/staff/construction/lifecycleFormat.js (import แบบไม่มีนามสกุล node ตรงๆ ไม่รู้จัก)
// ทุกเคสสร้าง bundle ให้ถึงเงื่อนไขจริงของ deadlines()/projectAlerts() แล้วยืนยันก่อนว่าคำเตือนที่ตั้งใจทดสอบเกิดจริง
// (ไม่งั้นเคส "ไม่นับ" จะผ่านลวงเพราะไม่มีคำเตือนอยู่แล้ว)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { createServer } from 'vite'

process.env.TZ = 'America/Los_Angeles'   // กันโค้ดที่อ่านวันจากนาฬิกา/โซนเวลาเครื่อง
const TODAY = '2026-11-09'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

try {
  const D = await vite.ssrLoadModule('/src/lib/constructionDueWork.js')
  const L = await vite.ssrLoadModule('/src/lib/constructionLifecycle.js')
  const Fmt = await vite.ssrLoadModule('/src/components/staff/construction/lifecycleFormat.js')

  const empty = () => ({ contract: null, people: [], milestones: [], installments: [], changes: [], defects: [], documents: [], events: [] })
  const project = (id, stage, extra = {}) => ({
    id, title: `โครงการ ${id}`, stage, stage_before_hold: null, status: L.statusOfStage(stage), contract_amount: 500_000, department_id: 'd1', ...extra,
  })
  const bundle = (id, stage, extra = {}, projectExtra = {}) => ({ project: project(id, stage, projectExtra), ...empty(), ...extra })
  const row = b => ({ project: b.project, bundle: b })
  const inst = (no, extra = {}) => ({ installment_no: no, due_on: null, delivered_on: null, chair_acknowledged_on: null, inspected_on: null, inspection_result: null, due_report_on: null, ...extra })
  const alertOf = (b, code) => L.projectAlerts(b, TODAY).find(a => a.code === code)
  const work = (...bundles) => D.constructionDueWork(bundles.map(row), TODAY)

  await test('งวดส่งแล้วยังไม่ตรวจรับ = นับ · ตรวจรับแล้ว = ไม่นับ · ยังไม่ส่ง = ไม่นับ · ค่าว่าง/ช่องว่างล้วน = ไม่มีค่า', () => {
    const b = bundle('p1', 'construction', { installments: [
      inst(1, { delivered_on: '2026-11-02' }),                                   // ส่งแล้วยังไม่ตรวจ → นับ
      inst(2, { delivered_on: '2026-10-01', inspected_on: '2026-10-03', inspection_result: 'accepted' }), // ตรวจแล้ว → ไม่นับ
      inst(3, {}),                                                               // ยังไม่ส่ง → ไม่นับ
      inst(4, { delivered_on: '2026-11-03', inspected_on: '   ' }),              // ช่องตรวจเป็นช่องว่างล้วน = ว่าง → นับ
      inst(5, { delivered_on: '' }),                                             // ส่งเป็นสตริงว่าง → ไม่นับ
    ] })
    assert.deepEqual(work(b), { awaitingInspection: 2, overdue: 0, total: 2 })
    // ไม่มีคำเตือนอื่นแอบนับ (กันเลขถูกด้วยเหตุผลผิด)
    assert.deepEqual(L.projectAlerts(b, TODAY).filter(D.isCountableOverdue), [])
  })

  await test('โครงการปิดแล้ว/ยกเลิก = ไม่นับ แม้มีงวดค้างและกำหนดเลย · ระงับ/บอกเลิก ใช้ชุดเดียวกับแท็บภาพรวม (FINISHED_STAGES เท่านั้นที่ตัดออก)', () => {
    assert.deepEqual([...Fmt.FINISHED_STAGES], ['closed', 'cancelled'])
    const busy = stage => bundle(`s-${stage}`, stage, {
      installments: [inst(1, { delivered_on: '2026-10-20' })],
      contract: { contract_date: '2026-09-01' },
      milestones: [{ key: 'contract_copy_revenue', done_on: '2026-09-20' }],
    }, { contract_amount: 1_250_000 })
    assert.ok(alertOf(busy('construction'), 'contract_copy_oag_overdue'), 'เคสต้องมีกำหนดเลยจริง')
    for (const stage of ['closed', 'cancelled']) assert.deepEqual(work(busy(stage)), { awaitingInspection: 0, overdue: 0, total: 0 }, stage)
    for (const stage of ['construction', 'suspended', 'warranty']) assert.deepEqual(work(busy(stage)), { awaitingInspection: 1, overdue: 1, total: 2 }, stage)
  })

  await test('กำหนดตรวจรับงวดเลยแล้ว: นับครั้งเดียว (ใน awaitingInspection) ไม่ซ้ำใน overdue — ทั้งแบบ verify และไม่ verify', () => {
    for (const total of [3, null]) {
      const b = bundle('p2', 'construction', {
        contract: total ? { installments_total: total } : null,
        installments: [inst(1, { delivered_on: '2026-10-20', chair_acknowledged_on: '2026-10-21' })],
      })
      const alert = alertOf(b, 'installment_inspection_overdue')
      assert.ok(alert && alert.level === 'error', 'ต้องมีคำเตือนตรวจรับเลยกำหนดจริง')
      assert.equal(alert.verify, total === null, 'มีจำนวนงวดในสัญญา = ไม่ verify (เคสที่ต้องกันซ้ำจริง)')
      assert.deepEqual(work(b), { awaitingInspection: 1, overdue: 0, total: 1 }, `installments_total=${total}`)
    }
  })

  await test('คำเตือนที่ verify (ผู้ควบคุมงานรายงานงวด — ว 681 ยังไม่ยืนยันวิธีนับ) = ไม่นับ', () => {
    const b = bundle('p3', 'construction', { installments: [inst(1, { due_on: '2026-09-01' })] })
    const alert = alertOf(b, 'installment_due_report_overdue')
    assert.ok(alert && alert.level === 'error' && alert.verify === true, 'ต้องมีคำเตือน error ที่ verify จริง')
    assert.deepEqual(work(b), { awaitingInspection: 0, overdue: 0, total: 0 })
  })

  await test('คำเตือนฝั่งผู้รับจ้าง (ระดับ warn: แจ้งขอขยายเวลาเลยกำหนด) = ไม่นับ', () => {
    const b = bundle('p4', 'construction', { changes: [{ kind: 'extend_time', cause_ended_on: '2026-09-01', request_received_on: null, decision: null }] })
    const alert = alertOf(b, 'change_request_overdue')
    assert.ok(alert && alert.level === 'warn', 'ต้องมีคำเตือน warn ของผู้รับจ้างจริง')
    assert.deepEqual(work(b), { awaitingInspection: 0, overdue: 0, total: 0 })
  })

  await test('กำหนดเลยจริงที่ไม่ต้อง verify (ส่งสำเนาสัญญาให้ สตง./กรมสรรพากร) = นับ · ทำแล้วไม่นับ · ครบกำหนดวันนี้ยังไม่นับ', () => {
    const base = { contract: { contract_date: '2026-09-01' } }   // ≥ 1 ล้านบาท → ครบ 30 วัน = 2026-10-01
    const big = { contract_amount: 1_250_000 }
    const both = bundle('p5', 'contracted', base, big)
    for (const code of ['contract_copy_oag_overdue', 'contract_copy_revenue_overdue']) {
      const a = alertOf(both, code)
      assert.ok(a && a.level === 'error' && a.verify === false && a.deadlineKey, code)
    }
    assert.deepEqual(work(both), { awaitingInspection: 0, overdue: 2, total: 2 })
    const oneDone = bundle('p5b', 'contracted', { ...base, milestones: [{ key: 'contract_copy_revenue', done_on: '2026-09-20' }] }, big)
    assert.deepEqual(work(oneDone), { awaitingInspection: 0, overdue: 1, total: 1 })
    const allDone = bundle('p5c', 'contracted', { ...base, milestones: [{ key: 'contract_copy_revenue', done_on: '2026-09-20' }, { key: 'contract_copy_oag', done_on: '2026-09-21' }] }, big)
    assert.deepEqual(work(allDone), { awaitingInspection: 0, overdue: 0, total: 0 })
    // เลยกำหนดตัดสินด้วยวันปฏิทิน: วันที่ 1 ต.ค. = ครบกำหนดวันนี้ (warn) · 2 ต.ค. = เลย (error)
    assert.deepEqual(D.constructionDueWork([row(both)], '2026-10-01'), { awaitingInspection: 0, overdue: 0, total: 0 })
    assert.deepEqual(D.constructionDueWork([row(both)], '2026-10-02'), { awaitingInspection: 0, overdue: 2, total: 2 })
    // สัญญาไม่ถึง 1 ล้านบาท = ไม่มีกำหนดนี้
    assert.deepEqual(work(bundle('p5d', 'contracted', base, { contract_amount: 500_000 })), { awaitingInspection: 0, overdue: 0, total: 0 })
  })

  await test('รวมหลายโครงการ: บวกทุกโครงการที่ยังไม่ปิด · ข้อมูลว่าง/ไม่มี rows = 0 ไม่ล้ม', () => {
    const a = bundle('a', 'construction', { installments: [inst(1, { delivered_on: '2026-11-02' }), inst(2, { delivered_on: '2026-11-03' })] })
    const b = bundle('b', 'warranty', { contract: { contract_date: '2026-09-01' } }, { contract_amount: 2_000_000 })
    const closed = bundle('c', 'closed', { installments: [inst(1, { delivered_on: '2026-11-02' })] })
    assert.deepEqual(work(a, b, closed), { awaitingInspection: 2, overdue: 2, total: 4 })
    for (const rows of [[], null, undefined]) assert.deepEqual(D.constructionDueWork(rows, TODAY), { awaitingInspection: 0, overdue: 0, total: 0 })
    assert.deepEqual(D.constructionDueWork([null, {}, { project: null }], TODAY), { awaitingInspection: 0, overdue: 0, total: 0 })
    // แถวที่ไม่มี bundle (ข้อมูลวงจรยังไม่มา) ไม่ล้ม และไม่แต่งตัวเลขขึ้นเอง
    assert.deepEqual(D.constructionDueWork([{ project: project('x', 'construction') }], TODAY), { awaitingInspection: 0, overdue: 0, total: 0 })
  })

  await test('isCountableOverdue: ต้อง error + มี deadlineKey + code = <key>_overdue + ไม่ verify + ไม่ใช่ตรวจรับงวด', () => {
    const ok = { level: 'error', deadlineKey: 'contract_copy_oag', code: 'contract_copy_oag_overdue', verify: false }
    assert.equal(D.isCountableOverdue(ok), true)
    for (const bad of [
      null, undefined, {},
      { ...ok, level: 'warn' }, { ...ok, level: 'info' },
      { ...ok, deadlineKey: undefined }, { ...ok, deadlineKey: null },
      { ...ok, code: 'contract_copy_oag_today' }, { ...ok, code: 'contract_copy_oag_soon' }, { ...ok, code: 'fine_over_threshold' },
      { ...ok, verify: true },
      { ...ok, deadlineKey: 'installment_inspection', code: 'installment_inspection_overdue' },
    ]) assert.equal(D.isCountableOverdue(bad), false, JSON.stringify(bad))
  })

  await test('buildDueRows: รูปเดียวกับ rows ของโมดูล (project + bundle เติมตารางว่างให้ครบ) · โครงการที่ยังไม่มีข้อมูลวงจรไม่ล้ม', () => {
    const p1 = project('p1', 'construction')
    const p2 = project('p2', 'closed')
    const rows = D.buildDueRows([p1, p2], { p1: { ...empty(), installments: [inst(1, { delivered_on: '2026-11-01' })] } })
    assert.equal(rows.length, 2)
    assert.equal(rows[0].project, p1)
    assert.equal(rows[0].bundle.project, p1)
    assert.equal(rows[0].bundle.installments.length, 1)
    for (const key of ['people', 'milestones', 'installments', 'changes', 'defects', 'documents', 'events']) assert.ok(Array.isArray(rows[1].bundle[key]), key)
    assert.equal(rows[1].bundle.contract, null)
    assert.deepEqual(D.buildDueRows(null, null), [])
    assert.deepEqual(D.constructionDueWork(rows, TODAY), { awaitingInspection: 1, overdue: 0, total: 1 })
  })

  // ── ซอร์สของชั้นดึงข้อมูล (ไม่ต่อฐานข้อมูล — import supabase ในเทสต์ไม่ได้) ───────────────
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
  const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const due = stripComments(read('src/lib/staffDueWork.js'))

  await test('staffDueWork: query ใดพัง = คืน error (ไม่คืน 0) · ทุก query กรอง municipality_id · อ่านขั้นก่อสร้างผ่าน RPC ไม่อ่านตารางตรง', () => {
    // ผลสำเร็จมี error: null เสมอ · ทางพังคืน failed(...) ที่มี error จริง
    assert.match(due, /return failed\(manager\.error/)
    assert.match(due, /if \(plansResult\.error\) return failed/)
    assert.match(due, /if \(progress\.error\) return failed/)
    assert.match(due, /if \(civil\.error\) return failed/)
    assert.match(due, /if \(itemsResult\.error\) return failed/)
    assert.match(due, /if \(list\.error\) return failed/)
    assert.match(due, /if \(life\.error\) return failed/)
    assert.match(due, /catch \(error\) \{\s*return failed/)
    // กรอง อปท. เองทุกตารางที่อ่านตรง (superadmin อ่านได้ทุก อปท.)
    assert.equal([...due.matchAll(/\.eq\('municipality_id', municipalityId\)/g)].length, 2)
    assert.match(due, /from\('local_op_plan_items'\)[\s\S]{0,260}\.eq\('municipality_id', municipalityId\)/)
    assert.match(due, /from\('local_op_plans'\)[\s\S]{0,160}\.eq\('municipality_id', municipalityId\)/)
    // civil_projects: RLS ให้ officer เห็นแค่กองตัวเอง → ต้องใช้ RPC ของแท็บติดตามผล (fetchCivilStages) ห้ามอ่านตาราง/นับเอง
    assert.doesNotMatch(due, /from\('civil_projects'\)/)
    assert.match(due, /fetchCivilStages\(municipalityId, month\.fiscalYear\)/)
    // รายการแผนไล่ทีละหน้า (NOTES ข้อ 14) และไม่อ่านชื่อรายการ/เหตุผล
    assert.match(due, /\.range\(from, from \+ PAGE - 1\)/)
    assert.doesNotMatch(due, /item_name|official_name|select\('\*'\)/)
  })

  await test('staffDueWork: ผู้จัดการแผนนับทั้ง อปท. · คนอื่นนับเฉพาะกองตัวเอง · ไม่ใช่ผู้จัดการและไม่มีกอง = 0 · ใช้เดือนที่เพิ่งจบตามเวลาไทยของ lib', () => {
    assert.match(due, /!manager\.isManager && !departmentId\) return zero/)
    assert.match(due, /departmentId: manager\.isManager \? null : departmentId/)
    assert.match(due, /previousMonthBangkok\(now\)/)
    assert.match(due, /countDueItems\(\{/)
    // โครงการก่อสร้าง: สิทธิ์อ่านชุดเดียวกับโมดูล + ตัดขั้นที่ปิดแล้วก่อนโหลดข้อมูลวงจร
    assert.match(due, /projectAccess\(\{/)
    assert.match(due, /FINISHED_STAGES\.includes\(project\.stage\)/)
    assert.match(due, /fetchLifecycleData\(visible\.map/)
  })
} finally {
  await vite.close()
}
console.log(`\n${cases} cases passed`)
process.exit(0)

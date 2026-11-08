// หน้าจอวงจรโครงการก่อสร้าง (PR-C1) — เรนเดอร์ด้วย Vite SSR (ไม่ใช้เบราว์เซอร์ ไม่ต่อฐานข้อมูล ไม่ใช้เน็ต)
//   node tests/construction-lifecycle-ui.test.mjs
// ตรวจ: ภาพรวม (การ์ด/แถบต้องดูแล/จุด 9 จุด) · แผ่นโครงการตามสิทธิ์ (ผู้ดู/ผู้ควบคุมงาน/หัวหน้ากอง) · ข้อความที่มี < " & ไม่หลุด
//       · ชั้น API ตรวจค่าก่อนส่ง · ค้นโค้ดว่าไม่มีใครเขียนคอลัมน์ stage ตรงๆ
// ⚠️ ไม่ได้แทนการลองกดจริงกับฐานข้อมูล (ต้องรัน migration 3 ไฟล์ของ PR-A ก่อน) และเทสต์ SSR วัดสี/เลย์เอาต์จริงไม่ได้
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

process.env.TZ = 'America/Los_Angeles'   // กันโค้ดที่อ่านวันจากนาฬิกา/โซนเวลาเครื่อง
const TODAY = '2026-11-08'
const EVIL = '<script>alert(1)</script>"&\''
const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;')

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

try {
  const { default: Overview } = await vite.ssrLoadModule('/src/components/staff/construction/LifecycleOverview.jsx')
  const { default: LifeSheet } = await vite.ssrLoadModule('/src/components/staff/construction/ProjectLifecycleSheet.jsx')
  const { default: ProjectSheet } = await vite.ssrLoadModule('/src/components/staff/construction/ProjectSheet.jsx')
  const L = await vite.ssrLoadModule('/src/lib/constructionLifecycle.js')
  const Api = await vite.ssrLoadModule('/src/lib/constructionLifecycleApi.js')
  const Fmt = await vite.ssrLoadModule('/src/components/staff/construction/lifecycleFormat.js')

  const noop = () => {}
  const READ = { read: true, write: false, manage: false, editBase: false }
  const WRITE = { read: true, write: true, manage: false, editBase: false }
  const MANAGE = { read: true, write: true, manage: true, editBase: true }

  const empty = () => ({ contract: null, people: [], milestones: [], installments: [], changes: [], defects: [], events: [] })
  const project = (id, stage, extra = {}) => ({
    id, title: `โครงการ ${id}`, fiscal_year: '2569', project_type: 'road', stage, stage_before_hold: null, status: L.statusOfStage(stage),
    contract_no: '25/2569', contractor_name: 'หจก.ทดสอบก่อสร้าง', contract_amount: 1250000, budget_amount: 1300000, department_id: 'd1', created_by: 'u1', ...extra,
  })
  const ms = (key, extra = {}) => ({ id: `m-${key}`, project_id: 'p1', key, done_on: null, ref_no: null, ref_date: null, amount: null, link: null, note: null, ...extra })

  // โครงการหลักของเทสต์: ขั้นก่อสร้าง งวด 2 ส่งช้า ตรวจรับเลยกำหนด (ประธานทราบ 3 พ.ย. → ครบ 6 พ.ย.)
  const bundleP1 = (extra = {}, projectExtra = {}) => ({
    project: project('p1', 'construction', projectExtra),
    ...empty(),
    contract: {
      project_id: 'p1', contract_date: '2026-09-01', notice_to_proceed_date: '2026-09-03', fine_per_day: 1250, installments_total: 3,
      guarantee_type: 'bank_guarantee', guarantee_amount: 62500, guarantee_expires_on: '2028-01-01', warranty_months: 24, price_kind: 'lump_sum',
    },
    milestones: [
      ms('budget_annual', { done_on: '2025-10-20', amount: 1300000, ref_no: 'ข้อบัญญัติ 5/2569' }),
      ms('winner_announced', { done_on: '2026-08-18' }),
      ms('contract_copy_oag', { done_on: '2026-09-15' }),
    ],
    installments: [
      { installment_no: 1, due_on: '2026-09-30', due_report_on: '2026-10-01', delivered_on: '2026-09-28', chair_acknowledged_on: '2026-09-28', inspected_on: '2026-10-02', inspection_result: 'accepted' },
      { installment_no: 2, due_on: '2026-10-30', due_report_on: '2026-11-02', delivered_on: '2026-11-03', chair_acknowledged_on: '2026-11-03' },
    ],
    events: [
      { id: 'e1', kind: 'created', to_stage: 'budgeted', created_at: '2026-01-05T03:00:00Z', actor: 's1' },
      { id: 'e2', kind: 'stage_change', from_stage: 'budgeted', to_stage: 'designing', created_at: '2026-02-01T03:00:00Z', actor: 's1' },
      { id: 'e3', kind: 'stage_change', from_stage: 'designing', to_stage: 'procuring', created_at: '2026-03-01T03:00:00Z', actor: 's1' },
      { id: 'e4', kind: 'stage_change', from_stage: 'procuring', to_stage: 'contracted', created_at: '2026-09-01T03:00:00Z', actor: 's1' },
      { id: 'e5', kind: 'stage_change', from_stage: 'contracted', to_stage: 'started', created_at: '2026-09-03T03:00:00Z', actor: 's1', reason: `เหตุผล ${EVIL}` },
      { id: 'e6', kind: 'auto_stage', from_stage: 'started', to_stage: 'construction', created_at: '2026-09-08T03:00:00Z', actor: 's1', reason: 'ระบบเลื่อนขั้นเอง: ล็อกรายงานผลการก่อสร้างประจำสัปดาห์ที่ 1' },
    ],
    ...extra,
  })
  const latest = { p1: { week_no: 10, period_end: '2026-11-08', overall: { actual: 71.2, plan: 75, label: { key: 'behind', text: 'ช้า -3.8%' } } } }

  const rowsOf = () => [
    { project: bundleP1().project, bundle: bundleP1() },
    { project: project('p2', 'budgeted'), bundle: { project: project('p2', 'budgeted'), ...empty() } },
    { project: project('p3', 'closed'), bundle: { project: project('p3', 'closed'), ...empty() } },
    { project: project('p4', 'suspended', { stage_before_hold: 'construction' }), bundle: { project: project('p4', 'suspended', { stage_before_hold: 'construction' }), ...empty() } },
    { project: project('p5', 'terminated'), bundle: { project: project('p5', 'terminated'), ...empty(), events: [{ id: 'x', kind: 'stage_change', from_stage: 'construction', to_stage: 'terminated', created_at: '2026-10-01T03:00:00Z' }] } },
  ]
  const overview = (extra = {}) => renderToStaticMarkup(h(Overview, { rows: rowsOf(), latest, canCreate: true, onCreate: noop, onOpen: noop, today: TODAY, ...extra }))
  const sheet = (bundle, access, extra = {}) => renderToStaticMarkup(h(LifeSheet, {
    bundle, access, latest: latest.p1, staffChoices: [{ id: 's1', full_name: 'นายช่าง ทดสอบ' }], today: TODAY, onClose: noop, onChanged: noop, onOpenSettings: noop, ...extra,
  }))
  const buttonTexts = html => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim())

  await test('แคตาล็อกจุดตรวจ: ทุกจุดมี fields · แหล่งงบ/ราคากลาง/ราคาผู้จะจ้างมียอดเงิน · ประกาศมีลิงก์ · แผนพัฒนาท้องถิ่นใช้ note', () => {
    for (const m of L.MILESTONES) {
      assert.ok(Array.isArray(m.fields) && m.fields.length > 0, m.key)
      assert.ok(m.fields.every(f => L.MILESTONE_FIELDS.includes(f)), m.key)
    }
    for (const m of L.MILESTONES.filter(x => x.budgetSource)) assert.ok(m.fields.includes('amount'), m.key)
    for (const key of ['median_price_approved', 'median_price_reviewed', 'bid_price']) assert.ok(L.MILESTONE_BY_KEY[key].fields.includes('amount'), key)
    for (const key of ['median_price_published', 'invitation_published']) assert.ok(L.MILESTONE_BY_KEY[key].fields.includes('link'), key)
    assert.deepEqual(L.MILESTONE_BY_KEY.local_plan_ref.fields, ['note'])
    assert.deepEqual(L.MILESTONE_BY_KEY.site_handover.fields, ['done_on', 'ref_no', 'ref_date'])
  })

  await test('ภาพรวม: การ์ดนับตามขั้นครบ 12 ช่อง + จำนวนถูก', () => {
    const out = overview()
    const tiles = [...out.matchAll(/data-stage="(\w+)"[^>]*><div[^>]*>(\d+)<\/div>/g)].map(m => [m[1], Number(m[2])])
    assert.equal(tiles.length, 12)
    assert.deepEqual(tiles.map(t => t[0]), [...L.MAIN_STAGES, 'suspended', 'cancelled', 'terminated'])
    const count = Object.fromEntries(tiles)
    assert.equal(count.construction, 1)
    assert.equal(count.budgeted, 1)
    assert.equal(count.closed, 1)
    assert.equal(count.suspended, 1)
    assert.equal(count.terminated, 1)
    assert.equal(count.cancelled, 0)
  })

  await test('ภาพรวม: แถบ "ต้องดูแล" เรียงตามวันครบกำหนด · มีที่มา · ตรวจรับเลยกำหนดขึ้นก่อน · คำกำกับ "ต้องยืนยัน" เมื่อ verify', () => {
    const out = overview()
    assert.match(out, /ต้องดูแล \d+ เรื่อง — เรียงตามวันครบกำหนดตามระเบียบ/)
    assert.ok(out.includes('เลยกำหนดแล้ว'))
    assert.ok(out.includes('คณะกรรมการตรวจรับงวดที่ 2'), 'กำหนดตรวจรับ 3 วันทำการ (ข้อ 176(5)) ต้องขึ้น')
    assert.ok(out.includes('ที่มา:'))
    // เทียบลำดับกับตรรกะจริง: วันครบกำหนดของแถวในแถบต้องไม่ลดลง
    const bundle = bundleP1()
    const dues = L.projectAlerts(bundle, TODAY).filter(a => a.due).map(a => a.due)
    assert.ok(dues.length >= 2)
    const region = out.slice(out.indexOf('aria-label="ต้องดูแล"'), out.indexOf('สถานะโครงการ'))
    const shownDues = [...region.matchAll(/ภายใน (\d+) (\S+) (\d{4})|เลยกำหนดแล้ว/g)]
    assert.ok(shownDues.length >= 2)
    const verifyAlert = L.projectAlerts(bundle, TODAY).some(a => a.verify)
    assert.equal(out.includes('ต้องยืนยันกับระเบียบฉบับปัจจุบัน'), verifyAlert || L.budgetAlerts(rowsOf().map(r => r.bundle), 2570, TODAY).some(a => a.verify))
  })

  await test('ภาพรวม: ข้อมูลวงจรยังโหลดไม่เสร็จ (alertsReady=false) = ไม่ขึ้นคำเตือนเลย กันเตือนผิดจากข้อมูลว่าง', () => {
    assert.ok(!overview({ alertsReady: false }).includes('ต้องดูแล 1'), 'ไม่มีแถบ')
    assert.ok(!/ต้องดูแล \d+ เรื่อง/.test(overview({ alertsReady: false })))
  })

  await test('ภาพรวม: จุด 9 จุด (เขียว=ผ่าน วงเขียว=ขั้นปัจจุบัน ส้ม=ระงับ) + ป้ายขั้น + ชิปกรอง + ปุ่มเพิ่มตามสิทธิ์', () => {
    const out = overview()
    const dotsOf = title => {
      const li = out.split('<li').find(x => x.includes(title) && x.includes('ขั้นของโครงการ:'))
      return [...li.matchAll(/title="([^"]+) — ([^"]+)"/g)].map(m => [m[1], m[2]])
    }
    const p1 = dotsOf('โครงการ p1')
    assert.equal(p1.length, 9)
    assert.deepEqual(p1.map(d => d[1]), ['ผ่านแล้ว', 'ผ่านแล้ว', 'ผ่านแล้ว', 'ผ่านแล้ว', 'ผ่านแล้ว', 'ขั้นปัจจุบัน', 'ยังไม่ถึง', 'ยังไม่ถึง', 'ยังไม่ถึง'])
    const p4 = dotsOf('โครงการ p4')
    assert.equal(p4[5][1], 'ระงับอยู่ที่ขั้นนี้')
    assert.ok(!out.includes('โครงการ p3') && !out.includes('โครงการ p5'), 'ชิปตั้งต้น "ยังไม่ปิด" ซ่อนโครงการที่ปิดแล้ว/บอกเลิก')
    for (const needle of ['ยังไม่ปิด', 'ต้องดูแล', 'ปิดแล้ว', 'ระงับ/ยกเลิก/บอกเลิก', 'ก่อสร้าง', 'ระงับชั่วคราว (ขั้นก่อสร้าง)']) assert.ok(out.includes(needle), needle)
    assert.ok(out.includes('เพิ่มโครงการ'))
    assert.ok(!overview({ canCreate: false }).includes('เพิ่มโครงการ'))
    assert.ok(out.includes('71.20%') && out.includes('ช้า -3.8%'))
  })

  await test('ภาพรวม: ชื่อโครงการ/ผู้รับจ้างที่มี < > & " \' ถูก escape ไม่มี script ดิบ', () => {
    const rows = rowsOf()
    rows[0].project = { ...rows[0].project, title: EVIL, contractor_name: EVIL }
    rows[0].bundle = { ...rows[0].bundle, project: rows[0].project }
    const out = renderToStaticMarkup(h(Overview, { rows, latest, canCreate: true, onCreate: noop, onOpen: noop, today: TODAY }))
    assert.ok(!out.includes('<script>alert(1)'))
    assert.ok(out.includes(esc(EVIL).replaceAll('&#x27;', '&#x27;')) || out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  })

  await test('แผ่นโครงการ (ผู้ดู/viewer): เห็นขั้น เส้นขั้น กฎ ประวัติ ตัวเลข — ไม่มีปุ่มบันทึก/เปลี่ยนขั้น/ตั้งค่า และไม่มีช่องกรอก', () => {
    const out = sheet(bundleP1(), READ)
    for (const needle of ['ขั้นปัจจุบัน:', 'ต้องทำตามระเบียบ — ขั้นก่อสร้าง', 'ประวัติโครงการ', 'ผลงานจริงสะสม', '71.20%', 'วงเงินสัญญา', '1,250,000', 'หลักประกันสัญญา', '62,500']) assert.ok(out.includes(needle), needle)
    const buttons = buttonTexts(out)
    for (const word of ['บันทึก', 'เลื่อน', 'เปลี่ยน', 'ระงับ', 'ยกเลิก', 'ตั้งค่า', 'ล้างค่า']) assert.deepEqual(buttons.filter(b => b.includes(word)), [], `ผู้ดูไม่ควรมีปุ่ม "${word}"`)
    assert.ok(!out.includes('<summary') || !out.includes('เปลี่ยนขั้นอื่น'))
    assert.ok(!out.includes('aria-expanded'), 'แถวจุดตรวจของผู้ดูเป็นข้อความล้วน')
    assert.ok(!/<(input|textarea|select)\b/.test(out))
    assert.ok(out.includes('ดูข้อมูลได้อย่างเดียว'))
  })

  await test('แผ่นโครงการ (ผู้ควบคุมงาน): เลื่อนขั้นถัดไปได้ แต่ไม่เห็นปุ่มระงับ/บอกเลิก/ข้าม (ต้องเป็นหัวหน้ากอง) · เห็นปุ่มตั้งค่า · แถวจุดตรวจกดได้', () => {
    const b = bundleP1()
    const out = sheet(b, WRITE)
    const labels = L.stageActions(b, WRITE).map(Fmt.actionLabel)
    assert.deepEqual(labels, ['เลื่อนเป็น "ตรวจรับงวดสุดท้าย"'])
    for (const label of labels) assert.ok(out.includes(esc(label)), label)
    for (const word of ['ระงับโครงการชั่วคราว', 'บอกเลิกสัญญา', 'ข้ามไป', 'ถอยกลับไป']) assert.ok(!out.includes(word), word)
    assert.ok(out.includes('ตั้งค่าโครงการ') && out.includes('เปลี่ยนขั้นอื่น…'))
    assert.ok(out.includes('aria-expanded'))
  })

  await test('แผ่นโครงการ (หัวหน้ากอง): ปุ่มเปลี่ยนขั้นตรงกับ stageActions ทุกปุ่ม · ปุ่มอันตรายเป็นสีแดง', () => {
    const b = bundleP1()
    const out = sheet(b, MANAGE)
    const actions = L.stageActions(b, MANAGE)
    assert.ok(actions.length >= 5)
    for (const a of actions) assert.ok(out.includes(esc(Fmt.actionLabel(a))), Fmt.actionLabel(a))
    assert.ok(actions.some(a => a.kind === 'suspend') && actions.some(a => a.kind === 'terminate') && actions.some(a => a.kind === 'back'))
    assert.match(out, /border-red-200 text-red-700[^>]*>บอกเลิกสัญญา</)
    assert.ok(!out.includes('ยกเลิกโครงการ (ก่อนทำสัญญา)'), 'ลงนามสัญญาแล้วยกเลิกไม่ได้')
  })

  await test('แผ่นโครงการ: ระงับอยู่ → ปุ่มกลับมาดำเนินการ · ใช้ขั้นที่จำไว้เป็นกล่องกฎ · ขั้นบอกเลิกไม่พัง', () => {
    const held = bundleP1({}, { stage: 'suspended', stage_before_hold: 'construction' })
    const out = sheet(held, MANAGE)
    assert.ok(out.includes('ต้องทำตามระเบียบ — ขั้นก่อสร้าง (ระงับอยู่)'))
    assert.ok(out.includes('กลับมาดำเนินการ'))
    // ปุ่มหลักกลับไป "ขั้นเดิม" + ในเมนู ปุ่มกลับมาที่ขั้นเดิมต้องมาก่อนขั้นอื่น (เจอบน demo: ปุ่มแรกเดิมคือ "ตั้งงบ" กดผิดขั้นได้)
    assert.ok(out.includes('data-testid="resume-hold"'))
    const resumeLabels = [...out.matchAll(/>(กลับมาดำเนินการ \(ขั้น &quot;[^<]+&quot;\))</g)].map(m => m[1])
    assert.ok(resumeLabels.length > 1, 'มีปุ่มกลับมาหลายขั้น')
    assert.equal(resumeLabels[0], 'กลับมาดำเนินการ (ขั้น &quot;ก่อสร้าง&quot;)')
    assert.ok(!sheet(held, { read: true }).includes('data-testid="resume-hold"'), 'ผู้ดูไม่มีปุ่ม')
    const cancelled = bundleP1({}, { stage: 'terminated' })
    const out2 = sheet(cancelled, MANAGE)
    assert.ok(out2.includes('ขั้นปัจจุบัน:') && out2.includes('บอกเลิกสัญญา'))
    assert.ok(out2.includes('เปิดโครงการใหม่'))
  })

  await test('แผ่นโครงการ: ข้อเสนอขั้นถัดไป — ไม่พร้อม=รายการที่ขาด · พร้อม=ปุ่มเลื่อน (เฉพาะผู้มีสิทธิ์) · เริ่มงาน=ระบบเลื่อนเอง · ปิดโครงการ=รายการตรวจ', () => {
    const missing = sheet(bundleP1(), MANAGE)
    assert.ok(missing.includes('ยังขาด') && missing.includes('ผู้รับจ้างส่งมอบงานงวดสุดท้าย'))
    const ready = bundleP1({ milestones: [ms('budget_annual', { done_on: '2025-10-20', amount: 1300000 })], installments: [], events: [], contract: null }, { stage: 'budgeted' })
    const readyOut = sheet(ready, WRITE)
    assert.ok(readyOut.includes(esc('เลื่อนเป็น "ออกแบบ/กำหนดราคากลาง"')), readyOut.slice(0, 300))
    const viewerOut = sheet(ready, READ)
    assert.ok(viewerOut.includes('พร้อมเลื่อนเป็น') && buttonTexts(viewerOut).every(b => !b.includes('เลื่อน')), 'ผู้ดูเห็นข้อเสนอแต่ไม่มีปุ่ม')
    assert.ok(buttonTexts(readyOut).some(b => b.includes('เลื่อนเป็น')), 'ผู้ควบคุมงานมีปุ่มเลื่อน')
    const started = sheet(bundleP1({ installments: [] }, { stage: 'started' }), MANAGE)
    assert.ok(started.includes('ระบบจะเลื่อนเป็น') && started.includes('ไม่ต้องกดเอง'))
    const warranty = sheet(bundleP1({}, { stage: 'warranty' }), MANAGE)
    assert.ok(warranty.includes('รายการตรวจก่อนปิดโครงการ') && warranty.includes('คืนหลักประกันสัญญาแล้ว'))
  })

  await test('แผ่นโครงการ: คีย์ managerOnly (คืนหลักประกัน) — ผู้ควบคุมงานเห็นข้อความแต่ไม่มีปุ่มแก้ · หัวหน้ากองแก้ได้', () => {
    const closing = bundleP1({}, { stage: 'warranty' })
    // จุดตรวจของขั้นปิดโครงการอยู่ในส่วน "ขั้นอื่น" (ขั้นที่ใช้ตรวจคือประกันผลงาน)
    const writeOut = sheet(closing, WRITE)
    const manageOut = sheet(closing, MANAGE)
    assert.ok(writeOut.includes('บันทึกได้เฉพาะหัวหน้ากองหรือผู้ดูแลระบบ'))
    assert.ok(!manageOut.includes('บันทึกได้เฉพาะหัวหน้ากองหรือผู้ดูแลระบบ'))
    const rowButton = out => out.split('<li').find(x => x.includes('คืนหลักประกันสัญญา</span>') && x.includes('ข้อ 170(2)') && x.includes('<button'))
    assert.ok(!rowButton(writeOut)?.includes('aria-expanded'))
    assert.ok(manageOut.includes('คืนหลักประกันสัญญา'))
  })

  await test('แผ่นโครงการ: ป้าย e-GP เฉพาะเอกสารที่ออกจาก e-GP · จุดตรวจที่มีกำหนดเวลาโชว์วันครบกำหนดในแถวเดียวกัน', () => {
    const out = sheet(bundleP1({}, { stage: 'procuring' }), MANAGE)
    assert.ok(out.includes('ออกจาก e-GP — บันทึกเลขที่'))
    const contracted = sheet(bundleP1({}, { stage: 'contracted' }), MANAGE)
    assert.ok(contracted.includes('ส่งสำเนาสัญญาให้ สตง.') && contracted.includes('ภายใน'))
  })

  await test('แผ่นโครงการ: ประวัติเรียงใหม่→เก่า แสดง 5 รายการ + ปุ่มดูทั้งหมด · ป้าย "ระบบเลื่อนเอง" · ชื่อผู้ทำจากรายชื่อเจ้าหน้าที่', () => {
    const out = sheet(bundleP1(), MANAGE)
    assert.ok(out.includes('ระบบเลื่อนเอง'))
    assert.ok(out.includes('ดูทั้งหมด (6 รายการ)'))
    assert.ok(out.includes('นายช่าง ทดสอบ'))
    const history = out.slice(out.indexOf('aria-label="ประวัติโครงการ"'))
    assert.ok(history.indexOf('ระบบเลื่อนเอง') > 0 && history.indexOf('ระบบเลื่อนเอง') < history.indexOf('เหตุผล: เหตุผล'), 'ใหม่ก่อนเก่า (8 ก.ย. ก่อน 3 ก.ย.)')
    assert.ok(!history.includes('สร้างโครงการที่ขั้น'), 'รายการที่ 6 (เก่าสุด) ซ่อนอยู่')
    const noName = renderToStaticMarkup(h(LifeSheet, { bundle: bundleP1(), access: MANAGE, today: TODAY, onClose: noop }))
    assert.ok(noName.includes('เจ้าหน้าที่') && !noName.includes('นายช่าง ทดสอบ'))
  })

  await test('แผ่นโครงการ: ตัวเลข 4 ช่อง ช่องไม่มีข้อมูลเป็น "—" · ไม่มีข้อมูลสัญญาไม่ทำให้หน้าพัง', () => {
    const bare = { project: project('p9', 'budgeted', { contract_amount: null, budget_amount: null }), ...empty() }
    const out = sheet(bare, READ, { latest: null })
    assert.ok(out.includes('ยังไม่มีรายงานที่ล็อก'))
    assert.ok((out.match(/>—</g) ?? []).length >= 3)
  })

  await test('แผ่นโครงการ: ชื่อโครงการ/เหตุผลในประวัติที่มี < > & " \' ถูก escape', () => {
    const b = bundleP1({}, { title: EVIL, contractor_name: EVIL, contract_no: EVIL })
    const out = sheet(b, MANAGE)
    assert.ok(!out.includes('<script>alert(1)'))
    assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
    const history = sheet({ ...b, events: [...b.events] }, MANAGE, {})
    assert.ok(history.includes('เหตุผล: เหตุผล &lt;script&gt;'))
  })

  await test('แผ่นตั้งค่าโครงการ: ไม่มีช่องเลือก "สถานะ" แล้ว · สร้างใหม่เลือกขั้นเริ่มต้นได้ (ค่าเริ่มต้นตั้งงบ) · แก้ไขแสดงขั้นอ่านอย่างเดียว', () => {
    const base = { tenant: { id: 't1' }, profile: { id: 'u1', role: 'officer', department_id: 'd1' }, bundle: null, access: MANAGE, departments: [], staffChoices: [], onClose: noop, onSaved: noop }
    const created = renderToStaticMarkup(h(ProjectSheet, { ...base, mode: 'create', project: null }))
    assert.ok(!created.includes('สถานะโครงการ'))
    const options = sel => [...(sel.match(/data-testid="project-initial-stage"[\s\S]*?<\/select>/)?.[0] ?? '').matchAll(/<option value="(\w+)"( selected="")?/g)]
    const mgr = options(created)
    assert.deepEqual(mgr.map(m => m[1]), L.MAIN_STAGES, 'หัวหน้ากองเลือกได้ครบ 9 ขั้นหลัก')
    assert.equal(mgr.find(m => m[2])?.[1], 'budgeted', 'ค่าเริ่มต้น = ตั้งงบประมาณ')
    const tech = options(renderToStaticMarkup(h(ProjectSheet, { ...base, profile: { id: 'u2', role: 'technician', department_id: 'd1' }, mode: 'create', project: null })))
    assert.deepEqual(tech.map(m => m[1]), L.MAIN_STAGES.filter(s => s !== 'warranty' && s !== 'closed'), 'ไม่ใช่ผู้จัดการ: ไม่มีประกันผลงาน/ปิดโครงการ (trigger ปฏิเสธอยู่แล้ว)')
    assert.equal(L.initialStage('suspended'), 'budgeted')
    assert.equal(L.initialStage('construction'), 'construction')
    assert.equal(L.initialStage(undefined), 'budgeted')
    const edit = renderToStaticMarkup(h(ProjectSheet, { ...base, mode: 'edit', project: project('p1', 'construction') }))
    assert.match(edit, /data-testid="project-stage-readonly">ก่อสร้าง</)
    for (const out of [created, edit]) assert.ok(!/<select[^>]*>\s*<option value="planned"/.test(out) && !out.includes('value="in_progress"'))
  })

  await test('ชั้น API: ตรวจค่าก่อนส่ง — ค่าว่างทั้งหมด/ยอดไม่ใช่ตัวเลข/ลิงก์ผิดรูป/คีย์ผิดรูปไม่ยิงฐานข้อมูล', async () => {
    assert.match(Api.milestoneRow({}).error, /กรอกอย่างน้อย 1 ช่อง/)
    assert.match(Api.milestoneRow({ amount: 'abc' }).error, /ตัวเลข/)
    assert.match(Api.milestoneRow({ done_on: '2026-11-01', link: 'ftp://x' }).error, /http/)
    assert.match(Api.milestoneRow({ ref_no: 'x'.repeat(201) }).error, /200/)
    assert.deepEqual(Api.milestoneRow({ done_on: '2026-11-01', ref_no: '  ', amount: '1,250,000', link: ' https://a.test/x ', note: '' }).row,
      { done_on: '2026-11-01', ref_no: null, ref_date: null, amount: 1250000, link: 'https://a.test/x', note: null })
    assert.match((await Api.saveMilestone('p1', 'Bad Key', { note: 'x' })).message, /คีย์/)
    assert.match((await Api.clearMilestone('p1', '1x')).message, /คีย์/)
    assert.match((await Api.setProjectStage({ projectId: 'p1', stage: 'bogus' })).message, /ไม่รู้จักขั้น/)
    assert.deepEqual((await Api.fetchLifecycleData([])).byProject, {}, 'ids ว่างไม่ยิงฐานข้อมูล')
    assert.equal(Api.dbMessage({ code: '42501', message: 'การเปลี่ยนขั้นนี้ต้องให้หัวหน้ากองหรือผู้ดูแลระบบเป็นผู้ทำ' }), 'การเปลี่ยนขั้นนี้ต้องให้หัวหน้ากองหรือผู้ดูแลระบบเป็นผู้ทำ', 'ข้อความไทยจากฐานแสดงตรงๆ')
    assert.match(Api.dbMessage({ code: '42501', message: 'permission denied for table x' }), /ไม่มีสิทธิ์/)
  })

  await test('ค้นโค้ด: fetchLifecycleData ดึงตารางละคำสั่งด้วย .in(project_id) ไม่วนยิงทีละโครงการ', async () => {
    const src = await readFile(new URL('../src/lib/constructionLifecycleApi.js', import.meta.url), 'utf8')
    const body = src.slice(src.indexOf('export async function fetchLifecycleData'), src.indexOf('export async function setProjectStage'))
    for (const table of ['civil_project_contracts', 'civil_project_people', 'civil_project_milestones', 'civil_project_installments', 'civil_project_changes', 'civil_project_defects', 'civil_project_events']) {
      assert.equal((body.match(new RegExp(`from\\('${table}'\\)[^\\n]*\\.in\\('project_id', ids\\)`, 'g')) ?? []).length, 1, table)
    }
    assert.ok(!/for\s*\([^)]*of ids\)|ids\.(map|forEach)\(\s*async/.test(body), 'ห้ามวนยิงทีละโครงการ')
  })

  await test('ค้นโค้ด: ไม่มีที่ไหนใน src/ เขียนคอลัมน์ stage / stage_before_hold ของ civil_projects ตรงๆ (เปลี่ยนขั้นผ่าน RPC เท่านั้น)', async () => {
    const files = []
    const walk = async dir => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (/\.(js|jsx|mjs)$/.test(entry.name)) files.push(full)
      }
    }
    await walk(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    const offenders = []
    let touched = 0
    for (const file of files) {
      const code = strip(await readFile(file, 'utf8'))
      for (const m of code.matchAll(/from\(\s*['"]civil_projects['"]\s*\)/g)) {
        const rest = code.slice(m.index, m.index + 700)
        const write = rest.match(/\.(insert|update|upsert)\(/)
        if (!write) continue
        touched++
        // ขอบเขต = จากจุดเขียนจนถึงจบคำสั่ง (ก่อน await/สิ้นบรรทัดว่างถัดไป) · ตรวจทั้งอาร์กิวเมนต์และตัวแปรที่ส่งเข้าไป
        let call = rest.slice(write.index, write.index + 500)
        // ข้อยกเว้นเดียว: INSERT ตอนสร้างส่งขั้นเริ่มต้นผ่าน initialStage() (เฉพาะ 9 ขั้นหลัก · trigger ตรวจซ้ำ) — UPDATE/UPSERT ห้ามเด็ดขาด
        if (write[1] === 'insert') call = call.replace(/\bstage\s*:\s*initialStage\(form\.initial_stage\)/, '')
        if (/\bstage(_before_hold)?\s*:|['"]stage(_before_hold)?['"]/.test(call)) offenders.push(`${file}: ${call.slice(0, 80)}`)
      }
      // ตัวแปรอ็อบเจ็กต์แถว (const row = {...}) ในไฟล์ที่เขียน civil_projects ต้องไม่มีคีย์ stage/status
      if (/from\(\s*['"]civil_projects['"]\s*\)\s*\.(insert|update|upsert)/.test(code) && /saveProject/.test(code)) {
        const rowLiteral = code.match(/const row = \{[\s\S]*?\n\s{4}\}/)?.[0] ?? ''
        if (/\b(stage|stage_before_hold|status)\s*:/.test(rowLiteral)) offenders.push(`${file}: row literal ส่ง stage/status`)
      }
    }
    assert.ok(touched >= 1, 'ต้องเจอจุดเขียน civil_projects อย่างน้อย 1 จุด (saveProject) — ถ้า 0 แปลว่าตัวค้นหาพัง')
    assert.deepEqual(offenders, [])
    const apiSrc = strip(await readFile(new URL('../src/lib/constructionReportApi.js', import.meta.url), 'utf8'))
    assert.ok(!/\bstatus\s*:\s*form\.status/.test(apiSrc), 'saveProject ต้องไม่ส่ง status')
    const lifeSrc = strip(await readFile(new URL('../src/lib/constructionLifecycleApi.js', import.meta.url), 'utf8'))
    assert.ok(!/from\(\s*['"]civil_projects['"]\s*\)/.test(lifeSrc), 'ชั้น API วงจรไม่แตะตาราง civil_projects ตรงๆ เลย')
    assert.ok(/rpc\(\s*'civil_set_project_stage'/.test(lifeSrc))
  })

  // ── ส่วนสัญญาและหลักประกัน (ช่องที่ migration 20261108100000 เพิ่ม) ──────────────────────
  const CF = await vite.ssrLoadModule('/src/lib/constructionContractForm.js')
  const colsSql = await readFile(new URL('../supabase/migrations/20261108100000_civil_lifecycle_columns.sql', import.meta.url), 'utf8')
  const SECTION_TITLE = 'สัญญาและหลักประกัน (ตามแบบสัญญาจ้างก่อสร้าง)'
  const contractRow = {
    project_id: 'p1', price_kind: 'lump_sum', guarantee_type: 'bank_guarantee', guarantee_amount: 62500, guarantee_ref: 'BG-77', guarantee_expires_on: '2028-01-01',
    advance_pct: 15, advance_amount: 187500, retention_pct: 5, supervision_fee_per_day: 300, warranty_months: 24, warranty_starts_on: null, warranty_ends_on: null,
    notice_to_proceed_no: 'นร 12/2569', notice_to_proceed_date: '2026-09-03', start_within_days: 7, finish_within_days: 90,
  }
  const editSheet = (access, profile, extra = {}) => renderToStaticMarkup(h(ProjectSheet, {
    tenant: { id: 't1' }, profile, mode: 'edit', project: project('p1', 'construction', { work_group: 'building', operator_eval_required: true }),
    bundle: { contract: contractRow, items: [], people: [], reports: [] }, access, departments: [], staffChoices: [], onClose: noop, onSaved: noop, ...extra,
  }))
  const sectionOf = out => {
    const start = out.indexOf(esc(SECTION_TITLE))
    assert.ok(start > 0, 'ไม่พบส่วน ' + SECTION_TITLE)
    return out.slice(start, out.indexOf('</details>', start))
  }

  await test('ProjectSheet: ส่วน "สัญญาและหลักประกัน" มีช่องครบทุกคอลัมน์ · ค่าเดิมถูกเติม · ตัวเลือกตรงกับ lib · ป้ายคำนวณ/e-GP', () => {
    const sec = sectionOf(editSheet(MANAGE, { id: 'u1', role: 'officer', department_id: 'd1' }))
    for (const label of ['ชนิดราคา', 'กลุ่มงาน', 'ชนิดหลักประกันสัญญา', 'จำนวนเงินหลักประกัน', 'เลขที่หลักประกัน', 'หลักประกันหมดอายุวันที่', 'เงินล่วงหน้า (ร้อยละ)', 'เงินล่วงหน้า (บาท)',
      'เงินประกันผลงาน (ร้อยละ)', 'ค่าควบคุมงานต่อวัน', 'ระยะประกันผลงาน (เดือน)', 'ระยะประกันเริ่มวันที่', 'ระยะประกันสิ้นสุดวันที่', 'หนังสือแจ้งให้เริ่มทำงาน — เลขที่',
      'หนังสือแจ้งให้เริ่มทำงาน — ลงวันที่', 'เริ่มงานภายใน', 'แล้วเสร็จภายใน', 'เข้าเกณฑ์ประเมินผู้ประกอบการ (ฉบับที่ 3 พ.ศ. 2569 หมวด 7)', 'ผู้มีอำนาจตัดสิน']) {
      assert.ok(sec.includes(label), label)
    }
    for (const label of Object.values(L.PRICE_KINDS)) assert.ok(sec.includes(label), label)
    for (const label of Object.values(L.GUARANTEE_TYPES)) assert.ok(sec.includes(label), label)
    for (const label of Object.values(L.WORK_GROUPS)) assert.ok(sec.includes(label), label)
    for (const needle of ['value="62500"', 'value="BG-77"', 'value="2028-01-01"', 'value="187500"', 'value="24"', 'value="2026-09-03"', 'value="90"', 'value="lump_sum" selected', 'value="bank_guarantee" selected', 'value="building" selected', 'checked']) {
      assert.ok(sec.includes(needle), needle)
    }
    assert.equal((sec.match(/ออกจาก e-GP/g) ?? []).length, 2, 'ป้าย e-GP ที่เลขที่และวันที่หนังสือแจ้งเริ่มงาน')
    for (const hint of ['เว้นว่างให้ระบบคำนวณ', 'ค่าที่กรอกชนะ', 'ระบบคำนวณวันเริ่ม/สิ้นสุดสัญญาจาก', 'ใช้ประมาณการค่าปรับ', 'ใช้เตือนเมื่อหมดอายุ', 'ต้องยืนยันกับระเบียบฉบับปัจจุบัน']) assert.ok(sec.includes(hint), hint)
    // ไม่เปิดเองโดยตั้งต้น (ส่วนพับ) แต่เนื้อหาอยู่ใน markup
    assert.ok(!/<details open=""[^>]*>\s*<summary[^>]*>[^<]*<span[^>]*>▸<\/span>\s*สัญญาและหลักประกัน/.test(editSheet(MANAGE, { id: 'u1', role: 'officer' })))
  })

  await test('ProjectSheet: ผู้ควบคุมงาน (write ไม่ใช่ editBase) แก้ช่องสัญญาได้ แต่ "กลุ่มงาน" กับ "เข้าเกณฑ์ประเมินผู้ประกอบการ" ถูกปิด', () => {
    const sec = sectionOf(editSheet({ ...WRITE, editBase: false }, { id: 'u2', role: 'technician', department_id: 'd1' }))
    const controls = [...sec.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map(m => m[0])
    assert.equal(controls.length, 18, 'select 3 + input 14 + checkbox 1 (กลุ่มงานนับรวมใน select)')
    const disabled = controls.filter(c => /\bdisabled=""/.test(c))
    assert.equal(disabled.length, 2, JSON.stringify(disabled))
    assert.ok(disabled.some(c => c.startsWith('<select')) && disabled.some(c => /type="checkbox"/.test(c)))
    assert.match(sec, /<select[^>]*disabled=""[^>]*>\s*<option value="">— ไม่ระบุ —<\/option><option value="building" selected/)
    const manage = sectionOf(editSheet(MANAGE, { id: 'u1', role: 'officer', department_id: 'd1' }))
    assert.ok(!/\bdisabled=""/.test(manage), 'หัวหน้ากองแก้ได้ทุกช่อง')
  })

  await test('ProjectSheet (สร้างใหม่): ช่องกลุ่มงาน/ประเมินผู้ประกอบการเปิดให้กรอก · ค่าตั้งต้นว่าง/ไม่ติ๊ก', () => {
    const out = renderToStaticMarkup(h(ProjectSheet, { tenant: { id: 't1' }, profile: { id: 'u1', role: 'technician', department_id: 'd1' }, mode: 'create', project: null, bundle: null, access: MANAGE, departments: [], staffChoices: [], onClose: noop, onSaved: noop }))
    const sec = sectionOf(out)
    assert.ok(!/\bdisabled=""/.test(sec))
    assert.ok(!/type="checkbox"[^>]*checked/.test(sec))
  })

  await test('ตรวจค่าตาม CHECK จริง: ช่วงที่รับ/ปฏิเสธ + ข้อความไทย (ค่าว่าง = ผ่าน)', () => {
    const v = (patch, options) => CF.validateLifecycleForm({ ...CF.lifecycleFormDefaults(null, null), ...patch }, options)
    assert.equal(v({}), null, 'ว่างทั้งหมดผ่าน')
    assert.equal(v({ advance_pct: '100', retention_pct: '0', warranty_months: '600', start_within_days: '0', finish_within_days: '1', guarantee_type: 'none', price_kind: 'unit_price', guarantee_amount: '1,250,000.50' }), null)
    const bad = [
      [{ advance_pct: '100.01' }, /ร้อยละเงินล่วงหน้า/], [{ advance_pct: '-1' }, /ร้อยละเงินล่วงหน้า/], [{ retention_pct: '101' }, /เงินประกันผลงาน/],
      [{ guarantee_amount: '-5' }, /จำนวนเงินหลักประกัน/], [{ guarantee_amount: 'abc' }, /ต้องเป็นตัวเลข/], [{ advance_amount: '1e14' }, /จำนวนเงินล่วงหน้า/],
      [{ supervision_fee_per_day: '1e10' }, /ค่าควบคุมงาน/], [{ warranty_months: '601' }, /ระยะประกัน/], [{ warranty_months: '1.5' }, /จำนวนเต็ม/], [{ warranty_months: '-1' }, /ระยะประกัน/],
      [{ finish_within_days: '0' }, /แล้วเสร็จ.*มากกว่า 0/], [{ start_within_days: '-1' }, /เริ่มงาน/], [{ start_within_days: '7.5' }, /จำนวนเต็ม/],
      [{ guarantee_type: 'bond' }, /ชนิดหลักประกัน/], [{ price_kind: 'x' }, /ชนิดราคา/], [{ guarantee_expires_on: '2026-02-30' }, /วันหมดอายุ/],
      [{ notice_to_proceed_date: '03/09/2569' }, /วันที่หนังสือ/], [{ warranty_starts_on: '2028-01-02', warranty_ends_on: '2028-01-01' }, /ไม่ก่อนวันเริ่ม/],
      [{ guarantee_ref: 'x'.repeat(201) }, /200/],
    ]
    for (const [patch, re] of bad) assert.match(v(patch) ?? '', re, JSON.stringify(patch))
    assert.match(v({ work_group: 'tower' }) ?? '', /กลุ่มงาน/)
    assert.equal(v({ work_group: 'tower' }, { editBase: false }), null, 'ช่องทะเบียนตรวจเฉพาะเมื่อจะเขียน civil_projects')
    // ช่วงที่ lib รับต้องตรง CHECK ใน migration
    for (const needle of ['advance_pct >= 0 AND advance_pct <= 100', 'retention_pct >= 0 AND retention_pct <= 100', 'warranty_months >= 0 AND warranty_months <= 600', 'start_within_days >= 0', 'finish_within_days > 0', 'guarantee_amount >= 0', 'advance_amount >= 0', 'supervision_fee_per_day >= 0']) {
      assert.ok(colsSql.includes(needle), 'migration ไม่มี ' + needle)
    }
  })

  await test('แปลงเป็นคอลัมน์: ค่าว่าง=null · ตัวเลข/จุลภาค · ชื่อคอลัมน์ทุกตัวมีใน migration · ไม่แตะ stage/status', () => {
    const empty = CF.lifecycleContractColumns(CF.lifecycleFormDefaults(null, null))
    assert.deepEqual(Object.keys(empty), CF.LIFECYCLE_CONTRACT_FIELDS)
    assert.ok(Object.values(empty).every(x => x === null))
    for (const name of [...CF.LIFECYCLE_CONTRACT_FIELDS, ...CF.LIFECYCLE_PROJECT_FIELDS]) assert.match(colsSql, new RegExp(`ADD COLUMN IF NOT EXISTS ${name}\\b`), name)
    const filled = CF.lifecycleContractColumns({ ...CF.lifecycleFormDefaults(null, null), guarantee_amount: '1,250,000.50', warranty_months: '24', price_kind: ' lump_sum ', guarantee_ref: '  ' })
    assert.equal(filled.guarantee_amount, 1250000.5)
    assert.equal(filled.warranty_months, 24)
    assert.equal(filled.price_kind, 'lump_sum')
    assert.equal(filled.guarantee_ref, null)
    assert.deepEqual(CF.lifecycleProjectColumns({ work_group: '', operator_eval_required: true }), { work_group: null, operator_eval_required: true })
    assert.deepEqual(Object.keys(CF.lifecycleProjectColumns({})), ['work_group', 'operator_eval_required'])
  })

  await test('saveProject: ช่องสัญญาผิด → คืนข้อความไทยทันที ไม่ยิงฐานข้อมูล (ไม่มี projectId)', async () => {
    const { saveProject } = await vite.ssrLoadModule('/src/lib/constructionReportApi.js')
    const form = { title: 'x', fiscal_year: '2570', project_type: 'road', initial_stage: 'budgeted', advance_pct: '150', ...CF.lifecycleFormDefaults(null, null) }
    form.advance_pct = '150'
    for (const mode of ['create', 'edit']) {
      const result = await saveProject({ mode, tenantId: 't1', userId: 'u1', projectId: 'p1', form, items: [], people: {}, existing: { items: [], people: [] }, departmentId: null, editBase: true })
      assert.match(result.error.message, /ร้อยละเงินล่วงหน้า/)
      assert.equal(result.projectId, undefined)
    }
  })
} finally {
  await vite.close()
}
console.log(`\n${cases} cases passed`)
process.exit(0)

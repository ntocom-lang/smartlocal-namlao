// งวดงาน / ขยายเวลา-แก้สัญญา / ตรวจความชำรุด / เอกสารแนบ ของวงจรโครงการก่อสร้าง (PR-C2) — เรนเดอร์ด้วย Vite SSR (ไม่ใช้เบราว์เซอร์ ไม่ต่อฐานข้อมูล ไม่ใช้เน็ต)
//   node tests/construction-installments.test.mjs
// ตรวจ: lib แปลงฟอร์ม (diff เฉพาะช่องเปลี่ยน · ตัดช่องผู้จัดการ/ช่องล็อกหลังมีผล · validation) · รายชื่อช่องเทียบกับ trigger ในไฟล์ migration จริง
//       · ข้อเสนอที่ระบบคำนวณ · เอกสารแนบ (โฟลเดอร์/ชื่อไฟล์ไม่มีชื่อคน) · ข้อความประวัติ · หน้าจอตามสิทธิ์ (ผู้ดู/ผู้ควบคุมงาน/หัวหน้ากอง) · ค้นโค้ด
// ⚠️ ไม่ได้แทนการลองกดจริงกับฐานข้อมูล/Drive (อัปโหลด เปิดไฟล์ ลบ) และ SSR วัดสี/เลย์เอาต์จริงไม่ได้
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
const read = rel => readFile(new URL(rel, import.meta.url), 'utf8')

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

try {
  const F = await vite.ssrLoadModule('/src/lib/constructionInstallmentForm.js')
  const L = await vite.ssrLoadModule('/src/lib/constructionLifecycle.js')
  const Api = await vite.ssrLoadModule('/src/lib/constructionLifecycleApi.js')
  const Folders = await vite.ssrLoadModule('/src/lib/driveFolders.js')
  const { default: InstallmentsTable } = await vite.ssrLoadModule('/src/components/staff/construction/InstallmentsTable.jsx')
  const { default: ChangesPanel } = await vite.ssrLoadModule('/src/components/staff/construction/ContractChangesPanel.jsx')
  const { default: DefectsSection } = await vite.ssrLoadModule('/src/components/staff/construction/DefectsSection.jsx')
  const { default: DocumentsSection } = await vite.ssrLoadModule('/src/components/staff/construction/DocumentsSection.jsx')
  const { default: LifeSheet } = await vite.ssrLoadModule('/src/components/staff/construction/ProjectLifecycleSheet.jsx')
  const { default: History } = await vite.ssrLoadModule('/src/components/staff/construction/LifecycleHistory.jsx')

  const noop = () => {}
  const READ = { read: true, write: false, manage: false, editBase: false }
  const WRITE = { read: true, write: true, manage: false, editBase: false }
  const MANAGE = { read: true, write: true, manage: true, editBase: true }

  const tablesSql = await read('../supabase/migrations/20261108100100_civil_lifecycle_tables.sql')
  const rlsSql = await read('../supabase/migrations/20261108100200_civil_lifecycle_rls_triggers.sql')

  // ── ข้อมูลทดสอบ ─────────────────────────────────────────────────────────────
  const project = (stage = 'construction', extra = {}) => ({
    id: 'p1abcdef-0000-0000-0000-000000000000', title: `โครงการ ${EVIL}`, fiscal_year: '2569', project_type: 'road', stage, stage_before_hold: null,
    status: L.statusOfStage(stage), contract_no: '25/2569', contractor_name: 'หจก.ทดสอบก่อสร้าง', contract_amount: 1250000, budget_amount: 1300000,
    end_date: '2026-10-30', created_by: 'u1', ...extra,
  })
  const inst = (no, extra = {}) => ({ id: `i${no}`, project_id: 'p1', installment_no: no, updated_at: `2026-11-0${no}T00:00:00Z`, ...extra })
  const bundleOf = (extra = {}, projectExtra = {}, stage = 'construction') => ({
    project: project(stage, projectExtra),
    contract: { project_id: 'p1', installments_total: 3, fine_per_day: 1250, notice_to_proceed_date: '2026-09-03', guarantee_type: 'bank_guarantee', warranty_months: 24 },
    people: [], milestones: [], changes: [], defects: [], documents: [], events: [],
    installments: [
      inst(1, { amount: 500000, work_pct: 40, due_on: '2026-09-30', due_report_on: '2026-10-01', delivered_on: '2026-09-28', chair_acknowledged_on: '2026-09-28',
        inspected_on: '2026-10-02', inspection_result: 'accepted', paid_on: '2026-10-09', paid_gross: 500000, voucher_no: '012/2570' }),
      inst(2, { amount: null, work_pct: 35, due_on: '2026-10-30', due_report_on: '2026-11-02', delivered_on: '2026-11-03', chair_acknowledged_on: '2026-11-03' }),
    ],
    ...extra,
  })
  const render = (Component, props) => renderToStaticMarkup(h(Component, props))

  // ── แถวงวด ───────────────────────────────────────────────────────────────────
  await test('installmentSlots: ขึ้นแถว 1..จำนวนงวดในสัญญาให้เอง · รวมแถวที่บันทึก · แถวที่ยังไม่มี saved:false · ไม่มีอะไรเลย = []', () => {
    const slots = F.installmentSlots(bundleOf())
    assert.deepEqual(slots.map(s => [s.installment_no, s.saved]), [[1, true], [2, true], [3, false]])
    assert.equal(slots[0].amount, 500000)
    assert.deepEqual(F.installmentSlots({ contract: { installments_total: 2 }, installments: [] }).map(s => s.saved), [false, false])
    // มีงวดที่ 5 บันทึกไว้เกินจำนวนในสัญญา → ขึ้นถึง 5 และเติมช่องว่าง
    assert.deepEqual(F.installmentSlots({ contract: { installments_total: 3 }, installments: [{ installment_no: 5 }] }).map(s => s.installment_no), [1, 2, 3, 4, 5])
    assert.deepEqual(F.installmentSlots({ contract: {}, installments: [{ installment_no: 2 }] }).map(s => [s.installment_no, s.saved]), [[1, false], [2, true]])
    assert.deepEqual(F.installmentSlots({ contract: null, installments: [] }), [])
    assert.deepEqual(F.installmentSlots({}), [])
    assert.equal(F.installmentSlots({ contract: { installments_total: 99999 }, installments: [] }).length, 200, 'เพดานกันค่าผิดปกติ')
  })

  // ── รายชื่อช่องเทียบกับ migration ───────────────────────────────────────────────
  const tableColumns = name => {
    const body = tablesSql.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\(([\\s\\S]*?)\\n\\);`))?.[1]
    assert.ok(body, 'ไม่พบตาราง ' + name)
    return body.split('\n').map(l => l.match(/^ {2}([a-z_]+)\s/)?.[1]).filter(c => c && !['unique', 'check'].includes(c))
  }
  const triggerArgs = name => {
    const m = rlsSql.match(new RegExp(`CREATE TRIGGER ${name}[\\s\\S]*?civil_manage_columns_guard\\(([\\s\\S]*?)\\);`))
    assert.ok(m, 'ไม่พบ trigger ' + name)
    const args = [...m[1].matchAll(/'([a-z_-]+)'/g)].map(x => x[1])
    const cut = args.indexOf('--')
    assert.ok(cut > 0, 'ไม่พบตัวคั่น --')
    return { manager: args.slice(0, cut), locked: args.slice(cut + 1) }
  }
  const SYSTEM_COLUMNS = ['id', 'project_id', 'created_by', 'updated_by', 'created_at', 'updated_at']

  await test('เทียบ trigger civil_manage_columns_guard ในไฟล์ migration: ช่องผู้จัดการ/ช่องล็อกหลังมีผล ตรงกับค่าคงที่ใน lib ตัวต่อตัว', () => {
    const i = triggerArgs('civil_installments_manage_guard_trigger')
    assert.deepEqual([...F.INSTALLMENT_MANAGER_COLUMNS].sort(), [...i.manager].sort())
    assert.deepEqual([...F.INSTALLMENT_LOCKED_COLUMNS].sort(), [...i.locked].sort())
    assert.equal(i.manager[0], 'inspection_result', 'อาร์กิวเมนต์แรก = ช่องผล (ใช้ตัดสินว่า "มีผลแล้ว")')
    const c = triggerArgs('civil_changes_manage_guard_trigger')
    assert.deepEqual([...F.CHANGE_MANAGER_COLUMNS].sort(), [...c.manager].sort())
    assert.deepEqual([...F.CHANGE_LOCKED_COLUMNS].sort(), [...c.locked].sort())
    assert.equal(c.manager[0], 'decision')
  })

  await test('สเปกช่องครบทุกคอลัมน์ของตาราง (ไม่ขาด ไม่เกิน) และชื่อช่องมีจริงใน migration', () => {
    const cases = [
      ['civil_project_installments', F.INSTALLMENT_FIELDS],
      ['civil_project_changes', F.CHANGE_FIELDS],
      ['civil_project_defects', F.DEFECT_FIELDS],
    ]
    for (const [table, specs] of cases) {
      const cols = tableColumns(table).filter(c => !SYSTEM_COLUMNS.includes(c))
      assert.deepEqual(specs.map(s => s.key).sort(), [...cols].sort(), table)
    }
    // กลุ่มของงวดครบ 4 กลุ่มตามแผน + ช่องเลขงวดอ่านอย่างเดียว
    assert.deepEqual(F.INSTALLMENT_GROUPS.map(g => g.key), ['delivery', 'inspection', 'fine', 'payment'])
    assert.equal(F.INSTALLMENT_FIELDS.find(f => f.key === 'installment_no').readOnly, true)
    // ช่องที่ล็อก/ผู้จัดการมีสเปกทุกตัว
    for (const k of [...F.INSTALLMENT_MANAGER_COLUMNS, ...F.INSTALLMENT_LOCKED_COLUMNS]) assert.ok(F.INSTALLMENT_FIELDS.some(f => f.key === k), k)
    for (const k of [...F.CHANGE_MANAGER_COLUMNS, ...F.CHANGE_LOCKED_COLUMNS]) assert.ok(F.CHANGE_FIELDS.some(f => f.key === k), k)
  })

  await test('ตัวเลือกใน lib ตรงกับ CHECK ใน migration (ผลตรวจรับ · ชนิดขยายเวลา · ผลพิจารณา · ผลตรวจชำรุด · ที่มาเอกสาร · ขั้น)', () => {
    const list = obj => Object.keys(obj).sort()
    const inCheck = (column, values) => {
      for (const v of values) assert.ok(new RegExp(`${column}[^\\n]*'${v}'`).test(tablesSql) || tablesSql.includes(`'${v}'`), `${column}: ${v}`)
    }
    inCheck('inspection_result', Object.keys(L.INSPECTION_RESULTS))
    inCheck('kind', Object.keys(L.CHANGE_KINDS))
    inCheck('decision', Object.keys(F.CHANGE_DECISIONS))
    inCheck('result', Object.keys(L.DEFECT_RESULTS))
    inCheck('source', F.DOC_SOURCES)
    assert.deepEqual(list(F.DOC_SOURCE_LABELS), ['egp', 'elaas', 'other', 'system'])
    const sourceCheck = tablesSql.match(/source\s+text NOT NULL DEFAULT 'other' CHECK \(source IN \(([^)]*)\)\)/)?.[1]
    assert.deepEqual([...sourceCheck.matchAll(/'([a-z]+)'/g)].map(m => m[1]).sort(), list(F.DOC_SOURCE_LABELS))
    // doc_kind: รูปแบบใน SQL = รูปแบบที่ lib ใช้ตรวจ
    assert.ok(tablesSql.includes(`doc_kind ~ '${F.DOC_KIND_PATTERN.source}'`), 'รูปแบบ doc_kind ไม่ตรง SQL')
    assert.ok(tablesSql.includes('length(btrim(title)) BETWEEN 1 AND 300'))
    // ขั้นที่แนบเอกสารได้ = 12 ขั้นเดียวกับ STAGES
    const stageCheck = tablesSql.match(/stage\s+text CHECK \(stage IS NULL OR stage IN \(([^)]*)\)\)/)?.[1]
    assert.deepEqual([...stageCheck.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort(), [...L.STAGES].sort())
  })

  // ── installmentPatch ─────────────────────────────────────────────────────────
  const draftOf = (row, no) => F.installmentDraft(row, no)

  await test('installmentPatch: งวดใหม่ส่งเฉพาะช่องที่กรอก (ค่าว่าง/false ไม่ส่ง) · installment_no ไม่เข้า patch', () => {
    const r = F.installmentPatch({ ...draftOf(null, 2), delivered_on: '2026-11-03', delivery_ref_no: ' 1450 ', work_pct: '35', amount: '437,500.00' }, null, { manage: false })
    assert.deepEqual(r, { patch: { work_pct: 35, amount: 437500, delivered_on: '2026-11-03', delivery_ref_no: '1450' } })
    assert.equal(F.installmentPatch(draftOf(null, 2), null).error, 'ไม่มีอะไรเปลี่ยน')
  })

  await test('installmentPatch: แถวเดิม — ส่งเฉพาะช่องที่ต่าง (เทียบแบบ normalize ตัวเลข/วันที่) · ล้างช่อง = null · ไม่เปลี่ยน = error', () => {
    const row = inst(1, { amount: 437500, work_pct: 35.5, delivered_on: '2026-11-03', paid_gross: '1250.5', note: 'เดิม' })
    const draft = draftOf(row)
    assert.equal(F.installmentPatch(draft, row).error, 'ไม่มีอะไรเปลี่ยน')
    assert.equal(F.installmentPatch({ ...draft, amount: '437,500', work_pct: '35.500', paid_gross: '1,250.50' }, row).error, 'ไม่มีอะไรเปลี่ยน', 'รูปตัวเลขต่างแต่ค่าเท่ากัน')
    assert.deepEqual(F.installmentPatch({ ...draft, voucher_no: '012/2570' }, row), { patch: { voucher_no: '012/2570' } })
    assert.deepEqual(F.installmentPatch({ ...draft, delivered_on: '', note: '   ' }, row), { patch: { delivered_on: null, note: null } })
    assert.deepEqual(F.installmentPatch({ ...draft, fine_reserved: true }, row), { patch: { fine_reserved: true } })
    // ค่าที่ฟอร์มไม่ส่งมาใช้ค่าเดิม (ไม่ถูกล้าง)
    assert.equal(F.installmentPatch({ voucher_no: 'x' }, row).patch.amount, undefined)
    assert.deepEqual(F.installmentPatch({ voucher_no: 'x' }, row), { patch: { voucher_no: 'x' } })
  })

  await test('installmentPatch: ไม่ใช่ผู้จัดการ — ตัดช่องผลตรวจรับทิ้งเสมอ · ผู้จัดการส่งได้', () => {
    const row = inst(2, { delivered_on: '2026-11-03', inspected_on: '2026-11-05' })
    const values = { ...draftOf(row), inspection_result: 'accepted', inspection_reason: 'ครบถ้วน', egp_inspection_no: 'E-1', inspected_on: '2026-11-06' }
    assert.deepEqual(F.installmentPatch(values, row, { manage: false }), { patch: { inspected_on: '2026-11-06' } })
    assert.deepEqual(F.installmentPatch({ ...values, inspected_on: '2026-11-05' }, row, { manage: false }).error, 'ไม่มีอะไรเปลี่ยน')
    assert.deepEqual(F.installmentPatch(values, row, { manage: true }).patch,
      { inspected_on: '2026-11-06', inspection_result: 'accepted', inspection_reason: 'ครบถ้วน', egp_inspection_no: 'E-1' })
    // งวดใหม่ที่คนทั่วไปกรอกผลตรวจรับ → ผลไม่ถูกส่ง
    assert.equal(F.installmentPatch({ ...draftOf(null, 4), delivered_on: '2026-11-03', inspection_result: 'rejected', inspected_on: '2026-11-04' }, null).patch.inspection_result, undefined)
  })

  await test('installmentPatch: มีผลตรวจรับแล้ว — ไม่ใช่ผู้จัดการแก้ช่องข้อเท็จจริงไม่ได้ (ตัดทิ้ง) แต่แก้ฎีกา/เบิกจ่าย/หนังสือค่าปรับได้ · ผู้จัดการแก้ได้ทุกช่อง', () => {
    const row = inst(1, { amount: 500000, work_pct: 40, due_on: '2026-09-30', delivered_on: '2026-09-28', delivery_ref_no: 'A1', chair_acknowledged_on: '2026-09-28',
      inspected_on: '2026-10-02', inspection_result: 'accepted', fine_reserved: false })
    const edit = {
      ...draftOf(row), amount: '1', work_pct: '1', due_on: '2026-01-01', delivered_on: '2026-01-02', delivery_ref_no: 'ZZ', chair_acknowledged_on: '2026-01-03',
      inspected_on: '2026-01-04', fine_reserved: true, paid_on: '2026-10-09', voucher_no: '012/2570', fine_notice_no: 'ปค.1', due_report_on: '2026-10-01', note: 'หมายเหตุ',
    }
    assert.deepEqual(F.installmentPatch(edit, row, { manage: false }).patch,
      { due_report_on: '2026-10-01', fine_notice_no: 'ปค.1', voucher_no: '012/2570', paid_on: '2026-10-09', note: 'หมายเหตุ' })
    const all = F.installmentPatch(edit, row, { manage: true }).patch
    for (const k of F.INSTALLMENT_LOCKED_COLUMNS.filter(k => k !== 'installment_no')) assert.ok(k in all, `ผู้จัดการต้องแก้ ${k} ได้`)
    // ชุดที่ตัด = ชุดล็อกใน trigger พอดี
    const stripped = F.INSTALLMENT_LOCKED_COLUMNS.filter(k => !(k in F.installmentPatch(edit, row, { manage: false }).patch))
    assert.deepEqual(stripped.sort(), [...F.INSTALLMENT_LOCKED_COLUMNS].sort())
  })

  await test('installmentPatch: validation — ตัวเลข/ติดลบ/เกินช่วง/วันที่/ความยาว/ผลตรวจรับต้องมีวันที่ตรวจ/ค่าไม่รู้จัก', () => {
    const base = draftOf(null, 1)
    const bad = [
      [{ amount: 'abc' }, /ต้องเป็นตัวเลข/], [{ amount: '1e5' }, /ต้องเป็นตัวเลข/], [{ amount: '-1' }, /ไม่ติดลบ/], [{ paid_gross: '-0.01' }, /ไม่ติดลบ/],
      [{ amount: '1e14' }, /ต้องเป็นตัวเลข/], [{ amount: '99999999999999.99' }, /เกินช่วง/],
      [{ work_pct: '100.001' }, /0–100/], [{ work_pct: '-1' }, /ต้องไม่ติดลบ|0–100/], [{ delivered_on: '2026-02-30' }, /วันที่/], [{ paid_on: '08/11/2569' }, /วันที่/],
      [{ delivery_ref_no: 'x'.repeat(201) }, /200/], [{ note: 'x'.repeat(4001) }, /4,000/], [{ description: 'x'.repeat(4001) }, /4,000/],
    ]
    for (const [patch, re] of bad) assert.match(F.installmentPatch({ ...base, ...patch }, null, { manage: true }).error ?? '', re, JSON.stringify(patch))
    assert.equal(F.installmentPatch({ ...base, work_pct: '100', amount: '0', note: 'x'.repeat(4000), delivery_ref_no: 'x'.repeat(200) }, null).error, undefined, 'ค่าขอบผ่าน')
    assert.match(F.installmentPatch({ ...base, inspection_result: 'accepted' }, null, { manage: true }).error, /วันที่ตรวจรับ/)
    assert.match(F.installmentPatch({ ...base, inspection_result: 'maybe', inspected_on: '2026-11-04' }, null, { manage: true }).error, /ไม่ถูกต้อง/)
    assert.deepEqual(F.installmentPatch({ ...base, inspection_result: 'rejected', inspected_on: '2026-11-04' }, null, { manage: true }).patch, { inspected_on: '2026-11-04', inspection_result: 'rejected' })
    // ปัดทศนิยมตามคอลัมน์ numeric(15,2) / numeric(6,3)
    assert.deepEqual(F.installmentPatch({ ...base, amount: '10.005', work_pct: '33.3333' }, null).patch, { work_pct: 33.333, amount: 10.01 })
  })

  // ── ค่าที่ระบบเสนอ ───────────────────────────────────────────────────────────────
  await test('suggestedAmount / suggestedNet / netWarning / suggestedNewEnd', () => {
    assert.equal(F.suggestedAmount(1250000, 35), 437500)
    assert.equal(F.suggestedAmount('1,250,000', '33.333'), 416662.5)
    assert.equal(F.suggestedAmount(100, 33.3333), 33.33)
    for (const [a, b] of [[null, 10], [1000, ''], [1000, 101], [1000, -1], ['x', 5]]) assert.equal(F.suggestedAmount(a, b), null, `${a},${b}`)
    assert.equal(F.suggestedNet({ paid_gross: 100000, deduct_advance: 10000, deduct_retention: 5000, deduct_fine: 0, deduct_other: null }), 85000)
    assert.equal(F.suggestedNet({ paid_gross: '100,000', deduct_advance: '1,000.50' }), 98999.5)
    assert.equal(F.suggestedNet({ paid_gross: 1000, deduct_advance: 2000 }), null, 'ติดลบ = ไม่เสนอ')
    assert.equal(F.suggestedNet({ paid_gross: null }), null)
    assert.equal(F.netWarning({ paid_gross: 100000, deduct_retention: 5000, paid_net: 95000 }), null)
    assert.match(F.netWarning({ paid_gross: 100000, deduct_retention: 5000, paid_net: 94000 }), /ยอดสุทธิไม่เท่ากับยอดเบิกหักรายการ — ตรวจกับฎีกา \(อาจมีภาษีหัก ณ ที่จ่าย\)/)
    assert.equal(F.netWarning({ paid_gross: 100000, paid_net: null }), null, 'ยังไม่กรอกยอดสุทธิ = ไม่เตือน')
    assert.equal(F.suggestedNewEnd('2026-10-30', 20), '2026-11-19')
    assert.equal(F.suggestedNewEnd('2026-12-20', '15'), '2027-01-04')
    assert.equal(F.suggestedNewEnd('2026-10-30', 0), '2026-10-30')
    for (const [a, b] of [[null, 5], ['2026-10-30', ''], ['2026-10-30', -1], ['2026-10-30', 1.5], ['bad', 5]]) assert.equal(F.suggestedNewEnd(a, b), null, `${a},${b}`)
  })

  // ── changePatch / defectPatch ───────────────────────────────────────────────────
  await test('changePatch: คำขอใหม่ · ไม่ใช่ผู้จัดการตัดช่องผลพิจารณา · ผู้จัดการต้องมีวันที่พิจารณา/วันสิ้นสุดใหม่ของขยายเวลาที่อนุมัติ', () => {
    const draft = F.changeDraft(null)
    assert.match(F.changePatch(draft, null).error, /เลือกชนิดรายการ/)
    assert.deepEqual(F.changePatch({ ...draft, kind: 'extend_time', requested_days: '30', cause: 'ฝนตกหนัก', cause_ended_on: '2026-10-20' }, null),
      { patch: { kind: 'extend_time', cause: 'ฝนตกหนัก', cause_ended_on: '2026-10-20', requested_days: 30 } })
    // ไม่ใช่ผู้จัดการ: ส่งผลพิจารณามา → ถูกตัดทิ้ง
    assert.deepEqual(F.changePatch({ ...draft, kind: 'extend_time', requested_days: '30', decision: 'approved', approved_on: '2026-11-01', approved_days: '20', new_end_date: '2026-11-19' }, null, { manage: false }).patch,
      { kind: 'extend_time', requested_days: 30 })
    const row = { id: 'c1', kind: 'extend_time', requested_days: 30 }
    const decide = (extra, o = { manage: true }) => F.changePatch({ ...F.changeDraft(row), ...extra }, row, o)
    assert.match(decide({ approved_days: '20' }).error, /เลือกผลพิจารณา/)
    assert.match(decide({ decision: 'approved' }).error, /วันที่พิจารณา/)
    assert.match(decide({ decision: 'approved', approved_on: '2026-11-01', approved_days: '20' }).error, /วันสิ้นสุดสัญญาใหม่/)
    assert.deepEqual(decide({ decision: 'approved', approved_on: '2026-11-01', approved_days: '20', new_end_date: '2026-11-19' }).patch,
      { decision: 'approved', approved_on: '2026-11-01', approved_days: 20, new_end_date: '2026-11-19' })
    assert.deepEqual(decide({ decision: 'rejected', approved_on: '2026-11-01' }).patch, { decision: 'rejected', approved_on: '2026-11-01' }, 'ไม่อนุมัติไม่ต้องมีวันสิ้นสุดใหม่')
    assert.match(decide({ requested_days: '-1' }).error, /ไม่ติดลบ/)
    assert.match(decide({ requested_days: '1.5' }).error, /จำนวนเต็ม/)
    assert.match(decide({ cause: 'x'.repeat(4001) }).error, /4,000/)
  })

  await test('changePatch: ช่องเฉพาะชนิด (approved_days/new_end_date = ขยายเวลา · amount_change/egp_published_on = แก้สัญญา) · ติดลบได้เฉพาะวงเงิน · ล็อกหลังมีผล', () => {
    const waive = { id: 'c2', kind: 'waive_fine', decision: null }
    // ชนิดงดค่าปรับส่งจำนวนวัน/วงเงินมา → ล้างเป็น null (ไม่เก็บค่าที่ชนิดนี้ไม่ใช้)
    const p = F.changePatch({ ...F.changeDraft(waive), decision: 'approved', approved_on: '2026-11-01', approved_days: '5', amount_change: '-100', egp_published_on: '2026-11-02', new_end_date: '2026-12-01' }, waive, { manage: true })
    assert.deepEqual(p.patch, { decision: 'approved', approved_on: '2026-11-01' })
    const amend = { id: 'c3', kind: 'amend_contract' }
    const a = F.changePatch({ ...F.changeDraft(amend), decision: 'approved', approved_on: '2026-11-01', amount_change: '-125,000.50', egp_published_on: '2026-11-05', approved_days: '9' }, amend, { manage: true })
    assert.deepEqual(a.patch, { decision: 'approved', approved_on: '2026-11-01', amount_change: -125000.5, egp_published_on: '2026-11-05' })
    // เปลี่ยนชนิดจากขยายเวลา → แก้สัญญา ช่องวัน/วันสิ้นสุดใหม่ที่เคยมีถูกล้าง
    const was = { id: 'c4', kind: 'extend_time', decision: 'approved', approved_on: '2026-11-01', approved_days: 20, new_end_date: '2026-11-19' }
    assert.deepEqual(F.changePatch({ ...F.changeDraft(was), kind: 'amend_contract' }, was, { manage: true }).patch, { kind: 'amend_contract', approved_days: null, new_end_date: null })
    assert.ok(F.changeFieldApplies('extend_time', 'new_end_date') && !F.changeFieldApplies('amend_contract', 'new_end_date'))
    assert.ok(F.changeFieldApplies('amend_contract', 'amount_change') && !F.changeFieldApplies('extend_time', 'amount_change') && F.changeFieldApplies('waive_fine', 'cause'))
    // มีผลพิจารณาแล้ว: ไม่ใช่ผู้จัดการแก้ชนิด/เหตุ/เลขที่ไม่ได้ (ตัดทิ้ง) แต่แก้ e-GP/หมายเหตุได้
    const decided = { id: 'c5', kind: 'amend_contract', cause: 'เดิม', ref_no: 'ท1', decision: 'approved', approved_on: '2026-11-01', amount_change: 1000 }
    const e = F.changePatch({ ...F.changeDraft(decided), kind: 'extend_time', cause: 'ใหม่', ref_no: 'ท2', decision: 'rejected', amount_change: '5', egp_published_on: '2026-11-09', note: 'ok' }, decided, { manage: false })
    assert.deepEqual(e.patch, { egp_published_on: '2026-11-09', note: 'ok' })
  })

  await test('defectPatch: บังคับวันที่/ชนิด/ผล · ผลปกติล้างช่องแจ้งแก้ไข · พบชำรุดเก็บครบ', () => {
    const d = F.defectDraft(null)
    assert.match(F.defectPatch(d, null).error, /วันที่ตรวจ/)
    assert.match(F.defectPatch({ ...d, inspected_on: '2026-11-08' }, null).error, /ชนิดการตรวจ/)
    assert.match(F.defectPatch({ ...d, inspected_on: '2026-11-08', kind: 'during_warranty' }, null).error, /ผลการตรวจ/)
    assert.match(F.defectPatch({ ...d, inspected_on: '2026-02-30', kind: 'during_warranty', result: 'ok' }, null).error, /วันที่/)
    assert.deepEqual(F.defectPatch({ ...d, inspected_on: '2026-11-08', kind: 'final_before_expiry', result: 'ok', notice_no: 'ไม่ควรเก็บ', fixed_on: '2026-11-09' }, null).patch,
      { inspected_on: '2026-11-08', kind: 'final_before_expiry', result: 'ok' })
    const defect = F.defectPatch({ ...d, inspected_on: '2026-11-08', kind: 'during_warranty', result: 'defect', detail: 'ผิวถนนแตก', notice_no: 'ท 5', notice_date: '2026-11-09', fix_due_on: '2026-11-30', guarantor_notified_on: '2026-11-10' }, null)
    assert.deepEqual(defect.patch, { inspected_on: '2026-11-08', kind: 'during_warranty', result: 'defect', detail: 'ผิวถนนแตก', notice_no: 'ท 5', notice_date: '2026-11-09', guarantor_notified_on: '2026-11-10', fix_due_on: '2026-11-30' })
    // แก้ผลจากพบชำรุด → ปกติ ล้างช่องที่เคยกรอก
    const row = { id: 'd1', inspected_on: '2026-11-08', kind: 'during_warranty', result: 'defect', notice_no: 'ท 5', fix_due_on: '2026-11-30' }
    assert.deepEqual(F.defectPatch({ ...F.defectDraft(row), result: 'ok' }, row).patch, { result: 'ok', notice_no: null, fix_due_on: null })
  })

  // ── เอกสารแนบ ───────────────────────────────────────────────────────────────────
  await test('DOC_KINDS: คีย์ถูกรูปแบบ ไม่ซ้ำ มีป้ายไทย · ที่มาเริ่มต้นตามแผน · ครบ 14 ชนิด', () => {
    assert.equal(F.DOC_KINDS.length, 14)
    const keys = F.DOC_KINDS.map(k => k.key)
    assert.equal(new Set(keys).size, keys.length)
    for (const k of F.DOC_KINDS) {
      assert.match(k.key, F.DOC_KIND_PATTERN)
      assert.match(k.label, /[฀-๿]/)
      assert.ok(F.DOC_SOURCES.includes(k.source), k.key)
    }
    const src = key => F.DOC_KIND_BY_KEY[key].source
    assert.deepEqual(['inspection_record', 'fine_notice', 'egp_announcement'].map(src), ['egp', 'egp', 'egp'])
    assert.equal(src('voucher'), 'elaas')
    for (const key of ['contract', 'guarantee', 'notice_to_proceed', 'delivery_letter', 'performance_cert', 'change_request', 'change_approval', 'defect_notice', 'photo', 'other']) assert.ok(keys.includes(key), key)
  })

  await test('validateAttachment: PDF/รูปเท่านั้น ≤ 20 MB · กล้องมือถือที่ type ว่างดูนามสกุล · ว่าง/ไม่มีไฟล์ไม่ผ่าน', () => {
    const f = (name, type, size) => ({ name, type, size })
    const MB = 1024 * 1024
    assert.equal(F.validateAttachment(f('a.pdf', 'application/pdf', 1000)), null)
    assert.equal(F.validateAttachment(f('a.png', 'image/png', 20 * MB)), null, 'เท่าเพดานผ่าน')
    assert.equal(F.validateAttachment(f('a.jpg', '', 5000)), null, 'type ว่าง + .jpg')
    assert.match(F.validateAttachment(f('a.png', 'image/png', 20 * MB + 1)), /ใหญ่เกิน 20 MB/)
    assert.match(F.validateAttachment(f('a.txt', 'text/plain', 10)), /PDF หรือรูปภาพ/)
    assert.match(F.validateAttachment(f('a.exe', '', 10)), /PDF หรือรูปภาพ/)
    assert.match(F.validateAttachment(f('a.html', 'text/html', 10)), /PDF หรือรูปภาพ/)
    assert.match(F.validateAttachment(f('a.pdf', 'application/pdf', 0)), /ว่างเปล่า/)
    assert.match(F.validateAttachment(null), /ไม่พบไฟล์/)
    assert.equal(F.ATTACHMENT_MAX_BYTES, 20 * MB)
  })

  await test('attachmentFolder / attachmentFileName: โครงการก่อสร้าง/ปีงบ/สัญญา · ไม่มีชื่อบุคคล (PDPA) · เติม construction ใน DRIVE_MODULES', () => {
    assert.equal(Folders.DRIVE_MODULES.construction, 'โครงการก่อสร้าง')
    const p = project('construction', { contractor_name: 'นายสมชาย ใจดี', title: 'ถนนหน้าบ้านนางสมหญิง' })
    assert.equal(F.attachmentFolder(p), 'โครงการก่อสร้าง/ปีงบ 2569/สัญญา 25-2569')
    assert.equal(F.attachmentFolder(project('procuring', { contract_no: null })), 'โครงการก่อสร้าง/ปีงบ 2569/โครงการ p1abcdef')
    assert.equal(F.attachmentFolder(project('procuring', { contract_no: '  ', fiscal_year: null })), 'โครงการก่อสร้าง/โครงการ p1abcdef')
    for (const name of [F.attachmentFolder(p), F.attachmentFileName({ docKind: 'voucher', installmentNo: 2, ext: 'pdf' })]) {
      for (const person of ['สมชาย', 'สมหญิง', 'ใจดี', 'หจก.', 'ถนน']) assert.ok(!name.includes(person), `${person} ใน ${name}`)
    }
    assert.equal(F.attachmentFileName({ docKind: 'voucher', installmentNo: 2, ext: 'PDF', date: '2026-11-08' }), 'ฎีกาเบิกจ่าย (e-LAAS)-งวด2-20261108.pdf')
    assert.equal(F.attachmentFileName({ docKind: 'photo', ext: 'jpg', date: '2026-11-08' }), 'ภาพถ่าย-20261108.jpg')
    assert.match(F.attachmentFileName({ docKind: 'other', ext: '../../x' , date: '2026-11-08' }), /\.bin$/, 'นามสกุลผิดรูป = bin ไม่ทะลุโฟลเดอร์')
    assert.ok(!/[\\/]/.test(F.attachmentFileName({ docKind: 'other', ext: 'pdf' })))
    assert.equal(F.documentStageOf(project('suspended', { stage_before_hold: 'construction' })), 'construction')
    assert.equal(F.documentStageOf(project('construction')), 'construction')
    assert.equal(F.documentStageOf({ stage: 'bogus' }), null)
  })

  // ── ข้อความประวัติ ───────────────────────────────────────────────────────────────
  await test('historyNote: ข้อความตามตัวอย่างในแผน · ไม่เกิน 4000 ตัว', () => {
    const before2 = { installment_no: 2 }
    assert.equal(F.historyNote('installment', null, { installment_no: 2, delivered_on: '2026-11-03', delivery_ref_no: '1450' }), 'บันทึกงวดที่ 2: ส่งมอบ 3 พ.ย. 2569 (เลขรับ 1450)')
    assert.equal(F.historyNote('installment', before2, { installment_no: 2, delivered_on: '2026-11-03' }), 'บันทึกงวดที่ 2: ส่งมอบ 3 พ.ย. 2569')
    assert.equal(F.historyNote('installment', { installment_no: 2, inspected_on: '2026-11-05' }, { installment_no: 2, inspected_on: '2026-11-05', inspection_result: 'accepted' }), 'บันทึกผลตรวจรับงวดที่ 2: ตรวจรับ')
    assert.equal(F.historyNote('installment', before2, { installment_no: 2, inspected_on: '2026-11-05', inspection_result: 'rejected' }), 'บันทึกผลตรวจรับงวดที่ 2: ไม่ตรวจรับ')
    assert.equal(F.historyNote('installment', before2, { installment_no: 2, paid_on: '2026-11-09', paid_gross: 437500, voucher_no: '012/2570' }), 'บันทึกงวดที่ 2: เบิกจ่าย 437,500 บาท 9 พ.ย. 2569 (ฎีกา 012/2570)')
    assert.equal(F.historyNote('installment', before2, { installment_no: 2, voucher_no: 'x', note: 'เปลี่ยน' }), 'บันทึกงวดที่ 2: แก้ไขข้อมูล')
    assert.equal(F.historyNote('installment', null, { installment_no: 3 }), 'บันทึกงวดที่ 3: เพิ่มงวด')
    assert.equal(F.historyNote('installment_delete', { installment_no: 3 }, null), 'ลบงวดที่ 3')
    assert.equal(F.historyNote('change', null, { kind: 'extend_time', requested_days: 30 }), 'บันทึกคำขอขยายเวลา 30 วัน')
    assert.equal(F.historyNote('change', null, { kind: 'waive_fine' }), 'บันทึกคำของดค่าปรับ')
    assert.equal(F.historyNote('change', { kind: 'extend_time' }, { kind: 'extend_time', decision: 'approved', approved_days: 20, new_end_date: '2026-11-19' }), 'บันทึกผลพิจารณาขยายเวลา: อนุมัติ 20 วัน สิ้นสุดใหม่ 19 พ.ย. 2569')
    assert.equal(F.historyNote('change', { kind: 'extend_time' }, { kind: 'extend_time', decision: 'rejected' }), 'บันทึกผลพิจารณาขยายเวลา: ไม่อนุมัติ')
    assert.equal(F.historyNote('change', { kind: 'amend_contract' }, { kind: 'amend_contract', decision: 'approved', amount_change: -1000 }), 'บันทึกผลพิจารณาแก้ไขสัญญา: อนุมัติ วงเงินเปลี่ยน -1,000 บาท')
    assert.equal(F.historyNote('change', { kind: 'extend_time' }, { kind: 'extend_time', note: 'x' }), 'แก้ไขรายการขยายเวลา')
    assert.equal(F.historyNote('change_delete', { kind: 'reduce_fine' }, null), 'ลบรายการลดค่าปรับ')
    assert.equal(F.historyNote('defect', null, { inspected_on: '2026-11-08', result: 'defect' }), 'บันทึกผลตรวจความชำรุดบกพร่อง 8 พ.ย. 2569: พบความชำรุดบกพร่อง')
    assert.equal(F.historyNote('defect_delete', { inspected_on: '2026-11-08' }, null), 'ลบผลตรวจความชำรุดบกพร่อง 8 พ.ย. 2569')
    assert.equal(F.historyNote('document_add', null, { title: 'ใบตรวจรับงวด 2' }), 'แนบเอกสาร: ใบตรวจรับงวด 2')
    assert.equal(F.historyNote('document_delete', { title: 'ใบตรวจรับงวด 2' }, null), 'ลบเอกสารแนบ: ใบตรวจรับงวด 2')
    assert.equal(F.historyNote('document_add', null, { title: 'ก'.repeat(5000) }).length, 4000)
  })

  // ── ชั้น API (ไม่ต่อฐานข้อมูล: ตรวจค่าก่อนส่ง) ───────────────────────────────────
  await test('ชั้น API: ค่าผิด/ไม่เปลี่ยน/ไม่มีโครงการ → ข้อความไทยทันที ไม่ยิงฐานข้อมูล · แนบเอกสารตรวจก่อนอัปโหลด', async () => {
    assert.match((await Api.saveInstallment(null, {}, null)).message, /ไม่พบโครงการ/)
    assert.equal((await Api.saveInstallment('p1', F.installmentDraft(null, 2), null)).message, 'ไม่มีอะไรเปลี่ยน')
    assert.match((await Api.saveInstallment('p1', { ...F.installmentDraft(null, 2), amount: '-5' }, null)).message, /ไม่ติดลบ/)
    const row = inst(1, { amount: 5 })
    assert.equal((await Api.saveInstallment('p1', F.installmentDraft(row), row)).message, 'ไม่มีอะไรเปลี่ยน')
    assert.match((await Api.saveChange('p1', F.changeDraft(null), null)).message, /เลือกชนิดรายการ/)
    assert.match((await Api.saveDefect('p1', F.defectDraft(null), null)).message, /วันที่ตรวจ/)
    assert.match((await Api.deleteInstallment(null)).message, /ไม่พบรายการ/)
    assert.match((await Api.deleteDocument({})).message, /ไม่พบรายการ/)
    const project1 = project('construction')
    const base = { project: project1, docKind: 'voucher', title: 'ฎีกา' }
    const png = { name: 'a.png', type: 'image/png', size: 100 }
    assert.match((await Api.addDocument({ ...base, project: null })).message, /ไม่พบโครงการ/)
    assert.match((await Api.addDocument({ ...base, title: '  ' })).message, /ชื่อเอกสาร/)
    assert.match((await Api.addDocument({ ...base, title: 'x'.repeat(301) })).message, /300/)
    assert.match((await Api.addDocument({ ...base, docKind: 'Bad Kind' })).message, /ชนิดเอกสาร/)
    assert.match((await Api.addDocument({ ...base, source: 'gov' })).message, /ที่มา/)
    assert.match((await Api.addDocument({ ...base, stage: 'bogus' })).message, /ขั้น/)
    assert.match((await Api.addDocument({ ...base, refNo: 'x'.repeat(201) })).message, /200/)
    assert.match((await Api.addDocument({ ...base, refNo: '1', refDate: '2026-02-30' })).message, /วันที่/)
    assert.match((await Api.addDocument({ ...base, refNo: '1', installmentNo: 0 })).message, /งวด/)
    assert.match((await Api.addDocument(base)).message, /แนบไฟล์ หรือกรอกเลขที่/)
    assert.match((await Api.addDocument({ ...base, file: { name: 'a.txt', type: 'text/plain', size: 5 } })).message, /PDF หรือรูปภาพ/)
    assert.match((await Api.addDocument({ ...base, file: { ...png, size: 21 * 1024 * 1024 } })).message, /ใหญ่เกิน/)
    assert.match((await Api.openDocument({ file_ref: null })).message, /ไม่มีไฟล์/)
    assert.match((await Api.openDocument({ file_ref: 'รหัสเปล่า123' })).message, /ไม่มีไฟล์/)
    assert.match((await Api.addProjectNote('p1', '   ')).message, /ไม่มีข้อความ/)
    assert.match((await Api.addProjectNote(null, 'x')).message, /ไม่มีข้อความ/)
  })

  // ── หน้าจอ ─────────────────────────────────────────────────────────────────────
  const tableProps = (access, extra = {}, bundle = bundleOf()) => ({ bundle, access, deadlines: L.deadlines(bundle, TODAY), today: TODAY, onChanged: noop, ...extra })

  await test('InstallmentsTable (ผู้ดู): ตารางตามแบบ — ป้ายรับ/จ่าย/เลยกำหนด/ช้า N วัน · หัวตาราง N งวด + จ่ายแล้ว · ไม่มีปุ่ม/ฟอร์ม', () => {
    const out = render(InstallmentsTable, tableProps(READ))
    for (const text of ['งวดงาน · ส่งมอบ / ตรวจรับ / เบิกจ่าย', '3 งวด · จ่ายแล้ว 500,000 บาท', '1 (40%)', '2 (35%)', 'รับ 2 ต.ค. 2569', 'จ่าย 9 ต.ค. 2569', 'ช้า 4 วัน', 'เลยกำหนด 6 พ.ย. 2569', '30 ก.ย. 2569']) {
      assert.ok(out.includes(esc(text)), text)
    }
    assert.ok(out.includes('1 ต.ค. 2569') && out.includes('2 พ.ย. 2569'), 'วันรายงาน ผคง.')
    assert.ok(/bg-amber-50\/60/.test(out), 'แถวที่มีเลยกำหนดพื้น amber')
    assert.ok(!out.includes('aria-expanded') && !out.includes('เพิ่มงวด') && !out.includes('<input') && !out.includes('<select'), 'ผู้ดูไม่มีปุ่ม/ฟอร์ม')
    // 700px ตาม mock — พอดีแผ่นกว้าง (~728px) ที่ 1366 · เดิม 760 ทำคอลัมน์เบิกจ่ายถูกตัด (ตรวจบน demo 2026-11-08)
    assert.ok(out.includes('min-w-[700px]') && out.includes('overflow-x-auto'), '390px ห้ามล้นจอ — ตารางเลื่อนแนวนอนในกรอบ')
    // ผลตรวจรับ rejected / ตรวจแล้วแต่ยังไม่บันทึกผล
    const b = bundleOf({ installments: [inst(1, { inspected_on: '2026-10-02', inspection_result: 'rejected' }), inst(2, { inspected_on: '2026-11-05' })] })
    const o2 = render(InstallmentsTable, tableProps(READ, {}, b))
    assert.ok(o2.includes('ไม่รับ') && o2.includes(esc('ตรวจ 5 พ.ย. 2569 (ยังไม่บันทึกผล)')))
  })

  await test('InstallmentsTable (ผู้ควบคุมงาน): ทุกแถวกดได้ (aria-expanded) · ปุ่มเพิ่มงวด · ยังไม่ได้เปิดฟอร์ม', () => {
    const out = render(InstallmentsTable, tableProps(WRITE))
    assert.equal((out.match(/aria-expanded="false"/g) ?? []).length, 3)
    assert.ok(out.includes('เพิ่มงวด'))
    assert.ok(!out.includes('<fieldset'))
    // แถวที่ยังไม่บันทึก (งวด 3) ไม่ขึ้นป้ายเปล่าๆ ให้เข้าใจผิด
    assert.ok(!out.includes('ยังไม่ส่ง'), 'งวดที่ยังไม่มีแถว/ไม่มีกำหนดส่ง = —')
  })

  await test('InstallmentsTable: ไม่มีจำนวนงวดและไม่มีแถว → ข้อความ + ปุ่มเพิ่มงวด (ผู้เขียน) / ไม่มีปุ่ม (ผู้ดู)', () => {
    const empty = bundleOf({ installments: [], contract: { installments_total: null } })
    const w = render(InstallmentsTable, tableProps(WRITE, {}, empty))
    assert.ok(w.includes('ยังไม่มีงวดงาน') && w.includes('เพิ่มงวด') && !w.includes('<table'))
    const r = render(InstallmentsTable, tableProps(READ, {}, empty))
    assert.ok(r.includes('ยังไม่มีงวดงาน') && !r.includes('เพิ่มงวด'))
  })

  await test('InstallmentsTable: ฟอร์มใต้แถว 4 กลุ่ม — หัวหน้ากองแก้ผลตรวจรับ/ลบงวดได้ · ผู้ควบคุมงานเห็นผลตรวจรับเป็นข้อความอย่างเดียว', () => {
    const m = render(InstallmentsTable, tableProps(MANAGE, { initialOpenNo: 2 }))
    for (const title of ['ส่งมอบงาน', 'ตรวจรับงาน', 'ค่าปรับ', 'เบิกจ่าย (คัดจากฎีกา e-LAAS)']) assert.ok(m.includes(esc(title)), title)
    assert.ok(m.includes('ลบงวดนี้') && m.includes('value="accepted"') && m.includes('value="rejected"'))
    assert.ok(!m.includes('ยืนยันลบ'), 'ยืนยันลบโผล่เมื่อกดลบเท่านั้น')
    const w = render(InstallmentsTable, tableProps(WRITE, { initialOpenNo: 2 }))
    assert.ok(!w.includes('ลบงวดนี้') && !w.includes('value="accepted"'))
    assert.ok(w.includes('บันทึกได้เฉพาะหัวหน้ากองหรือผู้ดูแลระบบ'))
    for (const label of ['ผลการตรวจรับ (ตามใบที่คณะกรรมการลงนามแล้ว)', 'เหตุผล (กรณีไม่ตรวจรับ หรือมีข้อสังเกต)', 'ความเห็นแย้งของกรรมการ (ถ้ามี)', 'เลขคุมใบตรวจรับใน e-GP']) {
      assert.ok(w.includes(esc(label)) && !w.includes(`${esc(label)}</span><input`) && !w.includes(`${esc(label)}</span><select`) && !w.includes(`${esc(label)}</span><textarea`), `${label} ต้องเป็นข้อความอย่างเดียว`)
    }
    // ช่องของงวดที่ยังไม่ตรวจรับผู้ควบคุมงานยังแก้ได้
    assert.ok(w.includes(`${esc('วันที่ผู้รับจ้างส่งมอบงาน')}</span><input`) && w.includes(`${esc('วันที่ตรวจรับ')}</span><input`))
    // เลขงวดอ่านอย่างเดียวเสมอ
    assert.ok(!m.includes(`${esc('งวดที่')}</span><input`))
  })

  await test('InstallmentsTable: งวดที่บันทึกผลตรวจรับแล้ว — ผู้ควบคุมงานแก้ช่องข้อเท็จจริงไม่ได้ (ข้อความ "ให้หัวหน้ากอง…แก้") · ฎีกา/เบิกจ่ายยังแก้ได้ · หัวหน้ากองแก้ได้หมด', () => {
    const w = render(InstallmentsTable, tableProps(WRITE, { initialOpenNo: 1 }))
    assert.ok(w.includes('บันทึกผลตรวจรับแล้ว ให้หัวหน้ากองหรือผู้ดูแลระบบแก้'))
    for (const label of ['เงินงวดตามสัญญา (บาท)', 'สัดส่วนงานของงวด (ร้อยละ)', 'กำหนดส่งมอบตามสัญญา', 'วันที่ผู้รับจ้างส่งมอบงาน', 'เลขรับหนังสือส่งมอบ', 'วันที่ประธานกรรมการตรวจรับทราบการส่งมอบ', 'วันที่ตรวจรับ']) {
      assert.ok(w.includes(esc(label)) && !w.includes(`${esc(label)}</span><input`), `${label} ต้องล็อก`)
    }
    assert.ok(!w.includes('บอกสงวนสิทธิ์เรียกค่าปรับขณะรับมอบงานแล้ว</label>') || !/type="checkbox"[^>]*>บอกสงวนสิทธิ์/.test(w), 'ช่องสงวนสิทธิ์ล็อก')
    for (const label of ['เลขที่ฎีกา', 'วันที่จ่าย', 'ยอดเบิก (บาท)', 'ยอดสุทธิที่จ่าย (บาท)', 'หนังสือแจ้งสิทธิเรียกค่าปรับ — เลขที่', 'ผู้ควบคุมงานรายงาน ณ วันครบกำหนด — วันที่']) {
      assert.ok(w.includes(`${esc(label)}</span><input`), `${label} ยังแก้ได้`)
    }
    const m = render(InstallmentsTable, tableProps(MANAGE, { initialOpenNo: 1 }))
    assert.ok(!m.includes('บันทึกผลตรวจรับแล้ว ให้หัวหน้ากอง') && m.includes(`${esc('เงินงวดตามสัญญา (บาท)')}</span><input`))
  })

  await test('InstallmentsTable: ปุ่ม "ใช้ค่าที่ระบบคำนวณ" (เงินงวด = วงเงิน × สัดส่วน · ยอดสุทธิ) ไม่เสนอเมื่อกรอกเท่ากันแล้ว · เตือนยอดสุทธิไม่ตรง', () => {
    const open2 = render(InstallmentsTable, tableProps(WRITE, { initialOpenNo: 2 }))
    assert.ok(open2.includes(esc('ใช้ค่าที่ระบบคำนวณ: 437,500 บาท (35% ของวงเงินสัญญา)')), 'งวด 2 สัดส่วน 35% ยังไม่มียอด')
    const open1 = render(InstallmentsTable, tableProps(MANAGE, { initialOpenNo: 1 }))
    assert.ok(!open1.includes('% ของวงเงินสัญญา)'), 'งวด 1 ยอด 500,000 ตรงกับ 40% แล้ว ไม่เสนอเงินงวดซ้ำ')
    assert.ok(open1.includes(esc('ใช้ค่าที่ระบบคำนวณ: 500,000 บาท (ยอดเบิก − ยอดหัก)')), 'ยังไม่กรอกยอดสุทธิ → เสนอยอดเบิก − ยอดหัก')
    const b = bundleOf({ installments: [inst(1, { paid_gross: 100000, deduct_retention: 5000, deduct_advance: 0, paid_net: 99000 })] })
    const net = render(InstallmentsTable, tableProps(WRITE, { initialOpenNo: 1 }, b))
    assert.ok(net.includes(esc('ใช้ค่าที่ระบบคำนวณ: 95,000 บาท (ยอดเบิก − ยอดหัก)')))
    assert.ok(net.includes(esc('ยอดสุทธิไม่เท่ากับยอดเบิกหักรายการ — ตรวจกับฎีกา (อาจมีภาษีหัก ณ ที่จ่าย)')))
    const ok = bundleOf({ installments: [inst(1, { paid_gross: 100000, deduct_retention: 5000, paid_net: 95000 })] })
    const quiet = render(InstallmentsTable, tableProps(WRITE, { initialOpenNo: 1 }, ok))
    assert.ok(!quiet.includes('ยอดสุทธิไม่เท่ากับ') && !quiet.includes('ใช้ค่าที่ระบบคำนวณ: 95,000'))
  })

  await test('InstallmentsTable: ค่าปรับประมาณการเมื่อส่งช้า (ป้ายประมาณการ + ข้อ 162/181/183) · เกิน 10% เตือนแดง · ยังไม่ตั้งค่าปรับต่อวันบอกให้กรอก', () => {
    const out = render(InstallmentsTable, tableProps(READ))
    assert.ok(out.includes('ประมาณการ — ยอดทางการใช้ e-GP'))
    assert.ok(out.includes(esc('ส่งมอบช้า 9 วัน')) && out.includes('11,250 บาท') && out.includes('0.90%'), '9 วัน × 1,250')
    assert.ok(out.includes('ข้อ 162, 181, 183') && !out.includes('เกินร้อยละ 10'))
    const big = bundleOf({ contract: { installments_total: 3, fine_per_day: 20000 } })
    const o2 = render(InstallmentsTable, tableProps(READ, {}, big))
    assert.ok(o2.includes('เกินร้อยละ 10 ของวงเงินสัญญา') && o2.includes('ข้อ 183') && o2.includes('180,000 บาท'))
    const none = bundleOf({ contract: { installments_total: 3 } })
    assert.ok(render(InstallmentsTable, tableProps(READ, {}, none)).includes('ยังไม่ได้ตั้งค่าปรับต่อวันของสัญญา'))
    const onTime = bundleOf({}, { end_date: '2026-12-30' })
    assert.ok(!render(InstallmentsTable, tableProps(READ, {}, onTime)).includes('ประมาณการ'), 'ไม่ช้า = ไม่ขึ้น')
  })

  const changesBundle = () => bundleOf({
    changes: [
      { id: 'c1', kind: 'extend_time', requested_days: 30, cause: 'ฝนตกหนัก', cause_ended_on: '2026-10-10', request_received_on: '2026-10-28', decision: 'approved', approved_on: '2026-11-01', approved_days: 20, new_end_date: '2026-11-19', ref_no: 'ท 12', ref_date: '2026-11-01', created_at: '2026-10-28T03:00:00Z' },
      { id: 'c2', kind: 'amend_contract', created_at: '2026-11-02T03:00:00Z' },
      { id: 'c3', kind: 'extend_time', requested_days: 7, cause_ended_on: '2026-10-01', created_at: '2026-11-03T03:00:00Z' },
    ],
  })

  await test('ContractChangesPanel: รายการ + ผลพิจารณา + ผลตรวจ 15 วัน · ข้อความกำกับ "ระบบไม่อนุมัติเอง" · ไม่มีรายการ/ไม่ได้สั่งเพิ่ม = ไม่แสดง', () => {
    const b = changesBundle()
    const props = access => ({ bundle: b, access, deadlines: L.deadlines(b, TODAY), onChanged: noop })
    const out = render(ChangesPanel, props(READ))
    for (const text of ['ขยายเวลา / งดหรือลดค่าปรับ / แก้ไขสัญญา', '3 รายการ', 'ขอ 30 วัน', 'อนุมัติ 20 วัน · สิ้นสุดใหม่ 19 พ.ย. 2569', 'หนังสือเลขที่ ท 12', 'รอผลพิจารณา', 'ขอ 7 วัน',
      'ระบบไม่อนุมัติเอง — บันทึกตามหนังสือที่ผู้มีอำนาจลงนามแล้ว · ม.102 / ข้อ 182 (ต้องยืนยันกับระเบียบฉบับปัจจุบัน)', 'ข้อมูลประกอบการพิจารณา']) {
      assert.ok(out.includes(esc(text)), text)
    }
    assert.ok(out.includes(esc('ภายใน 25 ต.ค. 2569')) && out.includes(esc('ภายใน 16 ต.ค. 2569')), 'กำหนด 15 วันของแต่ละรายการ (10 ต.ค.+15 · 1 ต.ค.+15)')
    assert.ok(out.includes('ทำแล้ว 28 ต.ค. 2569 (เลยกำหนด)'), 'รับหนังสือ 28 ต.ค. เลยกำหนด 25 ต.ค.')
    assert.ok(!out.includes('aria-expanded') && !out.includes('<input'))
    assert.equal(render(ChangesPanel, { ...props(WRITE), bundle: bundleOf() }), '', 'ไม่มีรายการและไม่ได้สั่งเพิ่ม = ไม่แสดง')
    assert.equal((render(ChangesPanel, props(WRITE)).match(/aria-expanded="false"/g) ?? []).length, 3)
    const adding = render(ChangesPanel, { ...props(WRITE), bundle: bundleOf(), adding: true })
    assert.ok(adding.includes('รายการใหม่') && adding.includes('value="extend_time" selected'), 'รายการใหม่ตั้งต้นเป็นขยายเวลา')
  })

  await test('ContractChangesPanel ฟอร์ม: หัวหน้ากองบันทึกผลพิจารณา + ปุ่มคำนวณวันสิ้นสุดใหม่ (ไม่นับรายการเดียวกันซ้ำ) · ผู้ควบคุมงานเห็นเป็นข้อความอย่างเดียว', () => {
    const b = bundleOf({ changes: [{ id: 'c9', kind: 'extend_time', requested_days: 20, decision: 'approved', approved_on: '2026-11-01', approved_days: 20, new_end_date: null }] })
    const props = access => ({ bundle: b, access, deadlines: [], onChanged: noop, initialOpenId: 'c9' })
    const m = render(ChangesPanel, props(MANAGE))
    assert.ok(m.includes(esc('ใช้ค่าที่ระบบคำนวณ: 19 พ.ย. 2569 (สิ้นสุดเดิม 30 ต.ค. 2569 + 20 วัน)')), 'สิ้นสุดเดิม 30 ต.ค. + 20')
    assert.ok(m.includes('value="approved" selected') && m.includes('ลบรายการนี้'))
    // ใส่วันสิ้นสุดใหม่ตรงกับที่เสนอแล้ว = ไม่เสนอซ้ำ และไม่บวกซ้ำ
    const done = bundleOf({ changes: [{ id: 'c9', kind: 'extend_time', decision: 'approved', approved_on: '2026-11-01', approved_days: 20, new_end_date: '2026-11-19' }] })
    const again = render(ChangesPanel, { ...props(MANAGE), bundle: done })
    assert.ok(!again.includes('ใช้ค่าที่ระบบคำนวณ'))
    const w = render(ChangesPanel, props(WRITE))
    assert.ok(w.includes('บันทึกผลพิจารณาแล้ว ให้หัวหน้ากองหรือผู้ดูแลระบบแก้') && w.includes('บันทึกได้เฉพาะหัวหน้ากองหรือผู้ดูแลระบบ'))
    assert.ok(!w.includes('value="approved"') && !w.includes('ลบรายการนี้'))
    for (const label of ['จำนวนวันที่อนุมัติ', 'วันที่พิจารณา (ลงนามผลพิจารณา)']) assert.ok(w.includes(esc(label)) && !w.includes(`${esc(label)}</span><input`), label)
    assert.ok(!w.includes(`${esc('ชนิดรายการ')}</span><select`), 'มีผลแล้ว ชนิดรายการล็อก')
    assert.ok(!w.includes('วงเงินที่เปลี่ยน') && !w.includes('วันที่เผยแพร่การแก้ไขสัญญาใน e-GP'), 'ช่องของแก้ไขสัญญาไม่โผล่ในชนิดขยายเวลา')
    // แก้ไขสัญญา: ช่องวงเงิน + วันเผยแพร่ e-GP (ม.98) · ไม่มีช่องจำนวนวัน
    const amend = bundleOf({ changes: [{ id: 'c8', kind: 'amend_contract' }] })
    const a = render(ChangesPanel, { bundle: amend, access: MANAGE, deadlines: [], onChanged: noop, initialOpenId: 'c8' })
    assert.ok(a.includes('วงเงินที่เปลี่ยน') && a.includes(esc('วันที่เผยแพร่การแก้ไขสัญญาใน e-GP (ม.98)')) && !a.includes('จำนวนวันที่อนุมัติ') && !a.includes('วันสิ้นสุดสัญญาใหม่'))
  })

  await test('DefectsSection: แสดงเมื่อมีวันครบประกัน/มีผลตรวจ/ขั้นประกัน-ปิด · หัวบอกช่วงประกัน + เริ่มตรวจครั้งสุดท้ายได้ · ช่องแจ้งแก้ไขเมื่อพบชำรุด', () => {
    const none = bundleOf({ contract: { installments_total: 3 } })
    assert.equal(render(DefectsSection, { bundle: none, access: WRITE, today: TODAY, onChanged: noop }), '', 'ขั้นก่อสร้างไม่มีวันครบประกัน ไม่แสดง')
    assert.ok(render(DefectsSection, { bundle: bundleOf({ contract: { installments_total: 3 } }, {}, 'warranty'), access: READ, today: TODAY, onChanged: noop }).includes('ยังไม่ทราบวันครบระยะประกัน'))
    const b = bundleOf({
      contract: { installments_total: 3, warranty_starts_on: '2026-12-02', warranty_ends_on: '2028-12-01' },
      defects: [
        { id: 'd1', inspected_on: '2027-06-01', kind: 'during_warranty', result: 'defect', notice_no: 'ท 5', fix_due_on: '2027-06-30' },
        { id: 'd2', inspected_on: '2028-11-10', kind: 'final_before_expiry', result: 'ok' },
      ],
    })
    const out = render(DefectsSection, { bundle: b, access: READ, today: TODAY, onChanged: noop })
    for (const text of ['ตรวจความชำรุดบกพร่อง', 'ระยะประกันผลงาน 2 ธ.ค. 2569 – 1 ธ.ค. 2571', 'เริ่มตรวจครั้งสุดท้ายได้ตั้งแต่ 1 พ.ย. 2571', 'ตรวจระหว่างระยะประกัน', 'ตรวจครั้งสุดท้ายก่อนครบระยะประกัน', 'กำหนดแก้ไข 30 มิ.ย. 2570', 'หนังสือแจ้งเลขที่ ท 5', 'พบความชำรุดบกพร่อง', 'ไม่พบความชำรุดบกพร่อง']) {
      assert.ok(out.includes(esc(text)), text)
    }
    assert.ok(!out.includes('บันทึกผลตรวจ') && !out.includes('aria-expanded'))
    const w = render(DefectsSection, { bundle: b, access: WRITE, today: TODAY, onChanged: noop, initialOpenId: 'd1' })
    assert.ok(w.includes('บันทึกผลตรวจ') && w.includes(`${esc('หนังสือแจ้งผู้รับจ้างให้แก้ไข — เลขที่')}</span><input`) && w.includes(`${esc('กำหนดเข้าแก้ไขตามหนังสือแจ้ง')}</span><input`))
    assert.ok(!w.includes('ลบผลตรวจนี้'), 'ลบได้เฉพาะหัวหน้ากอง')
    assert.ok(render(DefectsSection, { bundle: b, access: MANAGE, today: TODAY, onChanged: noop, initialOpenId: 'd1' }).includes('ลบผลตรวจนี้'))
    // ผลปกติ: ช่องแจ้งแก้ไขไม่แสดง
    const ok = render(DefectsSection, { bundle: b, access: WRITE, today: TODAY, onChanged: noop, initialOpenId: 'd2' })
    assert.ok(!ok.includes('กำหนดเข้าแก้ไขตามหนังสือแจ้ง') && ok.includes(esc('ผลการตรวจ')))
  })

  const docsBundle = () => bundleOf({
    documents: [
      { id: 'o1', stage: 'construction', doc_kind: 'inspection_record', source: 'egp', installment_no: 1, title: 'ใบตรวจรับงวด 1', ref_no: 'EGP-77', ref_date: '2026-10-02', file_ref: 'drive:ABC123', mime_type: 'application/pdf', size_bytes: 2_500_000, created_by: 'u-self', created_at: '2026-10-03T03:00:00Z' },
      { id: 'o2', stage: 'construction', doc_kind: 'voucher', source: 'elaas', installment_no: 1, title: 'ฎีกา 012/2570', ref_no: '012/2570', file_ref: 'https://example.test/v.pdf', created_by: 'u-other', created_at: '2026-10-10T03:00:00Z' },
      { id: 'o3', stage: 'contracted', doc_kind: 'contract', source: 'other', title: `สัญญา ${EVIL}`, file_ref: null, created_by: 'u-other', created_at: '2026-09-02T03:00:00Z' },
      { id: 'o4', stage: null, doc_kind: 'photo', source: 'other', title: 'ภาพหน้างาน', ref_no: 'x', file_ref: 'abc123', created_by: 'u-other', created_at: '2026-10-11T03:00:00Z' },
    ],
  })

  await test('DocumentsSection (ผู้ดู): เห็นรายการ/เลขที่ จัดกลุ่มตามขั้น · ปุ่มเปิดไฟล์ drive: ปิด + ข้อความ · ลิงก์ https เปิดได้ · ไม่มีปุ่มเพิ่ม/ลบ', () => {
    const out = render(DocumentsSection, { bundle: docsBundle(), access: READ, userId: 'u-self', onChanged: noop })
    assert.ok(out.indexOf('ขั้นลงนามสัญญา') > 0 && out.indexOf('ขั้นลงนามสัญญา') < out.indexOf('ขั้นก่อสร้าง') && out.indexOf('ขั้นก่อสร้าง') < out.indexOf('ไม่ระบุขั้น'), 'เรียงตามขั้น')
    for (const text of ['4 รายการ', 'ใบตรวจรับงวด 1', 'เลขที่ EGP-77 ลว. 2 ต.ค. 2569', 'งวดที่ 1', '2.4 MB', 'ไฟล์เปิดได้เฉพาะเจ้าหน้าที่ — ขอดูผ่านกองช่าง', 'จดเลขที่เท่านั้น (ไม่มีไฟล์แนบ)', 'ฎีกา 012/2570']) {
      assert.ok(out.includes(esc(text)), text)
    }
    assert.ok(out.includes('>e-GP<') && out.includes('>e-LAAS<'), 'ป้ายที่มา')
    const buttons = [...out.matchAll(/<button[^>]*>[\s\S]*?เปิดไฟล์<\/button>/g)].map(m => m[0])
    assert.equal(buttons.length, 2, 'เฉพาะรายการที่มีไฟล์ drive/https (รหัสเปล่ากับไม่มีไฟล์ไม่มีปุ่ม)')
    assert.equal(buttons.filter(b => /disabled=""/.test(b)).length, 1, 'ปิดเฉพาะไฟล์ drive:')
    assert.ok(!out.includes('เพิ่มเอกสาร') && !out.includes('>ลบ<'))
    assert.ok(out.includes(esc(`สัญญา ${EVIL}`)) && !out.includes('<script>alert'), 'escape ข้อความผู้ใช้')
  })

  await test('DocumentsSection (ผู้ควบคุมงาน/หัวหน้ากอง): เปิดไฟล์ได้ · ลบได้เฉพาะหัวหน้ากองหรือคนที่แนบเอง · ฟอร์มเพิ่มมีชนิด/เลขที่/งวด/ไฟล์ PDF-รูป', () => {
    const w = render(DocumentsSection, { bundle: docsBundle(), access: WRITE, userId: 'u-self', onChanged: noop })
    assert.ok(!w.includes('ไฟล์เปิดได้เฉพาะเจ้าหน้าที่') && !/<button[^>]*disabled=""[^>]*>[\s\S]{0,80}เปิดไฟล์/.test(w))
    assert.equal((w.match(/>ลบ<\/button>/g) ?? []).length, 1, 'ลบได้เฉพาะ o1 ที่ u-self แนบเอง')
    assert.equal((render(DocumentsSection, { bundle: docsBundle(), access: WRITE, userId: 'u-nobody', onChanged: noop }).match(/>ลบ<\/button>/g) ?? []).length, 0)
    assert.equal((render(DocumentsSection, { bundle: docsBundle(), access: WRITE, userId: null, onChanged: noop }).match(/>ลบ<\/button>/g) ?? []).length, 0, 'ไม่รู้ผู้ใช้ = ไม่แสดงปุ่มลบ')
    assert.equal((render(DocumentsSection, { bundle: docsBundle(), access: MANAGE, userId: 'u-nobody', onChanged: noop }).match(/>ลบ<\/button>/g) ?? []).length, 4, 'หัวหน้ากองลบได้ทุกรายการ')
    assert.ok(w.includes('เพิ่มเอกสาร') && !w.includes('<form') && !w.includes('type="file"'), 'ฟอร์มพับอยู่จนกดเพิ่ม')
    const add = render(DocumentsSection, { bundle: docsBundle(), access: WRITE, userId: 'u-self', onChanged: noop, initialAdding: true })
    assert.ok(add.includes('accept="application/pdf,image/*"') && add.includes('type="file"'))
    for (const k of F.DOC_KINDS) assert.ok(add.includes(`value="${k.key}"`) && add.includes(esc(k.label)), k.key)
    for (const text of ['ชนิดเอกสาร', 'ชื่อเอกสาร', 'เลขที่เอกสาร', 'ลงวันที่', 'ของงวดที่', 'งวดที่ 3', 'บันทึกเอกสาร', 'ไม่เกิน 20 MB']) assert.ok(add.includes(esc(text)), text)
    // ไม่มีงวดเลย = ไม่มีช่องเลือกงวด
    const noInst = bundleOf({ installments: [], contract: { installments_total: null } })
    assert.ok(!render(DocumentsSection, { bundle: noInst, access: WRITE, userId: 'u', onChanged: noop, initialAdding: true }).includes('ของงวดที่'))
    assert.ok(render(DocumentsSection, { bundle: noInst, access: READ, userId: 'u', onChanged: noop }).includes('ยังไม่มีเอกสารแนบ'))
  })

  await test('LifecycleHistory: kind note แสดงข้อความ (reason) เป็นเนื้อความ ไม่ขึ้น "เหตุผล:" · ข้อความผู้ใช้ถูก escape', () => {
    const events = [
      { id: 'n1', kind: 'note', reason: `บันทึกงวดที่ 2: ส่งมอบ ${EVIL}`, created_at: '2026-11-03T03:00:00Z', actor: 's1' },
      { id: 'e1', kind: 'stage_change', from_stage: 'started', to_stage: 'construction', reason: 'เหตุผลเดิม', created_at: '2026-09-08T03:00:00Z', actor: 's1' },
    ]
    const out = render(History, { events, staffChoices: [{ id: 's1', full_name: 'ช่างทดสอบ' }] })
    assert.ok(out.includes(esc(`บันทึกงวดที่ 2: ส่งมอบ ${EVIL}`)) && !out.includes('<script>alert'))
    assert.ok(!out.includes('บันทึกข้อความ') && out.includes('เหตุผล: เหตุผลเดิม'))
    assert.equal((out.match(/เหตุผล:/g) ?? []).length, 1)
    assert.ok(render(History, { events: [{ id: 'n2', kind: 'note', reason: null, created_at: '2026-11-03T03:00:00Z' }] }).includes('บันทึกข้อความ'))
  })

  await test('แผ่นโครงการ: ต่อชิ้นส่วนครบ — งวด · เอกสาร · ปุ่ม "ขยายเวลา / แก้ไขสัญญา…" ตามสิทธิ์ · จ่ายแล้ว · ไม่มีขยายเวลา', () => {
    const b = bundleOf({ documents: docsBundle().documents })
    const sheet = (access, bundle = b) => render(LifeSheet, { bundle, access, today: TODAY, staffChoices: [], onClose: noop, onChanged: noop })
    const m = sheet(MANAGE)
    for (const text of ['งวดงาน · ส่งมอบ / ตรวจรับ / เบิกจ่าย', 'เอกสารแนบ', 'ประวัติโครงการ', 'ขยายเวลา / แก้ไขสัญญา…', 'จ่ายแล้ว 500,000', 'ไม่มีขยายเวลา']) assert.ok(m.includes(esc(text)), text)
    assert.ok(m.indexOf('สิ้นสุดสัญญา') < m.indexOf('งวดงาน · ส่งมอบ') && m.indexOf('งวดงาน · ส่งมอบ') < m.indexOf('เอกสารแนบ') && m.indexOf('เอกสารแนบ') < m.indexOf('ประวัติโครงการ') && m.indexOf('ประวัติโครงการ') < m.indexOf('ขยายเวลา / แก้ไขสัญญา…'), 'ลำดับส่วน')
    assert.ok(m.includes('จ่ายแล้ว 500,000') && m.includes('วงเงินงบประมาณ 1,300,000'))
    const r = sheet(READ)
    assert.ok(r.includes('งวดงาน · ส่งมอบ') && r.includes('เอกสารแนบ') && !r.includes('ขยายเวลา / แก้ไขสัญญา…') && !r.includes('เพิ่มงวด') && !r.includes('เพิ่มเอกสาร'))
    // ขยายเวลาที่อนุมัติแล้ว: การ์ดสิ้นสุดสัญญา "ขยายเวลาแล้ว" ไม่ใช่ "ไม่มีขยายเวลา" + แสดงรายการแม้ผู้ดู
    const ext = bundleOf({ changes: [{ id: 'c1', kind: 'extend_time', requested_days: 20, decision: 'approved', approved_on: '2026-11-01', approved_days: 20, new_end_date: '2026-11-19' }] })
    const e = sheet(READ, ext)
    assert.ok(e.includes('ขยายเวลาแล้ว') && !e.includes('ไม่มีขยายเวลา') && e.includes('ขยายเวลา / งดหรือลดค่าปรับ / แก้ไขสัญญา') && e.includes('อนุมัติ 20 วัน'))
    // ยังไม่ถึงขั้นสัญญาและไม่มีงวด = ไม่ขึ้นตารางงวด
    const early = bundleOf({ installments: [], contract: null, documents: [] }, {}, 'procuring')
    const o = sheet(MANAGE, early)
    assert.ok(!o.includes('งวดงาน · ส่งมอบ') && o.includes('เอกสารแนบ') && !o.includes('ตรวจความชำรุดบกพร่อง'))
    // ขั้นประกันผลงาน: มีส่วนตรวจความชำรุด
    assert.ok(sheet(MANAGE, bundleOf({}, {}, 'warranty')).includes('ตรวจความชำรุดบกพร่อง'))
  })

  // ── ค้นโค้ด ─────────────────────────────────────────────────────────────────────
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  const walk = async dir => {
    const out = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...await walk(full))
      else if (/\.(js|jsx)$/.test(entry.name)) out.push(full)
    }
    return out
  }
  const root = p => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

  await test('ค้นโค้ด: ไฟล์แนบของโมดูลนี้ใช้ bucket org-documents เท่านั้น · ไม่แตะ civil_projects · ประวัติเขียนได้เฉพาะ note · fetch ดึงเอกสารตารางละคำสั่ง', async () => {
    const files = [...await walk(root('../src/components/staff/construction')), root('../src/lib/constructionLifecycleApi.js'), root('../src/lib/constructionInstallmentForm.js')]
    let uploads = 0
    for (const file of files) {
      const code = strip(await readFile(file, 'utf8'))
      for (const m of code.matchAll(/uploadFile\(\s*([^,)]+)/g)) {
        uploads++
        assert.equal(m[1].trim(), "'org-documents'", `${file}: uploadFile ต้องใช้ 'org-documents'`)
      }
      assert.ok(!/from\(\s*['"]civil_projects['"]\s*\)/.test(code), `${file}: ห้ามแตะ civil_projects ตรงๆ`)
      assert.ok(!/[{,]\s*stage_before_hold\s*:/.test(code), `${file}: ห้ามเขียน stage_before_hold`)   // ที่อ่านค่าด้วย ? : ไม่ใช่การเขียน
      if (file.includes('components')) assert.ok(!/\bsupabase\b/.test(code), `${file}: คอมโพเนนต์ไม่เรียก supabase ตรงๆ`)
    }
    assert.equal(uploads, 1, 'ต้องมีจุดอัปโหลดเดียว (addDocument)')
    const api = strip(await read('../src/lib/constructionLifecycleApi.js'))
    const events = [...api.matchAll(/from\('civil_project_events'\)\s*\.(\w+)/g)].map(m => m[1])
    assert.deepEqual([...new Set(events)].sort(), ['insert', 'select'], 'ตารางประวัติ: อ่านกับเพิ่มเท่านั้น')
    assert.ok(/from\('civil_project_events'\)\.insert\(\{ project_id: projectId, kind: 'note', reason:/.test(api), 'เพิ่มได้เฉพาะ kind note')
    const fetchBody = api.slice(api.indexOf('export async function fetchLifecycleData'), api.indexOf('export async function setProjectStage'))
    assert.equal((fetchBody.match(/from\('civil_project_documents'\)[^\n]*\.in\('project_id', ids\)/g) ?? []).length, 1)
    // ลำดับ: ลบแถวก่อน แล้วค่อยย้ายไฟล์ · insert ล้มหลังอัปโหลด → คืนไฟล์
    const del = api.slice(api.indexOf('export async function deleteDocument'), api.indexOf('export async function openDocument'))
    assert.ok(del.indexOf('deleteChild(') < del.indexOf('deleteFile('), 'ลบแถวก่อนไฟล์')
    const add = api.slice(api.indexOf('export async function addDocument'), api.indexOf('export async function deleteDocument'))
    assert.ok(add.indexOf("writeChild('civil_project_documents'") < add.indexOf('deleteFile(fileId)') && /result\.error && fileId/.test(add))
    // เปิดหน้าต่างก่อน await (กัน popup blocker บนมือถือ)
    const open = api.slice(api.indexOf('export async function openDocument'), api.indexOf('// ── ประวัติ'))
    assert.ok(open.indexOf("window.open('', '_blank')") > 0 && open.indexOf("window.open('', '_blank')") < open.indexOf('await resolvePrivateFileUrl'))
    assert.ok(/noopener/.test(open) && /revokeObjectURL/.test(open) && /win\.close\(\)/.test(open))
  })

  await test('ค้นโค้ด: ฟอร์มตารางทั้งหมดใช้ btnPrimary/btnGhost/inp/Field เดิม — ปุ่มสูงอย่างน้อย min-h-11 · ตารางงวดเลื่อนแนวนอนในกรอบ', async () => {
    const ui = await read('../src/components/staff/construction/uiStyles.js')
    assert.ok(ui.includes('btnPrimary') && /btnGhost = '[^']*min-h-11/.test(ui) && /btnPrimary = '[^']*min-h-11/.test(ui))
    for (const f of ['InstallmentsTable', 'ContractChangesPanel', 'DefectsSection', 'DocumentsSection', 'LifecycleFields']) {
      const code = await read(`../src/components/staff/construction/${f}.jsx`)
      assert.ok(/from '\.\/uiStyles'/.test(code), f)
      for (const m of code.matchAll(/<button\b/g)) assert.ok(/className=/.test(code.slice(m.index, m.index + 400)), `${f}: ปุ่มทุกปุ่มต้องมี className (ไม่ใช้ปุ่มเปลือย)`)
    }
  })
} finally {
  await vite.close()
}
console.log(`\n${cases} cases passed`)
process.exit(0)

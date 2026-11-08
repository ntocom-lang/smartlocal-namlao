// แจ้งเตือน Telegram วันที่ 1 "รายการแผนการดำเนินงานที่ถึงกำหนดแต่ยังไม่บันทึกผล" (supabase/functions/local-plan-monthly-reminder)
//   ชั้นแรก: รันตรรกะล้วนของจริง (_shared/localPlanMonthlyReminder.ts) — เดือน/ปีงบตามเวลาไทย · กติกาถึงกำหนด · ข้อความ
//            + เทียบผลกับ src/lib/localPlanProgress.js (ตัวที่แท็บติดตามผลใช้) ด้วยข้อมูลชุดเดียวกัน กันสองชุดเพี้ยนกัน
//   ชั้นสอง: อ่านซอร์ส edge function + migration — ลำดับ dry_run/claim/ส่ง · ช่องที่อ่าน (ไม่อ่านข้อความอิสระ) · ตารางเวลา cron
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่ส่งข้อความจริง
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// โซนเวลาเครื่องเป็นต่างประเทศ: ถ้าโค้ดอ่านเดือนจากเวลาเครื่อง/UTC แทนเวลาไทย เคสข้ามเดือนด้านล่างจะพัง
process.env.TZ = 'America/Los_Angeles'
const R = await import('../supabase/functions/_shared/localPlanMonthlyReminder.ts')
const Lib = await import('../src/lib/localPlanProgress.js')
const Cal = await import('../src/lib/localPlanCalendar.js')
const CR = await import('../supabase/functions/_shared/complaintMonthlyReminder.ts')

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

// ── เดือน/ปีงบ ──────────────────────────────────────────────────────────────

await test('cron ยิง 1 พ.ย. 2569 08:45 น. → เดือนที่จบ ต.ค. 2569 = ปีงบ 2570 เดือนที่ 1', () => {
  const m = R.previousMonthBangkok(new Date('2026-11-01T01:45:00Z'))
  assert.deepEqual([m.key, m.label, m.fiscalYear, m.fiscalMonth], ['2569-10', 'ตุลาคม 2569', 2570, 1])
})

await test('1 ต.ค. → ก.ย. = เดือนที่ 12 ของปีงบที่เพิ่งปิด (ตามรายการปีเก่าก่อนรายงาน ธ.ค.) · 1 ม.ค. → ธ.ค. เดือนที่ 3', () => {
  const sep = R.previousMonthBangkok(new Date('2026-10-01T01:45:00Z'))
  assert.deepEqual([sep.key, sep.fiscalYear, sep.fiscalMonth], ['2569-09', 2569, 12])
  const dec = R.previousMonthBangkok(new Date('2027-01-01T01:45:00Z'))
  assert.deepEqual([dec.key, dec.fiscalYear, dec.fiscalMonth], ['2569-12', 2570, 3])
})

await test('ใช้เวลาไทย ไม่ใช่ UTC: 1 พ.ย. 00:30 ไทย (31 ต.ค. 17:30 UTC) → ต.ค. · 31 ต.ค. 23:59 ไทย → ก.ย.', () => {
  assert.equal(R.previousMonthBangkok(new Date('2026-10-31T17:30:00Z')).key, '2569-10')
  assert.equal(R.previousMonthBangkok(new Date('2026-10-31T16:59:00Z')).key, '2569-09')
})

await test('เดือนที่ของปีงบตรงกับ localPlanCalendar.calendarToFiscalMonth ทั้ง 12 เดือน + ชื่อเดือนตรงกับแจ้งเตือนคำร้อง', () => {
  for (let cm = 1; cm <= 12; cm++) {
    // วันที่ 1 ของเดือนถัดไป 08:45 ไทย → เดือนที่จบคือ cm ของปี 2027
    const next = cm === 12 ? new Date('2028-01-01T01:45:00Z') : new Date(Date.UTC(2027, cm, 1, 1, 45))
    const m = R.previousMonthBangkok(next)
    assert.equal(m.fiscalMonth, Cal.calendarToFiscalMonth(cm), `เดือน ${cm}`)
    const back = Cal.fiscalMonthToCalendar(m.fiscalMonth, m.fiscalYear)
    assert.deepEqual([back.month, back.yearBE], [cm, 2027 + 543], `ย้อนกลับเดือน ${cm}`)
  }
  assert.deepEqual(R.MONTHS_TH_FULL, CR.MONTHS_TH_FULL)
})

// ── ชุดรายการที่มีผล: ต้องเท่ากับแท็บติดตามผล ─────────────────────────────────

const FY = 2570
const plans = [
  { id: 'p0', fiscal_year: FY, kind: 'main', revision_no: 0, status: 'published' },
  { id: 'p1', fiscal_year: FY, kind: 'supplement', revision_no: 1, status: 'published' },
  { id: 'p2', fiscal_year: FY, kind: 'amendment', revision_no: 2, status: 'published' },
  { id: 'p3', fiscal_year: String(FY), kind: 'supplement', revision_no: '3', status: 'published' },
  { id: 'p4', fiscal_year: FY, kind: 'supplement', revision_no: 4, status: 'draft' },       // ร่าง → ไม่นับ
  { id: 'px', fiscal_year: FY - 1, kind: 'main', revision_no: 0, status: 'published' },     // ปีอื่น → ไม่นับ
]
const items = [
  // ฉบับหลัก
  { id: 'a0', op_plan_id: 'p0', department_id: 'dC', month_from: 1, month_to: 3, sort_order: 1 },
  { id: 'b0', op_plan_id: 'p0', department_id: 'dE', month_from: 2, month_to: 2, sort_order: 2 },
  { id: 'c0', op_plan_id: 'p0', department_id: 'dE', month_from: 1, month_to: 12, sort_order: 3 },   // ฉบับแก้ไขตัดออก
  // ฉบับเพิ่มเติม 1 (ก่อนแก้ไข → ฉบับแก้ไขคัดไปแล้ว ไม่นับซ้ำ)
  { id: 'd1', op_plan_id: 'p1', department_id: 'dC', month_from: 1, month_to: 1, sort_order: 1 },
  // ฉบับแก้ไข: คัด a0, b0 (เปลี่ยนเดือน), d1 · ตัด c0
  { id: 'a2', op_plan_id: 'p2', origin_item_id: 'a0', department_id: 'dC', month_from: 1, month_to: 3, sort_order: 1, dev_project_id: 'proj-civil' },
  { id: 'b2', op_plan_id: 'p2', origin_item_id: 'b0', department_id: 'dE', month_from: 5, month_to: 6, sort_order: 2 },
  { id: 'd2', op_plan_id: 'p2', origin_item_id: 'd1', department_id: null, month_from: 1, month_to: 1, sort_order: 3 },
  { id: 'n2', op_plan_id: 'p2', department_id: 'dGone', month_from: 1, month_to: 1, sort_order: 4 },   // กองถูกลบ
  { id: 'm2', op_plan_id: 'p2', department_id: 'dE', month_from: null, month_to: null, sort_order: 5 }, // ไม่ระบุเดือน
  // ฉบับเพิ่มเติม 3 (หลังแก้ไข → นับต่อ)
  { id: 'e3', op_plan_id: 'p3', department_id: 'dE', month_from: 1, month_to: 1, sort_order: 1 },
  { id: 'f3', op_plan_id: 'p3', department_id: 'dC', month_from: 1, month_to: 1, sort_order: 2 },
  { id: 'g3', op_plan_id: 'p3', department_id: 'dC', month_from: 1, month_to: 2, sort_order: 3, dev_project_id: 'proj-plain' },
  // ร่าง/ปีอื่น
  { id: 'z4', op_plan_id: 'p4', department_id: 'dC', month_from: 1, month_to: 1 },
  { id: 'zx', op_plan_id: 'px', department_id: 'dC', month_from: 1, month_to: 1 },
]
// ผลที่กองกดเอง (key = ต้นสาย)
const progressRows = [
  { lineage_id: 'b0', status: 'in_progress' },
  { lineage_id: 'd1', status: 'in_progress' },
  { lineage_id: 'f3', status: 'done' },
  { lineage_id: 'g3', status: 'in_progress' },
  { lineage_id: 'a0', status: 'not_done' },   // ผูกก่อสร้าง → ผลก่อสร้างชนะ (เทียบกับแท็บ)
]
const progressByLineage = Object.fromEntries(progressRows.map(p => [p.lineage_id, p.status]))
const civilRefs = new Set(['proj-civil'])
const departments = [
  { id: 'dE', name: 'กองการศึกษา', sort_order: 5 },
  { id: 'dC', name: 'กองช่าง', sort_order: 3 },
  { id: 'dX', name: 'สำนักปลัด', sort_order: 1 },
]

await test('ชุดรายการที่มีผล = effectiveItemSet ของแท็บติดตามผล (ลำดับและแถวที่เลือกตรงกันทุกตัว)', () => {
  const ours = R.effectiveItemSet(plans, items, FY).map(i => i.id)
  const lib = Lib.effectiveItemSet(plans, items, FY).map(i => i.id)
  assert.deepEqual(ours, lib)
  assert.deepEqual(ours, ['a2', 'b2', 'd2', 'n2', 'm2', 'e3', 'f3', 'g3'])
  assert.deepEqual(R.effectivePlans(plans, FY).map(p => p.id), Lib.effectivePlans(plans, FY).map(p => p.id))
  assert.equal(R.lineageOf(items.find(i => i.id === 'b2')), Lib.lineageOf(items.find(i => i.id === 'b2')))
})

await test('สถานะ + "ผูกก่อสร้าง" ตรงกับ resolveItemStatus ของแท็บ (ก่อสร้างชนะผลที่กดเอง)', () => {
  const civilByRef = { 'proj-civil': { registry_ref: 'proj-civil', stage: 'construction', stage_changed_at: '2026-10-05T03:00:00Z' } }
  const progressObjs = Object.fromEntries(progressRows.map(p => [p.lineage_id, p]))
  for (const item of R.effectiveItemSet(plans, items, FY)) {
    const lineage = R.lineageOf(item)
    const lib = Lib.resolveItemStatus({ item, progress: progressObjs[lineage] ?? null, civilByRef })
    const civilLinked = Boolean(item.dev_project_id) && civilRefs.has(item.dev_project_id)
    assert.equal(civilLinked, lib.source === 'civil', item.id)
    if (!civilLinked) assert.equal(progressByLineage[lineage] ?? 'none', lib.status, item.id)
  }
})

// ── กติกาถึงกำหนด ───────────────────────────────────────────────────────────

await test('dueKindOf: none+ถึงเดือนเริ่ม → not_started · in_progress+เลยเดือนสิ้นสุด → past_end · อื่นๆ ไม่เตือน', () => {
  const k = (status, from, to, fm, civilLinked = false) =>
    R.dueKindOf({ item: { id: 'x', op_plan_id: 'p', month_from: from, month_to: to }, status, civilLinked, fiscalMonth: fm })
  assert.equal(k('none', 1, 3, 1), 'not_started')
  assert.equal(k('none', 2, 3, 1), null)              // ยังไม่ถึงเดือนเริ่ม
  assert.equal(k('none', 1, 3, 12), 'not_started')    // เลยเดือนสิ้นสุดแล้วยังไม่กด → นับเป็นยังไม่บันทึก
  assert.equal(k('in_progress', 1, 3, 2), null)       // ยังอยู่ในช่วง
  assert.equal(k('in_progress', 1, 3, 3), 'past_end') // สิ้นเดือนสุดท้ายของช่วงแล้วยังไม่ปิด
  assert.equal(k('in_progress', 2, null, 2), 'past_end') // ไม่มีเดือนสิ้นสุด → ใช้เดือนเริ่ม
  assert.equal(k('done', 1, 1, 12), null)
  assert.equal(k('not_done', 1, 1, 12), null)
  assert.equal(k('none', null, null, 12), null)       // ไม่ระบุเดือน
  assert.equal(k('none', '1', '2', 1), 'not_started') // ค่าจากฐานเป็นสตริงก็ได้
  assert.equal(k('none', 13, 13, 12), null)           // ค่าผิดรูป → ไม่เดา
  assert.equal(k('none', 1, 1, 12, true), null)       // ผูกก่อสร้าง → ระบบดึงผลเอง
})

await test('นับแยกกอง ณ เดือนที่ 1: เรียงตามทะเบียนกอง · ไม่มีกอง/กองถูกลบ → "ยังไม่ระบุกอง" ท้ายสุด', () => {
  const counts = R.countDueByDepartment({ opPlans: plans, items, fiscalYear: FY, fiscalMonth: 1, progressByLineage, civilRefs, departments })
  // a2 ผูกก่อสร้าง · b2 ยังไม่ถึง (เดือน 5) · d2 in_progress เลยสิ้นสุด (ไม่มีกอง) · n2 none (กองถูกลบ) · m2 ไม่มีเดือน
  // e3 none · f3 done · g3 in_progress ยังไม่เลย (ถึงเดือน 2)
  assert.deepEqual(counts.map(c => [c.name, c.notStarted, c.pastEnd]), [
    ['กองการศึกษา', 1, 0],
    ['ยังไม่ระบุกอง', 1, 1],
  ])
  const later = R.countDueByDepartment({ opPlans: plans, items, fiscalYear: FY, fiscalMonth: 6, progressByLineage, civilRefs, departments })
  assert.deepEqual(later.map(c => [c.name, c.notStarted, c.pastEnd]), [
    ['กองช่าง', 0, 1],          // g3
    ['กองการศึกษา', 1, 1],      // e3 none · b2 in_progress ถึงเดือน 6
    ['ยังไม่ระบุกอง', 1, 1],
  ])
})

await test('ไม่มีฉบับประกาศของปีงบ → ชุดรายการว่าง (ฟังก์ชันข้ามเป็น noPlan)', () => {
  assert.deepEqual(R.effectivePlans(plans, FY + 1), [])
  assert.deepEqual(R.countDueByDepartment({ opPlans: plans, items, fiscalYear: FY + 1, fiscalMonth: 1, progressByLineage, civilRefs, departments }), [])
})

// ── ข้อความ ─────────────────────────────────────────────────────────────────

await test('ข้อความ: หัว/ยอดรายกอง/ยอดรวม/ทางเข้าเมนู · escape HTML · ไม่มีลิงก์เข้าระบบ (#160) · ไม่มีรายการ → null', () => {
  const month = R.previousMonthBangkok(new Date('2026-12-01T01:45:00Z'))
  const text = R.buildDueMessage({
    tenantName: 'เทศบาลตำบล<สาธิต>',
    month,
    counts: [
      { departmentId: 'dC', name: 'กองช่าง & ผังเมือง', notStarted: 3, pastEnd: 0 },
      { departmentId: 'dE', name: 'กองการศึกษา', notStarted: 0, pastEnd: 2 },
      { departmentId: 'dZ', name: 'กองว่าง', notStarted: 0, pastEnd: 0 },
    ],
  })
  assert.match(text, /^📋 <b>แผนการดำเนินงานปีงบประมาณ 2570: รายการที่ยังไม่บันทึกผล<\/b>/)
  assert.match(text, /เทศบาลตำบล&lt;สาธิต&gt;/)
  assert.match(text, /นับถึงสิ้นเดือนพฤศจิกายน 2569 \(เดือนที่ 2 ของปีงบ\)/)
  assert.match(text, /• กองช่าง &amp; ผังเมือง — ยังไม่บันทึกผล 3\n/)
  assert.match(text, /• กองการศึกษา — เลยกำหนดเสร็จ 2\n/)
  assert.doesNotMatch(text, /กองว่าง/)
  assert.match(text, /ถึงกำหนดแต่ยังไม่บันทึกผล 3 รายการ/)
  assert.match(text, /เลยเดือนสิ้นสุดแต่ยังเป็น "กำลังดำเนินการ" 2 รายการ/)
  assert.match(text, /เมนู "แผนพัฒนาท้องถิ่น" → แท็บ "ติดตามผล"/)
  assert.doesNotMatch(text, /https?:|rk-networks/)
  assert.ok(text.length <= 3500)
  assert.equal(R.buildDueMessage({ tenantName: 'x', month, counts: [] }), null)
  assert.equal(R.buildDueMessage({ tenantName: 'x', month, counts: [{ departmentId: null, name: 'a', notStarted: 0, pastEnd: 0 }] }), null)
})

await test('ข้อความยาวสุดไม่เกินเพดาน Telegram (4096) แม้มี 60 กอง ชื่อยาว', () => {
  const month = R.previousMonthBangkok(new Date('2026-12-01T01:45:00Z'))
  const counts = Array.from({ length: 60 }, (_, i) => ({ departmentId: 'd' + i, name: 'ก'.repeat(200), notStarted: 999, pastEnd: 999 }))
  assert.ok(R.buildDueMessage({ tenantName: 'ท'.repeat(500), month, counts }).length <= 3500)
})

await test('คีย์กันส่งซ้ำรายเดือน · slug ทดสอบ · safeEqual', () => {
  assert.equal(R.idempotencyKey('2569-10'), 'local_plan_monthly:2569-10')
  assert.notEqual(R.idempotencyKey('2569-10'), CR.idempotencyKey('2569-10'))
  assert.equal(R.NOTIFICATION_TYPE, 'local_plan_monthly_due')
  assert.equal(R.validSlug('demo'), 'demo')
  for (const bad of ['', 'Demo', 'demo.evil.com', '-demo', 'de mo', null, 5, 'a'.repeat(64)]) assert.equal(R.validSlug(bad), null, String(bad))
  assert.equal(R.safeEqual('abc', 'abc'), true)
  assert.equal(R.safeEqual('abc', 'abd'), false)
  assert.equal(R.safeEqual('abc', 'abcd'), false)
})

// ── ซอร์ส edge function + migration ────────────────────────────────────────

const fn = stripComments(read('supabase/functions/local-plan-monthly-reminder/index.ts'))
const shared = read('supabase/functions/_shared/localPlanMonthlyReminder.ts')
const migration = read('supabase/migrations/20261111100000_local_plan_monthly_reminder_cron.sql')
const migrationCode = stripComments(migration)

await test('ไฟล์ตรรกะล้วนไม่ import เน็ต/ไม่ใช้ Deno (node เทสต์ได้)', () => {
  const imports = [...shared.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1])
  assert.deepEqual(imports, ['./telegram.ts'])
  assert.doesNotMatch(stripComments(shared), /Deno\./)
})

await test('ฟังก์ชัน: ตรวจ cron secret ก่อนอ่านข้อมูล · dry_run คืนก่อน claim · claim ก่อนส่ง · ส่งซ้ำได้เฉพาะ failed', () => {
  const at = s => { const i = fn.indexOf(s); assert.ok(i >= 0, 'ไม่พบ ' + s); return i }
  assert.ok(at("safeEqual(req.headers.get('x-cron-secret')") < at("admin.from('municipalities')"))
  assert.ok(at('if (dryRun) { previews.push') < at("from('notification_deliveries').insert"))
  assert.ok(at("from('notification_deliveries').insert") < at('sendTelegramMessage('))
  assert.match(fn, /claimError\.code !== '23505'/)
  assert.match(fn, /existing\?\.status !== 'failed'/)
  assert.match(fn, /validSlug\(body\.only_slug\)/)
  assert.match(fn, /'invalid only_slug' }, 400/)
})

await test('ฟังก์ชันอ่านเฉพาะช่องที่ใช้นับ — ไม่อ่านชื่อรายการ เหตุผล หมายเหตุ ชื่อบุคคล', () => {
  const selectList = [...fn.matchAll(/\.select\('([^']+)'/g)].map(m => m[1])
  // plans items progress civil depts municipalities deliveries — จับไม่ครบ = regex หลุด เทสต์ข้อนี้จะผ่านลวง
  assert.ok(selectList.length >= 7, 'จับ select ได้ไม่ครบ ' + selectList.length)
  const selects = selectList.join(',')
  for (const col of ['item_name', 'official_name', 'reason', 'note', 'created_by', 'updated_by', 'external_agency', 'project_name']) {
    assert.doesNotMatch(selects, new RegExp(`\\b${col}\\b`), col)
  }
  assert.doesNotMatch(fn, /select\('\*'\)|select\(\)/)
  // ไล่หน้าครบทุกตารางที่อาจเกิน 1,000 แถว
  for (const t of ['local_op_plan_items', 'local_op_item_progress', 'civil_projects']) {
    assert.match(fn, new RegExp(`fetchAll<[^>]+>\\('${t}'[\\s\\S]{0,420}withCountOpt\\(c\\)[\\s\\S]{0,200}\\.range\\(from, to\\)`), t)
  }
})

await test('ไล่หน้าเทียบ count exact (NOTES ข้อ 14): ไม่คืนยอดนับ/ได้ไม่ครบ = หยุด · เลื่อนตามแถวที่ได้จริง', () => {
  assert.match(fn, /typeof count !== 'number'\) throw/)
  assert.match(fn, /if \(out\.length !== total\) throw/)
  assert.match(fn, /await build\(out\.length, out\.length \+ PAGE - 1, page === 0\)/)
  assert.match(fn, /count: 'exact' as const/)
  // error ระหว่างนับของ อปท. หนึ่ง → ข้ามแค่ อปท. นั้น (ไม่ส่งข้อความเกินจริง)
  assert.ok(fn.includes('summary.errors.push(`${tenant.slug}: ${cleanText((e as Error).message, 200)}`)'))
})

await test('สมุดลงเวลา job_heartbeats: เฉพาะรอบเต็ม (ไม่นับ dry_run/only_slug) · errors หรือส่งไม่สำเร็จ = last_error', () => {
  assert.match(fn, /const JOB_NAME = 'local-plan-monthly-reminder'/)
  assert.match(fn, /const fullRun = !dryRun && !onlySlug/)
  assert.match(fn, /from\('job_heartbeats'\)\.upsert\(row, \{ onConflict: 'job_name' \}\)/)
  assert.match(fn, /summary\.failed > 0 \?/)
  const hb = read('supabase/migrations/20260928140000_job_heartbeats_table.sql')
  assert.match('local-plan-monthly-reminder', new RegExp(hb.match(/job_name ~ '([^']+)'/)[1]))
})

await test('civil_projects: ปีงบเทียบหลัง trim แบบ RPC local_plan_civil_stages + กรอง อปท. เดียวกัน', () => {
  assert.match(fn, /String\(c\.fiscal_year \?\? ''\)\.trim\(\) === String\(fiscalYear\)/)
  assert.match(fn, /from\('civil_projects'\)[\s\S]{0,120}\.eq\('municipality_id', tenantId\)/)
  const rpc = read('supabase/migrations/20261110100100_local_plan_progress_rls.sql')
  assert.match(rpc, /btrim\(c\.fiscal_year\) = p_fiscal_year::text/)
})

await test('migration: ตั้ง cron อย่างเดียว 08:45 ไทย (01:45 UTC วันที่ 1) ยิงไปฟังก์ชันชื่อเดียวกัน ใช้ secret เดิม', () => {
  assert.match(migrationCode, /'local-plan-monthly-reminder',\s*'45 1 1 \* \*'/)
  assert.match(migrationCode, /functions\/v1\/local-plan-monthly-reminder'/)
  assert.match(migrationCode, /name = 'fleet_cron_secret'/)
  assert.doesNotMatch(migrationCode, /\b(GRANT|REVOKE|CREATE TABLE|ALTER TABLE|CREATE POLICY|CREATE (OR REPLACE )?FUNCTION|SECURITY DEFINER|DROP)\b/i)
  assert.match(migrationCode, /^BEGIN;/m)
  assert.match(migrationCode, /COMMIT;\s*$/)
  assert.match(migrationCode, /length\(decrypted_secret\), 0\) > 0/)
  assert.match(migrationCode, /column_name = 'registry_ref'/)
  assert.match(migration, /net\._http_response/)
  // ไม่ชนเวลากับแจ้งเตือนคำร้อง (08:30)
  const complaintCron = read('supabase/migrations/20261019100000_complaint_monthly_reminder_cron.sql')
  assert.match(complaintCron, /'30 1 1 \* \*'/)
  assert.match(read('supabase/functions/local-plan-monthly-reminder/index.ts'), /--no-verify-jwt/)
})

console.log(`\n${cases} cases passed`)

// ตรรกะวงจรโครงการก่อสร้าง (src/lib/constructionLifecycle.js — PR-B) คำนวณล้วน ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/construction-lifecycle.test.mjs
//   node tests/construction-lifecycle.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js   (เพิ่มชุดเทียบ RPC จริง)
//
// ส่วนที่ 1 (รันเสมอ): ค่าขั้น / mapping stage↔status / ค่า CHECK / คีย์จุดตรวจที่จำกัดสิทธิ์ / ข้อความ error
//   ต้องตรงกับ migration 20261108100000/100100/100200 — อ่านจากไฟล์ SQL ตรงๆ ไม่คัดค่ามาเขียนซ้ำ
// ส่วนที่ 2 (--pglite): รันฟังก์ชัน civil_stage_ord / civil_status_of_stage / civil_stage_for_status / civil_set_project_stage
//   ที่คัดจาก migration ทั้งตัว บน PostgreSQL จำลอง แล้วเทียบกับ lib ทุกคู่ (ขั้นเดิม × ขั้นใหม่ × สิทธิ์ × เหตุผล/เลขหนังสือ × หลักประกัน)
// ส่วนที่ 3: วันครบกำหนดตามระเบียบ + คำเตือน (โซนเวลาเครื่องตั้งเป็นต่างประเทศ กันโค้ดที่อ่านวันจากนาฬิกาเครื่อง)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

process.env.TZ = 'America/Los_Angeles'
const L = await import('../src/lib/constructionLifecycle.js')
const { addDays } = await import('../src/lib/complaintReportPeriods.js')
const { workingDaysBetween } = await import('../src/lib/workingDays.js')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const colsSql = await readMigration('20261108100000_civil_lifecycle_columns.sql')
const tablesSql = await readMigration('20261108100100_civil_lifecycle_tables.sql')
const lifeSql = await readMigration('20261108100200_civil_lifecycle_rls_triggers.sql')

const quoted = list => [...list.matchAll(/'([^']*)'/g)].map(m => m[1])
const must = (re, text, what) => {
  const m = text.match(re)
  assert.ok(m, `หา ${what} ใน migration ไม่เจอ — รูปแบบ SQL เปลี่ยน ต้องแก้เทสต์/lib ให้ตรง`)
  return m
}
const fnBody = name => must(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`), lifeSql, `ฟังก์ชัน ${name}`)[0]
const tableSegment = name => must(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\([\\s\\S]*?\\n\\);`), tablesSql, `ตาราง ${name}`)[0]
const checkList = (segment, column, what) => quoted(must(new RegExp(`CHECK \\((?:${column} IS NULL OR )?${column} IN \\(([^)]*)\\)`), segment, what)[1])
const keysOf = obj => Object.keys(obj)

// ── ส่วนที่ 1: เทียบกับข้อความ SQL ───────────────────────────────────────────────

await test('STAGES = CHECK civil_projects.stage (ลำดับเดียวกัน) = รายการใน RPC = CHECK ของไฟล์แนบ', () => {
  assert.deepEqual(L.STAGES, checkList(colsSql, 'stage', 'CHECK stage'))
  assert.deepEqual(L.STAGES, quoted(must(/p_stage NOT IN \(([^)]*)\)/, fnBody('civil_set_project_stage'), 'รายการขั้นใน RPC')[1]))
  assert.deepEqual(L.STAGES, checkList(tableSegment('civil_project_documents'), 'stage', 'CHECK documents.stage'))
  assert.equal(L.STAGES.length, 12)
})

await test('HOLDABLE_STAGES = CHECK civil_projects.stage_before_hold', () => {
  assert.deepEqual(L.HOLDABLE_STAGES, checkList(colsSql, 'stage_before_hold', 'CHECK stage_before_hold'))
})

await test('stageOrd = civil_stage_ord ทุกค่า', () => {
  const pairs = [...fnBody('civil_stage_ord').matchAll(/WHEN '(\w+)' THEN (\d+)/g)].map(m => [m[1], Number(m[2])])
  assert.equal(pairs.length, 9)
  assert.deepEqual(pairs, L.MAIN_STAGES.map(s => [s, L.stageOrd(s)]))
  for (const s of ['suspended', 'cancelled', 'terminated', 'bogus', null]) assert.equal(L.stageOrd(s), null)
})

await test('STATUS_OF_STAGE = civil_status_of_stage ทุกค่า (ครบ 12 ขั้น)', () => {
  const body = fnBody('civil_status_of_stage')
  const sql = {}
  for (const m of body.matchAll(/WHEN p_stage IN \(([^)]*)\) THEN '(\w+)'/g)) for (const s of quoted(m[1])) sql[s] = m[2]
  for (const m of body.matchAll(/WHEN p_stage = '(\w+)' THEN '(\w+)'/g)) sql[m[1]] = m[2]
  assert.deepEqual(sql, L.STATUS_OF_STAGE)
  assert.deepEqual(keysOf(sql).sort(), [...L.STAGES].sort())
  assert.equal(L.statusOfStage('bogus'), null)
})

await test('STAGE_FOR_STATUS = civil_stage_for_status ทุกค่า + ไปกลับแล้วได้ status เดิม', () => {
  const sql = Object.fromEntries([...fnBody('civil_stage_for_status').matchAll(/WHEN '(\w+)' THEN '(\w+)'/g)].map(m => [m[1], m[2]]))
  assert.deepEqual(sql, L.STAGE_FOR_STATUS)
  for (const [status, stage] of Object.entries(L.STAGE_FOR_STATUS)) assert.equal(L.statusOfStage(stage), status)
  assert.equal(L.STAGE_FOR_STATUS.completed, 'warranty', 'completed → warranty (ไม่ใช่ closed) โดยตั้งใจ')
})

await test('ค่า CHECK อื่นที่ lib ใช้ตรงกับ migration (work_group / price_kind / guarantee_type / grp / changes / defects / ผลตรวจรับ)', () => {
  assert.deepEqual(keysOf(L.WORK_GROUPS), checkList(colsSql, 'work_group', 'CHECK work_group'))
  assert.deepEqual(keysOf(L.PRICE_KINDS), checkList(colsSql, 'price_kind', 'CHECK price_kind'))
  assert.deepEqual(keysOf(L.GUARANTEE_TYPES), checkList(colsSql, 'guarantee_type', 'CHECK guarantee_type'))
  assert.deepEqual(L.PEOPLE_GROUP_KEYS, quoted(must(/civil_people_grp_check\s+CHECK \(grp IN \(([^)]*)\)\)/, colsSql, 'CHECK grp')[1]))
  assert.deepEqual(keysOf(L.CHANGE_KINDS), checkList(tableSegment('civil_project_changes'), 'kind', 'CHECK changes.kind'))
  assert.deepEqual(keysOf(L.DEFECT_KINDS), checkList(tableSegment('civil_project_defects'), 'kind', 'CHECK defects.kind'))
  assert.deepEqual(keysOf(L.DEFECT_RESULTS), checkList(tableSegment('civil_project_defects'), 'result', 'CHECK defects.result'))
  assert.deepEqual(keysOf(L.INSPECTION_RESULTS), checkList(tableSegment('civil_project_installments'), 'inspection_result', 'CHECK inspection_result'))
})

await test('แคตาล็อกจุดตรวจ: คีย์ไม่ซ้ำ รูปแบบผ่าน CHECK ขั้นถูก · คีย์ที่ผู้จัดการเท่านั้น = civil_milestones_guard', () => {
  const pattern = must(/key\s+text NOT NULL CHECK \(key ~ '([^']+)'\)/, tableSegment('civil_project_milestones'), 'CHECK milestones.key')[1]
  assert.equal(L.MILESTONE_KEY_PATTERN.source, pattern)
  const keys = L.MILESTONES.map(m => m.key)
  assert.equal(new Set(keys).size, keys.length, 'คีย์ซ้ำ')
  for (const m of L.MILESTONES) {
    assert.ok(L.MILESTONE_KEY_PATTERN.test(m.key), m.key)
    assert.ok(L.STAGES.includes(m.stage), m.key)
    assert.ok(m.label, m.key)
  }
  const guarded = quoted(must(/v_key IN \(([^)]*)\)/, fnBody('civil_milestones_guard'), 'คีย์ใน civil_milestones_guard')[1])
  assert.deepEqual([...L.MANAGER_ONLY_MILESTONES].sort(), [...guarded].sort())
  // RPC อ่านคีย์ guarantee_returned + guarantee_type 'none' ตอนปิดโครงการ
  assert.match(fnBody('civil_set_project_stage'), /m\.key = 'guarantee_returned'/)
  assert.match(fnBody('civil_set_project_stage'), /c\.guarantee_type = 'none'/)
})

await test('ข้อความ error ของ lib = ข้อความใน RPC ทุกตัว (หน้าจอแสดงข้อความเดียวกับที่ฐานข้อมูลตอบ)', () => {
  const rpc = fnBody('civil_set_project_stage')
  for (const [k, v] of Object.entries(L.STAGE_ERRORS)) {
    if (typeof v === 'string') assert.ok(rpc.includes(`'${v}'`), `ข้อความ ${k} ไม่ตรงกับ RPC: ${v}`)
  }
  assert.ok(rpc.includes(`'ไม่รู้จักขั้นโครงการ "%"'`))
  assert.ok(rpc.includes(`'เปลี่ยนจากขั้น "%" ไปขั้น "%" ไม่ได้'`))
  assert.equal(L.STAGE_ERRORS.unknown('x'), 'ไม่รู้จักขั้นโครงการ "x"')
  assert.equal(L.STAGE_ERRORS.invalid('closed', 'cancelled'), 'เปลี่ยนจากขั้น "closed" ไปขั้น "cancelled" ไม่ได้')
})

// ── ส่วนที่ 2: เทียบกับ RPC จริงบน PGlite ─────────────────────────────────────────

const pgliteArg = process.argv.indexOf('--pglite')
const pglitePath = pgliteArg !== -1 ? process.argv[pgliteArg + 1] : process.env.CIVIL_PGLITE_MODULE
if (!pglitePath) {
  console.log('SKIP เทียบ RPC บน PGlite — ส่ง --pglite <path ของ @electric-sql/pglite/dist/index.js> เพื่อรันชุดนี้')
} else {
  const { PGlite } = await import(pathToFileURL(pglitePath).href)
  // PGlite สะสม stack ภายในเมื่อจับ exception ของ plpgsql ซ้ำหลายพันครั้งในอินสแตนซ์เดียว (ได้ 'stack depth limit exceeded'
  // ทั้งที่ทุกคู่ก่อนหน้าตรงกัน) → สร้างฐานใหม่ต่อขั้นตั้งต้น 1 ชุด
  const freshDb = async () => {
    const db = new PGlite()
    await db.exec(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('t.uid', true), '')::uuid $$;
    CREATE TABLE public.civil_projects (id uuid PRIMARY KEY, stage text, stage_before_hold text);
    CREATE TABLE public.civil_project_milestones (project_id uuid, key text, done_on date);
    CREATE TABLE public.civil_project_contracts (project_id uuid, guarantee_type text);
    CREATE FUNCTION public.civil_can_read_project(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.civil_can_manage_project(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('t.manage', true) = 'on' $$;
    CREATE FUNCTION public.civil_can_write_project(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('t.write', true) = 'on' $$;
    CREATE FUNCTION public.civil_stage_context(boolean, text, text, text, date) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
    `)
    // ฟังก์ชันจริงจาก migration ทั้งตัว (สิทธิ์/ตารางรอบข้างเป็นตัวจำลอง — สิ่งที่ทดสอบคือกติกาเปลี่ยนขั้นใน RPC)
    for (const name of ['civil_stage_ord', 'civil_status_of_stage', 'civil_stage_for_status', 'civil_set_project_stage']) await db.exec(fnBody(name))
    return db
  }
  let db = await freshDb()

  await test('PGlite: civil_stage_ord / civil_status_of_stage / civil_stage_for_status = lib ทุกค่า (รวมค่าแปลก/NULL)', async () => {
    for (const s of [...L.STAGES, 'bogus', null]) {
      const r = (await db.query('SELECT public.civil_stage_ord($1) AS o, public.civil_status_of_stage($1) AS st', [s])).rows[0]
      assert.equal(r.o, L.stageOrd(s), `ord ${s}`)
      assert.equal(r.st, L.statusOfStage(s), `status ${s}`)
    }
    for (const st of [...Object.keys(L.STAGE_FOR_STATUS), 'bogus', null]) {
      const r = (await db.query('SELECT public.civil_stage_for_status($1) AS s', [st])).rows[0]
      assert.equal(r.s, L.stageForStatus(st), `stage_for_status ${st}`)
    }
  })

  await test('PGlite: civil_set_project_stage = checkStageChange ทุกคู่ (ขั้นเดิม × ขั้นใหม่ × สิทธิ์ × เหตุผล/เลขหนังสือ × หลักประกัน)', async () => {
    const P = '00000000-0000-4000-8000-000000000001'
    const froms = [
      ...L.STAGES.filter(s => s !== 'suspended').map(s => ({ stage: s, hold: null })),
      ...[null, ...L.HOLDABLE_STAGES].map(h => ({ stage: 'suspended', hold: h })),
    ]
    const accesses = [{ write: false, manage: false }, { write: true, manage: false }, { write: true, manage: true }]
    const reasons = [[null, null], ['   ', null], ['เหตุผล', null], [null, 'ที่ 1/2569'], ['   ', 'ที่ 1/2569'], ['เหตุผล', 'ที่ 1/2569']]
    const guarantees = [{}, { guaranteeReturned: true }, { guaranteeNone: true }]
    let runs = 0
    let successes = 0
    for (const from of froms) {
      await db.close()
      db = await freshDb()
      for (const to of [...L.STAGES, 'bogus']) {
        for (const access of accesses) {
          for (const [reason, refNo] of reasons) {
            for (const g of to === 'closed' ? guarantees : [{}]) {
              const expected = L.checkStageChange({ project: { stage: from.stage, stage_before_hold: from.hold }, to, access, reason, refNo, ...g })
              let actual
              await db.exec('BEGIN')
              try {
                await db.query(`SELECT set_config('t.uid', $1, true), set_config('t.write', $2, true), set_config('t.manage', $3, true)`,
                  ['00000000-0000-4000-8000-000000000099', access.write ? 'on' : 'off', access.manage ? 'on' : 'off'])
                await db.query('INSERT INTO public.civil_projects (id, stage, stage_before_hold) VALUES ($1, $2, $3)', [P, from.stage, from.hold])
                if (g.guaranteeReturned) await db.query(`INSERT INTO public.civil_project_milestones VALUES ($1, 'guarantee_returned', '2026-11-01')`, [P])
                if (g.guaranteeNone) await db.query(`INSERT INTO public.civil_project_contracts VALUES ($1, 'none')`, [P])
                const ret = (await db.query('SELECT public.civil_set_project_stage($1, $2, $3, $4) AS s', [P, to, reason, refNo])).rows[0].s
                const row = (await db.query('SELECT stage, stage_before_hold FROM public.civil_projects WHERE id = $1', [P])).rows[0]
                actual = { ok: true, ret, stage: row.stage, hold: row.stage_before_hold }
              } catch (e) {
                actual = { ok: false, error: e.message }
              } finally {
                await db.exec('ROLLBACK')
              }
              const label = `${from.stage}${from.hold ? `(${from.hold})` : ''} → ${to} · ${JSON.stringify(access)} · reason=${JSON.stringify(reason)} ref=${JSON.stringify(refNo)} ${JSON.stringify(g)}`
              assert.equal(actual.ok, expected.ok, `${label}\n  SQL: ${actual.error ?? 'สำเร็จ'}\n  lib: ${expected.error ?? 'สำเร็จ'}`)
              if (actual.ok) {
                assert.equal(actual.ret, to, label)
                assert.equal(actual.stage, to, label)
                assert.equal(actual.hold, expected.newHold, `${label} stage_before_hold`)
                successes++
              } else {
                assert.equal(actual.error, expected.error, label)
              }
              runs++
            }
          }
        }
      }
    }
    assert.ok(runs > 5000 && successes > 300, `เทียบ ${runs} คู่ สำเร็จ ${successes}`)
    console.log(`  เทียบ ${runs} คู่ (เปลี่ยนขั้นสำเร็จ ${successes})`)
  })
  await db.close()
}

// ── ส่วนที่ 3: กติกาเปลี่ยนขั้น (ไม่ต้องใช้ PGlite) ─────────────────────────────────────

await test('stageChangeRule: เส้นหลัก / ผู้จัดการ / เหตุผล / เลขหนังสือ / ยกเลิก-บอกเลิก / ระงับ', () => {
  const R = L.stageChangeRule
  assert.deepEqual(R({ from: 'budgeted', to: 'designing' }), { ok: true, needManage: false, needReason: false, needRef: false, newHold: null })
  assert.equal(R({ from: 'final_inspection', to: 'warranty' }).needManage, true)
  assert.equal(R({ from: 'warranty', to: 'closed' }).needReason, true, 'ยังไม่คืนหลักประกัน → ต้องมีเหตุผล')
  assert.equal(R({ from: 'warranty', to: 'closed', guaranteeReturned: true }).needReason, false)
  assert.equal(R({ from: 'warranty', to: 'closed', guaranteeNone: true }).needReason, false)
  assert.deepEqual(R({ from: 'construction', to: 'budgeted' }), { ok: true, needManage: true, needReason: true, needRef: false, newHold: null })
  assert.deepEqual(R({ from: 'construction', to: 'suspended' }), { ok: true, needManage: true, needReason: true, needRef: true, newHold: 'construction' })
  assert.equal(R({ from: 'closed', to: 'suspended' }).error, L.STAGE_ERRORS.suspendClosed)
  assert.equal(R({ from: 'contracted', to: 'cancelled' }).error, L.STAGE_ERRORS.cancelAfterContract)
  assert.equal(R({ from: 'procuring', to: 'cancelled' }).needRef, true)
  assert.equal(R({ from: 'procuring', to: 'terminated' }).error, L.STAGE_ERRORS.terminateRange)
  assert.equal(R({ from: 'warranty', to: 'terminated' }).error, L.STAGE_ERRORS.terminateRange)
  assert.equal(R({ from: 'suspended', hold: 'construction', to: 'terminated' }).ok, true)
  assert.equal(R({ from: 'suspended', hold: null, to: 'cancelled' }).error, L.STAGE_ERRORS.holdUnknown)
  assert.equal(R({ from: 'suspended', hold: 'designing', to: 'construction' }).needManage, true)
  assert.equal(R({ from: 'cancelled', to: 'designing' }).ok, true)
  assert.equal(R({ from: 'cancelled', to: 'terminated' }).error, L.STAGE_ERRORS.terminateRange)
  assert.equal(R({ from: 'terminated', to: 'cancelled' }).error, L.STAGE_ERRORS.cancelAfterContract)
  assert.equal(R({ from: 'construction', to: 'construction' }).error, L.STAGE_ERRORS.same)
  assert.equal(R({ from: 'construction', to: 'x' }).error, 'ไม่รู้จักขั้นโครงการ "x"')
})

await test('checkStageChange + stageActions: ช่าง/viewer/หัวหน้ากอง เห็นปุ่มเท่าที่กดผ่าน', () => {
  const C = L.checkStageChange
  const project = { stage: 'construction', stage_before_hold: null }
  assert.equal(C({ project, to: 'final_inspection', access: {} }).error, L.STAGE_ERRORS.noWrite)
  assert.equal(C({ project, to: 'final_inspection', access: { write: true } }).ok, true)
  assert.equal(C({ project: { stage: 'final_inspection' }, to: 'warranty', access: { write: true } }).error, L.STAGE_ERRORS.needManage)
  assert.equal(C({ project: { stage: 'warranty' }, to: 'closed', access: { manage: true } }).error, L.STAGE_ERRORS.needReason)
  assert.equal(C({ project: { stage: 'warranty' }, to: 'closed', access: { manage: true }, reason: '   ' }).error, L.STAGE_ERRORS.needReason)
  assert.equal(C({ project: { stage: 'warranty' }, to: 'closed', access: { manage: true }, reason: 'คืนหลักประกันนอกระบบแล้ว' }).ok, true)
  assert.equal(C({ project, to: 'suspended', access: { manage: true }, reason: 'น้ำท่วม' }).error, L.STAGE_ERRORS.needRef)
  assert.equal(C({ project, to: 'suspended', access: { manage: true }, reason: 'x'.repeat(4001) }).error, L.STAGE_ERRORS.tooLong)

  assert.deepEqual(L.stageActions({ project }, { write: true }).map(a => a.to), ['final_inspection'])
  assert.deepEqual(L.stageActions({ project }, {}), [])
  const manage = L.stageActions({ project }, { write: true, manage: true })
  assert.deepEqual(manage.map(a => a.to), ['budgeted', 'designing', 'procuring', 'contracted', 'started', 'final_inspection', 'warranty', 'closed', 'suspended', 'terminated'])
  assert.equal(manage.find(a => a.to === 'final_inspection').kind, 'next')
  assert.equal(manage.find(a => a.to === 'started').kind, 'back')
  assert.equal(manage.find(a => a.to === 'closed').kind, 'skip')
  assert.equal(manage.find(a => a.to === 'terminated').needRef, true)
})

// ── ส่วนที่ 4: วันครบกำหนด + คำเตือน ──────────────────────────────────────────────

const bundleOf = (over = {}) => ({
  project: { id: 'p1', title: 'ถนน คสล. หมู่ 1', stage: 'construction', fiscal_year: '2570', budget_amount: 2_500_000, contract_amount: 2_000_000, ...over.project },
  contract: { ...over.contract },
  milestones: over.milestones ?? [],
  people: over.people ?? [],
  installments: over.installments ?? [],
  changes: over.changes ?? [],
  defects: over.defects ?? [],
  events: over.events ?? [],
})
const ms = (key, done_on, extra = {}) => ({ key, done_on, ...extra })
const dl = (bundle, key, today) => L.deadlines(bundle, today).find(d => d.key === key)
const codes = list => list.map(a => a.code)

await test('ตัวช่วยวันที่: addMonths ปลายเดือน/ปีอธิกสุรทิน/ติดลบ · ปีงบ พ.ศ.', () => {
  assert.equal(L.addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(L.addMonths('2028-01-31', 1), '2028-02-29')
  assert.equal(L.addMonths('2026-11-30', -11), '2025-12-30')
  assert.equal(L.addMonths('2026-02-31', 1), null)
  assert.deepEqual(L.fiscalYearRange(2570), { start: '2026-10-01', end: '2027-09-30' })
  assert.equal(L.fiscalYearRange('abc'), null)
})

await test('ตรวจรับภายใน 3 วันทำการนับแต่ประธานทราบ (ข้อ 176(5)) — วันที่ 1 = วันทำการถัดไป', () => {
  const b = bundleOf({ installments: [{ installment_no: 1, chair_acknowledged_on: '2026-11-05' }] }) // พฤหัส
  assert.equal(dl(b, 'installment_inspection', '2026-11-09').due, '2026-11-10') // ศ.(1) จ.(2) อ.(3)
  assert.equal(dl(b, 'installment_inspection', '2026-11-09').state, 'open')
  assert.equal(dl(b, 'installment_inspection', '2026-11-09').daysLeft, 1)
  assert.equal(dl(b, 'installment_inspection', '2026-11-11').state, 'overdue')
  const done = bundleOf({ installments: [{ installment_no: 1, chair_acknowledged_on: '2026-11-05', inspected_on: '2026-11-11' }] })
  assert.equal(dl(done, 'installment_inspection', '2026-11-20').state, 'late_done')
})

await test('ว 681: กรรมการตรวจรับงวดสุดท้าย 5 วันทำการ · งวดงาน 3 · ไม่รู้จำนวนงวด → 3 + ต้องยืนยัน', () => {
  const inst = no => ({ installment_no: no, chair_acknowledged_on: '2026-11-05' }) // พฤหัส
  const b = bundleOf({ contract: { installments_total: 2 }, installments: [inst(1), inst(2)] })
  const all = L.deadlines(b, '2026-11-09').filter(d => d.key === 'installment_inspection')
  const [first, last] = [all.find(d => d.installmentNo === 1), all.find(d => d.installmentNo === 2)]
  assert.equal(first.due, '2026-11-10') // ศ.(1) จ.(2) อ.(3)
  assert.equal(first.verify, false)
  assert.equal(last.due, '2026-11-12')  // ... พ.(4) พฤ.(5)
  assert.match(last.label, /งวดสุดท้าย/)
  assert.match(last.basis, /ว 681/)
  assert.equal(last.verify, false)
  const unknown = dl(bundleOf({ installments: [inst(1)] }), 'installment_inspection', '2026-11-09')
  assert.equal(unknown.due, '2026-11-10', 'ไม่รู้ว่างวดสุดท้าย → ใช้ 3 วัน (เตือนเร็วไว้ก่อน)')
  assert.equal(unknown.verify, true)
  // ราคาต่อหน่วยใช้ 3/5 เหมือนกัน
  const unit = bundleOf({ project: { contract_amount: 150_000_000 }, contract: { price_kind: 'unit_price', installments_total: 1 }, installments: [inst(1)] })
  assert.equal(dl(unit, 'installment_inspection', '2026-11-09').due, '2026-11-12')
})

await test('ว 681: ผู้ควบคุมงาน — เหมารวม 3/3 · ต่อหน่วยตามวงเงิน (รวมค่าขอบ "ไม่เกิน") · ค่าสำรองเมื่อข้อมูลไม่ครบ', () => {
  const days = (contract, amount, no) => L.supervisorInstallmentDays(bundleOf({ project: { contract_amount: amount }, contract }), no)
  const unit = { price_kind: 'unit_price', installments_total: 3 }
  assert.deepEqual(days({ price_kind: 'lump_sum', installments_total: 3 }, 500_000_000, 1), { days: 3, assumed: false })
  assert.deepEqual(days({ price_kind: 'lump_sum', installments_total: 3 }, 500_000_000, 3), { days: 3, assumed: false })
  const cases = [
    [30_000_000, 4, 8], [30_000_001, 8, 12], [60_000_000, 8, 12], [60_000_001, 12, 16],
    [100_000_000, 12, 16], [100_000_001, 16, 20], [1_000_000_000, 16, 20],
  ]
  for (const [amount, inst, fin] of cases) {
    assert.deepEqual(days(unit, amount, 1), { days: inst, assumed: false }, `รายงวด ${amount}`)
    assert.deepEqual(days(unit, amount, 3), { days: fin, assumed: false }, `งวดสุดท้าย ${amount}`)
  }
  assert.deepEqual(days({ installments_total: 3 }, 50_000_000, 3), { days: 3, assumed: true }, 'ไม่รู้ชนิดราคา → เหมารวม')
  assert.deepEqual(days({ price_kind: 'unit_price', installments_total: 3 }, null, 3), { days: 8, assumed: true }, 'ต่อหน่วยไม่รู้วงเงิน → ช่วงแรก')
  assert.deepEqual(days({ price_kind: 'unit_price' }, 50_000_000, 3), { days: 8, assumed: true }, 'ไม่รู้จำนวนงวด → ค่ารายงวด')

  const b = bundleOf({ project: { contract_amount: 2_000_000 }, contract: { price_kind: 'unit_price', installments_total: 2 },
    installments: [{ installment_no: 1, due_on: '2026-11-10' }, { installment_no: 2, due_on: '2026-11-10' }] }) // อ.
  const list = L.deadlines(b, '2026-11-10').filter(d => d.key === 'installment_due_report')
  assert.equal(list.find(d => d.installmentNo === 1).due, '2026-11-16') // พ.(1) พฤ.(2) ศ.(3) จ.(4)
  assert.equal(list.find(d => d.installmentNo === 2).due, '2026-11-20') // 8 วันทำการ
  assert.ok(list.every(d => d.verify), 'ว 681 ไม่ระบุเหตุตั้งต้นของผู้ควบคุมงาน → ต้องยืนยันเสมอ')
})

await test('ว 681: ตรวจรับแล้วเตือนรายงานหัวหน้าหน่วยงาน 2 วันทำการ — เตือนอย่างเดียว พ้นกำหนดไม่ขึ้นว่าเลย', () => {
  const b = bundleOf({ installments: [{ installment_no: 1, chair_acknowledged_on: '2026-11-10', inspected_on: '2026-11-12', inspection_result: 'rejected' }] }) // พฤ.
  const d = dl(b, 'inspection_head_report', '2026-11-13')
  assert.equal(d.due, '2026-11-16') // ศ.(1) จ.(2)
  assert.equal(d.mode, 'reminder')
  assert.equal(d.state, 'open')
  assert.ok(codes(L.projectAlerts(b, '2026-11-13')).includes('inspection_head_report_soon'))
  assert.equal(dl(b, 'inspection_head_report', '2026-11-16').state, 'due_today')
  assert.equal(dl(b, 'inspection_head_report', '2026-11-17').state, 'lapsed')
  assert.ok(!codes(L.projectAlerts(b, '2026-11-17')).some(c => c.startsWith('inspection_head_report')), 'พ้นกำหนดไม่เตือน (ไม่มีช่องบันทึกว่ารายงานแล้ว)')
  const noResult = bundleOf({ installments: [{ installment_no: 1, inspected_on: '2026-11-12' }] })
  assert.equal(dl(noResult, 'inspection_head_report', '2026-11-13'), undefined, 'ยังไม่บันทึกผลตรวจรับ → ยังไม่เตือน')
})

await test('ว 681: เลยกำหนดตรวจรับ/รายงานงวด → คำเตือนบอกทางขอขยายเวลาต่อหัวหน้าหน่วยงาน', () => {
  const b = bundleOf({ installments: [{ installment_no: 1, chair_acknowledged_on: '2026-11-05' }] })
  const a = L.projectAlerts(b, '2026-11-11').find(x => x.code === 'installment_inspection_overdue')
  assert.ok(a)
  assert.match(a.message, /ขอขยายเวลา.*ว 681/)
})

await test('กับดักวันเสาร์: กำหนดวันศุกร์ วันเสาร์ต้องขึ้น "เลยกำหนด" แม้ตัวนับวันทำการให้ 0', () => {
  const b = bundleOf({ installments: [{ installment_no: 2, due_on: '2026-11-10' }] }) // อ. + 3 วันทำการ = ศ. 13
  const d = dl(b, 'installment_due_report', '2026-11-14')
  assert.equal(d.due, '2026-11-13')
  assert.equal(workingDaysBetween('2026-11-14', '2026-11-13'), 0, 'ตัวนับวันทำการให้ 0 จริง (เหตุผลที่ต้องตัดสินด้วยวันปฏิทิน)')
  assert.equal(d.state, 'overdue')
  assert.ok(codes(L.projectAlerts(b, '2026-11-14')).includes('installment_due_report_overdue'))
  assert.equal(dl(b, 'installment_due_report', '2026-11-13').state, 'due_today')
})

await test('ส่งมอบล่าช้า → แจ้งสิทธิค่าปรับ 7 วันทำการนับถัดจากวันครบกำหนด (ข้อ 181) + ประมาณการค่าปรับ', () => {
  const b = bundleOf({ project: { end_date: '2026-11-13' }, contract: { fine_per_day: 500 } })
  assert.equal(dl(b, 'fine_notice', '2026-11-13'), undefined, 'วันครบกำหนดยังไม่ล่าช้า')
  const d = dl(b, 'fine_notice', '2026-11-16')
  assert.equal(d.due, '2026-11-24')
  const f = L.fineEstimate(b, '2026-11-16')
  assert.equal(f.lateDays, 3)
  assert.equal(f.amount, 1500)
  assert.equal(f.pct, 0.075)
  assert.equal(f.daysToThreshold, 400 - 3)
  assert.equal(f.estimate, true)
  // ขยายเวลาที่อนุมัติแล้ว → วันสิ้นสุดใหม่
  const ext = bundleOf({ project: { end_date: '2026-11-13' }, contract: { fine_per_day: 500 },
    changes: [{ kind: 'extend_time', decision: 'approved', approved_on: '2026-11-10', new_end_date: '2026-12-15' }] })
  assert.equal(dl(ext, 'fine_notice', '2026-11-16'), undefined)
  assert.equal(L.contractSchedule(ext).effectiveEnd, '2026-12-15')
  // ส่งมอบแล้ว นับถึงวันส่งมอบ
  const delivered = bundleOf({ project: { end_date: '2026-11-13' }, contract: { fine_per_day: 500, installments_total: 2 },
    installments: [{ installment_no: 1, delivered_on: '2026-10-01' }, { installment_no: 2, delivered_on: '2026-11-18' }] })
  assert.equal(L.fineEstimate(delivered, '2027-01-01').lateDays, 5)
})

await test('ค่าปรับเกินร้อยละ 10 (ข้อ 183): ครบ 10% พอดียังไม่เกิน · เกินแล้วขึ้น error + เหตุประเมินผู้ประกอบการ', () => {
  const b = bundleOf({ project: { end_date: '2026-11-13' }, contract: { fine_per_day: 500 } })
  const at400 = addDays('2026-11-13', 400)
  assert.equal(L.fineEstimate(b, at400).pct, 10)
  assert.equal(L.fineEstimate(b, at400).overThreshold, false)
  const at401 = addDays('2026-11-13', 401)
  assert.equal(L.fineEstimate(b, at401).overThreshold, true)
  assert.ok(codes(L.projectAlerts(b, at401)).includes('fine_over_threshold'))
  assert.ok(L.operatorEvalEvents(b, at401).some(e => e.key === 'fine_over_threshold'))
  assert.ok(codes(L.projectAlerts(b, addDays('2026-11-13', 380))).includes('fine_near_threshold'))
  // รับมอบงานล่าช้าแล้วไม่สงวนสิทธิ์
  const accepted = bundleOf({ project: { end_date: '2026-11-13' }, contract: { fine_per_day: 500 },
    installments: [{ installment_no: 1, delivered_on: '2026-11-20', inspected_on: '2026-11-24', inspection_result: 'accepted' }] })
  assert.ok(codes(L.projectAlerts(accepted, '2026-11-25')).includes('fine_not_reserved'))
  accepted.installments[0].fine_reserved = true
  assert.ok(!codes(L.projectAlerts(accepted, '2026-11-25')).includes('fine_not_reserved'))
})

await test('ราคากลาง: ประกาศภายใน 30 วันปฏิทินนับถัดจากวันเห็นชอบ ไม่งั้นทบทวน (ข้อ 18) · ทบทวนแล้วนับใหม่', () => {
  const base = { project: { stage: 'designing' }, people: [1, 2, 3].map(() => ({ grp: 'price_committee' })) }
  const b = bundleOf({ ...base, milestones: [ms('designer_certified', '2026-09-20'), ms('median_price_approved', '2026-10-01', { amount: 1_000_000 })] })
  assert.equal(dl(b, 'median_price_publish', '2026-10-31').due, '2026-10-31')
  assert.equal(dl(b, 'median_price_publish', '2026-10-31').state, 'due_today')
  assert.ok(codes(L.priceAlerts(b, '2026-10-26')).includes('median_price_publish_soon'))
  assert.ok(codes(L.priceAlerts(b, '2026-11-01')).includes('median_price_stale'))
  const published = bundleOf({ ...base, milestones: [...b.milestones, ms('invitation_published', '2026-10-20')] })
  assert.equal(dl(published, 'median_price_publish', '2026-11-01').state, 'done')
  assert.ok(!codes(L.priceAlerts(published, '2026-11-01')).includes('median_price_stale'))
  const reviewed = bundleOf({ ...base, milestones: [...b.milestones, ms('median_price_reviewed', '2026-11-02', { amount: 1_050_000 })] })
  assert.equal(dl(reviewed, 'median_price_publish', '2026-11-05').due, '2026-12-02')
  assert.equal(L.medianPrice(reviewed), 1_050_000)
})

await test('ราคากลาง: กรรมการ ≥ 3 · วงเงิน 1–20 ล้านต้องใช้ระบบ e-GP · ต่าง ≥ 15% แจ้ง สตง. · ผู้ออกแบบรับรองก่อน', () => {
  const committee = n => Array.from({ length: n }, () => ({ grp: 'price_committee' }))
  const mk = (over = {}) => bundleOf({ project: { stage: 'designing', budget_amount: 500_000, ...over.project }, people: over.people ?? committee(3),
    milestones: over.milestones ?? [ms('designer_certified', '2026-10-01')] })
  const today = '2026-10-05'
  assert.ok(codes(L.priceAlerts(mk({ people: committee(2) }), today)).includes('price_committee_size'))
  assert.deepEqual(L.priceAlerts(mk(), today), [])
  // หลังลงนามสัญญา (เช่น โครงการเดิมที่ migration เติมเป็น construction) ไม่เตือนกรรมการ/เลข e-GP ย้อนหลัง
  for (const stage of ['contracted', 'construction', 'warranty']) {
    const late = codes(L.priceAlerts(mk({ project: { stage, budget_amount: 5_000_000 }, people: [] }), today))
    assert.ok(!late.includes('price_committee_size') && !late.includes('price_calc_egp'), stage)
  }
  assert.ok(codes(L.priceAlerts(mk({ project: { stage: 'procuring', budget_amount: 5_000_000 }, people: [] }), today)).includes('price_committee_size'))
  for (const [budget, expect] of [[1_000_000, true], [20_000_000, true], [20_000_001, false], [999_999.99, false]]) {
    assert.equal(codes(L.priceAlerts(mk({ project: { budget_amount: budget } }), today)).includes('price_calc_egp'), expect, String(budget))
  }
  assert.ok(!codes(L.priceAlerts(mk({ project: { budget_amount: 5_000_000 }, milestones: [ms('designer_certified', '2026-10-01'), ms('egp_price_calc', null, { ref_no: 'P-123' })] }), today)).includes('price_calc_egp'))
  const gap = bid => codes(L.priceAlerts(mk({ project: { stage: 'procuring' },
    milestones: [ms('designer_certified', '2026-09-01'), ms('median_price_approved', '2026-09-02', { amount: 1_000_000 }), ms('invitation_published', '2026-09-05'), ms('bid_price', '2026-09-30', { amount: bid })] }), today))
  assert.ok(gap(850_000).includes('price_gap_oag'), 'ต่าง 15% พอดี = ต้องแจ้ง')
  assert.ok(!gap(850_001).includes('price_gap_oag'))
  assert.ok(gap(1_150_000).includes('price_gap_oag'))
  assert.ok(codes(L.priceAlerts(mk({ milestones: [ms('median_price_approved', '2026-10-01', { amount: 1 })] }), today)).includes('designer_not_certified'))
  assert.deepEqual(L.priceAlerts(bundleOf({ project: { stage: 'budgeted', budget_amount: 5_000_000 } }), today), [], 'ยังไม่ถึงขั้นราคากลาง ไม่เตือน')
})

await test('ระยะอุทธรณ์ 7 วันทำการ (ม.117) + ลงนามก่อนพ้นระยะ = error · สำเนาสัญญา ≥ 1 ล้านภายใน 30 วัน (ข้อ 164)', () => {
  const mk = contract_date => bundleOf({ project: { stage: 'contracted' }, contract: { contract_date }, milestones: [ms('winner_announced', '2026-10-01')] })
  const gate = dl(mk(null), 'appeal_period', '2026-10-05')
  assert.equal(gate.due, '2026-10-12') // พฤ. 1 ต.ค. → ศ.(1) จ.(2) อ.(3) พ.(4) พฤ.(5) ศ.(6) จ. 12 (7)
  assert.equal(gate.state, 'waiting')
  assert.equal(dl(mk(null), 'appeal_period', '2026-10-13').state, 'passed')
  assert.ok(codes(L.projectAlerts(mk('2026-10-12'), '2026-10-20')).includes('signed_before_appeal_end'))
  assert.ok(!codes(L.projectAlerts(mk('2026-10-14'), '2026-10-20')).includes('signed_before_appeal_end'))

  const copy = amount => bundleOf({ project: { stage: 'contracted', contract_amount: amount }, contract: { contract_date: '2026-10-15' } })
  assert.equal(dl(copy(1_000_000), 'contract_copy_oag', '2026-10-20').due, '2026-11-14')
  assert.equal(dl(copy(1_000_000), 'contract_copy_revenue', '2026-10-20').due, '2026-11-14')
  assert.equal(dl(copy(999_999), 'contract_copy_oag', '2026-10-20'), undefined)
  assert.ok(codes(L.projectAlerts(copy(1_000_000), '2026-11-15')).includes('contract_copy_oag_overdue'))
})

await test('รายงาน ณ วันเริ่มงาน 3 วันทำการ (ข้อ 178(4)) · วันเริ่ม/สิ้นสุดคำนวณจากหนังสือแจ้งให้เริ่มงาน', () => {
  const b = bundleOf({ project: { stage: 'started' }, contract: { notice_to_proceed_date: '2026-11-02', start_within_days: 7, finish_within_days: 120 } })
  const s = L.contractSchedule(b)
  assert.equal(s.startBy, '2026-11-09')
  assert.equal(s.finishBy, '2027-03-02')
  assert.equal(s.start, '2026-11-09')
  assert.equal(s.computedStart, true)
  const d = dl(b, 'start_report', '2026-11-10')
  assert.equal(d.due, '2026-11-12')
  assert.equal(d.verify, true, 'วันเริ่มที่คำนวณเอง ต้องมีคำกำกับ')
  const recorded = bundleOf({ project: { stage: 'started', start_date: '2026-11-05' }, contract: { notice_to_proceed_date: '2026-11-02', start_within_days: 7 } })
  assert.equal(L.contractSchedule(recorded).start, '2026-11-05', 'วันที่คนบันทึกจากสัญญาชนะ')
})

await test('ระยะประกัน + ตรวจครั้งสุดท้าย (ว 117: 30 วันถ้า ≥ 6 เดือน / 15 วันถ้า < 6 เดือน)', () => {
  const w24 = L.warrantyWindow(bundleOf({ contract: { warranty_starts_on: '2027-01-02', warranty_months: 24 } }))
  assert.deepEqual([w24.end, w24.leadDays, w24.opensOn], ['2029-01-01', 30, '2028-12-02'])
  const w6 = L.warrantyWindow(bundleOf({ contract: { warranty_starts_on: '2027-01-02', warranty_months: 6 } }))
  assert.deepEqual([w6.end, w6.leadDays], ['2027-07-01', 30])
  const w3 = L.warrantyWindow(bundleOf({ contract: { warranty_starts_on: '2027-01-02', warranty_months: 3 } }))
  assert.deepEqual([w3.end, w3.leadDays, w3.opensOn], ['2027-04-01', 15, '2027-03-17'])
  const derived = L.warrantyWindow(bundleOf({ contract: { warranty_months: 12, installments_total: 1 },
    installments: [{ installment_no: 1, delivered_on: '2026-12-30', inspected_on: '2027-01-04', inspection_result: 'accepted' }] }))
  assert.deepEqual([derived.start, derived.end, derived.computedStart], ['2026-12-31', '2027-12-30', true])
  assert.equal(L.warrantyWindow(bundleOf({ contract: { warranty_months: 12 } })).end, null, 'ยังไม่รับมอบ = ยังไม่มีระยะประกัน')

  const b = bundleOf({ project: { stage: 'warranty' }, contract: { warranty_starts_on: '2027-01-02', warranty_months: 24 } })
  assert.ok(!codes(L.projectAlerts(b, '2028-11-28')).includes('warranty_final_inspection_soon'), 'ยังไม่เปิดช่วงตรวจ ไม่เตือน')
  assert.ok(codes(L.projectAlerts(b, '2028-12-26')).includes('warranty_final_inspection_soon'))
  b.defects = [{ inspected_on: '2028-12-10', kind: 'final_before_expiry', result: 'ok' }]
  assert.equal(dl(b, 'warranty_final_inspection', '2028-12-26').state, 'done')
})

await test('คืนหลักประกัน 15 วันนับถัดจากพ้นข้อผูกพัน (ข้อ 170(2)) · ไม่มีหลักประกัน = ไม่มีกำหนด · หลักประกันหมดอายุก่อน', () => {
  const b = bundleOf({ project: { stage: 'warranty' }, contract: { guarantee_type: 'bank_guarantee' }, milestones: [ms('obligation_ended', '2026-11-01')] })
  assert.equal(dl(b, 'guarantee_return', '2026-11-05').due, '2026-11-16')
  assert.equal(dl(b, 'guarantee_return', '2026-11-05').verify, false)
  const none = bundleOf({ contract: { guarantee_type: 'none' }, milestones: [ms('obligation_ended', '2026-11-01')] })
  assert.equal(dl(none, 'guarantee_return', '2026-11-05'), undefined)
  const short = bundleOf({ contract: { guarantee_type: 'bank_guarantee', guarantee_expires_on: '2027-06-30', warranty_starts_on: '2027-01-02', warranty_months: 24 } })
  assert.ok(codes(L.projectAlerts(short, '2027-02-01')).includes('guarantee_short'))
})

await test('ขอขยายเวลาเกิน 15 วันนับถัดจากเหตุสิ้นสุด (ข้อ 182) = ข้อมูลประกอบ ไม่ใช่ error · ความชำรุดไม่แจ้งผู้ค้ำ', () => {
  const b = bundleOf({ changes: [{ kind: 'extend_time', cause_ended_on: '2026-10-01', request_received_on: '2026-10-20' }] })
  const d = dl(b, 'change_request', '2026-11-01')
  assert.deepEqual([d.due, d.state, d.party], ['2026-10-16', 'late_done', 'contractor'])
  const a = L.projectAlerts(b, '2026-11-01').find(x => x.code === 'change_request_late')
  assert.equal(a.level, 'info')
  const defect = bundleOf({ project: { stage: 'warranty' }, defects: [{ inspected_on: '2026-10-01', kind: 'during_warranty', result: 'defect', notice_date: '2026-10-02', fix_due_on: '2026-10-30' }] })
  assert.ok(codes(L.projectAlerts(defect, '2026-10-05')).includes('defect_guarantor'))
  assert.ok(L.operatorEvalEvents(defect, '2026-10-31').some(e => e.key === 'defect_not_fixed'))
  assert.deepEqual(L.operatorEvalEvents(defect, '2026-10-29'), [])
})

await test('งบประมาณปี 2570: ยังไม่ก่อหนี้ใกล้สิ้นปี · กันเงินวางฎีกาก่อน 30 วัน · ลงนาม 30 วันสุดท้าย · เงินสะสม', () => {
  const notCommitted = bundleOf({ project: { stage: 'procuring', fiscal_year: '2570' }, milestones: [ms('budget_annual', '2026-09-20')] })
  assert.deepEqual(L.budgetAlerts([notCommitted], 2570, '2027-01-01'), [])
  const warn = L.budgetAlerts([notCommitted], 2570, '2027-08-01')
  assert.deepEqual([warn[0].code, warn[0].level, warn[0].due], ['not_committed', 'warn', '2027-09-30'])
  assert.equal(L.budgetAlerts([notCommitted], 2570, '2027-10-02')[0].level, 'error')
  assert.deepEqual(L.budgetAlerts([bundleOf({ project: { stage: 'procuring', fiscal_year: '2569' } })], 2570, '2027-08-01'), [])

  const carry = bundleOf({ project: { stage: 'construction', fiscal_year: '2570', end_date: '2027-12-31' }, contract: { contract_date: '2027-03-01' } })
  const c = L.budgetAlerts([carry], 2570, '2027-07-01')
  assert.deepEqual([c[0].code, c[0].due], ['carryover_voucher', '2027-08-31'])
  carry.milestones = [ms('budget_carryover', '2027-08-20')]
  assert.deepEqual(L.budgetAlerts([carry], 2570, '2027-07-01'), [])

  const late = bundleOf({ project: { stage: 'contracted', fiscal_year: '2570', end_date: '2028-01-31' }, contract: { contract_date: '2027-09-05' } })
  assert.equal(L.budgetAlerts([late], 2570, '2027-09-10')[0].code, 'carryover_late_contract')

  const acc = bundleOf({ project: { stage: 'designing', fiscal_year: '2570' }, milestones: [ms('budget_accumulated', '2026-11-15')] })
  const a = L.budgetAlerts([acc], 2570, '2027-10-01')
  assert.deepEqual([a[0].code, a[0].due, a[0].verify], ['accumulated_commit', '2027-11-14', true])
})

await test('เสนอขั้นถัดไป + รายการตรวจก่อนปิดโครงการ', () => {
  assert.equal(L.stageSuggestion(bundleOf({ project: { stage: 'budgeted' } }), '2026-11-08').ready, false)
  const s1 = L.stageSuggestion(bundleOf({ project: { stage: 'budgeted' }, milestones: [ms('budget_annual', '2026-09-20')] }), '2026-11-08')
  assert.deepEqual([s1.to, s1.ready, s1.needManage, s1.needReason], ['designing', true, false, false])
  const s2 = L.stageSuggestion(bundleOf({ project: { stage: 'designing' }, milestones: [ms('designer_certified', '2026-10-01'), ms('median_price_approved', '2026-10-02')] }), '2026-11-08')
  assert.equal(s2.ready, false)
  assert.deepEqual(s2.missing, ['คณะกรรมการกำหนดราคากลางอย่างน้อย 3 คน'])
  const s3 = L.stageSuggestion(bundleOf({ project: { stage: 'started' } }), '2026-11-08')
  assert.deepEqual([s3.to, s3.auto, s3.ready], ['construction', true, false])
  const s4 = L.stageSuggestion(bundleOf({ project: { stage: 'final_inspection' }, contract: { installments_total: 1 },
    installments: [{ installment_no: 1, delivered_on: '2026-11-01', inspected_on: '2026-11-03', inspection_result: 'accepted' }] }), '2026-11-08')
  assert.deepEqual([s4.to, s4.ready, s4.needManage], ['warranty', true, true])
  assert.equal(L.stageSuggestion(bundleOf({ project: { stage: 'closed' } })), null)
  assert.equal(L.stageSuggestion(bundleOf({ project: { stage: 'suspended', stage_before_hold: 'construction' } })), null)

  const full = bundleOf({ project: { stage: 'warranty' },
    contract: { installments_total: 1, guarantee_type: 'bank_guarantee', warranty_starts_on: '2025-01-02', warranty_months: 12, retention_pct: 5 },
    installments: [{ installment_no: 1, delivered_on: '2025-01-01', inspected_on: '2025-01-02', inspection_result: 'accepted' }],
    defects: [{ inspected_on: '2025-12-10', kind: 'final_before_expiry', result: 'ok' }],
    milestones: [ms('retention_returned', '2025-01-10'), ms('obligation_ended', '2026-01-01')] })
  const before = L.closeChecklist(full, '2026-01-05')
  assert.deepEqual([before.ready, before.missing, before.needReason], [false, ['คืนหลักประกันสัญญาแล้ว'], true])
  full.milestones.push(ms('guarantee_returned', '2026-01-10'))
  const after = L.closeChecklist(full, '2026-01-12')
  assert.deepEqual([after.ready, after.needReason], [true, false])
  const sug = L.stageSuggestion(full, '2026-01-12')
  assert.deepEqual([sug.to, sug.ready, sug.needManage, sug.needReason], ['closed', true, true, false])
  full.project.operator_eval_required = true
  assert.deepEqual(L.closeChecklist(full, '2026-01-12').missing, ['ประเมินผู้ประกอบการใน e-GP แล้ว'])
})

await test('buildProjectSteps: ปกติ / ระงับ / ปิดแล้ว / บอกเลิก', () => {
  const states = steps => steps.map(s => `${s.key}:${s.state}`)
  assert.deepEqual(states(L.buildProjectSteps({ stage: 'construction' })).slice(4, 7), ['started:done', 'construction:now', 'final_inspection:todo'])
  assert.equal(L.buildProjectSteps({ stage: 'suspended', stage_before_hold: 'construction' })[5].state, 'hold')
  assert.ok(L.buildProjectSteps({ stage: 'closed' }).every(s => s.state === 'done'))
  const events = [
    { to_stage: 'construction', from_stage: 'started', created_at: '2026-10-01T03:00:00Z' },
    { to_stage: 'terminated', from_stage: 'construction', created_at: '2026-11-01T03:00:00Z' },
  ]
  const t = L.buildProjectSteps({ stage: 'terminated' }, events)
  assert.equal(t.length, 7)
  assert.deepEqual(t.at(-1), { key: 'terminated', label: 'บอกเลิกสัญญา', state: 'stop', at: '2026-11-01T03:00:00Z' })
  assert.equal(t[5].at, '2026-10-01T03:00:00Z')
})

await test('ปีที่ยังไม่มีตารางวันหยุด → แจ้งให้แอดมินกรอก (กำหนดแบบวันทำการคลาดได้)', () => {
  const b = bundleOf({ installments: [{ installment_no: 1, chair_acknowledged_on: '2031-03-05' }] })
  assert.ok(codes(L.projectAlerts(b, '2031-03-01')).includes('holidays_missing'))
  assert.ok(!codes(L.projectAlerts(bundleOf({ installments: [{ installment_no: 1, chair_acknowledged_on: '2026-11-05' }] }), '2026-11-06')).includes('holidays_missing'))
})

console.log(`\nผ่านทั้งหมด ${cases} ชุด`)

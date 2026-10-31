// หน้า "ผู้ลงนามแต่ละช่อง" + ฟอร์มเจ้าหน้าที่หน้าเดียว — ทดสอบบนเบราว์เซอร์จริงด้วยฐานข้อมูลจำลอง (ไม่แตะฐานจริง)
// npm run test:signing-setup   ·   SIGNING_SHOTS=<โฟลเดอร์> เก็บภาพหน้าจอ   ·   SIGNING_ONLY=<คำ> รันเฉพาะชุดที่ชื่อมีคำนี้
//
// ฐานจำลองเลียนแบบกติกาที่ฝั่งจริงบังคับ 2 ข้อ เพราะเป็นต้นเหตุของบั๊กที่งานนี้แก้:
//   - admin_update_user: กองเปลี่ยนในการบันทึกเดียวกัน = ล้าง is_dept_head (trigger sync_profile_department_from_position)
//   - set_document_signatory_v4: ปิดแถวเดิมแล้วสร้างแถวใหม่ · ปฏิเสธบัญชีที่ไม่มีชื่อ
// และเก็บการเรียกทุกครั้งไว้ตรวจว่า "ไม่กดยืนยัน = ไม่เขียน"
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MUNI = 'muni-test'
const SHOTS = process.env.SIGNING_SHOTS || ''
const ONLY = process.env.SIGNING_ONLY || ''

const D = { fin: 'd-fin', eng: 'd-eng', gen: 'd-gen', aud: 'd-aud', exec: 'd-exec', wel: 'd-wel' }
const P = {
  mayor: 'p-mayor', clerk: 'p-clerk', finHead: 'p-fin-head', engHead: 'p-eng-head', genHead: 'p-gen-head',
  audHead: 'p-aud-head', deputyFin: 'p-deputy-fin', officerWork: 'p-officer', tech: 'p-tech', welHead: 'p-wel-head',
  byCategory: 'p-by-category',
}
const positions = () => [
  { id: P.mayor, name: 'นายกเทศมนตรีตำบลทดสอบ', role: 'viewer', category: 'political_exec', department_id: null, department_hint: null, sort_order: 1 },
  { id: P.clerk, name: 'ปลัดเทศบาล', role: 'officer', category: 'top_admin', department_id: null, department_hint: null, sort_order: 2 },
  { id: P.finHead, name: 'ผู้อำนวยการกองคลัง', role: 'officer', category: 'dept_head', department_id: D.fin, department_hint: 'กองคลัง', sort_order: 3 },
  { id: P.engHead, name: 'ผู้อำนวยการกองช่าง', role: 'staff', category: 'operating_staff', department_id: D.eng, department_hint: 'กองช่าง', sort_order: 4 },
  { id: P.genHead, name: 'หัวหน้าสำนักปลัด', role: 'officer', category: 'dept_head', department_id: D.gen, department_hint: 'สำนักปลัด', sort_order: 5 },
  { id: P.deputyFin, name: 'รองผู้อำนวยการกองคลัง', role: 'staff', category: 'dept_head', department_id: D.fin, department_hint: 'กองคลัง', sort_order: 6 },
  { id: P.officerWork, name: 'นักจัดการงานทั่วไป', role: 'staff', category: 'operating_staff', department_id: null, department_hint: 'สำนักปลัด', sort_order: 7 },
  { id: P.tech, name: 'นายช่างโยธา', role: 'technician', category: 'field_technician', department_id: null, department_hint: 'กองช่าง', sort_order: 8 },
  // แบบมาตรฐาน: ชื่อไม่บอกว่าเป็นหัวหน้า รู้จากหมวดเท่านั้น
  { id: P.byCategory, name: 'นักบริหารงานคลัง ระดับต้น', role: 'officer', category: 'dept_head', department_id: null, department_hint: 'กองคลัง', sort_order: 9 },
]
const person = (id, full_name, role, department_id, position_id, extra = {}) => ({
  id, full_name, role, department_id, position_id, is_dept_head: false, municipality_id: MUNI, job_title: null,
  email: `${id}@smartlocal.test`, phone: null, id_card: null, ...extra,
})
// ตั้งต้นครบทุกกรณีของแถว: ตรง / กรอกชื่อเอง / ถือตำแหน่งไม่ติ๊ก / เลือกคนอื่นไว้ / หลายคน / ไม่มีใคร / ไม่บังคับ
function freshDb() {
  return {
    profiles: [
      person('u-mayor', '[TEST] นายกตัวจริง', 'viewer', D.exec, P.mayor),
      person('u-clerk', '[TEST] ปลัดตัวจริง', 'admin', null, P.clerk),
      person('u-fin-head', '[TEST] ผอ.คลังไม่ติ๊ก', 'officer', D.fin, P.finHead),
      person('u-deputy-fin', '[TEST] รองผอ.คลัง', 'staff', D.fin, P.deputyFin),
      person('u-eng-head', '[TEST] ผอ.ช่างตัวจริง', 'officer', D.eng, P.engHead, { is_dept_head: true }),
      person('u-eng-other', '[TEST] นายช่างที่เคยตั้ง', 'technician', D.eng, P.tech),
      person('u-gen-a', '[TEST] หัวหน้าสำนัก ก', 'officer', D.gen, P.genHead, { is_dept_head: true }),
      person('u-gen-b', '[TEST] หัวหน้าสำนัก ข', 'officer', D.gen, P.genHead, { is_dept_head: true }),
      person('u-staff', '[TEST] เจ้าหน้าที่ธรรมดา', 'staff', D.gen, P.officerWork),
      person('u-new', '[TEST] คนใหม่ย้ายมา', 'staff', D.gen, P.officerWork),
      person('u-noname', '', 'staff', D.gen, P.officerWork),
      person('u-citizen', '[TEST] ประชาชนสมัครใหม่', 'citizen', null, null),
    ],
    signatories: [
      { id: 'r-mayor', signatory_role: 'mayor', department_id: null, custom_label: null, profile_id: 'u-mayor', manual_name: null, title_override: null, is_vehicle_order_default: false, effective_from: '2026-10-01', effective_to: null, is_active: true },
      { id: 'r-clerk', signatory_role: 'clerk', department_id: null, custom_label: null, profile_id: null, manual_name: '[TEST] ปลัดตัวจริง', title_override: 'ปลัดเทศบาล', is_vehicle_order_default: true, effective_from: '2026-10-01', effective_to: null, is_active: true },
      { id: 'r-eng', signatory_role: 'department_head', department_id: D.eng, custom_label: null, profile_id: 'u-eng-other', manual_name: null, title_override: null, is_vehicle_order_default: false, effective_from: '2026-10-01', effective_to: null, is_active: true },
    ],
    extraPositions: [],
    extraDepartments: [],
    writes: [],
    failSignatoryFor: new Set(),
  }
}
const DEPARTMENTS = [
  { id: D.gen, code: 'general', name: 'สำนักปลัด', short_name: 'สป.', sort_order: 1, is_active: true },
  { id: D.fin, code: 'finance', name: 'กองคลัง', short_name: 'คลัง', sort_order: 2, is_active: true },
  { id: D.eng, code: 'engineering', name: 'กองช่าง', short_name: 'ช่าง', sort_order: 3, is_active: true },
  { id: D.aud, code: 'audit', name: 'หน่วยตรวจสอบภายใน', short_name: 'ตส.', sort_order: 4, is_active: true },
  { id: D.exec, code: 'exec', name: 'คณะผู้บริหาร', short_name: 'บห.', sort_order: 5, is_active: true },
]

const positionsOf = db => [...positions(), ...db.extraPositions].filter(item => !db.deletedPositions?.has(item.id))
const departmentsOf = db => [...DEPARTMENTS, ...db.extraDepartments]
const positionById = (db, id) => positionsOf(db).find(item => item.id === id)
const withPosition = (db, row) => {
  const position = positionById(db, row.position_id)
  return { ...row, position: position ? { name: position.name, category: position.category } : null, department: departmentsOf(db).find(item => item.id === row.department_id) ?? null }
}
const usersRow = (db, row) => ({ ...row, position_name: positionById(db, row.position_id)?.name ?? null, department_name: departmentsOf(db).find(item => item.id === row.department_id)?.name ?? null, providers: ['email'], created_at: '2026-10-01T00:00:00Z' })

function installDb(page, db) {
  return page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.hostname === '127.0.0.1') return route.continue()
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    const bare = url.pathname
    if (bare.endsWith('/rpc/set_document_signatory_v4')) {
      const body = request.postDataJSON()
      db.writes.push({ rpc: 'set', ...body })
      const key = `${body.p_signatory_role}:${body.p_department_id ?? ''}:${body.p_custom_label ?? ''}`
      if (db.failSignatoryFor.has(key)) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'ฐานข้อมูลปฏิเสธ (จำลอง)', code: 'P0001' }) })
      const profile = db.profiles.find(item => item.id === body.p_profile_id)
      if (body.p_profile_id && !profile?.full_name?.trim()) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'ไม่พบบุคลากรในสังกัดนี้', code: '23503' }) })
      db.signatories = db.signatories.filter(row => !(row.signatory_role === body.p_signatory_role
        && (row.department_id ?? null) === (body.p_department_id ?? null) && (row.custom_label ?? null) === (body.p_custom_label ?? null)))
      db.signatories.push({
        id: `r-${db.writes.length}`, signatory_role: body.p_signatory_role, department_id: body.p_department_id,
        custom_label: body.p_custom_label, profile_id: body.p_profile_id, manual_name: body.p_manual_name,
        title_override: body.p_title_override, is_vehicle_order_default: body.p_is_vehicle_order_default,
        effective_from: body.p_effective_from ?? '2026-10-30', effective_to: null, is_active: true,
      })
      return json('new-id')
    }
    if (bare.endsWith('/rpc/clear_document_signatory_v2')) {
      const body = request.postDataJSON()
      db.writes.push({ rpc: 'clear', ...body })
      db.signatories = db.signatories.filter(row => !(row.signatory_role === body.p_signatory_role
        && (row.department_id ?? null) === (body.p_department_id ?? null) && (row.custom_label ?? null) === (body.p_custom_label ?? null)))
      return json(null)
    }
    if (bare.endsWith('/rpc/admin_update_user')) {
      const body = request.postDataJSON()
      db.writes.push({ rpc: 'update', userId: body.p_user_id, changes: body.p_changes })
      // จำลองรอบสองของการติ๊กหัวหน้าล้ม (ย้ายกองสำเร็จแล้ว) — หน้าจอต้องแสดงค่าจริง ไม่ใช่ค่าที่ส่งไป
      if (db.failHeadTick && Object.keys(body.p_changes).join() === 'is_dept_head' && body.p_changes.is_dept_head) {
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'ฐานข้อมูลปฏิเสธ (จำลอง)', code: 'P0001' }) })
      }
      const row = db.profiles.find(item => item.id === body.p_user_id)
      const before = { ...row }
      Object.assign(row, body.p_changes)
      // เลียนแบบ trigger sync_profile_department_from_position: กองเปลี่ยนในการบันทึกเดียวกัน = ล้างติ๊ก
      if (row.position_id && row.department_id !== before.department_id) row.is_dept_head = false
      return json(null)
    }
    if (bare.endsWith('/rpc/search_users_for_staff_assignment')) {
      const query = request.postDataJSON().p_search
      return json(db.profiles.filter(item => item.full_name.includes(query)).map(item => ({
        id: item.id, email: item.email, full_name: item.full_name, role: item.role, municipality_id: item.municipality_id,
        phone: item.phone, department_id: item.department_id, department_name: departmentsOf(db).find(dept => dept.id === item.department_id)?.name ?? null, is_dept_head: item.is_dept_head,
      })))
    }
    if (bare.includes('/rpc/get_users_with_email')) {
      const { p_department_id: dept, p_roles: roles } = request.postDataJSON()
      return json(db.profiles.filter(item => (!dept || item.department_id === dept) && (!roles || roles.includes(item.role))).map(row => usersRow(db, row)))
    }
    if (bare.endsWith('/rpc/esign_gate_status')) return json(db.esign ?? { ok: true, slot_modes: {} })
    if (bare.endsWith('/rpc/get_user_role_counts')) return json({ staff: db.profiles.filter(item => item.role !== 'citizen').length, citizen: db.profiles.filter(item => item.role === 'citizen').length })
    if (bare.endsWith('/rpc/get_staff_department_counts')) return json(DEPARTMENTS.map(item => ({ department_id: item.id, staff_count: db.profiles.filter(row => row.department_id === item.id).length })))
    if (bare.endsWith('/rpc/get_position_holder_counts')) return json(db.holderCounts ?? [])
    if (bare.endsWith('/rest/v1/departments')) {
      // แก้/ลบได้เฉพาะกองที่เทสต์สร้างเอง (กองตั้งต้นใช้ร่วมทุกชุด ห้ามเปลี่ยน)
      const targetId = url.searchParams.get('id')?.replace('eq.', '')
      if (request.method() === 'PATCH') {
        const target = db.extraDepartments.find(item => item.id === targetId)
        Object.assign(target, request.postDataJSON())
        db.writes.push({ rpc: 'update-department', ...target })
        return json(target)
      }
      if (request.method() === 'DELETE') {
        db.extraDepartments = db.extraDepartments.filter(item => item.id !== targetId)
        db.writes.push({ rpc: 'delete-department', id: targetId })
        return route.fulfill({ status: 204, body: '' })
      }
      if (request.method() !== 'POST') return json(departmentsOf(db))
      const body = request.postDataJSON()
      const created = { ...body, id: `d-new-${db.writes.length}`, is_active: true }
      db.writes.push({ rpc: 'insert-department', ...created })
      db.extraDepartments.push(created)
      return json(created)
    }
    if (bare.endsWith('/rest/v1/positions')) {
      if (request.method() === 'DELETE') {
        const targetId = url.searchParams.get('id')?.replace('eq.', '')
        db.deletedPositions = new Set([...(db.deletedPositions ?? []), targetId])
        db.writes.push({ rpc: 'delete-position', id: targetId })
        return route.fulfill({ status: 204, body: '' })
      }
      if (request.method() !== 'POST') return json(positionsOf(db))
      const body = request.postDataJSON()
      const created = { ...body, id: `p-new-${db.writes.length}` }
      db.writes.push({ rpc: 'insert-position', ...created })
      if (db.failPositionInsert) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'duplicate key', code: '23505' }) })
      db.extraPositions.push(created)
      return json(created)
    }
    if (bare.endsWith('/rest/v1/document_signatories')) {
      return json(db.signatories.map(row => {
        const profile = db.profiles.find(item => item.id === row.profile_id)
        return { ...row, profile: profile ? { full_name: profile.full_name, job_title: profile.job_title, position: positionById(db, profile.position_id) ? { name: positionById(db, profile.position_id).name } : null } : null }
      }))
    }
    if (bare.endsWith('/rest/v1/profiles')) {
      const params = url.searchParams
      const single = (request.headers().accept ?? '').includes('vnd.pgrst.object')
      let rows = db.profiles
      // ต้องกรอง role ตามจริง: หน้าผู้ลงนามขอเฉพาะบทบาทเจ้าหน้าที่ ไม่รวมสมาชิกสภา
      if (params.get('role')?.startsWith('in.(')) {
        const allowed = params.get('role').slice(4, -1).split(',')
        rows = rows.filter(item => allowed.includes(item.role))
      }
      if (params.get('department_id')) rows = rows.filter(item => item.department_id === params.get('department_id').replace('eq.', ''))
      if (params.get('is_dept_head')) rows = rows.filter(item => item.is_dept_head)
      if (params.get('id')?.startsWith('neq.')) rows = rows.filter(item => item.id !== params.get('id').slice(4))
      if (params.get('id')?.startsWith('eq.')) rows = rows.filter(item => item.id === params.get('id').slice(3))
      return single ? json(withPosition(db, rows[0] ?? {})) : json(rows.map(row => withPosition(db, row)))
    }
    return json([])
  })
}

const vite = await createServer({ root, appType: 'custom', server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
const fixtureHtml = (body) => `<!doctype html><html><head></head><body class="bg-slate-50"><div id="root"></div><script type="module">
  import React from 'react'; import {createRoot} from 'react-dom/client'; import '/src/index.css';
  ${body}
</script></body></html>`
const FIXTURES = {
  signatories: fixtureHtml(`
    import Page from '/src/components/admin/DocumentSigningSettings.jsx';
    createRoot(document.getElementById('root')).render(React.createElement(Page, {
      tenant:{id:'${MUNI}',name:'เทศบาลทดสอบ'}, onOpenUsers:()=>{document.body.dataset.openUsers='yes'},
    }));`),
  users: fixtureHtml(`
    import {UserManager} from '/src/pages/AdminDashboard.jsx';
    createRoot(document.getElementById('root')).render(React.createElement(UserManager, {
      tenant:{id:'${MUNI}',name:'เทศบาลทดสอบ'}, currentUserRole:'admin', currentUserId:'admin-test',
      onOpenSigning:()=>{document.body.dataset.openSigning='yes'},
    }));`),
}
vite.middlewares.use(async (request, response, next) => {
  const name = /^\/__(\w+)-fixture/.exec(request.url ?? '')?.[1]
  if (!FIXTURES[name]) return next()
  response.setHeader('Content-Type', 'text/html')
  response.end(await vite.transformIndexHtml(`/__${name}-fixture`, FIXTURES[name]))
})
await vite.listen()
const base = vite.resolvedUrls.local[0]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
if (SHOTS) await mkdir(SHOTS, { recursive: true })

let passed = 0
const failures = []
async function scenario(name, { viewport = { width: 1280, height: 900 }, db = freshDb(), fixture }, fn) {
  if (ONLY && !name.includes(ONLY)) return
  const context = await browser.newContext({ viewport, locale: 'th-TH', timezoneId: 'Asia/Bangkok' })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await installDb(page, db)
  try {
    await page.goto(`${base}__${fixture}-fixture`)
    await fn(page, db)
    assert.deepEqual(pageErrors, [], 'หน้าต้องไม่มี error ของ JavaScript')
    passed++
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`  ✗ ${name}\n    ${String(error.message).split('\n').slice(0, 6).join('\n    ')}`)
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `FAIL-${passed}-${failures.length}.png`), fullPage: true }).catch(() => {})
  } finally {
    await context.close()
  }
}

const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }) : null)
const row = (page, role, dept = '', label = '') => page.locator(`[data-signatory-slot="${role}:${dept || 'organization'}:${label}"]`)
const setWrites = db => db.writes.filter(write => write.rpc === 'set')
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

// ── หน้าผู้ลงนาม ──────────────────────────────────────────────────────────────
await scenario('เปิดหน้ามาเห็นขั้นต่อไปและสถานะครบทุกกรณี โดยไม่มีการเขียนอะไรเลย', { fixture: 'signatories' }, async (page, db) => {
  const next = page.locator('[data-signatory-next-step]')
  await next.waitFor({ timeout: 60000 })
  // ปลัด (กรอกชื่อเอง) · กองคลัง (ถือตำแหน่งไม่ติ๊ก) = 2 ช่อง · กองช่างเลือกคนอื่นไว้ ไม่นับ เพราะอาจตั้งใจ
  assert.match(await next.innerText(), /ระบบเตรียมชื่อให้แล้ว 2 ช่อง/)
  assert.match(await page.locator('[data-signatory-summary]').innerText(), /ตั้งแล้ว 3\/6 ช่อง · ลงนามในระบบได้ 2 ช่อง/)
  assert.match(await page.locator('[data-signatory-apply-all]').innerText(), /ตรวจและใช้ชื่อตามการแต่งตั้ง \(2 ช่อง\)/)

  const mayor = row(page, 'mayor')
  assert.match(await mayor.innerText(), /\[TEST\] นายกตัวจริง/)
  assert.match(await mayor.innerText(), /ตรงกับการแต่งตั้ง/)
  assert.match(await mayor.innerText(), /มีบัญชี · ลงนามในระบบได้/)

  const clerk = row(page, 'clerk')
  assert.match(await clerk.innerText(), /พิมพ์ชื่อเอง · เซ็นปากกาเท่านั้น/)
  assert.match(await clerk.innerText(), /คนเดิมมีบัญชีแล้ว/, 'ชื่อตรงกัน ต้องบอกว่าแค่ผูกบัญชี ไม่ใช่เปลี่ยนคน')
  assert.match(await clerk.innerText(), /ผู้มีอำนาจสั่งใช้รถ/)

  const finance = row(page, 'department_head', D.fin)
  assert.match(await finance.innerText(), /ยังไม่ได้ตั้ง · เอกสารจะเว้นชื่อให้เขียนด้วยมือ/)
  assert.match(await finance.innerText(), /\[TEST\] ผอ\.คลังไม่ติ๊ก/, 'ไม่มีใครติ๊ก ต้องเสนอคนถือตำแหน่งหัวหน้า')
  assert.doesNotMatch(await finance.innerText(), /รองผอ\.คลัง/, 'รองต้องไม่ถูกเสนอ')

  const engineering = row(page, 'department_head', D.eng)
  assert.match(await engineering.innerText(), /ตอนนี้ตั้งคนอื่นไว้/)

  const general = row(page, 'department_head', D.gen)
  assert.match(await general.innerText(), /การแต่งตั้งมี 2 คน \(\[TEST\] หัวหน้าสำนัก ก, \[TEST\] หัวหน้าสำนัก ข\)/, 'เจอหลายคนต้องบอกชื่อ และบอกให้เลือกเอง')
  assert.match(await general.innerText(), /เลือกเอง/)

  const audit = row(page, 'department_head', D.aud)
  assert.match(await audit.innerText(), /ไม่พบคนที่ถือตำแหน่งนี้ในการแต่งตั้ง/, 'ไม่มีข้อเสนอต้องบอกทางไปต่อ')
  assert.match(await audit.innerText(), /ถ้าหน่วยนี้ไม่มีหัวหน้า ปล่อยว่างได้/, 'หน่วยที่ไม่มีหัวหน้าจริงๆ ต้องรู้ว่าไม่ต้องทำอะไร')

  const exec = row(page, 'department_head', D.exec)
  assert.match(await exec.innerText(), /ไม่ได้ตั้ง \(ไม่บังคับ\)/)
  assert.doesNotMatch(await exec.innerText(), /เอกสารจะเว้นชื่อ/, 'แถวไม่บังคับต้องไม่เตือน')

  assert.equal(db.writes.length, 0, 'เปิดหน้าดูอย่างเดียวห้ามเขียน')
  assert.equal(await noOverflow(page), true)
  await shot(page, '1-signatories-desktop')
})

await scenario('ปุ่มรวม: ติ๊กให้เฉพาะช่องว่าง/กรอกชื่อเอง · ยืนยันแล้วเขียนตรงตามที่เห็น และคงเครื่องหมายรถ', { fixture: 'signatories' }, async (page, db) => {
  await page.locator('[data-signatory-apply-all]').click()
  const dialog = page.getByTestId('signatory-apply-dialog')
  await dialog.waitFor()
  assert.equal(db.writes.length, 0, 'เปิดกล่องยืนยันยังห้ามเขียน')
  const clerkKey = 'clerk:organization:'
  const finKey = `department_head:${D.fin}:`
  const engKey = `department_head:${D.eng}:`
  assert.equal(await dialog.locator(`[data-apply-row="${clerkKey}"]`).getAttribute('data-apply-state'), 'on')
  assert.equal(await dialog.locator(`[data-apply-row="${finKey}"]`).getAttribute('data-apply-state'), 'on')
  assert.equal(await dialog.locator(`[data-apply-row="${engKey}"]`).getAttribute('data-apply-state'), 'off', 'ช่องที่เลือกคนอื่นไว้ต้องไม่ติ๊กให้')
  assert.match(await dialog.locator(`[data-apply-row="${engKey}"]`).innerText(), /ตอนนี้ตั้งคนอื่นไว้ ระบบจึงไม่ติ๊กให้/)
  assert.match(await dialog.locator(`[data-apply-row="${clerkKey}"]`).innerText(), /คนเดิม เพิ่มบัญชีให้ลงนามในระบบได้/)
  assert.match(await dialog.locator(`[data-apply-row="${finKey}"]`).innerText(), /เดิมยังไม่มีผู้ลงนาม/)
  assert.match(await dialog.locator(`[data-apply-row="${finKey}"]`).innerText(), /ตำแหน่งที่พิมพ์ใต้ชื่อ: ผู้อำนวยการกองคลัง/)
  assert.match(await dialog.innerText(), /เรื่องที่ยังไม่เสร็จจะพิมพ์ชื่อใหม่ทันที · เรื่องที่เสร็จแล้วคงชื่อเดิม/, 'ต้องเห็นผลกระทบก่อนกด')
  assert.match(await dialog.locator('[data-apply-confirm]').innerText(), /ยืนยัน ตั้ง 2 ช่อง/)
  await shot(page, '2-apply-dialog-desktop')

  await dialog.locator('[data-apply-confirm]').click()
  await dialog.waitFor({ state: 'detached' })
  const writes = setWrites(db)
  assert.equal(writes.length, 2, 'ต้องเขียนเฉพาะช่องที่ติ๊ก')
  const clerk = writes.find(write => write.p_signatory_role === 'clerk')
  assert.equal(clerk.p_profile_id, 'u-clerk')
  assert.equal(clerk.p_manual_name, null)
  assert.equal(clerk.p_title_override, null, 'ผูกบัญชีแล้วต้องไม่ทับตำแหน่ง')
  assert.equal(clerk.p_effective_from, null, 'ให้ฐานข้อมูลกำหนดวันนี้เอง')
  assert.equal(clerk.p_is_vehicle_order_default, true, 'ต้องคงเครื่องหมายผู้มีอำนาจสั่งใช้รถ')
  const finance = writes.find(write => write.p_department_id === D.fin)
  assert.equal(finance.p_profile_id, 'u-fin-head')
  assert.equal(finance.p_is_vehicle_order_default, false)
  // ต้องส่งครบทุก argument ไม่งั้นเสี่ยง PGRST202
  assert.deepEqual(Object.keys(clerk).filter(key => key.startsWith('p_')).sort(), [
    'p_authority_reference', 'p_custom_label', 'p_department_id', 'p_effective_from', 'p_effective_to', 'p_is_vehicle_order_default',
    'p_manual_name', 'p_municipality_id', 'p_profile_id', 'p_signatory_role', 'p_title_override',
  ])
  await page.locator('[data-signatory-notice]').waitFor()
  assert.match(await page.locator('[data-signatory-notice]').innerText(), /ตั้งผู้ลงนามแล้ว 2 ช่อง/)
  assert.match(await row(page, 'clerk').innerText(), /มีบัญชี · ลงนามในระบบได้/)
  assert.match(await row(page, 'clerk').innerText(), /ตรงกับการแต่งตั้ง/)
  assert.match(await page.locator('[data-signatory-next-step]').innerText(), /ยังขาดผู้ลงนาม 2 ช่อง/, 'ตั้งที่เตรียมไว้หมดแล้ว แถบต้องเปลี่ยนไปบอกงานที่เหลือ')
})

await scenario('ปุ่ม "ใช้ชื่อนี้" รายช่อง: ขึ้นกล่องยืนยันก่อน · ยกเลิกแล้วไม่เขียน · ยืนยันแล้วเขียนช่องเดียว', { fixture: 'signatories' }, async (page, db) => {
  const engineering = row(page, 'department_head', D.eng)
  await engineering.locator('[data-signatory-apply-one]').click()
  const dialog = page.getByTestId('signatory-apply-dialog')
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /ตั้งผู้ลงนามช่อง “กองช่าง”/)
  assert.match(await dialog.innerText(), /เปลี่ยนคน/)
  assert.equal(await dialog.locator('input[type="checkbox"]').count(), 0, 'ช่องเดียวไม่ต้องติ๊ก กดยืนยันได้เลย')
  await dialog.getByRole('button', { name: 'ยกเลิก' }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(db.writes.length, 0, 'ยกเลิกต้องไม่เขียน')

  await engineering.locator('[data-signatory-apply-one]').click()
  await page.locator('[data-apply-confirm]').click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(setWrites(db).length, 1)
  assert.equal(setWrites(db)[0].p_profile_id, 'u-eng-head')
  await row(page, 'department_head', D.eng).getByText('ตรงกับการแต่งตั้ง').waitFor()
})

await scenario('ปุ่มรวมบันทึกไม่สำเร็จบางช่อง: ช่องที่ผ่านไม่หาย ช่องที่ล้มบอกเหตุ ลองใหม่เฉพาะที่ล้ม', { fixture: 'signatories' }, async (page, db) => {
  db.failSignatoryFor.add(`department_head:${D.fin}:`)
  await page.locator('[data-signatory-apply-all]').click()
  const dialog = page.getByTestId('signatory-apply-dialog')
  await dialog.locator('[data-apply-confirm]').click()
  const finRow = dialog.locator(`[data-apply-row="department_head:${D.fin}:"]`)
  await finRow.getByText('ฐานข้อมูลปฏิเสธ (จำลอง)').waitFor()
  assert.equal(await dialog.locator('[data-apply-row="clerk:organization:"]').getAttribute('data-apply-state'), 'done')
  assert.match(await dialog.locator('[data-apply-confirm]').innerText(), /ลองใหม่ 1 ช่อง/)
  db.failSignatoryFor.clear()
  const before = setWrites(db).length
  await dialog.locator('[data-apply-confirm]').click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(setWrites(db).length, before + 1, 'ต้องลองใหม่เฉพาะช่องที่ล้ม ไม่เขียนช่องที่ผ่านซ้ำ')
  assert.match(await page.locator('[data-signatory-notice]').innerText(), /ตั้งผู้ลงนามแล้ว 2 ช่อง/)
})

await scenario('กล่องแก้รายช่อง: ปุ่มที่กดไม่ได้บอกเหตุ · เลือกคนแล้วบันทึก · กรอกชื่อเองต้องมีตำแหน่ง', { fixture: 'signatories' }, async (page, db) => {
  await row(page, 'department_head', D.aud).locator('[data-signatory-edit]').click()
  const dialog = page.getByTestId('signatory-edit-dialog')
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /ผู้ลงนามช่อง “หน่วยตรวจสอบภายใน”/)
  assert.equal(await dialog.locator('[data-signatory-save]').isDisabled(), true)
  assert.match(await dialog.innerText(), /เลือกผู้ลงนามก่อนจึงบันทึกได้/, 'ปุ่มกดไม่ได้ต้องบอกเหตุผล')
  assert.match(await dialog.innerText(), /คนที่มีบัญชีในระบบ ลงนามในระบบได้/)
  assert.equal(await dialog.getByText('ใช้เป็นผู้มีอำนาจสั่งใช้รถโดยปริยาย').count(), 0, 'แถวกองติ๊กผู้มีอำนาจสั่งใช้รถไม่ได้')
  await shot(page, '3-edit-dialog-desktop')

  await dialog.getByRole('button', { name: 'กรอกชื่อเอง' }).click()
  assert.match(await dialog.innerText(), /ใช้สำหรับผู้ลงนามที่ไม่มีบัญชีในระบบ/)
  await dialog.locator('#signatory-manual-name').fill('[TEST] คนนอกระบบ')
  assert.match(await dialog.innerText(), /กรอกชื่อและตำแหน่งก่อนจึงบันทึกได้/, 'กรอกชื่ออย่างเดียวต้องบอกว่าขาดตำแหน่ง')
  await dialog.locator('#signatory-title').fill('หัวหน้าหน่วยตรวจสอบภายใน')
  assert.equal(await dialog.locator('[data-signatory-save]').isDisabled(), false)
  await dialog.locator('[data-signatory-save]').click()
  await dialog.waitFor({ state: 'detached' })
  const write = setWrites(db)[0]
  assert.equal(write.p_manual_name, '[TEST] คนนอกระบบ')
  assert.equal(write.p_profile_id, null)
  assert.equal(write.p_title_override, 'หัวหน้าหน่วยตรวจสอบภายใน')
  assert.match(await page.locator('[data-signatory-notice]').innerText(), /บันทึกผู้ลงนามช่อง “หน่วยตรวจสอบภายใน” แล้ว/)
  assert.match(await row(page, 'department_head', D.aud).innerText(), /พิมพ์ชื่อเอง · เซ็นปากกาเท่านั้น/)
})

await scenario('กล่องแก้รายช่อง: ไม่ได้แก้อะไรบันทึกไม่ได้ · เครื่องหมายรถอยู่แถวนายก · ยกเลิกผู้ลงนามบอกผลก่อน · Esc ปิด', { fixture: 'signatories' }, async (page, db) => {
  await row(page, 'mayor').locator('[data-signatory-edit]').click()
  const dialog = page.getByTestId('signatory-edit-dialog')
  await dialog.waitFor()
  assert.equal(await dialog.locator('[data-signatory-save]').isDisabled(), true)
  assert.match(await dialog.innerText(), /ยังไม่มีอะไรเปลี่ยน/)
  assert.match(await dialog.getByText('ใบขอใช้รถจะเลือกคนนี้ให้เอง').innerText(), /ติ๊กได้ช่องเดียว ถ้าไม่ติ๊กเลยจะใช้นายก/)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(db.writes.length, 0)

  await row(page, 'mayor').locator('[data-signatory-edit]').click()
  await dialog.waitFor()
  const messages = []
  page.once('dialog', async confirm => { messages.push(confirm.message()); await confirm.accept() })
  await dialog.locator('[data-signatory-clear]').click()
  await dialog.waitFor({ state: 'detached' })
  assert.match(messages[0], /เรื่องที่ยังไม่เสร็จจะเว้นชื่อให้เขียนด้วยมือ/)
  assert.equal(db.writes[0].rpc, 'clear')
  assert.equal(db.writes[0].p_signatory_role, 'mayor')
})

await scenario('เพิ่มผู้ลงนาม: ถามชื่อช่องแล้วเปิดกล่องทันที · ปิดโดยไม่บันทึกไม่ทิ้งแถวว่าง · บันทึกแล้วแถวอยู่', { fixture: 'signatories' }, async (page, db) => {
  const answer = text => page.once('dialog', confirm => confirm.accept(text))
  answer('รองนายก')
  await page.locator('[data-signatory-add]').click()
  const dialog = page.getByTestId('signatory-edit-dialog')
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /ผู้ลงนามช่อง “รองนายก”/)
  await dialog.getByRole('button', { name: 'ปิด', exact: true }).first().click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await row(page, 'custom', '', 'รองนายก').count(), 0, 'ปิดโดยไม่บันทึกต้องไม่ทิ้งแถวว่าง')

  answer('รองนายก')
  await page.locator('[data-signatory-add]').click()
  await dialog.waitFor()
  await dialog.locator('#signatory-person').selectOption('u-staff')
  await dialog.locator('[data-signatory-save]').click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(setWrites(db)[0].p_custom_label, 'รองนายก')
  assert.match(await row(page, 'custom', '', 'รองนายก').innerText(), /ใช้กับใบขออนุญาตใช้รถเท่านั้น/)
})

await scenario('มือถือ 390px: ไม่ล้นแนวนอน · ปุ่มสูงพอกด · ตัวอักษรไม่เล็กกว่า 12px · ปุ่มยืนยันไม่ถูกบัง', { fixture: 'signatories', viewport: { width: 390, height: 844 } }, async page => {
  await page.locator('[data-signatory-next-step]').waitFor({ timeout: 60000 })
  assert.equal(await noOverflow(page), true, 'หน้าห้ามล้นแนวนอน')
  const measure = () => page.evaluate(() => ({
    short: [...document.querySelectorAll('[data-signatory-next-step] button, [data-signatory-slot] button, [data-signatory-add], [role="dialog"] button, [role="dialog"] select, [role="dialog"] input:not([type="checkbox"])')]
      .filter(element => element.getClientRects().length && element.getBoundingClientRect().height < 44)
      .map(element => element.textContent?.trim() || element.id),
    tiny: [...document.querySelectorAll('[data-signatory-slot] *, [data-signatory-next-step] *, [role="dialog"] *')]
      .filter(element => element.children.length === 0 && element.textContent.trim() && parseFloat(getComputedStyle(element).fontSize) < 12)
      .map(element => element.textContent.trim().slice(0, 30)),
  }))
  const onPage = await measure()
  assert.deepEqual(onPage.short, [], 'ปุ่มบนหน้าต้องสูงอย่างน้อย 44px')
  assert.deepEqual(onPage.tiny, [], 'ตัวอักษรบนหน้าต้องไม่เล็กกว่า 12px')
  await shot(page, '4-signatories-mobile')

  await page.locator('[data-signatory-apply-all]').click()
  const dialog = page.getByTestId('signatory-apply-dialog')
  await dialog.waitFor()
  assert.equal(await noOverflow(page), true, 'กล่องยืนยันห้ามล้นแนวนอน')
  const inDialog = await measure()
  assert.deepEqual(inDialog.short, [], 'ปุ่มในกล่องต้องสูงอย่างน้อย 44px')
  assert.deepEqual(inDialog.tiny, [], 'ตัวอักษรในกล่องต้องไม่เล็กกว่า 12px')
  const reachable = await page.evaluate(() => {
    const button = document.querySelector('[data-apply-confirm]')
    const box = button.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return button.contains(hit) && box.bottom <= window.innerHeight
  })
  assert.equal(reachable, true, 'ปุ่มยืนยันต้องอยู่ในจอและไม่ถูกบัง')
  await shot(page, '5-apply-dialog-mobile')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })

  await row(page, 'department_head', D.aud).locator('[data-signatory-edit]').click()
  const edit = page.getByTestId('signatory-edit-dialog')
  await edit.waitFor()
  assert.equal(await noOverflow(page), true, 'กล่องแก้ห้ามล้นแนวนอน')
  const inEdit = await measure()
  assert.deepEqual(inEdit.short, [], 'ปุ่มในกล่องแก้ต้องสูงอย่างน้อย 44px')
  assert.deepEqual(inEdit.tiny, [], 'ตัวอักษรในกล่องแก้ต้องไม่เล็กกว่า 12px')
  await shot(page, '6-edit-dialog-mobile')
})

await scenario('ไม่มีข้อเสนอแต่ยังขาด: บอกให้ไปแต่งตั้ง และปุ่มพาไปหน้าจัดการผู้ใช้ · ครบแล้วบอกว่าจบ', {
  fixture: 'signatories',
  db: Object.assign(freshDb(), { profiles: [], signatories: [] }),
}, async (page, db) => {
  const next = page.locator('[data-signatory-next-step]')
  await next.waitFor({ timeout: 60000 })
  assert.match(await next.innerText(), /ยังขาดผู้ลงนาม 6 ช่อง/)
  await next.getByRole('button', { name: /ไปแต่งตั้งที่จัดการผู้ใช้/ }).click()
  assert.equal(await page.evaluate(() => document.body.dataset.openUsers), 'yes')
  assert.equal(db.writes.length, 0)
})

await scenario('ตั้งครบแล้ว: ขึ้นข้อความจบ ไม่มีปุ่มค้าง', {
  fixture: 'signatories',
  db: (() => {
    const db = freshDb()
    db.profiles = db.profiles.filter(item => ['u-mayor', 'u-clerk'].includes(item.id))
    db.signatories = [
      { ...db.signatories[0] },
      { ...db.signatories[1], profile_id: 'u-clerk', manual_name: null, title_override: null },
      ...[D.gen, D.fin, D.eng, D.aud].map(id => ({ id: `r-${id}`, signatory_role: 'department_head', department_id: id, custom_label: null, profile_id: null, manual_name: `[TEST] ผู้ลงนาม ${id}`, title_override: 'หัวหน้า', is_vehicle_order_default: false, effective_from: '2026-10-01', effective_to: null, is_active: true })),
    ]
    return db
  })(),
}, async page => {
  const next = page.locator('[data-signatory-next-step]')
  await next.waitFor({ timeout: 60000 })
  assert.match(await next.innerText(), /ตั้งครบแล้ว ไม่ต้องทำอะไรเพิ่ม/)
  assert.equal(await next.locator('button').count(), 0)
})

await scenario('ตั้งครบแล้วแต่มีช่องที่ตั้งคนอื่นไว้: ไม่เตือนค้าง บอกว่าถ้าตั้งใจก็ไม่ต้องทำอะไร', {
  fixture: 'signatories',
  db: (() => {
    const db = freshDb()
    db.profiles = db.profiles.filter(item => ['u-mayor', 'u-clerk', 'u-eng-head', 'u-eng-other'].includes(item.id))
    db.signatories = [
      { ...db.signatories[0] },
      { ...db.signatories[1], profile_id: 'u-clerk', manual_name: null, title_override: null },
      { ...db.signatories[2] },
      ...[D.gen, D.fin, D.aud].map(id => ({ id: `r-${id}`, signatory_role: 'department_head', department_id: id, custom_label: null, profile_id: null, manual_name: `[TEST] ผู้ลงนาม ${id}`, title_override: 'หัวหน้า', is_vehicle_order_default: false, effective_from: '2026-10-01', effective_to: null, is_active: true })),
    ]
    return db
  })(),
}, async page => {
  const next = page.locator('[data-signatory-next-step]')
  await next.waitFor({ timeout: 60000 })
  assert.match(await next.innerText(), /ตั้งครบแล้ว · มี 1 ช่องที่ชื่อไม่ตรงการแต่งตั้ง/)
  assert.match(await next.innerText(), /ถ้าตั้งใจให้คนเดิมลงนามต่อ ไม่ต้องทำอะไร/)
  assert.equal(await page.locator('[data-signatory-apply-all]').count(), 0, 'ไม่มีช่องที่ระบบติ๊กให้ ต้องไม่มีปุ่มรวมที่กดแล้วไม่มีอะไรให้ยืนยัน')
  await row(page, 'department_head', D.eng).locator('[data-signatory-apply-one]').waitFor()
})

await scenario('ชื่อที่พิมพ์ไว้เป็นคนละคนกับการแต่งตั้ง: ไม่ติ๊กให้ ไม่นับเป็นงานค้าง ต้องตัดสินเอง', {
  fixture: 'signatories',
  db: (() => {
    const db = freshDb()
    db.signatories[1].manual_name = '[TEST] คนอื่นที่พิมพ์ไว้'
    return db
  })(),
}, async (page, db) => {
  await page.locator('[data-signatory-next-step]').waitFor({ timeout: 60000 })
  assert.match(await page.locator('[data-signatory-next-step]').innerText(), /ระบบเตรียมชื่อให้แล้ว 1 ช่อง/, 'เหลือกองคลังที่ว่างอยู่ช่องเดียว')
  assert.match(await row(page, 'clerk').innerText(), /ตามการแต่งตั้ง แต่ตอนนี้ตั้งคนอื่นไว้/)
  await page.locator('[data-signatory-apply-all]').click()
  const dialog = page.getByTestId('signatory-apply-dialog')
  await dialog.waitFor()
  const clerk = dialog.locator('[data-apply-row="clerk:organization:"]')
  assert.equal(await clerk.getAttribute('data-apply-state'), 'off')
  assert.match(await clerk.innerText(), /เปลี่ยนคน/)
  assert.match(await dialog.locator('[data-apply-confirm]').innerText(), /ยืนยัน ตั้ง 1 ช่อง/)
  await dialog.locator('[data-apply-confirm]').click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(setWrites(db).length, 1)
  assert.equal(setWrites(db)[0].p_department_id, D.fin, 'ชื่อที่พิมพ์ไว้ต้องไม่ถูกเปลี่ยนโดยไม่ได้ติ๊ก')
})

await scenario('ผู้ลงนามที่อยู่นอกรายชื่อบุคลากร: กล่องแก้ยังเห็นชื่อเดิม ไม่ใช่ช่องว่าง', {
  fixture: 'signatories',
  db: (() => {
    const db = freshDb()
    db.profiles.push(person('u-council', '[TEST] สมาชิกสภา', 'council', null, null))
    db.signatories.push({ id: 'r-custom', signatory_role: 'custom', department_id: null, custom_label: 'ผู้แทนสภา', profile_id: 'u-council', manual_name: null, title_override: 'สมาชิกสภา', is_vehicle_order_default: false, effective_from: '2026-10-01', effective_to: null, is_active: true })
    return db
  })(),
}, async (page, db) => {
  await row(page, 'custom', '', 'ผู้แทนสภา').locator('[data-signatory-edit]').click()
  const dialog = page.getByTestId('signatory-edit-dialog')
  await dialog.waitFor()
  assert.equal(await dialog.locator('#signatory-person').inputValue(), 'u-council')
  assert.match(await dialog.locator('#signatory-person option:checked').innerText(), /\[TEST\] สมาชิกสภา · สมาชิกสภา \(ตั้งไว้เดิม\)/)
  assert.equal(await dialog.locator('[data-signatory-save]').isDisabled(), true, 'ยังไม่ได้แก้อะไร')
  assert.equal(db.writes.length, 0)
})

await scenario('หน้าผู้ลงนาม: ติ๊กหัวหน้าอย่างเดียวไม่ถูกเสนอ · ผู้ถือตำแหน่งหลายคนใช้คนที่ติ๊ก', {
  fixture: 'signatories',
  db: (() => {
    const db = freshDb()
    Object.assign(db.profiles.find(item => item.id === 'u-fin-head'), { position_id: P.tech, is_dept_head: true })
    db.profiles.find(item => item.id === 'u-gen-b').is_dept_head = false
    return db
  })(),
}, async (page) => {
  const finance = row(page, 'department_head', D.fin)
  await finance.waitFor({ timeout: 60000 })
  assert.match(await finance.innerText(), /ไม่พบคนที่ถือตำแหน่งนี้ในการแต่งตั้ง/, 'เจ้าของระบบสั่งแยก: ติ๊กหัวหน้าอย่างเดียวต้องไม่ถูกเสนอเป็นผู้ลงนาม')
  assert.doesNotMatch(await finance.innerText(), /ผอ\.คลังไม่ติ๊ก/)
  assert.match(await row(page, 'department_head', D.gen).innerText(), /\[TEST\] หัวหน้าสำนัก ก/, 'ผู้ถือตำแหน่งหลายคน ติ๊กไว้คนเดียวต้องเสนอคนนั้น')
  assert.doesNotMatch(await row(page, 'department_head', D.gen).innerText(), /การแต่งตั้งมี 2 คน/)
})

// ── ฟอร์มเจ้าหน้าที่หน้าเดียว (ผ่านหน้าจัดการผู้ใช้จริงทั้งหน้า) ──────────────────────────
const form = page => page.getByTestId('person-setup-form')
const escapeName = name => name.replace(/[[\]().]/g, '\\$&')
const slotRow = (page, departmentId) => page.locator(`[data-person-signing-row="department_head:${departmentId}:"]`)

async function openAdd(page) {
  await page.locator('[data-add-person]').waitFor({ timeout: 60000 })
  await page.locator('[data-add-person]').click()
  await form(page).waitFor()
}
async function pickAccount(page, who) {
  await page.locator('#person-account-search').fill(who)
  await form(page).getByRole('button', { name: new RegExp(escapeName(who)) }).click()
  await page.locator('[data-person-chosen]').waitFor()
}
async function pickPosition(page, name) {
  await page.locator('#person-position').fill(name)
  await page.locator('[data-person-position-list]').getByRole('button', { name: new RegExp(`^${escapeName(name)}`) }).click()
}
async function openUser(page, name, departmentCard = 'ทุกกอง / หน่วยงาน') {
  await page.getByRole('button', { name: new RegExp(departmentCard) }).first().waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: new RegExp(departmentCard) }).first().click()
  // จอใหญ่เรนเดอร์ทั้งการ์ดมือถือ (ซ่อน) และตาราง ต้องเลือกแถวที่มองเห็น
  const line = page.locator('tr:visible', { hasText: name }).first()
  await line.waitFor()
  await line.locator('td').nth(1).click()
  await form(page).waitFor()
}
const save = page => form(page).locator('[data-person-save]').click()
const savedOk = page => page.locator('[data-person-saved]').waitFor()
const updatesOf = (db, id) => db.writes.filter(write => write.rpc === 'update' && write.userId === id)

await scenario('เพิ่มเจ้าหน้าที่ ตำแหน่งหัวหน้า: ติ๊กให้ครบ · ย้ายกองแล้วติ๊กไม่หาย · เอาหัวหน้าคนเดิมออก · ตั้งผู้ลงนาม', { fixture: 'users', viewport: { width: 390, height: 844 } }, async (page, db) => {
  await openAdd(page)
  await pickAccount(page, 'คนใหม่ย้ายมา')
  await pickPosition(page, 'ผู้อำนวยการกองช่าง')
  const head = page.locator('[data-person-head] input')
  await head.waitFor()
  assert.equal(await head.isChecked(), true, 'ตำแหน่งหัวหน้าต้องติ๊กให้')
  assert.match(await page.locator('[data-person-head]').innerText(), /ไม่เกี่ยวกับการลงนามเอกสาร/, 'ต้องบอกบนหน้าจอว่าสองเรื่องนี้แยกกัน')
  assert.match(await page.locator('[data-person-role]').innerText(), /หัวหน้ากอง/, 'ต้องเห็นสิทธิ์ที่จะได้ก่อนบันทึก')
  assert.match(await page.locator('[data-person-role-change]').innerText(), /จากเดิม “เจ้าหน้าที่”/)
  const offer = slotRow(page, D.eng)
  await offer.waitFor()
  assert.match(await offer.innerText(), /ลงนามช่อง “กองช่าง”/)
  assert.match(await offer.innerText(), /ตอนนี้เป็น \[TEST\] นายช่างที่เคยตั้ง/, 'ต้องเห็นว่าจะทับใคร')
  assert.equal(await offer.locator('input').isChecked(), true, 'ตำแหน่งเพิ่งเปลี่ยนมา ต้องติ๊กให้')
  const oldHead = page.locator('[data-appointment-other-head="u-eng-head"]')
  await oldHead.waitFor()
  assert.match(await oldHead.innerText(), /เอาสถานะหัวหน้ากองของ \[TEST\] ผอ\.ช่างตัวจริง ออก/)
  assert.equal(await page.locator('[data-person-signing] [data-appointment-other-head]').count(), 0, 'หัวหน้าคนเดิมไม่ใช่เรื่องการลงนาม ต้องไม่อยู่ในกรอบนี้')
  assert.match(await page.locator('[data-person-signing]').innerText(), /เรื่องที่เสร็จแล้วคงชื่อเดิม/)
  assert.match(await page.locator('[data-person-moving]').innerText(), /สำนักปลัด อยู่ การบันทึกครั้งนี้จะย้ายมากองช่าง/)
  assert.match(await page.locator('[data-person-summary]').innerText(), /ผู้อำนวยการกองช่าง · กองช่าง · หัวหน้ากอง · สิทธิ์หัวหน้ากอง · ผู้ลงนาม กองช่าง/)
  await shot(page, '7-person-form-head-mobile')
  assert.equal(db.writes.length, 0, 'ยังไม่กดบันทึกห้ามเขียน')

  await save(page)
  await savedOk(page)
  const updates = updatesOf(db, 'u-new')
  assert.equal(updates[0].changes.role, 'officer')
  assert.equal(updates[0].changes.department_id, D.eng)
  assert.equal(updates.length, 2, 'ย้ายกองพร้อมติ๊กหัวหน้าต้องเขียน 2 รอบ เพราะฐานข้อมูลล้างติ๊กตอนย้าย')
  const stored = db.profiles.find(item => item.id === 'u-new')
  assert.equal(stored.is_dept_head, true, 'บั๊กเดิม: ย้ายกองพร้อมติ๊กแล้วติ๊กหาย')
  assert.equal(stored.department_id, D.eng)
  assert.equal(db.profiles.find(item => item.id === 'u-eng-head').is_dept_head, false, 'หัวหน้าคนเดิมต้องถูกเอาติ๊กออก')
  const set = setWrites(db)
  assert.equal(set.length, 1)
  assert.equal(set[0].p_profile_id, 'u-new')
  assert.equal(set[0].p_department_id, D.eng)
  assert.ok(db.writes.indexOf(updates[1]) < db.writes.indexOf(set[0]), 'ต้องแต่งตั้งเสร็จก่อนตั้งผู้ลงนาม')
})

await scenario('เพิ่มเจ้าหน้าที่ ตำแหน่งธรรมดา: ฟอร์มสั้น ไม่ติ๊กหัวหน้า ไม่ยกสิทธิ์ ไม่เขียนผู้ลงนาม', { fixture: 'users' }, async (page, db) => {
  await openAdd(page)
  await pickAccount(page, 'เจ้าหน้าที่ธรรมดา')
  await pickPosition(page, 'นายช่างโยธา')
  const head = page.locator('[data-person-head] input')
  await head.waitFor()
  assert.equal(await head.isChecked(), false)
  assert.equal(await page.locator('[data-person-signing-row]').count(), 0, 'ตำแหน่งธรรมดาต้องไม่เสนอผู้ลงนาม')
  assert.match(await page.locator('[data-person-signing]').innerText(), /คนนี้ยังไม่เป็นผู้ลงนาม ถ้าลงนามด้วยให้เลือกช่อง/)
  assert.equal(await page.locator('[data-person-role-change]').count(), 0, 'สิทธิ์ต้องไม่เปลี่ยน')
  await save(page)
  await savedOk(page)
  const updates = updatesOf(db, 'u-staff')
  assert.equal(updates.length, 1)
  assert.equal(updates[0].changes.role, 'staff')
  assert.equal(updates[0].changes.is_dept_head, false)
  assert.equal(updates[0].changes.department_id, D.gen, 'คนมีกองอยู่แล้ว ต้องคงกองเดิม')
  assert.equal(setWrites(db).length, 0)
})

await scenario('เพิ่มเจ้าหน้าที่: เอาติ๊กออกครบ = แต่งตั้งเฉยๆ', { fixture: 'users' }, async (page, db) => {
  await openAdd(page)
  await pickAccount(page, 'เจ้าหน้าที่ธรรมดา')
  await pickPosition(page, 'ผู้อำนวยการกองช่าง')
  await slotRow(page, D.eng).locator('input').uncheck()
  await page.locator('[data-appointment-other-head="u-eng-head"] input').uncheck()
  await page.locator('[data-person-role-open]').click()
  await page.locator('#person-role').selectOption('staff')
  await save(page)
  await savedOk(page)
  assert.equal(setWrites(db).length, 0, 'เอาติ๊กออกต้องไม่ตั้งผู้ลงนาม')
  assert.equal(db.profiles.find(item => item.id === 'u-eng-head').is_dept_head, true, 'เอาติ๊กออกต้องไม่แตะหัวหน้าคนเดิม')
  const stored = db.profiles.find(item => item.id === 'u-staff')
  assert.equal(stored.role, 'staff', 'เปลี่ยนสิทธิ์เองแล้วต้องได้ตามที่เลือก')
  assert.equal(stored.is_dept_head, true, 'ยังเป็นหัวหน้าตามที่เลือกไว้')
})

await scenario('เพิ่มเจ้าหน้าที่: ติ๊กหัวหน้าให้ตำแหน่งธรรมดา ไม่ถามเรื่องลงนาม · ไม่เขียนผู้ลงนาม', { fixture: 'users' }, async (page, db) => {
  await openAdd(page)
  await pickAccount(page, 'เจ้าหน้าที่ธรรมดา')
  await pickPosition(page, 'นายช่างโยธา')
  await page.locator('[data-person-head] input').check()
  await page.locator('[data-appointment-other-head="u-gen-a"]').waitFor()
  assert.equal(await page.locator('[data-person-signing-row]').count(), 0, 'ติ๊กหัวหน้าอย่างเดียวต้องไม่เสนอผู้ลงนาม')
  await save(page)
  await savedOk(page)
  assert.equal(db.profiles.find(item => item.id === 'u-staff').is_dept_head, true)
  assert.equal(setWrites(db).length, 0, 'ติ๊กหัวหน้าต้องไม่ตั้งผู้ลงนาม')
})

await scenario('เพิ่มเจ้าหน้าที่: ตำแหน่งหัวหน้า เอาติ๊กหัวหน้าออก ยังเป็นผู้ลงนามได้ · เอาติ๊กลงนามออก ยังเป็นหัวหน้าได้', { fixture: 'users' }, async (page, db) => {
  await openAdd(page)
  await pickAccount(page, 'เจ้าหน้าที่ธรรมดา')
  await pickPosition(page, 'ผู้อำนวยการกองช่าง')
  const offer = slotRow(page, D.eng).locator('input')
  await offer.waitFor()
  await page.locator('[data-person-head] input').uncheck()
  assert.equal(await offer.isChecked(), true, 'เอาติ๊กหัวหน้าออก ติ๊กลงนามต้องอยู่เหมือนเดิม')
  assert.equal(await page.locator('[data-appointment-other-head]').count(), 0, 'ไม่ได้เป็นหัวหน้าแล้ว ต้องไม่ถามเรื่องหัวหน้าคนเดิม')
  await offer.uncheck()
  await page.locator('[data-person-head] input').check()
  assert.equal(await offer.isChecked(), false, 'ติ๊กหัวหน้ากลับ ติ๊กลงนามต้องไม่กลับตาม')
  await offer.check()
  await page.locator('[data-person-head] input').uncheck()
  await save(page)
  await savedOk(page)
  assert.equal(db.profiles.find(item => item.id === 'u-staff').is_dept_head, false)
  assert.equal(setWrites(db)[0].p_profile_id, 'u-staff', 'ต้องเป็นผู้ลงนามตามที่ติ๊กไว้')
  assert.equal(db.profiles.find(item => item.id === 'u-eng-head').is_dept_head, true, 'ไม่ได้เป็นหัวหน้า ต้องไม่แตะหัวหน้าคนเดิม')
})

await scenario('เพิ่มเจ้าหน้าที่: ตั้งผู้ลงนามล้ม บอกว่าแต่งตั้งแล้ว เหลือปุ่มปิด ห้ามกดบันทึกซ้ำ', { fixture: 'users' }, async (page, db) => {
  db.failSignatoryFor.add(`department_head:${D.eng}:`)
  await openAdd(page)
  await pickAccount(page, 'เจ้าหน้าที่ธรรมดา')
  await pickPosition(page, 'ผู้อำนวยการกองช่าง')
  await slotRow(page, D.eng).waitFor()
  await save(page)
  const alert = form(page).getByRole('alert')
  await alert.waitFor()
  assert.match(await alert.innerText(), /แต่งตั้งแล้ว แต่ ตั้งผู้ลงนามช่อง “กองช่าง” ไม่สำเร็จ/)
  assert.equal(await form(page).locator('[data-person-save]').count(), 0, 'ห้ามกดบันทึกซ้ำจนเขียนการแต่งตั้งซ้ำ')
  await form(page).locator('[data-person-close]').click()
  await form(page).waitFor({ state: 'detached' })
})

await scenario('ตำแหน่ง: พิมพ์ ผอ. เจอตำแหน่งเดิม ไม่สร้างซ้ำ · ไม่มีในรายการเสนอเพิ่มใหม่ · กดกากบาทเลือกใหม่ได้', { fixture: 'users' }, async (page, db) => {
  await openAdd(page)
  await pickAccount(page, 'เจ้าหน้าที่ธรรมดา')
  await page.locator('#person-position').click()
  const list = page.locator('[data-person-position-list]')
  await list.waitFor()
  assert.match(await list.innerText(), /ผู้อำนวยการกองคลัง/, 'ยังไม่พิมพ์ต้องเห็นรายการให้เลือก')
  assert.match(await list.innerText(), /ไม่มีในรายการ พิมพ์ชื่อแล้วกดเพิ่มได้เลย/, 'ต้องบอกว่าเพิ่มใหม่ได้ก่อนพิมพ์')
  await page.locator('#person-position').fill('ผอ.กองช่าง')
  assert.equal(await list.locator(`[data-person-position-option="${P.engHead}"]`).count(), 1, 'พิมพ์ย่อต้องเจอตำแหน่งเดิม')
  assert.equal(await page.locator('[data-person-position-new]').count(), 0, 'มีอยู่แล้วต้องไม่เสนอเพิ่มซ้ำ')
  await page.locator('#person-position').fill('เจ้าพนักงานธุรการ')
  assert.match(await page.locator('[data-person-position-new]').innerText(), /เพิ่มตำแหน่งใหม่ “เจ้าพนักงานธุรการ”/)
  await page.locator('[data-person-position-new]').click()
  await page.locator('[data-person-new-position]').waitFor()
  await page.locator('[data-person-position-clear]').click()
  assert.equal(await page.locator('#person-position').inputValue(), '')
  assert.equal(await page.locator('[data-person-new-position]').count(), 0)
  assert.equal(db.writes.length, 0, 'พิมพ์เล่นต้องไม่สร้างอะไร')
})

await scenario('ตำแหน่งใหม่: สร้างตอนบันทึก ได้หมวดและสิทธิ์จากชื่อ · กองตามชื่อตำแหน่ง · ล็อกเฉพาะหัวหน้า', { fixture: 'users' }, async (page, db) => {
  await openAdd(page)
  await pickAccount(page, 'คนใหม่ย้ายมา')
  await page.locator('#person-position').fill('หัวหน้าหน่วยตรวจสอบภายใน')
  await page.locator('[data-person-position-new]').click()
  assert.equal(await page.locator('#person-department').inputValue(), D.aud, 'ชื่อกองอยู่ในชื่อตำแหน่ง ต้องเติมให้')
  assert.equal(await page.locator('#person-department').isDisabled(), true, 'ตำแหน่งหัวหน้ามีได้กองเดียว')
  assert.equal(await page.locator('[data-person-head] input').isChecked(), true)
  assert.equal(await slotRow(page, D.aud).locator('input').isChecked(), true)
  assert.equal(db.writes.length, 0, 'ยังไม่กดบันทึกห้ามสร้างตำแหน่ง')
  await save(page)
  await savedOk(page)
  const created = db.writes.find(write => write.rpc === 'insert-position')
  assert.equal(created.name, 'หัวหน้าหน่วยตรวจสอบภายใน')
  assert.equal(created.category, 'dept_head')
  assert.equal(created.role, 'officer')
  assert.equal(created.department_id, D.aud)
  const stored = db.profiles.find(item => item.id === 'u-new')
  assert.equal(stored.position_id, created.id)
  assert.equal(stored.is_dept_head, true)
  assert.ok(db.writes.indexOf(created) < db.writes.findIndex(write => write.rpc === 'update'), 'ต้องสร้างตำแหน่งก่อนแต่งตั้ง')
  assert.match(await page.locator('[data-person-saved]').innerText(), /เพิ่มตำแหน่ง “หัวหน้าหน่วยตรวจสอบภายใน” เข้ารายชื่อให้แล้ว/)
})

await scenario('ตำแหน่งใหม่ธรรมดา: ใช้ได้ทุกกอง ไม่ล็อก · สร้างไม่ได้เพราะชื่อซ้ำ บอกเหตุ ไม่แต่งตั้ง', { fixture: 'users' }, async (page, db) => {
  await openAdd(page)
  await pickAccount(page, 'เจ้าหน้าที่ธรรมดา')
  await page.locator('#person-position').fill('เจ้าพนักงานธุรการ')
  await page.locator('[data-person-position-new]').click()
  assert.equal(await page.locator('#person-department').isDisabled(), false)
  db.failPositionInsert = true
  await save(page)
  await form(page).getByRole('alert').waitFor()
  assert.match(await form(page).getByRole('alert').innerText(), /มีตำแหน่งชื่อ “เจ้าพนักงานธุรการ” อยู่แล้ว/)
  assert.equal(updatesOf(db, 'u-staff').length, 0, 'สร้างตำแหน่งไม่ได้ต้องไม่แต่งตั้ง')
  db.failPositionInsert = false
  await save(page)
  await savedOk(page)
  const created = db.writes.filter(write => write.rpc === 'insert-position').at(-1)
  assert.equal(created.department_id, null, 'ตำแหน่งธรรมดาต้องใช้ได้ทุกกอง')
  assert.equal(created.category, 'operating_staff')
  assert.equal(created.department_hint, 'สำนักปลัด', 'จำกองนี้ไว้เป็นกองแนะนำ')
})

await scenario('กองใหม่: ตำแหน่งหัวหน้าของกองที่ยังไม่มี ระบบเสนอชื่อกอง · บอกผลก่อนบันทึก · กันชื่อซ้ำ · สร้างตามลำดับ', { fixture: 'users' }, async (page, db) => {
  await openAdd(page)
  await pickAccount(page, 'ประชาชนสมัครใหม่')
  await page.locator('#person-position').fill('ผู้อำนวยการกองสวัสดิการสังคม')
  await page.locator('[data-person-position-new]').click()
  const typed = page.locator('#person-new-department')
  assert.equal(await typed.inputValue(), 'กองสวัสดิการสังคม', 'ต้องเสนอชื่อกองจากชื่อตำแหน่ง')
  assert.match(await page.locator('[data-person-new-department]').innerText(), /ขึ้นในทุกเมนูของระบบ และมีช่องผู้ลงนามเพิ่ม 1 ช่อง/)
  assert.match(await page.locator('[data-person-signing]').innerText(), /ลงนามช่อง “กองสวัสดิการสังคม”/, 'ช่องลงนามของกองใหม่ต้องขึ้นก่อนบันทึก')
  await typed.fill('กองคลัง')
  assert.match(await page.locator('[data-person-reason]').innerText(), /กองนี้มีอยู่แล้ว/)
  assert.equal(await form(page).locator('[data-person-save]').isDisabled(), true)
  await typed.fill('กองสวัสดิการสังคม')
  assert.equal(db.writes.length, 0, 'ยังไม่กดบันทึกห้ามสร้าง')
  await save(page)
  await savedOk(page)
  const department = db.writes.find(write => write.rpc === 'insert-department')
  const position = db.writes.find(write => write.rpc === 'insert-position')
  assert.equal(department.name, 'กองสวัสดิการสังคม')
  assert.equal(department.color, null, 'สีให้ trigger เลือก')
  assert.match(department.code, /^dept_/)
  assert.equal(position.department_id, department.id, 'ตำแหน่งหัวหน้าต้องล็อกกับกองใหม่')
  assert.equal(db.profiles.find(item => item.id === 'u-citizen').department_id, department.id)
  assert.equal(setWrites(db)[0].p_department_id, department.id, 'ต้องตั้งผู้ลงนามกับกองจริง ไม่ใช่รหัสชั่วคราว')
  assert.ok(db.writes.indexOf(department) < db.writes.indexOf(position))
})

await scenario('กองใหม่จากช่องกอง: เลือกเพิ่มกองใหม่ได้ · เปลี่ยนใจเลือกกองเดิมแล้วช่องพิมพ์หาย', { fixture: 'users' }, async (page, db) => {
  await openAdd(page)
  await pickAccount(page, 'ประชาชนสมัครใหม่')
  await pickPosition(page, 'นายช่างโยธา')
  await page.locator('#person-department').selectOption('__new')
  await page.locator('#person-new-department').waitFor()
  assert.match(await page.locator('[data-person-reason]').innerText(), /เลือกกองก่อน/, 'ยังไม่พิมพ์ชื่อกองต้องบันทึกไม่ได้')
  await page.locator('#person-department').selectOption(D.eng)
  assert.equal(await page.locator('#person-new-department').count(), 0)
  await page.locator('#person-department').selectOption('__new')
  await page.locator('#person-new-department').fill('กองพัสดุ')
  await save(page)
  await savedOk(page)
  assert.equal(db.writes.find(write => write.rpc === 'insert-department').name, 'กองพัสดุ')
  assert.equal(setWrites(db).length, 0, 'ตำแหน่งธรรมดาในกองใหม่ต้องไม่ถูกตั้งเป็นผู้ลงนาม')
})

await scenario('ตำแหน่งอื่นลงนามได้: เลือกช่องเอง เตือนเมื่อไม่ตรง ใส่ตำแหน่งใต้ชื่อ · สร้างช่องใหม่', { fixture: 'users' }, async (page, db) => {
  await openAdd(page)
  await pickAccount(page, 'เจ้าหน้าที่ธรรมดา')
  await pickPosition(page, 'นายช่างโยธา')
  const key = `department_head:${D.aud}:`
  await page.locator('[data-person-slot-add]').selectOption(key)
  const row = slotRow(page, D.aud)
  await row.waitFor()
  assert.match(await row.locator('[data-person-signing-warn]').innerText(), /ตรวจคำสั่งมอบอำนาจก่อน/, 'ตำแหน่งไม่ตรงช่องต้องเตือน')
  const title = page.locator(`[data-person-signing-title="${key}"]`)
  assert.equal(await title.inputValue(), 'นายช่างโยธา', 'ค่าเริ่มต้นคือตำแหน่งของคนนี้')
  await title.fill('รักษาราชการแทนหัวหน้าหน่วยตรวจสอบภายใน')
  await page.locator('[data-person-slot-add]').selectOption('__custom')
  await page.getByLabel('ชื่อช่องลงนามใหม่').fill('รองปลัดที่ได้รับมอบอำนาจ')
  assert.match(await page.locator('[data-person-custom-slot]').innerText(), /ใช้กับใบขออนุญาตใช้รถเท่านั้น/, 'ต้องบอกข้อจำกัดของช่องที่สร้างเอง')
  await page.getByRole('button', { name: 'เพิ่มช่องนี้' }).click()
  const custom = page.locator('[data-person-signing-row="custom:organization:รองปลัดที่ได้รับมอบอำนาจ"]')
  await custom.waitFor()
  assert.equal(await custom.locator('input[type="checkbox"]').isChecked(), true)
  assert.equal(await custom.locator('[data-person-signing-warn]').count(), 0, 'ช่องที่สร้างเองไม่มีตำแหน่งตายตัว ไม่ต้องเตือน')
  await shot(page, '10-person-form-other-signer')
  await save(page)
  await savedOk(page)
  const writes = setWrites(db)
  assert.equal(writes.length, 2)
  const audit = writes.find(write => write.p_department_id === D.aud)
  assert.equal(audit.p_profile_id, 'u-staff')
  assert.equal(audit.p_title_override, 'รักษาราชการแทนหัวหน้าหน่วยตรวจสอบภายใน')
  const created = writes.find(write => write.p_signatory_role === 'custom')
  assert.equal(created.p_custom_label, 'รองปลัดที่ได้รับมอบอำนาจ')
  assert.equal(created.p_title_override, null, 'ไม่ได้แก้ตำแหน่งใต้ชื่อ ต้องใช้ตำแหน่งตามการแต่งตั้ง')
  assert.equal(db.profiles.find(item => item.id === 'u-staff').is_dept_head, false, 'เป็นผู้ลงนามไม่ได้ทำให้เป็นหัวหน้ากอง')
})

await scenario('ไม่พบบัญชี: QR + ลิงก์สมัครของเว็บนี้ · เจ้าตัวสมัครแล้วค้นหาอีกครั้งเจอ', { fixture: 'users' }, async (page, db) => {
  await openAdd(page)
  await page.locator('#person-account-search').fill('มานะ')
  const panel = page.locator('[data-person-no-account]')
  await panel.waitFor()
  assert.match(await panel.innerText(), /ยังไม่มีบัญชีชื่อ “มานะ”/)
  assert.match(await panel.locator('[data-person-signup-link]').innerText(), /\/auth\?mode=register$/)
  assert.equal(await panel.getByRole('img', { name: 'QR สมัครใช้งาน' }).count(), 1, 'ต้องมี QR')
  assert.match(await panel.innerText(), /ตั้งที่เมนูการลงนามเอกสาร/, 'คนที่ไม่ต้องเข้าระบบต้องรู้ทางไปต่อ')
  await shot(page, '11-person-form-no-account')
  db.profiles.push(person('u-mana', '[TEST] มานะ สมัครแล้ว', 'citizen', null, null))
  await panel.getByRole('button', { name: 'ค้นหาอีกครั้ง' }).click()
  await form(page).getByRole('button', { name: /\[TEST\] มานะ สมัครแล้ว/ }).waitFor()
  assert.equal(await panel.count(), 0)
})

await scenario('ชื่อจาก LINE ไม่ครบ: กางช่องชื่อให้แก้ ชื่อที่ครบไม่กาง · แก้แล้วบันทึกชื่อใหม่', { fixture: 'users' }, async (page, db) => {
  await openAdd(page)
  db.profiles.push(person('u-line', 'สมชายไลน์', 'citizen', null, null))
  await pickAccount(page, 'สมชายไลน์')
  assert.match(await page.locator('[data-person-name-note]').innerText(), /ชื่อยังไม่ครบ/)
  await page.locator('#person-name-title').selectOption('นาย')
  await page.locator('#person-name-last').fill('ตัวอย่าง')
  assert.match(await page.locator('[data-person-name-note]').innerText(), /ชื่อนี้พิมพ์บนเอกสาร/)
  await pickPosition(page, 'นายช่างโยธา')
  await page.locator('#person-department').selectOption(D.eng)
  await save(page)
  await savedOk(page)
  const updates = updatesOf(db, 'u-line')
  assert.equal(updates[0].changes.full_name, 'นาย สมชายไลน์ ตัวอย่าง')
})

await scenario('บันทึก แล้วเพิ่มคนต่อ: ขึ้นผลที่ทำ ฟอร์มเริ่มใหม่', { fixture: 'users' }, async (page) => {
  await openAdd(page)
  await pickAccount(page, 'เจ้าหน้าที่ธรรมดา')
  await pickPosition(page, 'นายช่างโยธา')
  await form(page).locator('[data-person-save-next]').click()
  await savedOk(page)
  await page.locator('#person-account-search').waitFor()
  assert.equal(await page.locator('#person-position').inputValue(), '')
  assert.match(await page.locator('[data-person-reason]').innerText(), /เลือกคนก่อน/)
})

await scenario('ออกโดยยังไม่บันทึกต้องถาม · ไม่ได้แก้อะไรออกได้เลย', { fixture: 'users' }, async (page) => {
  await openUser(page, '[TEST] เจ้าหน้าที่ธรรมดา')
  const answers = []
  page.on('dialog', async dialog => { answers.push(dialog.message()); await (answers.length === 1 ? dialog.dismiss() : dialog.accept()) })
  await page.keyboard.press('Escape')
  await form(page).waitFor({ state: 'detached' })
  assert.equal(answers.length, 0, 'ไม่ได้แก้อะไรต้องไม่ถาม')
  await openUser(page, '[TEST] เจ้าหน้าที่ธรรมดา')
  await page.locator('[data-person-role-open]').click()
  await page.locator('#person-role').selectOption('technician')
  await page.keyboard.press('Escape')
  assert.match(answers[0], /ยังไม่ได้บันทึก/)
  assert.equal(await form(page).count(), 1, 'กดไม่ออก ต้องอยู่ต่อ')
  await form(page).getByRole('button', { name: 'ย้อนกลับ' }).click()
  await form(page).waitFor({ state: 'detached' })
})

await scenario('แก้คนเดิม: เลือกตำแหน่งหัวหน้า → ติ๊กให้ เสนอสิทธิ์ เสนอผู้ลงนาม → บันทึกครั้งเดียวจบ และหน้าจอตรงกับฐานข้อมูล', { fixture: 'users' }, async (page, db) => {
  await openUser(page, '[TEST] คนใหม่ย้ายมา')
  await page.locator('[data-person-position-clear]').click()
  await pickPosition(page, 'ผู้อำนวยการกองช่าง')
  assert.equal(await page.locator('[data-person-head] input').isChecked(), true, 'ตำแหน่งหัวหน้าต้องติ๊กให้')
  assert.match(await page.locator('[data-person-role-change]').innerText(), /จากเดิม “เจ้าหน้าที่”/, 'ตำแหน่งที่สร้างเองมี role staff ก็ต้องเสนอสิทธิ์หัวหน้ากอง')
  const offer = slotRow(page, D.eng)
  await offer.waitFor()
  assert.match(await offer.innerText(), /ตอนนี้เป็น \[TEST\] นายช่างที่เคยตั้ง/)
  await page.locator('[data-appointment-other-head="u-eng-head"]').waitFor()
  await shot(page, '8-person-form-edit-desktop')
  assert.equal(db.writes.length, 0, 'ยังไม่กดบันทึกห้ามเขียน')

  await save(page)
  await savedOk(page)
  const stored = db.profiles.find(item => item.id === 'u-new')
  assert.equal(stored.is_dept_head, true, 'บั๊กเดิม: ย้ายกองพร้อมติ๊กแล้วติ๊กหาย')
  assert.equal(stored.role, 'officer')
  assert.equal(db.profiles.find(item => item.id === 'u-eng-head').is_dept_head, false)
  assert.equal(setWrites(db)[0].p_profile_id, 'u-new')
  const line = page.locator('tr:visible', { hasText: '[TEST] คนใหม่ย้ายมา' }).first()
  await line.getByText(/ลงนาม: กองช่าง/).waitFor()
  await line.getByText('หัวหน้ากอง', { exact: true }).first().waitFor()
  await shot(page, '9-person-saved-desktop')
})

await scenario('แก้คนเดิม: ย้ายกองแล้วติ๊กไม่ติด บอกเหตุ ไม่ตั้งผู้ลงนาม และเปิดใหม่เห็นค่าจริงจากฐานข้อมูล', {
  fixture: 'users',
  db: Object.assign(freshDb(), { failHeadTick: true }),
}, async (page, db) => {
  await openUser(page, '[TEST] คนใหม่ย้ายมา')
  await page.locator('[data-person-position-clear]').click()
  await pickPosition(page, 'ผู้อำนวยการกองช่าง')
  await slotRow(page, D.eng).waitFor()
  await save(page)
  await form(page).getByRole('alert').waitFor()
  assert.match(await form(page).getByRole('alert').innerText(), /ย้ายกองแล้ว แต่ติ๊กหัวหน้ากองไม่สำเร็จ/)
  assert.equal(setWrites(db).length, 0, 'แต่งตั้งยังไม่ครบ ต้องยังไม่ตั้งผู้ลงนาม')
  page.on('dialog', dialog => dialog.accept())
  await form(page).getByRole('button', { name: 'ย้อนกลับ' }).click()
  await form(page).waitFor({ state: 'detached' })
  const line = page.locator('tr:visible', { hasText: '[TEST] คนใหม่ย้ายมา' }).first()
  await line.getByText('กองช่าง').first().waitFor()
  assert.equal(await line.getByText('หัวหน้ากอง', { exact: true }).count(), 1, 'เห็นเฉพาะป้ายสิทธิ์ ของจริงไม่ได้ติ๊กหัวหน้า')
})

await scenario('แก้คนเดิม: แก้ข้อมูลอื่นไม่ถามเรื่องผู้ลงนาม ไม่ทับผู้แทน', {
  fixture: 'users',
  db: (() => {
    const db = freshDb()
    db.profiles.find(item => item.id === 'u-eng-head').phone = '0800000000'
    db.signatories.find(item => item.id === 'r-eng').title_override = 'นายช่าง รักษาราชการแทน ผู้อำนวยการกองช่าง'
    return db
  })(),
}, async (page, db) => {
  await openUser(page, '[TEST] ผอ.ช่างตัวจริง')
  await page.locator('[data-person-signing]').waitFor()
  assert.equal(await slotRow(page, D.eng).count(), 0, 'ตั้งผู้แทนไว้ถือว่าตั้งใจ ต้องไม่เสนอและไม่เตือน')
  await page.locator('[data-person-fold="personal"] summary').click()
  await page.getByPlaceholder('0812345678', { exact: true }).fill('0899999999')
  await save(page)
  await savedOk(page)
  assert.equal(setWrites(db).length, 0, 'ต้องไม่ทับผู้รักษาราชการแทน')
  const update = updatesOf(db, 'u-eng-head')[0]
  assert.equal(update.changes.phone, '0899999999')
  assert.equal('address_province' in update.changes, false, 'ไม่ได้แก้ที่อยู่ ต้องไม่เขียนค่าตั้งต้นทับ')
  assert.equal('asset_role' in update.changes, false, 'ไม่ได้แก้สิทธิ์พัสดุ ต้องไม่เขียนทับ')
  assert.equal(update.changes.is_dept_head, true, 'แก้เบอร์โทรแล้วติ๊กหัวหน้าต้องไม่ขยับ')
  assert.equal(update.changes.role, 'officer')
})

await scenario('แก้คนเดิม: ติ๊กหัวหน้าอย่างเดียว ไม่ถามเรื่องลงนาม', { fixture: 'users' }, async (page, db) => {
  await openUser(page, '[TEST] คนใหม่ย้ายมา')
  await page.locator('[data-person-head] input').check()
  await page.locator('[data-appointment-other-head="u-gen-a"]').waitFor()
  assert.equal(await page.locator('[data-person-signing-row]').count(), 0, 'ติ๊กหัวหน้าอย่างเดียวต้องไม่เสนอผู้ลงนาม')
  await save(page)
  await savedOk(page)
  assert.equal(db.profiles.find(item => item.id === 'u-new').is_dept_head, true)
  assert.equal(setWrites(db).length, 0, 'ติ๊กหัวหน้าต้องไม่ตั้งผู้ลงนาม')
})

await scenario('แก้คนเดิม: หัวหน้าตามหมวดตำแหน่ง เปิดมาไม่ติ๊กลงนามให้ แต่บอกว่าควรลงนาม · แก้ข้อมูลอื่นไม่เขียน', {
  fixture: 'users',
  db: (() => {
    const db = freshDb()
    Object.assign(db.profiles.find(item => item.id === 'u-new'), { position_id: P.byCategory, department_id: D.fin })
    return db
  })(),
}, async (page, db) => {
  await openUser(page, '[TEST] คนใหม่ย้ายมา')
  const row = slotRow(page, D.fin)
  await row.waitFor()
  assert.match(await row.innerText(), /ตามการแต่งตั้ง คนนี้ควรลงนามช่องนี้/, 'แถวผู้ใช้มีแค่ชื่อตำแหน่ง ต้องรู้จากหมวดในทำเนียบ')
  assert.equal(await row.locator('input').isChecked(), false, 'ไม่ได้เปลี่ยนตำแหน่งต้องไม่ติ๊กให้')
  await save(page)
  await savedOk(page)
  assert.equal(setWrites(db).length, 0)
})

await scenario('แก้คนเดิม: คนที่แต่งตั้งไว้แล้วแต่ช่องยังไม่ตั้ง ติ๊กแล้วบันทึกตั้งได้จากตรงนี้', { fixture: 'users' }, async (page, db) => {
  await openUser(page, '[TEST] ผอ.คลังไม่ติ๊ก')
  const row = slotRow(page, D.fin)
  await row.waitFor()
  assert.equal(await row.locator('input').isChecked(), false)
  assert.equal(await page.locator('[data-person-head] input').isChecked(), false, 'ติ๊กเดิมไม่ได้ติ๊ก แก้ข้อมูลอื่นต้องไม่ขยับ')
  await row.locator('input').check()
  await save(page)
  await savedOk(page)
  assert.equal(setWrites(db)[0].p_profile_id, 'u-fin-head')
  assert.equal(db.profiles.find(item => item.id === 'u-fin-head').is_dept_head, false, 'ตั้งผู้ลงนามต้องไม่ทำให้ติ๊กหัวหน้า')
})

await scenario('แก้คนเดิม: เปลี่ยนจากหัวหน้าเป็นตำแหน่งอื่น เอาติ๊กออกให้ · สิทธิ์ไม่ลดเองแต่เตือน · เอาชื่อออกจากช่องได้', {
  fixture: 'users',
  db: (() => {
    const db = freshDb()
    db.signatories.push({ id: 'r-gen', signatory_role: 'department_head', department_id: D.eng, custom_label: null, profile_id: 'u-eng-head', manual_name: null, title_override: null, is_vehicle_order_default: false, effective_from: '2026-10-01', effective_to: null, is_active: true })
    db.signatories = db.signatories.filter(item => item.id !== 'r-eng')
    return db
  })(),
}, async (page, db) => {
  await openUser(page, '[TEST] ผอ.ช่างตัวจริง')
  const row = slotRow(page, D.eng)
  await row.waitFor()
  assert.match(await row.innerText(), /ตอนนี้คนนี้ลงนามช่องนี้อยู่/)
  await page.locator('[data-person-position-clear]').click()
  await pickPosition(page, 'นายช่างโยธา')
  assert.equal(await page.locator('[data-person-head] input').isChecked(), false, 'ออกจากตำแหน่งหัวหน้าต้องเอาติ๊กออก')
  assert.match(await page.locator('[data-person-role-kept]').innerText(), /ไม่ได้เป็นหัวหน้ากอง แต่สิทธิ์ยังเห็นงานของทั้งกอง/)
  assert.match(await row.locator('[data-person-signing-warn]').innerText(), /ถ้าคงติ๊กไว้ เอกสารยังพิมพ์ชื่อคนนี้/)
  assert.equal(await row.locator('input').isChecked(), true, 'ระบบต้องไม่เอาชื่อออกเอง')
  await row.locator('input').uncheck()
  await save(page)
  await savedOk(page)
  const cleared = db.writes.filter(write => write.rpc === 'clear')
  assert.equal(cleared.length, 1)
  assert.equal(cleared[0].p_department_id, D.eng)
  assert.equal(db.profiles.find(item => item.id === 'u-eng-head').role, 'officer', 'สิทธิ์ไม่ลดเอง')
})

await scenario('แก้คนเดิม: บัญชีไม่มีชื่อ ต้องใส่ชื่อก่อนจึงเป็นผู้ลงนามได้', {
  fixture: 'users',
  db: (() => {
    const db = freshDb()
    Object.assign(db.profiles.find(item => item.id === 'u-noname'), { full_name: '', email: 'no-name@smartlocal.test', position_id: P.clerk, department_id: null })
    db.signatories = db.signatories.filter(item => item.signatory_role !== 'clerk')
    db.profiles.find(item => item.id === 'u-clerk').position_id = null
    return db
  })(),
}, async (page, db) => {
  await openUser(page, 'no-name@smartlocal.test')
  const row = page.locator('[data-person-signing-row="clerk:organization:"]')
  await row.waitFor()
  await row.locator('input').check()
  assert.match(await page.locator('[data-person-reason]').innerText(), /ใส่ชื่อก่อน จึงเป็นผู้ลงนามได้/)
  assert.equal(await form(page).locator('[data-person-save]').isDisabled(), true, 'ไม่มีชื่อต้องไม่มีปุ่มที่กดแล้วเจอ error')
  await page.locator('#person-name-title').selectOption('นาย')
  await page.locator('#person-name-first').fill('ทดสอบ')
  await page.locator('#person-name-last').fill('มีชื่อ')
  await save(page)
  await savedOk(page)
  assert.equal(setWrites(db)[0].p_profile_id, 'u-noname')
  assert.equal(db.profiles.find(item => item.id === 'u-noname').full_name, 'นาย ทดสอบ มีชื่อ')
})

await scenario('แก้คนเดิม: ฟังก์ชันเดิมครบ — ย้อนกลับ โอนงาน รวมบัญชี ตั้งรหัส ลบ ข้อมูลบัญชี ข้อมูลส่วนตัว และกล่องซ้อนอยู่เหนือฟอร์ม', { fixture: 'users' }, async (page) => {
  await openUser(page, '[TEST] เจ้าหน้าที่ธรรมดา')
  // เจ้าของระบบสั่ง 2569-10-31: จอใหญ่ต้องอยู่กลางจอ ไม่ชิดขวา
  const box = await form(page).getByRole('dialog').boundingBox()
  assert.ok(Math.abs(box.x + box.width / 2 - 640) <= 2, `กล่องต้องอยู่กลางจอ (กึ่งกลางอยู่ที่ ${Math.round(box.x + box.width / 2)}px)`)
  assert.ok(box.y > 0 && box.y + box.height < 900, 'กล่องต้องไม่ชิดขอบบนล่าง')
  const actions = page.locator('[data-person-actions]')
  for (const label of ['โอนงานให้ผู้อื่น', 'รวมบัญชีซ้ำ', 'ตั้งรหัสผ่านใหม่', 'ลบผู้ใช้งาน']) {
    await actions.getByRole('button', { name: label }).waitFor()
  }
  await form(page).getByRole('button', { name: 'ย้อนกลับ' }).waitFor()
  assert.equal(await form(page).getByRole('button', { name: 'แก้ไขการแต่งตั้ง' }).count(), 0, 'ฟอร์มแก้ได้เลย ไม่มีปุ่มแก้ไขแล้ว')
  await page.locator('[data-person-fold="account"] summary').click()
  await page.locator('[data-person-fold="account"]').getByText('ชื่อผู้ใช้สำหรับเข้าสู่ระบบ').waitFor()
  await page.locator('[data-person-fold="account"]').getByText('ช่องทางเชื่อมต่อบัญชี').waitFor()
  await page.locator('[data-person-fold="account"]').getByText('เข้าสู่ระบบล่าสุด').waitFor()
  await page.locator('[data-person-fold="personal"] summary').click()
  await page.locator('[data-person-fold="personal"]').getByText('เลขบัตรประชาชน').waitFor()
  await page.locator('[data-person-fold="personal"]').getByText('ที่อยู่').waitFor()
  // กล่องอื่นซ้อนแบบเดียวกัน เลือกกล่องลบเพราะไม่ต้องพึ่งข้อมูล อปท. นอกฟอร์ม
  await actions.getByRole('button', { name: 'ลบผู้ใช้งาน' }).click()
  // หาปุ่มในกล่องลบเท่านั้น — ปุ่ม "ยกเลิก" ตัวสุดท้ายของหน้าอาจเป็นของฟอร์ม ถ้ากล่องหลุดไปอยู่ใต้ฟอร์มเทสต์จะผ่านลวง
  const button = page.getByRole('heading', { name: 'ยืนยันการลบผู้ใช้งาน' }).locator('xpath=..').getByRole('button', { name: 'ยกเลิก', exact: true })
  await button.waitFor()
  const onTop = await button.evaluate(element => {
    const box = element.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return element === hit || element.contains(hit)
  })
  assert.equal(onTop, true, 'กล่องยืนยันต้องอยู่เหนือฟอร์ม')
  await page.keyboard.press('Escape')
  assert.equal(await form(page).count(), 1, 'Esc ขณะมีกล่องซ้อนต้องไม่ปิดฟอร์ม')
})

await scenario('แก้คนเดิม: บัญชีตัวเองดูได้อย่างเดียว บอกเหตุ ไม่มีปุ่มบันทึก', {
  fixture: 'users',
  db: (() => {
    const db = freshDb()
    db.profiles.push(person('admin-test', '[TEST] แอดมินเอง', 'admin', D.gen, P.officerWork))
    return db
  })(),
}, async (page, db) => {
  await openUser(page, '[TEST] แอดมินเอง')
  assert.match(await page.locator('[data-person-read-only]').innerText(), /นี่คือบัญชีของคุณ/)
  assert.equal(await form(page).locator('[data-person-save]').count(), 0)
  assert.equal(await page.locator('#person-position').isDisabled(), true)
  await form(page).locator('[data-person-close]').click()
  await form(page).waitFor({ state: 'detached' })
  assert.equal(db.writes.length, 0)
})

await scenario('แก้คนเดิม: ตำแหน่งเก่าที่พิมพ์บนเอกสาร (job_title) เห็นก่อน กดแก้แล้วเอกสารพิมพ์ตามตำแหน่ง', {
  fixture: 'users',
  db: (() => {
    const db = freshDb()
    db.profiles.find(item => item.id === 'u-staff').job_title = 'ตำแหน่งเก่าที่พิมพ์ไว้'
    return db
  })(),
}, async (page, db) => {
  await openUser(page, '[TEST] เจ้าหน้าที่ธรรมดา')
  const note = page.locator('[data-person-job-title]')
  await note.waitFor()
  assert.match(await note.innerText(), /เอกสารของคนนี้พิมพ์ตำแหน่งว่า “ตำแหน่งเก่าที่พิมพ์ไว้”/)
  await note.getByRole('button').click()
  await page.locator('[data-person-job-title-cleared]').waitFor()
  await save(page)
  await savedOk(page)
  assert.equal(updatesOf(db, 'u-staff')[0].changes.job_title, null)
})

await scenario('แก้คนเดิม: บัญชีประชาชนเปิดฟอร์มเดียวกัน ข้อมูลส่วนตัวกางไว้ ไม่มีปุ่มโอนงาน แก้ได้โดยไม่ต้องมีตำแหน่ง', { fixture: 'users' }, async (page, db) => {
  await page.getByRole('button', { name: /^ประชาชน/ }).first().click()
  const line = page.locator('tr:visible', { hasText: '[TEST] ประชาชนสมัครใหม่' }).first()
  await line.waitFor({ timeout: 60000 })
  await line.locator('td').nth(1).click()
  await form(page).waitFor()
  assert.equal(await page.locator('[data-person-fold="personal"]').evaluate(element => element.open), true, 'ข้อมูลส่วนตัวคือข้อมูลหลักของประชาชน')
  assert.equal(await page.locator('[data-person-actions]').getByRole('button', { name: 'โอนงานให้ผู้อื่น' }).count(), 0)
  await page.getByPlaceholder('0812345678', { exact: true }).fill('0877777777')
  await save(page)
  await savedOk(page)
  const update = updatesOf(db, 'u-citizen')[0]
  assert.equal(update.changes.phone, '0877777777')
  assert.equal(update.changes.role, 'citizen', 'ไม่ได้แต่งตั้ง สิทธิ์ต้องไม่เปลี่ยน')
  assert.equal(setWrites(db).length, 0)
})

await scenario('หน้ารายชื่อ: ปุ่มเพิ่มเห็นเสมอ · ปุ่มไปแท็บกองและตำแหน่ง · แท็บเดิมรวมเป็นแท็บเดียว', { fixture: 'users' }, async (page) => {
  await page.locator('[data-add-person]').waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: /ทุกกอง \/ หน่วยงาน/ }).first().click()
  assert.equal(await page.locator('[data-add-person]').isVisible(), true, 'ปุ่มเพิ่มต้องไม่ซ่อนเมื่อไม่ได้เลือกกอง')
  const tabs = page.locator('[aria-label="เมนูจัดการผู้ใช้และการแต่งตั้ง"]')
  assert.equal(await tabs.getByRole('button', { name: /แบบตำแหน่ง/ }).count(), 0)
  await page.locator('[data-open-structure]').click()
  await page.locator('[data-user-manager-structure]').waitFor()
  await page.getByRole('button', { name: 'เพิ่มกอง', exact: true }).waitFor()
  await page.getByRole('button', { name: /เพิ่มตำแหน่ง/ }).waitFor()
  await page.getByRole('button', { name: /ชุดมาตรฐาน/ }).waitFor()
  assert.match(await page.locator('[data-user-manager-structure]').innerText(), /เพิ่มเจ้าหน้าที่ไม่ต้องมาหน้านี้ก่อน/)
  assert.equal(await page.locator('[data-add-person]').count(), 0)
})

// ── แท็บกองและตำแหน่ง: รายการเดียวจัดตามกอง (เจ้าของระบบสั่ง 2569-10-31 เพราะหน้ายาว 3-4 จอ) ──────
// 12 กอง 120 ตำแหน่ง — มากกว่าสนามซ้อม (7 กอง 28 ตำแหน่ง) ราว 4 เท่า
function manyDb() {
  const db = freshDb()
  for (let index = 1; index <= 7; index += 1) {
    db.extraDepartments.push({ id: `d-extra-${index}`, code: `dept_x${index}`, name: `กองทดสอบที่ ${index}`, short_name: `ทส.${index}`, sort_order: 10 + index, is_active: true })
  }
  const homes = [...DEPARTMENTS.filter(item => item.id !== D.exec), ...db.extraDepartments]
  for (let index = 1; index <= 111; index += 1) {
    const home = homes[index % homes.length]
    db.extraPositions.push({ id: `p-extra-${index}`, name: `ตำแหน่งทดสอบลำดับ ${index}`, role: 'staff', category: 'operating_staff', department_id: null, department_hint: home.name, sort_order: 100 + index })
  }
  return db
}
const structure = page => page.locator('[data-structure-manager]')
const structureGroup = (page, key) => structure(page).locator(`[data-structure-group="${key}"]`)
async function openStructure(page) {
  await page.locator('[data-open-structure]').click({ timeout: 60000 })
  await structure(page).locator('[data-structure-group]').first().waitFor()
}
const tabHeight = page => page.locator('[data-user-manager-structure]').evaluate(element => Math.round(element.getBoundingClientRect().height))

await scenario('กองและตำแหน่ง: ยาวตามจำนวนกอง ไม่ใช่จำนวนตำแหน่ง · เปิดทีละกอง · ค้นหากางเฉพาะที่เจอ', { fixture: 'users', db: manyDb() }, async (page) => {
  await openStructure(page)
  const groups = structure(page).locator('[data-structure-group]')
  assert.equal(await groups.count(), 13, '12 กอง + กลุ่มผู้บริหาร (กลุ่มใช้ได้ทุกกองไม่มีตำแหน่งจึงไม่ขึ้น)')
  assert.match(await structure(page).innerText(), /12 กอง · 120 ตำแหน่ง/)
  assert.equal(await structure(page).locator('[data-structure-position]').count(), 0, 'เปิดหน้ามาทุกกองต้องพับ')
  const height = await tabHeight(page)
  assert.ok(height < 1200, `120 ตำแหน่งต้องไม่ทำให้หน้ายาว (ได้ ${height}px · ของเดิมสนามซ้อม 28 ตำแหน่งยาว 2,705px)`)
  const finance = structureGroup(page, D.fin)
  await finance.locator('[data-structure-toggle]').click()
  assert.ok(await finance.locator('[data-structure-position]').count() > 5)
  const engineering = structureGroup(page, D.eng)
  await engineering.locator('[data-structure-toggle]').click()
  assert.equal(await finance.locator('[data-structure-position]').count(), 0, 'เปิดได้ทีละกอง กองเดิมต้องพับเอง')
  assert.ok(await engineering.locator('[data-structure-position]').count() > 5)
  await engineering.locator('[data-structure-toggle]').click()
  assert.equal(await structure(page).locator('[data-structure-position]').count(), 0, 'กดซ้ำต้องพับ')
  // ค้นหาชื่อตำแหน่ง: ขึ้นเฉพาะกองที่มี และกางให้เลย
  const search = structure(page).locator('[data-structure-search]')
  await search.fill('นายช่างโยธา')
  assert.equal(await groups.count(), 1)
  assert.equal(await structure(page).locator('[data-structure-position]').count(), 1)
  // ค้นหาชื่อย่อกอง: ขึ้นทั้งกอง แม้ชื่อตำแหน่งไม่มีคำนั้น
  await search.fill('ทส.3')
  assert.equal(await groups.count(), 1)
  assert.ok(await structure(page).locator('[data-structure-position]').count() > 5, 'เจอชื่อกองต้องเห็นตำแหน่งทั้งกอง')
  await search.fill('')
  assert.equal(await groups.count(), 13)
  assert.equal(await structure(page).locator('[data-structure-position]').count(), 0)
  await shot(page, '11-structure-desktop')
})

await scenario('กองและตำแหน่ง: เพิ่ม แก้ ลบกองในหน้าต่าง · ไม่มีฟอร์มค้างบนหน้า · กองชื่อซ้ำเพิ่มไม่ได้', { fixture: 'users' }, async (page, db) => {
  const asked = []
  page.on('dialog', dialog => { asked.push(dialog.message()); dialog.accept() })
  await openStructure(page)
  assert.equal(await page.locator('#department-name').count(), 0, 'ฟอร์มเพิ่มกองต้องไม่ค้างบนหน้า')
  await structure(page).locator('[data-structure-add-department]').click()
  const dialog = page.locator('[data-department-dialog]')
  await dialog.locator('#department-name').fill('กองคลัง')
  assert.match(await dialog.locator('[data-department-reason]').innerText(), /มีกองชื่อ “กองคลัง” อยู่แล้ว/)
  assert.equal(await dialog.locator('[data-department-save]').isDisabled(), true)
  await dialog.locator('#department-name').fill('กองสาธารณสุข')
  await dialog.locator('#department-short-name').fill('สธ.')
  assert.equal(db.writes.length, 0, 'ยังไม่กดบันทึกห้ามเขียน')
  await dialog.locator('[data-department-save]').click()
  await dialog.waitFor({ state: 'detached' })
  const created = db.writes.find(write => write.rpc === 'insert-department')
  assert.equal(created.name, 'กองสาธารณสุข')
  assert.equal(created.short_name, 'สธ.')
  assert.equal(created.color, null, 'ไม่เลือกสี = ให้ trigger เลือก')
  assert.match(created.code, /^dept_/)
  assert.equal(created.sort_order, DEPARTMENTS.length)
  const group = structureGroup(page, created.id)
  await group.locator('[data-structure-add-position]').waitFor({ timeout: 10000 })
  await group.locator('[data-structure-edit-department]').click()
  assert.equal(await dialog.getByRole('radio', { name: 'อัตโนมัติ' }).count(), 0, 'แก้กองต้องเลือกสีจริง')
  await dialog.locator('#department-name').fill('กองสาธารณสุขและสิ่งแวดล้อม')
  await dialog.locator('[data-department-save]').click()
  await dialog.waitFor({ state: 'detached' })
  const updated = db.writes.find(write => write.rpc === 'update-department')
  assert.equal(updated.id, created.id)
  assert.equal(updated.name, 'กองสาธารณสุขและสิ่งแวดล้อม')
  await group.getByText('กองสาธารณสุขและสิ่งแวดล้อม').waitFor()
  await group.locator('[data-structure-edit-department]').click()
  await dialog.locator('[data-department-delete]').click()
  await dialog.waitFor({ state: 'detached' })
  assert.ok(asked.some(message => message.includes('ลบกอง "กองสาธารณสุขและสิ่งแวดล้อม"')), 'ลบกองต้องถามก่อน')
  assert.equal(db.writes.at(-1).rpc, 'delete-department')
  await group.waitFor({ state: 'detached' })
})

await scenario('กองและตำแหน่ง: ลบตำแหน่งอยู่ในหน้าต่างแก้ · มีคนถืออยู่ลบไม่ได้ บอกเหตุ', {
  fixture: 'users', db: Object.assign(freshDb(), { holderCounts: [{ position_id: P.finHead, holder_count: 2 }] }),
}, async (page, db) => {
  const asked = []
  page.on('dialog', dialog => { asked.push(dialog.message()); dialog.accept() })
  await openStructure(page)
  const finance = structureGroup(page, D.fin)
  await finance.locator('[data-structure-toggle]').click()
  assert.equal(await finance.getByRole('button', { name: /^ลบ/ }).count(), 0, 'แถวตำแหน่งไม่มีปุ่มลบแล้ว')
  await finance.getByRole('button', { name: 'แก้ไขตำแหน่ง ผู้อำนวยการกองคลัง', exact: true }).click()
  const dialog = page.getByRole('dialog')
  assert.match(await dialog.locator('[data-position-delete-blocked]').innerText(), /ยังมีบุคลากร 2 คนถือตำแหน่งนี้/)
  assert.equal(await dialog.locator('[data-position-delete]').count(), 0)
  await dialog.getByRole('button', { name: 'ปิด' }).click()
  await finance.getByRole('button', { name: 'แก้ไขตำแหน่ง รองผู้อำนวยการกองคลัง', exact: true }).click()
  await dialog.locator('[data-position-delete]').click()
  await dialog.waitFor({ state: 'detached' })
  assert.ok(asked.some(message => message.includes('ลบตำแหน่ง "รองผู้อำนวยการกองคลัง"')), 'ลบตำแหน่งต้องถามก่อน')
  assert.deepEqual(db.writes.map(write => write.rpc), ['delete-position'])
  await finance.getByRole('button', { name: 'แก้ไขตำแหน่ง รองผู้อำนวยการกองคลัง', exact: true }).waitFor({ state: 'detached' })
  assert.equal(await finance.locator('[data-structure-position]').count() > 0, true, 'กองที่เปิดอยู่ต้องยังเปิด')
})

await scenario('กองและตำแหน่ง มือถือ 390px: สั้นกว่าเดิม · ไม่ล้นแนวนอน · ปุ่มสูงพอกด · ตัวอักษรไม่เล็กกว่า 12px', {
  fixture: 'users', db: manyDb(), viewport: { width: 390, height: 844 },
}, async (page) => {
  await openStructure(page)
  const height = await tabHeight(page)
  assert.ok(height < 1500, `มือถือ 120 ตำแหน่งต้องไม่ยาว (ได้ ${height}px · ของเดิมสนามซ้อม 28 ตำแหน่งยาว 3,628px)`)
  await structureGroup(page, D.fin).locator('[data-structure-toggle]').click()
  assert.equal(await noOverflow(page), true, 'ต้องไม่ล้นแนวนอน')
  const shortControls = list => list.evaluateAll(items => items
    .filter(item => item.getBoundingClientRect().height < 44)
    .map(item => item.textContent?.trim() || item.getAttribute('aria-label') || item.id))
  assert.deepEqual(await shortControls(structure(page).locator('button:visible, input:visible')), [], 'ปุ่มและช่องกรอกต้องสูงอย่างน้อย 44px')
  const smallText = await structure(page).evaluate(root => [...root.querySelectorAll('*')]
    .filter(item => item.children.length === 0 && item.textContent.trim() && parseFloat(getComputedStyle(item).fontSize) < 12)
    .map(item => item.textContent.trim().slice(0, 30)))
  assert.deepEqual(smallText, [], 'ตัวอักษรต้องไม่เล็กกว่า 12px')
  await shot(page, '12-structure-mobile')
  await structure(page).locator('[data-structure-add-department]').click()
  const dialog = page.locator('[data-department-dialog]')
  await dialog.locator('#department-name').waitFor()
  assert.equal(await noOverflow(page), true, 'หน้าต่างกองต้องไม่ล้น')
  assert.deepEqual(await shortControls(dialog.locator('button:visible, input:visible')), [], 'ปุ่มสีและปุ่มในหน้าต่างต้องสูงอย่างน้อย 44px')
  await shot(page, '13-department-dialog-mobile')
})

await scenario('แถบผู้ลงนาม: บอกช่องที่ขาด กดตั้งเลยเปิดฟอร์มพร้อมตำแหน่ง · ครบแล้วบอกว่าครบ', { fixture: 'users' }, async (page, db) => {
  const bar = page.locator('[data-signing-bar]')
  await bar.waitFor({ timeout: 60000 })
  assert.match(await bar.innerText(), /ผู้ลงนาม 3 จาก 6 ช่อง/, 'กองผู้บริหารไม่บังคับ ต้องไม่นับ')
  assert.match(await bar.innerText(), /ยังไม่มี: สำนักปลัด/)
  await page.locator(`[data-signing-bar-set="department_head:${D.fin}:"]`).click()
  await form(page).waitFor()
  assert.equal(await page.locator('#person-position').inputValue(), 'ผู้อำนวยการกองคลัง', 'ตำแหน่งของช่องนั้นต้องเติมให้')
  await pickAccount(page, 'คนใหม่ย้ายมา')
  await slotRow(page, D.fin).waitFor()
  assert.equal(await slotRow(page, D.fin).locator('input').isChecked(), true)
  await save(page)
  await savedOk(page)
  assert.equal(setWrites(db)[0].p_department_id, D.fin)
  await bar.getByText('ผู้ลงนาม 4 จาก 6 ช่อง').waitFor()
})

await scenario('วิธีลงนาม: เซ็นสดไม่พูดเรื่องรหัส · เปิดออนไลน์แล้วบอกว่าเจ้าตัวต้องตั้งเอง', { fixture: 'users' }, async (page) => {
  await openAdd(page)
  await pickAccount(page, 'เจ้าหน้าที่ธรรมดา')
  await pickPosition(page, 'นายช่างโยธา')
  await page.locator('[data-person-sign-mode="wet"]').waitFor()
  assert.equal(await page.locator('[data-person-sign-mode="online"]').count(), 0)
})

await scenario('วิธีลงนาม: หน่วยงานเปิดออนไลน์ ฟอร์มบอกสิ่งที่เจ้าตัวต้องทำ และบอกซ้ำหลังบันทึก', {
  fixture: 'users',
  db: Object.assign(freshDb(), { esign: { slot_modes: { authority: 'online', dept_head: 'online' } } }),
}, async (page) => {
  await openAdd(page)
  await pickAccount(page, 'เจ้าหน้าที่ธรรมดา')
  await pickPosition(page, 'ผู้อำนวยการกองช่าง')
  await page.locator('[data-person-sign-mode="online"]').waitFor()
  assert.equal(await page.locator('[data-person-sign-mode="wet"]').count(), 0)
  await save(page)
  await savedOk(page)
  assert.match(await page.locator('[data-person-saved]').innerText(), /เจ้าตัวต้องตั้งรหัสลงนามและเพิ่มลายเซ็นเอง/)
})

await scenario('มือถือ 390px: ฟอร์มไม่ล้นแนวนอน · ปุ่มสูงพอกด · ตัวอักษรไม่เล็กกว่า 12px · ปุ่มบันทึกไม่ถูกบัง', { fixture: 'users', viewport: { width: 390, height: 844 } }, async (page) => {
  await page.locator('[data-add-person]').first().waitFor({ timeout: 60000 })
  assert.equal(await noOverflow(page), true, 'หน้ารายชื่อต้องไม่ล้น')
  await openAdd(page)
  await pickAccount(page, 'คนใหม่ย้ายมา')
  await pickPosition(page, 'ผู้อำนวยการกองช่าง')
  await page.locator('[data-person-role-open]').click()
  await slotRow(page, D.eng).waitFor()
  assert.equal(await noOverflow(page), true, 'ฟอร์มต้องไม่ล้น')
  const shortControls = await form(page).locator('button:visible, input:visible:not([type="checkbox"]), select:visible').evaluateAll(items => items
    .filter(item => item.getBoundingClientRect().height < 44)
    .map(item => item.textContent?.trim() || item.id))
  assert.deepEqual(shortControls, [], 'ปุ่มและช่องกรอกต้องสูงอย่างน้อย 44px')
  const smallText = await form(page).evaluate(root => [...root.querySelectorAll('*')]
    .filter(item => item.children.length === 0 && item.textContent.trim() && parseFloat(getComputedStyle(item).fontSize) < 12)
    .map(item => item.textContent.trim().slice(0, 30)))
  assert.deepEqual(smallText, [], 'ตัวอักษรต้องไม่เล็กกว่า 12px')
  const saveButton = form(page).locator('[data-person-save]')
  const onTop = await saveButton.evaluate(element => {
    const box = element.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return box.bottom <= window.innerHeight && (element === hit || element.contains(hit))
  })
  assert.equal(onTop, true, 'ปุ่มบันทึกต้องอยู่ในจอและไม่ถูกบัง')
})

await browser.close()
await vite.close()
console.log(`signing-setup: ผ่าน ${passed} ชุด${failures.length ? ` · ไม่ผ่าน ${failures.length} ชุด` : ''}`)
process.exit(failures.length ? 1 : 0)

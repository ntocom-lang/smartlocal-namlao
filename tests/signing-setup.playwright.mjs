// หน้า "ผู้ลงนามแต่ละช่อง" + แท็บการแต่งตั้ง + ปุ่มเพิ่มบุคลากร — ทดสอบบนเบราว์เซอร์จริงด้วยฐานข้อมูลจำลอง (ไม่แตะฐานจริง)
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
    ],
    signatories: [
      { id: 'r-mayor', signatory_role: 'mayor', department_id: null, custom_label: null, profile_id: 'u-mayor', manual_name: null, title_override: null, is_vehicle_order_default: false, effective_from: '2026-10-01', effective_to: null, is_active: true },
      { id: 'r-clerk', signatory_role: 'clerk', department_id: null, custom_label: null, profile_id: null, manual_name: '[TEST] ปลัดตัวจริง', title_override: 'ปลัดเทศบาล', is_vehicle_order_default: true, effective_from: '2026-10-01', effective_to: null, is_active: true },
      { id: 'r-eng', signatory_role: 'department_head', department_id: D.eng, custom_label: null, profile_id: 'u-eng-other', manual_name: null, title_override: null, is_vehicle_order_default: false, effective_from: '2026-10-01', effective_to: null, is_active: true },
    ],
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

const positionById = id => positions().find(item => item.id === id)
const withPosition = row => {
  const position = positionById(row.position_id)
  return { ...row, position: position ? { name: position.name, category: position.category } : null, department: DEPARTMENTS.find(item => item.id === row.department_id) ?? null }
}
const usersRow = row => ({ ...row, position_name: positionById(row.position_id)?.name ?? null, department_name: DEPARTMENTS.find(item => item.id === row.department_id)?.name ?? null, providers: ['email'], created_at: '2026-10-01T00:00:00Z' })

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
        phone: item.phone, department_id: item.department_id, department_name: DEPARTMENTS.find(dept => dept.id === item.department_id)?.name ?? null, is_dept_head: item.is_dept_head,
      })))
    }
    if (bare.includes('/rpc/get_users_with_email')) {
      const { p_department_id: dept } = request.postDataJSON()
      return json(db.profiles.filter(item => !dept || item.department_id === dept).map(usersRow))
    }
    if (bare.endsWith('/rpc/get_user_role_counts')) return json({ staff: db.profiles.length, citizen: 0 })
    if (bare.endsWith('/rpc/get_staff_department_counts')) return json(DEPARTMENTS.map(item => ({ department_id: item.id, staff_count: db.profiles.filter(row => row.department_id === item.id).length })))
    if (bare.endsWith('/rpc/get_position_holder_counts')) return json([])
    if (bare.endsWith('/rest/v1/departments')) return json(DEPARTMENTS)
    if (bare.endsWith('/rest/v1/positions')) return json(positions())
    if (bare.endsWith('/rest/v1/document_signatories')) {
      return json(db.signatories.map(row => {
        const profile = db.profiles.find(item => item.id === row.profile_id)
        return { ...row, profile: profile ? { full_name: profile.full_name, job_title: profile.job_title, position: positionById(profile.position_id) ? { name: positionById(profile.position_id).name } : null } : null }
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
      return single ? json(withPosition(rows[0] ?? {})) : json(rows.map(withPosition))
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
  quick: fixtureHtml(`
    import Dialog from '/src/components/admin/PersonnelQuickAssignDialog.jsx';
    createRoot(document.getElementById('root')).render(React.createElement(Dialog, {
      tenant:{id:'${MUNI}'}, department:${JSON.stringify(DEPARTMENTS[2])}, currentUserId:'admin-test', currentUserRole:'admin',
      positions:${JSON.stringify(positions())},
      onClose:()=>{document.body.dataset.closed='yes'}, onSaved:()=>{document.body.dataset.saved='yes'},
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

// ── ปุ่มเพิ่มบุคลากร ─────────────────────────────────────────────────────────
async function pickInQuick(page, who, positionName) {
  await page.locator('#quick-account-search').fill(who)
  await page.getByRole('button', { name: new RegExp(who.replace(/[[\]]/g, '\\$&')) }).click()
  await page.locator('#quick-position-search').fill(positionName)
  await page.getByRole('button', { name: new RegExp(`^${positionName}`) }).click()
}

await scenario('ปุ่มเพิ่มบุคลากร ตำแหน่งหัวหน้า: ติ๊กให้ครบ · ย้ายกองแล้วติ๊กไม่หาย · เอาหัวหน้าคนเดิมออก · ตั้งผู้ลงนาม', { fixture: 'quick', viewport: { width: 390, height: 844 } }, async (page, db) => {
  await pickInQuick(page, 'คนใหม่ย้ายมา', 'ผู้อำนวยการกองช่าง')
  const head = page.locator('[data-quick-head] input')
  const officer = page.locator('[data-quick-officer] input')
  await head.waitFor()
  assert.equal(await head.isChecked(), true, 'ตำแหน่งหัวหน้าต้องติ๊กให้')
  assert.equal(await officer.isChecked(), true)
  const offer = page.locator(`[data-appointment-signing-offer="department_head:${D.eng}:"]`)
  await offer.waitFor()
  assert.match(await offer.innerText(), /ตั้งเป็นผู้ลงนามช่อง “กองช่าง” ด้วย/)
  assert.match(await offer.innerText(), /ตอนนี้ช่องนี้เป็น \[TEST\] นายช่างที่เคยตั้ง/, 'ต้องเห็นว่าจะทับใคร')
  const oldHead = page.locator('[data-appointment-other-head="u-eng-head"]')
  await oldHead.waitFor()
  assert.match(await oldHead.innerText(), /เอาสถานะหัวหน้ากองของ \[TEST\] ผอ\.ช่างตัวจริง ออก/)
  assert.match(await page.locator('[data-appointment-signing]').innerText(), /เรื่องที่เสร็จแล้วคงชื่อเดิม/)
  assert.equal(await page.locator('[data-appointment-signing] [data-appointment-other-head]').count(), 0, 'หัวหน้าคนเดิมไม่ใช่เรื่องการลงนาม ต้องไม่อยู่ในกรอบนี้')
  await shot(page, '7-quick-assign-head-mobile')
  assert.equal(db.writes.length, 0, 'ยังไม่กดยืนยันห้ามเขียน')

  await page.getByRole('button', { name: 'ยืนยันการย้ายและแต่งตั้ง' }).click()
  await page.waitForFunction(() => document.body.dataset.saved === 'yes')
  const updates = db.writes.filter(write => write.rpc === 'update' && write.userId === 'u-new')
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

await scenario('ปุ่มเพิ่มบุคลากร ตำแหน่งธรรมดา: ไม่ติ๊กอะไรให้ · ไม่ยกสิทธิ์ · ไม่เขียนผู้ลงนาม', { fixture: 'quick' }, async (page, db) => {
  await pickInQuick(page, 'เจ้าหน้าที่ธรรมดา', 'นายช่างโยธา')
  const head = page.locator('[data-quick-head] input')
  await head.waitFor()
  assert.equal(await head.isChecked(), false)
  assert.equal(await page.locator('[data-quick-officer]').count(), 0)
  assert.equal(await page.locator('[data-appointment-signing]').count(), 0)
  await page.getByRole('button', { name: 'ยืนยันการย้ายและแต่งตั้ง' }).click()
  await page.waitForFunction(() => document.body.dataset.saved === 'yes')
  const updates = db.writes.filter(write => write.rpc === 'update')
  assert.equal(updates.length, 1)
  assert.equal(updates[0].changes.role, 'staff')
  assert.equal(updates[0].changes.is_dept_head, false)
  assert.equal(setWrites(db).length, 0)
})

await scenario('ปุ่มเพิ่มบุคลากร: เอาติ๊กออกครบ = แต่งตั้งเฉยๆ · รองไม่ติ๊กให้', { fixture: 'quick' }, async (page, db) => {
  await pickInQuick(page, 'เจ้าหน้าที่ธรรมดา', 'ผู้อำนวยการกองช่าง')
  await page.locator('[data-appointment-signing]').waitFor()
  await page.locator(`[data-appointment-signing-offer="department_head:${D.eng}:"] input`).uncheck()
  await page.locator('[data-appointment-other-head="u-eng-head"] input').uncheck()
  await page.locator('[data-quick-officer] input').uncheck()
  await page.getByRole('button', { name: 'ยืนยันการย้ายและแต่งตั้ง' }).click()
  await page.waitForFunction(() => document.body.dataset.saved === 'yes')
  assert.equal(setWrites(db).length, 0, 'เอาติ๊กออกต้องไม่ตั้งผู้ลงนาม')
  assert.equal(db.profiles.find(item => item.id === 'u-eng-head').is_dept_head, true, 'เอาติ๊กออกต้องไม่แตะหัวหน้าคนเดิม')
  assert.equal(db.profiles.find(item => item.id === 'u-staff').role, 'staff', 'เอาติ๊กออกต้องไม่ยกสิทธิ์')
  assert.equal(db.profiles.find(item => item.id === 'u-staff').is_dept_head, true, 'ยังเป็นหัวหน้าตามที่เลือกไว้')
})

await scenario('ปุ่มเพิ่มบุคลากร: ติ๊กหัวหน้าให้ตำแหน่งธรรมดา ไม่ถามเรื่องลงนาม · ไม่เขียนผู้ลงนาม', { fixture: 'quick' }, async (page, db) => {
  await pickInQuick(page, 'เจ้าหน้าที่ธรรมดา', 'นายช่างโยธา')
  const head = page.locator('[data-quick-head] input')
  await head.check()
  await page.locator('[data-appointment-other-head="u-eng-head"]').waitFor()
  assert.equal(await page.locator('[data-appointment-signing]').count(), 0, 'ติ๊กหัวหน้าอย่างเดียวต้องไม่ขึ้นกรอบการลงนาม')
  await page.getByRole('button', { name: 'ยืนยันการย้ายและแต่งตั้ง' }).click()
  await page.waitForFunction(() => document.body.dataset.saved === 'yes')
  assert.equal(db.profiles.find(item => item.id === 'u-staff').is_dept_head, true)
  assert.equal(setWrites(db).length, 0, 'ติ๊กหัวหน้าต้องไม่ตั้งผู้ลงนาม')
})

await scenario('ปุ่มเพิ่มบุคลากร: ตำแหน่งหัวหน้า เอาติ๊กหัวหน้าออก ยังเป็นผู้ลงนามได้ · เอาติ๊กลงนามออก ยังเป็นหัวหน้าได้', { fixture: 'quick' }, async (page, db) => {
  await pickInQuick(page, 'เจ้าหน้าที่ธรรมดา', 'ผู้อำนวยการกองช่าง')
  const offer = page.locator(`[data-appointment-signing-offer="department_head:${D.eng}:"]`)
  await offer.waitFor()
  await page.locator('[data-quick-head] input').uncheck()
  assert.equal(await offer.locator('input').isChecked(), true, 'เอาติ๊กหัวหน้าออก ติ๊กลงนามต้องอยู่เหมือนเดิม')
  assert.equal(await page.locator('[data-appointment-other-head]').count(), 0, 'ไม่ได้เป็นหัวหน้าแล้ว ต้องไม่ถามเรื่องหัวหน้าคนเดิม')
  await page.getByRole('button', { name: 'ยืนยันการย้ายและแต่งตั้ง' }).click()
  await page.waitForFunction(() => document.body.dataset.saved === 'yes')
  assert.equal(db.profiles.find(item => item.id === 'u-staff').is_dept_head, false)
  assert.equal(setWrites(db)[0].p_profile_id, 'u-staff', 'ต้องเป็นผู้ลงนามตามที่ติ๊กไว้')
  assert.equal(db.profiles.find(item => item.id === 'u-eng-head').is_dept_head, true, 'ไม่ได้เป็นหัวหน้า ต้องไม่แตะหัวหน้าคนเดิม')
})

await scenario('ปุ่มเพิ่มบุคลากร: ตั้งผู้ลงนามล้ม บอกว่าแต่งตั้งแล้ว เหลือปุ่มปิด ห้ามกดยืนยันซ้ำ', { fixture: 'quick' }, async (page, db) => {
  db.failSignatoryFor.add(`department_head:${D.eng}:`)
  await pickInQuick(page, 'เจ้าหน้าที่ธรรมดา', 'ผู้อำนวยการกองช่าง')
  await page.locator('[data-appointment-signing]').waitFor()
  await page.getByRole('button', { name: 'ยืนยันการย้ายและแต่งตั้ง' }).click()
  const alert = page.getByRole('alert')
  await alert.waitFor()
  assert.match(await alert.innerText(), /แต่งตั้งแล้ว แต่ ตั้งผู้ลงนามช่อง “กองช่าง” ไม่สำเร็จ/)
  assert.equal(await page.getByRole('button', { name: /ยืนยัน/ }).count(), 0, 'ห้ามกดยืนยันซ้ำจนเขียนการแต่งตั้งซ้ำ')
  await page.getByRole('button', { name: 'ปิด', exact: true }).last().click()
  await page.waitForFunction(() => document.body.dataset.saved === 'yes')
})

// ── แท็บการแต่งตั้ง (ผ่านหน้าจัดการผู้ใช้จริงทั้งหน้า) ──────────────────────────────
async function openUser(page, name, departmentCard = 'ทุกกอง / หน่วยงาน') {
  await page.getByRole('button', { name: new RegExp(departmentCard) }).first().waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: new RegExp(departmentCard) }).first().click()
  // จอใหญ่เรนเดอร์ทั้งการ์ดมือถือ (ซ่อน) และตาราง ต้องเลือกแถวที่มองเห็น
  const line = page.locator('tr:visible', { hasText: name }).first()
  await line.waitFor()
  await line.locator('td').nth(1).click()
  await page.getByRole('heading', { name: new RegExp(`รายละเอียดข้อมูลผู้ใช้งาน: .*${name.replace(/[[\]]/g, '\\$&')}`) }).waitFor()
}

await scenario('แท็บการแต่งตั้ง: เลือกตำแหน่งหัวหน้า → ติ๊กให้ เสนอสิทธิ์ ถามผู้ลงนาม → บันทึกครั้งเดียวจบ และหน้าจอตรงกับฐานข้อมูล', { fixture: 'users' }, async (page, db) => {
  await openUser(page, '[TEST] คนใหม่ย้ายมา')
  await page.getByRole('button', { name: 'แก้ไขการแต่งตั้ง' }).click()
  const prompts = []
  page.on('dialog', async dialog => { prompts.push(dialog.message()); await dialog.accept() })
  await page.locator('select').filter({ hasText: 'ยังไม่แต่งตั้งตำแหน่ง' }).selectOption(P.engHead)
  await page.getByRole('checkbox', { name: 'เป็นหัวหน้ากอง' }).waitFor()
  assert.equal(await page.getByRole('checkbox', { name: 'เป็นหัวหน้ากอง' }).isChecked(), true, 'ตำแหน่งหัวหน้าต้องติ๊กให้')
  assert.match(prompts[0] ?? '', /หัวหน้ากอง/, 'ตำแหน่งที่สร้างเองมี role staff ก็ต้องเสนอสิทธิ์หัวหน้ากอง')
  const offer = page.locator(`[data-appointment-signing-offer="department_head:${D.eng}:"]`)
  await offer.waitFor()
  assert.match(await offer.innerText(), /ตอนนี้ช่องนี้เป็น \[TEST\] นายช่างที่เคยตั้ง/)
  await page.locator('[data-appointment-other-head="u-eng-head"]').waitFor()
  assert.equal(await page.locator('[data-appointment-signing] [data-appointment-other-head]').count(), 0, 'หัวหน้าคนเดิมไม่ใช่เรื่องการลงนาม ต้องไม่อยู่ในกรอบนี้')
  assert.equal(await page.locator('[data-signing-role-note]').count(), 0, 'ตอนแก้ฟอร์มต้องไม่โชว์สถานะเก่าซ้อน')
  await shot(page, '8-appointment-edit-desktop')
  assert.equal(db.writes.length, 0, 'ยังไม่กดบันทึกห้ามเขียน')

  await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await page.getByRole('button', { name: 'แก้ไขการแต่งตั้ง' }).waitFor()
  const stored = db.profiles.find(item => item.id === 'u-new')
  assert.equal(stored.is_dept_head, true, 'บั๊กเดิม: ย้ายกองพร้อมติ๊กแล้วติ๊กหาย')
  assert.equal(stored.role, 'officer')
  assert.equal(db.profiles.find(item => item.id === 'u-eng-head').is_dept_head, false)
  assert.equal(setWrites(db)[0].p_profile_id, 'u-new')
  const note = page.locator('[data-signing-role-note]')
  await note.getByText('ชื่อนี้พิมพ์ในช่องลงนาม').waitFor()
  assert.match(await note.innerText(), /กองช่าง/)
  assert.match(await page.locator('body').innerText(), /หัวหน้ากอง\s*ใช่/, 'หน้าจอต้องแสดงค่าจริงจากฐานข้อมูล')
  await shot(page, '9-appointment-saved-desktop')
})

await scenario('แท็บการแต่งตั้ง: ย้ายกองแล้วติ๊กไม่ติด บอกเหตุ ไม่ตั้งผู้ลงนาม และหน้าจอแสดงค่าจริงจากฐานข้อมูล', {
  fixture: 'users',
  db: Object.assign(freshDb(), { failHeadTick: true }),
}, async (page, db) => {
  await openUser(page, '[TEST] คนใหม่ย้ายมา')
  await page.getByRole('button', { name: 'แก้ไขการแต่งตั้ง' }).click()
  page.on('dialog', dialog => dialog.accept())
  await page.locator('select').filter({ hasText: 'ยังไม่แต่งตั้งตำแหน่ง' }).selectOption(P.engHead)
  await page.locator(`[data-appointment-signing-offer="department_head:${D.eng}:"]`).waitFor()
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await page.getByText(/ย้ายกองแล้ว แต่ติ๊กหัวหน้ากองไม่สำเร็จ/).waitFor()
  assert.equal(setWrites(db).length, 0, 'แต่งตั้งยังไม่ครบ ต้องยังไม่ตั้งผู้ลงนาม')
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
  const body = await page.locator('body').innerText()
  assert.match(body, /หัวหน้ากอง\s*ไม่ใช่/, 'ของจริงไม่ได้ติ๊ก หน้าจอต้องไม่ขึ้นว่าใช่')
  assert.match(body, /กอง\/หน่วยงาน\s*กองช่าง/, 'ของจริงย้ายกองแล้ว หน้าจอต้องตรงกัน')
})

await scenario('แท็บการแต่งตั้ง: แก้ข้อมูลอื่นไม่ถามเรื่องผู้ลงนาม ไม่ทับผู้แทน', {
  fixture: 'users',
  db: (() => {
    const db = freshDb()
    db.profiles.find(item => item.id === 'u-eng-head').phone = '0800000000'
    db.signatories.find(item => item.id === 'r-eng').title_override = 'นายช่าง รักษาราชการแทน ผู้อำนวยการกองช่าง'
    return db
  })(),
}, async (page, db) => {
  await openUser(page, '[TEST] ผอ.ช่างตัวจริง')
  await page.getByRole('button', { name: 'แก้ไขการแต่งตั้ง' }).click()
  await page.getByRole('checkbox', { name: 'เป็นหัวหน้ากอง' }).waitFor()
  assert.equal(await page.locator('[data-appointment-signing-offer]').count(), 0, 'ไม่ได้เปลี่ยนการแต่งตั้งต้องไม่ถาม')
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await page.getByRole('button', { name: 'แก้ไขการแต่งตั้ง' }).waitFor()
  assert.equal(setWrites(db).length, 0, 'ต้องไม่ทับผู้รักษาราชการแทน')
  assert.equal(await page.locator('[data-signing-role-missing]').count(), 0, 'ผู้แทนถือว่าตั้งใจ ไม่เตือน')
})

await scenario('แท็บการแต่งตั้ง: ติ๊กหัวหน้าอย่างเดียว ไม่ถามเรื่องลงนาม และไม่เตือนว่าขาด', { fixture: 'users' }, async (page, db) => {
  await openUser(page, '[TEST] คนใหม่ย้ายมา')
  await page.getByRole('button', { name: 'แก้ไขการแต่งตั้ง' }).click()
  await page.getByRole('checkbox', { name: 'เป็นหัวหน้ากอง' }).check()
  await page.locator('[data-appointment-other-head="u-gen-a"]').waitFor()
  assert.match(await page.locator('body').innerText(), /ไม่เกี่ยวกับการลงนามเอกสาร/, 'ต้องบอกบนหน้าจอว่าสองเรื่องนี้แยกกัน')
  assert.equal(await page.locator('[data-appointment-signing]').count(), 0, 'ติ๊กหัวหน้าอย่างเดียวต้องไม่ขึ้นกรอบการลงนาม')
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await page.getByRole('button', { name: 'แก้ไขการแต่งตั้ง' }).waitFor()
  assert.equal(db.profiles.find(item => item.id === 'u-new').is_dept_head, true)
  assert.equal(setWrites(db).length, 0, 'ติ๊กหัวหน้าต้องไม่ตั้งผู้ลงนาม')
  await page.locator('[data-signing-role-note]').getByText('ไม่ได้เป็นผู้ลงนามในเอกสาร').waitFor()
  assert.equal(await page.locator('[data-signing-role-missing]').count(), 0, 'เป็นหัวหน้าโดยไม่ได้ลงนามเป็นเรื่องปกติ ต้องไม่เตือน')
})

await scenario('แท็บการแต่งตั้ง: หัวหน้าตามหมวดตำแหน่ง แก้ข้อมูลอื่นไม่ถามเรื่องลงนาม แต่ยังเตือนว่าช่องยังไม่ตั้ง', {
  fixture: 'users',
  db: (() => {
    const db = freshDb()
    Object.assign(db.profiles.find(item => item.id === 'u-new'), { position_id: P.byCategory, department_id: D.fin })
    return db
  })(),
}, async (page, db) => {
  await openUser(page, '[TEST] คนใหม่ย้ายมา')
  await page.locator('[data-signing-role-missing]').waitFor()
  assert.match(await page.locator('[data-signing-role-missing]').innerText(), /ผู้ลงนามช่อง กองคลัง/, 'แถวผู้ใช้มีแค่ชื่อตำแหน่ง ต้องรู้จากหมวดในทำเนียบ')
  await page.getByRole('button', { name: 'แก้ไขการแต่งตั้ง' }).click()
  await page.getByRole('checkbox', { name: 'เป็นหัวหน้ากอง' }).waitFor()
  assert.equal(await page.locator('[data-appointment-signing-offer]').count(), 0, 'ไม่ได้เปลี่ยนตำแหน่งต้องไม่ถาม')
  assert.equal(db.writes.length, 0)
})

await scenario('แท็บการแต่งตั้ง: คนที่แต่งตั้งไว้แล้วแต่ช่องยังไม่ตรง กดตั้งได้จากตรงนี้ ผ่านกล่องยืนยัน', { fixture: 'users' }, async (page, db) => {
  await openUser(page, '[TEST] ผอ.คลังไม่ติ๊ก')
  const missing = page.locator('[data-signing-role-missing]')
  await missing.waitFor()
  assert.match(await missing.innerText(), /ตามการแต่งตั้ง คนนี้เป็นผู้ลงนามช่อง กองคลัง/)
  assert.match(await page.locator('[data-signing-head-not-ticked]').innerText(), /ยังอนุมัติกิจกรรมของกองไม่ได้/)
  await page.locator('[data-signing-role-apply]').click()
  const dialog = page.getByTestId('signatory-apply-dialog')
  await dialog.waitFor()
  assert.equal(db.writes.length, 0, 'เปิดกล่องยังห้ามเขียน')
  await dialog.locator('[data-apply-confirm]').click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(setWrites(db)[0].p_profile_id, 'u-fin-head')
  await page.locator('[data-signing-role-note]').getByText('ชื่อนี้พิมพ์ในช่องลงนาม').waitFor()
  assert.equal(await missing.count(), 0)
})

await scenario('แท็บการแต่งตั้ง: เปลี่ยนจากหัวหน้าเป็นตำแหน่งอื่น เอาติ๊กออกให้ · บัญชีไม่มีชื่อบอกให้ใส่ชื่อก่อน', {
  fixture: 'users',
  db: (() => {
    const db = freshDb()
    const noName = db.profiles.find(item => item.id === 'u-noname')
    Object.assign(noName, { full_name: '', email: 'no-name@smartlocal.test', position_id: P.clerk, department_id: null })
    db.signatories = db.signatories.filter(item => item.signatory_role !== 'clerk')
    db.profiles.find(item => item.id === 'u-clerk').position_id = null
    return db
  })(),
}, async (page, db) => {
  await openUser(page, '[TEST] ผอ.ช่างตัวจริง')
  await page.getByRole('button', { name: 'แก้ไขการแต่งตั้ง' }).click()
  page.on('dialog', dialog => dialog.dismiss())
  const tick = page.getByRole('checkbox', { name: 'เป็นหัวหน้ากอง' })
  await tick.waitFor()
  assert.equal(await tick.isChecked(), true)
  await page.locator('select').filter({ hasText: 'ยังไม่แต่งตั้งตำแหน่ง' }).selectOption(P.tech)
  assert.equal(await tick.isChecked(), false, 'ออกจากตำแหน่งหัวหน้าต้องเอาติ๊กออก')
  assert.match(await page.locator('[data-appointment-role-kept]').innerText(), /จะบันทึกสิทธิ์เป็น “หัวหน้ากอง”/,
    'ปฏิเสธบทบาทที่แนะนำแล้ว ต้องบอกว่าสิทธิ์ยังเป็นอะไร')
  assert.equal(db.writes.length, 0)
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click()
  await page.getByRole('button', { name: 'ย้อนกลับ' }).click()

  await openUser(page, 'no-name@smartlocal.test')
  const missing = page.locator('[data-signing-role-missing]')
  await missing.waitFor()
  assert.match(await missing.innerText(), /บัญชีนี้ยังไม่มีชื่อ-นามสกุล/)
  assert.equal(await page.locator('[data-signing-role-apply]').count(), 0, 'ไม่มีชื่อต้องไม่มีปุ่มที่กดแล้วเจอ error')
})

await browser.close()
await vite.close()
console.log(`signing-setup: ผ่าน ${passed} ชุด${failures.length ? ` · ไม่ผ่าน ${failures.length} ชุด` : ''}`)
process.exit(failures.length ? 1 : 0)

// หน้าลบบัญชี /account/delete — ใช้ App/Router/contexts จริง แต่ Supabase เป็น fixture ทั้งหมด ไม่เขียน DB จริง
// รันด้วย: node tests/account-delete.playwright.mjs (แพทเทิร์นเดียวกับ tests/account-tabs.playwright.mjs)
//
// ตรวจสิ่งที่เทสต์ระดับฟังก์ชัน (tests/account-deletion.test.mjs) มองไม่เห็น: ทุกสถานะของหน้า, ลำดับการเรียก
// API จริงของ supabase-js ตอนกดลบ (รูป → บัญชี → ออกจากระบบ), หน้าสำเร็จหลังโหลดใหม่ และกรณีพังต้องไม่ลบบัญชี
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { createServer } from 'vite'

process.env.SKIP_SYNC_CHECK = '1'
const server = await createServer({
  root: process.cwd(), cacheDir: path.join(tmpdir(), 'smartlocal-account-delete-vite', path.basename(process.cwd())),
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.supabase.co'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-fixture-only'), 'import.meta.env.VITE_TENANT_SLUG': JSON.stringify('demo'), 'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 0, hmr: false },
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const uid = '00000000-0000-4000-8000-000000000001'
const mid = '00000000-0000-4000-8000-000000000002'
let passed = 0

async function fixture(role, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true })
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', user_metadata: { full_name: 'TEST ผู้ทดสอบลบบัญชี' }, app_metadata: { provider: 'email', providers: ['email'] }, identities: [] }
  const profile = { id: uid, municipality_id: mid, role, full_name: user.user_metadata.full_name, phone: '0800000000', avatar_url: null }
  const state = { calls: [], avatarFiles: options.avatarFiles ?? ['avatar.jpg'], removeReturnsEmpty: !!options.removeReturnsEmpty, rpcError: options.rpcError ?? null }
  await context.routeWebSocket('**/*', socket => socket.close())
  // ใส่ session ครั้งเดียวต่อแท็บ — หลังออกจากระบบแล้วโหลดหน้าใหม่ต้องไม่ถูกยัดกลับ (จะได้ตรวจว่าล้างจริง)
  await context.addInitScript((session) => {
    if (session && !sessionStorage.getItem('__fixtureSeeded')) {
      localStorage.setItem('sb-fixture-auth-token', JSON.stringify(session))
      sessionStorage.setItem('__fixtureSeeded', '1')
    }
  }, role ? (() => {
    const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url')
    const exp = Math.floor(Date.now() / 1000) + 3600
    return { user, access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: uid, aud: 'authenticated', role: 'authenticated', exp, iat: exp - 3600, session_id: uid }) + '.fixture', refresh_token: 'fixture', token_type: 'bearer', expires_at: exp, expires_in: 3600 }
  })() : null)
  await context.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url())
    if (url.hostname.endsWith('.supabase.co')) {
      const headers = { 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-credentials': 'true' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      const rpc = url.pathname.split('/rpc/')[1]
      let data = []
      let status = 200
      let handled = false
      if (url.pathname.startsWith('/storage/v1/object/list/avatars')) {
        handled = true
        state.calls.push(['list', req.postDataJSON()?.prefix])
        data = state.avatarFiles.map(name => ({ name, id: name }))
      } else if (url.pathname === '/storage/v1/object/avatars' && req.method() === 'DELETE') {
        handled = true
        const prefixes = req.postDataJSON()?.prefixes ?? []
        state.calls.push(['remove', prefixes])
        data = state.removeReturnsEmpty ? [] : prefixes.map(name => ({ name }))
      } else if (rpc === 'delete_my_account') {
        handled = true
        state.calls.push(['rpc', rpc])
        if (state.rpcError) { status = 400; data = state.rpcError } else { status = 204; data = null }
      } else if (url.pathname === '/auth/v1/logout') {
        state.calls.push(['logout', url.searchParams.get('scope')])
        return route.fulfill({ status: 204, headers })
      } else if (url.pathname.includes('/auth/v1/user')) data = user
      else if (url.pathname.includes('/rest/v1/municipalities')) data = { id: mid, slug: 'demo', name: 'TEST หน่วยงานทดสอบ', org_type: 'เทศบาลตำบล', phone: '053000000', ui_style: 'eco_friendly', theme_color: '#0f766e', enabled_modules: null, logo_url: null }
      else if (url.pathname.includes('/rest/v1/profiles')) data = req.headers().accept?.includes('object+json') ? profile : [profile]
      else if (req.headers().accept?.includes('object+json')) data = null
      // RPC อื่นของโครงหน้าเว็บ (รายการงาน กระดิ่ง ฯลฯ) เรียกด้วย POST แต่เป็นการอ่าน — นับเป็นการเขียนเฉพาะที่ยิงตารางตรง
      if (!handled && !rpc && !['GET', 'HEAD'].includes(req.method())) state.calls.push(['write', req.method(), url.pathname])
      return route.fulfill({ status, headers: { ...headers, 'content-range': '0-0/0' }, contentType: 'application/json', body: data === null && status === 204 ? '' : JSON.stringify(data) })
    }
    if (req.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' })
    if (url.origin !== base) return route.abort()
    return route.continue()
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  return { context, page, state, errors }
}

async function check(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`) }
// AD_SHOTS=<โฟลเดอร์> เก็บภาพเต็มหน้าของแต่ละสถานะไว้ตรวจหน้าตา (ไม่ตั้ง = ไม่ถ่าย)
async function shot(page, name) {
  if (!process.env.AD_SHOTS) return
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(process.env.AD_SHOTS, `${name}.png`), fullPage: true })
}
// เลื่อนสุดแล้วของชิ้นสุดท้ายต้องอยู่เหนือแถบเมนูล่างของแอป (fixed) ไม่งั้นมือถือจอเล็กกดปุ่มไม่ได้
async function clearOfBottomBar(page, selector) {
  return page.evaluate((sel) => {
    for (const node of [document.scrollingElement, ...document.querySelectorAll('*')]) {
      if (node && node.scrollHeight > node.clientHeight + 1 && getComputedStyle(node).overflowY !== 'visible') node.scrollTop = node.scrollHeight
    }
    window.scrollTo(0, document.documentElement.scrollHeight)
    const bars = [...document.body.querySelectorAll('*')].filter(n => {
      const s = getComputedStyle(n); const r = n.getBoundingClientRect()
      return s.position === 'fixed' && r.height > 0 && r.height < innerHeight / 3 && r.bottom >= innerHeight - 1 && r.width >= innerWidth * 0.9
    })
    const barTop = Math.min(innerHeight, ...bars.map(n => n.getBoundingClientRect().top))
    return { bottom: document.querySelector(sel).getBoundingClientRect().bottom, barTop }
  }, selector)
}
async function noOverflow(page, label) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
  assert.equal(wide, false, `${label}: ล้นแนวนอนที่ 390px`)
}

try {
  await check('ยังไม่ล็อกอิน: บอกวิธีลบ + ปุ่มเข้าสู่ระบบพากลับมาหน้านี้ + ช่องทางติดต่อหน่วยงาน', async () => {
    const { context, page, state, errors } = await fixture(null)
    await page.goto(base + '/account/delete')
    await page.locator('[data-account-delete-state="signed-out"]').waitFor({ timeout: 30000 })
    assert.equal(await page.locator('[data-account-delete-submit]').count(), 0)
    assert.ok(await page.getByText('รีวิวสถานที่ท่องเที่ยว').isVisible())
    assert.ok(await page.locator('a[href="tel:053000000"]').isVisible())
    await noOverflow(page, 'signed-out')
    await shot(page, 'signed-out')
    await page.getByRole('button', { name: 'เข้าสู่ระบบเพื่อลบบัญชี' }).click()
    await page.waitForURL(/\/auth$/)
    assert.deepEqual(state.calls, [])
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('เจ้าหน้าที่: เห็นข้อความให้ติดต่อแอดมิน ไม่มีปุ่มลบ และหน้าโปรไฟล์ไม่มีลิงก์ลบบัญชี', async () => {
    const { context, page, state, errors } = await fixture('staff')
    await page.goto(base + '/account/delete')
    await page.locator('[data-account-delete-state="staff"]').waitFor({ timeout: 30000 })
    assert.equal(await page.locator('[data-account-delete-submit]').count(), 0)
    await page.goto(base + '/profile')
    await page.locator('[data-profile-panel="account"]').waitFor({ timeout: 30000 })
    assert.equal(await page.locator('[data-profile-delete-account]').count(), 0)
    assert.deepEqual(state.calls, [])
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('ประชาชน: ลิงก์จากหน้าโปรไฟล์ → ยืนยันด้วยคำ → ลบรูป → ลบบัญชี → ออกจากระบบ → หน้าสำเร็จ', async () => {
    const { context, page, state, errors } = await fixture('citizen')
    await page.goto(base + '/profile')
    const link = page.locator('[data-profile-delete-account]')
    await link.waitFor({ timeout: 30000 })
    await shot(page, 'citizen-profile')
    await link.click()
    await page.locator('[data-account-delete-state="confirm"]').waitFor({ timeout: 30000 })
    const submit = page.locator('[data-account-delete-submit]')
    assert.equal(await submit.isDisabled(), true, 'ยังไม่พิมพ์ต้องกดไม่ได้')
    const box = await submit.boundingBox()
    assert.ok(box.height >= 44, `ปุ่มต้องสูงอย่างน้อย 44px (ได้ ${box.height})`)
    await noOverflow(page, 'confirm')
    await page.locator('#account-delete-confirm').fill('ลบ')
    assert.equal(await submit.isDisabled(), true, 'พิมพ์ไม่ครบต้องกดไม่ได้')
    await page.locator('#account-delete-confirm').fill(' ลบ บัญชี ')
    assert.equal(await submit.isDisabled(), false)
    await shot(page, 'citizen-confirm')
    for (const sel of ['[data-account-delete-submit]', 'main[data-account-delete-page] a[href="/profile"]']) {
      const { bottom, barTop } = await clearOfBottomBar(page, sel)
      assert.ok(bottom <= barTop, `${sel} จมใต้แถบเมนูล่าง (ล่างสุด ${bottom} > แถบเริ่ม ${barTop})`)
    }
    await page.screenshot({ path: path.join(process.env.AD_SHOTS || tmpdir(), 'citizen-confirm-bottom.png') })
    await submit.click()
    await page.waitForURL(/\/account\/delete\?done=1$/, { timeout: 30000 })
    await page.locator('[data-account-delete-state="done"]').waitFor({ timeout: 30000 })
    await shot(page, 'done')
    assert.deepEqual(state.calls, [
      ['list', uid],
      ['remove', [`${uid}/avatar.jpg`]],
      ['rpc', 'delete_my_account'],
      ['logout', 'local'],
    ])
    assert.equal(await page.evaluate(() => localStorage.getItem('sb-fixture-auth-token')), null, 'session ในเครื่องต้องถูกล้าง')
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('ลบรูปไม่ได้ (Storage ตอบสำเร็จแต่ลบ 0 ไฟล์): ขึ้นข้อความ ไม่เรียกลบบัญชี ไม่ออกจากระบบ', async () => {
    const { context, page, state, errors } = await fixture('citizen', { removeReturnsEmpty: true })
    await page.goto(base + '/account/delete')
    await page.locator('[data-account-delete-state="confirm"]').waitFor({ timeout: 30000 })
    await page.locator('#account-delete-confirm').fill('ลบบัญชี')
    await page.locator('[data-account-delete-submit]').click()
    await page.getByRole('alert').filter({ hasText: 'ลบรูปโปรไฟล์ไม่สำเร็จ' }).waitFor()
    assert.deepEqual(state.calls.map(c => c[0]), ['list', 'remove'])
    assert.ok(await page.locator('[data-account-delete-state="confirm"]').isVisible())
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('ฐานข้อมูลปฏิเสธ: แสดงข้อความภาษาไทยจากฐานตรงๆ บัญชียังล็อกอินอยู่ กดลองใหม่ได้', async () => {
    const message = 'บัญชีนี้ยังมีประวัติงานของเจ้าหน้าที่ผูกอยู่ ลบเองไม่ได้ กรุณาติดต่อผู้ดูแลระบบของหน่วยงาน'
    const { context, page, state, errors } = await fixture('citizen', { avatarFiles: [], rpcError: { code: '23503', message, details: 'fleet_bookings_requester_id_fkey', hint: null } })
    await page.goto(base + '/account/delete')
    await page.locator('[data-account-delete-state="confirm"]').waitFor({ timeout: 30000 })
    await page.locator('#account-delete-confirm').fill('ลบบัญชี')
    await page.locator('[data-account-delete-submit]').click()
    await page.getByRole('alert').filter({ hasText: message }).waitFor()
    assert.deepEqual(state.calls.map(c => c[0]), ['list', 'rpc'], 'ไม่มีรูป = ไม่เรียกลบรูป และไม่ออกจากระบบ')
    assert.equal(await page.locator('[data-account-delete-submit]').isDisabled(), false, 'ต้องกดลองใหม่ได้')
    assert.notEqual(await page.evaluate(() => localStorage.getItem('sb-fixture-auth-token')), null)
    assert.deepEqual(errors, [])
    await context.close()
  })
} finally {
  await browser.close()
  await server.close()
}

console.log(`\nผ่านทั้งหมด ${passed} ข้อ`)

// เชื่อม Telegram ส่วนตัว (ข้อ 3b ตั้งค่าแจ้งเตือน) — ทดสอบบนเบราว์เซอร์จริง
// รันด้วย: node tests/telegram-link.playwright.mjs   (PTD_ENGINE=chromium ถ้าเครื่องไม่มี Chrome)
//
// ใช้ App/Router/contexts จริง แต่ API บัญชีและ Edge Function telegram-webhook เป็น fixture ทั้งหมด
// — ไม่เขียน DB จริง ไม่เรียก Telegram จริง

import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { createServer } from 'vite'

process.env.SKIP_SYNC_CHECK = '1'
const output = process.env.PTD_OUTPUT || path.join(tmpdir(), 'smartlocal-telegram-link')
await mkdir(output, { recursive: true })
const server = await createServer({
  root: process.cwd(),
  cacheDir: path.join(tmpdir(), 'smartlocal-telegram-link-vite', path.basename(process.cwd())),
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-fixture-only'),
    'import.meta.env.VITE_TENANT_SLUG': JSON.stringify('demo'),
    'import.meta.env.VITE_VAPID_PUBLIC_KEY': 'globalThis.__fixturePushKey',
  },
  server: { host: '127.0.0.1', port: 0, hmr: false },
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const engine = process.env.PTD_ENGINE || 'chrome'
const browser = await chromium.launch({ headless: true, ...(engine === 'chrome' ? { channel: 'chrome' } : {}) })
const uid = '00000000-0000-4000-8000-000000000201'
const mid = '00000000-0000-4000-8000-000000000202'
const TOKEN = 'A'.repeat(43)
const LINK_URL = `https://t.me/SmartLocalTestBot?start=${TOKEN}`

async function fixture({ role = 'staff', linked = null, linkStatus = 200, tableMissing = false, dmColumnMissing = false, webhook = { configured: false, other: true, otherHost: 'old.example' }, viewport = { width: 1366, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', hasTouch: viewport.width < 600 })
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', user_metadata: { full_name: 'TEST เชื่อม Telegram' }, app_metadata: { provider: 'email', providers: ['email'] }, identities: [] }
  const profile = { id: uid, municipality_id: mid, role, full_name: user.user_metadata.full_name, phone: '0800000000', avatar_url: null }
  const state = { linked, linkReads: 0, deletes: [], calls: [], mutedCalls: [], linkStatus, webhook }
  await context.routeWebSocket(/.*/, (ws) => ws.close())

  const encode = (x) => Buffer.from(JSON.stringify(x)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 86400
  const session = { user, access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: uid, aud: 'authenticated', role: 'authenticated', exp, iat: exp - 3600, session_id: uid })}.fixture`, refresh_token: 'fixture', token_type: 'bearer', expires_at: exp, expires_in: 86400 }
  await context.addInitScript(({ session }) => {
    localStorage.setItem('sb-fixture-auth-token', JSON.stringify(session))
    window.__fixturePushKey = 'B' + 'A'.repeat(86)
  }, { session })

  await context.route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.hostname.endsWith('.supabase.co')) {
      const headers = { 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-credentials': 'true' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      let data = []
      let status = 200
      const single = req.headers().accept?.includes('object+json')
      if (url.pathname.includes('/auth/v1/user')) data = user
      else if (url.pathname.includes('/rest/v1/municipalities')) data = { id: mid, slug: 'demo', name: 'TEST หน่วยงานทดสอบ Telegram', org_type: 'เทศบาลตำบล', ui_style: 'eco_friendly', theme_color: '#0f766e', enabled_modules: null, logo_url: null }
      else if (url.pathname.includes('/rest/v1/profiles')) data = single ? profile : [profile]
      else if (url.pathname === '/rest/v1/telegram_user_links') {
        if (tableMissing) {
          status = 404
          data = { code: 'PGRST205', message: "Could not find the table 'public.telegram_user_links' in the schema cache" }
        } else if (req.method() === 'DELETE') {
          state.deletes.push(url.searchParams.get('user_id'))
          state.linked = null
          data = null
        } else if (dmColumnMissing && /dm_muted/.test(url.searchParams.get('select') ?? '')) {
          // ยังไม่ apply migration ส่วนที่ 2 — PostgREST ตอบ 42703 แล้วหน้าเว็บต้องขอใหม่แบบไม่มีคอลัมน์นี้
          status = 400
          data = { code: '42703', message: 'column telegram_user_links.dm_muted does not exist' }
        } else {
          state.linkReads += 1
          assert.doesNotMatch(url.searchParams.get('select') ?? '', /chat_id/, 'หน้าเว็บต้องไม่ขอ chat_id')
          const row = state.linked && (dmColumnMissing ? { tg_display: state.linked.tg_display, linked_at: state.linked.linked_at } : state.linked)
          data = single ? row : (row ? [row] : [])
        }
      } else if (url.pathname === '/rest/v1/rpc/set_my_telegram_dm_muted') {
        const muted = req.postDataJSON().p_muted
        state.mutedCalls.push(muted)
        state.linked = { ...state.linked, dm_muted: [...new Set(muted)].sort() }
        data = state.linked.dm_muted
      } else if (url.pathname === '/functions/v1/telegram-webhook') {
        const body = req.postDataJSON()
        state.calls.push(body)
        if (body.action === 'link') {
          status = state.linkStatus
          data = status === 200
            ? { ok: true, url: LINK_URL, bot: 'SmartLocalTestBot', expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }
            : { ok: false, error: 'ขอลิงก์บ่อยเกินไป รอสักครู่แล้วลองใหม่' }
        } else if (body.action === 'status') {
          data = { ok: true, pending: 0, lastError: null, bot: 'SmartLocalTestBot', ...state.webhook }
        } else if (body.action === 'setup') {
          if (state.webhook.other && body.force !== true) {
            status = 409
            data = { ok: false, error: 'บอตตั้ง webhook ไว้ที่ old.example อยู่แล้ว ยังไม่ได้ทับ', ...state.webhook }
          } else {
            state.webhook = { configured: true, other: false, otherHost: null }
            data = { ok: true, pending: 0, lastError: null, bot: 'SmartLocalTestBot', ...state.webhook }
          }
        }
      } else if (single) data = null
      return route.fulfill({ status, headers: { ...headers, 'content-range': '0-0/0' }, contentType: 'application/json', body: JSON.stringify(data) })
    }
    if (req.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' })
    if (url.origin !== base) return route.abort()
    assert(['GET', 'HEAD'].includes(req.method()), 'non-GET outside fixture')
    return route.continue()
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (dialog) => dialog.accept())
  return { context, page, state, errors }
}

async function openSettings(page) {
  await page.goto(`${base}/profile/notifications`)
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-push-status]')?.textContent ?? ''
    return text && !text.includes('กำลังตรวจสอบ')
  }, null, { timeout: 30000 })
}
async function waitTelegramReady(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-telegram-link-settings]')
    return el && !el.textContent.includes('กำลังตรวจสอบ')
  }, null, { timeout: 15000 })
}
const results = []
async function test(name, options, run) {
  const f = await fixture(options)
  try {
    await run(f)
    assert.deepEqual(f.errors, [], `${name}: page errors`)
    results.push(name)
    console.log(`PASS ${name}`)
  } catch (error) {
    await f.page.screenshot({ path: path.join(output, `${name.replace(/[^\w-]+/g, '_')}.png`), fullPage: true }).catch(() => {})
    throw error
  } finally {
    await f.context.close()
  }
}

try {
  await test('ยังไม่เชื่อม: แจ้งก่อนเชื่อม → ได้ลิงก์ + QR → กด Start แล้วหน้าขึ้นเชื่อมแล้วเอง', {}, async ({ page, state }) => {
    await page.clock.install()
    await openSettings(page)
    await waitTelegramReady(page)
    const consent = await page.locator('[data-telegram-consent]').textContent()
    assert.match(consent, /ไม่มีชื่อหรือเบอร์โทรของประชาชน/)
    assert.match(consent, /ต่างประเทศ/)
    assert.equal(await page.locator('[data-telegram-bot-admin]').count(), 0, 'บุคลากรทั่วไปไม่เห็นส่วนผู้ดูแลบอต')
    await page.locator('[data-telegram-link-start]').click()
    await page.locator('[data-telegram-open]').waitFor()
    assert.equal(await page.locator('[data-telegram-open]').getAttribute('href'), LINK_URL)
    assert.equal(await page.locator('[data-telegram-open]').getAttribute('rel'), 'noopener noreferrer')
    assert.ok(await page.locator('[data-telegram-link-qr]').isVisible(), 'จอคอมต้องมี QR ให้สแกนด้วยโทรศัพท์')
    assert.deepEqual(state.calls, [{ action: 'link' }])
    await page.screenshot({ path: path.join(output, 'pending-desktop.png'), fullPage: true })

    const reads = state.linkReads
    state.linked = { tg_display: '@somchai', linked_at: '2026-10-29T03:00:00Z' }
    await page.clock.runFor(5500)
    await page.locator('[data-telegram-linked]').waitFor()
    assert.ok(state.linkReads > reads)
    assert.match(await page.locator('[data-telegram-linked]').textContent(), /เชื่อมแล้ว กับ @somchai/)
    const after = state.linkReads
    await page.clock.runFor(30_000)
    assert.equal(state.linkReads, after, 'เชื่อมแล้วต้องหยุดตรวจ')
  })

  await test('ลิงก์หมดอายุ: หยุดตรวจ ขอลิงก์ใหม่ได้', {}, async ({ page, state }) => {
    await page.clock.install()
    await openSettings(page)
    await waitTelegramReady(page)
    await page.locator('[data-telegram-link-start]').click()
    await page.locator('[data-telegram-open]').waitFor()
    await page.clock.runFor(15 * 60_000 + 6000)
    await page.locator('[data-telegram-link-start]').waitFor()
    assert.match(await page.locator('[data-telegram-link-start]').textContent(), /ลิงก์หมดอายุ ขอลิงก์ใหม่/)
    const reads = state.linkReads
    await page.clock.runFor(60_000)
    assert.equal(state.linkReads, reads, 'หมดอายุแล้วต้องหยุดตรวจ')
  })

  await test('ขอลิงก์บ่อยเกิน: ขึ้นข้อความจาก server', { linkStatus: 429 }, async ({ page }) => {
    await openSettings(page)
    await waitTelegramReady(page)
    await page.locator('[data-telegram-link-start]').click()
    await page.locator('[data-telegram-link-note]').waitFor()
    assert.match(await page.locator('[data-telegram-link-note]').textContent(), /ขอลิงก์บ่อยเกินไป/)
    assert.equal(await page.locator('[data-telegram-open]').count(), 0)
  })

  await test('เชื่อมแล้ว: ยกเลิกได้ ลบเฉพาะของตัวเอง', { linked: { tg_display: 'สมชาย ใจดี', linked_at: '2026-10-29T03:00:00Z' } }, async ({ page, state }) => {
    await openSettings(page)
    await page.locator('[data-telegram-linked]').waitFor()
    assert.match(await page.locator('[data-telegram-linked]').textContent(), /กับ สมชาย ใจดี/)
    await page.locator('[data-telegram-unlink]').click()
    await page.locator('[data-telegram-link-start]').waitFor()
    assert.deepEqual(state.deletes, [`eq.${uid}`])
    assert.match(await page.locator('[data-telegram-link-note]').textContent(), /ยกเลิกการเชื่อมแล้ว/)
  })

  await test('เชื่อมแล้ว: สวิตช์ 3 หมวด ปิดหมวดแล้วบันทึกขึ้น server', { linked: { tg_display: 'สมชาย ใจดี', linked_at: '2026-10-29T03:00:00Z', dm_muted: [] } }, async ({ page, state }) => {
    await openSettings(page)
    const switches = page.locator('[data-telegram-dm-category]')
    await switches.first().waitFor()
    assert.deepEqual(await switches.evaluateAll((els) => els.map((el) => [el.dataset.telegramDmCategory, el.getAttribute('aria-checked')])),
      [['complaint', 'true'], ['event', 'true'], ['esign', 'true']], 'ค่าเริ่มต้นรับครบ')
    await page.locator('[data-telegram-dm-category="event"]').click()
    await page.waitForFunction(() => document.querySelector('[data-telegram-dm-category="event"]')?.getAttribute('aria-checked') === 'false')
    assert.deepEqual(state.mutedCalls, [['event']])
    await page.locator('[data-telegram-dm-category="esign"]').click()
    await page.waitForFunction(() => document.querySelector('[data-telegram-dm-category="esign"]')?.getAttribute('aria-checked') === 'false')
    await page.locator('[data-telegram-dm-category="event"]').click()
    await page.waitForFunction(() => document.querySelector('[data-telegram-dm-category="event"]')?.getAttribute('aria-checked') === 'true')
    assert.deepEqual(state.mutedCalls, [['event'], ['event', 'esign'], ['esign']])
    const box = await page.locator('[data-telegram-dm-category="complaint"]').boundingBox()
    assert.ok(box.height >= 44, 'สวิตช์สูงพอให้นิ้วกด')
  })

  await test('ยังไม่ apply migration ส่วนที่ 2: เชื่อมแล้วยังใช้ได้ แค่ไม่มีสวิตช์', { linked: { tg_display: 'สมชาย ใจดี', linked_at: '2026-10-29T03:00:00Z', dm_muted: [] }, dmColumnMissing: true }, async ({ page }) => {
    await openSettings(page)
    await page.locator('[data-telegram-linked]').waitFor()
    assert.match(await page.locator('[data-telegram-linked]').textContent(), /กับ สมชาย ใจดี/)
    assert.equal(await page.locator('[data-telegram-dm-categories]').count(), 0)
    assert.equal(await page.locator('[data-telegram-link-settings] [role="alert"]').count(), 0, 'ไม่ขึ้น error')
  })

  await test('ประชาชน: ไม่มีส่วน Telegram และไม่อ่านตาราง', { role: 'citizen' }, async ({ page, state }) => {
    await openSettings(page)
    await page.waitForTimeout(500)
    assert.equal(await page.locator('[data-telegram-link-settings]').count(), 0)
    assert.equal(state.linkReads, 0)
  })

  await test('ยังไม่ apply migration: ซ่อนส่วนนี้เงียบๆ', { tableMissing: true }, async ({ page }) => {
    await openSettings(page)
    await page.waitForTimeout(800)
    assert.equal(await page.locator('[data-telegram-link-settings]').count(), 0)
    assert.ok(await page.locator('[data-push-status]').isVisible(), 'ส่วนอื่นของหน้ายังทำงาน')
  })

  await test('superadmin: ตรวจสถานะบอต → ยืนยันก่อนทับ webhook ที่อื่น', { role: 'superadmin' }, async ({ page, state }) => {
    await openSettings(page)
    await waitTelegramReady(page)
    await page.locator('[data-telegram-bot-status]').click()
    await page.locator('[data-telegram-bot-result]').waitFor()
    assert.match(await page.locator('[data-telegram-bot-result]').textContent(), /old\.example/)
    assert.match(await page.locator('[data-telegram-bot-setup]').textContent(), /ทับ webhook เดิม/)
    await page.locator('[data-telegram-bot-setup]').click()
    await page.waitForFunction(() => document.querySelector('[data-telegram-bot-result]')?.textContent.includes('พร้อมใช้'))
    assert.deepEqual(state.calls, [{ action: 'status' }, { action: 'setup', force: true }])
    assert.equal(await page.locator('[data-telegram-bot-setup]').count(), 0, 'ตั้งแล้วไม่มีปุ่มตั้งซ้ำ')
  })

  await test('superadmin: ยังไม่มี webhook ที่ไหน ตั้งโดยไม่ต้องทับ', { role: 'superadmin', webhook: { configured: false, other: false, otherHost: null } }, async ({ page, state }) => {
    await openSettings(page)
    await waitTelegramReady(page)
    await page.locator('[data-telegram-bot-status]').click()
    await page.locator('[data-telegram-bot-setup]').waitFor()
    assert.equal((await page.locator('[data-telegram-bot-setup]').textContent()).trim(), 'ตั้ง webhook')
    await page.locator('[data-telegram-bot-setup]').click()
    await page.waitForFunction(() => document.querySelector('[data-telegram-bot-result]')?.textContent.includes('พร้อมใช้'))
    assert.deepEqual(state.calls, [{ action: 'status' }, { action: 'setup', force: false }])
  })

  await test('มือถือ: ไม่ล้นจอ ไม่มี QR ปุ่มสูงพอ', { viewport: { width: 390, height: 844 } }, async ({ page }) => {
    await openSettings(page)
    await waitTelegramReady(page)
    await page.locator('[data-telegram-link-start]').click()
    await page.locator('[data-telegram-open]').waitFor()
    await page.locator('[data-telegram-link-settings]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, 'pending-mobile.png') })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'หน้าต้องไม่เลื่อนแนวนอน')
    assert.equal(await page.locator('[data-telegram-link-qr]').isVisible(), false, 'มือถือกดปุ่มเปิดได้เลย ไม่ต้องมี QR')
    const box = await page.locator('[data-telegram-open]').boundingBox()
    assert.ok(box.height >= 44 && box.x + box.width <= 390)
  })
} finally {
  await browser.close()
  await server.close()
}
console.log(`✓ telegram-link (browser): ผ่าน ${results.length} กรณี`)

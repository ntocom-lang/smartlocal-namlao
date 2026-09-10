// E2E ของคำขอ "ขออนุเคราะห์รถรับ-ส่งผู้ป่วย" (อปท. รับเรื่อง → ส่งต่อหน่วยงานผู้จัดรถ)
//
// ครอบ:
//   1. แอดมินเพิ่มหน่วยงานรับเรื่องต่อผ่านการ์ดในแท็บ "ประเภทคำขอเอกสาร"
//   2. การ์ดบริการโผล่ในหน้า E-Service เฉพาะเมื่อมีหน่วยงานเปิดอยู่ (has_active_referral_partner)
//   3. ขั้นคัดกรองฉุกเฉิน: ตอบ "ฉุกเฉิน" ต้องเห็นปุ่มโทร 1669 และไม่เห็นฟอร์ม
//   4. ประชาชนกรอก + ติ๊กยินยอม (ข้อความต้องมีชื่อหน่วยงานปลายทาง) → ยื่นสำเร็จ
//   5. หน้า "เอกสารของฉัน" แสดงกล่องการส่งต่อ + ยกเลิก (ถอนความยินยอม) เองได้ก่อนส่งต่อ
//   6. RPC ปฏิเสธ: anon / ไม่ยินยอม / ฉุกเฉิน / ยื่นกระชั้นกว่า min_lead_days / ประชาชนกดส่งต่อเอง
//   7. RPC idempotent: ยื่นซ้ำด้วย id เดิมไม่เกิดแถวซ้ำ
//   8. ฝั่งเจ้าหน้าที่ (ผ่าน RPC — แผงยังไม่ผูกเข้า StaffDashboard): ส่งต่อ → หน่วยงานรับ → ปิดเรื่อง
//      + ไม่รับโดยไม่มีเหตุผลต้องถูกปฏิเสธ + routing ลงกองที่ถูกต้อง
//
// ⚠️ ข้อบังคับด้านความปลอดภัย/PDPA (เหมือนเทสต์อื่นในโฟลเดอร์นี้)
//   - ยิงได้เฉพาะ dev server ในเครื่อง (VITE_TENANT_SLUG=demo) หรือสนามซ้อม demo.rk-networks.com
//   - ห้าม log token/anon key/เนื้อหาหน้าเว็บดิบ — log เฉพาะผล PASS/FAIL และข้อความ error ของ RPC
//   - ข้อมูลผู้ป่วยในเทสต์เป็นข้อมูลสมมติทั้งหมด และเขียนลง tenant สนามซ้อมเท่านั้น
//
// การรัน: node tests/patient-transport.playwright.mjs [--headed]
//   PT_TEST_BASE_URL (ค่าเริ่มต้น http://localhost:5174)  PT_SHOT_DIR (โฟลเดอร์เก็บภาพหน้าจอ)

import assert from 'node:assert/strict'
import { access, mkdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, safeEvaluate, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const PROFILE_ROOT = process.env.PT_PROFILE_ROOT || path.join(ROOT_DIR, '.chrome-test-profiles')
const SHOT_DIR = process.env.PT_SHOT_DIR || path.join(ROOT_DIR, 'test-results-patient-transport')
const DEFAULT_BASE_URL = 'http://localhost:5174'
const SESSION_SOURCE_URL = 'https://demo.rk-networks.com'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])

const PARTNER_NAME = 'กองทุนทดสอบระบบ (สนามซ้อม)'
const PARTNER_TITLE = 'ประธานคณะกรรมการกองทุนทดสอบระบบ'
const CARD_TITLE = 'ขออนุเคราะห์รถรับ-ส่งผู้ป่วย'
const CONSENT_VERSION = 'ptr-consent-v1'

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
async function step(name, fn) {
  try {
    const detail = await fn()
    record(name, true, typeof detail === 'string' ? detail : '')
  } catch (error) {
    record(name, false, error instanceof BlockedError ? `BLOCKED: ${error.message}` : error.message.split('\n')[0])
  }
}

function resolveBaseUrl() {
  const raw = (process.env.PT_TEST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const url = new URL(raw)
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new BlockedError(`ปฏิเสธการยิงไปที่ ${url.hostname} — ทดสอบได้เฉพาะสนามซ้อมหรือ dev server ในเครื่อง`)
  }
  return url.origin
}

// อ่าน URL + anon key จาก .env.local เข้า memory ของ Node เท่านั้น ห้าม log
async function supabaseEnv() {
  const text = await readFile(path.join(ROOT_DIR, '.env.local'), 'utf8')
  const read = pattern => text.split(/\r?\n/).find(line => pattern.test(line))?.split('=').slice(1).join('=').trim()
  const url = read(/^VITE_SUPABASE_URL=/)
  const key = read(/^VITE_SUPABASE_(ANON|PUBLISHABLE)_KEY=/)
  if (!url || !key) throw new BlockedError('.env.local ไม่มี VITE_SUPABASE_URL / anon key')
  return { url: url.replace(/\/$/, ''), key }
}

async function pathExists(target) {
  try { await access(target); return true } catch { return false }
}

// localStorage แยกตาม origin — ย้าย session ของสนามซ้อมมาใส่ localhost ก่อน goto ครั้งแรก
async function transferDemoSession(page, baseUrl) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) return
  await page.goto(SESSION_SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(3_000)
  const entries = await safeEvaluate(page, () => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('sb-') || key === 'sl-auth-remember'), undefined, [])
  if (!entries.find(([key]) => key.endsWith('-auth-token'))) {
    throw new BlockedError('โปรไฟล์นี้ไม่มี session ค้างบนสนามซ้อม — เปิด Chrome โปรไฟล์นี้ล็อกอินใหม่ก่อน')
  }
  await page.addInitScript(pairs => {
    for (const [key, value] of pairs) {
      try { localStorage.setItem(key, value) } catch { /* โควตาเต็ม/โหมดส่วนตัว */ }
    }
  }, entries)
}

async function openProfile(profile, headed) {
  const profileDir = path.join(PROFILE_ROOT, `TEST-${profile}`)
  if (!await pathExists(profileDir)) throw new BlockedError(`ไม่พบโปรไฟล์ TEST-${profile}`)
  let context
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome', headless: !headed, viewport: { width: 1440, height: 950 },
    })
  } catch {
    throw new BlockedError(`เปิด TEST-${profile} ไม่สำเร็จ; ปิด Chrome โปรไฟล์นี้ก่อนรันซ้ำ`)
  }
  const page = context.pages()[0] || await context.newPage()
  page.on('dialog', dialog => dialog.accept())
  return { context, page, auth: trackProfileResolution(page) }
}

async function accessToken(page) {
  return safeEvaluate(page, () => {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (!key) return null
    try { return JSON.parse(localStorage.getItem(key))?.access_token ?? null } catch { return null }
  }, undefined, null)
}

// เรียก RPC ตรงจาก Node — คืนเฉพาะสถานะและข้อความ error (ไม่คืน body ดิบที่อาจมีข้อมูลส่วนบุคคล)
async function callRpc(env, token, fn, args) {
  const response = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${token ?? env.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const text = await response.text()
  let parsed = null
  try { parsed = JSON.parse(text) } catch { parsed = null }
  return {
    ok: response.ok,
    status: response.status,
    value: response.ok ? parsed : null,
    message: response.ok ? '' : String(parsed?.message ?? text).slice(0, 200),
  }
}

async function selectRows(env, token, table, query) {
  const response = await fetch(`${env.url}/rest/v1/${table}?${query}`, {
    headers: { apikey: env.key, Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`อ่าน ${table} ไม่สำเร็จ (${response.status})`)
  return response.json()
}

function bangkokDate(offsetDays) {
  const now = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now)
}

function payload(partnerId, overrides = {}) {
  return {
    is_emergency: false,
    consent_given: true,
    consent_version: CONSENT_VERSION,
    consent_text: `ข้าพเจ้ายินยอมให้ส่งข้อมูลให้แก่${PARTNER_NAME} (ข้อความทดสอบ)`,
    staff_entry: false,
    partner_id: partnerId,
    requester_name: 'นายทดสอบ ระบบรถ',
    requester_phone: '0800000000',
    requester_relation: 'self',
    pickup_address: 'บ้านเลขที่ 1 หมู่ที่ 1 (ข้อมูลสมมติ)',
    destination: 'โรงพยาบาลทดสอบ',
    appointment_at: `${bangkokDate(6)}T09:00:00+07:00`,
    trip_type: 'round_trip',
    appointment_kind: 'follow_up',
    mobility: 'walk',
    companions: 1,
    ...overrides,
  }
}

const fieldInput = (page, label) => page.locator(
  `xpath=//label[normalize-space(.)="${label}" or normalize-space(.)="${label} *"]`
  + '/following-sibling::*[self::input or self::select or self::textarea][1]',
)

async function shot(page, name, options = {}) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), ...options })
}

async function main() {
  const headed = process.argv.includes('--headed')
  const baseUrl = resolveBaseUrl()
  const env = await supabaseEnv()
  await mkdir(SHOT_DIR, { recursive: true })

  const admin = await openProfile('admin', headed)
  const citizen = await openProfile('citizen', headed)
  let partnerId = null

  try {
    await transferDemoSession(admin.page, baseUrl)
    await transferDemoSession(citizen.page, baseUrl)

    // TEST-citizen ไม่มีเลขบัตร → หน้า E-Service ติดด่าน "ยืนยันตัวตนก่อนใช้บริการ" (LPA ๑.๒)
    // ก่อนถึงรายการบริการ เทสต์นี้ไม่ได้ทดสอบด่านนั้น จึงเติม id_card สมมติเฉพาะในคำตอบที่
    // เบราว์เซอร์ได้รับ — ไม่เขียนลงโปรไฟล์จริง เพราะบัญชีทดสอบนี้ใช้ร่วมกับเทสต์อื่นที่อาจตรวจด่านนั้นอยู่
    await citizen.page.route(/\/rest\/v1\/profiles\?.*select=[^&]*id_card/, async route => {
      const response = await route.fetch()
      const body = await response.json().catch(() => null)
      const patch = row => (row && typeof row === 'object' && !row.id_card ? { ...row, id_card: '0000000000000' } : row)
      await route.fulfill({ response, json: Array.isArray(body) ? body.map(patch) : patch(body) })
    })

    // ── 1. แอดมินเพิ่มหน่วยงานรับเรื่องต่อ ───────────────────────────────────────
    await step('แอดมินเพิ่มหน่วยงานรับเรื่องต่อผ่านการ์ด', async () => {
      const { page } = admin
      await page.goto(`${baseUrl}/admin`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await waitForSettled(page, admin.auth)
      await page.getByRole('button', { name: 'ประเภทคำร้อง', exact: true }).first().click()
      await page.getByRole('button', { name: 'ประเภทคำขอเอกสาร', exact: true }).first().click()
      const card = page.locator('div.rounded-2xl.border-gray-200').filter({ hasText: 'หน่วยงานรับเรื่องต่อ — รถรับ-ส่งผู้ป่วย' })
      await card.first().waitFor({ timeout: 20_000 })
      await card.first().scrollIntoViewIfNeeded()
      await page.waitForTimeout(1_500)
      if (!await card.getByText(PARTNER_NAME).count()) {
        await card.getByRole('button', { name: 'เพิ่มหน่วยงาน' }).click()
        await card.getByPlaceholder('เช่น กองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว').fill(PARTNER_NAME)
        await card.getByPlaceholder('เช่น ประธานคณะกรรมการกองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว').fill(PARTNER_TITLE)
        const saved = page.waitForResponse(res => res.url().includes('/rest/v1/referral_partners') && res.request().method() === 'POST')
        await card.getByRole('button', { name: 'บันทึก', exact: true }).click()
        const response = await saved
        assert.ok(response.ok(), `บันทึกหน่วยงานไม่สำเร็จ (${response.status()})`)
        await card.getByText(PARTNER_NAME).waitFor({ timeout: 15_000 })
      }
      // ถ่ายเฉพาะการ์ด — การ์ดอยู่ท้ายตารางประเภทคำขอ ภาพทั้งหน้าจอจะเห็นแค่หัวตาราง
      await card.first().screenshot({ path: path.join(SHOT_DIR, '01-admin-referral-partner-card.png') })
      const token = await accessToken(page)
      const rows = await selectRows(env, token, 'referral_partners', `select=id,name,is_active&name=eq.${encodeURIComponent(PARTNER_NAME)}`)
      assert.equal(rows.length, 1, 'ต้องมีหน่วยงานทดสอบ 1 แถว')
      assert.equal(rows[0].is_active, true)
      partnerId = rows[0].id
    })

    const citizenToken = async () => accessToken(citizen.page)

    // ── 2-4. ประชาชนเห็นการ์ด → คัดกรองฉุกเฉิน → ยื่นคำขอ ─────────────────────────
    let submittedRef = null
    await step('การ์ดบริการโผล่ในหน้า E-Service หลังมีหน่วยงานเปิดอยู่', async () => {
      const { page } = citizen
      await page.goto(`${baseUrl}/doc-request`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await waitForSettled(page, citizen.auth)
      await page.waitForTimeout(2_000)
      // ถ่ายก่อนตรวจ — ถ้าการ์ดไม่ขึ้นจะได้เห็นว่าหน้าจอติดอยู่ที่อะไร (เช่น ด่านยืนยันเลขบัตร)
      await shot(page, '02-citizen-service-list')
      // แยกให้ออกว่าพังที่ฐานข้อมูลหรือที่หน้าจอ: ถามฟังก์ชันเดียวกับที่หน้าเว็บใช้ด้วย token ของประชาชน
      const token = await citizenToken()
      const [partnerRow] = await selectRows(env, token, 'referral_partners', `select=municipality_id&id=eq.${partnerId}`)
      assert.ok(partnerRow, 'ประชาชนอ่านหน่วยงานที่เปิดอยู่ใน อปท. ตัวเองไม่ได้ (RLS)')
      const visible = await callRpc(env, token, 'has_active_referral_partner', {
        _municipality_id: partnerRow.municipality_id, _document_type: 'patient_transport_request',
      })
      assert.equal(visible.value, true, `has_active_referral_partner คืน ${visible.value} ${visible.message}`)
      await page.getByText(CARD_TITLE).first().waitFor({ timeout: 20_000 })
    })

    await step('ตอบ "ฉุกเฉิน" แล้วเห็นปุ่มโทร 1669 และไม่เห็นฟอร์ม', async () => {
      const { page } = citizen
      await page.getByRole('button', { name: new RegExp(CARD_TITLE) }).first().click()
      await page.getByRole('button', { name: 'ใช่ ฉุกเฉิน ต้องไปเดี๋ยวนี้' }).click()
      await page.getByRole('link', { name: /โทร 1669/ }).waitFor({ timeout: 10_000 })
      assert.equal(await page.getByText('ผู้ยื่นคำขอ', { exact: true }).count(), 0, 'ฟอร์มต้องไม่แสดงเมื่อเป็นเหตุฉุกเฉิน')
      await shot(page, '03-citizen-emergency-1669')
    })

    await step('กรอกฟอร์ม + ยินยอม (มีชื่อหน่วยงาน) แล้วยื่นสำเร็จ', async () => {
      const { page } = citizen
      await page.getByRole('button', { name: 'ไม่ฉุกเฉิน เป็นการไปตามนัดล่วงหน้า' }).click()
      await page.getByText('ผู้ยื่นคำขอ', { exact: true }).waitFor({ timeout: 15_000 })

      const title = fieldInput(page, 'คำนำหน้า')
      if (!await title.inputValue()) await title.selectOption({ index: 1 })
      if (!(await fieldInput(page, 'ชื่อ').inputValue()).trim()) await fieldInput(page, 'ชื่อ').fill('ทดสอบ')
      if (!(await fieldInput(page, 'นามสกุล').inputValue()).trim()) await fieldInput(page, 'นามสกุล').fill('ระบบรถ')
      await fieldInput(page, 'เบอร์โทรศัพท์สำหรับติดต่อ').fill('0800000000')
      await fieldInput(page, 'อายุ (ปี)').fill('67')
      await fieldInput(page, 'ที่อยู่จุดรับผู้ป่วย').fill('บ้านเลขที่ 1 หมู่ที่ 1 (ข้อมูลสมมติ)')
      await fieldInput(page, 'สถานพยาบาลปลายทาง').fill('โรงพยาบาลทดสอบ')
      await fieldInput(page, 'วันนัด').fill(bangkokDate(7))
      await fieldInput(page, 'เวลานัด').fill('09:30')
      await page.getByRole('button', { name: 'ตรวจตามนัดแพทย์' }).click()
      await page.getByRole('button', { name: 'เดินได้เอง' }).click()

      const consent = page.locator('section').filter({ hasText: 'ความยินยอมส่งต่อข้อมูล' })
      const consentText = await consent.innerText()
      assert.ok(consentText.includes(PARTNER_NAME), 'ข้อความยินยอมต้องระบุชื่อหน่วยงานปลายทาง')
      const submit = page.getByRole('button', { name: 'ยืนยันและส่งคำขอ' })
      assert.equal(await submit.isDisabled(), true, 'ยังไม่ติ๊กยินยอมต้องกดส่งไม่ได้')
      await consent.locator('input[type="checkbox"]').check()
      // รอ transition-colors ของปุ่มตัวเลือกจบก่อนถ่าย ไม่งั้นปุ่มที่เพิ่งกดติดภาพเป็นสีจางครึ่งทาง
      await page.waitForTimeout(500)
      await shot(page, '04-citizen-form-filled', { fullPage: true })

      const created = page.waitForResponse(res => res.url().includes('/rpc/create_patient_transport_request'))
      await submit.click()
      const response = await created
      assert.ok(response.ok(), `ยื่นคำขอไม่สำเร็จ (${response.status()})`)
      await page.getByText('ยื่นคำขอสำเร็จ').waitFor({ timeout: 15_000 })
      // เอาเลขอ้างอิงจาก id ที่หน้าเว็บส่งเข้า RPC จริง ไม่อ่านจากจอ — class ตัวอักษรห่าง
      // (tracking-widest) ซ้ำกับป้ายเมนูด้านข้าง เคยหยิบผิดเป็นคำว่า "บริการหลัก" มาแล้ว
      const requestIdSent = response.request().postDataJSON()?.p_request_id ?? ''
      submittedRef = requestIdSent.slice(0, 8).toUpperCase()
      assert.ok(submittedRef.length === 8, 'อ่าน id ที่ส่งเข้า RPC ไม่ได้')
      assert.ok(await page.getByText(submittedRef, { exact: true }).count(), 'เลขอ้างอิงบนจอไม่ตรงกับ id ที่ส่ง')
      await shot(page, '05-citizen-submitted')
      return `ref ${submittedRef}`
    })

    await step('หน้าเอกสารของฉันแสดงกล่องการส่งต่อ แล้วยกเลิกเองได้', async () => {
      assert.ok(submittedRef, 'ไม่มีเลขอ้างอิงจากขั้นก่อน')
      const { page } = citizen
      await page.goto(`${baseUrl}/my-docs`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await waitForSettled(page, citizen.auth)
      await page.locator('tr').filter({ hasText: submittedRef }).first().click()
      await page.getByText('การส่งต่อหน่วยงานผู้จัดรถ').waitFor({ timeout: 15_000 })
      await page.getByText('รอเจ้าหน้าที่ตรวจสอบ').first().waitFor({ timeout: 5_000 })
      await shot(page, '06-citizen-my-docs-progress')
      await page.getByRole('button', { name: 'ยกเลิกคำขอ / ถอนความยินยอม' }).click()
      const cancelled = page.waitForResponse(res => res.url().includes('/rpc/cancel_patient_transport_request'))
      await page.getByRole('button', { name: 'ยืนยันยกเลิก' }).click()
      assert.ok((await cancelled).ok(), 'ยกเลิกไม่สำเร็จ')
      await page.getByText('ยกเลิกคำขอแล้ว').waitFor({ timeout: 10_000 })
      await shot(page, '07-citizen-cancelled')
    })

    // ── 6. RPC ต้องปฏิเสธกรณีผิดเงื่อนไข ────────────────────────────────────────
    await step('anon เรียก create ไม่ได้', async () => {
      const result = await callRpc(env, null, 'create_patient_transport_request', {
        p_request_id: randomUUID(), p_payload: payload(partnerId),
      })
      assert.equal(result.ok, false, 'anon ต้องถูกปฏิเสธ')
      return `HTTP ${result.status}`
    })

    for (const [name, overrides, expected] of [
      ['ไม่ยินยอม → ปฏิเสธ', { consent_given: false }, 'ยินยอม'],
      ['ไม่ส่ง is_emergency → ถือว่าฉุกเฉิน ปฏิเสธ (fail closed)', { is_emergency: undefined }, '1669'],
      ['ยื่นกระชั้นกว่า min_lead_days → ปฏิเสธ', { appointment_at: `${bangkokDate(1)}T09:00:00+07:00` }, 'ล่วงหน้า'],
      ['ยื่นแทนแต่ไม่มีชื่อผู้ป่วย → ปฏิเสธ', { requester_relation: 'relative' }, 'ชื่อผู้ป่วย'],
    ]) {
      await step(`RPC: ${name}`, async () => {
        const result = await callRpc(env, await citizenToken(), 'create_patient_transport_request', {
          p_request_id: randomUUID(), p_payload: payload(partnerId, overrides),
        })
        assert.equal(result.ok, false, 'ต้องถูกปฏิเสธ')
        assert.ok(result.message.includes(expected), `ข้อความ error ไม่ตรง: ${result.message}`)
      })
    }

    // ── 7-8. idempotent + ฝั่งเจ้าหน้าที่ ─────────────────────────────────────────
    const requestId = randomUUID()
    await step('RPC: ยื่นซ้ำด้วย id เดิมไม่เกิดแถวซ้ำ (idempotent)', async () => {
      const token = await citizenToken()
      const first = await callRpc(env, token, 'create_patient_transport_request', { p_request_id: requestId, p_payload: payload(partnerId) })
      const second = await callRpc(env, token, 'create_patient_transport_request', { p_request_id: requestId, p_payload: payload(partnerId) })
      assert.ok(first.ok && second.ok, `ยื่นไม่สำเร็จ: ${first.message || second.message}`)
      const rows = await selectRows(env, token, 'patient_transport_requests', `select=request_id,workflow_status&request_id=eq.${requestId}`)
      assert.equal(rows.length, 1)
      assert.equal(rows[0].workflow_status, 'submitted')
    })

    await step('routing: คำขอเข้ากองสวัสดิการ (หรือสำนักปลัดถ้าไม่มี)', async () => {
      const token = await accessToken(admin.page)
      const rows = await selectRows(env, token, 'document_requests', `select=department:departments(name)&id=eq.${requestId}`)
      const name = rows[0]?.department?.name ?? ''
      assert.ok(/สวัสดิการ|ปลัด/.test(name), `กองที่ได้: ${name || '(ว่าง)'}`)
      return name
    })

    await step('RPC: ประชาชนกดส่งต่อคำขอของตัวเองไม่ได้', async () => {
      const result = await callRpc(env, await citizenToken(), 'forward_patient_transport_request', {
        p_request_id: requestId, p_letter_no: 'ปลอม 1/2569', p_letter_date: bangkokDate(0),
      })
      assert.equal(result.ok, false)
      assert.ok(result.message.includes('ไม่มีสิทธิ์'), result.message)
    })

    await step('RPC: เจ้าหน้าที่ส่งต่อ → หน่วยงานรับ → ปิดเรื่อง', async () => {
      const token = await accessToken(admin.page)
      const forwarded = await callRpc(env, token, 'forward_patient_transport_request', {
        p_request_id: requestId, p_letter_no: 'ทดสอบ 1/2569', p_letter_date: bangkokDate(0),
      })
      assert.equal(forwarded.value, 'forwarded', forwarded.message)
      const again = await callRpc(env, token, 'forward_patient_transport_request', {
        p_request_id: requestId, p_letter_no: 'ทดสอบ 2/2569', p_letter_date: bangkokDate(0),
      })
      assert.equal(again.value, 'forwarded', 'ส่งต่อซ้ำต้องได้สถานะเดิม ไม่ทับเลขหนังสือ')
      const declinedNoReason = await callRpc(env, token, 'record_patient_transport_fund_result', {
        p_request_id: requestId, p_accepted: false, p_note: null, p_contact: null,
      })
      assert.equal(declinedNoReason.ok, false, 'ไม่รับโดยไม่มีเหตุผลต้องถูกปฏิเสธ')
      const accepted = await callRpc(env, token, 'record_patient_transport_fund_result', {
        p_request_id: requestId, p_accepted: true, p_note: 'นัดรับ 08:00', p_contact: 'โทรกองทุนทดสอบ',
      })
      assert.equal(accepted.value, 'fund_accepted', accepted.message)
      const completed = await callRpc(env, token, 'complete_patient_transport_request', {
        p_request_id: requestId, p_note: 'ปิดโดยเทสต์อัตโนมัติ',
      })
      assert.equal(completed.value, 'completed', completed.message)
      const rows = await selectRows(env, token, 'patient_transport_requests', `select=forward_letter_no&request_id=eq.${requestId}`)
      assert.equal(rows[0].forward_letter_no, 'ทดสอบ 1/2569')
      const events = await selectRows(env, token, 'patient_transport_events', `select=event_type&request_id=eq.${requestId}&order=created_at`)
      assert.deepEqual(events.map(event => event.event_type), ['created', 'forwarded', 'fund_accepted', 'completed'])
    })

    // ── 9. กล่องงานเจ้าหน้าที่ต้องใช้แผงเฉพาะ ไม่ใช่ปุ่มเปลี่ยนสถานะตัวกลาง ────────
    //
    // ⚠️ ข้อนี้ไม่ใช่การทดสอบหน้าตา แต่กันข้อบกพร่องที่เคยเจอจริง: ตอนยังไม่ได้ผูก
    // StaffDashboard ประเภทนี้เห็นปุ่มกลางครบชุด กด "ดำเนินการเสร็จสิ้น" แล้วได้ทั้ง
    // สถานะแม่-ลูกไม่ตรงกัน (ปิดโดยไม่มีเลขหนังสือนำส่ง) และ handleUpdate สร้าง
    // "หนังสือรับรอง" จาก DOC_TITLES ค่ากลางอัปขึ้น Drive ทั้งที่คำขอนี้ไม่มีหนังสือรับรอง
    // ใครเพิ่มประเภทที่มีแผงเฉพาะใหม่แล้วลืมใส่ใน PANEL_DOC_TYPES จะตกข้อนี้
    const CENTRAL_BUTTONS = [
      'รับเรื่อง — เริ่มดำเนินการ', 'ดำเนินการเสร็จสิ้น', 'ปฏิเสธคำขอ', 'พิมพ์ / บันทึกเป็น PDF',
    ]

    async function openDocInbox(page) {
      await page.goto(`${baseUrl}/staff`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await waitForSettled(page, admin.auth)
      // /staff เปิดที่แดชบอร์ดรวม ต้องเข้าเมนู "คำขอบริการ/เอกสาร" ก่อนถึงจะเจอกล่องงาน
      await page.locator('text=คำขอบริการ/เอกสาร').locator('visible=true').first().click({ timeout: 20_000 })
      await page.waitForTimeout(3_000)
    }

    await step('กล่องงาน: คำขอรถรับ-ส่งผู้ป่วยใช้แผงเฉพาะ ไม่มีปุ่มเปลี่ยนสถานะตัวกลาง', async () => {
      const { page } = admin
      await openDocInbox(page)
      // ค้นด้วยชื่อประเภทแทนการกดแถวแรก เพื่อไม่ให้ผลขึ้นกับลำดับข้อมูลทดสอบที่ค้างอยู่
      await page.locator('input[placeholder^="ค้นหาชื่อ"]').first().fill('ขออนุเคราะห์รถรับ-ส่งผู้ป่วย')
      await page.waitForTimeout(2_000)
      const row = page.locator('button:has-text("ดูรายละเอียด"), button:has-text("ตรวจสอบคำขอ")').first()
      assert.ok(await row.count() > 0, 'ไม่พบคำขอรถรับ-ส่งผู้ป่วยในกล่องงาน')
      await row.click({ timeout: 20_000 })
      await page.waitForTimeout(3_000)
      await page.screenshot({ path: path.join(SHOT_DIR, 'staff-panel.png') })

      const sheet = await page.evaluate(() => document.querySelector('.fixed.inset-0.z-50')?.innerText ?? '')
      assert.ok(/หน่วยงานผู้จัดรถ/.test(sheet), 'ไม่เจอแผงคำขอรถรับ-ส่งผู้ป่วยในใบงาน')
      assert.ok(await page.locator('button:has-text("พิมพ์หนังสือนำส่ง")').count() > 0,
        'ไม่เจอปุ่มพิมพ์หนังสือนำส่ง + ใบคำขอ')
      for (const label of CENTRAL_BUTTONS) {
        const found = await page.locator(`button:has-text("${label}")`).locator('visible=true').count()
        assert.equal(found, 0, `ปุ่มกลาง "${label}" ยังโผล่ในคำขอประเภทนี้`)
      }
    })

    await step('กล่องงาน: คำขอประเภทอื่นที่ยังไม่ปิด ยังเห็นปุ่มเปลี่ยนสถานะตัวกลางเหมือนเดิม', async () => {
      const { page } = admin
      await openDocInbox(page)
      // ปุ่ม "ตรวจสอบคำขอ" มีเฉพาะแถวที่ยังไม่ปิด — ใบที่ปิดแล้วไม่ขึ้นปุ่มกลางอยู่แล้ว (isActive)
      // เปิดใบที่ปิดแล้วมาทดสอบจะได้ผลลบลวงว่าปุ่มหายทั้งระบบ
      const buttons = page.locator('button:has-text("ตรวจสอบคำขอ")')
      const total = await buttons.count()
      for (let index = 0; index < Math.min(total, 8); index += 1) {
        await buttons.nth(index).click({ timeout: 20_000 })
        await page.waitForTimeout(2_000)
        const sheet = await page.evaluate(() => document.querySelector('.fixed.inset-0.z-50')?.innerText ?? '')
        // ข้ามประเภทที่ตั้งใจให้ไม่มีปุ่มกลาง (PANEL_DOC_TYPES ใน StaffDashboard.jsx)
        if (/ขออนุเคราะห์รถรับ-ส่งผู้ป่วย|ขอยืมพัสดุ\/ครุภัณฑ์/.test(sheet)) {
          await openDocInbox(page)
          continue
        }
        const visible = []
        for (const label of CENTRAL_BUTTONS) {
          if (await page.locator(`button:has-text("${label}")`).locator('visible=true').count() > 0) visible.push(label)
        }
        assert.ok(visible.length > 0, `คำขอประเภทอื่นไม่เห็นปุ่มกลางเลย — ${sheet.slice(0, 60)}`)
        return `เทียบกับ ${sheet.split('\n').slice(0, 3).join(' ').slice(0, 40)}`
      }
      throw new BlockedError('ไม่มีคำขอประเภทอื่นที่ยังไม่ปิดในกล่องงานให้เทียบ')
    })

    await step('กล่องงาน: เจ้าหน้าที่รับเรื่องแทนหน้าเคาน์เตอร์ ต้องผ่านด่านคัดกรองฉุกเฉินเหมือนกัน', async () => {
      const { page } = admin
      await openDocInbox(page)
      await page.locator('button:has-text("สร้างคำขอ")').locator('visible=true').first().click({ timeout: 20_000 })
      await page.waitForTimeout(1_500)
      const typeButton = page.locator('button:has-text("ขออนุเคราะห์รถรับ-ส่งผู้ป่วย")').locator('visible=true').first()
      assert.ok(await typeButton.count() > 0, 'ไม่เจอประเภทนี้ในรายการสร้างคำขอของเจ้าหน้าที่')
      await typeButton.click({ timeout: 20_000 })
      await page.waitForTimeout(3_000)
      const text = await page.evaluate(() => document.body.innerText)
      assert.ok(/ผู้ป่วยต้องไปโรงพยาบาลด่วนตอนนี้หรือไม่/.test(text),
        'กดแล้วไม่เข้าวิซาร์ด — ตกไปที่ฟอร์มสร้างคำขอทั่วไปซึ่งไม่มีด่านฉุกเฉินและไม่มีความยินยอม')
      await page.locator('button:has-text("ใช่ ฉุกเฉิน")').locator('visible=true').first().click({ timeout: 20_000 })
      await page.waitForTimeout(1_500)
      const after = await page.evaluate(() => document.body.innerText)
      assert.ok(/1669/.test(after), 'ตอบว่าฉุกเฉินแล้วไม่ขึ้นให้โทร 1669')
      assert.ok(!/วันเวลานัด|จุดรับ/.test(after), 'ตอบว่าฉุกเฉินแล้วยังกรอกฟอร์มต่อได้')
      await page.screenshot({ path: path.join(SHOT_DIR, 'staff-counter-1669.png') })
    })
  } finally {
    await admin.context.close().catch(() => {})
    await citizen.context.close().catch(() => {})
  }

  const failed = results.filter(result => !result.ok).length
  console.log(`\n${results.length - failed}/${results.length} ผ่าน — ภาพหน้าจอ: ${SHOT_DIR}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => {
  console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'ERROR'}: ${error.message.split('\n')[0]}`)
  process.exit(2)
})

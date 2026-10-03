// E2E การแข่งกันของ 2 connection บนฐานข้อมูลจริงของสนามซ้อม demo — ระบบจองรถรับ-ส่งผู้ป่วย (patient_booking_*)
//
// ทำไมต้องมี: tests/patient-booking-db.test.mjs ใช้ PGlite ซึ่งเป็น connection เดียว จึงพิสูจน์ไม่ได้ว่า
// `SELECT … FOR UPDATE` บนแถวตั้งค่าของหน่วยงานกัน "ยืนยันรถชนกัน/กดซ้ำ" ได้จริง (docs/ai/PATIENT_BOOKING_HANDOFF.md
// ข้อ "Release gates" ข้อ 2) สคริปต์นี้ยิงคำสั่งเดียวกันพร้อมกัน 2 คำขอผ่าน PostgREST (คนละ connection ใน pool)
//
// ครอบ (R = race):
//   R1 ยืนยันรถ 2 คำขอที่ชนเวลากันพร้อมกัน → ต้องสำเร็จเที่ยวเดียว อีกใบถูกปฏิเสธ ไม่มีเที่ยวซ้อนทับ
//   R2 กดยืนยันคำขอเดียวซ้ำพร้อมกันด้วยรหัสเที่ยวเดิม → สำเร็จทั้งคู่ ได้เที่ยวเดียวกัน (idempotent)
//   R3 กดยืนยันคำขอเดียวพร้อมกันจาก 2 แท็บ (รหัสเที่ยวต่างกัน) → สำเร็จใบเดียว ไม่เกิด 2 เที่ยว
//   R4 สั่งเที่ยวเดียวกันพร้อมกันด้วย revision เดียวกันแต่คนละ op → สำเร็จใบเดียว อีกใบถูกปฏิเสธว่าเที่ยวเปลี่ยนแล้ว
//   R5 ส่งคำสั่งเดิม (op เดียวกัน) ซ้ำพร้อมกัน → ผลเกิดครั้งเดียว ประวัติมีบรรทัดเดียว revision ขึ้น 1
//   R6 ส่งคำขอจองซ้ำ (ชื่อ/เบอร์/เวลา/เส้นทางเดียวกัน คนละรหัส) พร้อมกัน → ตัวกันซ้ำต้องกันได้
//
// ⚠️ ข้อบังคับความปลอดภัย/PDPA
//   - เขียนได้เฉพาะ tenant slug=demo เท่านั้น (ตรวจก่อนทุกครั้ง) ห้ามชี้ไปหน่วยงานอื่น — ทุ่งแค้ว/น้ำเลา มีข้อมูลจริง
//   - ข้อมูลทดสอบทั้งหมดเป็นข้อมูลสมมติ ชื่อขึ้นต้น "[TEST] race" ไม่ลบแถวใด ๆ (ฐานข้อมูลไม่เปิดให้ลบ) ใช้คืนเที่ยว/ยกเลิกแทน
//   - ห้าม log token/anon key/เนื้อหา body ดิบ — log เฉพาะผล PASS/FAIL และข้อความ error ของ RPC
//   - ระบบจองนี้แจ้งเตือนในแอป (patient_booking_notices) เท่านั้น ไม่มี Telegram/push/อีเมลออกนอกระบบ
//
// การรัน (ต้องรันจากโฟลเดอร์รากของรีโปที่มี .env.local และ .chrome-test-profiles เพราะอ่าน URL/anon key และ session จากที่นั่น):
//   node tests/patient-booking-demo-race.playwright.mjs            ← โหมดซ้อม: ตรวจ session/หน่วยงาน/วันว่าง ไม่เขียนอะไร
//   node tests/patient-booking-demo-race.playwright.mjs --write    ← รันจริง (เขียนข้อมูล [TEST] race บน demo แล้วเก็บกวาดท้ายรอบ)
//   node tests/patient-booking-demo-race.playwright.mjs --cleanup  ← เก็บกวาดรายการ [TEST] race ที่ค้างจากรอบที่ถูกขัดจังหวะ
//   ปิด Chrome โปรไฟล์ TEST-admin / TEST-citizen ก่อนรัน (โปรไฟล์เปิดซ้อนกันไม่ได้)

import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, safeEvaluate, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const PROFILE_ROOT = process.env.PT_PROFILE_ROOT || path.join(ROOT_DIR, '.chrome-test-profiles')
const DEMO_ORIGIN = 'https://demo.rk-networks.com'
const DEMO_SLUG = 'demo'
const TEST_PREFIX = '[TEST] race'
const MIN_TOKEN_LIFE_S = 240

const WRITE = process.argv.includes('--write')
const CLEANUP_ONLY = process.argv.includes('--cleanup')
const RUN_TAG = randomUUID().slice(0, 6)

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
    record(name, false, error instanceof BlockedError ? `BLOCKED: ${error.message}` : String(error.message).split('\n')[0])
  }
}

// อ่าน URL + anon key จาก .env.local เข้า memory ของ Node เท่านั้น ห้าม log
async function supabaseEnv() {
  let text
  try { text = await readFile(path.join(ROOT_DIR, '.env.local'), 'utf8') } catch { throw new BlockedError('ไม่พบ .env.local — รันจากโฟลเดอร์รากของรีโป') }
  const read = pattern => text.split(/\r?\n/).find(line => pattern.test(line))?.split('=').slice(1).join('=').trim()
  const url = read(/^VITE_SUPABASE_URL=/)
  const key = read(/^VITE_SUPABASE_(ANON|PUBLISHABLE)_KEY=/)
  if (!url || !key) throw new BlockedError('.env.local ไม่มี VITE_SUPABASE_URL / anon key')
  return { url: url.replace(/\/$/, ''), key }
}

async function pathExists(target) {
  try { await access(target); return true } catch { return false }
}

// เปิดโปรไฟล์ทดสอบ → โหลดหน้า demo ให้ auth-js ต่ออายุ token → อ่าน token ออกมาใช้ใน Node แล้วปิดเบราว์เซอร์
// token ไม่ถูก log และไม่ถูกเขียนลงไฟล์ · ต้องเหลืออายุ > 4 นาที ไม่งั้นรอบแข่งอาจหมดอายุกลางทาง
async function sessionOf(profile) {
  const profileDir = path.join(PROFILE_ROOT, `TEST-${profile}`)
  if (!await pathExists(profileDir)) throw new BlockedError(`ไม่พบโปรไฟล์ TEST-${profile}`)
  let context
  try {
    context = await chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless: true, viewport: { width: 1280, height: 900 } })
  } catch {
    throw new BlockedError(`เปิด TEST-${profile} ไม่สำเร็จ — ปิด Chrome โปรไฟล์นี้ก่อนรันซ้ำ`)
  }
  try {
    const page = context.pages()[0] || await context.newPage()
    const auth = trackProfileResolution(page)
    const read = () => safeEvaluate(page, () => {
      const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (!key) return null
      try {
        const value = JSON.parse(localStorage.getItem(key))
        return { token: value?.access_token ?? null, expiresAt: value?.expires_at ?? 0, userId: value?.user?.id ?? null }
      } catch { return null }
    }, undefined, null)
    await page.goto(`${DEMO_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await waitForSettled(page, auth)
    let session = await read()
    for (let attempt = 0; attempt < 2 && (!session?.token || session.expiresAt - Date.now() / 1000 < MIN_TOKEN_LIFE_S); attempt += 1) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(6_000)
      session = await read()
    }
    if (!session?.token) throw new BlockedError(`โปรไฟล์ TEST-${profile} ไม่มี session ค้างบน demo — เปิด Chrome โปรไฟล์นี้ล็อกอินใหม่ก่อน`)
    if (session.expiresAt - Date.now() / 1000 < MIN_TOKEN_LIFE_S) throw new BlockedError(`token ของ TEST-${profile} เหลืออายุน้อยกว่า 4 นาที — เปิดโปรไฟล์ค้างไว้ให้ต่ออายุแล้วรันใหม่`)
    return session
  } finally {
    await context.close()
  }
}

// เรียก RPC ตรงจาก Node — คืนเฉพาะสถานะและข้อความ error (ไม่คืน body ดิบเมื่อผิดพลาด)
// คำสั่งที่ต้องชนกันจริงต้องถูกสร้างพร้อมกัน (Promise.all ของฟังก์ชันนี้) เพื่อให้ได้คนละ connection
async function rpc(env, token, fn, args) {
  const response = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.key, Authorization: `Bearer ${token ?? env.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(45_000),
  })
  const text = await response.text()
  let parsed = null
  try { parsed = JSON.parse(text) } catch { parsed = null }
  return { ok: response.ok, status: response.status, value: response.ok ? parsed : null, message: response.ok ? '' : String(parsed?.message ?? text).slice(0, 240) }
}
async function rpcOk(env, token, fn, args) {
  const out = await rpc(env, token, fn, args)
  if (!out.ok) throw new Error(`${fn} ล้มเหลว (${out.status}): ${out.message}`)
  return out.value
}

const bangkokDate = offsetDays => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(Date.now() + offsetDays * 86_400_000))
const at = (day, time) => `${day}T${time}:00+07:00`

// วันที่รถว่างทั้งวัน (ไม่มีเที่ยวเลย) ไว้ให้แต่ละรอบใช้คนละวัน ไม่ชนข้อมูลที่คนอื่นกำลังทดสอบบน demo
async function freeDays(ctx, count) {
  const calendar = await rpcOk(ctx.env, ctx.admin.token, 'patient_booking_calendar', { p_muni: ctx.muni, p_from: bangkokDate(8), p_to: bangkokDate(60) })
  const days = (calendar.days ?? []).filter(day => day.status === 'open' && !(day.trips ?? []).length).map(day => day.date)
  if (days.length < count) throw new BlockedError(`วันที่รถว่างทั้งวันใน 8–60 วันข้างหน้ามี ${days.length} วัน ต้องการ ${count} วัน (ไม่แก้ตั้งค่าของ demo เอง)`)
  return days.slice(0, count)
}

const label = suffix => `${TEST_PREFIX} ${suffix} ${RUN_TAG}`
function bookingBody(ctx, suffix, phoneIndex, day, time, returnTime = '12:00') {
  return {
    requester_name: `${TEST_PREFIX} ผู้จอง`, patient_name: label(suffix), phone: `08000009${String(phoneIndex).padStart(2, '0')}`,
    relation: 'self', pickup: '[TEST] จุดรับสมมติ', in_area: true, route_id: ctx.info.routes[0].id,
    appointment_at: at(day, time), mobility: 'walk', companions: 0, share: false, return_mode: 'wait', return_at: at(day, returnTime),
    is_emergency: false, consent: true, consent_version: ctx.info.consent_version, privacy_notice: ctx.info.privacy_notice, owner_name: ctx.info.owner_name,
  }
}
const submit = (ctx, id, body) => rpc(ctx.env, ctx.citizen.token, 'patient_booking_submit', { p_muni: ctx.muni, p_id: id, p_data: body, p_staff_entry: false })
const workspace = ctx => rpcOk(ctx.env, ctx.admin.token, 'patient_booking_workspace', { p_muni: ctx.muni })
const preview = (ctx, ids) => rpcOk(ctx.env, ctx.admin.token, 'patient_booking_preview', { p_muni: ctx.muni, p_ids: ids, p_helper: '' })
const confirm = (ctx, tripId, ids, plan) => rpc(ctx.env, ctx.admin.token, 'patient_booking_confirm', { p_muni: ctx.muni, p_id: tripId, p_ids: ids, p_expected: plan, p_helper: '' })
const act = (ctx, op, entity, revision, action, note = '') => rpc(ctx.env, ctx.admin.token, 'patient_booking_action', { p_muni: ctx.muni, p_op: op, p_entity: entity, p_revision: revision, p_action: action, p_note: note })
const history = async (ctx, bookingId) => (await rpcOk(ctx.env, ctx.admin.token, 'patient_booking_history', { p_muni: ctx.muni, p_booking: bookingId })).events ?? []

const bookingOf = (ws, id) => ws.bookings.find(booking => booking.id === id)
const tripOf = (ws, id) => ws.trips.find(trip => trip.id === id)
const exactlyOne = (list, what) => assert.equal(list.filter(Boolean).length, 1, what)
const noServerFault = (outs, what) => assert(outs.every(out => out.ok || out.status < 500), `${what}: ต้องถูกปฏิเสธด้วยข้อความของระบบ ไม่ใช่ข้อผิดพลาดของเซิร์ฟเวอร์ (${outs.map(out => out.status).join('/')}) ${outs.map(out => out.message).join(' | ')}`)

// ── เก็บกวาด: คืนเที่ยวที่ยังไม่ออกรถ แล้วยกเลิกคำขอที่ค้าง "รอยืนยันรถ" — ไม่ลบแถวใด ๆ ──
async function cleanup(ctx, onlyTag) {
  const mine = ws => ws.bookings.filter(booking => String(booking.patient_name ?? '').startsWith(TEST_PREFIX) && (!onlyTag || booking.patient_name.endsWith(onlyTag)))
  let ws = await workspace(ctx)
  const tripIds = [...new Set(mine(ws).map(booking => booking.trip_id).filter(Boolean))]
  for (const id of tripIds) {
    const trip = tripOf(ws, id)
    if (trip?.state === 'issue') await act(ctx, randomUUID(), id, trip.revision, 'resolve', 'เก็บกวาดข้อมูลทดสอบการแข่งกัน')
  }
  ws = await workspace(ctx)
  for (const id of tripIds) {
    const trip = tripOf(ws, id)
    if (trip?.state === 'confirmed') await act(ctx, randomUUID(), id, trip.revision, 'release', 'เก็บกวาดข้อมูลทดสอบการแข่งกัน')
  }
  ws = await workspace(ctx)
  let cancelled = 0
  for (const booking of mine(ws)) {
    if (booking.status !== 'submitted') continue
    const out = await act(ctx, randomUUID(), booking.id, booking.revision, 'cancel', 'เก็บกวาดข้อมูลทดสอบการแข่งกัน')
    if (out.ok) cancelled += 1
  }
  ws = await workspace(ctx)
  const leftover = mine(ws).filter(booking => ['submitted', 'confirmed'].includes(booking.status))
  return { total: mine(ws).length, cancelled, leftover: leftover.length }
}

async function main() {
  const env = await supabaseEnv()
  const ctx = { env }

  await step('ตั้งต้น: session ของแอดมินและประชาชนทดสอบบน demo + หน่วยงานคือ demo เท่านั้น', async () => {
    ctx.admin = await sessionOf('admin')
    ctx.citizen = await sessionOf('citizen')
    const response = await fetch(`${env.url}/rest/v1/municipalities?slug=eq.${DEMO_SLUG}&select=id,slug`, { headers: { apikey: env.key, Authorization: `Bearer ${env.key}` }, signal: AbortSignal.timeout(30_000) })
    const rows = response.ok ? await response.json() : []
    if (rows.length !== 1 || rows[0].slug !== DEMO_SLUG) throw new BlockedError('หา tenant demo ไม่พบ — ไม่เขียนข้อมูลที่อื่น')
    ctx.muni = rows[0].id
    ctx.info = await rpcOk(env, null, 'patient_booking_info', { p_muni: ctx.muni })
    assert.equal(ctx.info.enabled, true, 'demo ยังไม่เปิดรับจอง')
    assert(Array.isArray(ctx.info.routes) && ctx.info.routes.length > 0, 'demo ไม่มีเส้นทางให้จอง')
    const ws = await workspace(ctx)
    assert(ws?.settings && Array.isArray(ws.bookings), 'บัญชีแอดมินทดสอบเปิดพื้นที่จัดคิวของ demo ไม่ได้')
    return 'ต่อ demo ได้ · เปิดรับจอง · แอดมินเห็นพื้นที่จัดคิว'
  })
  if (!ctx.muni) return finish()

  if (CLEANUP_ONLY) {
    await step('เก็บกวาดรายการ [TEST] race ที่ค้าง', async () => {
      const out = await cleanup(ctx, null)
      assert.equal(out.leftover, 0, `ยังเหลือรายการค้างสถานะ รอยืนยัน/ยืนยันแล้ว ${out.leftover} รายการ`)
      return `รายการ [TEST] race ทั้งหมด ${out.total} · ยกเลิกเพิ่ม ${out.cancelled}`
    })
    return finish()
  }

  await step('ตรวจวันที่รถว่างพอสำหรับทดสอบ (โหมดซ้อมไม่เขียนอะไร)', async () => {
    ctx.days = await freeDays(ctx, 4)
    return `พบวันว่าง ${ctx.days.length} วัน`
  })
  if (!WRITE) {
    console.log('\nโหมดซ้อม: ยังไม่เขียนข้อมูล · ใส่ --write เพื่อรันจริง (เขียนรายการ "[TEST] race" บน demo แล้วเก็บกวาดท้ายรอบ)')
    return finish()
  }
  if (!ctx.days) return finish()

  const [dayRace, daySame, dayTabs, dayDup] = ctx.days
  try {
    // ── R1: ยืนยันรถ 2 คำขอที่ชนเวลากันพร้อมกัน ──
    await step('R1 ยืนยันรถ 2 คำขอที่ชนเวลากันพร้อมกัน → สำเร็จเที่ยวเดียว อีกใบถูกปฏิเสธ ไม่มีเที่ยวซ้อนทับ', async () => {
      const [a, b] = [randomUUID(), randomUUID()]
      assert((await submit(ctx, a, bookingBody(ctx, 'R1-A', 1, dayRace, '10:00'))).ok, 'ส่งคำขอ A ไม่สำเร็จ')
      assert((await submit(ctx, b, bookingBody(ctx, 'R1-B', 2, dayRace, '10:15'))).ok, 'ส่งคำขอ B ไม่สำเร็จ')
      const [planA, planB] = [await preview(ctx, [a]), await preview(ctx, [b])]
      assert.equal(planA.errors.length + planB.errors.length, 0, 'ก่อนยืนยัน ทั้งสองแผนต้องใช้ได้ (ยังไม่มีเที่ยวของใคร)')
      const outs = await Promise.all([confirm(ctx, randomUUID(), [a], planA), confirm(ctx, randomUUID(), [b], planB)])
      noServerFault(outs, 'ยืนยันชนกัน')
      exactlyOne(outs.map(out => out.ok), `ต้องยืนยันสำเร็จใบเดียว แต่ได้ ${outs.filter(out => out.ok).length} ใบ`)
      const ws = await workspace(ctx)
      const [ba, bb] = [bookingOf(ws, a), bookingOf(ws, b)]
      exactlyOne([ba.status === 'confirmed' && ba.trip_id, bb.status === 'confirmed' && bb.trip_id], 'ต้องมีคำขอที่ยืนยันแล้วใบเดียว')
      const loser = ba.status === 'confirmed' ? bb : ba
      assert.equal(loser.status, 'submitted', 'ใบที่แพ้ต้องกลับไปรอยืนยันรถ ไม่ถูกยกเลิกเงียบ ๆ')
      assert.equal(loser.trip_id, null, 'ใบที่แพ้ต้องไม่ผูกกับเที่ยว')
      const afterPlan = await preview(ctx, [loser.id])
      assert(afterPlan.errors.length > 0, 'หลังมีเที่ยวของอีกใบ แผนของใบที่แพ้ต้องบอกว่ารถไม่ว่าง')
      return `ปฏิเสธด้วยข้อความ: ${outs.find(out => !out.ok).message}`
    })

    // ── R2/R4/R5: คำขอเดียว เที่ยวเดียว ──
    let c = null
    await step('R2 กดยืนยันคำขอเดียวซ้ำพร้อมกันด้วยรหัสเที่ยวเดิม → สำเร็จทั้งคู่ ได้เที่ยวเดียวกัน', async () => {
      c = { booking: randomUUID(), trip: randomUUID() }
      assert((await submit(ctx, c.booking, bookingBody(ctx, 'R2-C', 3, daySame, '10:00'))).ok, 'ส่งคำขอ C ไม่สำเร็จ')
      const plan = await preview(ctx, [c.booking])
      const outs = await Promise.all([confirm(ctx, c.trip, [c.booking], plan), confirm(ctx, c.trip, [c.booking], plan)])
      noServerFault(outs, 'ยืนยันซ้ำรหัสเที่ยวเดิม')
      assert(outs.every(out => out.ok), `ยิงซ้ำด้วยรหัสเที่ยวเดิมต้องสำเร็จทั้งคู่ (idempotent): ${outs.map(out => out.message || 'ok').join(' | ')}`)
      assert.equal(outs[0].value, outs[1].value, 'ต้องได้รหัสเที่ยวเดียวกัน')
      const ws = await workspace(ctx)
      assert.equal(ws.trips.filter(trip => (trip.booking_ids ?? []).includes(c.booking) && trip.state !== 'cancelled').length, 1, 'ต้องมีเที่ยวเดียวของคำขอนี้')
    })

    await step('R3 กดยืนยันคำขอเดียวพร้อมกันจาก 2 แท็บ (รหัสเที่ยวต่างกัน) → สำเร็จใบเดียว ไม่เกิด 2 เที่ยว', async () => {
      const d = randomUUID()
      assert((await submit(ctx, d, bookingBody(ctx, 'R3-D', 4, dayTabs, '10:00'))).ok, 'ส่งคำขอ D ไม่สำเร็จ')
      const plan = await preview(ctx, [d])
      const outs = await Promise.all([confirm(ctx, randomUUID(), [d], plan), confirm(ctx, randomUUID(), [d], plan)])
      noServerFault(outs, 'ยืนยันจาก 2 แท็บ')
      exactlyOne(outs.map(out => out.ok), `ต้องสำเร็จใบเดียว แต่ได้ ${outs.filter(out => out.ok).length} ใบ`)
      const ws = await workspace(ctx)
      assert.equal(ws.trips.filter(trip => (trip.booking_ids ?? []).includes(d) && trip.state !== 'cancelled').length, 1, 'ต้องมีเที่ยวเดียวของคำขอนี้')
      return `ปฏิเสธด้วยข้อความ: ${outs.find(out => !out.ok).message}`
    })

    await step('R4 สั่งเที่ยวเดียวกันพร้อมกัน (revision เดียวกัน คนละ op) → สำเร็จใบเดียว อีกใบถูกปฏิเสธว่าเที่ยวเปลี่ยนแล้ว', async () => {
      assert(c, 'ข้ามเพราะ R2 ไม่สำเร็จ')
      const before = tripOf(await workspace(ctx), c.trip)
      assert(before, 'ข้ามเพราะไม่พบเที่ยวจาก R2')
      const outs = await Promise.all([act(ctx, randomUUID(), c.trip, before.revision, 'issue', 'ทดสอบเหตุขัดข้อง'), act(ctx, randomUUID(), c.trip, before.revision, 'issue', 'ทดสอบเหตุขัดข้อง')])
      noServerFault(outs, 'สั่งเที่ยวพร้อมกัน')
      exactlyOne(outs.map(out => out.ok), `ต้องสำเร็จใบเดียว แต่ได้ ${outs.filter(out => out.ok).length} ใบ`)
      assert.match(outs.find(out => !out.ok).message, /เที่ยวเปลี่ยนแล้ว|ไม่พร้อม|ขัดข้อง/, 'ข้อความปฏิเสธต้องบอกว่าเที่ยวเปลี่ยนแล้ว')
      const after = tripOf(await workspace(ctx), c.trip)
      assert.equal(after.state, 'issue');assert.equal(after.revision, before.revision + 1, 'revision ต้องขึ้นเพียง 1')
    })

    await step('R5 ส่งคำสั่งเดิม (op เดียวกัน) ซ้ำพร้อมกัน → ผลเกิดครั้งเดียว ประวัติบรรทัดเดียว revision ขึ้น 1', async () => {
      assert(c, 'ข้ามเพราะ R2 ไม่สำเร็จ')
      const before = tripOf(await workspace(ctx), c.trip)
      assert(before, 'ข้ามเพราะไม่พบเที่ยวจาก R2')
      assert.equal(before.state, 'issue', 'ต้องอยู่สถานะเหตุขัดข้อง (ผลของ R4) ก่อนแก้ไข')
      const op = randomUUID()
      const outs = await Promise.all([act(ctx, op, c.trip, before.revision, 'resolve', 'ทดสอบแก้ไขแล้ว'), act(ctx, op, c.trip, before.revision, 'resolve', 'ทดสอบแก้ไขแล้ว')])
      noServerFault(outs, 'ส่ง op เดียวกันซ้ำ')
      assert(outs.every(out => out.ok), `op เดียวกันซ้ำต้องสำเร็จทั้งคู่ (ตอบผลเดิม): ${outs.map(out => out.message || 'ok').join(' | ')}`)
      const after = tripOf(await workspace(ctx), c.trip)
      assert.equal(after.state, 'confirmed', 'แก้เหตุขัดข้องแล้วต้องกลับสถานะเดิม');assert.equal(after.revision, before.revision + 1, 'ผลต้องเกิดครั้งเดียว revision ขึ้น 1 ไม่ใช่ 2')
      const resolved = (await history(ctx, c.booking)).filter(event => event.action === 'resolve')
      assert.equal(resolved.length, 1, `ประวัติ "resolve" ต้องมีบรรทัดเดียว แต่มี ${resolved.length}`)
      // ระดับคำขอ: ขอยกเลิกด้วย op เดียวกันซ้ำพร้อมกัน → cancel_requested ตั้งครั้งเดียว revision ของคำขอขึ้น 1
      const booking = bookingOf(await workspace(ctx), c.booking)
      const cancelOp = randomUUID()
      const cancels = await Promise.all([act(ctx, cancelOp, c.booking, booking.revision, 'cancel', 'ทดสอบขอยกเลิก'), act(ctx, cancelOp, c.booking, booking.revision, 'cancel', 'ทดสอบขอยกเลิก')])
      noServerFault(cancels, 'ขอยกเลิก op เดียวกันซ้ำ')
      assert(cancels.every(out => out.ok), `ขอยกเลิก op เดียวกันซ้ำต้องสำเร็จทั้งคู่: ${cancels.map(out => out.message || 'ok').join(' | ')}`)
      const afterCancel = bookingOf(await workspace(ctx), c.booking)
      assert.equal(afterCancel.cancel_requested, true);assert.equal(afterCancel.revision, booking.revision + 1, 'revision ของคำขอต้องขึ้น 1')
      assert.equal((await history(ctx, c.booking)).filter(event => event.action === 'cancel').length, 1, 'ประวัติ "cancel" ต้องมีบรรทัดเดียว')
    })

    // ── R6: ส่งคำขอจองซ้ำพร้อมกัน (ตัวกันซ้ำของ patient_booking_submit) ──
    await step('R6 ส่งคำขอจองซ้ำ (ข้อมูลเหมือนกันทุกช่อง คนละรหัส) พร้อมกัน → ตัวกันซ้ำต้องกันได้ สำเร็จใบเดียว', async () => {
      const body = bookingBody(ctx, 'R6-DUP', 5, dayDup, '09:00')
      const outs = await Promise.all([submit(ctx, randomUUID(), body), submit(ctx, randomUUID(), body)])
      noServerFault(outs, 'ส่งคำขอซ้ำพร้อมกัน')
      const ok = outs.filter(out => out.ok).length
      const ws = await workspace(ctx)
      const stored = ws.bookings.filter(booking => booking.patient_name === body.patient_name && ['submitted', 'confirmed'].includes(booking.status)).length
      assert.equal(stored, 1, `ต้องมีคำขอเดียวในคิว แต่ส่งสำเร็จ ${ok} ใบ และมีในคิว ${stored} ใบ — ตัวกันซ้ำยังชนกันได้เมื่อส่งพร้อมกัน`)
    })
  } finally {
    await step('เก็บกวาด: คืนเที่ยวที่ยังไม่ออกรถ + ยกเลิกคำขอ [TEST] race ของรอบนี้ (ไม่ลบแถวใด ๆ)', async () => {
      const out = await cleanup(ctx, RUN_TAG)
      assert.equal(out.leftover, 0, `ยังเหลือรายการค้างสถานะ รอยืนยัน/ยืนยันแล้ว ${out.leftover} รายการ — รัน --cleanup`)
      return `รายการของรอบนี้ ${out.total} รายการ ถูกยกเลิกแล้วทั้งหมด (แถวยังอยู่ในตาราง ติดป้าย ${TEST_PREFIX} … ${RUN_TAG})`
    })
  }
  return finish()
}

function finish() {
  const failed = results.filter(result => !result.ok)
  console.log(`\nสรุป: ผ่าน ${results.length - failed.length} / ${results.length}${failed.length ? ` · ไม่ผ่าน: ${failed.map(result => result.name.split(' ')[0]).join(', ')}` : ''}`)
  process.exitCode = failed.length ? 1 : 0
}

main().catch(error => {
  console.error(error instanceof BlockedError ? `BLOCKED: ${error.message}` : `ERROR: ${String(error.message).split('\n')[0]}`)
  process.exitCode = 2
})

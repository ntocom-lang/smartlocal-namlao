// Real PostgREST concurrency with two existing TEST accounts. No service-role key.
// Default: read-only preflight. --write: temporarily configure DEMO only, cancel
// this run's exact booking IDs, and restore its rules using revision CAS.
// PT_PROFILE_ROOT selects LOCAL Chrome TEST profiles; tokens stay in memory.
// Run from the isolated worktree. Never copy profiles or session data to cloud.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile, access } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { isDeepStrictEqual } from 'node:util'
import { chromium } from 'playwright'
import { BlockedError, safeEvaluate, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const DEMO = 'https://demo.rk-networks.com'
const cleanupIndex = process.argv.indexOf('--cleanup')
const CLEANUP = cleanupIndex >= 0
const WRITE = process.argv.includes('--write') || CLEANUP
const PROFILE_ROOT = process.env.PT_PROFILE_ROOT || path.resolve('.chrome-test-profiles')
const OUT = path.resolve(process.env.COMMUNITY_ACTIVATION_EVIDENCE || path.join(os.tmpdir(), 'smartlocal-community-activation'))
let TAG = randomUUID().slice(0, 8)
let PREFIX = `[TEST] community race ${TAG}`
const profiles = (process.env.PT_RACE_PROFILES || 'admin,officer,superadmin').split(',')
assert(profiles.every(p => /^[a-z0-9-]+$/.test(p)), 'Invalid TEST profile alias')
const report = { tag: TAG, mode: WRITE ? 'write' : 'read-only', tenant: 'demo', accounts: [], tests: [], bookingIds: [], tripIds: [] }
const created = new Set()
const tripIds = new Set()
let ctx
let journalWrites = Promise.resolve()

async function checkpoint() {
  report.bookingIds = [...created]; report.tripIds = [...tripIds]
  if (ctx?.changedRules) report.recovery = { muni: ctx.muni, originalPolicy: ctx.originalPolicy, originalRevision: ctx.originalRevision,
    testPolicy: ctx.testPolicy, testRevision: ctx.testRevision, changedRules: true }
  await mkdir(OUT, { recursive: true })
  if (report.recovery) report.recovery.changedRules = !!ctx?.changedRules
  const contents = JSON.stringify(report, null, 2) + '\n'
  journalWrites = journalWrites.then(() => writeFile(path.join(OUT, `demo-race-${TAG}.json`), contents))
  await journalWrites
}

function record(name, details = {}) {
  report.tests.push({ name, passed: true, ...details })
  console.log(`PASS ${name}`)
}
function policy(rules) {
  return Object.fromEntries(['enabled', 'window_start', 'window_end', 'places', 'activities', 'rules_reference'].map(key => [key, rules[key]]))
}
const same = isDeepStrictEqual
const date = n => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(Date.now() + n * 86400000))
const clock = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
const at = (day, n) => `${day}T${clock(n)}:00+07:00`

async function session(alias) {
  const dir = path.join(PROFILE_ROOT, `TEST-${alias}`)
  const interactive = process.env.PT_INTERACTIVE_PROFILE === alias
  try { await access(dir) } catch { throw new BlockedError(`Missing TEST-${alias}`) }
  let browser
  try { browser = await chromium.launchPersistentContext(dir, { channel: 'chrome', headless: !interactive, viewport: { width: 1280, height: 900 } }) }
  catch { throw new BlockedError(`Close Chrome TEST-${alias} before retrying`) }
  try {
    const page = browser.pages()[0] || await browser.newPage()
    const resolution = trackProfileResolution(page)
    await page.goto(DEMO, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await waitForSettled(page, resolution)
    const read = () => safeEvaluate(page, () => {
      const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (!key) return null
      try {
        const value = JSON.parse(localStorage.getItem(key))
        return { token: value.access_token, expires: value.expires_at, id: value.user?.id }
      } catch { return null }
    })
    let value = await read()
    for (let i = 0; i < 2 && (!value?.token || value.expires - Date.now() / 1000 < 300); i++) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(6000)
      value = await read()
    }
    if (interactive && (!value?.token || value.expires - Date.now() / 1000 < 300)) {
      console.log(`LOGIN TEST-${alias}: sign in on Demo in the visible Chrome window (no password/token input to this script)`)
      await page.goto(`${DEMO}/auth`, { waitUntil: 'domcontentloaded' })
      const deadline = Date.now() + Number(process.env.PT_LOGIN_WAIT_MS || 300000)
      while (Date.now() < deadline && (!value?.token || value.expires - Date.now() / 1000 < 300)) {
        await page.waitForTimeout(1000)
        value = await read()
      }
    }
    if (!value?.token || !value.id || value.expires - Date.now() / 1000 < 300) throw new BlockedError(`TEST-${alias} needs a fresh Demo login`)
    return { ...value, alias }
  } finally { await browser.close() }
}

async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(45000) })
}
async function assertDemo() {
  const response = await request(`${ctx.api}/rest/v1/municipalities?id=eq.${ctx.muni}&slug=eq.demo&select=id,slug`, { headers: ctx.publicHeaders })
  assert.equal(response.status, 200, 'Cannot verify Demo tenant')
  const rows = await response.json()
  assert.equal(rows.length, 1, 'Refuse writes outside Demo')
  assert.equal(rows[0].slug, 'demo')
  assert.equal(rows[0].id, ctx.muni)
}
async function rpc(actor, name, args, write = false) {
  if (write) {
    assert(WRITE, 'Write flag is required')
    assert.equal(args.p_muni, ctx.muni, 'Refuse mismatched tenant')
    await assertDemo()
    // Durable ID/config journal before any HTTP write, including lost responses.
    await checkpoint()
  }
  const start = performance.now()
  const response = await request(`${ctx.api}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { ...ctx.publicHeaders, Authorization: `Bearer ${actor?.token || ctx.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  const data = await response.json()
  return { ok: response.ok, status: response.status, value: response.ok ? data : null, message: response.ok ? '' : String(data.message || 'RPC rejected').slice(0, 240), start, end: performance.now() }
}
async function ok(actor, name, args, write = false) {
  const out = await rpc(actor, name, args, write)
  if (!out.ok) throw new Error(`${name}: ${out.status} ${out.message}`)
  return out.value
}
const ws = () => ok(ctx.admin, 'patient_booking_workspace', { p_muni: ctx.muni })
const preview = (actor, ids) => ok(actor, 'patient_booking_preview', { p_muni: ctx.muni, p_ids: ids, p_helper: '' })
const confirm = (actor, id, ids, plan) => rpc(actor, 'patient_booking_confirm', { p_muni: ctx.muni, p_id: id, p_ids: ids, p_expected: plan, p_helper: '' }, true)
const action = (entity, revision, name) => ok(ctx.admin, 'patient_booking_action', { p_muni: ctx.muni, p_op: randomUUID(), p_entity: entity, p_revision: revision, p_action: name, p_note: `${PREFIX} cleanup` }, true)

async function createBooking(service, day, suffix, n) {
  const id = randomUUID()
  // Track before HTTP: a lost response can still have committed the request.
  created.add(id)
  const contact = { requester_name: `${PREFIX} contact`, phone: `080000${String(n).padStart(4, '0')}`, pickup: `${PREFIX} pickup`, in_area: true,
    appointment_at: at(day, ctx.appointment), return_mode: 'one_way', return_at: null, consent: true, owner_name: ctx.info.owner_name }
  const community = ctx.info.community
  const args = service === 'community'
    ? { p_muni: ctx.muni, p_id: id, p_staff: true, p_data: { ...contact, group_label: `${PREFIX} ${suffix}`, party_size: 1,
      purpose_code: ctx.testPolicy.activities[0].code, route_id: ctx.testPolicy.places[0].id,
      rules_version: community.rules_version, consent_version: community.consent_version, privacy_notice: community.privacy_notice } }
    : { p_muni: ctx.muni, p_id: id, p_staff_entry: true, p_data: { ...contact, patient_name: `${PREFIX} ${suffix}`, relation: 'self', route_id: ctx.info.routes[0].id,
      mobility: 'walk', companions: 0, share: false, is_emergency: false, consent_version: ctx.info.consent_version, privacy_notice: ctx.info.privacy_notice } }
  await ok(ctx.admin, service === 'community' ? 'patient_booking_submit_community' : 'patient_booking_submit', args, true)
  return id
}
function raceEvidence(outs) {
  assert(outs.every(o => o.ok || o.status < 500), 'Server fault rather than a scheduling rejection')
  // Concurrent HTTP lifetimes, not a claim that PostgreSQL lock wait was observed.
  assert(Math.max(...outs.map(o => o.start)) < Math.min(...outs.map(o => o.end)), 'HTTP calls did not overlap; concurrency gate remains unproven')
  return { httpOverlap: true, outcomes: outs.map(o => ({ status: o.status, ok: o.ok, durationMs: Math.round(o.end - o.start), error: o.message })) }
}

async function cleanup() {
  let work = await ws()
  for (const booking of work.bookings.filter(b => created.has(b.id))) if (booking.trip_id) tripIds.add(booking.trip_id)
  for (const booking of work.bookings.filter(b => created.has(b.id))) {
    assert(String(booking.service_type === 'community' ? booking.group_label : booking.patient_name).startsWith(PREFIX), 'Refuse cleanup of IDs not labelled for this run')
  }
  for (const id of tripIds) {
    const trip = work.trips.find(t => t.id === id)
    if (!trip) continue
    const members = trip.booking_ids || work.bookings.filter(b => b.trip_id === id).map(b => b.id)
    assert(members.length && members.every(id => created.has(id)), 'Refuse cleanup of another session’s trip')
    if (trip.state === 'issue') { await action(id, trip.revision, 'resolve'); work = await ws() }
    const current = work.trips.find(t => t.id === id)
    if (current.state === 'confirmed') { await action(id, current.revision, 'release'); work = await ws() }
    else assert.equal(current.state, 'cancelled', 'Do not modify trips that have departed')
  }
  work = await ws()
  for (const booking of work.bookings.filter(b => created.has(b.id) && b.status === 'submitted')) await action(booking.id, booking.revision, 'cancel')
  work = await ws()
  assert.equal(work.bookings.filter(b => created.has(b.id) && ['submitted', 'confirmed'].includes(b.status)).length, 0, 'Test bookings remain active')
  assert.equal(work.trips.filter(t => tripIds.has(t.id) && t.state !== 'cancelled').length, 0, 'Test trips remain active')
  record('Cleanup exact run IDs; no active test booking/trip remains', { bookings: created.size, trips: tripIds.size })
}
async function restore() {
  if (!ctx.changedRules) return
  const current = (await ws()).community_rules
  if (same(policy(current), ctx.originalPolicy) && current.revision === ctx.originalRevision) {
    record('Rules write did not commit; original Demo policy retained')
    ctx.changedRules = false; report.recoveryComplete = true
    return
  }
  // Do not overwrite concurrent edits, even when only a timestamp/revision changed.
  assert.equal(current.revision, ctx.testRevision, 'Rules changed in another session: refuse to overwrite them')
  assert(same(policy(current), ctx.testPolicy), 'Rules no longer belong to this test run')
  await ok(ctx.admin, 'patient_booking_save_community_rules', { p_muni: ctx.muni, p_revision: current.revision, p_data: ctx.originalPolicy }, true)
  const restored = (await ws()).community_rules
  assert(same(policy(restored), ctx.originalPolicy), 'Rules were not restored')
  record('Restore Demo policy by CAS; intake disabled again', { enabled: restored.enabled, rulesVersion: restored.rules_version, revision: restored.revision })
  ctx.changedRules = false
  report.recoveryComplete = true
}

async function main() {
  const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8')
  const api = worker.match(/const FALLBACK_SUPABASE_URL = '([^']+)'/)?.[1]
  const key = worker.match(/const FALLBACK_SUPABASE_KEY = '([^']+)'/)?.[1]
  assert(api && key, 'Public Supabase connection config missing')
  ctx = { api, key, publicHeaders: { apikey: key, Authorization: `Bearer ${key}` } }
  const response = await request(`${api}/rest/v1/municipalities?slug=eq.demo&select=id,slug`, { headers: ctx.publicHeaders })
  assert.equal(response.status, 200)
  const rows = await response.json()
  assert.equal(rows.length, 1); assert.equal(rows[0].slug, 'demo'); ctx.muni = rows[0].id
  if (CLEANUP) {
    const journal = path.resolve(process.argv[cleanupIndex + 1] || '')
    assert.equal(path.dirname(journal), OUT, 'Recovery journal must be in the evidence directory')
    const previous = JSON.parse(await readFile(journal, 'utf8'))
    assert.equal(previous.tenant, 'demo'); assert(/^[a-f0-9]{8}$/.test(previous.tag))
    assert.equal(path.basename(journal), `demo-race-${previous.tag}.json`)
    assert.equal(previous.recovery?.muni, ctx.muni, 'Recovery journal has a different tenant')
    assert.equal(previous.recovery.originalPolicy.enabled, false, 'Recovery must return Demo intake to disabled')
    TAG = previous.tag; PREFIX = `[TEST] community race ${TAG}`
    assert(previous.recovery.testPolicy.rules_reference.startsWith(PREFIX), 'Recovery policy does not belong to this run')
    for (const ids of [previous.bookingIds, previous.tripIds]) assert(Array.isArray(ids) && ids.every(id => /^[0-9a-f-]{36}$/.test(id)), 'Invalid recovery IDs')
    previous.bookingIds.forEach(id => created.add(id)); previous.tripIds.forEach(id => tripIds.add(id))
    Object.assign(ctx, previous.recovery)
    Object.assign(report, previous, { mode: 'cleanup', tests: [] })
    const actor = await session('admin')
    const work = await ok(actor, 'patient_booking_workspace', { p_muni: ctx.muni })
    assert.equal(work.role, 'admin'); ctx.admin = actor
    try { await cleanup() } finally { await restore() }
    return
  }
  const actors = []
  for (const alias of profiles) {
    try {
      const actor = await session(alias)
      const work = await ok(actor, 'patient_booking_workspace', { p_muni: ctx.muni })
      report.accounts.push({ alias, role: work.role, usable: ['admin', 'coordinator'].includes(work.role) })
      console.log(`CHECK TEST-${alias}: ${work.role}`)
      if (['admin', 'coordinator'].includes(work.role) && !actors.some(a => a.id === actor.id)) actors.push({ ...actor, role: work.role })
    } catch (error) {
      report.accounts.push({ alias, usable: false, error: String(error.message).split('\n')[0] })
      console.log(`BLOCKED TEST-${alias}: ${String(error.message).split('\n')[0]}`)
    }
    if (actors.length >= 2 && actors.some(a => a.role === 'admin')) break
  }
  if (actors.length < 2 || !actors.some(a => a.role === 'admin')) throw new BlockedError('Two distinct authorized Demo TEST accounts are required; no role or account changes were made')
  ctx.admin = actors.find(a => a.role === 'admin')
  ctx.other = actors.find(a => a.id !== ctx.admin.id)
  const work = await ws()
  assert.equal(work.limited, false, 'Workspace truncated; cleanup cannot be verified')
  assert(work.settings?.enabled && work.settings.seats >= 1, 'Demo vehicle is not configured')
  ctx.originalPolicy = policy(work.community_rules)
  ctx.originalRevision = work.community_rules.revision
  assert.equal(ctx.originalPolicy.enabled, false, 'Do not interrupt an already enabled Demo service')
  ctx.info = await ok(null, 'patient_booking_info', { p_muni: ctx.muni })
  assert(ctx.info?.routes?.length, 'Demo patient route missing')
  ctx.appointment = Math.min(work.settings.office_end, Math.max(work.settings.office_start, 630))
  const calendar = await ok(null, 'patient_booking_calendar', { p_muni: ctx.muni, p_from: date(8), p_to: date(60) })
  const days = calendar.days.filter(d => d.status === 'open' && !(d.trips || []).length).map(d => d.date)
  assert(days.length >= 3, 'Need three currently empty Demo days')
  record('Two distinct authenticated Demo accounts with existing queue authority', { aliases: [ctx.admin.alias, ctx.other.alias], roles: [ctx.admin.role, ctx.other.role] })
  record('Demo disabled, configured vehicle and three free dates; no patient settings changes', { dates: days.slice(0, 3) })
  if (!WRITE) return

  ctx.testPolicy = { enabled: true, window_start: work.settings.office_start, window_end: work.settings.office_end,
    places: [{ id: `test_${TAG}`, label: `${PREFIX} activity centre`, minutes: ctx.info.routes[0].minutes }],
    activities: [{ code: `test_${TAG}`, label: `${PREFIX} simulated activity` }],
    rules_reference: `${PREFIX}: Demo scheduling test only; not approval of fund authority or production activation` }
  // Mark before HTTP so an ambiguous committed response is investigated in finally.
  ctx.changedRules = true
  ctx.testRevision = work.community_rules.revision + 1
  try {
    ctx.testRevision = await ok(ctx.admin, 'patient_booking_save_community_rules', { p_muni: ctx.muni, p_revision: work.community_rules.revision, p_data: ctx.testPolicy }, true)
    ctx.info = await ok(null, 'patient_booking_info', { p_muni: ctx.muni })
    assert.equal(ctx.info.community.enabled, true)
    for (let i = 0; i < 2; i++) {
      const [patient, community] = [await createBooking('patient', days[i], `R${i + 1} patient`, i * 2 + 1), await createBooking('community', days[i], `R${i + 1} community`, i * 2 + 2)]
      const actors = i === 0 ? [ctx.admin, ctx.other] : [ctx.other, ctx.admin]
      const plans = await Promise.all([preview(actors[0], [patient]), preview(actors[1], [community])])
      assert.deepEqual(plans[0].errors, []); assert.deepEqual(plans[1].errors, [])
      assert.equal(plans[0].service_type, 'patient'); assert.equal(plans[1].service_type, 'community')
      const trips = [randomUUID(), randomUUID()]; trips.forEach(id => tripIds.add(id))
      const outs = await Promise.all([confirm(actors[0], trips[0], [patient], plans[0]), confirm(actors[1], trips[1], [community], plans[1])])
      const evidence = raceEvidence(outs)
      assert.equal(outs.filter(o => o.ok).length, 1, 'Exactly one conflicting trip must win')
      assert.match(outs.find(o => !o.ok).message, /รถ|ชน|เปลี่ยน|แผน/, 'Loser must receive a scheduling rejection')
      const after = await ws()
      const bookings = [patient, community].map(id => after.bookings.find(b => b.id === id))
      assert.equal(bookings.filter(b => b.status === 'confirmed').length, 1)
      const loser = bookings.find(b => b.status !== 'confirmed')
      assert.equal(loser.status, 'submitted'); assert.equal(loser.trip_id, null)
      assert.equal(after.trips.filter(t => trips.includes(t.id) && t.state !== 'cancelled').length, 1)
      const blocked = await preview(ctx.admin, [loser.id])
      assert(blocked.errors.length > 0, 'Losing request must see vehicle conflict')
      const winner = outs.findIndex(o => o.ok)
      const history = await ok(ctx.admin, 'patient_booking_history', { p_muni: ctx.muni, p_booking: bookings[winner].id })
      assert.equal(after.trips.find(t => t.id === trips[winner]).confirmed_by, actors[winner].id, 'Stored trip must identify the actual winning account')
      assert.equal((history.events || []).filter(e => e.action === 'confirmed').length, 1, 'History must have one trip confirmation')
      record(`R${i + 1}: patient/community collide; reverse account assignment; one winner, loser pending`, { ...evidence, winnerService: bookings[winner].service_type, confirmedByWinningAccount: true })
    }
    const booking = await createBooking('community', days[2], 'R3 retry', 5)
    const plan = await preview(ctx.admin, [booking]); assert.deepEqual(plan.errors, [])
    const trip = randomUUID(); tripIds.add(trip)
    const outs = await Promise.all([confirm(ctx.admin, trip, [booking], plan), confirm(ctx.other, trip, [booking], plan)])
    const evidence = raceEvidence(outs)
    // Replay is bound to confirmed_by. A different account cannot claim it as its own.
    assert.equal(outs.filter(o => o.ok).length, 1, 'A different account must not replay another account’s trip')
    assert.match(outs.find(o => !o.ok).message, /รหัสเที่ยวไม่ถูกต้อง/)
    const winner = outs[0].ok ? ctx.admin : ctx.other
    const replay = await confirm(winner, trip, [booking], plan)
    assert.equal(replay.ok, true, 'Winning account must be able to retry safely')
    assert.equal(replay.value, outs.find(o => o.ok).value)
    const after = await ws()
    assert.equal(after.trips.filter(t => (t.booking_ids || []).includes(booking) && t.state !== 'cancelled').length, 1)
    record('R3: same community trip ID is actor-bound; winning account retries safely', evidence)
  } finally {
    try { await cleanup() } finally { await restore() }
  }
}

try { await main(); report.passed = true }
catch (error) {
  report.passed = false; report.error = String(error.message).split('\n')[0]
  console.error(`${error instanceof BlockedError ? 'BLOCKED' : 'FAIL'} ${report.error}`)
  process.exitCode = 1
} finally {
  await checkpoint()
}

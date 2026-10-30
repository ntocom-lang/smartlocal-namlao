// Telegram ส่วนตัว (ข้อ 3b ส่วนที่ 2 ตั้งค่าแจ้งเตือน) — ตัวส่ง sendDirectMessages ใน notify-telegram
// รันด้วย: node tests/telegram-dm.test.mjs
//
// โหลด edge function มารันใน Node แบบเดียวกับ telegram-notification-message.test.mjs แล้วแทนฐานข้อมูลด้วยของจำลอง
// คุม 4 เรื่องที่พังเงียบได้:
// (1) ส่งผิดคน — คนกดเอง / คนต่าง อปท. / คนที่ปิดหมวดนั้น / คนที่ไม่ได้ผูก ต้องไม่ได้รับ
// (2) ส่งซ้ำ — คนเดียวได้ครั้งเดียวต่อเรื่อง (กิจกรรมแก้รายชื่อกี่รอบก็ตาม)
// (3) ผู้ใช้บล็อกบอต (403) ต้องเลิกผูกเอง ไม่งั้นทุกเรื่องยิงซ้ำไปที่แชทตาย
// (4) ⚠️ PDPA — เรื่องลับไม่บอกหมวด/สถานที่แม้เป็นแชทส่วนตัว · ข้อความลงนามไม่มีชื่อคนและปลายทาง
// (5) คำร้องทางหลัก — ระบบรับเรื่องเอง/สายเฉพาะกิจ/แอดมินกดรับเรื่อง ต้องได้ข้อความ โดยไม่ทำข้อความเข้ากลุ่มพัง
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ASSIGNMENT_TASKS } from '../src/lib/eventAssignment.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
const source = read('supabase/functions/notify-telegram/index.ts')

// ── ตัวส่ง Telegram จำลอง: จดทุกข้อความ · ตั้งให้ตอบ 403 รายแชทได้ ────────────────────────────────
const sent = []
const blockedChats = new Set()
globalThis.__sendTelegram = async (chatId, text) => {
  if (blockedChats.has(chatId)) return { ok: false, attempts: 1, error: 'Forbidden: bot was blocked by the user', status: 403 }
  sent.push({ chatId, text })
  return { ok: true, attempts: 1, messageId: sent.length }
}

const work = mkdtempSync(path.join(tmpdir(), 'telegram-dm-'))
let mod
try {
  const stubbed = source
    .replace(/^import \{ serve \}.*$/m, 'const serve = (handler: unknown) => { (globalThis as any).__handler = handler }')
    .replace(/^import \{ createClient \}.*$/m, 'const createClient = (_url: string, key: string) => (globalThis as any).__createClient(key)')
    .replace(/^import \{ sendTelegramMessage.*$/m,
      'const sendTelegramMessage = (chatId: string, text: string) => (globalThis as any).__sendTelegram(chatId, text)\n'
      + 'type TelegramSendResult = { ok: boolean; attempts: number; error?: string; status?: number; messageId?: unknown }')
  const probe = path.join(work, 'probe.mts')
  writeFileSync(probe, `${stubbed}\nexport {\n`
    + '  sendDirectMessages, buildComplaintAssignedDm, buildEventAssignedDm, buildEsignTurnDm,\n'
    + '  eventIsPast, notificationMatchesResource, DM_CATEGORY, EVENT_TASK_LABEL,\n}\n')
  const ENV = { TELEGRAM_BOT_TOKEN: 'test-token', SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key' }
  globalThis.Deno = { env: { get: (key) => ENV[key] ?? '' } }
  mod = await import(pathToFileURL(probe).href)
} finally {
  rmSync(work, { recursive: true, force: true })
}
const {
  sendDirectMessages, buildComplaintAssignedDm, buildEventAssignedDm, buildEsignTurnDm,
  eventIsPast, notificationMatchesResource, DM_CATEGORY, EVENT_TASK_LABEL,
} = mod

// ── ฐานข้อมูลจำลอง: รองรับเฉพาะรูปคำสั่งที่ sendDirectMessages/claimDelivery ใช้ ─────────────────────────
const MUNI = '11111111-1111-4111-8111-111111111111'
const OTHER_MUNI = '22222222-2222-4222-8222-222222222222'
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ADMIN = uid(1)
const TECH = uid(2)
const CLERK = uid(3)
const OUTSIDER = uid(4)
const UNLINKED = uid(5)

function fakeDb({ links, profiles, assignments = [], turns = [], complaints = [], municipalities = [], brokenTables = [] }) {
  const state = { links: links.map((l) => ({ ...l })), deliveries: [], deleted: [] }
  const rows = {
    telegram_user_links: () => state.links,
    profiles: () => profiles,
    event_assignments: () => assignments,
    notification_deliveries: () => state.deliveries,
    complaints: () => complaints,
    municipalities: () => municipalities,
  }
  function builder(table) {
    const q = { table, op: 'select', filters: [], values: null }
    const run = () => {
      if (brokenTables.includes(table)) return { data: null, error: { message: `${table} is down` } }
      const badId = q.filters.find(([kind, , val]) => kind === 'in' && val.some((v) => !/^[0-9a-f-]{36}$/.test(String(v))))
      if (badId) return { data: null, error: { message: 'invalid input syntax for type uuid' } }
      const match = (row) => q.filters.every(([kind, col, val]) =>
        kind === 'eq' ? row[col] === val : kind === 'in' ? val.includes(row[col]) : row[col] != null)
      if (q.op === 'insert') {
        const dup = state.deliveries.find((d) => d.municipality_id === q.values.municipality_id
          && d.channel === q.values.channel && d.idempotency_key === q.values.idempotency_key)
        if (dup) return { data: null, error: { code: '23505' } }
        const row = { id: uid(900 + state.deliveries.length), attempt_count: 0, ...q.values }
        state.deliveries.push(row)
        return { data: row, error: null }
      }
      if (q.op === 'update') {
        for (const row of state.deliveries.filter(match)) Object.assign(row, q.values)
        return { data: null, error: null }
      }
      if (q.op === 'delete') {
        const gone = state.links.filter(match)
        state.deleted.push(...gone)
        state.links = state.links.filter((row) => !match(row))
        return { data: null, error: null }
      }
      return { data: rows[table]().filter(match), error: null }
    }
    const chain = {
      select: () => chain,
      insert: (values) => { q.op = 'insert'; q.values = values; return chain },
      update: (values) => { q.op = 'update'; q.values = values; return chain },
      delete: () => { q.op = 'delete'; return chain },
      eq: (col, val) => { q.filters.push(['eq', col, val]); return chain },
      in: (col, val) => { q.filters.push(['in', col, val]); return chain },
      not: (col) => { q.filters.push(['notnull', col]); return chain },
      maybeSingle: async () => {
        const { data, error } = run()
        return { data: Array.isArray(data) ? data[0] ?? null : data, error }
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    }
    return chain
  }
  return {
    state,
    from: builder,
    rpc: async (name, args) => {
      assert.equal(name, 'esign_trip_turns')
      assert.ok(args.p_trip_id)
      return { data: turns, error: null }
    },
  }
}

const staff = (id, role = 'technician', municipality_id = MUNI) => ({ id, role, municipality_id })
const PROFILES = [staff(ADMIN, 'admin'), staff(TECH), staff(CLERK, 'staff'), staff(OUTSIDER, 'staff', OTHER_MUNI), staff(UNLINKED)]
const LINKS = [
  { user_id: ADMIN, chat_id: 1001, dm_muted: [] },
  { user_id: TECH, chat_id: 1002, dm_muted: [] },
  { user_id: CLERK, chat_id: 1003, dm_muted: ['event'] },
  { user_id: OUTSIDER, chat_id: 1004, dm_muted: [] },
]
const body = async (response) => ({ status: response.status, ...(await response.json()) })
const reset = () => { sent.length = 0; blockedChats.clear() }

const complaint = {
  id: uid(100), municipality_id: MUNI, status: 'received', category: 'road', assigned_to: TECH,
  ref_no: 'ES-69-0100', village: 'หมู่ 3 บ้านน้ำเลา', due_date: '2026-11-05',
  department: { name: 'กองช่าง', color: 'orange' }, category_ref: { label: 'ถนนชำรุด', emoji: '🛣️' },
}

// ── (1) คำร้องมอบหมาย: ส่งถึงผู้รับผิดชอบคนเดียว ครั้งเดียว ────────────────────────────────────────────
{
  reset()
  const db = fakeDb({ links: LINKS, profiles: PROFILES })
  const res = await body(await sendDirectMessages(db, 'complaint_assigned_dm', 'complaint', complaint, ADMIN))
  assert.deepEqual([res.status, res.sent, res.failed], [200, 1, 0])
  assert.equal(sent.length, 1)
  assert.equal(sent[0].chatId, '1002')
  assert.match(sent[0].text, /มีคำร้องมอบหมายให้คุณ/)
  assert.match(sent[0].text, /ES-69-0100/)
  assert.match(sent[0].text, /กำหนดเสร็จ: <b>.*2569/, 'วันกำหนดเสร็จเป็นปี พ.ศ.')
  const [delivery] = db.state.deliveries
  assert.equal(delivery.channel, 'telegram_dm')
  assert.equal(delivery.status, 'sent')
  assert.equal(delivery.idempotency_key, `complaint_assigned_dm:${complaint.id}:${TECH}`)
  assert.equal(delivery.requested_by, ADMIN)

  // กดซ้ำ (มอบหมายคนเดิมอีกรอบ) → ไม่ส่งซ้ำ
  const again = await body(await sendDirectMessages(db, 'complaint_assigned_dm', 'complaint', complaint, ADMIN))
  assert.deepEqual([again.sent, again.duplicate], [0, 1])
  assert.equal(sent.length, 1)
}

// มอบหมายให้ตัวเอง → ไม่ต้องแจ้ง
{
  reset()
  const db = fakeDb({ links: LINKS, profiles: PROFILES })
  const res = await body(await sendDirectMessages(db, 'complaint_assigned_dm', 'complaint', complaint, TECH))
  assert.equal(res.reason, 'no_recipient')
  assert.equal(sent.length, 0)
}

// ไม่ได้ผูก / ต่าง อปท. / ปิดหมวด → ข้ามเงียบๆ ไม่สร้างแถวบันทึก
for (const [assignee, label] of [[UNLINKED, 'ไม่ได้ผูก'], [OUTSIDER, 'ต่าง อปท.']]) {
  reset()
  const db = fakeDb({ links: LINKS, profiles: PROFILES })
  const res = await body(await sendDirectMessages(db, 'complaint_assigned_dm', 'complaint', { ...complaint, assigned_to: assignee }, ADMIN))
  assert.equal(res.reason, 'not_linked', label)
  assert.equal(sent.length, 0, label)
  assert.equal(db.state.deliveries.length, 0, label)
}
{
  reset()
  const db = fakeDb({ links: LINKS.map((l) => (l.user_id === TECH ? { ...l, dm_muted: ['complaint'] } : l)), profiles: PROFILES })
  const res = await body(await sendDirectMessages(db, 'complaint_assigned_dm', 'complaint', complaint, ADMIN))
  assert.equal(res.reason, 'not_linked', 'ปิดหมวดคำร้อง')
  assert.equal(sent.length, 0)
}

// ── (3) ผู้ใช้บล็อกบอต → เลิกผูกเอง + บันทึก failed ────────────────────────────────────────────────
{
  reset()
  blockedChats.add('1002')
  const db = fakeDb({ links: LINKS, profiles: PROFILES })
  const res = await body(await sendDirectMessages(db, 'complaint_assigned_dm', 'complaint', complaint, ADMIN))
  assert.deepEqual([res.sent, res.failed], [0, 1])
  assert.deepEqual(db.state.deleted.map((l) => l.user_id), [TECH])
  assert.equal(db.state.links.some((l) => l.user_id === TECH), false)
  assert.equal(db.state.deliveries[0].status, 'failed')
  assert.match(db.state.deliveries[0].last_error, /blocked/)
}

// ── (4) เรื่องลับ: ไม่มีหมวด/สถานที่/กอง ───────────────────────────────────────────────────────────
{
  const text = buildComplaintAssignedDm({ ...complaint, category: 'corruption', category_ref: { label: 'แจ้งการทุจริต', emoji: '⚖️' } })
  assert.match(text, /เรื่องลับ/)
  assert.match(text, /ES-69-0100/)
  for (const leak of ['ทุจริต', 'หมู่ 3', 'กองช่าง', 'ประเภท', 'สถานที่']) assert.equal(text.includes(leak), false, `เรื่องลับห้ามมี '${leak}'`)
}

// ── (2) กิจกรรม: ทุกคนที่ผูกและไม่ได้ปิดหมวด · ไม่ส่งคนกด · คนละครั้งต่อกิจกรรม ──────────────────────────────
const event = {
  id: uid(200), municipality_id: MUNI, title: 'ประชุมประจำเดือน', event_date: '2099-01-10', end_date: null,
  event_time: '09:00', end_time: '12:00', location: 'ห้องประชุมสภา', is_all_day: false,
}
const assignments = [
  { profile_id: TECH, task: 'attend' },
  { profile_id: CLERK, task: 'join' }, // ปิดหมวดกิจกรรมไว้
  { profile_id: ADMIN, task: 'preside' }, // คนกดเอง
  { profile_id: UNLINKED, task: 'join' },
  { profile_id: null, task: 'join' }, // พิมพ์ชื่อเอง ไม่มีบัญชี
  { profile_id: TECH, task: 'join', event_id: uid(201) }, // คนละกิจกรรม — ถ้าไม่กรอง event_id จะนับเป็นซ้ำ
].map((row) => ({ event_id: event.id, ...row }))
{
  reset()
  const db = fakeDb({ links: LINKS, profiles: PROFILES, assignments })
  const res = await body(await sendDirectMessages(db, 'event_assigned_dm', 'event', event, ADMIN))
  assert.deepEqual([res.sent, res.failed, res.duplicate], [1, 0, 0])
  assert.deepEqual(sent.map((m) => m.chatId), ['1002'])
  assert.match(sent[0].text, /มีกิจกรรมมอบหมายให้คุณ/)
  assert.match(sent[0].text, /หน้าที่: <b>ไปประชุมแทน<\/b>/)
  assert.match(sent[0].text, /09:00 – 12:00 น\./)
  assert.match(sent[0].text, /ห้องประชุมสภา/)
  // แก้รายชื่อแล้วบันทึกอีกรอบ → คนเดิมไม่ได้ซ้ำ
  await sendDirectMessages(db, 'event_assigned_dm', 'event', event, ADMIN)
  assert.equal(sent.length, 1)
}
{
  reset()
  const db = fakeDb({ links: LINKS, profiles: PROFILES, assignments })
  const res = await body(await sendDirectMessages(db, 'event_assigned_dm', 'event', { ...event, event_date: '2000-01-01' }, ADMIN))
  assert.equal(res.reason, 'no_recipient', 'กิจกรรมที่ผ่านไปแล้วไม่ส่ง')
  assert.equal(sent.length, 0)
}
const now = new Date('2026-10-30T10:00:00+07:00')
assert.equal(eventIsPast({ event_date: '2026-10-29' }, now), true)
assert.equal(eventIsPast({ event_date: '2026-10-30' }, now), false, 'วันนี้ยังไม่ผ่าน')
assert.equal(eventIsPast({ event_date: '2026-10-28', end_date: '2026-10-31' }, now), false, 'หลายวัน นับวันสุดท้าย')
assert.equal(eventIsPast({ event_date: 'bad' }, now), false)

// ── ถึงคิวลงนาม: ผู้รับมาจาก esign_trip_turns · คีย์แยกรายช่อง ──────────────────────────────────────────
const trip = {
  id: uid(300), municipality_id: MUNI, status: 'approved', destination: 'ศาลากลางจังหวัดแพร่',
  planned_departure: '2026-11-02T08:00:00+07:00', vehicle: { name: 'รถกระบะ', license_plate: 'กข 1234' },
  department: { name: 'สำนักปลัด', color: 'blue' },
}
{
  reset()
  const turns = [
    { slot: 'dept_head', label: 'หัวหน้าส่วนราชการ', user_id: CLERK },
    { slot: 'sk1', label: 'สก.๑', user_id: TECH },
  ]
  const db = fakeDb({ links: LINKS, profiles: PROFILES, turns })
  const res = await body(await sendDirectMessages(db, 'esign_turn_dm', 'esign', trip, ADMIN))
  assert.equal(res.sent, 2, 'ปิดหมวดกิจกรรมไม่กระทบหมวดลงนาม')
  assert.match(sent[0].text, /ถึงคิวลงนามใบขอใช้รถ/)
  assert.match(sent[0].text, /ช่อง: <b>หัวหน้าส่วนราชการ<\/b>/)
  assert.match(sent[0].text, /รถกระบะ \(กข 1234\)/)
  assert.deepEqual(db.state.deliveries.map((d) => d.idempotency_key).sort(), [
    `esign_turn_dm:${trip.id}:dept_head:${CLERK}`,
    `esign_turn_dm:${trip.id}:sk1:${TECH}`,
  ])
}
assert.equal(notificationMatchesResource('esign_turn_dm', { status: 'approved' }), true)
for (const status of ['rejected', 'cancelled', 'completed']) {
  assert.equal(notificationMatchesResource('esign_turn_dm', { status }), false, status)
}
assert.equal(notificationMatchesResource('complaint_assigned_dm', { assigned_to: null }), false)
assert.equal(notificationMatchesResource('complaint_assigned_dm', { assigned_to: TECH }), true)

// ── ข้อความไม่มีลิงก์ · escape HTML ───────────────────────────────────────────────────────────
{
  const texts = [
    buildComplaintAssignedDm(complaint),
    buildEventAssignedDm({ ...event, title: '<b>x</b> & y' }, 'join'),
    buildEsignTurnDm(trip, 'ผู้ขอ'),
  ]
  for (const text of texts) assert.equal(/https?:\/\//.test(text), false, 'ห้ามมีลิงก์เข้าระบบ')
  assert.match(texts[1], /&lt;b&gt;x&lt;\/b&gt; &amp; y/)
}

// ── คีย์หมวดตรงกัน 3 ที่: edge function · หน้าเว็บ · CHECK ใน migration ──────────────────────────────
{
  const edge = [...new Set(Object.values(DM_CATEGORY))].sort()
  const web = [...read('src/lib/telegramLink.js').match(/TELEGRAM_DM_CATEGORIES = Object\.freeze\(\[([\s\S]*?)\]\)/)[1]
    .matchAll(/key: '(\w+)'/g)].map((m) => m[1]).sort()
  const migration = read('supabase/migrations/20261030100000_telegram_dm_columns.sql')
  const check = [...migration.match(/dm_muted <@ ARRAY\[([^\]]+)\]/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()
  const rpc = read('supabase/migrations/20261030100100_telegram_dm_functions.sql')
  const rpcKeys = [...rpc.match(/WHERE k IN \(([^)]+)\)/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(web, edge, 'TELEGRAM_DM_CATEGORIES ต้องตรงกับ DM_CATEGORY')
  assert.deepEqual(check, edge, 'CHECK dm_muted ต้องตรงกับ DM_CATEGORY')
  assert.deepEqual(rpcKeys, edge, 'set_my_telegram_dm_muted ต้องรับคีย์ชุดเดียวกัน')
  assert.deepEqual(EVENT_TASK_LABEL, Object.fromEntries(ASSIGNMENT_TASKS.map((t) => [t.value, t.label])), 'ป้ายหน้าที่ต้องตรงกับ ASSIGNMENT_TASKS')
}

// ── จุดเรียกฝั่งหน้าเว็บ: ยิงหลังบันทึกสำเร็จเท่านั้น ─────────────────────────────────────────────────
{
  const complaints = read('src/components/admin/ComplaintsManager.jsx')
  assert.match(complaints, /if \(!error\) \{\n\s+\/\/[^\n]*\n\s+if \(technicianId\) notifyTelegram\('complaint_assigned_dm', complaintId\)/)
  assert.match(read('src/lib/eventAssignmentApi.js'), /if \(!result\.error && people\.length\) notifyTelegram\('event_assigned_dm', eventId\)/)
  assert.match(read('src/lib/esignApi.js'), /if \(result\?\.ok\) notifyTelegram\('esign_turn_dm', tripId\)/)
  assert.match(read('src/components/fleet/FleetTrips.jsx'), /if \(!isEdit && saved\?\.esign_slots\) notifyTelegram\('esign_turn_dm', saved\.id\)/)
}

// ── ฟังก์ชันหาคิวลงนาม: service role เท่านั้น ────────────────────────────────────────────────────
{
  const rpc = read('supabase/migrations/20261030100100_telegram_dm_functions.sql')
  assert.match(rpc, /REVOKE ALL ON FUNCTION public\.esign_trip_turns\(uuid\) FROM PUBLIC, anon, authenticated;/)
  assert.match(rpc, /GRANT EXECUTE ON FUNCTION public\.esign_trip_turns\(uuid\) TO service_role;/)
  assert.equal(/GRANT EXECUTE ON FUNCTION public\.esign_trip_turns\(uuid\) TO authenticated/.test(rpc), false)
}

// ── ข้อความลงนาม: มีแค่ช่อง รถ เวลาออก เลขอ้างอิง · ไม่มีชื่อคนและปลายทาง ─────────────────────────────
{
  const text = buildEsignTurnDm({
    ...trip,
    driver: { full_name: 'สมชาย ขับรถ' },
    requester: { full_name: 'สมหญิง ขอใช้' },
    planned_return: '2026-11-02T16:00:00+07:00',
  }, 'หัวหน้าส่วนราชการ')
  for (const leak of ['สมชาย', 'สมหญิง', 'ผู้ขับ', 'ผู้ขอ', 'ปลายทาง', 'ศาลากลาง', 'กลับ:']) {
    assert.equal(text.includes(leak), false, `ข้อความลงนามห้ามมี '${leak}'`)
  }
  assert.match(text, /ช่อง: <b>หัวหน้าส่วนราชการ<\/b>/)
  assert.match(text, /รถ: รถกระบะ \(กข 1234\)/)
  assert.match(text, /ออก: 2 พ\.ย\. 2569 08:00 น\./)
  assert.match(text, /อ้างอิง: #/)
}

// คำแจ้งก่อนเชื่อมต้องบอกครบทุกอย่างที่ข้อความมีจริง
{
  const notice = read('src/components/notifications/TelegramLinkSettings.jsx').match(/ข้อความมีแค่[^<]+/)[0]
  for (const word of ['เลขที่เรื่อง', 'ประเภท', 'ชื่องาน', 'หน้าที่', 'วันเวลา', 'สถานที่', 'กอง', 'รถที่ขอใช้', 'ไม่มีชื่อหรือเบอร์โทรของประชาชน']) {
    assert.ok(notice.includes(word), `คำแจ้งก่อนเชื่อมขาด '${word}'`)
  }
}

// ── (5) คำร้องทางหลัก: รันผ่าน handler จริงของ Edge Function ──────────────────────────────────────
const GROUP = -5000
const MUNICIPALITY = { id: MUNI, telegram_group_id: GROUP, org_type: 'เทศบาลตำบล', fee_schedule: null }
const freshComplaint = (extra = {}) => ({ ...complaint, user_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra })

async function callHandler(db, type, resourceId, user = null) {
  globalThis.__createClient = (key) => (key === 'anon-key'
    ? { auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) } }
    : db)
  const response = await globalThis.__handler(new Request('https://fixture.invalid/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notification_type: type, resource_id: resourceId }),
  }))
  return { ...(await response.json()), http: response.status }
}
const chats = () => sent.map((m) => m.chatId).sort()
const dmRows = (db) => db.state.deliveries.filter((d) => d.channel === 'telegram_dm')
const handlerDb = (row, extra = {}) => fakeDb({ links: LINKS, profiles: PROFILES, complaints: [row], municipalities: [MUNICIPALITY], ...extra })

// อ่าน is_adhoc จากตารางหมวด ไม่ดึง extra_data ที่อาจมีข้อมูลผู้แจ้ง
{
  const complaintSelect = source.match(/'id,municipality_id,user_id,created_at,updated_at,status,category,assigned_to[^']*'/)[0]
  assert.match(complaintSelect, /complaint_categories\(label,emoji,is_adhoc\)/)
  assert.equal(complaintSelect.includes('extra_data'), false, '⚠️ PDPA: ห้ามดึง extra_data')
}

// ระบบรับเรื่องเอง (ประชาชนไม่ล็อกอิน) → ได้ทั้งกลุ่มและผู้รับผิดชอบ
{
  reset()
  const row = freshComplaint()
  const db = handlerDb(row)
  const res = await callHandler(db, 'complaint_created', row.id)
  assert.equal(res.http, 200)
  assert.deepEqual(chats(), [String(GROUP), '1002'])
  assert.match(sent.find((m) => m.chatId === '1002').text, /มีคำร้องมอบหมายให้คุณ/)
  assert.equal(dmRows(db)[0].idempotency_key, `complaint_assigned_dm:${row.id}:${TECH}`)
  assert.equal(dmRows(db)[0].notification_type, 'complaint_assigned_dm', 'บันทึกเป็นชนิดส่วนตัว ไม่ปนกับชนิดเข้ากลุ่ม')
  assert.equal(dmRows(db)[0].status, 'sent')
  assert.equal(dmRows(db)[0].requested_by, null)

  // เรียกซ้ำ → ไม่ส่งซ้ำทั้งสองทาง
  await callHandler(db, 'complaint_created', row.id)
  assert.equal(sent.length, 2)
}

// สายเฉพาะกิจ: สถานะยัง pending แต่ส่งตรงถึงผู้รับผิดชอบแล้ว
{
  reset()
  const row = freshComplaint({ status: 'pending', category: 'odor', category_ref: { label: 'กลิ่นเหม็น', emoji: '👃', is_adhoc: true } })
  await callHandler(handlerDb(row), 'complaint_created', row.id)
  assert.deepEqual(chats(), [String(GROUP), '1002'])
}

// รอแอดมินรับเรื่อง → ยังไม่ส่งถึงผู้รับผิดชอบ · แอดมินกดรับเรื่องแล้วค่อยส่ง ครั้งเดียว
{
  reset()
  const row = freshComplaint({ status: 'pending' })
  const db = handlerDb(row)
  await callHandler(db, 'complaint_created', row.id)
  assert.deepEqual(chats(), [String(GROUP)], 'ยังรอแอดมิน')
  assert.equal(dmRows(db).length, 0)

  row.status = 'received'
  row.updated_at = new Date(Date.now() + 1000).toISOString()
  await callHandler(db, 'complaint_status_updated', row.id, ADMIN)
  assert.equal(chats().filter((c) => c === '1002').length, 1, 'กดรับเรื่องแล้วได้ข้อความ')

  // แอดมินเปลี่ยนสถานะกลับไปกลับมา หรือกดปุ่มมอบหมายคนเดิม → ไม่ซ้ำ (คีย์ชุดเดียวกัน)
  row.updated_at = new Date(Date.now() + 2000).toISOString()
  await callHandler(db, 'complaint_status_updated', row.id, ADMIN)
  await callHandler(db, 'complaint_assigned_dm', row.id, ADMIN)
  assert.equal(chats().filter((c) => c === '1002').length, 1)

  // เปลี่ยนผู้รับผิดชอบเป็นคนใหม่ → คนใหม่ได้
  row.assigned_to = ADMIN
  await callHandler(db, 'complaint_assigned_dm', row.id, TECH)
  assert.equal(chats().filter((c) => c === '1001').length, 1)
}

// สถานะอื่นไม่ส่ง · ยังไม่มีผู้รับผิดชอบไม่ส่ง · ผู้รับผิดชอบกดเองไม่ส่ง
for (const [extra, user, label] of [
  [{ status: 'in_progress' }, ADMIN, 'เริ่มดำเนินการ'],
  [{ status: 'closed' }, ADMIN, 'ปิดเรื่อง'],
  [{ status: 'pending' }, ADMIN, 'ส่งคืนให้แอดมิน'],
  [{ status: 'received', assigned_to: null }, ADMIN, 'ยังไม่มีผู้รับผิดชอบ'],
  [{ status: 'received' }, TECH, 'ผู้รับผิดชอบกดรับเอง'],
]) {
  reset()
  const row = freshComplaint(extra)
  const errors = []
  const originalError = console.error
  console.error = (...args) => errors.push(args)
  try {
    await callHandler(handlerDb(row), 'complaint_status_updated', row.id, user)
  } finally {
    console.error = originalError
  }
  assert.equal(sent.some((m) => m.chatId === '1002'), false, label)
  assert.equal(errors.length, 0, `${label}: ต้องไม่ยิงคำสั่งเสียเข้าฐานข้อมูล`)
}

// อปท. ที่ไม่ได้ผูกกลุ่ม → ผู้รับผิดชอบยังได้ข้อความ
{
  reset()
  const row = freshComplaint()
  const res = await callHandler(handlerDb(row, { municipalities: [{ ...MUNICIPALITY, telegram_group_id: null }] }), 'complaint_created', row.id)
  assert.equal(res.reason, 'not_configured')
  assert.deepEqual(chats(), ['1002'])
}

// เรื่องลับ: กลุ่มไม่ได้รับการเปลี่ยนสถานะ แต่ผู้รับผิดชอบได้ข้อความกลางๆ
{
  reset()
  const row = freshComplaint({ category: 'corruption', category_ref: { label: 'แจ้งการทุจริต', emoji: '⚖️', is_adhoc: false } })
  const res = await callHandler(handlerDb(row), 'complaint_status_updated', row.id, ADMIN)
  assert.equal(res.reason, 'confidential')
  assert.deepEqual(chats(), ['1002'])
  assert.match(sent[0].text, /เรื่องลับ/)
  assert.equal(/ทุจริต|หมู่ 3/.test(sent[0].text), false)
}

// ส่วนตัวพัง (อ่านตารางผูกบัญชีไม่ได้) → ข้อความเข้ากลุ่มต้องไม่หายตาม
{
  reset()
  const errors = []
  const originalError = console.error
  console.error = (...args) => errors.push(args)
  try {
    const row = freshComplaint()
    const res = await callHandler(handlerDb(row, { brokenTables: ['telegram_user_links'] }), 'complaint_created', row.id)
    assert.equal(res.http, 200)
    assert.deepEqual(chats(), [String(GROUP)])
    assert.equal(errors.length, 1, 'ต้องจด log ไว้ตรวจย้อน')
  } finally {
    console.error = originalError
  }
}

console.log('telegram-dm: ผ่านทั้งหมด')

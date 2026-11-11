// ห้องผู้บริหารแบบเรียบ (หน้าเดียวสำหรับนายก) — ตรรกะล้วนของ src/lib/execSimpleView.js + ตรวจสายไฟจากซอร์ส
//   ชั้นแรก: ฟังก์ชัน pure ของจริง (แยกแถวเตือน · ตัวเลข ③ · ช่วงเวลาอัปเดตเอง 06:00–20:00 เวลาไทย · ถัดไป · กำหนดการ · ป้ายใหม่ · sessionStorage)
//   ชั้นสอง: อ่านซอร์ส — ไม่อ่านตารางตรงๆ · ไม่ขอคีย์ที่ไม่ใช้ · รีเฟรชเงียบไม่ตั้ง loading · ไม่มีข้อมูลส่วนบุคคลในไฟล์ใหม่ · เส้นทางเลือกหน้า
// ไม่ต่อเน็ต ไม่ใช้บัญชี · โซนเวลาเครื่องตั้งเป็นต่างประเทศ: โค้ดที่อ่านเวลาจากเครื่องแทนเวลาไทยจะพังในเคสข้ามวัน
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.TZ = 'America/Los_Angeles'

const V = await import('../src/lib/execSimpleView.js')
const { EXEC_ALERT_RULE_KEYS, buildExecModel, deriveExec, satisfactionView } = await import('../src/lib/executiveData.js')
const { liveEntries } = await import('../src/lib/executiveRegistry.js')

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

// เวลาไทย HH:MM ของวันที่ไทยที่กำหนด → Date (UTC+7 ไม่มี DST)
const bkk = (day, hhmm) => new Date(`${day}T${hhmm}:00+07:00`)

// ── รายการสำคัญ ──────────────────────────────────────────────────────────────

test('EXEC_SIMPLE_MAJOR_ALERTS ทุกตัวต้องมีกฎจริงใน EXEC_ALERT_RULE_KEYS (ไม่งั้นแก้ชื่อกฎแล้วเรื่องหายเงียบ)', () => {
  assert.equal(V.EXEC_SIMPLE_MAJOR_ALERTS.length, 7)
  for (const key of V.EXEC_SIMPLE_MAJOR_ALERTS) assert.ok(EXEC_ALERT_RULE_KEYS.includes(key), `ไม่มีกฎ ${key}`)
  for (const key of V.EXEC_SIMPLE_OVERDUE_IDS) assert.ok(V.EXEC_SIMPLE_MAJOR_ALERTS.includes(key))
  assert.ok(EXEC_ALERT_RULE_KEYS.includes(V.EXEC_SIMPLE_ESIGN_ALERT_ID))
  assert.equal(new Set(V.EXEC_SIMPLE_MAJOR_ALERTS).size, V.EXEC_SIMPLE_MAJOR_ALERTS.length, 'ห้ามซ้ำ')
})

test('ถ้อยคำ ② ครบทุกแถวเด่นที่ไม่ใช่แถวช้า 5 วันทำการ (หัวข้อ/หน่วย/ปุ่ม)', () => {
  for (const key of V.EXEC_SIMPLE_MAJOR_ALERTS.filter((k) => !V.EXEC_SIMPLE_OVERDUE_IDS.includes(k))) {
    const w = V.EXEC_SIMPLE_ALERT_WORDS[key]
    assert.ok(w && w.what && w.go, `ไม่มีถ้อยคำของ ${key}`)
  }
  // ไม่อยู่ในตาราง = ใช้ป้ายจากทะเบียน (เรื่องเล็ก) + ปุ่ม "ดู<ชื่อเมนู>"
  assert.deepEqual(V.simpleAlertWords({ id: 'fleet:incidents', label: 'รถเสียหาย/สูญหาย', unit: 'เหตุ', entry: { label: 'ยานพาหนะ' } }),
    { what: 'รถเสียหาย/สูญหาย', unit: 'เหตุ', go: 'ดูยานพาหนะ' })
})

test('คีย์สรุปที่ไม่ขอ (รายกอง/รถผู้ป่วย) ไม่กระทบ alert/decision ใดในทะเบียน — ตัดแล้วเรื่องไม่หาย', () => {
  const entries = liveEntries(() => true)
  const used = new Set()
  for (const e of entries) {
    for (const a of e.alerts) if (EXEC_ALERT_RULE_KEYS.includes(`${e.key}:${a.id}`)) used.add(e.summaryKey)
    if (e.zones.includes('decision')) used.add(e.summaryKey)
  }
  for (const key of V.EXEC_SIMPLE_SKIP_SUMMARY_KEYS) assert.ok(!used.has(key), `${key} ถูกใช้โดยกฎเตือน/คิวรอตัดสิน แต่ถูกตัดจากการขอ`)
})

// ── แยกแถวเตือน ──────────────────────────────────────────────────────────────

const A = (id, count, extra = {}) => ({ id, count, ...extra })

test('splitSimpleAlerts: ช้า 5 วันทำการของคำร้อง+คำขอรวมเป็นแถวเดียว count รวม · ใบรอลงนามเกิน 2 วันไปอยู่ ① ไม่อยู่ ②', () => {
  const r = V.splitSimpleAlerts([
    A('complaints:overdue_5wd', 4), A('src:esign:waiting_2wd', 1), A('inbox:overdue_5wd', 2), A('water-situation:event_open', 1),
  ])
  assert.equal(r.overdue5.count, 6)
  assert.deepEqual(r.overdue5.items.map((i) => i.id), ['complaints:overdue_5wd', 'inbox:overdue_5wd'])
  assert.equal(r.esign.id, 'src:esign:waiting_2wd')
  assert.deepEqual(r.major.map((i) => i.id), ['water-situation:event_open'])
  assert.deepEqual(r.minor, [])
  for (const bucket of [r.major, r.minor]) assert.ok(!bucket.some((i) => i.id === 'src:esign:waiting_2wd'))
  // มีฝั่งเดียวก็ได้ (โมดูลคำขอปิด)
  assert.equal(V.splitSimpleAlerts([A('inbox:overdue_5wd', 3)]).overdue5.count, 3)
})

test('splitSimpleAlerts: แถวเด่นไม่เกิน 3 (ตามลำดับความรุนแรงที่ส่งมา) · ส่วนเกิน + นอกรายการสำคัญ = เรื่องเล็ก ไม่ซ่อนเงียบ', () => {
  const r = V.splitSimpleAlerts([
    A('projects:contract_past', 1), A('water-situation:event_open', 1), A('complaints:low_rating', 2),
    A('projects:behind', 3), A('local-plan:no_published_plan', 1, { showCount: false }), A('fleet:incidents', 1), A('borrowable-assets:overdue_return', 2),
  ])
  assert.deepEqual(r.major.map((i) => i.id), ['projects:contract_past', 'water-situation:event_open', 'complaints:low_rating'])
  assert.deepEqual(r.minor.map((i) => i.id), ['projects:behind', 'local-plan:no_published_plan', 'fleet:incidents', 'borrowable-assets:overdue_return'])
  assert.equal(r.major.length + r.minor.length, 7, 'รวมทุกแถวต้องไม่หาย')
})

test('splitSimpleAlerts: ว่าง/ผิดรูป = ไม่มีอะไร (overdue5 null) ไม่พัง', () => {
  for (const input of [[], null, undefined, [null, {}, { id: 5 }]]) {
    assert.deepEqual(V.splitSimpleAlerts(input), { overdue5: null, major: [], minor: [], esign: null })
  }
})

test('simpleOverdueWhat: ใช้ชื่อประเภทตามที่มีจริง', () => {
  const both = V.splitSimpleAlerts([A('complaints:overdue_5wd', 1), A('inbox:overdue_5wd', 1)]).overdue5
  assert.equal(V.simpleOverdueWhat(both), 'เรื่องร้องเรียน/คำขอบริการ ช้ากว่ากำหนดเกิน 5 วันทำการ')
  assert.equal(V.simpleOverdueWhat(V.splitSimpleAlerts([A('complaints:overdue_5wd', 1)]).overdue5), 'เรื่องร้องเรียน ช้ากว่ากำหนดเกิน 5 วันทำการ')
  assert.equal(V.simpleOverdueWhat(V.splitSimpleAlerts([A('inbox:overdue_5wd', 1)]).overdue5), 'คำขอบริการ ช้ากว่ากำหนดเกิน 5 วันทำการ')
})

// ── ตัวเลข ③ ────────────────────────────────────────────────────────────────

const TODAY = '2026-11-11'
const complaintsRaw = {
  period: { total: 28, citizen_online: 20, oss_counter: 8, confidential: 0, adhoc: 0 },
  on_time: { completed: 12, on_time: 10, late: 2, no_due: 0, open_past_due: 0, undated: 0 },
  backlog: [],
}
const docsRaw = {
  by_type: [{ t: 'building_permit', total: 10, pending: 1, processing: 1, completed: 8, rejected: 0, avg_days: 2 }, { t: 'waste_collection', total: 7, pending: 0, processing: 0, completed: 7, rejected: 0, avg_days: 1 }],
  on_time: { by_type: [
    { t: 'building_permit', completed: 8, on_time: 7, late: 1, no_due: 0, open_past_due: 0, undated: 0 },
    { t: 'waste_collection', completed: 7, on_time: 7, late: 0, no_due: 0, open_past_due: 0, undated: 0 },
  ] },
  backlog: [],
  entered: {},
}
const satRaw = {
  closed: 20, any_rated: 15,
  sources: { verified: { complaints: 8, sum: 36, cnt: 8 }, via_link: { complaints: 7, sum: 32, cnt: 7 } },
  genuine: { complaints: 15, sum: 68, cnt: 15 },
  general: { n: 0, sum: 0 }, low: {}, by_dept: [],
}
const modelOf = (raw) => buildExecModel(raw)
const numbersOf = (raw) => { const m = modelOf(raw); return V.simpleServiceNumbers(m, deriveExec({ model: m, today: TODAY })) }

test('③ ตัวเลขครบ: รับเรื่อง = คำร้อง + คำขอ · ทันเวลา แยกคำร้อง/คำขอ ไม่รวมตัวหาร · พอใจ = ค่าเดียวกับการ์ดหน้าเต็ม', () => {
  const raw = { complaints: { ok: true, data: complaintsRaw }, doc_requests: { ok: true, data: docsRaw }, satisfaction: { ok: true, data: satRaw } }
  const n = numbersOf(raw)
  assert.deepEqual(n.received, { state: 'ok', total: 45, complaints: 28, docs: 17 })
  assert.deepEqual(n.onTime.complaints, { state: 'ok', onTime: 10, denominator: 12, pct: 83.3 })
  assert.deepEqual(n.onTime.docs, { state: 'ok', onTime: 14, denominator: 15, pct: 93.3 }, 'คำขอ: ตัวหารของคำขอเอง (7+7 จาก 8+7) ไม่ปนคำร้อง')
  const full = satisfactionView(modelOf(raw).satisfaction.data)
  assert.equal(n.satisfaction.avg, full.genuineAvg, 'พอใจต้องตรงกับการ์ดหน้าเต็ม (genuineAvg)')
  assert.deepEqual(n.satisfaction, { state: 'ok', avg: 4.5, count: 15 })
})

test('③ อ่านไม่ได้ต้องเป็น null (ขีด) ไม่ใช่ 0: ฝั่งใดฝั่งหนึ่ง error = ยอดรวมรับเรื่อง null · การ์ดนั้น error', () => {
  const n = numbersOf({ complaints: { ok: true, data: complaintsRaw }, doc_requests: { ok: false, error: '57014' }, satisfaction: { ok: false, error: 'x' } })
  assert.equal(n.received.state, 'error')
  assert.equal(n.received.total, null)
  assert.equal(n.received.docs, null)
  assert.equal(n.received.complaints, 28)
  assert.deepEqual(n.onTime.docs, { state: 'error', onTime: null, denominator: null, pct: null })
  assert.equal(n.onTime.complaints.state, 'ok')
  assert.deepEqual(n.satisfaction, { state: 'error', avg: null, count: null })
})

test('③ โมดูลปิด (missing) ไม่นับ · ปิดหมดเป็น missing · ไม่มีคะแนน avg null · ไม่มีเรื่องครบกำหนด pct null', () => {
  const only = numbersOf({ complaints: { ok: true, data: complaintsRaw } })
  assert.deepEqual(only.received, { state: 'ok', total: 28, complaints: 28, docs: null })
  assert.equal(only.onTime.docs.state, 'missing')
  assert.equal(only.satisfaction.state, 'missing')
  const none = numbersOf({})
  assert.equal(none.received.state, 'missing')
  assert.equal(none.received.total, null)
  assert.equal(V.simpleServiceNumbers(null, null).received.total, null, 'model/derived เป็น null ก็ไม่พัง')
  const noRate = numbersOf({ complaints: { ok: true, data: { period: { total: 0 }, backlog: [] } }, satisfaction: { ok: true, data: { closed: 3, any_rated: 0, sources: {}, genuine: { cnt: 0, sum: 0 }, low: {} } } })
  assert.equal(noRate.received.total, 0, 'ได้ 0 เรื่องจริงต้องเป็น 0 (ต่างจากอ่านไม่ได้)')
  assert.equal(noRate.onTime.complaints.pct, null, 'ไม่มีเรื่องครบกำหนด = null ไม่ใช่ 0%')
  assert.equal(noRate.onTime.complaints.denominator, 0)
  assert.deepEqual(noRate.satisfaction, { state: 'ok', avg: null, count: 0 })
})

// ── ช่วงเวลาอัปเดตเอง (06:00–20:00 เวลาไทย) ─────────────────────────────────

test('isRefreshWindow: 05:59 ไม่ · 06:00 ใช่ · 19:59 ใช่ · 20:00 ไม่ (เวลาไทย ไม่ขึ้นกับโซนเครื่อง)', () => {
  assert.equal(V.isRefreshWindow(bkk('2026-11-11', '05:59')), false)
  assert.equal(V.isRefreshWindow(bkk('2026-11-11', '06:00')), true)
  assert.equal(V.isRefreshWindow(bkk('2026-11-11', '12:30')), true)
  assert.equal(V.isRefreshWindow(bkk('2026-11-11', '19:59')), true)
  assert.equal(V.isRefreshWindow(bkk('2026-11-11', '20:00')), false)
  assert.equal(V.isRefreshWindow(bkk('2026-11-11', '00:00')), false)
  assert.equal(V.isRefreshWindow(bkk('2026-11-11', '23:59')), false)
  // ตัวอย่างตรงๆ ของ UTC ที่ข้ามวัน: 22:59Z = 05:59 ไทย (วันถัดไป) · 23:00Z = 06:00 ไทย · 12:59Z = 19:59 ไทย · 13:00Z = 20:00 ไทย
  assert.equal(V.isRefreshWindow(new Date('2026-11-10T22:59:00Z')), false)
  assert.equal(V.isRefreshWindow(new Date('2026-11-10T23:00:00Z')), true)
  assert.equal(V.isRefreshWindow(new Date('2026-11-11T12:59:00Z')), true)
  assert.equal(V.isRefreshWindow(new Date('2026-11-11T13:00:00Z')), false)
  assert.equal(V.bangkokMinutes(new Date('2026-11-10T23:00:00Z')), 360)
})

test('canAutoRefresh: แท็บซ่อน = ไม่ดึงแม้อยู่ในเวลา · นอกเวลา = ไม่ดึงแม้แท็บมองเห็น', () => {
  const noon = bkk('2026-11-11', '12:00')
  assert.equal(V.canAutoRefresh({ now: noon, visible: true }), true)
  assert.equal(V.canAutoRefresh({ now: noon, visible: false }), false)
  assert.equal(V.canAutoRefresh({ now: bkk('2026-11-11', '21:00'), visible: true }), false)
  assert.equal(V.canAutoRefresh({ now: noon }), true, 'ไม่ระบุ visible = ถือว่ามองเห็น (ค่าเริ่มต้นของฟังก์ชัน)')
  assert.equal(V.canAutoRefresh({ now: noon, visible: 'hidden' }), false, 'ค่าที่ไม่ใช่ true เป๊ะ = ไม่ดึง')
})

test('shouldRefreshOnReturn: กลับมาที่แท็บแล้วข้อมูลเก่า ≥ 5 นาที = ดึงทันที · สดกว่านั้น/นอกเวลา/ซ่อน = ไม่ดึง', () => {
  const now = bkk('2026-11-11', '10:00')
  const at = (minAgo) => now.getTime() - minAgo * 60_000
  assert.equal(V.EXEC_SIMPLE_REFRESH_MS, 300_000)
  assert.equal(V.shouldRefreshOnReturn({ now, visible: true, lastAt: at(5) }), true)
  assert.equal(V.shouldRefreshOnReturn({ now, visible: true, lastAt: at(4.9) }), false)
  assert.equal(V.shouldRefreshOnReturn({ now, visible: true, lastAt: at(180) }), true)
  assert.equal(V.shouldRefreshOnReturn({ now, visible: false, lastAt: at(180) }), false)
  assert.equal(V.shouldRefreshOnReturn({ now: bkk('2026-11-11', '20:00'), visible: true, lastAt: at(600) }), false, 'นอกเวลาไม่ดึงแม้ข้อมูลเก่ามาก')
  assert.equal(V.shouldRefreshOnReturn({ now, visible: true, lastAt: undefined }), true, 'ไม่รู้เวลาล่าสุด = ถือว่าเก่า')
})

test('bangkokClock: HH:MM เวลาไทย · ค่าเสีย = null', () => {
  assert.equal(V.bangkokClock(bkk('2026-11-11', '09:05')), '09:05')
  assert.equal(V.bangkokClock(new Date('2026-11-10T17:30:00Z')), '00:30')
  assert.equal(V.bangkokClock(NaN), null)
  assert.equal(V.bangkokClock(undefined), null)
})

// ── ถัดไป + กำหนดการ ─────────────────────────────────────────────────────────

test('nextEventInfo: "ถัดไป · อีก N นาที" เฉพาะกิจกรรมวันนี้ที่มีเวลา · ทั้งวัน/พรุ่งนี้/ผ่านไปแล้ว ไม่นับ', () => {
  const now = bkk(TODAY, '09:12')
  const events = [
    { id: 'a', day: TODAY, time: '08:00' },
    { id: 'allday', day: TODAY, time: null },
    { id: 'c', day: TODAY, time: '13:30' },
    { id: 'b', day: TODAY, time: '09:30' },
    { id: 'tmr', day: '2026-11-12', time: '09:13' },
  ]
  assert.deepEqual(V.nextEventInfo(events, now), { id: 'b', minutes: 18, text: 'ถัดไป · อีก 18 นาที' })
  assert.equal(V.nextEventInfo(events, bkk(TODAY, '09:30')).text, 'ถัดไป · ตอนนี้')
  assert.equal(V.nextEventInfo(events, bkk(TODAY, '09:31')).id, 'c')
  assert.equal(V.nextEventInfo(events, bkk(TODAY, '09:31')).text, 'ถัดไป · อีก 3 ชั่วโมง 59 นาที')
  assert.equal(V.nextEventText(240), 'ถัดไป · อีก 4 ชั่วโมง')
  assert.equal(V.nextEventText(95), 'ถัดไป · อีก 1 ชั่วโมง 35 นาที')
  assert.equal(V.nextEventInfo(events, bkk(TODAY, '13:31')), null, 'ผ่านหมดแล้ว = ไม่มีถัดไป')
  assert.equal(V.nextEventInfo([], now), null)
  assert.equal(V.nextEventInfo(null, now), null)
  // วันของ "ตอนนี้" ตามปฏิทินไทย: 17:30Z ของ 10 พ.ย. = 00:30 ของ 11 พ.ย. (เครื่องอยู่ลอสแอนเจลิส)
  assert.equal(V.nextEventInfo([{ id: 'x', day: TODAY, time: '01:00' }], new Date('2026-11-10T17:30:00Z')).minutes, 30)
})

test('mergeSimpleSchedule: เฉพาะวันนี้+พรุ่งนี้ · ตัดซ้ำด้วย id ข้ามสองแหล่ง · เรียงเวลา (ทั้งวันไว้ท้าย) · เก็บเฉพาะชื่อ+เวลา', () => {
  const events = [
    { id: 'e1', title: 'ประชุมสภา', event_date: '2026-11-12', end_date: null, event_time: '10:00:00', is_personal: false },
    { id: 'e2', title: 'ตรวจถนน', event_date: TODAY, end_date: null, event_time: '13:30', is_personal: false },
    { id: 'e3', title: 'งานลอยกระทง', event_date: TODAY, end_date: '2026-11-15', event_time: null, is_personal: false },
    { id: 'far', title: 'อีก 5 วัน', event_date: '2026-11-16', end_date: null, event_time: '09:00', is_personal: false },
    { id: 'me', title: 'นัดส่วนตัว', event_date: TODAY, end_date: null, event_time: '07:30', is_personal: true },
  ]
  const myEvents = {
    today: [{ id: 'e2', title: 'ตรวจถนน', time: '13:30', day: 'today', location: 'ห้ามหลุด', task: 'ห้ามหลุด' }, { id: 'm9', title: 'รับแขก', time: '11:00', day: 'today' }],
    tomorrow: [{ id: 'm10', title: 'อบรม', time: null, day: 'tomorrow' }],
  }
  const r = V.mergeSimpleSchedule({ events, myEvents, today: TODAY })
  assert.deepEqual(r.today.map((e) => `${e.time ?? 'ทั้งวัน'} ${e.title}`), ['07:30 นัดส่วนตัว', '11:00 รับแขก', '13:30 ตรวจถนน', 'ทั้งวัน งานลอยกระทง'])
  assert.deepEqual(r.tomorrow.map((e) => `${e.time ?? 'ทั้งวัน'} ${e.title}`), ['10:00 ประชุมสภา', 'ทั้งวัน อบรม'])
  assert.equal(r.all.length, 6)
  assert.ok(!r.all.some((e) => e.title === 'อีก 5 วัน'))
  for (const e of r.all) assert.deepEqual(Object.keys(e).sort(), ['day', 'end', 'id', 'personal', 'time', 'title'])
  assert.deepEqual(V.mergeSimpleSchedule({ events: null, myEvents: null, today: TODAY }), { today: [], tomorrow: [], all: [] })
})

// ── ป้าย "ใหม่ HH:MM" ───────────────────────────────────────────────────────

test('markNewAlerts: เปิดครั้งแรก (ไม่มีรอบก่อน) = ไม่ติดป้ายใคร · รอบถัดมา จำนวนเพิ่ม/ขึ้นใหม่ = ติดป้ายเวลาที่ได้ข้อมูล', () => {
  const t1 = bkk(TODAY, '09:00')
  const first = V.markNewAlerts(null, [A('x:a', 4), A('x:b', 1)], t1)
  assert.deepEqual(first.labels, {})
  assert.deepEqual(first.snapshot.counts, { 'x:a': 4, 'x:b': 1 })
  const t2 = bkk(TODAY, '10:05')
  const second = V.markNewAlerts(first.snapshot, [A('x:a', 4), A('x:b', 2), A('x:c', 1)], t2)
  assert.deepEqual(second.labels, { 'x:b': '10:05', 'x:c': '10:05' })
})

test('markNewAlerts: ป้ายอยู่ 1 ชั่วโมงเป๊ะ · จำนวนลด/เท่าเดิมไม่ติดป้ายใหม่ · ลดแล้วเพิ่มอีกติดใหม่ · ค่าเสียไม่พัง', () => {
  const t0 = bkk(TODAY, '09:00')
  const s1 = V.markNewAlerts(V.markNewAlerts(null, [A('x:a', 1)], t0).snapshot, [A('x:a', 3)], bkk(TODAY, '10:00'))
  assert.deepEqual(s1.labels, { 'x:a': '10:00' })
  const s2 = V.markNewAlerts(s1.snapshot, [A('x:a', 3)], bkk(TODAY, '10:59'))
  assert.deepEqual(s2.labels, { 'x:a': '10:00' }, 'เท่าเดิม = ป้ายเดิมคงอยู่ (ยังไม่ครบชั่วโมง)')
  const s3 = V.markNewAlerts(s2.snapshot, [A('x:a', 3)], bkk(TODAY, '11:00'))
  assert.deepEqual(s3.labels, {}, 'ครบ 1 ชั่วโมงพอดี = ป้ายหาย')
  const s4 = V.markNewAlerts(s3.snapshot, [A('x:a', 1)], bkk(TODAY, '11:05'))
  assert.deepEqual(s4.labels, {}, 'จำนวนลด = ไม่ติดป้ายใหม่')
  const s5 = V.markNewAlerts(s4.snapshot, [A('x:a', 2)], bkk(TODAY, '11:10'))
  assert.deepEqual(s5.labels, { 'x:a': '11:10' }, 'ลดแล้วเพิ่มอีก = เป็นของใหม่')
  assert.deepEqual(V.markNewAlerts({ counts: 5, marks: 'x' }, [A('x:a', 1)], t0).labels, {})
  assert.deepEqual(V.markNewAlerts(undefined, null, t0).snapshot, { counts: {}, marks: {} })
  assert.deepEqual(V.markNewAlerts(s5.snapshot, [], bkk(TODAY, '11:15')).snapshot, { counts: {}, marks: {} }, 'ข้อที่หายไปไม่ค้างในรอบถัดไป')
})

// ── sessionStorage ห่อ try/catch ────────────────────────────────────────────

function withStorage(storage, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true, writable: true })
  try { run() } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original)
    else delete globalThis.sessionStorage
  }
}
const memoryStorage = () => {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)) }, removeItem: (k) => { map.delete(k) } }
}
const throwingStorage = () => ({
  getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') }, removeItem() { throw new Error('denied') },
})

test('sessionStorage: อ่าน/เขียน JSON ได้ · ใช้ไม่ได้/โยน error/ค่าพัง = ไม่ทำให้หน้าพัง (คืน null / ข้าม)', () => {
  withStorage(memoryStorage(), () => {
    V.writeSessionJson('k', { a: 1 })
    assert.deepEqual(V.readSessionJson('k'), { a: 1 })
    globalThis.sessionStorage.setItem('bad', '{ไม่ใช่ json')
    assert.equal(V.readSessionJson('bad'), null)
    assert.equal(V.readSessionJson('none'), null)
  })
  withStorage(throwingStorage(), () => {
    assert.equal(V.readSessionJson('k'), null)
    assert.doesNotThrow(() => V.writeSessionJson('k', { a: 1 }))
    assert.doesNotThrow(() => V.removeSessionKey('k'))
    assert.doesNotThrow(() => V.saveSimpleScroll(300))
    assert.equal(V.takeSimpleScroll(), null)
  })
  withStorage(undefined, () => {
    assert.equal(V.readSessionJson('k'), null)
    assert.doesNotThrow(() => V.writeSessionJson('k', 1))
  })
})

test('เลื่อนจอคืนตำแหน่ง: จำก่อนออก · หยิบได้ครั้งเดียว · เก่าเกิน 30 นาที/ค่าเสียไม่เลื่อน', () => {
  withStorage(memoryStorage(), () => {
    V.saveSimpleScroll(842.4, 1_000_000)
    assert.equal(V.takeSimpleScroll(1_000_000 + 5_000), 842)
    assert.equal(V.takeSimpleScroll(1_000_000 + 6_000), null, 'หยิบแล้วหาย — ใช้ครั้งเดียว')
    V.saveSimpleScroll(500, 1_000_000)
    assert.equal(V.takeSimpleScroll(1_000_000 + V.EXEC_SIMPLE_SCROLL_TTL_MS + 1), null, 'เก่าเกินไป = เปิดหน้าใหม่')
    V.saveSimpleScroll(-5)
    V.saveSimpleScroll(NaN)
    assert.equal(V.takeSimpleScroll(), null, 'ค่าเสียไม่ถูกจำ')
    globalThis.sessionStorage.setItem(V.EXEC_SIMPLE_SCROLL_KEY, JSON.stringify({ y: 'x', at: 1 }))
    assert.equal(V.takeSimpleScroll(2), null)
  })
})

// ── สายไฟจากซอร์ส ────────────────────────────────────────────────────────────

const NEW_FILES = [
  'src/lib/execSimpleView.js',
  'src/hooks/useExecAutoRefresh.js',
  'src/hooks/useExecSimpleFollows.js',
  'src/components/staff/executive/ExecSimpleHome.jsx',
  'src/components/staff/executive/ExecSimpleParts.jsx',
  'src/components/staff/executive/ExecSimpleSign.jsx',
  'src/components/staff/executive/ExecSimpleLists.jsx',
  'src/components/staff/executive/ExecBackBar.jsx',
]

test('ไฟล์ใหม่ทั้งหมด: ไม่อ่านตารางคำร้อง/คำขอตรงๆ · ไม่เปิดแท็บใหม่ · ไม่มีช่องข้อมูลส่วนบุคคลของผู้ร้อง/ผู้ประเมิน (PDPA)', () => {
  for (const file of NEW_FILES) {
    const code = stripComments(read(file))
    assert.ok(!/supabase\s*\.\s*from\(/.test(code), `${file}: ห้าม supabase.from — viewer อ่านตารางตรงไม่ได้ (RLS) ใช้ RPC เท่านั้น`)
    assert.ok(!/window\.open\(|target="_blank"/.test(code), `${file}: ห้ามเปิดแท็บใหม่`)
    assert.ok(!/reporter_name|complainant|full_name|phone|contact_|requester_name|\.purpose\b|rater|comment\b/i.test(code), `${file}: พบช่องที่อาจเป็นข้อมูลส่วนบุคคล/ข้อความอิสระ`)
    assert.ok(!/approve|อนุมัติ\s*\(/i.test(code.replace(/actionLabel|อนุมัติ \(ลงนาม\)/g, '')) || file.endsWith('ExecSimpleSign.jsx'), `${file}: ห้ามมีปุ่มอนุมัติของตัวเอง`)
  }
})

test('แบบเรียบใช้ฮุก/ฟังก์ชันชุดเดียวกับหน้าเต็ม · ไม่ขอคีย์รายกอง/รถผู้ป่วย · ไม่ดึงผลดำเนินการตามแผน (เพิ่ม egress)', () => {
  const home = stripComments(read('src/components/staff/executive/ExecSimpleHome.jsx'))
  for (const used of ['useExecOverview', 'buildAlerts', 'buildDecisionQueue', 'deriveExec', "'exec_my_esign_waiting'", "'esign_my_pending'", "'staff_home_summary'", 'useExecSchedule', 'useExecAutoRefresh', 'canNudgeItems']) {
    assert.ok(home.includes(used), `ไม่ได้ใช้ ${used}`)
  }
  assert.ok(home.includes('EXEC_SIMPLE_SKIP_SUMMARY_KEYS'), 'ต้องกรองคีย์สรุปที่ไม่ใช้')
  assert.ok(!home.includes('useExecPlanProgress'), 'แผนระบุไม่ต่อผลดำเนินการตามแผน')
  assert.ok(!home.includes('execPreviousRange'), 'ไม่มีลูกศรเทียบช่วงก่อน → ไม่ขอช่วงก่อนหน้า')
  assert.ok(/execPeriodRange\('month'/.test(home), 'ล็อกช่วง "เดือนนี้"')
  const lists = stripComments(read('src/components/staff/executive/ExecSimpleLists.jsx'))
  for (const used of ['loadOverdue', 'nudgeItem', 'nudgeConfirmText', 'nudgeResultMessage', 'overdueWorkingDays', 'nudgeBlocked']) assert.ok(lists.includes(used), `รายการเร่งรัดไม่ได้ใช้ ${used} ของเดิม`)
})

test('รีเฟรชเงียบ: refresh ของทุกฮุกไม่ตั้ง status loading · ฮุกอัปเดตเองคุมแท็บมองเห็น + ช่วงเวลา + ไม่ดึงตอนซ่อน', () => {
  for (const file of ['src/hooks/useExecOverview.js', 'src/hooks/useExecRpc.js', 'src/hooks/useExecExtras.js']) {
    const code = stripComments(read(file))
    assert.ok(/const refresh = useCallback/.test(code), `${file}: ต้องมี refresh()`)
    const body = code.slice(code.indexOf('const refresh = useCallback'))
    const end = body.indexOf('}, [')
    const refreshBody = body.slice(0, end > 0 ? end : 400)
    assert.ok(!/status:\s*'loading'|setState/.test(refreshBody), `${file}: refresh ห้ามตั้ง loading/แตะ state (จอห้ามกระพริบ)`)
  }
  const auto = stripComments(read('src/hooks/useExecAutoRefresh.js'))
  assert.ok(auto.includes('canAutoRefresh') && auto.includes('shouldRefreshOnReturn'), 'ต้องใช้ตัวตัดสินเวลา/แท็บของ lib')
  assert.ok(auto.includes("document.visibilityState === 'visible'"))
  assert.ok(auto.includes("addEventListener('visibilitychange'") && auto.includes('removeEventListener'))
  assert.ok(auto.includes('clearInterval'))
  // ดึงพลาดคงตัวเลขเดิม: useExecRpc ดูที่ prev.data (ไม่ใช่ prev.status)
  const rpc = stripComments(read('src/hooks/useExecRpc.js'))
  assert.ok(/prev\.key === key && prev\.data != null/.test(rpc))
  assert.ok(!/prev\.status === 'ok' \? prev/.test(rpc))
})

test('เส้นทาง: ?view=full/simple · viewer เริ่มแบบเรียบ · แบบเต็มมีลิงก์ "ดูแบบย่อ (แบบนายก)" · ปุ่มรายละเอียดทั้งหมดไป ?view=full · แถบกลับอยู่ที่ App.jsx จุดเดียว', () => {
  const room = stripComments(read('src/pages/ExecutiveRoom.jsx'))
  assert.ok(/viewParam === 'simple' \|\| \(viewParam !== 'full' && profile\.role === 'viewer'\)/.test(room))
  assert.ok(room.includes("lazy(() => import('../components/staff/executive/ExecSimpleHome'))"))
  assert.ok(room.includes('ExecutiveHome'), 'หน้าแบบเต็มเดิมยังอยู่')
  assert.ok(read('src/components/staff/executive/ExecutiveHome.jsx').includes("navigate('/executive?view=simple')"))
  assert.ok(read('src/components/staff/executive/ExecutiveHome.jsx').includes('ดูแบบย่อ (แบบนายก)'))
  assert.ok(read('src/components/staff/executive/ExecSimpleHome.jsx').includes("navigate('/executive?view=full')"))
  const app = read('src/App.jsx')
  assert.equal((app.match(/<ExecBackBar \/>/g) ?? []).length, 1, 'แถบกลับต้องวางจุดเดียว')
})

test('ลิงก์ออกจากแบบเรียบส่ง state fromExec ไม่ทับ state เดิม (StaffDashboard อ่าน state.module) · แถบกลับอ่านอย่างเดียว ไม่เปิดแท็บใหม่', () => {
  const home = stripComments(read('src/components/staff/executive/ExecSimpleHome.jsx'))
  assert.ok(/navigate\(path, \{ state: \{ \.\.\.\(state \?\? \{\}\), fromExec: true, execReturnIdx:/.test(home))
  assert.ok(home.includes("leave('/staff', { module: link.module })"))
  assert.ok(home.includes('saveSimpleScroll(') && home.includes('takeSimpleScroll('))
  const bar = stripComments(read('src/components/staff/executive/ExecBackBar.jsx'))
  assert.ok(bar.includes('location.state?.fromExec !== true'))
  assert.ok(bar.includes("startsWith('/executive')"))
  assert.ok(/navigate\(-steps\)/.test(bar) && bar.includes("navigate('/executive')"))
  assert.ok(!/setState|state:\s*\{/.test(bar), 'แถบกลับห้ามเขียน state')
})

test('หน้าต่างลงนาม: ปุ่มย้อนกลับของมือถือ = ปิดหน้าต่าง (push state ผ่าน router) · ใช้หน้าต่างเดิม SignTripDialog ไม่แก้ของใช้ร่วม', () => {
  const sign = stripComments(read('src/components/staff/executive/ExecSimpleSign.jsx'))
  assert.ok(sign.includes("import SignTripDialog from '../../esign/SignTripDialog'"))
  assert.ok(/execSimpleSign: true/.test(sign) && /location\.state\?\.execSimpleSign === true/.test(sign))
  assert.ok(sign.includes('navigate(-1)'))
  assert.ok(sign.includes('esignPendingRow') && sign.includes('resubmitFleetTrip'))
})

test('prebuild + สคริปต์ test:exec-simple เดินสายแล้ว', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts['test:exec-simple'], 'node tests/executive-simple-view.test.mjs')
  assert.ok(pkg.scripts.prebuild.includes('node tests/executive-simple-view.test.mjs'))
})

console.log(`\n${cases} cases passed`)

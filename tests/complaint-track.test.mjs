// ลิงก์ติดตามเรื่องของผู้แจ้ง (/t/<โทเคน>) — ตรรกะหน้าเว็บ + ตรวจให้หน้าเว็บกับฐานข้อมูลตรงกัน (ไม่ใช้เครือข่าย ไม่แตะข้อมูลจริง)
//   node tests/complaint-track.test.mjs        (npm run test:complaint-track)
// ฝั่งฐานข้อมูลตรวจแยกที่ tests/complaint-track-db.test.mjs (ต้องใช้ PGlite)
//
// สิ่งที่ต้องไม่พัง: (1) ขั้นความคืบหน้าถูกในทุกสถานะ รวมเรื่องที่ถูกแจ้งกลับแล้ววนมารับเรื่องใหม่
// (2) วันที่เป็นเวลาไทย/ปีพุทธ ไม่ขึ้นกับ timezone เครื่อง (3) หน้าลิงก์ไม่อ้างข้อมูลส่วนบุคคลสักช่อง
// (4) ชื่อ RPC/พารามิเตอร์/รหัสผลลัพธ์/ลิสต์ role/จำนวนวัน ในหน้าเว็บ = ในฐานข้อมูล (5) ลิงก์เปิดได้โดยไม่ล็อกอิน
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TRACK_BUSY_MESSAGE, TRACK_RATE_ERRORS, TRACK_REOPEN_ERRORS, TRACK_REOPEN_WINDOW_DAYS, TRACK_TOKEN_PATTERN,
  buildTrackSteps, closedOnTime, copyText, formatTrackDate, formatTrackDateTime, isTrackBusy, isTrackFinished, isTrackToken,
  shareTrackLink, trackPath, trackShareText,
} from '../src/lib/complaintTrack.js'
import { OFFICIAL_ROLES } from '../src/lib/serviceAudience.js'
import { REOPEN_WINDOW_DAYS } from '../src/lib/complaintWorkflow.js'
import { moduleForPath } from '../src/lib/staffModules.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = async rel => (await readFile(path.join(root, rel), 'utf8')).replace(/\r\n/g, '\n')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

// ── 1) โทเคนและลิงก์ ─────────────────────────────────────────────────────────────────────────
await test('isTrackToken รับเฉพาะ 32 ตัวฐาน 16 ตัวพิมพ์เล็ก · เส้นทางเดาจาก trackPath', () => {
  const good = '0123456789abcdef0123456789abcdef'
  assert.equal(isTrackToken(good), true)
  for (const bad of [good.toUpperCase(), good.slice(1), good + 'a', '', null, undefined, 123, '../../etc/passwd', `${good.slice(0, 31)}g`, ` ${good}`, `${good}\n`])
    assert.equal(isTrackToken(bad), false, String(bad))
  assert.equal(trackPath(good), `/t/${good}`)
  assert.equal(TRACK_TOKEN_PATTERN.source, '^[0-9a-f]{32}$')
})

await test('ข้อความแชร์ไม่มีข้อมูลส่วนบุคคลและไม่ใส่ลิงก์ซ้ำ (ลิงก์ส่งแยกช่อง)', () => {
  const text = trackShareText({ orgName: 'อบต.ตัวอย่าง', refNo: 'ES-69-0123' })
  assert.match(text, /อบต\.ตัวอย่าง/)
  assert.match(text, /ES-69-0123/)
  assert.ok(!/https?:\/\//.test(text), 'ลิงก์ส่งเป็นพารามิเตอร์ url ของแผ่นแชร์ ไม่ต่อท้ายข้อความ (แอปแชตบางตัวแสดงซ้ำสองรอบ)')
  assert.ok(!/\d{9,}/.test(text), 'ห้ามมีตัวเลขยาวคล้ายเบอร์โทร')
  assert.equal(trackShareText({}), 'ติดตามเรื่องที่แจ้ง เปิดดูความคืบหน้าและให้คะแนนได้ที่ลิงก์นี้')
})

await test('shareTrackLink: ใช้แผ่นแชร์ถ้ามี · ผู้ใช้กดยกเลิกไม่ถือว่าล้มเหลวและไม่คัดลอกแทน · ไม่มี/ล้ม → คัดลอก', async () => {
  const calls = []
  const shared = await shareTrackLink({ url: 'https://x/t/a', text: 't', title: 'T' }, { navigator: { share: async arg => { calls.push(arg) } } })
  assert.equal(shared, 'shared')
  assert.deepEqual(calls, [{ title: 'T', text: 't', url: 'https://x/t/a' }])

  const copied = []
  const clip = { writeText: async v => { copied.push(v) } }
  const abort = Object.assign(new Error('x'), { name: 'AbortError' })
  assert.equal(await shareTrackLink({ url: 'u' }, { navigator: { share: async () => { throw abort }, clipboard: clip } }), 'cancelled')
  assert.deepEqual(copied, [], 'ยกเลิกแล้วต้องไม่แอบคัดลอก')

  assert.equal(await shareTrackLink({ url: 'u1' }, { navigator: { clipboard: clip } }), 'copied')
  assert.equal(await shareTrackLink({ url: 'u2' }, { navigator: { share: async () => { throw new Error('NotAllowedError') }, clipboard: clip } }), 'copied')
  assert.deepEqual(copied, ['u1', 'u2'])
  assert.equal(await shareTrackLink({ url: 'u' }, { navigator: {} }), 'failed')
})

await test('copyText: clipboard ถูกปฏิเสธ → ถอยไปวิธีเก่า (execCommand) · ไม่มีทั้งคู่ → false', async () => {
  const doc = {
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, setAttribute() {}, select() {} }),
    execCommand: command => command === 'copy',
  }
  assert.equal(await copyText('u', { navigator: { clipboard: { writeText: async () => { throw new Error('denied') } } }, document: doc }), true)
  assert.equal(await copyText('u', { navigator: {}, document: { ...doc, execCommand: () => false } }), false)
  assert.equal(await copyText('u', { navigator: {} }), false)
})

// ── 2) วันเวลา ───────────────────────────────────────────────────────────────────────────────
// เครื่องคนทำงานตั้งเวลาไทยอยู่แล้ว (+07:00) โค้ดที่ลืมล็อกเวลาไทยจึงผ่านเทสต์ได้เงียบๆ แต่พังบนเครื่องผู้ใช้ที่ตั้งเขตเวลาอื่น
// และบน CI (UTC) — จึงรันทุกข้อวันเวลาซ้ำใต้เขตเวลาที่ต่างกันสุดขั้ว
const withTimezone = async (zone, run) => {
  const previous = process.env.TZ
  process.env.TZ = zone
  try { await run() } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
}
const ZONES = ['Asia/Bangkok', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']

await test('วันที่ใช้เวลาไทย + ปีพุทธ 2 หลัก ข้ามเที่ยงคืนเวลาไทยถูกวัน (ทุกเขตเวลาของเครื่อง)', async () => {
  for (const zone of ZONES) {
    await withTimezone(zone, () => {
      assert.equal(formatTrackDate('2026-10-18T16:59:00Z'), '18 ต.ค. 69', zone) // 23:59 ไทย
      assert.equal(formatTrackDate('2026-10-18T17:00:00Z'), '19 ต.ค. 69', zone) // 00:00 ไทย
      assert.equal(formatTrackDateTime('2026-10-18T02:12:00Z'), '18 ต.ค. 69 · 09:12 น.', zone)
      assert.equal(formatTrackDateTime('2026-10-18T17:05:00Z'), '19 ต.ค. 69 · 00:05 น.', zone)
    })
  }
  for (const empty of [null, undefined, '', 'ไม่ใช่วันที่']) { assert.equal(formatTrackDate(empty), ''); assert.equal(formatTrackDateTime(empty), '') }
})

await test('closedOnTime: เทียบวันตามเวลาไทย (ทุกเขตเวลาของเครื่อง) ไม่ตัดสินเมื่อไม่มีข้อมูล', async () => {
  for (const zone of ZONES) {
    await withTimezone(zone, () => {
      assert.equal(closedOnTime('2026-10-20T16:59:00Z', '2026-10-20'), true, zone)   // 23:59 วันที่ 20 ไทย
      assert.equal(closedOnTime('2026-10-20T17:00:00Z', '2026-10-20'), false, zone)  // 00:00 วันที่ 21 ไทย
      assert.equal(closedOnTime('2026-10-10T05:00:00Z', '2026-10-20'), true, zone)
      assert.equal(closedOnTime('2026-10-20T05:00:00Z', '2026-10-20T00:00:00+07:00'), true, zone)
    })
  }
  for (const [a, b] of [[null, '2026-10-20'], ['2026-10-20T05:00:00Z', null], ['เสีย', '2026-10-20']]) assert.equal(closedOnTime(a, b), null)
})

// ── 3) ขั้นความคืบหน้า ───────────────────────────────────────────────────────────────────────
const base = { created_at: '2026-10-18T02:12:00Z', due_date: '2026-10-21', closed_at: null, timeline: [], is_adhoc: false }
const states = steps => steps.map(s => s.state)

await test('steps: รอรับเรื่อง (pending/new) → ขั้น 1 now ใช้เวลาแจ้ง · ขั้นที่ยังไม่ถึงไม่มีเวลา · ขั้นสุดท้ายบอกกำหนดเสร็จ', () => {
  for (const status of ['pending', 'new']) {
    const steps = buildTrackSteps({ ...base, status })
    assert.deepEqual(states(steps), ['now', 'todo', 'todo'])
    assert.equal(steps[0].label, 'รอเจ้าหน้าที่รับเรื่อง')
    assert.equal(steps[0].at, base.created_at)
    assert.equal(steps[1].at, null); assert.equal(steps[2].at, null)
    assert.equal(steps[2].note, 'กำหนดเสร็จภายใน 21 ต.ค. 69')
  }
  assert.equal(buildTrackSteps({ ...base, status: 'pending', due_date: null })[2].note, '')
})

await test('steps: รับเรื่องแล้ว / กำลังดำเนินการ / ดำเนินการแล้ว (ทันกำหนด · เลยกำหนดไม่ตัดสิน)', () => {
  const timeline = [{ status: 'received', at: '2026-10-18T03:00:00Z' }, { status: 'in_progress', at: '2026-10-19T01:00:00Z' }]
  const received = buildTrackSteps({ ...base, status: 'received', timeline: timeline.slice(0, 1) })
  assert.deepEqual(states(received), ['now', 'todo', 'todo'])
  assert.equal(received[0].label, 'รับเรื่องแล้ว'); assert.equal(received[0].at, '2026-10-18T03:00:00Z')

  const working = buildTrackSteps({ ...base, status: 'in_progress', timeline })
  assert.deepEqual(states(working), ['done', 'now', 'todo'])
  assert.equal(working[1].at, '2026-10-19T01:00:00Z')

  const onTime = buildTrackSteps({ ...base, status: 'closed', closed_at: '2026-10-20T08:00:00Z', timeline })
  assert.deepEqual(states(onTime), ['done', 'done', 'done'])
  assert.equal(onTime[2].at, '2026-10-20T08:00:00Z'); assert.equal(onTime[2].note, 'ทันกำหนด')

  const late = buildTrackSteps({ ...base, status: 'closed', closed_at: '2026-10-25T08:00:00Z', timeline })
  assert.equal(late[2].note, '', 'เลยกำหนดแสดงแค่วันที่จริง ไม่เขียนคำตัดสิน — ผู้อ่านเทียบวันกำหนดเองได้จากวันที่ของเรื่อง')
})

await test('steps: เรื่องที่แจ้งกลับแล้ววนกลับมารับเรื่อง → ขั้น 2-3 ว่าง ใช้เวลารับเรื่องรอบล่าสุด', () => {
  const timeline = [
    { status: 'received', at: '2026-10-18T03:00:00Z' }, { status: 'in_progress', at: '2026-10-19T01:00:00Z' },
    { status: 'closed', at: '2026-10-20T08:00:00Z' }, { status: 'received', at: '2026-10-22T02:00:00Z' },
  ]
  const steps = buildTrackSteps({ ...base, status: 'received', closed_at: null, timeline })
  assert.deepEqual(states(steps), ['now', 'todo', 'todo'])
  assert.equal(steps[0].at, '2026-10-22T02:00:00Z', 'ใช้รอบล่าสุด')
  assert.equal(steps[1].at, null, 'เวลา "กำลังดำเนินการ" ของรอบเก่าต้องไม่โผล่')
})

await test('steps: ขั้นเก่า done/completed นับเป็นดำเนินการแล้ว · สถานะแปลกๆ ถือเป็นขั้นรับเรื่อง ไม่พัง', () => {
  for (const status of ['done', 'completed', 'closed']) {
    assert.deepEqual(states(buildTrackSteps({ ...base, status, closed_at: '2026-10-20T08:00:00Z' })), ['done', 'done', 'done'], status)
    assert.equal(isTrackFinished(status), true)
  }
  assert.deepEqual(states(buildTrackSteps({ ...base, status: 'อะไรไม่รู้' })), ['now', 'todo', 'todo'])
  assert.deepEqual(states(buildTrackSteps(undefined)), ['now', 'todo', 'todo'])
  for (const status of ['pending', 'received', 'in_progress', 'rejected']) assert.equal(isTrackFinished(status), false)
})

await test('steps: ปฏิเสธ → 2 ขั้น (รับเรื่อง/ไม่สามารถดำเนินการได้) · เฉพาะกิจ → ขั้นเดียว ไม่ไล่สถานะ', () => {
  const rejected = buildTrackSteps({ ...base, status: 'rejected', closed_at: '2026-10-19T05:00:00Z' })
  assert.deepEqual(states(rejected), ['done', 'stop'])
  assert.equal(rejected[1].label, 'ไม่สามารถดำเนินการได้')
  const adhoc = buildTrackSteps({ ...base, status: 'pending', is_adhoc: true })
  assert.equal(adhoc.length, 1)
  assert.equal(adhoc[0].state, 'done')
})

// ── 4) ข้อความผิดพลาด ────────────────────────────────────────────────────────────────────────
await test('isTrackBusy แยกยิงถี่ (PT429) ออกจาก error อื่น', () => {
  assert.equal(isTrackBusy({ code: 'PT429' }), true)
  assert.equal(isTrackBusy({ message: 'เปิดดูถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' }), true)
  for (const other of [null, undefined, {}, { code: '42501', message: 'permission denied' }, { message: 'Failed to fetch' }]) assert.equal(isTrackBusy(other), false)
  assert.ok(TRACK_BUSY_MESSAGE.includes('ถี่เกินไป'))
})

// ── 5) หน้าเว็บ ↔ ฐานข้อมูล ───────────────────────────────────────────────────────────────────
const columnSql = await read('supabase/migrations/20261020160000_complaint_track_token_column.sql')
const functionsSql = await read('supabase/migrations/20261020160100_complaint_track_token_functions.sql')
const page = await read('src/pages/TrackComplaint.jsx')
const card = await read('src/components/complaints/TrackLinkCard.jsx')

// ตัดคอมเมนต์ออกก่อนสแกน ไม่งั้นคอมเมนต์ที่อธิบายว่า "ไม่แสดงเบอร์โทร" ทำให้สแกนแดงทั้งที่โค้ดถูก
const stripComments = source => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

await test('ชื่อฟังก์ชัน RPC และชื่อพารามิเตอร์ที่หน้าเว็บเรียก มีอยู่จริงในฐานข้อมูลและไม่เรียกตัวที่ไม่ใช่ของลิงก์', () => {
  const used = [...(stripComments(page) + stripComments(card)).matchAll(/\.rpc\(\s*'([a-z_]+)'\s*,\s*\{([^}]*)\}/g)]
  assert.deepEqual(used.map(m => m[1]).sort(), ['get_complaint_by_track_token', 'get_complaint_track_token', 'rate_complaint_by_track_token', 'reopen_complaint_by_track_token'])
  for (const [, name, args] of used) {
    const signature = new RegExp(`FUNCTION public\\.${name}\\(([^)]*)\\)`).exec(functionsSql)
    assert.ok(signature, `ไม่พบ ${name} ในฐานข้อมูล`)
    const declared = signature[1].split(',').map(p => p.trim().split(/\s+/)[0])
    const passed = [...args.matchAll(/\b([_a-z]+)\s*:/g)].map(m => m[1])
    assert.ok(passed.length > 0, name)
    for (const key of passed) assert.ok(declared.includes(key), `${name}: พารามิเตอร์ ${key} ไม่อยู่ในฟังก์ชัน (${declared.join(', ')})`)
  }
})

await test('รหัสผลลัพธ์ที่ฐานข้อมูลคืน ทุกตัวมีข้อความภาษาไทยรองรับ (already_rated หน้าเว็บถือว่าสำเร็จจึงไม่ต้องมี)', () => {
  const codesOf = fn => {
    const body = new RegExp(`FUNCTION public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`).exec(functionsSql)?.[0]
    assert.ok(body, fn)
    return [...new Set([...body.matchAll(/'code', '([a-z_]+)'/g)].map(m => m[1]))]
  }
  const rateCodes = codesOf('rate_complaint_by_track_token').filter(c => c !== 'already_rated')
  const reopenCodes = codesOf('reopen_complaint_by_track_token')
  assert.deepEqual(rateCodes.sort(), Object.keys(TRACK_RATE_ERRORS).sort())
  assert.deepEqual(reopenCodes.sort(), Object.keys(TRACK_REOPEN_ERRORS).sort())
  for (const message of [...Object.values(TRACK_RATE_ERRORS), ...Object.values(TRACK_REOPEN_ERRORS)]) assert.match(message, /[ก-๙]/)
})

await test('ค่าคงที่ตรงกันสองฝั่ง: รูปแบบโทเคน · 7 วัน · ลิสต์ role ผู้มีตำแหน่ง', () => {
  // ต้องเจาะจงถึงตัว CHECK เอง — รูปแบบเดียวกันโผล่ในคอมเมนต์ "ตรวจหลัง apply" ด้วย ถ้า includes เฉยๆ จะผ่านทั้งที่ CHECK เพี้ยน
  assert.ok(columnSql.includes(`CHECK (track_token ~ '${TRACK_TOKEN_PATTERN.source}')`), 'CHECK ของคอลัมน์ต้องใช้รูปแบบเดียวกับหน้าเว็บ')
  assert.ok(functionsSql.includes(`_token !~ '${TRACK_TOKEN_PATTERN.source}'`), 'ฟังก์ชันต้องตรวจรูปแบบเดียวกับหน้าเว็บ')
  assert.equal(TRACK_REOPEN_WINDOW_DAYS, REOPEN_WINDOW_DAYS)
  const sqlDays = [...functionsSql.matchAll(/interval '(\d+) days'/g)].map(m => Number(m[1]))
  assert.ok(sqlDays.length >= 3 && sqlDays.every(d => d === REOPEN_WINDOW_DAYS), `ตัวเลขวันในฐานข้อมูล: ${sqlDays}`)
  const helper = /FUNCTION public\.complaint_track_caller_is_staff\(\)[\s\S]*?\$\$;/.exec(functionsSql)[0]
  const sqlRoles = [...helper.matchAll(/'([a-z]+)'/g)].map(m => m[1])
  assert.deepEqual([...sqlRoles].sort(), [...OFFICIAL_ROLES].sort(), 'ผู้มีตำแหน่งต้องเป็นชุดเดียวกับ serviceAudience.js')
})

await test('หน้าลิงก์ไม่อ้างข้อมูลส่วนบุคคล/ตัวระบุภายในสักช่อง (ชื่อ เบอร์ พิกัด รายละเอียด id ผู้ใช้ ผู้รับผิดชอบ รูป)', () => {
  const code = stripComments(page)
  for (const forbidden of ['phone', 'reporter_name', 'latitude', 'longitude', 'assigned_to', 'user_id', 'attachments', 'work_photos', 'detail', 'subject', 'actor_name'])
    assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(code), `หน้าลิงก์ห้ามอ้าง ${forbidden}`)
  assert.ok(!/\bdata\.id\b/.test(code))
  assert.ok(!/localStorage|sessionStorage/.test(code), 'ไม่เก็บอะไรในเครื่องผู้ใช้')
})

await test('หน้าลิงก์: ซ่อนจากผลค้นหา (noindex) · ตัวส่งต่อไม่รอเครือข่ายก่อนเรียกแผ่นแชร์ (iOS ปฏิเสธถ้าเลยจังหวะแตะ)', () => {
  assert.match(page, /meta\.name = 'robots'/)
  assert.match(page, /meta\.content = 'noindex'/)
  const share = /async function share\(\) \{[\s\S]*?\n  \}/.exec(card)?.[0]
  assert.ok(share, 'ไม่พบฟังก์ชัน share')
  assert.ok(!/supabase|await fetch/.test(share), 'share() ต้องไม่รอเครือข่ายก่อนเรียกแผ่นแชร์ — ดึงโทเคนไว้ล่วงหน้าตอน mount')
  assert.match(card, /useEffect\([\s\S]*get_complaint_track_token/)
})

await test('เส้นทาง /t/:token เปิดได้โดยไม่ล็อกอินและไม่ผูกโมดูล · การ์ดอยู่ครบ 3 จุดและมีด่านผู้ยื่น', async () => {
  const app = await read('src/App.jsx')
  const line = app.split('\n').find(l => l.includes('path="/t/:token"'))
  assert.ok(line, 'ไม่พบ route')
  assert.match(line, /element=\{<TrackComplaint \/>\}/, 'ห้ามห่อด้วย RequireAuth')
  assert.match(app, /lazyWithRetry\(\(\) => import\('\.\/pages\/TrackComplaint'\)\)/)
  assert.equal(moduleForPath(trackPath('0123456789abcdef0123456789abcdef')), null, 'ลิงก์ต้องไม่ถูกโมดูลของ อปท. ปิดทั้งหน้า')

  const form = await read('src/pages/CitizenForm.jsx')
  assert.match(form, /\{isLoggedIn && complaintId && \(\s*<TrackLinkCard/, 'ผู้ยื่นที่ไม่ล็อกอินไม่มีการ์ด (ติดตามด้วยเลขอ้างอิงตามเดิม)')
  const mine = await read('src/pages/MyComplaints.jsx')
  assert.match(mine, /currentUserId && c\.user_id === currentUserId && !isAdhocComplaint\(c\) && \(\s*<TrackLinkCard/)
  const oss = await read('src/components/admin/OssIntakeForm.jsx')
  assert.match(oss, /<TrackLinkCard complaintId=\{result\.id\}/)
})

console.log(`\nครบ ${cases} กลุ่ม`)

// แจ้งเตือน Web Push เรื่องคำร้อง (supabase/functions/send-push + _shared/complaintPush.ts)
// รันด้วย: node tests/complaint-push.test.mjs
//
// ทำไมต้องมี (2569-10-28): send-push เคยมีโหมด "ส่งทั้ง อปท." ที่ไม่ต้องล็อกอิน ส่งถึงทุกเครื่องของ อปท.
// รวมเครื่องประชาชน พร้อมข้อความที่ประชาชนพิมพ์ 100 ตัวแรก — พอ #599 เปิดปุ่มสมัครรับให้ทุกคน
// รายละเอียดคำร้องจะไปขึ้นจอล็อกของประชาชนคนอื่น และใครก็ยิงข้อความเองถึงทุกเครื่องได้
// ชั้นแรก: รันตรรกะล้วนของจริง (ผู้รับ "คำร้องใหม่" · ข้อความทุกชนิด · เรื่องลับ · เวลาเพิ่งเกิด)
// ชั้นสอง: อ่านโค้ด index.ts + หน้าเว็บทุกจุดที่เรียก — ผู้เรียกส่งได้แค่ complaint_id + kind

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const Push = await import('../supabase/functions/_shared/complaintPush.ts')

// ── ชนิดที่รองรับ ─────────────────────────────────────────────────────────────
assert.deepEqual([...Push.COMPLAINT_PUSH_KINDS], ['complaint_finished', 'complaint_created', 'complaint_note', 'complaint_photo'])
for (const kind of Push.COMPLAINT_PUSH_KINDS) assert.equal(Push.isComplaintPushKind(kind), true, kind)
for (const bad of [undefined, null, '', 'broadcast', 'COMPLAINT_CREATED', 1]) assert.equal(Push.isComplaintPushKind(bad), false, String(bad))

// ── ผู้รับ "คำร้องใหม่" = คนที่ list_complaints_for_staff() ให้เห็นเรื่องนี้ และเป็นคนลงมือ ──
const A = 'muni-a'
const B = 'muni-b'
const departments = [
  { id: 'd-eng', municipality_id: A, name: 'กองช่าง', short_name: 'กช', code: 'eng' },
  { id: 'd-office', municipality_id: A, name: 'สำนักปลัด', short_name: null, code: null },
  { id: 'd-eng-b', municipality_id: B, name: 'กองช่าง', short_name: 'กช', code: 'eng' },
]
const profiles = [
  { id: 'admin-a', role: 'admin', municipality_id: A, department_id: null },
  { id: 'admin-b', role: 'admin', municipality_id: B, department_id: null },
  { id: 'officer-eng', role: 'officer', municipality_id: A, department_id: 'd-eng' },
  { id: 'staff-eng', role: 'staff', municipality_id: A, department_id: 'd-eng' },
  { id: 'officer-office', role: 'officer', municipality_id: A, department_id: 'd-office' },
  { id: 'officer-nodept', role: 'officer', municipality_id: A, department_id: null },
  // กองที่ผูกไว้เป็นของ อปท. อื่น — ชื่อตรงก็ไม่นับ (ตาม p.municipality_id = d.municipality_id ใน DB)
  { id: 'officer-wrong-muni-dept', role: 'officer', municipality_id: A, department_id: 'd-eng-b' },
  { id: 'officer-b', role: 'officer', municipality_id: B, department_id: 'd-eng-b' },
  { id: 'tech-eng', role: 'technician', municipality_id: A, department_id: 'd-eng' },
  { id: 'viewer-a', role: 'viewer', municipality_id: A, department_id: 'd-eng' },
  { id: 'council-a', role: 'council', municipality_id: A, department_id: null },
  { id: 'kamnan-a', role: 'kamnan', municipality_id: A, department_id: null },
  { id: 'citizen-a', role: 'citizen', municipality_id: A, department_id: null },
  { id: 'nobody', role: null, municipality_id: A, department_id: null },
  { id: 'super', role: 'superadmin', municipality_id: null, department_id: null },
]
const pick = (complaint, adhoc = false) =>
  Push.pickNewComplaintRecipients({ municipality_id: A, department: null, assigned_to: null, ...complaint }, adhoc, profiles, departments).sort()

assert.deepEqual(pick({ department: 'กองช่าง' }), ['admin-a', 'officer-eng', 'staff-eng', 'super'])
// ชื่อย่อ/รหัส ไม่สนตัวพิมพ์และช่องว่างหัวท้าย เหมือน complaint_matches_my_department()
assert.deepEqual(pick({ department: '  ENG ' }), ['admin-a', 'officer-eng', 'staff-eng', 'super'])
assert.deepEqual(pick({ department: 'กช' }), ['admin-a', 'officer-eng', 'staff-eng', 'super'])
assert.deepEqual(pick({ department: 'สำนักปลัด' }), ['admin-a', 'officer-office', 'super'])
// department ว่าง: ไม่ตรงกับกองไหน (ฝั่ง SQL '' ไปตรงกับกองที่ไม่มีชื่อย่อ/รหัส — แจ้งเตือนแคบกว่า ไม่กว้างกว่า)
assert.deepEqual(pick({ department: '' }), ['admin-a', 'super'])
assert.deepEqual(pick({ department: null }), ['admin-a', 'super'])
// ผู้ถูกมอบหมายได้เสมอ แม้กองไม่ตรง
assert.deepEqual(pick({ department: 'กองช่าง', assigned_to: 'officer-office' }), ['admin-a', 'officer-eng', 'officer-office', 'staff-eng', 'super'])
// หมวดเฉพาะกิจ: เฉพาะผู้ถูกมอบหมาย + admin (ไม่ไล่ตามกอง)
assert.deepEqual(pick({ department: 'กองช่าง' }, true), ['admin-a', 'super'])
assert.deepEqual(pick({ department: 'กองช่าง', assigned_to: 'staff-eng' }, true), ['admin-a', 'staff-eng', 'super'])
// ช่างที่ถูกมอบหมายไม่ได้ "คำร้องใหม่" (กระดิ่งของช่างแสดงเฉพาะงานที่รับแล้ว)
assert.deepEqual(pick({ department: 'กองช่าง', assigned_to: 'tech-eng' }), ['admin-a', 'officer-eng', 'staff-eng', 'super'])
// ห้ามมีประชาชน / ผู้ดูอย่างเดียว / คนของ อปท. อื่น ไม่ว่ากรณีไหน
for (const complaint of [{ department: 'กองช่าง' }, { department: 'eng', assigned_to: 'citizen-a' }, { department: null, assigned_to: 'viewer-a' }]) {
  const ids = pick(complaint)
  for (const outsider of ['citizen-a', 'viewer-a', 'council-a', 'kamnan-a', 'nobody', 'admin-b', 'officer-b', 'officer-wrong-muni-dept', 'tech-eng']) {
    assert.equal(ids.includes(outsider), false, `${outsider} ต้องไม่ได้แจ้งเตือนคำร้องใหม่ (${JSON.stringify(complaint)})`)
  }
}
assert.deepEqual(Push.NEW_COMPLAINT_PUSH_ROLES, ['superadmin', 'admin', 'officer', 'staff'])

// ── ข้อความ: มีแค่เลขที่ + ชื่อหมวด ไม่มีช่องให้ใส่รายละเอียดที่ประชาชนพิมพ์ ──────────
const created = Push.complaintPushMessage('complaint_created', { label: '💡 ไฟฟ้าส่องสว่าง', complaintNumber: 'NL-69-0042' })
assert.deepEqual(created, { title: 'คำร้องใหม่', body: 'เลขที่ NL-69-0042 · ไฟฟ้าส่องสว่าง', url: '/staff' })
assert.equal(Push.complaintPushMessage('complaint_created', { label: '', complaintNumber: null }).body, 'มีคำร้องใหม่เข้าระบบ')
assert.deepEqual(
  Push.complaintPushMessage('complaint_note', { label: '🌳 ตัดต้นไม้' }),
  { title: 'เจ้าหน้าที่บันทึกข้อความถึงคุณ', body: 'มีบันทึกใหม่ในคำร้องตัดต้นไม้', url: '/my-complaints' },
)
assert.deepEqual(
  Push.complaintPushMessage('complaint_photo', { label: '🛠️ ซ่อมประปา' }),
  { title: 'มีรูปหลักฐานการทำงานใหม่', body: 'เจ้าหน้าที่เพิ่มรูปความคืบหน้าในคำร้องซ่อมประปา', url: '/my-complaints' },
)
// เรื่องลับไม่ขึ้นชื่อหมวดบนจอล็อก — ทั้งจอผู้แจ้งและจอเจ้าหน้าที่
for (const kind of Push.COMPLAINT_PUSH_KINDS) {
  const message = Push.complaintPushMessage(kind, { label: '🚨 ทุจริตประพฤติมิชอบ', confidential: true, complaintNumber: 'NL-69-0043' })
  assert.doesNotMatch(`${message.title} ${message.body}`, /ทุจริต/, kind)
  // ลิงก์ในแจ้งเตือนต้องเป็น path ภายในเว็บ — sw.js เปิดลิงก์ตรงๆ "//host" พาออกไปเว็บอื่นได้
  assert.match(message.url, /^\/(?![/\\])/, kind)
}
assert.equal(Push.complaintPushMessage('complaint_created', { label: 'ทุจริต', confidential: true, complaintNumber: 'NL-69-0043' }).body, 'เลขที่ NL-69-0043')
assert.equal(Push.complaintPushMessage('complaint_note', { label: 'ทุจริต', confidential: true }).body, 'มีบันทึกใหม่ในคำร้องของคุณ')
assert.equal(Push.complaintPushMessage('complaint_photo', { label: 'ทุจริต', confidential: true }).body, 'เจ้าหน้าที่เพิ่มรูปความคืบหน้าในคำร้องของคุณ')
// ไฟล์ตรรกะไม่อ่านรายละเอียด/ชื่อ/เบอร์ของคำร้องเลย
assert.doesNotMatch(stripComments(read('supabase/functions/_shared/complaintPush.ts')), /\b(detail|phone|reporter_name|location|address)\b/)

// ── "เพิ่งเกิด" (ยื่นใหม่/เพิ่งปิด) — กันยิงซ้ำย้อนหลัง ─────────────────────────
const now = Date.parse('2026-10-28T10:00:00Z')
const minutesAgo = (m) => new Date(now - m * 60_000).toISOString()
assert.equal(Push.PUSH_FRESH_WINDOW_MS, 15 * 60 * 1000)
assert.equal(Push.isFreshTimestamp(minutesAgo(0), now), true)
assert.equal(Push.isFreshTimestamp(minutesAgo(14), now), true)
assert.equal(Push.isFreshTimestamp(minutesAgo(16), now), false)
assert.equal(Push.isFreshTimestamp(minutesAgo(-0.5), now), true, 'นาฬิกาคลาดเล็กน้อยยังถือว่าเพิ่งเกิด')
assert.equal(Push.isFreshTimestamp(minutesAgo(-5), now), false, 'เวลาในอนาคตไกลไม่ใช่ "เพิ่งเกิด"')
for (const bad of [null, undefined, '', 'not-a-date', 1730000000000]) assert.equal(Push.isFreshTimestamp(bad, now), false, String(bad))

// ── index.ts: ถอดโหมดข้อความอิสระ — อ่านจากคำขอแค่ complaint_id + kind (+ endpoint ของปุ่มส่งทดสอบ) ──
const edge = stripComments(read('supabase/functions/send-push/index.ts'))
const requestKeys = edge.match(/const \{ ([^}]+) \} = \(await req\.json\(\)/)?.[1]
assert.equal(requestKeys, 'complaint_id, kind, endpoint', 'send-push ต้องอ่านจากคำขอแค่ complaint_id, kind และ endpoint')
// endpoint ส่งต่อได้ที่เดียวคือชนิดส่งทดสอบ (ส่งถึงเครื่องของผู้กดเอง — tests/push-test-devices.test.mjs)
assert.match(edge, /if \(kind === SELF_TEST_KIND\) return await handleSelfTest\(supabase, req, endpoint\)/)
// (ไม่นับคำว่า endpoint ในสตริงชื่อคอลัมน์)
const endpointLines = edge.slice(edge.indexOf('\nserve(')).replace(/\r\n/g, '\n').split('\n')
  .filter((line) => /\bendpoint\b/.test(line.replace(/'[^']*'/g, "''")))
  .map((line) => line.trim())
assert.equal(endpointLines.length, 2, `endpoint จากคำขอต้องไปที่ handleSelfTest ที่เดียว: ${endpointLines.join(' | ')}`)
assert.ok(endpointLines[0].startsWith('const { complaint_id, kind, endpoint } = '))
assert.equal(endpointLines[1], 'if (kind === SELF_TEST_KIND) return await handleSelfTest(supabase, req, endpoint)')
assert.doesNotMatch(edge, /\b(title|body|url|user_id|municipality_id)\s*\?:\s*(string|unknown)/, 'ห้ามรับ title/body/url/user_id/municipality_id จากผู้เรียก')
assert.match(edge, /if \(!isComplaintPushKind\(kind\)\) return jsonResponse\(\{ error: 'unknown kind' \}, 400\)/)
// ยื่นคำร้องได้โดยไม่ล็อกอิน: complaint_created ไม่ตรวจผู้เรียก แต่ต้องเป็นคำร้องที่เพิ่งยื่น
assert.match(edge, /if \(pushKind === 'complaint_created'\) \{\s*if \(!isFreshTimestamp\(row\.created_at, Date\.now\(\)\)\)/)
// ชนิดอื่นต้องเป็นเจ้าหน้าที่ของ อปท. เดียวกันเท่านั้น
assert.match(edge, /\} else \{\s*const denied = await denyUnlessComplaintStaff\(supabase, req, row\)/)
// ผู้รับ: ชนิดฝั่งเจ้าหน้าที่มาจากกติกากลาง · ชนิดฝั่งประชาชนคือเจ้าของคำร้องคนเดียว
assert.match(edge, /\? await newComplaintRecipients\(supabase, row, category\.adhoc\)/)
assert.match(edge, /: \(row\.user_id \? \[row\.user_id\] : \[\]\)/)
assert.match(edge, /\.in\('user_id', userIds\)/)
assert.match(edge, /if \(pushKind === 'complaint_created'\) query = query\.eq\('municipality_id', row\.municipality_id\)/)
// ข้อความมาจากกติกากลางเท่านั้น
assert.match(edge, /const message = complaintPushMessage\(pushKind, \{/)
assert.doesNotMatch(edge, /let message|message = \{/)

// ── หน้าเว็บทุกจุดที่เรียก send-push ส่งแค่ { complaint_id, kind } ─────────────────
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const allCallers = walk(path.join(root, 'src'))
  .filter((file) => /\.(jsx?|tsx?)$/.test(file))
  .flatMap((file) => {
    const source = stripComments(readFileSync(file, 'utf8'))
    return [...source.matchAll(/invoke\('send-push', \{\s*body: \{([^}]*)\}/g)].map((m) => ({ file: path.relative(root, file).replace(/\\/g, '/'), body: m[1].trim() }))
  })
// ปุ่มส่งทดสอบถึงเครื่องตัวเองเป็นจุดเรียกเดียวที่ไม่ใช่คำร้อง — ส่งได้แค่ kind + endpoint ของตัวเอง
const selfTestCallers = allCallers.filter((c) => c.file === 'src/lib/pushDevices.js')
assert.deepEqual(selfTestCallers.map((c) => c.body), ["kind: 'self_test', endpoint"])
const callers = allCallers.filter((c) => c.file !== 'src/lib/pushDevices.js')
const callerFiles = callers.map((c) => c.file).sort()
assert.deepEqual(callerFiles, [
  'src/components/admin/ComplaintsManager.jsx',
  'src/lib/complaintFinish.js',
  'src/pages/CitizenForm.jsx',
  'src/pages/TechnicianDashboard.jsx',
])
const kindsUsed = new Set()
for (const { file, body } of callers) {
  const keys = body.split(',').map((part) => part.split(':')[0].trim()).filter(Boolean)
  assert.deepEqual(keys, ['complaint_id', 'kind'], `${file} ต้องส่งแค่ complaint_id และ kind (เจอ: ${body})`)
  const kind = body.match(/kind: '([a-z_]+)'/)?.[1]
  assert.ok(Push.isComplaintPushKind(kind), `${file} ใช้ชนิดที่ server ไม่รู้จัก: ${kind}`)
  kindsUsed.add(kind)
}
assert.deepEqual([...kindsUsed].sort(), [...Push.COMPLAINT_PUSH_KINDS].sort(), 'ทุกชนิดต้องมีจุดเรียกจริง')
// จุดเรียกในหน้าเว็บต้องไม่พึ่ง user_id ของผู้ร้อง (officer/staff ไม่ได้มากับรายการตาม PDPA)
for (const file of callerFiles) {
  const source = stripComments(read(file))
  const near = [...source.matchAll(/[\s\S]{0,240}invoke\('send-push'/g)].map((m) => m[0]).join('\n')
  assert.doesNotMatch(near, /\buser_id\b/, `${file} ต้องไม่ตัดสินจาก user_id ของผู้ร้อง`)
}

console.log('✓ complaint-push: ผ่านทุกข้อ')

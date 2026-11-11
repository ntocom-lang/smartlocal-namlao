// ห้องผู้บริหาร E3-2 ฝั่งหน้าจอ: "เรื่องเลยกำหนด + ⭐ ติดตาม + ส่งให้กองเร่งรัด"
//   ชั้นแรก: ฟังก์ชัน pure ของจริง (src/lib/execFollowNudgeHelpers.js) — ป้ายผลส่ง · canRetry ขอบ 10 นาที · วันทำการ · จัดกลุ่ม · สิทธิ์ปุ่ม
//   ชั้นสอง: อ่านซอร์ส — ไม่ใช้ functions.invoke กับ exec-nudge-notify (timeout 25 วิ) · ไม่มีข้อมูลส่วนบุคคลในไฟล์ใหม่ · ปุ่มเร่งผูกกับสิทธิ์
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่ส่งข้อความจริง
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// โซนเวลาเครื่องเป็นต่างประเทศ: โค้ดที่อ่านวันจากเวลาเครื่องแทนเวลาไทยจะพังในเคสข้ามวัน
process.env.TZ = 'America/Los_Angeles'
const H = await import('../src/lib/execFollowNudgeHelpers.js')
const { workingDaysSince } = await import('../src/lib/workingDays.js')
const { BASE_DOCUMENT_TYPES } = await import('../src/lib/documentTypes.js')

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

// ── ป้ายผลการส่ง ─────────────────────────────────────────────────────────────

test('ป้ายผลส่งทุกค่า: dm/group = ok · none/failed = warn · pending/sending = wait ตามถ้อยคำที่เจ้าของระบบกำหนด', () => {
  assert.deepEqual(H.nudgeDeliveryText('dm'), { label: 'ส่งถึงหัวหน้ากองทาง Telegram ส่วนตัวแล้ว', tone: 'ok', note: null })
  assert.deepEqual(H.nudgeDeliveryText('group'), { label: 'ส่งเข้ากลุ่ม Telegram ของหน่วยงานแล้ว', tone: 'ok', note: null })
  assert.equal(H.nudgeDeliveryText('none').label, 'ไม่ได้ส่ง')
  assert.equal(H.nudgeDeliveryText('none').tone, 'warn')
  assert.equal(H.nudgeDeliveryText('failed').label, 'ส่งไม่สำเร็จ — กดส่งซ้ำได้')
  assert.equal(H.nudgeDeliveryText('failed').tone, 'warn')
  for (const d of ['pending', 'sending']) {
    assert.equal(H.nudgeDeliveryText(d).label, 'กำลังส่ง…')
    assert.equal(H.nudgeDeliveryText(d).tone, 'wait')
  }
})

test('ค่า delivery ที่ไม่รู้จัก/ว่าง = "ไม่ทราบผล" ระดับเตือน ไม่ใช่ ok (ห้ามบอกว่าส่งถึงโดยไม่รู้)', () => {
  for (const d of [undefined, null, '', 'weird']) {
    const r = H.nudgeDeliveryText(d)
    assert.equal(r.label, 'ไม่ทราบผลการส่ง')
    assert.equal(r.tone, 'warn')
  }
})

test('note จากเซิร์ฟเวอร์ถูกแนบเสมอ (ตัดช่องว่าง) · note ว่าง = null', () => {
  assert.equal(H.nudgeDeliveryText('none', '  ไม่มีช่องทางส่ง: ผอ.กองยังไม่ได้ผูก Telegram  ').note, 'ไม่มีช่องทางส่ง: ผอ.กองยังไม่ได้ผูก Telegram')
  assert.equal(H.nudgeDeliveryText('dm', '   ').note, null)
  assert.equal(H.nudgeDeliveryText('dm', 42).note, null)
})

test('ข้อความผลกดเร่ง: sent ประกอบ ป้าย + note · none บอกเหตุที่ไม่ถึง', () => {
  const sent = H.nudgeResultMessage({ outcome: 'sent', delivery: 'dm', note: 'ถึง ผอ.กองช่าง 1 คน' })
  assert.equal(sent.tone, 'ok')
  assert.equal(sent.text, 'ส่งถึงหัวหน้ากองทาง Telegram ส่วนตัวแล้ว — ถึง ผอ.กองช่าง 1 คน')
  const none = H.nudgeResultMessage({ outcome: 'sent', delivery: 'none', note: 'ไม่มีช่องทางส่ง' })
  assert.equal(none.tone, 'warn')
  assert.match(none.text, /^ไม่ได้ส่ง — ไม่มีช่องทางส่ง$/)
  assert.equal(H.nudgeResultMessage({ outcome: 'sent', delivery: 'group' }).text, 'ส่งเข้ากลุ่ม Telegram ของหน่วยงานแล้ว')
})

test('Edge Function ต่อไม่ติด = "ส่งไม่สำเร็จ — กดส่งซ้ำได้หลัง 10 นาที" · หมดเวลา = ยังไม่ทราบผล (ไม่บอกว่าพลาด) · in_progress = กำลังส่ง', () => {
  assert.equal(H.nudgeResultMessage({ outcome: 'edge_unreachable' }).text, 'ส่งไม่สำเร็จ — กดส่งซ้ำได้หลัง 10 นาที')
  const timeout = H.nudgeResultMessage({ outcome: 'timeout' })
  assert.match(timeout.text, /ยังไม่ทราบผลการส่ง/)
  assert.doesNotMatch(timeout.text, /ส่งไม่สำเร็จ/)
  assert.equal(H.nudgeResultMessage({ outcome: 'in_progress' }).tone, 'wait')
})

test('already_today: บอกตำแหน่งผู้เร่งเดิม + เวลาไทย + ผลส่ง (ไม่ใช่ชื่อคน) · ไม่มีข้อมูลเดิม = ใช้คำว่าผู้บริหาร', () => {
  const m = H.nudgeResultMessage({
    outcome: 'already_today',
    existing: { at: '2026-11-11T03:15:00Z', by: 'นายกเทศมนตรี', delivery: 'group' }, // 10:15 น. ไทย
  })
  assert.equal(m.tone, 'warn')
  assert.match(m.text, /^วันนี้ นายกเทศมนตรี เร่งเรื่องนี้ไปแล้ว เมื่อ .*10:15 น\. · ส่งเข้ากลุ่ม Telegram ของหน่วยงานแล้ว$/)
  assert.match(H.nudgeResultMessage({ outcome: 'already_today', existing: null }).text, /^วันนี้ ผู้บริหาร เร่งเรื่องนี้ไปแล้ว/)
})

test('วันเวลาไทยไม่พึ่งโซนเครื่อง (เครื่องตั้ง Los_Angeles): 17:30Z = 00:30 ไทยของวันถัดไป', () => {
  assert.match(H.thaiDateTime('2026-11-09T17:30:00Z'), /^10 พ\.ย\. 2569 00:30 น\.$/)
  assert.equal(H.thaiDateTime('not-a-date'), '—')
  assert.equal(H.thaiDateTime(null), '—')
})

// ── canRetry / nudgeBlocked ───────────────────────────────────────────────────

const T0 = '2026-11-11T03:00:00Z'
const ms = (iso) => new Date(iso).getTime()

test('canRetry: failed กดซ้ำได้ทันที', () => {
  assert.equal(H.canRetry({ delivery: 'failed', at: T0 }, new Date(T0)), true)
})

test('canRetry: pending/sending ขอบ 10 นาที — ครบพอดี = ยังไม่ได้ · เกิน 1 มิลลิวินาที = ได้ (ตรง "< now - 10 minutes" ใน SQL)', () => {
  for (const delivery of ['pending', 'sending']) {
    const n = { delivery, at: T0 }
    assert.equal(H.canRetry(n, new Date(ms(T0) + 9 * 60_000 + 59_999)), false)
    assert.equal(H.canRetry(n, new Date(ms(T0) + 10 * 60_000)), false)
    assert.equal(H.canRetry(n, new Date(ms(T0) + 10 * 60_000 + 1)), true)
  }
})

test('canRetry: ส่งถึงแล้ว (dm/group/none) ไม่เปิดให้กดซ้ำ · ไม่มีข้อมูล/เวลาเสีย = false', () => {
  for (const delivery of ['dm', 'group', 'none']) assert.equal(H.canRetry({ delivery, at: T0 }, new Date('2030-01-01T00:00:00Z')), false)
  assert.equal(H.canRetry(null, new Date()), false)
  assert.equal(H.canRetry(undefined, new Date()), false)
  assert.equal(H.canRetry({ delivery: 'pending', at: 'garbage' }, new Date()), false)
  assert.equal(H.canRetry({ delivery: 'pending', at: null }, new Date()), false)
})

test('nudgeBlocked: ปิดปุ่มเฉพาะ "วันนี้เร่งแล้ว และยังกดซ้ำไม่ได้" · เร่งเมื่อวาน/ไม่เคยเร่ง = เปิด · ส่งพลาดวันนี้ = เปิด', () => {
  const now = new Date(ms(T0) + 60_000)
  assert.equal(H.nudgeBlocked({ nudged_today: false, nudge: { delivery: 'dm', at: '2026-11-10T03:00:00Z' } }, now), false)
  assert.equal(H.nudgeBlocked({ nudged_today: false, nudge: null }, now), false)
  assert.equal(H.nudgeBlocked({ nudged_today: true, nudge: { delivery: 'dm', at: T0 } }, now), true)
  assert.equal(H.nudgeBlocked({ nudged_today: true, nudge: { delivery: 'failed', at: T0 } }, now), false)
  assert.equal(H.nudgeBlocked({ nudged_today: true, nudge: { delivery: 'pending', at: T0 } }, now), true)
  assert.equal(H.nudgeBlocked({ nudged_today: true, nudge: { delivery: 'pending', at: T0 } }, new Date(ms(T0) + 11 * 60_000)), false)
})

// ── วันทำการที่เลยกำหนด ──────────────────────────────────────────────────────

test('วันทำการที่เลยมา = workingDaysSince ตัวเดียวกับ E2 · ข้ามเสาร์-อาทิตย์ · ไม่ติดลบ · due ผิดรูป = 0', () => {
  // ศุกร์ 6 พ.ย. → จันทร์ 9 พ.ย. 2569 = 1 วันทำการ (ไม่นับเสาร์-อาทิตย์)
  assert.equal(H.overdueWorkingDays('2026-11-06', '2026-11-09'), 1)
  assert.equal(H.overdueWorkingDays('2026-11-06', '2026-11-09'), workingDaysSince('2026-11-06', '2026-11-09'))
  assert.equal(H.overdueWorkingDays('2026-11-09', '2026-11-09'), 0)
  assert.equal(H.overdueWorkingDays('2026-11-20', '2026-11-09'), 0) // กำหนดยังไม่ถึง
  assert.equal(H.overdueWorkingDays('2026-11-06T00:00:00+07:00', '2026-11-09'), 1) // ตัดส่วนเวลา
  for (const bad of [null, undefined, '', 'x', 123]) assert.equal(H.overdueWorkingDays(bad, '2026-11-09'), 0)
})

// ── จัดกลุ่มรายกอง ───────────────────────────────────────────────────────────

const it = (id, due, deptId, dept, k = 'complaint') => ({ k, id, ref: id, s: 'received', due, dept_id: deptId, dept })

test('จัดกลุ่มรายกอง: กองที่เลยเยอะก่อน · เท่ากัน = กองที่มีเรื่องเก่าสุดก่อน · กองไม่ระบุท้ายสุด · ในกองเรียง due เก่าก่อน', () => {
  const items = [
    it('a1', '2026-11-03', 'D-A', 'กองช่าง'),
    it('b1', '2026-10-01', 'D-B', 'กองคลัง'),
    it('b2', '2026-10-20', 'D-B', 'กองคลัง'),
    it('n1', '2026-09-01', null, null),
    it('a2', '2026-11-01', 'D-A', 'กองช่าง'),
    it('c1', '2026-10-15', 'D-C', 'กองการศึกษา'),
    it('c2', '2026-10-16', 'D-C', 'กองการศึกษา'),
  ]
  const groups = H.groupByDept(items, '2026-11-11')
  assert.deepEqual(groups.map((g) => g.name), ['กองคลัง', 'กองการศึกษา', 'กองช่าง', H.EXEC_NO_DEPT_LABEL])
  assert.deepEqual(groups[0].items.map((i) => i.id), ['b1', 'b2'])
  assert.deepEqual(groups[2].items.map((i) => i.id), ['a2', 'a1']) // เรียง due เก่าสุดก่อน แม้ข้อมูลเข้ามาสลับ
  assert.equal(groups[3].deptId, null)
})

test('จัดกลุ่ม: นับ "เกิน 5 วันทำการ" ต่อกอง (> ไม่ใช่ >=) · ข้อมูลว่าง/ผิดรูป = ไม่พัง', () => {
  // 11 พ.ย. 2569 (พุธ): due 4 พ.ย. = 5 วันทำการ (ไม่เกิน) · due 3 พ.ย. = 6 วันทำการ (เกิน)
  const groups = H.groupByDept([it('x', '2026-11-04', 'D', 'กองช่าง'), it('y', '2026-11-03', 'D', 'กองช่าง')], '2026-11-11')
  assert.equal(H.overdueWorkingDays('2026-11-04', '2026-11-11'), 5)
  assert.equal(groups[0].over, 1)
  assert.deepEqual(H.groupByDept(null, '2026-11-11'), [])
  assert.deepEqual(H.groupByDept([null, undefined], '2026-11-11'), [])
})

// ── ข้อมูลจาก RPC ────────────────────────────────────────────────────────────

test('normalizeOverdue: ทิ้งแถวผิดรูป · ตัวเลขผิดรูปไม่ทำให้พัง · ยอดหมวดคุ้มครองผู้ร้องไม่มีเลขที่', () => {
  const d = H.normalizeOverdue({
    as_of: '2026-11-11', total: 301, limit: 300, truncated: true,
    items: [it('ok', '2026-11-01', 'D', 'กองช่าง'), { k: 'weird', id: 'z' }, { k: 'complaint' }, null],
    sensitive: [{ dept_id: 'D', dept: 'กองช่าง', n: 2 }, { dept_id: null, dept: null, n: 0 }, { n: 'x' }],
  })
  assert.equal(d.items.length, 1)
  assert.equal(d.total, 301)
  assert.equal(d.truncated, true)
  assert.deepEqual(d.sensitive, [{ dept_id: 'D', dept: 'กองช่าง', n: 2 }])
  const empty = H.normalizeOverdue(null)
  assert.deepEqual([empty.items, empty.sensitive, empty.total, empty.truncated], [[], [], 0, false])
})

test('ข้อความหมวดคุ้มครองผู้ร้อง: ยอดรวมต่อกอง ไม่มีเลขที่/ไอดี · ยอด 0 ไม่ขึ้น', () => {
  const lines = H.sensitiveSummaryLines([{ dept_id: 'D', dept: 'กองช่าง', n: 3 }, { dept_id: null, dept: 'ไม่ระบุกอง', n: 1 }, { dept: 'x', n: 0 }])
  assert.deepEqual(lines, [
    'หมวดคุ้มครองผู้ร้อง เลยกำหนด 3 เรื่อง (กองช่าง) — แสดงเป็นยอดรวม ติดตาม/เร่งรายเรื่องไม่ได้',
    'หมวดคุ้มครองผู้ร้อง เลยกำหนด 1 เรื่อง (ไม่ระบุกอง) — แสดงเป็นยอดรวม ติดตาม/เร่งรายเรื่องไม่ได้',
  ])
  assert.deepEqual(H.sensitiveSummaryLines(null), [])
})

test('ข้อความถูกตัด: บอกจำนวนที่แสดงกับทั้งหมด · ไม่ถูกตัด = null', () => {
  assert.equal(H.truncatedText({ truncated: true, total: 412, limit: 300 }), 'แสดง 300 จาก 412 เรื่อง (เก่าสุดก่อน)')
  assert.equal(H.truncatedText({ truncated: false, total: 10, limit: 300 }), null)
})

test('เรื่องที่ติดตาม: แยก gone / hidden / ปกติ · normalizeFollows ทิ้งแถวผิดรูป', () => {
  assert.equal(H.followRowKind({ gone: true }), 'gone')
  assert.equal(H.followRowKind({ hidden: true }), 'hidden')
  assert.equal(H.followRowKind({ ref: 'X' }), 'normal')
  assert.equal(H.followRowKind(null), 'normal')
  const rows = H.normalizeFollows({ follows: [{ k: 'complaint', id: 'a' }, { k: 'nope', id: 'b' }, null, { k: 'document_request' }] })
  assert.deepEqual(rows.map((r) => r.id), ['a'])
  assert.deepEqual(H.normalizeFollows(null), [])
})

test('ป้ายสถานะ/ประเภท: pending ของคำร้อง ≠ คำขอ · สถานะไม่รู้จักแสดงค่าดิบ ไม่ว่าง', () => {
  // ชื่อเดียวกับหน้าเจ้าหน้าที่ (ComplaintsManager) และข้อความ Telegram ที่ ผอ.กองได้รับ
  assert.equal(H.itemStatusLabel('complaint', 'pending'), 'คำร้องใหม่')
  assert.equal(H.itemStatusLabel('complaint', 'new'), 'คำร้องใหม่')
  assert.equal(H.itemStatusLabel('complaint', 'parked'), 'ขึ้นทะเบียนรอดำเนินการ')
  assert.equal(H.itemStatusLabel('document_request', 'pending'), 'รอดำเนินการ')
  assert.equal(H.itemStatusLabel('document_request', 'processing'), 'กำลังดำเนินการ')
  assert.equal(H.itemStatusLabel('complaint', 'weird'), 'weird')
  assert.equal(H.itemStatusLabel('complaint', null), 'ไม่ระบุสถานะ')
  assert.equal(H.itemKindName('complaint'), 'คำร้อง')
  assert.equal(H.itemKindName('document_request'), 'คำขอ')
})

test('หมวด: คำร้องใช้ cat_label จากเซิร์ฟเวอร์ · คำขอแปลงจากทะเบียนประเภทคำขอ', () => {
  assert.equal(H.itemCategoryLabel({ k: 'complaint', cat: 'road', cat_label: 'ถนนชำรุด' }, null), 'ถนนชำรุด')
  assert.equal(H.itemCategoryLabel({ k: 'complaint', cat: 'road', cat_label: null }, null), 'road')
  const known = BASE_DOCUMENT_TYPES[0]
  const label = H.itemCategoryLabel({ k: 'document_request', cat: known.value }, null)
  assert.ok(label.length > 0 && label !== known.value, 'ประเภทที่รู้จักต้องได้ชื่อไทยจากทะเบียน ไม่ใช่รหัสดิบ')
  assert.equal(H.itemCategoryLabel({ k: 'document_request', cat: 'some_unknown_type' }, null), 'some_unknown_type')
})

test('ข้อความยืนยันก่อนส่ง: ระบุกองและเลขที่ · กองไม่ระบุใช้คำกลาง', () => {
  assert.equal(H.nudgeConfirmText({ ref: 'CR-6911-0042' }, 'กองช่าง'), 'ส่งข้อความ Telegram ถึงหัวหน้ากองช่าง ให้เร่งรัดเรื่องเลขที่ CR-6911-0042?')
  assert.equal(H.nudgeConfirmText({ ref: 'AB12CD34' }, H.EXEC_NO_DEPT_LABEL), 'ส่งข้อความ Telegram ถึงหัวหน้ากองที่ถือเรื่อง ให้เร่งรัดเรื่องเลขที่ AB12CD34?')
  assert.match(H.nudgeConfirmText({ ref: 'X' }, null), /หัวหน้ากองที่ถือเรื่อง/)
})

// ── สิทธิ์ปุ่มเร่ง (ต้องตรง exec_assert_actor ใน SQL) ─────────────────────────────

test('สิทธิ์ปุ่มเร่ง: viewer ได้ · ปลัด (top_admin) ได้ทุก role เจ้าหน้าที่รวม admin · admin ที่ไม่ใช่ปลัดไม่ได้', () => {
  assert.equal(H.canNudgeItems({ role: 'viewer' }), true)
  for (const role of ['officer', 'staff', 'council', 'technician', 'admin']) {
    assert.equal(H.canNudgeItems({ role, positionCategory: 'top_admin' }), true, role)
    assert.equal(H.canNudgeItems({ role, positionCategory: 'department_head' }), false, role)
    assert.equal(H.canNudgeItems({ role, positionCategory: null }), false, role) // ยังไม่รู้ตำแหน่ง = ไม่แสดง
    assert.equal(H.canNudgeItems({ role }), false, role)
  }
})

test('สิทธิ์ปุ่มเร่ง: superadmin เฉพาะ tenant demo · role อื่น/ว่าง = ไม่ได้ แม้ตำแหน่งเป็น top_admin', () => {
  assert.equal(H.canNudgeItems({ role: 'superadmin', tenantSlug: 'demo' }), true)
  assert.equal(H.canNudgeItems({ role: 'superadmin', tenantSlug: 'namlao' }), false)
  assert.equal(H.canNudgeItems({ role: 'superadmin' }), false)
  assert.equal(H.canNudgeItems({ role: 'citizen', positionCategory: 'top_admin' }), false)
  assert.equal(H.canNudgeItems({}), false)
  assert.equal(H.canNudgeItems(), false)
})

// ── อ่านซอร์ส ────────────────────────────────────────────────────────────────

const API = 'src/lib/execFollowNudge.js'
const NEW_FILES = [API, 'src/lib/execFollowNudgeHelpers.js', 'src/components/staff/executive/ExecOverdueList.jsx']

test('เรียก exec-nudge-notify ด้วย fetch เอง + AbortController (ไม่ใช้ functions.invoke ที่ครอบ timeout 25 วิ)', () => {
  for (const file of [...NEW_FILES, 'src/components/staff/executive/ExecServiceBlocks.jsx']) {
    const code = stripComments(read(file))
    assert.doesNotMatch(code, /functions\s*\.\s*invoke/, `${file} ห้ามใช้ functions.invoke`)
  }
  const api = stripComments(read(API))
  assert.match(api, /\/functions\/v1\/exec-nudge-notify/)
  assert.match(api, /new AbortController\(\)/)
  assert.match(api, /NUDGE_TIMEOUT_MS = 45000/)
  assert.match(api, /Authorization: `Bearer \$\{session\.access_token\}`/)
  assert.match(api, /body: JSON\.stringify\(\{ nudge_id: nudgeId \}\)/)
})

test('ลำดับ nudgeItem: exec_nudge ก่อน แล้วเรียก Edge Function · already_today ไม่เรียก Edge Function', () => {
  const api = stripComments(read(API))
  const body = api.slice(api.indexOf('export async function nudgeItem'))
  assert.ok(body.indexOf("callRpc('exec_nudge'") < body.indexOf('callNudgeNotify('))
  const alreadyLine = body.split('\n').find((line) => line.includes("reason === 'already_today'"))
  assert.ok(alreadyLine && alreadyLine.includes("outcome: 'already_today'") && !alreadyLine.includes('callNudgeNotify'), 'already_today ต้องคืนผลเลย ไม่เรียก Edge Function')
  assert.match(body, /data\?\.ok === true && typeof data\.nudge_id === 'string'\) return callNudgeNotify\(data\.nudge_id\)/)
})

test('เรียกเฉพาะ RPC ของห้อง ไม่อ่านตารางคำร้อง/คำขอตรง · ไม่มีข้อมูลส่วนบุคคลในไฟล์ใหม่ (PDPA)', () => {
  for (const file of NEW_FILES) {
    const code = stripComments(read(file))
    assert.doesNotMatch(code, /reporter_name|phone|\.from\(\s*['"](complaints|document_requests)['"]/i, file)
    assert.doesNotMatch(code, /requester_name|applicant|patient/i, file)
  }
  const api = stripComments(read(API))
  for (const rpc of ['exec_overdue_items', 'exec_my_follows', 'exec_follow', 'exec_unfollow', 'exec_nudge']) {
    assert.match(api, new RegExp(`['"]${rpc}['"]`), rpc)
  }
})

test('หน้าจอ: ไม่มีปุ่มอนุมัติ/ลิงก์เข้าไปแก้เรื่อง · ปุ่มเร่งอยู่หลัง canNudge · เปิดแผงแล้วถึงโหลด (lazy)', () => {
  const list = stripComments(read('src/components/staff/executive/ExecOverdueList.jsx'))
  assert.doesNotMatch(list, /อนุมัติ|navigate\(|<a\s|href=/)
  assert.match(list, /\{canNudge && \(\s*<button[^>]*data-exec-nudge-btn/)
  assert.match(list, /window\.confirm\(nudgeConfirmText\(/)
  const blocks = stripComments(read('src/components/staff/executive/ExecServiceBlocks.jsx'))
  assert.match(blocks, /\{open && <ExecOverdueList /)
  assert.match(blocks, /canNudgeItems\(\{ role: profile\?\.role, positionCategory: ready \? category : null, tenantSlug: tenant\?\.slug \}\)/)
})

console.log(`\nผ่านทั้งหมด ${cases} ข้อ`)

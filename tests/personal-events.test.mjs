// ตรรกะหน้าจอของรายการส่วนตัวในปฏิทิน ("🔒 เฉพาะฉัน") — node --test tests/personal-events.test.mjs
// ไม่ใช้เน็ต ไม่แตะฐานข้อมูล · ด่านจริงอยู่ที่ RLS + trigger (ทดสอบแยกใน tests/personal-events-db.test.mjs)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  PERSONAL_AUDIENCE, PERSONAL_LABEL, PERSONAL_COLOR, PERSONAL_LIMIT, PERSONAL_LIMITS, PERSONAL_LIMIT_CODE,
  PERSONAL_HORIZON_CODE, PERSONAL_DEFAULT_CATEGORY, MINE_FILTER,
  canUsePersonalEvents, isPersonalEvent, isPersonalAudience, maxPersonalDate, occurrenceInYear, nextOccurrence,
  toPersonalEvent, eventsForCalendarYear, isMine, audienceMeta, audienceColor, nextAudiences, personalPayload,
  validatePersonalForm, overwriteCandidate, personalQuota, isPersonalLimitError, isPersonalHorizonError,
} from '../src/lib/personalEvents.js'
import { STAFF_PORTAL_ROLES } from '../src/lib/portalAccess.js'
import { canAssignEvent } from '../src/lib/eventAssignment.js'
import { AUDIENCE_COLOR, AUDIENCE_LABEL } from '../src/lib/orgTerms.js'

const read = async (rel) => (await readFile(new URL(rel, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const TABLE_SQL = await read('../supabase/migrations/20261001150000_personal_events_table.sql')
const GUARD_SQL = await read('../supabase/migrations/20261001150100_personal_events_guard.sql')

test('ค่าในหน้าจอตรงกับด่านในฐานข้อมูล (กันหลุดกันคนละที่)', () => {
  assert.match(GUARD_SQL, new RegExp(`v_limit\\s+constant int := ${PERSONAL_LIMIT};`), 'เพดานไม่ตรงกับ trigger')
  assert.equal(PERSONAL_LIMIT, 100, 'เจ้าของระบบสั่ง 100 รายการต่อคน')
  assert.match(GUARD_SQL, new RegExp(`ERRCODE = '${PERSONAL_LIMIT_CODE}'`))
  assert.match(GUARD_SQL, new RegExp(`ERRCODE = '${PERSONAL_HORIZON_CODE}'`))
  assert.match(GUARD_SQL, /v_horizon date := \(v_today \+ interval '1 year'\)::date;/, 'ล่วงหน้าไม่เกิน 1 ปี')
  assert.match(TABLE_SQL, new RegExp(`char_length\\(title\\) <= ${PERSONAL_LIMITS.title}`))
  assert.match(TABLE_SQL, new RegExp(`char_length\\(description\\) <= ${PERSONAL_LIMITS.description}`))
  assert.match(TABLE_SQL, new RegExp(`char_length\\(location\\) <= ${PERSONAL_LIMITS.location}`))
  assert.match(TABLE_SQL, new RegExp(`char_length\\(category\\) <= ${PERSONAL_LIMITS.category}`))
  // overwriteCandidate() ต้องเลือกตัวเดียวกับที่ trigger ลบ — ฟอร์มบอกผู้ใช้ล่วงหน้าว่ารายการไหนจะหาย
  assert.match(GUARD_SQL, /AND NOT repeat_yearly\n\s+AND COALESCE\(end_date, event_date\) < v_today\n\s+ORDER BY COALESCE\(end_date, event_date\), created_at, id/,
    'กติกาเลือกรายการที่จะถูกทับใน trigger เปลี่ยน — ต้องแก้ overwriteCandidate() ให้ตรงกันด้วย')
})

test('ใครใช้ได้: ผู้มีตำแหน่งทุกบทบาท ยกเว้นประชาชน — ตรงกับ policy ของฐานข้อมูล', () => {
  const OFFICIALS = ['superadmin', 'admin', 'officer', 'staff', 'technician', 'viewer', 'council']
  assert.deepEqual([...STAFF_PORTAL_ROLES].sort(), [...OFFICIALS].sort())
  for (const role of OFFICIALS) assert.equal(canUsePersonalEvents(role), true, role)
  for (const role of ['citizen', null, undefined, '', 'kamnan']) assert.equal(canUsePersonalEvents(role), false, String(role))

  // policy เพิ่ม/แก้ทั้ง 2 ตัวใช้ลิสต์เดียวกับหน้าเว็บ (superadmin แยกเงื่อนไขเพราะไม่มีสังกัด)
  const lists = [...TABLE_SQL.matchAll(/get_my_role\(\) IN \(([^)]*)\)/g)].map((m) => m[1].split(',').map((s) => s.trim().replace(/'/g, '')))
  assert.equal(lists.length, 2, 'ต้องมีลิสต์ role ใน policy INSERT และ UPDATE')
  for (const list of lists) {
    assert.deepEqual([...list, 'superadmin'].sort(), [...STAFF_PORTAL_ROLES].sort(), 'ลิสต์ role ใน policy ไม่ตรงกับ STAFF_PORTAL_ROLES')
    assert.ok(!list.includes('citizen'))
  }
  assert.equal((TABLE_SQL.match(/get_my_role\(\) = 'superadmin'/g) ?? []).length, 2)
  // อ่าน/ลบ: เจ้าของเท่านั้น ไม่มีทางเลี่ยงของแอดมิน
  assert.match(TABLE_SQL, /"personal events owner read" ON public\.personal_events\n\s+FOR SELECT TO authenticated\n\s+USING \(owner_id = \(SELECT auth\.uid\(\)\)\);/)
  assert.match(TABLE_SQL, /"personal events owner delete" ON public\.personal_events\n\s+FOR DELETE TO authenticated\n\s+USING \(owner_id = \(SELECT auth\.uid\(\)\)\);/)
})

test('ป้ายและสีของ "เฉพาะฉัน" ไม่หลุดไปที่ค่ากลางที่หน้าสาธารณะใช้', () => {
  assert.equal(Object.hasOwn(AUDIENCE_LABEL, PERSONAL_AUDIENCE), false, 'ห้ามเพิ่มเข้า AUDIENCE_LABEL — หน้าแรกของประชาชนวาดคำอธิบายสีจากตัวนี้')
  assert.equal(Object.hasOwn(AUDIENCE_COLOR, PERSONAL_AUDIENCE), false)
  assert.ok(!Object.values(AUDIENCE_COLOR).includes(PERSONAL_COLOR), 'สีต้องไม่ซ้ำกลุ่มเดิม')
  assert.deepEqual(audienceMeta(PERSONAL_AUDIENCE), { value: PERSONAL_AUDIENCE, label: PERSONAL_LABEL, color: PERSONAL_COLOR })
  assert.equal(audienceMeta('staff').label, 'เจ้าหน้าที่')
  assert.equal(audienceMeta('nope'), null)
  assert.equal(audienceMeta(undefined), null)
  assert.equal(audienceMeta('toString'), null, 'ชื่อที่เป็น property ของ Object ต้องไม่ถูกนับเป็นกลุ่ม')
  assert.equal(audienceColor('nope'), '#6b7280')
  assert.equal(audienceColor(PERSONAL_AUDIENCE), PERSONAL_COLOR)
})

test('เลือกกลุ่มเป้าหมาย: "เฉพาะฉัน" กับกลุ่มอื่นเลือกพร้อมกันไม่ได้', () => {
  assert.deepEqual(nextAudiences(['public', 'staff'], PERSONAL_AUDIENCE), [PERSONAL_AUDIENCE])
  assert.deepEqual(nextAudiences([PERSONAL_AUDIENCE], 'staff'), ['staff'])
  assert.deepEqual(nextAudiences(['public'], 'staff'), ['public', 'staff'])
  assert.deepEqual(nextAudiences(['public', 'staff'], 'staff'), ['public'])
  assert.deepEqual(nextAudiences(['public'], 'public'), ['public'], 'เอากลุ่มสุดท้ายออกไม่ได้ (พฤติกรรมเดิม)')
  assert.deepEqual(nextAudiences([PERSONAL_AUDIENCE], PERSONAL_AUDIENCE), [PERSONAL_AUDIENCE])
  assert.deepEqual(nextAudiences(undefined, 'staff'), ['staff'])
  assert.equal(isPersonalAudience([PERSONAL_AUDIENCE]), true)
  assert.equal(isPersonalAudience(['staff']), false)
  assert.equal(isPersonalAudience(undefined), false)
})

test('ล่วงหน้าได้ไม่เกิน 1 ปี — ผลเดียวกับ (วันนี้ + interval 1 year) ของ PostgreSQL', () => {
  assert.equal(maxPersonalDate('2026-10-01'), '2027-10-01')
  assert.equal(maxPersonalDate('2028-02-29'), '2029-02-28', '29 ก.พ. + 1 ปี = 28 ก.พ.')
  assert.equal(maxPersonalDate('2027-02-28'), '2028-02-28')
  assert.equal(maxPersonalDate('2026-12-31'), '2027-12-31')
  assert.equal(maxPersonalDate(''), '')
})

test('รายการ "ทุกปี": วันของแต่ละปี และครั้งถัดไป', () => {
  assert.equal(occurrenceInYear('1990-05-15', 2026), '2026-05-15')
  assert.equal(occurrenceInYear('1990-05-15', 1990), '1990-05-15')
  assert.equal(occurrenceInYear('1990-05-15', 1989), null, 'ปีก่อนปีที่เริ่มจดไม่ขึ้น')
  assert.equal(occurrenceInYear('2000-02-29', 2001), '2001-02-28', '29 ก.พ. ในปีที่ไม่มี ขึ้นวันที่ 28')
  assert.equal(occurrenceInYear('2000-02-29', 2004), '2004-02-29')
  assert.equal(occurrenceInYear('2000-02-29', 2100), '2100-02-28', 'ค.ศ. 2100 ไม่ใช่ปีอธิกสุรทิน')
  assert.equal(occurrenceInYear('bad', 2026), null)

  assert.equal(nextOccurrence('1990-05-15', '2026-10-01'), '2027-05-15', 'ผ่านไปแล้วปีนี้ → ปีหน้า')
  assert.equal(nextOccurrence('1990-12-25', '2026-10-01'), '2026-12-25', 'ยังไม่ถึงปีนี้ → ปีนี้')
  assert.equal(nextOccurrence('1990-10-01', '2026-10-01'), '2026-10-01', 'ตรงกับวันนี้ = ครั้งถัดไปคือวันนี้')
  assert.equal(nextOccurrence('2027-03-01', '2026-10-01'), '2027-03-01', 'เริ่มจดในอนาคต → ครั้งแรกคือวันที่จด')
  assert.equal(nextOccurrence('2024-02-29', '2026-10-01'), '2027-02-28')
  assert.equal(nextOccurrence('2024-02-29', '2027-12-01'), '2028-02-29')
})

const row = (over = {}) => ({
  id: 'r1', owner_id: 'u1', municipality_id: 'm1', title: 'TEST', description: null, event_date: '2026-10-05',
  end_date: null, event_time: null, end_time: null, location: null, category: null, repeat_yearly: false,
  created_at: '2026-10-01T01:00:00+00:00', updated_at: '2026-10-01T01:00:00+00:00', ...over,
})

test('แปลงแถวของตารางให้หน้าตาเหมือนกิจกรรม', () => {
  const ev = toPersonalEvent(row(), '2026-10-01')
  assert.equal(isPersonalEvent(ev), true)
  assert.deepEqual(ev.audiences, [PERSONAL_AUDIENCE])
  assert.equal(ev.created_by, 'u1', 'เจ้าของ = คนสร้าง ปุ่มแก้ไข/ลบเดิมจึงใช้ได้')
  assert.equal(ev.can_view_detail, true)
  assert.deepEqual(ev.assignments, [])
  assert.deepEqual(ev.attachment_urls, [])
  assert.equal(ev.has_attachment, false)
  assert.equal(ev.category, PERSONAL_DEFAULT_CATEGORY, 'ไม่มีประเภท → ค่าที่ระบบเลือกให้')
  assert.equal(ev.event_date, '2026-10-05')
  assert.equal(ev.base_date, '2026-10-05')

  const yearly = toPersonalEvent(row({ event_date: '1990-05-15', repeat_yearly: true, category: 'อื่นๆ' }), '2026-10-01')
  assert.equal(yearly.event_date, '2027-05-15', 'รายการ "ทุกปี" ขึ้นในรายการด้วยวันของครั้งถัดไป')
  assert.equal(yearly.base_date, '1990-05-15', 'วันที่จดไว้จริงต้องเก็บไว้ ฟอร์มแก้ไขใช้ค่านี้')
  assert.equal(yearly.category, 'อื่นๆ')
  assert.equal(isPersonalEvent({ is_personal: 'true' }), false)
  assert.equal(isPersonalEvent(null), false)
})

test('ปฏิทินรายปี: รายการ "ทุกปี" ย้ายไปวันของปีที่เปิดดู ของอื่นไม่ถูกแตะ', () => {
  const shared = { id: 'e1', event_date: '2026-11-01', audiences: ['staff'] }
  const once = toPersonalEvent(row({ id: 'p1', event_date: '2026-11-02' }), '2026-10-01')
  const birthday = toPersonalEvent(row({ id: 'p2', event_date: '2026-03-10', repeat_yearly: true }), '2026-10-01')
  const list = [shared, once, birthday]
  const y2026 = eventsForCalendarYear(list, 2026)
  assert.equal(y2026.find((e) => e.id === 'p2').event_date, '2026-03-10')
  const y2028 = eventsForCalendarYear(list, 2028)
  assert.equal(y2028.find((e) => e.id === 'p2').event_date, '2028-03-10')
  assert.equal(y2028.find((e) => e.id === 'e1'), shared, 'กิจกรรมของหน่วยงานส่งผ่านตัวเดิม')
  assert.equal(y2028.find((e) => e.id === 'p1').event_date, '2026-11-02', 'รายการครั้งเดียวไม่ถูกย้ายปี')
  assert.equal(eventsForCalendarYear(list, 2025).some((e) => e.id === 'p2'), false, 'ก่อนปีที่เริ่มจดไม่ขึ้น')
  assert.equal(birthday.event_date, '2027-03-10', 'ต้นฉบับไม่ถูกแก้')
  assert.deepEqual(eventsForCalendarYear(undefined, 2026), [])
})

test('"ของฉัน" = รายการที่จดเอง + กิจกรรมที่ได้รับมอบหมาย', () => {
  const mine = toPersonalEvent(row(), '2026-10-01')
  const assigned = { id: 'e1', audiences: ['management'], assignments: [{ name: 'TEST', profile_id: 'u1' }] }
  const other = { id: 'e2', audiences: ['staff'], assignments: [{ name: 'TEST', profile_id: 'u9' }] }
  assert.equal(isMine(mine, 'u1'), true)
  assert.equal(isMine(assigned, 'u1'), true)
  assert.equal(isMine(other, 'u1'), false)
  assert.equal(isMine(assigned, null), false)
  assert.equal(MINE_FILTER, 'mine')
})

test('ข้อมูลที่จะบันทึก: ไม่มีไฟล์แนบ/การมอบหมาย และ "ทุกปี" ไม่มีวันสิ้นสุด', () => {
  const form = {
    title: '  TEST ไปหาหมอฟัน ', description: '  ', event_date: '2026-10-05', end_date: '2026-10-06',
    event_time: '09:00', end_time: '', location: ' คลินิก ', category: 'อื่นๆ', customCategory: ' นัดส่วนตัว ',
    audiences: [PERSONAL_AUDIENCE], attachment_urls: ['x'], attachment_files: [{}],
  }
  assert.deepEqual(personalPayload(form), {
    title: 'TEST ไปหาหมอฟัน', description: null, event_date: '2026-10-05', end_date: '2026-10-06',
    event_time: '09:00', end_time: null, location: 'คลินิก', category: 'นัดส่วนตัว', repeat_yearly: false,
  })
  const yearly = personalPayload(form, { repeatYearly: true })
  assert.equal(yearly.end_date, null)
  assert.equal(yearly.repeat_yearly, true)
  assert.equal(personalPayload({ ...form, category: '' }).category, PERSONAL_DEFAULT_CATEGORY)
  assert.equal(personalPayload({ ...form, category: 'อื่นๆ', customCategory: ' ' }).category, 'อื่นๆ')
  assert.equal('audiences' in yearly || 'attachment_urls' in yearly || 'owner_id' in yearly, false,
    'ไม่ส่ง owner_id (ฐานข้อมูลใส่เอง) และไม่ส่งคอลัมน์ที่ตารางไม่มี')
})

test('ตรวจก่อนบันทึก (ซ้ำกับฐานข้อมูล)', () => {
  const ok = personalPayload({ title: 'TEST', event_date: '2026-10-05', category: 'ประชุม' })
  const today = '2026-10-01'
  assert.equal(validatePersonalForm(ok, today), '')
  assert.match(validatePersonalForm({ ...ok, title: '' }, today), /ชื่อ/)
  assert.match(validatePersonalForm({ ...ok, title: 'ก'.repeat(201) }, today), /200/)
  assert.equal(validatePersonalForm({ ...ok, title: 'ก'.repeat(200) }, today), '')
  assert.match(validatePersonalForm({ ...ok, description: 'ก'.repeat(2001) }, today), /2000/)
  assert.match(validatePersonalForm({ ...ok, location: 'ก'.repeat(201) }, today), /สถานที่/)
  assert.match(validatePersonalForm({ ...ok, category: 'ก'.repeat(61) }, today), /ประเภท/)
  assert.match(validatePersonalForm({ ...ok, event_date: '' }, today), /วันที่/)
  assert.match(validatePersonalForm({ ...ok, end_date: '2026-10-04' }, today), /วันสิ้นสุด/)
  assert.equal(validatePersonalForm({ ...ok, event_date: '2027-10-01' }, today), '', 'ครบ 1 ปีพอดีผ่าน')
  assert.match(validatePersonalForm({ ...ok, event_date: '2027-10-02' }, today), /ไม่เกิน 1 ปี.*ทุกปี/)
  assert.match(validatePersonalForm({ ...ok, end_date: '2027-10-02' }, today), /ไม่เกิน 1 ปี/)
  assert.equal(validatePersonalForm({ ...ok, event_date: '2001-01-01' }, today), '', 'ลงย้อนหลังได้')
})

test('เต็ม 100 แล้วเขียนทับ: เลือกรายการเดียวกับ trigger', () => {
  const today = '2026-10-01'
  const p = (id, date, extra = {}) => toPersonalEvent(row({ id, event_date: date, ...extra }), today)
  const rows = [
    p('a', '2025-01-01', { repeat_yearly: true }),                 // เก่าที่สุดแต่เป็น "ทุกปี" → ไม่ทับ
    p('b', '2025-02-01', { end_date: '2026-09-30' }),              // หลายวัน นับจากวันสิ้นสุด
    p('c', '2025-06-01', { created_at: '2026-01-02T00:00:00+00:00' }),
    p('d', '2025-06-01', { created_at: '2026-01-01T00:00:00+00:00' }), // วันเดียวกัน สร้างก่อน → ถูกทับก่อน
    p('e', today),                                                 // วันนี้ยังไม่ผ่าน
    p('f', '2026-12-01'),
  ]
  assert.equal(overwriteCandidate(rows, today).id, 'd')
  assert.equal(overwriteCandidate(rows.filter((r) => r.id !== 'd'), today).id, 'c')
  assert.equal(overwriteCandidate(rows.filter((r) => !['c', 'd'].includes(r.id)), today).id, 'b')
  assert.equal(overwriteCandidate(rows.filter((r) => ['a', 'e', 'f'].includes(r.id)), today), null,
    'เหลือแต่รายการล่วงหน้า/ทุกปี → ไม่มีอะไรให้ทับ')
  assert.equal(overwriteCandidate([], today), null)
  // ลำดับเทียบสตริงตรงๆ (เหมือน ORDER BY) ไม่ขึ้นกับภาษาของเครื่อง
  const tie = [p('b2', '2025-03-01', { created_at: 'X' }), p('a2', '2025-03-01', { created_at: 'X' })]
  assert.equal(overwriteCandidate(tie, today).id, 'a2')

  const many = Array.from({ length: PERSONAL_LIMIT }, (_, i) => p(`n${i}`, '2026-11-01'))
  assert.deepEqual(personalQuota(many.slice(0, 99), today), { used: 99, full: false, victim: null })
  assert.deepEqual(personalQuota(many, today), { used: 100, full: true, victim: null }, 'เต็มด้วยรายการล่วงหน้า → ต้องลบเอง')
  const withPast = [...many.slice(1), p('old', '2026-01-01')]
  assert.equal(personalQuota(withPast, today).victim.id, 'old')
})

test('รายการส่วนตัวไม่มีปุ่มมอบหมาย แม้เป็นแอดมินหรือเจ้าของ', () => {
  const ev = toPersonalEvent(row({ owner_id: 'u1' }), '2026-10-01')
  for (const role of ['superadmin', 'admin', 'viewer', 'staff']) {
    assert.equal(canAssignEvent(ev, role, 'u1', null), false, role)
  }
  assert.equal(canAssignEvent({ audiences: ['management'], created_by: 'u1' }, 'staff', 'u1', null), true, 'กิจกรรมปกติยังมอบหมายได้ตามเดิม')
})

test('รหัสข้อผิดพลาดจากฐานข้อมูล', () => {
  assert.equal(isPersonalLimitError({ code: 'PE001' }), true)
  assert.equal(isPersonalLimitError({ code: '42501' }), false)
  assert.equal(isPersonalHorizonError({ code: 'PE002' }), true)
  assert.equal(isPersonalLimitError(null), false)
})

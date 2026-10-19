// ประกาศน้ำ-ฝนที่มีผู้ยืนยัน (เฟส 2 · PR 2.2) — ตรรกะล้วน + สแกนโค้ดหน้าจอ (ไม่ใช้เบราว์เซอร์/ฐานข้อมูล)
// node tests/water-announcements.test.mjs
//
// เรื่องที่ต้องไม่พลาด:
//  (1) ประชาชนเห็นเฉพาะฉบับที่ยังไม่หมดอายุ — ตัดสินจากเวลาหมดอายุเอง + นาฬิกาเซิร์ฟเวอร์ (เครื่องผู้ใช้ตั้งเวลาเพี้ยนก็ไม่แสดงผิด)
//  (2) หน้าเจ้าหน้าที่: เผยแพร่ต้องกดยืนยันซ้ำ · ปุ่มตัดสินมีเฉพาะผู้มีสิทธิ์ · ช่องกรอกมีเฉพาะกล่องตั้งค่าผู้ยืนยันของ admin
//  (3) ค่าคงที่ฝั่งหน้าเว็บตรงกับฐานข้อมูล (อายุร่าง 3 ชม. · ผู้ยืนยันสูงสุด 5 · อายุประกาศ 24/72 ชม.)
//  (4) อปท. ที่ไม่ได้เปิดประกาศ: ไม่ยิง RPC เพิ่มฝั่งเจ้าหน้าที่นอกจากตัวถามเดียว · ฝั่งประชาชนได้ null หน้าไม่เปลี่ยน
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AUTHORITY_NOTE_MAX, DEFAULT_EXPIRY_HOURS, DRAFT_LIFE_HOURS, MAX_APPROVERS, MAX_EXPIRY_HOURS, PUBLIC_REFRESH_MS, STATUS_LABELS,
  actionFailureText, bodyLines, clockOffsetMs, describeRpcError, draftCanApprove, draftDeadline, historyLine, isActive, isQuietListError,
  publicView, remainingText, roleLabel, todoCount,
} from '../src/lib/waterAnnouncements.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const HOUR = 3_600_000
const MIN = 60_000
const T0 = Date.parse('2026-10-20T03:00:00Z') // 10:00 น. เวลาไทย

// ── 1) isActive: ตัดสินจากเวลาหมดอายุ ──
{
  const a = { id: 'x', body: 'ข้อความ', expires_at: new Date(T0 + HOUR).toISOString() }
  assert.equal(isActive(a, T0), true)
  assert.equal(isActive(a, T0 + HOUR - 1), true)
  assert.equal(isActive(a, T0 + HOUR), false, 'เท่ากับเวลาหมดอายุ = หมดแล้ว')
  assert.equal(isActive(a, T0 + 5 * HOUR), false)
  for (const bad of [null, undefined, {}, { body: 'x' }, { body: 'x', expires_at: 'ไม่ใช่วันที่' }, { body: '', expires_at: new Date(T0 + HOUR).toISOString() }]) {
    assert.equal(isActive(bad, T0), false, `ข้อมูลไม่ครบ/อ่านไม่ออก = ไม่แสดง (ไม่เดาว่ายังใช้ได้): ${JSON.stringify(bad)}`)
  }
  assert.equal(isActive(a, null), false); assert.equal(isActive(a, 'ไม่ใช่เวลา'), false)
  console.log('✓ isActive: ครบอายุ (รวมเท่ากับเวลาหมดอายุ) = ไม่แสดง · ข้อมูลไม่ครบ/อ่านไม่ออก = ไม่แสดง')
}

// ── 2) นาฬิกาเซิร์ฟเวอร์ ──
{
  // เครื่องผู้ใช้เดินเร็ว 3 ชม. (ตอนนี้จริง = T0) → ต้องไม่ตัดประกาศที่ยังใช้ได้ทิ้ง · เครื่องเดินช้า → ต้องไม่โชว์ฉบับที่หมดแล้ว
  const a = { id: 'x', body: 'b', expires_at: new Date(T0 + HOUR).toISOString(), issuer: 'อบต.' }
  const fast = T0 + 3 * HOUR
  const offsetFast = clockOffsetMs(new Date(T0).toISOString(), fast)
  assert.equal(offsetFast, -3 * HOUR)
  assert.equal(isActive(a, fast), false, 'ถ้าใช้นาฬิกาเครื่องที่เดินเร็ว จะซ่อนผิด')
  assert.equal(isActive(a, fast + offsetFast), true, 'ปรับด้วยนาฬิกาเซิร์ฟเวอร์ → ยังแสดง')
  const slow = T0 - 3 * HOUR
  const expired = { ...a, expires_at: new Date(T0 - MIN).toISOString() }
  assert.equal(isActive(expired, slow), true, 'ถ้าใช้นาฬิกาเครื่องที่เดินช้า จะโชว์ฉบับที่หมดแล้วผิด')
  assert.equal(isActive(expired, slow + clockOffsetMs(new Date(T0).toISOString(), slow)), false)
  assert.equal(clockOffsetMs(undefined, T0), 0); assert.equal(clockOffsetMs('ขยะ', T0), 0); assert.equal(clockOffsetMs(new Date(T0).toISOString(), null), 0)
  console.log('✓ นาฬิกา: ใช้ server_now ปรับเวลาเครื่อง — เครื่องเดินเร็ว/ช้า 3 ชม. ก็แสดง/ซ่อนถูก · ไม่มี server_now = ไม่ปรับ')
}

// ── 3) remainingText ──
{
  const exp = new Date(T0 + 5 * HOUR + 20 * MIN).toISOString()
  assert.equal(remainingText(exp, T0), 'เหลืออีก 5 ชม. 20 นาที')
  assert.equal(remainingText(new Date(T0 + 2 * HOUR).toISOString(), T0), 'เหลืออีก 2 ชม.')
  assert.equal(remainingText(new Date(T0 + 12 * MIN).toISOString(), T0), 'เหลืออีก 12 นาที')
  assert.equal(remainingText(new Date(T0 + 30_000).toISOString(), T0), 'ใกล้หมดอายุ')
  assert.equal(remainingText(new Date(T0).toISOString(), T0), 'หมดอายุแล้ว')
  assert.equal(remainingText(new Date(T0 - HOUR).toISOString(), T0), 'หมดอายุแล้ว')
  assert.equal(remainingText(null, T0), ''); assert.equal(remainingText('ขยะ', T0), '')
  console.log('✓ remainingText: ชม./นาที/ใกล้หมด/หมดแล้ว · ข้อมูลเสีย = ว่าง')
}

// ── 4) bodyLines / publicView ──
{
  assert.deepEqual(bodyLines('บรรทัด 1\r\nบรรทัด 2\n\n\n\nย่อหน้า 2\n\n'), ['บรรทัด 1', 'บรรทัด 2', '', 'ย่อหน้า 2'], 'ตัดบรรทัดว่างหัวท้าย/ซ้อน เก็บ 1 บรรทัดว่างเป็นย่อหน้า')
  assert.deepEqual(bodyLines('\n\n  \n'), []); assert.deepEqual(bodyLines(null), [])
  const exp = new Date(T0 + 5 * HOUR).toISOString()
  const v = publicView({ id: 'a1', body: 'ประกาศจาก อบต.ก\n• รายการ', published_at: new Date(T0 - HOUR).toISOString(), expires_at: exp, issuer: 'อบต.ก' }, T0)
  assert.equal(v.id, 'a1'); assert.deepEqual(v.lines, ['ประกาศจาก อบต.ก', '• รายการ']); assert.equal(v.issuer, 'อบต.ก')
  assert.match(v.publishedText, /69/); assert.match(v.expiresText, /น\.$/); assert.equal(v.remaining, 'เหลืออีก 5 ชม.')
  assert.equal(publicView({ id: 'a1', body: 'x', expires_at: exp }, T0 + 6 * HOUR), null, 'ครบอายุ → null')
  assert.equal(publicView(null, T0), null)
  assert.ok(!('published_by' in v) && !('authority_note' in v), 'ไม่มีตัวตนผู้ยืนยัน/ข้อความอ้างอิงอำนาจในข้อมูลที่หน้าประชาชนใช้')
  console.log('✓ publicView: ข้อความเดิมทุกบรรทัด · ครบอายุ/ไม่มีข้อมูล = null · ไม่มีตัวตนผู้ยืนยัน')
}

// ── 5) ร่าง: ยืนยันได้ 3 ชม. ──
{
  const d = new Date(T0).toISOString()
  assert.equal(draftDeadline(d), T0 + 3 * HOUR)
  assert.equal(draftCanApprove(d, T0 + 3 * HOUR - 1), true)
  assert.equal(draftCanApprove(d, T0 + 3 * HOUR), false, 'ครบ 3 ชม. พอดี = ยืนยันไม่ได้ (ตรงกับ SQL: drafted_at <= now - 3h)')
  assert.equal(draftCanApprove(null, T0), false); assert.equal(draftDeadline('ขยะ'), null)
  console.log('✓ ร่าง: ยืนยันได้ถึง 3 ชม. หลังร่าง (เท่ากับฐานข้อมูล) · ข้อมูลเสีย = ยืนยันไม่ได้')
}

// ── 6) ข้อความผลลัพธ์/error ──
{
  for (const reason of ['disabled', 'already_handled', 'event_closed', 'draft_too_old', 'not_active', 'not_staff', 'max_reached', 'อะไรก็ไม่รู้']) {
    const text = actionFailureText(reason)
    assert.ok(text.length > 10 && !/undefined|null/.test(text), reason)
  }
  assert.match(actionFailureText('draft_too_old'), /3 ชั่วโมง/)
  assert.match(actionFailureText('max_reached'), /5 คน/)
  assert.equal(actionFailureText('อะไรก็ไม่รู้'), 'ทำรายการไม่สำเร็จ', 'เหตุผลที่ไม่รู้จักไม่โชว์ข้อความดิบ')
  assert.match(describeRpcError({ code: '42501', message: 'ไม่มีสิทธิ์ยืนยันประกาศของหน่วยงานนี้' }), /ไม่มีสิทธิ์/)
  assert.match(describeRpcError({ code: 'PGRST202' }), /ยังไม่พร้อม/)
  assert.match(describeRpcError({ code: '22023', message: 'ข้อความอ้างอิงอำนาจยาวเกิน 300 ตัวอักษร' }), /300/)
  assert.equal(describeRpcError({ code: 'XX000', message: 'relation "x" does not exist ข้อมูลภายใน' }), 'ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'ไม่แสดงข้อความดิบของฐานข้อมูล')
  assert.equal(describeRpcError(null), 'ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
  assert.equal(isQuietListError({ code: '42501' }), true); assert.equal(isQuietListError({ code: 'PGRST202' }), true)
  assert.equal(isQuietListError({ code: '42883' }), true); assert.equal(isQuietListError({ message: 'Could not find the function public.x' }), true)
  assert.equal(isQuietListError({ code: '57014' }), false, 'timeout/เน็ตหลุดต้องบอกผู้ยืนยัน ไม่ซ่อน'); assert.equal(isQuietListError(null), false)
  console.log('✓ ข้อความ: ทุกเหตุผลที่ฐานข้อมูลคืนมามีคำอธิบายภาษาคน · ไม่โชว์ข้อความดิบ · ไม่มีสิทธิ์/ฟังก์ชันไม่พร้อม = ซ่อนเงียบ แต่ timeout ไม่ซ่อน')
}

// ── 7) todo / history / ป้าย ──
{
  assert.equal(todoCount({ can_approve: true, pending: true }), 1)
  for (const x of [null, undefined, {}, { can_approve: true, pending: false }, { can_approve: false, pending: true }, { can_approve: 'true', pending: true }, { can_approve: true, pending: 1 }]) {
    assert.equal(todoCount(x), 0, JSON.stringify(x))
  }
  const now = T0 + HOUR
  assert.match(historyLine({ status: 'published', published_at: new Date(T0).toISOString(), expires_at: new Date(T0 + 2 * HOUR).toISOString() }, now), /^เผยแพร่อยู่ · เผยแพร่ .* · หมดอายุ /)
  assert.match(historyLine({ status: 'published', published_at: new Date(T0 - 5 * HOUR).toISOString(), expires_at: new Date(T0 - HOUR).toISOString() }, now), /^หมดอายุ · /, 'published ที่ครบอายุแล้วแสดงว่าหมดอายุ แม้ cron ยังไม่เก็บสถานะ')
  assert.match(historyLine({ status: 'declined', drafted_at: new Date(T0).toISOString(), closed_at: new Date(T0 + MIN).toISOString() }, now), /^เลือกไม่ประกาศ · ร่างเมื่อ .* · ปิดเมื่อ /)
  assert.match(historyLine({ status: 'cancelled', published_at: new Date(T0).toISOString(), expires_at: new Date(T0 + HOUR).toISOString(), closed_at: new Date(T0 + 10 * MIN).toISOString() }, now), /^ยกเลิกแล้ว · เผยแพร่ .* · ปิดเมื่อ /)
  for (const s of ['draft', 'published', 'declined', 'cancelled', 'superseded', 'expired', 'lapsed']) assert.ok(STATUS_LABELS[s], s)
  assert.equal(roleLabel('admin'), 'ผู้ดูแลระบบ'); assert.equal(roleLabel('officer'), 'หัวหน้ากอง'); assert.equal(roleLabel('staff'), 'เจ้าหน้าที่'); assert.equal(roleLabel('citizen'), '')
  console.log('✓ todo นับ 1 เฉพาะผู้ยืนยันที่มีร่างจริง (ค่าแปลกๆ = 0) · ป้ายสถานะครบ 7 แบบ · ประวัติบอกหมดอายุถูกแม้ cron ยังไม่เก็บ')
}

// ── 8) ค่าคงที่ตรงกับฐานข้อมูล ──
const sqlTables = read('supabase/migrations/20261020100000_water_announcements_tables.sql')
const sqlFuncs = read('supabase/migrations/20261020100100_water_announcements_functions.sql')
const sqlApprTables = read('supabase/migrations/20261020130000_water_announcement_approvers_table.sql')
const sqlApprFuncs = read('supabase/migrations/20261020130100_water_announcement_approvers_functions.sql')
{
  for (const [name, src] of [['water_announcement_tick/approve (PR 2.1)', sqlFuncs], ['water_announcement_todo (PR 2.2)', sqlApprFuncs]]) {
    const m = [...src.matchAll(/c_draft_life\s+CONSTANT interval := interval '(\d+) hours'/g)].map(x => Number(x[1]))
    assert.ok(m.length >= 1 && m.every(h => h === DRAFT_LIFE_HOURS), `${name}: อายุร่างใน SQL ต้องเป็น ${DRAFT_LIFE_HOURS} ชม. (พบ ${m})`)
  }
  assert.equal([...sqlFuncs.matchAll(/c_draft_life\s+CONSTANT interval := interval '3 hours'/g)].length, 2, 'tick + approve ใช้ 3 ชม.')
  assert.match(sqlApprFuncs, new RegExp(`c_max\\s+CONSTANT integer := ${MAX_APPROVERS}`), 'ผู้ยืนยันสูงสุดใน SQL')
  assert.match(sqlApprFuncs, new RegExp(`'max_approvers', ${MAX_APPROVERS}`))
  assert.match(sqlApprTables, new RegExp(`char_length\\(authority_note\\) <= ${AUTHORITY_NOTE_MAX}`))
  assert.match(sqlTables, new RegExp(`default_expiry_hours integer\\s+NOT NULL DEFAULT ${DEFAULT_EXPIRY_HOURS} CHECK \\(default_expiry_hours BETWEEN 1 AND ${MAX_EXPIRY_HOURS}\\)`))
  assert.match(sqlFuncs, new RegExp(`v_hours > ${MAX_EXPIRY_HOURS}`))
  assert.equal(PUBLIC_REFRESH_MS, 5 * 60 * 1000, 'ถามฐานข้อมูลหน้าประชาชนทุก 5 นาที เท่ากับแถบแจ้งเตือนดิบเดิม')
  // ฮุกหน้าแรกเจ้าหน้าที่เรียกด้วย p_muni
  assert.match(read('src/lib/staffHomeData.js'), /supabase\.rpc\(rpc, \{ p_muni: tenantId \}\)/)
  assert.match(sqlApprFuncs, /water_announcement_todo\(p_muni uuid\)/)
  console.log('✓ ค่าคงที่: อายุร่าง 3 ชม. · ผู้ยืนยัน ≤ 5 · อายุประกาศ 24 (≤ 72) · ข้อความอ้างอิง ≤ 300 · ชื่อพารามิเตอร์ p_muni — หน้าเว็บตรงกับ SQL')
}

// ── 9) สแกนโค้ดหน้าจอ ──
const card = read('src/components/water/WaterAnnouncementCard.jsx')
const hook = read('src/components/water/useWaterAnnouncement.js')
const banner = read('src/components/citizen/WaterAlertBanner.jsx')
const page = read('src/pages/WaterSituationPage.jsx')
const section = read('src/components/staff/WaterAnnouncementsSection.jsx')
const approvers = read('src/components/staff/WaterAnnouncementApprovers.jsx')
const panel = read('src/components/staff/WaterEventsPanel.jsx')
const home = read('src/components/staff/StaffOperationalDashboard.jsx')
const lib = read('src/lib/waterAnnouncements.js')
const strip = (s) => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
{
  // ตรรกะล้วนห้ามพึ่ง supabase/react
  assert.ok(!/from '\.\/supabase|from '\.\.\/lib\/supabase|from 'react/.test(lib), 'lib ห้าม import supabase/react')
  // ฝั่งประชาชน: การ์ดไม่เรียกเครือข่าย ไม่มีปุ่ม/ช่องกรอก · ฮุกอ่านอย่างเดียว
  assert.ok(!/supabase|<button|<input|<textarea|<select|<form/.test(strip(card)), 'การ์ดประชาชนต้องเป็นข้อความล้วน')
  assert.match(card, /data-water-announcement/); assert.match(card, /role="alert"/)
  assert.ok(!/authority|published_by|facts|can_approve/.test(card), 'การ์ดประชาชนไม่มีข้อมูลภายใน')
  assert.equal([...hook.matchAll(/supabase\.rpc\('([a-z_]+)'/g)].map(m => m[1]).join(','), 'get_public_water_announcement', 'ฮุกประชาชนเรียก RPC เดียว')
  assert.ok(!/\.from\(|\.insert\(|\.update\(|\.delete\(/.test(hook))
  assert.match(hook, /useVisibleRefresh\(load, \{ intervalMs: PUBLIC_REFRESH_MS/)
  assert.match(hook, /clockOffsetMs\(data\?\.server_now, Date\.now\(\)\)/, 'ใช้ server_now ปรับนาฬิกา')
  assert.match(hook, /publicView\(state\.data, deviceNow \+ state\.offset\)/)
  // แถบหน้าแรก: ประกาศชนะข้อมูลดิบ — ฮุกเรียกก่อน early return ทุกตัว (กฎของ hooks) และ return การ์ดก่อนตรวจข้อมูลดิบ
  const iHook = banner.indexOf('useWaterAnnouncement({ tenantId, enabled })')
  const iCard = banner.indexOf('<WaterAnnouncementCard view={announcement}')
  const iRaw = banner.indexOf('if (!enabled || !data) return null')
  assert.ok(iHook > 0 && iCard > iHook && iRaw > iCard, 'ลำดับ: ฮุกประกาศ → การ์ดประกาศ → แถบข้อมูลดิบ')
  assert.ok(banner.indexOf('useVisibleRefresh(load, { intervalMs: REFRESH_MS') < iHook, 'ฮุกประกาศไม่อยู่หลัง return ใดๆ')
  assert.match(banner, /linkTo="\/water-situation"/)
  // หน้า /water-situation: การ์ดอยู่บนสุดของเนื้อหา เหนือแผงอื่น
  assert.match(page, /const \{ view: announcement \} = useWaterAnnouncement\(\{ tenantId \}\)/)
  const iPageCard = page.indexOf('<WaterAnnouncementCard view={announcement} />')
  assert.ok(iPageCard > 0 && page.indexOf('<HydroHourlyPanel') > 0 && iPageCard < page.indexOf('<HydroHourlyPanel'), 'การ์ดประกาศต้องมีและอยู่เหนือแผงอื่น')
  assert.ok(!/components\/staff/.test(card + hook + banner), 'โค้ดประชาชนไม่ import โค้ดเจ้าหน้าที่')
  console.log('✓ ประชาชน: การ์ดเป็นข้อความล้วนไม่มีข้อมูลภายใน · ฮุกเรียก RPC เดียวอ่านอย่างเดียว ปรับด้วย server_now · แถบหน้าแรก: ประกาศชนะข้อมูลดิบ · หน้า /water-situation: ประกาศอยู่บนสุด')
}
{
  // ฝั่งเจ้าหน้าที่: RPC ที่เรียกได้ + ปุ่มทุกปุ่มมีป้าย + ผ่านขั้นยืนยัน
  const sectionRpcs = [...strip(section).matchAll(/supabase\.rpc\('([a-z_]+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(sectionRpcs, ['approve_water_announcement', 'cancel_water_announcement', 'decline_water_announcement', 'list_water_announcements'])
  const apprRpcs = [...strip(approvers).matchAll(/supabase\.rpc\('([a-z_]+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(apprRpcs, ['list_water_announcement_approvers', 'set_water_announcement_approver'])
  for (const src of [section, approvers]) {
    assert.ok(!/\.from\(|\.insert\(|\.update\(|\.delete\(|dangerouslySetInnerHTML|window\.confirm|confirm\(|prompt\(/.test(strip(src)), 'ไม่แตะตารางตรง/ไม่ตีความ HTML/ไม่ใช้ confirm ของเบราว์เซอร์')
  }
  for (const src of [section, approvers]) {
    const buttons = [...src.matchAll(/<button\b[^>]*>/g)].map(m => m[0])
    assert.ok(buttons.length >= 3)
    for (const b of buttons) assert.match(b, /data-wa-action="[a-z-]+"/, `ปุ่มต้องมี data-wa-action: ${b.slice(0, 70)}`)
  }
  // ไม่มีช่องกรอกในส่วนประกาศ (ยกเว้นกล่องตั้งค่าผู้ยืนยันของ admin: ช่องข้อความเดียว type=text)
  assert.ok(!/<input|<textarea|<select|<form|contentEditable/.test(strip(section)), 'ส่วนประกาศหลักห้ามมีช่องกรอก')
  const inputs = [...approvers.matchAll(/<input\b[^>]*>/g)].map(m => m[0])
  assert.equal(inputs.length, 1); assert.match(inputs[0], /type="text"/); assert.match(inputs[0], /maxLength=\{AUTHORITY_NOTE_MAX\}/)
  assert.ok(!/<textarea|<select|<form|contentEditable/.test(strip(approvers)))
  // เผยแพร่ต้องผ่านขั้นยืนยันซ้ำ: ปุ่ม "approve" แค่เปิดขั้นยืนยัน · เฉพาะ approve-confirm เรียก approve จริง
  assert.match(section, /data-wa-action="approve" [^>]*onClick=\{\(\) => \{ setNotice\(null\); setConfirming\('approve'\) \}\}/)
  assert.match(section, /data-wa-action="approve-confirm" [^>]*onClick=\{approve\}/)
  assert.equal([...section.matchAll(/onClick=\{approve\}/g)].length, 1, 'approve() ถูกเรียกจากปุ่มเดียว')
  assert.match(section, /data-wa-action="cancel" disabled=\{busy !== null\} onClick=\{\(\) => \{ setNotice\(null\); setConfirming\('cancel'\) \}\}/); assert.match(section, /data-wa-action="cancel-confirm" [^>]*onClick=\{cancel\}/)
  assert.equal([...section.matchAll(/onClick=\{cancel\}/g)].length, 1)
  // ปุ่มตัดสินแสดงเฉพาะผู้มีสิทธิ์ + ร่างที่ยังสด
  assert.match(section, /\{draftFresh && canApprove && \(confirming === 'approve'/)
  assert.match(section, /\{canApprove && \(confirming === 'cancel'/)
  assert.match(section, /draftFresh && !canApprove/, 'คนอื่นเห็นข้อความอ่านอย่างเดียว')
  // อปท. ที่ไม่ได้เปิด: ไม่แสดงอะไร · error ชนิดสิทธิ์/ฟังก์ชันไม่พร้อม: ซ่อนเงียบ
  assert.match(section, /if \(data\.enabled !== true\) return null/)
  assert.match(section, /if \(isQuietListError\(state\.error\)\) return null/)
  // ข้อความประกาศแสดงตามต้นฉบับ (ไม่ตัดแต่ง/ไม่ตีความ HTML)
  assert.match(section, /whitespace-pre-line/); assert.ok(!/body\.replace|body\.slice|body\.substring/.test(section))
  // ตั้งค่าผู้ยืนยัน: แสดงเฉพาะ can_manage_approvers · ไม่โหลดรายชื่อจนกว่าจะเปิดกล่อง
  assert.match(section, /data\.can_manage_approvers === true && <WaterAnnouncementApprovers/)
  assert.match(approvers, /isOpen && state\.status === 'idle'/)
  // หลังทำรายการ: ล้างแคชหน้าแรก (ไม่ให้แถว "ต้องทำตอนนี้" เก่าค้าง)
  assert.equal([...section.matchAll(/refreshHome\(\)/g)].length, 3)
  assert.match(section, /const refreshHome = \(\) => clearHomeRpcCache\('water_announcement_todo'\)/, 'refreshHome ต้องล้างแคชของแถว "ต้องทำตอนนี้" จริง (ไม่ใช่ฟังก์ชันว่าง)')
  // ส่วนประกาศอยู่เหนือรายการเหตุการณ์ ไม่ปนกับพื้นที่ที่ล็อกว่าอ่านอย่างเดียว
  assert.ok(panel.indexOf('<WaterAnnouncementsSection tenantId={tenantId} />') < panel.indexOf('<div data-we-list'))
  assert.match(panel, /<div data-we-list className="space-y-4">/)
  console.log('✓ เจ้าหน้าที่: เรียก RPC เฉพาะ 4+2 ตัว · ปุ่มทุกปุ่มมี data-wa-action · เผยแพร่/ยกเลิกต้องผ่านขั้นยืนยันซ้ำ · ปุ่มตัดสินเฉพาะผู้มีสิทธิ์+ร่างสด · ช่องกรอกมีช่องเดียว (อ้างอิงอำนาจ ของ admin) · อปท. ที่ไม่เปิด = ไม่แสดง · ข้อความประกาศไม่ถูกแก้')
}
{
  // หน้าแรกเจ้าหน้าที่
  assert.match(home, /useHomeRpc\(\{ rpc: 'water_announcement_todo', tenantId, profileId, enabled: Boolean\(waterItem\) \}\)/, 'ดึงเฉพาะเมื่อบัญชีนี้เห็นเมนูเหตุการณ์น้ำ-ฝน')
  assert.match(home, /waterTodo\.status === 'loading' \? 'loading' : null/, 'โหลดพลาดไม่บล็อก "ไม่มีงานค้าง" ของงานอื่น')
  assert.match(home, /waterPending && \(\s*<WorkRow item=\{\{ \.\.\.waterItem, label: 'ประกาศน้ำ-ฝนรอคุณยืนยัน' \}\}/)
  assert.match(home, /hasTodo = workCards\.length > 0 \|\| summary\.status !== 'idle' \|\| waterPending/, 'ไม่เพิ่มกล่อง "ต้องทำตอนนี้" ให้คนที่ไม่มีงานน้ำ-ฝน')
  assert.match(home, /!hasAttention && !waterPending/)
  // ไม่ผ่าน todoState ถ้าไม่ใช่ผู้ยืนยัน: ตัวนับ = 0
  assert.match(read('src/lib/staffHomeData.js'), /export function clearHomeRpcCache\(rpc\)/)
  console.log('✓ หน้าแรกเจ้าหน้าที่: แถว "ประกาศน้ำ-ฝนรอคุณยืนยัน" ขึ้นเฉพาะผู้ยืนยันที่มีร่าง · โหลดพลาดไม่กระทบงานอื่น · ไม่เพิ่มกล่องให้คนที่ไม่เกี่ยว')
}

console.log('\n✅ water-announcements: ผ่านทุกข้อ')

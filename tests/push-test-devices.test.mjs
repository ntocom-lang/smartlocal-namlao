// ส่งทดสอบถึงเครื่อง + รายการเครื่องที่เปิดรับ + กันแจ้ง "คำร้องใหม่" ซ้ำ (ข้อ 2 ตั้งค่าแจ้งเตือน)
// รันด้วย: node tests/push-test-devices.test.mjs
//
// ทำไมต้องมี: ปุ่มส่งทดสอบเป็นช่องที่ใครก็กดได้ ต้องส่งได้แค่เครื่องของตัวเอง ข้อความตายตัว และจำกัดครั้ง
// ชื่อเครื่องต้องไม่ใช่ user-agent ดิบ และ "คำร้องใหม่" ต้องส่งครั้งเดียวต่อคำร้อง (เรียกได้โดยไม่ล็อกอิน)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// pushDevices.js import ./supabase (ต้องมี env ของ Vite) — ทดสอบฟังก์ชันล้วนด้วยการตัดเฉพาะส่วนนั้นมารัน
const devicesSource = read('src/lib/pushDevices.js')
const pure = devicesSource
  .replace(/^import .*$/m, '')
  .replace(/export async function[\s\S]*?\n}\n/g, '')
const { describeDevice, selfTestResultText } = await import(`data:text/javascript,${encodeURIComponent(pure)}`)
const SelfTest = await import('../supabase/functions/_shared/pushSelfTest.ts')

// ── ชื่อเครื่อง: สั้น อ่านง่าย ไม่ใช่ user-agent ดิบ ─────────────────────────────
const nav = (userAgent, extra = {}) => ({ userAgent, maxTouchPoints: 0, ...extra })
const browserWin = { matchMedia: () => ({ matches: false }) }
const appWin = { matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }) }
const cases = [
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Chrome · Windows'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 'Edge · Windows'],
  ['Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36', 'Samsung Internet · Android'],
  ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', 'Chrome · Android'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1', 'Safari · iPhone'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1', 'Chrome · iPhone'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.16.0', 'LINE · iPhone'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15', 'Safari · Mac'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox · Windows'],
  ['', 'เบราว์เซอร์'],
]
for (const [ua, want] of cases) assert.equal(describeDevice(nav(ua), browserWin), want, ua || '(ว่าง)')
// iPadOS ส่ง user-agent เป็น Mac แต่จอสัมผัส
assert.equal(describeDevice(nav(cases[7][0], { maxTouchPoints: 5 }), browserWin), 'Safari · iPad')
assert.equal(describeDevice(nav(cases[4][0]), appWin), 'Safari · iPhone · แอป', 'เปิดจากแอปที่ติดตั้ง')
for (const [ua] of cases) {
  const label = describeDevice(nav(ua), appWin)
  assert.ok(label.length >= 1 && label.length <= 60, 'ต้องผ่าน CHECK ความยาว 1–60 ของคอลัมน์')
  assert.doesNotMatch(label, /Mozilla|AppleWebKit|KHTML|\d+\.\d+/, 'ห้ามมีชิ้นส่วน user-agent/เลขเวอร์ชัน')
}
assert.equal(describeDevice(undefined, undefined), 'เบราว์เซอร์')

// ── ข้อความผลการส่งทดสอบ ───────────────────────────────────────────────────
assert.match(selfTestResultText({ ok: true }), /^ส่งแล้ว/)
assert.match(selfTestResultText({ ok: false, status: 429 }), /ไม่เกิน 3 ครั้งใน 10 นาที/)
assert.match(selfTestResultText({ ok: false, status: 404 }), /ยังไม่ได้ลงทะเบียน/)
assert.match(selfTestResultText({ ok: false, status: 200, failed: true }), /ไม่รับข้อความ/)
assert.match(selfTestResultText({ ok: false, status: 0 }), /ไม่สำเร็จ/)

// ── กติกาปุ่มส่งทดสอบ (ฝั่ง server) ────────────────────────────────────────────
assert.equal(SelfTest.SELF_TEST_KIND, 'self_test')
assert.equal(SelfTest.SELF_TEST_LIMIT, 3)
assert.equal(SelfTest.SELF_TEST_WINDOW_MS, 10 * 60 * 1000)
assert.deepEqual([0, 1, 2, 3, 4].map(SelfTest.selfTestAllowed), [true, true, true, false, false])
for (const bad of [null, undefined, -1, 'x', Number.NaN]) assert.equal(SelfTest.selfTestAllowed(bad), false, String(bad))
assert.equal(SelfTest.isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc:def'), true)
assert.equal(SelfTest.isPushEndpoint('https://web.push.apple.com/QGf0nB'), true)
for (const bad of ['http://evil.example/x', 'javascript:alert(1)', 'https://', '', null, 42, `https://a.example/${'x'.repeat(1100)}`]) {
  assert.equal(SelfTest.isPushEndpoint(bad), false, String(bad).slice(0, 40))
}
const message = SelfTest.selfTestMessage()
assert.deepEqual(Object.keys(message).sort(), ['body', 'title', 'url'])
assert.match(message.url, /^\/(?![/\\])/, 'ลิงก์ต้องเป็น path ภายในเว็บ')

// ── send-push: ปุ่มทดสอบส่งได้แค่เครื่องของตัวเอง ─────────────────────────────────
const edge = stripComments(read('supabase/functions/send-push/index.ts'))
const selfTest = edge.slice(edge.indexOf('async function handleSelfTest'), edge.indexOf('\nserve('))
assert.match(selfTest, /if \(!isPushEndpoint\(endpoint\)\) return jsonResponse\(\{ error: 'invalid endpoint' \}, 400\)/)
assert.match(selfTest, /if \(!caller\) return jsonResponse\(\{ error: 'unauthorized' \}, 401\)/, 'ต้องล็อกอิน')
assert.match(selfTest, /\.eq\('user_id', caller\.id\)\s*\.eq\('endpoint', endpoint\)/, 'ต้องเป็นเครื่องของผู้กดเท่านั้น')
assert.match(selfTest, /\.eq\('requested_by', caller\.id\)\s*\.gte\('created_at', since\)/, 'นับครั้งของผู้กดในช่วงเวลา')
assert.match(selfTest, /if \(!selfTestAllowed\(count\)\) return jsonResponse\(\{ error: 'too many tests' \}, 429\)/)
assert.match(selfTest, /sendToSubscriptions\(supabase, \[device as Subscription\], selfTestMessage\(\)\)/, 'ส่งเครื่องเดียว ข้อความตายตัว')
assert.ok(selfTest.indexOf('selfTestAllowed(count)') < selfTest.indexOf('sendToSubscriptions('), 'ตรวจจำนวนครั้งก่อนส่ง')
assert.match(edge, /if \(kind === SELF_TEST_KIND\) return await handleSelfTest\(supabase, req, endpoint\)/)

// ── send-push: "คำร้องใหม่" ส่งครั้งเดียวต่อคำร้อง ─────────────────────────────
assert.match(edge, /idempotency_key: `\$\{pushKind\}:\$\{row\.id\}`/)
assert.match(edge, /if \(pushKind === 'complaint_created' && !delivery\) return jsonResponse\(\{ sent: 0, failed: 0, duplicate: true \}\)/)
const serveBody = edge.slice(edge.indexOf('\nserve('))
assert.ok(serveBody.indexOf('openDelivery(') < serveBody.indexOf('sendToSubscriptions('), 'จองสิทธิ์ส่งก่อนส่งจริง')
assert.match(edge, /if \(error\?\.code === '23505'\) return null/, 'แถวซ้ำ = เคยส่งแล้ว')
assert.match(edge, /\.insert\(\{ \.\.\.values, channel: 'push', status: 'pending' \}\)/)

// ── migration ───────────────────────────────────────────────────────────────
const sql = read('supabase/migrations/20261029100000_push_device_label_and_push_channel.sql')
assert.match(sql, /ADD COLUMN IF NOT EXISTS device_label text;/)
assert.match(sql, /CHECK \(device_label IS NULL OR char_length\(btrim\(device_label\)\) BETWEEN 1 AND 60\)/)
assert.match(sql, /CHECK \(channel IN \('telegram', 'push'\)\)/)
assert.match(sql, /REVOKE ALL ON TABLE public\.push_subscriptions FROM anon;/)
assert.match(sql, /REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public\.push_subscriptions FROM authenticated;/)
assert.doesNotMatch(sql, /DROP POLICY|CREATE POLICY/, 'ไม่แตะ policy เดิมของเจ้าของแถว')

// ── หน้าเว็บ ─────────────────────────────────────────────────────────────────
const hook = read('src/hooks/usePushNotification.js')
assert.match(hook, /save\(\{ \.\.\.row, device_label: describeDevice\(\) \}\)/, 'เก็บชื่อเครื่องตอนเปิดรับ')
assert.match(hook, /if \(saveError\?\.code === 'PGRST204'\) \(\{ error: saveError \} = await save\(row\)\)/, 'DB ยังไม่มีคอลัมน์ต้องเปิดรับได้')
assert.doesNotMatch(hook, /navigator\.userAgent/, 'ห้ามเก็บ user-agent ดิบ')
assert.match(hook, /return \{[^}]*\bendpoint\b[^}]*\}/)
assert.match(stripComments(devicesSource), /invoke\('send-push', \{ body: \{ kind: 'self_test', endpoint \} \}\)/)
const page = read('src/pages/AccountNotificationSettingsPage.jsx')
assert.match(page, /\{push\.subscribed && push\.endpoint && !push\.loading && <SelfTestButton endpoint=\{push\.endpoint\} \/>\}/, 'ปุ่มทดสอบเฉพาะเครื่องที่เปิดรับแล้ว')
// รายการเครื่องโหลดเมื่อกดดูเท่านั้น — เปิดหน้าไม่เพิ่มการอ่านฐานข้อมูล
const deviceList = page.slice(page.indexOf('function PushDeviceList'), page.indexOf('export default function'))
assert.doesNotMatch(deviceList, /useEffect/, 'ห้ามโหลดรายการเครื่องเองตอนเปิดหน้า')
assert.match(deviceList, /onClick=\{\(\) => \(state\.open \? setState\(\(s\) => \(\{ \.\.\.s, open: false \}\)\) : load\(\)\)\}/)

console.log('✓ push-test-devices: ผ่านทุกข้อ')

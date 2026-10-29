// ผูก Telegram รายคน (ข้อ 3b ตั้งค่าแจ้งเตือน) — ตรรกะล้วน + โครงโค้ดของ webhook
// รันด้วย: node tests/telegram-link.test.mjs
//
// ทำไมต้องมี: telegram-webhook เปิดรับคำขอโดยไม่ตรวจ JWT ที่เกตเวย์ ด่านเดียวคือหัว secret
// และผูกได้ทางเดียวคือโทเคนจากหน้าเว็บที่ล็อกอินอยู่ — ถ้าด่านไหนหลวม คนนอกผูก Telegram ตัวเองเข้าบัญชีบุคลากรแล้วรับงานแทนได้

import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const T = await import('../supabase/functions/_shared/telegramLink.ts')
const { STAFF_PORTAL_ROLES } = await import('../src/lib/portalAccess.js')

// ── บทบาทที่ผูกได้ตรงกับฝั่งเว็บ · ประชาชนผูกไม่ได้ ──────────────────────────────────────
assert.deepEqual([...T.TELEGRAM_LINK_ROLES].sort(), [...STAFF_PORTAL_ROLES].sort(), 'ต้องตรงกับ STAFF_PORTAL_ROLES')
for (const role of ['citizen', 'kamnan', '', null, undefined, 'SUPERADMIN']) assert.equal(T.canLinkTelegram(role), false, String(role))
assert.equal(T.canLinkTelegram('technician'), true)

// ── จำกัดการขอลิงก์ ────────────────────────────────────────────────────────────
assert.equal(T.linkAllowed(0), true)
assert.equal(T.linkAllowed(T.LINK_TOKEN_LIMIT - 1), true)
assert.equal(T.linkAllowed(T.LINK_TOKEN_LIMIT), false)
for (const bad of [null, undefined, '0', NaN, -1, 1.5]) assert.equal(T.linkAllowed(bad), false, String(bad))

// ── โทเคน: 43 ตัว base64url (Telegram รับ start param ≤64 ตัว A-Za-z0-9_-) ไม่ซ้ำ ───────────────
const tokens = new Set(Array.from({ length: 200 }, () => T.newLinkToken()))
assert.equal(tokens.size, 200)
for (const token of tokens) assert.match(token, T.LINK_TOKEN_PATTERN)
assert.equal(await T.sha256Hex('abc'), createHash('sha256').update('abc').digest('hex'))

// ── secret ของ webhook = HMAC ของ bot token (คำนวณซ้ำได้ ไม่ต้องตั้ง secret ใหม่) ──────────────
const secret = await T.webhookSecret('123:ABC')
assert.equal(secret, createHmac('sha256', '123:ABC').update('smartlocal-telegram-webhook-v1').digest('hex'))
assert.match(secret, /^[A-Za-z0-9_-]{1,256}$/, 'Telegram รับ secret_token แค่ A-Z a-z 0-9 _ -')
assert.notEqual(await T.webhookSecret('123:ABD'), secret)
assert.equal(T.safeEqual(secret, secret), true)
assert.equal(T.safeEqual(secret, secret.slice(0, -1)), false)
assert.equal(T.safeEqual('', secret), false)

assert.equal(T.webhookUrl('https://x.supabase.co/'), 'https://x.supabase.co/functions/v1/telegram-webhook')
const token = T.newLinkToken()
assert.equal(T.deepLink('SmartLocalBot', token), `https://t.me/SmartLocalBot?start=${token}`)
assert.equal(T.deepLink('bad name', token), null)
assert.equal(T.deepLink('SmartLocalBot', 'short'), null)

// ── แปลง update ─────────────────────────────────────────────────────────────────
const dm = (text, from = { id: 42, first_name: 'สมชาย', last_name: 'ใจดี' }) => ({ message: { chat: { id: 42, type: 'private' }, from, text } })
assert.deepEqual(T.classifyUpdate(dm(`/start ${token}`)), { kind: 'start', chatId: 42, token, display: 'สมชาย ใจดี' })
assert.deepEqual(T.classifyUpdate(dm(`/start@SmartLocalBot ${token}`, { id: 42, username: 'somchai', first_name: 'ส' })), { kind: 'start', chatId: 42, token, display: '@somchai' })
assert.deepEqual(T.classifyUpdate(dm('/start')), { kind: 'start_bare', chatId: 42 })
assert.deepEqual(T.classifyUpdate(dm('/start ../../etc')), { kind: 'start_bare', chatId: 42 }, 'โทเคนรูปแบบผิดไม่ส่งเข้า DB')
assert.deepEqual(T.classifyUpdate(dm('สวัสดี')), { kind: 'start_bare', chatId: 42 })
assert.deepEqual(T.classifyUpdate(dm('/stop')), { kind: 'stop', chatId: 42 })
assert.deepEqual(T.classifyUpdate({ my_chat_member: { chat: { id: 42, type: 'private' }, new_chat_member: { status: 'kicked' } } }), { kind: 'blocked', chatId: 42 })
assert.deepEqual(T.classifyUpdate({ my_chat_member: { chat: { id: 42, type: 'private' }, new_chat_member: { status: 'member' } } }), { kind: 'ignore' })
// /start ในกลุ่มต้องไม่ผูก (คนในกลุ่มเห็นลิงก์กันหมด และ chat_id กลุ่มไม่ใช่ของคนใดคนหนึ่ง)
assert.equal(T.classifyUpdate({ message: { chat: { id: -100123, type: 'supergroup', title: 'กลุ่มงาน' }, text: `/start ${token}` } }).kind, 'group')
assert.deepEqual(T.classifyUpdate({ my_chat_member: { chat: { id: -100123, type: 'supergroup', title: 'กลุ่ม ทต.' }, new_chat_member: { status: 'administrator' } } }),
  { kind: 'group', chatId: -100123, chatType: 'supergroup', title: 'กลุ่ม ทต.', botStatus: 'administrator', migratedTo: null })
assert.deepEqual(T.classifyUpdate({ message: { chat: { id: -555, type: 'group', title: 'g' }, migrate_to_chat_id: -100999 } }),
  { kind: 'group', chatId: -555, chatType: 'group', title: 'g', botStatus: null, migratedTo: -100999 })
for (const junk of [null, 'x', 42, {}, { message: {} }, { message: { chat: { id: 'a', type: 'private' } } }, { edited_message: dm('/stop').message }]) {
  assert.deepEqual(T.classifyUpdate(junk), { kind: 'ignore' }, JSON.stringify(junk))
}
assert.equal(T.telegramDisplay({ first_name: 'ก'.repeat(100) }).length, 64)
assert.equal(T.telegramDisplay({ first_name: '  ' }), null)
assert.equal(T.telegramDisplay(null), null)

assert.equal(T.linkReply('linked'), T.LINK_REPLY.linked)
assert.equal(T.linkReply('expired'), T.LINK_REPLY.expired)
assert.equal(T.linkReply('อะไรก็ได้'), T.LINK_REPLY.invalid)
// ข้อความถูกส่งด้วย parse_mode HTML — ห้ามมีอักขระที่ Telegram ตีความเป็นแท็ก
for (const text of Object.values(T.LINK_REPLY)) assert.doesNotMatch(text, /[<>&]/)

const state = T.webhookState({ url: 'https://evil.example/hook', pending_update_count: 3, last_error_message: 'x', last_error_date: 1700000000 }, 'https://a/functions/v1/telegram-webhook')
assert.deepEqual(state, { configured: false, other: true, otherHost: 'evil.example', pending: 3, lastError: 'x', lastErrorAt: '2023-11-14T22:13:20.000Z' })
assert.equal(T.webhookState({ url: 'https://a/functions/v1/telegram-webhook' }, 'https://a/functions/v1/telegram-webhook').configured, true)
assert.equal(T.webhookState(null, 'https://a').other, false)

// ── โครงโค้ด webhook ──────────────────────────────────────────────────────────────
const fn = stripComments(read('supabase/functions/telegram-webhook/index.ts'))
const secretCheck = fn.indexOf('safeEqual(telegramSecret')
assert.ok(secretCheck > 0, 'ต้องตรวจหัว secret')
assert.ok(secretCheck < fn.indexOf('handleUpdate(admin, update)', secretCheck), 'ตรวจ secret ก่อนประมวลผล update')
assert.match(fn, /X-Telegram-Bot-Api-Secret-Token/)
assert.match(fn, /auth\.getUser\(\)/, 'action จากหน้าเว็บต้องตรวจ JWT เอง (deploy แบบ --no-verify-jwt)')
assert.match(fn, /role !== 'superadmin'/, 'status/setup เฉพาะ superadmin')
assert.match(fn, /state\.other && body\.force !== true/, 'ห้ามทับ webhook ที่อื่นโดยไม่ตั้งใจ')
assert.match(fn, /telegram_link_consume/, 'ผูกผ่านฟังก์ชัน DB เท่านั้น (ทำในธุรกรรมเดียว)')
assert.doesNotMatch(fn, /from\('telegram_user_links'\)\s*\.(insert|upsert|update)/, 'ห้ามเขียนลิงก์ตรงจาก function')
assert.match(fn, /sha256Hex\(token\)/, 'เก็บโทเคนเป็น hash')
assert.doesNotMatch(fn, /insert\(\{\s*token_hash:\s*token\b/, 'ห้ามเก็บโทเคนดิบ')
assert.match(fn, /canLinkTelegram\(role\)/)
assert.match(read('supabase/functions/telegram-webhook/index.ts'), /--no-verify-jwt/, 'คอมเมนต์หัวไฟล์ต้องเตือนเรื่อง deploy')

// ── หน้าเว็บ ────────────────────────────────────────────────────────────────────
const page = stripComments(read('src/pages/AccountNotificationSettingsPage.jsx'))
assert.match(page, /canLinkTelegram\(role\) && <TelegramLinkSettings/, 'โชว์เฉพาะบุคลากร')
const ui = stripComments(read('src/components/notifications/TelegramLinkSettings.jsx'))
assert.match(ui, /document\.hidden/, 'ตรวจผลเฉพาะตอนหน้าเปิดอยู่')
assert.doesNotMatch(ui, /visibilitychange/, 'ห้ามดึงทันทีตอนสลับกลับมาหน้าเว็บ (มือถือค้าง)')
assert.match(ui, /data-telegram-consent/, 'ต้องแจ้งก่อนเชื่อม (PDPA)')
assert.doesNotMatch(stripComments(read('src/lib/telegramLink.js')), /chat_id/, 'หน้าเว็บไม่ขอ chat_id')

console.log('telegram-link: ผ่านทั้งหมด')

// ป๊อปอัป/เสียง/สั่น/ตัวเลขบนไอคอนแอป เมื่อมีรายการใหม่เข้ากระดิ่ง — ตรรกะล้วน
// รันด้วย: node tests/notification-device-prefs.test.mjs
//
// ทำไมต้องมี: ค่าตั้งรายเครื่องต้องไม่ดังเองโดยไม่มีใครเลือก (เสียง/สั่นปิดเป็นค่าเริ่มต้น),
// ต้องไม่เด้งของค้างเดิมตอนเปิดหน้า และป๊อปอัปต้องไม่ขึ้นชื่อหมวด (คนข้างๆ เห็นจอได้)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CITIZEN_STATUS_MSG, MAX_ALERTS_AT_ONCE, STAFF_STATUS_MSG,
  alertText, complaintShortRef, freshUnreadItems, notificationKey,
} from '../src/lib/notificationAlerts.js'
import {
  DEFAULT_NOTIFICATION_PREFS, NOTIFICATION_PREFS_EVENT,
  appBadgeSupported, deviceCanVibrate, notificationPrefsKey, parseNotificationPrefs,
  readNotificationPrefs, readNotificationPrefsRaw, sanitizeNotificationPrefs, syncAppBadge,
  vibrateForNotification, writeNotificationPrefs,
} from '../src/lib/notificationPrefs.js'
import { playNotificationSound } from '../src/lib/notificationSound.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

// ── ค่าตั้งรายเครื่อง ─────────────────────────────────────────────────────────
assert.deepEqual({ ...DEFAULT_NOTIFICATION_PREFS }, { popup: true, sound: false, vibrate: false }, 'เสียง/สั่นต้องปิดเป็นค่าเริ่มต้น')
assert.equal(Object.isFrozen(DEFAULT_NOTIFICATION_PREFS), true)
assert.deepEqual(sanitizeNotificationPrefs(null), { popup: true, sound: false, vibrate: false })
assert.deepEqual(sanitizeNotificationPrefs({ sound: true, vibrate: 'yes', extra: 1 }), { popup: true, sound: true, vibrate: false })
assert.deepEqual(parseNotificationPrefs('{พัง'), { popup: true, sound: false, vibrate: false })
// แยกรายบัญชี — คอมในสำนักงานใช้ร่วมกันหลายคน
assert.notEqual(notificationPrefsKey('user-a'), notificationPrefsKey('user-b'))
assert.equal(notificationPrefsKey(null), notificationPrefsKey(undefined))

function memoryStorage() {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map }
}
const store = memoryStorage()
const events = []
globalThis.addEventListener?.(NOTIFICATION_PREFS_EVENT, (event) => events.push(event.detail))
assert.deepEqual(readNotificationPrefs('user-a', store), { popup: true, sound: false, vibrate: false })
assert.deepEqual(writeNotificationPrefs('user-a', { popup: false, sound: true }, store), { prefs: { popup: false, sound: true, vibrate: false }, saved: true })
assert.deepEqual(readNotificationPrefs('user-a', store), { popup: false, sound: true, vibrate: false })
assert.deepEqual(readNotificationPrefs('user-b', store), { popup: true, sound: false, vibrate: false }, 'บัญชีอื่นบนเครื่องเดียวกันต้องได้ค่าเริ่มต้น')
assert.equal(readNotificationPrefsRaw('user-a', store), JSON.stringify({ popup: false, sound: true, vibrate: false }))
if (globalThis.addEventListener) assert.equal(events.at(-1)?.key, notificationPrefsKey('user-a'), 'หน้าที่เปิดอยู่ต้องรู้ว่าค่าเปลี่ยน')
// localStorage ใช้ไม่ได้ (โหมดไม่ระบุตัวตน/ถูกบล็อก) — ไม่พัง และบอกว่าไม่ได้บันทึก
const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
assert.deepEqual(readNotificationPrefs('user-a', broken), { popup: true, sound: false, vibrate: false })
assert.equal(writeNotificationPrefs('user-a', { sound: true }, broken).saved, false)

// ── ความสามารถของเครื่อง ────────────────────────────────────────────────────
const coarse = { matchMedia: () => ({ matches: true }) }
const fine = { matchMedia: () => ({ matches: false }) }
assert.equal(deviceCanVibrate({ vibrate: () => true }, coarse), true, 'Android จอสัมผัส')
assert.equal(deviceCanVibrate({}, coarse), false, 'iPhone ไม่มี navigator.vibrate')
assert.equal(deviceCanVibrate({ vibrate: () => true }, fine), false, 'คอมมี vibrate แต่ไม่มีมอเตอร์ — ไม่โชว์สวิตช์')
const vibrations = []
assert.equal(vibrateForNotification({ vibrate: (pattern) => { vibrations.push(pattern); return true } }), true)
assert.deepEqual(vibrations, [[30, 60, 30]])
assert.equal(vibrateForNotification({ vibrate() { throw new Error('x') } }), false)
const badges = []
const badgeNav = { setAppBadge: (n) => { badges.push(n); return Promise.resolve() }, clearAppBadge: () => { badges.push('clear'); return Promise.resolve() } }
assert.equal(appBadgeSupported(badgeNav), true)
assert.equal(appBadgeSupported({}), false)
assert.equal(syncAppBadge(3, badgeNav), true)
assert.equal(syncAppBadge(0, badgeNav), true)
assert.deepEqual(badges, [3, 'clear'], 'ไม่มีรายการค้าง = สั่งล้างตัวเลขบนไอคอนตรงๆ')
assert.equal(syncAppBadge(2, {}), false)
assert.equal(syncAppBadge(2, { setAppBadge: () => Promise.reject(new Error('denied')) }), true, 'สิทธิ์ถูกปฏิเสธต้องไม่โยน error')

// ── เสียง (Web Audio) ────────────────────────────────────────────────────────
function fakeAudio() {
  const log = { created: 0, oscillators: [], resumed: 0 }
  class FakeAudioContext {
    constructor() { log.created++; this.state = 'suspended'; this.currentTime = 1; this.destination = {} }
    resume() { log.resumed++; this.state = 'running'; return Promise.resolve() }
    createOscillator() {
      const osc = { frequency: {}, connect: () => {}, start: (t) => { osc.startAt = t }, stop: (t) => { osc.stopAt = t } }
      log.oscillators.push(osc)
      return osc
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => {} } }
  }
  return { FakeAudioContext, log }
}
const audio = fakeAudio()
assert.equal(playNotificationSound(audio.FakeAudioContext), true)
assert.equal(audio.log.oscillators.length, 2, 'เสียงสองโน้ต')
assert.ok(audio.log.oscillators.every((osc) => osc.stopAt - 1 < 0.5), 'เสียงสั้นไม่เกินครึ่งวินาที')
assert.equal(audio.log.resumed, 1, 'บริบทเสียงที่ถูกพักต้องปลุกก่อนเล่น')
assert.equal(playNotificationSound(audio.FakeAudioContext), true)
assert.equal(audio.log.created, 1, 'ใช้บริบทเสียงตัวเดิม ไม่สร้างใหม่ทุกครั้ง')
assert.equal(playNotificationSound(undefined), false, 'เบราว์เซอร์ไม่มี Web Audio')
assert.equal(playNotificationSound(class { constructor() { throw new Error('blocked') } }), false)

// ── รายการใหม่ที่ต้องเด้ง ────────────────────────────────────────────────────
const now = Date.parse('2026-10-29T03:00:00Z')
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString()
const item = (id, status, minutesAgo, extra = {}) => ({ id, status, updated_at: at(minutesAgo), created_at: at(minutesAgo), complaint_number: 42, ...extra })
const before = [item('a', 'new', 30), item('b', 'new', 20)]
const previous = { keys: new Set(before.map(notificationKey)), at: now - 60_000 }

// รอบแรกหลังเปิดหน้า: ไม่เด้งของค้างเดิม
assert.deepEqual(freshUnreadItems(null, before), [])
// คำร้องใหม่ + เรื่องเดิมเปลี่ยนสถานะ = เด้ง · เรื่องเดิมสถานะเดิม = ไม่เด้ง
const after = [item('c', 'new', 0), item('a', 'done', 0), item('b', 'new', 20)]
assert.deepEqual(freshUnreadItems(previous, after).map(notificationKey), ['c_new', 'a_done'])
// อ่านแล้วจากอีกเครื่อง / กด "อ่านทั้งหมด" หลังรายการนั้น = ไม่เด้ง
assert.deepEqual(freshUnreadItems(previous, after, { readKeys: new Set(['c_new']) }).map(notificationKey), ['a_done'])
assert.deepEqual(freshUnreadItems(previous, after, { clearedAt: now + 1000 }), [])
// ของเก่าที่หลุดเข้ามาในรายการ 50 อันดับ (อัปเดตนานแล้ว) ไม่ใช่ของใหม่
assert.deepEqual(freshUnreadItems(previous, [item('old', 'new', 120)]), [])
// นาฬิกาเครื่องเดินเร็วกว่าฐานข้อมูลไม่เกิน 5 นาที ยังเด้ง
assert.deepEqual(freshUnreadItems({ keys: new Set(), at: now }, [item('skew', 'new', 4)]).map(notificationKey), ['skew_new'])
assert.deepEqual(freshUnreadItems(previous, [item('bad', 'new', 0, { updated_at: 'ไม่ใช่วันที่' })]), [])
assert.equal(MAX_ALERTS_AT_ONCE, 2)

// ── ข้อความป๊อปอัป: ไม่มีชื่อหมวด (คนข้างๆ เห็นจอได้) ───────────────────────────
const created = new Date(2026, 9, 29, 10, 0, 0).toISOString()
assert.equal(complaintShortRef({ complaint_number: 42, created_at: created }), '6910042', 'ปี พ.ศ. 2 หลัก + เดือน + ลำดับ 3 หลัก')
assert.equal(complaintShortRef({ complaint_number: null, created_at: created }), null)
const staffAlert = alertText({ id: 'x', status: 'new', category: 'corruption', complaint_number: 7, created_at: created }, 'staff')
assert.deepEqual(staffAlert, { title: STAFF_STATUS_MSG.new, body: 'คำร้องเลขที่ 6910007' })
const citizenAlert = alertText({ id: 'x', status: 'closed', category: 'corruption', complaint_number: 7, created_at: created }, 'citizen')
assert.equal(citizenAlert.title, CITIZEN_STATUS_MSG.closed)
for (const audience of ['staff', 'citizen']) {
  for (const status of ['new', 'pending', 'received', 'in_progress', 'done', 'completed', 'closed', 'rejected', 'อื่นๆ']) {
    const text = alertText({ id: 'x', status, category: 'corruption', complaint_number: 7, created_at: created }, audience)
    assert.ok(text.title && text.body, `${audience}/${status} ต้องมีข้อความ`)
    assert.doesNotMatch(`${text.title} ${text.body}`, /ทุจริต|corruption/, `${audience}/${status} ห้ามมีชื่อหมวด`)
  }
}

// ── หน้ารายการแจ้งเตือนใช้ข้อความ/เลขที่ชุดเดียวกับป๊อปอัป ───────────────────────
const page = read('src/pages/NotificationsPage.jsx')
assert.match(page, /import \{ CITIZEN_STATUS_MSG, STAFF_STATUS_MSG, complaintShortRef \} from '\.\.\/lib\/notificationAlerts'/)
assert.doesNotMatch(page, /const (CITIZEN|STAFF)_STATUS_MSG = \{/, 'ห้ามมีข้อความสถานะชุดที่สอง')
assert.match(page, /const cno = complaintShortRef\(n\)/)

// ── กระดิ่ง: เด้งเฉพาะตอนดึงรอบถัดไป (realtime) และคุมด้วยค่าตั้งรายเครื่อง ─────────────
const ctx = read('src/contexts/NotificationsContext.jsx')
assert.match(ctx, /const previous = round\.scope === scope \? round\.previous : null/, 'เปลี่ยนบัญชี/หน่วยงานแล้วรอบแรกต้องไม่เด้ง')
assert.match(ctx, /announce\(freshUnreadItems\(previous, rows, \{ readKeys, clearedAt: cleared \}\), audience\)/)
assert.match(ctx, /if \(prefs\.popup\) \{/)
assert.match(ctx, /if \(prefs\.sound\) playNotificationSound\(\)/)
assert.match(ctx, /if \(prefs\.vibrate && deviceCanVibrate\(\)\) vibrateForNotification\(\)/)
assert.match(ctx, /useEffect\(\(\) => \{ syncAppBadge\(uid \? unreadCount : 0\) \}, \[uid, unreadCount\]\)/)
// ห้ามดึงข้อมูลตอนสลับกลับมาหน้าเว็บ — เคยทำ supabase ค้างทั้งแอปบนมือถือ (src/lib/supabase.js)
assert.doesNotMatch(ctx, /visibilitychange/)

console.log('✓ notification-device-prefs: ผ่านทุกข้อ')

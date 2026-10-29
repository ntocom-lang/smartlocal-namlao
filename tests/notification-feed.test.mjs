// กระดิ่งรวม "งานของฉัน" หลายหมวด (ข้อ 3 ตั้งค่าแจ้งเตือน) — ตรรกะล้วน + โครงโค้ด
// รันด้วย: node tests/notification-feed.test.mjs
// (การตัดสินสิทธิ์จริงอยู่ฝั่งฐานข้อมูล ทดสอบใน tests/notification-feed-db.test.mjs)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FEED_REFRESH_MS, NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_KEYS,
  feedRound, freshFeedItems, isFeedItem, isMissingFeedFunction, mapFeedItem,
} from '../src/lib/notificationFeed.js'
import { sanitizeNotificationPrefs } from '../src/lib/notificationPrefs.js'
import { alertText } from '../src/lib/notificationAlerts.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

// ── หมวด ────────────────────────────────────────────────────────────────────
assert.deepEqual(NOTIFICATION_CATEGORY_KEYS, ['complaint', 'esign', 'event', 'eservice', 'patient'])
assert.ok(NOTIFICATION_CATEGORIES.every((c) => c.label && !/[a-z_]/.test(c.label.replace(/E-Service/, ''))), 'ชื่อหมวดเป็นภาษาไทย')
assert.equal(FEED_REFRESH_MS, 120000, 'ดึงซ้ำทุก 2 นาที (ประมาณการโควตาแผนฟรีอิงค่านี้)')

// ── แปลรหัสจากฐานข้อมูลเป็นข้อความ ─ ไม่มีชื่อคน/ปลายทาง/วัตถุประสงค์ ─────────────────
const pii = { requester_name: 'ชื่อผู้ขอ', destination: 'ปลายทางลับ', purpose: 'วัตถุประสงค์', phone: '0812345678' }
const esign = mapFeedItem({ category: 'esign', key: 'esign:t1:dept_head', ref: 't1', status: 'sign', detail: 'ผอ.กอง', at: '2026-10-30T01:00:00Z', ...pii })
assert.equal(esign.title, 'รอลงนามของคุณ')
assert.equal(esign.body, 'ใบขอใช้รถ · ผอ.กอง · ออกเดินทาง 30 ต.ค. 69')
assert.deepEqual([esign._href, esign._hrefState], ['/staff', null], 'การ์ดรอลงนามอยู่หน้าแรกเจ้าหน้าที่')
assert.equal(mapFeedItem({ category: 'esign', key: 'esign:t1:authority', status: 'approve', detail: 'ผู้มีอำนาจ' }).title, 'รออนุมัติของคุณ')
const event = mapFeedItem({ category: 'event', key: 'event:a1', ref: 'e1', status: 'preside', detail: '2026-11-02', at: '2026-10-29T01:00:00Z' })
assert.deepEqual([event.title, event.body, event._href], ['ได้รับมอบหมายเป็นประธานแทน', 'วันที่ 2 พ.ย. 69', '/events'])
assert.equal(mapFeedItem({ category: 'event', key: 'event:a2', status: 'attend', detail: '2026-11-02' }).title, 'ได้รับมอบหมายไปประชุมแทน')
assert.equal(mapFeedItem({ category: 'event', key: 'event:a3', status: 'join', detail: '2026-11-02' }).title, 'ได้รับมอบหมายร่วมงานแทน')
const eservice = mapFeedItem({ category: 'eservice', key: 'eservice:r1:pending', status: 'pending', detail: 'water_supply_request' },
  (code) => (code === 'water_supply_request' ? '🚰 ขออนุญาตใช้น้ำประปา' : code))
assert.deepEqual([eservice.title, eservice.body, eservice._hrefState], ['คำขอใหม่รอรับเรื่อง', 'ขออนุญาตใช้น้ำประปา', { module: 'inbox' }])
const patient = mapFeedItem({ category: 'patient', key: 'patient:2:1', status: 'pending', detail: '3' })
assert.deepEqual([patient.title, patient.body, patient._count, patient._hrefState], ['งานรถรับ-ส่งผู้ป่วยรอดำเนินการ', '3 รายการ', 3, { module: 'patient-transport' }])
for (const item of [esign, event, eservice, patient]) {
  assert.equal(isFeedItem(item), true)
  assert.equal(item.id, item.key, 'อ่านแล้ว/ป๊อปอัปอ้างด้วย key ของฐานข้อมูล')
  assert.doesNotMatch(JSON.stringify(item), /ชื่อผู้ขอ|ปลายทางลับ|วัตถุประสงค์|0812345678/)
  assert.match(item._href, /^\/(?![/\\])/)
  assert.deepEqual(alertText(item, 'staff'), { title: item.title, body: item.body }, 'ป๊อปอัปใช้ข้อความเดียวกับกระดิ่ง')
}
assert.equal(mapFeedItem({ category: 'complaint', key: 'x' }), null, 'คำร้องไม่มาทางฟีด')
assert.equal(mapFeedItem({ category: 'esign' }), null, 'ไม่มี key ใช้ไม่ได้')
assert.equal(mapFeedItem(null), null)
assert.equal(isFeedItem({ id: 'c1', status: 'new' }), false, 'รายการคำร้องเดิมไม่ใช่ฟีด')

// ── เด้งเตือน: รอบแรกไม่เด้ง · งานใหม่เด้ง · อ่านแล้วไม่เด้ง · รถผู้ป่วยเด้งเฉพาะจำนวนเพิ่ม ─────────
const round1 = [esign, eservice, mapFeedItem({ category: 'patient', key: 'patient:1:0', detail: '1' })]
assert.deepEqual(freshFeedItems(null, round1), [], 'รอบแรกหลังเปิดหน้าไม่เด้งของค้าง')
const prev = feedRound(round1)
assert.equal(prev.patientCount, 1)
const newEvent = event
const round2 = [esign, eservice, newEvent, mapFeedItem({ category: 'patient', key: 'patient:2:0', detail: '2' })]
assert.deepEqual(freshFeedItems(prev, round2).map((i) => i.key), ['event:a1', 'patient:2:0'])
assert.deepEqual(freshFeedItems(prev, round2, new Set(['event:a1'])).map((i) => i.key), ['patient:2:0'], 'อ่านจากเครื่องอื่นแล้วไม่เด้ง')
assert.deepEqual(freshFeedItems(feedRound(round2), [mapFeedItem({ category: 'patient', key: 'patient:1:0', detail: '1' })]), [], 'งานลดลงไม่เด้ง')
assert.deepEqual(freshFeedItems(feedRound(round2), [mapFeedItem({ category: 'patient', key: 'patient:0:2', detail: '2' })]), [], 'จำนวนเท่าเดิมไม่เด้ง')
assert.deepEqual(feedRound([]).patientCount, 0)

// ── ฐานข้อมูลยังไม่มีฟังก์ชัน: เงียบ (กระดิ่งคำร้องทำงานต่อ) · error อื่นต้องรายงาน ───────────────
assert.equal(isMissingFeedFunction({ code: 'PGRST202', message: 'Could not find the function public.my_notification_feed' }), true)
assert.equal(isMissingFeedFunction({ message: 'function public.my_notification_feed(uuid) does not exist' }), true)
assert.equal(isMissingFeedFunction({ code: '42501', message: 'permission denied for function my_notification_feed' }), false)
assert.equal(isMissingFeedFunction(null), false)

// ── ค่าตั้งหมวดที่ปิดเด้ง ─────────────────────────────────────────────────────
assert.deepEqual(sanitizeNotificationPrefs({ muted: ['esign', 'esign', 'ไม่มีหมวดนี้', 7, 'patient'] }).muted, ['esign', 'patient'])
assert.deepEqual(sanitizeNotificationPrefs({ muted: 'esign' }).muted, [])
assert.deepEqual(sanitizeNotificationPrefs(null).muted, [])

// ── กระดิ่ง (NotificationsContext) ───────────────────────────────────────────
const ctx = stripComments(read('src/contexts/NotificationsContext.jsx'))
assert.match(ctx, /supabase\.rpc\('my_notification_feed', \{ p_municipality_id: tenantId \}, \{ get: true \}\)/, 'อ่านอย่างเดียว เรียกแบบ GET')
assert.match(ctx, /if \(!uid \|\| !tenantId \|\| audience !== 'staff' \|\| profileLoading\) return\n(?:\s*\n)? {4}const \{ data, error \} = await supabase\.rpc/, 'ฟีดเฉพาะบุคลากร')
assert.match(ctx, /window\.setInterval\(\(\) => \{ if \(!document\.hidden\) fetchFeed\(\) \}, FEED_REFRESH_MS\)/, 'ดึงซ้ำเฉพาะตอนหน้าเปิดอยู่')
assert.doesNotMatch(ctx, /visibilitychange/)
assert.match(ctx, /const list = fresh\.filter\(\(item\) => !prefs\.muted\?\.includes\(kindOf\(item\)\)\)\.slice\(0, MAX_ALERTS_AT_ONCE\)/, 'หมวดที่ปิดเด้งไม่ป๊อปอัป/ไม่มีเสียง')
assert.match(ctx, /announce\(freshFeedItems\(previous, feedItems, readStateRef\.current\.readIds\), audience\)/)
assert.match(ctx, /categories: \['complaint', \.\.\.feedCategories\]/)
assert.match(ctx, /_unread: isFeedItem\(n\)\n {6}\? !readIds\.has\(itemKey\(n\)\)/, 'ฟีดอ่านแล้วรายรายการ')
assert.match(ctx, /\(\) => \{ fetchItems\(\); fetchFeed\(\) \}/, 'คำร้องเปลี่ยน = ดึงฟีดด้วย')

// ── migration: ฟีดอ่านผ่าน RLS เดิม (INVOKER) ไม่คืนข้อมูลส่วนบุคคล ───────────────────
const sql = read('supabase/migrations/20261029110000_my_notification_feed.sql')
const feedFn = stripComments(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.my_notification_feed'), sql.indexOf('REVOKE ALL ON FUNCTION public.my_notification_feed')))
assert.match(feedFn, /SECURITY INVOKER/)
assert.doesNotMatch(feedFn, /SECURITY DEFINER/)
// ชื่อฟิลด์อยู่ต้นบรรทัดของ jsonb_build_object แต่ละก้อน (ค่าอยู่หลังจุลภาคบรรทัดเดียวกัน)
const objectKeys = [...feedFn.matchAll(/jsonb_build_object\(\n\s*'category'[\s\S]*?\n\s*\)\)?/g)].map((m) => [...m[0].matchAll(/\n\s*'([a-z_]+)',/g)].map((k) => k[1]))
assert.equal(objectKeys.length, 4, 'สี่หมวด')
for (const keys of objectKeys) assert.deepEqual(keys, ['category', 'key', 'ref', 'status', 'detail', 'at'])
assert.doesNotMatch(feedFn, /requester_|phone|address|purpose|destination|reporter_name|staff_notes/, 'ห้ามอ่านคอลัมน์ข้อมูลส่วนบุคคล')
assert.match(sql, /REVOKE ALL ON FUNCTION public\.my_notification_feed\(uuid\) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public\.my_notification_feed\(uuid\) TO authenticated;/)
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.my_patient_transport_role\(p_municipality_id uuid\)[\s\S]*?SECURITY DEFINER[\s\S]*?AS \$\$ SELECT public\.ptb_role\(p_municipality_id\) \$\$;/)

// ── หน้ารายการ + หน้าตั้งค่า ────────────────────────────────────────────────
const page = read('src/pages/NotificationsPage.jsx')
assert.match(page, /if \(isFeedItem\(n\)\) \{/, 'แถวงานหมวดอื่นต้องแสดง (เดิมข้ามเพราะไม่มีสถานะคำร้อง)')
const mute = read('src/components/notifications/CategoryMuteSettings.jsx')
assert.match(mute, /NOTIFICATION_CATEGORIES\.filter\(\(category\) => categories\.includes\(category\.key\)\)/, 'โชว์เฉพาะหมวดที่ได้รับจริง')
assert.match(mute, /if \(shown\.length < 2\) return null/)

console.log('✓ notification-feed: ผ่านทุกข้อ')

// ตัวตรวจงบรูป (scripts/check-image-budget.mjs) — เฉพาะตรรกะล้วน ไม่ยิงเครือข่าย
// ผลจริงที่เป็นที่มาของเกณฑ์: 2026-10-05 ตัวตรวจรายงานว่าทั้ง 4 อปท. ไม่ผ่านงบ (น้ำเลา 7.7 MB / ทุ่งแค้ว 7.5 MB / ตำหนักธรรม 3.9 MB / demo 3.5 MB)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_BUDGET_KB, DEFAULT_SINGLE_MAX_KB, collectImageRefs, formatReport, isDriveFileUrl, normalizeImageUrl, summarizeBudget,
} from '../scripts/check-image-budget.mjs'

const SB = 'https://umxssfahtuprnztlytdd.supabase.co'
const KB = 1024

test('import ไม่ทำให้สคริปต์รันเอง (ไม่ยิงเครือข่าย ไม่ process.exit)', () => {
  assert.equal(typeof summarizeBudget, 'function')
})

test('ค่าเริ่มต้นของเกณฑ์: รวม 3 MB (กรณีเลวร้ายสุด) · รูปเดี่ยว 400 KB', () => {
  assert.equal(DEFAULT_BUDGET_KB, 3072)
  assert.equal(DEFAULT_SINGLE_MAX_KB, 400)
})

test('normalizeImageUrl: URL Drive แบบเก่าถูกแปลงเป็น Edge Function ตรงกับ toReliableImageUrl · อื่นๆ คงเดิม · ค่าไม่ใช่ URL → null', () => {
  assert.equal(normalizeImageUrl('https://drive.google.com/uc?id=ABC123&export=view', SB), `${SB}/functions/v1/drive-file?id=ABC123`)
  assert.equal(normalizeImageUrl('https://lh3.googleusercontent.com/d/XYZ789=s0', SB), `${SB}/functions/v1/drive-file?id=XYZ789`)
  const same = `${SB}/storage/v1/object/public/logos/a.png?v=1`
  assert.equal(normalizeImageUrl(same, SB), same)
  for (const bad of [null, undefined, '', 'drive:abc', '/relative.png', 42]) assert.equal(normalizeImageUrl(bad, SB), null)
})

test('isDriveFileUrl แยกรูป Drive ออกจากรูป Storage', () => {
  assert.equal(isDriveFileUrl(`${SB}/functions/v1/drive-file?id=abc&v=1`), true)
  assert.equal(isDriveFileUrl(`${SB}/storage/v1/object/public/logos/a.png`), false)
})

test('collectImageRefs: รวมทุกที่มา ตัดค่าว่าง/ซ้ำ และระบุที่มาของแต่ละรูป', () => {
  const dup = `${SB}/storage/v1/object/public/logos/a.png`
  const refs = collectImageRefs({
    tenant: { logo_url: dup, header_image_url: null, smart_city_image_url: `${SB}/functions/v1/drive-file?id=SC1`, tourism_background_url: '' },
    banners: [{ image_url: `${SB}/b1.png` }, { image_url: dup }],        // ซ้ำกับโลโก้ → นับครั้งเดียว
    posts: [{ image_url: `${SB}/p1.jpg` }, { image_url: null }],
    places: [{ image_url: `${SB}/t1.jpg` }],
  }, SB)
  assert.deepEqual(refs.map(r => r.source), ['โลโก้', 'Smart City', 'แบนเนอร์', 'ข่าว/กิจกรรม', 'ท่องเที่ยว'])
  assert.equal(new Set(refs.map(r => r.url)).size, refs.length)
})

test('summarizeBudget: ผ่านเมื่อรวมไม่เกินงบ ไม่มีรูปเดี่ยวเกิน และวัดได้ครบ', () => {
  const s = summarizeBudget([
    { source: 'โลโก้', url: 'a', bytes: 40 * KB },
    { source: 'แบนเนอร์', url: 'b', bytes: 300 * KB },
  ])
  assert.equal(s.passed, true)
  assert.equal(s.totalBytes, 340 * KB)
  assert.deepEqual(s.overSingle, [])
})

test('summarizeBudget: ยอดรวมเกินงบ → ไม่ผ่าน (แม้ไม่มีรูปเดี่ยวใหญ่)', () => {
  const imgs = Array.from({ length: 11 }, (_, i) => ({ source: 'ข่าว/กิจกรรม', url: `u${i}`, bytes: 300 * KB })) // 3,300 KB
  const s = summarizeBudget(imgs)
  assert.equal(s.over, true)
  assert.equal(s.passed, false)
  assert.equal(s.overSingle.length, 0)
})

test('summarizeBudget: รูปเดี่ยวเกินเพดาน → ไม่ผ่านแม้ยอดรวมไม่เกินงบ (รูปใหญ่ใบเดียวคือต้นเหตุจริง)', () => {
  const s = summarizeBudget([
    { source: 'แบนเนอร์', url: 'big', bytes: 4836 * KB },
    { source: 'โลโก้', url: 'a', bytes: 10 * KB },
  ], { budgetKb: 10_000 })
  assert.equal(s.over, false)
  assert.equal(s.passed, false)
  assert.equal(s.overSingle.length, 1)
  assert.equal(s.overSingle[0].url, 'big')
})

test('summarizeBudget: วัดขนาดไม่ได้ (bytes=null) = ไม่ผ่าน — ตัวตรวจที่มองไม่เห็นรูปแล้วรายงานเขียวคือตัวตรวจที่โกหก', () => {
  const s = summarizeBudget([
    { source: 'โลโก้', url: 'a', bytes: 40 * KB },
    { source: 'ข่าว/กิจกรรม', url: 'drive', bytes: null },
  ])
  assert.equal(s.unknown, 1)
  assert.equal(s.passed, false)
  assert.equal(s.totalBytes, 40 * KB)
  assert.equal(summarizeBudget([]).passed, true) // ไม่มีรูปเลย = ไม่มีอะไรเกิน
})

test('summarizeBudget: เรียงจากใหญ่ไปเล็ก และ top เป็น 5 อันดับแรก', () => {
  const imgs = [5, 90, 30, 70, 10, 50, 20].map((n, i) => ({ source: 's', url: `u${i}`, bytes: n * KB }))
  const s = summarizeBudget(imgs)
  assert.deepEqual(s.all.map(r => r.bytes / KB), [90, 70, 50, 30, 20, 10, 5])
  assert.equal(s.top.length, 5)
})

test('formatReport: ไม่ผ่านต้องแสดงรูปที่ใหญ่สุดพร้อมธงเกินเพดาน และรายการที่วัดไม่ได้ · ผ่านแสดงบรรทัดเดียว', () => {
  const limits = { budgetKb: DEFAULT_BUDGET_KB, singleMaxKb: DEFAULT_SINGLE_MAX_KB }
  const bad = summarizeBudget([
    { source: 'ภาพหัวเว็บ', url: `${SB}/storage/v1/object/public/municipality-assets/headers/header-namlao.jpg`, bytes: 1088 * KB },
    { source: 'ข่าว/กิจกรรม', url: `${SB}/functions/v1/drive-file?id=ABCDEFGHIJKLMNOP`, bytes: null },
  ])
  const text = formatReport([
    { slug: 'namlao', count: 2, summary: bad, unmeasured: [{ source: 'ข่าว/กิจกรรม', url: `${SB}/functions/v1/drive-file?id=ABCDEFGHIJKLMNOP` }] },
    { slug: 'ok', count: 1, summary: summarizeBudget([{ source: 'โลโก้', url: 'x/y', bytes: 30 * KB }]) },
  ], limits)
  assert.match(text, /❌ namlao/)
  assert.match(text, /header-namlao\.jpg ◀ เกินเพดานรูปเดี่ยว/)
  assert.match(text, /drive:ABCDEFGHIJ… ◀ วัดขนาดไม่ได้/)
  assert.match(text, /✅ ok/)
  assert.equal(text.split('\n').filter(l => l.includes('ok')).length, 1, 'ที่ผ่านต้องไม่ขยายรายการ')
})

test('package.json: มีสคริปต์ check:image-budget และ test:image-proxy / test:image-budget', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['check:image-budget'], 'node scripts/check-image-budget.mjs')
  assert.equal(pkg.scripts['test:image-proxy'], 'node --test tests/image-proxy.test.mjs')
  assert.equal(pkg.scripts['test:image-budget'], 'node --test tests/image-budget.test.mjs')
})

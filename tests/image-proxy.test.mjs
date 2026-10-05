// พร็อกซีรูปผ่านแคช edge (worker/imageProxy.js) — ไม่ยิงเครือข่ายจริง: แคชกับ fetch เป็นตัวปลอมในหน่วยความจำ
// เทสต์หลักคือ "ความปลอดภัยของ allowlist" (รูปคำร้องประชาชนต้องไม่ผ่าน) และ "แคชทำงานจริง" (ครั้งที่ 2 ไม่ถึงต้นทาง)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  ALLOWED_STORAGE, BROWSER_TTL_SECONDS, EDGE_TTL_SECONDS, MAX_BYTES, imageProxyResponse, resolveImageRequest,
} from '../worker/imageProxy.js'

const ORIGIN = 'https://umxssfahtuprnztlytdd.supabase.co'
const HOST = 'https://namlao.rk-networks.com'
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

function fakeCache() {
  const map = new Map()
  return {
    map,
    async match(req) {
      const hit = map.get(req.url)
      return hit ? hit.clone() : undefined
    },
    async put(req, res) { map.set(req.url, res) },
  }
}

function originReturning(init = {}) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    return new Response(init.body ?? PNG, {
      status: init.status ?? 200,
      headers: init.headers ?? { 'Content-Type': 'image/png', ETag: '"abc"' },
    })
  }
  return { calls, fetchImpl }
}

const get = (path, init) => new Request(HOST + path, init)
const run = (request, { cache = fakeCache(), origin = originReturning() } = {}) =>
  imageProxyResponse(request, {}, undefined, { cache, fetchImpl: origin.fetchImpl, supabaseOrigin: ORIGIN })

// ── resolveImageRequest: allowlist ──────────────────────────────────────────────────────────────
test('bucket ที่อนุญาต → ชี้ URL สาธารณะของ Supabase และคง ?v= ไว้ในคีย์', () => {
  const r = resolveImageRequest('/_img/municipality-assets/logos/logo-namlao.png', '?v=1785080846411', ORIGIN)
  assert.equal(r.upstream, `${ORIGIN}/storage/v1/object/public/municipality-assets/logos/logo-namlao.png`)
  assert.equal(r.key, '/_img/municipality-assets/logos/logo-namlao.png?v=1785080846411')
  assert.equal(resolveImageRequest('/_img/logos/logo-thungkaew.png', '', ORIGIN).upstream, `${ORIGIN}/storage/v1/object/public/logos/logo-thungkaew.png`)
})

test('complaint-attachments: เฉพาะ posts/ tourism/ staff/ — โฟลเดอร์รูปคำร้องประชาชน (UUID) ต้องไม่ผ่าน (PDPA)', () => {
  const ok = ['posts/b7394bd8-70de-4c67-889e-8e62d1a6f299/1.jpg', 'tourism/a366077b-821a/p.jpg', 'staff/858f6a4b/photo.jpeg']
  for (const p of ok) assert.ok(resolveImageRequest(`/_img/complaint-attachments/${p}`, '', ORIGIN), p)

  const denied = [
    'dee7c272-cbdd-4c70-a879-77a0ba4f1c1c/1.jpg',       // โฟลเดอร์ของคำร้อง
    'f2dcb4de-e1bd-4956-bf1b-888526d0b541/photo.png',
    'posts',                                              // ไม่มีชื่อไฟล์
    'postsX/a.jpg',                                       // นำหน้าคล้ายแต่ไม่ใช่
    'POSTS/a.jpg',                                        // ตัวพิมพ์ต่าง (Storage แยกตัวพิมพ์ อย่าเดา)
  ]
  for (const p of denied) assert.equal(resolveImageRequest(`/_img/complaint-attachments/${p}`, '', ORIGIN), null, p)
})

test('bucket อื่นทั้งหมดต้องไม่ผ่าน (เอกสารราชการ สลิป อวาตาร์ ไฟล์แนบอีเวนต์)', () => {
  for (const b of ['official-documents', 'payment-slips', 'document-certs', 'fleet-documents', 'avatars', 'event-attachments', 'org-documents', 'constructor', '__proto__']) {
    assert.equal(resolveImageRequest(`/_img/${b}/x.png`, '', ORIGIN), null, b)
  }
  assert.deepEqual(Object.keys(ALLOWED_STORAGE).sort(), ['complaint-attachments', 'logos', 'municipality-assets'])
  assert.deepEqual(ALLOWED_STORAGE['complaint-attachments'], ['posts', 'tourism', 'staff'])
})

test('path traversal / อักขระต้องห้าม / รูปแบบผิด → null', () => {
  const bad = [
    '/_img/logos/../official-documents/x.png',
    '/_img/logos/%2e%2e/official-documents/x.png',
    '/_img/logos/..%2fofficial-documents/x.png',
    '/_img/logos/a%2Fb.png',
    '/_img/logos//x.png',
    '/_img/logos/./x.png',
    '/_img/logos/a\\b.png',
    '/_img/logos/a%5cb.png',
    '/_img/logos/x%00.png',
    '/_img/logos/a\tb.png',  // อักขระควบคุมตัวจริง (ไม่ใช่รูปแบบ %xx)
    '/_img/logos/a\u007fb.png',
    '/_img/logos/a\nb.png',
    '/_img/logos',           // ไม่มีชื่อไฟล์
    '/_img/',
    '/_img/' + 'a'.repeat(700),
    '/img/logos/x.png',      // prefix ผิด
  ]
  for (const p of bad) assert.equal(resolveImageRequest(p, '', ORIGIN), null, p)
})

test('query: เก็บเฉพาะ v (ตัวเลข) ตัวอื่นถูกทิ้ง ไม่เข้าคีย์แคช · v ที่ไม่ใช่ตัวเลข → null', () => {
  const r = resolveImageRequest('/_img/logos/a.png', '?v=123&utm=x&cachebust=1', ORIGIN)
  assert.equal(r.key, '/_img/logos/a.png?v=123')
  assert.equal(resolveImageRequest('/_img/logos/a.png', '?v=abc', ORIGIN), null)
  assert.equal(resolveImageRequest('/_img/logos/a.png', '?v=1;drop', ORIGIN), null)
  assert.equal(resolveImageRequest('/_img/logos/a.png', '?utm=x', ORIGIN).key, '/_img/logos/a.png')
})

test('drive-file: id ต้องเป็นรูปแบบ Drive และปลายทางตายตัวที่ Edge Function ของเรา', () => {
  const r = resolveImageRequest('/_img/drive-file', '?id=1IOKEABmQlt6dxqUue8tb7Io_OOogtqW-&v=1788010180797', ORIGIN)
  assert.equal(r.upstream, `${ORIGIN}/functions/v1/drive-file?id=1IOKEABmQlt6dxqUue8tb7Io_OOogtqW-`)
  assert.equal(r.key, '/_img/drive-file?id=1IOKEABmQlt6dxqUue8tb7Io_OOogtqW-&v=1788010180797')
  for (const q of ['', '?id=', '?id=short', '?id=abc/../../x1234567', '?id=ok1234567890&v=x', '?id=' + 'a'.repeat(101)]) {
    assert.equal(resolveImageRequest('/_img/drive-file', q, ORIGIN), null, q)
  }
})

test('ปลายทางไม่เคยมาจากผู้ใช้: ใส่ host/URL เต็มใน path แล้วยังชี้ Supabase ของเราเท่านั้น', () => {
  const r = resolveImageRequest('/_img/logos/https:/evil.example/x.png', '', ORIGIN)
  assert.ok(r === null || r.upstream.startsWith(`${ORIGIN}/storage/v1/object/public/logos/`), String(r?.upstream))
})

// ── imageProxyResponse: แคชและส่วนหัว ──────────────────────────────────────────────────────────
test('MISS ครั้งแรกดึงจากต้นทาง 1 ครั้ง · ครั้งที่ 2 เป็น HIT และไม่ถึงต้นทางเลย', async () => {
  const cache = fakeCache()
  const origin = originReturning()
  const path = '/_img/municipality-assets/logos/logo-namlao-256.png?v=7'

  const first = await run(get(path), { cache, origin })
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('X-Img-Cache'), 'MISS')
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), PNG)
  assert.equal(origin.calls.length, 1)
  assert.equal(origin.calls[0].url, `${ORIGIN}/storage/v1/object/public/municipality-assets/logos/logo-namlao-256.png`)

  const second = await run(get(path), { cache, origin })
  assert.equal(second.headers.get('X-Img-Cache'), 'HIT')
  assert.deepEqual(new Uint8Array(await second.arrayBuffer()), PNG)
  assert.equal(origin.calls.length, 1, 'ครั้งที่ 2 ต้องไม่ยิงต้นทางซ้ำ')
})

test('คนละ ?v= คือคนละรูป (ไม่ปนแคช) · คนละ host คนละแคช', async () => {
  const cache = fakeCache()
  const origin = originReturning()
  await run(get('/_img/logos/a.png?v=1'), { cache, origin })
  await run(get('/_img/logos/a.png?v=2'), { cache, origin })
  assert.equal(origin.calls.length, 2)
  await run(new Request('https://thungkaew.rk-networks.com/_img/logos/a.png?v=1'), { cache, origin })
  assert.equal(origin.calls.length, 3)
})

test('ส่วนหัว: เบราว์เซอร์ 1 วัน · แคช edge เก็บ 7 วัน · nosniff + CSP sandbox · ความยาวถูกต้อง', async () => {
  const cache = fakeCache()
  const res = await run(get('/_img/logos/a.png'), { cache })
  assert.equal(res.headers.get('Cache-Control'), `public, max-age=${BROWSER_TTL_SECONDS}`)
  assert.equal(BROWSER_TTL_SECONDS, 86400)
  assert.equal(res.headers.get('Content-Type'), 'image/png')
  assert.equal(res.headers.get('Content-Length'), String(PNG.byteLength))
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.match(res.headers.get('Content-Security-Policy'), /sandbox/)
  assert.equal(res.headers.get('ETag'), '"abc"')
  const stored = cache.map.get(`${HOST}/_img/logos/a.png`)
  assert.equal(stored.headers.get('Cache-Control'), `public, max-age=${EDGE_TTL_SECONDS}`)
  assert.equal(EDGE_TTL_SECONDS, 604800)
})

test('ตอบจากแคชไม่ copy Content-Length (edge อาจส่งตัวที่บีบอัดต่างจากที่เก็บ)', async () => {
  const cache = fakeCache()
  await run(get('/_img/logos/a.png'), { cache })
  const hit = await run(get('/_img/logos/a.png'), { cache })
  assert.equal(hit.headers.get('Content-Length'), null)
})

test('ใช้ ctx.waitUntil เก็บแคชหลังตอบ ไม่ถ่วงผู้ใช้ และแคชพังไม่ทำให้รูปพัง', async () => {
  const waited = []
  const cache = fakeCache()
  const res = await imageProxyResponse(get('/_img/logos/a.png'), {}, { waitUntil: p => waited.push(p) }, {
    cache, fetchImpl: originReturning().fetchImpl, supabaseOrigin: ORIGIN,
  })
  assert.equal(res.status, 200)
  assert.equal(waited.length, 1)
  await Promise.all(waited)
  assert.equal(cache.map.size, 1)

  const broken = { async match() { return undefined }, async put() { throw new Error('quota') } }
  const ok = await imageProxyResponse(get('/_img/logos/b.png'), {}, undefined, {
    cache: broken, fetchImpl: originReturning().fetchImpl, supabaseOrigin: ORIGIN,
  })
  assert.equal(ok.status, 200)
})

// ── ชนิดไฟล์/ขนาด/สถานะจากต้นทาง ───────────────────────────────────────────────────────────────
test('ไม่ใช่รูปแรสเตอร์ (SVG/HTML/PDF/octet-stream) → 404 และไม่เข้าแคช แม้ชื่อไฟล์ลงท้าย .png', async () => {
  for (const type of ['image/svg+xml', 'text/html', 'application/pdf', 'application/octet-stream', 'text/plain']) {
    const cache = fakeCache()
    const origin = originReturning({ headers: { 'Content-Type': type }, body: '<svg onload="alert(1)"/>' })
    const res = await run(get('/_img/logos/evil.png'), { cache, origin })
    assert.equal(res.status, 404, type)
    assert.equal(cache.map.size, 0, type)
  }
})

test('ชนิดรูปที่ยอมรับ: png jpeg webp gif avif', async () => {
  for (const type of ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/avif', 'image/png; charset=binary']) {
    const res = await run(get('/_img/logos/a.x'), { origin: originReturning({ headers: { 'Content-Type': type } }) })
    assert.equal(res.status, 200, type)
  }
})

test('ไฟล์ใหญ่เกิน MAX_BYTES → 413 (ทั้งจาก Content-Length และจากขนาดจริง) และไม่เข้าแคช', async () => {
  const cache = fakeCache()
  const declared = originReturning({ headers: { 'Content-Type': 'image/png', 'Content-Length': String(MAX_BYTES + 1) }, body: PNG })
  assert.equal((await run(get('/_img/logos/big.png'), { cache, origin: declared })).status, 413)

  const real = originReturning({ headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(MAX_BYTES + 1) })
  assert.equal((await run(get('/_img/logos/big2.png'), { cache, origin: real })).status, 502)
  assert.equal(cache.map.size, 0)
})

test('ต้นทาง 404/400 → 404 จำสั้น 60 วิที่เบราว์เซอร์ ไม่เข้าแคช edge · ต้นทางล่ม → 502 no-store', async () => {
  for (const status of [404, 400]) {
    const cache = fakeCache()
    const res = await run(get('/_img/logos/none.png'), { cache, origin: originReturning({ status, body: 'x', headers: { 'Content-Type': 'application/json' } }) })
    assert.equal(res.status, 404)
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60')
    assert.equal(cache.map.size, 0)
  }
  const cache = fakeCache()
  const down = await run(get('/_img/logos/a.png'), { cache, origin: originReturning({ status: 503, body: 'x' }) })
  assert.equal(down.status, 502)
  assert.equal(down.headers.get('Cache-Control'), 'no-store')
  const thrown = await imageProxyResponse(get('/_img/logos/a.png'), {}, undefined, {
    cache, fetchImpl: async () => { throw new Error('network') }, supabaseOrigin: ORIGIN,
  })
  assert.equal(thrown.status, 502)
  assert.equal(cache.map.size, 0)
})

test('redirect จากต้นทางไม่ถูกตามไป (กันพาไปโฮสต์อื่น) และไม่เข้าแคช', async () => {
  const cache = fakeCache()
  const origin = originReturning({ status: 302, body: '', headers: { Location: 'https://evil.example/x.png', 'Content-Type': 'image/png' } })
  const res = await run(get('/_img/logos/a.png'), { cache, origin })
  assert.equal(res.status, 502)
  assert.equal(origin.calls[0].options.redirect, 'manual')
  assert.equal(cache.map.size, 0)
})

test('เฉพาะ GET/HEAD · path ไม่อยู่ใน allowlist ไม่ยิงต้นทางเลย', async () => {
  const origin = originReturning()
  assert.equal((await run(get('/_img/logos/a.png', { method: 'POST', body: 'x' }), { origin })).status, 405)
  assert.equal((await run(get('/_img/logos/a.png', { method: 'DELETE' }), { origin })).status, 405)
  assert.equal((await run(get('/_img/complaint-attachments/dee7c272-cbdd-4c70-a879-77a0ba4f1c1c/1.jpg'), { origin })).status, 404)
  assert.equal((await run(get('/_img/official-documents/a.png'), { origin })).status, 404)
  assert.equal(origin.calls.length, 0)
  assert.equal((await run(get('/_img/logos/a.png', { method: 'HEAD' }), { origin })).status, 200)
})

test('ส่ง Accept: image/* ไปต้นทาง และไม่ส่งคุกกี้/Authorization ของผู้ใช้ต่อ', async () => {
  const origin = originReturning()
  await run(get('/_img/logos/a.png', { headers: { Cookie: 'sb=secret', Authorization: 'Bearer secret' } }), { origin })
  assert.deepEqual(origin.calls[0].options.headers, { Accept: 'image/*' })
})

// ── ระดับซอร์ส: worker/index.js ต้องต่อเส้นทางถูกตำแหน่ง ─────────────────────────────────────────
test('worker/index.js: /_img/ ถูกจัดการก่อน isFileRequest และก่อน manifest/shell, ส่ง ctx เข้าไป', async () => {
  const src = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8')
  const route = src.indexOf('url.pathname.startsWith(IMAGE_ROUTE_PREFIX)')
  const fileGuard = src.indexOf('if (isFileRequest(url.pathname))')
  const httpsGuard = src.indexOf('httpsRedirectResponse(request)')
  assert.ok(route > 0, 'ไม่พบเส้นทาง /_img/')
  assert.ok(httpsGuard > 0 && httpsGuard < route, 'เส้นทาง /_img/ ต้องอยู่หลังด่าน https')
  assert.ok(route < fileGuard, 'เส้นทาง /_img/ ต้องมาก่อน isFileRequest (ไม่งั้นได้ 404 ทุกรูป)')
  assert.match(src, /async fetch\(request, env, ctx\)/)
  assert.match(src, /imageProxyResponse\(request, env, ctx,/)
})

test('wrangler.jsonc: ห้ามเปิด run_worker_first (จะทำให้ทุก asset นับโควตา Worker 100k/วัน)', async () => {
  const src = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(code, /run_worker_first/)
})

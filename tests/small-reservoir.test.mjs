// อ่างเก็บน้ำขนาดเล็ก (ห้วยยอย/ห้วยปุย) จากผังน้ำออนไลน์แพร่ — ตัวอ่านตาราง · ตรรกะป้าย · Worker
// รัน: npm run test:small-reservoir
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  RESERVOIR_MAX_ROWS, RESERVOIR_SAME_MIN, RESERVOIR_STALE_DAYS, SMALL_RESERVOIRS, SMALL_RESERVOIR_TENANTS,
  formatReportDate, isReservoirReport, parseReservoirHtml, reservoirReportUrl, reservoirSummary, reservoirTrend,
} from '../src/lib/smallReservoirs.js'
import { DAM_SAME_MIN_REPORTS } from '../src/lib/waterSituation.js'
import { smallReservoirResponse } from '../worker/phraeReservoir.js'

const fixture = readFileSync(new URL('./fixtures/phrae-reservoir-50.html', import.meta.url), 'utf8')
// 14 ต.ค. 2569 12:00 เวลาไทย — 8 วันหลังรายงานล่าสุดในไฟล์ตัวอย่าง (6 ต.ค.)
const now = Date.parse('2026-10-14T05:00:00Z')
const DAY = 86_400_000

const NAME = 'อ่างเก็บน้ำห้วยยอย'
// สร้างหน้าตามโครงจริงของต้นทาง: หัวตารางใช้ <td> ไม่ใช่ <th> และแต่ละแถวปิดด้วย </tr></tr></tr></td> ซ้อนกัน
const HEAD = '<table id = \'s_table_1\'><thead><tr><td>ชื่ออ่างเก็บน้ำ</td><td>ความจุของอ่าง</td><td>ปริมาณน้ำปัจจุบัน</td><td>ปริมาณน้ำคิดเป็น (%)</td>'
  + '<td>ใช้งานได้</td><td>ใช้งานได้ (%)</td><td>ประเภทอ่าง</td><td>สถานการณ์น้ำในอ่าง</td><td>ข้อมูลอัพเดท</td></tr></thead><tbody>'
const rowHtml = ([name, cap, vol, pct, date]) => `<tr>\n<td>${name}</td>\n<td>${cap}</td>\n<td>${vol}</td>\n<td>${pct}</td>\n<td>${vol}</td>\n<td>${pct}</td>\n`
  + `<td>อ่างเก็บน้ำขนาดเล็ก</td>\n<td><font color="blue">เกณฑ์น้ำมาก</font></td>\n<td>${date}</td>\n</tr>\n</tr>\n</tr>\n</td>\n`
const pageOf = (rows, head = HEAD) => `${head}${rows.map(rowHtml).join('')}</tbody></table>`
const r = (cap, vol, pct, date, name = NAME) => [name, cap, vol, pct, date]
const good = r('0.300', '0.22', '73.20', '06/10/2026')

// ───────── ตัวอ่าน: หน้าจริงของต้นทาง ─────────
const real = parseReservoirHtml(fixture, '50', now)
assert.equal(real.id, '50'); assert.equal(real.name, NAME); assert.equal(real.capacity, 0.3)
assert.equal(real.rows.length, 30)
assert.deepEqual(real.rows[0], { d: '2026-10-06', pct: 73.2, vol: 0.22 })
assert.deepEqual(Object.keys(real.rows[0]), ['d', 'pct', 'vol'], 'ส่งต่อเฉพาะ วันที่/%/ปริมาตร ห้ามมีป้ายหรือข้อความของต้นทาง')
assert.ok(real.rows.every((row, i) => i === 0 || real.rows[i - 1].d > row.d), 'เรียงใหม่→เก่า ไม่ซ้ำวัน')
assert.ok(!JSON.stringify(real).includes('เกณฑ์'), 'ป้ายสถานการณ์ของต้นทางเชื่อไม่ได้ ห้ามหลุดมา')

// ───────── ตัวอ่าน: ของเสียที่ต้นทางมีจริง ─────────
const parsed = rows => parseReservoirHtml(pageOf(rows), '50', now)
assert.equal(parsed([r('0.300 ', '0.28 ', '93.41 ', '13/06/2025')]).rows[0].pct, 93.41, 'ช่องว่างท้ายตัวเลข (เจอจริง "0.280 ")')
assert.equal(parsed([good, r('0.300', '0.22', '73.20', '18/06/0004')]).rows.length, 1, 'ปี 0004 (เจอจริงที่อ่างอื่น) ทิ้งแถว')
assert.equal(parsed([good, r('0.300', '0.22', '73.20', '31/02/2026')]).rows.length, 1, 'วันที่ไม่มีในปฏิทิน')
assert.equal(parsed([good, r('0.300', '0.22', '73.20', '30/10/2026')]).rows.length, 1, 'วันที่ล่วงหน้า')
assert.equal(parsed([good, r('0.300', '0.21', '71.00', '06/10/2026')]).rows.length, 1, 'วันที่ซ้ำ (เจอจริงที่ห้วยปุย) เอาแถวบนก่อน')
assert.equal(parsed([good, r('0.300', '0.21', '71.00', '06/10/2026')]).rows[0].pct, 73.2)
assert.equal(parsed([good, r('0.300', '0.22', '-', '30/09/2026')]).rows.length, 1, 'ค่าว่าง/ขีด ไม่แปลงเป็น 0')
assert.equal(parsed([good, r('0.300', '0.22', '12.00', '30/09/2026')]).rows.length, 1, '% ไม่ไปทางเดียวกับปริมาตร (คอลัมน์เลื่อน) ทิ้ง')
assert.equal(parsed([good, r('0.300', '0.27', '93.08', '04/12/2025')]).rows.length, 2, 'คลาดจากการปัดปริมาตร 3.08 จุดที่เจอจริง ต้องยังรับ')
assert.equal(parsed([good, r('0', '0.22', '73.20', '30/09/2026')]).rows.length, 1, 'ความจุ 0')
assert.equal(parsed([r('0.300', '0.22', '73.20', '30/09/2026'), good]).rows[0].d, '2026-10-06', 'ไม่พึ่งลำดับแถวของต้นทาง')
assert.equal(parsed(Array.from({ length: 100 }, (_, i) => r('0.300', '0.22', (70 + (i % 5) * 0.1).toFixed(2), `${String((i % 28) + 1).padStart(2, '0')}/${String(Math.floor(i / 28) + 1).padStart(2, '0')}/2026`))).rows.length, RESERVOIR_MAX_ROWS)

// ตัวตน/โครงหน้า: เปลี่ยนแล้วต้องโยน error ห้ามเดา
assert.throws(() => parsed([good, r('0.280', '0.21', '76.79', '06/10/2026', 'อ่างเก็บน้ำห้วยปุย')]), /mismatch/)
assert.throws(() => parseReservoirHtml(pageOf([good]), '30', now), /mismatch/)
assert.throws(() => parseReservoirHtml(pageOf([good]), '37', now), /Invalid/, 'อ่างนอกรายการ')
assert.throws(() => parseReservoirHtml(pageOf([good]), '__proto__', now), /Invalid/)
assert.throws(() => parseReservoirHtml(pageOf([good]).replace('ข้อมูลอัพเดท', 'วันที่'), '50', now), /Layout/)
assert.throws(() => parseReservoirHtml(pageOf([good]).replace('<tbody>', ''), '50', now), /Layout/)
assert.throws(() => parseReservoirHtml('<html></html>', '50', now), /Layout/)
assert.throws(() => parsed([]), /Empty/)
assert.throws(() => parsed([r('0.300', 'x', '73.20', '06/10/2026')]), /Empty/)
assert.throws(() => parseReservoirHtml('x'.repeat(300_001), '50', now), /too large/)

// ───────── CPU: Worker แผนฟรีมีงบ 10 ms ต่อคำขอ — กันตัวอ่านกลับไปใช้ regex กวาดทั้งหน้า ─────────
// หน้าจริงยาว ~94 KB / ~180 แถว (Node ไม่เท่า workerd แต่จับกรณีบานปลายเป็นสิบเท่าได้ ค่าจริงบน production ต้องวัดหลัง deploy)
const bigRows = Array.from({ length: 180 }, (_, i) => r('0.300', '0.22', (73 + (i % 7) * 0.1).toFixed(2), `${String((i % 28) + 1).padStart(2, '0')}/${String((Math.floor(i / 28) % 12) + 1).padStart(2, '0')}/${2023 + Math.floor(i / 336)}`))
const bigPage = `<html><body>${'<option value="1">Toyota</option>\n'.repeat(1500)}${pageOf(bigRows)}${'<div>สถิติการเข้าใช้งาน</div>\n'.repeat(800)}</body></html>`
assert.ok(bigPage.length > 80_000 && bigPage.length < 300_000, `ขนาดหน้าจำลอง ${bigPage.length}`)
let best = Infinity
for (let i = 0; i < 5; i += 1) { const t = performance.now(); parseReservoirHtml(bigPage, '50', now); best = Math.min(best, performance.now() - t) }
assert.ok(best < 25, `parse ใช้ ${best.toFixed(2)} ms ต่อครั้ง (เกณฑ์ Node ≤ 25 ms)`)

// ───────── สรุป/ป้าย ─────────
const sum = reservoirSummary(real, now)
assert.equal(sum.ageDays, 8); assert.equal(sum.stale, false); assert.equal(sum.sameCount, 1); assert.equal(sum.showSame, false)
assert.equal(sum.previous.d, '2026-09-30'); assert.equal(sum.trend.dir, 'flat') // 73.20 vs 73.49 = 0.29 จุด
assert.equal(reservoirSummary(real, now + 6 * DAY).stale, false, 'อายุ 14 วันพอดียังไม่ค้าง')
assert.equal(reservoirSummary(real, now + 6 * DAY).ageDays, RESERVOIR_STALE_DAYS)
assert.equal(reservoirSummary(real, now + 7 * DAY).stale, true, 'เกิน 14 วัน = ไม่มีรายงานใหม่')
assert.equal(reservoirSummary(null, now), null); assert.equal(reservoirSummary({ rows: [] }, now), null)
assert.equal(reservoirSummary(real, now - 30 * DAY).ageDays, 0, 'นาฬิกาเครื่องเพี้ยน ไม่ให้อายุติดลบ')

// ซ้ำเดิม: ห้วยยอยจริงซ้ำ 82.27% 20 รายงานติดกัน (1 ต.ค. 2567 – 11 ก.พ. 2568) แล้วมี 100.00% คั่นก่อนหน้า
const weekly = (n, pct, endIso) => Array.from({ length: n }, (_, i) => ({ d: new Date(Date.parse(`${endIso}T00:00:00Z`) - i * 7 * DAY).toISOString().slice(0, 10), pct, vol: 0.24 }))
const repeated = { rows: [...weekly(20, 82.27, '2025-02-11'), { d: '2024-09-27', pct: 100, vol: 0.3 }] }
const feb = reservoirSummary(repeated, Date.parse('2025-02-13T05:00:00Z'))
assert.equal(feb.sameCount, 20); assert.equal(feb.sameCapped, false); assert.equal(feb.showSame, true)
assert.equal(feb.sameSince, weekly(20, 82.27, '2025-02-11').at(-1).d)
assert.equal(reservoirSummary({ rows: weekly(2, 82.27, '2025-02-11') }, Date.parse('2025-02-13T05:00:00Z')).showSame, false, 'ซ้ำ 2 รายงานยังไม่ขึ้นป้าย')
assert.equal(reservoirSummary({ rows: weekly(RESERVOIR_SAME_MIN, 82.27, '2025-02-11') }, Date.parse('2025-02-13T05:00:00Z')).showSame, true)
assert.equal(reservoirSummary({ rows: weekly(5, 82.27, '2025-02-11') }, Date.parse('2025-02-13T05:00:00Z')).sameCapped, true, 'ซ้ำทุกรายงานที่เก็บ = อาจนานกว่านี้')
assert.equal(reservoirSummary(repeated, Date.parse('2025-03-20T05:00:00Z')).showSame, false, 'ข้อมูลค้างมีป้ายของตัวเอง ไม่ซ้อนกัน')
assert.equal(reservoirSummary(repeated, Date.parse('2025-03-20T05:00:00Z')).stale, true)

assert.equal(reservoirTrend({ pct: 80 }, { pct: 79.6 }).dir, 'flat')
assert.equal(reservoirTrend({ pct: 80 }, { pct: 79.5 }).dir, 'up')
assert.equal(reservoirTrend({ pct: 76.79 }, { pct: 87.81 }).dir, 'down')
assert.equal(Math.round(reservoirTrend({ pct: 76.79 }, { pct: 87.81 }).points * 10) / 10, 11)
assert.equal(reservoirTrend({ pct: 1 }, null), null)

// ───────── ค่าคงที่/ทะเบียน ─────────
assert.equal(RESERVOIR_SAME_MIN, DAM_SAME_MIN_REPORTS, 'เกณฑ์ "ซ้ำ" ต้องเท่าของอ่างกลาง')
assert.deepEqual(SMALL_RESERVOIR_TENANTS.thungkaew.ids, ['50', '30'])
assert.ok(!('namlao' in SMALL_RESERVOIR_TENANTS) && !('tamnaktham' in SMALL_RESERVOIR_TENANTS), 'เจ้าของสั่งเฉพาะทุ่งแค้ว (+ demo เป็นสนามซ้อม)')
for (const tenant of Object.values(SMALL_RESERVOIR_TENANTS)) for (const id of tenant.ids) assert.ok(Object.hasOwn(SMALL_RESERVOIRS, id))
assert.equal(SMALL_RESERVOIRS[50].name, 'อ่างเก็บน้ำห้วยยอย'); assert.equal(SMALL_RESERVOIRS[30].name, 'อ่างเก็บน้ำห้วยปุย')
assert.equal(reservoirReportUrl('50'), 'https://www.phraepao.go.th/officechief/water/views_r_id.php?id_dam=50')
assert.equal(formatReportDate('2026-10-06'), '6 ต.ค. 2569'); assert.equal(formatReportDate('x'), '')
assert.equal(isReservoirReport(real, '50'), true)
assert.equal(isReservoirReport(real, '30'), false); assert.equal(isReservoirReport({ ...real, rows: [] }, '50'), false)
assert.equal(isReservoirReport({ ...real, rows: [{ d: '2026-10-06', pct: '73', vol: 1 }] }, '50'), false, 'ไม่เชื่อ JSON ที่ชนิดผิด')
assert.equal(isReservoirReport(null, '50'), false)
console.log('PASS Small reservoir parser: real page, bad rows, identity/layout errors, CPU budget')
console.log('PASS Small reservoir summary: stale boundary, repeated reports, trend, registry parity')

// ───────── Worker ─────────
const map = new Map(), cache = { match: async k => map.get(k)?.clone(), put: async (k, v) => map.set(k, v.clone()) }
let calls = 0
const fetcher = async (u, options) => {
  calls += 1
  assert.equal(u, reservoirReportUrl('50')); assert.equal(options.redirect, 'manual'); assert.ok(options.signal, 'ต้องมี timeout')
  assert.match(options.headers['User-Agent'], /SmartLocal/)
  return new Response(fixture, { headers: { 'content-type': 'text/html' } })
}
const req = new Request('https://thungkaew.rk-networks.com/api/small-reservoir?id=50')
const first = await smallReservoirResponse(req, { fetcher, cache, now })
assert.equal(first.status, 200)
const body = await first.json()
assert.equal(body.refreshFailed, false); assert.equal(body.rows[0].pct, 73.2); assert.equal(body.fetchedAt, new Date(now).toISOString())
assert.equal(isReservoirReport(body, '50'), true)
assert.ok(!JSON.stringify(body).includes('เกณฑ์'), 'คำตอบจาก Worker ห้ามมีป้ายของต้นทาง')
await smallReservoirResponse(req, { fetcher, cache, now: now + 5 * 3_600_000 }); assert.equal(calls, 1, 'ภายใน 6 ชม. ไม่ยิงต้นทางซ้ำ')
await smallReservoirResponse(req, { fetcher, cache, now: now + 7 * 3_600_000 }); assert.equal(calls, 2, 'เกิน 6 ชม. ดึงใหม่')

const fail = async () => { throw Error('Offline') }
const stale = await (await smallReservoirResponse(req, { fetcher: fail, cache, now: now + 13 * 3_600_000 })).json()
assert.equal(stale.refreshFailed, true); assert.equal(stale.rows[0].pct, 73.2)
assert.equal((await smallReservoirResponse(req, { fetcher: fail, cache, now: now + 7 * 3_600_000 + 15 * DAY })).status, 503, 'ของเก่าเกิน 14 วัน ไม่ใช้')
assert.equal((await smallReservoirResponse(req, { fetcher: fail, now })).status, 503, 'ไม่มี cache และต้นทางล่ม')
assert.equal((await smallReservoirResponse(req, { fetcher, now })).status, 200, 'ไม่มี Cache API ก็ทำงานได้')

assert.equal((await smallReservoirResponse(new Request(req.url, { method: 'POST' }), { fetcher, now })).status, 405)
for (const id of ['', '37', '51', 'https://evil.test', '50/../x', '__proto__', '30%20']) {
  assert.equal((await smallReservoirResponse(new Request(`https://t/api/small-reservoir?id=${encodeURIComponent(id)}`), { fetcher, now })).status, 400, `id=${id}`)
}
assert.equal((await smallReservoirResponse(new Request('https://t/api/small-reservoir'), { fetcher, now })).status, 400)
const bad = body => ({ now, fetcher: async () => new Response(body) })
assert.equal((await smallReservoirResponse(req, bad('<html>maintenance</html>'))).status, 503, 'หน้าเปลี่ยนรูป')
assert.equal((await smallReservoirResponse(req, bad(pageOf([r('0.280', '0.21', '76.79', '06/10/2026', 'อ่างเก็บน้ำห้วยปุย')])))).status, 503, 'ผิดอ่าง')
assert.equal((await smallReservoirResponse(req, { now, fetcher: async () => new Response(fixture, { headers: { 'content-length': '400000' } }) })).status, 503, 'ใหญ่เกิน')
assert.equal((await smallReservoirResponse(req, { now, fetcher: async () => new Response(null, { status: 302, headers: { Location: 'https://other.test' } }) })).status, 503, 'ไม่ตาม redirect')
assert.equal((await smallReservoirResponse(req, { now, fetcher: async () => new Response('x', { status: 500 }) })).status, 503)
console.log('PASS Small reservoir Worker: cache 6h, fallback 14d, allowlist, method, upstream failures, redirect/size guards')

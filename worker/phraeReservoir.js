// GET /api/small-reservoir?id=50|30 — รายงานอ่างเก็บน้ำขนาดเล็กของศูนย์บริหารจัดการทรัพยากรน้ำจังหวัดแพร่
//
// แพตเทิร์นเดียวกับ worker/hydroHourly.js: ไม่มี cron ไม่มีฐานข้อมูล ไม่มี secret — ดึงเมื่อมีคนเปิดหน้า
// แล้วให้ Cloudflare จำคำตอบไว้ที่ edge (ต้นทางอัปเดตรายสัปดาห์ จึงจำ 6 ชม. พอ) หลายคนเปิดพร้อมกันตอนน้ำมา
// ก็ยิงต้นทางไม่เกินครั้งเดียวต่อศูนย์ข้อมูล edge ต่อ 6 ชม. และไม่ไปแตะโควตา Supabase เลย
//
// ⚠️ cache อยู่แยกตามศูนย์ข้อมูล Cloudflare (ไม่ใช่ฐานกลาง) ต้นทางล่มแล้ว edge ที่ไม่เคยจำไว้จะตอบ 503
//    หน้าเว็บรองรับแล้ว (ขึ้นป้ายพร้อมลิงก์ต้นฉบับ) · ไม่มีตัวเฝ้าระวังแจ้งเจ้าหน้าที่ — ข้อมูลนี้แสดงอย่างเดียว
//    ไม่ส่ง Telegram/แถบหน้าแรก ตั้งใจ (รายสัปดาห์ พิมพ์มือ มีค่าผิดโดด: ถ้าเอามาเตือนจะเตือนผิดบ่อย)
import { SMALL_RESERVOIRS, RESERVOIR_HTML_MAX_CHARS, parseReservoirHtml, reservoirReportUrl } from '../src/lib/smallReservoirs.js'

const HOUR = 3_600_000
const FRESH_MS = 6 * HOUR
// ต้นทางล่มได้ใช้ของเก่านานแค่ไหน — รายสัปดาห์ จึงเผื่อ 2 สัปดาห์ (หน้าเว็บขึ้นป้าย "ไม่มีรายงานใหม่" เองเมื่อเกิน)
const KEEP_MS = 14 * 24 * HOUR

const reply = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store', 'X-Content-Type-Options': 'nosniff' },
})

export async function smallReservoirResponse(request, { fetcher = fetch, cache = globalThis.caches?.default, now = Date.now() } = {}) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } })
  const id = new URL(request.url).searchParams.get('id')
  // allowlist ตายตัว — ไม่มี URL ปลายทางจากผู้ใช้ และไม่รับอ่างนอกรายการ
  if (!Object.hasOwn(SMALL_RESERVOIRS, id || '')) return reply({ error: 'INVALID_RESERVOIR' }, 400)

  // key เดียวต่ออ่างข้ามทุก อปท. (ข้อมูลเดียวกัน)
  const key = `https://smartlocal.ntocom.workers.dev/api/small-reservoir-v1/${id}`
  let saved
  try { const hit = await cache?.match(key); if (hit) saved = await hit.json() } catch { /* cache เป็นของเสริม */ }
  const age = now - Date.parse(saved?.fetchedAt)
  if (saved && age >= 0 && age < FRESH_MS) return reply({ ...saved, refreshFailed: false })

  try {
    const response = await fetcher(reservoirReportUrl(id), {
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
      headers: { Accept: 'text/html', 'User-Agent': 'SmartLocal-WaterSituation/1.0' },
    })
    if (!response.ok || Number(response.headers.get('content-length')) > RESERVOIR_HTML_MAX_CHARS) throw new Error('Upstream unavailable')
    const raw = await response.text()
    // ตัวแยกอ่านเป็นข้อมูลล้วน ไม่ execute อะไรจากต้นทาง และโยน error เมื่อหน้าเปลี่ยนรูป/ผิดอ่าง
    const report = parseReservoirHtml(raw, id, now)
    const body = { ...report, fetchedAt: new Date(now).toISOString() }
    try { await cache?.put(key, Response.json(body, { headers: { 'Cache-Control': 'public, max-age=1209600' } })) } catch { /* ใช้คำตอบนี้ต่อได้ */ }
    return reply({ ...body, refreshFailed: false })
  } catch (error) {
    console.warn('Small reservoir upstream unavailable', id, error.message)
    if (saved && age >= 0 && age < KEEP_MS) return reply({ ...saved, refreshFailed: true })
    return reply({ error: 'RESERVOIR_UNAVAILABLE' }, 503)
  }
}

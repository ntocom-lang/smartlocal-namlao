// ที่ปรึกษา AI รอบ 2 — ตรรกะสลับช่องผู้ให้บริการ (supabase/functions/_shared/advisorRouting.ts) ไม่ใช้เน็ต
//   node tests/superadmin-advisor-routing.test.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const R = await import('../supabase/functions/_shared/advisorRouting.ts')
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`) }

const NOW = new Date('2026-11-08T07:00:00Z') // 14:00 น. เวลาไทย
const claude = { slot: 1, provider: 'claude', tier: 'paid', enabled: true, model: 'claude-opus-5-5', daily_cap: 50, key_last4: 'WXYZ', key_invalid_at: null, paused_until: null, pause_reason: null }
const geminiPaid = { ...claude, slot: 2, provider: 'gemini', tier: 'paid', model: 'gemini-3.5-flash' }
const geminiFree = { ...geminiPaid, slot: 3, tier: 'free', key_last4: null, daily_cap: 100 }
const ok = { now: NOW, usedToday: 0, hasKey: true }

await check('ชื่อช่องตามลำดับที่เจ้าของกำหนด', () => {
  assert.deepEqual([claude, geminiPaid, geminiFree].map(R.slotLabel), ['Claude', 'Gemini จ่ายเงิน', 'Gemini ฟรี'])
})

await check('เวลาไทย HH:MM', () => {
  assert.equal(R.bangkokClock(NOW), '14:00')
  assert.equal(R.bangkokClock(new Date('2026-11-08T17:05:00Z')), '00:05')
})

await check('ด่านก่อนลองช่อง: ปิด / ไม่มี key / key ผิด / ยังพัก / ครบเพดาน · พ้นเวลาพักแล้วลองได้เอง', () => {
  assert.equal(R.slotSkipReason(claude, ok), null)
  assert.match(R.slotSkipReason({ ...claude, enabled: false }, ok), /Claude: ปิดอยู่/)
  assert.match(R.slotSkipReason(geminiPaid, { ...ok, hasKey: false }), /Gemini จ่ายเงิน: ยังไม่ใส่ API key/)
  assert.match(R.slotSkipReason({ ...claude, key_invalid_at: NOW.toISOString() }, ok), /API key ใช้ไม่ได้/)
  const paused = { ...claude, paused_until: '2026-11-08T08:00:00Z', pause_reason: 'billing' }
  assert.equal(R.slotSkipReason(paused, ok), 'Claude: เครดิตหมด ลองใหม่ 15:00 น.')
  assert.equal(R.slotSkipReason(paused, { ...ok, now: new Date('2026-11-08T08:00:01Z') }), null, 'พ้นเวลาพัก = ลองเอง ไม่ต้องมีคนกด')
  assert.match(R.slotSkipReason(claude, { ...ok, usedToday: 50 }), /ครบเพดาน 50 คำถาม/)
  assert.equal(R.slotSkipReason(claude, { ...ok, usedToday: 49 }), null)
  assert.equal(R.slotSkipReason({ ...claude, daily_cap: null }, { ...ok, usedToday: 9999 }), null, 'เพดานว่าง = ไม่จำกัด')
})

await check('Claude 402 / billing_error → พัก 60 นาที', () => {
  for (const e of [{ status: 402 }, { status: 400, errorType: 'billing_error' }]) {
    const f = R.classifyFailure(claude, e, NOW)
    assert.equal(f.kind, 'pause')
    assert.equal(f.reason, 'billing')
    assert.equal(f.until.toISOString(), '2026-11-08T08:00:00.000Z')
    assert.equal(f.label, 'Claude: เครดิตหมด ลองใหม่ 15:00 น.')
  }
})

await check('Claude 429 → retry-after (วินาที/วันที่) หรือ 15 นาที · ค่าผิดปกติไม่เกิน 24 ชม.', () => {
  assert.equal(R.classifyFailure(claude, { status: 429 }, NOW).until.toISOString(), '2026-11-08T07:15:00.000Z')
  assert.equal(R.classifyFailure(claude, { status: 429, retryAfter: '90' }, NOW).until.toISOString(), '2026-11-08T07:02:00.000Z')
  assert.equal(R.classifyFailure(claude, { status: 429, retryAfter: 'Sun, 08 Nov 2026 07:30:00 GMT' }, NOW).until.toISOString(), '2026-11-08T07:30:00.000Z')
  assert.equal(R.classifyFailure(claude, { status: 429, retryAfter: '9999999' }, NOW).until.toISOString(), '2026-11-09T07:00:00.000Z')
  assert.equal(R.classifyFailure(claude, { status: 429, retryAfter: 'ขยะ' }, NOW).until.toISOString(), '2026-11-08T07:15:00.000Z')
  assert.equal(R.classifyFailure(claude, { status: 429 }, NOW).reason, 'rate_limit')
})

await check('Gemini 429 / RESOURCE_EXHAUSTED → พัก 60 นาที (ทั้งจ่ายเงินและฟรี)', () => {
  for (const s of [geminiPaid, geminiFree]) {
    const f = R.classifyFailure(s, { status: 429, errorType: 'RESOURCE_EXHAUSTED' }, NOW)
    assert.equal(f.kind, 'pause')
    assert.equal(f.reason, 'quota')
    assert.equal(f.until.toISOString(), '2026-11-08T08:00:00.000Z')
  }
})

await check('key ผิด: 401/403 ทุกเจ้า + Google 400 "API key not valid" → invalid_key · 400 อื่นของ Google ไม่ใช่', () => {
  assert.equal(R.classifyFailure(claude, { status: 401, errorType: 'authentication_error' }, NOW).kind, 'invalid_key')
  assert.equal(R.classifyFailure(claude, { status: 403 }, NOW).kind, 'invalid_key')
  assert.equal(R.classifyFailure(geminiPaid, { status: 400, errorType: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' }, NOW).kind, 'invalid_key')
  assert.equal(R.classifyFailure(geminiPaid, { status: 400, errorType: 'INVALID_ARGUMENT', message: 'Request contains an invalid argument.' }, NOW).kind, 'skip')
})

await check('5xx / 529 / timeout / 404 → ข้ามเฉพาะคำถามนี้ ไม่พัก', () => {
  for (const status of [500, 502, 503, 529, 0, 404, 400]) {
    assert.equal(R.classifyFailure(claude, { status }, NOW).kind, 'skip', String(status))
    assert.equal(R.classifyFailure(geminiFree, { status }, NOW).kind, 'skip', String(status))
  }
  assert.match(R.classifyFailure(claude, { status: 404 }, NOW).label, /ไม่พบโมเดล/)
  assert.match(R.classifyFailure(claude, { status: 0 }, NOW).label, /ช้าเกินเวลา/)
})

await check('route_note รวมบรรทัดเดียว ตัดที่ 1000 ตัว · ว่าง = null', () => {
  assert.equal(R.routeNote([]), null)
  assert.equal(R.routeNote(['Claude: เครดิตหมด ลองใหม่ 15:00 น.', 'Gemini จ่ายเงิน: ยังไม่ใส่ API key']), 'Claude: เครดิตหมด ลองใหม่ 15:00 น. · Gemini จ่ายเงิน: ยังไม่ใส่ API key')
  assert.equal(R.routeNote(['x'.repeat(2000)]).length, 1000)
})

await check('fallbacks "default" เฉพาะรุ่นที่รองรับ', () => {
  for (const m of ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']) assert.ok(R.claudeSupportsFallbacks(m), m)
  for (const m of ['claude-haiku-5-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-5-5x']) assert.ok(!R.claudeSupportsFallbacks(m), m)
})

await check('ประวัติ → messages ของ Claude: model→assistant · รวมบทบาทติดกัน · เริ่มด้วย user', () => {
  const out = R.toClaudeMessages([
    { role: 'model', content: 'ตอบเก่าที่ถูกตัดหัว' },
    { role: 'user', content: 'ถาม 1' }, { role: 'user', content: 'ถาม 1 ต่อ' },
    { role: 'model', content: 'ตอบ 1' },
  ], 'ถาม 2')
  assert.deepEqual(out, [
    { role: 'user', content: 'ถาม 1\n\nถาม 1 ต่อ' },
    { role: 'assistant', content: 'ตอบ 1' },
    { role: 'user', content: 'ถาม 2' },
  ])
})

await check('อ่านคำตอบ Claude: refusal ก่อน content · ข้าม thinking · max_tokens = ตัดท้าย', () => {
  const refused = R.extractClaudeReply({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] })
  assert.deepEqual(refused, { ok: false, reason: 'Claude: ปฏิเสธคำถามนี้ (cyber)' })
  const good = R.extractClaudeReply({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: ' คำตอบ ' }] })
  assert.deepEqual(good, { ok: true, text: 'คำตอบ', truncated: false })
  assert.equal(R.extractClaudeReply({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'ยาว' }] }).truncated, true)
  assert.equal(R.extractClaudeReply({ stop_reason: 'end_turn', content: [] }).ok, false)
})

await check('งบเวลา: ช่องแรกไม่เกิน 70 วิ · ทั้งคำขอจบใน 110 วิ · เหลือไม่ถึง 15 วิไม่เริ่มช่องใหม่', () => {
  assert.equal(R.slotTimeoutMs(0, 0), 70_000)
  assert.equal(R.slotTimeoutMs(0, 70_000), 38_000)
  assert.equal(R.slotTimeoutMs(0, 95_001), null)
  assert.ok(R.REQUEST_BUDGET_MS < 120_000, 'ต้องจบก่อนหน้าเว็บเลิกรอ (120 วิ)')
})

await check('CHECK pause_reason ใน migration ตรงกับค่าที่ตรรกะใช้', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261109130000_advisor_provider_slots_tables.sql', import.meta.url), 'utf8')
  assert.ok(sql.includes("pause_reason IN ('billing', 'rate_limit', 'quota')"))
})

console.log(`\nsuperadmin-advisor-routing: ผ่าน ${passed} ข้อ`)

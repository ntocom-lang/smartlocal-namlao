// หน้า "ที่ปรึกษา AI" เฉพาะ Super Admin (รอบ 2: 3 ช่อง) — ตรวจ helper pure + ซอร์ส
// (กัน XSS / สิทธิ์ route / ห้ามใช้ functions.invoke / key ห้ามรั่ว / UPDATE ส่งเฉพาะคอลัมน์ที่มีสิทธิ์)
// npm run test:advisor
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  ADVISOR_MODEL_RE, answerBadge, bangkokClockText, bangkokDayStartIso, conversationToText, groupConversations, isSlotPaused,
  newConversationId, slotDisplayName, usageText, validateSlotSettings,
} from '../src/lib/advisorHelpers.js'
import { currentPortal } from '../src/lib/portalAccess.js'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
// ตัดคอมเมนต์ออกก่อนตรวจซอร์ส — คอมเมนต์ในไฟล์เตือนชื่อสิ่งที่ห้ามทำไว้ ไม่ใช่การทำจริง
const code = (src) => src.split(/\r?\n/).filter(l => !l.trim().startsWith('//')).map(l => l.replace(/\s\/\/\s.*$/, '')).join('\n')
let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

await check('bangkokDayStartIso: เที่ยงคืนไทย = 17:00Z ของวันก่อน (ขอบวัน)', () => {
  assert.equal(bangkokDayStartIso(new Date('2026-11-08T18:30:00Z')), '2026-11-08T17:00:00.000Z')
  assert.equal(bangkokDayStartIso(new Date('2026-11-08T16:59:00Z')), '2026-11-07T17:00:00.000Z')
  assert.equal(bangkokDayStartIso(new Date('2026-11-08T17:00:00Z')), '2026-11-08T17:00:00.000Z', 'ตรงเที่ยงคืนพอดีนับเป็นวันใหม่')
  assert.equal(bangkokDayStartIso(new Date('2026-01-01T00:00:00Z')), '2025-12-31T17:00:00.000Z', 'ข้ามปี')
  assert.equal(bangkokDayStartIso('2026-11-08T05:00:00Z'), '2026-11-07T17:00:00.000Z', 'รับสตริง ISO ได้')
})

const row = (id, conv, role, content, at) => ({ id, conversation_id: conv, role, content, created_at: at })

await check('groupConversations: จัดกลุ่ม หัวข้อ = ข้อความ user แรก ตัด 60 ตัว เรียงล่าสุดก่อน', () => {
  const long = 'ก'.repeat(100)
  const rows = [
    // ลำดับสลับกันโดยตั้งใจ — ต้องเรียงเองไม่พึ่งลำดับที่ฐานข้อมูลส่งมา
    row(4, 'b', 'model', 'ตอบเรื่อง B', '2026-11-08T03:00:00Z'),
    row(2, 'a', 'model', 'ตอบ A', '2026-11-07T01:01:00Z'),
    row(1, 'a', 'user', '  คำถาม   A\nบรรทัดสอง ', '2026-11-07T01:00:00Z'),
    row(3, 'b', 'user', long, '2026-11-08T02:59:00Z'),
    row(5, 'c', 'model', 'ไม่มีข้อความ user ในชุดที่โหลด', '2026-11-06T00:00:00Z'),
  ]
  const out = groupConversations(rows)
  assert.deepEqual(out.map(c => c.id), ['b', 'a', 'c'], 'ล่าสุดก่อน')
  assert.equal(out[0].title, 'ก'.repeat(60))
  assert.equal(out[1].title, 'คำถาม A บรรทัดสอง', 'ยุบช่องว่าง/ขึ้นบรรทัดใหม่')
  assert.equal(out[2].title, 'บทสนทนา', 'ไม่มีข้อความ user ใช้หัวข้อสำรอง')
  assert.equal(out[1].lastAt, '2026-11-07T01:01:00Z')
  assert.equal(out[1].count, 2)
  assert.deepEqual(groupConversations([]), [])
  assert.deepEqual(groupConversations(null), [])
})

await check('validateSlotSettings: โมเดลตาม regex เดียวกับฐานข้อมูล · เพดาน 1–10000 · ว่าง = null (ไม่จำกัด)', () => {
  const ok = validateSlotSettings({ model: ' gemini-2.5-flash ', daily_cap: '50' })
  assert.deepEqual(ok, { error: '', model: 'gemini-2.5-flash', daily_cap: 50 }, 'ตัดช่องว่างหัวท้าย + แปลงเป็นตัวเลข')
  assert.equal(validateSlotSettings({ model: 'claude-opus-5-5', daily_cap: '10000' }).daily_cap, 10000)
  for (const empty of ['', '  ', null, undefined]) {
    const r = validateSlotSettings({ model: 'claude-opus-5-5', daily_cap: empty })
    assert.equal(r.error, '', `เพดานว่าง (${JSON.stringify(empty)}) ต้องผ่าน`)
    assert.equal(r.daily_cap, null, 'ว่าง = ส่ง null')
  }
  for (const bad of ['', 'a', 'Gemini', '-abc', 'a b', 'x'.repeat(64), 'ก-ข', 'a_b']) {
    assert.notEqual(validateSlotSettings({ model: bad, daily_cap: 10 }).error, '', `โมเดล "${bad}" ต้องไม่ผ่าน`)
  }
  for (const cap of ['0', '10001', '1.5', 'abc', '-1', '1e3', 0, 10001, 1.5]) {
    assert.notEqual(validateSlotSettings({ model: 'gemini-2.5-flash', daily_cap: cap }).error, '', `เพดาน ${cap} ต้องไม่ผ่าน`)
  }
  assert.ok(ADVISOR_MODEL_RE.test('x'.repeat(63)) && !ADVISOR_MODEL_RE.test('x'.repeat(64)))
})

await check('slotDisplayName / answerBadge: ชื่อช่องตามที่เจ้าของกำหนด · ข้อความรอบ 1 (ไม่มี provider) = Gemini ฟรี', () => {
  assert.equal(slotDisplayName({ provider: 'claude', slot: 1 }), 'Claude')
  assert.equal(slotDisplayName({ provider: 'gemini', slot: 2 }), 'Gemini จ่ายเงิน')
  assert.equal(slotDisplayName({ provider: 'gemini', slot: 3 }), 'Gemini ฟรี')
  assert.equal(slotDisplayName({ provider: null, slot: null }), 'Gemini ฟรี', 'แถวรอบ 1 ไม่มี provider/slot')
  assert.equal(slotDisplayName({}), 'Gemini ฟรี')
  assert.equal(slotDisplayName(), 'Gemini ฟรี')

  assert.deepEqual(answerBadge({ provider: 'claude', slot: 1, model: 'claude-opus-5-5', route_note: 'Claude: เครดิตหมด ลองใหม่ 15:00 น.' }),
    { text: 'ตอบโดย Claude (claude-opus-5-5)', note: 'Claude: เครดิตหมด ลองใหม่ 15:00 น.' })
  assert.deepEqual(answerBadge({ provider: null, slot: null, model: 'gemini-2.5-flash', route_note: null }),
    { text: 'ตอบโดย Gemini ฟรี (gemini-2.5-flash)', note: '' })
  // รูปแบบ response ของ Edge Function
  const live = answerBadge({ answered_by: { slot: 2, provider: 'gemini', model: 'gemini-2.5-pro', label: 'Gemini จ่ายเงิน' }, notes: ['Claude: เครดิตหมด', 'ช่อง 2 ข้าม'] })
  assert.equal(live.text, 'ตอบโดย Gemini จ่ายเงิน (gemini-2.5-pro)')
  assert.equal(live.note, 'Claude: เครดิตหมด · ช่อง 2 ข้าม')
  assert.equal(answerBadge({ provider: 'gemini', slot: 3 }).text, 'ตอบโดย Gemini ฟรี', 'ไม่มีโมเดล = ไม่มีวงเล็บ')
})

await check('usageText / isSlotPaused / bangkokClockText', () => {
  assert.equal(usageText(3, 50), '3 / 50')
  assert.equal(usageText(3, null), '3 / ไม่จำกัด', 'daily_cap null = ไม่จำกัด')
  assert.equal(usageText(undefined, 50), '')
  const now = new Date('2026-11-08T07:00:00Z')
  assert.equal(isSlotPaused({ paused_until: '2026-11-08T08:00:00Z' }, now), true)
  assert.equal(isSlotPaused({ paused_until: '2026-11-08T07:00:00Z' }, now), false, 'พ้นเวลาพอดี = ไม่พักแล้ว')
  assert.equal(isSlotPaused({ paused_until: null }, now), false)
  assert.equal(isSlotPaused(null, now), false)
  assert.equal(bangkokClockText('2026-11-08T08:00:00Z'), '15:00', 'UTC+7')
  assert.equal(bangkokClockText('2026-11-08T17:05:00Z'), '00:05', 'ข้ามเที่ยงคืนไทย')
  assert.equal(bangkokClockText('ไม่ใช่วันที่'), '')
})

await check('conversationToText + newConversationId', () => {
  assert.equal(conversationToText([{ role: 'user', content: 'สวัสดี' }, { role: 'model', content: 'ครับ' }]), 'ฉัน: สวัสดี\n\nGemini ฟรี: ครับ')
  assert.equal(conversationToText([{ role: 'model', content: 'ก', provider: 'claude', slot: 1 }]), 'Claude: ก')
  assert.match(newConversationId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

await check('ซอร์ส: SuperAdminAdvisor ไม่มี dangerouslySetInnerHTML/markdown lib · ตรวจ role · ใช้ whitespace-pre-wrap', async () => {
  const src = await read('src/components/dev/SuperAdminAdvisor.jsx')
  assert.ok(!src.includes('dangerouslySetInnerHTML'), 'ห้าม render HTML จากคำตอบโมเดล (XSS)')
  assert.ok(!/from ['"](react-markdown|marked|markdown-it|remark|showdown|dompurify)/.test(src), 'ห้ามเพิ่มไลบรารี markdown')
  assert.ok(src.includes("currentUserRole !== 'superadmin'"), 'ด่านที่ 2: ตรวจ role ในคอมโพเนนต์')
  assert.ok(src.includes('เมนูนี้ใช้ได้เฉพาะ Super Admin'))
  assert.ok(src.includes('whitespace-pre-wrap'))
  assert.ok(src.includes("'noopener'"), 'window.open ไป claude.ai ต้อง noopener')
})

await check('ซอร์ส: หน้าจอ — ป้าย "ตอบโดย" · ตัดคำตอบ · notes ของ 503 · ยอดใช้รายช่อง · คำเตือนข้อมูลประชาชน/การนำไปฝึก', async () => {
  const src = await read('src/components/dev/SuperAdminAdvisor.jsx')
  assert.ok(src.includes('answerBadge(m)'), 'ใต้คำตอบต้องมีป้าย ตอบโดย')
  assert.ok(src.includes('(คำตอบถูกตัดเพราะยาวเกิน)') && src.includes('res.truncated'))
  assert.ok(src.includes('errorNotes') && src.includes('e.notes'), '503 ต้องแสดง notes ทุกข้อ')
  assert.ok(src.includes('usageText(usage.used, usage.cap)') && src.includes('res.used_today') && src.includes('res.daily_cap'))
  assert.ok(src.includes('ห้ามพิมพ์/วางข้อมูลส่วนบุคคลของประชาชน'))
  assert.ok(src.includes('Gemini แบบฟรี Google นำข้อความไปพัฒนาได้ · แบบจ่ายเงินและ Claude ไม่นำไปฝึก (ตามเงื่อนไขผู้ให้บริการ ต้องยืนยันฉบับปัจจุบัน)'))
  for (const hint of [
    'ขึ้นต้นด้วย sk-ant- · สร้างที่ console.anthropic.com · ตั้งวงเงินใช้จ่ายสูงสุดที่ console ด้วย',
    'key ของ Google AI Studio จาก project ที่เปิด billing แล้ว — ต้องคนละ project กับช่อง 3 (โควตาคิดต่อ project)',
    'key จาก project ที่ไม่ผูก billing · ไม่ใส่ = ใช้ key ของระบบ',
  ]) assert.ok(src.includes(hint), `ขาด hint: ${hint}`)
  assert.ok(src.includes('ใช้ key ของระบบ (GEMINI_API_KEY)') && src.includes('ยังไม่ใส่ key — ช่องนี้จะถูกข้าม'))
  assert.ok(src.includes('API key ใช้ไม่ได้ (ผู้ให้บริการปฏิเสธ) — ใส่ key ใหม่'))
  assert.ok(src.includes('ปลดพักตอนนี้') && src.includes('ระบบจะลองใหม่เองเวลา'))
  assert.ok(src.includes('ลองช่องนี้เป็นลำดับที่'))
  // ช่อง model / daily_cap เดิมของ advisor_settings ต้องไม่อยู่ในฟอร์มสวิตช์รวมอีกแล้ว
  const form = src.slice(src.indexOf('function SettingsForm'), src.indexOf('const SLOT_KEY_HINT'))
  assert.ok(!/model|daily_cap/.test(form), 'ฟอร์มสวิตช์รวมต้องเหลือแค่ enabled')
})

await check('ซอร์ส: key — ช่องเป็น password + autoComplete off · ไม่ log · ไม่ลง storage · ไม่มี key ใน console', async () => {
  const src = code(await read('src/components/dev/SuperAdminAdvisor.jsx'))
  assert.ok(/type="password"[^>]*autoComplete="off"/.test(src.replace(/\n\s*/g, ' ')), 'ช่อง key ต้อง type=password autoComplete=off')
  assert.ok(!/console\s*\.\s*(log|info|debug|warn|error|trace)/.test(src), 'คอมโพเนนต์ที่ถือ key ห้ามมี console.*')
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(src), 'ห้ามเก็บ key ลง storage')
  assert.ok(src.includes('window.confirm') && src.includes("setSlotKey(n, '')"), 'ลบ key ต้องยืนยันก่อนแล้วส่ง key ว่าง')
  const api = code(await read('src/lib/advisorApi.js'))
  assert.ok(!/console\s*\.\s*\w+/.test(api), 'advisorApi ห้ามมี console.*')
})

await check('ซอร์ส: แนบภาพรวมระบบ — เริ่มที่ไม่แนบ · เลือกต่อคำถาม · ล้างหลังส่งสำเร็จ · ส่งเฉพาะตอนติ๊ก', async () => {
  const src = code(await read('src/components/dev/SuperAdminAdvisor.jsx'))
  assert.ok(src.includes('useState(false)') && src.includes('[attachOverview, setAttachOverview] = useState(false)'), 'ค่าเริ่มต้นต้องไม่แนบ')
  assert.ok(src.includes('overviewDays: attachOverview ? overviewDays : null'), 'ส่งเฉพาะตอนติ๊ก')
  assert.ok(src.includes('setAttachOverview(false)'), 'ต้องล้างหลังส่งสำเร็จ')
  const api = code(await read('src/lib/advisorApi.js'))
  assert.ok(api.includes('overview_days: overviewDays'))
})

await check('ซอร์ส: advisorApi ไม่เรียก functions.invoke (timeout 25 วิ) ใช้ fetch เอง + timeout 120 วิ', async () => {
  const src = code(await read('src/lib/advisorApi.js')).replace(/\n/g, ' ')
  assert.ok(!/functions\s*\.\s*invoke/.test(src), 'ห้ามใช้ supabase.functions.invoke')
  assert.ok(src.includes('/functions/v1/superadmin-advisor'))
  assert.ok(src.includes('AbortController') && src.includes('120000'))
  assert.ok(src.includes('Bearer ${session.access_token}') && src.includes('apikey: supabaseAnonKey'))
  assert.ok(src.includes('err.notes'), '503 ต้องแนบ notes ไปกับ error')
})

await check('ซอร์ส: advisorApi — rpc ใส่ key เป็น POST (ไม่มี get:true) · SELECT ระบุคอลัมน์ · UPDATE เฉพาะคอลัมน์ที่มีสิทธิ์', async () => {
  const src = code(await read('src/lib/advisorApi.js')).replace(/\n/g, ' ')
  const rpcs = [...src.matchAll(/\.rpc\(([^)]*)\)/g)].map(m => m[1])
  assert.equal(rpcs.length, 1, 'ต้องมี rpc เดียวคือ advisor_set_slot_key')
  assert.ok(rpcs[0].includes("'advisor_set_slot_key'") && rpcs[0].includes('p_slot') && rpcs[0].includes('p_key'))
  assert.ok(!/get\s*:\s*true/.test(src), 'ห้าม { get: true } — key จะไปอยู่ใน URL')
  assert.ok(!/head\s*:\s*true.*rpc/.test(src))

  assert.ok(!src.includes('key_secret_id'), 'ห้ามขอ key_secret_id มาที่หน้าจอ')
  assert.ok(!/from\('advisor_provider_slots'\)\s*\.select\('\*'\)/.test(src), 'ห้าม select(*) ตารางช่อง')
  const cols = src.match(/const SLOT_COLUMNS = '([^']+)'/)?.[1]
  assert.equal(cols, 'slot, provider, tier, enabled, model, daily_cap, key_last4, key_set_at, key_invalid_at, paused_until, pause_reason, updated_at')

  // GRANT UPDATE ของ authenticated: advisor_provider_slots = enabled/model/daily_cap/paused_until/pause_reason · advisor_settings ให้เขียนแค่ enabled (รอบ 2)
  const sets = [...src.matchAll(/\.update\(\{([^}]*)\}\)/g)].map(m =>
    m[1].split(',').map(x => x.trim().split(':')[0].trim()).filter(Boolean).sort().join(','))
  assert.ok(sets.length >= 3, `ต้องพบ update อย่างน้อย 3 จุด (settings/slot/unpause) พบ ${sets.length}`)
  const allowed = new Set(['daily_cap,enabled,model', 'pause_reason,paused_until', 'enabled'])
  for (const s of sets) assert.ok(allowed.has(s), `UPDATE ส่งคอลัมน์ที่ไม่อนุญาต: ${s}`)
  assert.ok(sets.includes('pause_reason,paused_until'), 'ปลดพักต้องส่งสองคอลัมน์พร้อมกัน (CHECK pause_pair)')
  assert.ok(!/from\('advisor_settings'\)\s*\.select\('[^']*(model|daily_cap)/.test(src), 'advisor_settings.model/daily_cap เลิกใช้ ห้ามอ่านมาแสดง')
  assert.ok(!/\.(insert|upsert|delete)\(/.test(src.replace(/from\('advisor_messages'\)\.delete\(\)/, '')), 'ห้าม insert/upsert/delete อย่างอื่น (สิทธิ์ไม่มี)')
})

await check('ซอร์ส: สัญญา response ของ Edge Function ตรงกับที่หน้าจออ่าน (answered_by/notes/truncated/used_today/daily_cap)', async () => {
  const fn = await read('supabase/functions/superadmin-advisor/index.ts')
  for (const f of ['answered_by', 'notes', 'truncated', 'used_today', 'daily_cap', 'reply', 'masked']) {
    assert.ok(new RegExp(`\\b${f}\\b`).test(fn.slice(fn.indexOf('return json({\n      ok: true'))), `response ขาด ${f}`)
  }
  assert.ok(fn.includes("'ไม่มีช่องผู้ให้บริการที่ตอบได้ตอนนี้', notes }, 503"), '503 ต้องมี notes[]')
})

await check('ซอร์ส: เมนูย้ายออกจาก AdminDashboard หมดแล้ว (ไม่มีร่องรอย advisor / ai-advisor / SuperAdminAdvisor)', async () => {
  const src = await read('src/pages/AdminDashboard.jsx')
  assert.ok(!/advisor/i.test(src), 'AdminDashboard ต้องไม่มี advisor เหลือ')
  assert.ok(!src.includes('ที่ปรึกษา AI'), 'ไม่มีเมนู/ป้าย ที่ปรึกษา AI ใน AdminDashboard')
  assert.ok(!/\bSparkles\b/.test(src), 'ไอคอน Sparkles ที่ import ไว้ให้เมนูนี้ต้องถูกเอาออกด้วย')
})

await check('ซอร์ส: route /dev-journal/advisor + ด่าน DEV_USER_ID + superadmin + ปุ่มเข้า/กลับ', async () => {
  const app = await read('src/App.jsx')
  assert.ok(app.includes("lazyWithRetry(() => import('./pages/DevAdvisor'))"))
  assert.ok(app.includes('<Route path="/dev-journal/advisor" element={<DevAdvisor />} />'))
  // ด่าน isBackOffice / hideBottomNav ใช้ startsWith('/dev-journal') อยู่แล้ว ครอบ route ใหม่เอง
  assert.ok(/isBackOffice = \[[^\]]*'\/dev-journal'[^\]]*\]\.some\(p => location\.pathname\.startsWith\(p\)\)/.test(app))
  assert.ok(/hideBottomNav = \[[^\]]*'\/dev-journal'[^\]]*\]\.some\(p => location\.pathname\.startsWith\(p\)\)/.test(app))
  assert.equal(currentPortal('/dev-journal/advisor'), 'dev', 'พอร์ทัลต้องเป็น dev (หัว/เมนูผู้พัฒนา)')

  const page = await read('src/pages/DevAdvisor.jsx')
  assert.ok(page.includes("import { DEV_USER_ID } from '../lib/portalAccess'"))
  assert.ok(/uid !== DEV_USER_ID/.test(page) && page.includes("navigate('/admin/login', { replace: true })"), 'ไม่ใช่ผู้พัฒนา = กลับหน้าล็อกอิน')
  assert.ok(page.includes("from('profiles').select('role')"), 'ตรวจ profiles.role จากฐาน')
  assert.ok(page.includes('<SuperAdminAdvisor currentUserRole={role} />'), 'ส่ง role ให้คอมโพเนนต์ตรวจด่านที่ 2')
  assert.ok(page.includes("navigate('/dev-journal')"), 'ต้องมีปุ่มกลับ /dev-journal')

  const journal = await read('src/pages/DevJournal.jsx')
  assert.ok(journal.includes("navigate('/dev-journal/advisor')") && journal.includes('ที่ปรึกษา AI'), 'DevJournal ต้องมีปุ่มเข้าที่ปรึกษา AI')
})

console.log(`\nผ่านทั้งหมด ${passed} กลุ่ม`)

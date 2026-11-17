// แจ้งเตือน Telegram "ใบอนุญาตใกล้หมดอายุ / หนังสือรับรองการแจ้งใกล้ครบกำหนดค่าธรรมเนียม" (supabase/functions/licence-expiry-notify)
//   ชั้นแรก: รันตรรกะล้วนของจริง (_shared/licenceExpiryNotify.ts) — วันนี้ตามเวลาไทย · หลักเตือน m* · คีย์กันส่งซ้ำ · ข้อความไม่มีชื่อบุคคล
//   ชั้นสอง: อ่านซอร์ส edge function + migration cron — ลำดับ dry_run/claim/ส่ง · ช่องที่อ่าน (ไม่อ่านชื่อร้าน/ผู้ประกอบการ) · เฉพาะ อปท. ที่เปิดโมดูล
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่ส่งข้อความจริง
//   node tests/licence-expiry-notify.test.mjs   (หรือ npm run test:licence)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// โซนเวลาเครื่องเป็นต่างประเทศ: ถ้าโค้ดอ่านวันจากเวลาเครื่อง/UTC แทนเวลาไทย เคสข้ามวันด้านล่างจะพัง
process.env.TZ = 'America/Los_Angeles'
const N = await import('../supabase/functions/_shared/licenceExpiryNotify.ts')
const Lib = await import('../src/lib/licenceRegistry.js')

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

// ── วันนี้ / วันคงเหลือ ─────────────────────────────────────────────────────────

await test('วันนี้ใช้เวลาไทย ไม่ใช่ UTC/เวลาเครื่อง: 00:30 ไทย = 17:30 UTC ของวันก่อน', () => {
  assert.equal(N.todayBangkok(new Date('2026-11-16T17:30:00Z')), '2026-11-17')
  assert.equal(N.todayBangkok(new Date('2026-11-16T16:59:00Z')), '2026-11-16')
  assert.equal(N.todayBangkok(new Date('2026-12-31T17:00:00Z')), '2027-01-01')
})

await test('ส่วนต่างวัน/บวกวัน ตรงกับฝั่งหน้าจอ (licenceRegistry.js) — สองชุดต้องตัดสินตรงกัน', () => {
  for (const [a, b] of [['2026-11-17', '2026-12-17'], ['2026-11-17', '2026-11-10'], ['2026-02-28', '2028-02-29'], ['2026-12-31', '2027-01-01']]) {
    assert.equal(N.daysBetween(a, b), Lib.daysBetween(a, b), `${a} → ${b}`)
  }
  assert.equal(N.addDays('2026-11-17', 60), Lib.addDays('2026-11-17', 60))
  assert.equal(N.daysBetween('bad', '2026-01-01'), null)
  assert.equal(N.addDays('bad', 1), null)
  assert.deepEqual(N.DEFAULT_REMIND_DAYS, Lib.DEFAULT_REMIND_DAYS)
  for (const v of [null, [], [7, 30, 60, 0], [5, 5, 200, -1], 'x', [1, 2, 3, 4, 5, 6, 7]]) assert.deepEqual(N.effectiveRemindDays(v), Lib.effectiveRemindDays(v), JSON.stringify(v))
})

// ── หลักเตือน m* ───────────────────────────────────────────────────────────────

await test('หลักเตือน m* = ค่าน้อยสุดใน remind_days ที่ d ≤ m · ยังไกลกว่าหลักแรก = ข้าม · เลยกำหนดแล้ว = หลัก 0', () => {
  const days = [60, 30, 7, 0]
  const stage = d => N.stageOf(d, days)
  assert.equal(stage(61), null)      // ยังไม่ถึงหลัก 60
  assert.equal(stage(60), 60)
  assert.equal(stage(31), 60)
  assert.equal(stage(30), 30)
  assert.equal(stage(8), 30)
  assert.equal(stage(7), 7)
  assert.equal(stage(1), 7)
  assert.equal(stage(0), 0)
  assert.equal(stage(-1), 0)         // เลยกำหนด
  assert.equal(stage(-400), 0)
  assert.equal(N.stageOf(10, [90, 45]), 45)
  assert.equal(N.stageOf(100, [90, 45]), null)
})

await test('คีย์กันส่งซ้ำต่อ (ใบ, วันเป้าหมาย, หลัก): ต่ออายุแล้ว target เปลี่ยน → คีย์ใหม่ · หลักเดียวกันไม่ซ้ำ', () => {
  assert.equal(N.idempotencyKey('abc', '2027-01-31', 30), 'licence_remind:abc:2027-01-31:30')
  assert.notEqual(N.idempotencyKey('abc', '2027-01-31', 30), N.idempotencyKey('abc', '2028-01-31', 30))
  assert.notEqual(N.idempotencyKey('abc', '2027-01-31', 30), N.idempotencyKey('abc', '2027-01-31', 7))
  assert.equal(N.NOTIFICATION_TYPE, 'licence_expiring')
  assert.equal(N.JOB_NAME, 'licence-expiry-notify')
  assert.match(N.JOB_NAME, /^[a-z0-9-]{1,64}$/)
})

const L = (id, over = {}) => ({ id, municipality_id: 'm1', licence_type_id: 'tl', expires_on: null, next_fee_due_on: null, status: 'active', ...over })
const KINDS = { tl: 'licence', tn: 'notice_certificate' }
const run = (licences, today, remindDays = [60, 30, 7, 0]) => N.dueLicences({ licences, docKindByType: KINDS, remindDays, today })

await test('เลือกใบตามชนิดเอกสาร: ใบอนุญาตดู expires_on · หนังสือรับรองดู next_fee_due_on · ประเภทที่หาไม่เจอข้าม · วันที่ว่างข้าม', () => {
  const due = run([
    L('a', { expires_on: '2026-12-10' }),                                                            // d=23 → 30
    L('b', { licence_type_id: 'tn', next_fee_due_on: '2026-11-17' }),                                // d=0 → 0
    L('c', { licence_type_id: 'tn', expires_on: '2026-11-18', next_fee_due_on: null }),              // หนังสือรับรองไม่ดู expires_on
    L('d', { licence_type_id: 'zz', expires_on: '2026-11-18' }),                                     // ไม่รู้ชนิดเอกสาร ไม่เดา
    L('e', { expires_on: null }),
    L('f', { expires_on: '2027-06-01' }),                                                            // ไกลเกินหลักแรก
  ], '2026-11-17')
  assert.deepEqual(due.map(x => [x.licenceId, x.docKind, x.days, x.stage]), [['a', 'licence', 23, 30], ['b', 'notice_certificate', 0, 0]])
  assert.equal(due[0].key, 'licence_remind:a:2026-12-10:30')
})

await test('สถานะ: เตือนเฉพาะใช้งาน/พักใช้ · เพิกถอน/เลิกกิจการไม่เตือน', () => {
  const due = run(['active', 'suspended', 'revoked', 'closed'].map(status => L(status, { status, expires_on: '2026-11-20' })), '2026-11-17')
  assert.deepEqual(due.map(x => x.licenceId), ['active', 'suspended'])
})

await test('เตือนครั้งเดียวต่อหลัก: วันที่หลักผ่านไปใบเดิมได้คีย์เดิม · ข้ามหลักถัดไปได้คีย์ใหม่ (ส่งหลักละครั้ง)', () => {
  const lic = [L('a', { expires_on: '2027-01-16' })]
  const keyOn = today => run(lic, today)[0]?.key ?? null
  assert.equal(keyOn('2026-11-16'), null)                                  // d=61 ยังไม่ถึง
  assert.equal(keyOn('2026-11-17'), 'licence_remind:a:2027-01-16:60')      // d=60
  assert.equal(keyOn('2026-12-01'), 'licence_remind:a:2027-01-16:60')      // d=46 ยังหลัก 60 = คีย์เดิม (ไม่ส่งซ้ำ)
  assert.equal(keyOn('2026-12-17'), 'licence_remind:a:2027-01-16:30')      // d=30
  assert.equal(keyOn('2027-01-09'), 'licence_remind:a:2027-01-16:7')       // d=7
  assert.equal(keyOn('2027-01-16'), 'licence_remind:a:2027-01-16:0')       // d=0
  assert.equal(keyOn('2027-03-01'), 'licence_remind:a:2027-01-16:0')       // เลยกำหนดนานแล้ว ยังเป็นหลัก 0 เดิม (ส่งครั้งเดียว)
})

await test('หลักที่ตรงเสาร์-อาทิตย์ (cron ยิงเฉพาะจันทร์–ศุกร์) ส่งตามวันทำการถัดไปเอง ไม่หาย: d=7 ตรงวันเสาร์ → จันทร์ d=5 ยังเป็นหลัก 7', () => {
  // วันหมดอายุ อาทิตย์ 22 พ.ย. 2569 → หลัก 7 ตรงวันอาทิตย์ 15 พ.ย. 2569 (cron ไม่ยิง) · จันทร์ 16 พ.ย. d=6 ยังเป็นหลัก 7
  const lic = [L('a', { expires_on: '2026-11-22' })]
  assert.equal(new Date('2026-11-15T12:00:00+07:00').getUTCDay(), 0)
  assert.equal(new Date('2026-11-16T12:00:00+07:00').getUTCDay(), 1)
  const monday = run(lic, '2026-11-16')[0]
  assert.deepEqual([monday.days, monday.stage], [6, 7])
  // วันศุกร์ก่อนหน้า (d=8) ยังเป็นหลัก 30 — ไม่ข้ามไปหลัก 7 ก่อนเวลา
  assert.equal(run(lic, '2026-11-13')[0].stage, 30)
  // ถ้า อปท. ตั้งหลัก 5 ตรงวันเสาร์ ส่งวันจันทร์ที่ d=3 (ยังเป็นหลัก 5)
  const sat = run([L('b', { expires_on: '2026-11-19' })], '2026-11-16', [5])[0]
  assert.deepEqual([sat.days, sat.stage], [3, 5])
})

await test('วันนี้ใช้เวลาไทยตัดสินหลัก: 00:30 ไทยวันที่ 17 (ยังเป็น 16 ใน UTC/เครื่องสหรัฐ) ได้ d ของวันที่ 17', () => {
  const today = N.todayBangkok(new Date('2026-11-16T17:30:00Z'))
  assert.equal(run([L('a', { expires_on: '2026-11-17' })], today)[0].days, 0)
})

// ── ข้อความ ────────────────────────────────────────────────────────────────────

const item = (docKind, days, stage) => ({ docKind, days, stage })

await test('ข้อความ: แยกใบอนุญาต/หนังสือรับรอง · หมดอายุแล้ว/วันนี้/ภายใน N วัน · จำนวนใบ · ชื่อ อปท. escape HTML · บอกทางเข้าเมนูเป็นตัวหนังสือ', () => {
  const text = N.buildMessage({
    tenantName: 'เทศบาลตำบล<สาธิต> & บริวาร',
    items: [
      item('licence', -3, 0), item('licence', -10, 0), item('licence', 0, 0), item('licence', 5, 7), item('licence', 7, 7), item('licence', 20, 30),
      item('notice_certificate', -1, 0), item('notice_certificate', 25, 30),
    ],
  })
  assert.match(text, /^📋 <b>ทะเบียนใบอนุญาต: ใกล้ครบกำหนด<\/b>\n/)
  assert.match(text, /เทศบาลตำบล&lt;สาธิต&gt; &amp; บริวาร/)
  assert.match(text, /<b>ใบอนุญาต<\/b>\n• หมดอายุแล้ว 2 ใบ\n• หมดอายุวันนี้ 1 ใบ\n• หมดอายุภายใน 7 วัน 2 ใบ\n• หมดอายุภายใน 30 วัน 1 ใบ/)
  assert.match(text, /<b>หนังสือรับรองการแจ้ง \(ค่าธรรมเนียมรายปี\)<\/b>\n• ครบกำหนดชำระแล้ว 1 ใบ\n• ครบกำหนดชำระภายใน 30 วัน 1 ใบ/)
  assert.match(text, /ดูรายชื่อที่เมนู "ทะเบียนใบอนุญาต" → แท็บ "ต้องดำเนินการ"/)
  assert.doesNotMatch(text, /https?:|rk-networks/)
  assert.ok(text.indexOf('<b>ใบอนุญาต</b>') < text.indexOf('<b>หนังสือรับรองการแจ้ง'))
})

await test('ข้อความ: มีแค่ชนิดเดียว = ไม่มีหัวของอีกชนิด · ไม่มีรายการ = null (ไม่ส่งข้อความว่าง) · ไม่มีชื่อร้าน/ผู้ประกอบการ/เลขใบ', () => {
  const only = N.buildMessage({ tenantName: 'x', items: [item('notice_certificate', 0, 0)] })
  assert.doesNotMatch(only, /<b>ใบอนุญาต<\/b>/)
  assert.match(only, /ครบกำหนดชำระวันนี้ 1 ใบ/)
  assert.equal(N.buildMessage({ tenantName: 'x', items: [] }), null)
  assert.equal(N.buildMessage({ tenantName: 'x', items: undefined }), null)
  // ชนิดข้อมูลที่ส่งเข้า builder ไม่มีช่องชื่อ/เลขใบเลย — กันคนเพิ่มช่องมาทีหลัง
  const shared = stripComments(read('supabase/functions/_shared/licenceExpiryNotify.ts'))
  assert.doesNotMatch(shared, /business_name|holder_name|licence_no|holder_phone|address|village/)
})

await test('ข้อความยาวสุดไม่เกินเพดาน Telegram (4096) แม้หลักเตือนครบ 6 ค่า ชื่อ อปท. ยาว', () => {
  const items = []
  for (const stage of [180, 90, 60, 30, 7, 1]) for (const kind of ['licence', 'notice_certificate']) items.push(item(kind, stage, stage), item(kind, -1, 0))
  assert.ok(N.buildMessage({ tenantName: 'ท'.repeat(500), items }).length <= 3500)
})

await test('ค่าตั้ง อปท.: ไม่มีแถว/ว่าง = 60/30/7/0 · slug ทดสอบ · เปรียบเทียบเวลาคงที่ · โมดูลต้องเปิดไว้ชัดเจนเท่านั้น', () => {
  assert.deepEqual(N.effectiveRemindDays(undefined), [60, 30, 7, 0])
  assert.equal(N.validSlug('demo'), 'demo')
  for (const bad of ['', 'Demo', 'demo.evil.com', '-demo', 'de mo', null, 5, 'a'.repeat(64)]) assert.equal(N.validSlug(bad), null, String(bad))
  assert.equal(N.safeEqual('abc', 'abc'), true)
  assert.equal(N.safeEqual('abc', 'abd'), false)
  assert.equal(N.safeEqual('abc', 'abcd'), false)
  assert.equal(N.moduleEnabled(['complaints', 'licence-registry']), true)
  assert.equal(N.moduleEnabled(['complaints']), false)
  assert.equal(N.moduleEnabled([]), false)
  assert.equal(N.moduleEnabled(null), false)        // ต่างจากโมดูลเก่า: ไม่ใช่ array = ไม่ส่ง (โมดูลนี้ค่าเริ่มต้นปิด)
  assert.equal(N.moduleEnabled(undefined), false)
  assert.equal(N.moduleEnabled('licence-registry'), false)
  assert.equal(N.MODULE_KEY, Lib.LICENCE_MODULE_KEY)
})

// ── ซอร์ส edge function + migration ────────────────────────────────────────

const fnRaw = read('supabase/functions/licence-expiry-notify/index.ts')
const fn = stripComments(fnRaw)
const shared = read('supabase/functions/_shared/licenceExpiryNotify.ts')
const migration = read('supabase/migrations/20261208100200_licence_expiry_notify_cron.sql')
const migrationCode = stripComments(migration)

await test('ไฟล์ตรรกะล้วนไม่ import เน็ต/ไม่ใช้ Deno (node เทสต์ได้)', () => {
  const imports = [...shared.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1])
  assert.deepEqual(imports, ['./telegram.ts'])
  assert.doesNotMatch(stripComments(shared), /Deno\./)
})

await test('ฟังก์ชัน: ตรวจ cron secret ก่อนอ่านข้อมูล · dry_run คืนก่อน claim · claim ก่อนส่ง · ส่งซ้ำได้เฉพาะ failed · only_slug ผิดรูป 400', () => {
  const at = s => { const i = fn.indexOf(s); assert.ok(i >= 0, 'ไม่พบ ' + s); return i }
  assert.ok(at("safeEqual(req.headers.get('x-cron-secret')") < at("admin.from('municipalities')"))
  assert.ok(at('if (dryRun) {') < at("from('notification_deliveries').insert"))
  assert.ok(at("from('notification_deliveries').insert") < at('sendTelegramMessage('))
  assert.match(fn, /claimError\.code !== '23505'/)
  assert.match(fn, /existing\?\.status !== 'failed'/)
  assert.match(fn, /validSlug\(body\.only_slug\)/)
  assert.match(fn, /'invalid only_slug' }, 400/)
  assert.match(fnRaw, /--no-verify-jwt/)
  assert.match(fnRaw, /deploy จาก master หลัง merge/)
})

await test('ฟังก์ชัน: ส่งเฉพาะ อปท. ที่เปิดโมดูล + มี telegram_group_id · claim ต่อใบ (idempotency_key ต่อใบต่อหลัก, resource_type licence) · 1 ข้อความต่อ อปท.', () => {
  assert.match(fn, /\.not\('telegram_group_id', 'is', null\)/)
  assert.match(fn, /if \(!moduleEnabled\(tenant\.enabled_modules\)\) \{ summary\.moduleOff \+= 1; continue \}/)
  assert.match(fn, /notification_type: NOTIFICATION_TYPE/)
  assert.match(fn, /resource_type: 'licence'/)
  assert.match(fn, /resource_id: item\.licenceId/)
  assert.match(fn, /idempotency_key: item\.key/)
  assert.equal((fn.match(/sendTelegramMessage\(/g) ?? []).length, 1)
  // ข้อความสร้างจากใบที่ claim ได้ใหม่เท่านั้น
  assert.match(fn, /buildMessage\(\{ tenantName: tenant\.name, items: claimed \}\)/)
  // ผลส่งบันทึกกลับทุกใบที่ claim ด้วยคีย์ของตัวเอง (failed = ส่งใหม่ได้รอบหน้า)
  assert.match(fn, /\.in\('idempotency_key', keys\.slice\(i, i \+ UPDATE_CHUNK\)\)/)
  assert.match(fn, /status: result\.ok \? 'sent' : 'failed'/)
})

await test('ฟังก์ชันอ่านเฉพาะช่องที่ใช้นับ — ไม่อ่านชื่อร้าน ชื่อผู้ประกอบการ เลขใบ ที่อยู่ เบอร์โทร หมายเหตุ เหตุผล', () => {
  const selectList = [...fn.matchAll(/\.select\('([^']+)'/g)].map(m => m[1])
  assert.ok(selectList.length >= 5, 'จับ select ได้ไม่ครบ ' + selectList.length)
  const selects = selectList.join(',')
  for (const col of ['business_name', 'holder_name', 'licence_no', 'holder_phone', 'address', 'village', 'note', 'status_reason', 'status_order_ref', 'created_by', 'updated_by']) {
    assert.doesNotMatch(selects, new RegExp(`\\b${col}\\b`), col)
  }
  assert.doesNotMatch(fn, /select\('\*'\)|select\(\)/)
  assert.match(fn, /from\('licence_settings'\)\s*\.select\('remind_days'\)/)
  assert.match(fn, /from\('licence_types'\)\s*\.select\('id, doc_kind'\)/)
  // ใบอ่านเฉพาะ active/suspended ของ อปท. นั้น และไล่หน้าเทียบ count (NOTES ข้อ 14)
  assert.match(fn, /fetchAll<LicenceRow>\('licences'[\s\S]{0,420}withCountOpt\(c\)[\s\S]{0,300}\.range\(from, to\)/)
  assert.match(fn, /\.eq\('municipality_id', tenantId\)\.in\('status', \['active', 'suspended'\]\)/)
  assert.match(fn, /typeof count !== 'number'\) throw/)
  assert.match(fn, /if \(out\.length !== total\) throw/)
  assert.match(fn, /count: 'exact' as const/)
  // error ระหว่างอ่านของ อปท. หนึ่ง → ข้ามแค่ อปท. นั้น (ไม่ส่งข้อความเกินจริง) แล้วลงสมุดว่าพัง
  assert.ok(fn.includes('summary.errors.push(`${tenant.slug}: ${cleanText((e as Error).message, 200)}`)'))
})

await test('สมุดลงเวลา job_heartbeats: เฉพาะรอบเต็ม (ไม่นับ dry_run/only_slug) · errors หรือส่งไม่สำเร็จ = last_error · ชื่องานผ่าน CHECK ของตาราง', () => {
  assert.match(fn, /const fullRun = !dryRun && !onlySlug/)
  assert.match(fn, /from\('job_heartbeats'\)\.upsert\(row, \{ onConflict: 'job_name' \}\)/)
  assert.match(fn, /summary\.failed > 0 \?/)
  const hb = read('supabase/migrations/20260928140000_job_heartbeats_table.sql')
  assert.match(N.JOB_NAME, new RegExp(hb.match(/job_name ~ '([^']+)'/)[1]))
})

await test('เพดาน claim ต่อ อปท.ต่อรอบ: ใบที่เกินเพดานไม่ถูก claim (เข้ารอบวันทำการถัดไป ไม่หาย) · ดึงเฉพาะใบที่ถึงหลักเตือนแรก', () => {
  assert.match(fn, /const MAX_CLAIMS_PER_TENANT = \d+/)
  assert.match(fn, /if \(claimed\.length >= MAX_CLAIMS_PER_TENANT\) \{ summary\.deferred \+= 1; continue \}/)
  assert.match(fn, /\.or\(`expires_on\.lte\.\$\{limit\},next_fee_due_on\.lte\.\$\{limit\}`\)/)
  assert.match(fn, /const limit = addDays\(today, Math\.max\(\.\.\.remindDays\)\)/)
})

await test('migration: ตั้ง cron อย่างเดียว วันทำการ 08:40 ไทย (01:40 UTC จันทร์–ศุกร์) ยิงไปฟังก์ชันชื่อเดียวกัน ใช้ secret เดิม ไม่ชนงานอื่น', () => {
  assert.match(migrationCode, /'licence-expiry-notify',\s*'40 1 \* \* 1-5'/)
  assert.match(migrationCode, /functions\/v1\/licence-expiry-notify'/)
  assert.match(migrationCode, /name = 'fleet_cron_secret'/)
  assert.doesNotMatch(migrationCode, /\b(GRANT|REVOKE|CREATE TABLE|ALTER TABLE|CREATE POLICY|CREATE (OR REPLACE )?FUNCTION|SECURITY DEFINER)\b/i)
  assert.match(migration, /deploy Edge Function licence-expiry-notify/)
  const fleet = read('supabase/migrations/20260819120000_fleet_doc_expiry_cron.sql')
  assert.doesNotMatch(fleet, /'40 1 \* \* /)
})

await test('ตัวเฝ้า thaiwater-watchdog: ลงรายการ licence-expiry-notify ชื่อตรง JOB_NAME · เกณฑ์ครอบช่วงว่างเสาร์-อาทิตย์ (72 ชม.) ไม่เตือนผิด', async () => {
  const dog = read('supabase/functions/thaiwater-watchdog/index.ts')
  const entry = dog.slice(dog.indexOf("name: 'licence-expiry-notify'"), dog.indexOf("name: 'licence-expiry-notify'") + 900)
  assert.ok(entry.includes(`name: '${N.JOB_NAME}'`))
  assert.match(entry, /schedule: \{ kind: 'rolling', maxAgeMinutes: (\d+) \}/)
  const max = Number(entry.match(/maxAgeMinutes: (\d+)/)[1])
  // ช่วงว่างยาวสุด: ศุกร์ 08:40 → จันทร์ 08:40 = 72 ชม. · ตัวเฝ้าตรวจนาทีที่ 25 → ต้องไม่เกินเกณฑ์ก่อนรอบจันทร์ แต่ไม่หลวมเกิน 80 ชม.
  assert.ok(max >= 72 * 60 && max <= 80 * 60, `maxAgeMinutes ${max}`)
  assert.match(migrationCode, /'40 1 \* \* 1-5'/)         // ถ้าย้ายเวลา/วัน cron ต้องทบทวนเกณฑ์นี้
  // จำลองด้วย checkJob จริง: รอบศุกร์ 08:41 → ตรวจ เสาร์/อาทิตย์/จันทร์ก่อนรอบ ต้องไม่ stale · จันทร์รอบพลาด ตรวจ 11:25 ต้อง stale
  const J = await import('../supabase/functions/_shared/jobSchedule.ts')
  const sched = { kind: 'rolling', maxAgeMinutes: max }
  const fri = '2026-11-20T01:41:00Z'                          // ศุกร์ 20 พ.ย. 2569 08:41 ไทย
  for (const at of ['2026-11-21T03:25:00Z', '2026-11-22T10:25:00Z', '2026-11-23T01:25:00Z']) assert.equal(J.checkJob(sched, fri, new Date(at)).stale, false, at)
  assert.equal(J.checkJob(sched, fri, new Date('2026-11-23T04:25:00Z')).stale, true)   // จันทร์ 11:25 ไทย ยังไม่มีรอบใหม่
  assert.match(dog, /last_error\/ผลที่ลงสมุดมีแต่ slug/)
})

await test('last_error/สมุดลงเวลาไม่มีชื่อผู้ประกอบการ/ชื่อร้าน: ข้อความ error ที่ลงมาจาก slug + ข้อความระบบเท่านั้น (ไม่ประกอบจากข้อมูลใบ)', () => {
  const errorLines = fn.split(String.fromCharCode(10)).filter(l => /errors\.push|new Error\(/.test(l)).join(' ')
  assert.ok(errorLines.length > 0)
  assert.doesNotMatch(errorLines, /business_name|holder_name|licence_no|holder_phone|licence\.|item\.|row\./)
  assert.match(fn, /recordHeartbeat\(admin, problems\.length === 0/)
})

console.log(`\n${cases} cases passed`)

// แจ้งเตือน Telegram "สรุปเรื่องร้องเรียนประจำเดือนพร้อมแล้ว" (supabase/functions/complaint-monthly-reminder)
//   ชั้นแรก: รันตรรกะล้วนของจริง (_shared/complaintMonthlyReminder.ts) — เดือนที่แล้วตามเวลาไทย · ลิงก์ · ข้อความ · เทียบกับหน้าเว็บ
//   ชั้นสอง: อ่านซอร์ส edge function + migration — ลำดับ dry_run/claim/ส่ง · กันส่งซ้ำ · ไม่แตะข้อมูลส่วนบุคคล · ตารางเวลา cron
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่ส่งข้อความจริง
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ตั้งโซนเวลาเครื่องเป็นต่างประเทศ: ถ้าโค้ดอ่านเดือนจากเวลาเครื่อง/UTC แทนเวลาไทย เคสข้ามเดือนด้านล่างจะพัง
process.env.TZ = 'America/Los_Angeles'
const Reminder = await import('../supabase/functions/_shared/complaintMonthlyReminder.ts')
const Sum = await import('../src/lib/complaintMonthlySummary.js')
const { MODULE_KEY, buildReminderMessage, idempotencyKey, moduleOn, previousMonthBangkok, reportUrl, safeEqual } = Reminder

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
// ตัดคอมเมนต์ก่อนตรวจชื่อคอลัมน์/ลำดับโค้ด — คอมเมนต์กติกา PDPA ในไฟล์เองก็เอ่ยชื่อคอลัมน์เหล่านี้
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

await test('เดือนที่แล้วตามเวลาไทย ณ เวลาที่ cron ยิง (1 พ.ย. 08:30 น. → ตุลาคม 2569)', () => {
  const month = previousMonthBangkok(new Date('2026-11-01T01:30:00Z'))
  assert.deepEqual(
    [month.key, month.label, month.from, month.to, month.beYear, month.month],
    ['2569-10', 'ตุลาคม 2569', '2026-10-01', '2026-10-31', 2569, 10],
  )
})

await test('ใช้เวลาไทย ไม่ใช่ UTC/เวลาเครื่อง: 1 พ.ย. 00:30 ไทย = 31 ต.ค. 17:30 UTC → ตุลาคม · 31 ต.ค. 23:59 ไทย → กันยายน', () => {
  assert.equal(previousMonthBangkok(new Date('2026-10-31T17:30:00Z')).key, '2569-10')
  assert.equal(previousMonthBangkok(new Date('2026-10-31T16:59:00Z')).key, '2569-09')
})

await test('ข้ามปี: 1 ม.ค. 2570 → ธันวาคม 2569 (ปี ค.ศ. 2026) · กุมภาพันธ์ปีอธิกสุรทิน 29 วัน', () => {
  const december = previousMonthBangkok(new Date('2027-01-01T01:30:00Z'))
  assert.deepEqual([december.key, december.from, december.to], ['2569-12', '2026-12-01', '2026-12-31'])
  const february = previousMonthBangkok(new Date('2024-03-01T01:30:00Z'))
  assert.deepEqual([february.key, february.from, february.to], ['2567-02', '2024-02-01', '2024-02-29'])
})

await test('ชื่อเดือนตรงกับ src/lib/complaintMonthlySummary.js และช่วงวันที่ตรงกับที่หน้ารายงานคำนวณจากรหัสเดือนเดียวกัน', () => {
  assert.deepEqual(Reminder.MONTHS_TH_FULL, Sum.MONTHS_TH_FULL)
  for (const iso of ['2026-11-01T01:30:00Z', '2027-01-01T01:30:00Z', '2024-03-01T01:30:00Z', '2026-06-01T01:30:00Z']) {
    const now = new Date(iso)
    const month = previousMonthBangkok(now)
    const page = Sum.parseMonthParam(month.key, now)
    assert.ok(page, `หน้ารายงานต้องรับรหัสเดือน ${month.key} (ไม่งั้นลิงก์ตกกลับไปโหมดปีงบเงียบๆ)`)
    assert.deepEqual([page.from, page.to, page.label], [month.from, month.to, month.label])
  }
})

await test('ลิงก์: โฮสต์ตาม slug เท่านั้น · slug แปลกปลอม/รหัสเดือนผิดรูปแบบคืน null', () => {
  assert.equal(reportUrl('namlao', '2569-09'), 'https://namlao.rk-networks.com/reports/complaints?m=2569-09')
  assert.equal(reportUrl('thung-kaew', '2569-12'), 'https://thung-kaew.rk-networks.com/reports/complaints?m=2569-12')
  for (const slug of ['', 'a.b', 'evil.com/#', 'x y', 'ABC', '-a', 'a-', null, undefined, 'a@b']) {
    assert.equal(reportUrl(slug, '2569-09'), null, `slug ${JSON.stringify(slug)}`)
  }
  for (const monthKey of ['2569-13', '2569-00', '2569-9', 'abcd-ef', '2569-09&x=1']) {
    assert.equal(reportUrl('namlao', monthKey), null, `เดือน ${monthKey}`)
  }
})

await test('ตัดตามโมดูลคำร้อง: null = เปิดทุกโมดูล · ลิสต์ที่ไม่มี complaints = ปิด', () => {
  assert.equal(MODULE_KEY, 'complaints')
  assert.equal(moduleOn(null), true)
  assert.equal(moduleOn(undefined), true)
  assert.equal(moduleOn(['complaints', 'fleet']), true)
  assert.equal(moduleOn(['fleet']), false)
  assert.equal(moduleOn([]), false)
})

await test('ข้อความ: บอกเดือน ชื่อหน่วยงาน ยอดรวม ลิงก์ · ไม่มีร้อยละ (ร้อยละขยับทีหลัง ไม่ตรงกับภาพที่ดาวน์โหลดตอนแชร์)', () => {
  const month = previousMonthBangkok(new Date('2026-10-02T01:30:00Z'))
  const url = reportUrl('namlao', month.key)
  const text = buildReminderMessage({ tenantName: 'องค์การบริหารส่วนตำบลน้ำเลา', month, total: 1234, url })
  assert.ok(text.includes('กันยายน 2569'))
  assert.ok(text.includes('องค์การบริหารส่วนตำบลน้ำเลา'))
  assert.ok(text.includes('1,234 เรื่อง'))
  assert.ok(text.includes(url))
  assert.ok(text.includes('LINE') && text.includes('Facebook'))
  assert.ok(!text.includes('%') && !text.includes('ร้อยละ'), 'ห้ามมีร้อยละ')
  assert.ok(text.length < 1800)
})

await test('ข้อความ: ชื่อหน่วยงานที่มี HTML ถูกหนีอักขระ (parse_mode HTML) และข้อความยาวผิดปกติไม่เกินเพดาน', () => {
  const month = previousMonthBangkok(new Date('2026-10-02T01:30:00Z'))
  const text = buildReminderMessage({ tenantName: '<b>x</b> & <script>alert(1)</script>', month, total: 3, url: reportUrl('namlao', month.key) })
  assert.ok(!text.includes('<script>') && !text.includes('<b>x</b>'))
  assert.ok(text.includes('&lt;b&gt;x&lt;/b&gt; &amp; &lt;script&gt;'))
  const long = buildReminderMessage({ tenantName: 'ก'.repeat(5000), month, total: 3, url: reportUrl('namlao', month.key) })
  assert.ok(long.length <= 1800)
})

await test('คีย์กันส่งซ้ำแยกตามเดือน (เดือนใหม่ส่งได้ เดือนเดิมไม่ซ้ำ)', () => {
  assert.equal(idempotencyKey('2569-09'), 'complaint_monthly:2569-09')
  assert.notEqual(idempotencyKey('2569-09'), idempotencyKey('2569-10'))
})

await test('safeEqual: เท่ากันจริงเท่านั้น (ความยาวต่าง/ว่าง/คนละตัว = false)', () => {
  assert.equal(safeEqual('abc123', 'abc123'), true)
  assert.equal(safeEqual('abc123', 'abc124'), false)
  assert.equal(safeEqual('abc', 'abcd'), false)
  assert.equal(safeEqual('', 'x'), false)
  assert.equal(safeEqual('', ''), true) // index.ts ปฏิเสธ CRON_SECRET ว่างก่อนถึงตรงนี้ (ทดสอบด้านล่าง)
})

const edgeSource = read('supabase/functions/complaint-monthly-reminder/index.ts')
const edge = stripComments(edgeSource)
const migration = read('supabase/migrations/20261019100000_complaint_monthly_reminder_cron.sql')

await test('edge function: ยืนยันตัวด้วย x-cron-secret แบบเวลาคงที่ · ไม่มี CRON_SECRET = ปฏิเสธ · ผ่านก่อนทำอย่างอื่น', () => {
  assert.ok(edge.includes("req.headers.get('x-cron-secret')"))
  assert.ok(edge.includes('safeEqual('))
  assert.ok(edge.includes('if (!CRON_SECRET) return json'))
  const secretAt = edge.indexOf('safeEqual(')
  assert.ok(secretAt > 0 && secretAt < edge.indexOf("from('municipalities')"), 'ต้องตรวจ secret ก่อนแตะฐานข้อมูล')
})

await test('edge function: dry_run คืนข้อความก่อน claim และก่อนส่ง (ทดสอบแล้วไม่ส่งจริง ไม่ลงสมุดกันซ้ำ)', () => {
  const dryAt = edge.indexOf('if (dryRun) {')
  const claimAt = edge.indexOf("from('notification_deliveries').insert")
  const sendAt = edge.indexOf('sendTelegramMessage(String(')
  assert.ok(dryAt > 0 && claimAt > dryAt && sendAt > claimAt, `ลำดับ dry_run(${dryAt}) < claim(${claimAt}) < ส่ง(${sendAt})`)
  assert.ok(edge.includes('if (!dryRun && !BOT_TOKEN)'), 'dry_run ไม่ต้องมี bot token')
})

await test('edge function: กันส่งซ้ำด้วย unique (23505) ส่งใหม่เฉพาะแถว failed · ยอดรวมมาจาก RPC สาธารณะ ไม่ใช่ตารางคำร้อง', () => {
  assert.ok(edge.includes("claimError.code !== '23505'"))
  assert.ok(edge.includes("existing?.status !== 'failed'"))
  assert.ok(edge.includes("rpc('complaint_stats_fy'"))
  assert.ok(edge.includes('_from: month.from, _to: month.to'))
  assert.ok(!edge.includes("from('complaints')"), 'ห้ามอ่านตารางคำร้องตรงๆ ในฟังก์ชันนี้')
  assert.ok(edge.includes("resource_type: 'municipality'") && edge.includes('resource_id: tenant.id'))
})

await test('edge function: ข้าม อปท. ที่ไม่ผูกกลุ่ม/ปิดโมดูล/เดือนไม่มีเรื่อง/slug แปลก — ไม่ใช่ error', () => {
  assert.ok(edge.includes(".not('telegram_group_id', 'is', null)"))
  assert.ok(edge.includes('.filter((t) => moduleOn(t.enabled_modules))'))
  assert.ok(edge.includes('total <= 0'))
  assert.ok(edge.includes('if (!url)'))
})

await test('⚠️ PDPA: ฟังก์ชันและโมดูลตรรกะไม่แตะคอลัมน์ข้อมูลส่วนบุคคลของประชาชน', () => {
  const logic = stripComments(read('supabase/functions/_shared/complaintMonthlyReminder.ts'))
  for (const column of [
    'requester_name', 'requester_phone', 'requester_address', 'requester_id_card', 'reporter_name',
    'reporter_phone', 'staff_notes', 'contact_phone', 'description', 'location_text', 'issue_type',
  ]) {
    assert.ok(!edge.includes(column) && !logic.includes(column), `แตะคอลัมน์ ${column}`)
  }
})

await test('migration: ตาราง cron วันที่ 1 เวลา 01:30 UTC (08:30 ไทย) ยิงฟังก์ชันที่ถูกตัว ด้วย secret เดียวกับ fleet · มีด่านตรวจ secret · ยกเลิกงานเดิมก่อนตั้งใหม่', () => {
  assert.ok(migration.includes("'complaint-monthly-reminder',\n  '30 1 1 * *',") || migration.includes("'30 1 1 * *'"))
  assert.ok(migration.includes('/functions/v1/complaint-monthly-reminder'))
  assert.ok(migration.includes("name = 'fleet_cron_secret'"))
  assert.ok(migration.includes("RAISE EXCEPTION 'ยังไม่มี vault secret fleet_cron_secret"))
  assert.ok(migration.includes("cron.unschedule('complaint-monthly-reminder')"))
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(migration), 'ห้ามมี JWT/secret ฝังในไฟล์')
})

await test('ชนิดแจ้งเตือนในฟังก์ชันตรงกับค่าที่ตรรกะกำหนด (ไม่ซ้ำกับชนิดอื่นใน notification_deliveries)', () => {
  assert.equal(Reminder.NOTIFICATION_TYPE, 'complaint_monthly_summary')
  const others = ['fleet_document_expiring', 'fleet_emission_due', 'thaiwater_warning']
  assert.ok(!others.includes(Reminder.NOTIFICATION_TYPE))
})

console.log(`\n${cases} cases passed`)

// เหตุการณ์น้ำ-ฝนที่ระบบจดเอง (PR 3.1) — เทสต์แบบอ่านไฟล์ ไม่ต้องใช้ฐานข้อมูล (รันใน CI ได้)
// พฤติกรรมของ water_event_tick() จริงทดสอบใน tests/water-events-db.test.mjs (PGlite — วิธีรันอยู่หัวไฟล์นั้น)
// เทสต์นี้กัน 3 เรื่อง: (1) เกณฑ์ใน SQL ต้องตรงกับแจ้งเตือน Telegram และหน้าเว็บ (ตัวเลขซ้ำกัน 3 ที่)
// (2) ตารางปิดสิทธิ์ก่อนเปิดใช้ (3) ไม่มีข้อมูลบุคคลหลุดเข้าตารางเหตุการณ์
// รันด้วย: node tests/water-events.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LEVEL_WATCH_M, RAIN_VERY_HEAVY_MM, STATION_STALE_HOURS } from '../src/lib/waterSituation.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const tables = read('supabase/migrations/20261016100000_water_events_tables.sql')
const tick = read('supabase/migrations/20261016100100_water_events_tick_cron.sql')
const notify = read('supabase/functions/water-alert-notify/index.ts')

const stripComments = (text) => text.split('\n').filter(line => !/^\s*--/.test(line)).join('\n')
const code = { tables: stripComments(tables), tick: stripComments(tick) }

// ── 1) เกณฑ์ใน SQL = เกณฑ์ของแจ้งเตือน Telegram = เกณฑ์ของหน้าเว็บ ──
{
  const sqlNum = (name) => Number(tick.match(new RegExp(`${name}\\s+CONSTANT numeric\\s+:=\\s+([0-9.]+);`))?.[1])
  const sqlHours = (name) => Number(tick.match(new RegExp(`${name}\\s+CONSTANT interval := interval '(\\d+) hours'`))?.[1])
  const tsNum = (name) => Number(notify.match(new RegExp(`const ${name} = ([0-9.]+)`))?.[1])

  assert.equal(sqlNum('c_heavy_rain'), tsNum('HEAVY_RAIN_MM'), 'ฝนหนักมาก ต้องตรงกับ water-alert-notify')
  assert.equal(sqlNum('c_heavy_rain'), RAIN_VERY_HEAVY_MM, 'ฝนหนักมาก ต้องตรงกับ waterSituation.js')
  assert.equal(sqlNum('c_level_watch'), tsNum('LEVEL_WATCH_M'), 'ขั้นเฝ้าระวังระดับน้ำ ต้องตรงกับ water-alert-notify')
  assert.equal(sqlNum('c_level_watch'), LEVEL_WATCH_M, 'ขั้นเฝ้าระวังระดับน้ำ ต้องตรงกับ waterSituation.js')
  assert.equal(sqlHours('c_fresh_rain'), tsNum('RAIN_FRESH_HOURS'), 'ความสดค่าฝน')
  assert.equal(sqlHours('c_fresh_rain'), STATION_STALE_HOURS, 'ความสดค่าฝนต้องตรงกับหน้าเว็บ')
  assert.equal(sqlHours('c_fresh_level'), STATION_STALE_HOURS, 'ความสดระดับน้ำต้องตรงกับหน้าเว็บ')
  assert.equal(sqlHours('c_fresh_ews'), tsNum('EWS_FRESH_HOURS'), 'ความสด ews')
  assert.equal(sqlHours('c_fresh_warning'), tsNum('WARNING_FRESH_HOURS'), 'ความสดข้อความ สสน.')
  assert.match(notify, /EWS_ALERT_LEVELS = new Set\(\[2, 3\]\)/, 'ews ระดับ 2–3 ที่ water-alert-notify')
  assert.match(code.tick, /l\.situation_level IN \(2, 3\)/, 'ews ระดับ 2–3 ต้องตรงกับ water-alert-notify')

  // ตัวเลขของเหตุการณ์เอง (ไม่มีคู่ที่อื่น) ล็อกไว้ให้เปลี่ยนแล้วต้องแก้ทั้งเอกสารและเทสต์พฤติกรรม
  assert.equal(sqlHours('c_lead'), 24, 'คัดลอกค่าย้อนหลัง 24 ชม. ก่อนเปิด')
  assert.equal(sqlHours('c_calm'), 24, 'สงบต่อเนื่อง 24 ชม. จึงปิด')
  assert.equal(sqlHours('c_data_lost'), 48, 'ไม่มีค่าสด 48 ชม. จึงปิดแบบ data_lost')
}

// ── 2) อ่างเก็บน้ำต้องไม่ใช่ตัวเปิดเหตุการณ์ (น้ำมาก >80% อยู่ได้เป็นเดือน เหตุการณ์จะไม่ปิด) ──
{
  assert.ok(!/station_type\s*=\s*'dam'/.test(code.tick), "water_event_tick ห้ามใช้สถานีอ่าง ('dam') เป็นเกณฑ์เปิดเหตุการณ์")
  assert.ok(!/storage_percent\s*(>=|>)/.test(code.tick), 'ห้ามเทียบ % อ่างในฟังก์ชันตรวจ')
  // ค่าว่างห้ามถูกแปลงเป็น 0 (bank_diff_m ว่าง = ไม่มีค่า ไม่ใช่ "เสมอตลิ่ง")
  assert.ok(!/COALESCE\(\s*[a-z_.]*(bank_diff_m|rain_24h_mm)/i.test(code.tick), 'ห้าม COALESCE ค่าฝน/ระดับน้ำเป็น 0')
  assert.match(code.tick, /l\.rain_24h_mm IS NOT NULL AND l\.rain_24h_mm >= c_heavy_rain/)
  assert.match(code.tick, /l\.bank_diff_m IS NOT NULL AND l\.bank_diff_m <= c_level_watch/)
  // ค่า "ล่าสุด" ต้องไม่เกิน _now (ไม่งั้นเทสต์จำลองเวลา/รอบที่รันช้าจะเห็นค่าจากอนาคต)
  assert.ok((code.tick.match(/r\.recorded_at <= _now/g) ?? []).length >= 4, 'ค่าล่าสุดของทุกเกณฑ์ต้องไม่เกิน _now')
}

// ── 3) ปิดสิทธิ์ก่อนเปิดใช้: ถอนก่อน เปิด RLS ไม่เปิด policy · ฟังก์ชันเรียกจากเว็บไม่ได้ ──
{
  for (const tbl of ['water_events', 'water_event_readings', 'water_event_warnings']) {
    assert.match(code.tick, new RegExp(`REVOKE ALL ON public\\.${tbl}\\s+FROM anon, authenticated, PUBLIC;`), `${tbl} ต้องถอนสิทธิ์`)
    assert.match(code.tick, new RegExp(`ALTER TABLE public\\.${tbl}\\s+ENABLE ROW LEVEL SECURITY;`), `${tbl} ต้องเปิด RLS`)
  }
  assert.ok(!/\bGRANT\b/i.test(code.tables + code.tick), 'PR 3.1 ยังไม่ให้สิทธิ์ใคร (หน้าเจ้าหน้าที่ให้ใน PR 3.2)')
  assert.ok(!/CREATE POLICY/i.test(code.tables + code.tick), 'ยังไม่มี policy เปิดอ่าน')
  assert.match(code.tick, /REVOKE ALL ON FUNCTION public\.water_event_tick\(timestamptz\) FROM PUBLIC, anon, authenticated;/)
  assert.match(code.tick, /SECURITY DEFINER\s+SET search_path = pg_catalog, public/)
  const revokeAt = code.tick.indexOf('REVOKE ALL ON public.water_events')
  const fnAt = code.tick.indexOf('CREATE OR REPLACE FUNCTION public.water_event_tick')
  assert.ok(revokeAt > -1 && revokeAt < fnAt, 'ถอนสิทธิ์ตารางก่อนสร้างฟังก์ชัน')
}

// ── 4) cron: นาทีที่ 20 หลัง sync (10) และ notify (15) ──
{
  const minuteOf = (file, name) => Number(read(`supabase/migrations/${file}`).match(new RegExp(`'${name}',\\s*'(\\d+) \\* \\* \\* \\*'`))?.[1])
  const sync = minuteOf('20260918150500_water_situation_cron.sql', 'thaiwater-sync-hourly')
  const alert = minuteOf('20260919100400_water_alert_notify_cron.sql', 'water-alert-notify-hourly')
  const event = Number(tick.match(/'water-event-tick-hourly',\s*'(\d+) \* \* \* \*'/)?.[1])
  assert.ok(Number.isFinite(sync) && Number.isFinite(alert), 'อ่านนาทีของ cron เดิมไม่ได้ — ชื่องานเปลี่ยน?')
  assert.ok(event > alert && alert > sync, `ต้องรันหลัง sync(${sync}) และ notify(${alert}) ได้ ${event}`)
  assert.match(code.tick, /\$cron\$SELECT public\.water_event_tick\(\);\$cron\$/)
  assert.match(code.tick, /cron\.unschedule\('water-event-tick-hourly'\)/, 'apply ซ้ำต้องไม่ซ้อนงาน')
}

// ── 5) ไม่มีข้อมูลบุคคล/พิกัดในตารางเหตุการณ์ (PDPA) ──
{
  const columnNames = code.tables.split('\n')
    .map(line => line.match(/^\s{2}([a-z_0-9]+)\s+(uuid|text|jsonb|numeric|smallint|timestamptz|boolean)\b/)?.[1])
    .filter(Boolean)
  assert.ok(columnNames.length >= 25, `อ่านชื่อคอลัมน์ได้ ${columnNames.length}`)
  for (const name of columnNames) {
    // ชื่อสถานี/ชื่อตำบลเป็นชื่อสถานที่ ไม่ใช่ชื่อบุคคล
    const personal = !['station_name', 'tambon_name'].includes(name)
      && /(name$|phone|tel|id_card|citizen|address|latitude|longitude|lat$|lng$|email|user)/.test(name)
    assert.ok(!personal,
      `คอลัมน์ ${name} ดูเหมือนข้อมูลบุคคล/พิกัด — ตารางเหตุการณ์ห้ามเก็บ`)
  }
  assert.ok(!/auth\.users|profiles/.test(code.tables + code.tick), 'ไม่อ้างตารางผู้ใช้')
}

// ── 6) ข้อความที่ต้องไม่หายจากไฟล์ (เหตุผลที่คนรุ่นหลังต้องอ่าน) ──
{
  assert.match(tables, /ไม่ผูก FK ไป water_station_config/, 'เหตุผลที่สำเนาค่าไม่ผูกกับตารางสถานี')
  assert.match(tick, /ไม่ใช่ค่า 0 และไม่ใช่ "น้ำลดแล้ว"/, 'ค่าที่ขาดไม่นับว่าสงบ')
  assert.match(tick, /อ่างเก็บน้ำ "ไม่" ใช้เปิดเหตุการณ์/)
}

console.log('✅ water-events: ผ่านทุกข้อ')

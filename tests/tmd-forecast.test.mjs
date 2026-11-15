// พยากรณ์อากาศกรมอุตุนิยมวิทยา (NWP) บนหน้าสถานการณ์น้ำ-ฝน — ตรรกะ lib + จุดที่ต้องตรงกับ Edge Function + การ์ดต้องอ้างที่มา
//   node tests/tmd-forecast.test.mjs
// ตรวจ: cond→ข้อความ · ระดับฝนใช้ RAIN_LEVELS เดียวกับหน้าเดิม · null ไม่กลายเป็น 0 · ตัดชั่วโมง/วันที่ผ่านไปแล้ว
//       · ความเก่า 12 ชม. · เกณฑ์ใน tmd-sync ตรงกับ RAIN_LEVELS · การ์ดมีที่มา+ลิงก์กรม ไม่มี iframe/script · ไม่ยิงกรมจากเบราว์เซอร์
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RAIN_LEVELS, RAIN_VERY_HEAVY_MM } from '../src/lib/waterSituation.js'
import { POSTER_BADGE_TAG } from '../src/lib/waterAlertPoster.js'
import {
  SMART_CITY_COLORS, SMART_CITY_LOCAL_WORDS, SMART_CITY_TAG, TMD_CONDITIONS, TMD_SOURCE_DOC_URL, TMD_STALE_HOURS, WIND_LEVELS,
  conditionInfo, dailyRainLevel, dayHeading, dayLabel, daysRangeText, fetchTmdForecast, fetchedAtText, forecastFreshness, formatTemp, gridText,
  hourText, hourlyRainSummary, normalizeForecast, rainLegend, rainText, tempRound, upcomingDays, upcomingHours, windDirection, windKmh, windLevel,
} from '../src/lib/tmdForecast.js'

let n = 0
const ok = label => { n += 1; console.log(`PASS ${label}`) }
const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/\s.*$/gm, '')

// 2569-11-15 10:30 น. (เวลาไทย)
const NOW = Date.parse('2026-11-15T10:30:00+07:00')
const HOUR = 3_600_000

// ── cond ตามตาราง 1–12 ของกรม ──
{
  assert.equal(Object.keys(TMD_CONDITIONS).length, 12)
  const expected = ['ท้องฟ้าแจ่มใส', 'มีเมฆบางส่วน', 'เมฆเป็นส่วนมาก', 'มีเมฆมาก', 'ฝนตกเล็กน้อย', 'ฝนปานกลาง', 'ฝนตกหนัก', 'ฝนฟ้าคะนอง',
    'อากาศหนาวจัด', 'อากาศหนาว', 'อากาศเย็น', 'อากาศร้อนจัด']
  expected.forEach((label, i) => assert.equal(conditionInfo(i + 1).label, label, `cond ${i + 1}`))
  assert.equal(conditionInfo('5').label, 'ฝนตกเล็กน้อย', 'ค่าจาก RPC มาเป็นสตริงได้')
  for (const bad of [0, 13, 2.5, null, undefined, '', 'abc']) assert.equal(conditionInfo(bad), null, `cond ${bad} ต้องไม่เดาข้อความ`)
  ok('cond 1–12 ตรงตารางกรม · ค่านอกตาราง/ว่าง = null ไม่เดา')
}

// ── ระดับฝนรายวันใช้เกณฑ์เดียวกับหน้าเดิม ──
{
  assert.equal(dailyRainLevel(36.3).key, 'heavy')
  assert.equal(dailyRainLevel(35.0).key, 'moderate')
  assert.equal(dailyRainLevel(35.1).key, 'heavy')
  assert.equal(dailyRainLevel(90.1).key, 'veryHeavy')
  assert.equal(dailyRainLevel(0).key, 'none')
  assert.equal(dailyRainLevel(null), null, 'null ไม่ใช่ "ไม่มีฝน"')
  assert.equal(dailyRainLevel(undefined), null)
  assert.equal(dailyRainLevel(-1), null)
  assert.equal(dailyRainLevel(36.3), RAIN_LEVELS[3], 'ต้องเป็นอ็อบเจกต์ RAIN_LEVELS ตัวเดียวกัน ไม่ใช่ชุดซ้ำ')
  const lib = stripComments(read('../src/lib/tmdForecast.js'))
  assert.ok(!/35\.1|90\.1|below:\s*0\.1/.test(lib), 'ห้ามเขียนเกณฑ์ฝนซ้ำใน tmdForecast.js')
  ok('ระดับฝนรายวัน = rainLevel ของ waterSituation.js (ขอบ 35.0/35.1/90.1) · null ไม่เป็นระดับ · ไม่มีเกณฑ์ซ้ำ')
}

// ── null ห้ามกลายเป็น 0 ──
{
  const f = normalizeForecast({
    hourly: [{ time: '2026-11-15T11:00:00+07:00', rain: null, tc: null, rh: null, cond: null }, { time: '2026-11-15T12:00:00+07:00', rain: 0, tc: 30, rh: 60, cond: 1 }],
    daily: [{ time: '2026-11-15T00:00:00+07:00', rain: null, tc_max: null, tc_min: null, cond: null }, { time: '2026-11-16T00:00:00+07:00', rain: 0, tc_max: 31, tc_min: 22, cond: 3 }],
    hourly_fetched_at: '2026-11-15T09:00:00+07:00', daily_fetched_at: null, hourly_grid: { lat: 18.27, lon: 100.3 }, daily_grid: null,
  })
  assert.equal(f.hourly[0].rain, null)
  assert.equal(f.hourly[0].tc, null)
  assert.equal(f.hourly[1].rain, 0)
  assert.equal(f.daily[0].rain, null)
  assert.equal(f.daily[0].tcMax, null)
  assert.equal(f.daily[1].tcMin, 22)
  assert.equal(rainText(null), '–')
  assert.equal(rainText(0), '0')
  assert.equal(formatTemp(null), '–')
  assert.equal(formatTemp(undefined), '–')
  assert.equal(formatTemp(''), '–')
  assert.equal(formatTemp(0), '0°', '0°C จริงต้องไม่หายไป')
  assert.equal(formatTemp(31.48), '31°')
  assert.equal(formatTemp(23.97), '24°')
  const s = hourlyRainSummary(f.hourly)
  assert.equal(s.total, 0)
  assert.equal(s.missing, 1)
  assert.equal(hourlyRainSummary([{ rain: null }, { rain: null }]).total, null, 'ทุกชั่วโมงไม่มีค่า = null ไม่ใช่ 0')
  assert.equal(hourlyRainSummary([]).total, null)
  const withPeak = hourlyRainSummary([{ time: 'a', rain: 0.4 }, { time: 'b', rain: 2.1 }, { time: 'c', rain: null }, { time: 'd', rain: 0.5 }])
  assert.equal(withPeak.total, 3)
  assert.equal(withPeak.peak.time, 'b')
  assert.equal(withPeak.missing, 1)
  assert.equal(hourlyRainSummary([{ time: 'a', rain: 0 }]).peak, null, 'ไม่มีฝนเลย = ไม่มีชั่วโมงที่ตกแรงสุด')
  ok('null ยังเป็น null ทุกชั้น (normalize · ข้อความ · อุณหภูมิ · สรุปรายชั่วโมง) · 0 จริงไม่หาย')
}

// ── normalize: ของเสียไม่ล้ม ──
{
  assert.equal(normalizeForecast(null), null)
  assert.equal(normalizeForecast(undefined), null)
  assert.equal(normalizeForecast('x'), null)
  assert.equal(normalizeForecast({}), null)
  assert.equal(normalizeForecast({ hourly: [], daily: [] }), null)
  assert.equal(normalizeForecast({ hourly: [{ time: 'ไม่ใช่เวลา', rain: 1 }], daily: [{ rain: 1 }] }), null, 'แถวเวลาเสียถูกตัด เหลือศูนย์ = null')
  const sorted = normalizeForecast({ daily: [{ time: '2026-11-17T00:00:00+07:00', rain: 2 }, { time: '2026-11-16T00:00:00+07:00', rain: 1 }] })
  assert.deepEqual(sorted.daily.map(d => d.rain), [1, 2], 'เรียงตามเวลา')
  assert.equal(normalizeForecast({ daily: [{ time: '2026-11-16T00:00:00+07:00', rain: '36.3' }] }).daily[0].rain, 36.3, 'สตริงตัวเลขแปลงได้')
  assert.equal(normalizeForecast({ daily: [{ time: '2026-11-16T00:00:00+07:00' }], hourly_grid: { lat: 'x', lon: 1 } }).hourlyGrid, null)
  ok('normalizeForecast: ว่าง/เสีย = null · เรียงเวลา · สตริงเป็นตัวเลข · กริดเสีย = null')
}

// ── fetchTmdForecast ──
{
  const good = { daily: [{ time: '2026-11-16T00:00:00+07:00', rain: 1, tc_max: 30, tc_min: 20, cond: 2 }] }
  let called = null
  const client = { rpc: async (name, args) => { called = { name, args }; return { data: good, error: null } } }
  const r = await fetchTmdForecast(client, 'muni-1')
  assert.deepEqual(called, { name: 'get_public_tmd_forecast', args: { _municipality_id: 'muni-1' } })
  assert.equal(r.forecast.daily[0].rain, 1)
  assert.equal(r.error, false)
  assert.deepEqual(await fetchTmdForecast({ rpc: async () => ({ data: null, error: null }) }, 'm'), { forecast: null, error: false })
  assert.deepEqual(await fetchTmdForecast({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, 'm'), { forecast: null, error: true })
  assert.deepEqual(await fetchTmdForecast({ rpc: async () => { throw new Error('network') } }, 'm'), { forecast: null, error: true })
  let touched = false
  assert.deepEqual(await fetchTmdForecast({ rpc: async () => { touched = true } }, null), { forecast: null, error: false })
  assert.equal(touched, false, 'ไม่มี อปท. = ไม่ยิง RPC (RPC บังคับระบุ อปท.)')
  ok('fetchTmdForecast: เรียก RPC ถูกชื่อ/พารามิเตอร์ · null/error/โยน = ไม่ล้ม · ไม่มี อปท. ไม่ยิง')
}

// ── ตัดช่วงที่ผ่านไปแล้ว ──
{
  const hourly = [8, 9, 10, 11, 12].map(h => ({ time: `2026-11-15T${String(h).padStart(2, '0')}:00:00+07:00`, rain: h }))
  // ตอนนี้ 10:30 → 08:00 และ 09:00 จบไปแล้ว · 10:00 คือชั่วโมงปัจจุบัน ยังเก็บไว้
  assert.deepEqual(upcomingHours(hourly, NOW).map(h => h.rain), [10, 11, 12])
  assert.deepEqual(upcomingHours(hourly, new Date(NOW)).map(h => h.rain), [10, 11, 12], 'รับ Date ได้')
  assert.deepEqual(upcomingHours(hourly, Date.parse('2026-11-15T11:00:00+07:00')).map(h => h.rain), [11, 12], '11:00 พอดี ชั่วโมง 10 จบแล้ว')
  assert.deepEqual(upcomingHours(hourly, NOW, 2).map(h => h.rain), [10, 11], 'limit')
  assert.deepEqual(upcomingHours(hourly, Date.parse('2026-11-16T00:00:00+07:00')), [], 'ผ่านหมด = ว่าง')
  assert.deepEqual(upcomingHours(undefined, NOW), [])
  const long = Array.from({ length: 60 }, (_, i) => ({ time: new Date(NOW + i * HOUR).toISOString(), rain: 0 }))
  assert.equal(upcomingHours(long, NOW).length, 48, 'ไม่เกิน 48 ชม.')

  const daily = ['14', '15', '16', '17'].map(d => ({ time: `2026-11-${d}T00:00:00+07:00`, rain: Number(d) }))
  assert.deepEqual(upcomingDays(daily, NOW).map(d => d.rain), [15, 16, 17], 'เมื่อวานตัดทิ้ง วันนี้ยังอยู่')
  // 00:30 ไทย = 17:30Z วันก่อน — ต้องตัดสินตามวันไทย ไม่ใช่ UTC
  assert.deepEqual(upcomingDays(daily, Date.parse('2026-11-16T00:30:00+07:00')).map(d => d.rain), [16, 17])
  assert.deepEqual(upcomingDays(daily, Date.parse('2026-11-15T23:59:00+07:00')).map(d => d.rain), [15, 16, 17])
  ok('ตัดชั่วโมงที่จบแล้ว (เก็บชั่วโมงปัจจุบัน) · ไม่เกิน 48 · ตัดวันที่ผ่านแล้วตามวันไทย')
}

// ── ป้ายวัน / เวลา ──
{
  assert.equal(dayLabel('2026-11-15T00:00:00+07:00', NOW), 'วันนี้')
  assert.equal(dayLabel('2026-11-16T00:00:00+07:00', NOW), 'พรุ่งนี้')
  assert.equal(dayLabel('2026-11-18T00:00:00+07:00', NOW), 'วันพุธ 18 พ.ย.')
  assert.equal(dayLabel('ไม่ใช่เวลา', NOW), '')
  assert.equal(hourText('2026-11-15T08:00:00+07:00'), '08:00')
  assert.equal(hourText('2026-11-15T01:00:00Z'), '08:00', 'แสดงเวลาไทยเสมอแม้ส่งมาเป็น UTC')
  assert.equal(fetchedAtText('2026-11-15T09:03:00+07:00', NOW), '09:03 น.')
  assert.equal(fetchedAtText('2026-11-14T22:00:00+07:00', NOW), '14 พ.ย. 22:00 น.')
  assert.equal(fetchedAtText(null, NOW), '')
  assert.equal(gridText({ lat: 18.27, lon: 100.3 }), '18.27, 100.30')
  assert.equal(gridText(null), '')
  ok('ป้ายวัน (วันนี้/พรุ่งนี้/วันพุธ 18 พ.ย.) · เวลาไทย · กริด 2 ตำแหน่ง')
}

// ── ความเก่า 12 ชม. ──
{
  assert.equal(TMD_STALE_HOURS, 12)
  const fresh = { hourlyFetchedAt: new Date(NOW - 2 * HOUR).toISOString(), dailyFetchedAt: new Date(NOW - 2 * HOUR).toISOString() }
  assert.equal(forecastFreshness(fresh, NOW).stale, false)
  const edge = { hourlyFetchedAt: new Date(NOW - 12 * HOUR).toISOString(), dailyFetchedAt: new Date(NOW - 12 * HOUR).toISOString() }
  assert.equal(forecastFreshness(edge, NOW).stale, false, 'ครบ 12 ชม. พอดียังไม่เหลือง (เกินจึงเหลือง)')
  const old = { hourlyFetchedAt: new Date(NOW - 12 * HOUR - 60_000).toISOString(), dailyFetchedAt: new Date(NOW - 12 * HOUR - 60_000).toISOString() }
  assert.equal(forecastFreshness(old, NOW).stale, true)
  const mixed = { hourlyFetchedAt: new Date(NOW - HOUR).toISOString(), dailyFetchedAt: new Date(NOW - 13 * HOUR).toISOString() }
  const m = forecastFreshness(mixed, NOW)
  assert.equal(m.stale, true, 'ชุดใดชุดหนึ่งเก่า = ทั้งการ์ดเหลือง')
  assert.equal(m.fetchedAt, mixed.dailyFetchedAt, 'โชว์เวลาของชุดที่เก่าสุด')
  const onlyOne = { hourlyFetchedAt: new Date(NOW - HOUR).toISOString(), dailyFetchedAt: null }
  assert.equal(forecastFreshness(onlyOne, NOW).stale, false)
  const unknown = forecastFreshness({ hourlyFetchedAt: null, dailyFetchedAt: null }, NOW)
  assert.equal(unknown.stale, true, 'ไม่รู้เวลาดึง = ไม่อ้างว่าเป็นปัจจุบัน')
  assert.equal(unknown.fetchedAt, null)
  ok('ป้ายเหลืองเมื่อเกิน 12 ชม. (ชุดที่เก่าสุดเป็นเกณฑ์) · ไม่รู้เวลา = เหลือง')
}

// ── เกณฑ์ใน tmd-sync ต้องตรงกับ RAIN_LEVELS ──
{
  const src = read('../supabase/functions/tmd-sync/index.ts')
  const heavy = Number(src.match(/const HEAVY_RAIN_MM = ([\d.]+)/)?.[1])
  const veryHeavy = Number(src.match(/const VERY_HEAVY_RAIN_MM = ([\d.]+)/)?.[1])
  // ขอบล่างของระดับ = ขอบบนของระดับก่อนหน้า + 0.1 (กรมระบุทศนิยม 1 ตำแหน่ง)
  const lower = key => {
    const i = RAIN_LEVELS.findIndex(l => l.key === key)
    return Math.round((RAIN_LEVELS[i - 1].upTo + 0.1) * 10) / 10
  }
  assert.ok(Number.isFinite(heavy) && Number.isFinite(veryHeavy), 'อ่านค่าเกณฑ์จาก tmd-sync ไม่ได้ — regex ตกยุค')
  assert.equal(heavy, 35.1)
  assert.equal(veryHeavy, 90.1)
  assert.equal(heavy, lower('heavy'), 'HEAVY_RAIN_MM ใน tmd-sync ไม่ตรงขอบ "ฝนหนัก" ของ RAIN_LEVELS')
  assert.equal(veryHeavy, lower('veryHeavy'), 'VERY_HEAVY_RAIN_MM ใน tmd-sync ไม่ตรงขอบ "ฝนหนักมาก" ของ RAIN_LEVELS')
  assert.equal(veryHeavy, RAIN_VERY_HEAVY_MM, 'ต้องตรง RAIN_VERY_HEAVY_MM (หมุดบนแท่งเทียบฝน)')
  ok('เกณฑ์ฝนหนัก 35.1 / ฝนหนักมาก 90.1 ใน tmd-sync ตรงกับ RAIN_LEVELS และ RAIN_VERY_HEAVY_MM')
}

// ── ช่วงงดส่ง Telegram 22:00–05:59 น. (เจ้าของระบบเลือก 2569-11-15) ──
// cron 20 */3 * * * (UTC) = 01:20 04:20 07:20 … 22:20 น. ตามเวลาไทย ⇒ ต้องงด 22:20 / 01:20 / 04:20 ส่งได้ 07:20 ถึง 19:20
{
  const src = read('../supabase/functions/tmd-sync/index.ts')
  const from = Number(src.match(/const QUIET_FROM_HOUR = (\d+)/)?.[1])
  const until = Number(src.match(/const QUIET_UNTIL_HOUR = (\d+)/)?.[1])
  assert.ok(Number.isFinite(from) && Number.isFinite(until), 'อ่านช่วงงดส่งจาก tmd-sync ไม่ได้ — regex ตกยุค')
  assert.equal(from, 22)
  assert.equal(until, 6)
  const fn = src.match(/function inQuietHours\(hour: number\): boolean \{\s*return ([^\r\n]+)\r?\n/)?.[1]
  assert.ok(fn, 'ไม่พบ inQuietHours ใน tmd-sync')
  const inQuietHours = new Function('hour', 'QUIET_FROM_HOUR', 'QUIET_UNTIL_HOUR', `return ${fn}`)
  const cronHoursTh = [1, 4, 7, 10, 13, 16, 19, 22]
  const quietRuns = cronHoursTh.filter(h => inQuietHours(h, from, until))
  assert.deepEqual(quietRuns, [1, 4, 22], 'รอบที่งดส่งต้องเป็น 22:20 / 01:20 / 04:20 น.')
  for (const h of [5, 23, 0]) assert.equal(inQuietHours(h, from, until), true, `${h} น. ต้องอยู่ในช่วงงดส่ง`)
  for (const h of [6, 12, 21]) assert.equal(inQuietHours(h, from, until), false, `${h} น. ต้องส่งได้`)
  assert.ok(/const quiet = !isTest && inQuietHours\(now\.hour\)/.test(src), 'ช่วงงดส่งต้องใช้เวลาไทย (now.hour) และโหมดทดสอบไม่ติด')
  assert.ok(/if \(BOT_TOKEN && !quiet\)/.test(src), 'ช่วงงดส่งต้องกันทั้งบล็อกแจ้งเตือน (ไม่ claim คีย์ ไม่งั้นรอบเช้าไม่ส่ง)')
  ok('งดส่ง Telegram 22:00–05:59 น. — รอบ cron ที่ส่งได้คือ 07:20 ถึง 19:20 น. · โหมดทดสอบไม่ติด')
}

// ── การ์ด: ที่มา · ไม่ฝังภายนอก · ไม่ยิงกรมจากเบราว์เซอร์ ──
{
  const card = read('../src/components/water/TmdForecastCard.jsx')
  const lib = read('../src/lib/tmdForecast.js')
  const page = read('../src/pages/WaterSituationPage.jsx')
  assert.equal(TMD_SOURCE_DOC_URL, 'https://data.tmd.go.th/nwpapi/doc/')
  assert.ok(card.includes('TMD_SOURCE_NAME') && lib.includes("TMD_SOURCE_NAME = 'กรมอุตุนิยมวิทยา'"), 'การ์ดต้องแสดงชื่อ กรมอุตุนิยมวิทยา')
  assert.ok(lib.includes("TMD_SOURCE_TEXT = 'ผลพยากรณ์จากแบบจำลองคอมพิวเตอร์ (NWP)'"))
  assert.ok(card.includes('data-tmd-source') && card.includes('ที่มา:'), 'ต้องมีกล่องที่มา')
  assert.ok(/href=\{TMD_SOURCE_DOC_URL\}[^>]*target="_blank"[^>]*rel="noopener noreferrer"/s.test(card), 'ลิงก์เอกสารกรมต้องเปิดแท็บใหม่ + noopener noreferrer')
  assert.ok(card.includes('data.tmd.go.th/nwpapi/doc'), 'ลิงก์ต้องเห็นชื่อโฮสต์ของกรม')
  assert.ok(card.includes('ดึงข้อมูลล่าสุด') && card.includes('ณ จุดกริด'), 'ต้องบอกเวลาที่ดึงและจุดกริด')
  assert.ok(card.includes('พยากรณ์อาจคลาดเคลื่อน') && card.includes('ไม่ใช่ประกาศเตือนภัยของ'), 'ต้องกำกับว่าไม่ใช่ประกาศเตือนภัย')
  assert.ok(card.includes('พยากรณ์ชุดนี้ดึงเมื่อ') && card.includes('อาจไม่เป็นปัจจุบัน'), 'ต้องมีป้ายเหลืองความเก่า')
  assert.ok(card.includes('คาดหมายสภาวะอากาศ 7 วันข้างหน้า'))
  assert.ok(!/<iframe|<script|windy/i.test(card), 'ห้ามฝังตัวเล่นหรือสคริปต์ภายนอกในการ์ด')
  assert.ok(!/<iframe|<script|windy/i.test(page), 'หน้าหลักยังต้องไม่มี iframe/script')
  for (const [name, text] of [['การ์ด', card], ['lib', lib]]) {
    const code = stripComments(text)
    assert.ok(!/\bfetch\(|XMLHttpRequest|nwpapi\/v1/.test(code), `${name} ต้องไม่ยิงไปกรมจากเบราว์เซอร์ (อ่านผ่าน RPC เท่านั้น)`)
    assert.ok(!/TMD_NWP_TOKEN|Bearer/i.test(code), `${name} ต้องไม่มี token ของกรม`)
  }
  assert.ok(lib.includes("'get_public_tmd_forecast'") && lib.includes('_municipality_id'), 'ต้องอ่านผ่าน RPC get_public_tmd_forecast')
  // การ์ดไม่ฝัง URL ตรงๆ — ลิงก์ภายนอกมาจาก TMD_SOURCE_DOC_URL ตัวเดียว (โฮสต์ของกรม)
  assert.deepEqual([...stripComments(card).matchAll(/https?:\/\/[^\s'"`)}]+/g)].map(m => m[0]), [])
  assert.equal(new URL(TMD_SOURCE_DOC_URL).hostname, 'data.tmd.go.th')
  ok('การ์ดอ้างที่มากรมอุตุฯ + ลิงก์เอกสาร + เวลาดึง + จุดกริด + คำกำกับ · ไม่มี iframe/script · ไม่ยิงกรมจากเบราว์เซอร์')
}

// ── ลม: แปลงหน่วย · ทิศ · ระดับตามขอบ · null ──
{
  assert.equal(windKmh(2.8), 10, '2.8 m/s × 3.6 = 10.08 → 10')
  assert.equal(windKmh(1.39), 5)
  assert.equal(windKmh(0), 0, 'ลมสงบ 0 m/s เป็น 0 จริง')
  assert.equal(windKmh('5'), 18, 'สตริงจาก RPC ได้')
  assert.equal(windKmh(null), null)
  assert.equal(windKmh(undefined), null)
  assert.equal(windKmh(''), null)
  assert.equal(windKmh(-1), null)

  const key = kmh => windLevel(kmh)?.key ?? null
  // ขอบบนรวม: ภาพของกรมลง 10 km/h สีเขียว (ลมอ่อน) และ 11 km/h สีเหลือง (ลมเอื่อย)
  assert.deepEqual([0, 5, 5.5, 10, 11, 20, 21, 30, 31, 90].map(key),
    ['calm', 'calm', 'light', 'light', 'breeze', 'breeze', 'moderate', 'moderate', 'strong', 'strong'])
  assert.equal(windLevel(null), null)
  assert.equal(windLevel(undefined), null)
  assert.deepEqual(WIND_LEVELS.map(l => l.label), ['ลมเบา', 'ลมอ่อน', 'ลมเอื่อย', 'ลมปานกลาง', 'ลมแรง'])
  assert.deepEqual(WIND_LEVELS.map(l => l.upTo), [5, 10, 20, 30, Infinity])
  assert.equal(windLevel(windKmh(8 / 3.6)).key, 'light')

  // ทิศ = "พัดมาจาก" · ลูกศรชี้ไปทางตรงข้าม (+180)
  assert.deepEqual(windDirection(0), { from: 'เหนือ', toDeg: 180 })
  assert.deepEqual(windDirection(45), { from: 'ตะวันออกเฉียงเหนือ', toDeg: 225 }, 'ลมตะวันออกเฉียงเหนือ → ลูกศรชี้ลงซ้าย (ตะวันตกเฉียงใต้) เหมือนภาพกรม')
  assert.deepEqual(windDirection(90), { from: 'ตะวันออก', toDeg: 270 })
  assert.deepEqual(windDirection(180), { from: 'ใต้', toDeg: 0 })
  assert.deepEqual(windDirection(225), { from: 'ตะวันตกเฉียงใต้', toDeg: 45 })
  assert.deepEqual(windDirection(270), { from: 'ตะวันตก', toDeg: 90 })
  assert.deepEqual(windDirection(315), { from: 'ตะวันตกเฉียงเหนือ', toDeg: 135 })
  assert.equal(windDirection(360).from, 'เหนือ', '360° = เหนือ')
  assert.equal(windDirection(22).from, 'เหนือ')
  assert.equal(windDirection(23).from, 'ตะวันออกเฉียงเหนือ', 'ขอบ 22.5° ปัดขึ้น')
  assert.equal(windDirection(337).from, 'ตะวันตกเฉียงเหนือ')
  assert.equal(windDirection(338).from, 'เหนือ')
  assert.equal(windDirection(null), null, 'ไม่มีทิศ = null ห้ามเดาเป็นเหนือ')
  assert.equal(windDirection(undefined), null)
  assert.equal(windDirection(''), null)
  assert.equal(windDirection(400), null)
  assert.equal(windDirection(-5), null)

  const f = normalizeForecast({ daily: [
    { time: '2026-11-16T00:00:00+07:00', rain: 1, tc_max: 30, tc_min: 20, cond: 2, ws10m: 3.5, wd10m: 45 },
    { time: '2026-11-17T00:00:00+07:00', rain: 1, tc_max: 30, tc_min: 20, cond: 2, ws10m: null, wd10m: null },
    { time: '2026-11-18T00:00:00+07:00', rain: 1, tc_max: 30, tc_min: 20, cond: 2 },
    { time: '2026-11-19T00:00:00+07:00', rain: 1, ws10m: 0, wd10m: 0 },
  ] })
  assert.equal(f.daily[0].windMs, 3.5)
  assert.equal(f.daily[0].windDir, 45)
  assert.equal(f.daily[1].windMs, null)
  assert.equal(f.daily[1].windDir, null)
  assert.equal(f.daily[2].windMs, null, 'RPC รุ่นเก่าไม่มีช่องลม = null ไม่พัง')
  assert.equal(f.daily[3].windMs, 0, '0 m/s จริงต้องไม่หาย')
  assert.equal(f.daily[3].windDir, 0, '0° จริงต้องไม่หาย')
  assert.equal(tempRound(31.48), 31)
  assert.equal(tempRound(23.97), 24)
  assert.equal(tempRound(0), 0)
  assert.equal(tempRound(null), null)
  assert.equal(tempRound(undefined), null)
  ok('ลม: m/s→km/h · ทิศ 8 ทิศ + ลูกศร +180° · ระดับตามขอบ (10 = ลมอ่อน, 11 = ลมเอื่อย) · null/0 แยกกัน')
}

// ── หัวคอลัมน์วัน / ช่วงวันที่ / คำอธิบายระดับฝน ──
{
  assert.deepEqual(dayHeading('2026-11-15T00:00:00+07:00', NOW), { title: 'วันนี้', date: '15 พ.ย.', isToday: true })
  assert.deepEqual(dayHeading('2026-11-16T00:00:00+07:00', NOW), { title: 'พรุ่งนี้', date: '16 พ.ย.', isToday: false })
  assert.deepEqual(dayHeading('2026-11-17T00:00:00+07:00', NOW), { title: 'วันอังคาร', date: '17 พ.ย.', isToday: false })
  assert.equal(dayHeading('2026-11-18T00:00:00+07:00', NOW).title, 'วันพุธ')
  assert.equal(dayHeading('2026-11-19T00:00:00+07:00', NOW).title, 'วันพฤหัสบดี')
  assert.equal(dayHeading('2026-11-21T00:00:00+07:00', NOW).title, 'วันเสาร์')
  assert.equal(dayHeading('2026-11-16T00:00:00+07:00', Date.parse('2026-11-15T23:50:00+07:00')).title, 'พรุ่งนี้', 'ตัดสินตามวันไทย')
  assert.equal(dayHeading('ไม่ใช่เวลา', NOW), null)

  const day = d => ({ time: `${d}T00:00:00+07:00` })
  assert.equal(daysRangeText([day('2026-11-15'), day('2026-11-18'), day('2026-11-21')]), '15 – 21 พ.ย. 2569', 'ปี พ.ศ.')
  assert.equal(daysRangeText([day('2026-11-29'), day('2026-12-05')]), '29 พ.ย. – 5 ธ.ค. 2569')
  assert.equal(daysRangeText([day('2026-12-28'), day('2027-01-03')]), '28 ธ.ค. 2569 – 3 ม.ค. 2570')
  assert.equal(daysRangeText([day('2026-11-15')]), '15 พ.ย. 2569')
  assert.equal(daysRangeText([]), '')

  const legend = rainLegend()
  assert.deepEqual(legend.map(l => l.level.label), ['ไม่มีฝน', 'ฝนเล็กน้อย', 'ฝนปานกลาง', 'ฝนหนัก', 'ฝนหนักมาก'], 'คำง่ายตามที่เจ้าของสั่ง')
  assert.deepEqual(legend.map(l => l.range), ['ต่ำกว่า 0.1 มม.', '0.1–10 มม.', '10.1–35 มม.', '35.1–90 มม.', '90.1 มม. ขึ้นไป'], 'ช่วงต้องตรงเกณฑ์กรมใน RAIN_LEVELS')
  legend.forEach((l, i) => assert.equal(l.level, RAIN_LEVELS[i], 'ต้องเป็นอ็อบเจกต์ RAIN_LEVELS ตัวเดียวกัน'))
  ok('หัวคอลัมน์ วันนี้/พรุ่งนี้/ชื่อวันเต็ม + วันที่สั้น · ช่วงวันที่ พ.ศ. · คำอธิบายระดับฝนคำนวณจาก RAIN_LEVELS')
}

// ── ตาราง: ครบแถว · แถวฝนใช้คำง่าย · แบรนด์ 2 ข้อความ · ไม่ใช้โลโก้กรม · มือถือเลื่อนได้ ──
{
  const card = read('../src/components/water/TmdForecastCard.jsx')
  const code = stripComments(card)
  for (const row of ['cond', 'tmax', 'tmin', 'wind', 'rain']) assert.ok(card.includes(`data-tmd-row="${row}"`), `ต้องมีแถว ${row}`)
  for (const text of ['สภาพอากาศ', 'อุณหภูมิสูงสุด', 'อุณหภูมิต่ำสุด', 'ลมกระโชก', 'แรงสุดของวัน', 'ฝน']) assert.ok(card.includes(text), `ต้องมีหัวแถว ${text}`)
  assert.ok(card.includes('data-tmd-legend') && card.includes('rainLegend()') && card.includes('data-tmd-wind-note'), 'ต้องมีแถบคำอธิบายระดับฝน + คำอธิบายลมกระโชก')
  // ลมรายวันของ NWP = ลมแรงสุด (กระโชก) — ห้ามจัดระดับ/ลงสีด้วย WIND_LEVELS (เกณฑ์ลมปกติ) ไม่งั้นขึ้น "ลมแรง" แดงทุกวัน
  // (เจ้าของระบบเลือก 2569-11-15 · เปิดระดับกลับได้เมื่อใช้ลมรายจังหวัดของกรม ซึ่งเป็นลมปกติ)
  const windCell = card.slice(card.indexOf('function WindCell'), card.indexOf('function RainCell'))
  assert.ok(!/windLevel\(|WIND_LEVELS|level\.chip|level\.label/.test(stripComments(windCell)), 'แถวลมกระโชกห้ามใช้ระดับ/สีของลมปกติ')
  assert.ok(!/WIND_LEVELS/.test(code), 'การ์ดห้ามแสดงแถบระดับลมปกติขณะใช้ค่าลมกระโชก')
  assert.ok(windCell.includes('data-wind-gust') && windCell.includes('bg-slate-100'), 'ป้ายลมกระโชกเป็นสีกลาง')
  // แถวฝนแสดง "คำ" จาก RAIN_LEVELS (level.label) ไม่ใช่ % — เราไม่มีข้อมูลโอกาสเกิดฝน ห้ามเดา
  const rainCell = card.slice(card.indexOf('function RainCell'), card.indexOf('function Legend'))
  assert.ok(rainCell.includes('{level.label}') && rainCell.includes('{rainText(day.rain)} มม.'), 'แถวฝน = คำระดับฝน + ตัวเลข มม. ตัวเล็ก')
  assert.ok(!/โอกาสเกิดฝน|โอกาสฝน/.test(code), 'ห้ามมี "โอกาสเกิดฝน"')
  assert.ok(!/>\s*\{[^}]+\}\s*%/.test(code) && !/%\s*ของพื้นที่/.test(code), 'ห้ามแสดงตัวเลขเปอร์เซ็นต์ (ไม่มีข้อมูลโอกาสเกิดฝน)')
  // ฝั่งป้ายวัน/ลม/ฝน ใช้ฟังก์ชันของ lib
  for (const fn of ['dayHeading(', 'windKmh(', 'windDirection(', 'dailyRainLevel(', 'tempRound(']) assert.ok(code.includes(fn), `การ์ดต้องใช้ ${fn}`)
  assert.ok(/transform: `rotate\(\$\{dir\.toDeg\}deg\)`/.test(code), 'ลูกศรลมหมุนตาม toDeg (พัดมาจาก + 180)')

  // แบรนด์ (เจ้าของสั่ง 2569-11-15)
  assert.equal(SMART_CITY_TAG, 'มุ่งสู่เมืองอัจฉริยะ (Smart City)')
  assert.equal(SMART_CITY_TAG, POSTER_BADGE_TAG, 'ต้องเป็นค่าเดียวกับป้ายหน่วยงานบนภาพแชร์ (import มา ไม่พิมพ์ซ้ำ)')
  assert.equal(SMART_CITY_LOCAL_WORDS.map(([w]) => w).join(' '), 'Smart City Local')
  assert.ok(card.includes('data-smart-city-tag') && card.includes('{SMART_CITY_TAG}'), 'แคปซูลคำขวัญในแถบหัว')
  assert.ok(card.includes('data-smart-city-local') && card.includes('SMART_CITY_LOCAL_WORDS'), 'คำ Smart City Local ในแถบท้าย')
  const header = card.slice(card.indexOf('function Header'), card.indexOf('function DayTable'))
  const source = card.slice(card.indexOf('function SourceBox'))
  assert.ok(header.includes('SMART_CITY_TAG') && !header.includes('SMART_CITY_LOCAL_WORDS'), 'แคปซูลอยู่แถบหัว')
  assert.ok(source.includes('<SmartCityLocalMark />') && source.includes('TMD_SOURCE_DOC_URL'), 'Smart City Local อยู่แถบท้ายคู่กับที่มา')
  // โลโก้ตัวหนังสือแบบเดิม (complaintNewsImage.js) — สีต้องตรงต้นฉบับ · ไม่ใช้แบบ "ไม่มีพื้นหลังบรรทัดเดียว" ของ waterAlertPosterImage.js
  const original = read('../src/lib/complaintNewsImage.js')
  const block = original.slice(original.indexOf('function smartCityMarkSvg'), original.indexOf('/** การ์ดมุมมน'))
  const { blue, orange, shadow, stroke, wifi, pin } = SMART_CITY_COLORS
  for (const color of [...blue, ...orange, shadow, stroke, wifi, pin]) assert.ok(block.includes(color), `สี ${color} ไม่พบใน smartCityMarkSvg ของต้นฉบับ`)
  assert.ok(block.includes(`id="news-sc-blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${blue[0]}"/><stop offset="1" stop-color="${blue[1]}"/>`), 'ไล่น้ำเงินตรงต้นฉบับ')
  assert.ok(block.includes(`<stop offset="0" stop-color="${orange[0]}"/><stop offset="0.55" stop-color="${orange[1]}"/><stop offset="1" stop-color="${orange[2]}"/>`), 'ไล่ส้มทองตรงต้นฉบับ')
  assert.ok(block.includes('skewX(-11)') && card.includes('skewX(-11)'), 'เอียง -11° เหมือนต้นฉบับ')
  const mark = card.slice(card.indexOf('function SmartCityLocalMark'), card.indexOf('function SourceBox'))
  assert.deepEqual(SMART_CITY_LOCAL_WORDS.map(([w, t]) => `${w}:${t}`), ['Smart:blue', 'City:orange', 'Local:blue'], 'Smart/Local น้ำเงิน City ส้ม')
  assert.ok(mark.includes('url(#tmd-sc-${w.fill})') && mark.includes('id="tmd-sc-blue"') && mark.includes('id="tmd-sc-orange"'), 'แต่ละคำใช้ไล่สีตามโทนของคำ')
  assert.ok(mark.includes('data-sc-wifi') && mark.includes('data-sc-pin') && mark.includes('strokeWidth="7"') && mark.includes('c.pin') && mark.includes('c.wifi'), 'มี wifi ซ้าย + ขอบขาวหนา + หมุดแดงขวา')
  assert.ok(mark.includes('textLength') && !/-webkit-text-stroke|WebkitTextStroke|filter=/.test(mark), 'ใช้ SVG text + textLength ไม่พึ่ง -webkit-text-stroke/filter (Safari เหมือน Chrome)')
  assert.ok(!/waterAlertPosterImage/.test(card), 'ไม่ใช้แบบบรรทัดเดียวไม่มีพื้นหลังของ waterAlertPosterImage.js')
  assert.ok(source.includes('bg-slate-800') || card.includes('bg-slate-800 px-4 py-2.5'), 'แถบท้ายพื้นเข้มรองรับโลโก้ตามภาพตัวอย่าง')
  assert.ok(!read('../src/lib/tmdForecast.js').includes("'มุ่งสู่เมืองอัจฉริยะ"), 'คำขวัญต้องมาจาก POSTER_BADGE_TAG ไม่พิมพ์ซ้ำ')

  // ห้ามโลโก้กรมอุตุฯ/Digital Platform: รูปเดียวในการ์ดคือตราของ อปท. (logoUrl) · ไม่มีไฟล์ภาพ/URL ของกรม
  const imgs = [...code.matchAll(/<img\b[^>]*>/g)].map(m => m[0])
  assert.equal(imgs.length, 1)
  assert.ok(/src=\{logoUrl\}/.test(imgs[0]), 'รูปเดียวคือโลโก้ อปท. จาก tenant.logo_url')
  assert.ok(!/<svg[^>]*\b(TMD|Digital)/i.test(code) && !/Digital\s*Platform|1182|tmd\.go\.th\/[^"' ]*\.(png|jpe?g|svg|webp)|import\s+.*\.(png|jpe?g|svg|webp)/i.test(code), 'ห้ามมีโลโก้/ตรา/Digital Platform/เบอร์ 1182 ของกรม')
  assert.ok(/logoUrl=\{tenant\?\.logo_url\}/.test(read('../src/pages/WaterSituationPage.jsx')), 'หน้าส่ง tenant.logo_url เข้าการ์ด')

  // มือถือ: เลื่อนแนวนอนในกรอบตาราง · ชื่อแถวปักซ้าย · มีคำบอก · PC เห็นครบ ไม่เลื่อน
  assert.ok(card.includes('overflow-x-auto') && card.includes('sticky left-0') && card.includes('เลื่อนดูวันถัดไป'), 'ตารางเลื่อนได้ + คอลัมน์ชื่อแถวปักซ้าย + คำบอก')
  assert.ok(card.includes('min-w-[44rem]') && !/\bmd:(min-w-0|hidden)/.test(code), 'ความกว้างขั้นต่ำของตารางตายตัว — คำบอกเลื่อนตัดสินจากกรอบจริง ไม่ใช่ breakpoint ของหน้าจอ (แท็บเล็ตที่มีเมนูข้างกรอบแคบ)')
  assert.ok(card.includes('el.scrollWidth > el.clientWidth + 1'), 'คำบอกเลื่อนขึ้นเฉพาะตอนล้นกรอบจริง และหายเมื่อเลื่อนสุด')
  assert.ok(card.includes('tabIndex={0}') && card.includes('role="region"'), 'คีย์บอร์ดเลื่อนตารางได้')
  // ฝนรายชั่วโมงอยู่ในส่วนพับ ไม่ได้ลบ
  const hourly = card.slice(card.indexOf('function HourlyStrip'), card.indexOf('function HourBar'))
  assert.ok(hourly.includes('<details data-tmd-hourly') && hourly.includes('ดูฝนรายชั่วโมง'), 'ฝนรายชั่วโมงเป็น <details>')
  // ขนาดตัวอักษรไม่ต่ำกว่า 12px: ห้ามมี text-[10px]/text-[11px]
  assert.ok(!/text-\[(?:[0-9]|1[01])px\]/.test(card), 'ห้ามตัวอักษรเล็กกว่า 12px')
  ok('ตารางครบ 5 แถว + แถบอธิบาย · ฝนเป็นคำ ไม่มี % · ลูกศรลมหมุนตามทิศ · แบรนด์ 2 ข้อความ · ไม่มีโลโก้กรม · มือถือเลื่อนได้ · ฝนรายชั่วโมงพับ')
}

// ── จุดต่อในหน้า ──
{
  const page = read('../src/pages/WaterSituationPage.jsx')
  assert.ok(page.includes("import TmdForecastCard from '../components/water/TmdForecastCard'"))
  assert.ok(/<TmdForecastCard key=\{tenantId\} tenantId=\{tenantId\}/.test(page), 'ต้องวางการ์ดในหน้า และ key ตาม อปท.')
  assert.ok(page.indexOf('<TmdForecastCard') > page.indexOf('<HydroHourlyPanel') && page.indexOf('<TmdForecastCard') < page.indexOf('<RainSection'), 'การ์ดอยู่ในแท็บสถานการณ์ ก่อนส่วนฝน')
  const card = read('../src/components/water/TmdForecastCard.jsx')
  assert.ok(/if \(!forecast\) return null/.test(card), 'ไม่มีข้อมูล = ไม่แสดงการ์ด')
  assert.ok(/error && prev\.tenantId === tenantId \? prev/.test(card), 'โหลดพลาดแต่เคยได้ของ อปท. เดิม = คงของเดิม')
  ok('วางการ์ดในแท็บสถานการณ์ก่อนส่วนฝน · ไม่มีข้อมูล = ไม่แสดง · โหลดพลาด = คงของเดิม')
}

console.log(`\n${n} ชุดผ่าน`)

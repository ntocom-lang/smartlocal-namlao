// ป้ายสรุปสถานการณ์ใต้หัวหน้า /water-situation (เจ้าของระบบอนุมัติ 2569-11-15)
// 1) statusVerdict — คำสรุปจาก selectStatus ตัวเดียวกับภาพสถานะ · 2) nextHeavyRainDay — บรรทัดพยากรณ์ฝนหนักล่วงหน้า
// 3) จุดต่อในหน้า: ปุ่มแชร์ภาพเหลือปุ่มเดียว ชุดภาพเดิมท้ายหน้าเลิกใช้ · พยากรณ์โหลดครั้งเดียว
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAlerts } from '../src/lib/waterSituation.js'
import { selectStatus, statusVerdict } from '../src/lib/waterAlertPoster.js'
import { TMD_OUTLOOK_DAYS, nextHeavyRainDay } from '../src/lib/tmdForecast.js'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\s*\}/g, '')
let n = 0
const ok = msg => { n += 1; console.log(`ok ${n} - ${msg}`) }

const NOW = Date.parse('2026-11-15T03:00:00Z') // 10:00 น. เวลาไทย
const FRESH = '2026-11-15T02:30:00Z'
const DAM_AT = '2026-11-14T17:00:00Z'
const base = { amphoe_name: 'ร้องกวาง', province_name: 'แพร่', tambon_name: 'น้ำเลา', river_name: null, is_primary: false }
const dam = (pct, extra = {}) => ({ ...base, station_type: 'dam', station_code: '305', station_name: 'อ่างเก็บน้ำแม่คำปอง', distance_km: 3.6, is_primary: true, recorded_at: DAM_AT, storage_percent: pct, ...extra })
const rain = (mm, extra = {}) => ({ ...base, station_type: 'rain', station_code: 'R1', station_name: 'บ้านบุญแจ่ม', distance_km: 2.6, is_primary: true, recorded_at: FRESH, rain_24h_mm: mm, ...extra })
const level = (diff, extra = {}) => ({ ...base, station_type: 'waterlevel', station_code: 'W1', station_name: 'บ้านน้ำปุ๊', distance_km: 6, recorded_at: FRESH, bank_diff_m: diff, ...extra })
const input = extra => ({ rain: [rain(2)], ews: [], levels: [], dams: [dam(72)], warnings: [], now: NOW, ...extra })
const verdict = extra => { const i = input(extra); return statusVerdict(selectStatus(i), NOW) }
const BANNED = /แล้ง/

// ── 1) คำสรุปทุกสถานะ ──
{
  const normal = verdict({})
  assert.equal(normal.state, 'normal')
  assert.equal(normal.label, 'ปกติ')
  assert.match(normal.detail, /ยังไม่ถึงเกณฑ์เฝ้าระวัง/)

  const watchRain = verdict({ rain: [rain(50.4)] })
  assert.equal(watchRain.label, 'เฝ้าระวัง')
  assert.equal(watchRain.detail, 'ฝนหนัก 50.4 มม. ใน 24 ชม. ที่สถานีบ้านบุญแจ่ม (เกณฑ์ฝนหนัก 35.1–90 มม.)')
  // ฝนหนัก 35.1–90 ไม่ทำให้แถบแจ้งเตือนขึ้น — ถ้าขึ้น ป้ายจะถูกซ่อนตรงสถานะที่มีประโยชน์ที่สุด
  assert.equal(buildAlerts(input({ rain: [rain(50.4)] })).any, false)

  const watchLevel = verdict({ levels: [level(0.62)] })
  assert.equal(watchLevel.label, 'เฝ้าระวัง')
  assert.match(watchLevel.detail, /^ระดับน้ำต่ำกว่าตลิ่ง 0\.62 ม\. ที่สถานีบ้านน้ำปุ๊/)
  assert.equal(buildAlerts(input({ levels: [level(0.62)] })).any, false)

  const low = verdict({ dams: [dam(42.35)] })
  assert.equal(low.label, 'น้ำน้อย')
  assert.equal(low.critical, false)
  assert.match(low.detail, /^อ่างแม่คำปอง มีน้ำ 42\.4% ของความจุ/)
  const critical = verdict({ dams: [dam(30)] })
  assert.equal(critical.label, 'น้ำน้อยวิกฤติ')
  assert.equal(critical.critical, true)

  const nodata = verdict({ rain: [rain(2, { recorded_at: '2026-11-14T20:00:00Z' })] })
  assert.equal(nodata.label, 'ข้อมูลไม่ครบ')
  assert.match(nodata.detail, /^ยังสรุปไม่ได้ เพราะไม่มีค่าล่าสุดของฝน/)

  // แจ้งเตือน (ฝนหนักมาก) = ไม่มีคำสรุป (แถบแจ้งเตือนทำหน้าที่แทน)
  assert.equal(verdict({ rain: [rain(90.1)] }), null)
  assert.equal(statusVerdict(null, NOW), null)

  for (const v of [normal, watchRain, watchLevel, low, critical, nodata]) assert.ok(!BANNED.test(v.label + v.detail), `ห้ามคำว่าแล้ง: ${v.detail}`)
  ok('คำสรุป ปกติ/เฝ้าระวัง (ฝน/ระดับน้ำ)/น้ำน้อย/วิกฤติ/ข้อมูลไม่ครบ · แจ้งเตือน = null · ไม่มีคำว่าแล้ง')
}

// ── 2) พยากรณ์ฝนหนักล่วงหน้า ──
{
  const day = (iso, mm) => ({ time: iso, rain: mm })
  const fc = (daily, fetched = '2026-11-15T01:00:00Z') => ({ hourly: [], daily, dailyFetchedAt: fetched, hourlyFetchedAt: fetched })
  // วันในพยากรณ์ของกรมเป็นเที่ยงคืนเวลาไทย (17:00Z ของวันก่อน)
  const D15 = '2026-11-14T17:00:00Z', D16 = '2026-11-15T17:00:00Z', D17 = '2026-11-16T17:00:00Z', D18 = '2026-11-17T17:00:00Z'
  assert.equal(TMD_OUTLOOK_DAYS, 3)
  assert.equal(nextHeavyRainDay(null, NOW), null)
  // 35.0 = ปานกลาง ไม่ขึ้น · 35.1 = หนัก
  assert.equal(nextHeavyRainDay(fc([day(D15, 35), day(D16, 2)]), NOW), null)
  const hit = nextHeavyRainDay(fc([day(D15, 3), day(D16, 36.3)]), NOW)
  assert.equal(hit.level.key, 'heavy')
  assert.equal(hit.mm, 36.3)
  assert.equal(hit.when, 'พรุ่งนี้ (16 พ.ย.)')
  assert.equal(nextHeavyRainDay(fc([day(D15, 95)]), NOW).level.key, 'veryHeavy')
  assert.equal(nextHeavyRainDay(fc([day(D15, 95)]), NOW).when, 'วันนี้ (15 พ.ย.)')
  // วันที่ 3 (มะรืน) ยังอยู่ในช่วง ชื่อวันเต็ม · วันที่ 4 นอกช่วง (ตรงกับ tmd-sync ALERT_DAYS_AHEAD = 2)
  assert.equal(nextHeavyRainDay(fc([day(D17, 40)]), NOW).when, 'วันอังคาร 17 พ.ย.')
  assert.equal(nextHeavyRainDay(fc([day(D18, 80)]), NOW), null)
  // วันที่ผ่านไปแล้วไม่นับ
  assert.equal(nextHeavyRainDay(fc([day('2026-11-13T17:00:00Z', 60)]), NOW), null)
  // ชุดรายวันเก่าเกิน 12 ชม. หรือไม่รู้เวลาดึง = ไม่พูดถึง
  assert.equal(nextHeavyRainDay(fc([day(D16, 50)], '2026-11-14T10:00:00Z'), NOW), null)
  assert.equal(nextHeavyRainDay({ daily: [day(D16, 50)] }, NOW), null)
  const sync = read('../supabase/functions/tmd-sync/index.ts')
  assert.ok(/const ALERT_DAYS_AHEAD = 2\b/.test(sync), 'ช่วงวันของหน้าต้องเท่ากับช่วงแจ้ง Telegram (วันนี้ + 2)')
  ok('พยากรณ์ฝนหนัก: เกณฑ์ 35.1 · วันนี้/พรุ่งนี้/ชื่อวัน · ช่วง 3 วันเท่า Telegram · วันผ่านไปแล้ว/ชุดเก่า = ไม่ขึ้น')
}

// ── 3) จุดต่อในหน้า + ป้าย ──
{
  const page = read('../src/pages/WaterSituationPage.jsx')
  const card = read('../src/components/water/WaterVerdictCard.jsx')
  const code = stripComments(page)
  assert.ok(!/WaterSituationShare|WaterShareCards|StatusShareRow/.test(code), 'ชุดภาพเดิมท้ายหน้า + ปุ่มแชร์แยก ต้องเลิกใช้')
  assert.equal((code.match(/<WaterVerdictCard\b/g) ?? []).length, 1)
  assert.ok(/announced=\{Boolean\(announcement\)\}/.test(code), 'มีประกาศ อปท. = ไม่ขึ้นคำสรุป (ประกาศชนะเสมอ)')
  assert.ok(code.indexOf('<WaterVerdictCard') > code.indexOf('<AlertBanner') && code.indexOf('<WaterVerdictCard') < code.indexOf('<HeroStats'), 'ป้ายอยู่ใต้แถบเตือน เหนือตัวเลขภาพรวม')
  assert.equal((code.match(/useTmdForecast\(/g) ?? []).length, 1, 'พยากรณ์โหลดที่หน้าครั้งเดียว')
  assert.ok(/<TmdForecastCard key=\{tenantId\} forecast=\{forecast\}/.test(code) && /forecast=\{forecast\}/.test(code.slice(code.indexOf('<WaterVerdictCard'))))
  // ปุ่มแชร์ภาพบนหน้า: ในแถบเตือน (มีเตือน) หรือในป้ายสรุป (ไม่มีเตือน) — ไม่ขึ้นสองปุ่ม
  assert.ok(/!announced && !st\.alerts\.any/.test(card))
  assert.ok(card.includes('<WaterAlertShareButton') && card.includes('allStates'))
  assert.ok(card.includes('ไม่ใช่ประกาศทางการ') && card.includes('STATUS_RULE_TEXT'), 'ต้องบอกว่าไม่ใช่ประกาศ + มีเกณฑ์ให้ตรวจย้อน')
  assert.ok(card.includes('อาจคลาดเคลื่อน') && card.includes('ไม่ใช่ประกาศเตือนภัย') && card.includes('TMD_SOURCE_NAME'), 'บรรทัดพยากรณ์ต้องอ้างที่มา + กำกับว่าคลาดเคลื่อนได้')
  assert.ok(card.includes('href="#water-forecast"') && read('../src/components/water/TmdForecastCard.jsx').includes('id="water-forecast"'))
  assert.ok(!BANNED.test(stripComments(card)))
  ok('หน้าใช้ป้ายสรุปตัวเดียว ใต้แถบเตือน · ชุดภาพเดิมเลิกใช้ · พยากรณ์โหลดครั้งเดียว · ป้ายอ้างที่มา/ไม่ใช่ประกาศ')
}

console.log(`\n${n} ชุดผ่าน`)

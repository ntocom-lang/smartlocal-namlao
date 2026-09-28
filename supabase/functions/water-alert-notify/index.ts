// Supabase Edge Function: water-alert-notify
// Deploy: npx --no-install supabase functions deploy water-alert-notify --no-verify-jwt --project-ref <ref>
//   --no-verify-jwt จำเป็นเหมือน thaiwater-sync: pg_cron ยิงผ่าน net.http_post โดยไม่มี JWT
// Secret: THAIWATER_CRON_SECRET (ตัวเดียวกับ thaiwater-sync/watchdog) + TELEGRAM_BOT_TOKEN
//
// แจ้งกลุ่ม Telegram ของ อปท. เมื่อมีเหตุใกล้พื้นที่ (เจ้าของระบบเลือก 2569-09-19) — 5 แหล่ง:
//   A. สถานีฝนของ อปท. (รัศมี 10 กม.) วัดฝน 24 ชม. ได้ "ฝนหนักมาก" ≥ 90.1 มม. ตามเกณฑ์กรมอุตุฯ
//      ค่าเดียวกับป้าย RAIN_LEVELS บนหน้าเว็บ — ข้อเท็จจริงที่วัดได้ ไม่ใช่สถานะเตือนภัยทางการ
//   B. ข้อความเตือนของ สสน. (water_warnings) ที่ระบุอำเภอ + จังหวัดเดียวกับ อปท. — ส่งตามต้นฉบับ
//   C. สถานีเตือนภัยน้ำหลาก-ดินถล่มของกรมทรัพยากรน้ำ ระดับ 2–3 — ตอนนี้ปิดอยู่ (ดึงจาก Supabase
//      ไม่ได้ ดู 20260919100150) โค้ดรองรับไว้ เปิดแถว ews แล้วทำงานทันที
//   D. สถานีระดับน้ำ: ระดับน้ำสูงกว่าตลิ่งต่ำสุดของสถานี (bank_diff_m < 0) — ข้อเท็จจริงทางกายภาพ
//      ที่ thaiwater-sync คำนวณจาก min_bank ของต้นทาง ไม่ใช่เกณฑ์ที่เราตั้งเอง
//   E. อ่างเก็บน้ำ: % ความจุที่ระดับเก็บกักขยับขึ้นถึงชั้น "น้ำมาก" (80–100%) หรือ "เกินความจุเก็บกัก"
//      (>100%) ตามเกณฑ์ของ สสน./กรมชลประทาน ชุดเดียวกับ DAM_LEVELS บนหน้าเว็บ
//
// D และ E แจ้ง **ตอนข้ามชั้นขึ้น** ไม่ใช่แจ้งตามสถานะ เพราะน้ำล้นตลิ่ง/อ่างน้ำมากค้างได้หลายวัน
// ถ้าแจ้งตามสถานะจะส่งซ้ำทุกวันจนคนเลิกอ่าน · เมื่อข้ามชั้นลงกลับจะส่ง "สถานการณ์คลี่คลาย"
// ให้เฉพาะเรื่องที่เคยส่งขาเข้าสำเร็จไปแล้วภายใน 7 วัน (ไม่งั้นจะมี "คลี่คลาย" ลอยมาโดยไม่มีที่มา)
// อ่านจากฐานข้อมูลเราเท่านั้น (thaiwater-sync เก็บไว้นาทีที่ 10 ตัวนี้รันนาทีที่ 15) ไม่ยิงต้นทางซ้ำ
//
// ผู้รับ: ทุก อปท. ที่ตั้ง telegram_group_id และเปิดโมดูล water-situation — ต่างจาก thaiwater-watchdog
// ที่ส่งเข้ากลุ่ม demo อย่างเดียว เพราะเรื่องนี้เจ้าหน้าที่ อปท. ลงมือได้จริง
//
// กติกา
// - ความสด: ค่าฝนไม่เก่ากว่า 3 ชม. · ข้อความ สสน. ออกไม่เกิน 6 ชม. · สถานะ ews ไม่เก่ากว่า 12 ชม.
//   (ค่าฝน/ews ต้องตรงกับหน้าเว็บ — tests/water-situation.test.mjs อ่านค่าจากไฟล์นี้ไปเทียบ)
// - ส่งไม่เกินวันละครั้งต่อเรื่อง (คีย์กันซ้ำรวมวันที่ไทย): ฝน = ต่อสถานี · สสน. = ต่อสถานีต่อประเภท
//   ข้อความ (ล้นตลิ่ง/ฝนตกหนัก/เสี่ยงน้ำท่วมฉับพลัน …) · ews = ต่อสถานีต่อระดับ — ข้อความเปลี่ยน
//   ประเภทหรือระดับขึ้น คีย์เปลี่ยน จึงได้ข้อความใหม่ทันที
// - รวมเรื่องของ อปท. เดียวกันเป็นชุดไม่เกิน 3,800 ตัวอักษร โดยไม่ตัดรายการหรือ HTML
// - ส่งไม่สำเร็จ (Telegram ล่ม) รอบถัดไปพยายามใหม่ ไม่ถูกคีย์กันซ้ำกลืน — แบบเดียวกับ thaiwater-watchdog
// - ข้อความเป็นข้อมูลประกอบการตัดสินใจ ไม่สั่งอพยพและไม่ประกาศแทนผู้บริหาร (ดุลพินิจทางปกครอง)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage, escapeHtml, cleanText } from '../_shared/telegram.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('THAIWATER_CRON_SECRET')
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')

// ฝนหนักมาก = มากกว่า 90.0 มม. (กรมอุตุฯ: 90.1 มม. ขึ้นไป) — ตรงกับ RAIN_LEVELS ฝั่งหน้าเว็บ
const HEAVY_RAIN_MM = 90.1
const RAIN_FRESH_HOURS = 3
const WARNING_FRESH_HOURS = 6
const EWS_FRESH_HOURS = 12
const EWS_ALERT_LEVELS = new Set([2, 3])
// สถานีระดับน้ำรายงานทุก 10 นาที–1 ชม. เหมือนสถานีฝน จึงใช้เกณฑ์ความสดเดียวกัน
const LEVEL_FRESH_HOURS = RAIN_FRESH_HOURS
// อ่างเป็นข้อมูลรายวัน — เท่ากับ DAM_STALE_HOURS ฝั่งหน้าเว็บ เพื่อให้เว็บกับ Telegram ตัดสินเหมือนกัน
const DAM_FRESH_HOURS = 48
// หน้าต่างหาค่าก่อนหน้าไว้เทียบว่าข้ามชั้นหรือยัง — ต้องตรงกับ RPC get_public_water_situation
// (20260919100300_water_warnings_rls_rpc.sql) ไม่งั้นแถบบนเว็บกับ Telegram จะบอกคนละอย่าง
const LEVEL_PREV_MIN_MS = 50 * 60 * 1000
const LEVEL_PREV_MAX_MS = 3 * 60 * 60 * 1000
const DAM_PREV_MIN_MS = 20 * 60 * 60 * 1000
const DAM_PREV_MAX_MS = 3 * 24 * 60 * 60 * 1000

// เกณฑ์ % ของความจุที่ระดับเก็บกัก — คัดจากรายงานสถานภาพน้ำเขื่อนของ สสน. (tiwrm.hii.or.th
// rid_bigcm) และฐานข้อมูลอ่างเก็บน้ำกรมชลประทาน (app.rid.go.th/reservoir)
// ⚠️ ต้องตรงกับ DAM_LEVELS ใน src/lib/waterSituation.js ทุกค่า — tests/water-situation.test.mjs
//    อ่านทั้งสองไฟล์มาเทียบกัน ห้ามแก้ที่เดียว
const DAM_LEVELS = [
  { key: 'critical', label: 'น้ำน้อยวิกฤติ', upTo: 30 },
  { key: 'low', label: 'น้ำน้อย', upTo: 50 },
  { key: 'moderate', label: 'น้ำปานกลาง', upTo: 80 },
  { key: 'high', label: 'น้ำมาก', upTo: 100 },
  { key: 'over', label: 'เกินความจุเก็บกัก', upTo: Infinity },
]
// ชั้นต่ำสุดที่แจ้งเจ้าหน้าที่ = "น้ำมาก" (เกิน 80%) — ต่ำกว่านี้เป็นสถานะปกติของอ่างในฤดูฝน
// ⚠️ แถบเตือนฝั่งประชาชนใช้เกณฑ์สูงกว่านี้ (DAM_PUBLIC_ALERT_RANK = เกินความจุเก็บกัก >100%
// ใน src/lib/waterSituation.js) โดยตั้งใจ: อ่างอยู่ชั้น "น้ำมาก" เป็นเดือนในฤดูฝน ถ้าเอาไปขึ้น
// แถบบนหน้าแรก แถบจะค้างทั้งฤดูจนคนเลิกมอง — เจ้าหน้าที่ต้องได้สัญญาณเร็วกว่าประชาชน
const DAM_ALERT_RANK = DAM_LEVELS.findIndex(l => l.key === 'high')
const MODULE_KEY = 'water-situation'
// โหมดทดสอบส่งได้เฉพาะกลุ่มนี้ — ห้ามมีข้อความทดสอบหลุดเข้ากลุ่ม อปท. จริง
const TEST_TENANT_SLUG = 'demo'
const HOUR = 60 * 60 * 1000

type Tenant = {
  id: string
  slug: string
  name: string | null
  district: string | null
  province: string | null
  telegram_group_id: string | number | null
  enabled_modules: string[] | null
}
type Station = {
  id: string
  municipality_id: string
  station_type: 'rain' | 'ews' | 'waterlevel' | 'dam'
  station_code: string
  station_name: string
  tambon_name: string | null
  amphoe_name: string | null
  river_name: string | null
  distance_km: number | string | null
  note: string | null
  display_order: number | null
}
type Item = {
  section: 'rain' | 'thaiwater' | 'ews' | 'level' | 'dam' | 'cleared'
  key: string
  notificationType: string
  resourceType: string
  resourceId: string
  line: string
  sortKey: number
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// เทียบ secret แบบใช้เวลาเท่ากันทุกกรณี (ยกมาจาก thaiwater-sync ตั้งใจให้เหมือนกัน)
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

function bangkokDate(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }) // YYYY-MM-DD
}

function bangkokText(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'ไม่ทราบเวลา'
  return `${d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })} น.`
}

// สอดคล้องกับ isModuleEnabled() ฝั่งหน้าเว็บ: enabled_modules เป็น null = เปิดทุกโมดูล
function moduleOn(tenant: Tenant): boolean {
  return tenant.enabled_modules === null || tenant.enabled_modules.includes(MODULE_KEY)
}

function kmText(km: unknown): string {
  const n = Number(km)
  return Number.isFinite(n) ? `ห่างสำนักงาน ${n.toLocaleString('th-TH', { maximumFractionDigits: 1 })} กม.` : ''
}

function numText(value: unknown, digits = 2): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString('th-TH', { maximumFractionDigits: digits }) : '–'
}

// "ต.น้ำเลา · ห่างสำนักงาน 2.6 กม." หรือ "ต.น้ำรัด · อ.หนองม่วงไข่ · ห่างสำนักงาน 14.1 กม."
// ⚠️ ต้องโชว์อำเภอทุกครั้งที่ต่างจากที่ตั้งสำนักงาน — สถานีระดับน้ำที่ใกล้ที่สุดของบาง อปท. อยู่นอกอำเภอ
// ถ้าไม่บอก ประชาชนจะเข้าใจว่าน้ำล้นตลิ่งในหมู่บ้านตัวเอง (เหมือน stationPlace() ฝั่งหน้าเว็บ)
function placeText(s: Station, tenant: Tenant | undefined): string {
  const parts: string[] = []
  if (s.tambon_name) parts.push(`ต.${escapeHtml(s.tambon_name, 40)}`)
  if (s.amphoe_name && s.amphoe_name !== tenant?.district) parts.push(`อ.${escapeHtml(s.amphoe_name, 40)}`)
  const km = kmText(s.distance_km)
  if (km) parts.push(km)
  return parts.join(' · ')
}

// ชั้นเกณฑ์ของอ่าง — คืน index ใน DAM_LEVELS (ยิ่งมากยิ่งน้ำเยอะ) หรือ null เมื่อไม่มีค่า
function damRank(percent: unknown): number | null {
  const n = Number(percent)
  if (percent === null || percent === undefined || !Number.isFinite(n) || n < 0) return null
  const index = DAM_LEVELS.findIndex(l => n <= l.upTo)
  return index === -1 ? DAM_LEVELS.length - 1 : index
}

// ใช้แยกคีย์กันซ้ำเท่านั้น (ข้อความที่ส่งยังเป็นของ สสน. ตรงตัว) — เรียงจากเฉพาะเจาะจงไปทั่วไป
function warningCategory(message: string): string {
  if (message.includes('เสี่ยงเกิดน้ำท่วมฉับพลัน')) return 'flash'
  if (message.includes('ล้นตลิ่ง')) return 'overbank'
  if (message.includes('เท่ากับตลิ่ง')) return 'bankfull'
  if (message.includes('ฝนตกหนักมาก')) return 'rain_very_heavy'
  if (message.includes('ฝนตกหนัก')) return 'rain_heavy'
  return 'other'
}

// นับ HTML ก่อน parse แบบเผื่อเหลือ: ไม่ตัดกลาง tag/entity หรือกลืนรายการท้าย
function renderAlertMessage(items: Item[], tenant: Tenant, isTest: boolean): string {
  const section = (name: Item['section'], title: string) => {
    const lines = items.filter(i => i.section === name).sort((a, b) => a.sortKey - b.sortKey).map(i => i.line)
    return lines.length ? ['', title, ...lines] : []
  }
  const area = [tenant.district && `อ.${escapeHtml(tenant.district, 40)}`, tenant.province && `จ.${escapeHtml(tenant.province, 40)}`].filter(Boolean).join(' ')
  const sources = ['คลังข้อมูลน้ำแห่งชาติ (ThaiWater) สสน.']
  if (items.some(i => i.section === 'rain')) sources.push('เกณฑ์ฝนของกรมอุตุนิยมวิทยา')
  if (items.some(i => i.section === 'ews')) sources.push('ระบบเตือนภัยล่วงหน้า กรมทรัพยากรน้ำ')
  if (items.some(i => i.section === 'dam')) sources.push('เกณฑ์ปริมาณน้ำในอ่างของ สสน./กรมชลประทาน')

  // ชุดที่มีแต่ "คลี่คลาย" ไม่ใช่การเตือน จึงไม่ขึ้นหัวข้อ ⚠️ และไม่ต่อท้ายด้วยข้อความเรื่องดุลพินิจ
  const onlyCleared = items.length > 0 && items.every(i => i.section === 'cleared')
  if (onlyCleared) {
    return [
      `✅ <b>${isTest ? '[ทดสอบ] ' : ''}สถานการณ์น้ำใกล้พื้นที่คลี่คลายแล้ว</b>`,
      '',
      ...[...items].sort((a, b) => a.sortKey - b.sortKey).map(i => i.line),
      '',
      `ที่มา: ${sources.join(' · ')}`,
    ].join('\n')
  }

  return [
    `⚠️ <b>${isTest ? '[ทดสอบ] ' : ''}แจ้งเตือนสถานการณ์น้ำ-ฝนใกล้พื้นที่</b>`,
    ...section('rain', `🌧️ <b>ฝนหนักมาก</b> (${HEAVY_RAIN_MM} มม. ขึ้นไปใน 24 ชม. ตามเกณฑ์กรมอุตุนิยมวิทยา)`),
    ...section('level', '🌊 <b>ระดับน้ำสูงกว่าตลิ่ง</b> (เทียบตลิ่งต่ำสุดของสถานี)'),
    ...section('thaiwater', `📢 <b>ข้อความเตือนจาก สสน.</b>${area ? ` (${area})` : ''}`),
    ...section('ews', '🚨 <b>สถานีเตือนภัยน้ำหลาก-ดินถล่ม</b> (กรมทรัพยากรน้ำ)'),
    ...section('dam', '🏞️ <b>อ่างเก็บน้ำใกล้พื้นที่</b>'),
    ...section('cleared', '✅ <b>คลี่คลายแล้ว</b>'),
    '',
    `ที่มา: ${sources.join(' · ')}`,
    'ข้อมูลนี้ใช้ประกอบการตัดสินใจของเจ้าหน้าที่ — การประกาศแจ้งเตือนในพื้นที่เป็นการตัดสินใจของผู้บริหาร',
  ].join('\n')

}

export function buildAlertBatches(items: Item[], tenant: Tenant, isTest: boolean) {
  const batches: { items: Item[]; text: string }[] = []
  let current: Item[] = []
  for (const item of items) {
    const candidate = [...current, item]
    if (renderAlertMessage(candidate, tenant, isTest).length <= 3800) {
      current = candidate
      continue
    }
    if (current.length) batches.push({ items: current, text: renderAlertMessage(current, tenant, isTest) })
    // ค่าจากต้นทางถูกจำกัดก่อน escapeHtml แล้ว ป้องกันอนาคตที่เพิ่มความยาวโดยไม่แก้ตัวแบ่ง
    if (renderAlertMessage([item], tenant, isTest).length > 3800) {
      throw new Error('water alert item exceeds message limit')
    }
    current = [item]
  }
  if (current.length) batches.push({ items: current, text: renderAlertMessage(current, tenant, isTest) })
  return batches
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok: false, error: 'server not configured' }, 500)
  if (!CRON_SECRET) return json({ ok: false, error: 'THAIWATER_CRON_SECRET is not configured' }, 500)
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }
  if (!BOT_TOKEN) return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' }, 500)

  // ช่องทดสอบ (ต้องมี cron secret เหมือนกัน): {"test":true} → สร้างตัวอย่างเรื่องฝนหนักมาก + ข้อความ
  // สสน. ให้กลุ่ม demo เท่านั้น · แถวทดสอบใช้ประเภทลงท้าย _test และคีย์ขึ้นต้น test: จึงไม่ปนประวัติจริง
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const isTest = body.test === true
  const keyPrefix = isTest ? 'test:' : ''
  const typeSuffix = isTest ? '_test' : ''

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: tenantRows, error: tenantError } = await admin
    .from('municipalities')
    .select('id, slug, name, district, province, telegram_group_id, enabled_modules')
    .eq('is_active', true)
    .not('telegram_group_id', 'is', null)
  if (tenantError) return json({ ok: false, error: cleanText(tenantError.message, 300) }, 500)
  const tenants = ((tenantRows ?? []) as Tenant[])
    .filter(moduleOn)
    .filter(t => !isTest || t.slug === TEST_TENANT_SLUG)
  if (!tenants.length) return json({ ok: true, test: isTest, tenants: 0, sent: [] })

  const { data: stationRows, error: stationError } = await admin
    .from('water_station_config')
    .select('id, municipality_id, station_type, station_code, station_name, tambon_name, amphoe_name, river_name, distance_km, note, display_order')
    .in('municipality_id', tenants.map(t => t.id))
    .in('station_type', ['rain', 'ews', 'waterlevel', 'dam'])
    .eq('is_active', true)
  if (stationError) return json({ ok: false, error: cleanText(stationError.message, 300) }, 500)
  const stations = (stationRows ?? []) as Station[]
  const tenantById = new Map(tenants.map(t => [t.id, t]))

  const now = Date.now()
  const day = bangkokDate()
  const itemsByTenant = new Map<string, Item[]>()
  const push = (tenantId: string, item: Item) => {
    const list = itemsByTenant.get(tenantId) ?? []
    list.push(item)
    itemsByTenant.set(tenantId, list)
  }

  if (isTest) {
    const tenant = tenants[0]
    const rain = stations
      .filter(s => s.municipality_id === tenant.id && s.station_type === 'rain')
      .sort((a, b) => (a.display_order ?? 99) - (b.display_order ?? 99))[0]
    if (!rain) return json({ ok: false, error: `${TEST_TENANT_SLUG} ไม่มีสถานีฝน` }, 500)
    const at = new Date(now).toISOString()
    push(tenant.id, {
      section: 'rain', key: `${keyPrefix}rain:${rain.station_code}:${day}`, notificationType: `heavy_rain${typeSuffix}`,
      resourceType: 'water_station_config', resourceId: rain.id, sortKey: -95,
      line: `• ${escapeHtml(rain.station_name, 80)} <b>95 มม.</b> (ตัวอย่าง) · ${[rain.tambon_name && `ต.${escapeHtml(rain.tambon_name, 40)}`, kmText(rain.distance_km)].filter(Boolean).join(' · ')} · วัดเมื่อ ${bangkokText(at)}`,
    })
    push(tenant.id, {
      section: 'thaiwater', key: `${keyPrefix}ttw:ตัวอย่าง:overbank:${day}`, notificationType: `thaiwater_warning${typeSuffix}`,
      resourceType: 'water_station_config', resourceId: rain.id, sortKey: 0,
      line: `• ${bangkokText(at)} — สถานีตัวอย่าง ต.ตัวอย่าง อ.${escapeHtml(tenant.district ?? '', 40)} จ.${escapeHtml(tenant.province ?? '', 40)} [ข้อความตัวอย่าง] ล้นตลิ่งแล้ว 10 ซม.`,
    })
  } else {
    // ── A + C + D + E: ค่าล่าสุดของทุกสถานี + ค่าก่อนหน้าของสถานีที่ต้องเทียบชั้น ──
    //
    // ⚠️ แยกเป็น 2 คำสั่งโดยตั้งใจ ห้ามยุบกลับเป็นคำสั่งเดียว: PostgREST คืนสูงสุด 1,000 แถวต่อคำสั่ง
    // และตัดเงียบๆ ไม่แจ้ง error · สถานีฝนรายงานรายชั่วโมง 3 วันรวมกันเกิน 1,600 แถวอยู่แล้ว
    // (วัดจริง 2569-09-28: 2,016 แถว) ถ้าดึงรวมกัน แถว "เมื่อวาน" ของอ่างจะถูกตัดทิ้งทั้งหมด
    // แล้วระบบจะเข้าใจว่าไม่มีค่าก่อนหน้า → ส่งคำเตือนผิดว่าอ่างเพิ่งข้ามชั้น (เกิดขึ้นจริงมาแล้ว)
    if (stations.length) {
      const latest = new Map<string, Record<string, unknown>>()
      const history = new Map<string, Record<string, unknown>[]>()
      const COLUMNS = 'station_config_id, recorded_at, rain_24h_mm, situation_level, situation_text, bank_diff_m, storage_percent, dam_storage_mcm, dam_capacity_mcm, dam_inflow_mcm, dam_released_mcm'
      const ROW_CAP = 1000

      const fetchReadings = async (ids: string[], sinceMs: number) => {
        if (!ids.length) return { rows: [] as Record<string, unknown>[], error: null as string | null }
        const { data, error } = await admin
          .from('water_readings')
          .select(COLUMNS)
          .in('station_config_id', ids)
          .gte('recorded_at', new Date(now - sinceMs).toISOString())
          .order('recorded_at', { ascending: false })
        if (error) return { rows: [], error: cleanText(error.message, 300) }
        const rows = (data ?? []) as Record<string, unknown>[]
        // ชนเพดานเมื่อไรแปลว่าข้อมูลถูกตัด ผลที่ได้จะเชื่อไม่ได้ — หยุดดีกว่าส่งคำเตือนผิด
        if (rows.length >= ROW_CAP) return { rows, error: `water_readings ถูกตัดที่ ${rows.length} แถว — ต้องแบ่งคำสั่งให้เล็กลง` }
        return { rows, error: null }
      }

      // สถานีฝน/ews ใช้แค่ค่าล่าสุด จึงย้อนเท่าหน้าต่างความสดที่ยาวที่สุดของสองชนิดนี้พอ
      const quickIds = stations.filter(s => s.station_type === 'rain' || s.station_type === 'ews').map(s => s.id)
      // สถานีระดับน้ำ/อ่างต้องมีประวัติไว้เทียบว่าข้ามชั้นหรือยัง จึงย้อนเท่าหน้าต่างค่าก่อนหน้าของอ่าง
      const historyIds = stations.filter(s => s.station_type === 'waterlevel' || s.station_type === 'dam').map(s => s.id)
      const [quick, deep] = await Promise.all([
        fetchReadings(quickIds, EWS_FRESH_HOURS * HOUR),
        fetchReadings(historyIds, DAM_PREV_MAX_MS),
      ])
      if (quick.error) return json({ ok: false, error: quick.error }, 500)
      if (deep.error) return json({ ok: false, error: deep.error }, 500)

      for (const r of [...quick.rows, ...deep.rows]) {
        const id = String(r.station_config_id)
        if (!latest.has(id)) latest.set(id, r)
        const list = history.get(id) ?? []
        list.push(r)
        history.set(id, list)
      }
      // ค่าก่อนหน้าไว้เทียบว่าข้ามชั้นหรือยัง — เลือกแถวที่อยู่ในหน้าต่างเดียวกับ RPC ของหน้าเว็บ
      // (readings เรียงใหม่ไปเก่าแล้ว แถวแรกที่เข้าหน้าต่างคือค่าที่ใกล้ที่สุด)
      const previousOf = (stationId: string, latestAt: number, minGap: number, maxGap: number) =>
        (history.get(stationId) ?? []).find(r => {
          const at = new Date(String(r.recorded_at)).getTime()
          if (!Number.isFinite(at)) return false
          const gap = latestAt - at
          return gap >= minGap && gap <= maxGap
        }) ?? null

      for (const s of stations) {
        const r = latest.get(s.id)
        if (!r) continue
        const recordedAt = new Date(String(r.recorded_at)).getTime()
        const age = now - recordedAt
        const tenant = tenantById.get(s.municipality_id)
        const place = placeText(s, tenant)

        if (s.station_type === 'waterlevel') {
          // D: สูงกว่าตลิ่ง = bank_diff_m ติดลบ (ตลิ่งต่ำสุด − ระดับน้ำ) ไม่ใช่เกณฑ์ที่เราตั้งเอง
          const diff = Number(r.bank_diff_m)
          if (r.bank_diff_m === null || !Number.isFinite(diff) || age > LEVEL_FRESH_HOURS * HOUR) continue
          const prev = previousOf(s.id, recordedAt, LEVEL_PREV_MIN_MS, LEVEL_PREV_MAX_MS)
          const prevDiff = prev && prev.bank_diff_m !== null ? Number(prev.bank_diff_m) : null
          const river = s.river_name ? `${escapeHtml(s.river_name, 60)} ` : ''
          const situation = r.situation_text ? ` · สถานะจาก สสน.: <b>${escapeHtml(String(r.situation_text), 40)}</b>` : ''

          if (diff < 0 && (prevDiff === null || prevDiff >= 0)) {
            push(s.municipality_id, {
              section: 'level', key: `${keyPrefix}bank:${s.station_code}:${day}`, notificationType: `waterlevel_overbank${typeSuffix}`,
              resourceType: 'water_station_config', resourceId: s.id, sortKey: diff,
              line: `• ${river}สถานี${escapeHtml(s.station_name, 80)} <b>สูงกว่าตลิ่ง ${numText(Math.abs(diff))} ม.</b>${situation}\n  ${place} · วัดเมื่อ ${bangkokText(String(r.recorded_at))}`,
            })
          } else if (diff >= 0 && prevDiff !== null && prevDiff < 0) {
            push(s.municipality_id, {
              section: 'cleared', key: `${keyPrefix}bankclear:${s.station_code}:${day}`, notificationType: `waterlevel_cleared${typeSuffix}`,
              resourceType: 'water_station_config', resourceId: s.id, sortKey: 10,
              line: `• ${river}สถานี${escapeHtml(s.station_name, 80)} ระดับน้ำ<b>ลงมาต่ำกว่าตลิ่งแล้ว</b> (ต่ำกว่าตลิ่ง ${numText(diff)} ม.)\n  ${place} · วัดเมื่อ ${bangkokText(String(r.recorded_at))}`,
            })
          }
          continue
        }

        if (s.station_type === 'dam') {
          // E: ข้ามชั้นขึ้นถึง "น้ำมาก" หรือ "เกินความจุเก็บกัก" ตามเกณฑ์ สสน./กรมชลประทาน
          if (age > DAM_FRESH_HOURS * HOUR) continue
          const rank = damRank(r.storage_percent)
          if (rank === null) continue
          const prev = previousOf(s.id, recordedAt, DAM_PREV_MIN_MS, DAM_PREV_MAX_MS)
          const prevRank = prev ? damRank(prev.storage_percent) : null
          // ข้อมูลอ่างเป็นรายวันและมาสม่ำเสมอ ไม่มีค่าเมื่อวานให้เทียบ = ผิดปกติของระบบเรา ไม่ใช่ของอ่าง
          // เทียบชั้นไม่ได้ก็ห้ามเดาว่า "เพิ่งข้ามชั้น" (เคยส่งคำเตือนผิด 3 กลุ่มมาแล้วเพราะข้อนี้)
          if (prevRank === null) continue
          const percent = Number(r.storage_percent)
          const volume = [
            r.dam_storage_mcm !== null && `ปริมาตร ${numText(r.dam_storage_mcm)}${r.dam_capacity_mcm !== null ? `/${numText(r.dam_capacity_mcm)}` : ''} ล้าน ลบ.ม.`,
            r.dam_inflow_mcm !== null && `ไหลลงอ่าง ${numText(r.dam_inflow_mcm)}`,
            r.dam_released_mcm !== null && `ระบาย ${numText(r.dam_released_mcm)} ล้าน ลบ.ม./วัน`,
          ].filter(Boolean).join(' · ')

          if (rank >= DAM_ALERT_RANK && (prevRank === null || prevRank < rank)) {
            push(s.municipality_id, {
              section: 'dam', key: `${keyPrefix}dam:${s.station_code}:${DAM_LEVELS[rank].key}:${day}`, notificationType: `dam_level${typeSuffix}`,
              resourceType: 'water_station_config', resourceId: s.id, sortKey: -percent,
              line: `• ${escapeHtml(s.station_name, 80)} <b>${escapeHtml(DAM_LEVELS[rank].label, 40)} ${numText(percent, 1)}%</b> ของความจุที่ระดับเก็บกัก\n  ${[place, volume].filter(Boolean).join(' · ')}`,
            })
          } else if (rank < DAM_ALERT_RANK && prevRank !== null && prevRank >= DAM_ALERT_RANK) {
            push(s.municipality_id, {
              section: 'cleared', key: `${keyPrefix}damclear:${s.station_code}:${day}`, notificationType: `dam_cleared${typeSuffix}`,
              resourceType: 'water_station_config', resourceId: s.id, sortKey: 20,
              line: `• ${escapeHtml(s.station_name, 80)} ลงมาอยู่ระดับ <b>${escapeHtml(DAM_LEVELS[rank].label, 40)}</b> (${numText(percent, 1)}% ของความจุที่ระดับเก็บกัก)\n  ${place}`,
            })
          }
          continue
        }

        if (s.station_type === 'rain') {
          const mm = Number(r.rain_24h_mm)
          if (r.rain_24h_mm === null || !Number.isFinite(mm) || mm < HEAVY_RAIN_MM || age > RAIN_FRESH_HOURS * HOUR) continue
          push(s.municipality_id, {
            section: 'rain', key: `${keyPrefix}rain:${s.station_code}:${day}`, notificationType: `heavy_rain${typeSuffix}`,
            resourceType: 'water_station_config', resourceId: s.id, sortKey: -mm,
            line: `• ${escapeHtml(s.station_name, 80)} <b>${mm.toLocaleString('th-TH', { maximumFractionDigits: 1 })} มม.</b> · ${place} · วัดเมื่อ ${bangkokText(String(r.recorded_at))}`,
          })
        } else if (s.station_type === 'ews') {
          const level = Number(r.situation_level)
          if (!EWS_ALERT_LEVELS.has(level) || age > EWS_FRESH_HOURS * HOUR) continue
          const text = String(r.situation_text || (level === 3 ? 'วิกฤติ' : 'เตรียมพร้อม'))
          push(s.municipality_id, {
            section: 'ews', key: `${keyPrefix}ews:${s.station_code}:${level}:${day}`, notificationType: `ews_warning${typeSuffix}`,
            resourceType: 'water_station_config', resourceId: s.id, sortKey: -level,
            line: [
              `• ${escapeHtml(s.station_name, 80)} ระดับ <b>${escapeHtml(text, 20)}</b> · ${place} · รายงานเมื่อ ${bangkokText(String(r.recorded_at))}`,
              s.note ? `  ${escapeHtml(s.note, 280)}` : '',
            ].filter(Boolean).join('\n'),
          })
        }
      }
    }

    // ── B: ข้อความเตือนของ สสน. ที่ระบุอำเภอ + จังหวัดเดียวกับ อปท. ──
    const { data: warnings, error: warningError } = await admin
      .from('water_warnings')
      .select('id, issued_at, message, station_name, amphoe_name, province_name')
      .eq('source', 'thaiwater')
      .gte('issued_at', new Date(now - WARNING_FRESH_HOURS * HOUR).toISOString())
      .order('issued_at', { ascending: false })
    if (warningError) return json({ ok: false, error: cleanText(warningError.message, 300) }, 500)

    for (const t of tenants) {
      if (!t.district || !t.province) continue
      const seen = new Set<string>()
      for (const w of warnings ?? []) {
        if (w.amphoe_name !== t.district || w.province_name !== t.province) continue
        // สถานีเดียวรายงานซ้ำหลายรอบได้ — เอาข้อความล่าสุดของแต่ละสถานี (เรียงใหม่ไปเก่าแล้ว)
        const stationKey = String(w.station_name ?? w.message)
        if (seen.has(stationKey)) continue
        seen.add(stationKey)
        push(t.id, {
          section: 'thaiwater',
          key: `${keyPrefix}ttw:${stationKey.slice(0, 120)}:${warningCategory(String(w.message))}:${day}`,
          notificationType: `thaiwater_warning${typeSuffix}`,
          resourceType: 'water_warning', resourceId: w.id, sortKey: -new Date(w.issued_at).getTime(),
          line: `• ${bangkokText(w.issued_at)} — ${escapeHtml(w.message, 500)}`,
        })
      }
    }
  }

  // "คลี่คลาย" ส่งได้เฉพาะเรื่องที่เคยส่งขาเข้าสำเร็จภายใน 7 วัน — ไม่งั้นจะมีข้อความคลี่คลายลอยมา
  // โดยที่กลุ่มไม่เคยได้รับคำเตือนของเรื่องนั้นมาก่อนเลย (เช่น เพิ่งเปิดโมดูล เพิ่งเพิ่มสถานี
  // หรือรอบขาเข้าส่งไม่สำเร็จ) 7 วันเท่ากับอายุข้อมูลที่ water_readings เก็บไว้
  const entryTypeOf: Record<string, string> = {
    [`waterlevel_cleared${typeSuffix}`]: `waterlevel_overbank${typeSuffix}`,
    [`dam_cleared${typeSuffix}`]: `dam_level${typeSuffix}`,
  }
  const clearedItems = [...itemsByTenant.entries()]
    .flatMap(([tenantId, items]) => items.filter(i => i.section === 'cleared').map(item => ({ tenantId, item })))
  if (clearedItems.length) {
    const { data: past, error: pastError } = await admin
      .from('notification_deliveries')
      .select('municipality_id, resource_id, notification_type')
      .in('municipality_id', tenants.map(t => t.id))
      .eq('channel', 'telegram')
      .eq('status', 'sent')
      .in('notification_type', Object.values(entryTypeOf))
      .gte('created_at', new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString())
    if (pastError) return json({ ok: false, error: cleanText(pastError.message, 300) }, 500)
    const seen = new Set((past ?? []).map(r => `${r.municipality_id}|${r.resource_id}|${r.notification_type}`))
    for (const { tenantId, item } of clearedItems) {
      if (seen.has(`${tenantId}|${item.resourceId}|${entryTypeOf[item.notificationType]}`)) continue
      const rest = (itemsByTenant.get(tenantId) ?? []).filter(i => i !== item)
      if (rest.length) itemsByTenant.set(tenantId, rest)
      else itemsByTenant.delete(tenantId)
    }
  }

  const sent: { slug: string; items: number; ok: boolean }[] = []

  for (const tenant of tenants) {
    const items = itemsByTenant.get(tenant.id) ?? []
    if (!items.length) continue

    // แบ่งก่อน claim: รายการของชุดถัดไปยังไม่ติด pending ถ้าฟังก์ชันหยุดกลางทาง
    const batches = buildAlertBatches(items, tenant, isTest)
    for (const batch of batches) {
      // claim คีย์ผ่าน unique constraint ของ notification_deliveries — ชน = ส่งเรื่องนี้ไปแล้ววันนี้
      // ยกเว้นแถวเดิมเป็น failed ให้ส่งใหม่ได้ (เหตุผลเดียวกับ thaiwater-watchdog)
      const claimed: Item[] = []
      for (const item of batch.items) {
        const { error } = await admin.from('notification_deliveries').insert({
          municipality_id: tenant.id,
          channel: 'telegram',
          notification_type: item.notificationType,
          resource_type: item.resourceType,
          resource_id: item.resourceId,
          idempotency_key: item.key,
          status: 'pending',
        })
        if (!error) { claimed.push(item); continue }
        if (error.code !== '23505') {
          console.error('[water-alert-notify] claim ไม่สำเร็จ:', tenant.slug, error.code, error.message)
          continue
        }
        const { data: existing } = await admin.from('notification_deliveries')
          .select('status').eq('municipality_id', tenant.id).eq('channel', 'telegram')
          .eq('idempotency_key', item.key).maybeSingle()
        if (existing?.status === 'failed') claimed.push(item)
      }
      if (!claimed.length) continue

      const text = renderAlertMessage(claimed, tenant, isTest)

      const result = await sendTelegramMessage(String(tenant.telegram_group_id), text, BOT_TOKEN)
      for (const item of claimed) {
        await admin.from('notification_deliveries')
          .update({
            status: result.ok ? 'sent' : 'failed',
            attempt_count: result.attempts,
            sent_at: result.ok ? new Date().toISOString() : null,
            provider_message_id: result.ok ? String(result.messageId ?? '') : null,
            last_error: result.ok ? null : result.error,
            updated_at: new Date().toISOString(),
          })
          .eq('municipality_id', tenant.id)
          .eq('channel', 'telegram')
          .eq('idempotency_key', item.key)
      }
      sent.push({ slug: tenant.slug, items: claimed.length, ok: result.ok })
    }
  }

  return json({
    ok: true,
    test: isTest,
    tenants: tenants.length,
    found: [...itemsByTenant.entries()].map(([id, items]) => ({
      slug: tenants.find(t => t.id === id)?.slug,
      rain: items.filter(i => i.section === 'rain').length,
      thaiwater: items.filter(i => i.section === 'thaiwater').length,
      ews: items.filter(i => i.section === 'ews').length,
      level: items.filter(i => i.section === 'level').length,
      dam: items.filter(i => i.section === 'dam').length,
      cleared: items.filter(i => i.section === 'cleared').length,
    })),
    sent,
  })
})

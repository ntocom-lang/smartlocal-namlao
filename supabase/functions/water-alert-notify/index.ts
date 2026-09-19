// Supabase Edge Function: water-alert-notify
// Deploy: npx --no-install supabase functions deploy water-alert-notify --no-verify-jwt --project-ref <ref>
//   --no-verify-jwt จำเป็นเหมือน thaiwater-sync: pg_cron ยิงผ่าน net.http_post โดยไม่มี JWT
// Secret: THAIWATER_CRON_SECRET (ตัวเดียวกับ thaiwater-sync/watchdog) + TELEGRAM_BOT_TOKEN
//
// แจ้งกลุ่ม Telegram ของ อปท. เมื่อมีเหตุใกล้พื้นที่ (เจ้าของระบบเลือก 2569-09-19) — 3 แหล่ง:
//   A. สถานีฝนของ อปท. (รัศมี 10 กม.) วัดฝน 24 ชม. ได้ "ฝนหนักมาก" ≥ 90.1 มม. ตามเกณฑ์กรมอุตุฯ
//      ค่าเดียวกับป้าย RAIN_LEVELS บนหน้าเว็บ — ข้อเท็จจริงที่วัดได้ ไม่ใช่สถานะเตือนภัยทางการ
//   B. ข้อความเตือนของ สสน. (water_warnings) ที่ระบุอำเภอ + จังหวัดเดียวกับ อปท. — ส่งตามต้นฉบับ
//   C. สถานีเตือนภัยน้ำหลาก-ดินถล่มของกรมทรัพยากรน้ำ ระดับ 2–3 — ตอนนี้ปิดอยู่ (ดึงจาก Supabase
//      ไม่ได้ ดู 20260919100150) โค้ดรองรับไว้ เปิดแถว ews แล้วทำงานทันที
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
  station_type: 'rain' | 'ews'
  station_code: string
  station_name: string
  tambon_name: string | null
  amphoe_name: string | null
  distance_km: number | string | null
  note: string | null
  display_order: number | null
}
type Item = {
  section: 'rain' | 'thaiwater' | 'ews'
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

  return [
    `⚠️ <b>${isTest ? '[ทดสอบ] ' : ''}แจ้งเตือนสถานการณ์น้ำ-ฝนใกล้พื้นที่</b>`,
    ...section('rain', `🌧️ <b>ฝนหนักมาก</b> (${HEAVY_RAIN_MM} มม. ขึ้นไปใน 24 ชม. ตามเกณฑ์กรมอุตุนิยมวิทยา)`),
    ...section('thaiwater', `📢 <b>ข้อความเตือนจาก สสน.</b>${area ? ` (${area})` : ''}`),
    ...section('ews', '🚨 <b>สถานีเตือนภัยน้ำหลาก-ดินถล่ม</b> (กรมทรัพยากรน้ำ)'),
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
    .select('id, municipality_id, station_type, station_code, station_name, tambon_name, amphoe_name, distance_km, note, display_order')
    .in('municipality_id', tenants.map(t => t.id))
    .in('station_type', ['rain', 'ews'])
    .eq('is_active', true)
  if (stationError) return json({ ok: false, error: cleanText(stationError.message, 300) }, 500)
  const stations = (stationRows ?? []) as Station[]

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
    // ── A + C: ค่าล่าสุดของสถานีฝน/ews (ย้อนไม่เกินหน้าต่างที่ยาวที่สุด แล้วค่อยกรองรายชนิด) ──
    if (stations.length) {
      const since = new Date(now - EWS_FRESH_HOURS * HOUR).toISOString()
      const { data: readings, error: readingError } = await admin
        .from('water_readings')
        .select('station_config_id, recorded_at, rain_24h_mm, situation_level, situation_text')
        .in('station_config_id', stations.map(s => s.id))
        .gte('recorded_at', since)
        .order('recorded_at', { ascending: false })
      if (readingError) return json({ ok: false, error: cleanText(readingError.message, 300) }, 500)
      const latest = new Map<string, Record<string, unknown>>()
      for (const r of readings ?? []) if (!latest.has(r.station_config_id)) latest.set(r.station_config_id, r)

      for (const s of stations) {
        const r = latest.get(s.id)
        if (!r) continue
        const age = now - new Date(String(r.recorded_at)).getTime()
        const place = [s.tambon_name && `ต.${escapeHtml(s.tambon_name, 40)}`, kmText(s.distance_km)].filter(Boolean).join(' · ')
        if (s.station_type === 'rain') {
          const mm = Number(r.rain_24h_mm)
          if (r.rain_24h_mm === null || !Number.isFinite(mm) || mm < HEAVY_RAIN_MM || age > RAIN_FRESH_HOURS * HOUR) continue
          push(s.municipality_id, {
            section: 'rain', key: `${keyPrefix}rain:${s.station_code}:${day}`, notificationType: `heavy_rain${typeSuffix}`,
            resourceType: 'water_station_config', resourceId: s.id, sortKey: -mm,
            line: `• ${escapeHtml(s.station_name, 80)} <b>${mm.toLocaleString('th-TH', { maximumFractionDigits: 1 })} มม.</b> · ${place} · วัดเมื่อ ${bangkokText(String(r.recorded_at))}`,
          })
        } else {
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
    })),
    sent,
  })
})

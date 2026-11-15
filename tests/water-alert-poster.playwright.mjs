// E2E ภาพแชร์แจ้งเตือนน้ำ-ฝน (src/lib/waterAlertPosterImage.js) ใน Chrome จริง
//
// ตรวจ: ไฟล์ PNG ออกมา 1080×1350 และ canvas.toBlob สำเร็จ (= ไม่ tainted แม้ตราโหลดจาก URL) · ตราโหลดไม่ได้ = ยังวาดภาพได้
//   · ข้อความไม่ล้นกรอบ (layout.issues ว่าง) · เนื้อหาไม่ล้นแถบล่าง · ไม่มีเบอร์ = แถบเบอร์หาย · ไม่ใช้ SVG/ctx.filter ในโค้ดวาด
//   · ถ่ายภาพตัวอย่างแบบอ่าง (105.1%) · ฝน (96.5 มม.) · สถานีเตือนภัย (ระดับวิกฤติ/เตรียมพร้อม) · น้ำล้น/เสมอตลิ่ง ไว้ที่ tmp-shots/ (ไม่ git add)
//
// ไม่แตะฐานข้อมูล/เครือข่ายของระบบ: เปิด vite ชั่วคราวในกระบวนการนี้ (พอร์ตสุ่ม) แล้วปิดเมื่อจบ · ค่าสถานีเป็น fixture ทั้งหมด
// ใช้หน้าเปล่าที่ route ในเบราว์เซอร์ (ไม่โหลดแอป) แล้ว import โมดูลวาดภาพตรงๆ · ตราใช้ /logo.png ของรีโป (same-origin)

import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { createServer } from 'vite'

process.env.SKIP_SYNC_CHECK = '1'
const SHOT_DIR = path.join(process.cwd(), 'tmp-shots')
await mkdir(SHOT_DIR, { recursive: true })

// ── static: โค้ดวาดต้องไม่พึ่ง SVG filter / ctx.filter (Safari) ──
{
  const source = await readFile(path.join(process.cwd(), 'src/lib/waterAlertPosterImage.js'), 'utf8')
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
  assert.equal(/ctx\.filter\s*=|\.filter\s*=\s*['"`]|createElementNS|<svg|feTurbulence|feDisplacementMap|svgToPngFile|svgDataUrl/.test(code), false,
    'โค้ดวาดห้ามใช้ SVG/ctx.filter')
  assert.equal(/Math\.random\(\)/.test(code), false, 'ลายสุ่มต้องใช้ PRNG ที่ seed คงที่ ไม่ใช่ Math.random')
}

const server = await createServer({
  root: process.cwd(),
  cacheDir: path.join(tmpdir(), 'smartlocal-water-alert-poster-vite', path.basename(process.cwd())),
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-fixture-only'),
    'import.meta.env.VITE_TENANT_SLUG': JSON.stringify('demo'),
  },
  server: { host: '127.0.0.1', port: 0, hmr: false },
  logLevel: 'error',
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ headless: true, channel: 'chrome' })

let failed = false
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route(`${base}/__poster-test.html`, route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><title>poster</title><body></body>',
  }))
  // ตราจำลองที่โหลดไม่ได้ (404) — ต้องวาดภาพต่อได้โดยไม่มีตรา
  await page.route(`${base}/missing-logo.png`, route => route.fulfill({ status: 404, body: 'no' }))
  await page.goto(`${base}/__poster-test.html`)

  const result = await page.evaluate(async () => {
    const { buildPosterModel } = await import('/src/lib/waterAlertPoster.js')
    const { renderWaterAlertPoster } = await import('/src/lib/waterAlertPosterImage.js')
    const now = Date.now()
    const ago = hours => new Date(now - hours * 3600_000).toISOString()
    const dayStart = (() => { const t = new Date(now + 7 * 3600_000); t.setUTCHours(0, 0, 0, 0); return new Date(t.getTime() - 7 * 3600_000).toISOString() })()
    const tenant = { id: 'fixture', name: 'เทศบาลตำบลน้ำเลา', org_type: 'เทศบาลตำบล', district: 'ร้องกวาง', province: 'แพร่', phone: '054-522-092', logo_url: '/logo.png' }
    const base = { amphoe_name: 'ร้องกวาง', province_name: 'แพร่', tambon_name: 'น้ำเลา', river_name: null, is_primary: false }
    const dam = (extra = {}) => ({
      ...base, station_type: 'dam', station_code: '305', station_name: 'อ่างเก็บน้ำแม่คำปอง', distance_km: 3.6, is_primary: true, river_name: 'แม่คำปอง',
      recorded_at: dayStart, storage_percent: 105.1, dam_storage_mcm: 7.1, dam_capacity_mcm: 6.76, dam_inflow_mcm: 0.16, dam_released_mcm: 0.16, ...extra,
    })
    const rain = (code, name, mm, extra = {}) => ({
      ...base, station_type: 'rain', station_code: code, station_name: name, distance_km: 2.6, recorded_at: ago(0.5), rain_24h_mm: mm, rain_1h_mm: null, ...extra,
    })
    // อ่างตำบลข้างเคียง ห่าง 4.3 กม. — การ์ด "อ่างใกล้เคียง" มุมขวาของกรอบข้อควรทำ
    const maeThang = dam({ station_code: '310', station_name: 'อ่างเก็บน้ำแม่ถาง', distance_km: 4.3, is_primary: false, tambon_name: 'บ้านเวียง', river_name: 'แม่ถาง', storage_percent: 50.6, dam_storage_mcm: 15.5, dam_capacity_mcm: 30.62 })
    const contacts = [{ label: 'มูลนิธิเพชรเกษมแพร่', number: '054-068-199' }, { label: 'กู้ชีพ / EMS', number: '1669' }, { label: 'ตำรวจ', number: '191' }]
    // สถานีเตือนภัยน้ำหลาก-ดินถล่ม (รหัสสถานี E1 ตรงกับสถานีวัดฝนที่ใช้หาค่าฝนของสถานี) · สถานีระดับน้ำ + ค่าก่อนหน้า 3 ชม.
    const ewsRow = (lv, text, extra = {}) => ({
      ...base, station_type: 'ews', station_code: 'E1', station_name: 'สถานีเตือนภัยบ้านห้วยขึม', distance_km: 5, is_primary: true, recorded_at: ago(1),
      note: 'หมู่บ้านที่สถานีดูแล: บ้านห้วยทรายขาว, บ้านน้ำเลาใต้', situation_level: lv, situation_text: text, situation_color: '#dc2626', ...extra,
    })
    const levelRow = (diff, extra = {}) => ({
      ...base, station_type: 'waterlevel', station_code: 'W1', station_name: 'บ้านน้ำปุ๊', river_name: 'แม่น้ำยม', distance_km: 6, recorded_at: ago(0.5),
      bank_diff_m: diff, waterlevel_msl: 123.45, prev_waterlevel_msl: 123.1, prev_recorded_at: ago(3), ...extra,
    })
    const longWarn = [{ message: 'ประกาศ สสน. ระบุว่าเฝ้าระวังฝนตกหนักถึงหนักมากและน้ำป่าไหลหลากบริเวณเชิงเขาและริมลำน้ำสาขาในพื้นที่ตำบลและตำบลข้างเคียงต่อเนื่องตลอดคืนนี้ถึงเช้า', issued_at: ago(2) }]
    const villages = Array.from({ length: 9 }, (_, i) => `บ้านห้วยทรายขาวหมู่ที่ ${i + 1}`).join(', ')
    const scenes = {
      // ── ภาพสถานีเตือนภัย / น้ำเสมอ-สูงกว่าตลิ่ง ──
      ewsCritical: {
        ews: [ewsRow(3, 'วิกฤติ')], dams: [dam({ storage_percent: 62.4, dam_released_mcm: 0.21 }), maeThang],
        rain: [rain('E1', 'สถานีวัดฝนห้วยขึม', 96.5, { is_primary: true, rain_1h_mm: 12 }), rain('R2', 'บ้านบุญแจ่ม', 58, { is_primary: true, distance_km: 2.9 })], contacts,
      },
      ewsPrepare: { ews: [ewsRow(2, 'เตรียมพร้อม', { note: null })], contacts },
      overbank: {
        levels: [levelRow(-0.35)], dams: [maeThang],
        rain: [rain('R1', 'บ้านบุญแจ่ม', 60, { is_primary: true }), rain('R2', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', 38, { is_primary: true, distance_km: 2.9 })], contacts,
      },
      overbankAtBank: { levels: [levelRow(0, { prev_waterlevel_msl: null })], contacts },
      // เค้นสุดทาง: ชื่อสถานี/หมู่บ้าน/ชื่อ อปท. ยาวมาก + ข้อความ สสน. 2 บรรทัด + เบอร์ 3 เบอร์ + อ่างประกอบ + อ่างใกล้เคียง + ฝนของสถานี
      ewsStress: {
        tenant: { ...tenant, name: 'เทศบาลตำบลน้ำเลาทุ่งแค้วใหญ่มากมายเกินจริง' },
        ews: [ewsRow(3, 'วิกฤติ', { station_name: 'สถานีเตือนภัยน้ำหลากดินถล่มบ้านห้วยขึมโยธินอุทกพัฒนาตอนบนและตอนล่างหมู่ที่สิบสอง', note: `หมู่บ้านที่สถานีดูแล: ${villages}` })],
        dams: [dam({ station_name: 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', storage_percent: 97.4 }), maeThang],
        rain: [
          rain('E1', 'สถานีวัดฝนบ้านบุญแจ่มหมู่ที่สิบสองตำบลน้ำเลา', 148.2, { is_primary: true, rain_1h_mm: 0 }),
          rain('R2', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', 120.5, { is_primary: true, distance_km: 2.9 }),
        ],
        warnings: longWarn, contacts,
      },
      overbankStress: {
        tenant: { ...tenant, name: 'เทศบาลตำบลน้ำเลาทุ่งแค้วใหญ่มากมายเกินจริง' },
        levels: [levelRow(-1.45, { station_name: 'แม่น้ำยมที่สถานีวัดระดับน้ำบ้านน้ำปุ๊ตอนล่างใกล้สะพานข้ามแม่น้ำ', river_name: 'แม่น้ำยมสายหลักช่วงตอนล่างของจังหวัด' })],
        dams: [maeThang],
        rain: [rain('R1', 'สถานีวัดฝนบ้านบุญแจ่มหมู่ที่สิบสองตำบลน้ำเลา', 148.2, { is_primary: true }), rain('R2', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', 120.5, { is_primary: true, distance_km: 2.9 })],
        warnings: longWarn, contacts,
      },
      dam: { dams: [dam(), maeThang], rain: [rain('R1', 'บ้านบุญแจ่ม', 3.5, { is_primary: true }), rain('R2', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', 0, { is_primary: true, distance_km: 2.9, recorded_at: ago(1) })], contacts },
      rain: {
        dams: [dam({ storage_percent: 86.4, dam_released_mcm: 0.21 }), maeThang],
        rain: [rain('R1', 'บ้านบุญแจ่ม', 96.5, { is_primary: true, rain_1h_mm: 12 }), rain('R2', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', 58, { is_primary: true, distance_km: 2.9, recorded_at: ago(1) })],
        warnings: [{ message: 'เฝ้าระวังฝนตกหนักและน้ำป่าไหลหลาก', issued_at: ago(2) }], contacts,
      },
      // เค้นสุดทาง: ชื่อยาวมาก + ไม่มีตรา + ไม่มีเบอร์สำนักงาน/สายด่วน + ข้อความ สสน. ยาว
      // (ไม่ใส่ levels/ews ในฉากนี้: ลำดับหัวภาพให้ EWS/ล้นตลิ่งเป็นหัวภาพเอง ฉากนี้จึงเป็นภาพอ่างล้วน)
      stress: {
        tenant: { ...tenant, name: 'องค์การบริหารส่วนตำบลทุ่งแค้วใหญ่มากมายเกินจริง', org_type: 'อบต.', phone: null, logo_url: '/missing-logo.png' },
        dams: [dam({ station_name: 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนาตอนบนและตอนล่างพื้นที่ลุ่มน้ำแม่คำปอง', storage_percent: 118.7, river_name: null })],
        rain: [rain('R1', 'สถานีวัดฝนบ้านบุญแจ่มหมู่ที่สิบสองตำบลน้ำเลา', 101.2, { is_primary: true })],
        warnings: [{ message: 'ประกาศ สสน. ระบุว่าเฝ้าระวังฝนตกหนักถึงหนักมากและน้ำป่าไหลหลากบริเวณเชิงเขาและริมลำน้ำสาขาในพื้นที่ตำบลและตำบลข้างเคียงต่อเนื่องตลอดคืนนี้ถึงเช้า', issued_at: ago(2) }],
        contacts: [],
      },
      // ประโยควิเคราะห์ฝนครบ 3 ประโยค (ฝนหยุดแล้ว + วงกว้าง + อ่างประกอบน้ำมาก) + ข้อความ สสน. ยาว + เบอร์ 3 เบอร์ ต้องไม่ล้นแถบล่าง
      // (ไม่ใส่ ews ในฉากนี้: ลำดับหัวภาพให้ EWS เป็นหัวภาพเอง ฉากนี้จึงเป็นภาพฝนล้วน)
      rainStress: {
        dams: [dam({ station_name: 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', storage_percent: 97.4 }), maeThang],
        rain: [
          rain('R1', 'บ้านบุญแจ่ม', 148.2, { is_primary: true, rain_1h_mm: 0 }),
          rain('R2', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', 120.5, { is_primary: true, distance_km: 2.9 }),
          rain('R3', 'บ้านแม่ยางตาล', 95.0, { distance_km: 7.4 }),
        ],
        warnings: [{ message: 'ประกาศ สสน. ระบุว่าเฝ้าระวังฝนตกหนักถึงหนักมากและน้ำป่าไหลหลากบริเวณเชิงเขาและริมลำน้ำสาขาในพื้นที่ตำบลและตำบลข้างเคียงต่อเนื่องตลอดคืนนี้ถึงเช้า', issued_at: ago(2) }],
        contacts,
      },
    }
    const out = {}
    for (const [key, scene] of Object.entries(scenes)) {
      const model = buildPosterModel({ rain: [], ews: [], levels: [], dams: [], warnings: [], tenant, now, ...scene })
      if (!model) { out[key] = { model: null }; continue }
      try {
        const { blob, layout } = await renderWaterAlertPoster(model, { logoUrl: (scene.tenant ?? tenant).logo_url })
        const buffer = new Uint8Array(await blob.arrayBuffer())
        let binary = ''
        for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000))
        out[key] = { kind: model.kind, size: blob.size, type: blob.type, png: btoa(binary), layout, phones: model.phones.length }
      } catch (error) {
        out[key] = { error: String(error?.message ?? error) }
      }
    }
    return out
  })

  const pngSize = base64 => {
    const buffer = Buffer.from(base64, 'base64')
    assert.equal(buffer.subarray(1, 4).toString('latin1'), 'PNG')
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }

  const names = {
    dam: 'water-alert-dam-105.1', rain: 'water-alert-rain-96.5', stress: 'water-alert-stress', rainStress: 'water-alert-rain-stress',
    ewsCritical: 'ews-critical', ewsPrepare: 'ews-prepare', overbank: 'overbank', overbankAtBank: 'overbank-atbank', ewsStress: 'ews-stress', overbankStress: 'overbank-stress',
  }
  for (const key of Object.keys(names)) {
    const r = result[key]
    assert.ok(r && !r.error && r.model !== null, `${key}: วาดภาพไม่สำเร็จ ${r?.error ?? ''}`)
    // เขียนภาพก่อนตรวจเลย์เอาต์ — ล้มแล้วยังเปิดดูได้ว่าล้นตรงไหน
    await writeFile(path.join(SHOT_DIR, `${names[key]}.png`), Buffer.from(r.png, 'base64'))
    assert.equal(r.type, 'image/png', `${key}: ชนิดไฟล์`)
    assert.ok(r.size > 50_000, `${key}: ไฟล์เล็กผิดปกติ ${r.size} B`)
    assert.deepEqual(pngSize(r.png), { width: 1080, height: 1350 }, `${key}: ขนาดภาพ`)
    assert.deepEqual(r.layout.issues, [], `${key}: ข้อความล้นกรอบ/เนื้อหาล้น ${JSON.stringify(r.layout.issues)}`)
    assert.equal(r.layout.fits, true, `${key}: เนื้อหาล้นแถบล่าง`)
    assert.equal(r.layout.kanitLoaded, true, `${key}: ฟอนต์ Kanit ไม่โหลด`)
  }
  assert.equal(result.dam.kind, 'dam')
  assert.equal(result.rain.kind, 'rain')
  assert.equal(result.rainStress.kind, 'rain')
  assert.equal(result.stress.kind, 'dam')
  // หัวภาพใหม่: สถานีเตือนภัย (ระดับ 3/2) และน้ำเสมอ/สูงกว่าตลิ่ง
  assert.deepEqual(['ewsCritical', 'ewsPrepare', 'ewsStress'].map(k => result[k].kind), ['ews', 'ews', 'ews'])
  assert.deepEqual(['overbank', 'overbankAtBank', 'overbankStress'].map(k => result[k].kind), ['overbank', 'overbank', 'overbank'])
  // ภาพปกติของหัวภาพใหม่: ประโยคในย่อหน้าขึ้นครบ + มีแถบเบอร์
  for (const key of ['ewsCritical', 'overbank']) {
    const { analysisShown, analysisTotal } = result[key].layout
    assert.ok(analysisTotal > 0, `${key}: ควรมีประโยควิเคราะห์`)
    assert.equal(analysisShown, analysisTotal, `${key}: ประโยควิเคราะห์ถูกตัด ${analysisShown}/${analysisTotal}`)
  }
  for (const key of ['ewsCritical', 'ewsPrepare', 'overbank', 'overbankAtBank', 'ewsStress', 'overbankStress']) {
    assert.equal(result[key].layout.blocks.some(b => b.name === 'call'), true, `${key}: ต้องมีแถบเบอร์`)
  }
  // ฉากเค้น: เบอร์ 3 เบอร์อยู่ครบ + ภาพยังไม่ล้นแม้ข้อความยาวสุด (issues/fits ตรวจในลูปข้างบนแล้ว)
  assert.equal(result.ewsStress.phones, 3)
  assert.equal(result.overbankStress.phones, 3)
  console.log('stress analysis shown:', { ewsStress: `${result.ewsStress.layout.analysisShown}/${result.ewsStress.layout.analysisTotal}`, overbankStress: `${result.overbankStress.layout.analysisShown}/${result.overbankStress.layout.analysisTotal}`, tight: [result.ewsStress.layout.tight, result.overbankStress.layout.tight] })
  // ประโยควิเคราะห์: ภาพปกติขึ้นครบ · ภาพเค้นสุดทางตัดประโยคท้ายทิ้งทีละประโยคจนพอดี (ไม่ตัดกลางประโยค)
  for (const key of ['dam', 'rain']) {
    const { analysisShown, analysisTotal } = result[key].layout
    assert.ok(analysisTotal > 0, `${key}: ควรมีประโยควิเคราะห์`)
    assert.equal(analysisShown, analysisTotal, `${key}: ประโยควิเคราะห์ถูกตัด ${analysisShown}/${analysisTotal}`)
  }
  assert.equal(result.rainStress.layout.analysisTotal, 3)
  assert.ok(result.rainStress.layout.analysisShown >= 1, 'ภาพเค้นสุดทางยังต้องเหลือประโยควิเคราะห์อย่างน้อย 1')
  console.log('analysis shown:', Object.fromEntries(Object.entries(result).map(([k, r]) => [k, `${r.layout.analysisShown}/${r.layout.analysisTotal}`])))
  assert.equal(result.dam.layout.logoLoaded, true, 'ตราจาก URL ต้องโหลดและวาดได้')
  assert.equal(result.stress.layout.logoLoaded, false, 'ตรา 404 = วาดต่อได้โดยไม่มีตรา')
  // ไม่มีเบอร์ = แถบเบอร์หาย
  assert.equal(result.stress.phones, 0)
  assert.equal(result.stress.layout.blocks.some(b => b.name === 'call'), false, 'ไม่มีเบอร์ต้องไม่มีแถบโทรโข่ง')
  assert.equal(result.dam.layout.blocks.some(b => b.name === 'call'), true)
  // อ่างใกล้เคียง: ภาพปกติต้องมีการ์ด · ภาพเค้นสุดทาง (ข้อความข้อควรทำยาว) มีหรือไม่มีก็ได้ แต่ห้ามทำให้ล้น (ตรวจ issues/fits ข้างบนแล้ว)
  assert.equal(result.dam.layout.nearbyShown, true, 'ภาพอ่างต้องมีการ์ดอ่างใกล้เคียง (แม่ถาง 4.3 กม.)')
  assert.equal(result.rain.layout.nearbyShown, true, 'ภาพฝนต้องมีการ์ดอ่างใกล้เคียง')
  assert.equal(result.stress.layout.nearbyShown, false, 'ไม่มีอ่างใน 5 กม. = ไม่มีการ์ด')
  console.log('nearby dam shown:', Object.fromEntries(Object.entries(result).map(([k, r]) => [k, r.layout.nearbyShown])))
  assert.deepEqual(pageErrors, [], `เกิด error ในหน้าทดสอบ: ${pageErrors.join(' | ')}`)

  console.log('PASS: PNG 1080x1350 (dam 105.1 / rain 96.5 / ews critical+prepare / overbank over+at-bank / stress), toBlob ok with logo from URL, logo 404 still renders, no text overflow, no phone strip without numbers, no SVG/ctx.filter in drawing code')
  console.log(`ภาพตัวอย่าง: ${SHOT_DIR}`)
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await browser.close()
  await server.close()
}
if (failed) process.exit(1)

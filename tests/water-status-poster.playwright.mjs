// E2E ภาพรายงานสถานการณ์น้ำ-ฝนทุกสถานการณ์ (buildStatusPosterModel + ชุดสีใน waterAlertPosterImage.js) ใน Chrome จริง
//
// ตรวจ: PNG 1080×1350 · ข้อความไม่ล้นกรอบ · เนื้อหาไม่ล้นแถบล่าง · สถานะตรงตามกฎ (ปกติ/น้ำน้อย/น้ำน้อยวิกฤติ/เฝ้าระวัง/ข้อมูลไม่ครบ)
//   · ข้อความในภาพไม่มีคำประกาศภัยแล้ง · ภาพแจ้งเตือนเดิมยังวาดได้ภาพเดิมทุกพิกเซล (ถ้ามีสำเนาตัววาดเดิม __orig_waterAlertPosterImage.js)
//   · ภาพตัวอย่างอยู่ที่ tmp-shots/status-*.png (ไม่ git add)
// ไม่แตะฐานข้อมูล/เครือข่ายของระบบ: vite ชั่วคราวพอร์ตสุ่ม · ค่าสถานีเป็น fixture ทั้งหมด

import assert from 'node:assert/strict'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { createServer } from 'vite'

process.env.SKIP_SYNC_CHECK = '1'
const SHOT_DIR = path.join(process.cwd(), 'tmp-shots')
await mkdir(SHOT_DIR, { recursive: true })
const hasOrig = await access(path.join(process.cwd(), 'src/lib/__orig_waterAlertPosterImage.js')).then(() => true, () => false)

const server = await createServer({
  root: process.cwd(),
  cacheDir: path.join(tmpdir(), 'smartlocal-water-status-poster-vite', path.basename(process.cwd())),
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
  await page.goto(`${base}/__poster-test.html`)

  const result = await page.evaluate(async hasOrig => {
    const { buildPosterModel, buildStatusPosterModel } = await import('/src/lib/waterAlertPoster.js')
    const { renderWaterAlertPoster } = await import('/src/lib/waterAlertPosterImage.js')
    const orig = hasOrig ? await import('/src/lib/__orig_waterAlertPosterImage.js') : null
    const now = Date.now()
    const ago = hours => new Date(now - hours * 3600_000).toISOString()
    const dayStart = (() => { const t = new Date(now + 7 * 3600_000); t.setUTCHours(0, 0, 0, 0); return new Date(t.getTime() - 7 * 3600_000).toISOString() })()
    const tenant = { id: 'fixture', name: 'เทศบาลตำบลน้ำเลา', org_type: 'เทศบาลตำบล', district: 'ร้องกวาง', province: 'แพร่', phone: '054-522-092', logo_url: '/logo.png' }
    const baseRow = { amphoe_name: 'ร้องกวาง', province_name: 'แพร่', tambon_name: 'น้ำเลา', river_name: null, is_primary: false }
    const dam = (extra = {}) => ({
      ...baseRow, station_type: 'dam', station_code: '305', station_name: 'อ่างเก็บน้ำแม่คำปอง', distance_km: 3.6, is_primary: true, river_name: 'แม่คำปอง',
      recorded_at: dayStart, storage_percent: 72.4, dam_storage_mcm: 4.89, dam_capacity_mcm: 6.76, dam_inflow_mcm: 0.04, dam_released_mcm: 0.03, ...extra,
    })
    const rain = (code, name, mm, extra = {}) => ({
      ...baseRow, station_type: 'rain', station_code: code, station_name: name, distance_km: 2.6, recorded_at: ago(0.5), rain_24h_mm: mm, rain_1h_mm: null, ...extra,
    })
    const levelRow = (diff, extra = {}) => ({
      ...baseRow, station_type: 'waterlevel', station_code: 'W1', station_name: 'บ้านน้ำปุ๊', river_name: 'แม่น้ำยม', distance_km: 6, recorded_at: ago(0.5),
      bank_diff_m: diff, waterlevel_msl: 121.2, prev_waterlevel_msl: 121.05, prev_recorded_at: ago(3), ...extra,
    })
    const maeThang = dam({ station_code: '310', station_name: 'อ่างเก็บน้ำแม่ถาง', distance_km: 4.3, is_primary: false, tambon_name: 'บ้านเวียง', river_name: 'แม่ถาง', storage_percent: 50.6, dam_storage_mcm: 15.5, dam_capacity_mcm: 30.62 })
    const contacts = [{ label: 'มูลนิธิเพชรเกษมแพร่', number: '054-068-199' }, { label: 'กู้ชีพ / EMS', number: '1669' }, { label: 'ตำรวจ', number: '191' }]
    const twoRain = (a, b, extra = {}) => [rain('R1', 'บ้านบุญแจ่ม', a, { is_primary: true, ...extra }), rain('R2', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', b, { is_primary: true, distance_km: 2.9, recorded_at: ago(1) })]

    const status = {
      normal: { dams: [dam(), maeThang], rain: twoRain(3.5, 0), levels: [levelRow(2.35)], contacts },
      // อ่างน้ำมาก 92% = ยังปกติ (ไม่ดันเป็นเฝ้าระวัง)
      normalHighDam: { dams: [dam({ storage_percent: 92.1, dam_storage_mcm: 6.23 })], rain: twoRain(12.4, 4), contacts },
      low: { dams: [dam({ storage_percent: 42.3, dam_storage_mcm: 2.86, dam_inflow_mcm: 0.01, dam_released_mcm: 0.04 }), maeThang], rain: twoRain(0, 0), contacts },
      lowCritical: { dams: [dam({ storage_percent: 24, dam_storage_mcm: 1.62, dam_inflow_mcm: 0, dam_released_mcm: 0.03 }), maeThang], rain: twoRain(0, 0), contacts },
      watchRain: { dams: [dam({ storage_percent: 86.4, dam_storage_mcm: 5.84, dam_released_mcm: 0.12 }), maeThang], rain: twoRain(52.4, 18.6, { rain_1h_mm: 6.2 }), contacts },
      watchLevel: { dams: [maeThang], levels: [levelRow(0.65)], rain: twoRain(28.5, 12), contacts },
      watchWarning: { dams: [dam()], rain: twoRain(8, 2), warnings: [{ message: 'เฝ้าระวังฝนตกหนักและน้ำป่าไหลหลากบริเวณเชิงเขาและริมลำน้ำ', issued_at: ago(2) }], contacts },
      // ค่าฝนเก่ากว่า 3 ชม. ทุกสถานี = ข้อมูลไม่ครบ (ห้ามขึ้นปกติ)
      nodata: { dams: [dam()], rain: twoRain(0, 0, { recorded_at: ago(9) }).map(r => ({ ...r, recorded_at: ago(9) })), contacts },
      // เค้นสุดทาง: ชื่อยาวมาก ไม่มีตรา ไม่มีเบอร์
      lowStress: {
        tenant: { ...tenant, name: 'องค์การบริหารส่วนตำบลทุ่งแค้วใหญ่มากมายเกินจริง', org_type: 'อบต.', phone: null, logo_url: null },
        dams: [dam({ station_name: 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนาตอนบนและตอนล่างพื้นที่ลุ่มน้ำแม่คำปอง', storage_percent: 18.2, dam_storage_mcm: 1.23 })],
        rain: [rain('R1', 'สถานีวัดฝนบ้านบุญแจ่มหมู่ที่สิบสองตำบลน้ำเลา', 0, { is_primary: true })], contacts: [],
      },
    }
    // ภาพแจ้งเตือนเดิม (เทียบพิกเซลกับตัววาดเดิม)
    const alertScenes = {
      dam: { dams: [dam({ storage_percent: 105.1, dam_storage_mcm: 7.1, dam_inflow_mcm: 0.16, dam_released_mcm: 0.16 }), maeThang], rain: twoRain(3.5, 0), contacts },
      rain: { dams: [dam({ storage_percent: 86.4 }), maeThang], rain: twoRain(96.5, 58, { rain_1h_mm: 12 }), warnings: [{ message: 'เฝ้าระวังฝนตกหนักและน้ำป่าไหลหลาก', issued_at: ago(2) }], contacts },
      overbank: { levels: [levelRow(-0.35)], dams: [maeThang], rain: twoRain(60, 38), contacts },
    }
    const toB64 = async blob => {
      const buffer = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000))
      return btoa(binary)
    }
    const empty = { rain: [], ews: [], levels: [], dams: [], warnings: [], tenant, now }
    const out = { status: {}, alert: {} }
    for (const [key, scene] of Object.entries(status)) {
      const input = { ...empty, ...scene }
      if (buildPosterModel(input)) { out.status[key] = { error: 'เป็นภาพแจ้งเตือน ไม่ใช่ภาพสถานะ' }; continue }
      const model = buildStatusPosterModel(input)
      try {
        const { blob, layout } = await renderWaterAlertPoster(model, { logoUrl: input.tenant?.logo_url ?? null })
        const allText = JSON.stringify({ ...model, introFor: undefined })
        out.status[key] = { state: model.state, reason: model.reason, banner: model.banner, level: model.headline.level, png: await toB64(blob), size: blob.size, layout, allText }
      } catch (error) {
        out.status[key] = { error: String(error?.stack ?? error) }
      }
    }
    for (const [key, scene] of Object.entries(alertScenes)) {
      const input = { ...empty, ...scene }
      const model = buildPosterModel(input)
      const now1 = await renderWaterAlertPoster(model, { logoUrl: tenant.logo_url })
      const before = orig ? await orig.renderWaterAlertPoster(model, { logoUrl: tenant.logo_url }) : null
      out.alert[key] = { kind: model.kind, statusNull: buildStatusPosterModel(input) === null, same: before ? (await toB64(now1.blob)) === (await toB64(before.blob)) : null }
    }
    return out
  }, hasOrig)

  const names = {
    normal: 'status-normal', normalHighDam: 'status-normal-dam92', low: 'status-low-42', lowCritical: 'status-low-critical-24',
    watchRain: 'status-watch-rain', watchLevel: 'status-watch-level', watchWarning: 'status-watch-warning', nodata: 'status-nodata', lowStress: 'status-low-stress',
  }
  const expectState = {
    normal: ['normal', 'none'], normalHighDam: ['normal', 'none'], low: ['low', 'low'], lowCritical: ['low', 'critical'],
    watchRain: ['watch', 'rain'], watchLevel: ['watch', 'level'], watchWarning: ['watch', 'warning'], nodata: ['nodata', 'missing'], lowStress: ['low', 'critical'],
  }
  const problems = []
  for (const [key, file] of Object.entries(names)) {
    const r = result.status[key]
    if (!r || r.error) { problems.push(`${key}: ${r?.error}`); continue }
    await writeFile(path.join(SHOT_DIR, `${file}.png`), Buffer.from(r.png, 'base64'))
    if (r.layout.issues.length) problems.push(`${key}: ล้น ${JSON.stringify(r.layout.issues)}`)
    if (!r.layout.fits) problems.push(`${key}: เนื้อหาล้นแถบล่าง`)
    if (r.state !== expectState[key][0] || r.reason !== expectState[key][1]) problems.push(`${key}: สถานะ ${r.state}/${r.reason} ≠ ${expectState[key].join('/')}`)
    if (/ภัยแล้ง/.test(r.allText)) problems.push(`${key}: มีคำว่า ภัยแล้ง ในภาพ`)
    console.log(`${key}: ${r.state}/${r.reason} "${r.banner}" · ${r.level} · analysis ${r.layout.analysisShown}/${r.layout.analysisTotal} · tight ${r.layout.tight} · gap ${r.layout.gap} · nearby ${r.layout.nearbyShown}`)
  }
  for (const [key, r] of Object.entries(result.alert)) {
    console.log(`alert ${key}: kind ${r.kind} · statusNull ${r.statusNull} · ภาพเหมือนตัววาดเดิม ${r.same}`)
    if (!r.statusNull) problems.push(`alert ${key}: buildStatusPosterModel ต้องคืน null เมื่อมีเรื่องแจ้งเตือน`)
    if (r.same === false) problems.push(`alert ${key}: ภาพแจ้งเตือนเปลี่ยนจากเดิม`)
  }
  assert.deepEqual(pageErrors, [], `error ในหน้าทดสอบ: ${pageErrors.join(' | ')}`)
  assert.deepEqual(problems, [])
  console.log(`PASS ภาพตัวอย่าง: ${SHOT_DIR}`)
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await browser.close()
  await server.close()
}
if (failed) process.exit(1)

// เทสต์ไอคอนแอป maskable: สัดส่วนภาพที่หน้าตั้งค่าสร้าง + เงื่อนไขคัดไอคอนลง manifest ของ worker
// รันด้วย: node tests/app-icon.test.mjs
import assert from 'node:assert/strict'
import { appIconLayout, APP_ICON_SIZE, APP_ICON_LOGO_RATIO } from '../src/lib/appIcon.js'
import { buildIcons, FALLBACK_ICONS } from '../worker/manifestIcons.js'

// ── appIconLayout: ตราต้องอยู่ใน safe zone (วงกลมรัศมี 40% กลางภาพ) ──
{
  const square = appIconLayout(512, 512)
  assert.deepEqual(square, { x: 51, y: 51, width: 410, height: 410 })
  // ตราวงกลมกว้าง 80% = เส้นผ่านศูนย์กลาง safe zone พอดี ไม่เกิน
  assert.ok(square.width <= APP_ICON_SIZE * APP_ICON_LOGO_RATIO + 1)

  // โลโก้เก่าน้ำเลา 400x406 — ไม่จัตุรัส ต้องไม่ยืด และด้านยาวไม่ล้นกล่อง 80%
  const tall = appIconLayout(400, 406)
  assert.equal(tall.height, 410)
  assert.equal(tall.width, 404)
  assert.equal(tall.x + tall.width / 2, APP_ICON_SIZE / 2)

  // โลโก้เล็กกว่ากรอบก็ขยายขึ้นมาเต็ม 80%
  assert.equal(appIconLayout(120, 120).width, 410)
  const wide = appIconLayout(1000, 500)
  assert.equal(wide.width, 410)
  assert.equal(wide.height, 205)

  assert.throws(() => appIconLayout(0, 512))
  assert.throws(() => appIconLayout(NaN, 512))
}

// ── buildIcons ──
const ORIGIN = 'https://umxssfahtuprnztlytdd.supabase.co'
const LOGO = `${ORIGIN}/storage/v1/object/public/municipality-assets/logos/logo-namlao.png?v=1`
const ICON = `${ORIGIN}/functions/v1/drive-file?id=abc&v=2`
const sizes = map => async url => {
  if (!(url in map)) throw new Error(`ไม่ควรยิง ${url}`)
  const value = map[url]
  if (value instanceof Error) throw value
  return value
}

// ไม่มีโลโก้ ไม่มีไอคอน → ไอคอนสำรองชุดเดิม
assert.deepEqual(await buildIcons({}, ORIGIN, sizes({})), FALLBACK_ICONS)

// โลโก้อย่างเดียว (สถานะก่อน backfill) → เหมือนพฤติกรรมเดิมทุกอย่าง ไม่มี maskable
{
  const icons = await buildIcons({ logo_url: LOGO }, ORIGIN, sizes({ [LOGO]: { width: 512, height: 512 } }))
  assert.deepEqual(icons.map(i => [i.sizes, i.purpose]), [['192x192', 'any'], ['512x512', 'any']])
  assert.equal(icons[1].src, LOGO)
  assert.ok(icons.every(i => i.purpose === 'any'))
}

// โลโก้ + ไอคอน → เพิ่ม maskable ต่อท้าย
{
  const icons = await buildIcons(
    { logo_url: LOGO, app_icon_url: ICON },
    ORIGIN,
    sizes({ [LOGO]: { width: 480, height: 480 }, [ICON]: { width: 512, height: 512 } }),
  )
  assert.equal(icons.length, 4)
  assert.deepEqual(icons.at(-1), { src: ICON, sizes: '512x512', type: 'image/png', purpose: 'maskable' })
  assert.equal(icons.filter(i => i.purpose === 'maskable').length, 1)
}

// ไอคอนอยู่นอกโดเมนที่ไว้ใจ → ไม่ยิงอ่านเลย และไม่ใส่ลง manifest
{
  const evil = 'https://evil.example/icon.png'
  const icons = await buildIcons({ logo_url: LOGO, app_icon_url: evil }, ORIGIN, sizes({ [LOGO]: { width: 512, height: 512 } }))
  assert.ok(!icons.some(i => i.purpose === 'maskable'))
  const withCreds = `https://user:pw@${ORIGIN.slice(8)}/x.png`
  const icons2 = await buildIcons({ app_icon_url: withCreds }, ORIGIN, sizes({}))
  assert.deepEqual(icons2, FALLBACK_ICONS)
  const http = ICON.replace('https:', 'http:')
  assert.deepEqual(await buildIcons({ app_icon_url: http }, ORIGIN, sizes({})), FALLBACK_ICONS)
}

// ไอคอนไม่จัตุรัส / เล็กเกิน / อ่านไม่ได้ / ไม่ใช่ PNG → ข้าม maskable แต่โลโก้ยังอยู่
for (const bad of [{ width: 512, height: 500 }, { width: 128, height: 128 }, new Error('timeout'), null]) {
  const icons = await buildIcons(
    { logo_url: LOGO, app_icon_url: ICON },
    ORIGIN,
    sizes({ [LOGO]: { width: 512, height: 512 }, [ICON]: bad }),
  )
  assert.ok(!icons.some(i => i.purpose === 'maskable'), `ไม่ควรมี maskable เมื่อ ${JSON.stringify(bad?.message ?? bad)}`)
  assert.equal(icons.at(-1).src, LOGO)
}

// โลโก้พังแต่ไอคอนใช้ได้ → ไอคอนสำรอง + maskable (ติดตั้งได้ และหน้าจอยังได้ตรา)
{
  const icons = await buildIcons(
    { logo_url: LOGO, app_icon_url: ICON },
    ORIGIN,
    sizes({ [LOGO]: new Error('timeout'), [ICON]: { width: 512, height: 512 } }),
  )
  assert.deepEqual(icons.slice(0, 2), FALLBACK_ICONS)
  assert.equal(icons[2].purpose, 'maskable')
}

// อ่านสองไฟล์พร้อมกัน ไม่ใช่ทีละตัว
{
  let inFlight = 0
  let peak = 0
  const slow = async () => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise(r => setTimeout(r, 20))
    inFlight--
    return { width: 512, height: 512 }
  }
  await buildIcons({ logo_url: LOGO, app_icon_url: ICON }, ORIGIN, slow)
  assert.equal(peak, 2)
}

console.log('app-icon: ผ่านทั้งหมด')

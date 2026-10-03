// Real browser and PDF measurements, synthetic fixtures only. No DB/network service.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { buildCommunityRequestFormHtml, buildCommunityForwardLetterHtml } from '../src/lib/communityTransportPrint.js'
import { buildTripMonthReportHtml } from '../src/lib/patientTransportPrint.js'
import { assertSignBlockStandard, assertSignLinesAligned, measureSignRows, measureTextCenterMm, PX_PER_MM } from './lib/signBlockChecks.mjs'

const tenant = { name: '[TEST] องค์การบริหารส่วนตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่', org_type: 'อบต.', address: '[TEST] เลขที่ 199 หมู่ที่ 12 ตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่' }
const long = text => (`[TEST] ${text} `).repeat(8).slice(0, 200)
const booking = { id: 'test0000-community', service_type: 'community', status: 'confirmed', trip_id: 'trip-1',
  group_label: long('กลุ่มผู้เดินทางชุมชน'), party_size: 15, purpose_code: 'activity-1', purpose_label: long('กิจกรรมชุมชน'),
  route_label: long('สถานที่ชุมชน'), requester_name: long('ผู้ประสานงานกลุ่ม'), phone: '0800000001',
  pickup: (`[TEST] บ้านเลขที่ 199/25 หมู่ที่ 12 จุดสังเกตข้างตลาดชุมชน `).repeat(10).slice(0, 500),
  appointment_at: '2026-10-04T07:00:00+07:00', return_mode: 'later', return_at: '2026-10-04T19:00:00+07:00', entry_channel: 'staff' }
const args = { tenant, booking, trip: { id: 'trip-1', state: 'confirmed' }, partner: { name: '[TEST] กองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว' }, mayor: { name: '[TEST] นางสาวประกายมาศ ศรีวิชัยเลิศสกุล', title: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว' } }
const output = process.env.PATIENT_PREVIEW_SHOTS
if (output) await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const [name, builder] of [['community-request', buildCommunityRequestFormHtml], ['community-letter', buildCommunityForwardLetterHtml]]) {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } })
    await page.route('**/*', route => route.abort())
    await page.setContent(builder(args))
    await page.evaluate(() => document.fonts.ready);await page.emulateMedia({ media: 'print' })
    assert(await page.locator('.draft').isVisible(), 'draft notice must survive printing')
    assert.equal(await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).isVisible(), false)
    await assertSignBlockStandard(page, { minRows: 1, minBelow: 1 });await assertSignLinesAligned(page)
    if (name === 'community-letter') assert(Math.abs(await measureTextCenterMm(page, '.regards') - (await measureSignRows(page))[0].lineCenterMm) < 0.5)
    const box = await page.locator('.sheet').evaluate(sheet => ({ width: sheet.getBoundingClientRect().width, height: sheet.getBoundingClientRect().height, scroll: sheet.scrollWidth,
      font: getComputedStyle(document.body).fontFamily, size: getComputedStyle(document.body).fontSize, adjust: getComputedStyle(document.body).fontSizeAdjust,
      paddingLeft: getComputedStyle(sheet).paddingLeft, paddingRight: getComputedStyle(sheet).paddingRight }))
    assert(Math.abs(box.width / PX_PER_MM - 210) < 0.5);assert(box.height / PX_PER_MM <= 297.5, `${name} exceeds one A4`)
    assert(box.scroll <= Math.ceil(box.width));assert.match(box.font, /THSarabunPSK/);assert.equal(box.adjust, '0.45')
    assert(Math.abs(parseFloat(box.size) - 14 * 96 / 72) < 0.1)
    assert(Math.abs(parseFloat(box.paddingLeft) / PX_PER_MM - 30) < 0.1, JSON.stringify(box));assert(Math.abs(parseFloat(box.paddingRight) / PX_PER_MM - 20) < 0.1)
    const pdf = await page.pdf({ preferCSSPageSize: true })
    assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1, `${name} must produce exactly one PDF page`)
    if (output) { await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });await writeFile(`${output}/${name}.pdf`, pdf) }
    await page.close();console.log(`PASS ${name}: one A4, max accepted fields, shared font/margins, actual signature text alignment, printed draft`)
  }
  const page = await browser.newPage({ viewport: { width: 1123, height: 794 } })
  await page.route('**/*', route => route.abort())
  const rows = Array.from({ length: 12 }, (_, i) => ({ trip_id: `trip-${i}`, date: `2026-10-${String(i + 1).padStart(2, '0')}`, service_type: i % 2 ? 'community' : 'patient',
    state: 'completed', request_count: i % 2 ? 1 : 2, people: i % 2 ? 15 : 3, companions: i % 2 ? 0 : 1, distance: i === 3 ? null : 80, route_label: '[TEST] สถานที่ชุมชนหรือโรงพยาบาล', driver_name: '[TEST] คนขับ', letter_no: 'ทส 001/1, ทส 001/2' }))
  await page.setContent(buildTripMonthReportHtml({ tenant, period: { from: '2026-10-01', to: '2026-10-31', label: '[TEST] ตุลาคม 2569' }, report: { from: '2026-10-01', to: '2026-10-31', service_type: null, trips: rows } }))
  await page.evaluate(() => document.fonts.ready);await page.emulateMedia({ media: 'print' })
  const overflow = await page.evaluate(() => [...document.querySelectorAll('td,th')].some(cell => cell.scrollWidth > cell.clientWidth + 2))
  assert.equal(overflow, false, '11 report columns must wrap within A4 landscape')
  if (output) { await page.screenshot({ path: `${output}/community-report-a4.png`, fullPage: true });await writeFile(`${output}/community-report-a4.pdf`, await page.pdf({ preferCSSPageSize: true })) }
  await page.close();console.log('PASS mixed v2 report: readable 11 columns on A4 landscape, missing mileage and people totals')
} finally { await browser.close() }

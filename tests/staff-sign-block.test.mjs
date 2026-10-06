// ช่องลงนามเจ้าหน้าที่ท้ายใบคำขอ — ตรวจครบทุกใบในหน้า "งานบริการประชาชน" ที่ใบเดียว
//
// เจ้าของระบบสั่ง 2569-10-05 ว่าคำขอทุกประเภทต้องมีช่องลงนามชุดเดียวกัน (หัวหน้าส่วนราชการ
// ที่ถือเรื่อง / ปลัด / นายก) และ "ต้องจบในแผ่นเดียว" เทสต์นี้จึงล็อกไว้ 4 เรื่อง:
//   1. ใบที่ประชาชนพิมพ์เอง (ไม่ส่ง signatories) ต้องไม่มีช่องลงนามเจ้าหน้าที่เลย
//   2. ใบที่เจ้าหน้าที่พิมพ์ต้องมีครบ 3 ช่อง และยังจบ 1 แผ่นแม้ข้อมูลยาวสุด
//   3. ยังไม่ได้ตั้งผู้ลงนาม = ได้เส้นประ + ชื่อตำแหน่งสำรอง ไม่ใช่ช่องหาย
//   4. ช่องลงนามได้มาตรฐานกลาง (วัดด้วย Range + getClientRects ผ่าน assertSignBlockStandard)
//
// ⚠️ เพิ่มคำขอประเภทใหม่เมื่อไหร่ ให้เพิ่มเข้า FORMS ที่นี่ด้วย
// รันด้วย: npm run test:staff-sign

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { buildWaterServiceFormHtml } from '../src/lib/waterSupplyRequestPrint.js'
import { buildWasteCollectionRequestHtml } from '../src/lib/wasteCollectionRequestPrint.js'
import { buildWasteCollectionCancelHtml } from '../src/lib/wasteCollectionCancelPrint.js'
import { buildPublicAssistanceRequestHtml } from '../src/lib/publicAssistancePrint.js'
import { buildBookingRequestFormHtml } from '../src/lib/patientTransportPrint.js'
import { assertSignBlockStandard } from './lib/signBlockChecks.mjs'

const TENANT = {
  name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว',
  org_type: 'อบต.',
  address: '100 หมู่ที่ 1 ตำบลทุ่งแค้ว\nอำเภอหนองม่วงไข่ จังหวัดแพร่',
  district: 'หนองม่วงไข่',
  province: 'แพร่',
}

// ชื่อยาวสุดที่เจอจริง + ที่อยู่สองชุด เพื่อให้ใบสูงที่สุดเท่าที่เป็นไปได้
const APPLICANT = {
  title: 'นางสาว', first: 'ประกายมาศ', last: 'ศรีวิชัยเลิศสกุล', age: 45, phone: '081-234-5678',
  addr_no: '199/128', addr_moo: '12',
  addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
  nat_id: '1234567890123',
}
const SITE = {
  addr_no: '456/78', addr_moo: '9',
  addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
}
const SIGNED = { channel: 'online', name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล' }

const SIGNATORIES = {
  department_head: { name: 'นายเอกชัย รินทร์ นาเหล็ง', title: 'ผู้อำนวยการกองช่าง' },
  clerk: { name: 'นายปริญญา เทียบแสน', title: 'ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว' },
  mayor: { name: 'นายกันตพงษ์ คำปลูก', title: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว' },
}
const EMPTY_SIGNATORIES = { department_head: null, clerk: null, mayor: null }

function waterForm(type) {
  return {
    form_type: type, form_version: 1, applicant: APPLICANT, same_as_applicant: false, site: SITE,
    service_start_date: '2026-10-01', effective_date: '2026-10-01',
    reason: 'มาตรวัดน้ำชำรุด หมุนไม่ตรงกับปริมาณน้ำที่ใช้จริง',
    account_no: 'WTR-2569-000123', meter_ack: true,
    meter_point: { lat: 18.258742, lng: 100.308329, address: 'บ้านทุ่งแค้ว หมู่ 12' },
    signed_at: '2026-09-14T20:37:00', signed_by: SIGNED,
  }
}

const WASTE_FORM = {
  applicant: APPLICANT, same_as_applicant: false, site: SITE,
  service_start_date: '2026-10-01', effective_date: '2026-10-01',
  bin_count: 2, waste_type: 'ขยะทั่วไป',
  reason: 'ย้ายออกจากพื้นที่ ไม่มีผู้พักอาศัยในบ้านหลังนี้แล้ว',
  collection_point: { lat: 18.258742, lng: 100.308329, address: 'หน้าบ้านริมถนนสายหลัก' },
  signed_by: SIGNED,
}

const ASSISTANCE_FORM = {
  form_type: 'public_assistance_request', form_version: 1, applicant: APPLICANT,
  problem: 'บ้านพักอาศัยได้รับความเสียหายจากวาตภัย หลังคาเปิดทั้งหลัง ฝนตกน้ำรั่วเข้าบ้านทุกวัน'
    + ' ไม่มีเงินซ่อมเอง ครอบครัวมีผู้สูงอายุติดเตียงและเด็กเล็กอาศัยอยู่ด้วย',
  need: 'ขอรับการสนับสนุนวัสดุมุงหลังคาและช่างซ่อมแซม พร้อมเครื่องอุปโภคบริโภคที่จำเป็น',
  affected: [
    { name: 'นายสมชาย ใจดี', age: 70, relation: 'บิดา' },
    { name: 'เด็กหญิงสมหญิง ใจดี', age: 6, relation: 'บุตร' },
  ],
}

// คำขอรถรับ-ส่งผู้ป่วยในระบบจองคิว (เจ้าของระบบสั่ง 2569-10-06) — ข้อมูลยาวสุดที่เจอจริงเพื่อให้ใบสูงที่สุด
const PATIENT_BOOKING = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001', trip_id: null, status: 'submitted', entry_channel: 'online',
  patient_name: 'นางประกายมาศ ศรีวิชัยเลิศสกุลวงศ์', requester_name: 'นางสาวสุดารัตน์ ศรีวิชัยเลิศสกุลวงศ์', phone: '0812345678',
  relation: 'relative', companions: 2, return_mode: 'wait', mobility: 'wheelchair',
  pickup: 'บ้านเลขที่ 199/25 หมู่ที่ 12 ตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่ 54170 บ้านหลังคาสีน้ำเงินตรงข้ามศาลาประชาคมหมู่บ้าน',
  route_label: 'โรงพยาบาลแพร่ อาคารผู้ป่วยนอก ชั้น 2 คลินิกไตเทียม',
  appointment_at: '2026-10-05T08:30:00+07:00', return_at: '2026-10-05T14:00:00+07:00',
  created_at: '2026-09-10T09:15:00+07:00', consent_at: '2026-09-10T09:15:00+07:00',
}

// departmentName ตั้งคนละกองโดยตั้งใจ เพื่อให้เห็นว่าชื่อตำแหน่งสำรองมาจากกองที่ถือเรื่องจริง
const FORMS = [
  {
    // กองที่ถือเรื่อง = กองสวัสดิการสังคม (ไม่มีกองนี้ใช้สำนักปลัด) — ดู patientRequestSignatories.js
    label: 'ใบคำขอรถรับ-ส่งผู้ป่วย (ระบบจองคิว)', departmentName: 'กองสวัสดิการสังคม',
    headFallback: 'ผู้อำนวยการกองสวัสดิการสังคม',
    build: extra => buildBookingRequestFormHtml({
      tenant: TENANT, booking: PATIENT_BOOKING, partner: { name: 'กองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว' }, ...extra,
    }),
  },
  {
    label: 'ขออนุญาตใช้น้ำประปา', departmentName: 'กองช่าง', headFallback: 'ผู้อำนวยการกองช่าง',
    build: extra => buildWaterServiceFormHtml('water_supply_request', {
      form: waterForm('water_supply_request'), tenant: TENANT, docDate: '2026-09-14T20:37:00',
      referenceNo: 'A1B2C3D4', signedAt: '2026-09-14T20:37:00', ...extra,
    }),
  },
  {
    label: 'ขอเปลี่ยนมาตรน้ำประปา', departmentName: 'กองช่าง', headFallback: 'ผู้อำนวยการกองช่าง',
    build: extra => buildWaterServiceFormHtml('water_meter_change', {
      form: waterForm('water_meter_change'), tenant: TENANT, docDate: '2026-09-14T20:37:00',
      referenceNo: 'A1B2C3D4', signedAt: '2026-09-14T20:37:00', ...extra,
    }),
  },
  {
    label: 'ขอยกเลิกใช้น้ำประปา', departmentName: 'กองช่าง', headFallback: 'ผู้อำนวยการกองช่าง',
    build: extra => buildWaterServiceFormHtml('water_supply_cancel', {
      form: waterForm('water_supply_cancel'), tenant: TENANT, docDate: '2026-09-14T20:37:00',
      referenceNo: 'A1B2C3D4', signedAt: '2026-09-14T20:37:00', ...extra,
    }),
  },
  {
    label: 'ขอรับบริการเก็บขนขยะ', departmentName: 'สำนักปลัด', headFallback: 'หัวหน้าสำนักปลัด',
    build: extra => buildWasteCollectionRequestHtml({
      form: WASTE_FORM, tenant: TENANT, thDate: '14 กันยายน 2569', referenceNo: 'A1B2C3D4', ...extra,
    }),
  },
  {
    label: 'ขอยกเลิกเก็บขนขยะ', departmentName: 'สำนักปลัด', headFallback: 'หัวหน้าสำนักปลัด',
    build: extra => buildWasteCollectionCancelHtml({
      form: WASTE_FORM, tenant: TENANT, thDate: '14 กันยายน 2569', referenceNo: 'A1B2C3D4',
      signedAt: '2026-09-14T20:37:00', ...extra,
    }),
  },
  {
    label: 'ขอรับการช่วยเหลือประชาชน', departmentName: 'กองสวัสดิการสังคม',
    headFallback: 'ผู้อำนวยการกองสวัสดิการสังคม',
    // ใบนี้มีบัญชีแนบท้ายเป็นแผ่นที่ 2 ตามปกติ ช่องลงนามต้องอยู่ในแผ่นแรกเสมอ
    extraSheets: 1,
    build: extra => buildPublicAssistanceRequestHtml({
      form: ASSISTANCE_FORM, tenant: TENANT, docDate: '2026-09-14T20:37:00',
      referenceNo: 'A1B2C3D4', ...extra,
    }),
  },
]

function pdfPageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
}

// viewport เท่าพื้นที่พิมพ์จริง (160 × 276 มม. ที่ 96dpi) — ใบที่ใช้ min-height:100%
// จะวัดผิดทันทีถ้า viewport สูงกว่านี้ (เจอจริงตอนไล่เคสใบยกเลิกเก็บขนขยะ 2569-10-05)
const VIEWPORT = { width: 605, height: 1043 }

async function render(browser, html) {
  const page = await browser.newPage({ viewport: VIEWPORT })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  return page
}

const results = []
async function check(name, run) {
  try {
    await run()
    results.push(`PASS ${name}`)
  } catch (error) {
    results.push(`FAIL ${name}: ${error?.message ?? error}`)
  }
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const form of FORMS) {
      // ── ใบฝั่งประชาชน: ต้องไม่มีช่องลงนามเจ้าหน้าที่เลย ─────────────────────
      await check(`${form.label} — ใบประชาชนไม่มีช่องลงนามเจ้าหน้าที่`, async () => {
        const html = form.build({})
        assert.doesNotMatch(html, /class="staff-sign"/,
          'ใบที่ประชาชนพิมพ์เองต้องไม่มีช่องลงนามของผู้บริหาร')
      })

      // ── ใบฝั่งเจ้าหน้าที่: ครบ 3 ช่อง จบ 1 แผ่น และได้มาตรฐานช่องลงนาม ──────
      await check(`${form.label} — ใบเจ้าหน้าที่มีช่องลงนามครบ 3 ตำแหน่งและจบ 1 แผ่น`, async () => {
        const html = form.build({ signatories: SIGNATORIES, departmentName: form.departmentName })
        const page = await render(browser, html)
        try {
          const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
          assert.equal(pdfPageCount(pdf), 1 + (form.extraSheets ?? 0),
            `ใบ${form.label} ล้นไปอีกหน้า — ทบทวนระยะในโหมด .sheet--staff ของใบนี้`)

          const seen = await page.evaluate(() => {
            const block = document.querySelector('.staff-sign')
            if (!block) return null
            const sheet = block.closest('.sheet')
            return {
              cells: block.querySelectorAll('.staff-sign-cell').length,
              lines: [...block.querySelectorAll('.sign-axis')]
                .map(axis => Math.round(axis.getBoundingClientRect().width)),
              text: block.textContent.replace(/\s+/g, ' ').trim(),
              inFirstSheet: sheet === document.querySelector('.sheet'),
              overflows: block.getBoundingClientRect().bottom > sheet.getBoundingClientRect().bottom + 1,
            }
          })
          assert.ok(seen, `ใบ${form.label} ไม่พบช่องลงนามเจ้าหน้าที่`)
          assert.equal(seen.cells, 3, `ใบ${form.label} ต้องมีช่องลงนาม 3 ตำแหน่ง`)
          assert.equal(new Set(seen.lines).size, 1,
            `ใบ${form.label} เส้นลงนามกว้างไม่เท่ากัน (${seen.lines.join(', ')}px) — กติกากลางห้ามไล่ค่ารายจุด`)
          assert.ok(seen.inFirstSheet, `ใบ${form.label} ช่องลงนามต้องอยู่ในแผ่นแรก`)
          assert.ok(!seen.overflows, `ใบ${form.label} ช่องลงนามล้นขอบล่างของแผ่น`)
          for (const person of Object.values(SIGNATORIES)) {
            assert.ok(seen.text.includes(`(${person.name})`),
              `ใบ${form.label} ต้องพิมพ์ชื่อ ${person.name} ในวงเล็บใต้เส้น`)
            assert.ok(seen.text.includes(person.title),
              `ใบ${form.label} ต้องพิมพ์ตำแหน่ง ${person.title}`)
          }
          // ชื่อที่พิมพ์ต้องเป็นชื่อในวงเล็บเท่านั้น ห้ามกลายเป็นลายมือชื่ออิเล็กทรอนิกส์
          // (ใบพวกนี้เวียนเซ็นด้วยปากกา ต้องเหลือเส้นให้เซ็นเสมอ)
          const signedInBlock = await page.evaluate(
            () => document.querySelectorAll('.staff-sign .sign-signed').length)
          assert.equal(signedInBlock, 0,
            `ใบ${form.label} ช่องลงนามเจ้าหน้าที่ต้องเป็นเส้นให้เซ็นด้วยปากกา ไม่ใช่ชื่อพิมพ์แทนลายเซ็น`)

          await assertSignBlockStandard(page, { minRows: 3, minBelow: 6 })
        } finally {
          await page.close()
        }
      })

      // ── ยังไม่ได้ตั้งผู้ลงนาม: ต้องได้เส้นประ + ชื่อตำแหน่งสำรองของกองที่ถือเรื่อง ──
      await check(`${form.label} — ยังไม่ตั้งผู้ลงนามก็ยังได้ช่องเปล่าให้เซ็น`, async () => {
        const html = form.build({
          signatories: EMPTY_SIGNATORIES, departmentName: form.departmentName,
        })
        assert.match(html, /class="staff-sign"/,
          'ยังไม่ตั้งผู้ลงนาม = ยังต้องมีช่องลงนามให้เวียนเซ็น')
        assert.ok(html.includes(form.headFallback),
          `ต้องใช้ชื่อตำแหน่งสำรองของกองที่ถือเรื่อง (${form.headFallback})`)
        assert.ok(html.includes('ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว')
          && html.includes('นายกองค์การบริหารส่วนตำบลทุ่งแค้ว'),
        'ต้องมีตำแหน่งปลัดและนายกพร้อมชื่อหน่วยงาน')
        const page = await render(browser, html)
        try {
          const blanks = await page.evaluate(
            () => [...document.querySelectorAll('.staff-sign .sign-below')]
              .filter(line => /^\(\.+\)$/.test(line.textContent.trim())).length)
          assert.equal(blanks, 3, 'ทุกช่องต้องมีวงเล็บเว้นชื่อให้เขียนมือ')
        } finally {
          await page.close()
        }
      })
    }
  } finally {
    await browser.close()
  }

  const failed = results.filter(line => line.startsWith('FAIL')).length
  process.stdout.write(`ช่องลงนามเจ้าหน้าที่ท้ายใบคำขอ — ตรวจทุกใบในหน้างานบริการประชาชน\n${results.join('\n')}\n`)
  process.stdout.write(`SUMMARY PASS=${results.length - failed} FAIL=${failed}\n`)
  if (failed) process.exitCode = 1
}

main().catch(error => {
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exitCode = 1
})

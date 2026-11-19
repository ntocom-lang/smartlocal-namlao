// ตรวจเลย์เอาต์ช่องลงนามมาตรฐานและจำนวนหน้าของชุดเอกสารกองช่าง
// - civilApprovalPrint.js (บันทึกขออนุมัติโครงการ): 1 หน้า A4
// - civilMedianPrint.js (ชุดเอกสารราคากลาง บันทึก + บก.01 + ปร.6): 3 หน้า A4
// รันด้วย: node tests/civil-print-layout.test.mjs

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { assertSignBlockStandard, assertSignLinesAligned } from './lib/signBlockChecks.mjs'
import { buildCivilApprovalHtml } from '../src/lib/civilApprovalPrint.js'
import { buildCivilMedianHtml } from '../src/lib/civilMedianPrint.js'

const TENANT = { id: 'muni-01', name: 'องค์การบริหารส่วนตำบลน้ำเลา', phone: '054-123456' }
const PROJECT = {
  id: 'proj-01',
  title: 'โครงการก่อสร้างถนน คสล. สายทางเข้าหมู่บ้าน หมู่ที่ 2',
  fiscal_year: '2569',
  budget_amount: 1250000,
  location_desc: 'หมู่ที่ 2 บ้านน้ำเลา',
}

const APPROVAL_DATA = {
  docNo: 'พล 72303/10',
  docDate: '2026-10-15',
  proposerName: 'สมศักดิ์ ช่างใหญ่',
  proposerPosition: 'ผู้อำนวยการกองช่าง',
  committee: [
    { name: 'สมชาย รักงาน', position_title: 'ผู้อำนวยการกองช่าง', duty: 'ประธานกรรมการ' },
    { name: 'ประสิทธิ์ วิศวกรรม', position_title: 'นายช่างโยธาชำนาญงาน', duty: 'กรรมการ' },
    { name: 'บุญมี มีสุข', position_title: 'นายช่างสำรวจปฏิบัติงาน', duty: 'กรรมการ' },
  ],
}

const MEDIAN_DATA = {
  docNo: 'พล 72303/125',
  docDate: '2026-11-16',
  orderNo: '45/2568',
  orderDate: '2026-11-01',
  costAmount: 957500,
  factorF: 1.3056,
  calcAmount: 1250112,
  medianAmount: 1250000,
  workScope: 'ก่อสร้างถนน คสล. ผิวจราจรกว้าง 4.00 ม. ยาว 500 ม. หนา 0.15 ม.',
  sourceOfPrice: 'ราคามาตรฐานพาณิชย์จังหวัดและกรมบัญชีกลาง',
  committee: [
    { name: 'สมชาย รักงาน', position_title: 'ผู้อำนวยการกองช่าง', duty: 'ประธานกรรมการ' },
    { name: 'ประสิทธิ์ วิศวกรรม', position_title: 'นายช่างโยธาชำนาญงาน', duty: 'กรรมการ' },
    { name: 'บุญมี มีสุข', position_title: 'นายช่างสำรวจปฏิบัติงาน', duty: 'กรรมการ' },
  ],
}

const SIGNATORIES = {
  department_head: { name: 'สมศักดิ์ ช่างใหญ่', title: 'ผู้อำนวยการกองช่าง' },
  clerk: { name: 'มนตรี บริหารงาน', title: 'ปลัดองค์การบริหารส่วนตำบลน้ำเลา' },
  mayor: { name: 'วิชัย พัฒนาถิ่น', title: 'นายกองค์การบริหารส่วนตำบลน้ำเลา' },
}

async function render(browser, html) {
  const page = await browser.newPage({ viewport: { width: 605, height: 1043 } })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(200)
  return page
}

async function pdfPageCount(page) {
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    console.log('--- ทดสอบ civilApprovalPrint ---')
    // 1.1 มีชื่อผู้ลงนาม
    {
      const html = buildCivilApprovalHtml({
        tenant: TENANT,
        project: PROJECT,
        data: APPROVAL_DATA,
        signatories: SIGNATORIES,
      })
      const page = await render(browser, html)
      try {
        const pages = await pdfPageCount(page)
        assert.equal(pages, 1, `บันทึกขออนุมัติโครงการต้องจบใน 1 หน้า แต่ได้ ${pages} หน้า`)
        await assertSignBlockStandard(page, { minRows: 3, minBelow: 3 })
        await assertSignLinesAligned(page, '.review-grid .sign-row')
        console.log('✓ civilApproval (มีชื่อ) ผ่าน: 1 หน้า + ช่องลงนามมาตรฐาน')
      } finally {
        await page.close()
      }
    }

    // 1.2 ไม่มีชื่อผู้ลงนาม (เว้นว่างให้เขียนมือ)
    {
      const html = buildCivilApprovalHtml({
        tenant: TENANT,
        project: PROJECT,
        data: { ...APPROVAL_DATA, proposerName: '' },
        signatories: null,
      })
      const page = await render(browser, html)
      try {
        const pages = await pdfPageCount(page)
        assert.equal(pages, 1, `บันทึกขออนุมัติโครงการ (เว้นว่าง) ต้องจบใน 1 หน้า แต่ได้ ${pages} หน้า`)
        await assertSignBlockStandard(page, { minRows: 3, minBelow: 3 })
        await assertSignLinesAligned(page, '.review-grid .sign-row')
        console.log('✓ civilApproval (เว้นว่าง) ผ่าน: 1 หน้า + ช่องลงนามมาตรฐาน')
      } finally {
        await page.close()
      }
    }

    console.log('--- ทดสอบ civilMedianPrint ---')
    // 2.1 มีชื่อผู้ลงนาม
    {
      const html = buildCivilMedianHtml({
        tenant: TENANT,
        project: PROJECT,
        data: MEDIAN_DATA,
        signatories: SIGNATORIES,
      })
      const page = await render(browser, html)
      try {
        const pages = await pdfPageCount(page)
        assert.equal(pages, 3, `ชุดเอกสารราคากลางต้องได้ 3 หน้าพอดี แต่ได้ ${pages} หน้า`)
        await assertSignBlockStandard(page, { minRows: 7, minBelow: 7 })
        await assertSignLinesAligned(page, '.committee-grid .sign-row')
        console.log('✓ civilMedian (มีชื่อ) ผ่าน: 3 หน้า + ช่องลงนามมาตรฐาน')
      } finally {
        await page.close()
      }
    }

    // 2.2 ไม่มีชื่อผู้ลงนาม (เว้นว่างให้เขียนมือ)
    {
      const html = buildCivilMedianHtml({
        tenant: TENANT,
        project: PROJECT,
        data: {
          ...MEDIAN_DATA,
          committee: [
            { name: '', position_title: 'ผู้อำนวยการกองช่าง', duty: 'ประธานกรรมการ' },
            { name: '', position_title: 'นายช่างโยธา', duty: 'กรรมการ' },
            { name: '', position_title: 'นายช่างสำรวจ', duty: 'กรรมการ' },
          ],
        },
        signatories: null,
      })
      const page = await render(browser, html)
      try {
        const pages = await pdfPageCount(page)
        assert.equal(pages, 3, `ชุดเอกสารราคากลาง (เว้นว่าง) ต้องได้ 3 หน้าพอดี แต่ได้ ${pages} หน้า`)
        await assertSignBlockStandard(page, { minRows: 7, minBelow: 7 })
        await assertSignLinesAligned(page, '.committee-grid .sign-row')
        console.log('✓ civilMedian (เว้นว่าง) ผ่าน: 3 หน้า + ช่องลงนามมาตรฐาน')
      } finally {
        await page.close()
      }
    }

    console.log('\nผ่านการตรวจสอบเลย์เอาต์และช่องลงนามมาตรฐานทั้งหมด 100%')
  } finally {
    await browser.close()
  }
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})

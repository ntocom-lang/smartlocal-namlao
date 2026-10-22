// แผ่น "ภาพประกอบคำร้อง" ต่อท้ายใบคำร้อง (เจ้าของระบบสั่ง 2569-10-22: ซ่อมแซมถนนทางการเกษตร ต้องใช้ภาพแนบเป็นหลักฐานเบิก)
//
// ส่วนที่ 1 ตรวจตรรกะล้วน (ไม่เปิดเบราว์เซอร์): ตัวรวบรวม/โหลดรูป กรณีรูปเสีย สิทธิ์ที่ถูกตัดรูป การเดินสายปุ่ม
// ส่วนที่ 2 ตรวจด้วยเบราว์เซอร์จริง: นับจำนวนหน้าจาก PDF ที่ Chrome พิมพ์ออกมา (การขึ้นหน้าใหม่ไม่เกิดบนจอ
//   วัดจาก viewport ไม่ได้) และวัดว่าภาพไม่ล้นขอบพื้นที่พิมพ์ 16 ซม.
//
// รันด้วย: node tests/complaint-photo-sheet.test.mjs (รวมอยู่ใน npm run test:council)

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'
import { buildCouncilComplaintHtml } from '../src/lib/councilFormPrint.js'
import { PHOTO_ROW_MAX_HEIGHT_MM, photoAspect, photoSheetColumns } from '../src/lib/complaintPhotoSheet.js'
import {
  complaintPhotoCount, complaintPhotoRefs, loadPrintPhotos, printWhenImagesReady,
} from '../src/lib/printPhotos.js'

let failures = 0
async function check(name, run) {
  try {
    await run()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${name}\n     ${error.message}`)
  }
}

// ---------- ส่วนที่ 1: ตรรกะล้วน ----------

await check('refs: ตัดซ้ำ ตัดช่องว่าง รับทั้งสตริงและ {url} · รวมรูปที่เพิ่งอัปโหลดโดยไม่ซ้ำ', () => {
  const refs = complaintPhotoRefs(
    { attachments: ['a', ' a ', '', null, 'b'], work_photos: ['w1', { url: 'w2' }, 7] },
    ['w2', 'w3'],
  )
  assert.deepEqual(refs.before, ['a', 'b'])
  assert.deepEqual(refs.after, ['w1', 'w2', 'w3'])
  assert.equal(complaintPhotoCount({ attachments: ['a', 'b'], work_photos: ['w1'] }, ['w1', 'w9']), 4)
})

await check('refs: คีย์ที่สิทธิ์ตัดออก (viewer/council) = 0 รูป = ไม่มีปุ่ม ไม่ throw', () => {
  assert.equal(complaintPhotoCount({ id: 'x', description: 'ไม่มีคีย์รูปเลย' }), 0)
  assert.equal(complaintPhotoCount({ attachments: null, work_photos: null }), 0)
  assert.equal(complaintPhotoCount(null), 0)
  assert.equal(complaintPhotoCount({ attachments: [], work_photos: [] }), 0)
})

await check('load: รักษาลำดับ · รูปที่โหลดไม่ได้เป็น {src:null} ไม่ถูกตัดทิ้ง · fetchImage throw ก็ไม่ล้มทั้งชุด', async () => {
  const fetchImage = async (ref) => {
    if (ref === 'bad') return { dataUrl: null, error: new Error('403') }
    if (ref === 'boom') throw new Error('network')
    if (ref === 'empty') return { dataUrl: '', error: null }
    return { dataUrl: `data:image/png;base64,${ref}`, error: null }
  }
  const sheet = await loadPrintPhotos(
    { attachments: ['a', 'bad', 'b', 'boom', 'empty'], work_photos: ['w'] },
    fetchImage,
  )
  assert.deepEqual(sheet.before.map(p => p.src), [
    'data:image/png;base64,a', null, 'data:image/png;base64,b', null, null,
  ])
  assert.deepEqual(sheet.after.map(p => p.src), ['data:image/png;base64,w'])
})

await check('load: ส่งต่อขนาดภาพ (width/height) · ขนาดที่ไม่รู้/ใช้ไม่ได้เป็น null → แผ่นภาพใช้สัดส่วน 4:3', async () => {
  const sizes = { tall: [480, 640], wide: [640, 480], zero: [0, 480], text: ['x', 'y'] }
  const fetchImage = async (ref) => {
    if (ref === 'none') return { dataUrl: 'data:image/png;base64,n', error: null }
    const [width, height] = sizes[ref]
    return { dataUrl: `data:image/png;base64,${ref}`, width, height, error: null }
  }
  const sheet = await loadPrintPhotos({ attachments: ['tall', 'wide', 'zero', 'text', 'none'] }, fetchImage)
  assert.deepEqual(sheet.before.map(p => [p.width, p.height]), [[480, 640], [640, 480], [null, null], [null, null], [null, null]])
  assert.equal(photoAspect({ width: 480, height: 640 }), 0.75)
  assert.equal(photoAspect({ width: 640, height: 480 }), 4 / 3)
  for (const bad of [null, {}, { src: null }, { width: 0, height: 5 }, { width: 5, height: -1 }, { width: NaN, height: 3 }]) {
    assert.equal(photoAspect(bad), 4 / 3, `ขนาดใช้ไม่ได้ ${JSON.stringify(bad)} ต้องถอยไป 4:3`)
  }
})

await check('columns: 3 ภาพเรียงแถวเดียว · 1/2/4 ภาพใช้ 2 คอลัมน์ · 5+ ภาพใช้ 3 คอลัมน์', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(photoSheetColumns), [2, 2, 3, 2, 3, 3, 3])
})

await check('printWhenImagesReady: พิมพ์หลังรูปถอดรหัสครบ · ไม่พิมพ์ถ้าหน้าต่างถูกปิด · ไม่ค้างถ้ารูปไม่เสร็จ', async () => {
  const mkWin = (decodes, closed = false) => {
    const win = { closed, printed: 0, focused: 0, focus() { win.focused += 1 }, print() { win.printed += 1 } }
    win.document = { images: decodes.map(decode => ({ decode })) }
    return win
  }
  const ready = mkWin([() => Promise.resolve(), () => new Promise(resolve => setTimeout(resolve, 30))])
  await printWhenImagesReady(ready, { minWaitMs: 0, timeoutMs: 1000 })
  assert.equal(ready.printed, 1)

  const broken = mkWin([() => Promise.reject(new Error('decode failed'))])
  await printWhenImagesReady(broken, { minWaitMs: 0, timeoutMs: 1000 })
  assert.equal(broken.printed, 1, 'รูปเสียห้ามทำให้ไม่ได้พิมพ์')

  const hung = mkWin([() => new Promise(() => {})])
  const started = Date.now()
  await printWhenImagesReady(hung, { minWaitMs: 0, timeoutMs: 60 })
  assert.equal(hung.printed, 1)
  assert.ok(Date.now() - started < 1000, 'รูปที่ไม่เสร็จต้องไม่ค้างเกิน timeout')

  const closed = mkWin([() => Promise.resolve()], true)
  await printWhenImagesReady(closed, { minWaitMs: 0, timeoutMs: 1000 })
  assert.equal(closed.printed, 0)
})

const ARGS = {
  c: {
    id: '00000000-0000-4000-8000-000000000001',
    reporter_name: 'นายสมชาย ใจดีมีสุข',
    category: 'road',
    department: 'กองช่าง',
    issue_type: 'ผิวถนนชำรุด/เป็นหลุม',
    detail: 'ถนนเข้าแปลงเกษตรชำรุดเป็นหลุมลึก',
    village: 'หมู่ที่ 1 บ้านบุญแจ่ม',
  },
  tenant: { name: 'เทศบาลตำบลน้ำเลา', org_type: 'เทศบาลตำบล', district: 'อำเภอร่องกวาง', province: 'จังหวัดแพร่' },
  terminology: { mayor: 'นายกเทศมนตรี', clerk: 'ปลัดเทศบาล', council: 'สมาชิกสภาเทศบาล' },
  num: 'ES-69-0218',
  thDate: '21 ตุลาคม 2569',
  cat: 'ซ่อมแซมถนนทางการเกษตร',
  phone: '081-234-5678',
  signatories: {
    department_head: { name: 'นายชัยศักดิ์ ชัยธรรม', title: 'ผู้อำนวยการกองช่าง' },
    clerk: { name: 'นางสมหญิง รักษ์ราชการดี', title: 'ปลัดเทศบาล' },
    mayor: { name: 'นายสมศักดิ์ ตั้งใจพัฒนา', title: 'นายกเทศมนตรี' },
  },
}

// ภาพทดสอบ (SVG ไม่มีบุคคล) — แนวนอน 4:3 และแนวตั้ง 3:4 เพื่อดูว่าไม่ถูกครอบตัด
function scene(label, portrait = false) {
  const [w, h] = portrait ? [480, 640] : [640, 480]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#7fae5b"/><rect x="0" y="${h * 0.55}" width="${w}" height="${h * 0.45}" fill="#9b7650"/><text x="20" y="40" font-size="28" fill="#fff">${label}</text></svg>`
  return { src: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), width: w, height: h }
}
const photos = (prefix, n, portraitAt = -1) => Array.from({ length: n }, (_, i) => scene(`${prefix} ${i + 1}`, i === portraitAt))
// ภาพถ่ายตั้งแนวตั้งทั้งชุด — เคสจริงที่เจ้าของระบบเจอ (มือถือถ่ายตั้ง แล้วเหลือแถบขาวข้างภาพ) 2569-10-22
const portraits = (prefix, n) => Array.from({ length: n }, (_, i) => scene(`${prefix} ${i + 1}`, true))

await check('ไม่ส่ง photoSheet = ใบเดิม ไม่มี CSS/แผ่นภาพหลุดเข้ามา', () => {
  const plain = buildCouncilComplaintHtml(ARGS)
  assert.ok(!plain.includes('photo-sheet') && !plain.includes('ภาพประกอบคำร้อง'))
  assert.equal(buildCouncilComplaintHtml({ ...ARGS, photoSheet: null }), plain)
})

await check('หัวแผ่น: เลขคำร้อง/เรื่อง/สถานที่ + พิกัด 3 สถานะไม่รวมกัน (ตรงกับใบหน้าแรก)', () => {
  const sheet = { before: photos('ก่อน', 1), after: [] }
  const headerOf = (extra) => {
    const html = buildCouncilComplaintHtml({ ...ARGS, c: { ...ARGS.c, ...extra }, photoSheet: sheet })
    return html.slice(html.indexOf('<section class="photo-sheet">'))
  }
  const pinned = headerOf({ latitude: 18.123456, longitude: 100.654321 })
  assert.match(pinned, /คำร้องผ่าน E-Service ES-69-0218 ลงวันที่ 21 ตุลาคม 2569/)
  assert.match(pinned, /เรื่อง &nbsp;\S+/)
  assert.match(pinned, /สถานที่ &nbsp;หมู่ที่ 1 บ้านบุญแจ่ม/)
  assert.match(pinned, /พิกัด &nbsp;18\.12346, 100\.65432/)
  assert.match(headerOf({ latitude: null, longitude: null }), /พิกัด &nbsp;ไม่ได้ปักหมุด/)
  assert.ok(!headerOf({}).includes('พิกัด &nbsp;'), 'สิทธิ์ปิด (ไม่มีคีย์ latitude) ห้ามเขียนว่าไม่ได้ปักหมุด')
  const off = buildCouncilComplaintHtml({
    ...ARGS, c: { ...ARGS.c, latitude: 18.1, longitude: 100.6 }, photoSheet: sheet, includeCoordinates: false,
  })
  assert.ok(!off.slice(off.indexOf('<section class="photo-sheet">')).includes('พิกัด'))
})

await check('รูปที่โหลดไม่ได้พิมพ์เป็นกรอบแจ้ง · จำนวน figure เท่ากับจำนวนรูป ไม่มีรูปหาย', () => {
  const html = buildCouncilComplaintHtml({
    ...ARGS,
    photoSheet: { before: [scene('ก่อน 1'), { src: null }, scene('ก่อน 3')], after: [{ src: null }] },
  })
  assert.equal((html.match(/<figure[ >]/g) ?? []).length, 4)
  assert.equal((html.match(/โหลดภาพนี้ไม่สำเร็จ/g) ?? []).length, 2)
  assert.match(html, /ภาพที่ 2 \(ไม่มีภาพ\)/)
})

await check('หมวดที่ไม่มีรูปเลยไม่พิมพ์ทั้งหัวข้อ (เจ้าของระบบสั่ง 2569-10-22) · รูปที่มีแต่โหลดไม่ได้ยังพิมพ์เป็นกรอบ', () => {
  const sheetOf = (photoSheet) => {
    const html = buildCouncilComplaintHtml({ ...ARGS, photoSheet })
    return html.slice(html.indexOf('<section class="photo-sheet">'))
  }
  const noAfter = sheetOf({ before: photos('ก่อน', 2), after: [] })
  assert.match(noAfter, /ภาพก่อนดำเนินการ \(ภาพจากผู้แจ้ง\) — 2 ภาพ/)
  assert.ok(!noAfter.includes('ภาพหลังดำเนินการ'), 'ไม่มีภาพหลัง ต้องไม่มีหัวข้อภาพหลัง')
  assert.ok(!noAfter.includes('ยังไม่มีภาพหลังดำเนินการในระบบ') && !noAfter.includes('ps-none'), 'ห้ามมีกล่องแจ้งว่าไม่มีภาพ')
  assert.equal((noAfter.match(/<figure[ >]/g) ?? []).length, 2)

  const noBefore = sheetOf({ before: [], after: photos('หลัง', 1) })
  assert.match(noBefore, /ภาพหลังดำเนินการ \(ภาพจากเจ้าหน้าที่\) — 1 ภาพ/)
  assert.ok(!noBefore.includes('ภาพก่อนดำเนินการ') && !noBefore.includes('ผู้แจ้งไม่ได้แนบภาพ'))

  // หมวดที่มีรูปแต่ทุกใบโหลดไม่ได้ ≠ ไม่มีรูป: ยังต้องมีหัวข้อ + กรอบแจ้ง
  const allFailed = sheetOf({ before: [{ src: null }], after: [] })
  assert.match(allFailed, /ภาพก่อนดำเนินการ/)
  assert.match(allFailed, /โหลดภาพนี้ไม่สำเร็จ/)
})

await check('การเดินสาย: ปุ่มพิมพ์ + ภาพ ใน 2 หน้าจอ · รอรูปก่อนพิมพ์ · Draft PDF ส่ง GDCC ไม่ใส่ภาพ', async () => {
  const manager = await readFile(new URL('../src/components/admin/ComplaintsManager.jsx', import.meta.url), 'utf8')
  const tech = await readFile(new URL('../src/pages/TechnicianDashboard.jsx', import.meta.url), 'utf8')
  for (const [name, src] of [['ComplaintsManager', manager], ['TechnicianDashboard', tech]]) {
    assert.match(src, /withPhotos: true/, `${name}: ไม่มีปุ่มพิมพ์ + ภาพ`)
    assert.match(src, /loadPrintPhotos\(/, `${name}: ไม่โหลดรูปก่อนพิมพ์`)
    assert.match(src, /printWhenImagesReady\(/, `${name}: ไม่รอรูปก่อนสั่งพิมพ์`)
    assert.match(src, /complaintPhotoCount\(/, `${name}: ปุ่มต้องขึ้นเฉพาะเรื่องที่มีรูป`)
  }
  // ปุ่ม "พิมพ์" เดิมในกล่องรายละเอียดต้องไม่ใส่ภาพ (ไม่ส่ง withPhotos) และ Draft PDF ไม่มี photoSheet
  const draft = manager.slice(manager.indexOf('async function handleExportDraftPdf'), manager.indexOf('async function handleUploadFinalDoc'))
  assert.ok(draft.includes('buildCouncilComplaintHtml') && !draft.includes('photoSheet'), 'Draft PDF ต้องไม่ใส่ภาพ')
})

// ---------- ส่วนที่ 2: เบราว์เซอร์จริง ----------

function pdfPageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

// ⚠️ viewport ต้องเท่าความกว้างพื้นที่พิมพ์จริง (160mm = 604.7px ที่ 96dpi) ไม่งั้นข้อความตัดบรรทัดคนละแบบกับตอนพิมพ์
async function open(browser, html) {
  const page = await browser.newPage({ viewport: { width: 605, height: 1044 } })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode().catch(() => {}))))
  await page.emulateMedia({ media: 'print' })
  return page
}
const pagesOf = async (page) => pdfPageCount(await page.pdf({ preferCSSPageSize: true, printBackground: true }))

const browser = await chromium.launch({ channel: 'chrome' })
try {
  const render = async (extra) => open(browser, buildCouncilComplaintHtml({ ...ARGS, c: { ...ARGS.c, latitude: 18.31842, longitude: 100.20315 }, ...extra }))

  await check('PDF: ไม่มีภาพ = 1 หน้า (ใบเดิม) · มีภาพ = ใบ 1 หน้า + แผ่นภาพขึ้นหน้าใหม่ 1 หน้า', async () => {
    const plain = await render({})
    try { assert.equal(await pagesOf(plain), 1, 'ใบเดิมต้องจบ 1 หน้า') } finally { await plain.close() }
    for (const [label, before, after] of [['1+0', 1, 0], ['3+0', 3, 0], ['2+2', 2, 2], ['3+2', 3, 2], ['3+3 (ฟอร์มประชาชนเต็ม 3 รูป + หลังซ่อม 3)', 3, 3]]) {
      const page = await render({ photoSheet: { before: photos('ก่อน', before, 1), after: photos('หลัง', after) } })
      try { assert.equal(await pagesOf(page), 2, `${label} ต้องจบที่ 2 หน้า`) } finally { await page.close() }
    }
    // ภาพแนวตั้งสูงกว่าแนวนอนมาก (กรอบตามสัดส่วนจริง) — เคสที่ใช้พื้นที่มากสุดที่ยังต้องจบแผ่นเดียว
    for (const [label, before, after] of [['แนวตั้ง 1+0', 1, 0], ['แนวตั้ง 3+0', 3, 0], ['แนวตั้ง 2+2', 2, 2], ['แนวตั้ง 3+3', 3, 3]]) {
      const page = await render({ photoSheet: { before: portraits('ก่อน', before), after: portraits('หลัง', after) } })
      try { assert.equal(await pagesOf(page), 2, `${label} ต้องจบที่ 2 หน้า (ใบ 1 + แผ่นภาพ 1)`) } finally { await page.close() }
    }
  })

  await check('PDF: รูปมากเกินหน้าเดียว (9+9) ไหลไปหน้าถัดไป ไม่ถูกตัดทิ้ง และ figure ไม่ถูกฉีกครึ่ง', async () => {
    const page = await render({ photoSheet: { before: photos('ก่อน', 9), after: photos('หลัง', 9) } })
    try {
      const pages = await pagesOf(page)
      assert.ok(pages >= 3, `9+9 ภาพควรเกิน 2 หน้า ได้ ${pages}`)
      assert.equal(await page.locator('figure').count(), 18)
    } finally { await page.close() }
  })

  // วัดทุกแถวของแผ่นภาพ: กล่องของภาพแต่ละใบ (px) เทียบกับสัดส่วนจริงของไฟล์ภาพ
  const measureRows = (page) => page.evaluate(() => {
    const limit = document.body.getBoundingClientRect().right
    return {
      bodyWidth: document.body.getBoundingClientRect().width,
      overflow: Math.max(...[...document.querySelectorAll('.photo-sheet *')].map(el => el.getBoundingClientRect().right - limit)),
      breakBefore: getComputedStyle(document.querySelector('.photo-sheet')).breakBefore,
      rows: [...document.querySelectorAll('.photo-sheet .ps-row')].map(row => ({
        rowWidth: row.getBoundingClientRect().width,
        cells: [...row.querySelectorAll('figure')].map(figure => {
          const img = figure.querySelector('img')
          const frame = (img ?? figure.querySelector('.ps-failed')).getBoundingClientRect()
          const cell = figure.getBoundingClientRect()
          return {
            failed: !img,
            width: frame.width,
            height: frame.height,
            cellWidth: cell.width,
            natural: img ? img.naturalWidth / img.naturalHeight : null,
            fit: img ? getComputedStyle(img).objectFit : null,
          }
        }),
      })),
    }
  })
  const MM = 3.7795

  await check('ภาพไม่มีแถบว่างและไม่ถูกตัด: กรอบตรงสัดส่วนจริงของแต่ละภาพ · ทุกภาพในแถวสูงเท่ากัน · ไม่ล้นขอบ 16 ซม.', async () => {
    // [ชื่อเคส, ก่อน, หลัง, ความกว้างภาพเล็กสุดที่ยอมรับ (มม.)]
    // แนวตั้ง 3 ภาพ = เคสของเจ้าของระบบ: เดิมภาพกว้างแค่ ~29 มม. ในกรอบ 51 มม. (แถบขาวสองข้าง) ต้องใหญ่ขึ้นและไม่มีแถบ
    const cases = [
      ['แนวตั้งล้วน 3+3', portraits('ก่อน', 3), portraits('หลัง', 3), 48],
      ['แนวนอนล้วน 3+2', photos('ก่อน', 3), photos('หลัง', 2), 48],
      ['ผสมแนวตั้ง/แนวนอนในแถวเดียว', [scene('ตั้ง', true), scene('นอน'), scene('ตั้ง', true)], [], 38],
      ['ภาพแนวตั้ง 2 ภาพ (2 ต่อแถว)', portraits('ก่อน', 2), [], 60],
    ]
    for (const [label, before, after, minMm] of cases) {
      const page = await render({ photoSheet: { before, after } })
      try {
        const seen = await measureRows(page)
        assert.ok(seen.overflow <= 0.5, `${label}: ล้นขอบขวา ${seen.overflow.toFixed(1)}px`)
        assert.equal(seen.breakBefore, 'page', `${label}: แผ่นภาพต้องขึ้นหน้าใหม่เสมอ ไม่ต่อท้ายใบเดิมในหน้าเดียวกัน`)
        for (const [index, row] of seen.rows.entries()) {
          const heights = row.cells.map(cell => cell.height)
          assert.ok(Math.max(...heights) - Math.min(...heights) <= 0.6, `${label} แถว ${index + 1}: ภาพสูงไม่เท่ากัน ${heights.map(h => h.toFixed(1))}`)
          for (const cell of row.cells) {
            assert.ok(!cell.failed && cell.natural > 0, `${label}: ภาพไม่ถูกถอดรหัส`)
            // กล่องภาพ = สัดส่วนจริงของไฟล์ → object-fit: contain เติมเต็มกล่อง ไม่เหลือแถบว่าง และไม่ตัดภาพ
            assert.ok(Math.abs(cell.width / cell.height - cell.natural) / cell.natural < 0.01,
              `${label}: กรอบ ${(cell.width / cell.height).toFixed(3)} ไม่ตรงสัดส่วนภาพ ${cell.natural.toFixed(3)} (จะเหลือแถบว่าง)`)
            assert.equal(cell.fit, 'contain', `${label}: ต้อง object-fit: contain (ห้ามครอบตัดภาพหลักฐาน)`)
            assert.ok(Math.abs(cell.width - cell.cellWidth) < 0.5, `${label}: ภาพไม่เต็มความกว้างของช่อง`)
            assert.ok(cell.width / MM >= minMm, `${label}: ภาพเล็กสุดกว้าง ${(cell.width / MM).toFixed(1)} มม. (ต้อง ≥ ${minMm})`)
          }
        }
      } finally { await page.close() }
    }
  })

  await check(`เพดานความสูงแถว ${PHOTO_ROW_MAX_HEIGHT_MM} มม.: ภาพแนวตั้งเดี่ยว/คู่ไม่ใหญ่จนดันแผ่นล้นหน้า · ภาพแถวเต็มความกว้างเมื่อหลายภาพ`, async () => {
    for (const [label, before] of [['แนวตั้งเดี่ยว', portraits('ก่อน', 1)], ['แนวตั้ง 2 ภาพ', portraits('ก่อน', 2)]]) {
      const page = await render({ photoSheet: { before, after: [] } })
      try {
        const seen = await measureRows(page)
        const height = seen.rows[0].cells[0].height / MM
        assert.ok(height <= PHOTO_ROW_MAX_HEIGHT_MM + 0.5, `${label}: ภาพสูง ${height.toFixed(1)} มม. เกินเพดาน`)
        assert.ok(height >= PHOTO_ROW_MAX_HEIGHT_MM - 0.5, `${label}: ภาพสูง ${height.toFixed(1)} มม. ไม่ถึงเพดาน (ความกว้างแถวไม่ได้ถูกใช้เต็ม)`)
      } finally { await page.close() }
    }
    // 3 ภาพแนวนอนต่อแถว กว้างเต็มพื้นที่พิมพ์ (ไม่ติดเพดานเพราะเตี้ยกว่า)
    const wide = await render({ photoSheet: { before: photos('ก่อน', 3), after: [] } })
    try {
      const seen = await measureRows(wide)
      assert.ok(Math.abs(seen.rows[0].rowWidth - seen.bodyWidth) <= 1, `แถวภาพแนวนอนต้องกว้างเต็มพื้นที่พิมพ์ ${seen.bodyWidth.toFixed(1)}px ได้ ${seen.rows[0].rowWidth.toFixed(1)}px`)
    } finally { await wide.close() }
  })

  await check('รูปที่โหลดไม่ได้ในแถวเดียวกับภาพอื่น: กรอบแจ้ง 4:3 สูงเท่าภาพข้างเคียง ไม่ทำแถวเพี้ยน', async () => {
    const page = await render({ photoSheet: { before: [scene('ตั้ง', true), { src: null }, scene('นอน')], after: [{ src: null }] } })
    try {
      const seen = await measureRows(page)
      const [first, second] = seen.rows
      const heights = first.cells.map(cell => cell.height)
      assert.ok(Math.max(...heights) - Math.min(...heights) <= 0.6, `ภาพสูงไม่เท่ากัน ${heights.map(h => h.toFixed(1))}`)
      const failed = first.cells.find(cell => cell.failed)
      assert.ok(Math.abs(failed.width / failed.height - 4 / 3) < 0.02, 'กรอบแจ้งต้อง 4:3')
      assert.equal(second.cells.length, 1)
      assert.ok(second.cells[0].failed, 'หมวดที่มีแต่รูปเสียยังต้องมีกรอบแจ้ง')
    } finally { await page.close() }
  })

  await check('ใบหน้าแรกไม่ขยับเมื่อต่อแผ่นภาพ (ตำแหน่งบล็อกลงนาม/พิกัดเท่าเดิม)', async () => {
    const measure = async (extra) => {
      const page = await render(extra)
      try {
        return await page.evaluate(() => {
          const top = (selector) => document.querySelector(selector)?.getBoundingClientRect().top
          return { sign: top('.center-row'), qr: top('.geo-qr'), refs: top('.request-refs') }
        })
      } finally { await page.close() }
    }
    const plain = await measure({})
    const withSheet = await measure({ photoSheet: { before: photos('ก่อน', 3), after: photos('หลัง', 2) } })
    assert.deepEqual(withSheet, plain)
  })
} finally {
  await browser.close()
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall photo sheet checks passed')

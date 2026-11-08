// ใบพิมพ์วงจรโครงการก่อสร้าง P8–P12 (src/lib/constructionLifecyclePrint.js) — ถ้อยคำ ข้อมูล escape มาตรฐานกลาง และ "ระบบไม่ตัดสินแทนคน"
//   คำนวณล้วน ไม่ต้องมีเบราว์เซอร์/ฐานข้อมูล · เลย์เอาต์จริง (จำนวนแผ่น ช่องลงนาม ฟอนต์) อยู่ที่ tests/construction-lifecycle-print-layout.test.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  CHANGE_REQUEST_FOOTNOTE, CONTRACT_AMEND_FOOTNOTE, DEFECT_NOTICE_SCREEN_NOTE, INSTALLMENT_CERT_SCREEN_NOTE, WARRANTY_REPORT_FOOTNOTE,
  buildChangeRequestMemoHtml, buildContractAmendMemoHtml, buildDefectNoticeLetterHtml, buildInstallmentCertificateHtml,
  buildWarrantyInspectionReportHtml, changeNoticeTiming, needsGuarantorCopy, warrantyLeadDays,
} from '../src/lib/constructionLifecyclePrint.js'
import { GOV_PAGE_MARGIN } from '../src/lib/govDocStyle.js'
import { EVIL, fixture } from './lib/constructionLifecyclePrintFixtures.mjs'

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}
const asyncTest = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}
// ข้อความที่คนอ่านบนกระดาษ (ตัด <style> และแท็กออก) — ใช้เทียบถ้อยคำ
const textOf = html => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
// เฉพาะที่พิมพ์ลงกระดาษ (ตัดป้ายบนจอที่ซ่อนตอนพิมพ์)
const printedText = html => textOf(html.replace(/<div class="screen-only">[\s\S]*?<\/div>/g, ''))

const build = (options = {}, overrides = {}) => {
  const f = { ...fixture(options), ...overrides }
  return {
    f,
    p8: buildInstallmentCertificateHtml(f),
    p9: buildChangeRequestMemoHtml({ ...f, change: f.extend }),
    p10: buildContractAmendMemoHtml({ ...f, change: f.amend }),
    p11: buildWarrantyInspectionReportHtml(f),
    p12: buildDefectNoticeLetterHtml({ ...f, defect: f.defect }),
  }
}
const DOCS = ['p8', 'p9', 'p10', 'p11', 'p12']

test('changeNoticeTiming: ครบ +15 = ภายใน · +16 = เกิน · ขาดวันหรือรูปแบบผิด = null (ข้อ 182 นับวันปฏิทินถัดจากวันที่เหตุสิ้นสุด)', () => {
  assert.deepEqual(changeNoticeTiming({ causeEndedOn: '2026-10-01', receivedOn: '2026-10-16' }), { days: 15, within: true })
  assert.deepEqual(changeNoticeTiming({ causeEndedOn: '2026-10-01', receivedOn: '2026-10-17' }), { days: 16, within: false })
  assert.deepEqual(changeNoticeTiming({ causeEndedOn: '2026-10-01', receivedOn: '2026-10-02' }), { days: 1, within: true })
  assert.deepEqual(changeNoticeTiming({ causeEndedOn: '2026-10-01', receivedOn: '2026-10-01' }), { days: 0, within: true })
  // ข้ามเดือน/ปี/ปีอธิกสุรทิน
  assert.deepEqual(changeNoticeTiming({ causeEndedOn: '2026-12-25', receivedOn: '2027-01-09' }), { days: 15, within: true })
  assert.deepEqual(changeNoticeTiming({ causeEndedOn: '2028-02-20', receivedOn: '2028-03-06' }), { days: 15, within: true })
  assert.equal(changeNoticeTiming({ causeEndedOn: '2026-10-01', receivedOn: null }), null)
  assert.equal(changeNoticeTiming({ causeEndedOn: '', receivedOn: '2026-10-16' }), null)
  assert.equal(changeNoticeTiming({ causeEndedOn: 'ไม่ใช่วันที่', receivedOn: '2026-10-16' }), null)
  assert.equal(changeNoticeTiming(), null)
})

test('warrantyLeadDays: ประกัน 6 เดือนขึ้นไป = 30 วัน · ต่ำกว่า 6 = 15 วัน · ไม่ทราบระยะ = null (ว 117 ข้อ 3)', () => {
  assert.equal(warrantyLeadDays(6), 30)
  assert.equal(warrantyLeadDays(24), 30)
  assert.equal(warrantyLeadDays('12'), 30)
  assert.equal(warrantyLeadDays(5), 15)
  assert.equal(warrantyLeadDays(0), 15)
  assert.equal(warrantyLeadDays(null), null)
  assert.equal(warrantyLeadDays(undefined), null)
  assert.equal(warrantyLeadDays(''), null)
})

test('P11: ตรวจภายใน 30 วัน (6 เดือน) / 15 วัน (5 เดือน) / ว่าง = "ภายใน ..... วัน" และแสดงหลักประกัน/ระยะประกันครบ', () => {
  const f = fixture()
  const at = months => printedText(buildWarrantyInspectionReportHtml({ ...f, contract: { ...f.contract, warranty_months: months }, warranty: null }))
  assert.match(at(6), /ตรวจสอบความชำรุดบกพร่องของพัสดุก่อนสิ้นสุดระยะเวลาการประกันภายใน 30 วัน/)
  assert.match(at(5), /ภายใน 15 วัน/)
  assert.match(at(null), /ภายใน \.{5} วัน/)
  const text = at(24)
  assert.match(text, /ระยะเวลาประกันความชำรุดบกพร่อง 24 เดือน ตั้งแต่ 14 ธันวาคม พ.ศ. 2569 ถึง 13 ธันวาคม พ.ศ. 2571/)
  assert.match(text, /หลักประกันสัญญา หนังสือค้ำประกันของธนาคาร เลขที่ BG-2569\/0042 จำนวน 62,500\.00 บาท/)
  assert.match(text, /ที่ กค \(กวจ\) 0405\.2\/ว 117 ลงวันที่ 12 มีนาคม 2562 ข้อ 3/)
})

test('P11: guarantee_type none = "ไม่มีหลักประกันสัญญา" · ค่าว่างเป็นเส้นประ · วันที่ประกันเติมจาก warrantyWindow เมื่อสัญญาไม่ได้บันทึกตรงๆ', () => {
  const f = fixture({ guaranteeType: 'none' })
  assert.match(printedText(buildWarrantyInspectionReportHtml(f)), /ไม่มีหลักประกันสัญญา/)
  assert.doesNotMatch(printedText(buildWarrantyInspectionReportHtml(f)), /หลักประกันสัญญา (เงินสด|หนังสือค้ำประกัน|เลขที่)/)
  const bare = { ...f.contract, guarantee_type: null, guarantee_ref: '', guarantee_amount: null, warranty_starts_on: null, warranty_ends_on: null }
  const html = buildWarrantyInspectionReportHtml({ ...f, contract: bare, warranty: { start: '2027-01-01', end: '2028-12-31', months: 24 } })
  assert.match(printedText(html), /ตั้งแต่ 1 มกราคม พ.ศ. 2570 ถึง 31 ธันวาคม พ.ศ. 2571 หลักประกันสัญญา เลขที่ จำนวน บาท/)
  assert.ok(html.includes('class="blank"'), 'ค่าว่างต้องเป็นเส้นประ')
})

test('P8: ทั้งหมด = งวดสุดท้ายของสัญญา · เฉพาะงวดที่ N = งวดอื่น · ไม่ทราบจำนวนงวด = เฉพาะงวด', () => {
  const f = fixture()
  const certificate = (no, total) => buildInstallmentCertificateHtml({
    ...f, installment: { ...f.installment, installment_no: no }, contract: { ...f.contract, installments_total: total },
  })
  assert.match(printedText(certificate(3, 3)), /ใบรับรองผลการปฏิบัติงาน \(ทั้งหมด\)/)
  assert.doesNotMatch(printedText(certificate(3, 3)), /เฉพาะงวดที่/)
  assert.match(printedText(certificate(2, 3)), /\(เฉพาะงวดที่ 2\)/)
  assert.match(printedText(certificate(1, null)), /\(เฉพาะงวดที่ 1\)/)
})

test('P8: ถ้อยคำย่อหน้า 1–5 ตามที่อนุมัติ + ข้อมูลงวด + ช่องผลตรวจเว้นว่าง (ไม่ติ๊ก ไม่เติมวันที่ตรวจ/ผลจากฐานข้อมูล)', () => {
  const { p8 } = build()
  const text = printedText(p8)
  for (const needle of [
    'ตามสัญญาจ้างเลขที่ 25/2569 ลงวันที่ 1 กันยายน พ.ศ. 2569 องค์การบริหารส่วนตำบลทดสอบ ได้ตกลงจ้าง',
    'วงเงินค่าจ้าง 1,250,000.00 บาท แบ่งการจ่ายเงินเป็น 3 งวด',
    'ผู้รับจ้างได้ส่งมอบงานงวดที่ 2 (ร้อยละ 50 จำนวนเงิน 625,000.00 บาท) ตามหนังสือส่งมอบงาน เลขรับ รับ 88/2569 ลงวันที่ 12 พฤศจิกายน พ.ศ. 2569 กำหนดส่งมอบตามสัญญา 10 พฤศจิกายน พ.ศ. 2569',
    'คณะกรรมการตรวจรับพัสดุได้ตรวจผลงานกับแบบรูปรายการละเอียดและข้อกำหนดในสัญญาแล้ว เมื่อวันที่',
    'ถูกต้องครบถ้วนเป็นไปตามแบบรูปรายการละเอียดและข้อกำหนดในสัญญา ให้ถือว่าผู้รับจ้างส่งมอบงานครบถ้วนตั้งแต่วันที่ผู้รับจ้างส่งงานจ้างนั้น',
    'ไม่เป็นไปตามแบบรูปรายการละเอียดและข้อกำหนดในสัญญา เนื่องจาก',
    'ผู้รับจ้างส่งมอบงานล่าช้ากว่ากำหนด หน่วยงานสงวนสิทธิ์การเรียกค่าปรับตามสัญญา',
    'ใบรับรองนี้ทำขึ้นอย่างน้อย 2 ฉบับ มอบให้ผู้รับจ้าง 1 ฉบับ และเจ้าหน้าที่ 1 ฉบับ เพื่อทำการเบิกจ่ายเงิน และรายงานให้นายกองค์การบริหารส่วนตำบลทดสอบทราบ',
    'เขียนที่ องค์การบริหารส่วนตำบลทดสอบ', 'ความเห็นแย้ง (ถ้ามี)',
  ]) assert.ok(text.includes(needle), needle)
  // ผลตรวจรับในฐานข้อมูล (accepted · วันที่ตรวจ 15 พ.ย. · เหตุผล) ต้องไม่รั่วลงใบ
  for (const leak of ['MARK-INSPECTION-REASON', 'MARK-DISSENT', '15 พฤศจิกายน']) assert.ok(!p8.includes(leak), `ห้ามพิมพ์ผลตรวจจากฐานข้อมูล: ${leak}`)
})

test('P8: ป้ายบนจอ (ซ่อนตอนพิมพ์) มีข้อความ e-GP/ว 681/ข้อ 176(5)–(7) ข้อ 181 · ไม่พิมพ์คำว่า "ร่าง" ลงกระดาษ (ใบนี้มอบผู้รับจ้าง)', () => {
  const { p8 } = build()
  assert.match(p8, /<div class="screen-only">[^]*ห้ามมีสองฉบับ[^]*ว 681[^]*ข้อ 176\(5\)–\(7\) และข้อ 181[^]*<\/div>/)
  assert.ok(INSTALLMENT_CERT_SCREEN_NOTE.includes('ถ้าพิมพ์ใบตรวจรับจากระบบ e-GP แล้ว ไม่ต้องใช้ใบนี้'))
  assert.ok(INSTALLMENT_CERT_SCREEN_NOTE.includes('หนังสือ กค (กวจ) 0405.4/ว 681 ลว. 8 ต.ค. 2568'))
  assert.ok(INSTALLMENT_CERT_SCREEN_NOTE.includes('ร่างจากข้อมูลในระบบ ต้องตรวจกับระเบียบฉบับปัจจุบันก่อนใช้'))
  assert.ok(!printedText(p8).includes('ร่าง'), 'ใบที่มอบผู้รับจ้างต้องไม่มีคำว่าร่างบนกระดาษ')
  assert.match(p8, /@media print \{[^\n]*\.screen-only \{ display: none !important; \}/)
})

test('กรรมการตรวจรับ: ใช้เฉพาะ grp committee เรียงตาม sort_order · ชื่อในวงเล็บ + หน้าที่ใต้เส้น · ไม่มีรายชื่อ = 3 แถวเปล่า ประธานกรรมการ/กรรมการ/กรรมการ', () => {
  const f = fixture()
  const html = buildInstallmentCertificateHtml({ ...f, people: [...f.people].reverse() })
  const text = textOf(html)
  assert.ok(text.indexOf('(นายสมชาย ใจดีมาก)') < text.indexOf('(นางสาวสมหญิง รักงานดี)'))
  assert.ok(text.indexOf('(นางสาวสมหญิง รักงานดี)') < text.indexOf('(นายสมศักดิ์ ตรวจรับเก่ง)'))
  assert.ok(!text.includes('ห้ามออกใบกรรมการ'), 'ผู้ควบคุมงานต้องไม่ถูกพิมพ์เป็นกรรมการ')
  const committeeOf = content => content.slice(content.indexOf('class="committee'), content.indexOf('ความเห็นแย้ง'))
  assert.match(textOf(committeeOf(html)), /ประธานกรรมการ[^]*กรรมการ[^]*กรรมการ/)
  const noPeople = buildInstallmentCertificateHtml({ ...f, people: [f.people.at(-1)] })   // เหลือแต่ผู้ควบคุมงาน = ไม่มีกรรมการ
  assert.equal((committeeOf(noPeople).match(/class="sign-row"/g) ?? []).length, 3, 'ไม่มีรายชื่อกรรมการ = 3 แถวเปล่า')
  assert.equal((committeeOf(noPeople).match(/\(\.{20,}\)/g) ?? []).length, 3, 'วงเล็บเว้นชื่อ 3 ช่อง')
  const blankText = textOf(committeeOf(noPeople))
  assert.ok(blankText.indexOf('ประธานกรรมการ') >= 0 && blankText.indexOf('ประธานกรรมการ') < blankText.indexOf('กรรมการ', blankText.indexOf('ประธานกรรมการ') + 12))
  const five = buildInstallmentCertificateHtml(fixture({ committee: 5 }))
  assert.equal((committeeOf(five).match(/class="sign-row"/g) ?? []).length, 5, 'กรรมการ 5 คนต้องมีครบ 5 ช่อง')
})

test('P9: เรื่อง/ชนิดตามประเภทคำขอ (ใช้ label CHANGE_KINDS เดิม) + ข้อเท็จจริง + บรรทัดนับ 15 วัน + ประโยคสิทธิ์ถูกยกขึ้นอ้างเสมอ', () => {
  const f = fixture()
  for (const [kind, subject] of [['extend_time', 'ขออนุมัติขยายเวลาทำการตามสัญญา'], ['waive_fine', 'ขออนุมัติงดค่าปรับ'], ['reduce_fine', 'ขออนุมัติลดค่าปรับ']]) {
    const text = printedText(buildChangeRequestMemoHtml({ ...f, change: { ...f.extend, kind } }))
    assert.ok(text.includes(`เรื่อง ${subject} โครงการ ก่อสร้างถนน คสล. สายบ้านหนองทดสอบ หมู่ที่ 5`), subject)
    assert.ok(text.includes('เรียน นายกองค์การบริหารส่วนตำบลทดสอบ'))
  }
  const text = printedText(buildChangeRequestMemoHtml({ ...f, change: f.extend }))
  for (const needle of [
    'กำหนดแล้วเสร็จ 13 ธันวาคม พ.ศ. 2569 อัตราค่าปรับวันละ 1,250.00 บาท',   // extended_until ก่อน end_date
    'ผู้รับจ้างมีหนังสือ (เลขที่ ผจ 12/2569 ลงวันที่ 29 ตุลาคม พ.ศ. 2569) ซึ่งหน่วยงานได้รับเมื่อวันที่ 30 ตุลาคม พ.ศ. 2569 ขอขยายเวลาทำการตามสัญญา จำนวน 15 วัน เนื่องจาก ฝนตกหนักต่อเนื่อง',
    'และเหตุดังกล่าวสิ้นสุดลงเมื่อวันที่ 20 ตุลาคม พ.ศ. 2569',
    'นับถัดจากวันที่เหตุสิ้นสุดถึงวันที่ได้รับหนังสือ รวม 10 วัน ซึ่งอยู่ภายใน 15 วัน ตามที่ข้อ 182 กำหนด',
    'ทั้งนี้ หากมิได้แจ้งภายในเวลาที่กำหนด คู่สัญญาจะยกมากล่าวอ้างในภายหลังมิได้ เว้นแต่กรณีเหตุเกิดจากความผิดหรือความบกพร่องของหน่วยงานของรัฐซึ่งมีหลักฐานชัดแจ้ง หรือหน่วยงานของรัฐทราบดีอยู่แล้วตั้งแต่ต้น',
    'เหตุดังกล่าว เกิดจากความผิดหรือความบกพร่องของหน่วยงานของรัฐ เหตุสุดวิสัย เกิดจากพฤติการณ์อันหนึ่งอันใดที่คู่สัญญาไม่ต้องรับผิดตามกฎหมาย เหตุอื่นตามที่กำหนดในกฎกระทรวง ไม่เข้ากรณีข้างต้น',
    'เห็นควร ให้ขยายเวลาทำการตามสัญญา จำนวน วัน ไม่ให้ เนื่องจาก', 'จึงเรียนมาเพื่อโปรดพิจารณา', 'ความเห็น/คำสั่ง', 'คำสั่ง อนุมัติ วัน ไม่อนุมัติ',
  ]) assert.ok(text.includes(needle), needle)
  // ไม่มี extended_until → ใช้ end_date
  const noExt = printedText(buildChangeRequestMemoHtml({ ...f, contract: { ...f.contract, extended_until: null }, change: f.extend }))
  assert.ok(noExt.includes('กำหนดแล้วเสร็จ 28 พฤศจิกายน พ.ศ. 2569'))
})

test('P9: เกิน 15 วัน = "เกิน 15 วัน" · ขาดวัน/วันสลับกัน = ให้ตรวจนับเอง ไม่เดา · ประโยคสิทธิ์ยังอยู่ทุกกรณี', () => {
  const f = fixture()
  const late = printedText(buildChangeRequestMemoHtml({ ...f, change: { ...f.extend, cause_ended_on: '2026-10-01', request_received_on: '2026-10-17' } }))
  assert.ok(late.includes('รวม 16 วัน ซึ่งเกิน 15 วัน ตามที่ข้อ 182 กำหนด'))
  assert.ok(!late.includes('ซึ่งอยู่ภายใน'))
  for (const patch of [{ cause_ended_on: null }, { request_received_on: '' }, { cause_ended_on: '2026-11-01', request_received_on: '2026-10-30' }]) {
    const text = printedText(buildChangeRequestMemoHtml({ ...f, change: { ...f.extend, ...patch } }))
    assert.ok(text.includes('ต้องตรวจนับเอง'), JSON.stringify(patch))
    assert.ok(!/ซึ่ง(อยู่ภายใน|เกิน) 15 วัน/.test(text), 'ห้ามฟันธงเมื่อวันที่ไม่ครบ')
    assert.ok(text.includes('คู่สัญญาจะยกมากล่าวอ้างในภายหลังมิได้'))
  }
})

test('P10: วงเล็บเพิ่ม/ลดวงเงิน · วันสิ้นสุดใหม่ · หมายเหตุ · ข้อพิจารณา 3 ข้อ · ข้อ 4 + วันที่เผยแพร่ · ช่องผู้รับรอง + เลขใบอนุญาต', () => {
  const f = fixture()
  const text = printedText(buildContractAmendMemoHtml({ ...f, change: f.amend }))
  for (const needle of [
    'เรื่อง ขออนุมัติแก้ไขสัญญาจ้างเลขที่ 25/2569 โครงการ ก่อสร้างถนน คสล.',
    'วงเงินลด 50,000.00 บาท (วงเงินตามสัญญาเดิม 1,250,000.00 บาท เป็น 1,200,000.00 บาท)',
    'วันสิ้นสุดสัญญาใหม่ 13 ธันวาคม พ.ศ. 2569', 'ปรับลดงานคันทางส่วนที่ไม่จำเป็น', 'เหตุที่ต้องแก้ไข ฝนตกหนักต่อเนื่อง',
    'การแก้ไขอยู่ภายในขอบข่ายแห่งวัตถุประสงค์เดิมของสัญญา',
    'ได้เปรียบเทียบคุณภาพหรือรายละเอียดของงาน รวมทั้งราคาของงานตามสัญญากับที่จะทำการแก้ไขแล้ว ผลการเปรียบเทียบ',
    'เป็นงานเกี่ยวกับความมั่นคงแข็งแรงหรืองานเทคนิคเฉพาะอย่าง ซึ่งได้รับการรับรองจากวิศวกร สถาปนิก หรือผู้ทรงคุณวุฒิแล้ว ตามช่องรับรองด้านล่าง',
    'เมื่อผู้มีอำนาจอนุมัติแล้ว ให้หัวหน้าหน่วยงานของรัฐเป็นผู้ลงนามในสัญญาที่ได้แก้ไข และเผยแพร่การแก้ไขสัญญาในระบบเครือข่ายสารสนเทศของกรมบัญชีกลาง วันที่เผยแพร่ 7 พฤศจิกายน พ.ศ. 2569',
    'ผู้รับรอง (วิศวกร/สถาปนิก/ผู้ทรงคุณวุฒิ)', 'เลขทะเบียนใบอนุญาต', 'คำสั่ง อนุมัติ ไม่อนุมัติ',
  ]) assert.ok(text.includes(needle), needle)
  const plus = printedText(buildContractAmendMemoHtml({ ...f, change: { ...f.amend, amount_change: 30000, new_end_date: null, note: '', egp_published_on: null } }))
  assert.ok(plus.includes('วงเงินเพิ่ม 30,000.00 บาท (วงเงินตามสัญญาเดิม 1,250,000.00 บาท เป็น 1,280,000.00 บาท)'))
  assert.ok(!plus.includes('วันสิ้นสุดสัญญาใหม่'))
  assert.match(plus, /วันที่เผยแพร่ ?$|วันที่เผยแพร่ [^ก-๙]*\s*4\. |วันที่เผยแพร่(?! \d)/, 'ไม่มีวันที่เผยแพร่ = ช่องว่าง/เส้นประ')
  const none = printedText(buildContractAmendMemoHtml({ ...f, change: { kind: 'amend_contract' } }))
  assert.ok(!none.includes('วงเงินเพิ่ม') && !none.includes('วงเงินลด'), 'ไม่มียอดเปลี่ยน = ไม่พิมพ์บรรทัดวงเงิน')
})

test('P12: หนังสือภายนอก — เรื่อง/เรียน/อ้างถึง + ย่อหน้า + ตัดบรรทัด detail + กำหนดแก้ไข (fix_due_on หรือ "ภายใน ..... วัน") + ลงนามนายก + กองผู้ถือเรื่อง/โทร.', () => {
  const f = fixture()
  const html = buildDefectNoticeLetterHtml({ ...f, defect: f.defect })
  const text = printedText(html)
  for (const needle of [
    'เรื่อง แจ้งให้แก้ไขความชำรุดบกพร่อง', 'เรียน หจก.ทดสอบก่อสร้าง', 'อ้างถึง สัญญาจ้างเลขที่ 25/2569 ลงวันที่ 1 กันยายน พ.ศ. 2569',
    'ตามที่ หจก.ทดสอบก่อสร้าง ได้ทำสัญญาจ้างกับองค์การบริหารส่วนตำบลทดสอบ ดำเนินโครงการ ก่อสร้างถนน คสล. สายบ้านหนองทดสอบ หมู่ที่ 5 ตามสัญญาที่อ้างถึง ซึ่งกำหนดให้ผู้รับจ้างรับประกันความชำรุดบกพร่องของงานจ้าง เป็นระยะเวลา 24 เดือน สิ้นสุดวันที่ 13 ธันวาคม พ.ศ. 2571 นั้น',
    'องค์การบริหารส่วนตำบลทดสอบ ได้ตรวจสอบเมื่อวันที่ 20 พฤศจิกายน พ.ศ. 2571 พบความชำรุดบกพร่อง ดังนี้',
    'จึงขอให้ท่านเข้าดำเนินการแก้ไขหรือซ่อมแซมให้ใช้การได้ดีดังเดิม ภายในวันที่ 5 ธันวาคม พ.ศ. 2571 ตามเงื่อนไขในสัญญา หากท่านไม่ดำเนินการภายในกำหนด องค์การบริหารส่วนตำบลทดสอบ จะพิจารณาดำเนินการตามสิทธิที่มีอยู่ตามสัญญาต่อไป',
    'จึงเรียนมาเพื่อโปรดดำเนินการ', 'ขอแสดงความนับถือ', '(นายสมพงษ์ นายกดี)', 'นายกองค์การบริหารส่วนตำบลทดสอบ', 'กองช่าง', 'โทร.',
    '99 หมู่ที่ 1 ตำบลทดสอบ', 'อำเภอตัวอย่าง จังหวัดแพร่ 54000',
  ]) assert.ok(text.includes(needle), needle)
  assert.equal((html.match(/<div class="detail">[\s\S]*?<\/div>/)[0].match(/<p>/g) ?? []).length, 3, 'detail 3 บรรทัดตาม \\n')
  const noDue = printedText(buildDefectNoticeLetterHtml({ ...f, defect: { ...f.defect, fix_due_on: null } }))
  assert.match(noDue, /ภายใน {1,2}วัน นับถัดจากวันที่ได้รับหนังสือนี้/)
  assert.ok(!html.includes('class="staff-sign"'), 'หนังสือภายนอกไม่ใช้ช่องลงนามเจ้าหน้าที่')
  assert.match(html, /<div class="screen-only">[^]*ข้อ 185[^]*ว 117 ข้อ 3[^]*<\/div>/)
  assert.ok(DEFECT_NOTICE_SCREEN_NOTE.startsWith('ร่างจากข้อมูลในระบบ — ตรวจถ้อยคำกับเงื่อนไขในสัญญาและงานพัสดุก่อนส่ง'))
  // ไม่มีที่อยู่ = เส้นประ (ไม่ query คอลัมน์ใหม่ ไม่เดา)
  const noAddress = buildDefectNoticeLetterHtml({ ...f, tenant: { name: f.tenant.name }, defect: f.defect })
  assert.ok(noAddress.includes('class="sender"') && noAddress.includes('min-width:60mm'))
})

test('P12: บรรทัด "สำเนาเรียน ผู้ค้ำประกัน" พิมพ์เมื่อ bank_guarantee / e_guarantee / ไม่ระบุชนิด · ไม่พิมพ์เมื่อ cash cheque_draft gov_bond other none', () => {
  const copy = type => printedText(build({ guaranteeType: type }).p12).includes('สำเนาเรียน')
  for (const type of ['bank_guarantee', 'e_guarantee', null, undefined, '']) assert.equal(copy(type), true, `${type}`)
  for (const type of ['cash', 'cheque_draft', 'gov_bond', 'other', 'none']) assert.equal(copy(type), false, `${type}`)
  assert.match(printedText(build({ guaranteeType: 'e_guarantee' }).p12), /สำเนาเรียน (\.* )?\(ผู้ค้ำประกัน ตามหลักประกันเลขที่ BG-2569\/0042\) เพื่อโปรดทราบ/)
  assert.equal(needsGuarantorCopy('bank_guarantee'), true)
  assert.equal(needsGuarantorCopy('cash'), false)
})

test('ไม่มีช่องติ๊กใดถูกติ๊กไว้ (ไม่มี ☑ ☒ ✓ ✔ checked box--on) แม้ฐานข้อมูลมี inspection_result / decision / result · มีช่องว่างครบตามถ้อยคำ', () => {
  const out = build()
  for (const key of DOCS) {
    const html = out[key]
    assert.ok(!/[☑☒✓✔]|checked|box--on/.test(html), `${key} มีช่องที่ถูกติ๊ก`)
    assert.ok(!/MARK-/.test(html), `${key} มีข้อมูลผลตรวจจากฐานข้อมูลรั่ว`)
  }
  const boxes = html => (html.match(/<span class="box"><\/span>/g) ?? []).length
  assert.equal(boxes(out.p8), 3, 'P8: ผลตรวจ 2 + ล่าช้า 1')
  assert.equal(boxes(out.p9), 5 + 2 + 2, 'P9: เหตุ 5 + เห็นควร 2 + คำสั่ง 2')
  assert.equal(boxes(out.p10), 3 + 2, 'P10: ข้อพิจารณา 3 + คำสั่ง 2')
  assert.equal(boxes(out.p11), 2 + 3, 'P11: ผลตรวจ 2 + คำสั่งนายก 3')
  // ผลพิจารณา (approved · 77 วัน · 5 พ.ย.) ไม่ถูกเติมลงช่อง "อนุมัติ ..... วัน"
  assert.ok(!out.p9.includes('77') && !out.p9.includes('5 พฤศจิกายน'))
  assert.ok(!out.p10.includes('77') && !out.p10.includes('5 พฤศจิกายน'))
})

test('esc: ใส่ <img src=x onerror=alert(1)> ในผู้รับจ้าง/ชื่อโครงการ/เลขสัญญา/cause/detail/ชื่อกรรมการ/ref/หลักประกัน → ไม่มีแท็กดิบ ทุกใบ', () => {
  const out = build({ evil: EVIL })
  const escaped = '&lt;img src=x onerror=alert(1)&gt;'
  for (const key of DOCS) {
    const html = out[key]
    assert.ok(!html.includes('<img src=x'), `${key} มีแท็กดิบ`)
    assert.ok(!html.includes('onerror=alert(1)>'), `${key} มี onerror ดิบ`)
    assert.ok(html.includes(escaped), `${key} ต้องมีข้อความ escape แล้ว`)
  }
  // ช่องที่ใบนั้นใช้จริง (ค่าทดสอบต่อท้ายด้วย EVIL ทุกช่อง)
  assert.ok(out.p8.includes(`หจก.ทดสอบก่อสร้าง${escaped}`) && out.p8.includes(`(นายสมชาย ใจดีมาก${escaped})`) && out.p8.includes(`รับ 88/2569${escaped}`))
  assert.ok(out.p9.includes(`ผจ 12/2569${escaped}`) && out.p9.includes(`ฝนตกหนักต่อเนื่อง`) && out.p9.includes(`${escaped} และเหตุดังกล่าว`))
  assert.ok(out.p10.includes(`ปรับลดงานคันทางส่วนที่ไม่จำเป็น${escaped}`))
  assert.ok(out.p11.includes(`BG-2569/0042${escaped}`))
  assert.ok(out.p12.includes(`รอยต่อระหว่างแผ่นพื้นหลายจุดยาแนวหลุดร่อนจนน้ำซึมลงชั้นรองพื้นทาง${escaped}`))
  // ชื่อผู้ลงนาม/ชื่อ อปท./กอง/ที่อยู่ ก็ต้อง escape
  const f = fixture()
  const evilSign = { department_head: { name: EVIL, title: EVIL }, clerk: { name: EVIL, title: EVIL }, mayor: { name: EVIL, title: EVIL } }
  const evilTenant = { ...f.tenant, name: `เทศบาล${EVIL}`, address: EVIL }
  const docs = [
    buildChangeRequestMemoHtml({ ...f, change: f.extend, signatories: evilSign, tenant: evilTenant, departmentName: EVIL }),
    buildContractAmendMemoHtml({ ...f, change: f.amend, signatories: evilSign, tenant: evilTenant, departmentName: EVIL }),
    buildWarrantyInspectionReportHtml({ ...f, signatories: evilSign, tenant: evilTenant, departmentName: EVIL }),
    buildDefectNoticeLetterHtml({ ...f, defect: f.defect, signatories: evilSign, tenant: evilTenant, departmentName: EVIL }),
    buildInstallmentCertificateHtml({ ...f, tenant: evilTenant }),
  ]
  for (const html of docs) assert.ok(!html.includes('<img src=x') && html.includes(escaped))
  // emblemUrl ผ่าน esc ด้วย
  assert.ok(!buildChangeRequestMemoHtml({ ...f, change: f.extend, emblemUrl: '"><script>alert(1)</script>' }).includes('<script>alert(1)'))
})

test('ผู้ลงนาม: มีทะเบียน = ชื่อ/ตำแหน่งจากทะเบียน · ไม่มี (null) = เส้นประ + ชื่อตำแหน่งสำรอง ไม่ใช่ช่องหาย · P9/P10 ใช้ช่องลงนามกลาง (staff-sign) · P11/P12 ไม่ใช้', () => {
  const withSign = build()
  for (const key of ['p9', 'p10']) {
    assert.ok(withSign[key].includes('class="staff-sign"'), `${key} ต้องมีช่องลงนามเจ้าหน้าที่ชุดกลาง`)
    for (const name of ['(นายสมบัติ ผู้อำนวยการ)', '(นางสมศรี ปลัดดี)', '(นายสมพงษ์ นายกดี)']) assert.ok(withSign[key].includes(name), `${key} ${name}`)
  }
  for (const key of ['p8', 'p11', 'p12']) assert.ok(!withSign[key].includes('class="staff-sign"'), key)
  assert.ok(withSign.p11.includes('(นางสมศรี ปลัดดี)') && withSign.p11.includes('(นายสมพงษ์ นายกดี)'))
  assert.ok(!withSign.p11.includes('นายสมบัติ ผู้อำนวยการ'), 'P11 ห้ามมีช่อง ผอ. ซ้ำ')
  assert.ok(withSign.p12.includes('(นายสมพงษ์ นายกดี)') && !withSign.p12.includes('นางสมศรี'))
  for (const signatories of [null, { department_head: null, clerk: null, mayor: null }]) {
    const bare = build({}, { signatories })
    assert.ok(bare.p9.includes('class="staff-sign"') && bare.p9.includes('ผู้อำนวยการกองช่าง') && bare.p9.includes('ปลัดองค์การบริหารส่วนตำบลทดสอบ') && bare.p9.includes('นายกองค์การบริหารส่วนตำบลทดสอบ'))
    assert.ok(/\(\.{20,}\)/.test(bare.p9), 'ไม่มีผู้ลงนาม = วงเล็บเว้นชื่อ')
    assert.ok(bare.p11.includes('ปลัดองค์การบริหารส่วนตำบลทดสอบ') && bare.p12.includes('นายกองค์การบริหารส่วนตำบลทดสอบ'))
  }
})

test('ข้อมูลว่าง/ขาด: ไม่พิมพ์ undefined null NaN และไม่ throw — ใบต้องพิมพ์ได้เสมอ (ค่าว่างเป็นเส้นประ)', () => {
  const tenant = { name: 'องค์การบริหารส่วนตำบลทดสอบ' }
  const bare = [
    buildInstallmentCertificateHtml({ tenant, project: {}, installment: { installment_no: 1 } }),
    buildInstallmentCertificateHtml(),
    buildChangeRequestMemoHtml({ tenant, project: {}, change: { kind: 'waive_fine' } }),
    buildChangeRequestMemoHtml(),
    buildContractAmendMemoHtml({ tenant, project: {}, change: { kind: 'amend_contract' } }),
    buildContractAmendMemoHtml(),
    buildWarrantyInspectionReportHtml({ tenant, project: {} }),
    buildWarrantyInspectionReportHtml(),
    buildDefectNoticeLetterHtml({ tenant, project: {}, defect: {} }),
    buildDefectNoticeLetterHtml(),
  ]
  for (const html of bare) {
    const text = textOf(html)
    assert.ok(!/undefined|\bnull\b|NaN|Invalid Date|\[object/.test(text), text.match(/.{0,30}(undefined|null|NaN|Invalid Date|\[object).{0,30}/)?.[0])
    assert.ok(html.includes('class="blank"'))
  }
})

await asyncTest('มาตรฐานเอกสารราชการ: THSarabunPSK 14pt + font-size-adjust 0.45 + ขอบ @page จากส่วนกลาง · ไม่เขียน font-family/@page เอง · แนวตั้ง A4 · footnote 11pt ลงกระดาษ (P9–P11)', async () => {
  const out = build()
  for (const key of DOCS) {
    const html = out[key]
    assert.ok(html.includes('font-family: "THSarabunPSK"'), `${key} ชื่อ family ติดกัน`)
    assert.ok(html.includes('font-size: 14pt') && html.includes('font-size-adjust: 0.45'), `${key} 14pt + adjust`)
    assert.ok(html.includes(`@page { size: A4 portrait; margin: ${GOV_PAGE_MARGIN}; }`), `${key} ขอบกระดาษแนวตั้ง`)
    assert.equal((html.match(/font-family:/g) ?? []).length, 1, `${key} ห้ามมี font-family ซ้ำ`)
    assert.equal((html.match(/@page\s*\{/g) ?? []).length, 1)
    assert.ok(html.includes('class="sign-row"'), `${key} ใช้ govSignRow`)
    assert.ok(html.includes('.sign-line') && html.includes('.sign-axis'), `${key} ใส่ govSignBlockCss`)
    assert.ok(/<link href="https:\/\/fonts\.googleapis\.com/.test(html), `${key} โหลดฟอนต์สำรอง`)
  }
  for (const [key, footnote] of [['p9', CHANGE_REQUEST_FOOTNOTE], ['p10', CONTRACT_AMEND_FOOTNOTE], ['p11', WARRANTY_REPORT_FOOTNOTE]]) {
    assert.ok(printedText(out[key]).includes(footnote), `${key} footnote ต้องลงกระดาษ`)
    assert.match(out[key], /\.footnote \{ font-size: 11pt;/)
    assert.ok(!out[key].includes('class="screen-only"'), `${key} เป็นเอกสารภายใน ไม่มีป้ายบนจอ`)
  }
  assert.ok(CHANGE_REQUEST_FOOTNOTE.includes('มาตรา 102') && CHANGE_REQUEST_FOOTNOTE.includes('ข้อ 182') && CHANGE_REQUEST_FOOTNOTE.includes('ระบบไม่วินิจฉัยว่าเข้าเหตุหรือไม่'))
  assert.ok(CONTRACT_AMEND_FOOTNOTE.includes('มาตรา 97 และ 98 (ต้องยืนยันกับฉบับปัจจุบัน)') && CONTRACT_AMEND_FOOTNOTE.includes('ข้อ 165'))
  assert.ok(WARRANTY_REPORT_FOOTNOTE.includes('ข้อ 184–186') && WARRANTY_REPORT_FOOTNOTE.includes('ว 117 ลว. 12 มี.ค. 2562'))
  // ไฟล์ต้นทาง: ห้ามเขียนฟอนต์/ขอบกระดาษเอง (ตัดคอมเมนต์บรรทัดออกก่อนตรวจ)
  const source = (await readFile(new URL('../src/lib/constructionLifecyclePrint.js', import.meta.url), 'utf8')).replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/font-family\s*:/.test(source), 'ไฟล์ใบพิมพ์ห้ามเขียน font-family เอง')
  assert.ok(!/@page\s*\{/.test(source), 'ไฟล์ใบพิมพ์ห้ามเขียน @page เอง')
})

await asyncTest('ต่อเข้าหน้าจอ: ปุ่มพิมพ์ 3 คอมโพเนนต์เรียก builder ถูกใบ · ผู้ดูพิมพ์ได้ (ปุ่มไม่อยู่ใต้เงื่อนไข canWrite) · P8 เฉพาะแถวที่มี delivered_on · P12 เฉพาะผลตรวจพบชำรุด · P11 เมื่อมีวันครบประกัน', async () => {
  const read = name => readFile(new URL(`../src/components/staff/construction/${name}`, import.meta.url), 'utf8')
  const [installments, changes, defects, hook] = await Promise.all([
    read('InstallmentsTable.jsx'), read('ContractChangesPanel.jsx'), read('DefectsSection.jsx'), read('useLifecyclePrint.js'),
  ]).then(files => files.map(file => file.replace(/\r\n/g, '\n')))
  assert.ok(installments.includes('buildInstallmentCertificateHtml') && /slot\.saved && slot\.delivered_on && \(\s*<button/.test(installments))
  assert.ok(!/canWrite && slot\.delivered_on/.test(installments), 'ผู้ดูต้องพิมพ์ได้')
  assert.ok(changes.includes("ch.kind === 'amend_contract' ? buildContractAmendMemoHtml : buildChangeRequestMemoHtml"))
  assert.ok(/<div className="mt-1 flex">\s*<button[^>]*onClick=\{\(\) => printMemo\(ch\)\}/.test(changes))
  assert.ok(defects.includes('buildWarrantyInspectionReportHtml') && defects.includes('buildDefectNoticeLetterHtml'))
  assert.ok(/warranty\.end && \(\s*<button[^>]*onClick=\{printReport\}/.test(defects))
  assert.ok(/row\.result === 'defect' && \(\s*<div className="mt-1 flex">\s*<button[^>]*onClick=\{\(\) => printNotice\(row\)\}/.test(defects))
  assert.ok(hook.includes('openLifecyclePrint'))
})

console.log(`\n${cases} cases passed`)

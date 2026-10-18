// แบบ 5 รายงานการสูญหาย/ความเสียหายยานพาหนะ (ระเบียบ มท. ยานพาหนะ อปท. พ.ศ. ๒๕๖๙ ข้อ ๑๘)
// ตรวจเนื้อหาใบพิมพ์ + กติกา PDPA ในโค้ด/migration + เลย์เอาต์ตอนพิมพ์จริง (Chrome)
// รันด้วย: npm run test:fleet:form5 — ไม่ล็อกอิน ไม่แตะฐานข้อมูล
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import {
  buildFleetForm5Html, form5DateText, form5People, form5SpeedText, form5TimeText,
  FORM5_MIN_PEOPLE_ROWS, INCIDENT_KIND_LABEL,
} from '../src/lib/fleetForm5Print.js'

// ── ค่าในช่อง ──────────────────────────────────────────────────────────────────
assert.equal(form5DateText('2026-10-18'), '18 ตุลาคม 2569')
assert.equal(form5DateText(''), '')
assert.equal(form5TimeText('14:05:00'), '14.05')
assert.equal(form5TimeText('9:30'), '09.30')
assert.equal(form5TimeText(null), '')
assert.equal(form5SpeedText(60), '60')
assert.equal(form5SpeedText(null), '')
assert.deepEqual(Object.keys(INCIDENT_KIND_LABEL).sort(), ['damage', 'loss'])

// ผู้บาดเจ็บ/พยานเว้นที่ขั้นต่ำ 2 คนตามแบบ มีมากกว่านั้นพิมพ์ครบ เรียงตามลำดับที่กรอก
assert.deepEqual(form5People([], 'witness', FORM5_MIN_PEOPLE_ROWS), [null, null])
const many = [3, 1, 2].map(n => ({ role: 'witness', full_name: `พยาน ${n}`, sort_order: n }))
assert.deepEqual(form5People(many, 'witness', 2).map(p => p.full_name), ['พยาน 1', 'พยาน 2', 'พยาน 3'])
assert.deepEqual(form5People(many, 'injured', 2), [null, null], 'ต้องกรองตามบทบาท')

// ── HTML: หัวข้อตามแบบท้ายระเบียบ เรียงตามลำดับ · escape · ไม่มีช่องลงนาม ──────────
const people = [
  { role: 'other_driver', full_name: 'นายคู่กรณี ทดสอบ', age: 35, license_no: '12345678', address: '1 หมู่ 2' },
  { role: 'other_owner', full_name: 'นางเจ้าของ รถ' },
  { role: 'injured', full_name: '<b>ผู้บาดเจ็บ</b>', age: 20, address: 'บ้านเลขที่ 5', sort_order: 0 },
  { role: 'witness', full_name: 'พยานหนึ่ง', age: 50, address: 'หมู่ 3', sort_order: 0 },
  { role: 'investigator', full_name: 'ร.ต.อ.สอบสวน' },
]
const incident = {
  incident_kind: 'damage', report_date: '2026-10-18', incident_date: '2026-10-17', incident_time: '14:05:00',
  location: 'ถนนสาย 101', speed_kmh: 60, origin: 'เทศบาลตำบลสาธิต', destination: 'อำเภอเมือง',
  damage: 'กันชนหน้าบุบ', other_vehicle: 'รถกระบะ', other_plate: 'กข 1234', other_cause: 'ตัดหน้า',
  other_damage: 'ไฟท้ายแตก', police_station: 'สภ.เมือง', case_result: 'ตกลงกันได้',
}
const html = buildFleetForm5Html({
  incident, people, vehicle: { name: 'รถยนต์', license_plate: 'กธ 3393 แพร่' }, orgName: 'เทศบาลตำบลสาธิต',
})
const body = html.slice(html.indexOf('<body>'))
const order = ['แบบ 5', 'วันที่', 'เดือน', 'พ.ศ.', 'เรื่อง รายงานการสูญหาย/ความเสียหายยานพาหนะหมายเลขทะเบียน', 'เรียน',
  'เหตุเกิดเมื่อวันที่', 'เวลา', 'สถานที่เกิดเหตุ', '(ดังแผนที่สังเขปที่แนบมานี้)', 'ความเร็วขณะเกิดเหตุ', 'กม./ชม.',
  'ก่อนเกิดเหตุเดินทางจาก', 'จะไป', 'ความเสียหาย', 'ยานพาหนะหรือทรัพย์สินฝ่ายตรงข้าม', 'หมายเลขทะเบียน', 'ขับขี่โดย',
  'ใบอนุญาตขับขี่เลขที่', 'ที่อยู่ของผู้ขับขี่', 'ชื่อเจ้าของยานพาหนะ', 'เหตุเกิดจาก', 'ผู้บาดเจ็บ',
  'ผู้สอบสวนและพยาน', 'พนักงานสอบสวนชื่อ', 'สถานีตำรวจ', 'พยานชื่อ', 'ผลของคดี']
let cursor = -1
for (const text of order) {
  const at = body.indexOf(text, cursor + 1)
  assert.ok(at > cursor, `แบบ 5 ต้องมี "${text}" ตามลำดับแบบท้ายระเบียบ`)
  cursor = at
}
for (const text of ['กธ 3393 แพร่', 'นายกเทศมนตรีตำบลสาธิต', '17 ตุลาคม 2569', '14.05', '18</span>', 'ตุลาคม</span>', '2569</span>',
  'นายคู่กรณี ทดสอบ', '12345678', 'นางเจ้าของ รถ', 'ร.ต.อ.สอบสวน', 'สภ.เมือง', 'ตกลงกันได้', 'ผ่านระบบ E-Service เทศบาลตำบลสาธิต']) {
  assert.ok(body.includes(text), `แบบ 5 ต้องมี "${text}"`)
}
assert.ok(body.includes('&lt;b&gt;ผู้บาดเจ็บ&lt;/b&gt;') && !body.includes('<b>ผู้บาดเจ็บ</b>'), 'ข้อความจากผู้ใช้ต้อง escape')
// ต้นฉบับไม่มีช่องลงนาม — เจ้าของระบบเลือกคงตามต้นฉบับ (2026-10-18)
for (const text of ['ลงชื่อ', 'ผู้รายงาน', 'ลงนาม']) {
  assert.equal(body.includes(text), false, `แบบ 5 ต้นฉบับไม่มี "${text}" ห้ามเติมเอง`)
}
// "เรียน" ที่กรอกเองชนะค่าปริยาย
assert.ok(buildFleetForm5Html({ incident: { addressee: 'ปลัดเทศบาล' }, orgName: 'เทศบาลตำบลสาธิต' }).includes('ปลัดเทศบาล'))

// ── กติกา PDPA ในโค้ด ────────────────────────────────────────────────────────────
const modal = readFileSync('src/components/fleet/FleetIncidentModal.jsx', 'utf8')
assert.equal(/logAction\s*\(/.test(modal), false, 'หน้ารายงานเหตุห้ามส่งข้อมูลลง logAction (มีข้อมูลบุคคลคนนอก)')
assert.equal(/console\.(log|info|debug)\s*\(/.test(modal), false, 'หน้ารายงานเหตุห้าม console.log ข้อมูล')
assert.ok(modal.includes("notifyTelegram('fleet_incident_reported', id)"), 'ต้องแจ้งผู้บริหารทันทีตามข้อ 18 (ด้วย id อย่างเดียว)')
const tables = readFileSync('supabase/migrations/20261018110000_fleet_incidents_tables.sql', 'utf8')
const security = readFileSync('supabase/migrations/20261018110100_fleet_incidents_security.sql', 'utf8')
const securityCode = security.replace(/--.*$/gm, '')
assert.equal(/EXECUTE FUNCTION public\.fleet_audit_row\(\)/.test(securityCode), false,
  '⚠️ PDPA: ตารางรายงานเหตุห้ามใช้ fleet_audit_row (คัดลอกทั้งแถวลง audit log)')
for (const table of ['fleet_incidents', 'fleet_incident_people']) {
  assert.ok(new RegExp(`AFTER INSERT OR UPDATE OR DELETE ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.fleet_audit_row_redacted\\(\\)`).test(securityCode),
    `${table} ต้องมี audit แบบไม่เก็บค่า`)
}
assert.ok(/USING \(public\.fleet_is_manager\(municipality_id\)\)/.test(securityCode), 'RLS ต้องจำกัดเฉพาะผู้ดูแลยานพาหนะ')
assert.ok(/REVOKE ALL ON public\.fleet_incidents, public\.fleet_incident_people FROM PUBLIC, anon, authenticated;/.test(securityCode),
  'ต้องถอนสิทธิ์ค่าเริ่มต้นของ Supabase (anon ได้ GRANT ALL กับตารางใหม่)')
assert.equal(/\binjur(y|ies)_detail|symptom|อาการ/.test(tables.replace(/--.*$/gm, '')), false, 'ห้ามมีช่องอาการบาดเจ็บ (ข้อมูลสุขภาพ)')

// ── เลย์เอาต์ตอนพิมพ์จริง: ข้อมูลครบ + ใบเปล่า ต้องจบ 1 หน้า (≤ 297 − 9 มม.) ─────────
const MM = 96 / 25.4
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: Math.round(210 * MM), height: Math.round(297 * MM) } })
  const results = []
  for (const [name, args] of [
    ['ข้อมูลครบ', { incident, people, vehicle: { license_plate: 'กธ 3393 แพร่' }, orgName: 'องค์การบริหารส่วนตำบลน้ำเลา' }],
    ['ใบเปล่า', { orgName: 'องค์การบริหารส่วนตำบลน้ำเลา' }],
  ]) {
    await page.setContent(buildFleetForm5Html(args), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.emulateMedia({ media: 'print' })
    await page.waitForTimeout(200)
    const measured = await page.evaluate(() => {
      const mm = 96 / 25.4
      const sheet = document.querySelector('.sheet')
      const top = sheet.getBoundingClientRect().top
      const right = sheet.getBoundingClientRect().right
      return {
        bottom: (document.querySelector('.eservice-origin').getBoundingClientRect().bottom - top) / mm,
        overflowRight: [...document.querySelectorAll('.line, .long')].filter(el => el.getBoundingClientRect().right > right + 1).length,
        // ป้ายต้องไม่ถูกบีบจนตัดบรรทัด (white-space: nowrap แล้วล้นแทน)
        squeezedFills: [...document.querySelectorAll('.fill')].filter(el => el.getBoundingClientRect().width < 6 * mm).length,
      }
    })
    results.push(`${name} ${measured.bottom.toFixed(1)}`)
    assert.ok(measured.bottom <= 288, `แบบ 5 (${name}) ล้น 1 หน้า: ${measured.bottom.toFixed(1)} มม. > 288 มม.`)
    assert.equal(measured.overflowRight, 0, `แบบ 5 (${name}) มีบรรทัดล้นขอบขวา`)
    assert.equal(measured.squeezedFills, 0, `แบบ 5 (${name}) มีช่องเติมที่แคบเกินเขียน/อ่าน`)
  }
  console.log(`fleet form 5 print assertions passed (${results.join(' · ')} มม. / 288)`)
} finally {
  await browser.close()
}

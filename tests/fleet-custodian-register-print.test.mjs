// ทะเบียนคุมยานพาหนะส่วนกลาง (เอกสารแนบท้ายคำสั่ง อปท. — เจ้าของระบบสั่งเพิ่ม 2026-10-20)
// ตรวจเนื้อหา/การจัดกลุ่ม (ไม่ต้องเปิดเบราว์เซอร์) + เลย์เอาต์ตอนพิมพ์จริง (เปิด Chrome วัดจาก DOM/PDF)
// รันด้วย: npm run test:fleet:custodian — ไม่ล็อกอิน ไม่แตะฐานข้อมูล
// ข้อมูลทดสอบเป็นชื่อสมมติทั้งหมด ไม่ใช้ชื่อเจ้าหน้าที่จริงจากต้นฉบับ
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import {
  UNASSIGNED_GROUP_KEY, buildFleetCustodianRegisterHtml, custodianSuggestions, groupCustodianRegister,
  groupTitleText, isCustodianRegisterVehicle, orgShortName,
} from '../src/lib/fleetCustodianRegisterPrint.js'

// ── ชื่อย่อหน่วยงานท้ายหัวกลุ่ม ────────────────────────────────────────────────────
assert.equal(orgShortName('องค์การบริหารส่วนตำบลทุ่งแค้ว'), 'อบต.ทุ่งแค้ว')
assert.equal(orgShortName('เทศบาลตำบลน้ำเลา'), 'ทต.น้ำเลา')
assert.equal(orgShortName('เทศบาลเมืองสาธิต'), 'ทม.สาธิต')
assert.equal(orgShortName('เทศบาลสาธิต'), 'เทศบาลสาธิต', 'ไม่รู้ระดับเทศบาล = ใช้ชื่อเต็ม ไม่เดาตัวย่อ')
assert.equal(orgShortName(''), '')

// ── รถที่อยู่ในทะเบียน ──────────────────────────────────────────────────────────
const central = { asset_kind: 'vehicle', regulation_category: 'central', status: 'active' }
assert.equal(isCustodianRegisterVehicle(central), true)
assert.equal(isCustodianRegisterVehicle({ ...central, regulation_category: undefined }), true, 'ไม่ระบุประเภท = ส่วนกลาง (ค่าปริยายของระบบ)')
assert.equal(isCustodianRegisterVehicle({ ...central, status: 'under_repair' }), true, 'รถกำลังซ่อมยังอยู่ในความดูแล')
assert.equal(isCustodianRegisterVehicle({ ...central, regulation_category: 'position' }), false, 'รถประจำตำแหน่งอยู่แบบ 1 ไม่ใช่ทะเบียนนี้')
assert.equal(isCustodianRegisterVehicle({ ...central, status: 'inactive' }), false, 'ปลดประจำการ')
assert.equal(isCustodianRegisterVehicle({ ...central, status: 'retired' }), false, 'ปลดระวาง')
assert.equal(isCustodianRegisterVehicle({ ...central, disposed_date: '2026-01-01' }), false, 'จำหน่ายแล้ว')
assert.equal(isCustodianRegisterVehicle({ ...central, asset_kind: 'engine' }), false, 'เครื่องยนต์/ครุภัณฑ์ไม่ใช่ยานพาหนะ')

// ── จัดกลุ่ม: ตาม sort_order ของกอง · เรียงเลขครุภัณฑ์แบบตัวเลข · ยังไม่ระบุไว้ท้ายสุด · ไม่มีรถหาย ─────
const departments = [
  { id: 'd-eng', name: 'กองช่าง', sort_order: 3 },
  { id: 'd-clerk', name: 'สำนักปลัด', sort_order: 1 },
  { id: 'd-soc', name: 'กองสวัสดิการสังคม', sort_order: 5 },
]
const v = (id, extra) => ({ id, name: `รถ ${id}`, license_plate: `กก ${id}`, asset_kind: 'vehicle', regulation_category: 'central', status: 'active', ...extra })
const sample = [
  v('c10', { asset_code: '001 49 0010', custodian_department_id: 'd-clerk' }),
  v('c2', { asset_code: '001 49 0002', custodian_department_id: 'd-clerk' }),
  v('c-nocode', { custodian_department_id: 'd-clerk' }),
  v('e1', { asset_code: '024 39 0001', custodian_department_id: 'd-eng' }),
  v('s1', { asset_code: '024 63 0003', custodian_department_id: 'd-soc' }),
  v('none', { asset_code: '999 99 0001' }),
  v('orphan', { asset_code: '999 99 0002', custodian_department_id: 'd-from-another-municipality' }),
  v('pos', { regulation_category: 'position', custodian_department_id: 'd-clerk' }),
  v('gone', { status: 'retired', custodian_department_id: 'd-clerk' }),
]
const groups = groupCustodianRegister(sample, departments)
assert.deepEqual(groups.map(group => group.key), ['d-clerk', 'd-eng', 'd-soc', UNASSIGNED_GROUP_KEY],
  'กลุ่มต้องเรียงตาม sort_order ของกอง และกลุ่มยังไม่ระบุอยู่ท้ายสุด')
assert.deepEqual(groups[0].vehicles.map(x => x.id), ['c2', 'c10', 'c-nocode'],
  'เรียงเลขครุภัณฑ์แบบตัวเลข (0002 ก่อน 0010) คันที่ไม่มีเลขไว้ท้ายกลุ่ม')
assert.deepEqual(groups[3].vehicles.map(x => x.id), ['none', 'orphan'],
  'รถที่ไม่ระบุกอง และรถที่ id กองไม่อยู่ในรายชื่อกองของ อปท. นี้ ต้องตกกลุ่มยังไม่ระบุ ไม่หายจากทะเบียน')
const inRegister = sample.filter(isCustodianRegisterVehicle).length
assert.equal(groups.reduce((sum, group) => sum + group.vehicles.length, 0), inRegister, 'ทุกคันที่อยู่ในทะเบียนต้องมีแถว')
assert.deepEqual(groupCustodianRegister([], departments), [], 'ไม่มีรถ = ไม่มีกลุ่ม')

// ── autocomplete ผู้รับผิดชอบ: ชื่อซ้ำใช้ตำแหน่งแรกที่ไม่ว่าง ──────────────────────────
assert.deepEqual(custodianSuggestions([
  { custodian_name: ' นายสมชาย  ใจดี ', custodian_position: '' },
  { custodian_name: 'นายสมชาย ใจดี', custodian_position: 'พนักงานขับรถยนต์' },
  { custodian_name: 'นายสมชาย ใจดี', custodian_position: 'ตำแหน่งอื่น' },
  { custodian_name: '', custodian_position: 'ไม่มีชื่อ' },
  { custodian_name: null },
]), [{ name: 'นายสมชาย ใจดี', position: 'พนักงานขับรถยนต์' }])

// ── หัวกลุ่มตรงต้นฉบับ: "ในครอบครองของ…" + "หัวหน้าหน่วยงานผู้ครอบครองยานพาหนะส่วนกลางได้แก่ …" ──
assert.equal(
  groupTitleText({ department: { name: 'สำนักปลัด' }, orgName: 'องค์การบริหารส่วนตำบลทุ่งแค้ว' }),
  'ยานพาหนะส่วนกลาง ที่อยู่ในครอบครองของสำนักปลัด อบต.ทุ่งแค้ว (หัวหน้าหน่วยงานผู้ครอบครองยานพาหนะส่วนกลางได้แก่ หัวหน้าสำนักปลัด)')
assert.ok(groupTitleText({ department: { name: 'กองช่าง' }, orgName: 'องค์การบริหารส่วนตำบลทุ่งแค้ว' })
  .endsWith('ได้แก่ ผู้อำนวยการกองช่าง)'))
assert.equal(groupTitleText({ department: null, orgName: 'อบต.' }), 'ยานพาหนะส่วนกลาง ที่ยังไม่ได้ระบุหน่วยงานผู้ครอบครอง')

// ── HTML: หัวตารางตามต้นฉบับ + escape + ลำดับเริ่ม 1 ใหม่ทุกกลุ่ม + เส้นประเลขคำสั่ง ──────────
const tenant = { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', district: 'อำเภอหนองม่วงไข่', province: 'แพร่' }
const named = [
  v('a1', { name: '<b>รถบรรทุก (ดีเซล)</b>', asset_code: '001 49 0001', custodian_department_id: 'd-clerk',
    custodian_name: 'นายสมชาย ใจดี', custodian_position: 'พนักงานขับรถยนต์' }),
  v('a2', { name: 'รถบรรทุกขยะ', asset_code: '011 66 0002', custodian_department_id: 'd-clerk', custodian_name: 'นายสมชาย ใจดี' }),
  v('b1', { name: 'รถจักรยานยนต์', asset_code: '024 39 0001', custodian_department_id: 'd-eng' }),
]
const html = buildFleetCustodianRegisterHtml({ vehicles: named, departments, tenant, asOf: '2026-10-20' })
for (const text of ['เอกสารแนบท้ายคำสั่งองค์การบริหารส่วนตำบลทุ่งแค้ว ที่', 'ลงวันที่', 'ทะเบียนคุมยานพาหนะส่วนกลาง',
  'องค์การบริหารส่วนตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่', 'ข้อมูล ณ วันที่ 20/10/2569', 'A4 landscape',
  'ที่อยู่ในครอบครองของ<span class="keep">สำนักปลัด</span> <span class="keep">อบต.ทุ่งแค้ว</span>',
  'ได้แก่ <span class="keep">หัวหน้าสำนักปลัด</span>)', 'ได้แก่ <span class="keep">ผู้อำนวยการกองช่าง</span>)',
  '<span class="keep">นายสมชาย ใจดี</span> <span class="keep">ตำแหน่ง พนักงานขับรถยนต์</span>']) {
  assert.ok(html.includes(text), `ทะเบียนต้องมี "${text}"`)
}
assert.ok(html.includes('&lt;b&gt;รถบรรทุก') && !html.includes('<b>รถบรรทุก'), 'ข้อความจากผู้ใช้ต้อง escape')
const registerStart = html.indexOf('<table class="register">')
const thead = html.slice(html.indexOf('<thead>', registerStart), html.indexOf('</thead>', registerStart))
const order = ['ลำดับ', 'หมายเลขพัสดุ', 'ประเภทรถ', 'เลขทะเบียนรถ', 'ผู้รับผิดชอบควบคุม/ดูแลยานพาหนะส่วนกลาง'].map(text => thead.indexOf(text))
assert.ok(order.every(index => index >= 0), 'หัวตารางไม่ครบตามต้นฉบับ')
assert.deepEqual([...order].sort((a, b) => a - b), order, 'ลำดับคอลัมน์ต้องตรงต้นฉบับ')
// ลำดับเริ่ม 1 ใหม่ทุกกลุ่ม (สำนักปลัด 2 คัน → 1,2 · กองช่าง 1 คัน → 1)
const numbers = [...html.matchAll(/<tr class="vehicle">\s*<td>(\d+)<\/td>/g)].map(match => Number(match[1]))
assert.deepEqual(numbers, [1, 2, 1])
// ตัวใบไม่อ้างเลขข้อของระเบียบ (ที่มาทางระเบียบของเอกสารนี้ยังไม่ยืนยัน) และเลขคำสั่งต้องเป็นเส้นประ ไม่มีเลขจริงติดมา
assert.equal(/ข้อ\s*[0-9๐-๙]/.test(html), false, 'ห้ามอ้างเลขข้อของระเบียบบนใบนี้')
assert.equal((html.match(/class="fill">&nbsp;<\/span>/g) ?? []).length, 2, 'เลขที่คำสั่งและวันที่คำสั่งต้องเป็นเส้นประให้เขียนมือ')
// หัวกลุ่มห้ามค้างท้ายหน้า + หัวตารางซ้ำทุกหน้า + ไม่ตัดแถวกลางคัน
assert.ok(/tr\.group\s*\{[^}]*break-after:\s*avoid/.test(html), 'หัวกลุ่มต้องไม่ค้างท้ายหน้า')
assert.ok(html.includes('thead { display: table-header-group; }') && /tr\s*\{[^}]*break-inside:\s*avoid/.test(html))
// ขอบบน/ล่างต้องซ้ำทุกหน้า (เดิม padding อยู่แค่หน้าแรก หน้า 2 หัวตารางชิดขอบกระดาษตรงรูเจาะแฟ้ม)
assert.ok(/<thead><tr><td class="space-top"><\/td><\/tr><\/thead>\s*<tfoot><tr><td class="space-bottom"><\/td><\/tr><\/tfoot>/.test(html),
  'ต้องมีแถวเว้นระยะบน/ล่างใน thead/tfoot ของตารางห่อนอก เพื่อให้ทุกหน้ามีขอบ')
assert.ok(html.includes('td.space-top { height: 3cm; }') && html.includes('td.space-bottom { height: 1cm; }'),
  'ขอบบน/ล่างต้องเป็นค่าแนวนอนตามมาตรฐาน govPagePadding (3cm / 1cm)')
// ไม่มีรถ → แถว "ไม่มี" ไม่ใช่ตารางเปล่า
assert.ok(buildFleetCustodianRegisterHtml({ vehicles: [], departments, tenant }).includes('— ไม่มียานพาหนะส่วนกลาง —'))

// ── หน้าจอ/ฐานข้อมูลต้องส่งครบทุกช่องที่ใบพิมพ์ใช้ ────────────────────────────────────
const report = readFileSync('src/components/fleet/FleetReport.jsx', 'utf8')
assert.ok(report.includes('printCustodianRegister') && report.includes('buildFleetCustodianRegisterHtml'), 'แท็บรายงานต้องมีปุ่มพิมพ์ทะเบียนคุม')
for (const column of ['asset_code', 'license_plate', 'status', 'regulation_category', 'disposed_date', 'custodian_department_id',
  'custodian_name', 'custodian_position']) {
  assert.ok(report.includes(column), `FleetReport ต้องดึง ${column} ไปพิมพ์ทะเบียนคุม`)
}
const custodianQuery = report.slice(report.indexOf('async function printCustodianRegister'), report.indexOf('async function openMemoDialog'))
assert.equal(custodianQuery.includes('departments('), false,
  'ห้ามฝัง departments(...) ใน fleet_vehicles — หน่วยงานผู้ครอบครองไม่มี FK ต้องดึงรายชื่อกองแยก')
assert.ok(custodianQuery.includes(".from('departments')"), 'ต้องดึงรายชื่อกองแยกเพื่อจับคู่ id')
const vehiclesForm = readFileSync('src/components/fleet/FleetVehicles.jsx', 'utf8')
for (const column of ['custodian_department_id', 'custodian_name', 'custodian_position']) {
  assert.ok(new RegExp(`value=\\{form\\.${column}\\}`).test(vehiclesForm), `ฟอร์มรถต้องมีช่องกรอก ${column}`)
  assert.ok(new RegExp(`${column}:\\s*form\\.${column}[^\\n]*\\|\\| null`).test(vehiclesForm), `${column} ที่ว่างต้องบันทึกเป็น null ไม่ใช่สตริงว่าง`)
  assert.ok(vehiclesForm.includes(`${column}: v.${column}`), `${column} ต้องอยู่ใน audit snapshot`)
}
const migration = readFileSync('supabase/migrations/20261020180000_fleet_vehicle_custodian.sql', 'utf8')
const migrationSql = migration.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
assert.ok(/ADD COLUMN IF NOT EXISTS custodian_department_id uuid,/.test(migrationSql), 'ต้องเป็น uuid ไม่บังคับ')
assert.equal(/custodian_department_id[^,;]*(REFERENCES|NOT NULL)/i.test(migrationSql), false,
  'ห้ามมี FK/NOT NULL — FK ที่สองไป departments ทำให้ PostgREST ตอบ PGRST201 กับคำขอที่ฝัง departments(...) ทั้งระบบ')
assert.equal(/FOREIGN KEY/i.test(migrationSql), false)

// ── เลย์เอาต์ตอนพิมพ์จริง (A4 แนวนอน 14pt) ───────────────────────────────────────
const MM = 96 / 25.4
const pdfPageCount = buffer => (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
const longPerson = { custodian_name: 'นายวีระวัฒน์ วังแก้ว', custodian_position: 'นักป้องกันและบรรเทาสาธารณภัยชำนาญการ' }
const worst = (count, prefix) => Array.from({ length: count }, (_, i) => v(`${prefix}${i}`, {
  name: 'รถบรรทุกน้ำอเนกประสงค์ ขนาดใหญ่', license_plate: 'กลพ 7870 แพร่', asset_code: `001-52-${String(i + 1).padStart(4, '0')}`,
  custodian_department_id: prefix, ...longPerson,
}))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const open = async (vehicles) => {
    const page = await browser.newPage({ viewport: { width: Math.round(297 * MM), height: Math.round(210 * MM) } })
    await page.setContent(buildFleetCustodianRegisterHtml({
      vehicles, departments: [{ id: 'd-clerk', name: 'สำนักปลัด', sort_order: 1 }, { id: 'd-soc', name: 'กองสวัสดิการสังคม', sort_order: 2 }],
      tenant, asOf: '2026-10-20',
    }), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.emulateMedia({ media: 'print' })
    await page.waitForTimeout(300)
    return page
  }

  // ค่ายาวสุดที่เป็นไปได้ต่อช่อง (ทุกคันชื่อยาว + ตำแหน่งยาวสุดในต้นฉบับ 38 ตัวอักษร) — วัดว่าไม่ล้นช่อง/เส้นตาราง
  // ชื่อ + "ตำแหน่ง …" ยาวสุดกว้างกว่าช่อง (~134 มม. ที่ 14pt) จึงตัดเป็น 2 บรรทัดระหว่างชื่อกับตำแหน่ง ซึ่งยอมรับได้
  // แต่ต้องไม่เกิน 2 บรรทัดและไม่ล้นเส้นขวา
  const worstPage = await open([
    ...worst(5, 'd-clerk').map(x => ({ ...x, custodian_department_id: 'd-clerk' })),
    ...worst(3, 'd-soc').map(x => ({ ...x, custodian_department_id: 'd-soc' })),
    v('plain', { asset_code: '024 63 0003', name: 'รถจักรยานยนต์ Honda Wave 125i', custodian_department_id: 'd-soc' }),
    // เลขครุภัณฑ์/ทะเบียนยาวผิดปกติ (ข้อมูลทดสอบจริงบนสนามซ้อมมีเลข 25 ตัวอักษร) ต้องตัดบรรทัด ไม่ล้นทับช่องข้างๆ
    v('longcode', { asset_code: 'TEST-ASSET-20260830051222', license_plate: 'TEST 20260830051222 แพร่', custodian_department_id: 'd-soc' }),
  ])
  try {
    const measured = await worstPage.evaluate(() => {
      const mm = 96 / 25.4
      const lineCount = cell => {
        const range = document.createRange()
        range.selectNodeContents(cell)
        return new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size
      }
      const rows = [...document.querySelectorAll('tr.vehicle')]
      const col = index => rows.map(row => row.children[index])
      return {
        tableWidth: document.querySelector('table.register').getBoundingClientRect().width / mm,
        overflowingHeaders: [...document.querySelectorAll('th')].filter(th => th.scrollWidth > th.clientWidth + 1).map(th => th.textContent.trim()),
        headerLines: Math.max(...[...document.querySelectorAll('th')].map(lineCount)),
        // ข้อมูลปกติ (เลขครุภัณฑ์ ≤13 ตัว ทะเบียน ≤14 ตัว) ต้องจบบรรทัดเดียว — แถวทดสอบข้อมูลยาวผิดปกติยกเว้น
        codeLines: Math.max(...col(1).filter(td => td.textContent.trim().length <= 13).map(lineCount)),
        plateLines: Math.max(...col(3).filter(td => td.textContent.trim().length <= 14).map(lineCount)),
        cellOverflow: [...document.querySelectorAll('table.register td')].filter(td => td.scrollWidth > td.clientWidth + 1).length,
        personLines: Math.max(...col(4).map(lineCount)),
        keepOverflow: rows.flatMap(row => [...row.querySelectorAll('.keep')]
          .filter(span => span.getBoundingClientRect().right > span.closest('td').getBoundingClientRect().right - 1)).length,
        groupRows: document.querySelectorAll('tr.group').length,
        vehicleRows: rows.length,
        titleSplit: [...document.querySelectorAll('tr.group .keep')].filter(span => {
          const range = document.createRange()
          range.selectNodeContents(span)
          return new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size > 1
        }).length,
      }
    })
    assert.ok(measured.tableWidth <= 257.5, `ตารางกว้างเกินพื้นที่พิมพ์: ${measured.tableWidth.toFixed(1)} มม.`)
    assert.deepEqual(measured.overflowingHeaders, [], 'หัวตารางล้นเส้นตาราง')
    assert.ok(measured.headerLines <= 2, `หัวตารางสูงเกิน 2 บรรทัด (${measured.headerLines})`)
    assert.equal(measured.codeLines, 1, 'เลขครุภัณฑ์ต้องจบบรรทัดเดียว')
    assert.equal(measured.plateLines, 1, 'ทะเบียนต้องจบบรรทัดเดียว')
    assert.ok(measured.personLines <= 2, `ชื่อ + ตำแหน่งยาวสุดควรไม่เกิน 2 บรรทัด (${measured.personLines})`)
    assert.equal(measured.keepOverflow, 0, 'ชื่อ/ตำแหน่ง/เลขล้นเส้นขวาของช่อง')
    assert.equal(measured.cellOverflow, 0, 'ข้อมูลยาวผิดปกติต้องตัดบรรทัด ไม่ล้นทับช่องข้างๆ')
    assert.equal(measured.groupRows, 2)
    assert.equal(measured.titleSplit, 0, 'ชื่อหน่วยงาน/ตำแหน่งหัวหน้าในหัวกลุ่มห้ามถูกตัดกลางคำ')
    assert.equal(measured.vehicleRows, 10)
    console.log(`fleet custodian register assertions passed (ตาราง ${measured.tableWidth.toFixed(1)} มม., ชื่อ+ตำแหน่งสูงสุด ${measured.personLines} บรรทัด)`)
  } finally {
    await worstPage.close()
  }

  // ขนาดและข้อมูลแบบต้นฉบับ (9 คัน 3 กลุ่ม ตำแหน่งส่วนใหญ่สั้น มีตำแหน่งยาว 1 คัน) ต้องจบ 1 แผ่น
  const person = (name, position) => ({ custodian_name: name, custodian_position: position })
  const original = await open([
    v('o1', { name: 'รถยนต์บรรทุก (ดีเซล)', asset_code: '001 49 0001', license_plate: 'กค 3307 แพร่', custodian_department_id: 'd-clerk', ...person('นายสมชาย ใจดี', 'พนักงานขับรถยนต์') }),
    v('o2', { name: 'รถบรรทุก (ดีเซล)', asset_code: '001 66 0002', license_plate: 'กธ 738 แพร่', custodian_department_id: 'd-clerk', ...person('นายสมชาย ใจดี', 'พนักงานขับรถยนต์') }),
    v('o3', { name: 'รถบรรทุกน้ำอเนกประสงค์', asset_code: '003 58 0001', license_plate: 'บพ 5534 แพร่', custodian_department_id: 'd-clerk', ...longPerson }),
    v('o4', { name: 'รถบรรทุกขยะมูลฝอย', asset_code: '011 47 0001', license_plate: 'บพ 7985 แพร่', custodian_department_id: 'd-clerk', ...person('นายสมชาย ใจดี', 'พนักงานขับรถยนต์') }),
    v('o5', { name: 'รถบรรทุกขยะ', asset_code: '011 66 0002', license_plate: '81-8381', custodian_department_id: 'd-clerk', ...person('นายสมชาย ใจดี', 'พนักงานขับรถยนต์') }),
    v('o6', { name: 'รถจักรยานยนต์ ฮอนด้า', asset_code: '024 39 0001', license_plate: 'กรต 856 แพร่', custodian_department_id: 'd-soc', ...person('นายสมหมาย รักดี', 'ผู้ช่วยนายช่างโยธา') }),
    v('o7', { name: 'รถจักรยานยนต์ Honda Wave', asset_code: '024 58 0002', license_plate: '1กค 9040 แพร่', custodian_department_id: 'd-soc', ...person('นายสมหมาย รักดี', 'ผู้ช่วยนายช่างโยธา') }),
    v('o8', { name: 'รถจักรยานยนต์ Honda Wave 110i', asset_code: '024 64 0004', license_plate: '1กฎ 5411 แพร่', custodian_department_id: 'd-soc', ...person('นายสมหมาย รักดี', 'ผู้ช่วยนายช่างโยธา') }),
    v('o9', { name: 'รถจักรยานยนต์ Honda Wave 125i', asset_code: '024 63 0003', license_plate: '1กญ 1029 แพร่', custodian_department_id: 'd-soc', ...person('นางสมศรี ขยันงาน', 'นักพัฒนาชุมชนชำนาญการ') }),
  ])
  try {
    const pdf = await original.pdf({ preferCSSPageSize: true, printBackground: true })
    assert.equal(pdfPageCount(pdf), 1, `ทะเบียนขนาดต้นฉบับ (9 คัน) ต้องจบ 1 แผ่น แต่ได้ ${pdfPageCount(pdf)}`)
  } finally {
    await original.close()
  }

  // ทะเบียนยาวต้องไหลข้ามหน้า (หัวตารางซ้ำ) และแถวไม่หาย
  const long = await open([
    ...worst(18, 'd-clerk').map(x => ({ ...x, custodian_department_id: 'd-clerk' })),
    ...worst(12, 'd-soc').map(x => ({ ...x, custodian_department_id: 'd-soc' })),
  ])
  try {
    const pdf = await long.pdf({ preferCSSPageSize: true, printBackground: true })
    assert.ok(pdfPageCount(pdf) >= 2, 'ทะเบียน 30 คันต้องไหลไปหน้าถัดไป')
    assert.equal(await long.locator('tr.vehicle').count(), 30, 'ไหลข้ามหน้าแล้วแถวต้องไม่หาย')
  } finally {
    await long.close()
  }
} finally {
  await browser.close()
}

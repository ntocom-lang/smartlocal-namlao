// แถว "แจ้งเหตุ/ขอความช่วยเหลือเรื่องน้ำ" ท้ายแท็บผังน้ำตำบล (src/lib/waterHelp.js + src/components/water/WaterHelpRow.jsx) — ตรรกะ + ล็อกว่าอ่านอย่างเดียว/ไม่ฝังเบอร์โทร
// เจ้าของระบบสั่ง 2569-10-24 "ครบ จบ เรื่องน้ำ จะไม่มีคำถามตามมา" · รันด้วย: node tests/water-help.test.mjs
//
// จุดที่ต้องไม่พลาด:
//  (1) ปุ่มหมวดขึ้นเฉพาะเมื่อ "เปิดใช้งานจริง + role นี้ยื่นได้ + โมดูลไม่ถูกปิด" — ไม่เดา · ข้อมูลเสีย = ไม่ขึ้นปุ่ม (เหลือแต่สายด่วน)
//  (2) ข้อมูลจริง production 2569-10-24: ไม่มี อปท. ไหนมีหมวด flood · water_supply เปิดให้ประชาชนที่ตำหนักธรรม/ทุ่งแค้ว แต่ปิด+เฉพาะผู้มีตำแหน่งที่น้ำเลา
//      → ที่น้ำเลาประชาชนเห็นแค่สายด่วน · ถ้ามีหมวดรหัส flood ในตารางของ อปท. ปุ่มขึ้นเอง (แอดมินสร้างรหัสนี้เองไม่ได้ — เมนูให้รหัสสุ่ม cat_xxxx)
//  (3) ไม่ฝังเบอร์โทร (เบอร์ฉุกเฉินอยู่ในฐานข้อมูลของแต่ละ อปท.) · ไม่มีช่องกรอก · ไม่เขียนข้อมูล
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OFFICIAL_ROLES } from '../src/lib/serviceAudience.js'
import {
  WATER_HELP_CATEGORIES, WATER_HELP_EMERGENCY_PATH, openWaterHelpCategories, waterHelpCategoryPath,
} from '../src/lib/waterHelp.js'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const row = (value, extra = {}) => ({ value, label: value === 'flood' ? 'น้ำท่วม/ระบายน้ำ' : 'สนับสนุนน้ำอุปโภค', emoji: value === 'flood' ? '🌊' : '🚿', is_active: true, submit_audience: 'public', ...extra })
const values = list => list.map(item => item.value)

// ── 1) ค่าคงที่ + ลิงก์ ──
{
  assert.deepEqual(WATER_HELP_CATEGORIES, ['flood', 'water_supply'], 'น้ำท่วมก่อน แล้วน้ำอุปโภค · ซ่อมประปา/ท่อระบายน้ำเป็นงานคนละเรื่อง ไม่ใส่')
  assert.equal(WATER_HELP_EMERGENCY_PATH, '/emergency')
  assert.equal(waterHelpCategoryPath('water_supply'), '/request?category=water_supply')
  assert.equal(waterHelpCategoryPath('a b&c'), '/request?category=a%20b%26c', 'รหัสหมวดต้องถูก encode')
  console.log('✓ ค่าคงที่: หมวด flood · water_supply · สายด่วน /emergency · ลิงก์ฟอร์มรับเรื่อง encode ถูก')
}

// ── 2) หมวดไหนขึ้นปุ่ม (เหมือนข้อมูลจริงของ 3 อปท. ณ 2569-10-24) ──
{
  // น้ำเลา: water_supply ปิด + เฉพาะผู้มีตำแหน่ง · ไม่มี flood → ประชาชนไม่เห็นปุ่มใดเลย
  const namlao = [row('water_supply', { is_active: false, submit_audience: 'officials' })]
  assert.deepEqual(openWaterHelpCategories(namlao, { role: 'citizen' }), [])
  assert.deepEqual(openWaterHelpCategories(namlao, {}), [], 'ไม่ล็อกอิน = ไม่เห็น')
  assert.deepEqual(openWaterHelpCategories(namlao, { role: OFFICIAL_ROLES[0] }), [], 'ปิดอยู่ (is_active=false) เจ้าหน้าที่ก็ไม่เห็นปุ่มที่พาไปฟอร์มที่ปิด')

  // ตำหนักธรรม/ทุ่งแค้ว: water_supply เปิดให้ทุกคน
  const open = [row('water_supply')]
  const result = openWaterHelpCategories(open, { role: 'citizen' })
  assert.deepEqual(result, [{ value: 'water_supply', label: 'สนับสนุนน้ำอุปโภค', emoji: '🚿', to: '/request?category=water_supply' }])
  assert.deepEqual(values(openWaterHelpCategories(open, {})), ['water_supply'], 'ไม่ล็อกอินก็ยื่นได้ (หมวด public)')

  // เมื่อมีหมวดรหัส flood ในตารางของ อปท. → ปุ่มขึ้นเอง ลำดับตามรายการ ไม่ตามลำดับแถว
  const both = [row('water_supply'), row('flood')]
  assert.deepEqual(values(openWaterHelpCategories(both, { role: 'citizen' })), ['flood', 'water_supply'])
  assert.deepEqual(values(openWaterHelpCategories([...both].reverse(), { role: 'citizen' })), ['flood', 'water_supply'])

  // เฉพาะผู้มีตำแหน่ง (เปิดอยู่): ประชาชนไม่เห็น ผู้มีตำแหน่งเห็น
  const officials = [row('flood', { submit_audience: 'officials' })]
  assert.deepEqual(openWaterHelpCategories(officials, { role: 'citizen' }), [])
  assert.deepEqual(values(openWaterHelpCategories(officials, { role: OFFICIAL_ROLES[0] })), ['flood'])

  // โมดูลถูกปิด → ซ่อน
  assert.deepEqual(openWaterHelpCategories(open, { role: 'citizen', hiddenValues: ['water_supply'] }), [])
  assert.deepEqual(values(openWaterHelpCategories(both, { role: 'citizen', hiddenValues: ['water_supply'] })), ['flood'])
  console.log('✓ หมวดที่ขึ้นปุ่ม: น้ำเลา (ปิด/เฉพาะผู้มีตำแหน่ง) ไม่ขึ้น · ตำหนักธรรม/ทุ่งแค้ว ขึ้น water_supply · มีหมวด flood ขึ้นเอง · ผู้มีตำแหน่ง/โมดูลปิดถูกต้อง')
}

// ── 3) ข้อมูลแปลกต้องไม่ทำให้ขึ้นปุ่มมั่ว/ไม่พัง ──
{
  for (const bad of [null, undefined, 'x', 3, {}, [null], [undefined], [{}], [{ value: null }], [{ value: 'water_supply' }]]) {
    assert.deepEqual(openWaterHelpCategories(bad, { role: 'citizen' }), [], `ข้อมูลแปลก ${JSON.stringify(bad)} ต้องไม่ขึ้นปุ่ม (แถวที่ไม่มี is_active=true ถือว่าไม่เปิด)`)
  }
  assert.deepEqual(openWaterHelpCategories([row('water_supply', { is_active: 'true' })], {}), [], 'is_active ต้องเป็น true จริง ไม่ใช่สตริง')
  assert.deepEqual(openWaterHelpCategories([row('water_supply', { is_active: null })], {}), [])
  // หมวดนอกรายการไม่ขึ้น (กันของ อปท. อื่นแอบเข้ามา) · แถวซ้ำ ใช้แถวแรก
  assert.deepEqual(openWaterHelpCategories([row('road'), row('trash'), row('water_repair'), row('drain')], {}), [])
  assert.deepEqual(openWaterHelpCategories([row('water_supply', { label: 'ขอรถน้ำ' }), row('water_supply', { label: 'ตัวซ้ำ' })], {}).map(item => item.label), ['ขอรถน้ำ'])
  // ชื่อหมวดที่ อบต. ตั้งเอง ใช้ตามนั้น · ชื่อว่าง/หน้าตาเป็นรหัส → ชื่อมาตรฐานภาษาไทย (ไม่หลุดรหัสดิบ)
  assert.equal(openWaterHelpCategories([row('water_supply', { label: 'ขอรถน้ำอุปโภค' })], {})[0].label, 'ขอรถน้ำอุปโภค')
  for (const label of [null, '', 'water_supply']) assert.equal(openWaterHelpCategories([row('water_supply', { label })], {})[0].label, 'สนับสนุนน้ำอุปโภค', `label ${JSON.stringify(label)} → ชื่อมาตรฐาน`)
  // emoji ไม่ใช่สตริง = ว่าง · ยาวเกิน = ตัด (ค่ามาจากตารางที่แอดมินแก้ได้)
  assert.equal(openWaterHelpCategories([row('water_supply', { emoji: 5 })], {})[0].emoji, '')
  assert.ok(openWaterHelpCategories([row('water_supply', { emoji: 'x'.repeat(50) })], {})[0].emoji.length <= 8)
  console.log('✓ ข้อมูลแปลก: ไม่ใช่ array/แถวเสีย/is_active ไม่ใช่ true = ไม่ขึ้น · หมวดนอกรายการไม่ขึ้น · แถวซ้ำใช้แถวแรก · ชื่อหมวดไม่หลุดรหัสดิบ')
}

// ── 4) หน้าจอ: อ่านอย่างเดียว · ไม่ฝังเบอร์ · ต่อเข้าหน้าถูกจุด ──
{
  const lib = read('src/lib/waterHelp.js')
  assert.ok(!/supabase|react/i.test(lib.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')), 'ตรรกะล้วน ต้องไม่ import supabase/react')
  const comp = read('src/components/water/WaterHelpRow.jsx')
  const code = comp.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  for (const tag of ['<input', '<textarea', '<select', '<form', 'contentEditable', 'onSubmit']) assert.ok(!code.includes(tag), `ส่วนนี้อ่านอย่างเดียว ห้ามมี ${tag}`)
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/.test(code), 'ห้ามเขียนข้อมูล/เรียก RPC')
  assert.ok(!/tel:|\b(?:191|1669|1784|199|1196)\b/.test(code), 'ห้ามฝังเบอร์โทร — เบอร์ฉุกเฉินอยู่ในฐานข้อมูลของแต่ละ อปท. หน้า /emergency แสดงให้')
  assert.ok(code.includes("from('complaint_categories')") && code.includes(".eq('municipality_id', tenant.id)") && code.includes(".in('value', WATER_HELP_CATEGORIES)"), 'อ่านเฉพาะหมวดของน้ำจาก อปท. นี้')
  assert.ok(code.includes('moduleHiddenCategoryValues(isModuleEnabled)') && code.includes('role'), 'ต้องกรองตามโมดูลและ role')
  assert.ok(code.includes('data-help-emergency') && code.includes('WATER_HELP_EMERGENCY_PATH'), 'สายด่วนต้องขึ้นเสมอ')
  assert.ok(code.includes('min-h-[44px]'), 'ปุ่มกดได้ ≥ 44px')
  for (const word of ['ปกติ', 'ปลอดภัย', 'รับรอง', 'พยากรณ์', 'จะท่วม', 'คาดว่า']) assert.ok(!comp.includes(word), `ห้ามมี "${word}"`)

  const page = read('src/pages/WaterSituationPage.jsx')
  assert.ok(page.includes("import WaterHelpRow from '../components/water/WaterHelpRow'"))
  const iRoute = page.indexOf('id="water-panel-route"')
  const iDiagram = page.indexOf('<WaterDiagram ')
  const iHelp = page.indexOf('<WaterHelpRow />')
  assert.ok(iRoute > 0 && iDiagram > iRoute && iHelp > iDiagram, 'แถวแจ้งเหตุอยู่ท้ายแท็บผังน้ำตำบล (หลังผัง ในแผงของแท็บนี้)')
  assert.equal(page.split('<WaterHelpRow />').length - 1, 1, 'ใช้ที่เดียว')
  assert.ok(page.indexOf('id="water-panel-situation"') < iRoute, 'ไม่อยู่ในแผงสถานการณ์')
  console.log('✓ หน้าจอ: อ่านอย่างเดียว · ไม่ฝังเบอร์โทร · อ่านเฉพาะหมวดน้ำของ อปท. นี้ · กรองโมดูล/role · อยู่ท้ายแท็บผังน้ำตำบลที่เดียว')
}

// ── 5) หมวด flood เป็นหมวดมาตรฐาน: รหัสเดียวกันทั้งปุ่มหน้าสถานการณ์น้ำ · หมวดตั้งต้นของแอดมิน · migration · ฟอร์มแจ้งเรื่อง ──
//   เดิมไม่มี อปท. ไหนมี flood และแอดมินสร้างรหัสนี้เองไม่ได้ (เมนูให้รหัสสุ่ม cat_xxxx) ปุ่มแจ้งน้ำท่วมจึงไม่มีวันขึ้น (เจ้าของระบบสั่งเพิ่ม 2569-10-24)
{
  const admin = read('src/pages/AdminDashboard.jsx')
  const seed = admin.slice(admin.indexOf('const DEFAULT_SEED'), admin.indexOf('const EMOJI_HINTS'))
  assert.match(seed, /value: 'flood',\s+label: 'น้ำท่วม\/ระบายน้ำ'/, 'หมวดตั้งต้นของแอดมินต้องมี flood (อปท. ใหม่ได้ครบเหมือนกัน)')
  assert.ok(WATER_HELP_CATEGORIES.includes('flood'), 'ปุ่มหน้าสถานการณ์น้ำต้องดูรหัส flood')
  assert.match(admin, /const engineering = new Set\(\[[^\]]*'flood'[^\]]*\]\)/, 'หมวดตั้งต้น flood ตกกองช่าง (engineering) ตามกติกาเดิม')
  assert.equal(admin.split("value: 'flood'").length - 1, 1, 'flood อยู่ในหมวดตั้งต้นที่เดียว')

  const migration = read('supabase/migrations/20261024120000_flood_standard_category.sql')
  const sql = migration.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
  assert.match(sql, /'flood',\s+'น้ำท่วม\/ระบายน้ำ'/); assert.match(sql, /resolve_work_department\(municipality\.id, 'engineering', 'กองช่าง'\)/)
  assert.match(sql, /water_supply\.value = 'water_supply'/, 'นโยบายเปิด/ผู้ยื่นต้องคัดลอกจาก water_supply ของ อปท. เดียวกัน')
  assert.match(sql, /NOT EXISTS[\s\S]*existing\.value = 'flood'/, 'ต้องข้าม อปท. ที่มี flood อยู่แล้ว (รันซ้ำได้)')
  assert.ok(!/UPDATE|DELETE|DROP|ALTER|TRUNCATE/i.test(sql), 'migration นี้เพิ่มข้อมูลอย่างเดียว ไม่แก้/ลบของเดิม')
  assert.ok(!/slug|namlao|tamnaktham|thungkaew/i.test(sql), 'ไม่ฝังชื่อ อปท. ในเงื่อนไข (หลังบ้านทุก อปท. ต้องเหมือนกัน)')

  const form = read('src/pages/CitizenForm.jsx')
  assert.match(form, /form\.category === 'flood' && \(\s*<div data-flood-notice/, 'ฟอร์มหมวดน้ำท่วมต้องมีข้อความเหตุฉุกเฉินโทรสายด่วนก่อน')
  assert.match(form, /<Link to="\/emergency"[^>]*>สายด่วนฉุกเฉิน<\/Link>/, 'ลิงก์ไปหน้าสายด่วน (ไม่ฝังเบอร์)')
  const notice = form.slice(form.indexOf('data-flood-notice'), form.indexOf('data-flood-notice') + 700)
  assert.ok(!/\b(191|1669|1784|199|1196)\b|tel:/.test(notice), 'ห้ามฝังเบอร์โทรในข้อความ')
  console.log('✓ หมวด flood มาตรฐาน: รหัสเดียวกันทั้งปุ่มหน้าสถานการณ์น้ำ · หมวดตั้งต้นแอดมิน (กองช่าง) · migration (เพิ่มอย่างเดียว ไม่ฝังชื่อ อปท.) · ฟอร์มมีข้อความเหตุฉุกเฉิน')
}

console.log('\n✅ water-help: ผ่านทุกข้อ')

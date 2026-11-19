// ตลาดชาวบ้าน (ขั้น 1A) — เทสต์ฟังก์ชันล้วน (src/lib/localMarket.js) + การลงทะเบียนโมดูลทุกจุด + ด่านตรวจซอร์สหน้าจอ
// ไม่ต่อเน็ต/ฐานข้อมูล · รันด้วย: node tests/local-market.test.mjs  (ส่วนฐานข้อมูลอยู่ที่ tests/local-market-db.test.mjs)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ATTEST_TEXT, EMPTY_PRODUCT_FORM, LOCAL_MARKET_MODULE_KEY, MARKET_DISCLAIMER, MARKET_FAVORITE_LIMIT, MARKET_PRODUCT_LIMIT,
  PRODUCT_LIMITS, PRODUCT_MANAGE_COLS, PRODUCT_PUBLIC_COLS, buildProductPayload, escapeIlike, formatPrice, formatPriceWithUnit,
  friendlyMarketError, ilikePattern, nextDisplayOrder, normalizeHideReason, normalizeSearchTerm, priceNumber, productToForm,
  shortThaiDate, sortProducts, validateProductForm,
} from '../src/lib/localMarket.js'
import { MANAGED_MODULE_KEYS, MODULE_GROUPS, moduleForPath } from '../src/lib/staffModules.js'
import { EXECUTIVE_REGISTRY } from '../src/lib/executiveRegistry.js'
import { STAFF_MENU_MODULE_KEYS } from '../src/lib/staffMenuAccess.js'
import { PAGE_CATALOG } from '../src/lib/siteOpenStats.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const okForm = (over = {}) => ({ ...EMPTY_PRODUCT_FORM, name: 'กล้วยตาก', price: '45', unit: 'ถุง', attest: true, ...over })

// ── ราคา ───────────────────────────────────────────────────────────────────────
test('คีย์โมดูล = local-market · เพดาน 30 สินค้า/ร้าน และ 200 รายการโปรด', () => {
  assert.equal(LOCAL_MARKET_MODULE_KEY, 'local-market')
  assert.equal(MARKET_PRODUCT_LIMIT, 30)
  assert.equal(MARKET_FAVORITE_LIMIT, 200)
})

test('formatPrice: null/ว่าง/อ่านไม่ได้ = "สอบถามราคา" · มีราคา = ฿ + คั่นหลักพัน th-TH', () => {
  assert.equal(formatPrice(null), 'สอบถามราคา')
  assert.equal(formatPrice(undefined), 'สอบถามราคา')
  assert.equal(formatPrice(''), 'สอบถามราคา')
  assert.equal(formatPrice('abc'), 'สอบถามราคา')
  assert.equal(formatPrice(NaN), 'สอบถามราคา')
  assert.equal(formatPrice(45), '฿45')
  assert.equal(formatPrice(1250), '฿1,250')
  assert.equal(formatPrice(1250000), '฿1,250,000')
  assert.equal(formatPrice('1,250.50'), '฿1,250.5')
  assert.equal(formatPrice(45.5), '฿45.5')
  assert.equal(formatPrice(0), '฿0') // ราคา 0 ถูกกฎของ CHECK (0..10,000,000) — ไม่ใช่ "สอบถามราคา"
  assert.equal(priceNumber('12.30'), 12.3)
})

test('formatPriceWithUnit: มีราคา+หน่วย = "฿45 / ถุง" · ไม่มีหน่วยหรือไม่มีราคา = ราคาอย่างเดียว', () => {
  assert.equal(formatPriceWithUnit(45, 'ถุง'), '฿45 / ถุง')
  assert.equal(formatPriceWithUnit(45, '  '), '฿45')
  assert.equal(formatPriceWithUnit(45, null), '฿45')
  assert.equal(formatPriceWithUnit(null, 'ถุง'), 'สอบถามราคา')
})

// ── ค้นหา ──────────────────────────────────────────────────────────────────────
test('escapeIlike: % _ \\ , ( ) ถูกนำหน้าด้วย \\ · * ถูกตัดทิ้ง (PostgREST แปลง * เป็น %) · ตัวควบคุมเป็นช่องว่าง', () => {
  assert.equal(escapeIlike('50%'), '50\\%')
  assert.equal(escapeIlike('a_b'), 'a\\_b')
  assert.equal(escapeIlike('a\\b'), 'a\\\\b')
  assert.equal(escapeIlike('ข้าว,ปลา'), 'ข้าว\\,ปลา')
  assert.equal(escapeIlike('ข้าว(กล้อง)'), 'ข้าว\\(กล้อง\\)')
  assert.equal(escapeIlike('a*b'), 'ab')
  assert.equal(escapeIlike('a\nb'), 'a b')
  assert.equal(escapeIlike('กล้วยตาก'), 'กล้วยตาก') // ภาษาไทยปกติไม่ถูกแตะ
  assert.equal(escapeIlike(null), '')
  // ผู้ใช้พิมพ์ wildcard ล้วนๆ ต้องไม่กลายเป็น "ตรงทุกแถว": ทุกตัวถูก escape หมด
  assert.equal(escapeIlike('%%'), '\\%\\%')
  assert.equal(escapeIlike('__'), '\\_\\_')
})

test('normalizeSearchTerm: ตัดช่องว่างซ้ำ · สั้นกว่า 2 ตัวอักษร = "" · ยาวเกิน 50 ตัดที่ 50', () => {
  assert.equal(normalizeSearchTerm('  ข้าว   กล้อง  '), 'ข้าว กล้อง')
  assert.equal(normalizeSearchTerm('ก'), '')
  assert.equal(normalizeSearchTerm(' ก '), '')
  assert.equal(normalizeSearchTerm('ปู'), 'ปู') // 2 ตัวอักษรพอดี ค้นได้
  assert.equal(normalizeSearchTerm(''), '')
  assert.equal(normalizeSearchTerm(null), '')
  assert.equal([...normalizeSearchTerm('ก'.repeat(80))].length, 50)
})

test('ilikePattern: คำสั้นเกิน = null (ไม่ยิงฐานข้อมูล) · ปกติ = %…% พร้อม escape', () => {
  assert.equal(ilikePattern('ก'), null)
  assert.equal(ilikePattern('  '), null)
  assert.equal(ilikePattern('ข้าว'), '%ข้าว%')
  assert.equal(ilikePattern('50%'), '%50\\%%')
})

// ── ข้อความผิดพลาด ──────────────────────────────────────────────────────────────
test('friendlyMarketError: ข้อความไทยของฐานข้อมูล (เพดาน 30 / 200 / ต้องระบุเหตุผล) ส่งต่อตามนั้น', () => {
  const cap30 = 'ร้านนี้มีสินค้าครบ 30 รายการแล้ว ลบรายการเก่าก่อนเพิ่มใหม่'
  const cap200 = 'บันทึกรายการโปรดได้สูงสุด 200 แห่ง'
  assert.equal(friendlyMarketError({ code: 'P0001', message: cap30 }), cap30)
  assert.equal(friendlyMarketError({ code: 'P0001', message: cap200 }), cap200)
  assert.match(friendlyMarketError({ code: 'P0001', message: 'กรุณาระบุเหตุผลที่ซ่อน (เจ้าของร้านจะเห็นเหตุผลนี้)' }), /เหตุผล/)
})

test('friendlyMarketError: 42501/RLS/permission denied = ไม่มีสิทธิ์ (ไทย) · ไม่โชว์ข้อความอังกฤษจาก DB', () => {
  const eng = [
    { code: '42501', message: 'permission denied for table market_products' },
    { code: '42501', message: 'new row violates row-level security policy for table "market_products"' },
    { message: 'permission denied for table market_products' },
    { code: '23514', message: 'new row for relation "market_products" violates check constraint "market_products_image_url_check"' },
    { code: '23505', message: 'duplicate key value violates unique constraint "tourism_favorites_pkey"' },
    { code: '23503', message: 'insert or update on table violates foreign key constraint' },
    { code: 'PGRST301', message: 'JWT expired' },
    { message: 'TypeError: Failed to fetch' },
  ]
  for (const e of eng) {
    const out = friendlyMarketError(e)
    assert.ok(/[฀-๿]/.test(out), `ต้องเป็นไทย: ${JSON.stringify(e)} → ${out}`)
    assert.doesNotMatch(out, /[A-Za-z]{4,}/.test(out) ? /^$/ : /^x^/, 'ตรวจด้านล่าง')
    assert.ok(!/permission denied|violates|duplicate key|JWT|fetch|constraint|policy/i.test(out), `ข้อความอังกฤษหลุด: ${out}`)
  }
  assert.match(friendlyMarketError({ code: '42501', message: 'permission denied' }), /ไม่มีสิทธิ์/)
  assert.match(friendlyMarketError({ message: 'TypeError: Failed to fetch' }), /เชื่อมต่อ/)
})

test('friendlyMarketError: ไม่มี error = "" · error แปลกๆ ได้ข้อความสำรองที่ส่งเข้ามา', () => {
  assert.equal(friendlyMarketError(null), '')
  assert.equal(friendlyMarketError(undefined), '')
  assert.equal(friendlyMarketError({ message: 'weird' }, 'เพิ่มสินค้าไม่สำเร็จ'), 'เพิ่มสินค้าไม่สำเร็จ')
  assert.ok(friendlyMarketError({ message: 'weird' }).length > 0)
})

// ── ฟอร์มสินค้า ─────────────────────────────────────────────────────────────────
test('validateProductForm: ต้องมีชื่อ · ชื่อ/รายละเอียด/หน่วยไม่เกินเพดาน · ต้องติ๊กรับรอง', () => {
  assert.equal(validateProductForm(okForm()), '')
  assert.match(validateProductForm(okForm({ name: '   ' })), /ชื่อสินค้า/)
  assert.match(validateProductForm(okForm({ name: 'ก'.repeat(PRODUCT_LIMITS.nameMax + 1) })), /ชื่อสินค้ายาวเกิน/)
  assert.equal(validateProductForm(okForm({ name: 'ก'.repeat(PRODUCT_LIMITS.nameMax) })), '')
  assert.match(validateProductForm(okForm({ description: 'ก'.repeat(PRODUCT_LIMITS.descriptionMax + 1) })), /รายละเอียดยาวเกิน/)
  assert.match(validateProductForm(okForm({ unit: 'ก'.repeat(PRODUCT_LIMITS.unitMax + 1) })), /หน่วยยาวเกิน/)
  assert.match(validateProductForm(okForm({ attest: false })), /รับรอง/)
  assert.match(validateProductForm({ ...okForm(), attest: 'true' }), /รับรอง/) // ต้องเป็น true จริง
})

test('validateProductForm: ราคา — ว่าง = สอบถามราคา ผ่าน · ติดลบ/ตัวอักษร/ทศนิยมเกิน 2/เกินเพดาน ไม่ผ่าน', () => {
  assert.equal(validateProductForm(okForm({ price: '' })), '')
  assert.equal(validateProductForm(okForm({ price: '0' })), '')
  assert.equal(validateProductForm(okForm({ price: '1,250.50' })), '')
  assert.equal(validateProductForm(okForm({ price: '10000000' })), '')
  for (const bad of ['-5', 'abc', '12.345', '1e3', '10000001', '12.', '.5']) {
    assert.match(validateProductForm(okForm({ price: bad })), /ราคา/, bad)
  }
})

test('validateProductForm: รูปรับเฉพาะไฟล์ที่อัปโหลดผ่านระบบ (drive-file / storage สาธารณะ) — ตรงกับ CHECK ในตาราง', () => {
  assert.equal(validateProductForm(okForm({ image_url: '' })), '')
  assert.equal(validateProductForm(okForm({ image_url: 'https://x.supabase.co/functions/v1/drive-file?id=abc123XYZ_-' })), '')
  assert.equal(validateProductForm(okForm({ image_url: 'https://x.supabase.co/storage/v1/object/public/complaint-attachments/a.jpg' })), '')
  for (const bad of ['http://x.test/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'drive:FILEID123', 'https://a.test/x y.jpg', 'https://a.test/"onerror=',
    'https://example.com/a.jpg', 'https://x.supabase.co.evil.com/functions/v1/drive-file?id=1', 'https://x.supabase.co/functions/v1/drive-file?id=1&u=https://e',
    'https://x.supabase.co/storage/v1/object/public/../../../functions/v1/x']) {
    assert.match(validateProductForm(okForm({ image_url: bad })), /รูป/, bad)
  }
})

test('buildProductPayload: เฉพาะคอลัมน์ที่ authenticated เขียนได้ · ไม่มี municipality_id/is_hidden/hidden_reason/created_at', () => {
  const p = buildProductPayload(okForm({ description: '  หวานธรรมชาติ  ', image_url: ' https://a.test/i.jpg ' }), { placeId: 'P1', displayOrder: 3 })
  assert.deepEqual(p, {
    name: 'กล้วยตาก', description: 'หวานธรรมชาติ', price: 45, unit: 'ถุง', image_url: 'https://a.test/i.jpg',
    is_available: true, attest_lawful: true, place_id: 'P1', display_order: 3,
  })
  for (const forbidden of ['municipality_id', 'is_hidden', 'hidden_reason', 'created_at', 'updated_at', 'id']) {
    assert.ok(!(forbidden in p), `ห้ามส่ง ${forbidden}`)
  }
})

test('buildProductPayload: แก้ไข (ไม่ส่ง placeId) ไม่มี place_id · ราคาว่าง = null · ค่าว่างเป็น null · display_order ถูกบีบในช่วง 0..999', () => {
  const p = buildProductPayload(okForm({ price: '', unit: '', description: '', image_url: '', is_available: false }))
  assert.equal('place_id' in p, false)
  assert.equal(p.price, null)
  assert.equal(p.unit, null)
  assert.equal(p.description, null)
  assert.equal(p.image_url, null)
  assert.equal(p.is_available, false)
  assert.equal('display_order' in p, false)
  assert.equal(buildProductPayload(okForm(), { placeId: 'P', displayOrder: 5000 }).display_order, 999)
  assert.equal(buildProductPayload(okForm(), { placeId: 'P', displayOrder: -3 }).display_order, 0)
  assert.equal(buildProductPayload(okForm({ attest: false })).attest_lawful, false) // ไม่ติ๊ก = ฐานข้อมูลปฏิเสธ (CHECK) ไม่ใช่เติมให้เอง
})

test('productToForm: ติ๊กรับรองต้องติ๊กใหม่ทุกครั้งที่บันทึก · ราคาว่างแปลงเป็นสตริงว่าง', () => {
  const f = productToForm({ name: 'ข้าวกล้อง', description: null, price: '120.00', unit: 'กก.', image_url: null, is_available: false })
  assert.equal(f.attest, false)
  assert.equal(f.price, '120')
  assert.equal(f.is_available, false)
  assert.equal(f.description, '')
  assert.equal(productToForm({ name: 'x', price: null }).price, '')
})

test('nextDisplayOrder / sortProducts / normalizeHideReason / shortThaiDate', () => {
  assert.equal(nextDisplayOrder([]), 0)
  assert.equal(nextDisplayOrder(null), 0)
  assert.equal(nextDisplayOrder([{ display_order: 0 }, { display_order: 4 }, { display_order: 2 }]), 5)
  assert.equal(nextDisplayOrder([{ display_order: 999 }]), 999)
  assert.deepEqual(sortProducts([{ name: 'ข', display_order: 1 }, { name: 'ก', display_order: 1 }, { name: 'ค', display_order: 0 }]).map(p => p.name), ['ค', 'ก', 'ข'])
  assert.equal(normalizeHideReason('  สินค้าไม่เหมาะสม  '), 'สินค้าไม่เหมาะสม')
  assert.equal(normalizeHideReason(null), '')
  assert.equal(normalizeHideReason('ก'.repeat(400)).length, PRODUCT_LIMITS.hiddenReasonMax)
  assert.equal(shortThaiDate(null), '')
  assert.equal(shortThaiDate('ไม่ใช่วันที่'), '')
  assert.ok(shortThaiDate('2026-11-19T03:00:00Z').length > 0)
})

test('ถ้อยคำรับรอง = ตามที่เจ้าของระบบกำหนด และไม่อ้างเลขมาตรา/ชื่อกฎหมาย', () => {
  assert.equal(ATTEST_TEXT, 'ข้าพเจ้ารับรองว่าสินค้านี้จำหน่ายได้โดยชอบด้วยกฎหมาย และข้อมูลเป็นความจริง')
  assert.doesNotMatch(ATTEST_TEXT, /มาตรา|พ\.ร\.บ|พระราชบัญญัติ|ประกาศ|ระเบียบ/)
  assert.equal(MARKET_DISCLAIMER, 'ติดต่อสั่งซื้อกับร้านโดยตรง หน่วยงานไม่ได้เป็นผู้ขาย')
})

// ── เทียบกับไฟล์ SQL (กันโค้ดกับฐานข้อมูลหลุดจากกัน) ───────────────────────────────
const rlsSql = read('supabase/migrations/20261214100100_local_market_rls_rpc.sql')
const tablesSql = read('supabase/migrations/20261214100000_local_market_tables.sql')

test('PRODUCT_PUBLIC_COLS = คอลัมน์ที่ GRANT SELECT ให้ anon ใน SQL เป๊ะ (ไม่มี hidden_reason / attest_lawful)', () => {
  const m = /GRANT SELECT \(([^)]+)\)\s+ON public\.market_products TO anon/.exec(rlsSql)
  assert.ok(m, 'ไม่พบ GRANT SELECT (...) ON public.market_products TO anon')
  const sqlCols = m[1].split(',').map(s => s.trim()).sort()
  const codeCols = PRODUCT_PUBLIC_COLS.split(',').map(s => s.trim()).sort()
  assert.deepEqual(codeCols, sqlCols)
  assert.ok(!codeCols.includes('hidden_reason') && !codeCols.includes('attest_lawful'))
  assert.ok(PRODUCT_MANAGE_COLS.includes('hidden_reason') && PRODUCT_MANAGE_COLS.includes('attest_lawful'))
  assert.ok(!/\*/.test(PRODUCT_PUBLIC_COLS) && !/\*/.test(PRODUCT_MANAGE_COLS), 'ห้ามใช้ select(*) กับตารางนี้')
})

test('คอลัมน์ที่ authenticated เขียนได้ (INSERT/UPDATE) ตรงกับ payload ของ buildProductPayload', () => {
  const ins = /GRANT INSERT \(([^)]+)\)\s+ON public\.market_products TO authenticated/.exec(rlsSql)
  const upd = /GRANT UPDATE \(([^)]+)\)\s+ON public\.market_products TO authenticated/.exec(rlsSql)
  assert.ok(ins && upd)
  const insCols = new Set(ins[1].split(',').map(s => s.trim()))
  const updCols = new Set(upd[1].split(',').map(s => s.trim()))
  const create = Object.keys(buildProductPayload(okForm(), { placeId: 'P', displayOrder: 1 }))
  for (const k of create) assert.ok(insCols.has(k), `INSERT ส่ง ${k} แต่ไม่มีสิทธิ์`)
  const update = Object.keys(buildProductPayload(okForm()))
  for (const k of update) assert.ok(updCols.has(k), `UPDATE ส่ง ${k} แต่ไม่มีสิทธิ์`)
  assert.ok(!updCols.has('place_id'), 'UPDATE ห้ามแก้ place_id')
})

test('เพดาน 30 สินค้า/ร้าน และ 200 รายการโปรด ตรงกับ trigger ใน SQL · ชื่อ RPC ที่โค้ดเรียกมีใน SQL', () => {
  assert.match(rlsSql, new RegExp(`>= ${MARKET_PRODUCT_LIMIT} THEN`))
  assert.match(rlsSql, new RegExp(`>= ${MARKET_FAVORITE_LIMIT} THEN`))
  for (const rpc of ['market_set_product_hidden', 'market_link_owner_from_registration', 'market_unlink_owner']) {
    assert.match(rlsSql, new RegExp(`FUNCTION public\\.${rpc}\\(`), rpc)
  }
  // ขีดจำกัดความยาว/ราคาในตาราง
  assert.match(tablesSql, new RegExp(`BETWEEN 1 AND ${PRODUCT_LIMITS.nameMax}`))
  assert.match(tablesSql, new RegExp(`length\\(description\\) <= ${PRODUCT_LIMITS.descriptionMax}`))
  assert.match(tablesSql, new RegExp(`length\\(unit\\) <= ${PRODUCT_LIMITS.unitMax}`))
  assert.match(tablesSql, new RegExp(`BETWEEN 0 AND ${PRODUCT_LIMITS.priceMax}`))
  assert.match(tablesSql, new RegExp(`length\\(hidden_reason\\) <= ${PRODUCT_LIMITS.hiddenReasonMax}`))
})

// ── การลงทะเบียนโมดูล (แบบเดียวกับ #760) ────────────────────────────────────────────
test('ลงทะเบียนโมดูล local-market ครบ: MODULE_GROUPS (กลุ่มเดียวกับ tourism, requires tourism) · MODULE_ROUTES · ห้องผู้บริหาร · PAGE_CATALOG', () => {
  assert.ok(MANAGED_MODULE_KEYS.includes('local-market'))
  const group = MODULE_GROUPS.find(g => g.items.some(i => i.key === 'local-market'))
  assert.ok(group?.items.some(i => i.key === 'tourism'), 'ต้องอยู่กลุ่มเดียวกับ tourism')
  const item = group.items.find(i => i.key === 'local-market')
  assert.deepEqual(item.requires, ['tourism'])
  assert.match(item.desc, /เจ้าของร้าน/)
  assert.match(item.desc, /ซ่อน/)
  assert.equal(moduleForPath('/my-shop'), 'local-market')
  assert.equal(moduleForPath('/my-shop/'), 'local-market')
  assert.equal(moduleForPath('/tourism/abc'), 'tourism') // ส่วนสินค้าใน /tourism/:id ไม่ถูกบล็อกทั้งหน้า (ซ่อนเองตามโมดูล)
  const exec = EXECUTIVE_REGISTRY.find(e => e.key === 'local-market')
  assert.ok(exec, 'ต้องอยู่ในทะเบียนห้องผู้บริหาร')
  assert.deepEqual(exec.kpis, [])
  assert.equal(exec.link.module, 'tourism')
  assert.ok(PAGE_CATALOG.some(p => p.key === 'my-shop' && p.path === '/my-shop'))
})

test('ไม่มีเมนูเจ้าหน้าที่ใหม่: local-market ไม่อยู่ใน STAFF_MENU_MODULE_KEYS (งานเจ้าหน้าที่อยู่ในเมนู tourism เดิม)', () => {
  assert.ok(!STAFF_MENU_MODULE_KEYS.includes('local-market'))
  assert.ok(STAFF_MENU_MODULE_KEYS.includes('tourism'))
})

// ── ด่านตรวจซอร์สหน้าจอ ────────────────────────────────────────────────────────
test('ฟังก์ชันเรียกฐานข้อมูล: ไม่ select * · ค้นหาสินค้าเลือกเฉพาะคอลัมน์ข้อความ (ไม่โหลด image_url) · เรียก RPC ชื่อถูก', () => {
  const api = read('src/lib/localMarketApi.js')
  assert.doesNotMatch(api, /\.select\('\*'\)/)
  assert.match(api, /select\('id, place_id, name, price, unit'\)/)
  assert.match(api, /\.ilike\('name', pattern\)/)
  assert.match(api, /\.eq\('is_hidden', false\)/)
  assert.match(api, /\.limit\(SEARCH_RESULT_LIMIT\)/)
  assert.match(api, /rpc\('market_set_product_hidden'/)
  assert.match(api, /rpc\('market_link_owner_from_registration'/)
  assert.match(api, /rpc\('market_unlink_owner'/)
  assert.match(api, /insert\(\{ place_id: placeId \}\)/) // รายการโปรดส่งแค่ place_id
  assert.match(api, /error\.code !== '23505'/)
})

test('หน้าอนุมัติคำขอ: ผูกเจ้าของร้านหลังอัปเดตสถานะ approved · ผูกล้มไม่ล้มการอนุมัติ · ไม่มี user_id ข้าม', () => {
  const src = read('src/components/admin/BusinessRegistrationAdmin.jsx')
  assert.match(src, /\.select\('id'\)\.single\(\)/)
  const approvedAt = src.indexOf("status:      'approved'")
  const linkAt = src.indexOf('linkShopOwner(newPlace.id, selected.id)')
  assert.ok(approvedAt > 0 && linkAt > approvedAt, 'ต้องเรียกผูกหลังตั้ง approved (RPC ตรวจสถานะ approved)')
  assert.match(src, /if \(selected\.user_id && newPlace\?\.id\)/)
  assert.match(src, /อนุมัติแล้ว แต่ผูกเจ้าของร้านไม่สำเร็จ ผูกเองได้ที่หน้าจัดการสถานที่/)
  // ผูกล้มแล้วยังต้องปิดชีท/อัปเดตรายการ (ไม่ return ก่อน)
  const afterLink = src.slice(linkAt)
  assert.ok(afterLink.indexOf('setSelected(null)') > 0)
})

test('หน้าเจ้าหน้าที่ (TourismManager): ส่วนตลาดชาวบ้านแสดงเฉพาะตอนแก้ไขสถานที่ที่ดูแลได้ · ไม่มีขั้นอนุมัติรายสินค้า', () => {
  const mgr = read('src/components/admin/TourismManager.jsx')
  assert.match(mgr, /!isAdd && sheetPlace && canManagePlace\(sheetPlace\)/)
  assert.match(mgr, /<LocalMarketStaffPanel key=\{sheetPlace\.id\}/)
  const panel = read('src/components/admin/LocalMarketStaffPanel.jsx')
  assert.match(panel, /LOCAL_MARKET_MODULE_KEY/)
  assert.match(panel, /setProductHidden\(product\.id, true, text\)/)
  assert.match(panel, /setProductHidden\(product\.id, false, null\)/)
  assert.match(panel, /กรุณาระบุเหตุผลที่ซ่อน/)
  assert.match(panel, /window\.confirm\(`ลบสินค้า/)
  assert.doesNotMatch(panel, /<img\b/, 'รายการสินค้าฝั่งเจ้าหน้าที่ไม่โหลดรูป (egress)')
  assert.doesNotMatch(panel, /อนุมัติสินค้า|approve_?product|approveProduct/i, 'ห้ามเพิ่มขั้นอนุมัติรายสินค้า')
  assert.doesNotMatch(panel, /phone|เบอร์/i, 'รายการคำขอที่ให้เลือกผูกห้ามแสดงเบอร์')
})

test('หน้าร้านของฉัน: RequireAuth + โมดูลคุมผ่าน MODULE_ROUTES · รูปย่อ 800px · โฟลเดอร์ Drive ไม่ใช้ชื่อร้าน/ชื่อคน (PDPA) · ถ้อยคำรับรอง', () => {
  const app = read('src/App.jsx')
  assert.match(app, /<Route path="\/my-shop" element=\{\s*<RequireAuth>\s*<MyShopPage \/>\s*<\/RequireAuth>\s*\} \/>/)
  const page = read('src/pages/MyShopPage.jsx')
  assert.match(page, /shrinkPhoto\(file, \{ maxWidth: POST_IMAGE_MAX_WIDTH, quality: POST_IMAGE_QUALITY \}\)/)
  assert.match(page, /uploadFile\('complaint-attachments'/)
  assert.match(page, /subject: `business\/\$\{placeId\}\/products`/)
  assert.match(page, /folder: driveFolderPath\(DRIVE_MODULES\.business, driveMonthFolder\(\)\)/)
  assert.doesNotMatch(page, /folder:[^\n]*(name|shop\.|owner|full_name)/i, 'โฟลเดอร์ห้ามมีชื่อร้าน/ชื่อคน')
  assert.match(page, /ATTEST_TEXT/)
  assert.match(page, /ถูกซ่อนโดยเจ้าหน้าที่/)
  assert.match(page, /\/business-register/)
  assert.match(page, /edgeImageUrl\(/)
  assert.doesNotMatch(page, /ไม่ใช้ AI|ไม่ได้ใช้ AI/)
  const imgs = page.match(/<img\b[^>]*>/g) ?? []
  assert.ok(imgs.length >= 2)
  for (const tag of imgs) assert.match(tag, /edgeImageUrl\(/, `รูปสาธารณะต้องครอบ edgeImageUrl: ${tag}`)
  for (const tag of imgs) assert.match(tag, /loading="lazy"/)
  const more = read('src/pages/MorePage.jsx')
  assert.match(more, /key: 'my-shop', label: 'ร้านของฉัน'[^\n]*to: '\/my-shop'/)
})

test('หน้ารายละเอียดสถานที่: สินค้าอ่านเฉพาะเมื่อเปิดโมดูล · รูปทุกใบ edgeImageUrl + lazy + async · ข้อความ "หน่วยงานไม่ได้เป็นผู้ขาย" · ♡ ไม่ล็อกอินพาไป /auth', () => {
  const src = read('src/pages/TourismDetailPage.jsx')
  assert.match(src, /if \(!marketOn \|\| !id\) return undefined/)
  assert.match(src, /fetchPublicProducts\(id\)/)
  assert.match(src, /MARKET_DISCLAIMER/)
  const section = src.slice(src.indexOf('function MarketProducts'), src.indexOf('export default function TourismDetailPage'))
  const imgs = section.match(/<img\b[^>]*>/g) ?? []
  assert.equal(imgs.length, 1)
  assert.match(imgs[0], /edgeImageUrl\(p\.image_url\)/)
  assert.match(imgs[0], /loading="lazy"/)
  assert.match(imgs[0], /decoding="async"/)
  assert.match(src, /navigate\('\/auth', \{ state: \{ from: `\/tourism\/\$\{id\}` \} \}\)/)
})

test('หน้ารายการสถานที่: ค้นสินค้า debounce 300ms · ผลค้นหาไม่โหลดรูป · ตัวกรอง ♡ เฉพาะล็อกอิน+เปิดโมดูล', () => {
  const src = read('src/pages/TourismPage.jsx')
  assert.match(src, /setTimeout\(\(\) => setDebouncedQuery\(query\), 300\)/)
  assert.match(src, /marketOn \? normalizeSearchTerm\(debouncedQuery\) : ''/)
  assert.match(src, /marketOn && uid && \(\s*<FilterChip active=\{favOnly\}/)
  const hitsBlock = src.slice(src.indexOf('data-testid="market-search-hits"'), src.indexOf('searchingProducts && hits.length === 0'))
  assert.ok(hitsBlock.length > 100)
  assert.doesNotMatch(hitsBlock, /<img\b|image_url|edgeImageUrl/, 'ผลค้นหาสินค้าห้ามโหลดรูป')
  assert.match(hitsBlock, /navigate\(`\/tourism\/\$\{h\.place_id\}`\)/)
})

console.log(`\nok — ${cases} cases`)

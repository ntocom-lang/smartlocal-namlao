// ตลาดชาวบ้าน (ขั้น 1A) — ฟังก์ชันล้วนของหน้าประชาชน + หน้าเจ้าหน้าที่ (ไม่ import supabase/React เทสต์ด้วย node ได้)
// ส่วนที่เรียกฐานข้อมูลอยู่ที่ src/lib/localMarketApi.js
//
// ตัวตัดสินจริง (เพดาน 30 รายการ/ร้าน, รูปแบบข้อมูล, สิทธิ์เจ้าของร้าน, การซ่อน) อยู่ที่ฐานข้อมูล
// (supabase/migrations/20261214100000_local_market_tables.sql + 20261214100100_local_market_rls_rpc.sql)
// ไฟล์นี้แค่ตรวจเบื้องต้นให้เห็นข้อความไทยก่อนส่ง และแปลข้อความ error — ค่าที่ตรวจที่นี่ต้องไม่หลวมกว่าฝั่งฐานข้อมูล

export const LOCAL_MARKET_MODULE_KEY = 'local-market'

// ต้องตรงกับเพดานใน trigger market_products_guard / tourism_favorites_guard (เทสต์ตรวจกับไฟล์ SQL)
export const MARKET_PRODUCT_LIMIT = 30
export const MARKET_FAVORITE_LIMIT = 200

// ขีดจำกัดความยาว/ค่า — ตรงกับ CHECK ของตาราง market_products
export const PRODUCT_LIMITS = Object.freeze({
  nameMax: 120, descriptionMax: 500, unitMax: 30, priceMax: 10_000_000, displayOrderMax: 999, hiddenReasonMax: 300,
})

// คอลัมน์ที่ anon อ่านได้ (GRANT SELECT (...) ON market_products TO anon) — select('*') ฝั่ง anon จะ 42501
// ⚠️ ห้ามเพิ่ม hidden_reason / attest_lawful ที่นี่ (ไม่ได้ให้ anon) · เทสต์เทียบรายการนี้กับไฟล์ SQL
// เทียบ CHECK image_url ใน 20261214100000 (ฐานข้อมูลล็อก project ref จริง ที่นี่ยอมทุก ref ของ supabase.co)
export const PRODUCT_IMAGE_URL_RE = /^https:\/\/[a-z0-9]+\.supabase\.co\/(functions\/v1\/drive-file\?id=[A-Za-z0-9_-]+|storage\/v1\/object\/public\/[A-Za-z0-9_./-]+)$/
export const PRODUCT_PUBLIC_COLS ='id, municipality_id, place_id, name, description, price, unit, image_url, is_available, display_order, is_hidden, updated_at'
// เจ้าของร้าน/เจ้าหน้าที่ (authenticated) อ่านได้ทั้งแถว — ระบุคอลัมน์ชัด ไม่ใช้ '*'
export const PRODUCT_MANAGE_COLS = `${PRODUCT_PUBLIC_COLS}, hidden_reason, attest_lawful, created_at`

// ถ้อยคำรับรองบนจอเจ้าของร้าน — เจ้าของระบบกำหนด 2026-11-19 · ห้ามอ้างเลขมาตรา/ชื่อกฎหมาย
export const ATTEST_TEXT = 'ข้าพเจ้ารับรองว่าสินค้านี้จำหน่ายได้โดยชอบด้วยกฎหมาย และข้อมูลเป็นความจริง'
// ข้อความใต้รายการสินค้าหน้าสาธารณะ — อปท. ไม่เป็นคนกลางซื้อขาย
export const MARKET_DISCLAIMER = 'ติดต่อสั่งซื้อกับร้านโดยตรง หน่วยงานไม่ได้เป็นผู้ขาย'

// ── ราคา ────────────────────────────────────────────────────────────────────────

/** ราคาเป็นตัวเลข (รับสตริงจาก numeric ได้) หรือ null เมื่อไม่มี/อ่านไม่ได้ */
export function priceNumber(price) {
  if (price === null || price === undefined || price === '') return null
  const n = typeof price === 'number' ? price : Number(String(price).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/** "฿1,250" หรือ "฿45.50" · ไม่มีราคา (null) = "สอบถามราคา" */
export function formatPrice(price) {
  const n = priceNumber(price)
  if (n === null) return 'สอบถามราคา'
  return `฿${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })}`
}

/** "฿45 / กก." — ไม่มีหน่วยหรือไม่มีราคาแสดงเฉพาะราคา */
export function formatPriceWithUnit(price, unit) {
  const base = formatPrice(price)
  const u = typeof unit === 'string' ? unit.trim() : ''
  return priceNumber(price) !== null && u ? `${base} / ${u}` : base
}

// ── ค้นหา ───────────────────────────────────────────────────────────────────────

export const SEARCH_MIN_CHARS = 2
export const SEARCH_MAX_CHARS = 50
export const SEARCH_RESULT_LIMIT = 30

/**
 * escape ค่าค้นหาก่อนใส่ `%…%` ให้ .ilike() — ผู้ใช้พิมพ์ % หรือ _ แล้วต้องเป็นตัวอักษรธรรมดา ไม่ใช่ wildcard
 *  - \ % _ , ( ) → นำหน้าด้วย \ (ใน LIKE ตัวหลัง \ เป็นตัวอักษรตรงตัว ปลอดภัยทุกตัว)
 *  - * → ตัดทิ้ง: PostgREST แปลง * เป็น % ในตัวดำเนินการ like/ilike "ก่อน" ส่งให้ Postgres (\* จะกลายเป็น \% = เครื่องหมาย % จริง
 *    ซึ่งไม่ตรงที่ผู้ใช้พิมพ์) ตัดทิ้งแล้วได้ผลตรงที่สุด
 *  - ตัวควบคุม/ขึ้นบรรทัดใหม่ → ช่องว่าง
 */
// ตัวควบคุม ASCII (0x00–0x1F, 0x7F) — สร้างจากสตริงเพื่อไม่ต้องเขียน control char ใน regex literal (eslint no-control-regex)
const CONTROL_CHARS_RE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']', 'g')

export function escapeIlike(raw) {
  return String(raw ?? '')
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(/\*/g, '')
    .replace(/[\\%_,()]/g, (ch) => `\\${ch}`)
}

/** ตัดช่องว่างซ้ำ + จำกัดความยาว · สั้นกว่า SEARCH_MIN_CHARS คืน '' (นับตัวอักษรตามที่พิมพ์ — "ปู" "ไก่" 2 ตัวใช้ค้นได้) */
export function normalizeSearchTerm(raw) {
  const cleaned = String(raw ?? '').replace(CONTROL_CHARS_RE, ' ').replace(/\s+/g, ' ').trim()
  const chars = [...cleaned].slice(0, SEARCH_MAX_CHARS).join('').trim()
  return [...chars].length >= SEARCH_MIN_CHARS ? chars : ''
}

/** รูปแบบที่ส่งให้ .ilike('name', …) — คืน null เมื่อคำค้นสั้นเกินไป (ไม่ต้องยิงฐานข้อมูล) */
export function ilikePattern(raw) {
  const term = normalizeSearchTerm(raw)
  return term ? `%${escapeIlike(term)}%` : null
}

// ── ข้อความผิดพลาด ──────────────────────────────────────────────────────────────

const HAS_THAI = /[฀-๿]/

/**
 * error จาก supabase → ข้อความไทยที่ผู้ใช้อ่านรู้เรื่อง · ไม่โชว์ข้อความอังกฤษจากฐานข้อมูลให้ผู้ใช้เห็น
 *  - ข้อความที่ฐานข้อมูลเขียนเป็นไทยเอง (เพดาน 30/200, ต้องระบุเหตุผล, ไม่มีสิทธิ์…) ส่งต่อตามนั้น
 *  - 42501 / RLS → ไม่มีสิทธิ์ · 23514 → ข้อมูลไม่ผ่านเงื่อนไข · 23505 → มีอยู่แล้ว · 23503 → ไม่พบร้าน
 */
export function friendlyMarketError(error, fallback = 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง') {
  if (!error) return ''
  const code = String(error.code ?? '')
  const message = String(error.message ?? '')
  if (HAS_THAI.test(message)) return message
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'ไม่มีสิทธิ์ทำรายการนี้ — ตรวจว่าเข้าสู่ระบบแล้ว และหน่วยงานเปิดใช้งานตลาดชาวบ้าน'
  }
  if (code === '23514') return 'ข้อมูลไม่ผ่านเงื่อนไข ตรวจชื่อ ราคา และรูปอีกครั้ง (รูปต้องอัปโหลดผ่านหน้านี้)'
  if (code === '23505') return 'มีรายการนี้อยู่แล้ว'
  if (code === '23503') return 'ไม่พบร้านหรือบัญชีที่เกี่ยวข้อง อาจถูกลบไปแล้ว ลองโหลดหน้าใหม่'
  if (code === '22023') return 'ข้อมูลไม่ครบ ลองโหลดหน้าใหม่แล้วทำอีกครั้ง'
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'
  }
  return fallback
}

// ── ฟอร์มสินค้า ─────────────────────────────────────────────────────────────────

export const EMPTY_PRODUCT_FORM = Object.freeze({
  name: '', description: '', price: '', unit: '', image_url: '', is_available: true, attest: false,
})

/** แถวจากฐานข้อมูล → ค่าในฟอร์มแก้ไข (ติ๊กรับรองต้องติ๊กใหม่ทุกครั้งที่บันทึก) */
export function productToForm(product) {
  return {
    name: product?.name ?? '',
    description: product?.description ?? '',
    price: priceNumber(product?.price) === null ? '' : String(priceNumber(product.price)),
    unit: product?.unit ?? '',
    image_url: product?.image_url ?? '',
    is_available: product?.is_available !== false,
    attest: false,
  }
}

/** ข้อความไทยที่บอกว่าฟอร์มผิดตรงไหน · '' = ผ่าน */
export function validateProductForm(form) {
  const name = String(form?.name ?? '').trim()
  if (!name) return 'กรุณากรอกชื่อสินค้า'
  if ([...name].length > PRODUCT_LIMITS.nameMax) return `ชื่อสินค้ายาวเกิน ${PRODUCT_LIMITS.nameMax} ตัวอักษร`
  if ([...String(form?.description ?? '')].length > PRODUCT_LIMITS.descriptionMax) return `รายละเอียดยาวเกิน ${PRODUCT_LIMITS.descriptionMax} ตัวอักษร`
  if ([...String(form?.unit ?? '').trim()].length > PRODUCT_LIMITS.unitMax) return `หน่วยยาวเกิน ${PRODUCT_LIMITS.unitMax} ตัวอักษร`
  const rawPrice = String(form?.price ?? '').trim()
  if (rawPrice !== '') {
    if (!/^\d[\d,]*(\.\d{1,2})?$/.test(rawPrice)) return 'ราคาต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง (หรือเว้นว่างไว้ = สอบถามราคา)'
    const n = priceNumber(rawPrice)
    if (n === null || n < 0 || n > PRODUCT_LIMITS.priceMax) return `ราคาต้องไม่เกิน ${PRODUCT_LIMITS.priceMax.toLocaleString('th-TH')} บาท`
  }
  const image = String(form?.image_url ?? '').trim()
  // รับเฉพาะรูปที่อัปโหลดผ่านระบบ (Drive ผ่าน drive-file / Storage สาธารณะ) — ฐานข้อมูลบังคับ project ref จริงอีกชั้น
  // ไม่รับโฮสต์ภายนอก: ส่ง IP ผู้เปิดหน้าให้บุคคลที่สาม (PDPA) และสลับเนื้อรูปได้หลังตรวจ
  if (image && (!PRODUCT_IMAGE_URL_RE.test(image) || /\/\./.test(image))) return 'รูปสินค้าไม่ถูกต้อง ลองอัปโหลดรูปใหม่'
  if (form?.attest !== true) return 'ต้องติ๊กรับรองก่อนบันทึก'
  return ''
}

/**
 * ฟอร์ม → payload ส่งฐานข้อมูล (เฉพาะคอลัมน์ที่ GRANT ให้ authenticated เขียนได้ ไม่มี municipality_id/is_hidden/hidden_reason)
 * @param {object} form
 * @param {{ placeId?: string, displayOrder?: number }} opts  placeId ใส่เฉพาะตอนเพิ่ม (UPDATE ห้ามส่ง place_id)
 */
export function buildProductPayload(form, { placeId, displayOrder } = {}) {
  const price = String(form?.price ?? '').trim() === '' ? null : priceNumber(form.price)
  const payload = {
    name: String(form?.name ?? '').trim(),
    description: String(form?.description ?? '').trim() || null,
    price,
    unit: String(form?.unit ?? '').trim() || null,
    image_url: String(form?.image_url ?? '').trim() || null,
    is_available: form?.is_available !== false,
    attest_lawful: form?.attest === true,
  }
  if (placeId) payload.place_id = placeId
  if (Number.isInteger(displayOrder)) payload.display_order = Math.min(PRODUCT_LIMITS.displayOrderMax, Math.max(0, displayOrder))
  return payload
}

/** ลำดับแสดงของสินค้าใหม่ = ต่อท้ายรายการเดิม (เพดาน 999 ตามคอลัมน์) */
export function nextDisplayOrder(products) {
  const max = (products ?? []).reduce((m, p) => Math.max(m, Number.isFinite(Number(p?.display_order)) ? Number(p.display_order) : 0), -1)
  return Math.min(PRODUCT_LIMITS.displayOrderMax, max + 1)
}

/** ข้อความเหตุผลที่ซ่อน — ตัดช่องว่าง · '' เมื่อว่าง (RPC บังคับต้องมีเหตุผลตอนซ่อน) */
export function normalizeHideReason(raw) {
  return String(raw ?? '').trim().slice(0, PRODUCT_LIMITS.hiddenReasonMax)
}

/** รายการสินค้าเรียงตาม display_order แล้วตามชื่อ (ฐานข้อมูลเรียงให้แล้ว ใช้ซ้ำหลังแก้ในหน้า) */
export function sortProducts(products) {
  return [...(products ?? [])].sort((a, b) =>
    (Number(a.display_order) || 0) - (Number(b.display_order) || 0)
    || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'th'))
}

/** วันที่ยื่นแบบสั้นให้เจ้าหน้าที่เลือกคำขอ (ไม่แสดงเบอร์/ข้อมูลผู้ยื่น) */
export function shortThaiDate(value) {
  const d = value ? new Date(value) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

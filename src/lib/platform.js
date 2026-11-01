// แอปเดียวรวมทุก อปท. บนสโตร์ (Google Play / App Store) — ค่ากลางของ "ตัวแอป" ที่ไม่ใช่ของ อปท. ใด
//
// ที่มา: เจ้าของระบบสั่ง 2569-11-01 ให้นิติบุคคลผู้พัฒนาส่งแอปเดียว แอปเปิดที่โดเมนกลาง app.rk-networks.com
// ประชาชนเลือกหน่วยงานครั้งแรกครั้งเดียว (TenantPicker) ครั้งต่อไปพาเข้าเว็บ อปท. เอง
// เว็บของแต่ละ อปท. ยังเป็นโดเมนของตัวเองเหมือนเดิม (1 อปท. = 1 โดเมน) — การล็อกอิน ลิงก์ติดตามเรื่อง
// QR ในใบพิมพ์ และ Telegram จึงไม่ต้องแก้
//
// ไฟล์นี้ไม่ import supabase หรือแตะ window ตอนโหลด เพื่อให้เทสต์ใน node เรียกได้ตรงๆ (tests/platform.test.mjs)

export const PLATFORM_APP_NAME = 'SmartLocal'

// ชื่อนิติบุคคลผู้พัฒนา + อีเมลติดต่อ — ต้องตรงกับชื่อที่จด D-U-N-S และชื่อผู้พัฒนาบนหน้าสโตร์
// (Play User Data policy: นโยบายต้องมี "Developer information" และชื่อ entity บนหน้าสโตร์ต้องปรากฏในนโยบาย)
// ยังไม่ได้รับชื่อทางการจากเจ้าของระบบ (2569-11-01) ว่างไว้ = ใช้คำกลาง ⚠️ ต้องเติมก่อนส่งสโตร์
// ⚠️ ห้ามใช้ municipalities.developer_name แทน ช่องนั้นคือข้อความท้ายเว็บที่ อปท. กรอกเอง (Footer.jsx)
//    น้ำเลาใส่คำขวัญไว้ นโยบายรุ่นแรกเคยดึงไปเป็นชื่อผู้พัฒนาจนข้อความผิด
export const PLATFORM_DEVELOPER = Object.freeze({ name: '', email: '' })

export function platformDeveloperName() {
  return PLATFORM_DEVELOPER.name || 'ผู้พัฒนาและดูแลระบบ'
}

// โดเมนหลักของระบบ — ใช้ตอนเปิดจากที่ที่บอกโดเมนไม่ได้ (localhost, *.vercel.app)
// (ThemeSettingsAdmin.getMuniUrl ใช้ค่าเดียวกันเป็น fallback)
export const PLATFORM_DOMAIN = 'rk-networks.com'
const PLATFORM_HOST_LABEL = 'app'

// สนามซ้อม (demo = เทศบาลตำบลสาธิต) ข้อมูลสมมติ ไม่มีเจ้าหน้าที่จริง — รายการปกติไม่แสดง ประชาชนจะสับสน
// แต่หน้าเลือกของแอปแสดงไว้ท้ายรายการพร้อมป้าย เพราะผู้ตรวจแอปของ Apple/Google ต้องมีที่ลองใช้
// ถ้าซ่อน ผู้ตรวจต้องไปลองบน อปท. จริง แล้วเรื่องทดสอบจะถึงเจ้าหน้าที่จริง (เจ้าของระบบอนุมัติ 2569-11-01)
// ฐานข้อมูลไม่มีคอลัมน์บอกว่า อปท. ไหนเป็นของทดสอบ (demo ก็ is_active) มีสนามซ้อมเพิ่มต้องเติม slug ตรงนี้
export const DEMO_SLUGS = new Set(['demo'])

const currentHostname = () => globalThis.location?.hostname ?? ''

function isVendorHost(hostname) {
  return hostname.endsWith('.vercel.app') || hostname === 'localhost' || hostname === '127.0.0.1' || /^\d/.test(hostname)
}

// ตัดป้ายชื่อหน้าสุดของโดเมนออก (www.rk-networks.com → rk-networks.com) ตัดเสมอไม่ว่าจะเป็น www, app
// หรือ subdomain ที่พิมพ์ผิด (thungkaw.rk-networks.com → rk-networks.com)
function baseDomain(hostname) {
  const parts = hostname.split('.')
  return !isVendorHost(hostname) && parts.length >= 3 ? parts.slice(1).join('.') : PLATFORM_DOMAIN
}

// ลิงก์ไปเว็บของหน่วยงาน — https เสมอ เหมือนที่ Worker บังคับ
export function tenantHref(slug, path = '/', hostname = currentHostname()) {
  return `https://${slug}.${baseDomain(hostname)}${path}`
}

// ลิงก์กลับโดเมนกลางของแอป (หน้าเลือกหน่วยงาน / หน้ากลางที่กรอกในสโตร์)
export function platformHref(path = '/', hostname = currentHostname()) {
  return `https://${PLATFORM_HOST_LABEL}.${baseDomain(hostname)}${path}`
}

export function isPlatformHost(hostname = currentHostname()) {
  return !isVendorHost(hostname) && hostname.split('.')[0] === PLATFORM_HOST_LABEL
}

// ── หน้ากลางบนโดเมนกลาง — URL ที่กรอกในสโตร์ (นโยบาย / ลบบัญชี / ช่วยเหลือ) ──────────────────────
// แสดงเฉพาะเมื่อ URL ไม่ได้ระบุหน่วยงาน (App.jsx) โดเมนของ อปท. ยังใช้หน้า /privacy และ /account/delete ของตัวเอง
const PLATFORM_PAGES = { '/privacy': 'privacy', '/account/delete': 'account-delete', '/support': 'support' }

export function platformPageFor(pathname) {
  const path = String(pathname ?? '').replace(/\/+$/, '') || '/'
  return PLATFORM_PAGES[path] ?? null
}

// ── จำหน่วยงานที่เลือก (เฉพาะโดเมนกลาง) ─────────────────────────────────────────────────
// แอปจากสโตร์เปิดที่โดเมนกลางทุกครั้ง ถ้าไม่จำ ประชาชนต้องเลือกใหม่ทุกครั้งที่เปิดแอป
// เก็บใน localStorage ของโดเมนกลาง (คนละ origin กับเว็บ อปท. — ไม่ปนกับ sl_slug ของแต่ละเว็บ)
const REMEMBER_KEY = 'sl_app_tenant'
export const CHANGE_TENANT_PARAM = 'change'

const safeStorage = () => {
  try { return globalThis.localStorage ?? null } catch { return null }
}

export function readRememberedTenant(storage = safeStorage()) {
  try { return storage?.getItem(REMEMBER_KEY) || null } catch { return null }
}

export function rememberTenant(slug, storage = safeStorage()) {
  try { storage?.setItem(REMEMBER_KEY, slug) } catch { /* เครื่องที่ปิด storage — เลือกใหม่ครั้งหน้า ไม่พัง */ }
}

export function forgetRememberedTenant(storage = safeStorage()) {
  try { storage?.removeItem(REMEMBER_KEY) } catch { /* เหมือนข้างบน */ }
}

/**
 * เปิดโดเมนกลางแล้วจะพาเข้าเว็บ อปท. เลยไหม — คืน slug ที่จะพาไป หรือ null = ให้ผู้ใช้เลือก
 * พาไปเฉพาะหน่วยงานที่ยังเปิดใช้อยู่ ไม่งั้นเปิดแอปทีไรก็เด้งไปหน้า "ไม่พบหน่วยงาน" ทุกครั้ง
 * @param {{ remembered: string|null, tenants: Array<{slug: string}>, wantsChange: boolean }} input
 */
export function autoOpenSlug({ remembered, tenants, wantsChange }) {
  if (wantsChange || !remembered) return null
  return tenants.some((t) => t.slug === remembered) ? remembered : null
}

// ── จำว่าเครื่องนี้ใช้ผ่านแอป (เฉพาะเว็บ อปท.) ─────────────────────────────────────────────
// โดเมนกลางพาเข้าเว็บ อปท. พร้อม ?via=app — เว็บ อปท. จำไว้ แล้วแสดงเมนู "เปลี่ยนหน่วยงาน" ให้เฉพาะคนกลุ่มนี้
// คนเปิดเว็บปกติไม่เห็น กันกดพลาดแล้วไปแจ้งเรื่องผิด อปท. (ใช้พารามิเตอร์ ไม่ใช้ document.referrer
// เพราะ referrer หายได้ตามการตั้งค่าเบราว์เซอร์ และตรวจในเทสต์ไม่ได้แน่นอน)
export const VIA_APP_PARAM = 'via'
export const VIA_APP_VALUE = 'app'
export const VIA_APP_PATH = `/?${VIA_APP_PARAM}=${VIA_APP_VALUE}`
const VIA_APP_KEY = 'sl_via_app'

/**
 * เรียกครั้งเดียวใน main.jsx ก่อน router เริ่ม — เจอ ?via=app ให้จำไว้แล้วลบออกจาก URL
 * (ลิงก์ที่ผู้ใช้แชร์ต่อจะได้ไม่พาคนอื่นติดป้าย "ใช้ผ่านแอป" ไปด้วย)
 */
export function captureViaApp(loc = globalThis.location, hist = globalThis.history, storage = safeStorage()) {
  if (!loc || !hist) return false
  const params = new URLSearchParams(loc.search)
  if (params.get(VIA_APP_PARAM) !== VIA_APP_VALUE) return false
  try { storage?.setItem(VIA_APP_KEY, '1') } catch { /* จำไม่ได้ = ไม่เห็นเมนูเปลี่ยนหน่วยงาน ยังใช้งานได้ปกติ */ }
  params.delete(VIA_APP_PARAM)
  const search = params.toString()
  hist.replaceState(hist.state, '', `${loc.pathname}${search ? `?${search}` : ''}${loc.hash}`)
  return true
}

export function openedViaApp(storage = safeStorage()) {
  try { return storage?.getItem(VIA_APP_KEY) === '1' } catch { return false }
}

// ── รายชื่อหน่วยงาน ──────────────────────────────────────────────────────────────
// คอลัมน์ที่ anon อ่านได้ (municipalities ใช้ column-level grant — ตรวจด้วย anon key จริง 2569-11-01)
// RLS ให้เห็นเฉพาะ is_active ห้ามเพิ่มคอลัมน์โดยไม่เช็คสิทธิ์ ไม่งั้นทั้ง query ล้มด้วย 42501
// แล้วหน้าเลือกหน่วยงานกับหน้ากลางทุกหน้าโหลดไม่ขึ้น
export const PUBLIC_TENANT_COLUMNS = 'slug, name, org_type, province, district, logo_url, phone, email, address'

export function sortTenants(list) {
  return [...list].sort((a, b) => (a.province ?? '').localeCompare(b.province ?? '', 'th') || a.name.localeCompare(b.name, 'th'))
}

/** @param {object} client supabase client (ส่งเข้ามา ไม่ import เอง — เทสต์ใน node ใช้ไฟล์นี้ได้) */
export async function fetchActiveTenants(client) {
  const { data, error } = await client.from('municipalities').select(PUBLIC_TENANT_COLUMNS).eq('is_active', true)
  if (error) throw error
  return sortTenants((data ?? []).filter((t) => t.slug && t.name).map((t) => ({ ...t, isDemo: DEMO_SLUGS.has(t.slug) })))
}

// "อ.ร้องกวาง จ.แพร่" — ช่องไหนว่างก็ข้าม
export function tenantArea(t) {
  return [t?.district && `อ.${t.district}`, t?.province && `จ.${t.province}`].filter(Boolean).join(' ')
}

// ช่องทางติดต่อรูปแบบเดียวกับนโยบาย (privacyPolicy.js) — ช่องไหนว่างก็ไม่แสดง
export function tenantContacts(t) {
  return [
    t?.address && { kind: 'address', label: 'ที่อยู่', value: String(t.address) },
    t?.phone && { kind: 'phone', label: 'โทร', value: String(t.phone) },
    t?.email && { kind: 'email', label: 'อีเมล', value: String(t.email) },
  ].filter(Boolean)
}

// ─── กติกาของตัวนับการเข้าชมเว็บไซต์ (ท้ายเว็บ + หน้า /reports/visitors) ───
//
// ไฟล์นี้เป็นฟังก์ชันล้วน tests/site-open-counter.test.mjs import ตรงได้โดยไม่ต้องลาก supabase client
// มาด้วย ตัวที่ยิง RPC จริง + store ของท้ายเว็บอยู่ที่ siteOpenCounter.js
//
// นิยามการนับที่เจ้าของระบบเลือก (2569-09-29): เอายอดมากที่สุดเท่าที่ยังตรวจสอบย้อนได้
//   การเข้าชม (ครั้ง) = ทุกครั้งที่หน้าแสดงผล ทั้งเปิดเว็บ รีเฟรช และเปลี่ยนหน้า ทุกคนรวมเจ้าหน้าที่
//   ตัดออกเฉพาะสิ่งที่ "ไม่ใช่คน": บอต/crawler, เบราว์เซอร์ที่สคริปต์คุม (E2E ของเรา), localhost/dev
//   และหน้าหลังบ้าน (BACKOFFICE_PATHS) ตั้งแต่ BACKOFFICE_EXCLUDED_SINCE — เหตุผลอยู่ที่ isCountablePath
// ห้ามเติมตัวเลขปลอม ตัวคูณ หรือนับสัญญาณพื้นหลังเป็นการเข้าชม — เหตุผลอยู่หัวไฟล์
// supabase/migrations/20260930100100_site_open_daily_rpc.sql

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000

// วันตามเวลาไทยแบบ YYYY-MM-DD — ใช้แค่จำว่า "เครื่องนี้ถูกนับเป็นเครื่องไม่ซ้ำของวันนี้แล้ว"
// ฝั่ง server ตัดวันของตัวเองเสมอ ค่านี้ไม่เคยถูกส่งขึ้นไป
// บวก 7 ชั่วโมงตรงๆ ได้เพราะประเทศไทยไม่มีเวลาออมแสง (UTC+7 ตลอดปี) ไม่ต้องพึ่ง Intl ของเบราว์เซอร์
export function bangkokDay(now = new Date()) {
  return new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10)
}

// UA ของบอตที่รัน JavaScript ได้จริง (ตัวที่ไม่รัน JS ไม่มีทางยิง RPC มาถึงอยู่แล้ว)
// ห้ามใช้ /bot/i ลอยๆ — ชนชื่อรุ่นมือถือจริง เช่น "CUBOT X30" แล้วคนจริงจะถูกตัดทิ้ง
// จึงจับเฉพาะรูปแบบที่บอตใช้จริง: "(compatible; Googlebot/2.1; ...)" และ "Applebot/0.1"
const BOT_UA = /compatible;[^)]*(?:bot|crawler|spider)|\w(?:bot|crawler|spider)\/\d|headlesschrome|chrome-lighthouse|phantomjs|facebookexternalhit|mediapartners-google|google-inspectiontool/i

function isLocalHostname(hostname) {
  const host = String(hostname || '').toLowerCase()
  // ไม่มี hostname = file:// หรือ environment ทดสอบ ไม่ใช่เว็บจริงแน่นอน
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '[::1]' || host === '::1') return true
  // IP ตรงๆ = เปิด dev server ให้มือถือในวง LAN ดู — ต่อ DB จริงเหมือน localhost (NOTES.md ข้อ 1)
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
}

// เครื่อง/เบราว์เซอร์นี้เป็น "คนเข้าชมเว็บจริง" ไหม
//   isDev     — npm run dev ต่อ Supabase ตัวเดียวกับ production ถ้านับ ยอดงานพัฒนาจะไหลเข้า อปท. จริง
//   webdriver — Playwright/Selenium ตั้งค่านี้เป็น true เอง ครอบคลุม E2E ทุกตัวใน tests/
export function isCountableEnvironment({ isDev = false, hostname = '', userAgent = '', webdriver = false } = {}) {
  if (isDev || webdriver) return false
  if (isLocalHostname(hostname)) return false
  if (BOT_UA.test(String(userAgent || ''))) return false
  return true
}

// หน้าที่เจ้าหน้าที่ใช้ปฏิบัติงาน — ไม่นับเป็นการเข้าชมเว็บไซต์ (เจ้าของระบบเลือก 2569-09-30)
// ตัวเลขท้ายเว็บควรตอบว่า "หน้าเว็บสาธารณะถูกเปิดกี่ครั้ง" ไม่ใช่ "เจ้าหน้าที่เข้าระบบกี่รอบ"
// หลักเดียวกับตัวกรอง internal traffic ของเครื่องมือวัดสถิติทั่วไป
// ⚠️ ต้องตรงกับ route จริงใน src/App.jsx — เทสต์ตรวจให้ ถ้าเปลี่ยนชื่อ route แล้วลืมแก้ที่นี่
// หน้านั้นจะกลับมาถูกนับเงียบๆ · หน้าที่ประชาชนใช้ร่วม (/, /auth, /profile, /notifications,
// /reports/*, /data-center, /data-center/public) ยังนับตามเดิม แม้คนเปิดจะเป็นเจ้าหน้าที่
export const BACKOFFICE_PATHS = [
  '/admin',             // รวม /admin/login
  '/staff',             // รวม /staff/patient-transport (ทางลัดที่ redirect เข้า /staff)
  '/technician',
  '/fleet',
  '/data-center/staff',
  '/events/manage',
  '/dev-journal',
  '/device-login',      // เจ้าหน้าที่กดยืนยันรหัส 6 หลักจากจอคอมพิวเตอร์
]

// วันแรกที่ใช้นิยามนี้ (ต้นปีงบประมาณ 2570) — หน้า /reports/visitors เขียนกำกับว่ายอดก่อนวันนี้
// นับรวมหน้าหลังบ้านอยู่ด้วย ตัวเลขข้ามช่วงจะได้ไม่ถูกอ่านเทียบกันแบบผิดนิยาม
export const BACKOFFICE_EXCLUDED_SINCE = '2026-10-01'

// หน้านี้นับเป็นการเข้าชมไหม — pathname มาจาก useLocation() ซึ่งตัด basename ออกแล้ว
// เทียบแบบ "ตรงตัว หรือตามด้วย /" ไม่ใช่ startsWith ลอยๆ กัน route ในอนาคตชื่อ /staffing ถูกตัดไปด้วย
// แปลงเป็นตัวเล็กก่อนเพราะ react-router จับ route แบบไม่สนตัวพิมพ์ (/Staff ก็เปิดหน้าเจ้าหน้าที่)
export function isCountablePath(pathname) {
  const path = String(pathname || '/').toLowerCase()
  return !BACKOFFICE_PATHS.some(p => path === p || path.startsWith(`${p}/`))
}

// ควรนับเครื่องนี้เป็น "เครื่องไม่ซ้ำ" (ตัวรอง) ของวันนี้ไหม
//   storageOk  — อ่าน localStorage ได้ อ่านไม่ได้ตอบ false: ยอมให้ตัวรองขาด ดีกว่านับทุกหน้าเป็นเครื่องใหม่
//   claimedDay — วันที่แท็บนี้จองไว้แล้วระหว่างรอ RPC ตอบ กันเปลี่ยนหน้ารัวๆ แล้วนับเครื่องเดียวเป็น 2
export function isFirstTodayVisitor({ storageOk, storedDay, claimedDay, today }) {
  return Boolean(storageOk) && storedDay !== today && claimedDay !== today
}

// 12 เดือนของปีงบ (ต.ค.→ก.ย.) พร้อมยอด — เดือนที่ get_site_open_monthly ไม่คืนแถวมาเป็น 0
// ไม่ข้ามเดือนที่เป็น 0 ไม่งั้นแท่งกราฟจะชิดกันผิดสัดส่วนเวลา
//   bounds       = fiscalYearBounds() จาก fiscalYear.js
//   fiscalMonths = FISCAL_MONTHS_TH จาก fiscalYear.js
export function fiscalMonthSeries(rows, { startCE, endCE }, fiscalMonths) {
  const byMonth = new Map((rows ?? []).map(r => [String(r.month_start).slice(0, 7), r]))
  return fiscalMonths.map(({ label, month }) => {
    // ต.ค.–ธ.ค. อยู่ในปีปฏิทินก่อนหน้า (startCE) ที่เหลืออยู่ในปีที่ปีงบสิ้นสุด (endCE)
    const year = month >= 10 ? startCE : endCE
    const key = `${year}-${String(month).padStart(2, '0')}`
    return { key, label, opens: Number(byMonth.get(key)?.opens ?? 0) }
  })
}

// ปีงบ พ.ศ. ของเดือน 'YYYY-MM-DD' (ต.ค. ขึ้นไปนับเป็นปีงบถัดไป) — ตรงกับ fiscalYearOf() ใน fiscalYear.js
function fiscalYearOfMonth(monthStart) {
  const [y, m] = String(monthStart).split('-').map(Number)
  return (m >= 10 ? y + 1 : y) + 543
}

// ยอดรายปีงบสำหรับตัวเลือก "ทุกปีงบประมาณ" — ตั้งแต่ปีงบแรกที่มีข้อมูลถึงปีงบปัจจุบัน
// ปีงบที่อยู่ระหว่างกลางแต่ไม่มีข้อมูลต้องขึ้นเป็น 0 ไม่ใช่หายไปจากกราฟ
export function fiscalYearSeries(rows, currentFiscalYearBE) {
  const totals = new Map()
  for (const r of rows ?? []) {
    const fy = fiscalYearOfMonth(r.month_start)
    totals.set(fy, (totals.get(fy) ?? 0) + Number(r.opens ?? 0))
  }
  const first = Math.min(currentFiscalYearBE, ...totals.keys())
  const series = []
  for (let fy = first; fy <= currentFiscalYearBE; fy++) {
    series.push({ key: String(fy), label: String(fy), opens: totals.get(fy) ?? 0 })
  }
  return series
}

// ─── สถิติรายหน้า (เจ้าของระบบขอ 2569-10-28: "หน้าไหนที่คนสนใจ/เข้ามาใช้บริการมากที่สุด" ไว้พัฒนาต่อ) ───
//
// ทุกครั้งที่นับการเข้าชม ฝั่งเว็บส่งชื่อกลุ่มของหน้า (page_key) ไปด้วย ผลรวมรายหน้าของวัน = ยอดรวมของวันนั้น
// (นับตั้งแต่วัน apply — ไม่มีการเติมย้อนหลัง) · supabase/migrations/20261028100100_site_page_daily_rpc.sql
//
// ⚠️ ส่งเฉพาะ "ชื่อกลุ่มจากตารางนี้" ห้ามส่ง pathname หรือส่วนใดของ URL ขึ้นไป — URL มีโทเคนติดตามเรื่อง
// (/t/<โทเคน>) และรหัสตรวจสอบลายเซ็น (/v/<รหัส>) ซึ่งเป็นข้อมูลที่ไม่ควรไปอยู่ในสถิติ หน้าที่ไม่รู้จักตกเป็น 'other'
// ⚠️ เพิ่ม route ใหม่ใน App.jsx แล้วลืมเพิ่มที่นี่ = หน้านั้นไปรวมอยู่ใน 'other' เงียบๆ — เทสต์ตรวจให้ครบทุก route
//
// kind: service = ยื่น/จอง/ให้ความเห็น · info = ดูข้อมูล · mine = ของฉัน/ติดตามเรื่อง
//       transit = หน้านำทาง (หน้าแรก เมนูทั้งหมด รายงานทั้งหมด เข้าสู่ระบบ) คนผ่านทุกคนอยู่แล้ว ไม่ได้บอกว่า "สนใจเรื่องไหน"
//       จึงแยกไว้ต่างหากจากแท่งอันดับเมนู (ไม่งั้นหน้าแรกชนะทุกครั้งและแท่งอื่นสั้นจนเทียบกันไม่ออก)
// label ของหน้าที่เป็นเมนูในแถบข้าง (MENU_PAGE_KEYS) ต้องตรงกับชื่อในแถบข้างตัวอักษรต่อตัวอักษร —
// เจ้าของระบบเปิดดูแล้วต้องเห็นชื่อเดียวกับที่ประชาชนกดจริง เทสต์ตรวจกับ CitizenSidebar.jsx ให้
export const PAGE_CATALOG = [
  { key: 'home',               path: '/',                    label: 'หน้าแรก',                              kind: 'transit' },
  { key: 'more',               path: '/more',                label: 'เมนูทั้งหมด',                          kind: 'transit' },
  { key: 'auth',               path: '/auth',                label: 'เข้าสู่ระบบ/สมัครสมาชิก',               kind: 'transit' },
  { key: 'reset-password',     path: '/reset-password',      label: 'ตั้งรหัสผ่านใหม่',                      kind: 'transit' },
  { key: 'profile',            path: '/profile',             label: 'โปรไฟล์ของฉัน',                        kind: 'transit' },
  { key: 'reports',            path: '/reports',             label: 'รายงานทั้งหมด',                        kind: 'transit' },
  { key: 'complaint',          path: '/complaint',           label: 'ร้องเรียน/ร้องทุกข์',                   kind: 'service' },
  { key: 'complaint-legacy',   path: '/complaint-legacy',    label: 'ร้องเรียน (หน้าแบบเดิม)',               kind: 'service' },
  { key: 'request',            path: '/request',             label: 'แบบฟอร์มคำร้อง',                       kind: 'service' },
  { key: 'doc-request',        path: '/doc-request',         label: 'งานบริการประชาชน',                      kind: 'service' },
  { key: 'patient-transport',  path: '/patient-transport',   label: 'จองรถรับ-ส่งผู้ป่วย',                   kind: 'service' },
  { key: 'business-register',  path: '/business-register',   label: 'ลงทะเบียนร้านค้า',                      kind: 'service' },
  { key: 'satisfaction',       path: '/satisfaction',        label: 'ประเมินความพึงพอใจ',                   kind: 'service' },
  { key: 'surveys',            path: '/surveys',             label: 'แบบสำรวจความเห็น (รายการ)',             kind: 'service' },
  { key: 'survey',             path: '/survey/:id',          label: 'ทำแบบสำรวจความเห็น',                   kind: 'service' },
  { key: 'my-complaints',      path: '/my-complaints',       label: 'คำร้องของฉัน',                         kind: 'mine' },
  { key: 'my-docs',            path: '/my-docs',             label: 'เอกสารของฉัน',                         kind: 'mine' },
  { key: 'notifications',      path: '/notifications',       label: 'การแจ้งเตือน',                         kind: 'mine' },
  { key: 'track',              path: '/t/:token',            label: 'ติดตามเรื่องด้วยลิงก์',                 kind: 'mine' },
  { key: 'waste',              path: '/waste',               label: 'ตารางวันเก็บขยะ',                      kind: 'info' },
  { key: 'water-situation',    path: '/water-situation',     label: 'สถานการณ์น้ำ-ฝน',                      kind: 'info' },
  { key: 'weather',            path: '/weather',             label: 'สภาพอากาศ',                            kind: 'info' },
  { key: 'pm25',               path: '/pm25',                label: 'สถานการณ์ PM2.5',                      kind: 'info' },
  { key: 'events',             path: '/events',              label: 'ปฏิทินกิจกรรม',                        kind: 'info' },
  { key: 'news',               path: '/news',                label: 'ข่าวสาร/ประกาศ',                       kind: 'info' },
  { key: 'tourism',            path: '/tourism',             label: 'เที่ยว กิน พัก ช้อป บริการ',            kind: 'info' },
  { key: 'tourism-detail',     path: '/tourism/:id',         label: 'รายละเอียดสถานที่ (เที่ยว กิน พัก ช้อป)', kind: 'info' },
  { key: 'emergency',          path: '/emergency',           label: 'สายด่วนฉุกเฉิน',                       kind: 'info' },
  { key: 'directory',          path: '/directory',           label: 'เบอร์โทรสำคัญ',                        kind: 'info' },
  { key: 'contact',            path: '/contact',             label: 'ติดต่อเรา',                            kind: 'info' },
  { key: 'data-center',        path: '/data-center',         label: 'ศูนย์ข้อมูลดิจิทัล',                    kind: 'info' },
  { key: 'data-center-public', path: '/data-center/public',  label: 'แผนที่ศูนย์ข้อมูลดิจิทัล',               kind: 'info' },
  { key: 'doc-stats',          path: '/doc-stats',           label: 'รายงานการออกเอกสารดิจิทัล',             kind: 'info' },
  { key: 'reports-complaints', path: '/reports/complaints',  label: 'รายงานร้องเรียน/ร้องทุกข์',             kind: 'info' },
  { key: 'reports-visitors',   path: '/reports/visitors',    label: 'สถิติการเข้าชมเว็บไซต์',                kind: 'info' },
  { key: 'verify',             path: '/v/:code',             label: 'ตรวจสอบลายเซ็นออนไลน์',                kind: 'info' },
]

export const OTHER_PAGE = { key: 'other', label: 'หน้าอื่นๆ / ไม่ระบุ', kind: 'info' }

// เมนูในแถบข้างของหน้าประชาชน (src/components/layout/CitizenSidebar.jsx) — เจ้าของระบบขอดูทีละเมนูตามรายการนี้
// (2569-10-28 "ใครเข้ามาใช้บริการเมนูไหนมากที่สุด กี่ครั้ง") นับจากการเปิดหน้านั้นไม่ว่าเข้าทางไหน
// (เมนูข้าง ปุ่มหน้าแรก แถบล่างมือถือ หรือลิงก์) แยกไม่ได้ว่ากดมาจากปุ่มไหน และไม่รู้ว่าใครเป็นคนกด
export const MENU_PAGE_KEYS = [
  'home', 'complaint', 'doc-request', 'waste', 'water-situation', 'events', 'news', 'tourism', 'data-center',
  'my-complaints', 'my-docs', 'notifications',
  'reports', 'reports-complaints', 'contact', 'emergency', 'directory', 'more',
]

// route ที่ไม่เคยถูกนับเป็นหน้าของตัวเอง: เป็นแค่ทางผ่านที่ redirect ต่อ (นับที่ปลายทาง) หรือหน้า 404
export const UNCOUNTED_ROUTES = ['/search', '/chatbot', '/market', '/map', '*']

const PAGE_BY_KEY = new Map([...PAGE_CATALOG, OTHER_PAGE].map(p => [p.key, p]))

// pattern แบบ react-router: ส่วนที่ขึ้นต้นด้วย ':' ตรงกับ 1 ส่วนอะไรก็ได้ ส่วนอื่นเทียบตรงตัว
function matchesPattern(pattern, segments) {
  const parts = pattern.split('/').filter(Boolean)
  if (parts.length !== segments.length) return false
  return parts.every((part, i) => part.startsWith(':') || part === segments[i])
}

// pathname → ชื่อกลุ่มของหน้า ('other' เมื่อไม่รู้จัก) — เทียบแบบไม่สนตัวพิมพ์และตัด / ท้ายออกตาม react-router
export function pageKeyForPath(pathname) {
  const segments = String(pathname || '/').toLowerCase().split('/').filter(Boolean)
  return PAGE_CATALOG.find(p => matchesPattern(p.path, segments))?.key ?? OTHER_PAGE.key
}

// เครื่องนี้เพิ่งเปิดหน้านี้เป็นครั้งแรกของวันไหม (ตัวรองของสถิติรายหน้า)
//   storedDay/storedKeys   — ที่จำไว้ใน localStorage (ชื่อหน้าที่เปิดแล้วของวัน ไม่เคยถูกส่งขึ้น server)
//   claimedDay/claimedKeys — ที่แท็บนี้จองไว้ระหว่างรอ RPC ตอบ กันเปลี่ยนหน้ารัวๆ แล้วนับหน้าเดิมซ้ำ
//   อ่าน localStorage ไม่ได้ตอบ false — ยอมให้ตัวรองขาด ดีกว่านับทุกครั้งเป็นเครื่องใหม่ (หลักเดียวกับ isFirstTodayVisitor)
export function isFirstPageToday({ storageOk, storedDay, storedKeys, claimedDay, claimedKeys, today, pageKey }) {
  if (!storageOk) return false
  const seenStored = storedDay === today && (storedKeys ?? []).includes(pageKey)
  const seenClaimed = claimedDay === today && (claimedKeys ?? []).includes(pageKey)
  return !seenStored && !seenClaimed
}

// ชื่อหน้าที่เปิดแล้วของวัน ข้ามวันแล้วเริ่มรายการใหม่ · จำกัดความยาวไม่ให้ค่าใน localStorage โตไม่สิ้นสุด
const MAX_STORED_PAGE_KEYS = 80
export function addSeenPageKey(day, keys, today, pageKey) {
  const base = day === today ? (keys ?? []) : []
  if (base.includes(pageKey)) return base
  return [...base, pageKey].slice(-MAX_STORED_PAGE_KEYS)
}

// ผลของ get_site_page_ranking → ข้อมูลพร้อมแสดง
//   menus — เมนูในแถบข้าง (MENU_PAGE_KEYS) ที่ไม่ใช่หน้านำทาง เรียงมากไปน้อย "ครบทุกเมนู" รวมเมนูที่ยังไม่มีใครเปิด (0 ครั้ง)
//           เมนูที่ไม่มีใครใช้เลยเป็นข้อมูลเหมือนกัน ถ้าตัดทิ้งเจ้าของจะนึกว่าเมนูนั้นไม่อยู่ในรายงาน
//   nav   — เมนูนำทางในแถบข้าง (หน้าแรก เมนูทั้งหมด รายงานทั้งหมด) แยกไว้ ไม่ปนในแท่งอันดับ
//   rows  — ทุกชื่อหน้าที่มีข้อมูล (รวมหน้าที่ไม่ใช่เมนู และ 'other') เรียงมากไปน้อย พร้อมสัดส่วนของยอดรายหน้ารวม — ตารางเต็ม
//   total — ผลรวมรายหน้า (ฐานของสัดส่วน — ไม่ใช่ยอดสะสมทั้งหมดบนการ์ด เพราะรายหน้าเริ่มนับทีหลัง)
// ชื่อที่ไม่อยู่ในตาราง (ถูกยิงตรงด้วยชื่อมั่ว หรือหน้าที่ลบออกจากแอปแล้ว) รวมเป็น 'other'
export function pageRanking(rows) {
  const sums = new Map()
  for (const r of rows ?? []) {
    const key = PAGE_BY_KEY.has(r.page_key) ? r.page_key : OTHER_PAGE.key
    const prev = sums.get(key) ?? { opens: 0, visitors: 0 }
    sums.set(key, { opens: prev.opens + Number(r.opens ?? 0), visitors: prev.visitors + Number(r.visitors ?? 0) })
  }
  const total = [...sums.values()].reduce((sum, v) => sum + v.opens, 0)
  const byOpensThenName = (a, b) => b.opens - a.opens || a.label.localeCompare(b.label, 'th')
  const entry = key => {
    const page = PAGE_BY_KEY.get(key)
    const v = sums.get(key) ?? { opens: 0, visitors: 0 }
    return { key, label: page.label, kind: page.kind, opens: v.opens, visitors: v.visitors, share: total ? v.opens / total : 0 }
  }
  const menuEntries = MENU_PAGE_KEYS.map(entry)
  return {
    total,
    rows: [...sums.keys()].map(entry).sort(byOpensThenName),
    menus: menuEntries.filter(p => p.kind !== 'transit').sort(byOpensThenName),
    nav: menuEntries.filter(p => p.kind === 'transit').sort(byOpensThenName),
  }
}

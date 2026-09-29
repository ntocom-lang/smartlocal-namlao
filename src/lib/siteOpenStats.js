// ─── กติกาของตัวนับการเข้าชมเว็บไซต์ (ท้ายเว็บ + หน้า /reports/visitors) ───
//
// ไฟล์นี้เป็นฟังก์ชันล้วน tests/site-open-counter.test.mjs import ตรงได้โดยไม่ต้องลาก supabase client
// มาด้วย ตัวที่ยิง RPC จริง + store ของท้ายเว็บอยู่ที่ siteOpenCounter.js
//
// นิยามการนับที่เจ้าของระบบเลือก (2569-09-29): เอายอดมากที่สุดเท่าที่ยังตรวจสอบย้อนได้
//   การเข้าชม (ครั้ง) = ทุกครั้งที่หน้าแสดงผล ทั้งเปิดเว็บ รีเฟรช และเปลี่ยนหน้า ทุกคนรวมเจ้าหน้าที่
//   ตัดออกเฉพาะสิ่งที่ "ไม่ใช่คน": บอต/crawler, เบราว์เซอร์ที่สคริปต์คุม (E2E ของเรา), localhost/dev
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

// ตรรกะล้วนของแจ้งเตือน Telegram "สรุปเรื่องร้องเรียนประจำเดือนพร้อมแล้ว" (complaint-monthly-reminder)
//
// แยกออกมาจาก index.ts เพราะไฟล์นั้นต้อง import จากเน็ต (deno.land / esm.sh) เทสต์ใน node รันตรงๆ ไม่ได้
// ไฟล์นี้จึงห้าม import อะไรนอกจาก ./telegram.ts (ซึ่งไม่ import เน็ต) และห้ามใช้ Deno.* —
// tests/complaint-monthly-reminder.test.mjs โหลดไฟล์นี้ไปรันจริง

import { escapeHtml } from './telegram.ts'

// คีย์โมดูลเรื่องร้องเรียนใน municipalities.enabled_modules (null = เปิดทุกโมดูล ตามพฤติกรรมเดิมของ TenantContext)
export const MODULE_KEY = 'complaints'
export const NOTIFICATION_TYPE = 'complaint_monthly_summary'

// ต้องตรงกับ MONTHS_TH_FULL ใน src/lib/complaintMonthlySummary.js — เทสต์อ่านสองฝั่งมาเทียบ
export const MONTHS_TH_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

export type ReportMonth = {
  key: string      // 2569-09 (พ.ศ.) — รูปแบบเดียวกับ ?m= ของหน้า /reports/complaints
  label: string    // กันยายน 2569
  beYear: number
  month: number    // 1–12
  from: string     // 2026-09-01 (ค.ศ. YYYY-MM-DD)
  to: string       // 2026-09-30 วันสุดท้ายที่นับรวม
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * เดือนปฏิทินไทยที่ "เพิ่งจบ" ณ เวลา now — cron ยิงวันที่ 1 ของเดือน 08:30 น. เวลาไทย
 * ต้องอ่านเดือนตามเวลาไทย ไม่ใช่ UTC ของเซิร์ฟเวอร์ (ตี 0–7 ของวันที่ 1 ไทย ยังเป็นวันสุดท้ายของเดือนก่อนใน UTC)
 */
export function previousMonthBangkok(now: Date): ReportMonth {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' })
    .formatToParts(now)
  const ceYearNow = Number(parts.find((p) => p.type === 'year')?.value)
  const monthNow = Number(parts.find((p) => p.type === 'month')?.value)
  const index = ceYearNow * 12 + (monthNow - 1) - 1
  const ceYear = Math.floor(index / 12)
  const month = (index % 12) + 1
  const beYear = ceYear + 543
  const lastDay = new Date(Date.UTC(ceYear, month, 0)).getUTCDate()
  return {
    key: `${beYear}-${pad2(month)}`,
    label: `${MONTHS_TH_FULL[month - 1]} ${beYear}`,
    beYear,
    month,
    from: `${ceYear}-${pad2(month)}-01`,
    to: `${ceYear}-${pad2(month)}-${pad2(lastDay)}`,
  }
}

/** ลิงก์ไปหน้าสรุปรายเดือนของ อปท. นั้น — slug ที่มีอักขระนอก a-z 0-9 - คืน null (กันประกอบเป็นโฮสต์อื่น) */
export function reportUrl(slug: unknown, monthKey: string): string | null {
  const value = String(slug ?? '')
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value)) return null
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return null
  return `https://${value}.rk-networks.com/reports/complaints?m=${monthKey}`
}

export function moduleOn(enabledModules: string[] | null | undefined): boolean {
  return enabledModules == null || enabledModules.includes(MODULE_KEY)
}

/** กันส่งซ้ำรายเดือนต่อ อปท. (unique ของ notification_deliveries คือ อปท. + ช่องทาง + คีย์นี้) */
export function idempotencyKey(monthKey: string): string {
  return `complaint_monthly:${monthKey}`
}

// เปรียบเทียบเวลาคงที่ — แบบเดียวกับ water-alert-notify/thaiwater-sync (ไม่ให้เดา secret ทีละตัวอักษรจากเวลาตอบ)
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/**
 * ข้อความเข้ากลุ่ม Telegram ของ อปท. — มีแต่ยอดรวมกับลิงก์ ไม่มีข้อมูลระบุตัวบุคคล (PDPA: ลบย้อนหลังจาก Telegram ไม่ได้)
 *
 * ⚠️ ตั้งใจ "ไม่ใส่ร้อยละแล้วเสร็จ": ร้อยละนับจากสถานะ ณ วันที่เปิดดู เรื่องที่รับในเดือนนั้นปิดทีหลังได้ ตัวเลขในข้อความ
 * (ส่งวันที่ 1) จะไม่ตรงกับภาพที่เจ้าหน้าที่ดาวน์โหลดทีหลัง ยอดรวมเรื่องที่รับเข้าเดือนนั้นนิ่งแล้ว จึงบอกได้ปลอดภัย
 * ⚠️ ลิงก์: เจ้าของระบบเคยสั่งถอดลิงก์เข้าระบบออกจากข้อความแจ้งคำขอ/คำร้อง (2569-09-12) ข้อความนี้มีลิงก์เพราะ
 * "ลิงก์คือเนื้อหาของข้อความ" (พาไปหน้าสาธารณะที่มีปุ่มดาวน์โหลดภาพ ไม่ใช่หน้าเจ้าหน้าที่) — อยู่ในแผนที่เสนอเจ้าของแล้ว
 */
export function buildReminderMessage(
  input: { tenantName: unknown; month: ReportMonth; total: number; url: string },
): string {
  const total = Number.isFinite(input.total) ? input.total : 0
  return [
    `📊 <b>สรุปเรื่องร้องเรียนประจำเดือน${escapeHtml(input.month.label, 40)} พร้อมแล้ว</b>`,
    escapeHtml(input.tenantName, 120),
    `รับเรื่องร้องเรียนเข้าระบบทั้งเดือน ${total.toLocaleString('th-TH')} เรื่อง`,
    'ระบบสร้างภาพสรุปให้แล้ว กดดาวน์โหลดหรือแชร์ลง LINE / Facebook ได้เลย',
    escapeHtml(input.url, 200),
  ].join('\n').slice(0, 1800)
}

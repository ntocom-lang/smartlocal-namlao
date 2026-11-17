// ตรรกะล้วนของแจ้งเตือน Telegram "ใบอนุญาตใกล้หมดอายุ / หนังสือรับรองการแจ้งใกล้ครบกำหนดค่าธรรมเนียมรายปี" (licence-expiry-notify)
//
// แยกออกมาจาก index.ts เพราะไฟล์นั้นต้อง import จากเน็ต (deno.land / esm.sh) เทสต์ใน node รันตรงๆ ไม่ได้
// ไฟล์นี้จึงห้าม import อะไรนอกจาก ./telegram.ts และห้ามใช้ Deno.* — tests/licence-expiry-notify.test.mjs โหลดไปรันจริง
//
// กติกาเตือน (เจ้าของระบบอนุมัติ 2569-11-17)
//   วันเป้าหมาย target = expires_on (ใบอนุญาต) หรือ next_fee_due_on (หนังสือรับรองการแจ้ง)
//   d = target − วันนี้ตามเวลาไทย · remind_days ของ อปท. (ไม่มีแถว = 60/30/7/0)
//   หลักเตือน m* = ค่าน้อยสุดใน remind_days ที่ d ≤ m (ไม่มี = ยังไม่ถึงหลักแรก ข้าม) — เตือนครั้งเดียวต่อ (ใบ, วันเป้าหมาย, หลัก)
//   cron ยิงเฉพาะจันทร์–ศุกร์: หลักที่ตรงเสาร์-อาทิตย์ถูกส่งตามในวันทำการถัดไปเอง (d หดลงแต่ m* ยังเป็นหลักเดิม ถ้ายังไม่ข้ามหลักถัดไป)
//   ข้อความมีแต่ชื่อ อปท. และ "จำนวนใบ" — ไม่มีชื่อร้าน/ชื่อผู้ประกอบการ/เลขใบ (PDPA: ลบย้อนหลังจาก Telegram ไม่ได้)

import { escapeHtml } from './telegram.ts'

export const NOTIFICATION_TYPE = 'licence_expiring'
export const JOB_NAME = 'licence-expiry-notify'
export const DEFAULT_REMIND_DAYS = [60, 30, 7, 0]
export const MODULE_KEY = 'licence-registry'

export type DocKind = 'licence' | 'notice_certificate'

export type LicenceRow = {
  id: string
  municipality_id: string
  licence_type_id: string
  expires_on: string | null
  next_fee_due_on: string | null
  status: string
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

/** วันนี้ตามเวลาไทย (ISO yyyy-mm-dd) — ไม่อ่านโซนเวลาเครื่อง */
export function todayBangkok(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** b − a เป็นจำนวนวัน (ISO ล้วน) · ผิดรูป = null */
export function daysBetween(a: string, b: string): number | null {
  const x = ISO.exec(a ?? '')
  const y = ISO.exec(b ?? '')
  if (!x || !y) return null
  const ms = (m: RegExpExecArray) => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Math.round((ms(y) - ms(x)) / 86400000)
}

/** วันที่ ISO บวก days วัน (ใช้คำนวณเพดานวันที่เมื่อดึงเฉพาะใบที่ถึงหลักเตือนแรก) */
export function addDays(iso: string, days: number): string | null {
  const m = ISO.exec(iso ?? '')
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86400000).toISOString().slice(0, 10)
}

/** ค่าวันเตือนที่ใช้จริง: ไม่มี/ผิดรูป/ว่าง → ค่าเริ่มต้น · จำนวนเต็ม 0–180 ไม่ซ้ำ เรียงมาก→น้อย */
export function effectiveRemindDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_REMIND_DAYS]
  const set = new Set<number>()
  for (const v of raw) {
    const n = Number(v)
    if (Number.isInteger(n) && n >= 0 && n <= 180) set.add(n)
  }
  return set.size ? [...set].sort((a, b) => b - a).slice(0, 6) : [...DEFAULT_REMIND_DAYS]
}

/** วันที่ที่ใช้เตือนของใบนี้ตามชนิดเอกสาร */
export function targetOf(licence: Pick<LicenceRow, 'expires_on' | 'next_fee_due_on'>, docKind: DocKind): string | null {
  return (docKind === 'notice_certificate' ? licence.next_fee_due_on : licence.expires_on) ?? null
}

/** หลักเตือนที่ใช้: ค่าน้อยสุดใน remindDays ที่ d ≤ m · ไม่มี (ยังไกลกว่าหลักแรก) = null */
export function stageOf(d: number, remindDays: number[]): number | null {
  const hit = remindDays.filter((m) => d <= m)
  return hit.length ? Math.min(...hit) : null
}

/** คีย์กันส่งซ้ำต่อ (ใบ, วันเป้าหมาย, หลัก) — ต่ออายุแล้ว target เปลี่ยน ใบเดิมเตือนรอบใหม่ได้ */
export function idempotencyKey(licenceId: string, target: string, stage: number): string {
  return `licence_remind:${licenceId}:${target}:${stage}`
}

export type Due = { licenceId: string; docKind: DocKind; target: string; days: number; stage: number; key: string }

/**
 * ใบที่ถึงหลักเตือน ณ วันนี้ — เฉพาะ active/suspended (เพิกถอน/เลิกกิจการไม่ต้องเตือน)
 * types: { [licence_type_id]: doc_kind } · ประเภทที่หาไม่เจอข้าม (ไม่เดาชนิดเอกสาร)
 */
export function dueLicences(input: {
  licences: LicenceRow[]
  docKindByType: Record<string, DocKind | undefined>
  remindDays: number[]
  today: string
}): Due[] {
  const out: Due[] = []
  for (const l of input.licences ?? []) {
    if (l.status !== 'active' && l.status !== 'suspended') continue
    const docKind = input.docKindByType[l.licence_type_id]
    if (docKind !== 'licence' && docKind !== 'notice_certificate') continue
    const target = targetOf(l, docKind)
    if (!target) continue
    const d = daysBetween(input.today, target)
    if (d === null) continue
    const stage = stageOf(d, input.remindDays)
    if (stage === null) continue
    out.push({ licenceId: l.id, docKind, target, days: d, stage, key: idempotencyKey(l.id, target, stage) })
  }
  return out
}

const fmt = (n: number) => n.toLocaleString('th-TH')

/**
 * ข้อความเข้ากลุ่ม Telegram ของ อปท. — 1 ข้อความต่อ อปท. มีแต่จำนวน แยกใบอนุญาต/หนังสือรับรองการแจ้ง
 * แยก "หมดอายุ/ครบกำหนดแล้ว" · "วันนี้" · "ภายใน N วัน" (N = หลักเตือนที่ใบนั้นอยู่) · ไม่มีรายการ = null (ไม่ส่งข้อความว่าง)
 * ⚠️ ไม่ใส่ลิงก์เข้าระบบ (เจ้าของระบบสั่งถอดลิงก์ท้ายข้อความแจ้งเตือนแล้ว #160) บอกทางเข้าเมนูเป็นตัวหนังสือแทน
 */
export function buildMessage(input: { tenantName: unknown; items: Pick<Due, 'docKind' | 'days' | 'stage'>[] }): string | null {
  const items = input.items ?? []
  if (items.length === 0) return null
  const section = (kind: DocKind, title: string, past: string, today: string, within: (n: number) => string) => {
    const mine = items.filter((i) => i.docKind === kind)
    if (mine.length === 0) return []
    const lines: string[] = [title]
    const overdue = mine.filter((i) => i.days < 0).length
    const dueToday = mine.filter((i) => i.days === 0).length
    if (overdue > 0) lines.push(`• ${past} ${fmt(overdue)} ใบ`)
    if (dueToday > 0) lines.push(`• ${today} ${fmt(dueToday)} ใบ`)
    const stages = [...new Set(mine.filter((i) => i.days > 0).map((i) => i.stage))].sort((a, b) => a - b)
    for (const s of stages) lines.push(`• ${within(s)} ${fmt(mine.filter((i) => i.days > 0 && i.stage === s).length)} ใบ`)
    return lines
  }
  const licence = section('licence', '<b>ใบอนุญาต</b>', 'หมดอายุแล้ว', 'หมดอายุวันนี้', (n) => `หมดอายุภายใน ${n} วัน`)
  const notice = section('notice_certificate', '<b>หนังสือรับรองการแจ้ง (ค่าธรรมเนียมรายปี)</b>', 'ครบกำหนดชำระแล้ว', 'ครบกำหนดชำระวันนี้', (n) => `ครบกำหนดชำระภายใน ${n} วัน`)
  return [
    '📋 <b>ทะเบียนใบอนุญาต: ใกล้ครบกำหนด</b>',
    escapeHtml(input.tenantName, 120),
    '',
    ...licence,
    ...(licence.length && notice.length ? [''] : []),
    ...notice,
    '',
    'ดูรายชื่อที่เมนู "ทะเบียนใบอนุญาต" → แท็บ "ต้องดำเนินการ"',
  ].join('\n').slice(0, 3500)
}

/** slug ที่ใช้กรองตอนทดสอบ (only_slug) — รูปแบบเดียวกับโฮสต์ของ อปท. · ผิดรูป = null */
export function validSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value) && value.length <= 63 ? value : null
}

/** อปท. นี้เปิดโมดูลทะเบียนใบอนุญาตไว้ "ชัดเจน" ไหม — ต่างจากโมดูลเก่า: ไม่ใช่ array = ไม่ส่ง (โมดูลนี้ค่าเริ่มต้นปิด) */
export function moduleEnabled(enabledModules: unknown): boolean {
  return Array.isArray(enabledModules) && enabledModules.includes(MODULE_KEY)
}

// เปรียบเทียบเวลาคงที่ — แบบเดียวกับ localPlanMonthlyReminder.ts
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

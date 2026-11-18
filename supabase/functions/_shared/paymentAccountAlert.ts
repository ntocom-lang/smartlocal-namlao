// ตัวช่วยของ payment-account-alert — แยกไว้ให้เทสต์ด้วย node ได้ (ไม่มี import ของ Deno)
// เนื้อหามาจาก payment_alert_claim() ที่ปิดเลขบัญชีเหลือ 4 ตัวท้ายให้แล้ว · ข้อความไม่มีข้อมูลประชาชน

export type AlertField = { field: string; old: string | null; new: string | null }
export type AlertPayload = {
  event_id: number
  attempt: number
  changed_at: string
  municipality_name: string | null
  telegram_group_id: string | null
  first_setup: boolean
  actor_name: string | null
  actor_title: string | null
  fields: AlertField[]
  dm_chat_ids: string[]
}

export const FIELD_LABEL: Record<string, string> = {
  promptpay_id: 'เลขพร้อมเพย์ของหน่วยงาน',
  biller_id: 'รหัสผู้รับชำระ (Biller ID)',
  bank_name: 'ธนาคาร',
  payee_name: 'ชื่อบัญชี',
}

export function escapeHtmlText(value: unknown, maxLength = 200): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, maxLength)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function formatBangkokDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d) + ' น.'
}

/** ข้อความแจ้งเปลี่ยนบัญชีรับเงิน (HTML ของ Telegram) — ทุกค่าที่มาจากฐาน escape ก่อนเสมอ */
export function buildAccountAlertMessage(p: AlertPayload): string {
  const head = p.first_setup ? '🔐 <b>ตั้งบัญชีรับเงินครั้งแรก</b>' : '⚠️ <b>บัญชีรับเงินถูกเปลี่ยน</b>'
  const lines = [head, escapeHtmlText(p.municipality_name ?? '', 120), '']
  const fields = Array.isArray(p.fields) ? p.fields : []
  for (const f of fields) {
    const label = FIELD_LABEL[f.field] ?? escapeHtmlText(f.field, 40)
    const next = f.new ? escapeHtmlText(f.new) : '(ลบออก)'
    lines.push(p.first_setup || f.old == null
      ? `• ${label}: <b>${next}</b>`
      : `• ${label}: ${escapeHtmlText(f.old)} → <b>${next}</b>`)
  }
  if (fields.length === 0) lines.push('• (ไม่ระบุช่องที่เปลี่ยน — ดูประวัติในเมนูรับชำระเงิน)')
  const who = escapeHtmlText(p.actor_name ?? 'ไม่ทราบชื่อ', 120) + (p.actor_title ? ` (${escapeHtmlText(p.actor_title, 120)})` : '')
  lines.push('', `โดย ${who}`, `เวลา ${formatBangkokDateTime(p.changed_at)}`, '',
    'ถ้าไม่ได้สั่งเปลี่ยน ให้ตรวจที่เมนู "รับชำระเงิน" → ตั้งค่า ทันที',
    'ใบแจ้งชำระที่พิมพ์ก่อนเวลานี้อาจมี QR ของบัญชีเดิม')
  return lines.join('\n')
}

/** สรุปผลส่งสั้นๆ ลงคิว (ไม่มี chat id) */
export function deliveryNote(group: 'sent' | 'failed' | 'none', dmSent: number, dmTotal: number): string {
  const g = group === 'sent' ? 'กลุ่ม ✓' : group === 'failed' ? 'กลุ่ม ✗' : 'ไม่มีกลุ่ม'
  return `${g} · ส่วนตัว ${dmSent}/${dmTotal}`
}

/** ผลรวมของรอบ: ส่งถึงอย่างน้อย 1 ที่ = sent · ไม่มีปลายทางเลย = skipped · มีปลายทางแต่ส่งไม่ถึงสักที่ = failed (ลองใหม่) */
export function outcome(group: 'sent' | 'failed' | 'none', dmSent: number, dmTotal: number): 'sent' | 'failed' | 'skipped' {
  if (group === 'sent' || dmSent > 0) return 'sent'
  if (group === 'none' && dmTotal === 0) return 'skipped'
  return 'failed'
}

export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

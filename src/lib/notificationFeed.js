// กระดิ่งรวม "งานของฉัน" หลายหมวด — ตรรกะล้วน เทสต์ด้วย node (tests/notification-feed.test.mjs)
//
// คำร้องดึงจาก NotificationsContext เดิม · หมวดอื่นมาจาก RPC my_notification_feed ที่ตัดสินสิทธิ์ฝั่งฐานข้อมูล
// (RLS เดิม + RPC เดิมของแต่ละโมดูล) หน้าเว็บแค่แปลรหัสเป็นข้อความ ไม่ตัดสินเองว่าใครเห็นอะไร
// ข้อความไม่มีชื่อคน เบอร์ ปลายทาง วัตถุประสงค์ — ป๊อปอัปขึ้นกลางจอ คนข้างๆ เห็นได้

export const NOTIFICATION_CATEGORIES = [
  { key: 'complaint', label: 'คำร้อง' },
  { key: 'esign', label: 'รอลงนามของฉัน' },
  { key: 'event', label: 'กิจกรรมที่มอบหมายให้ฉัน' },
  { key: 'eservice', label: 'คำขอบริการ/เอกสาร' },
  { key: 'patient', label: 'รถรับ-ส่งผู้ป่วย' },
]
export const NOTIFICATION_CATEGORY_KEYS = NOTIFICATION_CATEGORIES.map((c) => c.key)
const FEED_KINDS = new Set(['esign', 'event', 'eservice', 'patient'])

// ดึงฟีดซ้ำทุก 2 นาทีระหว่างหน้าเปิดอยู่ (คำขอ/รถผู้ป่วยไม่อยู่ใน realtime) — ประมาณการ 20 แท็บเปิดทั้งวันราชการ
// ≈ 5,400 ครั้ง/วัน × ~2 KB ≈ 11 MB/วัน อยู่ในโควตาแผนฟรี · หน้าถูกซ่อน (พับจอ/สลับแท็บ) ไม่ดึง
export const FEED_REFRESH_MS = 2 * 60 * 1000

const EVENT_TASK_TITLE = {
  attend: 'ได้รับมอบหมายไปประชุมแทน',
  preside: 'ได้รับมอบหมายเป็นประธานแทน',
  join: 'ได้รับมอบหมายร่วมงานแทน',
}

const stripEmoji = (label) => String(label ?? '').replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, '').trim()

function thaiDate(value) {
  if (!value) return ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T00:00:00+07:00`) : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' })
}

/** แปลงแถวจาก my_notification_feed เป็นรายการกระดิ่ง · docTypeLabel(code) แปลรหัสประเภทคำขอเป็นชื่อ */
export function mapFeedItem(raw, docTypeLabel = (code) => code) {
  const kind = String(raw?.category ?? '')
  if (!FEED_KINDS.has(kind) || !raw?.key) return null
  const base = { id: raw.key, key: raw.key, _kind: kind, status: raw.status ?? null, updated_at: raw.at ?? null, _href: '/staff', _hrefState: null }
  if (kind === 'esign') {
    const when = thaiDate(raw.at)
    return {
      ...base,
      title: raw.status === 'approve' ? 'รออนุมัติของคุณ' : 'รอลงนามของคุณ',
      body: ['ใบขอใช้รถ', raw.detail, when ? `ออกเดินทาง ${when}` : ''].filter(Boolean).join(' · '),
    }
  }
  if (kind === 'event') {
    const when = thaiDate(raw.detail)
    return { ...base, title: EVENT_TASK_TITLE[raw.status] ?? 'ได้รับมอบหมายในกิจกรรม', body: when ? `วันที่ ${when}` : 'เปิดดูรายละเอียดในปฏิทิน', _href: '/events' }
  }
  if (kind === 'eservice') {
    return { ...base, title: 'คำขอใหม่รอรับเรื่อง', body: stripEmoji(docTypeLabel(raw.detail)) || 'คำขอบริการ/เอกสาร', _hrefState: { module: 'inbox' } }
  }
  const count = Number(raw.detail)
  return {
    ...base,
    title: 'งานรถรับ-ส่งผู้ป่วยรอดำเนินการ',
    body: Number.isFinite(count) ? `${count} รายการ` : 'เปิดดูรายการงาน',
    _count: Number.isFinite(count) ? count : 0,
    _hrefState: { module: 'patient-transport' },
  }
}

export const isFeedItem = (item) => FEED_KINDS.has(item?._kind)

/**
 * รายการฟีดที่ต้องเด้งเตือน = ไม่มีในรอบดึงก่อนหน้า + ยังไม่อ่าน
 * previous = null คือรอบแรกหลังเปิดหน้า/เปลี่ยนบัญชี — ไม่เด้งของค้างเดิม
 * รถผู้ป่วยมีแค่จำนวนงาน (ตารางไม่เปิดให้อ่านรายใบ) — เด้งเฉพาะตอนจำนวนเพิ่ม ไม่เด้งตอนงานลดลง
 */
export function freshFeedItems(previous, items, readKeys = new Set()) {
  if (!previous) return []
  return items.filter((item) => {
    if (readKeys.has(item.key)) return false
    if (item._kind === 'patient') return item._count > (previous.patientCount ?? 0)
    return !previous.keys.has(item.key)
  })
}

export function feedRound(items) {
  return {
    keys: new Set(items.map((item) => item.key)),
    patientCount: items.find((item) => item._kind === 'patient')?._count ?? 0,
  }
}

// ฐานข้อมูลยังไม่มีฟังก์ชัน (ยังไม่ได้ apply migration) — เงียบไว้ กระดิ่งยังทำงานด้วยคำร้องตามเดิม
export const isMissingFeedFunction = (error) =>
  error?.code === 'PGRST202'
  || (/my_notification_feed/.test(String(error?.message ?? '')) && /not find|does not exist/i.test(String(error?.message ?? '')))

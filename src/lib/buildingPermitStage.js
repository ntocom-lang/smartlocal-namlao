// ขั้นความคืบหน้าของคำขออนุญาตก่อสร้าง (document_requests.permit_stage) — ฟังก์ชันล้วน ไม่พึ่ง React/supabase
//
// ขั้นย่อยนี้เป็นแค่ "การแจ้งความคืบหน้า" ไม่ใช่การตัดสินอนุญาต และไม่แทน status หลัก 4 ค่าเดิม
// (pending/processing/completed/rejected) — การออกใบอนุญาตจริงเป็นดุลพินิจของผู้มีอำนาจนอกระบบ
// เลขที่ใบอนุญาต/วันออก/วันหมดอายุ เจ้าหน้าที่กรอกตามที่พิมพ์ในใบจริง
// ⚠️ ระบบไม่คำนวณวันหมดอายุจากกฎหมายเอง (อายุใบอนุญาตขึ้นกับประเภทอาคาร/การต่อใบ/เงื่อนไขในใบ)
// ห้ามเติมค่าเริ่มต้นให้ช่องวันหมดอายุ

// เรียงตามลำดับงานจริง · key = ค่าในคอลัมน์ permit_stage (null = ยังไม่เริ่มขั้นย่อย = รับคำขอแล้ว)
export const PERMIT_STAGES = [
  { key: null,              label: 'รับคำขอแล้ว' },
  { key: 'doc_check',       label: 'ตรวจเอกสาร' },
  { key: 'site_inspection', label: 'ตรวจสถานที่/แบบแปลน' },
  { key: 'review',          label: 'เสนอผู้มีอำนาจพิจารณา' },
  { key: 'issued',          label: 'ออกใบอนุญาตแล้ว รอรับ' },
  { key: 'collected',       label: 'รับใบอนุญาตแล้ว' },
]

const normalize = (stage) => (stage === undefined || stage === '' ? null : stage)

// ตำแหน่งในลำดับ (0 = รับคำขอแล้ว) · ค่าที่ไม่รู้จักคืน -1
export function stageIndex(stage) {
  const key = normalize(stage)
  return PERMIT_STAGES.findIndex(s => s.key === key)
}

export function stageLabel(stage) {
  return PERMIT_STAGES[stageIndex(stage)]?.label ?? ''
}

// ขั้นถัดไป คืน { key, label } · คืน null เมื่ออยู่ขั้นสุดท้ายแล้ว (หรือค่าไม่รู้จัก)
// ไม่คืนเป็นค่า key เปล่าๆ เพราะ key ของขั้นแรกคือ null เอง จะแยกจาก "ไม่มีขั้นถัดไป" ไม่ได้
export function nextStage(stage) {
  const i = stageIndex(stage)
  if (i < 0 || i >= PERMIT_STAGES.length - 1) return null
  return PERMIT_STAGES[i + 1]
}

// ส่งเลขที่/วันที่ใบอนุญาตได้เฉพาะ 2 ขั้นนี้ (ตรงกับกติกาใน RPC set_building_permit_stage)
export function stageAllowsPermitFields(stage) {
  return stage === 'issued' || stage === 'collected'
}

const MONTHS_SHORT_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

function parseIsoDate(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { y, mo, d, utc: Date.UTC(y, mo - 1, d) }
}

// "1 พ.ย. 2570" (ปี พ.ศ.) · แยกตัวเลขเองไม่ผ่าน new Date(str) กันวันเพี้ยนข้าม timezone
export function thaiShortDate(iso) {
  const p = parseIsoDate(iso)
  return p ? `${p.d} ${MONTHS_SHORT_TH[p.mo - 1]} ${p.y + 543}` : ''
}

// วันนี้ตามปฏิทินไทย (YYYY-MM-DD) ไม่ขึ้นกับ timezone ของเครื่อง
export function bangkokTodayIso(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}

const SOON_DAYS = 30

// expires_on = "วันสุดท้ายที่ใบยังใช้ได้" → หมดอายุเมื่อ expires_on < วันนี้ (เวลาไทย)
// คืน null เมื่อไม่มีวันหมดอายุ (หรือรูปแบบวันที่ผิด) · todayIso รับเป็นพารามิเตอร์เพื่อให้เทสต์ไม่ขึ้นกับเวลา
// tone: 'ok' (เหลือ > 30 วัน) | 'soon' (≤ 30 วัน รวมวันนี้) | 'expired'
export function permitExpiryInfo(expiresOn, todayIso = bangkokTodayIso()) {
  const exp = parseIsoDate(expiresOn)
  const today = parseIsoDate(todayIso)
  if (!exp || !today) return null
  const daysLeft = Math.round((exp.utc - today.utc) / 86400000)
  const dateText = thaiShortDate(expiresOn)
  if (daysLeft < 0) {
    return { daysLeft, expired: true, tone: 'expired', text: `หมดอายุแล้ว (ใช้ได้ถึง ${dateText})` }
  }
  if (daysLeft === 0) {
    return { daysLeft, expired: false, tone: 'soon', text: 'ใช้ได้ถึงวันนี้' }
  }
  return {
    daysLeft,
    expired: false,
    tone: daysLeft <= SOON_DAYS ? 'soon' : 'ok',
    text: `ใช้ได้ถึง ${dateText} · เหลือ ${daysLeft} วัน`,
  }
}

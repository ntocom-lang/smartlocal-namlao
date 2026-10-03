// ตัวช่วยฝั่งหน้าจอของ "สุขภาพข้อมูล" (RPC data_center_health) ในศูนย์รวมข้อมูลดิจิทัล
// ตัวตรวจจริงอยู่ที่ฐานข้อมูล (supabase/migrations/20261003200100_data_center_health_and_catalog.sql)
// ไฟล์นี้มีแค่ "ป้ายภาษาไทย + คำอธิบายกฎ" และฟังก์ชันจัดรูปแบบ — รหัสปัญหากับค่าเริ่มต้นต้องตรงกับ SQL
// (tests/data-center-hub.test.mjs เทียบสองฝั่งให้)
//
// หลักคิด: กฎทุกข้อต้องอธิบายให้เจ้าหน้าที่เข้าใจและตรวจย้อนได้เอง ไม่ใช้โมเดลที่อธิบายเหตุผลไม่ได้
// "ต้องแก้" นับเป็นไม่พร้อมใช้ (กระทบคะแนน) ส่วน "ควรเติม" แสดงเป็นความครบถ้วนเฉยๆ ไม่กระทบคะแนน

export const DEFAULT_STALE_DAYS = 365

// ตัวเลือกช่วง "ตรวจทานล่าสุด" ให้เจ้าของระบบเลือกเอง — ถนน/สถานที่สำคัญเปลี่ยนช้า ค่าเริ่มต้นจึงเป็นปีละครั้ง
export const STALE_OPTIONS = [
  { days: 180, label: '6 เดือน' },
  { days: 365, label: '1 ปี' },
  { days: 730, label: '2 ปี' },
]

export const ISSUE_ORDER = ['stale', 'duplicate', 'no_owner', 'pii_id', 'no_description', 'no_photo']

export const MUST_FIX_ISSUES = ['stale', 'duplicate', 'no_owner', 'pii_id']

export function staleLabel(days) {
  const hit = STALE_OPTIONS.find((o) => o.days === days)
  if (hit) return hit.label
  return days % 365 === 0 ? `${days / 365} ปี` : `${Math.round(days / 30)} เดือน`
}

// rule: ประโยคที่เจ้าหน้าที่อ่านแล้วตรวจเองได้ · fix: ต้องทำอะไรเพื่อให้ป้ายนี้หาย
export const ISSUES = {
  stale: {
    label: 'ไม่ได้ตรวจทานนาน',
    short: 'ตรวจทานนาน',
    severity: 'must',
    rule: (days) => `ไม่มีการแก้ไขหรือกดยืนยันเกิน ${staleLabel(days)} (นับจากวันที่ใหม่กว่าระหว่าง "แก้ไขล่าสุด" กับ "ตรวจทานล่าสุด")`,
    fix: 'กด "ยืนยันว่ายังถูกต้อง" ถ้าข้อมูลยังตรงกับของจริง หรือกดแก้ไขถ้ามีอะไรเปลี่ยน',
  },
  duplicate: {
    label: 'อาจซ้ำกัน',
    short: 'อาจซ้ำ',
    severity: 'must',
    rule: () => 'จุดพิกัดที่ชื่อเดียวกัน (ไม่นับช่องว่าง/ตัวพิมพ์) อยู่กลุ่มและประเภทเดียวกัน มีมากกว่า 1 รายการ — ไม่ตรวจเส้นทาง เพราะเส้นถนนที่นำเข้าจากไฟล์ KML ถูกซอยเป็นหลายท่อนชื่อเดียวกันตามปกติ',
    fix: 'เปิดดูทั้งสองรายการ ลบหรือปิดใช้งานอันที่ซ้ำ',
  },
  no_owner: {
    label: 'ไม่มีกองเจ้าของ',
    short: 'ไม่มีเจ้าของ',
    severity: 'must',
    rule: () => 'รายการที่ยังไม่ได้ระบุกอง/สำนักผู้รับผิดชอบ (มักมาจากการนำเข้าไฟล์โดยผู้ดูแลระบบ)',
    fix: 'ผู้ดูแลระบบเลือกกองเจ้าของได้ที่แถวนี้ หรือกำหนดให้ทุกรายการที่ไม่มีเจ้าของพร้อมกัน',
  },
  pii_id: {
    label: 'อาจมีเลขบัตรประชาชน',
    short: 'เลข 13 หลัก',
    severity: 'must',
    rule: () => 'ชื่อหรือรายละเอียดมีเลข 13 หลักที่หน้าตาเหมือนเลขบัตรประชาชน — ข้อความนี้ถูกเผยแพร่เป็นข้อมูลเปิดบนแผนที่สาธารณะ จึงต้องไม่มีเลขบัตรหลุดไป (เบอร์โทรและพิกัดไม่ถูกนับ)',
    fix: 'ลบเลขนั้นออกจากข้อความ หรือถ้าตรวจแล้วเป็นเลขอื่น (เช่น เลขผู้เสียภาษีของนิติบุคคล) กด "ยืนยันว่ายังถูกต้อง" หลังแก้ไขครั้งล่าสุด',
  },
  no_description: {
    label: 'ไม่มีรายละเอียด',
    short: 'ไม่มีรายละเอียด',
    severity: 'nice',
    rule: () => 'ช่อง "รายละเอียด" ว่างหรือมีแต่ช่องว่าง',
    fix: 'เปิดแก้ไขแล้วเพิ่มคำอธิบายสั้นๆ',
  },
  no_photo: {
    label: 'ไม่มีรูป',
    short: 'ไม่มีรูป',
    severity: 'nice',
    rule: () => 'จุดพิกัดที่ยังไม่มีรูปแนบ (เส้นทางถนนไม่ต้องมีรูป จึงไม่ถูกนับ)',
    fix: 'เปิดแก้ไขแล้วแนบรูปได้สูงสุด 5 รูป',
  },
}

// ใช้แค่ระบายสี ไม่ใช่เกณฑ์ทางการ — ตัวเลขคะแนนจริงมาจากฐานข้อมูล
export function scoreTone(score) {
  if (score == null) return 'none'
  if (score >= 80) return 'good'
  if (score >= 50) return 'warn'
  return 'bad'
}

export function percent(part, whole) {
  if (!whole) return null
  return Math.round((100 * part) / whole)
}

const DAY_MS = 24 * 60 * 60 * 1000

// "3 วันที่แล้ว" / "2 เดือนที่แล้ว" — now ส่งเข้ามาได้เพื่อให้เทสต์ไม่ผูกกับเวลาจริง
export function formatAgo(iso, now = Date.now()) {
  if (!iso) return 'ไม่เคย'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const days = Math.floor((now - t) / DAY_MS)
  if (days < 0) return 'วันนี้'
  if (days === 0) return 'วันนี้'
  if (days === 1) return 'เมื่อวาน'
  if (days < 30) return `${days} วันที่แล้ว`
  if (days < 365) return `${Math.floor(days / 30)} เดือนที่แล้ว`
  return `${Math.floor(days / 365)} ปีที่แล้ว`
}

export function formatThaiDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

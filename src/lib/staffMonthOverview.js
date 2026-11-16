// "ภาพรวมเดือนนี้" บนหน้าแรกเจ้าหน้าที่ — ตัวช่วยบริสุทธิ์ (ไม่แตะฐานข้อมูล/เบราว์เซอร์)
// ข้อมูลมาจาก RPC staff_month_overview(p_muni) (supabase/migrations/20261129100000_staff_month_overview_rpc.sql)
// ตัวเลขล้วน ไม่มีชื่อผู้ร้อง/เลขคำร้อง (PDPA) · ร้อยละ "ตรงเวลา" คิดที่นี่ ไม่ได้คิดที่ฐานข้อมูล

const RULE_BASE = 'นับคำร้องตั้งแต่วันที่ 1 ของเดือนถึงวันนี้ (เวลาไทย) · ตรงเวลา = เสร็จทันกำหนด ÷ (เสร็จทันกำหนด + เสร็จช้า + ค้างที่เลยกำหนด) สูตรเดียวกับเมนูผลการปฏิบัติงานและห้องผู้บริหาร · ไม่นับหมวดเฉพาะกิจและหมวดร้องเรียนเจ้าหน้าที่ (คุ้มครองผู้ร้อง)'
const RULE_DEPT_TAIL = ' ตัวเลขเลยกำหนดจึงอาจน้อยกว่าการ์ด "กองของฉัน" ที่นับทุกหมวด'

const SCOPES = ['department', 'municipality']

// ข้อความ "วิธีคิด" — ประโยคท้ายเรื่อง "กองของฉัน" ใช้เฉพาะ scope กอง (แอดมินไม่มีการ์ดนั้นให้เทียบ)
export function monthOverviewRule(scope) {
  return scope === 'department' ? RULE_BASE + RULE_DEPT_TAIL : RULE_BASE
}

// ค่าตั้งต้นสำหรับแสดงผลโดยไม่ทราบ scope (ใช้ชุดเต็ม)
export const MONTH_OVERVIEW_RULE = monthOverviewRule('department')

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

function count(value) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

// 'YYYY-MM-DD' (หรือ ISO ที่ขึ้นต้นด้วยวันที่) → { y, m, d } · ผิดรูป/ไม่มีวันนั้นจริงในปฏิทิน = null
function parseDate(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1) return null
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null
  return { y, m, d }
}

// "1–16 พฤศจิกายน 2569" · วันที่ 1 (ต้นเดือน = วันนี้) → "1 พฤศจิกายน 2569" · วันที่ผิดรูป = ''
function periodText(monthStart, today) {
  const a = parseDate(monthStart)
  const b = parseDate(today)
  if (!a || !b) return ''
  const be = y => y + 543
  const sameMonth = a.y === b.y && a.m === b.m
  if (sameMonth) {
    return a.d === b.d
      ? `${a.d} ${THAI_MONTHS[a.m - 1]} ${be(a.y)}`
      : `${a.d}–${b.d} ${THAI_MONTHS[a.m - 1]} ${be(a.y)}`
  }
  // RPC ให้ทั้งสองค่าเป็นเดือนเดียวกันเสมอ — กันไว้ไม่ให้ช่วงเพี้ยนเงียบถ้าวันหนึ่งไม่ใช่
  return `${a.d} ${THAI_MONTHS[a.m - 1]} ${be(a.y)} – ${b.d} ${THAI_MONTHS[b.m - 1]} ${be(b.y)}`
}

/**
 * แปลงผลของ staff_month_overview เป็นรูปที่จอใช้ · ไม่ใช่ object หรือ scope ไม่รู้จัก → null (ไม่แสดงการ์ด)
 * onTimePct = onTime ÷ (onTime + late + openPastDue) ปัดเป็นจำนวนเต็ม · ตัวหาร 0 = null (ไม่มีเรื่องที่ครบกำหนด ไม่ใช่ 0%)
 */
export function normalizeMonthOverview(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!SCOPES.includes(raw.scope)) return null
  const onTime = count(raw.on_time)
  const late = count(raw.late)
  const openPastDue = count(raw.open_past_due)
  const base = onTime + late + openPastDue
  const monthStart = typeof raw.month_start === 'string' ? raw.month_start.slice(0, 10) : ''
  const today = typeof raw.today === 'string' ? raw.today.slice(0, 10) : ''
  return {
    scope: raw.scope,
    departmentName: typeof raw.department_name === 'string' ? raw.department_name.trim() : '',
    monthStart,
    today,
    received: count(raw.received),
    completed: count(raw.completed),
    onTime,
    late,
    noDue: count(raw.no_due),
    openPastDue,
    openNow: count(raw.open_now),
    onTimePct: base === 0 ? null : Math.round((onTime * 100) / base),
    periodText: periodText(monthStart, today),
  }
}

// ตรรกะล้วนของแจ้งเตือน Web Push เรื่องคำร้อง (send-push) — ใครได้รับ + ข้อความที่ขึ้นบนจอ
//
// แยกออกมาจาก index.ts เพราะไฟล์นั้นต้อง import จากเน็ต (deno.land / esm.sh / npm:) เทสต์ใน node รันตรงๆ ไม่ได้
// ไฟล์นี้จึงห้าม import อะไรและห้ามใช้ Deno.* — tests/complaint-push.test.mjs โหลดไฟล์นี้ไปรันจริง
//
// กติกาหลัก (2569-10-28): ข้อความประกอบที่ server เท่านั้น ผู้เรียกส่งได้แค่ complaint_id + kind
// เดิมมีโหมด "ส่งทั้ง อปท." ที่ไม่ต้องล็อกอิน ส่งถึงทุกเครื่องของ อปท. (รวมเครื่องประชาชน) พร้อมข้อความ
// ที่ประชาชนพิมพ์ 100 ตัวแรก — พอ #599 เปิดปุ่มให้ทุกคนสมัครรับ รายละเอียดคำร้องจะไปขึ้นจอล็อกของ
// ประชาชนคนอื่น และใครก็ยิงข้อความเองถึงทุกเครื่องได้ จึงถอดโหมดข้อความอิสระทิ้งทั้งหมด

export const COMPLAINT_PUSH_KINDS = ['complaint_finished', 'complaint_created', 'complaint_note', 'complaint_photo'] as const
export type ComplaintPushKind = typeof COMPLAINT_PUSH_KINDS[number]

export const isComplaintPushKind = (kind: unknown): kind is ComplaintPushKind =>
  (COMPLAINT_PUSH_KINDS as readonly unknown[]).includes(kind)

// ต้องตรงกับ src/lib/complaintWorkflow.js (FINISHED_STATUSES, REOPEN_WINDOW_DAYS) — เทสต์อ่านสองฝั่งมาเทียบ
export const FINISHED_STATUSES = ['closed', 'completed']
export const REOPEN_WINDOW_DAYS = 7

// สมมติฐาน 2569-09-29: ส่งได้เฉพาะเรื่องที่เพิ่งปิด/เพิ่งยื่น กันการกดส่งซ้ำย้อนหลัง
export const PUSH_FRESH_WINDOW_MS = 15 * 60 * 1000
// นาฬิกาเครื่อง DB กับ edge อาจต่างกันเล็กน้อย — เวลาในอนาคตไม่เกินนี้ยังถือว่าเพิ่งเกิด
const CLOCK_SKEW_MS = 60 * 1000

// เรื่องลับ — ชุดเดียวกับ CONFIDENTIAL_COMPLAINT_CATEGORIES ของ notify-telegram (เทสต์ตรวจให้)
// แจ้งเตือนขึ้นบนหน้าจอล็อกมือถือ ใครเห็นเครื่องก็รู้ว่ามีการแจ้งเรื่องทุจริต จึงไม่ใส่ชื่อหมวด (2569-09-29)
export const CONFIDENTIAL_COMPLAINT_CATEGORIES = new Set(['corruption'])

// บทบาทที่ได้แจ้งเตือน "คำร้องใหม่" — คนที่ลงมือกับคำร้องใหม่ได้ (ดู pickNewComplaintRecipients)
export const NEW_COMPLAINT_PUSH_ROLES = ['superadmin', 'admin', 'officer', 'staff']

export type PushMessage = { title: string; body: string; url: string }

// ชื่อหมวดใน DB มีอีโมจินำหน้า — ตัดทิ้งแต่ต้องไม่กินตัวเลข (\p{Emoji} รวม 0-9 ไว้ด้วย)
export const stripCategoryEmoji = (label: unknown): string =>
  String(label ?? '').replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, '').trim()

export function isFreshTimestamp(value: unknown, nowMs: number, windowMs = PUSH_FRESH_WINDOW_MS): boolean {
  const at = typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(at)) return false
  const age = nowMs - at
  return age >= -CLOCK_SKEW_MS && age <= windowMs
}

/**
 * ข้อความแจ้งเตือนของแต่ละชนิด — รับแค่ชื่อหมวดกับเลขที่ ไม่มีช่องให้ใส่รายละเอียดที่ประชาชนพิมพ์
 * เรื่องลับไม่ใส่ชื่อหมวด ทั้งฝั่งประชาชน (จอล็อกผู้แจ้ง) และฝั่งเจ้าหน้าที่ (จอล็อกในที่ทำงาน)
 */
export function complaintPushMessage(
  kind: ComplaintPushKind,
  { label = '', confidential = false, complaintNumber = null }: { label?: string; confidential?: boolean; complaintNumber?: string | null } = {},
): PushMessage {
  const name = confidential ? '' : stripCategoryEmoji(label)
  const ofComplaint = name ? `คำร้อง${name}` : 'คำร้องของคุณ'
  switch (kind) {
    case 'complaint_finished': {
      const reopenHint = `แตะเพื่อดูผลและให้คะแนน ถ้ายังไม่เรียบร้อยแจ้งกลับได้ภายใน ${REOPEN_WINDOW_DAYS} วัน`
      return {
        title: 'คำร้องของคุณดำเนินการแล้ว',
        body: name ? `คำร้อง${name} ดำเนินการแล้ว — ${reopenHint}` : reopenHint,
        url: '/my-complaints',
      }
    }
    case 'complaint_created': {
      const number = String(complaintNumber ?? '').trim()
      return {
        title: 'คำร้องใหม่',
        body: [number ? `เลขที่ ${number}` : '', name].filter(Boolean).join(' · ') || 'มีคำร้องใหม่เข้าระบบ',
        url: '/staff',
      }
    }
    case 'complaint_note':
      return { title: 'เจ้าหน้าที่บันทึกข้อความถึงคุณ', body: `มีบันทึกใหม่ใน${ofComplaint}`, url: '/my-complaints' }
    case 'complaint_photo':
      return { title: 'มีรูปหลักฐานการทำงานใหม่', body: `เจ้าหน้าที่เพิ่มรูปความคืบหน้าใน${ofComplaint}`, url: '/my-complaints' }
  }
}

export type RecipientProfile = {
  id: string
  role: string | null
  municipality_id: string | null
  department_id: string | null
}
export type DepartmentRow = {
  id: string
  municipality_id: string | null
  name: string | null
  short_name: string | null
  code: string | null
}
export type NewComplaint = {
  municipality_id: string
  department: string | null
  assigned_to: string | null
}

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()

/**
 * ตามกติกาของ complaint_matches_my_department() ใน DB: กองของผู้ใช้ (อปท. เดียวกัน) ตรงกับข้อความ
 * department ของคำร้อง ด้วยชื่อเต็ม ชื่อย่อ หรือรหัส ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย
 * ต่างจาก DB จุดเดียว: department ว่างไม่ตรงกับใคร (ฝั่ง SQL '' ไปตรงกับกองที่ไม่มีชื่อย่อ/รหัส)
 * แจ้งเตือนจึงแคบกว่ากระดิ่งในกรณีนั้น ไม่กว้างกว่า
 */
export function departmentMatches(
  complaintDepartment: string | null,
  profile: RecipientProfile,
  departments: DepartmentRow[],
): boolean {
  const target = norm(complaintDepartment)
  if (!target || !profile.department_id) return false
  const dept = departments.find((d) => d.id === profile.department_id && d.municipality_id === profile.municipality_id)
  if (!dept) return false
  return [dept.name, dept.short_name, dept.code].some((value) => norm(value) !== '' && norm(value) === target)
}

/**
 * ผู้รับแจ้งเตือน "คำร้องใหม่" = คนที่ list_complaints_for_staff() ให้เห็นเรื่องนี้ และเป็นคนลงมือ
 * - superadmin (index.ts กรองเครื่องให้เหลือเฉพาะที่สมัครจากเว็บของ อปท. นี้)
 * - admin ของ อปท. เดียวกัน
 * - officer/staff ของ อปท. เดียวกัน ที่ถูกมอบหมาย หรือกองตรงกับคำร้อง
 *   หมวดเฉพาะกิจ (is_adhoc) ให้เฉพาะผู้ถูกมอบหมาย ตาม 20260827120000_restrict_odor_adhoc_visibility
 * ไม่รวมประชาชน, technician (กระดิ่งของช่างแสดงเฉพาะงานที่รับแล้ว) และ viewer/council/kamnan
 * (เห็นได้แต่ไม่ได้ลงมือ — สมมติฐาน 2569-10-28)
 */
export function pickNewComplaintRecipients(
  complaint: NewComplaint,
  adhoc: boolean,
  profiles: RecipientProfile[],
  departments: DepartmentRow[],
): string[] {
  const ids = new Set<string>()
  for (const profile of profiles) {
    if (!profile?.id) continue
    if (profile.role === 'superadmin') {
      ids.add(profile.id)
      continue
    }
    if (!complaint.municipality_id || profile.municipality_id !== complaint.municipality_id) continue
    if (profile.role === 'admin') {
      ids.add(profile.id)
    } else if (profile.role === 'officer' || profile.role === 'staff') {
      const assigned = complaint.assigned_to === profile.id
      if (assigned || (!adhoc && departmentMatches(complaint.department, profile, departments))) ids.add(profile.id)
    }
  }
  return [...ids]
}

// "สรุปวันนี้" ของแถบหัวหน้าแรกเจ้าหน้าที่ — ไม่เกิน 2 บรรทัด เรียบเรียงจากตัวเลขที่หน้านี้มีอยู่แล้ว (ไม่ดึงข้อมูลเพิ่ม)
// ฟังก์ชันบริสุทธิ์ล้วน (ไม่ import React/supabase เทสต์ด้วย node ได้) · เทสต์: node tests/staff-home-briefing.test.mjs
//
// หลักที่ห้ามผิด
//   - ใช้กฎตายตัวที่อธิบายและตรวจย้อนได้ (STAFF_BRIEFING_RULE ขึ้นเป็นปุ่ม "วิธีคิด" บนจอ) · ไม่ใช้ข้อความอิสระ/ชื่อคน
//   - ตัวเลขที่ยังโหลดไม่เสร็จหรือโหลดพลาด = ไม่สรุป (คืน null) ห้ามอ้างว่า "ไม่มีงาน" จากค่าเริ่มต้น 0 (บทเรียนเดียวกับ todoState)
//   - เตือนเท่านั้น ไม่ใช่คำสั่ง · ไม่สร้างงานให้ใคร

export const STAFF_BRIEFING_RULE = 'ระบบสรุปจากตัวเลขในหน้านี้ตามลำดับ: งานเลยกำหนด → งานรอคุณ → ภัยที่กำลังมา → กิจกรรมวันนี้ ไม่เกิน 2 บรรทัด · ตัวเลขที่ยังโหลดไม่ได้จะไม่ถูกสรุป'
export const STAFF_BRIEFING_MAX_LINES = 2

// ตัวเลขผิดรูป (ไม่ใช่ตัวเลข/ติดลบ/ทศนิยม) = 0 หรือปัดลง
const count = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0)
const nf = (n) => n.toLocaleString('th-TH')

// ข้อความของภัยหนึ่งรายการ — insight จาก heavyRainInsight/pm25Insight มี brief ถ้าไม่มีใช้ what · ไม่มีข้อความ = ข้าม
function hazardText(hazards) {
  for (const it of Array.isArray(hazards) ? hazards : []) {
    const text = typeof it?.brief === 'string' && it.brief ? it.brief : it?.what
    if (typeof text === 'string' && text) return text
  }
  return null
}

/**
 * @param {{
 *   ready: boolean, state: 'loading'|'error'|'pending'|'clear'|'holding',
 *   waiting?: number, overdue?: number, soon?: number, eventsToday?: number, hazards?: object[],
 * }} input  state = ผล todoState() ของหน้าแรก · waiting = ผลรวมงานรอคุณ (ตัวเดียวกับ badgeCounts ที่ส่งเข้า todoState)
 * @returns {{ lines: string[], tone: 'clear'|'normal'|'urgent' }|null}  null = ยังสรุปไม่ได้ (ไม่ขึ้นบรรทัดนี้ ไม่มีสปินเนอร์)
 */
export function buildStaffBriefing({ ready, state, waiting, overdue, soon, eventsToday, hazards } = {}) {
  // error = มีแหล่งตัวเลขพัง ไม่รู้ว่าจริงๆ มีงานหรือไม่ → ไม่สรุป (ป้ายเตือนอยู่ในส่วน "ต้องทำตอนนี้" แล้ว)
  if (ready !== true || state === 'loading' || state === 'error') return null
  const hazard = hazardText(hazards)

  if (state === 'clear') {
    return { lines: ['วันนี้ไม่มีงานค้าง', ...(hazard ? [hazard] : [])].slice(0, STAFF_BRIEFING_MAX_LINES), tone: 'clear' }
  }

  const nWaiting = count(waiting)
  const nOverdue = count(overdue)
  const nSoon = count(soon)
  const nEvents = count(eventsToday)

  const lines = []
  let tone = 'normal'
  if (nOverdue > 0) {
    lines.push(`มีคำร้องเลยกำหนด ${nf(nOverdue)} ใบ ควรเร่งดำเนินการ`)
    tone = 'urgent'
  } else if (nWaiting > 0) {
    lines.push(`มีงานรอคุณ ${nf(nWaiting)} เรื่อง${nSoon > 0 ? ` · ใกล้ครบกำหนด ${nf(nSoon)} ใบ` : ''}`)
  } else if (nSoon > 0) {
    // ไม่มีงานรอ/เลยกำหนด แต่มีใบใกล้ครบ — ไม่ปล่อยบรรทัดงานว่าง ทั้งที่ KPI ขึ้นตัวเลข
    lines.push(`มีคำร้องใกล้ครบกำหนด ${nf(nSoon)} ใบ`)
  } else if (state === 'holding') {
    lines.push('ไม่มีงานเร่งด่วน')
  }

  if (hazard) lines.push(hazard)
  else if (nEvents > 0) lines.push(`วันนี้มีกิจกรรมที่ได้รับมอบหมาย ${nf(nEvents)} รายการ`)

  if (lines.length === 0) return null
  return { lines: lines.slice(0, STAFF_BRIEFING_MAX_LINES), tone }
}

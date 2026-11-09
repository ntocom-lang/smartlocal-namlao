// เกณฑ์ "งานอัตโนมัติหยุดทำงานไหม" ของ thaiwater-watchdog — ตรรกะล้วน ไม่แตะเน็ต/ฐานข้อมูล
// (เทสต์ import ไฟล์นี้ตรงจาก node: tests/water-situation.test.mjs)
//
// งานแต่ละตัวรันคนละจังหวะ เกณฑ์เดียวใช้ไม่ได้:
//   rolling — งานรายชั่วโมง: สำเร็จล่าสุดต้องไม่เก่ากว่า maxAgeMinutes
//   monthly — งานเดือนละครั้ง: พ้นเส้นตาย (วันที่ day เวลา dueTime ตามเวลาไทย) ของเดือนนี้แล้ว
//             ต้องมี "สำเร็จ" ตั้งแต่ 00:00 ของวันนั้น · ยังไม่ถึงเส้นตาย = ดูรอบของเดือนก่อน
//             ยิงซ้ำด้วยมือภายหลัง (เช่นวันที่ 3) แล้วสำเร็จ = นับว่าแก้แล้ว
//
// เวลาไทยคิดด้วยค่าคงที่ +7 ชม. (ไทยไม่มี daylight saving) — ห้ามอ่านจากโซนเวลาของเครื่อง

export type JobSchedule =
  | { kind: 'rolling'; maxAgeMinutes: number }
  // firstMonth = เดือนแรกที่เริ่มเฝ้า (YYYY-MM ค.ศ.) — งานที่เพิ่งเปิดยังไม่เคยมีรอบจริง
  // ถ้าไม่กำหนด ระบบจะถือว่ารอบของเดือนก่อนหน้าหายไป แล้วเตือนผิดทุกวันจนถึงรอบแรก
  | { kind: 'monthly'; day: number; dueTime: string; firstMonth: string }

export type JobCheck = {
  stale: boolean
  // monthly: เวลาเริ่มของรอบที่ต้องมีผลสำเร็จ (ISO) · null = ยังไม่ถึงรอบแรก หรือ rolling
  cycleStart: string | null
}

const BKK_OFFSET_MS = 7 * 3600_000

// เวลา UTC (ms) ของ "ปี/เดือน/วัน ชั่วโมง:นาที ตามเวลาไทย" — month 0–11 ล้นข้ามปีได้ (Date.UTC จัดการให้)
function bangkokToUtcMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(year, month, day, hour, minute) - BKK_OFFSET_MS
}

function parseHhMm(text: string): [number, number] {
  const m = /^(\d{2}):(\d{2})$/.exec(text)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`dueTime ต้องเป็น HH:MM ได้ ${text}`)
  return [Number(m[1]), Number(m[2])]
}

function parseYearMonth(text: string): [number, number] {
  const m = /^(\d{4})-(\d{2})$/.exec(text)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`firstMonth ต้องเป็น YYYY-MM ได้ ${text}`)
  return [Number(m[1]), Number(m[2]) - 1]
}

export function checkJob(schedule: JobSchedule, lastOkAt: string | null, now: Date): JobCheck {
  const nowMs = now.getTime()
  const okMs = lastOkAt ? new Date(lastOkAt).getTime() : NaN

  if (schedule.kind === 'rolling') {
    const fresh = Number.isFinite(okMs) && nowMs - okMs <= schedule.maxAgeMinutes * 60_000
    return { stale: !fresh, cycleStart: null }
  }

  if (!Number.isInteger(schedule.day) || schedule.day < 1 || schedule.day > 28) {
    // จำกัด 1–28 ไว้ เพราะวันที่ 29–31 ไม่มีทุกเดือน (Date.UTC จะเลื่อนไปเดือนถัดไปเงียบๆ)
    throw new Error(`day ต้องอยู่ระหว่าง 1–28 ได้ ${schedule.day}`)
  }
  const [hh, mm] = parseHhMm(schedule.dueTime)
  const [firstYear, firstMonth] = parseYearMonth(schedule.firstMonth)

  const bkk = new Date(nowMs + BKK_OFFSET_MS)
  let year = bkk.getUTCFullYear()
  let month = bkk.getUTCMonth()
  // ยังไม่ถึงเส้นตายของเดือนนี้ → รอบที่ต้องตรวจคือของเดือนก่อน
  if (nowMs < bangkokToUtcMs(year, month, schedule.day, hh, mm)) {
    month -= 1
    if (month < 0) { month = 11; year -= 1 }
  }
  if (year < firstYear || (year === firstYear && month < firstMonth)) {
    return { stale: false, cycleStart: null }
  }

  const cycleStartMs = bangkokToUtcMs(year, month, schedule.day)
  const done = Number.isFinite(okMs) && okMs >= cycleStartMs
  return { stale: !done, cycleStart: new Date(cycleStartMs).toISOString() }
}

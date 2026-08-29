// แปลง user agent ดิบเป็นชื่อที่คนอ่านรู้เรื่อง สำหรับหน้า "อุปกรณ์ที่ล็อกอินอยู่"
//
// ตั้งใจให้หยาบและอ่านง่าย ไม่ใช่ fingerprint: ผู้ใช้แค่ต้องแยกออกว่าแถวไหนคือเครื่องที่
// ทิ้งไว้ที่สำนักงาน แถวไหนคือมือถือตัวเอง ไม่ต้องรู้เลขเวอร์ชันเบราว์เซอร์
//
// ไม่ใช้ไลบรารี ua-parser: เพิ่ม dependency ~20KB เพื่อความแม่นยำที่เกินความจำเป็นของงานนี้
// และตัว UA เองก็เชื่อไม่ได้ 100% อยู่แล้ว (iPad ส่ง UA เป็น Macintosh มาตั้งแต่ iPadOS 13)

const BROWSERS = [
  // เรียงตามลำดับที่ต้องเช็คก่อน-หลัง: UA ของ Edge/Line/Samsung มีคำว่า Chrome อยู่ด้วย
  // และ UA ของ Chrome ก็มีคำว่า Safari อยู่ด้วย เช็คสลับลำดับแล้วจะตอบผิดทุกตัว
  [/\bLine\//i, 'LINE'],
  [/\bEdg(?:e|A|iOS)?\//i, 'Edge'],
  [/\bSamsungBrowser\//i, 'Samsung Internet'],
  [/\bOPR\/|\bOpera/i, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//i, 'Firefox'],
  [/\bCriOS\//i, 'Chrome'],
  [/\bChrome\//i, 'Chrome'],
  [/\bSafari\//i, 'Safari'],
]

const PLATFORMS = [
  [/\biPhone\b/i, 'iPhone', 'mobile'],
  [/\biPad\b/i, 'iPad', 'tablet'],
  [/\bAndroid\b/i, 'Android', 'mobile'],
  [/\bWindows\b/i, 'Windows', 'desktop'],
  [/\bMac OS X\b|\bMacintosh\b/i, 'Mac', 'desktop'],
  [/\bCrOS\b/i, 'ChromeOS', 'desktop'],
  [/\bLinux\b/i, 'Linux', 'desktop'],
]

/**
 * @param {string|null} userAgent ค่าที่ GoTrue บันทึกไว้ตอนล็อกอิน
 * @returns {{ label: string, kind: 'mobile'|'tablet'|'desktop'|'unknown' }}
 */
export function describeDevice(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : ''
  if (!ua.trim()) return { label: 'ไม่ทราบอุปกรณ์', kind: 'unknown' }

  const platform = PLATFORMS.find(([re]) => re.test(ua))
  const browser = BROWSERS.find(([re]) => re.test(ua))

  if (!platform) return { label: browser ? browser[1] : 'ไม่ทราบอุปกรณ์', kind: 'unknown' }
  return {
    label: browser ? `${browser[1]} บน ${platform[1]}` : platform[1],
    kind: platform[2],
  }
}

// "เมื่อสักครู่ / 5 นาทีที่แล้ว / 3 ชั่วโมงที่แล้ว / 2 วันที่แล้ว"
// ใช้กับคอลัมน์ "ใช้งานล่าสุด" ซึ่งผู้ใช้สนใจแค่ว่านานแค่ไหนแล้ว ไม่ได้สนใจวันที่เป๊ะๆ
export function relativeTimeTh(value) {
  if (!value) return '—'
  const then = new Date(value).getTime()
  if (!Number.isFinite(then)) return '—'

  const diffMs = Date.now() - then
  if (diffMs < 0) return 'เมื่อสักครู่'   // นาฬิกาเครื่องผู้ใช้เดินเร็วกว่าเซิร์ฟเวอร์

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 2) return 'เมื่อสักครู่'
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} วันที่แล้ว`

  return new Date(then).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

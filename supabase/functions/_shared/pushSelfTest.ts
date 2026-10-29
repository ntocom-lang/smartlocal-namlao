// ปุ่ม "ส่งทดสอบถึงเครื่องนี้" ในหน้า /profile/notifications — ตรรกะล้วน (tests/push-test-devices.test.mjs โหลดไปรันจริง)
// ไฟล์นี้ห้าม import อะไรและห้ามใช้ Deno.* (เหตุผลเดียวกับ complaintPush.ts)
//
// ส่งได้เฉพาะเครื่องของผู้กดเอง (endpoint ต้องเป็นแถวของบัญชีนี้) ข้อความตายตัว ไม่มีช่องให้พิมพ์
// จำกัดครั้งต่อช่วงเวลา กันกดรัวแล้วกินโควตาบริการ push ของเบราว์เซอร์

export const SELF_TEST_KIND = 'self_test'
export const SELF_TEST_LIMIT = 3
export const SELF_TEST_WINDOW_MS = 10 * 60 * 1000

export const selfTestMessage = () => ({
  title: 'ทดสอบการแจ้งเตือน',
  body: 'เครื่องนี้รับการแจ้งเตือนจากระบบได้แล้ว แตะเพื่อกลับไปหน้าตั้งค่า',
  url: '/profile/notifications',
})

/**
 * ส่งทดสอบได้อีกไหม — recentCount = จำนวนครั้งที่ส่งไปแล้วในช่วง SELF_TEST_WINDOW_MS ล่าสุด
 * นับไม่ได้ (null/ไม่ใช่ตัวเลข) = ไม่ให้ส่ง — Number(null) เป็น 0 จะปล่อยให้กดได้ไม่จำกัด
 */
export const selfTestAllowed = (recentCount: unknown) =>
  typeof recentCount === 'number' && Number.isInteger(recentCount) && recentCount >= 0 && recentCount < SELF_TEST_LIMIT

// endpoint ของบริการ push ต้องเป็น https และยาวพอสมควร — กันค่าขยะก่อนแตะฐานข้อมูล
export const isPushEndpoint = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 1024 && /^https:\/\/[^\s/]+\/\S+$/.test(value)

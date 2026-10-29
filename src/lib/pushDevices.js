// เครื่องที่เปิดรับแจ้งเตือน (Web Push) ของบัญชีนี้ + ปุ่มส่งทดสอบ — ใช้ในหน้า /profile/notifications
// ตรรกะล้วน (describeDevice / selfTestResultText) เทสต์ด้วย node: tests/push-test-devices.test.mjs
import { supabase } from './supabase'

/**
 * ชื่อเครื่องสั้นๆ เช่น "Chrome · Windows" หรือ "Safari · iPhone · แอป" — เก็บแค่นี้ ไม่เก็บ user-agent ดิบ
 * ลำดับการตรวจสำคัญ: Edge/Samsung/Opera/LINE มีคำว่า Chrome อยู่ใน user-agent ด้วย ต้องเช็กก่อน Chrome
 */
export function describeDevice(nav = globalThis.navigator, win = globalThis.window) {
  const ua = String(nav?.userAgent ?? '')
  const touchMac = /Macintosh/.test(ua) && Number(nav?.maxTouchPoints) > 1 // iPadOS แสดงตัวเป็น Mac
  const os = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) || touchMac ? 'iPad'
      : /Android/.test(ua) ? 'Android'
        : /CrOS/.test(ua) ? 'ChromeOS'
          : /Windows/.test(ua) ? 'Windows'
            : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
              : /Linux/.test(ua) ? 'Linux' : ''
  const browser = /\bLine\//.test(ua) ? 'LINE'
    : /FBAN|FBAV/.test(ua) ? 'Facebook'
      : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
        : /Edg(A|iOS)?\//.test(ua) ? 'Edge'
          : /OPR\/|Opera/.test(ua) ? 'Opera'
            : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
              : /CriOS|Chrome\//.test(ua) ? 'Chrome'
                : /Safari\//.test(ua) ? 'Safari' : 'เบราว์เซอร์'
  return [browser, os, openedAsInstalledApp(nav, win) ? 'แอป' : ''].filter(Boolean).join(' · ').slice(0, 60)
}

function openedAsInstalledApp(nav, win) {
  try {
    return Boolean(win?.matchMedia?.('(display-mode: standalone)').matches || nav?.standalone)
  } catch {
    return false
  }
}

export async function listMyPushDevices(userId) {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, device_label, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

// ลบเฉพาะแถวของบัญชีนี้ (RLS ก็กันอยู่แล้ว) — ไม่ยกเลิกสิทธิ์แจ้งเตือนของเบราว์เซอร์ เหมือนปุ่มปิดรับ
export async function removePushDevice(userId, id) {
  const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('id', id)
  if (error) throw error
}

/** ส่งข้อความทดสอบถึงเครื่องนี้ผ่านเส้นทางจริง (server → บริการ push ของเบราว์เซอร์ → เครื่อง) */
export async function sendSelfTest(endpoint) {
  const { data, error } = await supabase.functions.invoke('send-push', { body: { kind: 'self_test', endpoint } })
  if (!error) return { ok: Number(data?.sent) > 0, failed: Number(data?.failed) > 0, status: 200 }
  return { ok: false, failed: false, status: Number(error?.context?.status) || 0 }
}

export function selfTestResultText(result) {
  if (result?.ok) return 'ส่งแล้ว ถ้าไม่เห็นแจ้งเตือนภายใน 1 นาที ให้ตรวจการตั้งค่าแจ้งเตือนของเครื่องและเบราว์เซอร์'
  if (result?.status === 429) return 'ทดสอบได้ไม่เกิน 3 ครั้งใน 10 นาที กรุณารอสักครู่แล้วลองใหม่'
  if (result?.status === 404) return 'เครื่องนี้ยังไม่ได้ลงทะเบียนกับบัญชีนี้ กดปิดรับแล้วเปิดรับบนเครื่องนี้ใหม่'
  if (result?.failed) return 'บริการแจ้งเตือนของเบราว์เซอร์ไม่รับข้อความ ลองปิดรับแล้วเปิดรับใหม่'
  return 'ส่งทดสอบไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่'
}

import { supabase } from './supabase'

// เรียก edge function device-login แล้วแกะ body ออกมาให้ได้เสมอ ไม่ว่า HTTP จะเป็นอะไร
//
// supabase-js ถือว่า status >= 400 เป็น FunctionsHttpError แล้วคืน data = null ทันที
// ส่วน body ที่ function ตอบกลับมา (ซึ่งเป็นข้อความไทยที่บอกเหตุผลจริง เช่น "QR หมดอายุแล้ว"
// "คำขอนี้ถูกใช้ไปแล้ว" "ใช้ได้เฉพาะบัญชีเจ้าหน้าที่") ไปอยู่ใน error.context ที่เป็น Response
// ถ้าไม่แกะตรงนี้ ทุก 403/404/409/410 จะกลายเป็น "เชื่อมต่อไม่ได้" เหมือนกันหมด
// (เจอจริงตอนทดสอบด้วยเครื่องจริง — ทดสอบด้วย curl ก่อนหน้านั้นไม่เจอเพราะเห็น body ตรงๆ อยู่แล้ว)

async function callOnce(body) {
  // แนบ access token ของผู้ใช้เองทุกครั้ง ไม่พึ่ง header ที่ functions.invoke เก็บไว้ภายใน:
  // getSession() ต่ออายุ token ที่หมดอายุให้ก่อนคืนค่า ต่างจาก header ของ client ซึ่งเป็น token
  // ณ ตอนที่ auth event ล่าสุดยิง — บนมือถือที่เพจถูกซ่อน/แสดงสลับไปมา (เปิดกล้องสแกน สลับแอป)
  // ตัวต่ออายุ token ในตัว SDK เคยไม่ฟื้นตัวเองมาแล้วในโปรเจกต์นี้ ผลคือ edge function เห็นเป็น
  // anon แล้วตอบ 401 "กรุณาเข้าสู่ระบบบนมือถือก่อน" ทั้งที่ผู้ใช้ล็อกอินอยู่จริง
  let headers
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token) headers = { Authorization: `Bearer ${token}` }
  } catch {
    // อ่าน session ไม่ได้ ปล่อยให้ invoke ใช้ header เดิมของ client ไปตามเดิม
  }

  const { data, error } = await supabase.functions.invoke('device-login', {
    body,
    ...(headers ? { headers } : {}),
  })
  if (!error) return { data, status: 200, offline: false }

  const response = error?.context
  if (response && typeof response.json === 'function') {
    try {
      return { data: await response.json(), status: response.status ?? 0, offline: false }
    } catch {
      // body อ่านไม่ออก ถือเป็นปัญหาการเชื่อมต่อ
    }
  }
  return { data: null, status: 0, offline: true }
}

// คืน offline = true เฉพาะกรณีที่ติดต่อ function ไม่ได้จริงๆ หรืออ่าน body ไม่ออกเท่านั้น
export async function invokeDeviceLogin(body) {
  const first = await callOnce(body)

  // โดน 401 ทั้งที่ฝั่งแอปยังถือ session อยู่ = token ที่ส่งไปหมดอายุหรือรีเฟรชไม่ทัน
  // บังคับต่ออายุแล้วยิงซ้ำครั้งเดียว ดีกว่าให้เจ้าหน้าที่ไปนั่งเดาว่าทำไมระบบบอกว่ายังไม่ล็อกอิน
  if (first.status === 401) {
    const { data: current } = await supabase.auth.getSession()
    if (current?.session) {
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (!refreshError) return callOnce(body)
    }
  }

  return first
}

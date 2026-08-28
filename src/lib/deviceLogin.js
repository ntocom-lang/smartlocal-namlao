import { supabase } from './supabase'

// เรียก edge function device-login แล้วแกะ body ออกมาให้ได้เสมอ ไม่ว่า HTTP จะเป็นอะไร
//
// supabase-js ถือว่า status >= 400 เป็น FunctionsHttpError แล้วคืน data = null ทันที
// ส่วน body ที่ function ตอบกลับมา (ซึ่งเป็นข้อความไทยที่บอกเหตุผลจริง เช่น "QR หมดอายุแล้ว"
// "คำขอนี้ถูกใช้ไปแล้ว" "ใช้ได้เฉพาะบัญชีเจ้าหน้าที่") ไปอยู่ใน error.context ที่เป็น Response
// ถ้าไม่แกะตรงนี้ ทุก 403/404/409/410 จะกลายเป็น "เชื่อมต่อไม่ได้" เหมือนกันหมด
// (เจอจริงตอนทดสอบด้วยเครื่องจริง — ทดสอบด้วย curl ก่อนหน้านั้นไม่เจอเพราะเห็น body ตรงๆ อยู่แล้ว)
//
// คืน offline = true เฉพาะกรณีที่ติดต่อ function ไม่ได้จริงๆ หรืออ่าน body ไม่ออกเท่านั้น
export async function invokeDeviceLogin(body) {
  const { data, error } = await supabase.functions.invoke('device-login', { body })
  if (!error) return { data, offline: false }

  const response = error?.context
  if (response && typeof response.json === 'function') {
    try {
      return { data: await response.json(), offline: false }
    } catch {
      // body อ่านไม่ออก ถือเป็นปัญหาการเชื่อมต่อ
    }
  }
  return { data: null, offline: true }
}

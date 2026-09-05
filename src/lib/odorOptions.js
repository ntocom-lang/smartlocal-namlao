// ตัวเลือกของหมวดเฉพาะกิจ "กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)" — แหล่งเดียวของฝั่ง frontend
//
// เดิมประกาศไว้ใน CitizenForm.jsx ไฟล์เดียว ใช้ตอนเรนเดอร์ dropdown อย่างเดียวก็พอ แต่พอรายงาน
// วิเคราะห์ต้องแปลงเลข 1-5 กลับเป็นคำอธิบาย ("4 — แสบจมูก/เวียนหัว") ก็ต้องมีชุดเดียวกันอีกที่
// การก๊อปไปวางคือจุดที่จะเพี้ยนแน่นอนเมื่อมีคนแก้ข้างเดียว จึงยกออกมาไว้ใน lib
//
// ⚠️ ชุดค่าเหล่านี้ถูกบังคับซ้ำอีกชั้นที่ฐานข้อมูล (submit_citizen_complaint_v4 ใน
// supabase/migrations/20260902100000_odor_submit_validation.sql) — แก้ที่นี่ที่เดียวไม่พอ
// ต้องแก้ไมเกรชันด้วยเสมอ ไม่งั้นผู้ใช้เลือกได้แต่ส่งไม่ผ่านโดยไม่มีใครรู้ว่าทำไม
// ส่วนช่วงเวลาที่ได้กลิ่นอยู่ใน odorTimeRanges.js (แยกไว้เพราะมี logic แปลงเวลาพ่วงมาด้วย)

const ODOR_INTENSITY_LEVELS = [
  { value: 1, label: 'ได้กลิ่นจางๆ' },
  { value: 2, label: 'ได้กลิ่นชัดเจน' },
  { value: 3, label: 'รบกวนการใช้ชีวิต' },
  { value: 4, label: 'แสบจมูก/เวียนหัว' },
  { value: 5, label: 'รุนแรงจนนอนไม่หลับ' },
]

// ระดับที่ถือว่า "รุนแรง" สำหรับการจัดลำดับความเร่งด่วนในรายงาน — 4 ขึ้นไปคือเริ่มมีผลต่อร่างกาย
// ไม่ใช่แค่รำคาญ (ดูคำอธิบายของแต่ละระดับด้านบน) ไม่ใช่เกณฑ์ตามกฎหมาย เป็นการจัดกลุ่มเพื่ออ่านง่าย
const ODOR_SEVERE_FROM = 4

const WIND_DIRECTIONS = ['เหนือ', 'ใต้', 'ตะวันออก', 'ตะวันตก', 'ลมสงบ']

const HEALTH_EFFECT_NONE = 'ไม่มีอาการทางกาย'
const HEALTH_EFFECT_OPTIONS = ['เวียนศีรษะ', 'คลื่นไส้', 'ระคายเคืองทางเดินหายใจ', HEALTH_EFFECT_NONE]

function odorIntensityLabel(value) {
  return ODOR_INTENSITY_LEVELS.find((lv) => lv.value === Number(value))?.label ?? null
}

export {
  ODOR_INTENSITY_LEVELS,
  ODOR_SEVERE_FROM,
  WIND_DIRECTIONS,
  HEALTH_EFFECT_NONE,
  HEALTH_EFFECT_OPTIONS,
  odorIntensityLabel,
}

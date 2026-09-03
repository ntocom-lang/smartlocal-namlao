import { useSearchParams } from 'react-router-dom'
import { fiscalYearBounds, recentFiscalYears } from './fiscalYear'

// ตัวกรองปีงบประมาณของหน้ารายงานสาธารณะ (/reports/complaints, /doc-stats)
//
// ทำไมต้องผูกกับ query string ไม่ใช่ useState เฉยๆ: เกณฑ์ ITA แบบวัด OIT ให้ อปท. กรอก URL
// ของหลักฐานลงระบบ ITAS ทีละข้อ ถ้าปีงบเก็บไว้ใน state อย่างเดียว ลิงก์ที่ส่งไปจะเปิดมาเป็น
// ปีงบปัจจุบันเสมอ ผู้ตรวจกดแล้วไม่เห็นปีที่หน่วยงานอ้าง — ต้องส่ง ?fy=2568 ได้
//
// ค่าเริ่มต้นเป็นปีงบปัจจุบัน (ประชาชนทั่วไปเข้ามาดูของปีนี้) ส่วนหลักฐาน ITA ให้ อปท.
// คัดลอกลิงก์ที่มี ?fy= ติดไปด้วย
//
// แยกจาก FiscalYearPicker.jsx เพราะ react-refresh ห้ามไฟล์คอมโพเนนต์ export อย่างอื่นปนมา

export const FY_ALL = 'all'

export function useFiscalYearParam() {
  const [searchParams, setSearchParams] = useSearchParams()
  const options = recentFiscalYears(5)
  const raw = searchParams.get('fy')

  // ค่า fy ที่ไม่รู้จัก (พิมพ์มั่ว/ปีเก่าเกินช่วง) ตกมาที่ปีงบปัจจุบัน ไม่ใช่หน้าพัง
  const value = raw === FY_ALL
    ? FY_ALL
    : (options.includes(Number(raw)) ? Number(raw) : options[0])

  // replace: true — การเปลี่ยนปีงบไม่ควรถมประวัติเบราว์เซอร์ ปุ่ม back ต้องกลับไปหน้าก่อนหน้า
  function setValue(next) {
    const params = new URLSearchParams(searchParams)
    params.set('fy', String(next))
    setSearchParams(params, { replace: true })
  }

  return { value, setValue, options, bounds: value === FY_ALL ? null : fiscalYearBounds(value) }
}

// ป้ายช่วงเวลาแบบอ่านออก ใช้ทั้งบนหน้าจอและตอนสั่งพิมพ์
export function fiscalPeriodLabel(value) {
  if (value === FY_ALL) return 'ทุกปีงบประมาณ (ยอดสะสมทั้งหมด)'
  return `ปีงบประมาณ พ.ศ. ${value} (1 ต.ค. ${value - 1} – 30 ก.ย. ${value})`
}

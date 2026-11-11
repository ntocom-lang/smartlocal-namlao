import { useLocation, useNavigate } from 'react-router-dom'

// แถบ "‹ กลับห้องผู้บริหาร" ตัวใหญ่ ติดบนสุดของหน้าปลายทาง — ขึ้นเฉพาะเมื่อมาจากห้องผู้บริหารแบบเรียบ (location.state.fromExec)
// และหน้าปัจจุบันไม่ใช่ /executive · วางครั้งเดียวที่ AppShell (App.jsx) ครอบทุกหน้าปลายทาง ไม่ต้องแก้ทีละหน้า
// ทำไมต้องมี: นายกสูงอายุกดไปหน้าอื่นแล้วหาทางกลับไม่เจอ (เมนูซ้าย/แถบล่างเป็นไอคอนเล็ก) — แถบนี้บอกทางกลับตรงๆ ตัวใหญ่ชัด
// กด = ย้อนประวัติกลับไปหน้าห้องผู้บริหารพอดี (ไม่เปิดแท็บใหม่) · ถ้าประวัติไม่พอ (เปิดลิงก์ตรง/รีเฟรช) = ไป /executive
// ห้ามทับ state เดิมของหน้าปลายทาง (StaffDashboard อ่าน location.state.module ตอนเปิดหน้า) — แถบนี้อ่านอย่างเดียว ไม่แก้ state
// มือถือ: ติดบนสุดของพื้นที่เลื่อน · จอกว้าง (md ขึ้นไป) หัวหน้าเจ้าหน้าที่ปักติดบนอยู่แล้ว แถบนี้อยู่ส่วนบนสุดของเนื้อหา ไม่ปักซ้อนทับหัวนั้น

export default function ExecBackBar() {
  const location = useLocation()
  const navigate = useNavigate()
  if (location.state?.fromExec !== true || location.pathname.startsWith('/executive')) return null

  const goBack = () => {
    // execReturnIdx = ตำแหน่งในประวัติของหน้า /executive ตอนออกมา · idx ปัจจุบัน − ตำแหน่งนั้น = ต้องย้อนกี่ก้าวถึงจะถึงห้องผู้บริหาร
    const here = window.history.state?.idx
    const back = Number(location.state?.execReturnIdx)
    const steps = Number.isFinite(here) && Number.isFinite(back) ? here - back : 0
    if (steps > 0) navigate(-steps)
    else navigate('/executive')
  }

  return (
    <div role="navigation" aria-label="กลับห้องผู้บริหาร" data-exec-backbar
      className="sticky top-0 z-40 border-b-2 border-blue-200 bg-white px-3 py-2.5 md:static md:px-6">
      <button type="button" onClick={goBack}
        className="flex min-h-[54px] w-full items-center justify-start gap-2 rounded-2xl border-2 border-blue-300 bg-white px-4 text-left text-[21px] font-bold leading-snug text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 active:bg-blue-50 sm:w-auto sm:min-w-[300px]">
        <span aria-hidden="true" className="text-[26px] leading-none">‹</span> กลับห้องผู้บริหาร
      </button>
    </div>
  )
}

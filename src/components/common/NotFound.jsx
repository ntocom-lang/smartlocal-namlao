import { Link, useLocation } from 'react-router-dom'
import { Compass, ArrowLeft } from 'lucide-react'

// หน้าสำหรับ path ที่ไม่ตรงกับ route ไหนเลย
//
// เดิมไม่มี <Route path="*"> ทำให้ <Routes> ไม่ render อะไรเลย ผู้ใช้เห็นแค่หัวเว็บ
// กับ BottomNav คั่นพื้นที่ว่างขาวๆ ตรงกลาง แยกไม่ออกว่าเว็บพังหรือเน็ตหลุด
// เคสที่เจอจริง: ปุ่ม "สั่งซื้อเลย" ของร้านค้าที่เก็บเบอร์โทรไว้ในช่องลิงก์ เบราว์เซอร์
// ตีค่านั้นเป็น relative path แล้วพาไป /tourism/0983819257 (แก้ที่ต้นเหตุแล้วใน
// resolveServiceUrl ของ src/lib/tourismPlaces.js — หน้านี้คือตาข่ายรับชั้นสุดท้าย)
//
// ลิงก์เก่าที่ประชาชน bookmark ไว้ ผลค้นหาจาก Google และลิงก์ในไลน์กลุ่มก็ลงที่นี่
// เหมือนกันเมื่อ route ถูกเปลี่ยนชื่อ จึงต้องบอกทางกลับ ไม่ใช่ปล่อยให้จอว่าง
export default function NotFound() {
  const { pathname } = useLocation()

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm text-center">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <Compass size={28} className="text-gray-400" strokeWidth={1.75} />
        </div>
        <h1 className="text-base font-bold text-gray-700">ไม่พบหน้าที่ต้องการ</h1>
        <p className="text-sm text-gray-500 mt-2 leading-relaxed">
          ลิงก์อาจพิมพ์ผิด ถูกย้าย หรือไม่มีอยู่แล้ว
          ลองกลับไปเริ่มจากหน้าแรกอีกครั้ง
        </p>
        <p className="text-xs text-gray-400 mt-3 break-all font-mono">{pathname}</p>
        <Link to="/"
          className="mt-6 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <ArrowLeft size={15} /> กลับหน้าแรก
        </Link>
      </div>
    </div>
  )
}

import { CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react'
import { describeServiceUrl } from '../../lib/tourismPlaces'

// บอกล่วงหน้าว่าค่าที่กรอกในช่อง online_url จะกลายเป็นปุ่มที่พาไปไหน
//
// ช่องนั้นเขียนว่า "ลิงก์ / Line ID / URL" คนกรอกจึงใส่ได้ทุกแบบและไม่มีทางรู้ว่าระบบ
// ตีความอย่างไร จนกว่าจะมีคนกดปุ่มแล้วเจอปัญหา — ของจริงที่เคยหลุดขึ้นเว็บคือเบอร์โทร
// "0983819257" กับ Line ID "ld.0876084038" ที่กดแล้วได้หน้าเปล่าอยู่หลายเดือน
//
// ⚠️ จงใจไม่บล็อกการบันทึกเมื่ออ่านค่าไม่ออก เพราะถ้ากติกาการแปลงพลาดเคสไหน เจ้าหน้าที่
// จะบันทึกร้านไม่ได้เลยและไม่รู้สาเหตุ ซึ่งแย่กว่าปุ่มเสียหนึ่งปุ่ม (ดู describeServiceUrl)
const KIND_TEXT = {
  phone: 'เปิดหน้าโทรออกให้ทันที',
  line:  'เปิดแชท LINE ของร้าน',
  web:   'เปิดเว็บไซต์ในแท็บใหม่',
}

export default function ServiceUrlHint({ value }) {
  const info = describeServiceUrl(value)
  if (info.status === 'empty') return null

  if (info.status === 'blocked') {
    return (
      <p className="flex items-start gap-1.5 text-xs font-semibold text-red-600 leading-relaxed">
        <ShieldAlert size={13} className="shrink-0 mt-0.5" />
        <span>ค่านี้ใช้ไม่ได้ด้วยเหตุผลด้านความปลอดภัย กรุณาใส่ลิงก์เว็บไซต์ เบอร์โทร หรือ Line ID</span>
      </p>
    )
  }

  if (info.status === 'unknown') {
    return (
      <p className="flex items-start gap-1.5 text-xs text-amber-700 leading-relaxed">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        <span>
          ระบบอ่านค่านี้ไม่ออก ปุ่มบนเว็บจะใช้เบอร์โทรของร้านแทน (ถ้ากรอกไว้)
          บันทึกได้ตามปกติ แต่แนะนำให้ใส่ลิงก์เต็ม เบอร์โทร หรือ Line ID
        </span>
      </p>
    )
  }

  return (
    <p className="flex items-start gap-1.5 text-xs text-green-700 leading-relaxed">
      <CheckCircle2 size={13} className="shrink-0 mt-0.5" />
      <span>
        ปุ่มจะ{KIND_TEXT[info.kind]}
        <span className="block font-mono text-[11px] text-gray-500 break-all mt-0.5">{info.href}</span>
      </span>
    </p>
  )
}

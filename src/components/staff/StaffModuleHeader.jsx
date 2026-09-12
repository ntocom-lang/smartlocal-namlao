// หัวเรื่องของหน้าโมดูลในระบบเจ้าหน้าที่ — ตัวเดียวใช้ทุกโมดูล
//
// เดิมมีแค่หน้าคำร้องหน้าเดียวที่มีหัวเรื่อง (เขียน inline ไว้ใน StaffDashboard) ที่เหลือเปิดมา
// เจอแถบแท็บหรือตารางทันที เจ้าหน้าที่กดจากเมนูซ้ายแล้วไม่มีอะไรยืนยันว่ามาถูกหน้า ยิ่งบนมือถือ
// ที่ไม่มีเมนูซ้ายให้ดูว่าปุ่มไหนถูกไฮไลต์อยู่
//
// ชื่อกับไอคอนดึงจากลิสต์ MODULES ใน StaffDashboard.jsx ซึ่งเป็นตัวเดียวกับที่วาดเมนูซ้าย
// หัวเรื่องจึงตรงกับปุ่มที่กดมาเสมอโดยอัตโนมัติ ไม่ต้องไล่แก้ 2 ที่เวลาเปลี่ยนชื่อเมนู
export default function StaffModuleHeader({ Icon, label, desc, color }) {
  if (!label) return null

  return (
    <header className="flex items-center gap-3 px-1">
      {Icon && (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-md"
          style={{ backgroundColor: color ?? '#475569', boxShadow: `0 4px 14px ${color ?? '#475569'}33` }}>
          <Icon size={21} strokeWidth={2.2} />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.12em]" style={{ color: color ?? '#475569' }}>
          ระบบเจ้าหน้าที่
        </p>
        {/* ไม่ใช้ truncate — ชื่อยาวอย่าง "เที่ยว กิน พัก ชอป บริการ" ต้องขึ้นบรรทัดใหม่บนมือถือ
            ไม่ใช่ถูกตัดหาย ซึ่งทำให้อ่านไม่ออกว่าอยู่หน้าไหนพอดี */}
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900 leading-tight">{label}</h1>
        {desc && <p className="text-[11px] text-slate-500 mt-0.5">{desc}</p>}
      </div>
    </header>
  )
}

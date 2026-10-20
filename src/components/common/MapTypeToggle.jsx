// แถบสลับมุมมองแผนที่ [ดาวเทียม | แผนที่ถนน] — ใช้ร่วมทุกแผนที่ที่ใช้ LeafletMapCanvas
// ผู้ใช้งานถือ state เอง แล้วส่งค่าไปที่ prop mapTypeId ของ LeafletMapCanvas ('hybrid' | 'roadmap')
// ตัวแถบไม่กำหนดตำแหน่ง — ผู้เรียกใส่ className (absolute left-3 top-3 ฯลฯ) ให้เหมาะกับมุมที่ว่างของแผนที่ตัวเอง
//
// ทำไมต้องมี: ภาพดาวเทียมเห็นหลังคาบ้านแต่ไม่มีชื่อถนน/ซอย ส่วนแผนที่ถนนมีชื่อถนนที่ดาวเทียมไม่มี
// (แต่ข้อมูลถนนของ OpenStreetMap ในชนบทยังบาง จึงช่วยในตัวตำบลและถนนสายหลักมากกว่าซอยย่อย)
// วางเป็น 2 ปุ่มติดกันแทน dropdown เพราะมีแค่ 2 ตัวเลือก กดครั้งเดียวจบ ไม่ต้องเปิดเมนู
const OPTIONS = [['hybrid', 'ดาวเทียม'], ['roadmap', 'แผนที่ถนน']]

export default function MapTypeToggle({ value, onChange, className = '' }) {
  return (
    <div
      role="group"
      aria-label="มุมมองแผนที่"
      className={`flex overflow-hidden rounded-xl border border-gray-200 bg-white/95 text-xs font-bold shadow-lg backdrop-blur ${className}`}
    >
      {OPTIONS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={`px-3 py-2 transition-colors ${value === id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

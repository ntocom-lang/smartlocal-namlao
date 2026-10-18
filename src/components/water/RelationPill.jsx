// ป้ายความสัมพันธ์ของอ่าง/สถานีกับตำบล (ดีไซน์ฉบับปิด D4) — ใช้ทั้งบนการ์ดอ่าง/สถานีระดับน้ำเดิมและในส่วน "ระบบน้ำของตำบล"
// ข้อความมาจาก RELATIONS ที่เดียว (src/lib/waterSystem/model.js) · สีเป็นแค่การจัดกลุ่ม ไม่ใช่สีสถานการณ์
const TONES = {
  up: 'border-sky-300 bg-sky-50 text-sky-800',
  in: 'border-indigo-300 bg-indigo-50 text-indigo-800',
  down: 'border-teal-300 bg-teal-50 text-teal-800',
  side: 'border-gray-300 bg-gray-100 text-gray-700',
  unk: 'border-amber-300 bg-amber-50 text-amber-900',
}

export default function RelationPill({ relation }) {
  if (!relation) return null
  return (
    <span data-relation={relation.key}
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 align-middle text-[11px] font-bold ${TONES[relation.tone] ?? TONES.unk}`}>
      {relation.label}
    </span>
  )
}

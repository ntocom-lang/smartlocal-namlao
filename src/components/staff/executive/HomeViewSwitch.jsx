// สวิตช์สองปุ่มบนหัวหน้าแรก: "ห้องผู้บริหาร | งานของฉัน" — ผู้บริหารเปิดงานประจำตัว (คำร้องที่ถือ ใบรอรับเรื่อง) ได้ทันที
// และแอดมินเปิดห้องผู้บริหารดูได้ · ทั้งสองหน้าใช้สิทธิ์ข้อมูลของบัญชีเดิม สวิตช์ไม่ได้ให้สิทธิ์เพิ่ม
const OPTIONS = [
  { value: 'executive', label: 'ห้องผู้บริหาร' },
  { value: 'mine', label: 'งานของฉัน' },
]

export default function HomeViewSwitch({ view, onChange }) {
  return (
    <div role="group" aria-label="เลือกหน้าแรก" data-home-view-switch className="flex justify-end">
      <div className="inline-flex rounded-full border border-slate-200 bg-white p-0.5 shadow-sm">
        {OPTIONS.map((o) => (
          <button key={o.value} type="button" aria-pressed={view === o.value} data-home-view={o.value} onClick={() => onChange(o.value)}
            className={`min-h-9 rounded-full px-4 text-xs font-bold active:scale-95 ${view === o.value ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

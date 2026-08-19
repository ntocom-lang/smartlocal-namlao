// Empty-state block ใช้ร่วมกันทุกหน้าในระบบยานพาหนะ — แทนที่ตัวหนังสือสีเทาเปล่าๆ
// ด้วย icon + หัวข้อ + คำแนะนำ (hint) ให้ดูมีการออกแบบและชี้ทางผู้ใช้ต่อ
export default function FleetEmptyState({ icon: Icon, title, hint, compact = false, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 px-4 text-center ${compact ? 'py-6' : 'py-10 md:py-12'} ${className}`}>
      <div className="w-11 h-11 rounded-2xl bg-gray-50 flex items-center justify-center">
        <Icon size={20} className="text-gray-300" />
      </div>
      <p className="text-sm font-semibold text-gray-400">{title}</p>
      {hint && <p className="text-xs text-gray-400 max-w-65 leading-relaxed">{hint}</p>}
    </div>
  )
}

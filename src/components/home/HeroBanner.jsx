import { useTenant } from '../../contexts/TenantContext'
import { ArrowRight } from 'lucide-react'
import oneStopHeader from '../../assets/one-stop-header.png'

export default function HeroBanner() {
  const { tenant, terminology } = useTenant()

  return (
    <div className="rounded-2xl overflow-hidden shadow-md"
         style={{ background: `linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)` }}>
      {/* รูป One Stop Service เต็มความกว้าง */}
      <img src={oneStopHeader} alt="One Stop Service"
           className="w-full object-cover max-h-64 md:max-h-80" />

      {/* ข้อความ + CTA ด้านล่าง */}
      <div className="flex flex-col md:flex-row items-center gap-4 px-6 py-5 md:px-10">
        <div className="flex-1 text-white">
          <h2 className="text-xl md:text-2xl font-bold leading-snug mb-1">
            สะดวก รวดเร็ว ตลอด 24 ชั่วโมง
          </h2>
          <p className="text-white/80 text-sm leading-relaxed">
            ยื่นคำร้อง ติดตามสถานะ และรับบริการจาก{tenant?.name}
            ได้ทุกที่ทุกเวลา ไม่ต้องเดินทางมาที่สำนักงาน
          </p>
        </div>
        <a href="/complaint"
           className="shrink-0 inline-flex items-center gap-2 bg-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow hover:shadow-md transition-shadow"
           style={{ color: 'var(--color-primary)' }}>
          ยื่นคำร้องเลย <ArrowRight size={16} />
        </a>
      </div>
    </div>
  )
}

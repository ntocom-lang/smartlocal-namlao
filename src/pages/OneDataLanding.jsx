import { useNavigate } from 'react-router-dom'
import { MapPin, Droplets, Leaf, Store, ArrowRight } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'

const FORMS = [
  {
    id:    'infrastructure',
    icon:  '🔧',
    color: '#ef4444',
    bg:    'from-red-500 to-red-700',
    label: 'ยื่นคำร้อง',
    sub:   'ตลอด 24 ชั่วโมง',
    desc:  'ไฟกิ่งดับ · ถนนเป็นหลุม · ท่อระบายน้ำอุดตัน · ลำเหมืองตื้นเขิน',
    badge: 'GPS บังคับ',
    route: '/request?form=infrastructure',
  },
  {
    id:    'water_support',
    icon:  '💧',
    color: '#3b82f6',
    bg:    'from-blue-500 to-blue-700',
    label: 'ขอสนับสนุนน้ำอุปโภค',
    sub:   'ภัยแล้ง / ภัยพิบัติ',
    desc:  'ปักหมุดถังน้ำกลางหมู่บ้านที่น้ำหมด เพื่อจัดรถบรรทุกน้ำออกแจกจ่าย',
    badge: 'GPS บังคับ',
    route: '/request?form=water_support',
  },
  {
    id:    'environment',
    icon:  '🌿',
    color: '#10b981',
    bg:    'from-emerald-500 to-emerald-700',
    label: 'แจ้งเหตุสิ่งแวดล้อม / จุดเสี่ยงภัย',
    sub:   'Smart Environment',
    desc:  'ขยะตกค้าง · กิ่งไม้หักโค่น · จุดเสี่ยงมั่วสุม · ควันไฟป่า',
    badge: 'GPS บังคับ',
    route: '/request?form=environment',
  },
  {
    id:    'business',
    icon:  '🏪',
    color: '#f59e0b',
    bg:    'from-amber-400 to-amber-600',
    label: 'ลงทะเบียนร้านค้า / ท่องเที่ยว',
    sub:   'เที่ยว กิน พัก ชอบ',
    desc:  'OTOP · ร้านอาหาร · โฮมสเตย์ · สถานที่ท่องเที่ยวใหม่ในชุมชน',
    badge: 'รอการอนุมัติ',
    route: '/business-register',
  },
]

export default function OneDataLanding() {
  const navigate = useNavigate()
  const { tenant } = useTenant()

  return (
    <div className="max-w-4xl mx-auto px-4 pb-28 md:pb-8">

      {/* PC header */}
      <div className="hidden md:block pt-8 pb-6 border-b border-gray-100 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">{tenant?.system_name || `${tenant?.name} One Data`}</h1>
        <p className="text-sm text-gray-500 mt-1">เลือกประเภทข้อมูลที่ต้องการส่ง — ทุกฟอร์มใช้พิกัด GPS จุดที่เกิดเหตุจริง</p>
      </div>

      {/* Mobile header */}
      <div className="md:hidden pt-4 pb-3">
        <h1 className="text-lg font-bold text-gray-800">{tenant?.system_name || `${tenant?.name} One Data`}</h1>
        <p className="text-xs text-gray-500 mt-0.5">เลือกประเภทที่ต้องการส่งข้อมูล</p>
      </div>

      {/* GPS badge info */}
      <div className="flex items-center gap-2 mb-5 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
        <MapPin size={15} className="text-blue-500 shrink-0" />
        <p className="text-xs text-blue-700 leading-snug">
          ทุกคำร้องต้องระบุพิกัด GPS หน้างาน เพื่อให้เจ้าหน้าที่ออกไปตรงจุดได้ทันที
        </p>
      </div>

      {/* 4 Form cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {FORMS.map((f) => (
          <button
            key={f.id}
            onClick={() => navigate(f.route)}
            className="group text-left rounded-2xl overflow-hidden shadow-md border border-gray-100 bg-white hover:shadow-lg active:scale-[0.98] transition-all"
          >
            {/* Gradient header */}
            <div className={`bg-gradient-to-r ${f.bg} px-5 py-4 flex items-center gap-3`}>
              <span className="text-3xl">{f.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-base leading-tight">{f.label}</p>
                <p className="text-white/75 text-xs mt-0.5">{f.sub}</p>
              </div>
              <ArrowRight size={18} className="text-white/60 group-hover:text-white transition-colors shrink-0" />
            </div>

            {/* Body */}
            <div className="px-5 py-4 flex items-end justify-between gap-3">
              <p className="text-sm text-gray-500 leading-relaxed flex-1">{f.desc}</p>
              <span className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: f.color + '18', color: f.color }}>
                {f.badge}
              </span>
            </div>
          </button>
        ))}
      </div>

    </div>
  )
}

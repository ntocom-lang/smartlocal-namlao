import { FileText, Search, Bell, BookOpen } from 'lucide-react'

const SERVICES = [
  {
    label: 'ยื่นคำร้องใหม่',
    sub: 'แจ้งเรื่องร้องเรียน ขอใช้บริการ',
    icon: FileText,
    href: '/request',
    color: '#1c7cd6',
    bg: '#e0f0ff',
    primary: true,
  },
  {
    label: 'ตรวจสอบสถานะ',
    sub: 'ติดตามความคืบหน้าคำร้อง',
    icon: Search,
    href: '/status',
    color: '#16a34a',
    bg: '#dcfce7',
  },
  {
    label: 'รับการแจ้งเตือน',
    sub: 'ลงทะเบียนรับข่าวสาร',
    icon: Bell,
    href: '/notify',
    color: '#d97706',
    bg: '#fef3c7',
  },
  {
    label: 'คู่มือการใช้งาน',
    sub: 'วิธียื่นคำร้องออนไลน์',
    icon: BookOpen,
    href: '/guide',
    color: '#7c3aed',
    bg: '#ede9fe',
  },
]

export default function ServiceButtons() {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-6 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />
        <h2 className="text-base font-bold text-gray-700 dark:text-slate-200">บริการออนไลน์ (E-Service)</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {SERVICES.map(({ label, sub, icon: Icon, href, color, bg, primary }) => (
          <a key={href} href={href}
             className={`group flex flex-col items-center text-center gap-3 p-5 rounded-2xl border transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${
               primary
                 ? 'text-white border-transparent shadow-md'
                 : 'bg-white border-gray-100 text-gray-700 hover:border-transparent dark:bg-white/10 dark:border-white/10 dark:text-white'
             }`}
             style={primary
               ? { background: `linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)` }
               : {}}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110"
                 style={{ backgroundColor: primary ? 'rgba(255,255,255,0.2)' : bg }}>
              <Icon size={28} style={{ color: primary ? '#fff' : color }} />
            </div>
            <div>
              <p className={`font-semibold text-sm ${primary ? 'text-white' : 'text-gray-800 dark:text-white'}`}>{label}</p>
              <p className={`text-xs mt-0.5 ${primary ? 'text-white/75' : 'text-gray-400 dark:text-white/60'}`}>{sub}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}

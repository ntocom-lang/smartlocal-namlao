import { ClipboardList, CheckCircle2, Inbox, Loader2 } from 'lucide-react'

const STATS = [
  { label: 'คำร้องทั้งหมด',        icon: ClipboardList, key: 'total',      color: '#1c7cd6', bg: '#e0f0ff' },
  { label: 'ดำเนินการเสร็จแล้ว',   icon: CheckCircle2,  key: 'completed',  color: '#16a34a', bg: '#dcfce7' },
  { label: 'รับเรื่องแล้ว',         icon: Inbox,         key: 'received',   color: '#d97706', bg: '#fef3c7' },
  { label: 'อยู่ระหว่างดำเนินการ', icon: Loader2,       key: 'inProgress', color: '#7c3aed', bg: '#ede9fe' },
]

export default function StatCards({ stats = {} }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {STATS.map(({ label, icon: Icon, key, color, bg }) => (
        <div key={key}
             className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow p-4 flex items-center gap-3 border border-gray-100 dark:bg-white/10 dark:border-white/10 dark:shadow-none dark:hover:shadow-none">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
               style={{ backgroundColor: bg }}>
            <Icon size={24} style={{ color }} />
          </div>
          <div>
            <p className="text-3xl font-bold leading-none" style={{ color }}>
              {stats[key] ?? 0}
            </p>
            <p className="text-xs text-gray-500 mt-1 leading-tight dark:text-slate-400">{label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

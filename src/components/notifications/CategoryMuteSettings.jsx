import { NOTIFICATION_CATEGORIES } from '../../lib/notificationFeed'

// เด้งเตือนรายหมวด — ปิดหมวดไหน ยังเห็นในกระดิ่ง แต่ไม่มีป๊อปอัป/เสียง/สั่น (ไม่กระทบแจ้งเตือนนอกเว็บ)
// โชว์เฉพาะหมวดที่ฐานข้อมูลบอกว่าบัญชีนี้ได้รับจริง (my_notification_feed) ไม่โชว์ทุกโมดูลแบบระบบอ้างอิง
export default function CategoryMuteSettings({ categories, muted, onChange }) {
  const shown = NOTIFICATION_CATEGORIES.filter((category) => categories.includes(category.key))
  // มีหมวดเดียว (เช่น ประชาชนมีแค่คำร้อง) ใช้สวิตช์ป๊อปอัป/เสียงด้านบนได้เลย ไม่ต้องมีชุดซ้ำ
  if (shown.length < 2) return null
  return (
    <div className="mt-4 border-t border-slate-100 pt-3" data-category-mute>
      <p className="text-sm font-semibold text-slate-800">เด้งเตือนรายหมวด</p>
      <p className="text-xs leading-5 text-slate-500">ปิดหมวดไหน ยังเห็นในกระดิ่ง แต่ไม่เด้ง ไม่มีเสียง ไม่สั่น</p>
      <div className="mt-1">
        {shown.map((category) => {
          const on = !muted.includes(category.key)
          return (
            <button key={category.key} type="button" role="switch" aria-checked={on} data-category-mute-key={category.key}
              onClick={() => onChange(on ? [...muted, category.key] : muted.filter((key) => key !== category.key))}
              className="flex min-h-11 w-full items-center gap-3 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
              <span className="min-w-0 flex-1 text-sm text-slate-700">{category.label}</span>
              <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-teal-700' : 'bg-slate-300'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

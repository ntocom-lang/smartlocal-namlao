import { LayoutGrid } from 'lucide-react'

// แถบล่างมือถือของระบบเจ้าหน้าที่ — ใช้ร่วม /staff กับห้องผู้บริหาร (/executive) · ข้อมูลทางลัดมาจาก staffBottomTabs()
// ปุ่มสุดท้ายคือ "เมนู" เสมอ (กริดไอคอนของทุกโมดูล) ไฮไลต์เมื่ออยู่โมดูลที่ไม่มีปุ่มของตัวเองบนแถบ
// badges = { <key>: จำนวน } — ห้องผู้บริหารไม่ส่ง (การ์ดหน้ารวมแสดงตัวเลขจาก RPC เท่านั้น ไม่เพิ่ม query ใหม่)
export default function StaffBottomNav({ tabs, activeKey, menuActive = false, menuBadge = 0, badges = {}, onSelect, onMenu }) {
  return (
    <nav data-staff-bottom-nav aria-label="เมนูล่าง" className="md:hidden fixed bottom-0 left-0 right-0 z-20 flex items-stretch"
      style={{
        background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
        borderTop: '2px solid rgba(255,255,255,0.15)',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
        borderTopLeftRadius: '20px',
        borderTopRightRadius: '20px',
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)',
      }}>
      {tabs.map(({ key, label, Icon }) => {
        const isActive = activeKey === key
        const badge = badges[key] > 0 ? badges[key] : null
        return (
          <button key={key} type="button" data-bottom-tab={key} aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(key)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 transition-all active:scale-90">
            <div className="relative w-10 h-9 rounded-xl flex items-center justify-center transition-all duration-200"
              style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : 'transparent' }}>
              {isActive && (
                <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-white" />
              )}
              <Icon size={20} strokeWidth={isActive ? 2.2 : 1.6}
                style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.45)' }} />
              {badge && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full text-[9px] font-bold text-amber-900 flex items-center justify-center px-1 bg-amber-400">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </div>
            <span className="text-[10px] font-bold leading-tight"
              style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.45)' }}>{label}</span>
          </button>
        )
      })}
      {/* เมนู — ปุ่มสุดท้ายเสมอ (แทนปุ่ม "รายงาน" เดิม: รายงานไปอยู่ในกริดเมนูกับทางลัดบนแดชบอร์ดแล้ว
          ทำให้แถบล่างยังมี 5 ปุ่มเท่าเดิม ไม่แคบลง) · ตัวเลขรวมงานค้างของโมดูลที่ไม่มีปุ่มบนแถบ (เช่น รถรับ-ส่งผู้ป่วย) */}
      <button type="button" data-bottom-tab="menu" onClick={onMenu} aria-label={menuBadge > 0 ? `เมนู ${menuBadge} รายการรอ` : 'เมนู'}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 transition-all active:scale-90">
        <div className="relative w-10 h-9 rounded-xl flex items-center justify-center transition-all duration-200"
          style={{ backgroundColor: menuActive ? 'rgba(255,255,255,0.2)' : 'transparent' }}>
          {menuActive && (
            <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-white" />
          )}
          <LayoutGrid size={20} strokeWidth={menuActive ? 2.2 : 1.6}
            style={{ color: menuActive ? '#fff' : 'rgba(255,255,255,0.45)' }} />
          {menuBadge > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full text-[9px] font-bold text-amber-900 flex items-center justify-center px-1 bg-amber-400">
              {menuBadge > 9 ? '9+' : menuBadge}
            </span>
          )}
        </div>
        <span className="text-[10px] font-bold leading-tight"
          style={{ color: menuActive ? '#fff' : 'rgba(255,255,255,0.45)' }}>เมนู</span>
      </button>
    </nav>
  )
}

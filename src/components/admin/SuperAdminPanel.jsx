import { useState } from 'react'
import { ShieldCheck, Palette, LayoutGrid, Briefcase } from 'lucide-react'
import ThemeSettingsAdmin from './ThemeSettingsAdmin'
import ModuleManager from './ModuleManager'
import PositionCatalogAdmin from './PositionCatalogAdmin'

// เพิ่มแท็บใหม่ในอนาคต: เพิ่ม entry ตรงนี้ + เขียน component ใหม่ ไม่ต้องแก้โครงสร้าง SuperAdminPanel เลย
const SUPERADMIN_TABS = [
  { key: 'theme',   label: 'ธีมแอป',        icon: Palette,    Component: ThemeSettingsAdmin },
  { key: 'modules', label: 'จัดการโมดูล',   icon: LayoutGrid, Component: ModuleManager },
  // ย้ายมาจากเมนู "ทำเนียบตำแหน่ง" ฝั่งเจ้าหน้าที่ที่ถอดออก 2026-08-31 — positions เป็นตารางกลาง
  // ไม่มี municipality_id แก้ทีเดียวกระทบทุก อปท. จึงเป็นงานของ superadmin ไม่ใช่ของแต่ละหน่วยงาน
  { key: 'positions', label: 'แบบตำแหน่ง',  icon: Briefcase,  Component: PositionCatalogAdmin },
]

export default function SuperAdminPanel({ tenant }) {
  const [activeTab, setActiveTab] = useState('theme')
  const ActiveComponent = SUPERADMIN_TABS.find(t => t.key === activeTab)?.Component ?? ThemeSettingsAdmin

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
             style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}>
          <ShieldCheck size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">จัดการโมดูล</h1>
          <p className="text-sm text-gray-500">ตั้งค่าธีมและโมดูลสำหรับ Super Admin</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-2 flex gap-1 overflow-x-auto">
        {SUPERADMIN_TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      <ActiveComponent tenant={tenant} />
    </div>
  )
}

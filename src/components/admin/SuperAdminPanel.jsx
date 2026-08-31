import { useState } from 'react'
import { ShieldCheck, Palette, LayoutGrid } from 'lucide-react'
import ThemeSettingsAdmin from './ThemeSettingsAdmin'
import ModuleManager from './ModuleManager'

// เพิ่มแท็บใหม่ในอนาคต: เพิ่ม entry ตรงนี้ + เขียน component ใหม่ ไม่ต้องแก้โครงสร้าง SuperAdminPanel เลย
const SUPERADMIN_TABS = [
  { key: 'theme',   label: 'ธีมแอป',        icon: Palette,    Component: ThemeSettingsAdmin },
  { key: 'modules', label: 'จัดการโมดูล',   icon: LayoutGrid, Component: ModuleManager },
  // ไม่มีแท็บ "แบบตำแหน่ง" ที่นี่โดยตั้งใจ — ตั้งแต่ 20260831140000_positions_per_municipality.sql
  // positions เป็นของแต่ละ อปท. แล้ว แอดมินหน่วยงานจัดการเองที่ จัดการผู้ใช้และการแต่งตั้ง → แบบตำแหน่ง
  // (superadmin เข้าหน้าเดียวกันนั้นแล้วเห็น/แก้ได้ทุกแถวจาก RLS อยู่แล้ว ไม่ต้องมีของ 2 ที่)
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

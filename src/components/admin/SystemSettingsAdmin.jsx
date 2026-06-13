import { useState, useEffect } from 'react'
import { Settings, Save, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const inputCls = 'w-full px-4 py-2.5 text-sm text-gray-900 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all'

export default function SystemSettingsAdmin({ tenant, onUpdateTenant }) {
  const [formData, setFormData] = useState({ system_name: tenant.system_name || 'One Data' })
  const [loading, setLoading] = useState(false)
  const [savedSection, setSavedSection] = useState(null)

  useEffect(() => {
    if (tenant) {
      setFormData({ system_name: tenant.system_name || 'One Data' })
    }
  }, [tenant])

  async function saveSystemName(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const { error } = await supabase
        .from('municipalities')
        .update({ system_name: formData.system_name.trim() || 'One Data' })
        .eq('id', tenant.id)
      if (error) throw error
      onUpdateTenant?.({ ...tenant, system_name: formData.system_name.trim() || 'One Data' })
      setSavedSection('name')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
             style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}>
          <Settings size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">ตั้งค่าระบบ</h1>
          <p className="text-sm text-gray-500">จัดการข้อมูลพื้นฐานและบริการออนไลน์</p>
        </div>
      </div>

      {/* ── ชื่อระบบ ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
          <Settings size={15} /> ชื่อย่อระบบ
        </h2>
        <form onSubmit={saveSystemName} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">System Name</label>
            <p className="text-xs text-gray-400 mb-2 leading-relaxed">
              แสดงผลเป็น "{formData.system_name || `${tenant?.name || ''} One Data`}"
            </p>
            <input
              type="text"
              value={formData.system_name}
              onChange={e => setFormData({ ...formData, system_name: e.target.value })}
              placeholder={`เช่น ${tenant?.name || 'เทศบาลตำบลน้ำเลา'} One Data`}
              className={inputCls}
              required
            />
          </div>
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : savedSection === 'name' ? <CheckCircle2 size={15} /> : <Save size={15} />}
            {savedSection === 'name' ? 'บันทึกสำเร็จ' : 'บันทึก'}
          </button>
        </form>
      </div>

    </div>
  )
}

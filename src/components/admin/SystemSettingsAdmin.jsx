import { useState, useEffect } from 'react'
import { Settings, Save, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function SystemSettingsAdmin({ tenant, onUpdateTenant }) {
  const [formData, setFormData] = useState({
    system_name: tenant.system_name || 'One Data'
  })
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  // Reset if tenant changes
  useEffect(() => {
    if (tenant) {
      setFormData({
        system_name: tenant.system_name || 'One Data'
      })
    }
  }, [tenant])

  async function handleSave(e) {
    e.preventDefault()
    setLoading(true)
    setSaved(false)
    
    try {
      const { error } = await supabase
        .from('municipalities')
        .update({ system_name: formData.system_name.trim() || 'One Data' })
        .eq('id', tenant.id)

      if (error) throw error

      setSaved(true)
      // Call parent to update context or just reload
      if (onUpdateTenant) {
        onUpdateTenant({ ...tenant, system_name: formData.system_name.trim() || 'One Data' })
      }
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
             style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}>
          <Settings size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">ตั้งค่าระบบ</h1>
          <p className="text-sm text-gray-500">จัดการข้อมูลพื้นฐานของระบบ</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
        <form onSubmit={handleSave} className="space-y-6 max-w-xl">
          
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              ชื่อย่อระบบ (System Name)
            </label>
            <p className="text-xs text-gray-500 mb-3 leading-relaxed">
              ชื่อเต็มของระบบ เช่น "เทศบาลตำบลน้ำเลา One Data" <br/>
              (จะแสดงผลตามที่คุณกรอกทั้งหมด เช่น "{formData.system_name || `${tenant?.name || ''} One Data`}")
            </p>
            <input
              type="text"
              value={formData.system_name}
              onChange={(e) => setFormData({ ...formData, system_name: e.target.value })}
              placeholder={`เช่น ${tenant?.name || 'เทศบาลตำบลน้ำเลา'} One Data`}
              className="w-full px-4 py-2.5 text-sm text-gray-900 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}
              required
            />
          </div>

          <div className="pt-4 border-t border-gray-100">
            <button
              type="submit"
              disabled={loading}
              className="flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> กำลังบันทึก...</>
              ) : saved ? (
                <><CheckCircle2 size={16} /> บันทึกสำเร็จ</>
              ) : (
                <><Save size={16} /> บันทึกการตั้งค่า</>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}

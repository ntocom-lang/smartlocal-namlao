import { useState, useEffect } from 'react'
import { Loader2, Plus, MapPinned } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ไอคอน/สี ต่อกลุ่มหลัก — เป็นแค่ค่า default ถ้าเจอกลุ่มใหม่ที่ไม่อยู่ในนี้จะใช้ค่า fallback
// ไม่ได้จำกัดว่าต้องมีแค่กลุ่มเหล่านี้ — เพิ่มกลุ่มใหม่ได้อิสระผ่านฟอร์ม
const GROUP_META = {
  'สาธารณสุข':        { emoji: '⛑️', color: '#dc2626', bg: '#fef2f2' },
  'สถานที่สำคัญ':      { emoji: '📍', color: '#059669', bg: '#f0fdf4' },
  'สถานประกอบการ':     { emoji: '🏢', color: '#d97706', bg: '#fffbeb' },
  'การจัดการขยะ':      { emoji: '🗑️', color: '#7c3aed', bg: '#f5f3ff' },
  'สถานศึกษา':         { emoji: '🏫', color: '#2563eb', bg: '#eff6ff' },
  'โครงสร้างพื้นฐาน':   { emoji: '🏗️', color: '#0891b2', bg: '#ecfeff' },
  'สถานที่หลบภัย':     { emoji: '⛺', color: '#b91c1c', bg: '#fef2f2' },
  'พื้นที่สีเขียว':     { emoji: '🌳', color: '#16a34a', bg: '#f0fdf4' },
}
const FALLBACK_META = { emoji: '📌', color: '#475569', bg: '#f1f5f9' }
const groupMeta = g => GROUP_META[g] ?? FALLBACK_META

export default function DataCenterOverview({ tenant, onAddNew }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('data_center_entries').select('id, group_name, category, status')
      .eq('municipality_id', tenant.id).eq('status', 'active')
      .then(({ data }) => { setEntries(data ?? []); setLoading(false) })
  }, [tenant?.id])

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-gray-200" /></div>

  const groups = Array.from(new Set(entries.map(e => e.group_name))).sort((a, b) => a.localeCompare(b, 'th'))

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <MapPinned size={18} className="text-indigo-500" /> ศูนย์รวมข้อมูลดิจิทัล
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">รวมพิกัด/สถานที่ทุกชนิดในเขตเทศบาล — {entries.length} รายการ</p>
        </div>
        <button onClick={() => onAddNew()}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white shadow-sm active:scale-95 transition-all"
          style={{ backgroundColor: '#1e293b' }}>
          <Plus size={14} /> เพิ่มข้อมูล
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">
          <MapPinned size={44} className="mb-3 opacity-20" />
          <p className="text-sm font-semibold">ยังไม่มีข้อมูลในระบบ</p>
          <p className="text-xs mt-1">กด "เพิ่มข้อมูล" เพื่อเริ่มปักหมุดรายการแรก</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {groups.map(g => {
            const meta = groupMeta(g)
            const inGroup = entries.filter(e => e.group_name === g)
            const byCategory = Array.from(new Set(inGroup.map(e => e.category))).sort((a, b) => a.localeCompare(b, 'th'))
            return (
              <div key={g} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-bold text-gray-800 flex items-center gap-2">
                    <span>{meta.emoji}</span> {g}
                  </p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: meta.bg, color: meta.color }}>
                      {inGroup.length} แห่ง
                    </span>
                    <button onClick={() => onAddNew(g)} aria-label={`เพิ่มข้อมูลในกลุ่ม ${g}`}
                      className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-400 transition-colors">
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {byCategory.map(c => (
                    <div key={c} className="flex items-center justify-between text-xs text-gray-500">
                      <span>{c}</span>
                      <span className="font-semibold text-gray-700">{inGroup.filter(e => e.category === c).length} แห่ง</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

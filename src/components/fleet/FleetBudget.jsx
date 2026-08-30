import { useState, useEffect } from 'react'
import { Check, Building2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import FleetEmptyState from './FleetEmptyState'
import { fiscalYearOf, FISCAL_MONTHS_TH } from '../../lib/fiscalYear'

/* ── งบประมาณน้ำมันรายกอง ─────────────────────────────────
   แยกออกมาจาก FleetSetup เพื่อให้ /fleet เรียกใช้ได้โดยไม่ต้องดึง UsersTab
   (ซึ่งเรียก adminUpdateUser และใช้ได้เฉพาะหน้าแอดมิน) ติดมาทั้งก้อน
   RLS fbudget_write ให้สิทธิ์ทั้ง fleet_admin และ role admin/superadmin อยู่แล้ว
   แต่เดิม UI อยู่หลัง /admin ทางเดียว ผู้ดูแลยานพาหนะที่ role เป็น staff จึงตั้งงบไม่ได้ ── */
export default function BudgetTab({ tenant, depts }) {
  const year  = fiscalYearOf()
  const [budgets,  setBudgets]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [editCell, setEditCell] = useState(null) // { dept_id, month }
  const [val, setVal] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('fleet_budgets').select('*')
      .eq('municipality_id', tenant.id).eq('fiscal_year', year)
      .then(({ data }) => setBudgets(data ?? []))
      .finally(() => setLoading(false))
  }, [tenant?.id])

  function getAmt(deptId, month) {
    return budgets.find(b => b.department_id === deptId && b.month === month)?.budget_amount ?? ''
  }

  async function handleSave(deptId, month) {
    setSaving(true)
    const existing = budgets.find(b => b.department_id === deptId && b.month === month)
    const amount   = parseFloat(val) || 0
    if (existing) {
      const { data, error } = await supabase.from('fleet_budgets')
        .update({ budget_amount: amount }).eq('id', existing.id).select().single()
      if (!error) setBudgets(prev => prev.map(b => b.id === existing.id ? data : b))
      else alert(error.message)
    } else {
      const { data, error } = await supabase.from('fleet_budgets').insert({
        municipality_id: tenant.id, department_id: deptId,
        fiscal_year: year, month, budget_amount: amount,
      }).select().single()
      if (!error) setBudgets(prev => [...prev, data])
      else alert(error.message)
    }
    setSaving(false)
    setEditCell(null)
    setVal('')
  }

  if (loading) return <div className="flex justify-center py-8"><div className="w-5 h-5 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--color-primary)' }} /></div>

  if (depts.length === 0) return (
    <FleetEmptyState icon={Building2} title="ยังไม่มีกอง" hint="ตั้งค่ากอง/หน่วยงานก่อนเริ่มใช้งาน" />
  )

  return (
    <div className="space-y-3">
      {/* ปีในวงเล็บต้องเป็น พ.ศ. ให้ตรงกับ "ปีงบประมาณ 2569" ที่ขึ้นต้นประโยค
          เดิมพิมพ์ year-544/year-543 = ค.ศ. (2025/2026) วางคู่เดือนไทย อ่านแล้วเข้าใจว่าเป็น พ.ศ. */}
      <p className="text-xs text-gray-500">งบประมาณน้ำมันต่อกอง ปีงบประมาณ {year} — ต.ค. {year - 1} ถึง ก.ย. {year} (บาท/เดือน)</p>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs min-w-150">
          <thead>
            <tr className="text-gray-400 border-b border-gray-100">
              <th className="text-left py-2 px-2 font-semibold">กอง</th>
              {FISCAL_MONTHS_TH.map(({ label }, i) => <th key={i} className="text-center py-2 px-1 font-semibold">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {depts.map(d => (
              <tr key={d.id} className="border-b border-gray-50">
                <td className="py-2 px-2 font-semibold text-gray-700 whitespace-nowrap">{d.short_name || d.name}</td>
                {FISCAL_MONTHS_TH.map(({ month: m }) => {
                  const isEditing = editCell?.dept_id === d.id && editCell?.month === m
                  const amt = getAmt(d.id, m)
                  return (
                    <td key={m} className="py-1 px-0.5 text-center">
                      {isEditing ? (
                        <div className="flex items-center gap-0.5">
                          <input autoFocus value={val} onChange={e => setVal(e.target.value)}
                            type="number" min="0"
                            className="w-14 px-1 py-1 text-xs text-gray-900 bg-white border border-blue-300 rounded-lg focus:outline-none"
                            onKeyDown={e => { if (e.key === 'Enter') handleSave(d.id, m); if (e.key === 'Escape') { setEditCell(null); setVal('') } }} />
                          <button onClick={() => handleSave(d.id, m)} disabled={saving}
                            className="w-5 h-5 flex items-center justify-center rounded-md bg-blue-500 text-white disabled:opacity-50 shrink-0">
                            <Check size={10} strokeWidth={3} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditCell({ dept_id: d.id, month: m }); setVal(amt?.toString() ?? '') }}
                          className="w-full text-center py-1 rounded-lg hover:bg-blue-50 text-gray-600 transition-colors">
                          {amt ? Number(amt).toLocaleString('th-TH') : <span className="text-gray-300">—</span>}
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-400">คลิกที่ช่องเพื่อแก้ไข · กด ✓ หรือ Enter เพื่อบันทึก · Esc เพื่อยกเลิก</p>
    </div>
  )
}

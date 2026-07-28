import { useState, useEffect } from 'react'
import { Banknote, Save, Loader2, CheckCircle2, AlertCircle, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

const DOC_FEE_LABELS = [
  { value: 'residence_cert',   label: '🏠 ใบรับรองการอยู่อาศัย' },
  { value: 'personal_cert',    label: '👤 หนังสือรับรองบุคคล' },
  { value: 'waste_collection', label: '🗑️ ค่าธรรมเนียมขยะ (ต่อปี)', hint: 'ใช้เป็นค่าเริ่มต้นเมื่อเจ้าหน้าที่แจ้งยอด' },
]
// tax_notice (ค่าธรรมเนียม/ภาษี) ไม่มีในนี้โดยตั้งใจ — ป้องกันการทุจริต ห้ามเก็บเงินผ่านแอป
// เด็ดขาด เป็นแค่ช่องทางสอบถามยอด ประชาชนต้องไปชำระที่เทศบาลเอง ตั้งค่าธรรมเนียมล่วงหน้า
// ไม่ได้ (ดู CitizenDocRequest.jsx ที่บังคับ feeAmount เป็น 0 ให้ประเภทนี้เสมอ)
const DEFAULT_FEE = { residence_cert: 0, personal_cert: 0, waste_collection: 0 }
const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

export default function FeeSettingsAdmin({ tenant }) {
  const { patchTenant } = useTenant()
  const [bankName, setBankName] = useState(tenant?.bank_name || '')
  const [bankAccountNo, setBankAccountNo] = useState(tenant?.bank_account_no || '')
  const [bankAccountName, setBankAccountName] = useState(tenant?.bank_account_name || '')
  const [feeSchedule, setFeeSchedule] = useState({ ...DEFAULT_FEE })
  const [customTypes, setCustomTypes] = useState([])
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newEmoji, setNewEmoji] = useState('📋')
  const [newLabel, setNewLabel] = useState('')

  useEffect(() => {
    if (!tenant) return
    setBankName(tenant.bank_name || '')
    setBankAccountNo(tenant.bank_account_no || '')
    setBankAccountName(tenant.bank_account_name || '')
    const { _custom_types: ct, ...fees } = tenant.fee_schedule || {}
    setFeeSchedule({ ...DEFAULT_FEE, ...fees })
    setCustomTypes(ct || [])
  }, [tenant?.id])

  function setFee(docType, val) {
    const n = Math.max(0, parseInt(val) || 0)
    setFeeSchedule(p => ({ ...p, [docType]: n }))
  }

  function addCustomType() {
    const label = newLabel.trim()
    if (!label) return
    const value = `custom_${Date.now()}`
    setCustomTypes(prev => [...prev, { value, label, emoji: newEmoji || '📋' }])
    setFeeSchedule(prev => ({ ...prev, [value]: 0 }))
    setNewLabel('')
    setNewEmoji('📋')
    setShowAddForm(false)
  }

  function removeCustomType(value) {
    setCustomTypes(prev => prev.filter(t => t.value !== value))
    setFeeSchedule(prev => {
      const next = { ...prev }
      delete next[value]
      return next
    })
  }

  async function handleSave(e) {
    e.preventDefault()
    setLoading(true)
    setSaveError('')
    try {
      const fee_schedule = { ...feeSchedule, _custom_types: customTypes }
      const { error } = await supabase
        .from('municipalities')
        .update({
          bank_name: bankName.trim() || null,
          bank_account_no: bankAccountNo.trim() || null,
          bank_account_name: bankAccountName.trim() || null,
          fee_schedule,
        })
        .eq('id', tenant.id)
      if (error) throw error
      patchTenant({
        bank_name: bankName.trim() || null,
        bank_account_no: bankAccountNo.trim() || null,
        bank_account_name: bankAccountName.trim() || null,
        fee_schedule,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white"
             style={{ backgroundColor: '#10b981' }}>
          <Banknote size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">ค่าธรรมเนียมและบัญชีธนาคาร</h1>
          <p className="text-sm text-gray-500">ตั้งค่าบัญชีรับชำระและอัตราค่าธรรมเนียมบริการออกเอกสาร</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <Banknote size={15} /> บัญชีธนาคารและค่าธรรมเนียม
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">LPA ๑.๖</span>
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          ค่าธรรมเนียม 0 บาท = ไม่ต้องชำระ (ฟรี)
        </p>

        <form onSubmit={handleSave} className="space-y-5">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">ธนาคาร</label>
              <input
                type="text"
                value={bankName}
                onChange={e => setBankName(e.target.value)}
                placeholder="เช่น ธ.ก.ส. / กสิกรไทย / ไทยพาณิชย์"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">เลขบัญชี</label>
              <input
                type="text"
                value={bankAccountNo}
                onChange={e => setBankAccountNo(e.target.value)}
                placeholder="เช่น 011-0-8241692-2"
                className={inputCls + ' font-mono tracking-widest'}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">ชื่อบัญชี</label>
              <input
                type="text"
                value={bankAccountName}
                onChange={e => setBankAccountName(e.target.value)}
                placeholder="เช่น องค์การบริหารส่วนตำบลน้ำเลา"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-3">ตารางค่าธรรมเนียม (บาท)</label>
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">ประเภทเอกสาร/บริการ</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 w-36">ค่าธรรมเนียม (บาท)</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {DOC_FEE_LABELS.map(({ value, label, hint }) => (
                    <tr key={value} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5">
                        <p className="text-sm text-gray-700">{label}</p>
                        {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            type="number"
                            min={0}
                            max={9999}
                            value={feeSchedule[value] ?? 0}
                            onChange={e => setFee(value, e.target.value)}
                            className="w-20 text-right text-sm text-gray-900 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
                          />
                          <span className="text-xs text-gray-400 shrink-0">บาท</span>
                        </div>
                      </td>
                      <td></td>
                    </tr>
                  ))}

                  {customTypes.map(t => (
                    <tr key={t.value} className="hover:bg-blue-50/40 bg-blue-50/20">
                      <td className="px-4 py-2.5">
                        <p className="text-sm text-gray-700">{t.emoji} {t.label}</p>
                        <p className="text-[10px] text-blue-400 mt-0.5">ประเภทที่เพิ่มเอง</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            type="number"
                            min={0}
                            max={9999}
                            value={feeSchedule[t.value] ?? 0}
                            onChange={e => setFee(t.value, e.target.value)}
                            className="w-20 text-right text-sm text-gray-900 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
                          />
                          <span className="text-xs text-gray-400 shrink-0">บาท</span>
                        </div>
                      </td>
                      <td className="pr-2">
                        <button type="button" onClick={() => removeCustomType(t.value)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-2">* ค่าธรรมเนียม 0 บาท = ไม่ต้องชำระ (ฟรี)</p>

            {showAddForm ? (
              <div className="mt-3 border border-blue-200 rounded-xl p-4 bg-blue-50 space-y-3">
                <p className="text-xs font-bold text-blue-700">เพิ่มประเภทเอกสาร/บริการใหม่</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newEmoji}
                    onChange={e => setNewEmoji(e.target.value)}
                    placeholder="📋"
                    maxLength={4}
                    className="w-14 text-center text-lg text-gray-900 border border-gray-200 rounded-lg px-1 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
                  />
                  <input
                    type="text"
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCustomType())}
                    placeholder="ชื่อประเภท เช่น ถ่ายเอกสาร, ค่าน้ำประปา"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
                  />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={addCustomType} disabled={!newLabel.trim()}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors">
                    เพิ่ม
                  </button>
                  <button type="button" onClick={() => { setShowAddForm(false); setNewLabel(''); setNewEmoji('📋') }}
                    className="px-4 py-2 rounded-lg text-xs text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 transition-colors">
                    ยกเลิก
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setShowAddForm(true)}
                className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                <Plus size={13} /> เพิ่มประเภทเอกสาร/บริการใหม่
              </button>
            )}
          </div>

          <div className="space-y-2">
            <button type="submit" disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
              style={{ backgroundColor: '#10b981' }}>
              {loading ? <Loader2 size={15} className="animate-spin" />
                : saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
              {loading ? 'กำลังบันทึก...' : saved ? 'บันทึกสำเร็จ' : 'บันทึกการตั้งค่าการชำระเงิน'}
            </button>
            {saveError && (
              <p className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertCircle size={13} /> {saveError}
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

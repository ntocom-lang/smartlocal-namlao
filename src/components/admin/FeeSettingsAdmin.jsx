import { useState, useEffect } from 'react'
import { Banknote, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

const DOC_FEE_LABELS = [
  { value: 'residence_cert', label: '🏠 ใบรับรองการอยู่อาศัย' },
  { value: 'personal_cert',  label: '👤 หนังสือรับรองบุคคล' },
  { value: 'conduct_cert',   label: '✅ หนังสือรับรองความประพฤติ' },
  { value: 'other',          label: '📝 คำขออื่นๆ' },
]
const DEFAULT_FEE = { residence_cert: 0, personal_cert: 0, conduct_cert: 0, other: 0 }
const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

export default function FeeSettingsAdmin({ tenant }) {
  const { patchTenant } = useTenant()
  const [bankName, setBankName] = useState(tenant?.bank_name || '')
  const [bankAccountNo, setBankAccountNo] = useState(tenant?.bank_account_no || '')
  const [bankAccountName, setBankAccountName] = useState(tenant?.bank_account_name || '')
  const [feeSchedule, setFeeSchedule] = useState({ ...DEFAULT_FEE, ...(tenant?.fee_schedule || {}) })
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!tenant) return
    setBankName(tenant.bank_name || '')
    setBankAccountNo(tenant.bank_account_no || '')
    setBankAccountName(tenant.bank_account_name || '')
    setFeeSchedule({ ...DEFAULT_FEE, ...(tenant.fee_schedule || {}) })
  }, [tenant?.id])

  function setFee(docType, val) {
    const n = Math.max(0, parseInt(val) || 0)
    setFeeSchedule(p => ({ ...p, [docType]: n }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setLoading(true)
    setSaveError('')
    try {
      const { error } = await supabase
        .from('municipalities')
        .update({
          bank_name: bankName.trim() || null,
          bank_account_no: bankAccountNo.trim() || null,
          bank_account_name: bankAccountName.trim() || null,
          fee_schedule: feeSchedule,
        })
        .eq('id', tenant.id)
      if (error) throw error
      patchTenant({
        bank_name: bankName.trim() || null,
        bank_account_no: bankAccountNo.trim() || null,
        bank_account_name: bankAccountName.trim() || null,
        fee_schedule: feeSchedule,
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
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 w-32">ค่าธรรมเนียม (บาท)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {DOC_FEE_LABELS.map(({ value, label }) => (
                    <tr key={value} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 text-gray-700">{label}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-2">* ค่าธรรมเนียม 0 บาท = ไม่ต้องชำระ (ฟรี)</p>
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

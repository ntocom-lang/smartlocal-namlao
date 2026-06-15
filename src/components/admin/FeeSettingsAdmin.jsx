import { useState, useEffect } from 'react'
import { Banknote, QrCode, Save, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const DOC_FEE_LABELS = [
  { value: 'residence_cert', label: '🏠 ใบรับรองการอยู่อาศัย' },
  { value: 'personal_cert',  label: '👤 หนังสือรับรองบุคคล' },
  { value: 'conduct_cert',   label: '✅ หนังสือรับรองความประพฤติ' },
  { value: 'other',          label: '📝 คำขออื่นๆ' },
]
const DEFAULT_FEE = { residence_cert: 0, personal_cert: 0, conduct_cert: 0, other: 0 }
const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

export default function FeeSettingsAdmin({ tenant }) {
  const [promptpayId, setPromptpayId] = useState(tenant?.promptpay_id || '')
  const [feeSchedule, setFeeSchedule] = useState({ ...DEFAULT_FEE, ...(tenant?.fee_schedule || {}) })
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!tenant) return
    setPromptpayId(tenant.promptpay_id || '')
    setFeeSchedule({ ...DEFAULT_FEE, ...(tenant.fee_schedule || {}) })
  }, [tenant?.id])

  function setFee(docType, val) {
    const n = Math.max(0, parseInt(val) || 0)
    setFeeSchedule(p => ({ ...p, [docType]: n }))
  }

  async function handleSave(e) {
    e.preventDefault()
    const pid = promptpayId.trim()
    if (pid && !/^(0[689]\d{8}|\d{13})$/.test(pid)) {
      alert('รหัส PromptPay ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขประชาชน/นิติบุคคล 13 หลัก')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase
        .from('municipalities')
        .update({ promptpay_id: pid || null, fee_schedule: feeSchedule })
        .eq('id', tenant.id)
      if (error) throw error
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
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
          <h1 className="text-xl font-bold text-gray-800">ค่าธรรมเนียมและ PromptPay</h1>
          <p className="text-sm text-gray-500">ตั้งค่าบัญชีรับชำระและอัตราค่าธรรมเนียมบริการออกเอกสาร</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <QrCode size={15} /> PromptPay และค่าธรรมเนียม
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">LPA ๑.๖</span>
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          ค่าธรรมเนียม 0 บาท = ไม่ต้องชำระ (ฟรี)
        </p>

        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              รหัส PromptPay <span className="font-normal text-gray-400">(เบอร์โทร 10 หลัก หรือเลขนิติบุคคล 13 หลัก)</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={promptpayId}
              onChange={e => setPromptpayId(e.target.value.replace(/\D/g, '').slice(0, 13))}
              placeholder="เช่น 0812345678 หรือ 1234567890123"
              maxLength={13}
              className={inputCls + ' font-mono tracking-widest'}
            />
            {promptpayId && (
              <p className="text-xs mt-1" style={{ color: /^(0[689]\d{8}|\d{13})$/.test(promptpayId) ? '#10b981' : '#f59e0b' }}>
                {/^(0[689]\d{8}|\d{13})$/.test(promptpayId) ? '✅ รูปแบบถูกต้อง' : '⚠️ เบอร์โทร 10 หลัก หรือเลขนิติบุคคล 13 หลัก'}
              </p>
            )}
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
            <p className="text-xs text-gray-400 mt-2">* ค่าธรรมเนียม 0 บาท = ไม่แสดง QR ให้ประชาชน</p>
          </div>

          <button type="submit" disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
            style={{ backgroundColor: '#10b981' }}>
            {loading ? <Loader2 size={15} className="animate-spin" />
              : saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
            {saved ? 'บันทึกสำเร็จ' : 'บันทึกการตั้งค่าการชำระเงิน'}
          </button>
        </form>
      </div>
    </div>
  )
}

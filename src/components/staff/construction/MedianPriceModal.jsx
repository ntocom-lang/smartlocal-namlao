import { useMemo, useState } from 'react'
import { AlertCircle, Calculator, FileText, Plus, Printer, Trash2, X } from 'lucide-react'
import { thaiBahtText } from '../../../lib/thaiBahtText'
import { printCivilMedianDoc } from '../../../lib/civilMedianPrint'
import { bangkokIsoDate } from '../../../lib/complaintReportPeriods'
import { Field } from './ui'
import { btnGhost, btnPrimary, inp } from './uiStyles'

const moneyTh = num => (num !== null && num !== undefined && num !== '' && Number.isFinite(Number(num))
  ? `${Number(num).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`
  : '–')

export default function MedianPriceModal({ project, bundle, tenant, onClose }) {
  const today = bangkokIsoDate()

  // ดึงกรรมการราคากลางเดิมจาก bundle (ถ้ามี) มิฉะนั้นตั้งต้น 3 คน
  const initialCommittee = useMemo(() => {
    const existing = (bundle?.people ?? []).filter(p => p.grp === 'price_committee')
    if (existing.length >= 3) {
      return existing.map(p => ({ name: p.name || '', position_title: p.position_title || '', duty: p.duty || 'กรรมการ' }))
    }
    return [
      { name: existing[0]?.name || '', position_title: existing[0]?.position_title || 'ผู้อำนวยการกองช่าง', duty: 'ประธานกรรมการ' },
      { name: existing[1]?.name || '', position_title: existing[1]?.position_title || 'นายช่างโยธา', duty: 'กรรมการ' },
      { name: existing[2]?.name || '', position_title: existing[2]?.position_title || 'นายช่างสำรวจ', duty: 'กรรมการ' },
    ]
  }, [bundle])

  const [docNo, setDocNo] = useState('')
  const [docDate, setDocDate] = useState(today)
  const [orderNo, setOrderNo] = useState('')
  const [orderDate, setOrderDate] = useState(today)

  const budget = Number(project?.budget_amount || 0)
  const [costAmount, setCostAmount] = useState('')
  const [factorF, setFactorF] = useState('1.3056')
  const [medianAmount, setMedianAmount] = useState(project?.budget_amount ? String(project.budget_amount) : '')
  const [workScope, setWorkScope] = useState(project?.description || '')
  const [sourceOfPrice, setSourceOfPrice] = useState('หลักเกณฑ์ราคากลางงานก่อสร้างของกรมบัญชีกลาง และราคามาตรฐานพาณิชย์จังหวัด')
  const [committee, setCommittee] = useState(initialCommittee)

  // คำนวณค่างาน x Factor F
  const calcAmount = useMemo(() => {
    const cost = Number(costAmount)
    const f = Number(factorF)
    if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(f) || f <= 0) return 0
    return Math.round(cost * f)
  }, [costAmount, factorF])

  // ซิงค์ยอดคำนวณลงช่องราคากลาง ถ้าผู้ใช้ยังไม่ได้ระบุเอง
  const handleApplyCalc = () => {
    if (calcAmount > 0) {
      setMedianAmount(String(calcAmount))
    }
  }

  const numMedian = Number(medianAmount) || 0
  const isOverBudget = budget > 0 && numMedian > budget
  const bahtTextDisplay = thaiBahtText(numMedian)

  const updatePerson = (index, patch) => {
    setCommittee(list => list.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const addPerson = () => {
    setCommittee(list => [...list, { name: '', position_title: 'เจ้าหน้าที่', duty: 'กรรมการ' }])
  }

  const removePerson = index => {
    setCommittee(list => list.filter((_, i) => i !== index))
  }

  const handlePrint = () => {
    printCivilMedianDoc({
      tenant,
      project,
      data: {
        docNo,
        docDate,
        orderNo,
        orderDate,
        costAmount: Number(costAmount) || 0,
        factorF,
        calcAmount: calcAmount || numMedian,
        medianAmount: numMedian,
        workScope,
        sourceOfPrice,
        committee: committee.filter(c => c.name.trim()),
      },
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="ชุดเอกสารราคากลาง">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-3xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-gray-900">ออกชุดเอกสารราคากลางงานก่อสร้าง</h2>
              <p className="text-xs text-gray-500">บันทึกข้อความรายงานผล + แบบ บก.01 + แบบ ปร.6 สรุป (A4 มาตรฐานราชการ)</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิดหน้าต่าง" className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        {/* Body (Scrollable) */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6 text-left">
          {/* ข้อมูลโครงการ */}
          <div className="rounded-2xl bg-amber-50/60 p-4 border border-amber-200/60">
            <div className="text-xs font-semibold text-amber-800">โครงการ:</div>
            <div className="text-sm font-extrabold text-amber-950">{project?.title}</div>
            <div className="mt-1 flex flex-wrap gap-4 text-xs text-amber-800">
              <span>ปีงบประมาณ: <b>{project?.fiscal_year || '–'}</b></span>
              <span>วงเงินงบประมาณที่ได้รับจัดสรร: <b>{moneyTh(project?.budget_amount)}</b></span>
            </div>
          </div>

          {/* ข้อมูลหนังสือและคำสั่ง */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="เลขที่บันทึกข้อความ">
              <input className={inp} value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="เช่น พล 72303/..." />
            </Field>
            <Field label="ลงวันที่บันทึกข้อความ">
              <input className={inp} type="date" value={docDate} onChange={e => setDocDate(e.target.value)} />
            </Field>
            <Field label="คำสั่งแต่งตั้ง กก. ราคากลาง ที่">
              <input className={inp} value={orderNo} onChange={e => setOrderNo(e.target.value)} placeholder="เช่น 45/2568 (ถ้ามี)" />
            </Field>
            <Field label="ลงวันที่คำสั่งแต่งตั้ง">
              <input className={inp} type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
            </Field>
          </div>

          {/* การคำนวณราคากลาง */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-900">การคำนวณราคากลาง (ปร.5 / ปร.6)</span>
              <span className="text-xs text-gray-500">กรอกต้นทุนและ Factor F เพื่อคำนวณอัตโนมัติ</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="ค่างานต้นทุน (ปร.4/5) (บาท)">
                <input className={inp} type="number" min="0" step="0.01" value={costAmount} onChange={e => setCostAmount(e.target.value)} placeholder="เช่น 950000" />
              </Field>
              <Field label="ค่า Factor F">
                <input className={inp} type="number" min="1" step="0.0001" value={factorF} onChange={e => setFactorF(e.target.value)} placeholder="เช่น 1.3056" />
              </Field>
              <Field label="ยอดรวมคำนวณได้ (บาท)">
                <div className="flex gap-1.5">
                  <input className={inp} readOnly value={calcAmount ? calcAmount.toLocaleString('th-TH') : '–'} />
                  {calcAmount > 0 && (
                    <button type="button" onClick={handleApplyCalc} title="นำยอดคำนวณไปใช้เป็นราคากลาง" className="flex shrink-0 items-center justify-center rounded-xl bg-teal-600 px-3 text-xs font-bold text-white hover:bg-teal-700">
                      <Calculator size={14} className="mr-1" />ใช้ยอดนี้
                    </button>
                  )}
                </div>
              </Field>
            </div>

            <div className="mt-3">
              <Field label="ราคากลางที่กำหนดสุทธิ (ปัดเศษแล้ว) (บาท)">
                <input className={inp} type="number" min="0" step="0.01" value={medianAmount} onChange={e => setMedianAmount(e.target.value)} placeholder="ยอดราคากลางที่จะประกาศใช้จริง" />
              </Field>
              {bahtTextDisplay && (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600">
                  <span className="font-semibold text-gray-500">ตัวอักษร:</span>
                  <span className="font-bold text-teal-800">({bahtTextDisplay})</span>
                </div>
              )}
            </div>

            {isOverBudget && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span><b>คำเตือน:</b> ราคากลาง ({moneyTh(numMedian)}) เกินวงเงินงบประมาณที่ได้รับจัดสรร ({moneyTh(budget)}) ตามระเบียบต้องทบทวนแบบรูปรายการหรือขออนุมัติงบประมาณเพิ่มเติม</span>
              </div>
            )}
          </div>

          {/* รายละเอียดเพิ่มเติมของ บก.01 */}
          <div className="space-y-3">
            <Field label="ลักษณะงานโดยสังเขป (สำหรับ บก.01)">
              <textarea className={`${inp} min-h-[64px]`} rows={2} value={workScope} onChange={e => setWorkScope(e.target.value)} placeholder="เช่น ก่อสร้างถนน คสล. กว้าง 4.00 ม. ยาว 500 ม. หนา 0.15 ม. หรือตามแบบ อปท. กำหนด" />
            </Field>
            <Field label="แหล่งที่มาของราคากลาง (ราคาอ้างอิง)">
              <input className={inp} value={sourceOfPrice} onChange={e => setSourceOfPrice(e.target.value)} />
            </Field>
          </div>

          {/* คณะกรรมการกำหนดราคากลาง */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-bold text-gray-900">คณะกรรมการกำหนดราคากลาง (อย่างน้อย 3 คน)</span>
                {committee.length < 3 && <p className="text-xs text-red-600">⚠️ ต้องมีกรรมการอย่างน้อย 3 คน (ประธาน 1 + กรรมการ 2)</p>}
              </div>
              <button type="button" onClick={addPerson} className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800">
                <Plus size={14} />เพิ่มกรรมการ
              </button>
            </div>

            <div className="space-y-2">
              {committee.map((p, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 rounded-xl border border-gray-100 bg-gray-50/50 p-2.5">
                  <div className="col-span-4">
                    <input className={inp} value={p.name} onChange={e => updatePerson(idx, { name: e.target.value })} placeholder="ชื่อ-นามสกุล" />
                  </div>
                  <div className="col-span-4">
                    <input className={inp} value={p.position_title} onChange={e => updatePerson(idx, { position_title: e.target.value })} placeholder="ตำแหน่งสายงาน" />
                  </div>
                  <div className="col-span-3">
                    <input className={inp} value={p.duty} onChange={e => updatePerson(idx, { duty: e.target.value })} placeholder="เช่น ประธานกรรมการ" />
                  </div>
                  <div className="col-span-1 flex items-center justify-center">
                    {committee.length > 3 && (
                      <button type="button" onClick={() => removePerson(idx)} aria-label="ลบ" className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-6 py-4">
          <div className="text-xs text-gray-500">
            ระบบจะสร้างเอกสาร 3 แผ่นจัดหน้า A4 สารบรรณพร้อมสั่งพิมพ์ทันที
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btnGhost}>
              ปิด
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={!numMedian || committee.length < 3}
              className={btnPrimary}
              style={{ backgroundColor: 'var(--color-primary, #0284c7)' }}
            >
              <Printer size={16} />พิมพ์ชุดเอกสารราคากลาง (3 แผ่น)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

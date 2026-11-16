import { useMemo, useState } from 'react'
import { FileText, Printer, X } from 'lucide-react'
import { thaiBahtText } from '../../../lib/thaiBahtText'
import { printCivilApprovalDoc } from '../../../lib/civilApprovalPrint'
import { bangkokIsoDate } from '../../../lib/complaintReportPeriods'
import { Field } from './ui'
import { btnGhost, btnPrimary, inp } from './uiStyles'

const moneyTh = num => (num !== null && num !== undefined && num !== '' && Number.isFinite(Number(num))
  ? `${Number(num).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`
  : '–')

export default function ProjectApprovalModal({ project, bundle, tenant, profile, onClose }) {
  const today = bangkokIsoDate()

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
  const [proposerName, setProposerName] = useState(profile?.full_name || '')
  const [proposerPosition, setProposerPosition] = useState('ผู้อำนวยการกองช่าง')
  const [committee, setCommittee] = useState(initialCommittee)

  const budget = Number(project?.budget_amount || 0)
  const bahtText = thaiBahtText(budget)

  const updatePerson = (index, patch) => {
    setCommittee(list => list.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const handlePrint = () => {
    printCivilApprovalDoc({
      tenant,
      project,
      data: {
        docNo,
        docDate,
        proposerName,
        proposerPosition,
        committee: committee.filter(c => c.name.trim()),
      },
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="บันทึกขออนุมัติโครงการ">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-3xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-gray-900">พิมพ์บันทึกขออนุมัติโครงการและแบบรูปรายการ</h2>
              <p className="text-xs text-gray-500">ระบบดึงข้อมูลโครงการและงบประมาณมาเติมให้อัตโนมัติ (1-Click Print)</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิดหน้าต่าง" className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-6 text-left">
          {/* ข้อมูลสรุปโครงการ */}
          <div className="rounded-2xl bg-teal-50/70 p-4 border border-teal-200/70">
            <div className="text-xs font-semibold text-teal-800">โครงการตามแผนพัฒนาท้องถิ่น:</div>
            <div className="text-sm font-extrabold text-teal-950">{project?.title}</div>
            <div className="mt-1 flex flex-wrap gap-4 text-xs text-teal-900">
              <span>ปีงบประมาณ: <b>{project?.fiscal_year || '–'}</b></span>
              <span>วงเงินงบประมาณ: <b>{moneyTh(budget)}</b></span>
              {bahtText && <span>({bahtText})</span>}
            </div>
          </div>

          {/* ข้อมูลหนังสือ */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="เลขที่บันทึกข้อความ (ถ้ามี)">
              <input className={inp} value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="เช่น พล 72303/..." />
            </Field>
            <Field label="ลงวันที่">
              <input className={inp} type="date" value={docDate} onChange={e => setDocDate(e.target.value)} />
            </Field>
            <Field label="ชื่อผู้เสนอเรื่อง">
              <input className={inp} value={proposerName} onChange={e => setProposerName(e.target.value)} placeholder="นาย/นาง/น.ส. ..." />
            </Field>
            <Field label="ตำแหน่งผู้เสนอเรื่อง">
              <input className={inp} value={proposerPosition} onChange={e => setProposerPosition(e.target.value)} />
            </Field>
          </div>

          {/* รายชื่อกรรมการกำหนดราคากลางที่ขอแต่งตั้ง */}
          <div className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50/60 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-800">รายชื่อเสนอแต่งตั้งเป็นคณะกรรมการกำหนดราคากลาง (3 ท่าน)</span>
              <span className="text-[11px] text-gray-500">แก้ไขชื่อได้ตามจริง</span>
            </div>
            {committee.slice(0, 3).map((p, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2">
                <div className="col-span-5">
                  <input className={inp} value={p.name} onChange={e => updatePerson(idx, { name: e.target.value })} placeholder={`ชื่อ-สกุล (${idx === 0 ? 'ประธาน' : 'กรรมการ'})`} />
                </div>
                <div className="col-span-4">
                  <input className={inp} value={p.position_title} onChange={e => updatePerson(idx, { position_title: e.target.value })} placeholder="ตำแหน่งสายงาน" />
                </div>
                <div className="col-span-3">
                  <input className={inp} value={p.duty} onChange={e => updatePerson(idx, { duty: e.target.value })} />
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-gray-500">
            💡 กดปุ่มพิมพ์ด้านล่าง ระบบจะจัดหน้ากระดาษ A4 สารบรรณพร้อมตราครุฑและช่องลงนามของช่าง ปลัด และนายกฯ ให้ทันที
          </p>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <button type="button" onClick={onClose} className={btnGhost}>
            ปิด
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className={btnPrimary}
            style={{ backgroundColor: 'var(--color-primary, #0f766e)' }}
          >
            <Printer size={16} />พิมพ์บันทึกข้อความ (A4)
          </button>
        </div>
      </div>
    </div>
  )
}

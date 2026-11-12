import { useCallback, useEffect, useId, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { getFleetPermitSettings, setFleetPermitSettings } from '../../lib/fleetPermitApi'
import { PERMIT_MODE_OPTIONS, permitMessage } from '../../lib/fleetPermit'
import { todayBangkok } from '../../lib/documentSignatories'
import { thaiDateFromDateInput, thaiDateTimeText } from '../../lib/thaiDate'

// ตั้งค่า "ขั้นตอนขอใช้รถ" ของ อปท. — เลือกระหว่างคิวอัตโนมัติ (แบบเดิม) กับบังคับอนุญาตก่อนออกรถ (ข้อ ๑๒)
// ตั้งโดยผู้ดูแลระบบของหน่วยงานเท่านั้น (ฟังก์ชัน DB ตรวจสิทธิ์ซ้ำ และบันทึก audit ทุกครั้งที่เปลี่ยน)
// ภาษาหน้าจอ/คอมโพเนนต์ยึด EsignSettings.jsx (แท็บเพื่อนบ้าน) — ไม่ออกแบบใหม่
// ⚠️ ข้อความต้องไม่รับรองผลทางระเบียบของหน่วยงาน: โหมดแรกบอกตรงๆ ว่าระบบไม่ได้ตรวจ โหมดสองบอกแค่ว่าบังคับลำดับก่อนออกรถ
const FIELD_CLASS = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 disabled:bg-gray-50 disabled:text-gray-500'
const BUTTON_CLASS = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50'

function Notice({ notice }) {
  if (!notice) return null
  const style = notice.ok
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-red-200 bg-red-50 text-red-700'
  return <p role={notice.ok ? 'status' : 'alert'} className={`rounded-xl border px-4 py-2.5 text-sm ${style}`}>{notice.text}</p>
}

export default function FleetPermitSettings({ tenant }) {
  const uid = useId()
  const municipalityId = tenant?.id
  const [saved, setSaved] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [mode, setMode] = useState('queue')
  const [delegate, setDelegate] = useState(false)
  const [delegationRef, setDelegationRef] = useState('')
  const [delegationDate, setDelegationDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const today = todayBangkok()

  const apply = useCallback(next => {
    setSaved(next)
    setMode(next.permit_mode === 'regulation' ? 'regulation' : 'queue')
    setDelegate(Boolean(next.delegate_dept_heads))
    setDelegationRef(next.delegation_ref ?? '')
    setDelegationDate(next.delegation_date ?? '')
  }, [])

  useEffect(() => {
    if (!municipalityId) return undefined
    let active = true
    getFleetPermitSettings(municipalityId).then(result => {
      if (!active) return
      if (result?.ok === true) apply(result)
      else setLoadError(permitMessage(result))
      setLoading(false)
    })
    return () => { active = false }
  }, [municipalityId, apply])

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
  }
  if (loadError || !saved) {
    return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">⚠️ {loadError || permitMessage(null)}</p>
  }

  const canEdit = saved.can_edit === true
  const savedMode = saved.permit_mode === 'regulation' ? 'regulation' : 'queue'
  const dirty = mode !== savedMode
    || delegate !== Boolean(saved.delegate_dept_heads)
    || delegationRef.trim() !== (saved.delegation_ref ?? '')
    || delegationDate !== (saved.delegation_date ?? '')
  const evidenceMissing = delegate && (!delegationRef.trim() || !delegationDate)
  const switchingToRegulation = mode === 'regulation' && savedMode !== 'regulation'

  async function save() {
    setBusy(true)
    setNotice(null)
    const result = await setFleetPermitSettings({
      // กลับเป็นแบบเดิมโดยที่ช่องมอบยังกรอกไม่ครบ (ซ่อนอยู่) = ไม่ส่งการมอบ ไม่งั้น DB ปัดว่าขาดหลักฐาน
      municipalityId, permitMode: mode, delegateDeptHeads: delegate && !(mode === 'queue' && evidenceMissing), delegationRef, delegationDate,
    })
    if (result?.ok === true) {
      apply(result)
      setNotice({ ok: true, text: 'บันทึกแล้ว มีผลกับคำขอที่ยื่นจากนี้ไป คำขอที่ยื่นไปแล้วใช้ขั้นตอนเดิมของใบนั้นต่อ' })
    } else {
      setNotice({ ok: false, text: permitMessage(result) })
    }
    setBusy(false)
  }

  const updatedAt = thaiDateTimeText(saved.updated_at)

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-xs leading-5 text-gray-500">
              เลือกว่าหน่วยงานนี้ให้ใบขออนุญาตใช้ยานพาหนะส่วนกลาง (แบบ ๓) เดินขั้นตอนไหนก่อนบันทึกออกรถ
              คิวรถที่ระบบกันให้อัตโนมัติ (อนุมัติแล้ว / รอจัดสรรรถ) เป็นคนละเรื่องกับการอนุญาต และไม่เปลี่ยนในทั้งสองแบบ
            </p>
            <p className="text-xs leading-5 text-gray-500">
              ระบบไม่ลงนามแทนใคร ไม่ตัดสินแทนผู้มีอำนาจ เพียงบันทึกผลการอนุญาตที่คนทำไว้ให้ตรวจย้อนได้ ทุกครั้งที่เปลี่ยนการตั้งค่ามีบันทึกการแก้ไข
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${savedMode === 'regulation' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
            {savedMode === 'regulation' ? 'บังคับอนุญาตก่อนออกรถ' : 'คิวอัตโนมัติ'}
          </span>
        </div>
        <p className="text-[11px] leading-5 text-gray-400" data-permit-updated>
          {updatedAt
            ? `แก้ไขล่าสุดโดย ${saved.updated_by_name || '—'} เมื่อ ${updatedAt}`
            : 'ยังไม่เคยตั้งค่า — หน่วยงานนี้ใช้คิวอัตโนมัติแบบเดิม'}
        </p>
        {!canEdit && (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs leading-5 text-sky-900" data-permit-readonly>
            ดูได้อย่างเดียว — ผู้ดูแลระบบของหน่วยงานเท่านั้นที่เปลี่ยนการตั้งค่านี้ได้
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <fieldset disabled={!canEdit || busy} className="space-y-2">
          <legend className="mb-1 text-sm font-bold text-gray-800">ขั้นตอนขอใช้รถ</legend>
          {PERMIT_MODE_OPTIONS.map(option => (
            <label key={option.key} htmlFor={`${uid}-mode-${option.key}`}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${mode === option.key ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-white'}`}>
              <input id={`${uid}-mode-${option.key}`} type="radio" name={`${uid}-mode`} value={option.key}
                checked={mode === option.key} onChange={() => setMode(option.key)} className="mt-1 h-4 w-4 shrink-0" />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-sm font-bold text-gray-800">{option.label}</span>
                <span className="block text-xs leading-5 text-gray-700">{option.summary}</span>
                <span className="block text-xs leading-5 text-gray-500">{option.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {switchingToRegulation && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-5 text-amber-800" data-permit-switch-warning>
            ⚠️ บันทึกแล้ว คำขอที่ยื่นจากนี้ไปจะบันทึกออกรถไม่ได้จนกว่าจะได้รับอนุญาต — แจ้งผู้ขอใช้รถและผู้ดูแลระบบยานพาหนะให้ทราบก่อน
            ผู้มีอำนาจควรตั้งรหัสลงนามและมีชื่อในทะเบียนผู้ลงนามให้พร้อม (แท็บ “ผู้ลงนามแต่ละช่อง” และ “ลงนามออนไลน์”)
          </p>
        )}
        <p className="text-xs leading-5 text-gray-500">
          เปลี่ยนแล้วมีผลกับคำขอที่ยื่นหลังบันทึกเท่านั้น คำขอที่ยื่นไปแล้วใช้ขั้นตอนเดิมของใบนั้นต่อจนจบ
        </p>
      </section>

      {mode === 'regulation' && (
        <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-800">มอบให้ ผอ.สำนัก/กอง อนุมัติคำขอของกองตัวเอง <span className="font-semibold text-gray-400">(ไม่บังคับ)</span></h3>
          <fieldset disabled={!canEdit || busy} className="space-y-3">
            <label htmlFor={`${uid}-delegate`} className="flex cursor-pointer items-start gap-3 text-sm text-gray-800">
              <input id={`${uid}-delegate`} type="checkbox" checked={delegate} onChange={event => setDelegate(event.target.checked)}
                className="mt-1 h-4 w-4 shrink-0" />
              <span className="font-semibold">มอบให้ ผอ.สำนัก/กอง อนุมัติคำขอของกองตัวเอง (ข้อ ๑๒ วรรคสี่)</span>
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-xs font-semibold text-gray-600" htmlFor={`${uid}-ref`}>เลขที่คำสั่งมอบหมาย{delegate ? ' *' : ''}
                <input id={`${uid}-ref`} className={`${FIELD_CLASS} mt-1`} value={delegationRef} maxLength={200}
                  onChange={event => setDelegationRef(event.target.value)} placeholder="เช่น คำสั่ง ทต.… ที่ 12/2569" />
              </label>
              <label className="block text-xs font-semibold text-gray-600" htmlFor={`${uid}-date`}>ลงวันที่{delegate ? ' *' : ''}
                <input id={`${uid}-date`} type="date" className={`${FIELD_CLASS} mt-1`} value={delegationDate} max={today}
                  onChange={event => setDelegationDate(event.target.value)} />
                {delegationDate && <span className="mt-1 block text-[11px] font-normal text-gray-400">{thaiDateFromDateInput(delegationDate)}</span>}
              </label>
            </div>
          </fieldset>
          {evidenceMissing && (
            <p role="alert" className="text-xs font-semibold text-amber-700">เปิดการมอบแล้ว ต้องกรอกเลขที่และวันที่คำสั่งมอบหมายก่อนบันทึก (ใช้เป็นหลักฐานให้ผู้ตรวจ)</p>
          )}
          <div className="space-y-1.5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-600" data-permit-delegation-notes>
            <p><strong>หมายเหตุ</strong></p>
            <ul className="list-disc space-y-1 pl-4">
              <li>ใช้ได้กับยานพาหนะส่วนกลางเท่านั้น ไม่รวมรถรับรอง — ระบบไม่แยกประเภทรถ หน่วยงานที่มีรถรับรองไม่ควรเปิดการมอบ</li>
              <li>ผอ.สำนัก/กองเป็นผู้ขอเอง · กองนั้นยังไม่ตั้งผู้ลงนามในทะเบียน · ผู้ขอเป็นนายก — ระบบส่งไปให้ผู้มีอำนาจตามแบบ ๓ เอง และบอกเหตุไว้ที่ใบ</li>
              <li>
                การลงนามออนไลน์ช่องผู้มีอำนาจยังเป็นนายกตามทะเบียน การมอบตอนนี้ใช้กับการบันทึกใบกระดาษของผู้ดูแลระบบยานพาหนะ
                (การลงนามออนไลน์แบบมอบรายกองเป็นเฟสถัดไป)
              </li>
            </ul>
          </div>
        </section>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={`${BUTTON_CLASS} bg-indigo-600 text-white hover:bg-indigo-700`}
            disabled={!canEdit || busy || !dirty || (mode === 'regulation' && evidenceMissing)}
            onClick={save}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึก
          </button>
        </div>
        <Notice notice={notice} />
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, Copy, Loader2, Save } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  ESIGN_DRIVER_NOTE, ESIGN_FLEET_SLOTS, ESIGN_MODE_LABEL, ESIGN_READINESS, esignAnnouncementDraft, esignAnyOnline, esignBlockers,
  esignGateItems, esignMessage, esignModesFromStatus, esignReadinessMap,
} from '../../lib/esign'
import { getEsignGateStatus, getSignerReadiness, reinstateEsignSigner, setEsignDocType, setEsignPolicy } from '../../lib/esignApi'
import { todayBangkok } from '../../lib/documentSignatories'
import { thaiDateFromDateInput } from '../../lib/thaiDate'

// ตั้งค่า "ลงนามออนไลน์รายเรื่อง" ของ อปท. — ตั้งโดยแอดมินของหน่วยงานเท่านั้น (ฟังก์ชัน DB ตรวจสิทธิ์ซ้ำ)
// เรียงตามสิ่งที่แอดมินต้องทำ: ผู้ลงนามผูกบัญชี (+ ดูว่าใครพร้อม) → เลือกช่อง · ประกาศอยู่ท้ายหน้าเป็นส่วนไม่บังคับ
// (เจ้าของระบบสั่ง 2026-10-22 ให้ถอดประกาศ/หนังสือให้ความเห็นชอบออกจากเงื่อนไขเปิดใช้ — ห้ามเอากลับมาบังคับโดยไม่ได้รับคำสั่ง)
// ข้อ "ยืนยันว่าทดลองแล้ว" ถอดแล้ว 2569-10-31 (เฟส 2): ช่องที่ผู้ลงนามยังไม่พร้อม ระบบให้เซ็นสดเองตอนสร้างคำขอ
// ไม่มีปุ่ม "เปิดทั้งหมด" โดยตั้งใจ และไม่เปิดให้เองเมื่อเงื่อนไขไม่ครบ (DB ปัดด้วย gate_* ถ้าข้ามหน้าจอมา)
const FIELD_CLASS = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400'
const BUTTON_CLASS = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50'
const STAFF_ROLES = ['admin', 'officer', 'staff', 'technician', 'viewer', 'council']
const READINESS_ORDER = { suspended: 0, pin_not_set: 1, ready: 2 }

// ใครในทะเบียนผู้ลงนามพร้อมลงนามออนไลน์ — คนที่ยังไม่พร้อมขึ้นก่อน พร้อมบอกว่าต้องทำอะไร
// ดึงไม่ได้ (readiness = null) บอกตรงๆ ว่ายังไม่รู้ ไม่เดาว่าไม่พร้อม
function ReadinessList({ readiness, people, busy, onReinstate }) {
  if (!readiness) {
    return <p className="text-xs text-gray-500" data-esign-readiness="unknown">ยังดูความพร้อมรายคนไม่ได้ ลองรีเฟรชหน้าอีกครั้ง</p>
  }
  const names = new Map(people.map(person => [person.id, person]))
  const rows = [...readiness.entries()]
    .map(([id, state]) => ({ id, state, person: names.get(id) }))
    .sort((a, b) => READINESS_ORDER[a.state] - READINESS_ORDER[b.state]
      || (a.person?.full_name ?? '').localeCompare(b.person?.full_name ?? '', 'th'))
  if (!rows.length) {
    return <p className="text-xs text-gray-500" data-esign-readiness="empty">ยังไม่มีผู้ลงนามที่ผูกบัญชี</p>
  }
  const ready = rows.filter(row => row.state === 'ready').length
  return (
    <div className="space-y-2" data-esign-readiness="list">
      <p className="text-sm font-semibold text-gray-800">พร้อมลงนามออนไลน์ {ready} จาก {rows.length} คน</p>
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
        {rows.map(row => {
          const info = ESIGN_READINESS[row.state]
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5" data-esign-readiness-person={row.state}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-800">{row.person?.full_name ?? 'บุคลากร (ไม่พบชื่อ)'}</p>
                {row.person?.job_title && <p className="text-xs text-gray-500">{row.person.job_title}</p>}
                {info.todo && <p className="text-xs text-gray-600">{info.todo}</p>}
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${info.tone === 'ok' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {info.label}
              </span>
              {row.state === 'suspended' && (
                <button type="button" className={`${BUTTON_CLASS} min-h-11 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
                  disabled={busy === 'reinstateInline'} onClick={() => onReinstate(row.id)}>
                  เปิดคืน
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Notice({ notice }) {
  if (!notice) return null
  const style = notice.ok
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-red-200 bg-red-50 text-red-700'
  return <p role={notice.ok ? 'status' : 'alert'} className={`rounded-xl border px-4 py-2.5 text-sm ${style}`}>{notice.text}</p>
}

function Step({ number, title, done, children }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0" aria-hidden="true">
          {done ? <CheckCircle2 size={22} className="text-emerald-600" /> : <Circle size={22} className="text-gray-300" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-gray-800">{number}. {title}</h3>
          <p className="text-xs font-semibold text-gray-400">{done ? 'ผ่านแล้ว' : 'ยังไม่ผ่าน'}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

export default function EsignSettings({ tenant, onOpenSignatories = null }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [people, setPeople] = useState([])

  const [announcementNo, setAnnouncementNo] = useState('')
  const [announcementDate, setAnnouncementDate] = useState('')
  const [approvalRef, setApprovalRef] = useState('')
  const [announcementUrl, setAnnouncementUrl] = useState('')
  const [modes, setModes] = useState(() => esignModesFromStatus(null))
  const [readiness, setReadiness] = useState(null)
  const [reinstateId, setReinstateId] = useState('')

  const [busy, setBusy] = useState('')
  const [notices, setNotices] = useState({})
  const [copied, setCopied] = useState(false)

  const municipalityId = tenant?.id
  const today = todayBangkok()

  const applyStatus = useCallback(next => {
    setStatus(next)
    setAnnouncementNo(next?.policy?.announcement_no ?? '')
    setAnnouncementDate(next?.policy?.announcement_date ?? '')
    setApprovalRef(next?.policy?.approval_ref ?? '')
    setAnnouncementUrl(next?.policy?.announcement_url ?? '')
    setModes(esignModesFromStatus(next))
  }, [])

  const reload = useCallback(async () => {
    if (!municipalityId) return
    const [next, ready] = await Promise.all([getEsignGateStatus(municipalityId), getSignerReadiness(municipalityId, null)])
    if (next?.ok === false) {
      setLoadError(esignMessage(next))
      setStatus(null)
    } else {
      setLoadError('')
      applyStatus(next)
    }
    setReadiness(esignReadinessMap(ready))
    setLoading(false)
  }, [municipalityId, applyStatus])

  useEffect(() => {
    if (!municipalityId) return undefined
    let active = true
    Promise.all([
      getEsignGateStatus(municipalityId),
      supabase.from('profiles').select('id,full_name,job_title,role')
        .eq('municipality_id', municipalityId).in('role', STAFF_ROLES).order('full_name'),
      getSignerReadiness(municipalityId, null),
    ]).then(([next, peopleResult, ready]) => {
      if (!active) return
      if (next?.ok === false) setLoadError(esignMessage(next))
      else applyStatus(next)
      setPeople((peopleResult.data ?? []).filter(person => person.full_name?.trim()))
      setReadiness(esignReadinessMap(ready))
      setLoading(false)
    })
    return () => { active = false }
  }, [municipalityId, applyStatus])

  const setNotice = (key, notice) => setNotices(current => ({ ...current, [key]: notice }))

  async function run(key, action, successText) {
    setBusy(key)
    setNotice(key, null)
    const result = await action()
    if (result?.ok) {
      setNotice(key, { ok: true, text: successText })
      await reload()
    } else {
      setNotice(key, { ok: false, text: esignMessage(result) })
    }
    setBusy('')
  }

  const savedModes = useMemo(() => esignModesFromStatus(status), [status])
  const enabled = esignAnyOnline(savedModes)
  const modesDirty = ESIGN_FLEET_SLOTS.some(slot => modes[slot.key] !== savedModes[slot.key])
  const blockers = esignBlockers(status, modes)
  const gateItems = esignGateItems(status, modes)
  const authorityGate = gateItems.find(item => item.key === 'authority')
  const deptHeadGate = gateItems.find(item => item.key === 'dept_head')
  const draftText = useMemo(() => esignAnnouncementDraft(tenant?.name), [tenant?.name])

  // ประกาศไม่บังคับ: ว่างทุกช่องก็บันทึกได้ (= ล้างที่เคยกรอก) ปุ่มบันทึกเปิดเมื่อมีการเปลี่ยนแปลงเท่านั้น
  const savedPolicy = status?.policy
  const policyRecorded = Boolean(savedPolicy?.announcement_no)
  const policyDirty = announcementNo.trim() !== (savedPolicy?.announcement_no ?? '')
    || announcementDate !== (savedPolicy?.announcement_date ?? '')
    || approvalRef.trim() !== (savedPolicy?.approval_ref ?? '')
    || announcementUrl.trim() !== (savedPolicy?.announcement_url ?? '')

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draftText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
      setNotice('draft', { ok: false, text: 'คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง' })
    }
  }

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
  }
  if (loadError) {
    return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">⚠️ {loadError}</p>
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-2">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-xs leading-5 text-gray-500">
              ให้ผู้ลงนามเซ็นใบขออนุญาตใช้ยานพาหนะส่วนกลาง (แบบ ๓) และบันทึกรับรอง สก.๑ ในระบบแทนเซ็นกระดาษ เลือกเปิดเป็นรายช่อง
              ช่องที่ไม่เลือกยังเซ็นสดเหมือนเดิม {ESIGN_DRIVER_NOTE}
            </p>
            <p className="text-xs leading-5 text-gray-500">
              เปิดแล้วมีผลกับคำขอที่สร้างหลังบันทึกเท่านั้น คำขอที่สร้างไปแล้วเซ็นสดต่อจนจบ ปิดสวิตช์แล้วลายเซ็นที่ลงไปแล้วยังตรวจสอบได้
              ระบบไม่ลงนามแทนใคร ไม่เปลี่ยนการอนุมัติคิวรถอัตโนมัติ และไม่ตัดสินแทนผู้มีอำนาจ
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
            {enabled ? 'เปิดใช้อยู่' : 'ยังไม่เปิด'}
          </span>
        </div>
      </section>

      <Step number={1} title="ผู้ลงนามผูกกับบัญชีจริง" done={authorityGate.ok && deptHeadGate.ok}>
        <p className="text-xs leading-5 text-gray-500">
          ช่องผู้มีอำนาจสั่งใช้และหัวหน้ากองลงนามออนไลน์ได้เมื่อผู้ลงนามในแท็บ “ผู้ลงนามแต่ละช่อง” มีบัญชีในระบบ
          ช่องที่พิมพ์ชื่อเอง (คนที่ไม่มีบัญชี) ลงนามออนไลน์ไม่ได้ ต้องเซ็นปากกาต่อ
          — แท็บนั้นเสนอบัญชีตามการแต่งตั้งให้ กด “ใช้ชื่อนี้” แล้วยืนยัน
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {[authorityGate, deptHeadGate].map(item => (
            <li key={item.key} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm">
              <span className="text-gray-700">{item.label}</span>
              <span className={`shrink-0 text-xs font-bold ${item.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{item.detail}</span>
            </li>
          ))}
        </ul>
        {onOpenSignatories && (
          <button type="button" className="text-xs font-bold text-indigo-700 underline underline-offset-2" onClick={onOpenSignatories}>
            ไปแท็บ “ผู้ลงนามแต่ละช่อง”
          </button>
        )}
        <ReadinessList readiness={readiness} people={people} busy={busy}
          onReinstate={id => run('reinstateInline', () => reinstateEsignSigner(id), 'เปิดคืนแล้ว')} />
        <Notice notice={notices.reinstateInline} />
      </Step>

      <Step number={2} title="เลือกช่องที่ลงนามออนไลน์" done={enabled}>
        <p className="text-xs leading-5 text-gray-500">
          ใบขออนุญาตใช้ยานพาหนะส่วนกลาง (แบบ ๓) พร้อมบันทึกรับรอง สก.๑ — ผู้ลงนามไม่ต้องพร้อมครบก่อนเปิด
          ตอนสร้างคำขอ ช่องที่ผู้ลงนามยังไม่ได้ตั้งรหัสหรือระงับอยู่ ระบบให้ใบนั้นเซ็นสดช่องนั้นแทนเอง ไม่ค้าง
          ตั้งรหัสแล้ว คำขอใบถัดไปลงนามออนไลน์ได้ ใบที่สร้างไปแล้วเซ็นสดต่อ
        </p>
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {ESIGN_FLEET_SLOTS.map(slot => (
            <div key={slot.key} className="grid gap-2 px-3 py-2.5 md:grid-cols-[1fr_220px] md:items-center">
              <div className="min-w-0">
                <label className="block text-sm font-semibold text-gray-800" htmlFor={`esign-slot-${slot.key}`}>{slot.label}</label>
                <p className="text-[11px] leading-4 text-gray-400">{slot.hint}</p>
              </div>
              <select id={`esign-slot-${slot.key}`} className={FIELD_CLASS} value={modes[slot.key]}
                onChange={event => setModes(current => ({ ...current, [slot.key]: event.target.value }))}>
                <option value="wet">{ESIGN_MODE_LABEL.wet}</option>
                <option value="online">{ESIGN_MODE_LABEL.online}</option>
              </select>
            </div>
          ))}
        </div>
        {blockers.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            {gateItems.filter(item => blockers.includes(item.key)).map(item => (
              <li key={item.key}>⚠️ ยังเปิดไม่ได้: {item.label} ({item.detail})</li>
            ))}
          </ul>
        )}
        {esignAnyOnline(modes) && !policyRecorded && (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs leading-5 text-sky-900">
            ควรมีประกาศของหน่วยงานตาม พ.ร.ฎ. ๒๕๔๙ มาตรา ๗ — ระบบไม่บังคับและเปิดใช้ได้เลย ร่างข้อความประกาศอยู่ในส่วน “ประกาศของหน่วยงาน” ด้านล่าง
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={`${BUTTON_CLASS} bg-indigo-600 text-white hover:bg-indigo-700`}
            disabled={busy === 'modes' || !modesDirty || blockers.length > 0}
            onClick={() => run('modes', () => setEsignDocType(municipalityId, esignAnyOnline(modes) ? modes : null),
              esignAnyOnline(modes) ? 'บันทึกแล้ว มีผลกับคำขอที่สร้างจากนี้' : 'ปิดการลงนามออนไลน์แล้ว')}>
            {busy === 'modes' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึก
          </button>
          {enabled && (
            <button type="button" className={`${BUTTON_CLASS} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
              disabled={busy === 'modes'}
              onClick={() => run('modes', () => setEsignDocType(municipalityId, null), 'ปิดการลงนามออนไลน์แล้ว')}>
              ปิดการลงนามออนไลน์ทั้งเรื่อง
            </button>
          )}
        </div>
        <Notice notice={notices.modes} />
      </Step>

      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <h3 className="text-sm font-bold text-gray-800">ประกาศของหน่วยงาน <span className="font-semibold text-gray-400">(ไม่บังคับ — ระบบเตรียมร่างให้)</span></h3>
            <p className="text-xs leading-5 text-gray-500">
              ระบบไม่บังคับให้มีประกาศก่อนเปิดใช้ แต่พระราชกฤษฎีกากำหนดหลักเกณฑ์และวิธีการในการทำธุรกรรมทางอิเล็กทรอนิกส์ภาครัฐ พ.ศ. ๒๕๔๙ มาตรา ๗
              ให้แนวนโยบายและแนวปฏิบัติความมั่นคงปลอดภัยทำเป็นประกาศ และต้องได้รับความเห็นชอบจากคณะกรรมการหรือหน่วยงานที่คณะกรรมการมอบหมายจึงมีผลบังคับ
              ควรสอบถามท้องถิ่นจังหวัดหรือกรมส่งเสริมการปกครองท้องถิ่นว่าต้องดำเนินการอย่างไร เป็นหน้าที่ของหน่วยงาน ระบบไม่ตรวจและไม่รับรองแทน
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${policyRecorded ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
            {policyRecorded ? 'บันทึกไว้แล้ว' : 'ยังไม่ได้บันทึก'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="text-xs font-bold text-indigo-700 underline underline-offset-2" onClick={copyDraft}>
            <Copy size={13} className="mr-1 inline" />{copied ? 'คัดลอกแล้ว' : 'คัดลอกร่างข้อความประกาศ'}
          </button>
        </div>
        <Notice notice={notices.draft} />
        <details className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <summary className="cursor-pointer text-xs font-bold text-gray-700">ดูร่างข้อความประกาศ (ให้นิติกรและผู้บริหารตรวจก่อนใช้)</summary>
          <p className="mt-2 text-[11px] leading-5 text-gray-500">
            เป็นร่างตั้งต้นที่อ้างเฉพาะตัวบทที่ตรวจกับสำเนาทางการแล้ว ไม่ใช่คำปรึกษากฎหมาย ส่วนในวงเล็บเหลี่ยม [ ] หน่วยงานต้องตัดสินใจและกรอกเอง
          </p>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-gray-800">{draftText}</pre>
        </details>
        <details className="rounded-xl border border-gray-200 px-4 py-3">
          <summary className="cursor-pointer text-xs font-bold text-gray-700">บันทึกเลขที่ประกาศและหนังสือที่ได้รับ (ถ้ามี)</summary>
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-xs font-semibold text-gray-600" htmlFor="esign-no">เลขที่ประกาศ
                <input id="esign-no" className={`${FIELD_CLASS} mt-1`} value={announcementNo} maxLength={200}
                  onChange={event => setAnnouncementNo(event.target.value)} placeholder="เช่น ประกาศ อบต.… ที่ 5/2569" />
              </label>
              <label className="block text-xs font-semibold text-gray-600" htmlFor="esign-date">ลงวันที่
                <input id="esign-date" type="date" className={`${FIELD_CLASS} mt-1`} value={announcementDate} max={today}
                  onChange={event => setAnnouncementDate(event.target.value)} />
                {announcementDate && <span className="mt-1 block text-[11px] font-normal text-gray-400">{thaiDateFromDateInput(announcementDate)}</span>}
              </label>
            </div>
            <label className="block text-xs font-semibold text-gray-600" htmlFor="esign-approval">หนังสือให้ความเห็นชอบ หรือคำชี้แจงว่าไม่ต้องขอ
              <textarea id="esign-approval" className={`${FIELD_CLASS} mt-1 min-h-20`} value={approvalRef} maxLength={500}
                onChange={event => setApprovalRef(event.target.value)}
                placeholder="เช่น หนังสือท้องถิ่นจังหวัด… ที่ มท …/… ลงวันที่ … (ถ้าได้รับคำตอบว่าไม่ต้องขอความเห็นชอบ ให้ใส่เลขที่หนังสือตอบนั้น)" />
            </label>
            <label className="block text-xs font-semibold text-gray-600" htmlFor="esign-url">ลิงก์ไฟล์ประกาศ
              <input id="esign-url" className={`${FIELD_CLASS} mt-1`} value={announcementUrl} maxLength={1000} inputMode="url"
                onChange={event => setAnnouncementUrl(event.target.value)} placeholder="https://…" />
            </label>
            <button type="button" className={`${BUTTON_CLASS} bg-indigo-600 text-white hover:bg-indigo-700`}
              disabled={busy === 'policy' || !policyDirty}
              onClick={() => run('policy', () => setEsignPolicy({
                municipalityId, announcementNo, announcementDate, approvalRef, announcementUrl,
              }), 'บันทึกแล้ว')}>
              {busy === 'policy' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึก
            </button>
            <Notice notice={notices.policy} />
          </div>
        </details>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-gray-800">เปิดคืนผู้ลงนามที่ระงับการลงนามของตัวเอง</h3>
        <p className="text-xs leading-5 text-gray-500">
          ผู้ลงนามกด “ระงับการลงนามของฉัน” เองเมื่อสงสัยว่ารหัสรั่ว เมื่อตรวจสอบแล้วเลือกชื่อเพื่อเปิดคืน ผู้ที่ไม่ได้ถูกระงับกดแล้วไม่มีผลอะไร
          ผู้ที่ตั้งรหัสใหม่ไม่ปลดระงับเอง ต้องให้ผู้ดูแลระบบเปิดคืนเสมอ
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-60 flex-1 text-xs font-semibold text-gray-600" htmlFor="esign-reinstate">ผู้ลงนาม
            <select id="esign-reinstate" className={`${FIELD_CLASS} mt-1`} value={reinstateId} onChange={event => setReinstateId(event.target.value)}>
              <option value="">เลือกบุคลากร</option>
              {people.map(person => (
                <option key={person.id} value={person.id}>{person.full_name}{person.job_title ? ` · ${person.job_title}` : ''}</option>
              ))}
            </select>
          </label>
          <button type="button" className={`${BUTTON_CLASS} bg-indigo-600 text-white hover:bg-indigo-700`}
            disabled={busy === 'reinstate' || !reinstateId}
            onClick={() => run('reinstate', () => reinstateEsignSigner(reinstateId), 'เปิดคืนแล้ว')}>
            {busy === 'reinstate' ? <Loader2 size={15} className="animate-spin" /> : null} เปิดคืน
          </button>
        </div>
        <Notice notice={notices.reinstate} />
      </section>
    </div>
  )
}

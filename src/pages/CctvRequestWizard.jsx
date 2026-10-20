import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Copy, Loader2, Video } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { notifyTelegram } from '../lib/notifyTelegram'
import {
  CCTV_INCIDENT_TYPES, CCTV_MAX_DESCRIPTION, CCTV_MAX_INCIDENT_AGE_DAYS, CCTV_MAX_LABEL, CCTV_MAX_POLICE_REF,
  CCTV_MAX_WINDOW_MINUTES, CCTV_REQUESTER_ROLES, CCTV_TYPE,
  buildCctvFormData, cctvBangkokToday, cctvCitizenRetentionNotice, cctvPurposeText, cctvRetentionDays,
  cctvSubmitErrorText, validateCctvDraft,
} from '../lib/cctvRequest'

const inputCls = 'w-full min-h-11 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-200'
const OTHER_CAMERA = '__other'

function Field({ label, required, error, hint, children }) {
  return (
    <div>
      {/* ครอบช่องกรอกไว้ใน label เดียวกัน — โปรแกรมอ่านหน้าจอและเทสต์ (getByLabel) จับคู่ป้ายกับช่องได้โดยไม่ต้องมี id */}
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-gray-500">
          {label}{required && <span className="text-rose-600"> *</span>}
        </span>
        {children}
      </label>
      {hint && !error && <p className="mt-1 text-[11px] text-gray-400">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  )
}

function Chips({ label, value, options, onChange, error }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-gray-500">{label}<span className="text-rose-600"> *</span></p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map(option => {
          const on = value === option.value
          return (
            <button key={option.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(option.value)}
              className={'min-h-11 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors '
                + (on ? 'border-cyan-700 bg-cyan-700 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50')}>
              {option.label}
            </button>
          )
        })}
      </div>
      {error && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  )
}

/**
 * ขอภาพจากกล้องวงจรปิด (CCTV) — ฟอร์มเฉพาะ เก็บรายละเอียดเหตุการณ์ลง document_requests.permit_form_data
 *
 * ระบบรับแค่ "คำขอ" ไม่รับ/ไม่ส่งไฟล์วิดีโอ เจ้าหน้าที่ค้นภาพและตัดสินว่าจะให้ใคร แล้วส่งมอบนอกระบบ
 * (บันทึกการส่งมอบอยู่ที่หน้าเจ้าหน้าที่) ข้อความทุกจุดจึงห้ามสื่อว่ายื่นแล้วจะได้ภาพ
 * ⚠️ ด่านบังคับจริง (ต้องล็อกอิน / สังกัด / เปิดบริการ / รูปแบบข้อมูล / 5 คำขอต่อวัน) อยู่ที่ฐานข้อมูล
 * guard_cctv_footage_request — หน้านี้แค่บอกผู้ใช้ให้เร็วกว่ารอ error
 * ⚠️ ไม่มีช่องแนบไฟล์โดยตั้งใจ (ใบแจ้งความให้นำมาแสดงตอนรับภาพ) ไม่งั้นต้องหาที่เก็บไฟล์ที่มีข้อมูลบุคคลเพิ่ม
 */
export default function CctvRequestWizard({ tenant, session, onBack }) {
  const navigate = useNavigate()
  const retentionDays = cctvRetentionDays(tenant)
  const today = useMemo(() => cctvBangkokToday(), [])
  const oldest = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d - CCTV_MAX_INCIDENT_AGE_DAYS)).toISOString().slice(0, 10)
  }, [today])

  const [requester, setRequester] = useState({ name: '', phone: '', idCard: '' })
  const [cameras, setCameras] = useState([])
  const [cameraChoice, setCameraChoice] = useState('')
  const [draft, setDraft] = useState({
    incident_type: '', incident_date: '', time_from: '', time_to: '', camera_id: null, camera_label: '',
    description: '', requester_role: '', police_ref: '',
  })
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [done, setDone] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!session) return undefined
    let cancelled = false
    supabase.from('profiles').select('full_name, phone, id_card').eq('id', session.user.id).single()
      .then(({ data }) => {
        if (cancelled || !data) return
        setRequester(current => ({
          name: current.name || data.full_name || '',
          phone: current.phone || data.phone || '',
          idCard: data.id_card || '',
        }))
      })
    return () => { cancelled = true }
  }, [session])

  // จุดกล้องที่ อปท. ลงไว้ในศูนย์ข้อมูล (แสดงบนแผนที่สาธารณะอยู่แล้ว) — อ่านไม่ได้ก็ไม่เป็นไร พิมพ์เองได้
  useEffect(() => {
    if (!tenant?.id) return undefined
    let cancelled = false
    supabase.from('data_center_entries').select('id, name')
      .eq('municipality_id', tenant.id).eq('group_name', 'ปุ่มลอยบนแผนที่').eq('category', 'กล้องวงจรปิด').eq('status', 'active')
      .order('name').limit(200)
      .then(({ data, error }) => { if (!cancelled && !error) setCameras(data ?? []) })
    return () => { cancelled = true }
  }, [tenant?.id])

  const set = key => value => setDraft(current => ({ ...current, [key]: value }))
  const setFromEvent = key => event => set(key)(event.target.value)

  function chooseCamera(value) {
    setCameraChoice(value)
    if (value && value !== OTHER_CAMERA) {
      const camera = cameras.find(item => item.id === value)
      setDraft(current => ({ ...current, camera_id: camera?.id ?? null, camera_label: camera?.name ?? '' }))
    } else {
      setDraft(current => ({ ...current, camera_id: null, camera_label: '' }))
    }
  }

  const { errors } = validateCctvDraft(draft, { today })
  const show = key => (attempted ? errors[key] : undefined)
  const requesterErrors = {
    name: requester.name.trim() ? '' : 'กรุณาระบุชื่อ-สกุลผู้ขอ',
    phone: requester.phone.trim() ? '' : 'กรุณาระบุเบอร์โทรที่เจ้าหน้าที่ติดต่อกลับได้',
  }
  const requesterOk = !requesterErrors.name && !requesterErrors.phone
  const notice = cctvCitizenRetentionNotice({ retentionDays, incidentDate: draft.incident_date, today })
  const showCameraText = cameras.length === 0 || cameraChoice === OTHER_CAMERA

  async function handleSubmit() {
    setAttempted(true)
    setSubmitError('')
    if (!validateCctvDraft(draft, { today }).ok || !requesterOk) return
    setSaving(true)
    const id = crypto.randomUUID()
    const { error } = await supabase.from('document_requests').insert({
      id,
      municipality_id: tenant?.id,
      document_type: CCTV_TYPE,
      requester_name: requester.name.trim(),
      // เลขบัตรเอามาจากบัญชีเท่านั้น (ถ้ามี) ไม่บังคับกรอก — เจ้าหน้าที่ตรวจบัตรตัวจริงตอนส่งมอบภาพ
      requester_id_card: requester.idCard || null,
      requester_phone: requester.phone.trim(),
      requester_address: null,
      purpose: cctvPurposeText(draft),
      status: 'pending',
      user_id: session?.user?.id ?? null,
      fee_amount: null,
      payment_status: 'not_required',
      payment_slip_url: null,
      permit_form_data: buildCctvFormData(draft),
    })
    setSaving(false)
    if (error) { setSubmitError(cctvSubmitErrorText(error)); return }
    notifyTelegram('document_request_created', id)
    setDone({ ref: id.slice(0, 8).toUpperCase() })
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#eef2f7' }}>
        <div className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-50">
            <Video size={30} className="text-cyan-700" />
          </div>
          <h2 className="mb-2 text-lg font-bold text-gray-800">เข้าสู่ระบบก่อนยื่นคำขอ</h2>
          <p className="mb-6 text-sm leading-relaxed text-gray-500">
            ภาพกล้องวงจรปิดมีข้อมูลส่วนบุคคลของคนที่อยู่ในภาพ จึงต้องเข้าสู่ระบบเพื่อให้ทราบว่าใครเป็นผู้ขอ
          </p>
          <button type="button" onClick={() => navigate('/auth', { state: { from: `/doc-request?type=${CCTV_TYPE}` } })}
            className="w-full rounded-2xl bg-cyan-700 py-3.5 text-sm font-bold text-white">
            เข้าสู่ระบบ / สมัครสมาชิก
          </button>
          <button type="button" onClick={onBack} className="mt-2 w-full rounded-2xl py-3 text-sm font-semibold text-gray-500">
            ย้อนกลับ
          </button>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ backgroundColor: '#eef2f7' }}>
        <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 size={32} className="text-emerald-600" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-gray-800">ส่งคำขอแล้ว</h2>
          {/* ⚠️ ห้ามเขียนว่า "จะได้รับภาพ" — การให้ภาพเป็นดุลพินิจของเจ้าหน้าที่ และภาพอาจถูกบันทึกทับไปแล้ว */}
          <p className="mb-5 text-sm leading-relaxed text-gray-500">
            เจ้าหน้าที่จะตรวจสอบคำขอและติดต่อกลับตามเบอร์โทรที่ท่านให้ไว้ ระบบนี้ไม่ส่งภาพให้ทางออนไลน์
            ถ้าได้รับอนุญาต ให้นำบัตรประชาชนตัวจริงมาแสดงที่สำนักงานตอนรับภาพ
          </p>
          <div className="mb-5 rounded-2xl bg-gray-50 p-4">
            <p className="mb-1.5 text-xs text-gray-400">หมายเลขอ้างอิง</p>
            <p className="text-2xl font-bold tracking-widest text-gray-800">{done.ref}</p>
            <button type="button"
              onClick={() => { navigator.clipboard?.writeText(done.ref); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="mx-auto mt-2.5 flex min-h-11 items-center gap-1.5 text-xs text-blue-600">
              {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกเลขอ้างอิง'}
            </button>
          </div>
          <div className="space-y-2.5">
            <button type="button" onClick={() => navigate('/my-docs')}
              className="w-full rounded-2xl bg-cyan-700 py-3.5 text-sm font-bold text-white">
              ดูสถานะคำขอของฉัน
            </button>
            <button type="button" onClick={() => navigate('/')} className="w-full rounded-2xl py-3 text-sm font-semibold text-gray-500">
              กลับหน้าหลัก
            </button>
          </div>
        </div>
      </div>
    )
  }

  const descLeft = CCTV_MAX_DESCRIPTION - draft.description.length

  return (
    <div data-cctv-wizard className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3 shadow-sm">
        <button type="button" onClick={onBack} aria-label="ย้อนกลับ" className="min-h-11 min-w-11 rounded-xl p-2 text-gray-500 hover:bg-gray-100">
          <ArrowLeft size={18} />
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <Video size={21} className="shrink-0 text-cyan-700" />
          <div className="min-w-0">
            <p className="truncate font-bold text-gray-800">ขอภาพจากกล้องวงจรปิด</p>
            <p className="text-xs text-gray-400">{tenant?.name}</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5 pb-10 md:px-8">
        <div role="note" className={'flex gap-2.5 rounded-2xl border p-4 text-xs leading-relaxed '
          + (notice.tone === 'red' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>{notice.text}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
          หน่วยงานไม่รับประกันว่าจะได้ภาพ และจะพิจารณาให้เฉพาะผู้ที่เกี่ยวข้องกับเหตุการณ์หรือพนักงานสอบสวน
          เพราะภาพอาจมีบุคคลอื่นอยู่ในภาพ ระบบนี้รับเฉพาะคำขอ ไม่ส่งภาพให้ทางออนไลน์
        </div>

        <section className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-700">เหตุการณ์</p>
          <Chips label="ประเภทเหตุ" value={draft.incident_type} options={CCTV_INCIDENT_TYPES} onChange={set('incident_type')} error={show('incident_type')} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="วันที่เกิดเหตุ" required error={show('incident_date')}>
              <input type="date" value={draft.incident_date} min={oldest} max={today} onChange={setFromEvent('incident_date')} className={inputCls} />
            </Field>
            <Field label="ตั้งแต่เวลา" required error={show('time_from')}>
              <input type="time" value={draft.time_from} onChange={setFromEvent('time_from')} className={inputCls} />
            </Field>
            <Field label="ถึงเวลา" required error={show('time_to')}>
              <input type="time" value={draft.time_to} onChange={setFromEvent('time_to')} className={inputCls} />
            </Field>
          </div>
          <p className="-mt-1 text-[11px] text-gray-400">
            ขอได้ไม่เกิน {CCTV_MAX_WINDOW_MINUTES / 60} ชั่วโมงในวันเดียว — ระบุช่วงสั้นที่สุดที่จำเป็น เพื่อลดภาพของบุคคลอื่น
          </p>

          {cameras.length > 0 && (
            <Field label="จุดกล้อง" required error={!showCameraText ? show('camera_label') : undefined}>
              <select value={cameraChoice} onChange={event => chooseCamera(event.target.value)} className={inputCls}>
                <option value="">— เลือกจุดกล้อง —</option>
                {cameras.map(camera => <option key={camera.id} value={camera.id}>{camera.name}</option>)}
                <option value={OTHER_CAMERA}>ไม่ทราบ / จุดอื่น — ระบุเอง</option>
              </select>
            </Field>
          )}
          {showCameraText && (
            <Field label={cameras.length > 0 ? 'ระบุสถานที่เกิดเหตุ' : 'จุดกล้อง / สถานที่เกิดเหตุ'} required error={show('camera_label')}>
              <input value={draft.camera_label} maxLength={CCTV_MAX_LABEL} onChange={setFromEvent('camera_label')}
                placeholder="เช่น หน้าร้านค้าตรงข้ามตลาด หมู่ 3" className={inputCls} />
            </Field>
          )}

          <Field label="รายละเอียดเหตุการณ์" required={draft.incident_type === 'other'} error={show('description')}
            hint={`เหลืออีก ${descLeft} ตัวอักษร`}>
            <textarea value={draft.description} maxLength={CCTV_MAX_DESCRIPTION} rows={3} onChange={setFromEvent('description')}
              placeholder="เช่น รถจักรยานยนต์จอดหน้าร้านแล้วหายไป" className={inputCls + ' resize-none'} />
          </Field>
        </section>

        <section className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-700">ผู้ขอ</p>
          <Chips label="ฐานะของผู้ขอ" value={draft.requester_role} options={CCTV_REQUESTER_ROLES} onChange={set('requester_role')} error={show('requester_role')} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="ชื่อ-สกุล" required error={attempted ? requesterErrors.name : ''}>
              <input value={requester.name} onChange={event => setRequester(current => ({ ...current, name: event.target.value }))} className={inputCls} />
            </Field>
            <Field label="เบอร์โทรศัพท์ติดต่อกลับ" required error={attempted ? requesterErrors.phone : ''}>
              <input type="tel" inputMode="tel" value={requester.phone} placeholder="08x-xxx-xxxx"
                onChange={event => setRequester(current => ({ ...current, phone: event.target.value }))} className={inputCls} />
            </Field>
          </div>
          <Field label="เลขที่ใบแจ้งความ (ถ้ามี)" error={show('police_ref')} hint="ไม่ต้องแนบไฟล์ ให้นำใบแจ้งความตัวจริงมาแสดงตอนรับภาพ">
            <input value={draft.police_ref} maxLength={CCTV_MAX_POLICE_REF} onChange={setFromEvent('police_ref')} className={inputCls} />
          </Field>
        </section>

        {submitError && (
          <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-sm font-semibold text-rose-700">{submitError}</p>
        )}
        {attempted && (!validateCctvDraft(draft, { today }).ok || !requesterOk) && !submitError && (
          <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-sm font-semibold text-rose-700">
            ยังกรอกไม่ครบหรือไม่ถูกต้อง กรุณาตรวจช่องที่มีข้อความสีแดง
          </p>
        )}

        <button type="button" onClick={handleSubmit} disabled={saving}
          className="flex w-full min-h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-700 py-3.5 text-sm font-bold text-white disabled:opacity-60">
          {saving ? <Loader2 size={16} className="animate-spin" /> : null}
          {saving ? 'กำลังส่งคำขอ…' : 'ส่งคำขอ'}
        </button>
        <p className="text-center text-xs text-gray-400">เจ้าหน้าที่จะตรวจสอบและโทรกลับตามเบอร์โทรที่ระบุ</p>
      </div>
    </div>
  )
}

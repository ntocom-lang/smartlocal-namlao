import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Loader2, Printer, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { thaiDateFromDateInput, thaiDateTimeText } from '../../lib/thaiDate'
import {
  APPOINTMENT_KINDS, MOBILITY_LEVELS, REQUESTER_RELATIONS, TRIP_TYPES, WORKFLOW_STATUS, optionLabel,
} from '../../lib/patientTransport'
import { buildPatientTransportPacketHtml } from '../../lib/patientTransportPrint'
import {
  SIGNATORY_REGISTRY_SELECT, SIGNATORY_SCOPE,
  pickSignatory, signatoryName, signatoryTitle,
} from '../../lib/documentSignatories'

const textCls = 'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm'

const TONE_CLS = {
  amber:   'bg-amber-50 text-amber-700 border-amber-200',
  blue:    'bg-blue-50 text-blue-700 border-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  red:     'bg-red-50 text-red-700 border-red-200',
  gray:    'bg-gray-100 text-gray-600 border-gray-200',
}

const EVENT_LABEL = {
  created:       'ยื่นคำขอ',
  rejected:      'อปท. ไม่ส่งต่อ',
  forwarded:     'ส่งหนังสือนำส่งแล้ว',
  fund_accepted: 'หน่วยงานผู้จัดรถรับเรื่อง',
  fund_declined: 'หน่วยงานผู้จัดรถไม่รับ',
  completed:     'ปิดเรื่อง',
  cancelled:     'ยกเลิกคำขอ',
}

function todayBangkok() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
}

function hoursUntil(iso) {
  return (new Date(iso).getTime() - Date.now()) / 36e5
}

function Row({ label, children }) {
  if (!children) return null
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-24 shrink-0 text-gray-400">{label}</span>
      <span className="leading-relaxed text-gray-700">{children}</span>
    </div>
  )
}

/**
 * แผงจัดการคำขอรถรับ-ส่งผู้ป่วยฝั่งเจ้าหน้าที่ — แทนที่ปุ่มเปลี่ยนสถานะแบบทั่วไปของ StaffDashboard
 *
 * ⚠️ ห้ามให้ประเภทนี้ใช้ปุ่ม "ดำเนินการเสร็จสิ้น" ตัวกลาง — ปุ่มนั้นจะปิดงานโดยไม่มีเลขหนังสือนำส่ง
 * ทำให้ตรวจย้อนหลังไม่ได้ว่าข้อมูลสุขภาพของผู้ป่วยออกจาก อปท. ไปด้วยหนังสือฉบับไหน
 *
 * ทุกปุ่มยิง RPC ฝั่งฐานข้อมูล ไม่ได้ UPDATE ตารางตรงๆ — ตารางลูกไม่มีสิทธิ์เขียนให้ authenticated
 * และ RPC เป็นที่เดียวที่ตรวจลำดับสถานะและเขียน audit ในธุรกรรมเดียว
 */
export default function PatientTransportPanel({ requestId, onChanged }) {
  // อ่าน อปท. จาก context ไม่รับเป็น prop — แผงนี้ถูกเรนเดอร์ลึกอยู่ใน TaskDetailSheet
  // ถ้าเป็น prop แล้วจุดที่ mount ลืมส่ง หนังสือนำส่งจะพิมพ์ออกมาโดยไม่มีชื่อ อปท. แบบเงียบๆ
  const { tenant } = useTenant()
  const [header, setHeader] = useState(null)
  const [parent, setParent] = useState(null)
  const [events, setEvents] = useState([])
  // ข้อมูลที่ใช้เฉพาะตอนพิมพ์ — โหลดแยกและไม่กันหน้าจอ อ่านไม่ได้ก็ยังทำงานต่อได้
  // (ใบจะพิมพ์ชื่อผู้ลงนามเป็นเส้นจุดให้เขียนมือแทน ซึ่งยังใช้งานได้จริง)
  const [printData, setPrintData] = useState({ department: '', mayor: null, partner: null })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [acting, setActing] = useState(false)
  const [letterNo, setLetterNo] = useState('')
  const [letterDate, setLetterDate] = useState(todayBangkok)
  const [fundContact, setFundContact] = useState('')
  const [fundNote, setFundNote] = useState('')
  const [closeNote, setCloseNote] = useState('')
  const [me, setMe] = useState(null)

  // reloadKey แทนการเรียก load() ตรงๆ ใน effect — setState แบบ synchronous ในตัว effect
  // ทำให้เกิด cascading render (กติกา react-hooks/set-state-in-effect ของโปรเจกต์นี้)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('patient_transport_requests').select('*').eq('request_id', requestId).maybeSingle(),
      supabase.from('document_requests')
        .select('permit_form_data, assigned_to, requester_name, requester_phone, requester_address, created_at')
        .eq('id', requestId).maybeSingle(),
      supabase.from('patient_transport_events')
        .select('id, event_type, actor_name, detail, created_at')
        .eq('request_id', requestId)
        .order('created_at', { ascending: false }),
    ]).then(([headRes, parentRes, eventRes]) => {
      if (cancelled) return
      // ⚠️ แยก "โหลดไม่สำเร็จ" ออกจาก "ไม่มีข้อมูล" — เจ้าหน้าที่ที่เห็นจอว่างตอนเน็ตมีปัญหา
      // จะเข้าใจว่าคำขอนี้ไม่มีรายละเอียด แล้วกดไม่ส่งต่อทิ้ง
      if (headRes.error || parentRes.error) {
        setLoadError((headRes.error ?? parentRes.error).message)
        setLoading(false)
        return
      }
      setLoadError('')
      setHeader(headRes.data)
      setParent(parentRes.data)
      // ประวัติอ่านไม่ได้ไม่กันการทำงาน — เป็นข้อมูลประกอบ ไม่ใช่เงื่อนไขการตัดสินใจ
      setEvents(eventRes.error ? [] : (eventRes.data ?? []))
      setLoading(false)

      const row = headRes.data
      if (!row?.municipality_id) return
      Promise.all([
        row.department_id
          ? supabase.from('departments').select('name').eq('id', row.department_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('document_signatories').select(SIGNATORY_REGISTRY_SELECT)
          .eq('municipality_id', row.municipality_id)
          .eq('document_type', SIGNATORY_SCOPE).eq('is_active', true),
        // ที่อยู่/เบอร์ของหน่วยงานปลายทางอยู่ในทะเบียน ไม่ได้ snapshot ไว้ในคำขอ — หนังสือ
        // ที่พิมพ์ซ้ำภายหลังจึงได้ที่อยู่ปัจจุบันเสมอ ซึ่งถูกต้องกว่าที่อยู่เก่าตอนยื่น
        supabase.from('referral_partners').select('address, phone').eq('id', row.partner_id).maybeSingle(),
      ]).then(([deptRes, signRes, partnerRes]) => {
        if (cancelled) return
        const registry = signRes.data ?? []
        const mayorRow = pickSignatory(registry, { role: 'mayor' })
        setPrintData({
          department: deptRes.data?.name ?? '',
          mayor: mayorRow ? { name: signatoryName(mayorRow), title: signatoryTitle(mayorRow) } : null,
          partner: partnerRes.data ?? null,
        })
      })
    })
    return () => { cancelled = true }
  }, [requestId, reloadKey])

  // สิทธิ์ดำเนินการ — เงื่อนไขต้องตรงกับ assert_patient_transport_actor() ฝั่งฐานข้อมูล
  // ไม่งั้นได้ปุ่มหลอกที่กดแล้ว error
  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      supabase.from('profiles').select('id, role, department_id, municipality_id')
        .eq('id', data.session.user.id).maybeSingle()
        .then(({ data: profile }) => { if (!cancelled) setMe(profile ?? {}) })
    })
    return () => { cancelled = true }
  }, [])

  const canAct = Boolean(
    me && header && (
      me.role === 'superadmin'
      || (me.municipality_id === header.municipality_id && (
        me.role === 'admin'
        || (me.role === 'officer' && (me.department_id ?? null) === (header.department_id ?? null))
        || (me.role === 'staff' && parent?.assigned_to === me.id)
      ))
    ),
  )

  async function run(fn, label) {
    setActing(true)
    const { error } = await fn()
    setActing(false)
    if (error) {
      // ข้อความจาก RAISE EXCEPTION เป็นภาษาไทยอยู่แล้ว แสดงตรงๆ ได้
      alert(`${label}ไม่สำเร็จ: ${error.message}`)
      return
    }
    reload()
    onChanged?.()
  }

  const forward = () => run(() => supabase.rpc('forward_patient_transport_request', {
    p_request_id: requestId,
    p_letter_no: letterNo.trim(),
    p_letter_date: letterDate || null,
  }), 'บันทึกการส่งต่อ')

  const reject = () => {
    const reason = window.prompt('เหตุผลที่ไม่ส่งต่อ (ผู้ยื่นจะเห็นข้อความนี้)')
    if (!reason?.trim()) return undefined
    return run(() => supabase.rpc('reject_patient_transport_request', {
      p_request_id: requestId, p_reason: reason.trim(),
    }), 'ไม่ส่งต่อ')
  }

  const recordResult = accepted => {
    if (!accepted && !fundNote.trim()) {
      alert('กรุณากรอกเหตุผลที่หน่วยงานผู้จัดรถไม่รับ ผู้ยื่นจะเห็นข้อความนี้')
      return undefined
    }
    return run(() => supabase.rpc('record_patient_transport_fund_result', {
      p_request_id: requestId,
      p_accepted: accepted,
      p_note: fundNote.trim() || null,
      p_contact: accepted ? (fundContact.trim() || null) : null,
    }), 'บันทึกผลจากหน่วยงานผู้จัดรถ')
  }

  const complete = () => run(() => supabase.rpc('complete_patient_transport_request', {
    p_request_id: requestId, p_note: closeNote.trim() || null,
  }), 'ปิดเรื่อง')

  const cancel = () => {
    // ยกเลิกหลังส่งต่อ = ข้อมูลอยู่ที่หน่วยงานปลายทางแล้ว เจ้าหน้าที่ต้องแจ้งให้หยุดใช้ข้อมูลเอง
    // ระบบส่งหนังสือแทนไม่ได้ จึงต้องเตือนให้รู้ตัวก่อนกด
    if (header.workflow_status !== 'submitted'
      && !window.confirm(`คำขอนี้ส่งต่อให้ ${header.partner_name_snapshot} แล้ว — หลังยกเลิกต้องแจ้งหน่วยงานนั้นให้ยกเลิกการจัดรถและหยุดใช้ข้อมูลผู้ป่วยด้วย ดำเนินการต่อหรือไม่`)) {
      return undefined
    }
    const reason = window.prompt('เหตุผลที่ยกเลิก (เช่น ผู้ยื่นแจ้งยกเลิกทางโทรศัพท์ / ถอนความยินยอม)')
    if (!reason?.trim()) return undefined
    return run(() => supabase.rpc('cancel_patient_transport_request', {
      p_request_id: requestId, p_reason: reason.trim(),
    }), 'ยกเลิกคำขอ')
  }

  function handlePrint() {
    const html = buildPatientTransportPacketHtml({
      header,
      form: parent?.permit_form_data ?? {},
      parent,
      partner: printData.partner,
      tenant,
      mayor: printData.mayor,
      departmentName: printData.department,
      // เลขอ้างอิง 8 ตัวแรกของ request id — รูปแบบเดียวกับที่ Inbox กับหน้าประชาชนแสดง
      referenceNo: String(requestId ?? '').slice(0, 8).toUpperCase(),
      docDate: parent?.created_at,
      // ต้องเป็น URL เต็ม หน้าต่างพิมพ์เป็น about:blank พาธ /images/... จะ resolve ไม่เจอ
      emblemUrl: `${window.location.origin}/images/garuda.svg`,
    })
    const win = window.open('', '_blank', 'width=860,height=1100')
    if (!win) return
    win.document.write(html)
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 400)
  }

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
  }

  if (loadError) {
    return (
      <div className="m-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center">
        <AlertTriangle size={24} className="mx-auto text-rose-500" />
        <p className="mt-2 text-sm font-semibold text-rose-900">โหลดรายละเอียดคำขอไม่สำเร็จ</p>
        <p className="mt-1 text-xs text-rose-700">{loadError}</p>
        <p className="mt-1 text-xs text-rose-800">ไม่ใช่ว่าคำขอนี้ไม่มีข้อมูล — อย่าเพิ่งกดไม่ส่งต่อ</p>
        <button onClick={reload} className="mt-3 min-h-[44px] rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-700">
          ลองใหม่
        </button>
      </div>
    )
  }

  if (!header) {
    return (
      <div className="m-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
        คำขอนี้ไม่มีข้อมูลการส่งต่อแนบอยู่ — อาจถูกสร้างผิดช่องทาง กรุณาแจ้งผู้ดูแลระบบ
      </div>
    )
  }

  const status = header.workflow_status
  const meta = WORKFLOW_STATUS[status] ?? WORKFLOW_STATUS.submitted
  const form = parent?.permit_form_data ?? {}
  const editStatus = canAct ? status : ''
  const hoursLeft = hoursUntil(header.appointment_at)
  const isOpen = ['submitted', 'forwarded', 'fund_accepted'].includes(status)
  const relation = optionLabel(REQUESTER_RELATIONS, form.requester_relation)

  return (
    <div className="space-y-3 border-t border-gray-100 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${TONE_CLS[meta.tone] ?? TONE_CLS.gray}`}>
          {meta.label}
        </span>
        {header.forward_letter_no && (
          <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs text-gray-600">ที่ {header.forward_letter_no}</span>
        )}
      </div>

      {isOpen && hoursLeft < 24 && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {hoursLeft < 0
            ? 'เลยวันเวลานัดแล้ว — ปิดเรื่องหรือยกเลิกให้ตรงกับความจริง'
            : 'นัดภายใน 24 ชั่วโมง — ควรโทรประสานหน่วยงานผู้จัดรถโดยตรง'}
        </div>
      )}

      {me && !canAct && isOpen && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          ท่านดูเรื่องนี้ได้อย่างเดียว — การส่งต่อต้องเป็นหัวหน้ากองที่รับเรื่อง ผู้ได้รับมอบหมาย
          หรือผู้ดูแลระบบของหน่วยงาน
        </div>
      )}

      <div className="space-y-1.5 rounded-xl bg-gray-50 p-3">
        <Row label="ผู้ยื่น">
          {[parent?.requester_name, parent?.requester_phone && `โทร ${parent.requester_phone}`].filter(Boolean).join(' · ')}
          {relation && ` (${relation}${form.requester_relation_note ? ` — ${form.requester_relation_note}` : ''})`}
        </Row>
        <Row label="ผู้ป่วย">
          {form.patient_name}{form.patient_age != null && ` อายุ ${form.patient_age} ปี`}
        </Row>
        <Row label="เลขที่สมาชิก">{form.fund_member_no || 'ไม่ได้ระบุ'}</Row>
        <Row label="ผู้รับผลประโยชน์ของ">
          {form.beneficiary_of_name
            && `${form.beneficiary_of_name}${form.beneficiary_of_member_no ? ` (สมาชิกเลขที่ ${form.beneficiary_of_member_no})` : ''}`}
        </Row>
        <Row label="จุดรับ">
          {form.pickup_address}{form.pickup_landmark && ` — ${form.pickup_landmark}`}
        </Row>
        <Row label="ปลายทาง">{[form.destination, form.destination_detail].filter(Boolean).join(' ')}</Row>
        <Row label="วันเวลานัด">{thaiDateTimeText(header.appointment_at)}</Row>
        <Row label="ประเภทนัด">
          {optionLabel(APPOINTMENT_KINDS, form.appointment_kind)}
          {form.appointment_kind_note && ` — ${form.appointment_kind_note}`}
        </Row>
        <Row label="การเดินทาง">
          {optionLabel(TRIP_TYPES, form.trip_type)}{form.return_note && ` — ${form.return_note}`}
        </Row>
        <Row label="การเคลื่อนไหว">
          <span className={header.mobility === 'stretcher' ? 'font-bold text-rose-700' : ''}>
            {optionLabel(MOBILITY_LEVELS, header.mobility)}
          </span>
        </Row>
        <Row label="ผู้ติดตาม">{`${form.companions ?? 0} คน`}</Row>
        <Row label="ส่งต่อให้">{header.partner_name_snapshot}</Row>
      </div>

      {/* หลักฐานความยินยอม — ต้องเปิดดูได้ก่อนส่งข้อมูลออกทุกครั้ง */}
      <details className="rounded-xl border border-gray-200 p-3 text-xs text-gray-600">
        <summary className="cursor-pointer font-semibold text-gray-700">
          ความยินยอม {header.consent_version} · {thaiDateTimeText(header.consent_at)}
        </summary>
        <p className="mt-2 leading-relaxed">{form.consent_text || 'ไม่มีข้อความยินยอมในคำขอนี้'}</p>
      </details>

      {header.forward_letter_no && (
        <p className="text-xs text-gray-600">
          ส่งต่อตามหนังสือที่ {header.forward_letter_no}
          {header.forward_letter_date && ` ลงวันที่ ${thaiDateFromDateInput(header.forward_letter_date)}`}
        </p>
      )}
      {header.fund_contact && <p className="text-xs text-gray-600">ติดต่อหน่วยงานผู้จัดรถ: {header.fund_contact}</p>}
      {header.fund_result_note && <p className="text-xs text-gray-600">ผลจากหน่วยงานผู้จัดรถ: {header.fund_result_note}</p>}

      {/* พิมพ์ได้ทุกสถานะ ไม่ใช่เฉพาะตอนยังไม่ส่งต่อ — ใบหายหรือกองทุนขอสำเนาซ้ำเป็นเรื่องปกติ
          และเลขหนังสือที่บันทึกไว้แล้วจะถูกพิมพ์ลงช่อง "ที่" ให้เอง ใบที่พิมพ์ซ้ำจึงตรงกับต้นเรื่อง */}
      <button onClick={handlePrint}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-700">
        <Printer size={15} /> พิมพ์หนังสือนำส่ง + ใบคำขอ (2 แผ่น)
      </button>

      {/* ── ส่งต่อ ─────────────────────────────────────────────────────── */}
      {editStatus === 'submitted' && (
        <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
          <p className="text-xs font-semibold text-blue-900">
            พิมพ์หนังสือนำส่งพร้อมใบคำขอ ลงนาม แล้วบันทึกเลขหนังสือตามทะเบียนหนังสือส่ง
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-blue-800">เลขที่หนังสือนำส่ง</label>
              <input className={textCls} value={letterNo} onChange={e => setLetterNo(e.target.value)}
                placeholder="เช่น ทก 72301/123" maxLength={40} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-blue-800">ลงวันที่</label>
              <input className={textCls} type="date" value={letterDate} max={todayBangkok()}
                onChange={e => setLetterDate(e.target.value)} />
            </div>
          </div>
          <button onClick={forward} disabled={acting || !letterNo.trim()}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 text-sm font-bold text-white disabled:opacity-50">
            {acting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            บันทึกว่าส่งหนังสือนำส่งแล้ว
          </button>
          <button onClick={reject} disabled={acting}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-red-600">
            <XCircle size={16} /> ไม่ส่งต่อ (ข้อมูลไม่ครบ / นอกพื้นที่ / เป็นเหตุฉุกเฉิน)
          </button>
        </div>
      )}

      {/* ── ผลจากหน่วยงานผู้จัดรถ ──────────────────────────────────────── */}
      {editStatus === 'forwarded' && (
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-900">บันทึกผลเมื่อหน่วยงานผู้จัดรถแจ้งกลับ</p>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-emerald-800">
              ช่องทางติดต่อที่ให้แจ้งผู้ยื่น (กรณีรับ)
            </label>
            {/* ควรเป็นเบอร์ของหน่วยงาน ไม่ใช่เบอร์ส่วนตัวอาสา — ผู้ยื่นทุกคนเห็นช่องนี้ */}
            <input className={textCls} value={fundContact} onChange={e => setFundContact(e.target.value)}
              placeholder="เช่น โทรกองทุน 08x-xxx-xxxx" maxLength={200} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-emerald-800">
              หมายเหตุ / เหตุผลที่ไม่รับ (ผู้ยื่นเห็นข้อความนี้)
            </label>
            <input className={textCls} value={fundNote} onChange={e => setFundNote(e.target.value)} maxLength={500} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={() => recordResult(true)} disabled={acting}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50">
              {acting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              หน่วยงานรับจัดรถ
            </button>
            <button onClick={() => recordResult(false)} disabled={acting}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white text-sm font-semibold text-red-600 disabled:opacity-50">
              <XCircle size={16} /> หน่วยงานไม่รับ
            </button>
          </div>
        </div>
      )}

      {/* ── ปิดเรื่อง ──────────────────────────────────────────────────── */}
      {editStatus === 'fund_accepted' && (
        <div className="space-y-2">
          <input className={textCls} value={closeNote} onChange={e => setCloseNote(e.target.value)}
            placeholder="บันทึกภายใน (ถ้ามี)" maxLength={1000} />
          <button onClick={complete} disabled={acting}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50">
            {acting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            เดินทางเรียบร้อย — ปิดเรื่อง
          </button>
        </div>
      )}

      {canAct && isOpen && (
        <button onClick={cancel} disabled={acting}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 disabled:opacity-50">
          ยกเลิกคำขอ (ตามที่ผู้ยื่นแจ้ง / ถอนความยินยอม)
        </button>
      )}

      {!isOpen && (
        <div className="rounded-xl bg-gray-50 p-3 text-center text-xs text-gray-500">
          {status === 'completed' ? 'เดินทางเรียบร้อย ปิดเรื่องแล้ว' : (header.reject_reason || header.fund_result_note || meta.label)}
        </div>
      )}

      {events.length > 0 && (
        <details className="rounded-xl border border-gray-100 p-3 text-xs text-gray-500">
          <summary className="cursor-pointer font-semibold text-gray-600">ประวัติการดำเนินการ ({events.length})</summary>
          <ul className="mt-2 space-y-1">
            {events.map(event => (
              <li key={event.id}>
                {thaiDateTimeText(event.created_at)} · {EVENT_LABEL[event.event_type] ?? event.event_type}
                {event.actor_name && ` · ${event.actor_name}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

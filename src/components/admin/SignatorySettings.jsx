import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Save, Trash2, UserRoundCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { SIGNATORY_SCOPE, todayBangkok } from '../../lib/documentSignatories'

function assignmentKey(role, departmentId = null) {
  return `${role}:${departmentId ?? 'organization'}`
}

function personTitle(person) {
  return person?.job_title || person?.position?.name || 'ไม่ระบุตำแหน่ง'
}

function assignmentState(assignment, optional = false) {
  // แถวที่ไม่บังคับยังไม่ตั้ง = ปกติ ไม่ใช่ปัญหา จึงไม่ขึ้นสีเตือนและไม่ถูกนับว่าขาด
  if (!assignment) return { ready: optional, label: optional ? 'ไม่ได้มอบอำนาจ' : 'ยังไม่ตั้ง' }
  const today = todayBangkok()
  if (assignment.effective_from > today) return { ready: false, label: 'ยังไม่ถึงวันเริ่ม' }
  if (assignment.effective_to && assignment.effective_to < today) return { ready: false, label: 'หมดอายุ' }
  return { ready: true, label: 'พร้อมใช้งาน' }
}

async function fetchSignatorySettings(municipalityId) {
  const [departmentResult, peopleResult, assignmentResult] = await Promise.all([
    supabase.from('departments').select('id,code,name,sort_order').eq('municipality_id', municipalityId).eq('is_active', true).order('sort_order'),
    supabase.from('profiles')
      .select('id,full_name,job_title,role,department_id,position:positions(name,category),department:departments(name)')
      .eq('municipality_id', municipalityId)
      .in('role', ['admin', 'officer', 'staff', 'technician', 'viewer'])
      .order('full_name'),
    supabase.from('document_signatories').select('*')
      .eq('municipality_id', municipalityId).eq('document_type', SIGNATORY_SCOPE).eq('is_active', true),
  ])
  return { departmentResult, peopleResult, assignmentResult }
}

// รายการนี้ยาวตามจำนวนกองของแต่ละ อปท. (บางแห่ง 8-10 กอง) การ์ดเต็มใบต่อผู้ลงนามหนึ่งคน
// ทำให้ต้องเลื่อนจอหลายหน้ากว่าจะเห็นครบ จึงยุบเหลือแถวละคนแบบตาราง แล้ว stack เฉพาะจอมือถือ
const FIELD_CLASS = 'w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 focus:outline-none focus:border-indigo-400'
const GRID_CLASS = 'grid gap-2 md:grid-cols-[minmax(160px,1.2fr)_minmax(210px,1.6fr)_minmax(150px,1.2fr)_auto]'

function SignatoryRow({ slot, people, assignment, onSaved }) {
  const [sourceMode, setSourceMode] = useState(assignment?.manual_name ? 'manual' : 'profile')
  const [profileId, setProfileId] = useState(assignment?.profile_id ?? '')
  const [manualName, setManualName] = useState(assignment?.manual_name ?? '')
  const [titleOverride, setTitleOverride] = useState(assignment?.title_override ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selected = sourceMode === 'profile' ? people.find((person) => person.id === profileId) : null
  // ต้องมี selected ก่อน มิฉะนั้น undefined !== departmentId จะทำให้แถวหัวหน้ากอง
  // ขึ้นคำเตือน 'อยู่นอกกอง' ตั้งแต่ยังไม่ได้เลือกใครเลย
  const crossDepartment = sourceMode === 'profile' && Boolean(slot.departmentId) && Boolean(selected)
    && selected.department_id !== slot.departmentId
  const status = assignmentState(assignment, slot.optional)
  const identityReady = sourceMode === 'manual' ? Boolean(manualName.trim() && titleOverride.trim()) : Boolean(profileId)

  // title_override ใช้ร่วมสองโหมดแต่มีความหมายต่างกัน: โหมด manual คือตำแหน่งบังคับของคนนอกระบบ
  // ส่วนโหมด profile คือการ "ทับ" ตำแหน่งจริงในโปรไฟล์ ถ้าไม่ล้างตอนสลับโหมด ตำแหน่งที่พิมพ์ไว้
  // สำหรับคนนอกระบบจะติดไปประทับทับตำแหน่งของบุคลากรที่เลือกใหม่โดยผู้ใช้ไม่รู้ตัว
  // (profile_id/manual_name ถูกกันด้วย sourceMode ตอนส่งอยู่แล้ว ที่รั่วคือช่องนี้ช่องเดียว)
  function switchMode(nextMode) {
    if (nextMode === sourceMode) return
    setSourceMode(nextMode)
    setError('')
    setTitleOverride(nextMode === (assignment?.manual_name ? 'manual' : 'profile')
      ? (assignment?.title_override ?? '')
      : '')
  }

  async function save() {
    if (sourceMode === 'profile' && !profileId) { setError('กรุณาเลือกผู้ลงนาม'); return }
    if (sourceMode === 'manual' && !manualName.trim()) { setError('กรุณากรอกชื่อ-นามสกุลผู้ลงนาม'); return }
    if (sourceMode === 'manual' && !titleOverride.trim()) { setError('กรุณากรอกตำแหน่งที่ต้องการพิมพ์'); return }
    setSaving(true)
    setError('')
    // ต้องส่งครบทุก argument แม้ตัวที่หน้าจอไม่ให้กรอกแล้ว: PostgREST เลือกฟังก์ชันจากชุดชื่อ argument
    // ที่ส่งไป ถ้าละตัวที่มี DEFAULT ไว้จะเสี่ยงได้ PGRST202 "Could not find the function ... in the
    // schema cache" ซึ่งอ่านไม่ออกว่าเกิดจากอะไร ในโปรเจกต์นี้ยังไม่มี RPC ตัวไหนละ argument เลย
    //
    // ส่ง p_effective_from เป็น null โดยตั้งใจ — ให้ DB coalesce เป็นวันนี้ตามเวลา Asia/Bangkok
    // จะได้ไม่ต้องพึ่งนาฬิกาของเครื่องผู้ใช้ ส่วนเลขที่คำสั่ง/วันสิ้นสุดไม่ใช้แล้ว ผู้ดูแลเปลี่ยนตัว
    // ผู้ลงนามเองเมื่อมีคำสั่งใหม่
    const { error: saveError } = await supabase.rpc('set_document_signatory_v2', {
      p_municipality_id: slot.municipalityId,
      p_signatory_role: slot.role,
      p_department_id: slot.departmentId,
      p_profile_id: sourceMode === 'profile' ? profileId : null,
      p_manual_name: sourceMode === 'manual' ? manualName.trim() : null,
      p_title_override: titleOverride.trim() || null,
      p_authority_reference: null,
      p_effective_from: null,
      p_effective_to: null,
    })
    setSaving(false)
    if (saveError) {
      // PGRST202 = ฟังก์ชันไม่มีใน schema cache ซึ่งเกือบทุกครั้งแปลว่า migration ยังไม่ถูก apply
      // ข้อความดิบของ PostgREST อ่านแล้วไม่รู้ว่าต้องทำอะไรต่อ จึงแปลให้เป็นคำสั่งที่ลงมือได้จริง
      setError(saveError.code === 'PGRST202'
        ? 'ยังไม่ได้ติดตั้งฟังก์ชันบันทึกผู้ลงนามในฐานข้อมูล (migration 20260901170000) กรุณาแจ้งผู้ดูแลระบบให้ apply ก่อน'
        : saveError.message)
      return
    }
    await onSaved()
  }

  async function clear() {
    if (!assignment || !window.confirm(`ยกเลิกผู้ลงนาม “${slot.label}”?`)) return
    setSaving(true)
    setError('')
    const { error: clearError } = await supabase.rpc('clear_document_signatory', {
      p_municipality_id: slot.municipalityId,
      p_signatory_role: slot.role,
      p_department_id: slot.departmentId,
    })
    setSaving(false)
    if (clearError) { setError(clearError.message); return }
    await onSaved()
  }

  return (
    <div className={`${GRID_CLASS} border-b border-gray-100 px-3 py-2.5 md:items-start ${status.ready ? 'bg-emerald-50/30' : 'bg-amber-50/30'}`}>
      <div className="min-w-0 md:pt-1">
        <div className="flex items-center gap-1.5">
          {status.ready
            ? <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />
            : <AlertTriangle size={13} className="shrink-0 text-amber-600" />}
          <span className="truncate text-xs font-bold text-gray-800" title={slot.label}>{slot.label}</span>
        </div>
        <span className={`mt-0.5 ml-5 inline-block text-[10px] font-semibold ${status.ready ? 'text-emerald-700' : 'text-amber-700'}`}>
          {status.label}
        </span>
        {slot.hint && (
          <p className="ml-5 mt-0.5 text-[10px] leading-tight text-gray-400">{slot.hint}</p>
        )}
      </div>

      <div className="min-w-0">
        <div className="mb-1 grid grid-cols-2 gap-0.5 rounded-lg bg-gray-100 p-0.5">
          <button type="button" onClick={() => switchMode('profile')}
            className={`rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors ${sourceMode === 'profile' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'}`}>
            เลือกจากบุคลากร
          </button>
          <button type="button" onClick={() => switchMode('manual')}
            className={`rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors ${sourceMode === 'manual' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'}`}>
            กรอกชื่อเอง
          </button>
        </div>
        {sourceMode === 'profile' ? (
          <select value={profileId} onChange={(event) => setProfileId(event.target.value)}
            aria-label={`ผู้ลงนาม ${slot.label}`} className={FIELD_CLASS}>
            <option value="">— เลือกบุคลากร —</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name} · {personTitle(person)}{person.department?.name ? ` · ${person.department.name}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <input value={manualName} onChange={(event) => setManualName(event.target.value)}
            placeholder="ชื่อ-นามสกุลผู้ลงนาม *" maxLength={250}
            title="ใช้สำหรับผู้ลงนามที่ไม่มีบัญชีในระบบ"
            aria-label={`ชื่อผู้ลงนาม ${slot.label}`} className={FIELD_CLASS} />
        )}
        {/* เตือนอย่างเดียว ไม่บล็อกการบันทึก — การให้คนนอกกองรักษาราชการแทนเป็นเรื่องปกติ
            แต่ถ้าเลือกผิดคนจะได้เห็นก่อนกดบันทึก */}
        {crossDepartment && (
          <p className="mt-1 text-[10px] font-medium leading-tight text-amber-700">
            ไม่ได้สังกัด {slot.departmentName} — ระบุคำว่า “รักษาราชการแทน” หรือ “ปฏิบัติราชการแทน”
            ในช่องตำแหน่งที่พิมพ์ได้ (คนละกรณีกัน ตรวจถ้อยคำกับคำสั่งจริงก่อน)
          </p>
        )}
      </div>

      <div className="min-w-0">
        <span className="mb-0.5 block text-[10px] font-semibold text-gray-500 md:hidden">
          ชื่อตำแหน่งที่พิมพ์{sourceMode === 'manual' ? ' *' : ''}
        </span>
        <input value={titleOverride} onChange={(event) => setTitleOverride(event.target.value)}
          placeholder={sourceMode === 'manual' ? 'ตำแหน่งที่พิมพ์ *' : selected ? personTitle(selected) : 'ตำแหน่งจากโปรไฟล์'}
          maxLength={250} aria-label={`ชื่อตำแหน่งที่พิมพ์ ${slot.label}`} className={FIELD_CLASS} />
      </div>

      <div className="flex items-center justify-end gap-1 md:pt-0.5">
        <button type="button" onClick={save} disabled={saving || !identityReady}
          title="บันทึกผู้ลงนาม"
          className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-40">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          <span className="md:hidden">บันทึกผู้ลงนาม</span>
        </button>
        {assignment && (
          <button type="button" onClick={clear} disabled={saving} title="ยกเลิกผู้ลงนาม"
            className="flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-red-600 disabled:opacity-40">
            <Trash2 size={12} />
            <span className="md:hidden">ยกเลิก</span>
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700 md:col-span-4">{error}</p>
      )}
    </div>
  )
}

export default function SignatorySettings({ tenant }) {
  const [departments, setDepartments] = useState([])
  const [people, setPeople] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function applyResults({ departmentResult, peopleResult, assignmentResult }) {
    const firstError = departmentResult.error || peopleResult.error || assignmentResult.error
    if (firstError) setError(firstError.message)
    else setError('')
    setDepartments(departmentResult.data ?? [])
    setPeople((peopleResult.data ?? []).filter((person) => person.full_name?.trim()))
    setAssignments(assignmentResult.data ?? [])
    setLoading(false)
  }

  async function reload() {
    if (!tenant?.id) return
    setLoading(true)
    applyResults(await fetchSignatorySettings(tenant.id))
  }

  useEffect(() => {
    if (!tenant?.id) return undefined
    let active = true
    fetchSignatorySettings(tenant.id).then((results) => {
      if (active) applyResults(results)
    })
    return () => { active = false }
  }, [tenant?.id])

  const slots = useMemo(() => [
    { key: assignmentKey('mayor'), role: 'mayor', municipalityId: tenant?.id, departmentId: null, label: 'นายก' },
    { key: assignmentKey('clerk'), role: 'clerk', municipalityId: tenant?.id, departmentId: null, label: 'ปลัด' },
    // ตั้งเฉพาะเมื่อนายกมีคำสั่งมอบอำนาจการสั่งใช้รถให้ผู้อื่น (รองนายก/ปลัด/รองปลัด)
    // optional = true จึงไม่ถูกนับว่า "ขาด" — อปท. ส่วนใหญ่ไม่ได้มอบอำนาจ ถ้านับด้วย
    // ทุกแห่งจะเห็นป้ายเตือนค้างตลอดทั้งที่ตั้งค่าครบแล้ว
    { key: assignmentKey('vehicle_authority'), role: 'vehicle_authority', municipalityId: tenant?.id,
      departmentId: null, label: 'ผู้มีอำนาจสั่งใช้รถ', optional: true,
      hint: 'เฉพาะกรณีมีคำสั่งมอบอำนาจ ไม่ตั้งก็ได้ — ใบขออนุญาตใช้รถจะใช้นายกตามปกติ' },
    ...departments
      .filter((department) => department.code !== 'exec')
      .map((department) => ({
        key: assignmentKey('department_head', department.id),
        role: 'department_head', municipalityId: tenant?.id,
        departmentId: department.id, departmentName: department.name,
        // ใช้ชื่อกองตรงๆ ห้ามเติมคำว่า "หัวหน้า" นำหน้า — หน่วยงานอย่าง "ตรวจสอบภายใน"
        // ส่วนใหญ่ขึ้นตรงกับปลัดและไม่มีตำแหน่งหัวหน้า ป้ายที่เติมเองจึงผิดกับ อปท. จำนวนมาก
        // ผลพลอยได้: ข้อความนี้กลายเป็นข้อมูล ไม่ใช่โค้ด ผู้ดูแลแก้เองได้ที่หน้าจัดการกอง/ส่วนราชการ
        label: department.name,
      })),
  ], [departments, tenant?.id])

  const assignmentMap = useMemo(() => Object.fromEntries(
    assignments.map((assignment) => [assignmentKey(assignment.signatory_role, assignment.department_id), assignment]),
  ), [assignments])

  const missingCount = slots.filter((slot) => !assignmentState(assignmentMap[slot.key], slot.optional).ready).length

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-3">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-indigo-100 p-2 text-indigo-700"><UserRoundCheck size={20} /></div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-gray-800">ผู้ลงนามเอกสาร</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            ทะเบียนกลางที่ทุกโมดูลดึงไปใช้ ตั้งที่นี่ที่เดียวแล้วมีผลกับทุกเอกสารที่ต้องลงนาม
            ปัจจุบันใช้กับ แบบพิมพ์คำร้อง และ ใบขออนุญาตใช้รถส่วนกลาง (แบบ 3)
            นายก/ปลัด ใช้กับทุกใบ ส่วนแถวของแต่ละกองใช้เฉพาะเอกสารที่ route เข้ากองนั้น
            (ชื่อแถวมาจากหน้าจัดการกอง/ส่วนราชการ แก้ที่นั่นแล้วเปลี่ยนตามทันที)
            เลือกจากบัญชีบุคลากรหรือกรอกชื่อและตำแหน่งเองสำหรับผู้ที่ไม่มีบัญชี
            โดยไม่เกี่ยวกับผู้รับผิดชอบลงพื้นที่หรือสิทธิ์เข้าเมนู
          </p>
        </div>
        {!loading && (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${missingCount ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {missingCount ? `ขาด ${missingCount} ตำแหน่ง` : 'พร้อมใช้งาน'}
          </span>
        )}
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">⚠️ {error}</p>}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
      ) : (
        <div className="md:overflow-x-auto">
          <div className="rounded-xl border border-gray-200 md:min-w-180">
            <div className={`${GRID_CLASS} hidden border-b border-gray-200 bg-gray-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500 md:grid`}>
              <span>ผู้ลงนามประจำ</span>
              <span>ผู้ลงนาม *</span>
              <span>ชื่อตำแหน่งที่พิมพ์</span>
              <span className="text-right">จัดการ</span>
            </div>
            {slots.map((slot) => (
              <SignatoryRow key={`${slot.key}:${assignmentMap[slot.key]?.id ?? 'empty'}`} slot={slot} people={people}
                assignment={assignmentMap[slot.key]} onSaved={reload} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

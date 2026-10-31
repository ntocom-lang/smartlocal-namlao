import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, PenLine, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  appointmentSuggestion, CUSTOM_ROLE, departmentSlotMeta, earliestEffectiveFrom, effectiveDateForForm, groupPeopleByDepartment,
  SIGNATORY_BACKDATE_LIMIT_DAYS, SIGNING_EFFECT_TEXT, signatoryChangeFor, signatoryName, signatorySlotKey, signatorySuggestionState, signatoryTitle,
  SUGGESTABLE_KINDS, todayBangkok,
} from '../../lib/documentSignatories'
import { clearSignatory, fetchActiveSignatories, saveSignatory } from '../../lib/signatoryApi'
import { thaiDateFromDateInput } from '../../lib/thaiDate'
import SignatoryApplyDialog from './SignatoryApplyDialog'
import SigningDialogShell from './SigningDialogShell'

// หน้า "ผู้ลงนามแต่ละช่อง" — เปิดมาเป็นตารางอ่าน บอกว่าแต่ละช่องใครลงชื่อ และขั้นต่อไปต้องทำอะไร (เจ้าของระบบอนุมัติ 2569-10-30)
// เดิมเป็นฟอร์มเต็มทุกแถว แถวละ 4-5 ช่อง บันทึกทีละแถว แอดมินไม่รู้ว่าต้องเริ่มตรงไหน
// ตอนนี้: ระบบเตรียมชื่อจากการแต่งตั้ง → แอดมินตรวจแล้วกดยืนยันครั้งเดียว (SignatoryApplyDialog)
//        กรณีพิเศษ (คนไม่มีบัญชี / ผู้แทน / วันมีผลย้อนหลัง / ผู้มีอำนาจสั่งใช้รถ) อยู่ในกล่อง "แก้" รายช่อง

// ต้องรวม customLabel ด้วย เพราะบทบาท custom มีได้หลายแถวต่อ อปท. ถ้าคีย์ชนกัน
// ทุกแถวที่แอดมินสร้างเองจะแสดงค่าของแถวเดียวกันหมด
function assignmentKey(role, departmentId = null, customLabel = null) {
  return signatorySlotKey({ role, departmentId, customLabel })
}

function personTitle(person) {
  return person?.job_title || person?.position?.name || 'ไม่ระบุตำแหน่ง'
}

function assignmentState(assignment, optional = false, emptyLabel = 'ไม่ได้มอบอำนาจ') {
  // แถวที่ไม่บังคับยังไม่ตั้ง = ปกติ ไม่ใช่ปัญหา จึงไม่ขึ้นสีเตือนและไม่ถูกนับว่าขาด
  if (!assignment) return { ready: optional, label: optional ? emptyLabel : 'ยังไม่ตั้ง' }
  const today = todayBangkok()
  if (assignment.effective_from > today) return { ready: false, label: 'ยังไม่ถึงวันเริ่ม' }
  if (assignment.effective_to && assignment.effective_to < today) return { ready: false, label: 'หมดอายุ' }
  return { ready: true, label: 'พร้อมใช้งาน' }
}

async function fetchSignatorySettings(municipalityId) {
  const [departmentResult, peopleResult, assignmentResult] = await Promise.all([
    supabase.from('departments').select('id,code,name,sort_order').eq('municipality_id', municipalityId).eq('is_active', true).order('sort_order'),
    // ตำแหน่งใช้เสนอชื่อตามการแต่งตั้ง · is_dept_head ใช้ตัดสินเฉพาะเมื่อมีผู้ถือตำแหน่งหลายคน (appointmentSuggestion)
    supabase.from('profiles')
      .select('id,full_name,job_title,role,department_id,is_dept_head,position:positions(name,category),department:departments(name)')
      .eq('municipality_id', municipalityId)
      .in('role', ['admin', 'officer', 'staff', 'technician', 'viewer'])
      .order('full_name'),
    fetchActiveSignatories(municipalityId),
  ])
  return { departmentResult, peopleResult, assignmentResult }
}

const FIELD_CLASS = 'min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400'
const HELP_CLASS = 'mt-1 text-xs leading-5 text-gray-500'
// จอใหญ่เรียงเป็นตาราง มือถือซ้อนเป็นการ์ด — รายการยาวตามจำนวนกอง (บางแห่ง 8-10 กอง)
const GRID_CLASS = 'grid gap-2.5 md:grid-cols-[minmax(130px,0.8fr)_minmax(190px,1.3fr)_minmax(230px,1.6fr)_108px] md:gap-3'

// กล่องแก้ผู้ลงนามรายช่อง — กรณีที่ระบบเสนอชื่อให้ไม่ได้ หรือต้องการมากกว่าการใช้ชื่อตามการแต่งตั้ง
function SignatoryEditDialog({ slot, people, departments, assignment, suggestion, onClose, onSaved }) {
  const [sourceMode, setSourceMode] = useState(assignment?.manual_name ? 'manual' : 'profile')
  const [profileId, setProfileId] = useState(assignment?.profile_id ?? '')
  const [manualName, setManualName] = useState(assignment?.manual_name ?? '')
  const [titleOverride, setTitleOverride] = useState(assignment?.title_override ?? '')
  const [vehicleDefault, setVehicleDefault] = useState(Boolean(assignment?.is_vehicle_order_default))
  // วันที่แอดมินเลือกเองในช่อง "มีผลตั้งแต่" ('' = ยังไม่ได้แตะ ใช้ค่าอัตโนมัติด้านล่าง)
  const [pickedDate, setPickedDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const today = todayBangkok()
  const earliest = earliestEffectiveFrom(today)
  // แก้อะไรไปจากที่บันทึกไว้บ้าง — บันทึกทุกครั้ง = ปิดแถวเดิมแล้วสร้างแถวใหม่ จึงไม่ให้กดบันทึกถ้าไม่ได้แก้อะไร
  // (2569-10-07 หน้าจอดูเหมือนบันทึกไม่ติด แอดมินกดซ้ำจนเกิดแถวประวัติเกินมา 3 แถว)
  const changedFromSaved = !assignment
    || sourceMode !== (assignment.manual_name ? 'manual' : 'profile')
    || (sourceMode === 'profile'
      ? profileId !== (assignment.profile_id ?? '')
      : manualName.trim() !== (assignment.manual_name ?? '').trim())
    || titleOverride.trim() !== (assignment.title_override ?? '').trim()
    || vehicleDefault !== Boolean(assignment.is_vehicle_order_default)
  // วันที่ในช่อง "มีผลตั้งแต่" + ปุ่มบันทึกกดได้ไหม + กำลังบันทึกย้อนหลังไหม — กติกาอยู่ที่ effectiveDateForForm
  const { value: effectiveFrom, dirty, backdated } = effectiveDateForForm({
    savedFrom: assignment?.effective_from ?? null, changed: changedFromSaved, picked: pickedDate, today,
  })
  const selected = sourceMode === 'profile' ? people.find((person) => person.id === profileId) : null
  // แยกกลุ่มตามกอง แถวหัวหน้ากองเริ่มที่กองของตัวเอง — ชื่อกองอยู่ที่หัวกลุ่ม จึงไม่ต้องซ้ำท้ายชื่อทุกคน
  const peopleGroups = useMemo(
    () => groupPeopleByDepartment(people, departments, slot.departmentId),
    [people, departments, slot.departmentId])
  // ต้องมี selected ก่อน มิฉะนั้น undefined !== departmentId จะทำให้แถวหัวหน้ากอง
  // ขึ้นคำเตือน 'อยู่นอกกอง' ตั้งแต่ยังไม่ได้เลือกใครเลย
  const crossDepartment = sourceMode === 'profile' && Boolean(slot.departmentId) && Boolean(selected)
    && selected.department_id !== slot.departmentId
  const identityReady = sourceMode === 'manual' ? Boolean(manualName.trim() && titleOverride.trim()) : Boolean(profileId)
  const suggested = signatorySuggestionState(assignment, suggestion)
  const suggestionPicked = Boolean(suggested.person) && sourceMode === 'profile' && profileId === suggested.person.id

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

  // เติมในฟอร์มเท่านั้น ยังไม่บันทึกจนกว่าจะกดบันทึก
  function applySuggestion() {
    if (!suggested.person) return
    switchMode('profile')
    setProfileId(suggested.person.id)
  }

  async function save() {
    if (sourceMode === 'profile' && !profileId) { setError('กรุณาเลือกผู้ลงนาม'); return }
    if (sourceMode === 'manual' && !manualName.trim()) { setError('กรุณากรอกชื่อ-นามสกุลผู้ลงนาม'); return }
    if (sourceMode === 'manual' && !titleOverride.trim()) { setError('กรุณากรอกตำแหน่งที่ต้องการพิมพ์'); return }
    if (!dirty) return
    if (effectiveFrom > today) { setError('วันที่มีผลต้องไม่เกินวันนี้'); return }
    if (backdated && effectiveFrom < earliest) {
      setError(`วันที่มีผลย้อนหลังได้ไม่เกิน ${SIGNATORY_BACKDATE_LIMIT_DAYS} วัน (เลือกได้ตั้งแต่ ${thaiDateFromDateInput(earliest)})`)
      return
    }
    // ตั้งย้อนหลัง = ชื่อบนเอกสารที่เสร็จไปแล้วเปลี่ยนตาม ต้องให้แอดมินเห็นผลก่อนกดยืนยันทุกครั้ง
    if (backdated) {
      const who = sourceMode === 'manual' ? manualName.trim() : selected?.full_name
      const confirmed = window.confirm(
        `ตั้ง “${who}” เป็นผู้ลงนามช่อง “${slot.label}” มีผลย้อนหลังตั้งแต่ ${thaiDateFromDateInput(effectiveFrom)}\n\n`
        + 'เอกสารที่เสร็จตั้งแต่วันนั้นจะพิมพ์ชื่อนี้แทนคนเดิมเมื่อพิมพ์ซ้ำ\n'
        + 'เอกสารที่เสร็จก่อนวันนั้นไม่เปลี่ยน\n\nยืนยัน?')
      if (!confirmed) return
    }
    setSaving(true)
    setError('')
    const { error: saveError } = await saveSignatory({
      municipalityId: slot.municipalityId,
      slot,
      profileId: sourceMode === 'profile' ? profileId : null,
      manualName: sourceMode === 'manual' ? manualName.trim() : null,
      titleOverride: titleOverride.trim() || null,
      effectiveFrom: backdated ? effectiveFrom : null,
      vehicleDefault,
    })
    setSaving(false)
    if (saveError) {
      // PGRST202 = ฟังก์ชันไม่มีใน schema cache ซึ่งเกือบทุกครั้งแปลว่า migration ยังไม่ถูก apply
      // ข้อความดิบของ PostgREST อ่านแล้วไม่รู้ว่าต้องทำอะไรต่อ จึงแปลให้เป็นคำสั่งที่ลงมือได้จริง
      setError(saveError.code === 'PGRST202'
        ? 'ยังไม่ได้ติดตั้งฟังก์ชันบันทึกผู้ลงนามในฐานข้อมูล (migration 20260904180000) กรุณาแจ้งผู้ดูแลระบบให้ apply ก่อน'
        : saveError.message)
      return
    }
    await onSaved(`บันทึกผู้ลงนามช่อง “${slot.label}” แล้ว`)
  }

  async function clear() {
    if (!assignment || !window.confirm(
      `ยกเลิกผู้ลงนามช่อง “${slot.label}”?\n\nเรื่องที่ยังไม่เสร็จจะเว้นชื่อให้เขียนด้วยมือ\nเรื่องที่เสร็จแล้วคงชื่อเดิม`)) return
    setSaving(true)
    setError('')
    const { error: clearError } = await clearSignatory({ municipalityId: slot.municipalityId, slot })
    setSaving(false)
    if (clearError) { setError(clearError.message); return }
    await onSaved(`ยกเลิกผู้ลงนามช่อง “${slot.label}” แล้ว`)
  }

  return (
    <SigningDialogShell testId="signatory-edit-dialog" title={`ผู้ลงนามช่อง “${slot.label}”`} subtitle={slot.hint}
      closeDisabled={saving} onClose={onClose}
      footer={(
        <div className="space-y-2">
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
          {dirty && !backdated && identityReady && <p className="text-xs font-semibold leading-5 text-slate-600">{SIGNING_EFFECT_TEXT}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {assignment && (
              <button type="button" onClick={clear} disabled={saving} data-signatory-clear
                className="flex min-h-11 items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40">
                <Trash2 size={15} /> ยกเลิกผู้ลงนามช่องนี้
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={onClose} disabled={saving}
                className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                ปิด
              </button>
              <button type="button" onClick={save} disabled={saving || !identityReady || !dirty} data-signatory-save
                className="flex min-h-11 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึก
              </button>
            </div>
          </div>
          {/* ปุ่มที่กดไม่ได้ต้องบอกเหตุผลบนจอ มือถือไม่มี tooltip */}
          {!identityReady ? (
            <p className="text-right text-xs text-gray-500">
              {sourceMode === 'manual' ? 'กรอกชื่อและตำแหน่งก่อนจึงบันทึกได้' : 'เลือกผู้ลงนามก่อนจึงบันทึกได้'}
            </p>
          ) : !dirty && (
            <p className="text-right text-xs text-gray-500">ยังไม่มีอะไรเปลี่ยน แก้ชื่อ ตำแหน่ง หรือวันมีผลก่อนจึงบันทึกได้</p>
          )}
        </div>
      )}>
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm font-bold text-gray-800">ผู้ลงนามช่องนี้คือใคร</p>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
            <button type="button" onClick={() => switchMode('profile')} aria-pressed={sourceMode === 'profile'}
              className={`min-h-11 rounded-lg px-2 text-sm font-semibold transition-colors ${sourceMode === 'profile' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'}`}>
              เลือกจากบุคลากร
            </button>
            <button type="button" onClick={() => switchMode('manual')} aria-pressed={sourceMode === 'manual'}
              className={`min-h-11 rounded-lg px-2 text-sm font-semibold transition-colors ${sourceMode === 'manual' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'}`}>
              กรอกชื่อเอง
            </button>
          </div>
          <p className={HELP_CLASS}>
            {sourceMode === 'profile'
              ? 'คนที่มีบัญชีในระบบ ลงนามในระบบได้ และชื่อตำแหน่งเปลี่ยนตามการแต่งตั้ง'
              : 'ใช้สำหรับผู้ลงนามที่ไม่มีบัญชีในระบบ พิมพ์ชื่อบนเอกสารแล้วเซ็นปากกา ลงนามในระบบไม่ได้'}
          </p>
        </div>

        {sourceMode === 'profile' ? (
          <div>
            <label htmlFor="signatory-person" className="mb-1 block text-sm font-bold text-gray-800">ชื่อผู้ลงนาม *</label>
            <select id="signatory-person" value={profileId} onChange={(event) => setProfileId(event.target.value)}
              aria-label={`ผู้ลงนาม ${slot.label}`} className={FIELD_CLASS}>
              <option value="">— เลือกบุคลากร —</option>
              {/* ผู้ลงนามที่อยู่นอกรายชื่อ (เช่น สมาชิกสภา หรือคนที่เปลี่ยนบทบาทไปแล้ว) ต้องยังเห็นชื่อ ไม่งั้นช่องนี้ดูเหมือนว่างทั้งที่ตั้งไว้ */}
              {assignment?.profile_id && !people.some((person) => person.id === assignment.profile_id) && (
                <option value={assignment.profile_id}>{signatoryName(assignment)} · {signatoryTitle(assignment) || 'ไม่ระบุตำแหน่ง'} (ตั้งไว้เดิม)</option>
              )}
              {peopleGroups.map((group) => (
                <optgroup key={group.key} label={`${group.label} (${group.people.length} คน)`}>
                  {group.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.full_name} · {personTitle(person)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {/* เตือนอย่างเดียว ไม่บล็อกการบันทึก — การให้คนนอกกองรักษาราชการแทนเป็นเรื่องปกติ
                แต่ถ้าเลือกผิดคนจะได้เห็นก่อนกดบันทึก */}
            {crossDepartment && (
              <p className="mt-1.5 text-xs font-medium leading-5 text-amber-800">
                คนนี้ไม่ได้สังกัด {slot.departmentName} — ระบุคำว่า “รักษาราชการแทน” หรือ “ปฏิบัติราชการแทน”
                ในช่องตำแหน่งด้านล่าง (คนละกรณีกัน ตรวจถ้อยคำกับคำสั่งจริงก่อน)
              </p>
            )}
          </div>
        ) : (
          <div>
            <label htmlFor="signatory-manual-name" className="mb-1 block text-sm font-bold text-gray-800">ชื่อ-นามสกุลผู้ลงนาม *</label>
            <input id="signatory-manual-name" value={manualName} onChange={(event) => setManualName(event.target.value)}
              placeholder="เช่น นายสมชาย ใจดี" maxLength={250}
              aria-label={`ชื่อผู้ลงนาม ${slot.label}`} className={FIELD_CLASS} />
          </div>
        )}

        {/* ชื่อตามการแต่งตั้ง — กดแล้วเติมในฟอร์ม ยังไม่บันทึกจนกว่าจะกดบันทึก */}
        {suggestionPicked ? (
          <p className="flex items-center gap-1.5 text-xs font-semibold leading-5 text-emerald-700" data-signatory-suggestion="picked">
            <CheckCircle2 size={14} className="shrink-0" />
            {suggested.kind === 'match' ? 'ตรงกับการแต่งตั้ง' : 'เลือกตามการแต่งตั้งแล้ว — กดบันทึกเพื่อใช้ชื่อนี้'}
          </p>
        ) : suggested.person ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2" data-signatory-suggestion="offer">
            <p className="min-w-0 flex-1 basis-48 text-xs leading-5 text-indigo-900">
              ตามการแต่งตั้ง: <strong>{suggested.person.full_name}</strong> · {personTitle(suggested.person)}
            </p>
            <button type="button" onClick={applySuggestion}
              className="min-h-11 shrink-0 rounded-lg bg-white px-3 text-sm font-bold text-indigo-700 shadow-sm ring-1 ring-indigo-200 hover:bg-indigo-100">
              เลือกคนนี้
            </button>
          </div>
        ) : null}

        <div>
          <label htmlFor="signatory-title" className="mb-1 block text-sm font-bold text-gray-800">
            ตำแหน่งที่พิมพ์ใต้ชื่อ{sourceMode === 'manual' ? ' *' : ''}
          </label>
          <input id="signatory-title" value={titleOverride} onChange={(event) => setTitleOverride(event.target.value)}
            placeholder={sourceMode === 'manual' ? 'เช่น ผู้อำนวยการกองช่าง' : selected ? personTitle(selected) : 'ตำแหน่งจากการแต่งตั้ง'}
            maxLength={250} aria-label={`ชื่อตำแหน่งที่พิมพ์ ${slot.label}`} className={FIELD_CLASS} />
          <p className={HELP_CLASS}>
            {sourceMode === 'profile' && 'เว้นว่างได้ ระบบใช้ตำแหน่งจากการแต่งตั้ง · '}
            ถ้ารักษาราชการแทนหรือปฏิบัติราชการแทน ให้พิมพ์ที่ช่องนี้ตามคำสั่งจริง
          </p>
        </div>

        {/* วันมีผล — แสดงวันที่บันทึกไว้ · เปลี่ยนตัวคน/ตำแหน่งแล้วกลายเป็นวันนี้ (มีผลทันทีที่กดบันทึก)
            เลือกย้อนหลังได้เมื่อคำสั่งแต่งตั้งมีผลก่อนวันที่มาตั้งในระบบ
            ตั้งล่วงหน้าไม่ได้ — เจ้าของระบบเลือกทำเฉพาะย้อนหลัง 2569-10-07 */}
        <div>
          <label htmlFor="signatory-effective" className="mb-1 block text-sm font-bold text-gray-800">มีผลตั้งแต่</label>
          <input id="signatory-effective" type="date" value={effectiveFrom} min={earliest} max={today}
            onChange={(event) => setPickedDate(event.target.value)}
            aria-label={`มีผลตั้งแต่ ${slot.label}`} className={FIELD_CLASS} />
          <p className={HELP_CLASS}>ปกติไม่ต้องแก้ · ถ้าคำสั่งมีผลก่อนวันนี้ เลือกย้อนหลังได้ไม่เกิน {SIGNATORY_BACKDATE_LIMIT_DAYS} วัน</p>
          {backdated && (
            <p className="mt-1 text-xs font-medium leading-5 text-amber-800">
              ย้อนหลัง — เอกสารที่เสร็จตั้งแต่ {thaiDateFromDateInput(effectiveFrom)} จะพิมพ์ชื่อนี้แทนคนเดิม
            </p>
          )}
        </div>

        {/* หัวหน้ากองติ๊กไม่ได้ — อำนาจสั่งใช้รถเป็นของผู้บริหารท้องถิ่นหรือผู้รับมอบอำนาจ
            ตามคำสั่ง (DB บังคับซ้ำอีกชั้นทั้งที่ CHECK และใน RPC) */}
        {!slot.departmentId && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm leading-5 text-gray-800">
            <input type="checkbox" checked={vehicleDefault}
              onChange={(event) => setVehicleDefault(event.target.checked)}
              aria-label={`ใช้เป็นผู้มีอำนาจสั่งใช้รถโดยปริยาย ${slot.label}`}
              className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600" />
            <span>
              <span className="font-semibold">ใช้เป็นผู้มีอำนาจสั่งใช้รถโดยปริยาย (ใบขออนุญาตใช้รถ แบบ 3)</span>
              <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                ใบขอใช้รถจะเลือกคนนี้ให้เอง ติ๊กได้ช่องเดียว ถ้าไม่ติ๊กเลยจะใช้นายก
              </span>
            </span>
          </label>
        )}
      </div>
    </SigningDialogShell>
  )
}

// ช่องขวาของแถว: ระบบเสนออะไร หรือทำไมไม่เสนอ — ทุกกรณีต้องบอกว่าต้องทำอะไรต่อ
function SuggestionCell({ slot, assignment, suggested, change, onApply }) {
  if (change) {
    const reason = change.sameName ? 'คนเดิมมีบัญชีแล้ว ใช้ชื่อนี้แล้วลงนามในระบบได้'
      : change.current ? 'ตามการแต่งตั้ง แต่ตอนนี้ตั้งคนอื่นไว้'
      : 'ตามการแต่งตั้ง'
    return (
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2" data-signatory-suggestion="offer">
        <p className="flex items-start gap-1.5 text-sm leading-5 text-indigo-950">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-indigo-600" />
          <span className="min-w-0">
            ระบบเสนอ <strong>{change.person.name}</strong>
            {change.person.title && <span className="block text-xs text-indigo-800">{change.person.title}</span>}
          </span>
        </p>
        <p className="mt-0.5 pl-5 text-xs leading-5 text-indigo-700">{reason}</p>
        <button type="button" onClick={onApply} data-signatory-apply-one
          className="mt-1.5 min-h-11 w-full rounded-lg bg-white px-3 text-sm font-bold text-indigo-700 shadow-sm ring-1 ring-indigo-200 hover:bg-indigo-100 md:min-h-9">
          ใช้ชื่อนี้
        </button>
      </div>
    )
  }
  if (suggested.kind === 'match') {
    return (
      <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700" data-signatory-suggestion="match">
        <CheckCircle2 size={15} className="shrink-0" /> ตรงกับการแต่งตั้ง
      </p>
    )
  }
  if (suggested.kind === 'acting') {
    return (
      <p className="text-xs leading-5 text-gray-600" data-signatory-suggestion="acting">
        ตั้งผู้แทนไว้ ระบบจึงไม่เสนอชื่อ · ผู้ถือตำแหน่งตามการแต่งตั้งคือ {suggested.person.full_name} — เมื่อกลับมาปฏิบัติหน้าที่ กด “แก้” เพื่อเปลี่ยน
      </p>
    )
  }
  if (suggested.kind === 'ambiguous') {
    return (
      <p className="text-xs font-medium leading-5 text-amber-800" data-signatory-suggestion="ambiguous">
        การแต่งตั้งมี {suggested.count} คน ({suggested.people.map(person => person.full_name).join(', ')}) ระบบจึงไม่เดา — กด “{assignment ? 'แก้' : 'เลือกเอง'}” เพื่อเลือกคนเดียว
      </p>
    )
  }
  // แถวที่แอดมินสร้างเอง (custom) ไม่อยู่ในการแต่งตั้งโดยธรรมชาติ ไม่ต้องเตือน
  if (assignment || slot.optional || slot.role === CUSTOM_ROLE) return null
  return (
    <p className="text-xs leading-5 text-gray-600" data-signatory-suggestion="none">
      ไม่พบคนที่ถือตำแหน่งนี้ในการแต่งตั้ง — กด “เลือกเอง” หรือแต่งตั้งคนเข้าตำแหน่งก่อน ระบบจะเสนอชื่อให้
      · ถ้าหน่วยนี้ไม่มีหัวหน้า ปล่อยว่างได้ เอกสารจะเว้นชื่อให้เขียนด้วยมือ
    </p>
  )
}

function SignatoryRow({ slot, assignment, suggestion, change, onEdit, onApply }) {
  const status = assignmentState(assignment, slot.optional, slot.emptyLabel)
  const suggested = signatorySuggestionState(assignment, suggestion)
  const manual = Boolean(assignment?.manual_name?.trim())
  const title = signatoryTitle(assignment)
  return (
    <li data-signatory-slot={slot.key} className={`${GRID_CLASS} border-b border-gray-100 px-3.5 py-3 last:border-b-0 md:items-start ${status.ready ? '' : 'bg-amber-50/40'}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {status.ready
            ? <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
            : <AlertTriangle size={15} className="shrink-0 text-amber-600" />}
          <span className="break-words text-sm font-bold text-gray-800">{slot.label}</span>
        </div>
        <span className={`ml-5 mt-0.5 block text-xs font-semibold ${status.ready ? 'text-emerald-700' : 'text-amber-700'}`}>{status.label}</span>
        {assignment?.is_vehicle_order_default && (
          <span className="ml-5 mt-1 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700" data-signatory-vehicle-default>
            ผู้มีอำนาจสั่งใช้รถ
          </span>
        )}
        {slot.hint && <p className="ml-5 mt-1 text-xs leading-5 text-gray-500">{slot.hint}</p>}
      </div>

      <div className="min-w-0 pl-5 md:pl-0">
        {assignment ? (
          <>
            <p className="break-words text-sm font-semibold text-gray-900">{signatoryName(assignment)}</p>
            {title && <p className="break-words text-xs leading-5 text-gray-600">{title}</p>}
            <p className={`text-xs leading-5 ${manual ? 'text-amber-800' : 'text-gray-500'}`} data-signatory-source={manual ? 'manual' : 'profile'}>
              {manual ? 'พิมพ์ชื่อเอง · เซ็นปากกาเท่านั้น' : 'มีบัญชี · ลงนามในระบบได้'}
            </p>
            {assignment.effective_from && (
              <p className="text-xs leading-5 text-gray-400">มีผลตั้งแต่ {thaiDateFromDateInput(assignment.effective_from)}</p>
            )}
          </>
        ) : (
          <p className="text-sm leading-5 text-gray-500">
            {slot.optional ? 'ไม่ได้ตั้ง' : 'ยังไม่ได้ตั้ง · เอกสารจะเว้นชื่อให้เขียนด้วยมือ'}
          </p>
        )}
      </div>

      <div className="min-w-0 pl-5 md:pl-0">
        <SuggestionCell slot={slot} assignment={assignment} suggested={suggested} change={change} onApply={onApply} />
      </div>

      <div className="pl-5 md:pl-0 md:text-right">
        <button type="button" onClick={onEdit} data-signatory-edit
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 md:min-h-9 md:w-auto">
          <PenLine size={14} /> {assignment ? 'แก้' : 'เลือกเอง'}
        </button>
      </div>
    </li>
  )
}

// บรรทัดบนสุด: บอกสถานะรวมและ "ขั้นต่อไป" อย่างเดียว เปิดหน้ามาต้องรู้ทันทีว่าต้องทำอะไร ไม่ต้องอ่านคำอธิบาย
// นับเฉพาะช่องที่ระบบติ๊กให้: ช่องที่ตั้งคนอื่นไว้อาจตั้งใจ ถ้านับรวม แถบนี้จะเตือนค้างตลอดไปทั้งที่ไม่ต้องทำอะไร
function NextStep({ changes, missingCount, requiredCount, readyCount, linkedCount, onApplyAll, onOpenUsers }) {
  const actionableCount = changes.filter((change) => change.defaultChecked).length
  const differsCount = changes.length - actionableCount
  const step = actionableCount > 0
    ? { tone: 'border-indigo-200 bg-indigo-50', title: `ระบบเตรียมชื่อให้แล้ว ${actionableCount} ช่อง`, text: 'กดปุ่มนี้ ตรวจชื่อ แล้วกดยืนยัน เสร็จในครั้งเดียว ไม่ต้องกรอกเอง' }
    : missingCount > 0
      ? { tone: 'border-amber-200 bg-amber-50', title: `ยังขาดผู้ลงนาม ${missingCount} ช่อง`, text: 'กด “เลือกเอง” ที่ช่องนั้น หรือแต่งตั้งคนเข้าตำแหน่งก่อน แล้วระบบจะเสนอชื่อให้' }
      : differsCount > 0
        ? { tone: 'border-emerald-200 bg-emerald-50', title: `ตั้งครบแล้ว · มี ${differsCount} ช่องที่ชื่อไม่ตรงการแต่งตั้ง`, text: 'ถ้าตั้งใจให้คนเดิมลงนามต่อ ไม่ต้องทำอะไร ถ้าจะเปลี่ยน กด “ใช้ชื่อนี้” ที่ช่องนั้น' }
        : { tone: 'border-emerald-200 bg-emerald-50', title: 'ตั้งครบแล้ว ไม่ต้องทำอะไรเพิ่ม', text: 'เปลี่ยนตัวคนเมื่อไร แต่งตั้งที่หน้าจัดการผู้ใช้ ระบบจะถามให้ตั้งเป็นผู้ลงนามในขั้นตอนเดียว' }
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 md:flex-row md:items-center ${step.tone}`} data-signatory-next-step>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-gray-900">{step.title}</p>
        <p className="mt-0.5 text-xs leading-5 text-gray-700">{step.text}</p>
        <p className="mt-1 text-xs font-semibold text-gray-600" data-signatory-summary>
          ตั้งแล้ว {readyCount}/{requiredCount} ช่อง · ลงนามในระบบได้ {linkedCount} ช่อง
        </p>
      </div>
      {actionableCount > 0 ? (
        <button type="button" onClick={onApplyAll} data-signatory-apply-all
          className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-indigo-700">
          <Sparkles size={15} /> ตรวจและใช้ชื่อตามการแต่งตั้ง ({actionableCount} ช่อง)
        </button>
      ) : missingCount > 0 && onOpenUsers && (
        <button type="button" onClick={onOpenUsers}
          className="flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-white px-4 text-sm font-bold text-amber-800 hover:bg-amber-100">
          ไปแต่งตั้งที่จัดการผู้ใช้ <ArrowRight size={15} />
        </button>
      )}
    </div>
  )
}

export default function SignatorySettings({ tenant, onOpenUsers = null }) {
  const [departments, setDepartments] = useState([])
  const [people, setPeople] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  // แถวที่กด "เพิ่มผู้ลงนาม" แล้วแต่ยังไม่ได้บันทึก — เก็บแยกเพราะยังไม่มีใน DB
  const [draftRows, setDraftRows] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editingKey, setEditingKey] = useState(null)
  const [applying, setApplying] = useState(null) // รายการที่กำลังยืนยัน: ทั้งหมด หรือช่องเดียว

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
    // ทุกกองมีแถวหัวหน้ากอง · กองผู้บริหารเป็นแบบไม่บังคับ + มีคำอธิบาย (ดู departmentSlotMeta)
    ...departments
      .map((department) => ({
        key: assignmentKey('department_head', department.id),
        role: 'department_head', municipalityId: tenant?.id,
        departmentId: department.id, departmentName: department.name,
        ...departmentSlotMeta(department),
        // ใช้ชื่อกองตรงๆ ห้ามเติมคำว่า "หัวหน้า" นำหน้า — หน่วยงานอย่าง "ตรวจสอบภายใน"
        // ส่วนใหญ่ขึ้นตรงกับปลัดและไม่มีตำแหน่งหัวหน้า ป้ายที่เติมเองจึงผิดกับ อปท. จำนวนมาก
        // ผลพลอยได้: ข้อความนี้กลายเป็นข้อมูล ไม่ใช่โค้ด ผู้ดูแลแก้เองได้ที่หน้าจัดการกอง/ส่วนราชการ
        label: department.name,
      })),
    // แถวที่แอดมินสร้างเอง — มาจากข้อมูลในทะเบียน ไม่ใช่รายการตายตัวในโค้ด
    // draftRows คือแถวที่เพิ่งกด "เพิ่มผู้ลงนาม" แต่ยังไม่ได้บันทึก จึงยังไม่มีใน assignments
    ...[...new Set([
      ...assignments.filter((a) => a.signatory_role === CUSTOM_ROLE).map((a) => a.custom_label),
      ...draftRows,
    ])].filter(Boolean).map((customLabel) => ({
      key: assignmentKey(CUSTOM_ROLE, null, customLabel),
      role: CUSTOM_ROLE, municipalityId: tenant?.id, departmentId: null,
      customLabel, label: customLabel, optional: true, removable: true,
      hint: 'เพิ่มเอง · ใช้กับใบขออนุญาตใช้รถเท่านั้น',
    })),
  ], [departments, tenant?.id, assignments, draftRows])

  const assignmentMap = useMemo(() => Object.fromEntries(
    assignments.map((assignment) => [
      assignmentKey(assignment.signatory_role, assignment.department_id, assignment.custom_label),
      assignment,
    ]),
  ), [assignments])

  const requiredSlots = slots.filter((slot) => !slot.optional)
  const missingCount = slots.filter((slot) => !assignmentState(assignmentMap[slot.key], slot.optional, slot.emptyLabel).ready).length
  const readyCount = requiredSlots.filter((slot) => assignmentState(assignmentMap[slot.key], slot.optional, slot.emptyLabel).ready).length
  const linkedCount = slots.filter((slot) => assignmentMap[slot.key]?.profile_id).length
  const suggestions = useMemo(
    () => Object.fromEntries(slots.map((slot) => [slot.key, appointmentSuggestion(slot, people)])),
    [slots, people])
  // ช่องที่ระบบเตรียมชื่อให้ได้ — ทั้งปุ่มรวมและปุ่มรายช่องใช้รายการชุดนี้ จึงเห็นข้อมูลเดียวกันก่อนยืนยัน
  const changes = useMemo(() => slots.flatMap((slot) => {
    const state = signatorySuggestionState(assignmentMap[slot.key], suggestions[slot.key])
    return SUGGESTABLE_KINDS.includes(state.kind) ? [signatoryChangeFor(slot, assignmentMap[slot.key], state.person)] : []
  }), [slots, assignmentMap, suggestions])
  const changeByKey = useMemo(() => Object.fromEntries(changes.map((change) => [change.key, change])), [changes])
  const editingSlot = editingKey ? slots.find((slot) => slot.key === editingKey) : null

  // ชื่อแถวเป็นตัวระบุแถว ซ้ำกันไม่ได้ (unique index ฝั่ง DB บังคับอีกชั้น แต่ต้องกัน
  // ตั้งแต่หน้าจอ ไม่งั้นผู้ใช้กรอกจนเสร็จแล้วค่อยเจอ error 23505 ที่อ่านไม่ออก)
  function addCustomRow() {
    const raw = window.prompt('ชื่อช่องลงนามที่ต้องการเพิ่ม (เช่น รองนายก, ผู้รับมอบอำนาจสั่งใช้รถ)\nยังไม่ต้องพิมพ์ชื่อคน ขั้นถัดไปจะให้เลือก')
    const label = raw?.trim()
    if (!label) return
    if (label.length > 100) { setError('ชื่อช่องลงนามยาวเกิน 100 ตัวอักษร'); return }
    if (slots.some((slot) => slot.label === label)) { setError(`มีช่อง “${label}” อยู่แล้ว`); return }
    setError('')
    setDraftRows((rows) => [...rows, label])
    setEditingKey(assignmentKey(CUSTOM_ROLE, null, label))
  }

  // ปิดกล่องของแถวที่เพิ่งเพิ่มโดยไม่ได้บันทึก = ไม่เอาแถวนั้น ไม่ทิ้งแถวว่างค้างไว้ในตาราง
  function closeEdit() {
    if (editingSlot?.removable && !assignmentMap[editingSlot.key]) {
      setDraftRows((rows) => rows.filter((label) => label !== editingSlot.customLabel))
    }
    setEditingKey(null)
  }

  async function afterSave(message) {
    setEditingKey(null)
    setApplying(null)
    setNotice(message)
    await reload()
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm md:p-5">
      {/* ชื่อหน้าอยู่ที่ ModuleHeader ตัวกลางของแผงควบคุมแล้ว */}
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">⚠️ {error}</p>}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
      ) : (
        <>
          <NextStep changes={changes} missingCount={missingCount} requiredCount={requiredSlots.length}
            readyCount={readyCount} linkedCount={linkedCount}
            onApplyAll={() => setApplying(changes)} onOpenUsers={onOpenUsers} />
          {notice && (
            <p role="status" className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800" data-signatory-notice>
              <CheckCircle2 size={15} className="shrink-0" /> {notice}
            </p>
          )}
          <p className="text-xs leading-5 text-gray-500">
            ชื่อในตารางนี้พิมพ์ใต้เส้นลงนามของทุกเอกสาร (คำร้อง คำขอบริการประชาชน ใบขอใช้รถ ใบยืมพัสดุ รถรับ-ส่งผู้ป่วย รายงาน)
            · นายกและปลัดใช้กับทุกใบ ช่องของแต่ละกองใช้กับเอกสารที่เข้ากองนั้น
          </p>
          <div className="rounded-xl border border-gray-200">
            <div className={`${GRID_CLASS} hidden border-b border-gray-200 bg-gray-50 px-3.5 py-2 text-xs font-bold text-gray-500 md:grid`}>
              <span>ช่องลงนาม</span>
              <span>ผู้ลงนามที่พิมพ์บนเอกสาร</span>
              <span>ตรงกับการแต่งตั้งไหม</span>
              <span />
            </div>
            <ul>
              {slots.map((slot) => (
                <SignatoryRow key={slot.key} slot={slot} assignment={assignmentMap[slot.key]}
                  suggestion={suggestions[slot.key]} change={changeByKey[slot.key]}
                  onEdit={() => setEditingKey(slot.key)}
                  onApply={() => setApplying([changeByKey[slot.key]])} />
              ))}
            </ul>
            <div className="flex flex-col gap-2 border-t border-gray-100 px-3.5 py-3 md:flex-row md:items-center">
              <button type="button" onClick={addCustomRow} data-signatory-add
                className="flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/50 px-3 text-sm font-bold text-indigo-700 hover:bg-indigo-50 md:min-h-9">
                <Plus size={15} /> เพิ่มผู้ลงนาม
              </button>
              <p className="text-xs leading-5 text-gray-500">
                ใช้เมื่อมีผู้ลงนามนอกรายการข้างบน เช่น รองนายกที่ได้รับมอบอำนาจสั่งใช้รถ
                — ช่องที่เพิ่มเองใช้กับใบขออนุญาตใช้รถเท่านั้น ไม่พิมพ์บนแบบคำร้อง
              </p>
            </div>
          </div>
        </>
      )}

      {editingSlot && (
        <SignatoryEditDialog key={`${editingSlot.key}:${assignmentMap[editingSlot.key]?.id ?? 'empty'}`}
          slot={editingSlot} people={people} departments={departments}
          assignment={assignmentMap[editingSlot.key]} suggestion={suggestions[editingSlot.key]}
          onClose={closeEdit} onSaved={afterSave} />
      )}
      {applying && (
        <SignatoryApplyDialog municipalityId={tenant?.id} changes={applying}
          onClose={() => setApplying(null)}
          onApplied={(count) => afterSave(`ตั้งผู้ลงนามแล้ว ${count} ช่อง`)} />
      )}
    </section>
  )
}

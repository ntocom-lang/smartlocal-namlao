// มอบหมายผู้ไปแทนในกิจกรรมปฏิทิน (เจ้าของระบบสั่ง 2569-10-01)
//
// EventAssignmentFields — ชุดช่องกรอก ใช้ทั้งในฟอร์มเพิ่ม/แก้ไขกิจกรรม และในกล่องเล็กด้านล่าง
// EventAssignmentDialog — กล่องเล็กสำหรับคนที่มอบหมายได้แต่ไม่ได้เปิดฟอร์มแก้ไข (เช่น นายก/เลขาฯ
//                         บนกิจกรรมที่ธุรการเป็นคนลง) บันทึกผ่าน RPC เอง
// AssignmentLine / AssignedBadge — แสดงผลในการ์ด ตาราง และหน้าต่างรายละเอียด
//
// ⚠️ บันทึกเพื่อแจ้งให้ทราบภายในเท่านั้น ไม่ใช่คำสั่งมอบหมาย/มอบอำนาจตามกฎหมาย
// สิทธิ์และการตรวจข้อมูลจริงอยู่ที่ RPC set_event_assignments ฝั่งเซิร์ฟเวอร์
import { useEffect, useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import {
  ASSIGNMENT_TASKS, MAX_ASSIGNEES, groupCandidates, defaultTaskForCategory, defaultOnBehalfOf, onBehalfChoices,
  assignmentSummary, assignmentRecordedLine, assignmentFormFromEvent, assignmentKey, validateAssignment,
} from '../../lib/eventAssignment'
import { loadAssigneeCandidates, saveEventAssignments } from '../../lib/eventAssignmentApi'

const MANUAL = '__manual__'

const chipStyle = (selected) => (selected
  ? { backgroundColor: '#7c3aed', color: 'white' }
  : { backgroundColor: '#f3f4f6', color: '#374151' })

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-violet-400'

export function EventAssignmentFields({ value, onChange, category, audiences }) {
  const { tenant, terminology } = useTenant()
  const [candidates, setCandidates] = useState(null) // null = กำลังโหลด
  const [loadError, setLoadError] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualTitle, setManualTitle] = useState('')
  const [behalfCustom, setBehalfCustom] = useState(false)

  useEffect(() => {
    if (!tenant?.id) return undefined
    let cancelled = false
    loadAssigneeCandidates(tenant.id)
      .then((rows) => { if (!cancelled) setCandidates(rows) })
      .catch((err) => {
        console.error('[events] โหลดรายชื่อผู้รับมอบหมายไม่สำเร็จ:', err?.message ?? err)
        if (!cancelled) {
          setCandidates([])
          setLoadError('โหลดรายชื่อในระบบไม่สำเร็จ — เลือก "พิมพ์ชื่อเอง" แทนได้')
        }
      })
    return () => { cancelled = true }
  }, [tenant?.id])

  const groups = useMemo(() => groupCandidates(candidates, terminology?.councilOrg), [candidates, terminology?.councilOrg])
  const assignees = value?.assignees ?? []
  const chosenIds = new Set(assignees.filter((a) => a.profile_id).map((a) => a.profile_id))
  const full = assignees.length >= MAX_ASSIGNEES
  const choices = onBehalfChoices(terminology)
  const behalfIsCustom = behalfCustom || (!!value?.onBehalfOf && !choices.includes(value.onBehalfOf))

  function addAssignee(person) {
    const next = { ...value, assignees: [...assignees, person] }
    // ระบบร่างให้ตอนเพิ่มคนแรก คนตรวจแล้วแก้ได้ในคลิกเดียว (ไม่ตัดสินแทนคน)
    if (!next.task) next.task = defaultTaskForCategory(category)
    if (!next.onBehalfOf) next.onBehalfOf = defaultOnBehalfOf(audiences, terminology)
    onChange(next)
  }

  function onPick(e) {
    const picked = e.target.value
    if (!picked) return
    if (picked === MANUAL) { setManualOpen(true); return }
    const person = (candidates ?? []).find((c) => c.profile_id === picked)
    if (person) addAssignee({ profile_id: person.profile_id, name: person.full_name, title: person.title ?? '' })
  }

  function addManual() {
    const name = manualName.trim()
    if (!name) return
    addAssignee({ profile_id: null, name, title: manualTitle.trim() })
    setManualName('')
    setManualTitle('')
    setManualOpen(false)
  }

  return (
    <div className="space-y-3 rounded-2xl border border-violet-100 bg-violet-50/50 p-3">
      <div>
        <label className="text-xs font-semibold text-gray-500 mb-1 block">มอบหมายให้ (สูงสุด {MAX_ASSIGNEES} คน)</label>
        {assignees.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {assignees.map((a, i) => (
              <span key={a.profile_id ?? `manual-${i}`}
                className="inline-flex items-center gap-1 rounded-xl border border-violet-200 bg-white px-2.5 py-1 text-xs font-semibold text-violet-800">
                {a.name}
                {a.title ? <span className="font-normal text-violet-500">· {a.title}</span> : null}
                <button type="button" aria-label={`เอา ${a.name} ออก`}
                  onClick={() => onChange({ ...value, assignees: assignees.filter((_, idx) => idx !== i) })}
                  className="ml-0.5 rounded p-0.5 text-violet-400 hover:bg-violet-100 hover:text-red-500">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {!full && (candidates === null ? (
          <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
            <Loader2 size={14} className="animate-spin" /> กำลังโหลดรายชื่อ…
          </div>
        ) : (
          <select value="" onChange={onPick} aria-label="เลือกผู้รับมอบหมาย" className={inputCls}>
            <option value="">— เลือกจากรายชื่อในระบบ —</option>
            {groups.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {g.members.map((m) => (
                  <option key={m.profile_id} value={m.profile_id} disabled={chosenIds.has(m.profile_id)}>
                    {m.full_name}{m.title ? ` — ${m.title}` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={MANUAL}>✏️ พิมพ์ชื่อเอง (คนที่ไม่มีบัญชีในระบบ)…</option>
          </select>
        ))}
        {full && <p className="text-[11px] text-gray-500">ครบ {MAX_ASSIGNEES} คนแล้ว เอาคนเดิมออกก่อนถึงจะเพิ่มได้</p>}
        {loadError && <p className="mt-1 text-[11px] text-amber-700">{loadError}</p>}
        {manualOpen && !full && (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input value={manualName} onChange={(e) => setManualName(e.target.value)} maxLength={120}
              placeholder="ชื่อ-สกุล *" aria-label="ชื่อผู้รับมอบหมาย" className={inputCls} autoFocus />
            <input value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} maxLength={120}
              placeholder="ตำแหน่ง เช่น รองนายก" aria-label="ตำแหน่งผู้รับมอบหมาย" className={inputCls} />
            <div className="flex gap-1.5">
              <button type="button" onClick={addManual} disabled={!manualName.trim()}
                className="flex-1 rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
                เพิ่ม
              </button>
              <button type="button" onClick={() => { setManualOpen(false); setManualName(''); setManualTitle('') }}
                className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-600">
                ยกเลิก
              </button>
            </div>
          </div>
        )}
      </div>

      {assignees.length > 0 && (
        <>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">ภารกิจ</label>
            <div className="flex flex-wrap gap-2">
              {ASSIGNMENT_TASKS.map((t) => (
                <button key={t.value} type="button" aria-pressed={value.task === t.value}
                  onClick={() => onChange({ ...value, task: t.value })}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
                  style={chipStyle(value.task === t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">แทน</label>
            <div className="flex flex-wrap gap-2">
              {choices.map((c) => {
                const selected = !behalfIsCustom && value.onBehalfOf === c
                return (
                  <button key={c} type="button" aria-pressed={selected}
                    onClick={() => { setBehalfCustom(false); onChange({ ...value, onBehalfOf: selected ? '' : c }) }}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
                    style={chipStyle(selected)}>
                    {c}
                  </button>
                )
              })}
              <button type="button" aria-pressed={behalfIsCustom}
                onClick={() => { setBehalfCustom(true); onChange({ ...value, onBehalfOf: '' }) }}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
                style={chipStyle(behalfIsCustom)}>
                อื่นๆ (ระบุ)
              </button>
            </div>
            {behalfIsCustom && (
              <input value={value.onBehalfOf ?? ''} onChange={(e) => onChange({ ...value, onBehalfOf: e.target.value })}
                maxLength={120} placeholder="เช่น ผู้อำนวยการกองช่าง" aria-label="ไปแทนใคร"
                className={`${inputCls} mt-2`} />
            )}
          </div>
        </>
      )}

      <p className="text-[11px] leading-relaxed text-gray-500">
        ⚠️ บันทึกเพื่อแจ้งให้ทราบ ไม่ใช่คำสั่งตามกฎหมาย หากมีคำสั่งมอบหมายให้แนบไฟล์ในช่องเอกสารแนบ · ประชาชนไม่เห็นข้อมูลนี้
      </p>
    </div>
  )
}

export function EventAssignmentDialog({ event, onClose, onSaved }) {
  const [value, setValue] = useState(() => assignmentFormFromEvent(event))
  const originalKey = useMemo(() => assignmentKey(assignmentFormFromEvent(event)), [event])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const d = event?.event_date ? new Date(`${event.event_date}T00:00:00`) : null

  async function handleSave() {
    const message = validateAssignment(value)
    if (message) { setError(message); return }
    if (assignmentKey(value) === originalKey) { onClose(); return }
    setSaving(true)
    setError('')
    try {
      const { data, error: rpcError } = await saveEventAssignments(event.id, value)
      if (rpcError) throw rpcError
      onSaved(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(`บันทึกไม่สำเร็จ: ${err?.message ?? 'เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/50 px-2 pt-2 md:p-6"
      onClick={saving ? undefined : onClose}>
      <div role="dialog" aria-modal="true" aria-label="มอบหมายผู้ไปแทน"
        className="w-full max-w-md md:max-w-xl bg-white rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col max-h-[calc(100dvh-0.5rem)] md:max-h-[88vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-800">มอบหมายผู้ไปแทน</h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {event?.title}{d ? ` · ${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="ปิด"
            className="p-1.5 rounded-xl hover:bg-gray-100 shrink-0">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-3">
          <EventAssignmentFields value={value} onChange={setValue} category={event?.category} audiences={event?.audiences} />
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <span className="text-red-500 font-bold text-sm shrink-0">⚠️</span>
              <p className="text-sm text-red-600 font-medium">{error}</p>
            </div>
          )}
        </div>
        <div className="border-t border-gray-100 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-3 shrink-0">
          <button type="button" onClick={onClose} disabled={saving}
            className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            ยกเลิก
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex-1 py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? <><Loader2 size={16} className="animate-spin" /> กำลังบันทึก...</> : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  )
}

// "👤 มอบหมาย: นายเอ (รองนายกเทศมนตรี) — ไปประชุมแทนนายกเทศมนตรี" — ไม่มีการมอบหมายไม่แสดงอะไร
export function AssignmentLine({ ev, className = '', showRecorded = false }) {
  const text = assignmentSummary(ev?.assignments)
  if (!text) return null
  const recorded = showRecorded ? assignmentRecordedLine(ev.assignments) : ''
  return (
    <div className={className}>
      <p className="text-xs font-medium text-violet-700 leading-relaxed">👤 มอบหมาย: {text}</p>
      {recorded && <p className="text-[11px] text-gray-400 mt-0.5">{recorded}</p>}
    </div>
  )
}

export function AssignedBadge() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-violet-600 text-white">
      📌 คุณได้รับมอบหมาย
    </span>
  )
}

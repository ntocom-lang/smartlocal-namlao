import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { AUTHORITY_NOTE_MAX, MAX_APPROVERS, actionFailureText, describeRpcError, roleLabel } from '../../lib/waterAnnouncements'

// กล่อง "ตั้งค่าผู้มีสิทธิ์ยืนยันประกาศ" — เห็น/ใช้ได้เฉพาะผู้ดูแลระบบของหน่วยงาน (admin) และ superadmin (ฐานข้อมูลตรวจซ้ำทุกครั้ง)
// ตั้งครั้งเดียวแล้วจบ (ไม่ใช่งานประจำวัน) — เลือกเจ้าหน้าที่ 1–5 คนที่หน่วยงานมอบหมายให้ยืนยันประกาศ
// ⚠️ ผู้มีอำนาจประกาศตามกฎหมายและแผนป้องกันและบรรเทาสาธารณภัยของหน่วยงานเป็นไปตามที่หน่วยงานกำหนดเอง ระบบไม่ตัดสินแทน
//    ช่อง "อ้างอิงอำนาจ" ไว้ให้หน่วยงานจดเองว่ามอบหมายตามอะไร (ผู้พัฒนาไม่ได้เติม/ไม่ได้อ้างระเบียบใดให้)
// โหลดรายชื่อเมื่อเปิดกล่องครั้งแรก (ไม่ยิง RPC ตอนเปิดหน้า) · ข้อความอ้างอิงเห็นเฉพาะผู้ดูแลระบบ ไม่ขึ้นหน้าประชาชน

export default function WaterAnnouncementApprovers({ tenantId, onChanged }) {
  const [opened, setOpened] = useState(false)
  const [state, setState] = useState({ status: 'idle', data: null })
  const [notes, setNotes] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [message, setMessage] = useState(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback(() => {
    return supabase.rpc('list_water_announcement_approvers', { _municipality_id: tenantId }).then(({ data, error }) => {
      if (!alive.current) return
      if (error || !data) { setState({ status: 'error', data: null, error }); return }
      setState({ status: 'ok', data })
      setNotes(Object.fromEntries((data.people ?? []).map(p => [p.id, p.authority_note ?? ''])))
    })
  }, [tenantId])

  const onToggle = (event) => {
    const isOpen = event.currentTarget.open
    setOpened(isOpen)
    if (isOpen && state.status === 'idle') {
      setState({ status: 'loading', data: null })
      load()
    }
  }

  const save = async (person, isApprover) => {
    setBusyId(person.id); setMessage(null)
    try {
      const { data, error } = await supabase.rpc('set_water_announcement_approver', {
        _municipality_id: tenantId, _profile_id: person.id, _is_approver: isApprover,
        _authority_note: isApprover ? (notes[person.id] ?? '') : null,
      })
      if (!alive.current) return
      if (error) setMessage({ tone: 'error', text: describeRpcError(error) })
      else if (data?.ok === false) setMessage({ tone: 'warn', text: actionFailureText(data.reason) })
      else {
        setMessage({ tone: 'ok', text: isApprover ? `ตั้ง ${person.name} เป็นผู้มีสิทธิ์ยืนยันแล้ว` : `ถอนสิทธิ์ยืนยันของ ${person.name} แล้ว` })
        await load()
        onChanged?.()
      }
    } catch (error) {
      if (alive.current) setMessage({ tone: 'error', text: describeRpcError(error) })
    } finally {
      if (alive.current) setBusyId(null)
    }
  }

  const people = state.data?.people ?? []
  const approvers = people.filter(p => p.is_approver)
  const full = approvers.length >= (state.data?.max_approvers ?? MAX_APPROVERS)

  return (
    <details data-wa-admin onToggle={onToggle} className="rounded-xl border border-gray-200 bg-white p-3">
      <summary className="min-h-6 cursor-pointer text-sm font-semibold text-gray-800">ตั้งค่าผู้มีสิทธิ์ยืนยันประกาศ (สำหรับผู้ดูแลระบบ)</summary>
      {opened && (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-relaxed text-gray-600">
            เลือกเจ้าหน้าที่ที่หน่วยงานมอบหมายให้ยืนยันประกาศ (ไม่เกิน {MAX_APPROVERS} คน) — ผู้มีอำนาจประกาศเป็นไปตามกฎหมายและแผนของหน่วยงานเอง ระบบไม่ตัดสินแทน
            ช่อง “อ้างอิงอำนาจ” ไว้จดว่ามอบหมายตามอะไร (เช่น เลขที่คำสั่ง) ผู้ที่ถูกตั้งจะเห็นปุ่มยืนยันเมื่อมีร่างประกาศ · ทุกการตั้ง/ถอนมีบันทึกย้อนตรวจ
          </p>
          {message && (
            <p data-wa-admin-notice={message.tone} role="status"
              className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${message.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : message.tone === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
              {message.tone === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
              <span>{message.text}</span>
            </p>
          )}
          {state.status === 'loading' && <div role="status" aria-label="กำลังโหลด" className="flex justify-center py-6"><Loader2 size={22} className="animate-spin text-blue-500" /></div>}
          {state.status === 'error' && (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{describeRpcError(state.error)}</p>
          )}
          {state.status === 'ok' && (
            <>
              <p data-wa-approver-count className="text-xs font-semibold text-gray-700">ผู้มีสิทธิ์ยืนยันตอนนี้ {approvers.length} จาก {state.data.max_approvers ?? MAX_APPROVERS} คน</p>
              {people.length === 0 && <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">ยังไม่มีเจ้าหน้าที่ของหน่วยงานนี้ในระบบให้เลือก</p>}
              <ul className="space-y-2">
                {people.map(person => (
                  <li key={person.id} data-wa-person={person.id} data-wa-approver={person.is_approver ? 'true' : 'false'}
                    className={`rounded-xl border p-3 ${person.is_approver ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 text-sm font-semibold text-gray-900">
                        {person.name}
                        <span className="ml-1.5 text-xs font-normal text-gray-500">{[person.job_title, roleLabel(person.role)].filter(Boolean).join(' · ')}</span>
                      </p>
                      {person.is_approver
                        ? <button type="button" data-wa-action="approver-off" disabled={busyId !== null} onClick={() => save(person, false)}
                            className="inline-flex min-h-11 items-center rounded-xl border border-rose-300 bg-white px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">ถอนสิทธิ์</button>
                        : <button type="button" data-wa-action="approver-on" disabled={busyId !== null || full} onClick={() => save(person, true)}
                            className="inline-flex min-h-11 items-center rounded-xl border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">ตั้งเป็นผู้ยืนยัน</button>}
                    </div>
                    {person.is_approver && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input type="text" maxLength={AUTHORITY_NOTE_MAX} value={notes[person.id] ?? ''} aria-label={`อ้างอิงอำนาจของ ${person.name}`}
                          onChange={e => setNotes(prev => ({ ...prev, [person.id]: e.target.value }))}
                          placeholder="อ้างอิงอำนาจ เช่น ตามคำสั่งหน่วยงานที่ …/…"
                          className="min-h-11 min-w-0 flex-1 basis-56 rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" />
                        <button type="button" data-wa-action="approver-note" disabled={busyId !== null || (notes[person.id] ?? '') === (person.authority_note ?? '')} onClick={() => save(person, true)}
                          className="inline-flex min-h-11 items-center rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">บันทึกข้อความ</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {full && <p className="text-xs text-amber-800">ครบ {state.data.max_approvers ?? MAX_APPROVERS} คนแล้ว — ถอนสิทธิ์ของคนเดิมก่อนจึงจะตั้งคนใหม่ได้</p>}
            </>
          )}
        </div>
      )}
    </details>
  )
}

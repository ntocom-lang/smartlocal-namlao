import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Briefcase, Check, Loader2, Plus, Search, UserPlus, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { adminUpdateUser } from '../../lib/adminUpdateUser'
import { loginIdentifier } from '../../lib/authProviders'
import { ROLE_LABELS } from '../../lib/staffRoster'
import {
  leastPrivilegeRole,
  normalizePositionName,
  positionMatchesDepartment,
  resolvedDepartmentId,
  shouldKeepDepartmentHead,
} from '../../lib/personnelStructure'

export default function PersonnelQuickAssignDialog({
  tenant,
  department,
  positions,
  currentUserId,
  onClose,
  onSaved,
}) {
  const [accountQuery, setAccountQuery] = useState('')
  const [candidates, setCandidates] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [searching, setSearching] = useState(false)
  const [positionQuery, setPositionQuery] = useState('')
  const [selectedPositionId, setSelectedPositionId] = useState('')
  const [localPositions, setLocalPositions] = useState(positions)
  const [saving, setSaving] = useState(false)
  const [creatingPosition, setCreatingPosition] = useState(false)
  const [error, setError] = useState('')
  const requestSequence = useRef(0)

  useEffect(() => {
    const query = accountQuery.trim()
    if (selectedUser || query.length < 2) {
      return undefined
    }

    const requestId = ++requestSequence.current
    const timer = setTimeout(async () => {
      setSearching(true)
      // RPC นี้คืนเฉพาะข้อมูลที่ dialog ใช้ ไม่ดึงเลขบัตร/ที่อยู่มาที่ browser โดยไม่จำเป็น
      const { data, error: searchError } = await supabase.rpc('search_users_for_staff_assignment', {
        p_municipality_id: tenant.id,
        p_search: query,
        p_limit: 10,
      })
      if (requestId !== requestSequence.current) return
      setSearching(false)
      if (searchError) {
        setCandidates([])
        setError('ค้นหาบัญชีไม่สำเร็จ: ' + searchError.message)
        return
      }
      setError('')
      setCandidates((data ?? []).filter((user) => user.id !== currentUserId && user.role !== 'superadmin'))
    }, 350)
    return () => {
      clearTimeout(timer)
      // ยกเลิกผลค้นหาที่กำลังรอด้วย เมื่อเปลี่ยนคำค้น/เลือกคน/ปิด dialog
      requestSequence.current += 1
    }
  }, [accountQuery, currentUserId, selectedUser, tenant.id])

  const availablePositions = useMemo(() => {
    const query = normalizePositionName(positionQuery)
    return localPositions
      .filter((position) => positionMatchesDepartment(position, department.id))
      .filter((position) => !query || normalizePositionName(position.name).includes(query))
      .slice(0, 12)
  }, [department.id, localPositions, positionQuery])

  const selectedPosition = localPositions.find((position) => position.id === selectedPositionId) ?? null
  const nextDepartmentId = resolvedDepartmentId(selectedPosition, department.id, selectedUser?.department_id)
  const nextRole = leastPrivilegeRole(selectedUser?.role)
  const movingDepartment = Boolean(
    selectedUser?.department_id && selectedUser.department_id !== nextDepartmentId,
  )
  const exactPosition = localPositions.find(
    (position) => normalizePositionName(position.name) === normalizePositionName(positionQuery),
  )
  const exactPositionElsewhere = exactPosition?.department_id
    && exactPosition.department_id !== department.id
  const canCreatePosition = positionQuery.trim().length >= 2 && !exactPosition

  function chooseUser(user) {
    setSelectedUser(user)
    setAccountQuery(user.full_name || loginIdentifier(user.email).value || user.phone || 'บัญชีผู้ใช้')
    setCandidates([])
    setError('')
  }

  function choosePosition(position) {
    if (position.department_id && position.department_id !== department.id) {
      setError(`ตำแหน่งนี้ผูกกับกองอื่นแล้ว กรุณาเลือกตำแหน่งของ ${department.name}`)
      return
    }
    setSelectedPositionId(position.id)
    setPositionQuery(position.name)
    setError('')
  }

  async function createPosition() {
    const name = positionQuery.trim().replace(/\s+/g, ' ')
    if (!name || !tenant?.id || !department?.id) return

    const collision = localPositions.find((position) => normalizePositionName(position.name) === normalizePositionName(name))
    if (collision) {
      choosePosition(collision)
      return
    }

    setCreatingPosition(true)
    setError('')
    const { data, error: createError } = await supabase.from('positions').insert({
      municipality_id: tenant.id,
      department_id: department.id,
      department_hint: department.name,
      name,
      category: 'operating_staff',
      role: 'staff',
      sort_order: 0,
    }).select('id, name, role, category, department_id, department_hint, sort_order').single()
    setCreatingPosition(false)

    if (createError) {
      setError(createError.code === '23505'
        ? `มีตำแหน่งชื่อ “${name}” อยู่แล้ว กรุณาไปตรวจที่แท็บแบบตำแหน่ง`
        : 'เพิ่มตำแหน่งไม่สำเร็จ: ' + createError.message)
      return
    }
    setLocalPositions((current) => [...current, data])
    setSelectedPositionId(data.id)
    setPositionQuery(data.name)
  }

  async function saveAssignment() {
    if (!selectedUser || !selectedPosition || !nextDepartmentId) return
    setSaving(true)
    setError('')
    const { error: saveError } = await adminUpdateUser(selectedUser.id, {
      role: nextRole,
      municipality_id: selectedUser.municipality_id || tenant.id,
      department_id: nextDepartmentId,
      position_id: selectedPosition.id,
      is_dept_head: shouldKeepDepartmentHead(selectedUser, nextDepartmentId),
    })
    setSaving(false)
    if (saveError) {
      setError('บันทึกการแต่งตั้งไม่สำเร็จ: ' + saveError.message)
      return
    }
    onSaved?.({ userId: selectedUser.id, position: selectedPosition })
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm md:items-center md:p-4"
      role="dialog" aria-modal="true" aria-labelledby="quick-assign-title">
      <div className="flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:max-w-xl md:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <UserPlus size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="quick-assign-title" className="font-extrabold text-slate-800">เพิ่มบุคลากรใน{department.name}</h2>
            <p className="text-xs text-slate-400">เลือกบัญชีและตำแหน่ง ระบบใส่กองให้โดยอัตโนมัติ</p>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100">
            <X size={19} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <section>
            <label htmlFor="quick-account-search" className="mb-1.5 block text-xs font-bold text-slate-600">1. บุคคล</label>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input id="quick-account-search" value={accountQuery}
                onChange={(event) => {
                  setAccountQuery(event.target.value)
                  setSelectedUser(null)
                  setCandidates([])
                  setSearching(false)
                  setError('')
                }}
                placeholder="พิมพ์ชื่อ เบอร์โทร หรืออีเมล อย่างน้อย 2 ตัวอักษร"
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-10 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100" />
              {searching && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-blue-500" />}
            </div>
            {!selectedUser && candidates.length > 0 && (
              <div className="mt-2 max-h-52 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg">
                {candidates.map((user) => (
                  <button key={user.id} type="button" onClick={() => chooseUser(user)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-blue-50">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-black text-slate-500">
                      {(user.full_name || '?')[0]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-slate-700">{user.full_name || 'ยังไม่ระบุชื่อ'}</span>
                      <span className="block truncate text-xs text-slate-400">
                        {user.phone || loginIdentifier(user.email).value || 'ไม่มีเบอร์ติดต่อ'} · {ROLE_LABELS[user.role]?.label ?? user.role}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {!selectedUser && accountQuery.trim().length >= 2 && !searching && candidates.length === 0 && !error && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                ไม่พบบัญชี บุคคลนี้ต้องสมัครใช้งานก่อน จึงจะแต่งตั้งและกำหนดสิทธิ์ได้
              </p>
            )}
            {selectedUser && (
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                <Check size={16} /> {selectedUser.full_name || 'บัญชีที่เลือก'}
              </div>
            )}
          </section>

          <section>
            <label htmlFor="quick-position-search" className="mb-1.5 block text-xs font-bold text-slate-600">2. ตำแหน่ง</label>
            <div className="relative">
              <Briefcase size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input id="quick-position-search" value={positionQuery}
                onChange={(event) => { setPositionQuery(event.target.value); setSelectedPositionId(''); setError('') }}
                placeholder={`พิมพ์ตำแหน่งใน${department.name}`}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100" />
            </div>
            {positionQuery.trim() && !selectedPosition && (
              <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg">
                {availablePositions.map((position) => (
                  <button key={position.id} type="button" onClick={() => choosePosition(position)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-blue-50">
                    <span className="text-sm font-semibold text-slate-700">{position.name}</span>
                    <span className="shrink-0 text-[10px] font-bold text-slate-400">
                      {position.department_id ? department.name : 'ใช้ได้ทุกกอง'}
                    </span>
                  </button>
                ))}
                {canCreatePosition && (
                  <button type="button" onClick={createPosition} disabled={creatingPosition}
                    className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-left text-sm font-bold text-indigo-700 disabled:opacity-50">
                    {creatingPosition ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                    สร้างตำแหน่ง “{positionQuery.trim()}” ใน{department.name}
                  </button>
                )}
                {exactPositionElsewhere && (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                    มีชื่อตำแหน่งนี้ในกองอื่นแล้ว หากต้องใช้ร่วมหลายกอง ให้เปลี่ยนตำแหน่งนั้นเป็น “ส่วนกลาง”
                    หรือใช้ชื่อที่ระบุสายงานให้ชัดเจนขึ้น
                  </p>
                )}
              </div>
            )}
            {selectedPosition && (
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                <Check size={16} /> {selectedPosition.name}
              </div>
            )}
          </section>

          {selectedUser && selectedPosition && (
            <section className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
              <p className="text-xs font-extrabold text-blue-800">ตรวจสอบก่อนบันทึก</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-5">
                <dt className="text-blue-500">บุคลากร</dt><dd className="font-bold text-blue-900">{selectedUser.full_name || 'ไม่ระบุชื่อ'}</dd>
                <dt className="text-blue-500">สังกัด</dt><dd className="font-bold text-blue-900">{department.name}</dd>
                <dt className="text-blue-500">ตำแหน่ง</dt><dd className="font-bold text-blue-900">{selectedPosition.name}</dd>
                <dt className="text-blue-500">สิทธิ์ระบบ</dt><dd className="font-bold text-blue-900">{ROLE_LABELS[nextRole]?.label ?? nextRole}</dd>
              </dl>
              {selectedPosition.role && selectedPosition.role !== nextRole && (
                <p className="mt-2 text-[11px] leading-5 text-blue-600">
                  ตำแหน่งนี้แนะนำสิทธิ์ “{ROLE_LABELS[selectedPosition.role]?.label ?? selectedPosition.role}” แต่ระบบไม่ยกระดับให้อัตโนมัติ
                  สามารถตรวจและเปลี่ยนภายหลังที่แท็บ “สิทธิ์การใช้งาน”
                </p>
              )}
              {movingDepartment && (
                <p className="mt-2 rounded-lg bg-amber-100 px-2.5 py-2 text-[11px] font-semibold leading-5 text-amber-800">
                  บุคคลนี้สังกัด {selectedUser.department_name || 'กองอื่น'} อยู่แล้ว การบันทึกครั้งนี้จะย้ายมาที่ {department.name}
                  และยกเลิกสถานะหัวหน้ากองเดิม (ถ้ามี)
                </p>
              )}
            </section>
          )}

          {error && (
            <div className="flex gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700" role="alert">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-4 pb-6 pt-3">
          <button type="button" onClick={onClose}
            className="min-h-11 flex-1 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-500 hover:bg-slate-50">
            ยกเลิก
          </button>
          <button type="button" onClick={saveAssignment}
            disabled={saving || !selectedUser || !selectedPosition || !nextDepartmentId}
            className="flex min-h-11 flex-[1.5] items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm disabled:opacity-40">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {movingDepartment ? 'ยืนยันการย้ายและแต่งตั้ง' : 'ยืนยันการแต่งตั้ง'}
          </button>
        </div>
      </div>
    </div>
  )
}

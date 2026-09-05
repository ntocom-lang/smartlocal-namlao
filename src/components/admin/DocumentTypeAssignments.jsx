import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Plus, Save, Trash2, UserCog } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { fetchAssignableStaff, groupStaffByDepartment } from '../../lib/staffRoster'
import { BASE_DOCUMENT_TYPES, defaultSlaDays } from '../../lib/documentTypes'

// หน้าตั้ง "ประเภทคำขอเอกสาร/บริการ + ผังงาน" — มีประเภทอะไรบ้าง กองไหนรับ ใครถือ
// และต้องเสร็จภายในกี่วัน รวมอยู่ในตารางเดียว
//
// เดิมแยกเป็น 2 การ์ด: DocumentTypeFeeSettings (เพิ่ม/ลบประเภท + อัตราค่าธรรมเนียม) กับการ์ดนี้
// รวมเข้าด้วยกัน 2569-09-05 เพราะทั้งสองใบไล่ประเภทชุดเดียวกันคนละตาราง เจ้าหน้าที่ต้องจับคู่
// แถวเอง ส่วน "อัตราค่าธรรมเนียม" ถูกตัดทิ้งพร้อมกัน — ทุก อปท. ตั้งไว้ 0 หมด ไม่มีคำขอใบไหน
// ในระบบเคยมียอด และช่องทางจริงที่ใช้อยู่คือเจ้าหน้าที่แจ้งยอดรายใบในหน้าจัดการคำขอ
// (StaffDashboard) โค้ดฝั่งประชาชน/เจ้าหน้าที่ที่ยังอ่าน fee_schedule[document_type] ไม่ได้แก้
// อ่านค่าเดิมใน DB ได้ตามปกติ เพียงแต่ตั้งค่าใหม่ผ่าน UI ไม่ได้แล้ว
//
// ⚠️ ที่นี่คือจุดที่ตัดสินว่า "ใครจะเห็นข้อมูลส่วนบุคคลของผู้ยื่นคำขอ" — policy
// "read document_requests" ให้ role 'staff' เห็นเฉพาะแถวที่ assigned_to เป็นตัวเอง
// ตั้งคนผิด = ส่งเลขบัตรประชาชน/ที่อยู่/เบอร์โทรของประชาชนไปให้คนที่ไม่ควรเห็น (PDPA)
//
// ⚠️ นี่คือที่เดียวในระบบที่เขียน municipalities.fee_schedule._custom_types ได้ ถ้าลบทิ้ง
// อปท. จะเพิ่ม/ลบประเภทคำขอของตัวเองไม่ได้อีกเลย ทั้งที่หน้าประชาชนทั้ง 6 ธีม, CitizenDocRequest,
// MyDocRequests, StaffDashboard และตารางในไฟล์นี้เองอ่านค่านั้นอยู่

export default function DocumentTypeAssignments({ tenant }) {
  const municipalityId = tenant?.id
  const { patchTenant } = useTenant()
  const [departments, setDepartments] = useState([])
  const [staff, setStaff] = useState([])
  const [rules, setRules] = useState({})     // document_type -> { department_id, assignee_id, sla_days }
  const [drafts, setDrafts] = useState({})   // เฉพาะแถวที่ผู้ใช้แก้ค้างไว้ ยังไม่กดบันทึก
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // ประเภทที่ อปท. เพิ่มเอง — อ่านค่าตั้งต้นจาก tenant ตอน mount ตรงๆ ไม่ผ่าน useEffect sync
  // (cascading render) ฝั่งที่เรียกส่ง key={tenant?.id} มาด้วย พอสลับหน่วยงานคอมโพเนนต์จะ
  // remount แล้วอ่านค่าใหม่เอง ส่วน patchTenant ตอนบันทึกไม่เปลี่ยน id จึงไม่ remount
  const [customTypes, setCustomTypes] = useState(() => tenant?.fee_schedule?._custom_types || [])
  const [customDirty, setCustomDirty] = useState(false)
  // ประเภทที่เคยบันทึกไว้แล้วและถูกกดลบ — เก็บไว้เพื่อตามไปลบแถวผังงานกับคีย์ค่าธรรมเนียมที่ค้าง
  // อยู่ตอนกดบันทึก ไม่งั้นเหลือแถวขยะที่ไม่มี UI ไหนมองเห็นอีกเลย
  const [removedCustom, setRemovedCustom] = useState([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [newEmoji, setNewEmoji] = useState('📋')
  const [newLabel, setNewLabel] = useState('')

  // ไม่ใช้ allDocumentTypes(tenant) แล้ว เพราะรายการที่เพิ่มเองต้องอ่านจาก state ในหน้านี้
  // ให้แถวใหม่โผล่ทันทีตั้งแต่ยังไม่กดบันทึก (tenant เพิ่งอัปเดตหลังบันทึกสำเร็จเท่านั้น)
  const docTypes = useMemo(() => [
    ...BASE_DOCUMENT_TYPES,
    ...customTypes.map(t => ({ value: t.value, label: `${t.emoji || '📋'} ${t.label}`, custom: true })),
  ], [customTypes])

  // reloadKey แทนการเรียก load() ตรงๆ ใน effect — setState แบบ synchronous ในตัว effect
  // ทำให้เกิด cascading render (กติกา react-hooks/set-state-in-effect ของโปรเจกต์นี้)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    if (!municipalityId) return undefined
    let cancelled = false
    Promise.all([
      supabase.from('departments')
        .select('id, name, sort_order')
        .eq('municipality_id', municipalityId)
        .eq('is_active', true)
        .order('sort_order'),
      fetchAssignableStaff(municipalityId),
      supabase.from('document_type_assignments')
        .select('document_type, department_id, assignee_id, sla_days')
        .eq('municipality_id', municipalityId),
    ]).then(([deptRes, people, ruleRes]) => {
      if (cancelled) return
      if (deptRes.error) setError('โหลดรายชื่อกองไม่สำเร็จ: ' + deptRes.error.message)
      else if (ruleRes.error) setError('โหลดค่าที่ตั้งไว้ไม่สำเร็จ: ' + ruleRes.error.message)
      setDepartments(deptRes.data ?? [])
      setStaff(people)
      setRules(Object.fromEntries((ruleRes.data ?? []).map(r => [r.document_type, r])))
      setDrafts({})
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [municipalityId, reloadKey])

  // ค่าที่จะแสดงในแถว = ค่าที่แก้ค้างไว้ → ค่าที่บันทึกไว้ → ค่าว่าง (ใช้ดีฟอลต์ของระบบ)
  function valueOf(docType) {
    const saved_ = rules[docType]
    return {
      department_id: '',
      assignee_id: '',
      sla_days: defaultSlaDays(docType),
      ...(saved_ ?? {}),
      ...(drafts[docType] ?? {}),
    }
  }

  function setField(docType, field, value) {
    setDrafts(prev => ({ ...prev, [docType]: { ...(prev[docType] ?? {}), [field]: value } }))
    setSaved(false)
  }

  function addCustomType() {
    const label = newLabel.trim()
    if (!label) return
    setCustomTypes(prev => [...prev, { value: `custom_${Date.now()}`, label, emoji: newEmoji || '📋' }])
    setCustomDirty(true)
    setSaved(false)
    setNewLabel('')
    setNewEmoji('📋')
    setShowAddForm(false)
  }

  function removeCustomType(value) {
    setCustomTypes(prev => prev.filter(t => t.value !== value))
    // ตัวที่เพิ่งเพิ่มในหน้าจอนี้แล้วลบเลย ยังไม่เคยลง DB จึงไม่ต้องตามไปลบอะไร
    const savedBefore = (tenant?.fee_schedule?._custom_types || []).some(t => t.value === value)
    if (savedBefore) setRemovedCustom(prev => (prev.includes(value) ? prev : [...prev, value]))
    setDrafts(prev => {
      const next = { ...prev }
      delete next[value]
      return next
    })
    setCustomDirty(true)
    setSaved(false)
  }

  // แถวที่แก้ค้างไว้ของประเภทที่เพิ่งถูกลบไม่ต้องบันทึก
  const dirtyTypes = Object.keys(drafts).filter(t => docTypes.some(d => d.value === t))
  const hasChanges = customDirty || dirtyTypes.length > 0

  async function handleSave() {
    if (!hasChanges) return
    setSaving(true)
    setError('')
    try {
      const { data: { user } = {} } = await supabase.auth.getUser()

      // ขั้นที่ 1 — รายการประเภท (municipalities.fee_schedule) ต้องสำเร็จก่อนเสมอ ถ้าล้มตรงนี้
      // ให้หยุด ไม่เขียนผังงานต่อ จะได้ไม่เหลือแถวผังงานของประเภทที่ไม่มีอยู่จริง
      if (customDirty) {
        // read-modify-write: fee_schedule เป็น jsonb ก้อนเดียวที่มีคีย์อื่น (อัตราค่าธรรมเนียมเดิม)
        // ปนอยู่ ห้ามเขียนทับทั้งก้อนจากค่าที่อ่านมาตั้งแต่ตอน mount
        const { data: fresh, error: readErr } = await supabase
          .from('municipalities').select('fee_schedule').eq('id', municipalityId).single()
        if (readErr) throw readErr
        const fee_schedule = { ...(fresh?.fee_schedule || {}) }
        removedCustom.forEach(v => { delete fee_schedule[v] })
        fee_schedule._custom_types = customTypes
        const { error: upErr } = await supabase
          .from('municipalities').update({ fee_schedule }).eq('id', municipalityId)
        if (upErr) throw upErr
        patchTenant({ fee_schedule })

        if (removedCustom.length > 0) {
          const { error: delErr } = await supabase.from('document_type_assignments')
            .delete().eq('municipality_id', municipalityId).in('document_type', removedCustom)
          if (delErr) throw delErr
        }
      }

      // ขั้นที่ 2 — ผังงานรายประเภท
      if (dirtyTypes.length > 0) {
        const rows = dirtyTypes.map(docType => {
          const v = valueOf(docType)
          return {
            municipality_id: municipalityId,
            document_type: docType,
            department_id: v.department_id || null,
            assignee_id: v.assignee_id || null,
            // clamp ให้ตรงกับ CHECK (sla_days BETWEEN 1 AND 90) ฝั่ง DB — ช่องตัวเลขบนเบราว์เซอร์
            // ห้ามค่านอกช่วงไม่ได้จริง (พิมพ์เองหรือวางทับได้) ถ้าปล่อยไปจะได้ error 23514 ดิบๆ
            sla_days: Math.min(90, Math.max(1, parseInt(v.sla_days, 10) || defaultSlaDays(docType))),
            updated_at: new Date().toISOString(),
            updated_by: user?.id ?? null,
          }
        })
        const { error: upsertErr } = await supabase
          .from('document_type_assignments')
          .upsert(rows, { onConflict: 'municipality_id,document_type' })
        if (upsertErr) throw upsertErr
      }

      setCustomDirty(false)
      setRemovedCustom([])
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      reload()
    } catch (err) {
      setError('บันทึกไม่สำเร็จ: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const staffGroups = useMemo(() => groupStaffByDepartment(staff), [staff])
  const unassigned = docTypes.filter(t => !valueOf(t.value).assignee_id)

  const selectCls = 'w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300'

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
        <UserCog size={15} /> ประเภทคำขอเอกสารและผังงาน
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">LPA ๑.๖</span>
      </h2>
      <p className="text-xs text-gray-400 mb-5 leading-relaxed">
        คำขอที่ประชาชนยื่นเข้ามาจะถูกส่งให้กองและผู้รับผิดชอบตามที่ตั้งไว้ทันที พร้อมกำหนดวันแล้วเสร็จ —
        ช่องที่เว้นว่างไว้ระบบจะใช้ค่าเริ่มต้นเดิม (ส่งเข้ากองตามประเภทงาน แต่ไม่มอบหมายให้ใคร
        ต้องรอหัวหน้ากองมอบหมายเอง) ประเภทที่เพิ่มเองจะไปแสดงบนหน้าแรกฝั่งประชาชนและหน้ายื่นคำขอทันที
      </p>

      {!loading && departments.length === 0 && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2.5">
          <p className="text-xs font-bold text-red-900">⚠️ ยังไม่มีกอง/ส่วนราชการในระบบ</p>
          <p className="mt-1 text-[11px] leading-relaxed text-red-800">
            ตั้งโครงสร้างส่วนราชการที่เมนู &ldquo;จัดการผู้ใช้และการแต่งตั้ง&rdquo; ก่อน จึงจะเลือกกองรับผิดชอบได้
          </p>
        </div>
      )}

      {/* คำขอที่ไม่มีเจ้าของไม่ได้หายไปไหน — หัวหน้ากองยังเห็นทั้งกอง แต่จะไม่มีใครถูกเตือนว่า
          "งานนี้ของฉัน" และเจ้าหน้าที่ระดับปฏิบัติงานจะมองไม่เห็นเลยจนกว่าจะมีคนมอบหมาย */}
      {!loading && unassigned.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
          <p className="text-xs font-bold text-amber-900">
            มี {unassigned.length} ประเภทที่ยังไม่ได้ตั้งผู้รับผิดชอบ
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
            คำขอประเภทนี้จะเข้าไปกองอยู่ในสถานะ &ldquo;ยังไม่มอบหมาย&rdquo; รอให้หัวหน้ากองเปิดเข้าไปมอบหมายรายใบ
            ถ้าอยากให้ถึงมือคนทำทันทีตั้งแต่นาทีที่ประชาชนกดส่ง ให้เลือกผู้รับผิดชอบไว้ที่นี่
          </p>
          <p className="mt-1.5 text-[11px] font-semibold text-amber-900">
            {unassigned.map(t => t.label).join(' · ')}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">ประเภทเอกสาร/บริการ</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-44">กองรับผิดชอบ</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-52">ผู้รับผิดชอบ</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-28">แล้วเสร็จใน</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {docTypes.map(({ value, label, custom }) => {
                  const v = valueOf(value)
                  const dirty = Boolean(drafts[value])
                  const rowCls = dirty ? 'bg-amber-50/50'
                    : custom ? 'bg-blue-50/20 hover:bg-blue-50/40'
                    : 'hover:bg-gray-50/50'
                  return (
                    <tr key={value} className={rowCls}>
                      <td className="px-4 py-2.5">
                        <p className="text-sm text-gray-700">{label}</p>
                        {custom && <p className="text-[10px] text-blue-400 mt-0.5">ประเภทที่เพิ่มเอง</p>}
                      </td>
                      <td className="px-3 py-2.5">
                        <select value={v.department_id ?? ''} onChange={e => setField(value, 'department_id', e.target.value)}
                          className={selectCls}>
                          <option value="">— ใช้ค่าเริ่มต้นของระบบ —</option>
                          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        <select value={v.assignee_id ?? ''} onChange={e => setField(value, 'assignee_id', e.target.value)}
                          className={selectCls + (v.assignee_id ? '' : ' border-amber-300')}>
                          <option value="">— ยังไม่มอบหมาย —</option>
                          {staffGroups.map(group => (
                            <optgroup key={group.department_name} label={group.department_name}>
                              {group.members.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.full_name || p.email}{p.is_dept_head ? ' (หัวหน้ากอง)' : ''}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <input type="number" min={1} max={90}
                            value={v.sla_days ?? ''}
                            onChange={e => setField(value, 'sla_days', e.target.value)}
                            className="w-16 text-right text-xs text-gray-900 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300" />
                          <span className="text-xs text-gray-400 shrink-0">วัน</span>
                        </div>
                      </td>
                      <td className="pr-2">
                        {/* ประเภทมาตรฐานลบไม่ได้ — ทั้งระบบอ้างค่าเหล่านี้ตรงๆ ตั้งแต่หน้ายื่นคำขอ
                            ไปจนถึงรายงาน LPA ลบได้เฉพาะประเภทที่ อปท. เพิ่มเอง */}
                        {custom && (
                          <button type="button" onClick={() => removeCustomType(value)}
                            title="ลบประเภทนี้ — คำขอเดิมที่ยื่นด้วยประเภทนี้ยังอยู่ แต่จะไม่มีให้เลือกใหม่"
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {showAddForm ? (
            <div className="mt-3 border border-blue-200 rounded-xl p-4 bg-blue-50 space-y-3">
              <p className="text-xs font-bold text-blue-700">เพิ่มประเภทเอกสาร/บริการใหม่</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newEmoji}
                  onChange={e => setNewEmoji(e.target.value)}
                  placeholder="📋"
                  maxLength={4}
                  className="w-14 text-center text-lg text-gray-900 border border-gray-200 rounded-lg px-1 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
                <input
                  type="text"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCustomType())}
                  placeholder="ชื่อประเภท เช่น ขอใช้สถานที่, ขอถังขยะเพิ่ม"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={addCustomType} disabled={!newLabel.trim()}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors">
                  เพิ่ม
                </button>
                <button type="button" onClick={() => { setShowAddForm(false); setNewLabel(''); setNewEmoji('📋') }}
                  className="px-4 py-2 rounded-lg text-xs text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 transition-colors">
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setShowAddForm(true)}
              className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors">
              <Plus size={13} /> เพิ่มประเภทเอกสาร/บริการใหม่
            </button>
          )}
        </>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
        ⚠️ &ldquo;แล้วเสร็จใน&rdquo; เป็นค่าที่ใช้คำนวณวันครบกำหนดในระบบเท่านั้น
        <strong className="text-gray-500"> ไม่ใช่ระยะเวลาตามคู่มือประชาชน</strong> ที่ อปท. ประกาศไว้
        ถ้าจะใช้อ้างอิงกับประชาชนหรือผู้ตรวจ ต้องเปิดคู่มือประชาชนของ อปท. แล้วตั้งให้ตรงกัน
        การเปลี่ยนค่านี้มีผลกับคำขอที่ยื่นเข้ามาใหม่เท่านั้น คำขอเดิมยังใช้กำหนดวันเดิม
      </p>

      <div className="mt-4 space-y-2">
        <button type="button" onClick={handleSave} disabled={saving || !hasChanges}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 active:scale-95 transition-all"
          style={{ backgroundColor: '#10b981' }}>
          {saving ? <Loader2 size={15} className="animate-spin" />
            : saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
          {saving ? 'กำลังบันทึก...'
            : saved ? 'บันทึกสำเร็จ'
            : hasChanges ? 'บันทึกการเปลี่ยนแปลง' : 'บันทึก'}
        </button>
        {error && (
          <p className="flex items-center gap-1.5 text-xs text-red-600">
            <AlertCircle size={13} /> {error}
          </p>
        )}
      </div>
    </div>
  )
}

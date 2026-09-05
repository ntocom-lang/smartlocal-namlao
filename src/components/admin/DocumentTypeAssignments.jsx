import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Save, UserCog } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchAssignableStaff, groupStaffByDepartment } from '../../lib/staffRoster'
import { allDocumentTypes, defaultSlaDays } from '../../lib/documentTypes'

// หน้าตั้ง "ผังงาน" ของคำขอบริการ/เอกสาร — กองไหนรับ ใครถือ และต้องเสร็จภายในกี่วัน
//
// คู่ขนานกับส่วนตั้งผู้รับผิดชอบ+SLA ในหน้า "ประเภทคำร้อง" (CategoryManager) ที่ใช้ตาราง
// category_assignments เจ้าหน้าที่จะได้เจอวิธีตั้งค่าแบบเดียวกันทั้งสองงาน ไม่ต้องเรียนใหม่
//
// ⚠️ ที่นี่คือจุดที่ตัดสินว่า "ใครจะเห็นข้อมูลส่วนบุคคลของผู้ยื่นคำขอ" — policy
// "read document_requests" ให้ role 'staff' เห็นเฉพาะแถวที่ assigned_to เป็นตัวเอง
// ตั้งคนผิด = ส่งเลขบัตรประชาชน/ที่อยู่/เบอร์โทรของประชาชนไปให้คนที่ไม่ควรเห็น (PDPA)

export default function DocumentTypeAssignments({ tenant }) {
  const municipalityId = tenant?.id
  const [departments, setDepartments] = useState([])
  const [staff, setStaff] = useState([])
  const [rules, setRules] = useState({})     // document_type -> { department_id, assignee_id, sla_days }
  const [drafts, setDrafts] = useState({})   // เฉพาะแถวที่ผู้ใช้แก้ค้างไว้ ยังไม่กดบันทึก
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const docTypes = useMemo(() => allDocumentTypes(tenant), [tenant])

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

  const dirtyTypes = Object.keys(drafts)

  async function handleSave() {
    if (dirtyTypes.length === 0) return
    setSaving(true)
    setError('')
    const { data: { user } = {} } = await supabase.auth.getUser()
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
    const { error: saveError } = await supabase
      .from('document_type_assignments')
      .upsert(rows, { onConflict: 'municipality_id,document_type' })
    setSaving(false)
    if (saveError) { setError('บันทึกไม่สำเร็จ: ' + saveError.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    reload()
  }

  const staffGroups = useMemo(() => groupStaffByDepartment(staff), [staff])
  const unassigned = docTypes.filter(t => !valueOf(t.value).assignee_id)

  const selectCls = 'w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300'

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
        <UserCog size={15} /> กอง ผู้รับผิดชอบ และระยะเวลาแล้วเสร็จ
      </h2>
      <p className="text-xs text-gray-400 mb-5 leading-relaxed">
        คำขอที่ประชาชนยื่นเข้ามาจะถูกส่งให้กองและผู้รับผิดชอบตามที่ตั้งไว้ทันที
        พร้อมกำหนดวันแล้วเสร็จ — ช่องที่เว้นว่างไว้ระบบจะใช้ค่าเริ่มต้นเดิม (ส่งเข้ากองตามประเภทงาน
        แต่ไม่มอบหมายให้ใคร ต้องรอหัวหน้ากองมอบหมายเอง)
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
        <div className="rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">ประเภทเอกสาร/บริการ</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-44">กองรับผิดชอบ</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-52">ผู้รับผิดชอบ</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-28">แล้วเสร็จใน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {docTypes.map(({ value, label }) => {
                const v = valueOf(value)
                const dirty = Boolean(drafts[value])
                return (
                  <tr key={value} className={dirty ? 'bg-amber-50/50' : 'hover:bg-gray-50/50'}>
                    <td className="px-4 py-2.5 text-sm text-gray-700">{label}</td>
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
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
        ⚠️ &ldquo;แล้วเสร็จใน&rdquo; เป็นค่าที่ใช้คำนวณวันครบกำหนดในระบบเท่านั้น
        <strong className="text-gray-500"> ไม่ใช่ระยะเวลาตามคู่มือประชาชน</strong> ที่ อปท. ประกาศไว้
        ถ้าจะใช้อ้างอิงกับประชาชนหรือผู้ตรวจ ต้องเปิดคู่มือประชาชนของ อปท. แล้วตั้งให้ตรงกัน
        การเปลี่ยนค่านี้มีผลกับคำขอที่ยื่นเข้ามาใหม่เท่านั้น คำขอเดิมยังใช้กำหนดวันเดิม
      </p>

      <div className="mt-4 space-y-2">
        <button type="button" onClick={handleSave} disabled={saving || dirtyTypes.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 active:scale-95 transition-all"
          style={{ backgroundColor: '#10b981' }}>
          {saving ? <Loader2 size={15} className="animate-spin" />
            : saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
          {saving ? 'กำลังบันทึก...'
            : saved ? 'บันทึกสำเร็จ'
            : dirtyTypes.length > 0 ? `บันทึกผังงาน (${dirtyTypes.length} ประเภท)` : 'บันทึกผังงาน'}
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

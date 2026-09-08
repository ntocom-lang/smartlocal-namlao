import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Plus, Save, Trash2, UserCog } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { fetchAssignableStaff, groupStaffByDepartment } from '../../lib/staffRoster'
import { BASE_DOCUMENT_TYPES, defaultSlaDays, removedDocumentTypes } from '../../lib/documentTypes'

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
// ⚠️ นี่คือที่เดียวในระบบที่เขียน municipalities.fee_schedule._custom_types (ประเภทที่เพิ่มเอง)
// และ ._removed_types (ประเภทที่ปิดใช้งาน) ได้ ถ้าลบทิ้ง อปท. จะเพิ่ม/ปิด/เปิดประเภทคำขอของตัวเอง
// ไม่ได้อีกเลย ทั้งที่หน้าประชาชนทั้ง 6 ธีม, CitizenDocRequest, MyDocRequests, StaffDashboard
// และตารางในไฟล์นี้เองอ่านค่านั้นอยู่
//
// 2569-09-08 เปลี่ยน UX จาก "ลบ + แถบกู้คืนใต้ตาราง" เป็นสวิตช์เปิด/ปิดในแถว — ค่าที่เขียนลง DB
// เป็นคีย์เดิม (._removed_types) ไม่มี migration ฝั่งประชาชนที่กรองด้วย withoutRemovedTypes()
// ทำงานเหมือนเดิมทุกประการ ที่ต่างคือ **ปิดแล้วไม่ลบแถว document_type_assignments ทิ้งอีก**
// เปิดกลับมาเมื่อไรก็ได้กอง/ผู้รับผิดชอบ/วันแล้วเสร็จเดิมคืนครบ (เดิมต้องมาตั้งใหม่ทุกครั้ง)

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
  // ประเภทที่ปิดใช้งานใน อปท. นี้ (fee_schedule._removed_types) — ลบออกจาก BASE_DOCUMENT_TYPES
  // ตรงๆ ไม่ได้เพราะเป็นลิสต์ร่วมของทุก อปท. ในโค้ด จึงเก็บเป็นรายชื่อ "ไม่เปิดที่นี่" รายหน่วยงาน
  // ครอบคลุมทั้งประเภทมาตรฐานและประเภทที่เพิ่มเอง (ปิดชั่วคราวโดยไม่ต้องลบทิ้ง)
  const [disabledTypes, setDisabledTypes] = useState(() => removedDocumentTypes(tenant))
  const [showAddForm, setShowAddForm] = useState(false)
  const [newEmoji, setNewEmoji] = useState('📋')
  const [newLabel, setNewLabel] = useState('')

  // ไม่ใช้ allDocumentTypes(tenant) แล้ว เพราะรายการที่เพิ่มเองต้องอ่านจาก state ในหน้านี้
  // ให้แถวใหม่โผล่ทันทีตั้งแต่ยังไม่กดบันทึก (tenant เพิ่งอัปเดตหลังบันทึกสำเร็จเท่านั้น)
  //
  // ตารางแสดงทุกประเภทรวมตัวที่ปิดอยู่ (ต่างจากเดิมที่กรองตัวที่ลบออกไปไว้แถบใต้ตาราง) —
  // สวิตช์ต้องอยู่ในแถวเดียวกับที่ปิดมัน ไม่งั้นเปิดกลับต้องไปตามหาที่อื่น
  const docTypes = useMemo(() => [
    ...BASE_DOCUMENT_TYPES,
    ...customTypes.map(t => ({ value: t.value, label: `${t.emoji || '📋'} ${t.label}`, custom: true })),
  ].map(t => ({ ...t, enabled: !disabledTypes.includes(t.value) })), [customTypes, disabledTypes])

  const enabledTypes = useMemo(() => docTypes.filter(t => t.enabled), [docTypes])

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

  // ลบประเภทที่เพิ่มเองออกถาวร (มีเฉพาะตัวที่ อปท. เพิ่มเอง ประเภทมาตรฐานปิดได้อย่างเดียว
  // เพราะลิสต์อยู่ในโค้ดเป็นของกลางทุก อปท.) — ใช้ตอนพิมพ์ชื่อผิดหรือเลิกให้บริการถาวร
  function removeCustomType(value) {
    setCustomTypes(prev => prev.filter(t => t.value !== value))
    // ตัวที่เพิ่งเพิ่มในหน้าจอนี้แล้วลบเลย ยังไม่เคยลง DB จึงไม่ต้องตามไปลบอะไร
    const savedBefore = (tenant?.fee_schedule?._custom_types || []).some(t => t.value === value)
    if (savedBefore) setRemovedCustom(prev => (prev.includes(value) ? prev : [...prev, value]))
    // ลบถาวรแล้วต้องหลุดจากลิสต์ "ปิดอยู่" ด้วย ไม่งั้นเหลือชื่อค้างใน _removed_types ที่ไม่มี
    // ประเภทรองรับอีกแล้ว สะสมไปเรื่อยๆ ทุกครั้งที่ปิดแล้วลบ
    setDisabledTypes(prev => prev.filter(v => v !== value))
    setDrafts(prev => {
      const next = { ...prev }
      delete next[value]
      return next
    })
    setCustomDirty(true)
    setSaved(false)
  }

  // เปิด/ปิดบริการรายประเภท — ปิด = เขียน value ลง fee_schedule._removed_types แล้วทุกจุดที่เป็น
  // "ตัวเลือกยื่นคำขอใหม่" (หน้าแรก 6 ธีม + หน้ายื่นคำขอ) จะกรองทิ้ง คำขอเก่ายังอยู่ครบ
  // เจ้าหน้าที่ยังดำเนินการต่อได้ และยังนับในรายงาน LPA ตามเดิม
  //
  // ผังงานที่ตั้งไว้ (กอง/ผู้รับผิดชอบ/วันแล้วเสร็จ) ไม่ถูกลบตอนปิด จึงไม่ต้องเคลียร์ drafts
  // ของแถวนั้นเหมือนโค้ดเดิม — ปิดแล้วเปิดกลับต้องได้ค่าที่ตั้งไว้คืนครบ
  function toggleType(value) {
    setDisabledTypes(prev => (prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]))
    setCustomDirty(true)
    setSaved(false)
  }

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
        // เขียนทับทั้งชุดเสมอ (ไม่ merge กับค่าที่อ่านมา) เพราะการเปิดกลับคือการเอาชื่อออกจากลิสต์นี้
        if (disabledTypes.length > 0) fee_schedule._removed_types = disabledTypes
        else delete fee_schedule._removed_types
        const { error: upErr } = await supabase
          .from('municipalities').update({ fee_schedule }).eq('id', municipalityId)
        if (upErr) throw upErr
        patchTenant({ fee_schedule })

        // ลบแถวผังงานเฉพาะประเภทที่เพิ่มเองแล้วถูกลบถาวร — ประเภทที่แค่ "ปิด" ต้องเก็บแถวไว้
        // เปิดกลับมาแล้วกอง/ผู้รับผิดชอบ/วันแล้วเสร็จเดิมยังอยู่ ไม่ต้องมาตั้งใหม่
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
  // เตือนเฉพาะประเภทที่เปิดให้บริการอยู่ — ที่ปิดไว้ไม่มีคำขอใหม่เข้ามาอยู่แล้ว
  const unassigned = enabledTypes.filter(t => !valueOf(t.value).assignee_id)

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
        — สวิตช์ท้ายแถวคือ &ldquo;เปิด/ปิดบริการ&rdquo; ปิดแล้วประชาชนยื่นใหม่ไม่ได้ แต่คำขอเดิมยังอยู่ครบ
        และค่าที่ตั้งไว้ในแถวไม่หาย เปิดกลับเมื่อไรก็ใช้ได้ทันที
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
            <table className="w-full text-sm min-w-205">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {/* หัวคอลัมน์ลำดับใช้คำว่า "ที่" ตามแบบพิมพ์ราชการ ไม่ใช่ "ลำดับที่"
                      (ตรงกับแบบ 4 บันทึกการใช้รถ และเทสต์ที่เช็คหัวคอลัมน์นี้อยู่) */}
                  <th className="pl-4 pr-1 py-2.5 text-right text-xs font-semibold text-gray-500 w-10">ที่</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">ประเภทเอกสาร/บริการ</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-44">กองรับผิดชอบ</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-52">ผู้รับผิดชอบ</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-28">แล้วเสร็จใน</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 w-24">เปิดบริการ</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {docTypes.map(({ value, label, custom, enabled }, index) => {
                  const v = valueOf(value)
                  const dirty = Boolean(drafts[value])
                  const rowCls = !enabled ? 'bg-gray-50/60'
                    : dirty ? 'bg-amber-50/50'
                    : custom ? 'bg-blue-50/20 hover:bg-blue-50/40'
                    : 'hover:bg-gray-50/50'
                  return (
                    <tr key={value} className={rowCls}>
                      {/* ลำดับนับจากแถวที่แสดงจริง ไม่ใช่ตำแหน่งใน BASE_DOCUMENT_TYPES —
                          ลบประเภทออกแล้วเลขต้องเรียง 1..n ต่อเนื่อง ไม่มีเลขหาย */}
                      <td className="pl-4 pr-1 py-2.5 text-right text-xs text-gray-400 tabular-nums align-middle">
                        {index + 1}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className={'text-sm ' + (enabled ? 'text-gray-700' : 'text-gray-400')}>{label}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {custom && <span className="text-[10px] text-blue-400">ประเภทที่เพิ่มเอง</span>}
                          {!enabled && (
                            <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-px">
                              ปิดอยู่ — ประชาชนยื่นใหม่ไม่ได้
                            </span>
                          )}
                        </div>
                      </td>
                      {/* ช่องผังงานของแถวที่ปิดอยู่ล็อกไว้ ค่าที่ตั้งไว้ยังอยู่ครบและกลับมาแก้ได้
                          ทันทีที่เปิดใหม่ — กันเจ้าหน้าที่เสียเวลาตั้งผู้รับผิดชอบให้บริการที่ปิดอยู่ */}
                      <td className="px-3 py-2.5">
                        <select value={v.department_id ?? ''} disabled={!enabled}
                          onChange={e => setField(value, 'department_id', e.target.value)}
                          className={selectCls + (enabled ? '' : ' opacity-50 bg-gray-50')}>
                          <option value="">— ใช้ค่าเริ่มต้นของระบบ —</option>
                          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        <select value={v.assignee_id ?? ''} disabled={!enabled}
                          onChange={e => setField(value, 'assignee_id', e.target.value)}
                          className={selectCls + (enabled && !v.assignee_id ? ' border-amber-300' : '') + (enabled ? '' : ' opacity-50 bg-gray-50')}>
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
                          <input type="number" min={1} max={90} disabled={!enabled}
                            value={v.sla_days ?? ''}
                            onChange={e => setField(value, 'sla_days', e.target.value)}
                            className={'w-16 text-right text-xs text-gray-900 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300'
                              + (enabled ? '' : ' opacity-50 bg-gray-50')} />
                          <span className="text-xs text-gray-400 shrink-0">วัน</span>
                        </div>
                      </td>
                      {/* สวิตช์เปิด/ปิดบริการ — ปิดเขียนชื่อลง _removed_types (ทั้งมาตรฐานและที่เพิ่มเอง)
                          ยังไม่มีผลจนกว่าจะกดบันทึก จึงไม่ต้อง confirm ซ้ำ กดพลาดก็กดกลับในแถวเดิมได้ */}
                      <td className="px-3 py-2.5">
                        <div className="flex justify-center">
                          <button type="button" role="switch" aria-checked={enabled}
                            aria-label={`${enabled ? 'ปิด' : 'เปิด'}บริการ ${label}`}
                            onClick={() => toggleType(value)}
                            title={enabled
                              ? 'ปิดบริการนี้ — ประชาชนจะยื่นคำขอใหม่ไม่ได้ คำขอเดิมยังอยู่ครบ'
                              : 'เปิดบริการนี้ให้ประชาชนยื่นคำขอได้'}
                            className={'relative h-5 w-9 shrink-0 rounded-full transition-colors '
                              + (enabled ? 'bg-emerald-500' : 'bg-gray-300')}>
                            <span className={'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all '
                              + (enabled ? 'left-4.5' : 'left-0.5')} />
                          </button>
                        </div>
                      </td>
                      <td className="pr-2">
                        {/* ลบถาวรมีเฉพาะประเภทที่เพิ่มเอง — ประเภทมาตรฐานลบไม่ได้เพราะลิสต์อยู่ในโค้ด
                            เป็นของกลางทุก อปท. (ปิดสวิตช์ให้ผลเท่ากันสำหรับ อปท. นี้อยู่แล้ว) */}
                        {custom && (
                          <button type="button"
                            onClick={() => {
                              const savedBefore = (tenant?.fee_schedule?._custom_types || []).some(t => t.value === value)
                              // ตัวที่เคยบันทึกแล้วอาจมีคำขอของประชาชนผูกอยู่ จึงถามยืนยันก่อน
                              // ส่วนตัวที่เพิ่งพิมพ์เพิ่มในหน้าจอนี้ยังกดลบได้เลยเหมือนเดิม
                              if (!savedBefore || window.confirm(`ลบ "${label}" ออกถาวร?\n\nถ้าแค่หยุดให้บริการชั่วคราว ให้ปิดสวิตช์แทน — ค่าที่ตั้งไว้จะไม่หาย\n\nลบแล้วชื่อประเภทนี้จะหายจากหน้าตั้งค่าถาวร คำขอเดิมที่ยื่นไว้ยังอยู่ครบและดำเนินการต่อได้`)) {
                                removeCustomType(value)
                              }
                            }}
                            title="ลบประเภทที่เพิ่มเองนี้ออกถาวร — ถ้าแค่หยุดให้บริการชั่วคราวให้ปิดสวิตช์แทน"
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

          {/* ปิดหมดทุกประเภท = หน้ายื่นคำขอฝั่งประชาชนว่างเปล่า เตือนไว้เพราะกดปิดทีละตัวจนหมด
              โดยไม่รู้ตัวได้ง่าย และไม่มีอะไรบนหน้าประชาชนบอกว่าทำไมไม่มีบริการให้เลือก */}
          {enabledTypes.length === 0 && (
            <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2.5">
              <p className="text-xs font-bold text-red-900">⚠️ ปิดบริการไว้ทั้งหมด</p>
              <p className="mt-1 text-[11px] leading-relaxed text-red-800">
                หน้ายื่นคำขอฝั่งประชาชนจะไม่มีบริการให้เลือกเลยหลังกดบันทึก — เปิดสวิตช์อย่างน้อย 1 ประเภท
              </p>
            </div>
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

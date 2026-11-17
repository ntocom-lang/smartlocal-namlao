import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, ArrowDown, ArrowUp, Check, CheckCircle2, Eye, EyeOff, FileDown, HelpCircle, Loader2, Pencil, Plus, Trash2, Upload, X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { useAuth } from '../../contexts/AuthContext'
import { uploadFile, deleteFile } from '../../lib/driveStorage'
import { driveFolderPath, DRIVE_MODULES } from '../../lib/driveFolders'
import { moduleForPath } from '../../lib/staffModules'
import { safeLink } from '../../lib/serviceSearch'

// จัดการ "แบบฟอร์มดาวน์โหลด" + "คำถามที่พบบ่อย" ของหน้าค้นหาบริการ (/search) — โครงเดียวกับ PostsManager (แท็บ + การ์ด + แผ่นกรอก)
// สิทธิ์ยึดแบบเดียวกับข่าวสาร (ตัวบังคับจริงคือ RLS ใน 20261203100100_service_help_rls.sql ที่นี่แค่ซ่อนปุ่มให้ตรง):
//   admin/superadmin = ทั้ง อปท. · officer = กองตัวเอง · staff = เพิ่มในกองตัวเอง แก้/ลบเฉพาะที่ตัวเองสร้าง
// ⚠️ ไฟล์ที่อัปโหลดเปิดให้ทุกคนดาวน์โหลดได้ (bucket สาธารณะ) — ห้ามอัปโหลดเอกสารที่กรอกข้อมูลของบุคคลแล้ว (PDPA)

const TABS = [
  { key: 'forms', label: 'แบบฟอร์มดาวน์โหลด', Icon: FileDown },
  { key: 'faqs', label: 'คำถามที่พบบ่อย', Icon: HelpCircle },
]

const TABLE = { forms: 'service_forms', faqs: 'service_faqs' }

// ขนาด/ความยาวตรงกับ CHECK ในฐานข้อมูล (20261203100000_service_help_tables.sql)
const LIMITS = {
  formTitle: { min: 3, max: 200 }, description: 500, keywords: 300, fileName: 200,
  question: { min: 5, max: 300 }, answer: { min: 1, max: 3000 }, linkLabel: 60, linkUrl: 300,
}

const MAX_FILE_BYTES = 10 * 1024 * 1024
const FILE_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
const FILE_ACCEPT = Object.keys(FILE_TYPES).map((ext) => `.${ext}`).join(',')

// ปุ่ม "ไปยื่นเรื่อง" ใต้คำตอบ — path ภายในที่มีจริง กรองตามโมดูลที่ อปท. เปิด (moduleForPath) ตอนแสดงเป็นตัวเลือก
const INTERNAL_LINK_OPTIONS = [
  { value: '/complaint', label: 'ร้องเรียน/ร้องทุกข์' },
  { value: '/doc-request', label: 'งานบริการประชาชน (คำขอเอกสาร)' },
  { value: '/waste', label: 'ตารางวันเก็บขยะ' },
  { value: '/patient-transport', label: 'จองรถรับ-ส่งผู้ป่วย' },
  { value: '/water-situation', label: 'สถานการณ์น้ำ-ฝน' },
  { value: '/events', label: 'ปฏิทินกิจกรรม' },
  { value: '/news', label: 'ข่าวสาร/ประกาศ' },
  { value: '/emergency', label: 'สายด่วนฉุกเฉิน' },
  { value: '/directory', label: 'เบอร์โทรสำคัญ' },
  { value: '/contact', label: 'ติดต่อเรา' },
]
const LINK_CUSTOM = '__custom__'

const EMPTY_FORM_ITEM = { title: '', description: '', keywords: '', department_id: '', is_published: true, file: null }
const EMPTY_FAQ_ITEM = { question: '', answer: '', keywords: '', department_id: '', is_published: true, linkChoice: '', linkCustom: '', link_label: '' }

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

function fileExt(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name ?? ''))
  return m ? m[1].toLowerCase() : ''
}

// แปลงข้อผิดพลาดจากฐานข้อมูล/RLS เป็นข้อความที่เจ้าหน้าที่อ่านเข้าใจ
function friendlyError(error, fallback) {
  const code = error?.code
  const message = String(error?.message ?? '')
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'ไม่มีสิทธิ์ทำรายการนี้ — แก้ได้เฉพาะรายการของกองคุณ หรือรายการที่คุณสร้างเอง'
  }
  if (code === '23514') return 'ข้อมูลไม่ตรงเงื่อนไข เช่น ข้อความสั้น/ยาวเกินกำหนด หรือรูปแบบลิงก์ไม่ถูกต้อง'
  if (code === '23503') return 'กองที่เลือกไม่ถูกต้องหรือถูกลบไปแล้ว กรุณาเลือกใหม่'
  if (code === '23502') return 'ข้อมูลไม่ครบ กรุณากรอกช่องที่จำเป็น'
  if (error?.name === 'AbortError' || /timeout|timed out/i.test(message)) return 'หมดเวลา กรุณาตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'
  return `${fallback}${message ? `: ${message}` : ''}`
}

export default function ServiceHelpManager({ currentUserRole = 'staff', myDepartmentId = null }) {
  const { tenant, isModuleEnabled } = useTenant()
  const { session } = useAuth()
  const userId = session?.user?.id ?? null

  const [tab, setTab] = useState('forms')
  const [items, setItems] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null) // แถวที่กำลังแก้ (null = เพิ่มใหม่)
  const [form, setForm] = useState(EMPTY_FORM_ITEM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saved, setSaved] = useState(false)

  const [toggleSet, setToggleSet] = useState(new Set())
  const [moving, setMoving] = useState(false)
  const [delConfirm, setDelConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState(null) // { tone: 'error' | 'warn', text }

  const isAdmin = ['superadmin', 'admin'].includes(currentUserRole)
  const isForms = tab === 'forms'
  const canCreate = isAdmin || currentUserRole === 'staff' || (currentUserRole === 'officer' && !!myDepartmentId)
  const canManage = (row) => {
    if (isAdmin) return true
    if (currentUserRole === 'officer') return !!myDepartmentId && row.department_id === myDepartmentId
    return currentUserRole === 'staff' && !!userId && row.created_by === userId
  }

  const deptName = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments])

  // ── โหลดรายการ ─────────────────────────────────────────────────────────────
  // reloadTick: สั่งโหลดซ้ำหลังบันทึก/ลบ/เรียงลำดับ · setState ทำหลัง await เท่านั้น (ไม่ตั้งค่าตรงๆ ใน effect)
  const tenantId = tenant?.id
  const [reloadTick, setReloadTick] = useState(0)
  const reload = useCallback(() => { setFetchError(null); setReloadTick((t) => t + 1) }, [])

  useEffect(() => {
    if (!tenantId) return undefined
    let cancelled = false
    const columns = tab === 'forms'
      ? 'id, department_id, title, description, file_url, drive_file_id, file_name, content_type, keywords, is_published, sort_order, created_by'
      : 'id, department_id, question, answer, keywords, link_url, link_label, is_published, sort_order, created_by'
    Promise.resolve(supabase
      .from(TABLE[tab])
      .select(columns)
      .eq('municipality_id', tenantId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }))
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setFetchError(error.message)
        else setItems(data ?? [])
        setLoading(false)
      }, (e) => {
        if (cancelled) return
        setFetchError(e?.message ?? 'โหลดข้อมูลไม่สำเร็จ')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [tenantId, tab, reloadTick])

  useEffect(() => {
    if (!tenant?.id) return undefined
    let cancelled = false
    Promise.resolve(supabase.from('departments').select('id, name').eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order'))
      .then(({ data }) => { if (!cancelled) setDepartments(data ?? []) }, () => {})
    return () => { cancelled = true }
  }, [tenant?.id])

  const linkOptions = useMemo(
    () => INTERNAL_LINK_OPTIONS.filter((o) => { const key = moduleForPath(o.value); return !key || isModuleEnabled(key) }),
    [isModuleEnabled],
  )

  // ── เปิด/ปิดแผ่นกรอก ────────────────────────────────────────────────────────
  function lockedDepartment() { return isAdmin ? '' : (myDepartmentId ?? '') }

  function openNew() {
    setEditing(null)
    setForm({ ...(isForms ? EMPTY_FORM_ITEM : EMPTY_FAQ_ITEM), department_id: lockedDepartment() })
    setSaveError(null)
    setSaved(false)
    setShowForm(true)
  }

  function openEdit(row) {
    setEditing(row)
    if (isForms) {
      setForm({
        title: row.title ?? '', description: row.description ?? '', keywords: row.keywords ?? '',
        department_id: row.department_id ?? '', is_published: row.is_published ?? true, file: null,
      })
    } else {
      const link = row.link_url ?? ''
      const isInternalOption = INTERNAL_LINK_OPTIONS.some((o) => o.value === link)
      setForm({
        question: row.question ?? '', answer: row.answer ?? '', keywords: row.keywords ?? '',
        department_id: row.department_id ?? '', is_published: row.is_published ?? true,
        linkChoice: !link ? '' : (isInternalOption ? link : LINK_CUSTOM),
        linkCustom: link && !isInternalOption ? link : '',
        link_label: row.link_label ?? '',
      })
    }
    setSaveError(null)
    setSaved(false)
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    setEditing(null)
    setSaveError(null)
    setSaved(false)
  }

  function onPickFile(file) {
    if (!file) return
    const ext = fileExt(file.name)
    if (!FILE_TYPES[ext]) { setSaveError('รองรับเฉพาะไฟล์ PDF, Word (.doc .docx) และ Excel (.xls .xlsx)'); return }
    if (file.size > MAX_FILE_BYTES) { setSaveError('ไฟล์ใหญ่เกิน 10 MB'); return }
    if (file.name.length > LIMITS.fileName) { setSaveError(`ชื่อไฟล์ยาวเกิน ${LIMITS.fileName} ตัวอักษร กรุณาเปลี่ยนชื่อไฟล์ก่อน`); return }
    setSaveError(null)
    setForm((f) => ({ ...f, file }))
  }

  // ── บันทึก ────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (saving) return
    setSaveError(null)
    const dept = isAdmin ? (form.department_id || null) : (lockedDepartment() || null)

    // ตรวจฝั่งหน้าจอก่อนส่ง (ฐานข้อมูลตรวจซ้ำอีกชั้น) — ความยาวนับหลัง trim เหมือน CHECK
    let payload
    if (isForms) {
      const title = form.title.trim()
      if (title.length < LIMITS.formTitle.min) { setSaveError(`ชื่อแบบฟอร์มต้องมีอย่างน้อย ${LIMITS.formTitle.min} ตัวอักษร`); return }
      if (!editing && !form.file) { setSaveError('กรุณาเลือกไฟล์แบบฟอร์ม'); return }
      payload = {
        title,
        description: form.description.trim() || null,
        keywords: form.keywords.trim() || null,
        is_published: form.is_published,
        department_id: dept,
      }
    } else {
      const question = form.question.trim()
      const answer = form.answer.trim()
      if (question.length < LIMITS.question.min) { setSaveError(`คำถามต้องมีอย่างน้อย ${LIMITS.question.min} ตัวอักษร`); return }
      if (answer.length < LIMITS.answer.min) { setSaveError('กรุณากรอกคำตอบ'); return }
      let linkUrl = null
      if (form.linkChoice === LINK_CUSTOM) {
        const link = safeLink(form.linkCustom)
        if (!link || link.internal) { setSaveError('ลิงก์ที่กรอกเองต้องขึ้นต้นด้วย https:// เท่านั้น'); return }
        if (form.linkCustom.trim().length > LIMITS.linkUrl) { setSaveError(`ลิงก์ยาวเกิน ${LIMITS.linkUrl} ตัวอักษร`); return }
        linkUrl = form.linkCustom.trim()
      } else if (form.linkChoice) {
        const link = safeLink(form.linkChoice)
        if (!link || !link.internal) { setSaveError('ลิงก์ปุ่มไม่ถูกต้อง'); return }
        linkUrl = form.linkChoice
      }
      payload = {
        question, answer,
        keywords: form.keywords.trim() || null,
        link_url: linkUrl,
        // ข้อความบนปุ่มมีผลเมื่อมีลิงก์เท่านั้น
        link_label: linkUrl ? (form.link_label.trim() || null) : null,
        is_published: form.is_published,
        department_id: dept,
      }
    }

    setSaving(true)
    let uploaded = null
    try {
      if (isForms && form.file) {
        // อัปโหลดตอนกดบันทึก (ตั้งโฟลเดอร์ด้วยชื่อแบบฟอร์มที่ยืนยันแล้ว) — ล้มแล้วยังไม่แตะแถวใดในฐานข้อมูล
        const ext = fileExt(form.file.name)
        const { url, fileId, error: upErr } = await uploadFile('municipality-assets', form.file, {
          folder: driveFolderPath(DRIVE_MODULES.documents, 'แบบฟอร์มดาวน์โหลด', payload.title),
          filename: form.file.name,
          municipality: tenant?.slug,
        })
        if (upErr || !url) { setSaveError(friendlyError(upErr, 'อัปโหลดไฟล์ไม่สำเร็จ')); return }
        uploaded = { fileId }
        payload = {
          ...payload, file_url: url, drive_file_id: fileId ?? null, file_name: form.file.name, content_type: FILE_TYPES[ext],
        }
      }

      let query
      if (editing) {
        // updated_by/updated_at ฐานข้อมูลตั้งเอง ห้ามส่ง · ล็อกกอง: officer/staff ไม่ส่ง department_id ตอนแก้ (คงกองเดิม)
        const body = { ...payload }
        if (!isAdmin) delete body.department_id
        query =supabase.from(TABLE[tab]).update(body).eq('id', editing.id).select('id')
      } else {
        const sortOrder = items.reduce((max, r) => Math.max(max, r.sort_order ?? 0), 0) + 1
        query = supabase.from(TABLE[tab])
          .insert({ ...payload, municipality_id: tenant.id, created_by: userId, sort_order: sortOrder })
          .select('id')
      }
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 20000)
      const { data, error } = await query.abortSignal(ctrl.signal)
      clearTimeout(timer)
      if (error || !data?.length) {
        // บันทึกไม่สำเร็จ → เก็บกวาดไฟล์ที่เพิ่งอัปโหลด (พยายามเท่านั้น) ไม่ให้ค้างบน Drive
        if (uploaded?.fileId) deleteFile(uploaded.fileId).catch(() => {})
        setSaveError(error ? friendlyError(error, 'บันทึกไม่สำเร็จ') : 'ไม่มีสิทธิ์แก้รายการนี้ — แก้ได้เฉพาะรายการของกองคุณ หรือรายการที่คุณสร้างเอง')
        return
      }
      // เปลี่ยนไฟล์แล้วบันทึกแถวสำเร็จ → ลบไฟล์เก่าแบบพยายาม (ล้มก็ไม่ย้อนแถว แต่แจ้งให้รู้)
      if (isForms && editing?.drive_file_id && uploaded?.fileId && editing.drive_file_id !== uploaded.fileId) {
        const { error: delErr } = await deleteFile(editing.drive_file_id)
        if (delErr) setNotice({ tone: 'warn', text: 'บันทึกแล้ว แต่ลบไฟล์เก่าบน Google Drive ไม่สำเร็จ (ไฟล์เก่าไม่ถูกแสดงต่อประชาชนแล้ว)' })
      }
      setSaved(true)
      setTimeout(() => { setShowForm(false); setEditing(null); setSaved(false); reload() }, 600)
    } catch (e) {
      if (uploaded?.fileId) deleteFile(uploaded.fileId).catch(() => {})
      setSaveError(friendlyError(e, 'เกิดข้อผิดพลาด'))
    } finally {
      setSaving(false)
    }
  }

  // ── สลับเผยแพร่/ร่าง ───────────────────────────────────────────────────────
  async function togglePublish(row) {
    if (toggleSet.has(row.id)) return
    setToggleSet((prev) => new Set([...prev, row.id]))
    const next = !row.is_published
    setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, is_published: next } : x)))
    const { data, error } = await supabase.from(TABLE[tab]).update({ is_published: next }).eq('id', row.id).select('id')
    if (error || !data?.length) {
      setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, is_published: row.is_published } : x)))
      setNotice({ tone: 'error', text: error ? friendlyError(error, 'เปลี่ยนสถานะไม่สำเร็จ') : 'ไม่มีสิทธิ์แก้รายการนี้ — แก้ได้เฉพาะรายการของกองคุณ หรือรายการที่คุณสร้างเอง' })
    }
    setToggleSet((prev) => { const s = new Set(prev); s.delete(row.id); return s })
  }

  // ── ลำดับ: สลับค่า sort_order กับรายการที่แก้ได้ติดกัน ─────────────────────────
  async function moveItem(row, dir) {
    if (moving) return
    const idx = items.findIndex((x) => x.id === row.id)
    let j = idx + dir
    while (items[j] && !canManage(items[j])) j += dir
    const other = items[j]
    if (!other) return
    // ค่าเท่ากัน (ค่าเริ่มต้น 0 ซ้ำกัน) สลับค่าไม่ได้ผล → ขยับตัวที่ย้ายไปเลยอีกฝั่งหนึ่งขั้น
    const rowSort = row.sort_order ?? 0
    const otherSort = other.sort_order ?? 0
    const newRow = rowSort === otherSort ? otherSort + dir : otherSort
    const newOther = rowSort === otherSort ? otherSort : rowSort
    setMoving(true)
    const results = await Promise.all([
      supabase.from(TABLE[tab]).update({ sort_order: newRow }).eq('id', row.id).select('id'),
      rowSort === otherSort ? Promise.resolve({ data: [{}], error: null })
        : supabase.from(TABLE[tab]).update({ sort_order: newOther }).eq('id', other.id).select('id'),
    ])
    const failed = results.find((r) => r.error || !r.data?.length)
    if (failed) setNotice({ tone: 'error', text: failed.error ? friendlyError(failed.error, 'เปลี่ยนลำดับไม่สำเร็จ') : 'ไม่มีสิทธิ์เปลี่ยนลำดับรายการนี้' })
    reload()
    setMoving(false)
  }

  // ── ลบ ────────────────────────────────────────────────────────────────────
  async function handleDelete(row) {
    if (deleting) return
    setDeleting(true)
    const { data, error } = await supabase.from(TABLE[tab]).delete().eq('id', row.id).select('id')
    if (error || !data?.length) {
      setNotice({ tone: 'error', text: error ? friendlyError(error, 'ลบไม่สำเร็จ') : 'ไม่มีสิทธิ์ลบรายการนี้ — ลบได้เฉพาะรายการของกองคุณ หรือรายการที่คุณสร้างเอง' })
    } else {
      setItems((prev) => prev.filter((x) => x.id !== row.id))
      setDelConfirm(null)
      if (isForms && row.drive_file_id) {
        const { error: delErr } = await deleteFile(row.drive_file_id)
        if (delErr) setNotice({ tone: 'warn', text: 'ลบรายการแล้ว แต่ลบไฟล์บน Google Drive ไม่สำเร็จ — แจ้งผู้ดูแลระบบให้ลบไฟล์เอง' })
      }
    }
    setDeleting(false)
  }

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const departmentLabel = (row) => (row.department_id ? (deptName.get(row.department_id) ?? 'กองอื่น') : 'ไม่ระบุกอง')

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} type="button" onClick={() => { setTab(key); setItems([]); setLoading(true); setShowForm(false); setDelConfirm(null) }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === key ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
            style={tab === key ? { backgroundColor: 'var(--color-primary)' } : {}}>
            <Icon size={14} /> {label}
          </button>
        ))}
        {canCreate && (
          <button type="button" onClick={openNew}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Plus size={14} /> เพิ่ม{isForms ? 'แบบฟอร์ม' : 'คำถาม'}
          </button>
        )}
      </div>

      {currentUserRole === 'officer' && !myDepartmentId && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          บัญชีหัวหน้ากองยังไม่ได้กำหนดกอง จึงดูข้อมูลได้อย่างเดียว กรุณาให้ผู้ดูแลระบบเทศบาลแต่งตั้งกองก่อน
        </div>
      )}

      {fetchError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">โหลดข้อมูลไม่สำเร็จ</p>
            <p className="text-xs text-red-500 mt-0.5">{fetchError}</p>
          </div>
          <button type="button" onClick={reload} className="ml-auto text-xs underline shrink-0">ลองใหม่</button>
        </div>
      )}

      {notice && (
        <div role="alert" className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
          notice.tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="ปิดข้อความ" className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* แผ่นกรอก */}
      {showForm && (
        <div className="fixed inset-0 z-200 flex items-end sm:items-center justify-center bg-black/40" onClick={closeForm}>
          <div className="relative w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[92dvh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-gray-800">{editing ? 'แก้ไข' : 'เพิ่ม'}{isForms ? 'แบบฟอร์ม' : 'คำถามที่พบบ่อย'}</h3>
              <button type="button" onClick={closeForm} disabled={saving} aria-label="ปิด" className="p-2 rounded-xl hover:bg-gray-100 disabled:opacity-40"><X size={16} /></button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              {isForms ? (
                <>
                  <div className="space-y-1.5">
                    <label htmlFor="sh-title" className="text-xs font-semibold text-gray-500">ชื่อแบบฟอร์ม <span className="text-red-500">*</span></label>
                    <input id="sh-title" value={form.title} onChange={setField('title')} maxLength={LIMITS.formTitle.max}
                      placeholder="เช่น แบบคำขอใบอนุญาตก่อสร้างอาคาร (ข.1)" className={inputCls} />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="sh-desc" className="text-xs font-semibold text-gray-500">คำอธิบายสั้น</label>
                    <textarea id="sh-desc" value={form.description} onChange={setField('description')} maxLength={LIMITS.description} rows={3}
                      placeholder="ใช้เมื่อไร ยื่นที่ไหน" className={`${inputCls} resize-y`} />
                    <p className="text-[11px] text-gray-400 tabular-nums">{form.description.length}/{LIMITS.description}</p>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-gray-500">ไฟล์แบบฟอร์ม {!editing && <span className="text-red-500">*</span>}</p>
                    {/* ข้อความเตือนถาวร: ไฟล์อยู่ใน bucket สาธารณะ ใครมีลิงก์ก็ดาวน์โหลดได้ */}
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                      ไฟล์นี้เปิดให้ทุกคนดาวน์โหลดได้ — อัปโหลดเฉพาะแบบฟอร์มเปล่า ห้ามอัปโหลดเอกสารที่กรอกข้อมูลของบุคคลแล้ว
                    </div>
                    {editing?.file_name && !form.file && (
                      <p className="text-xs text-gray-500 [overflow-wrap:anywhere]">ไฟล์ปัจจุบัน: {editing.file_name} (เลือกไฟล์ใหม่เพื่อเปลี่ยน)</p>
                    )}
                    <label className="flex flex-col items-center justify-center gap-1.5 py-6 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 cursor-pointer hover:border-blue-300 hover:text-blue-400">
                      <Upload size={20} />
                      <span className="text-xs font-medium text-center px-2 [overflow-wrap:anywhere]">{form.file ? form.file.name : 'คลิกเพื่อเลือกไฟล์'}</span>
                      <span className="text-[10px] opacity-60">PDF, Word, Excel — ไม่เกิน 10 MB</span>
                      <input type="file" accept={FILE_ACCEPT} className="hidden" disabled={saving}
                        onChange={(e) => { onPickFile(e.target.files?.[0]); e.target.value = '' }} />
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label htmlFor="sh-q" className="text-xs font-semibold text-gray-500">คำถาม <span className="text-red-500">*</span></label>
                    <input id="sh-q" value={form.question} onChange={setField('question')} maxLength={LIMITS.question.max}
                      placeholder="เช่น ขออนุญาตก่อสร้างต้องใช้เอกสารอะไรบ้าง" className={inputCls} />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="sh-a" className="text-xs font-semibold text-gray-500">คำตอบ <span className="text-red-500">*</span></label>
                    <textarea id="sh-a" value={form.answer} onChange={setField('answer')} maxLength={LIMITS.answer.max} rows={6}
                      className={`${inputCls} resize-y`} />
                    <p className="text-[11px] text-gray-400 tabular-nums">{form.answer.length}/{LIMITS.answer.max}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="sh-link" className="text-xs font-semibold text-gray-500">ปุ่มไปยื่นเรื่อง (ไม่บังคับ)</label>
                    <select id="sh-link" value={form.linkChoice} onChange={setField('linkChoice')} className={inputCls}>
                      <option value="">ไม่มีปุ่ม</option>
                      {/* ตัวเลือกของโมดูลที่ อปท. ปิดอยู่ซ่อนไว้ ยกเว้นรายการที่คำถามนี้เลือกไว้เดิม (ไม่ให้ช่องว่างเปล่าหลอก) */}
                      {INTERNAL_LINK_OPTIONS.filter((o) => linkOptions.includes(o) || o.value === form.linkChoice)
                        .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      <option value={LINK_CUSTOM}>ลิงก์เว็บอื่น (https://)</option>
                    </select>
                    {form.linkChoice === LINK_CUSTOM && (
                      <input value={form.linkCustom} onChange={setField('linkCustom')} maxLength={LIMITS.linkUrl} inputMode="url"
                        placeholder="https://..." aria-label="ลิงก์ปลายทาง" className={inputCls} />
                    )}
                    {form.linkChoice && (
                      <input value={form.link_label} onChange={setField('link_label')} maxLength={LIMITS.linkLabel}
                        placeholder="ข้อความบนปุ่ม เช่น ไปยื่นคำขอ" aria-label="ข้อความบนปุ่ม" className={inputCls} />
                    )}
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <label htmlFor="sh-kw" className="text-xs font-semibold text-gray-500">คำค้นเพิ่ม (คั่นด้วยจุลภาค)</label>
                <input id="sh-kw" value={form.keywords} onChange={setField('keywords')} maxLength={LIMITS.keywords}
                  placeholder="คำที่ชาวบ้านมักพิมพ์ค้น เช่น สร้างบ้าน, ต่อเติม" className={inputCls} />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="sh-dept" className="text-xs font-semibold text-gray-500">กอง</label>
                {isAdmin ? (
                  <select id="sh-dept" value={form.department_id} onChange={setField('department_id')} className={inputCls}>
                    <option value="">ไม่ระบุกอง</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                ) : (
                  <p id="sh-dept" className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-sm text-gray-600">
                    {lockedDepartment() ? (deptName.get(lockedDepartment()) ?? 'กองของคุณ') : 'ไม่ระบุกอง'}
                  </p>
                )}
              </div>

              <button type="button" className="flex items-center gap-3 text-left" onClick={() => setForm((f) => ({ ...f, is_published: !f.is_published }))}
                role="switch" aria-checked={form.is_published}>
                <span className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${form.is_published ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_published ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </span>
                <span className="text-sm font-medium text-gray-700 select-none">{form.is_published ? 'เผยแพร่ทันที' : 'บันทึกเป็นฉบับร่าง'}</span>
              </button>

              {saveError && (
                <div role="alert" className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600">{saveError}</p>
                </div>
              )}
              {saved && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
                  <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                  <p className="text-xs text-green-600 font-medium">บันทึกสำเร็จ!</p>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 shrink-0 flex gap-2">
              <button type="button" onClick={handleSave} disabled={saving || saved}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity"
                style={{ backgroundColor: saved ? '#10b981' : 'var(--color-primary)' }}>
                {saving ? <><Loader2 size={14} className="animate-spin" /> กำลังบันทึก...</>
                  : saved ? <><CheckCircle2 size={14} /> บันทึกสำเร็จ</>
                    : <><Check size={14} /> บันทึก</>}
              </button>
              <button type="button" onClick={closeForm} disabled={saving}
                className="px-5 py-3 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 disabled:opacity-40">ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      {/* รายการ */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
      ) : items.length === 0 && !fetchError ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
          {isForms ? <FileDown size={40} strokeWidth={1.2} /> : <HelpCircle size={40} strokeWidth={1.2} />}
          <div className="text-center">
            <p className="text-sm font-medium">ยังไม่มี{isForms ? 'แบบฟอร์ม' : 'คำถามที่พบบ่อย'}</p>
            <p className="text-xs mt-0.5">กด "เพิ่ม{isForms ? 'แบบฟอร์ม' : 'คำถาม'}" เพื่อเริ่มต้นได้เลย · หน้าค้นหาของประชาชนยังค้นบริการได้ตามปกติ</p>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((row) => {
            const manage = canManage(row)
            return (
              <li key={row.id} className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2 transition-opacity ${!row.is_published ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isForms ? 'bg-cyan-50 text-cyan-700' : 'bg-sky-50 text-sky-600'}`}>
                    {isForms ? <FileDown size={18} /> : <HelpCircle size={18} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 leading-snug [overflow-wrap:anywhere]">{isForms ? row.title : row.question}</p>
                    {isForms
                      ? <p className="text-xs text-gray-500 mt-0.5 [overflow-wrap:anywhere]">{row.description || row.file_name || ''}</p>
                      : <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 [overflow-wrap:anywhere]">{row.answer}</p>}
                    <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-gray-400">
                      <span>{departmentLabel(row)}</span>
                      {!row.is_published && <span className="font-semibold text-gray-500">ฉบับร่าง</span>}
                      {isForms && row.file_name && row.description && <span className="[overflow-wrap:anywhere]">{row.file_name}</span>}
                    </p>
                  </div>
                </div>

                {currentUserRole === 'officer' && !manage && (
                  <p className="text-[11px] font-medium text-gray-400">ข้อมูลกองอื่น · ดูอย่างเดียว</p>
                )}

                {manage && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <button type="button" onClick={() => togglePublish(row)} disabled={toggleSet.has(row.id)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-50 ${
                        row.is_published ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}>
                      {toggleSet.has(row.id) ? <Loader2 size={10} className="animate-spin" /> : row.is_published ? <Eye size={11} /> : <EyeOff size={11} />}
                      {row.is_published ? 'เผยแพร่' : 'ฉบับร่าง'}
                    </button>
                    <button type="button" onClick={() => openEdit(row)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[13px] font-medium bg-blue-50 text-blue-600 hover:bg-blue-100">
                      <Pencil size={11} /> แก้ไข
                    </button>
                    <span className="flex items-center gap-1">
                      <button type="button" onClick={() => moveItem(row, -1)} disabled={moving} aria-label="เลื่อนขึ้น"
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 disabled:opacity-40"><ArrowUp size={14} /></button>
                      <button type="button" onClick={() => moveItem(row, 1)} disabled={moving} aria-label="เลื่อนลง"
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 disabled:opacity-40"><ArrowDown size={14} /></button>
                    </span>
                    {delConfirm === row.id ? (
                      <div className="ml-auto flex items-center gap-1">
                        <button type="button" onClick={() => handleDelete(row)} disabled={deleting}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[13px] font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50">
                          {deleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />} ยืนยันลบ
                        </button>
                        <button type="button" onClick={() => setDelConfirm(null)} disabled={deleting}
                          className="px-2.5 py-1.5 rounded-lg text-[13px] font-medium bg-gray-100 text-gray-500 hover:bg-gray-200">ยกเลิก</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setDelConfirm(row.id)} aria-label="ลบ"
                        className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

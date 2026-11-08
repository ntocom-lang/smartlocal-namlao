// เอกสารแนบของโครงการ (PR-C2) — สำเนาเอกสารจาก e-GP / e-LAAS / ใบที่ลงนามแล้ว · เก็บไฟล์บน Drive ส่วนตัว (bucket org-documents) ในฐานข้อมูลเก็บแค่ตัวอ้างอิง
// จัดกลุ่มตามขั้นของโครงการ แล้วเรียงตามงวด · ผู้ดู (read อย่างเดียว) เห็นรายการ/เลขที่ แต่เปิดไฟล์ private (drive:) ไม่ได้ —
//   Edge Function drive-file ไม่ให้ role viewer เปิดไฟล์ private (ตัดสินแล้วว่าไม่แก้) · ลิงก์ https เปิดได้ตามปกติ
// ลบได้เฉพาะผู้จัดการ หรือคนที่แนบเอง (policy ฐานข้อมูลตรวจซ้ำ)
import { useEffect, useState } from 'react'
import { AlertOctagon, ExternalLink, FileText, Loader2, Plus } from 'lucide-react'
import { STAGES, STAGE_LABELS } from '../../../lib/constructionLifecycle'
import { addDocument, currentUserId, deleteDocument, openDocument, recordHistory } from '../../../lib/constructionLifecycleApi'
import {
  DOC_KINDS, DOC_KIND_BY_KEY, DOC_SOURCE_LABELS, documentStageOf, historyNote, installmentSlots, validateAttachment,
} from '../../../lib/constructionInstallmentForm'
import { isPrivateDriveRef } from '../../../lib/driveStorage'
import { Field } from './ui'
import { btnGhost, btnPrimary, inp } from './uiStyles'
import { thaiDay } from './lifecycleFormat'

const SOURCE_STYLE = { egp: 'border-blue-200 bg-blue-50 text-blue-700', elaas: 'border-violet-200 bg-violet-50 text-violet-700', system: 'border-teal-200 bg-teal-50 text-teal-700' }
const VIEWER_FILE_NOTE = 'ไฟล์เปิดได้เฉพาะเจ้าหน้าที่ — ขอดูผ่านกองช่าง'

const sizeText = bytes => {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return null
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

function AddDocumentForm({ bundle, project, onClose, onChanged }) {
  const [docKind, setDocKind] = useState('')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [refNo, setRefNo] = useState('')
  const [refDate, setRefDate] = useState('')
  const [installmentNo, setInstallmentNo] = useState('')
  const [file, setFile] = useState(null)
  const [fileKey, setFileKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const slots = installmentSlots(bundle)

  const pickKind = key => {
    setDocKind(key)
    if (!titleTouched) setTitle(DOC_KIND_BY_KEY[key]?.label ?? '')
  }
  const pickFile = e => {
    const picked = e.target.files?.[0] ?? null
    const problem = picked ? validateAttachment(picked) : null
    if (problem) { setError(problem); setFile(null); setFileKey(k => k + 1); return }
    setError('')
    setFile(picked)
  }
  const submit = async () => {
    if (!docKind) { setError('เลือกชนิดเอกสาร'); return }
    setBusy(true); setError('')
    const result = await addDocument({
      project, file, docKind, title, refNo, refDate, installmentNo: installmentNo || null,
      stage: documentStageOf(project), source: DOC_KIND_BY_KEY[docKind].source,
    })
    setBusy(false)
    if (result.error) { setError(result.message || result.error.message || 'เกิดข้อผิดพลาด'); return }
    await recordHistory(project.id, historyNote('document_add', null, result.row))
    await onChanged?.()
    onClose()
  }

  return (
    <div className="space-y-3 rounded-xl bg-gray-50 p-3 text-left">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ชนิดเอกสาร">
          <select className={inp} value={docKind} onChange={e => pickKind(e.target.value)}>
            <option value="">— เลือกชนิดเอกสาร —</option>
            {DOC_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="ชื่อเอกสาร">
          <input className={inp} value={title} maxLength={300} onChange={e => { setTitle(e.target.value); setTitleTouched(true) }} />
        </Field>
        <Field label="เลขที่เอกสาร">
          <input className={inp} value={refNo} maxLength={200} onChange={e => setRefNo(e.target.value)} />
        </Field>
        <Field label="ลงวันที่">
          <input className={inp} type="date" value={refDate} onChange={e => setRefDate(e.target.value)} />
        </Field>
        {slots.length > 0 && (
          <Field label="ของงวดที่">
            <select className={inp} value={installmentNo} onChange={e => setInstallmentNo(e.target.value)}>
              <option value="">— ไม่เกี่ยวกับงวด —</option>
              {slots.map(s => <option key={s.installment_no} value={s.installment_no}>งวดที่ {s.installment_no}</option>)}
            </select>
          </Field>
        )}
        <Field label="แนบไฟล์ (PDF หรือรูปภาพ ไม่เกิน 20 MB — ไม่บังคับ)" className="sm:col-span-2">
          <input key={fileKey} className={inp} type="file" accept="application/pdf,image/*" onChange={pickFile} />
        </Field>
      </div>
      <p className="text-[11px] text-gray-500">ไม่มีไฟล์ก็จดเลขที่เอกสารไว้ได้ (เช่นเลขที่เอกสารที่ออกจาก e-GP) · ห้ามแนบเอกสารที่มีข้อมูลส่วนบุคคลของประชาชน</p>
      {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700"><AlertOctagon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={submit}>
          {busy && <Loader2 size={16} className="animate-spin" />}{busy && file ? 'กำลังอัปโหลด…' : 'บันทึกเอกสาร'}
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={onClose}>ยกเลิก</button>
      </div>
    </div>
  )
}

function DocumentRow({ doc, canOpenPrivate, canDelete, onOpen, onDelete, busy }) {
  const [confirming, setConfirming] = useState(false)
  const privateRef = isPrivateDriveRef(doc.file_ref)
  const linkRef = /^https?:\/\//i.test(doc.file_ref ?? '')
  const detail = [
    DOC_KIND_BY_KEY[doc.doc_kind]?.label ?? doc.doc_kind,
    doc.ref_no ? `เลขที่ ${doc.ref_no}${doc.ref_date ? ` ลว. ${thaiDay(doc.ref_date)}` : ''}` : doc.ref_date ? `ลว. ${thaiDay(doc.ref_date)}` : null,
    doc.installment_no ? `งวดที่ ${doc.installment_no}` : null,
    sizeText(doc.size_bytes),
  ].filter(Boolean).join(' · ')
  return (
    <li className="px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <FileText size={18} className="mt-0.5 shrink-0 text-gray-400" aria-hidden="true" />
        <span className="min-w-0 flex-1 basis-48">
          <span className="font-semibold text-gray-900">{doc.title}</span>
          {SOURCE_STYLE[doc.source] && <span className={`ml-1.5 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${SOURCE_STYLE[doc.source]}`}>{DOC_SOURCE_LABELS[doc.source]}</span>}
          <span className="mt-0.5 block text-xs text-gray-600">{detail}</span>
          {!doc.file_ref && <span className="mt-0.5 block text-[11px] text-gray-400">จดเลขที่เท่านั้น (ไม่มีไฟล์แนบ)</span>}
          {privateRef && !canOpenPrivate && <span className="mt-0.5 block text-[11px] text-amber-700">{VIEWER_FILE_NOTE}</span>}
        </span>
        {(privateRef || linkRef) && (
          <button type="button" className={btnGhost} disabled={busy || (privateRef && !canOpenPrivate)} onClick={() => onOpen(doc)}>
            <ExternalLink size={15} />เปิดไฟล์
          </button>
        )}
        {canDelete && !confirming && <button type="button" className={`${btnGhost} text-red-600`} disabled={busy} onClick={() => setConfirming(true)}>ลบ</button>}
      </div>
      {confirming && (
        <div role="alertdialog" aria-label="ยืนยันลบเอกสาร" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3 py-2">
          <p className="min-w-0 flex-1 basis-56 text-sm text-red-800">ลบเอกสาร "{doc.title}"{privateRef ? ' (ไฟล์ย้ายลงถังขยะของ Drive)' : ''}</p>
          <button type="button" className={`${btnGhost} border-red-300 text-red-700`} disabled={busy} onClick={() => { setConfirming(false); onDelete(doc) }}>ยืนยันลบ</button>
          <button type="button" className={btnGhost} disabled={busy} onClick={() => setConfirming(false)}>ไม่ลบ</button>
        </div>
      )}
    </li>
  )
}

/** userId = ผู้ใช้ปัจจุบัน (ไม่ส่ง = อ่านจาก session) ใช้ตัดสินว่าลบเอกสารที่ตัวเองแนบได้ไหม */
export default function DocumentsSection({ bundle, access, userId, onChanged, initialAdding = false }) {
  const project = bundle.project
  const canWrite = Boolean(access.write || access.manage)
  const manage = Boolean(access.manage)
  const [adding, setAdding] = useState(initialAdding)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fetchedUid, setFetchedUid] = useState(null)
  useEffect(() => {
    if (userId !== undefined) return undefined
    let live = true
    currentUserId().then(id => { if (live) setFetchedUid(id) }).catch(() => {})
    return () => { live = false }
  }, [userId])
  const uid = userId !== undefined ? userId : fetchedUid

  const docs = [...(bundle.documents ?? [])]
  const order = stage => { const i = STAGES.indexOf(stage); return i === -1 ? 99 : i }
  docs.sort((a, b) => order(a.stage) - order(b.stage)
    || (Number(a.installment_no ?? 0) - Number(b.installment_no ?? 0))
    || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  const groups = []
  for (const doc of docs) {
    const key = doc.stage ?? ''
    if (groups.at(-1)?.key !== key) groups.push({ key, items: [] })
    groups.at(-1).items.push(doc)
  }

  const open = async doc => {
    setBusy(true); setError('')
    const result = await openDocument(doc)
    setBusy(false)
    if (result.error) setError(result.message)
  }
  const remove = async doc => {
    setBusy(true); setError('')
    const result = await deleteDocument(doc)
    setBusy(false)
    if (result.error) { setError(result.message); return }
    await recordHistory(project.id, historyNote('document_delete', doc, null))
    await onChanged?.()
  }

  return (
    <section className="rounded-2xl border border-gray-200" aria-label="เอกสารแนบ">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <b className="text-sm text-gray-900">เอกสารแนบ</b>
        <span className="text-xs text-gray-500">{docs.length} รายการ · สำเนาจาก e-GP / e-LAAS / ใบที่ลงนามแล้ว</span>
      </div>
      {error && <p role="alert" className="mx-4 mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700"><AlertOctagon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{error}</p>}
      {groups.length === 0 && <p className="px-4 py-3 text-xs text-gray-500">ยังไม่มีเอกสารแนบ</p>}
      {groups.map(group => (
        <div key={group.key || 'none'}>
          <p className="bg-gray-50 px-4 py-1.5 text-xs font-bold text-gray-600">{group.key ? `ขั้น${STAGE_LABELS[group.key]}` : 'ไม่ระบุขั้น'}</p>
          <ul className="divide-y divide-gray-100">
            {group.items.map(doc => (
              <DocumentRow key={doc.id} doc={doc} busy={busy} onOpen={open} onDelete={remove}
                canOpenPrivate={canWrite} canDelete={canWrite && (manage || (Boolean(uid) && doc.created_by === uid))} />
            ))}
          </ul>
        </div>
      ))}
      {canWrite && (
        <div className="border-t border-gray-100 px-4 py-3">
          {adding
            ? <AddDocumentForm bundle={bundle} project={project} onClose={() => setAdding(false)} onChanged={onChanged} />
            : <button type="button" className={btnGhost} onClick={() => setAdding(true)}><Plus size={15} />เพิ่มเอกสาร</button>}
        </div>
      )}
    </section>
  )
}

import { useEffect, useState } from 'react'
import { History, Loader2, Pencil } from 'lucide-react'
import { editComplaintText, fetchTextRevisions } from '../../lib/complaintFinish'

const FIELD_LABEL = { subject: 'เรื่อง', detail: 'รายละเอียด', technician_note: 'บันทึกผล' }

function formatWhen(value) {
  return new Date(value).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ข้อความคำร้อง (เรื่อง/รายละเอียด/บันทึกผล) + ปุ่มแก้ของผู้รับผิดชอบ + ประวัติทุกรุ่น
// เจ้าของระบบให้ผู้รับผิดชอบแก้ข้อความที่ผู้ร้องพิมพ์ผิดได้ (2569-09-15) — ⚠️ ข้อความของผู้ร้องคือหลักฐาน
// ค่าเดิมทุกรุ่นจึงเก็บที่ complaint_text_revisions โดย trigger (แก้/ลบผ่าน API ไม่ได้) และแสดงให้เห็นตรงนี้เสมอ
// อ่านประวัติได้เฉพาะแอดมิน ผู้รับผิดชอบ และผู้ร้อง (RLS) — คนอื่นได้รายการว่างเฉยๆ
export default function ComplaintTextBlock({ complaint: c, canEdit = false, onSaved, title = 'รายละเอียดแนบมา', showNote = true }) {
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState(c.subject ?? '')
  const [detail, setDetail] = useState(c.detail ?? '')
  const [note, setNote] = useState(c.technician_note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [revisions, setRevisions] = useState([])
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    let alive = true
    fetchTextRevisions(c.id).then(({ data }) => { if (alive) setRevisions(data) })
    return () => { alive = false }
  }, [c.id, c.subject, c.detail, c.technician_note])

  function startEdit() {
    setSubject(c.subject ?? '')
    setDetail(c.detail ?? '')
    setNote(c.technician_note ?? '')
    setError('')
    setEditing(true)
  }

  async function save() {
    if (!detail.trim()) { setError('รายละเอียดต้องไม่ว่าง'); return }
    const patch = {}
    if (subject.trim() !== (c.subject ?? '').trim()) patch.subject = subject
    if (detail.trim() !== (c.detail ?? '').trim()) patch.detail = detail
    if (note.trim() !== (c.technician_note ?? '').trim()) patch.technicianNote = note
    if (Object.keys(patch).length === 0) { setEditing(false); return }
    setSaving(true)
    const { error: saveError } = await editComplaintText(c.id, patch)
    setSaving(false)
    if (saveError) { setError('บันทึกไม่สำเร็จ: ' + saveError.message); return }
    setEditing(false)
    onSaved?.({
      ...(patch.subject !== undefined ? { subject: subject.trim() || null } : {}),
      ...(patch.detail !== undefined ? { detail: detail.trim() } : {}),
      ...(patch.technicianNote !== undefined ? { technician_note: note.trim() || null } : {}),
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</p>
        {canEdit && !editing && (
          <button type="button" onClick={startEdit}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100">
            <Pencil size={11} /> แก้ไขข้อความ
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2 rounded-2xl border border-blue-200 bg-blue-50/40 p-3">
          <p className="text-[11px] text-blue-800">
            แก้เฉพาะคำผิดหรือข้อความที่อ่านไม่เข้าใจ — ข้อความเดิมจะถูกเก็บในประวัติ แอดมินและผู้ร้องเปิดดูได้
          </p>
          <label className="block text-[11px] font-semibold text-gray-600">เรื่อง
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800" />
          </label>
          <label className="block text-[11px] font-semibold text-gray-600">รายละเอียด
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={4} maxLength={5000}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 resize-y" />
          </label>
          <label className="block text-[11px] font-semibold text-gray-600">บันทึกผลการดำเนินงาน
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 resize-y" />
          </label>
          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving}
              className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
              {saving && <Loader2 size={12} className="animate-spin" />} บันทึกการแก้ไข
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving}
              className="flex-1 py-2 rounded-xl text-xs font-medium text-gray-600 bg-white border border-gray-200">
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-2">
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.detail}</p>
          {showNote && c.technician_note && (
            <p className="text-xs text-gray-600 border-t border-gray-200 pt-2 whitespace-pre-wrap">
              <span className="font-semibold">บันทึกผล:</span> {c.technician_note}
            </p>
          )}
        </div>
      )}

      {revisions.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <button type="button" onClick={() => setShowHistory((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-xs font-semibold text-amber-800">
            <span className="inline-flex items-center gap-1"><History size={12} /> ข้อความถูกแก้ไข {revisions.length} ครั้ง</span>
            <span>{showHistory ? 'ซ่อน' : 'ดูข้อความเดิม'}</span>
          </button>
          {showHistory && (
            <ol className="mt-2 space-y-2">
              {revisions.map((r) => (
                <li key={r.id} className="rounded-lg bg-white border border-amber-100 p-2 text-[11px] text-gray-700">
                  <p className="font-semibold text-gray-800">
                    {FIELD_LABEL[r.field] ?? r.field} · {r.edited_by_name || 'เจ้าหน้าที่'} · {formatWhen(r.edited_at)}
                  </p>
                  <p className="mt-1 text-gray-500">เดิม:</p>
                  <p className="whitespace-pre-wrap line-through decoration-red-300">{r.old_value || '—'}</p>
                  <p className="mt-1 text-gray-500">แก้เป็น:</p>
                  <p className="whitespace-pre-wrap">{r.new_value || '—'}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
